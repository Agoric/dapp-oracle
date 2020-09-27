// @ts-check

import '@agoric/install-ses';

import test from 'ava';
import bundleSource from '@agoric/bundle-source';

import { E } from '@agoric/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/test/unitTests/contracts/fakeVatAdmin';
import { makeZoe } from '@agoric/zoe';

import '../src/types';
import '@agoric/zoe/exported';
import { makeIssuerKit } from '@agoric/ertp';

/**
 * @typedef {Object} TestContext
 * @property {ZoeService} zoe
 * @property {(t: ExecutionContext) => Promise<OracleStartFnResult>} makePingOracle
 * @property {Amount} feeAmount
 * @property {IssuerKit} link
 *
 * @typedef {import('ava').ExecutionContext<TestContext>} ExecutionContext
 */

const contractPath = `${__dirname}/../src/contract`;

test.before(
  'setup oracle',
  /** @param {ExecutionContext} ot */ async ot => {
    // Outside of tests, we should use the long-lived Zoe on the
    // testnet. In this test, we must create a new Zoe.
    const zoe = makeZoe(makeFakeVatAdmin());

    // Pack the contract.
    const contractBundle = await bundleSource(contractPath);

    const link = makeIssuerKit('$LINK', 'nat');

    // Install the contract on Zoe, getting an installation. We can
    // use this installation to look up the code we installed. Outside
    // of tests, we can also send the installation to someone
    // else, and they can use it to create a new contract instance
    // using the same code.
    const installation = await E(zoe).install(contractBundle);

    const feeAmount = link.amountMath.make(1000);
    /**
     * @returns {Promise<OracleStartFnResult>}
     */
    const makePingOracle = async t => {
      /** @type {OracleHandler} */
      const oracleHandler = harden({
        async onQuery(query, actions) {
          if (query.kind === 'Paid') {
            await E(actions).assertDeposit({ Fee: feeAmount });
          }
          const reply = harden({ pong: query });
          if (query.kind === 'Paid') {
            E(actions)
              .collectFee({ Fee: feeAmount })
              .then(collected => t.deepEqual(collected.Fee, feeAmount));
          }
          return reply;
        },
      });

      /** @type {OracleStartFnResult} */
      const startResult = await E(zoe).startInstance(
        installation,
        { Link: link.issuer },
        { oracleHandler, oracleDescription: 'myOracle' },
      );

      t.is(await E(startResult.publicFacet).getDescription(), 'myOracle');
      return startResult;
    };

    ot.context.zoe = zoe;
    ot.context.makePingOracle = makePingOracle;
    ot.context.feeAmount = feeAmount;
    ot.context.link = link;
  },
);

test('single oracle', /** @param {ExecutionContext} t */ async t => {
  const { zoe, link, makePingOracle, feeAmount } = t.context;

  // Get the Zoe invitation issuer from Zoe.
  const invitationIssuer = E(zoe).getInvitationIssuer();

  const {
    publicFacet,
    creatorFacet: pingCreator,
    creatorInvitation: pingRevoke,
  } = await makePingOracle(t);

  const revokeOffer = E(zoe).offer(pingRevoke);

  E(revokeOffer)
    .getPayouts()
    .then(payouts =>
      Promise.all(
        Object.entries(payouts).map(async ([keyword, payment]) => {
          const amount = await link.issuer.getAmountOf(payment);
          return [keyword, amount];
        }),
      ),
    )
    .then(kvals => {
      t.deepEqual(kvals, [['Fee', link.amountMath.make(799)]]);
    });

  const completeObj = E(revokeOffer).getOfferResult();

  const query1 = { kind: 'Free', data: 'foo' };
  const query2 = { kind: 'Paid', data: 'bar' };
  const query3 = { kind: 'Paid', data: 'baz' };
  const query4 = { kind: 'Paid', data: 'bot' };

  const freeReply = E(publicFacet).query({ hello: 'World' });
  const invitation1 = E(publicFacet).makeQueryInvitation(query1);
  const invitation2 = E(publicFacet).makeQueryInvitation(query2);
  const invitation3 = E(publicFacet).makeQueryInvitation(query3);
  const invitation4 = E(publicFacet).makeQueryInvitation(query4);

  // Ensure all three are real Zoe invitations.
  t.truthy(await E(invitationIssuer).isLive(invitation1));
  t.truthy(await E(invitationIssuer).isLive(invitation2));
  t.truthy(await E(invitationIssuer).isLive(invitation3));
  t.truthy(await E(invitationIssuer).isLive(invitation4));

  t.deepEqual(
    (await E(invitationIssuer).getAmountOf(invitation1)).value[0].query,
    query1,
  );
  t.deepEqual(
    (await E(invitationIssuer).getAmountOf(invitation2)).value[0].query,
    query2,
  );
  t.deepEqual(
    (await E(invitationIssuer).getAmountOf(invitation3)).value[0].query,
    query3,
  );
  t.deepEqual(
    (await E(invitationIssuer).getAmountOf(invitation4)).value[0].query,
    query4,
  );

  const offer = E(zoe).offer(invitation1);

  // Ensure our oracle handles $LINK.
  await E(pingCreator).addFeeIssuer(link.issuer);
  const overAmount = link.amountMath.add(feeAmount, link.amountMath.make(799));
  const offer3 = E(zoe).offer(
    invitation3,
    harden({ give: { Fee: overAmount } }),
    harden({
      Fee: link.mint.mintPayment(overAmount),
    }),
  );

  t.deepEqual(await freeReply, {
    pong: { hello: 'World' },
  });

  // Check the free result.
  t.deepEqual(await E(offer).getOfferResult(), {
    pong: { kind: 'Free', data: 'foo' },
  });

  // Check the overpaid result.
  t.deepEqual(await E(offer3).getOfferResult(), {
    pong: { kind: 'Paid', data: 'baz' },
  });
  t.deepEqual(
    await link.issuer.getAmountOf(E(offer3).getPayout('Fee')),
    link.amountMath.subtract(overAmount, feeAmount),
  );

  // Check the unpaid result.
  const offer2 = E(zoe).offer(invitation2);

  // Check the underpaid result.
  const underAmount = link.amountMath.make(500);
  const offer4 = E(zoe).offer(
    invitation4,
    harden({ give: { Fee: underAmount } }),
    harden({
      Fee: link.mint.mintPayment(underAmount),
    }),
  );

  await t.throwsAsync(() => E(offer2).getOfferResult(), { instanceOf: Error });
  await t.throwsAsync(() => E(offer4).getOfferResult(), { instanceOf: Error });
  t.deepEqual(
    await link.issuer.getAmountOf(E(offer4).getPayout('Fee')),
    underAmount,
  );

  const withdrawSome = E(pingCreator).makeWithdrawInvitation();
  const withdrawOffer = E(zoe).offer(
    withdrawSome,
    harden({
      want: { Fee: link.amountMath.make(201) },
    }),
  );
  t.is(await E(withdrawOffer).getOfferResult(), 'liquidated');

  const badInvitation = E(publicFacet).makeQueryInvitation({
    hello: 'nomore',
  });
  t.is(await E(completeObj).exit(), 'liquidated');
  const badOffer = E(zoe).offer(badInvitation);

  // Ensure the oracle no longer functions after revocation.
  await t.throwsAsync(() => E(badOffer).getOfferResult(), {
    instanceOf: Error,
    message: /^Oracle .* revoked$/,
  });
  await t.throwsAsync(() => E(publicFacet).query({ hello: 'not again' }), {
    instanceOf: Error,
    message: /^Oracle .* revoked$/,
  });

  t.deepEqual(
    await link.issuer.getAmountOf(E(withdrawOffer).getPayout('Fee')),
    link.amountMath.make(201),
  );
});

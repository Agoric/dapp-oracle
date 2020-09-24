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

const contractPath = `${__dirname}/../src/contract`;

test('contract with multiple oracles', async t => {
  // Outside of tests, we should use the long-lived Zoe on the
  // testnet. In this test, we must create a new Zoe.
  const zoe = makeZoe(makeFakeVatAdmin());

  // Get the Zoe invitation issuer from Zoe.
  const invitationIssuer = E(zoe).getInvitationIssuer();

  // Pack the contract.
  const contractBundle = await bundleSource(contractPath);

  const link = makeIssuerKit('$LINK', 'nat');

  // Install the contract on Zoe, getting an installation. We can
  // use this installation to look up the code we installed. Outside
  // of tests, we can also send the installation to someone
  // else, and they can use it to create a new contract instance
  // using the same code.
  const installation = await E(zoe).install(contractBundle);

  /** @type {{ publicFacet: OraclePublicFacet }} */
  const { publicFacet } = await E(zoe).startInstance(installation);

  // Create some oracles.
  const { adminFacet, oracle } = await E(publicFacet).makeOracleKit('myOracle');
  t.is(await E(oracle).getAllegedName(), 'myOracle');

  const feeAmount = link.amountMath.make(1000);
  /** @type {OracleHandler} */
  const oracleHandler = harden({
    async onCreate(o, oh) {
      t.is(o, oracle);
      t.is(oh, oracleHandler);
    },
    async onQuery(o, query, oh) {
      t.is(o, oracle);
      t.is(oh, oracleHandler);
      /** @type {OracleQueryHandler} */
      const oracleQueryHandler = harden({
        async calculateFee(q, isFinal, oqh) {
          t.is(q, query);
          t.is(typeof isFinal, 'boolean');
          t.is(oqh, oracleQueryHandler);
          if (q.kind !== 'Paid') {
            // No fee for an unpaid query.
            return undefined;
          }
          return harden({ Fee: feeAmount });
        },
        async getReply(q, oqh) {
          t.is(q, query);
          t.is(oqh, oracleQueryHandler);
          return harden({ pong: q });
        },
        async receiveFee(q, collected, oqh) {
          t.is(q, query);
          t.is(oqh, oracleQueryHandler);
          if (q.kind === 'Paid') {
            // eslint-disable-next-line no-await-in-loop
            t.is(await link.issuer.getAmountOf(E.G(collected).Fee), feeAmount);
          } else {
            // eslint-disable-next-line no-await-in-loop
            t.deepEqual(await collected, {});
          }
        },
      });
      return oracleQueryHandler;
    },
    async onRevoke(o, oh) {
      t.is(o, oracle);
      t.is(oh, oracleHandler);
    },
  });

  t.deepEqual(await E(publicFacet).query(oracle, { hello: 'World' }), {
    pong: { hello: 'World' },
  });

  const invitation = E(publicFacet).makeQueryInvitation(oracle, {
    kind: 'Free',
    data: 'foo',
  });
  const invitation2 = E(publicFacet).makeQueryInvitation(oracle, {
    kind: 'Paid',
    data: 'bar',
  });
  const invitation3 = E(publicFacet).makeQueryInvitation(oracle, {
    kind: 'Paid',
    data: 'baz',
  });

  // Ensure all three are real Zoe invitations.
  t.truthy(await E(invitationIssuer).isLive(invitation));
  t.truthy(await E(invitationIssuer).isLive(invitation2));
  t.truthy(await E(invitationIssuer).isLive(invitation3));

  const offer = E(zoe).offer(invitation);
  const overAmount = link.amountMath.make(1500);
  const offer3 = E(zoe).offer(
    invitation3,
    { give: { Fee: overAmount } },
    {
      Fee: link.mint.mintPayment(overAmount),
    },
  );

  // We only just now initialize the oracleHandler.
  E(adminFacet).setHandler(oracleHandler);

  // Check the free result.
  t.deepEqual(await E(offer).getOfferResult(), {
    pong: { kind: 'Free', data: 'foo' },
  });

  // Check the overpaid result.
  t.deepEqual(await E(offer3).getOfferResult(), {
    pong: { kind: 'Paid', data: 'baz' },
  });
  t.is(
    await link.issuer.getAmountOf(E(offer3).getPayout('Fee')),
    link.amountMath.subtract(overAmount, feeAmount),
  );

  // Check the unpaid result.
  const offer2 = E(zoe).offer(invitation2);

  // Check the underpaid result.
  const underAmount = link.amountMath.make(500);
  const offer4 = E(zoe).offer(
    invitation2,
    { give: { Fee: underAmount } },
    {
      Fee: link.mint.mintPayment(underAmount),
    },
  );

  await t.throwsAsync(() => E(offer2).getOfferResult(), { instanceOf: Error });
  await t.throwsAsync(() => E(offer4).getOfferResult(), { instanceOf: Error });
  t.is(await link.issuer.getAmountOf(E(offer4).getPayout('Fee')), underAmount);

  await E(adminFacet).revoke();

  // Ensure the oracle no longer functions after revocation.
  await t.throwsAsync(
    () => E(publicFacet).makeQueryInvitation(oracle, { hello: 'nomore' }),
    { instanceOf: Error },
  );
  await t.throwsAsync(
    () => E(publicFacet).query(oracle, { hello: 'not again' }),
    { instanceOf: Error },
  );
});

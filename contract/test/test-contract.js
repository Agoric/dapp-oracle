// @ts-check

import '@agoric/install-ses';

import test from 'ava';
import bundleSource from '@agoric/bundle-source';

import { E } from '@agoric/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/test/unitTests/contracts/fakeVatAdmin';
import { makeZoe } from '@agoric/zoe';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';

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
  const oracleProcess = async notifierP => {
    for await (const queries of makeAsyncIterableFromNotifier(notifierP)) {
      for (const [queryId, query] of queries) {
        if (query.kind === 'Paid') {
          E(adminFacet).wantPayment({ Fee: feeAmount });
        }
        const collected = E(adminFacet).reply(queryId, { pong: query });

        if (query.kind === 'Paid') {
          // eslint-disable-next-line no-await-in-loop
          t.is(await link.issuer.getAmountOf(E.G(collected).Fee), feeAmount);
        } else {
          // eslint-disable-next-line no-await-in-loop
          t.deepEqual(await collected, {});
        }
      }
    }
    return true;
  };

  const processedP = oracleProcess(E(adminFacet).getQueryNotifier());

  t.deepEqual(await E(oracle).query({ hello: 'World' }), {
    pong: { hello: 'World' },
  });

  const invitation = E(oracle).makeQueryInvitation({
    kind: 'Free',
    data: 'foo',
  });
  const invitation2 = E(oracle).makeQueryInvitation({
    kind: 'Paid',
    data: 'bar',
  });
  const invitation3 = E(oracle).makeQueryInvitation({
    kind: 'Paid',
    data: 'baz',
  });

  const offer = E(zoe).offer(invitation);
  const overAmount = link.amountMath.make(1500);
  const offer3 = E(zoe).offer(
    invitation3,
    { give: { Fee: overAmount } },
    {
      Fee: link.mint.mintPayment(overAmount),
    },
  );

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

  // Ensure the processed promise resolves as true.
  t.is(await processedP, true);
});

// @ts-check

import '@agoric/install-ses';

import test from 'ava';
import bundleSource from '@agoric/bundle-source';

import { E } from '@agoric/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/test/unitTests/contracts/fakeVatAdmin';
import { makeZoe } from '@agoric/zoe';
import { makeIssuerKit } from '@agoric/ertp';

const contractPath = `${__dirname}/../src/contract`;

test('contract with valid offers', async t => {
  // Outside of tests, we should use the long-lived Zoe on the
  // testnet. In this test, we must create a new Zoe.
  const zoe = makeZoe(makeFakeVatAdmin());

  // Get the Zoe invitation issuer from Zoe.
  const invitationIssuer = await E(zoe).getInvitationIssuer();

  // Pack the contract.
  const contractBundle = await bundleSource(contractPath);

  // Install the contract on Zoe, getting an installation. We can
  // use this installation to look up the code we installed. Outside
  // of tests, we can also send the installation to someone
  // else, and they can use it to create a new contract instance
  // using the same code.
  const installation = await E(zoe).install(contractBundle);

  // Let's check the code. Outside of this test, we would probably
  // want to check more extensively,
  const installedBundle = await E(installation).getBundle();
  const code = installedBundle.source;
  t.assert(
    code.includes(`This contract provides encouragement. `),
    `the code installed passes a quick check of what we intended to install`,
  );

  // Make some mints/issuers just for our test.
  const {
    issuer: bucksIssuer,
    mint: bucksMint,
    amountMath: bucksAmountMath,
  } = makeIssuerKit('bucks');

  // Let's give ourselves 5 bucks to start
  const bucks5 = bucksAmountMath.make(5);
  const bucksPayment = bucksMint.mintPayment(bucks5);

  // Create the contract instance, using our new issuer. It returns
  // an creator facet, which we will use to remove our tips at the end.
  const { creatorInvitation, publicFacet } = await E(zoe).startInstance(
    installation,
    {
      Tip: bucksIssuer,
    },
  );

  // Check that we received an invitation as the result of making the
  // contract instance.
  t.assert(
    await E(invitationIssuer).isLive(creatorInvitation),
    `an valid invitation (an ERTP payment) was created`,
  );

  // Let's use the creatorInvitation to make an offer. This will allow us
  // to remove our tips at the end
  const creatorSeat = await E(zoe).offer(creatorInvitation);

  t.is(
    await E(creatorSeat).getOfferResult(),
    `creator invitation redeemed`,
    `creator outcome is correct`,
  );

  // Let's test some of the publicFacet methods. The publicFacet is
  // accessible to anyone who has access to Zoe and the
  // instance. The publicFacet methods are up to the contract,
  // and Zoe doesn't require contracts to have
  // publicFacet methods. In this case, the contract provides a
  // getNotifier() function that returns a notifier we can subscribe
  // to, in order to get updates about changes to the state of the
  // contract.
  const notifier = E(publicFacet).getNotifier();
  const { value, updateCount } = await E(notifier).getUpdateSince();
  const nextUpdateP = E(notifier).getUpdateSince(updateCount);

  // Count starts at 0
  t.is(value.count, 0, `count starts at 0`);

  t.deepEqual(
    value.messages,
    harden({
      basic: `You're doing great!`,
      premium: `Wow, just wow. I have never seen such talent!`,
    }),
    `messages are as expected`,
  );

  // Let's use the contract like a client and get some encouragement!
  const encouragementInvitation = await E(publicFacet).makeInvitation();

  const seat1 = await E(zoe).offer(encouragementInvitation);

  t.is(
    await E(seat1).getOfferResult(),
    `You're doing great!`,
    `encouragement matches expected`,
  );

  // Getting encouragement resolves the 'nextUpdateP' promise
  const result = await nextUpdateP;
  t.is(result.value.count, 1, 'count increments by 1');

  // Now, let's get a premium encouragement message
  const encouragementInvitation2 = await E(publicFacet).makeInvitation();
  const proposal = harden({ give: { Tip: bucks5 } });
  const paymentKeywordRecord = harden({
    Tip: bucksPayment,
  });
  const seat2 = await E(zoe).offer(
    encouragementInvitation2,
    proposal,
    paymentKeywordRecord,
  );

  t.is(
    await E(seat2).getOfferResult(),
    `Wow, just wow. I have never seen such talent!`,
    `premium message is as expected`,
  );

  const newResult = await E(notifier).getUpdateSince();
  t.deepEqual(newResult.value.count, 2, `count is now 2`);

  // Let's get our Tips
  await E(creatorSeat).tryExit();
  const tip = await E(creatorSeat).getPayout('Tip');
  const tipAmount = await bucksIssuer.getAmountOf(tip);
  t.deepEqual(tipAmount, bucks5, `payout is 5 bucks, all the tips`);
});

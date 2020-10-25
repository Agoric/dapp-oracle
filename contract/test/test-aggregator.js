// @ts-check

import '@agoric/install-ses';

import test from 'ava';
import bundleSource from '@agoric/bundle-source';

import { E } from '@agoric/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/src/contractFacet/fakeVatAdmin';
import { makeZoe } from '@agoric/zoe';
import buildManualTimer from '@agoric/zoe/tools/manualTimer';

import '../src/types';
import '@agoric/zoe/exported';
import { makeIssuerKit, MathKind } from '@agoric/ertp';

/**
 * @typedef {Object} TestContext
 * @property {ZoeService} zoe
 * @property {(t: ExecutionContext, price?: number) => Promise<OracleKit & {
 * instance: Instance }>} makeFakePriceOracle
 * @property {AggregatorKit} aggregator
 * @property {Amount} feeAmount
 * @property {IssuerKit} link
 * @property {IssuerKit} usd
 * @property {IssuerKit} quote
 * @property {ReturnType<typeof buildManualTimer>} timer
 *
 * @typedef {import('ava').ExecutionContext<TestContext>} ExecutionContext
 */

const contractPath = `${__dirname}/../src/contract`;
const aggregatorPath = `${__dirname}/../src/aggregator`;

test.before(
  'setup aggregator and oracles',
  /** @param {ExecutionContext} ot */ async ot => {
    // Outside of tests, we should use the long-lived Zoe on the
    // testnet. In this test, we must create a new Zoe.
    const zoe = makeZoe(makeFakeVatAdmin().admin);
    const timer = buildManualTimer(console.log);

    // Pack the contracts.
    const contractBundle = await bundleSource(contractPath);
    const aggregatorBundle = await bundleSource(aggregatorPath);

    // Install the contract on Zoe, getting an installation. We can
    // use this installation to look up the code we installed. Outside
    // of tests, we can also send the installation to someone
    // else, and they can use it to create a new contract instance
    // using the same code.
    const oracleInstallation = await E(zoe).install(contractBundle);
    const aggregatorInstallation = await E(zoe).install(aggregatorBundle);

    const link = makeIssuerKit('$LINK', MathKind.NAT);
    const usd = makeIssuerKit('$USD', MathKind.NAT);

    /**
     * @returns {Promise<OracleKit>}
     */
    const makeFakePriceOracle = async (t, price = 1000) => {
      /** @type {OracleHandler} */
      const oracleHandler = harden({
        async onQuery({ increment }, _fee) {
          price += increment;
          return harden({
            reply: `${price}`,
            requiredFee: link.amountMath.getEmpty(),
          });
        },
        onError(query, reason) {
          console.error('query', query, 'failed with', reason);
        },
        onReply(_query, _reply) {},
      });

      /** @type {OracleStartFnResult} */
      const startResult = await E(zoe).startInstance(
        oracleInstallation,
        { Fee: link.issuer },
        { oracleDescription: 'myOracle' },
      );
      const creatorFacet = await E(startResult.creatorFacet).initialize({
        oracleHandler,
      });

      t.is(await E(startResult.publicFacet).getDescription(), 'myOracle');
      return harden({
        ...startResult,
        creatorFacet,
      });
    };

    const aggregator = await E(zoe).startInstance(
      aggregatorInstallation,
      { Price: usd.issuer },
      { timer, POLL_INTERVAL: 1 },
    );
    const quote = makeIssuerKit('quote', MathKind.SET);
    await E(aggregator.creatorFacet).initializeQuoteMint(quote.mint);
    ot.context.zoe = zoe;
    ot.context.makeFakePriceOracle = makeFakePriceOracle;
    ot.context.aggregator = aggregator;
    ot.context.link = link;
    ot.context.usd = usd;
    ot.context.quote = quote;
    ot.context.timer = timer;
  },
);

test('median aggregator', /** @param {ExecutionContext} t */ async t => {
  const { makeFakePriceOracle, aggregator, quote, timer, usd } = t.context;

  const price1000 = await makeFakePriceOracle(t, 1000);
  const price1300 = await makeFakePriceOracle(t, 1300);
  const price800 = await makeFakePriceOracle(t, 800);

  const notifier = aggregator.publicFacet.getNotifier();
  await aggregator.creatorFacet.addOracle(price1000.instance, {
    increment: 10,
  });

  let lastRec;
  const tickAndQuote = async () => {
    await timer.tick();
    lastRec = await notifier.getUpdateSince(lastRec && lastRec.updateCount);
    const q = await E(quote.issuer).getAmountOf(lastRec.value);
    const [{ timestamp, price: usdprice }] = quote.amountMath.getValue(q);
    const price = usd.amountMath.getValue(usdprice);
    return { timestamp, price };
  };
  
  const quote0 = await tickAndQuote();
  t.deepEqual(quote0, { price: 1020, timestamp: 0 });

  const quote1 = await tickAndQuote();
  t.deepEqual(quote1, { price: 1030, timestamp: 1 });

  await aggregator.creatorFacet.addOracle(price1300.instance, { increment: 8 });

  const quote2 = await tickAndQuote();
  t.deepEqual(quote2, { price: 1178, timestamp: 2 });

  const quote3 = await tickAndQuote();
  t.deepEqual(quote3, { price: 1187, timestamp: 3 });

  await aggregator.creatorFacet.addOracle(price800.instance, { increment: 17 });

  const quote4 = await tickAndQuote();
  t.deepEqual(quote4, { price: 1060, timestamp: 4 });

  const quote5 = await tickAndQuote();
  t.deepEqual(quote5, { price: 1070, timestamp: 5 });

  await aggregator.creatorFacet.dropOracle(price1300.instance);

  const quote6 = await tickAndQuote();
  t.deepEqual(quote6, { price: 974, timestamp: 6 });
});

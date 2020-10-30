// @ts-check

import '@agoric/install-ses';

import test from 'ava';
import bundleSource from '@agoric/bundle-source';

import { E } from '@agoric/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/src/contractFacet/fakeVatAdmin';
import { makeZoe } from '@agoric/zoe';
import buildManualTimer from '@agoric/zoe/tools/manualTimer';
import { makeIssuerKit, MathKind } from '@agoric/ertp';
import { makePromiseKit } from '@agoric/promise-kit';

import '@agoric/zoe/exported';
import '../src/types';

/**
 * @typedef {Object} TestContext
 * @property {ZoeService} zoe
 * @property {(t: ExecutionContext, amountOut?: number) => Promise<OracleKit & {
 * instance: Instance }>} makeFakePriceOracle
 * @property {(POLL_INTERVAL: number) => Promise<AggregatorKit & { instance: Instance }>} makeMedianAggregator
 * @property {Amount} feeAmount
 * @property {IssuerKit} link
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
    const makeFakePriceOracle = async (t, amountOut = 1000) => {
      /** @type {OracleHandler} */
      const oracleHandler = harden({
        async onQuery({ increment }, _fee) {
          amountOut += increment;
          return harden({
            reply: `${amountOut}`,
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

    const quote = makeIssuerKit('quote', MathKind.SET);
    /**
     * @param {RelativeTime} POLL_INTERVAL
     */
    const makeMedianAggregator = async POLL_INTERVAL => {
      const timer = buildManualTimer(() => {});
      const aggregator = await E(zoe).startInstance(
        aggregatorInstallation,
        { In: link.issuer, Out: usd.issuer },
        { timer, POLL_INTERVAL },
      );
      await E(aggregator.creatorFacet).initializeQuoteMint(quote.mint);
      return aggregator;
    };
    ot.context.zoe = zoe;
    ot.context.makeFakePriceOracle = makeFakePriceOracle;
    ot.context.makeMedianAggregator = makeMedianAggregator;
  },
);

test('median aggregator', /** @param {ExecutionContext} t */ async t => {
  const { makeFakePriceOracle, zoe } = t.context;

  const aggregator = await t.context.makeMedianAggregator(1);
  const {
    timer: oracleTimer,
    brands: { In: brandIn, Out: brandOut },
    issuers: { Quote: quoteIssuer },
    maths: { In: mathIn, Out: mathOut, Quote: quoteMath },
    baseAmountIn = mathIn.make(1),
  } = await E(zoe).getTerms(aggregator.instance);

  const price1000 = await makeFakePriceOracle(t, 1000);
  const price1300 = await makeFakePriceOracle(t, 1300);
  const price800 = await makeFakePriceOracle(t, 800);
  const pa = E(aggregator.publicFacet).getPriceAuthority();

  const notifier = E(pa).getPriceNotifier(brandIn, brandOut);
  await E(aggregator.creatorFacet).addOracle(price1000.instance, {
    increment: 10,
  });

  /** @type {UpdateRecord<PriceQuote>} */
  let lastRec;
  const tickAndQuote = async () => {
    await oracleTimer.tick();
    lastRec = await E(notifier).getUpdateSince(lastRec && lastRec.updateCount);

    const q = await E(quoteIssuer).getAmountOf(lastRec.value.quotePayment);
    t.deepEqual(q, lastRec.value.quoteAmount);
    const [{ timestamp, timer, amountIn, amountOut }] = quoteMath.getValue(q);
    t.is(timer, oracleTimer);
    const valueOut = mathOut.getValue(amountOut);

    t.deepEqual(amountIn, baseAmountIn);

    // Validate that we can get a recent amountOut explicitly as well.
    const { quotePayment: recentG } = await E(pa).quoteGiven(
      baseAmountIn,
      brandOut,
    );
    const recentGQ = await E(quoteIssuer).getAmountOf(recentG);
    const [
      {
        timestamp: rgTimestamp,
        timer: rgTimer,
        amountIn: rgIn,
        amountOut: rgOut,
      },
    ] = quoteMath.getValue(recentGQ);
    t.is(rgTimer, oracleTimer);
    t.is(rgTimestamp, timestamp);
    t.deepEqual(rgIn, amountIn);
    t.deepEqual(rgOut, amountOut);

    const { quotePayment: recentW } = await E(pa).quoteWanted(brandIn, rgOut);
    const recentWQ = await E(quoteIssuer).getAmountOf(recentW);
    const [
      {
        timestamp: rwTimestamp,
        timer: rwTimer,
        amountIn: rwIn,
        amountOut: rwOut,
      },
    ] = quoteMath.getValue(recentWQ);
    t.is(rwTimer, oracleTimer);
    t.is(rwTimestamp, timestamp);
    t.deepEqual(rwIn, amountIn);
    t.deepEqual(rwOut, amountOut);

    return { timestamp, amountOut: valueOut };
  };

  const quote0 = await tickAndQuote();
  t.deepEqual(quote0, { amountOut: 1020, timestamp: 1 });

  const quote1 = await tickAndQuote();
  t.deepEqual(quote1, { amountOut: 1030, timestamp: 2 });

  await E(aggregator.creatorFacet).addOracle(price1300.instance, {
    increment: 8,
  });

  const quote2 = await tickAndQuote();
  t.deepEqual(quote2, { amountOut: 1178, timestamp: 3 });

  const quote3 = await tickAndQuote();
  t.deepEqual(quote3, { amountOut: 1187, timestamp: 4 });

  await E(aggregator.creatorFacet).addOracle(price800.instance, {
    increment: 17,
  });

  const quote4 = await tickAndQuote();
  t.deepEqual(quote4, { amountOut: 1060, timestamp: 5 });

  const quote5 = await tickAndQuote();
  t.deepEqual(quote5, { amountOut: 1070, timestamp: 6 });

  await E(aggregator.creatorFacet).dropOracle(price1300.instance);

  const quote6 = await tickAndQuote();
  t.deepEqual(quote6, { amountOut: 974, timestamp: 7 });
});

test('quoteAtTime', /** @param {ExecutionContext} t */ async t => {
  const { makeFakePriceOracle, zoe } = t.context;

  const userTimer = buildManualTimer(() => {});

  const aggregator = await t.context.makeMedianAggregator(1);
  const {
    timer: oracleTimer,
    brands: { Out: usdBrand },
    issuers: { Quote: quoteIssuer },
    maths: { In: mathIn, Out: mathOut, Quote: quoteMath },
  } = await E(zoe).getTerms(aggregator.instance);

  const price1000 = await makeFakePriceOracle(t, 1000);
  const price1300 = await makeFakePriceOracle(t, 1300);
  const price800 = await makeFakePriceOracle(t, 800);
  const pa = E(aggregator.publicFacet).getPriceAuthority();

  const quoteAtTime = E(pa).quoteAtTime(7, mathIn.make(41), usdBrand);

  /** @type {PriceQuote} */
  let priceQuote;
  quoteAtTime.then(
    result => (priceQuote = result),
    reason =>
      t.notThrows(() => {
        throw reason;
      }),
  );

  /** @type {PromiseRecord<PriceQuote>} */
  const userQuotePK = makePromiseKit();
  await E(userTimer).setWakeup(1, {
    async wake(_timestamp) {
      userQuotePK.resolve(E(pa).quoteGiven(mathIn.make(23), usdBrand));
      await userQuotePK.promise;
    },
  });
  const quoteAtUserTime = userQuotePK.promise;

  /** @type {PriceQuote} */
  let userPriceQuote;
  quoteAtUserTime.then(
    result => (userPriceQuote = result),
    reason =>
      t.notThrowsAsync(() => {
        throw reason;
      }),
  );

  await E(aggregator.creatorFacet).addOracle(price1000.instance, {
    increment: 10,
  });

  await E(oracleTimer).tick();
  await E(oracleTimer).tick();

  await E(aggregator.creatorFacet).addOracle(price1300.instance, {
    increment: 8,
  });

  await E(oracleTimer).tick();
  await E(oracleTimer).tick();

  await E(aggregator.creatorFacet).addOracle(price800.instance, {
    increment: 17,
  });

  await E(oracleTimer).tick();

  // Ensure our user quote fires exactly now.
  t.falsy(userPriceQuote);
  await E(userTimer).tick();
  t.truthy(userPriceQuote);

  const userQuote = await E(quoteIssuer).getAmountOf(
    userPriceQuote.quotePayment,
  );
  const [
    {
      amountIn: userIn,
      amountOut: userOut,
      timer: uTimer,
      timestamp: uTimestamp,
    },
  ] = await E(quoteMath).getValue(userQuote);
  t.is(uTimer, oracleTimer);
  t.is(uTimestamp, 5);
  t.is(await E(mathIn).getValue(userIn), 23);
  t.is((await E(mathOut).getValue(userOut)) / 23, 1060);

  await E(oracleTimer).tick();

  await E(aggregator.creatorFacet).dropOracle(price1300.instance);

  // Ensure our quote fires exactly now.
  t.falsy(priceQuote);
  await E(oracleTimer).tick();
  t.truthy(priceQuote);

  const quote = await E(quoteIssuer).getAmountOf(priceQuote.quotePayment);
  t.deepEqual(quote, priceQuote.quoteAmount);
  const [{ amountIn, amountOut, timer, timestamp }] = await E(
    quoteMath,
  ).getValue(quote);
  t.is(timer, oracleTimer);
  t.is(timestamp, 7);
  t.is(await E(mathIn).getValue(amountIn), 41);
  t.is((await E(mathOut).getValue(amountOut)) / 41, 960);
});

test('quoteWhen', /** @param {ExecutionContext} t */ async t => {
  const { makeFakePriceOracle, zoe } = t.context;

  const aggregator = await t.context.makeMedianAggregator(1);
  const {
    timer: oracleTimer,
    issuers: { Quote: quoteIssuer },
    maths: { In: mathIn, Out: mathOut, Quote: quoteMath },
  } = await E(zoe).getTerms(aggregator.instance);

  const price1000 = await makeFakePriceOracle(t, 1000);
  const price1300 = await makeFakePriceOracle(t, 1300);
  const price800 = await makeFakePriceOracle(t, 800);
  const pa = E(aggregator.publicFacet).getPriceAuthority();

  const quoteWhenGTE = E(pa).quoteWhenGTE(
    mathIn.make(37),
    mathOut.make(1183 * 37),
  );

  /** @type {PriceQuote} */
  let abovePriceQuote;
  quoteWhenGTE.then(
    result => (abovePriceQuote = result),
    reason =>
      t.notThrows(() => {
        throw reason;
      }),
  );

  const quoteWhenLTE = E(pa).quoteWhenLTE(
    mathIn.make(29),
    mathOut.make(974 * 29),
  );

  /** @type {PriceQuote} */
  let belowPriceQuote;
  quoteWhenLTE.then(
    result => (belowPriceQuote = result),
    reason =>
      t.notThrows(() => {
        throw reason;
      }),
  );

  await E(aggregator.creatorFacet).addOracle(price1000.instance, {
    increment: 10,
  });

  await E(oracleTimer).tick();
  await E(oracleTimer).tick();

  await E(aggregator.creatorFacet).addOracle(price1300.instance, {
    increment: 8,
  });

  await E(oracleTimer).tick();
  // Above trigger has not yet fired.
  t.falsy(abovePriceQuote);
  await E(oracleTimer).tick();

  // The above trigger should fire here.
  await quoteWhenGTE;
  t.truthy(abovePriceQuote);
  const aboveQuote = await E(quoteIssuer).getAmountOf(
    abovePriceQuote.quotePayment,
  );
  t.deepEqual(aboveQuote, abovePriceQuote.quoteAmount);
  const [
    {
      amountIn: aboveIn,
      amountOut: aboveOut,
      timer: aboveTimer,
      timestamp: aboveTimestamp,
    },
  ] = await E(quoteMath).getValue(aboveQuote);
  t.is(aboveTimer, oracleTimer);
  t.is(aboveTimestamp, 4);
  t.is(await E(mathIn).getValue(aboveIn), 37);
  t.is((await E(mathOut).getValue(aboveOut)) / 37, 1183);

  await E(aggregator.creatorFacet).addOracle(price800.instance, {
    increment: 17,
  });

  await E(oracleTimer).tick();
  await E(oracleTimer).tick();

  await E(aggregator.creatorFacet).dropOracle(price1300.instance);

  // Below trigger has not yet fired.
  t.falsy(belowPriceQuote);
  await E(oracleTimer).tick();

  // The below trigger should fire here.
  await quoteWhenLTE;
  t.truthy(belowPriceQuote);
  const belowQuote = await E(quoteIssuer).getAmountOf(
    belowPriceQuote.quotePayment,
  );
  t.deepEqual(belowQuote, belowPriceQuote.quoteAmount);
  const [
    {
      amountIn: belowIn,
      amountOut: belowOut,
      timer: belowTimer,
      timestamp: belowTimestamp,
    },
  ] = await E(quoteMath).getValue(belowQuote);
  t.is(belowTimer, oracleTimer);
  t.is(belowTimestamp, 7);
  t.is(await E(mathIn).getValue(belowIn), 29);
  t.is((await E(mathOut).getValue(belowOut)) / 29, 960);
});

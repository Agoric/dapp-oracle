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

    const quote = makeIssuerKit('quote', MathKind.SET);
    const makeMedianAggregator = async POLL_INTERVAL => {
      const timer = buildManualTimer(() => {});
      const aggregator = await E(zoe).startInstance(
        aggregatorInstallation,
        { Asset: link.issuer, Price: usd.issuer },
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
    timer,
    brands: { Price: priceBrand },
    issuers: { Quote: quoteIssuer },
    maths: { Asset: assetMath, Price: priceMath, Quote: quoteMath },
  } = await E(zoe).getTerms(aggregator.instance);

  const price1000 = await makeFakePriceOracle(t, 1000);
  const price1300 = await makeFakePriceOracle(t, 1300);
  const price800 = await makeFakePriceOracle(t, 800);

  const notifier = E(aggregator.publicFacet).getPriceNotifier(priceBrand);
  await E(aggregator.creatorFacet).addOracle(price1000.instance, {
    increment: 10,
  });

  let lastRec;
  const tickAndQuote = async () => {
    await timer.tick();
    lastRec = await E(notifier).getUpdateSince(lastRec && lastRec.updateCount);
    const q = await E(quoteIssuer).getAmountOf(lastRec.value);
    const [{ timestamp, Asset, Price }] = quoteMath.getValue(q);
    const price = priceMath.getValue(Price);
    const asset = assetMath.getValue(Asset);
    return { asset, timestamp, price };
  };

  const quote0 = await tickAndQuote();
  t.deepEqual(quote0, { asset: 1, price: 1020, timestamp: 0 });

  const quote1 = await tickAndQuote();
  t.deepEqual(quote1, { asset: 1, price: 1030, timestamp: 1 });

  await E(aggregator.creatorFacet).addOracle(price1300.instance, {
    increment: 8,
  });

  const quote2 = await tickAndQuote();
  t.deepEqual(quote2, { asset: 1, price: 1178, timestamp: 2 });

  const quote3 = await tickAndQuote();
  t.deepEqual(quote3, { asset: 1, price: 1187, timestamp: 3 });

  await E(aggregator.creatorFacet).addOracle(price800.instance, {
    increment: 17,
  });

  const quote4 = await tickAndQuote();
  t.deepEqual(quote4, { asset: 1, price: 1060, timestamp: 4 });

  const quote5 = await tickAndQuote();
  t.deepEqual(quote5, { asset: 1, price: 1070, timestamp: 5 });

  await E(aggregator.creatorFacet).dropOracle(price1300.instance);

  const quote6 = await tickAndQuote();
  t.deepEqual(quote6, { asset: 1, price: 974, timestamp: 6 });
});

test('priceAtTime', /** @param {ExecutionContext} t */ async t => {
  const { makeFakePriceOracle, zoe } = t.context;

  const aggregator = await t.context.makeMedianAggregator(1);
  const {
    timer,
    brands: { Price: usdBrand },
    issuers: { Quote: quoteIssuer },
    maths: { Asset: assetMath, Price: priceMath, Quote: quoteMath },
  } = await E(zoe).getTerms(aggregator.instance);

  const price1000 = await makeFakePriceOracle(t, 1000);
  const price1300 = await makeFakePriceOracle(t, 1300);
  const price800 = await makeFakePriceOracle(t, 800);

  const priceAtTime = E(aggregator.publicFacet).priceAtTime(
    7,
    usdBrand,
    assetMath.make(41),
  );

  let quotePayment;
  priceAtTime.then(
    result => (quotePayment = result),
    reason =>
      t.notThrows(() => {
        throw reason;
      }),
  );

  await E(aggregator.creatorFacet).addOracle(price1000.instance, {
    increment: 10,
  });

  await E(timer).tick();
  await E(timer).tick();

  await E(aggregator.creatorFacet).addOracle(price1300.instance, {
    increment: 8,
  });

  await E(timer).tick();
  await E(timer).tick();

  await E(aggregator.creatorFacet).addOracle(price800.instance, {
    increment: 17,
  });

  await E(timer).tick();
  await E(timer).tick();

  await E(aggregator.creatorFacet).dropOracle(price1300.instance);

  // Ensure our quote fires exactly now.
  t.falsy(quotePayment);
  await E(timer).tick();
  t.truthy(quotePayment);

  const quote = await E(quoteIssuer).getAmountOf(quotePayment);
  const [{ Asset, Price, timestamp }] = await E(quoteMath).getValue(quote);
  t.is(timestamp, 7);
  t.is(await E(assetMath).getValue(Asset), 41);
  t.is(await E(priceMath).getValue(Price), 961 * 41);
});

test('priceWhen', /** @param {ExecutionContext} t */ async t => {
  const { makeFakePriceOracle, zoe } = t.context;

  const aggregator = await t.context.makeMedianAggregator(1);
  const {
    timer,
    issuers: { Quote: quoteIssuer },
    maths: { Asset: assetMath, Price: priceMath, Quote: quoteMath },
  } = await E(zoe).getTerms(aggregator.instance);

  const price1000 = await makeFakePriceOracle(t, 1000);
  const price1300 = await makeFakePriceOracle(t, 1300);
  const price800 = await makeFakePriceOracle(t, 800);

  const priceWhenEqualOrAbove = E(aggregator.publicFacet).priceWhenEqualOrAbove(
    priceMath.make(1183 * 37),
    assetMath.make(37),
  );

  let aboveQuotePayment;
  priceWhenEqualOrAbove.then(
    result => (aboveQuotePayment = result),
    reason =>
      t.notThrows(() => {
        throw reason;
      }),
  );

  const priceWhenBelow = E(aggregator.publicFacet).priceWhenBelow(
    priceMath.make(974 * 29),
    assetMath.make(29),
  );

  let belowQuotePayment;
  priceWhenBelow.then(
    result => (belowQuotePayment = result),
    reason =>
      t.notThrows(() => {
        throw reason;
      }),
  );

  await E(aggregator.creatorFacet).addOracle(price1000.instance, {
    increment: 10,
  });

  await E(timer).tick();
  await E(timer).tick();

  await E(aggregator.creatorFacet).addOracle(price1300.instance, {
    increment: 8,
  });

  await E(timer).tick();
  // Above trigger has not yet fired.
  t.falsy(aboveQuotePayment);
  await E(timer).tick();

  // The above trigger should fire here.
  await priceWhenEqualOrAbove;
  t.truthy(aboveQuotePayment);
  const aboveQuote = await E(quoteIssuer).getAmountOf(aboveQuotePayment);
  const [
    { Asset: aboveAsset, Price: abovePrice, timestamp: aboveTimestamp },
  ] = await E(quoteMath).getValue(aboveQuote);
  t.is(aboveTimestamp, 4);
  t.is(await E(assetMath).getValue(aboveAsset), 37);
  t.is(await E(priceMath).getValue(abovePrice), 1183 * 37);

  await E(aggregator.creatorFacet).addOracle(price800.instance, {
    increment: 17,
  });

  await E(timer).tick();
  await E(timer).tick();

  await E(aggregator.creatorFacet).dropOracle(price1300.instance);

  // Below trigger has not yet fired.
  t.falsy(belowQuotePayment);
  await E(timer).tick();

  // The below trigger should fire here.
  await priceWhenBelow;
  t.truthy(belowQuotePayment);
  const belowQuote = await E(quoteIssuer).getAmountOf(belowQuotePayment);
  const [
    { Asset: belowAsset, Price: belowPrice, timestamp: belowTimestamp },
  ] = await E(quoteMath).getValue(belowQuote);
  t.is(belowTimestamp, 7);
  t.is(await E(assetMath).getValue(belowAsset), 29);
  t.is(await E(priceMath).getValue(belowPrice), 961 * 29);
});

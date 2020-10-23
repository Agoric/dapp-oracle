// @ts-check

import '@agoric/install-ses';

import test from 'ava';
import bundleSource from '@agoric/bundle-source';

import { E } from '@agoric/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/src/contractFacet/fakeVatAdmin';
import { makeZoe } from '@agoric/zoe';

import '../src/types';
import '@agoric/zoe/exported';
import { makeIssuerKit, MathKind } from '@agoric/ertp';

/**
 * @typedef {Object} TestContext
 * @property {ZoeService} zoe
 * @property {(t: ExecutionContext, price?: number) => Promise<OracleInitializedResult & {
 * instance: Instance }>} makeFakePriceOracle
 * @property {MedianAggregatorStartFnResult} aggregator
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

    /**
     * @returns {Promise<OracleInitializedResult>}
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

    const aggregator = await E(zoe).startInstance(aggregatorInstallation);
    ot.context.zoe = zoe;
    ot.context.makeFakePriceOracle = makeFakePriceOracle;
    ot.context.aggregator = aggregator;
    ot.context.link = link;
  },
);

test('median aggregator', /** @param {ExecutionContext} t */ async t => {
  const { makeFakePriceOracle, aggregator } = t.context;

  const price1000 = await makeFakePriceOracle(t, 1000);
  const price1300 = await makeFakePriceOracle(t, 1300);
  const price800 = await makeFakePriceOracle(t, 800);

  const notifier = aggregator.publicFacet.getNotifier();
  const rec0P = notifier.getUpdateSince(undefined);
  aggregator.creatorFacet.addOracle(price1000.instance, { increment: 10 });
  const rec0 = await rec0P;
  t.deepEqual(rec0.value, { median: 1010, timestamp: 40 });

  // TODO: timer tick.
  const rec0b = await notifier.getUpdateSince(undefined);
  t.deepEqual(rec0b.value, { median: 1010, timestamp: 40 });

  aggregator.creatorFacet.addOracle(price1300.instance, { increment: 8 });
  const rec1 = await notifier.getUpdateSince(rec0.updateCount);
  t.deepEqual(rec1.value, { median: 1159, timestamp: 41 });

  // TODO: timer tick.
  const rec1b = await notifier.getUpdateSince(rec0.updateCount);
  t.deepEqual(rec1b.value, { median: 1159, timestamp: 41 });

  aggregator.creatorFacet.addOracle(price800.instance, { increment: 17 });
  const rec2 = await notifier.getUpdateSince(rec1.updateCount);
  t.deepEqual(rec2.value, { median: 1010, timestamp: 42 });

  // TODO: timer tick.
  const rec2b = await notifier.getUpdateSince(rec1.updateCount);
  t.deepEqual(rec2b.value, { median: 1010, timestamp: 42 });
});

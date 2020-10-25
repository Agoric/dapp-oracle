// @ts-check
import '@agoric/zoe/exported';

import { E } from '@agoric/eventual-send';

import './types';
import { makeNotifierKit } from '@agoric/notifier';
import { MathKind } from '@agoric/ertp';
import makeStore from '@agoric/store';
import { assert, details } from '@agoric/assert';

/**
 * This contract provides oracle queries for a fee or for pay.
 *
 * @type {ContractStartFn}
 *
 */
const start = async zcf => {
  const { timer, POLL_INTERVAL, maths: { Price: priceMath } } = zcf.getTerms();
  const { notifier, updater } = makeNotifierKit();
  const zoe = zcf.getZoeService();

  /** @type {Store<Instance, { querier: (timestamp: any) => void, lastSample: number }>} */
  const instanceToRecord = makeStore('oracleInstance');

  let recentTimestamp = await E(timer).getCurrentTimestamp();

  /** @type {IssuerRecord & { mint: ERef<Mint> }} */
  let aggregatorQuoteKit;

  /** @type {Payment} */
  let recentQuotePayment;

  const repeaterP = E(timer).createRepeater(0, POLL_INTERVAL);
  const handler = {
    async wake(timestamp) {
      // Run all the queriers.
      const querierPs = instanceToRecord
        .values()
        .map(({ querier }) => querier && querier(timestamp));
      await Promise.all(querierPs);
    },
  };
  E(repeaterP).schedule(handler);

  const updateQuote = async timestamp => {
    const sorted = instanceToRecord
      .values() // Find all the instance records.
      .map(({ lastSample }) => lastSample) // Get the last sample.
      .filter(value => value > 0) // Only allow positive samples.
      .sort((a, b) => a - b); // Sort ascending.
    if (sorted.length === 0) {
      // No valid samples, don't report anything.
      return;
    }
    let median;
    if (sorted.length % 2 === 0) {
      // Even length, average the two middle values.
      const secondIndex = sorted.length / 2;
      const sum = sorted[secondIndex - 1] + sorted[secondIndex];

      // Find the ceiling, since we deal with natural numbers.
      median = Math.ceil(sum / 2);
    } else {
      median = sorted[(sorted.length - 1) / 2];
    }

    // console.error('found median', median, 'of', sorted);
    const price = priceMath.make(median);
    const quote = aggregatorQuoteKit.amountMath.make(harden([{ price, timestamp: recentTimestamp }]));

    // Authenticate the quote by minting it, then publish.
    const authenticatedQuote = await E(aggregatorQuoteKit.mint).mintPayment(quote);

    // FIXME: Do our price triggers now, even if we're too late to publish.

    if (timestamp < recentTimestamp) {
      // Too late to publish.
      return;
    }
    recentTimestamp = timestamp;
    recentQuotePayment = authenticatedQuote;
    updater.updateState(recentQuotePayment);
  };

  /** @type {AggregatorCreatorFacet} */
  const creatorFacet = harden({
    async initializeQuoteMint(quoteMint) {
      const quoteIssuerRecord = await zcf.saveIssuer(E(quoteMint).getIssuer(), 'Quote');
      aggregatorQuoteKit = {
        ...quoteIssuerRecord,
        mint: quoteMint,
      };
    },
    async addOracle(oracleInstance, query) {
      assert(aggregatorQuoteKit, details`Must initializeQuoteMint before adding an oracle`);

      // Register our record.
      const record = { querier: undefined, lastSample: NaN };
      instanceToRecord.init(oracleInstance, record);

      // Obtain the oracle's publicFacet and schedule the repeater in the background.
      const oracle = await E(zoe).getPublicFacet(oracleInstance);
      if (!instanceToRecord.has(oracleInstance)) {
        // We were dropped already, no harm done.
        return;
      }

      let lastWakeTimestamp = 0;
      record.querier = async timestamp => {
        // Submit the query.
        const result = await E(oracle).query(query);
        // Now that we've received the result, check if we're out of date.
        if (
          timestamp < lastWakeTimestamp ||
          !instanceToRecord.has(oracleInstance)
        ) {
          return;
        }
        lastWakeTimestamp = timestamp;

        // Sample of NaN, 0, or negative numbers are valid, they get culled in
        // the median calculation.
        const sample = parseInt(result, 10);
        record.lastSample = sample;
        await updateQuote(timestamp);
      };
      const now = await E(timer).getCurrentTimestamp();
      await record.querier(now);
    },
    async dropOracle(oracleInstance) {
      // Just remove the map entries.
      instanceToRecord.delete(oracleInstance);
      const now = await E(timer).getCurrentTimestamp();
      await updateQuote(now);
    },
  });

  /** @type {AggregatorPublicFacet} */
  const publicFacet = harden({
    getNotifier() {
      return notifier;
    },
  });

  return { creatorFacet, publicFacet };
};

export { start };

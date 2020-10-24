// @ts-check
import '@agoric/zoe/exported';

import { E } from '@agoric/eventual-send';

import './types';
import { makeNotifierKit } from '@agoric/notifier';
import makeStore from '@agoric/store';

/**
 * This contract provides oracle queries for a fee or for pay.
 *
 * @type {ContractStartFn}
 *
 */
const start = async zcf => {
  const { timer, POLL_INTERVAL } = zcf.getTerms();
  const { notifier, updater } = makeNotifierKit();
  const zoe = zcf.getZoeService();

  /** @type {Store<Instance, { querier: (timestamp: any) => void, lastSample: number }>} */
  const instanceToRecord = makeStore('oracleInstance');

  let latestTimestamp = await E(timer).getCurrentTimestamp();

  const repeaterP = E(timer).createRepeater(0, POLL_INTERVAL);
  const handler = {
    wake(timestamp) {
      // Run all the queriers.
      instanceToRecord
        .values()
        .forEach(({ querier }) => querier && querier(timestamp));
    },
  };
  E(repeaterP).schedule(handler);

  const updateMedian = timestamp => {
    if (timestamp > latestTimestamp) {
      // Fresh value.
      latestTimestamp = timestamp;
    }

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
    updater.updateState({ median, timestamp: latestTimestamp });
  };

  /** @type {MedianAggregatorCreatorFacet} */
  const creatorFacet = harden({
    async addOracle(oracleInstance, query) {
      // Register our sample collection.
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
        updateMedian(timestamp);
      };
      const now = await E(timer).getCurrentTimestamp();
      await record.querier(now);
    },
    async dropOracle(oracleInstance) {
      // Just remove the map entries.
      instanceToRecord.delete(oracleInstance);
      const now = await E(timer).getCurrentTimestamp();
      updateMedian(now);
    },
  });

  /** @type {MedianAggregatorPublicFacet} */
  const publicFacet = harden({
    getNotifier() {
      return notifier;
    },
  });

  return { creatorFacet, publicFacet };
};

export { start };

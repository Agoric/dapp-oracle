// @ts-check
import '@agoric/zoe/exported';

import { assert, details } from '@agoric/assert';
import { E } from '@agoric/eventual-send';
import { trade } from '@agoric/zoe/src/contractSupport';

import './types';
import { makeNotifierKit } from '../../../agoric-sdk/node_modules/@agoric/notifier/src';
import makeStore from '../../../agoric-sdk/node_modules/@agoric/store/src';

/**
 * This contract provides oracle queries for a fee or for pay.
 *
 * @type {ContractStartFn}
 *
 */
const start = async zcf => {
  const { notifier, updater } = makeNotifierKit();
  const instanceToSample = makeStore('oracleInstance');

  let fakeTimestamp = 39;

  const updateMedian = timestamp => {
    const sorted = instanceToSample
      .values() // Find all the samples.
      .filter(value => value) // Take out the zero and NaN samples.
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
    // console.error('took median', median, 'of', sorted);
    updater.updateState({ median, timestamp });
  };

  /** @type {MedianAggregatorCreatorFacet} */
  const creatorFacet = harden({
    addOracle(oracleInstance, query) {
      instanceToSample.init(oracleInstance, 0);
      E(zcf.getZoeService())
        .getPublicFacet(oracleInstance)
        .then(oracle => oracle.query(query))
        .then(value => {
          // Sample is NaN is a valid thing.
          const num = parseInt(value, 10);
          instanceToSample.set(oracleInstance, num);
          // FIXME: Get actual timestamp from timer service.
          fakeTimestamp += 1;
          return Promise.resolve(fakeTimestamp);
        })
        .then(updateMedian);
    },
    dropOracle(oracleInstance) {
      instanceToSample.delete(oracleInstance);
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

harden(start);
export { start };

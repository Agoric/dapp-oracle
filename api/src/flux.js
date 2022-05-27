// @ts-check
import { makeIssuerKit } from '@agoric/ertp';
import { E } from '@agoric/far';
import { observeIteration, makeNotifierKit } from '@agoric/notifier';
import {
  ratioGTE,
  makeRatio,
  subtractRatios,
  multiplyRatios,
  invertRatio,
  parseRatio,
} from '@agoric/zoe/src/contractSupport/ratio.js';

/**
 * @param {object} param0
 * @param {Record<string, any>} param0.query
 * @param {Amount} param0.fee
 * @param {Ratio} param0.priceScale
 * @param {number} [param0.fractionalThreshold]
 * @param {number} [param0.absoluteThreshold]
 * @param {bigint} [param0.idleTimerTicks]
 * @param {object} param1
 * @param {AsyncIterable<void>} [param1.pollIterable]
 * @param {ERef<TimerService>} param1.timerService
 * @param {ERef<Notifier<bigint> | undefined>} [param1.roundStartNotifier]
 * @param {ERef<Awaited<ReturnType<typeof import('./builtin.js').makeBuiltinOracle>>['oracleHandler']>} param1.oracleHandler
 */
export const makeFluxNotifier = async (
  {
    query,
    fee,
    priceScale,
    fractionalThreshold: rawFractionalThreshold = 0,
    absoluteThreshold: rawAbsoluteThreshold = 0,
    idleTimerTicks,
  },
  { pollIterable, timerService, oracleHandler, roundStartNotifier },
) => {
  const { notifier: fluxNotifier, updater: fluxUpdater } = makeNotifierKit();

  const { brand: dimensionless } = makeIssuerKit('dimensionless');

  const {
    numerator: { brand: brandOut },
    denominator: { brand: brandIn },
  } = priceScale;

  const parsePrice = numericData => {
    const ratio = parseRatio(numericData, dimensionless);
    return multiplyRatios(priceScale, ratio);
  };

  const fractionalThreshold = parseRatio(rawFractionalThreshold, dimensionless);
  const absoluteThreshold = parsePrice(rawAbsoluteThreshold);

  /** @type {Promise<any> | undefined} */
  let querying;

  /** @type {bigint | undefined} */
  let currentRound;

  // Start a fresh query if we don't already have one.
  const triggerQuery = async (fromPollTimer) => {
    if (!querying || fromPollTimer) {
      const thisQuery = E(oracleHandler)
        .onQuery(query, fee)
        .then(({ reply }) => reply)
        .finally(() => {
          // Clear out the current query if we're it.
          if (querying === thisQuery) {
            querying = undefined;
          }
        });
      querying = thisQuery;
    }
    return querying;
  };

  let lastSubmission = makeRatio(0n, brandOut, 1n, brandIn);
  const submitToCurrentRound = (data, round) => {
    if (currentRound !== round) {
      return;
    }
    lastSubmission = parsePrice(data);
    if (currentRound === undefined) {
      // No round data, just send the query value directly.
      fluxUpdater.updateState(lastSubmission);
      return;
    }

    // We have a round, so attach it to the update.
    fluxUpdater.updateState({ ...lastSubmission, roundId: currentRound });
    if (!idleTimerTicks) {
      // No timeout on rounds, just let others and polling initiate.
      return;
    }

    // Submit a new round if there is a timeout with no intervening rounds.
    const preRound = currentRound;
    E(timerService)
      .delay(idleTimerTicks)
      .then(async () => {
        if (preRound !== currentRound) {
          // A different piece already started a new round.
          return;
        }
        const data2 = await triggerQuery(false);
        submitToCurrentRound(data2, preRound);
      });
  };

  const startNewRoundIfDeviated = (data, round) => {
    if (currentRound !== round) {
      return;
    }

    const current = parsePrice(data);
    const diff = ratioGTE(current, lastSubmission)
      ? subtractRatios(current, lastSubmission)
      : subtractRatios(lastSubmission, current);
    if (!ratioGTE(diff, absoluteThreshold)) {
      // We're within the absolute threshold, so don't send.
      return;
    }

    if (lastSubmission.numerator.value > 0n) {
      const fraction = multiplyRatios(diff, invertRatio(lastSubmission));
      if (!ratioGTE(fraction, fractionalThreshold)) {
        // Didn't deviate by a large enough fraction yet.
        return;
      }
    }

    if (currentRound !== undefined) {
      currentRound += 1n;
    }
    submitToCurrentRound(data, currentRound);
  };

  // Observe the start of every round.
  const roundStarter = await roundStartNotifier;
  if (roundStarter) {
    observeIteration(roundStarter, {
      async updateState(round) {
        if (currentRound === undefined || round <= currentRound) {
          // We already submitted for this round, so skip.
          return;
        }

        // Trigger a query for this round.
        currentRound = round;
        const data = await triggerQuery(false);
        submitToCurrentRound(data, round);
      },
    });
  }

  // Query on the polling interval.
  if (pollIterable) {
    observeIteration(pollIterable, {
      async updateState(_tick) {
        const preRound = currentRound;
        const data = await triggerQuery(true);
        startNewRoundIfDeviated(data, preRound);
      },
    });
  }

  // Trigger the first query and wait for its response.
  const data = await triggerQuery(false);
  submitToCurrentRound(data, currentRound);

  return fluxNotifier;
};

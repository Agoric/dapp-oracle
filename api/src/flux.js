import { E } from '@agoric/far';
import { observeIteration, makeNotifierKit } from '@agoric/notifier';

/**
 * @param {object} param0
 * @param {Record<string, any>} param0.query
 * @param {Amount} param0.fee
 * @param {number} [param0.fractionalThreshold]
 * @param {number} [param0.absoluteThreshold]
 * @param {bigint} [param0.idleTimerTicks]
 * @param {object} param1
 * @param {AsyncIterable<void>} [param1.pollIterable]
 * @param {ERef<TimerService>} param1.timerService
 * @param {ERef<Notifier<bigint> | undefined>} [param1.roundStartNotifier]
 * @param {ERef<Awaited<ReturnType<typeof makeBuiltinOracle>>['oracleHandler']>} param1.oracleHandler
 */
export const makeFluxNotifier = async (
  {
    query,
    fee,
    fractionalThreshold = 0,
    absoluteThreshold = 0,
    idleTimerTicks,
  },
  { pollIterable, timerService, oracleHandler, roundStartNotifier },
) => {
  const { notifier: fluxNotifier, updater: fluxUpdater } = makeNotifierKit();

  /** @type {Promise<any> | undefined} */
  let querying;

  /** @type {bigint} */
  let currentRound;

  // Start a fresh query if we don't already have one.
  const triggerQuery = async () => {
    if (!querying) {
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

  let lastSubmission = 0;
  const submitToCurrentRound = (data, round) => {
    if (currentRound !== round) {
      return;
    }
    lastSubmission = parseFloat(data);
    if (currentRound === undefined) {
      // No round data, just send the query value directly.
      fluxUpdater.updateState(data);
      return;
    }

    // We have a round, so attach it to the update.
    fluxUpdater.updateState({ data, roundId: currentRound });
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
        const data2 = await triggerQuery();
        submitToCurrentRound(data2, preRound);
      });
  };

  const startNewRoundIfDeviated = (data, round) => {
    if (currentRound !== round) {
      return;
    }
    const current = parseFloat(data);

    const diff = Math.abs(current - lastSubmission);
    if (diff < absoluteThreshold) {
      // We're within the absolute threshold, so don't send.
      return;
    }

    if (lastSubmission && diff / lastSubmission < fractionalThreshold) {
      // Didn't deviate by a large enough fraction yet.
      return;
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
        if (round <= currentRound) {
          // We already submitted for this round, so skip.
          return;
        }

        // Trigger a query for this round.
        currentRound = round;
        const data = await triggerQuery();
        submitToCurrentRound(data, round);
      },
    });
  }

  // Query on the polling interval.
  if (pollIterable) {
    observeIteration(pollIterable, {
      async updateState(_tick) {
        const preRound = currentRound;
        const data = await triggerQuery();
        startNewRoundIfDeviated(data, preRound);
      },
    });
  }

  return fluxNotifier;
};

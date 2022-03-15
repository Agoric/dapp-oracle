// @ts-check
import { E, Far } from '@agoric/far';
import { makePromiseKit } from '@endo/promise-kit';
import { observeIteration, makeNotifierKit } from '@agoric/notifier';

import { makeExternalOracle } from './external.js';
import { makeBuiltinOracle } from './builtin.js';
// import { makeCronTickIterable } from './cron.js';
import { makePeriodicTickIterable } from './ticks.js';

/**
 * @param {{ zoe: any, http: any, board: any, installOracle?: string, feeIssuer: Issuer, invitationIssuer: Issuer }} param0
 * @param {unknown} _invitationMaker
 */
const startSpawn = async (
  { board, feeIssuer, http, invitationIssuer, zoe },
  _invitationMaker,
) => {
  const handler = Far('oracle handler', {
    getCommandHandler() {
      const commandHandler = {
        onError(obj, _meta) {
          console.error('Have error', obj);
        },

        onOpen(_obj, _meta) {},

        onClose(_obj, _meta) {},

        async onMessage(obj, _meta) {
          // These are messages we receive from either POST or WebSocket.
          switch (obj.type) {
            case 'oracle/query': {
              try {
                const { instanceId, query } = obj.data;
                const instance = await E(board).getValue(instanceId);
                const publicFacet = E(zoe).getPublicFacet(instance);
                const reply = await E(publicFacet).query(query);
                return harden({
                  type: 'oracle/queryResponse',
                  data: { ...obj.data, reply },
                });
              } catch (e) {
                return harden({
                  type: 'oracle/queryError',
                  data: { ...obj.data, error: `${(e && e.stack) || e}` },
                });
              }
            }

            case 'oracle/sendInvitation': {
              const { depositFacetId, dappContext, offer } = obj.data;
              const { instanceId, query } = dappContext;
              try {
                const depositFacet = E(board).getValue(depositFacetId);
                const instance = await E(board).getValue(instanceId);
                const publicFacet = E(zoe).getPublicFacet(instance);
                const invitationP = await E(publicFacet).makeQueryInvitation(
                  query,
                );
                const deposited = E(depositFacet).receive(invitationP);
                const invitationAmount = await E(invitationIssuer).getAmountOf(
                  invitationP,
                );
                const {
                  // @ts-ignore - this is known to be an invitation value
                  value: [{ handle }],
                } = invitationAmount;
                const invitationHandleBoardId = await E(board).getId(handle);
                const updatedOffer = {
                  ...offer,
                  invitationHandleBoardId,
                  dappContext,
                };

                // We need to wait for the invitation to be
                // received, or we will possibly win the race of
                // proposing the offer before the invitation is ready.
                // TODO: We should make this process more robust.
                await deposited;

                return harden({
                  type: 'oracle/sendInvitationResponse',
                  data: { offer: updatedOffer },
                });
              } catch (e) {
                return harden({
                  type: 'oracle/queryError',
                  data: { ...dappContext, error: `${(e && e.stack) || e}` },
                });
              }
            }

            default:
              return undefined;
          }
        },
      };
      return Far('oracle command handler', commandHandler);
    },
  });

  return harden({
    handler,
    oracleMaster: Far('oracleMaster', {
      makeExternalOracle() {
        return makeExternalOracle({ board, http, feeIssuer });
      },
      makeBuiltinOracle({ httpClient, requiredFee }) {
        return makeBuiltinOracle({
          board,
          http,
          httpClient,
          requiredFee,
          feeIssuer,
        });
      },
      /**
       * @param {object} param0
       * @param {Record<string, any>} param0.query
       * @param {Amount} param0.fee
       * @param {number} [param0.minDeviationPercent]
       * @param {bigint} [param0.timeoutTicks]
       * @param {object} param1
       * @param {AsyncIterable<void>} [param1.pollingIterable]
       * @param {ERef<TimerService>} param1.timerService
       * @param {ERef<Notifier<bigint> | undefined>} [param1.roundStartNotifier]
       * @param {ERef<Awaited<ReturnType<typeof makeBuiltinOracle>>['oracleHandler']>} param1.oracleHandler
       */
      async makeFluxNotifier(
        { query, fee, minDeviationPercent = 0, timeoutTicks },
        { pollingIterable, timerService, oracleHandler, roundStartNotifier },
      ) {
        const deviationTolerance = minDeviationPercent / 100.0;

        const {
          notifier: fluxNotifier,
          updater: fluxUpdater,
        } = makeNotifierKit();

        /** @type {Promise<any> | undefined} */
        let querying;

        /** @type {bigint} */
        let currentRound;

        // Start a fresh query if we don't already have one.
        const triggerQuery = async () => {
          if (!querying) {
            const thisQuery = E(oracleHandler)
              .onQuery(query, fee)
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
          if (!timeoutTicks) {
            // No timeout on rounds, just let others and polling initiate.
            return;
          }

          // Submit a new round if there is a timeout with no intervening rounds.
          const preRound = currentRound;
          E(timerService)
            .delay(timeoutTicks)
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
          if (
            lastSubmission &&
            Math.abs(current - lastSubmission) / lastSubmission <
              deviationTolerance
          ) {
            // Didn't deviate enough yet.
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
        if (pollingIterable) {
          observeIteration(pollingIterable, {
            async updateState(_tick) {
              const preRound = currentRound;
              const data = await triggerQuery();
              startNewRoundIfDeviated(data, preRound);
            },
          });
        }

        return fluxNotifier;
      },
      /**
       *
       * @param {AsyncIterable<bigint>} tickIterable
       * @param {ERef<TimerService>} timerService
       */
      makeTimerIterable(tickIterable, timerService) {
        return Far('timer iterable', {
          [Symbol.asyncIterator]: () => {
            const tickIterator = E(tickIterable)[Symbol.asyncIterator]();
            return Far('timer iterator', {
              next: async () => {
                /** @type {any} */
                const startTick = await E(timerService).getCurrentTimestamp();
                const { value: deadline } = await E(tickIterator).next(
                  startTick,
                );
                if (startTick >= deadline) {
                  // We're already past the deadline, so wake immediately.
                  return { done: false, value: startTick };
                }

                // Wait for the next deadline.
                const wake = makePromiseKit();
                E(timerService).setWakeup(
                  deadline,
                  Far('waker', {
                    wake: tick => {
                      wake.resolve(tick);
                    },
                  }),
                );
                const wakeTick = await wake.promise;
                return harden({ done: false, value: wakeTick });
              },
            });
          },
        });
      },
      makePeriodicTickIterable,
      // FIXME: Enable when we have CJS support in compartment-mapper.
      // makeCronTickIterable,
    }),
  });
};

export default harden(startSpawn);

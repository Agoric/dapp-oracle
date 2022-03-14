// @ts-check
import { E, Far } from '@agoric/far';
import { makePromiseKit } from '@endo/promise-kit';

import { makeExternalOracle } from './external.js';
import { makeBuiltinOracle } from './builtin.js';
// import { makeCronTickIterable } from './cron.js';

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
    oracleAdmin: Far('oracleAdmin', {
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
      // FIXME: Enable when we have CJS support in compartment-mapper.
      // makeCronTickIterable,
      makeTimerIterable(tickIterable, timerService) {
        // @ts-expect-error - Type 'unique symbol' cannot be used as an index type.ts(2538)
        const cronTickIterator = E(tickIterable)[Symbol.asyncIterator]();
        return Far('cron iterable', {
          [Symbol.asyncIterator]: () => {
            return Far('cron iterator', {
              next: async () => {
                const startTick = await E(timerService).getCurrentTimestamp();
                const { value: deadline } = await E(cronTickIterator).next(
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
    }),
  });
};

export default harden(startSpawn);

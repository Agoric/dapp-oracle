// @ts-check
import harden from '@agoric/harden';
import { E } from '@agoric/eventual-send';

import { makeAmountMath } from '@agoric/ertp';

/**
 * @param {{ zoe: any, http: any, board: any, installOracle?: string, feeIssuer: Issuer, invitationIssuer: Issuer }} param0
 */
const startSpawn = async (
  { http, board, feeIssuer, invitationIssuer, installOracle, zoe },
  _invitationMaker,
) => {
  /** @type {OracleHandler} */
  let oracleHandler;
  let oracleURLHandler;

  if (installOracle) {
    const subChannelHandles = new Set();
    const queryIdToObj = new Map();
    const queryIdToActions = new Map();
    const queryIdToDoReply = new Map();

    const feeAmountMathKind = await E(feeIssuer).getAmountMathKind();
    const feeBrand = await E(feeIssuer).getBrand();

    const feeAmountMath = makeAmountMath(feeBrand, feeAmountMathKind);

    const sendToSubscribers = obj => {
      E(http)
        .send(obj, [...subChannelHandles.keys()])
        .catch(e => console.error('cannot send', e));
    };

    let lastQueryId = 0;

    oracleHandler = {
      async onQuery(query, actions) {
        lastQueryId += 1;
        const queryId = lastQueryId;
        const obj = {
          type: 'oracleServer/onQuery',
          data: {
            queryId,
            query,
          },
        };
        queryIdToActions.set(queryId, actions);
        queryIdToObj.set(queryId, obj);
        sendToSubscribers(obj);
        return new Promise(resolve => {
          queryIdToDoReply.set(queryId, (reply, value) => {
            if (value) {
              E(actions).collectFee({ Fee: feeAmountMath.make(value) });
            }
            resolve(reply);
            queryIdToDoReply.delete(queryId);
            queryIdToObj.delete(queryId);
            queryIdToActions.delete(queryId);
            sendToSubscribers({
              type: 'oracleServer/onReply',
              data: {
                queryId,
                query,
                reply,
              },
            });
          });
        });
      },
    };

    oracleURLHandler = {
      getCommandHandler() {
        const commandHandler = {
          onError(obj, _meta) {
            console.error('Have error', obj);
          },

          onOpen(_obj, { channelHandle }) {
            // Send all the pending requests to the new channel.
            for (const obj of queryIdToObj.values()) {
              E(http)
                .send(obj, [channelHandle])
                .catch(e => console.error('cannot send', e));
            }
            subChannelHandles.add(channelHandle);
          },

          onClose(_obj, { channelHandle }) {
            subChannelHandles.delete(channelHandle);
          },

          async onMessage(obj, { _channelHandle }) {
            // These are messages we receive from either POST or WebSocket.
            switch (obj.type) {
              case 'oracleServer/assertDeposit': {
                const { queryId, value } = obj.data;
                const actions = queryIdToActions.get(queryId);
                if (actions) {
                  return E(actions)
                    .assertDeposit({
                      Fee: feeAmountMath.make(value),
                    })
                    .then(
                      // Asserted!
                      _ => ({
                        type: 'oracleServer/assertDepositResponse',
                        data: { queryId, value },
                      }),
                      // Failed!
                      e => ({
                        type: 'oracleServer/onError',
                        data: { queryId, error: e },
                      }),
                    );
                }
                return undefined;
              }

              case 'oracleServer/reply': {
                const { queryId, reply, value } = obj.data;
                const doReply = queryIdToDoReply.get(queryId);
                if (doReply) {
                  doReply(reply, value);
                }
                return true;
              }

              default:
                return undefined;
            }
          },
        };
        return harden(commandHandler);
      },
    };
  }

  const handler = {
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
              const { depositFacetId, outcomeDetails, offer } = obj.data;
              const { instanceId, query } = outcomeDetails;
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
                  value: [{ handle }],
                } = invitationAmount;
                const invitationHandleBoardId = await E(board).getId(handle);
                const updatedOffer = {
                  ...offer,
                  invitationHandleBoardId,
                  outcomeDetails,
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
                  data: { ...outcomeDetails, error: `${(e && e.stack) || e}` },
                });
              }
            }

            default:
              return undefined;
          }
        },
      };
      return harden(commandHandler);
    },
  };

  return harden({
    oracleHandler,
    oracleURLHandler,
    handler,
  });
};

export default harden(startSpawn);

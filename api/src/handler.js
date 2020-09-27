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
  /** @type {AmountMath} */
  let feeAmountMath;
  const subChannelHandles = new Set();
  const queryIdToObj = new Map();
  const queryIdToActions = new Map();
  const queryIdToDoReply = new Map();

  if (installOracle) {
    const feeAmountMathKind = await E(feeIssuer).getAmountMathKind();
    const feeBrand = await E(feeIssuer).getBrand();

    feeAmountMath = makeAmountMath(feeBrand, feeAmountMathKind);

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
          queryIdToDoReply.set(queryId, reply => {
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
  }

  const handler = {
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
                await E(actions).assertDeposit({
                  Fee: feeAmountMath.make(value),
                });
              }
              return true;
            }

            case 'oracleServer/collectFee': {
              const { queryId, value } = obj.data;
              const actions = queryIdToActions.get(queryId);
              if (actions) {
                await E(actions).collectFee({
                  Fee: feeAmountMath.make(value),
                });
              }
              return true;
            }

            case 'oracleServer/reply': {
              const { queryId, reply } = obj.data;
              const doReply = queryIdToDoReply.get(queryId);
              if (doReply) {
                doReply(reply);
              }
              return true;
            }

            case 'oracle/query': {
              try {
                const { instanceId, query } = obj.data;
                const instance = await E(board).getValue(instanceId);
                const publicFacet = E(zoe).getPublicFacet(instance);
                const reply = await E(publicFacet).query(query);
                return harden({
                  type: 'oracle/queryResponse',
                  data: { instanceId, query, reply },
                });
              } catch (e) {
                return harden({
                  type: 'oracle/queryError',
                  data: `${(e && e.stack) || e}`,
                });
              }
            }

            case 'oracle/sendInvitation': {
              const { depositFacetId, instanceId, offer, query } = obj.data;
              const depositFacet = E(board).getValue(depositFacetId);
              const instance = await E(board).getValue(instanceId);
              const publicFacet = E(zoe).getPublicFacet(instance);
              const invitation = await E(publicFacet).makeQueryInvitation(
                query,
              );
              const invitationAmount = await E(invitationIssuer).getAmountOf(
                invitation,
              );
              const {
                value: [{ handle }],
              } = invitationAmount;
              const invitationHandleBoardId = await E(board).getId(handle);
              const updatedOffer = { ...offer, invitationHandleBoardId };
              // We need to wait for the invitation to be
              // received, or we will possibly win the race of
              // proposing the offer before the invitation is ready.
              // TODO: We should make this process more robust.
              await E(depositFacet).receive(invitation);

              return harden({
                type: 'oracle/sendInvitationResponse',
                data: { offer: updatedOffer },
              });
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
    handler,
  });
};

export default harden(startSpawn);

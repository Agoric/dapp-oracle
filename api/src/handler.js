// @ts-check
import harden from '@agoric/harden';
import { E } from '@agoric/eventual-send';

import { makeAmountMath } from '@agoric/ertp';
import { makePromiseKit } from '@agoric/promise-kit';

/**
 * @param {{ zoe: any, http: any, board: any, installOracle?: string, feeIssuer: Issuer, invitationIssuer: Issuer }} param0
 */
const startSpawn = async (
  { http, board, feeIssuer, invitationIssuer, installOracle, zoe },
  _invitationMaker,
) => {
  /** @type {OracleHandler} */
  let oracleHandler;
  const subChannelHandles = new Set();
  const requestIdToObj = new Map();
  const requestIdToWaitingPK = new Map();

  if (installOracle) {
    // Actually create our own oracle.
    const feeAmountMathKind = await E(feeIssuer).getAmountMathKind();
    const feeBrand = await E(feeIssuer).getBrand();

    const feeAmountMath = makeAmountMath(feeBrand, feeAmountMathKind);

    const sendToSubscribers = obj => {
      E(http)
        .send(obj, [...subChannelHandles.keys()])
        .catch(e => console.error('cannot send', e));
    };

    let lastQueryId = 0;
    let lastRequestId = 0;

    oracleHandler = {
      async onQuery(query) {
        lastQueryId += 1;
        const queryId = lastQueryId;

        const doRequest = (method, data = {}) => {
          lastRequestId += 1;
          const requestId = lastRequestId;
          const obj = {
            type: 'oracle/request',
            data: {
              ...data,
              method,
              queryId,
              query,
              requestId,
            },
          };
          sendToSubscribers(obj);
          requestIdToObj.set(requestId, obj);
          const waitingPK = makePromiseKit();
          requestIdToWaitingPK.set(requestId, waitingPK);
          return waitingPK.promise;
        };

        return {
          async calculateDeposit() {
            const value = await doRequest('calculateDeposit');
            if (!value) {
              return {};
            }
            return {
              Fee: feeAmountMath.make(value),
            };
          },
          async calculateFee(replyP) {
            const reply = await replyP;
            const value = await doRequest('calculateFee', { reply });
            if (!value) {
              return {};
            }
            return {
              Fee: feeAmountMath.make(value),
            };
          },
          getReply() {
            return doRequest('getReply');
          },
          completed(reply, collected) {
            const value = collected.Fee && collected.Fee.value;
            sendToSubscribers({
              type: 'oracle/completed',
              data: { queryId, query, reply, collected: value },
            });
          },
        };
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
          for (const obj of requestIdToObj.values()) {
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

            case 'oracle/requestResponse': {
              const { requestId, answer } = obj.data;
              const waitingPK = requestIdToWaitingPK.get(requestId);
              if (waitingPK) {
                waitingPK.resolve(answer);
                requestIdToWaitingPK.delete(requestId);
                requestIdToObj.delete(requestId);
              }
              return true;
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

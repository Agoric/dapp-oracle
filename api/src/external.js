// @ts-nocheck
import { E } from '@agoric/eventual-send';
import { makePromiseKit } from '@agoric/promise-kit';
import { amountMath } from '@agoric/ertp';
import {
  makeNotifierKit,
  makeAsyncIterableFromNotifier,
  observeIteration,
} from '@agoric/notifier';
import { makeStore } from '@agoric/store';

import '@agoric/zoe/src/contracts/exported';

async function makeExternalOracle({ board, http, feeIssuer }) {
  // console.warn('got', feeIssuer);
  const feeBrand = await E(feeIssuer).getBrand();

  const subChannelHandles = new Set();
  /** @type {Store<string, any>} */
  const queryIdToData = makeStore('queryId');
  /** @type {Store<string, PromiseRecord<any>} */
  const queryIdToReplyPK = makeStore('queryId');
  /** @type {Store<string, Updater<any>>} */
  const queryIdToUpdater = makeStore('queryId');

  const sendToSubscribers = (
    obj,
    channelHandles = [...subChannelHandles.keys()],
  ) => {
    E(http)
      .send(obj, channelHandles)
      .catch(e => console.error('cannot send', e));
  };

  const publishPending = (channelHandles = undefined) => {
    const queries = Object.fromEntries(queryIdToData.entries());
    const obj = { type: 'oracleServer/pendingQueries', data: { queries } };
    sendToSubscribers(obj, channelHandles);
  };

  let lastQueryId = 0;

  /** @type {OracleHandler} */
  const oracleHandler = {
    async onQuery(query, fee) {
      lastQueryId += 1;
      const queryId = `${lastQueryId}`;
      const data = {
        queryId,
        query,
        fee: fee.value,
      };
      queryIdToData.init(queryId, data);
      const replyPK = makePromiseKit();
      queryIdToReplyPK.init(queryId, replyPK);
      const obj = {
        type: 'oracleServer/onQuery',
        data,
      };
      sendToSubscribers(harden(obj));
      publishPending();
      return replyPK.promise;
    },
    async onReply(_query, _reply, _fee) {
      // do nothing
    },
    async onError(_query, _e) {
      // do nothing
    },
  };

  const oracleURLHandler = {
    getCommandHandler() {
      const commandHandler = {
        onError(obj, _meta) {
          console.error('Have error', obj);
        },

        onOpen(_obj, { channelHandle }) {
          subChannelHandles.add(channelHandle);
          // Send all the pending requests to the new channel.
          publishPending([channelHandle]);
        },

        onClose(_obj, { channelHandle }) {
          subChannelHandles.delete(channelHandle);
        },

        async onMessage(obj, { _channelHandle }) {
          // These are messages we receive from either POST or WebSocket.
          switch (obj.type) {
            case 'oracleServer/createNotifier': {
              const { notifier, updater } = makeNotifierKit();
              lastQueryId += 1;

              // Publish the notifier on the board.
              const queryId = `push-${lastQueryId}`;
              const boardId = await E(board).getId(notifier);

              // Say that we have an updater for that query.
              queryIdToUpdater.init(queryId, updater);
              const data = { ...obj.data, queryId, boardId };
              queryIdToData.init(queryId, data);

              publishPending();
              observeIteration(makeAsyncIterableFromNotifier(notifier), {
                updateState(reply) {
                  sendToSubscribers({
                    type: 'oracleServer/onPush',
                    data: { ...data, reply },
                  });
                },
                finish(final) {
                  sendToSubscribers({
                    type: 'oracleServer/onPush',
                    data: { ...data, reply: final },
                  });
                },
                fail(error) {
                  sendToSubscribers({
                    type: 'oracleServer/onPush',
                    data: { ...data, error },
                  });
                },
              });

              return harden({
                type: 'oracleServer/createNotifierResponse',
                data: { queryId, boardId },
              });
            }

            case 'oracleServer/reply': {
              const { queryId, reply, requiredFee, final = false } = obj.data;
              if (queryIdToUpdater.has(queryId)) {
                // We have an updater, so push the reply.
                const updater = queryIdToUpdater.get(queryId);
                if (final) {
                  updater.finish(reply);
                  queryIdToUpdater.delete(queryId);
                } else {
                  updater.updateState(reply);
                }
                return true;
              }
              if (queryIdToReplyPK.has(queryId)) {
                const replyPK = queryIdToReplyPK.get(queryId);
                replyPK.resolve({
                  reply,
                  requiredFee: amountMath.make(feeBrand, requiredFee || 0n),
                });
                queryIdToReplyPK.delete(queryId);
              }

              if (!queryIdToData.has(queryId)) {
                throw Error(`unrecognized queryId ${queryId}`);
              }
              const data = queryIdToData.get(queryId);
              queryIdToData.delete(queryId);
              sendToSubscribers({
                type: 'oracleServer/onReply',
                data: { ...data, reply, fee: requiredFee },
              });
              return true;
            }

            case 'oracleServer/error': {
              const { queryId, error } = obj.data;
              const e = Error(error);
              if (queryIdToUpdater.has(queryId)) {
                const updater = queryIdToUpdater.get(queryId);
                updater.fail(e);
                queryIdToUpdater.delete(queryId);
              }
              if (queryIdToReplyPK.has(queryId)) {
                const replyPK = queryIdToReplyPK.get(queryId);
                replyPK.reject(e);
                queryIdToReplyPK.delete(queryId);
              }

              if (!queryIdToData.has(queryId)) {
                throw Error(`unrecognized queryId ${queryId}`);
              }

              const data = queryIdToData.get(queryId);
              queryIdToData.delete(queryId);
              sendToSubscribers({
                type: 'oracleServer/onError',
                data: { ...data, error },
              });
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

  return harden({
    oracleHandler,
    oracleURLHandler,
  });
}

harden(makeExternalOracle);
export { makeExternalOracle };

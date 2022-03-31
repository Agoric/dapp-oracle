// @ts-check
import { E, Far } from '@agoric/far';
import { makePromiseKit } from '@endo/promise-kit';
import { makeLegacyMap } from '@agoric/store';
import { AmountMath } from '@agoric/ertp';

import { makePushCallbacks } from './push.js';

import '@agoric/zoe/src/contracts/exported.js';

async function makeExternalOracle({ board, http, feeIssuer }) {
  // console.warn('got', feeIssuer);
  const feeBrand = await E(feeIssuer).getBrand();

  /**
   * @type {LegacyMap<string, PromiseRecord<unknown>>}
   * Legacy because PromiseRecord mixes functions and data
   */
  const queryIdToReplyPK = makeLegacyMap('queryId');

  let lastQueryId = 0;

  const {
    queryIdToData,
    publishPending,
    sendToSubscribers,
    onOpen,
    onClose,
    onMessage: pushOnMessage,
  } = makePushCallbacks({ board, http });

  /** @type {OracleHandler} */
  const oracleHandler = Far('oracleHandler', {
    async onQuery(query, fee) {
      lastQueryId += 1;
      const queryId = `${lastQueryId}`;
      const data = {
        queryId,
        query,
        fee: `${fee.value}`,
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
  });

  const oracleURLHandler = Far('oracleURLHandler', {
    getCommandHandler() {
      const commandHandler = {
        onOpen,
        onClose,

        async onMessage(obj, _meta) {
          const pushReply = await pushOnMessage(obj);
          if (pushReply) {
            return pushReply;
          }

          switch (obj.type) {
            case 'oracleServer/reply': {
              const { queryId, reply, requiredFee } = obj.data;
              if (queryIdToReplyPK.has(queryId)) {
                const replyPK = queryIdToReplyPK.get(queryId);
                replyPK.resolve({
                  reply,
                  requiredFee: AmountMath.make(
                    feeBrand,
                    BigInt(requiredFee || 0),
                  ),
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
            default: {
              return false;
            }
          }
        },

        onError(obj, _meta) {
          console.error('Have error', obj);
        },
      };
      return Far('oracle commandHandler', commandHandler);
    },
  });

  return harden({
    oracleHandler,
    oracleURLHandler,
  });
}

harden(makeExternalOracle);
export { makeExternalOracle };

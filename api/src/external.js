import { E } from '@agoric/eventual-send';
import { makePromiseKit } from '@agoric/promise-kit';

async function makeExternalOracle({ http, feeAmountMath }) {
  const subChannelHandles = new Set();
  const queryIdToData = new Map();
  const queryIdToReplyPK = new Map();
  const queryToData = new Map();

  const sendToSubscribers = obj => {
    E(http)
      .send(obj, [...subChannelHandles.keys()])
      .catch(e => console.error('cannot send', e));
  };

  let lastQueryId = 0;

  /** @type {OracleHandler} */
  const oracleHandler = {
    async onQuery(query, fee) {
      lastQueryId += 1;
      const queryId = lastQueryId;
      const obj = {
        type: 'oracleServer/onQuery',
        data: {
          queryId,
          query,
          fee: fee.value,
        },
      };
      queryIdToData.set(queryId, obj.data);
      sendToSubscribers(obj);
      const replyPK = makePromiseKit();
      queryIdToReplyPK.set(queryId, replyPK);
      queryToData.set(query, obj.data);
      return replyPK.promise;
    },
    async onReply(query, reply, fee) {
      const data = queryToData.get(query);
      if (data) {
        queryIdToData.delete(data.queryId);
        queryIdToReplyPK.delete(data.queryId);
      }
      queryToData.delete(query);
      sendToSubscribers({
        type: 'oracleServer/onReply',
        data: { ...data, reply, fee: fee.value },
      });
    },
    async onError(query, e) {
      const data = queryToData.get(query);
      if (data) {
        queryIdToData.delete(data.queryId);
        queryIdToReplyPK.delete(data.queryId);
      }
      queryToData.delete(query);
      sendToSubscribers({
        type: 'oracleServer/onError',
        data: { ...data, error: `${(e && e.stack) || e}` },
      });
    },
  };

  const oracleURLHandler = {
    getCommandHandler() {
      const commandHandler = {
        onError(obj, _meta) {
          console.error('Have error', obj);
        },

        onOpen(_obj, { channelHandle }) {
          // Send all the pending requests to the new channel.
          for (const obj of queryIdToData.values()) {
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
            case 'oracleServer/reply': {
              const { queryId, reply, requiredFee } = obj.data;
              const replyPK = queryIdToReplyPK.get(queryId);
              if (replyPK) {
                replyPK.resolve({
                  reply,
                  requiredFee: feeAmountMath.make(requiredFee || 0),
                });
              }
              queryIdToReplyPK.delete(queryId);
              return true;
            }

            case 'oracleServer/error': {
              const { queryId, error } = obj.data;
              const replyPK = queryIdToReplyPK.get(queryId);
              if (replyPK) {
                replyPK.reject(Error(error));
              }
              const oldData = queryIdToData.get(queryId);
              queryIdToReplyPK.delete(queryId);
              queryIdToData.delete(queryId);
              if (oldData) {
                queryToData.delete(oldData.query);
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

  return harden({
    oracleHandler,
    oracleURLHandler,
  });
}

harden(makeExternalOracle);
export { makeExternalOracle };

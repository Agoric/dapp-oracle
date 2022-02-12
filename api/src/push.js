import { E } from '@agoric/far';

import { makeStore, makeLegacyMap } from '@agoric/store';

import {
  makeNotifierKit,
  makeAsyncIterableFromNotifier,
  observeIteration,
} from '@agoric/notifier';

export const makePushCallbacks = ({ board, http }) => {
  /**
   * @type {Store<string, {
   *   queryId: string, query: unknown, fee?: string, boardId?: string
   * }>}
   */
  const queryIdToData = makeStore('queryId');

  const subChannelHandles = new Set();

  const sendToSubscribers = (
    obj,
    channelHandles = [...subChannelHandles.keys()],
  ) => {
    E(http)
      .send(obj, channelHandles)
      .catch(e => console.error('cannot send', e));
  };

  /** @param {any[]} [channelHandles] */
  const publishPending = (channelHandles = undefined) => {
    const queries = Object.fromEntries(queryIdToData.entries());
    const obj = { type: 'oracleServer/pendingQueries', data: { queries } };
    sendToSubscribers(obj, channelHandles);
  };

  const onOpen = (_obj, { channelHandle }) => {
    subChannelHandles.add(channelHandle);
    // Send all the pending requests to the new channel.
    publishPending([channelHandle]);
  };

  const onClose = (_obj, { channelHandle }) => {
    subChannelHandles.delete(channelHandle);
  };

  /**
   * @type {LegacyMap<string, IterationObserver<unknown>>}
   * Legacy because makeNotifierKit().updater is not Far
   */
  const queryIdToUpdater = makeLegacyMap('queryId');
  let lastQueryId = 0;

  const onMessage = async obj => {
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

        const onPush = newData => {
          sendToSubscribers({
            type: 'oracleServer/onPush',
            data: newData,
          });
        };

        observeIteration(makeAsyncIterableFromNotifier(notifier), {
          updateState(reply) {
            onPush({ ...data, reply });
          },
          finish(final) {
            onPush({ ...data, reply: final });
          },
          fail(error) {
            onPush({ ...data, error });
          },
        });

        return harden({
          type: 'oracleServer/createNotifierResponse',
          data: { queryId, boardId },
        });
      }

      case 'oracleServer/reply': {
        const { queryId, reply, final = false } = obj.data;
        if (!queryIdToUpdater.has(queryId)) {
          return undefined;
        }

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

      case 'oracleServer/error': {
        const { queryId, error } = obj.data;
        if (!queryIdToUpdater.has(queryId)) {
          return undefined;
        }

        const e = Error(error);
        const updater = queryIdToUpdater.get(queryId);
        updater.fail(e);
        queryIdToUpdater.delete(queryId);
        return true;
      }

      default:
        return undefined;
    }
  };

  return {
    queryIdToData,
    publishPending,
    sendToSubscribers,
    onOpen,
    onClose,
    onMessage,
  };
};

// @ts-check
import { E } from '@agoric/eventual-send';
import {
  makeNotifierKit,
  makeAsyncIterableFromNotifier,
} from '@agoric/notifier';

import '@agoric/zoe/exported';

/**
 * @callback CancelFunction
 * @param {any} [reason]
 * @returns {void}
 */

/**
 * @template T
 * @typedef {Object} AsyncIterableKit
 * @property {AsyncIterable<T>} asyncIterable
 * @property {CancelFunction} cancel
 */

/**
 * Create an async iterable that plays back a script.
 *
 * @template T
 * @param {Array<T>} script
 * @param {AsyncIterable<Timestamp>} timerAsyncIterable
 * @param {ERef<TimerService>} timerP
 * @param {boolean} [repeat=true]
 * @returns {AsyncIterable<{ timer: TimerService, timestamp: Timestamp, item: T }>}
 */
export async function* makeScriptedAsyncIterable(
  script,
  timerAsyncIterable,
  timerP,
  repeat = true,
) {
  let index = 0;
  const timer = await timerP;
  for await (const timestamp of timerAsyncIterable) {
    yield { timer, timestamp, item: script[index] };
    index += 1;
    if (index >= script.length) {
      if (!repeat) {
        return;
      }
      index = 0;
    }
  }
}

/**
 * Create an asyncIterable kit from a timer repeater.
 *
 * @param {ERef<TimerRepeater>} repeater
 * @param {Timestamp} [initialTimestamp]
 * @returns {Promise<AsyncIterableKit<Timestamp>>}
 */
export const makeRepeaterAsyncIterableKit = async (
  repeater,
  initialTimestamp = undefined,
) => {
  /** @type {NotifierRecord<Timestamp>} */
  const { notifier, updater } = makeNotifierKit();

  if (initialTimestamp !== undefined) {
    // Prime the pump.
    updater.updateState(initialTimestamp);
  }

  /** @type {TimerWaker} */
  await E(repeater).schedule({
    // FIXME: It's a limit of the current API that we have no way to detect when a
    // repeater has been disabled from within a handler.
    wake(timestamp) {
      updater.updateState(timestamp);
    },
  });

  const asyncIterable = makeAsyncIterableFromNotifier(notifier);

  /** @type {CancelFunction} */
  const cancel = (reason = Error(`timerAsyncIterable was cancelled`)) => {
    updater.fail(reason);
  };

  return { asyncIterable, cancel };
};

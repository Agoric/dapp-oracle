// @ts-check
import { E, Far } from '@agoric/far';
import {
  makeNotifierKit,
  makeAsyncIterableFromNotifier,
} from '@agoric/notifier';

import '@agoric/zoe/exported.js';

/**
 * @callback CancelFunction
 * @param {any} [reason]
 * @returns {void}
 */

/**
 * @typedef {Object} TimerAsyncIterableKit
 * @property {AsyncIterable<Timestamp>} asyncIterable
 * @property {CancelFunction} cancel
 * @property {TimerService} timer
 */

/**
 * Create an async iterable that plays back a script.
 *
 * @template T
 * @param {Array<T>} script
 * @param {TimerAsyncIterableKit} timerAsyncIterableKit
 * @param {boolean} [repeat=true]
 * @yields {{ timer: TimerService, timestamp: Timestamp, item: T }}
 */
export async function* makeScriptedAsyncIterable(
  script,
  timerAsyncIterableKit,
  repeat = true,
) {
  let index = 0;
  const { timer, asyncIterable: timerAsyncIterable } = timerAsyncIterableKit;
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
 * @param {TimerService} timer
 * @param {RelativeTime} delay
 * @param {RelativeTime} interval
 * @returns {Promise<TimerAsyncIterableKit>}
 */
export const makeTimerAsyncIterableKit = async (timer, delay, interval) => {
  const { notifier, updater } = makeNotifierKit();
  const repeater = E(timer).makeRepeater(delay, interval);

  /** @type {TimerWaker} */
  const waker = Far('waker', {
    // FIXME: It's a limit of the current API that we have no way to detect when
    // a repeater has been disabled from within a handler.
    wake(timestamp) {
      updater.updateState(timestamp);
    },
  });

  await E(repeater).schedule(waker);

  const asyncIterable = makeAsyncIterableFromNotifier(notifier);

  /** @type {CancelFunction} */
  const cancel = (reason = Error(`timerAsyncIterable was cancelled`)) => {
    updater.fail(reason);
    E(repeater).disable();
  };

  return { asyncIterable, cancel, timer };
};

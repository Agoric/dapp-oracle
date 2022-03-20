// @ts-check

import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';
import { makeCronTickIterable } from '../src/cron.js';

test('cron steps in two minutes', async t => {
  const cronTicker = makeCronTickIterable('*/2 * * * * *')[
    Symbol.asyncIterator
  ]();

  let now = BigInt(Date.now());
  const TWO_MINUTE = 120_000n;

  // The milliseconds delay is the remainder of the current second.
  const slop = now % TWO_MINUTE;
  const first0 = slop ? now + (TWO_MINUTE - slop + (slop % 1000n)) : now;

  // Check that we hit the first match.
  const t0 = await cronTicker.next(now);
  t.deepEqual(t0, { done: false, value: first0 });

  // Check firing exactly at the next two-minute.
  now += TWO_MINUTE;
  const first1 = first0 + TWO_MINUTE;
  const t1 = await cronTicker.next(now);
  t.deepEqual(t1, { done: false, value: first1 });

  // Check giving the next two-minute.
  now += 60_000n;
  const first2 = first1 + TWO_MINUTE;
  const t2 = await cronTicker.next(now);
  t.deepEqual(t2, { done: false, value: first2 });

  now += 30_000n;
  const first3 = first2;
  const t3 = await cronTicker.next(now);
  t.deepEqual(t3, { done: false, value: first3 });

  // Skip ahead two minutes.
  now += TWO_MINUTE;
  const first4 = first3 + TWO_MINUTE;
  const t4 = await cronTicker.next(now);
  t.deepEqual(t4, { done: false, value: first4 });
});

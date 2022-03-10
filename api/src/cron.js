// @ts-check
import { getFutureMatches } from '@datasert/cronjs-matcher';

import { E, Far } from '@endo/far';

const { details: X } = assert;

/**
 * @param {Date} date
 * @param {string} cronSpec
 * @param {number} [nmatches]
 * @returns {Date[]}
 */
export const nextCronMatches = (date, cronSpec, nmatches = 1) => {
  const matches = getFutureMatches(cronSpec, {
    startAt: date.toISOString(),
    matchCount: nmatches + 1,
  });
  if (+date === +matches[0]) {
    // We are already on the next matches.
    matches.shift();
  } else {
    // Drop the last match.
    matches.pop();
  }
  return matches.map(tstr => new Date(tstr));
};

export const makeScaledEpochTickConverter = (scale = 1) =>
  Far('scaledEpochTickConverter', {
    /** @param {bigint} tick */
    fromTick: tick => Number(tick) * scale,
    /** @param {number} dateMs */
    toTick: dateMs => BigInt(dateMs / scale),
  });

/**
 *
 * @param {string} cronSpec
 * @param {Object} [param1]
 * @param {number} [param1.tickScale]
 * @param {ReturnType<typeof makeScaledEpochTickConverter>} [param1.tickConverter]
 */
export const makeCronTickIterable = (
  cronSpec,
  {
    tickScale = 1,
    tickConverter = makeScaledEpochTickConverter(tickScale),
  } = {},
) => {
  assert(tickConverter);
  return Far('cron tick iterable', {
    [Symbol.asyncIterator]: () => {
      /** @type {bigint|undefined} */
      let afterTick;
      return Far('cron tick iterator', {
        /** @param {bigint} [tick] */
        next: async tick => {
          assert.typeof(
            tick,
            'bigint',
            X`Argument 'tick' must be a bigint, not ${tick}`,
          );
          if (afterTick && tick >= afterTick) {
            // We are past the tick after, so just return immediately.  This
            // simulates the behavior of anacron, so that jobs that are long
            // past due actually get run immediately.
            const value = afterTick;
            afterTick = undefined;
            return harden({ done: false, value });
          }
          const dateMs = await E(tickConverter).fromTick(tick);
          const matches = nextCronMatches(new Date(dateMs), cronSpec, 2);
          const ticks = await Promise.all(
            matches.map(dt => E(tickConverter).toTick(+dt)),
          );
          // Track the next scheduled tick.
          if (!afterTick || ticks[1] > afterTick) {
            afterTick = ticks[1];
          }
          return harden({
            done: false,
            value: ticks[0],
          });
        },
      });
    },
  });
};

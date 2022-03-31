import { E, Far } from '@endo/far';

const { details: X } = assert;

export const makeScaledEpochTickConverter = (scale = 1) =>
  Far('scaledEpochTickConverter', {
    /** @param {bigint} tick */
    fromTick: tick => Number(tick) * scale,
    /** @param {number} dateMs */
    toTick: dateMs => BigInt(dateMs / scale),
  });

/**
 * @param {(date: Date) => Date[]} getNextTwoPeriods
 * @param {Object} [param1]
 * @param {number} [param1.tickScale]
 * @param {ReturnType<typeof makeScaledEpochTickConverter>} [param1.tickConverter]
 */
export const makeScheduledTickIterable = (
  getNextTwoPeriods,
  {
    tickScale = 1,
    tickConverter = makeScaledEpochTickConverter(tickScale),
  } = {},
) => {
  assert(tickConverter);
  return Far('periodic tick iterable', {
    [Symbol.asyncIterator]: () => {
      /** @type {bigint|undefined} */
      let afterTick;
      return Far('periodic tick iterator', {
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
          const matches = getNextTwoPeriods(new Date(dateMs));
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

/**
 * @param {number} periodMs
 * @param {Object} [param1]
 * @param {number} [param1.tickScale]
 * @param {ReturnType<typeof makeScaledEpochTickConverter>} [param1.tickConverter]
 */
export const makePeriodicTickIterable = (periodMs, param1) => {
  const getNextTwoPeriods = date => {
    const first = new Date(+date + periodMs);
    const second = new Date(+first + periodMs);
    return [first, second];
  };
  return makeScheduledTickIterable(getNextTwoPeriods, param1);
};

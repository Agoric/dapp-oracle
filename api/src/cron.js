// @ts-check
import { getFutureMatches } from '@datasert/cronjs-matcher';
import { makeScheduledTickIterable } from './ticks.js';

/**
 * @param {Date} date
 * @param {string} cronSpec
 * @param {number} [nmatches]
 * @returns {Date[]}
 */
export const nextCronMatches = (date, cronSpec, nmatches = 1) => {
  // console.error('nextCronMatches', { date, cronSpec, nmatches });
  // console.error({ getFutureMatches, date: { toISOString: date.toISOString } });
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

/**
 * @param {string} cronSpec
 * @param {Object} [param1]
 */
export const makeCronTickIterable = (cronSpec, param1) => {
  const getNextTwoPeriods = date => nextCronMatches(date, cronSpec, 2);
  return makeScheduledTickIterable(getNextTwoPeriods, param1);
};

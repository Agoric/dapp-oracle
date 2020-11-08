// @ts-check
import { assert, details } from '@agoric/assert';

import { makeFungiblePriceAuthority } from './fungible';
import {
  makeScriptedAsyncIterable,
  makeTimerAsyncIterableKit,
} from '../asyncIterableKit';

import '@agoric/zoe/exported';

/**
 * @typedef {Object} FakePriceAuthorityOptions
 * @property {AmountMath} mathIn
 * @property {AmountMath} mathOut
 * @property {Array<number>} [priceList]
 * @property {Array<[number, number]>} [tradeList]
 * @property {TimerService} timer
 * @property {RelativeTime} [quoteDelay]
 * @property {RelativeTime} [quoteInterval]
 * @property {ERef<Mint>} [quoteMint]
 * @property {Amount} [unitAmountIn]
 * @property {boolean} [repeat]
 */

/**
 * TODO: multiple price Schedules for different goods, or for moving the price
 * in different directions?
 *
 * @param {FakePriceAuthorityOptions} options
 * @returns {Promise<PriceAuthority>}
 */
export async function makeFakePriceAuthority(options) {
  const {
    mathIn,
    mathOut,
    priceList,
    tradeList,
    timer,
    unitAmountIn = mathIn.make(1),
    quoteDelay = 0,
    quoteInterval = 1,
    repeat = true,
    quoteMint,
  } = options;

  /** @type {number} */
  const unitValueIn = mathIn.getValue(unitAmountIn);

  /** @type {Array<[number, number]>} */
  let trades;
  if (tradeList) {
    trades = tradeList;
  } else {
    assert(priceList, details`One of tradeList or priceList must be specified`);
    trades = priceList.map(price => [unitValueIn, price]);
  }

  // Create a timer iterator.
  const timerAsyncIteratorKit = await makeTimerAsyncIterableKit(
    timer,
    quoteDelay,
    quoteInterval,
  );

  // Do the trades over the repeater.
  const quotes = makeScriptedAsyncIterable(
    trades,
    timerAsyncIteratorKit,
    repeat,
  );

  const priceAuthority = await makeFungiblePriceAuthority({
    mathIn,
    mathOut,
    quotes,
    quoteMint,
    timer,
  });

  return priceAuthority;
}

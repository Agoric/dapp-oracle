// @ts-check
import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';

import { makeFungiblePriceAuthority } from './fungible';
import {
  makeScriptedAsyncIterable,
  makeRepeaterAsyncIterableKit,
} from '../asyncIterableKit';

import '@agoric/zoe/exported';

/**
 * @typedef {Object} FakePriceAuthorityOptions
 * @property {AmountMath} mathIn
 * @property {AmountMath} mathOut
 * @property {Array<number>} [priceList]
 * @property {Array<[number, number]>} [tradeList]
 * @property {ERef<TimerService>} timer
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
    quoteInterval = 1,
    repeat = true,
    quoteMint,
  } = options;

  assert(
    tradeList || priceList,
    details`One of priceList or tradeList must be specified`,
  );

  const unitValueIn = mathIn.getValue(unitAmountIn);

  /** @type {Array<[number, number]>} */
  const trades = priceList
    ? priceList.map(price => [unitValueIn, price])
    : tradeList;

  // Create a repeater for our timer.
  const repeater = E(timer).createRepeater(0, quoteInterval);
  const {
    asyncIterable: repeaterAsyncIterable,
  } = await makeRepeaterAsyncIterableKit(repeater);

  // Do the trades over the repeater.
  const quotes = makeScriptedAsyncIterable(
    trades,
    repeaterAsyncIterable,
    timer,
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

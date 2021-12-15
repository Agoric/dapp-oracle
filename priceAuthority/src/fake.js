// @ts-check
import { assert, details } from '@agoric/assert';
import { AmountMath } from '@agoric/ertp';

import { makeLinearPriceAuthority } from './linear';
import {
  makeScriptedAsyncIterable,
  makeTimerAsyncIterableKit,
} from '../asyncIterableKit';

import '@agoric/zoe/exported';

/**
 * @typedef {Object} FakePriceAuthorityOptions
 * @property {Brand} brandIn
 * @property {Brand} brandOut
 * @property {Array<bigint>} [priceList]
 * @property {Array<[bigint, bigint]>} [tradeList]
 * @property {QuoteStream} [quotes]
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
    brandIn,
    brandOut,
    priceList,
    tradeList,
    quotes: overrideQuotes,
    timer,
    unitAmountIn = AmountMath.make(brandIn, 1n),
    quoteDelay = 0n,
    quoteInterval = 1n,
    quoteMint,
  } = options;

  let quotes = overrideQuotes;
  if (!quotes) {
    let trades;
    if (tradeList) {
      trades = tradeList.map(([valueIn, valueOut]) => ({
        amountIn: AmountMath.make(brandIn, valueIn),
        amountOut: AmountMath.make(brandOut, valueOut),
      }));
    } else {
      assert(
        priceList,
        details`Either quotes, priceList, or tradeList must be specified`,
      );
      trades = priceList.map(price => ({
        amountIn: unitAmountIn,
        amountOut: AmountMath.make(brandOut, price),
      }));
    }

    // Create a timer iterator.
    const timerAsyncIteratorKit = await makeTimerAsyncIterableKit(
      timer,
      quoteDelay,
      quoteInterval,
    );

    // Do the repeated trades.
    quotes = makeScriptedAsyncIterable(trades, timerAsyncIteratorKit, true);
  }

  const priceAuthority = await makeLinearPriceAuthority({
    brandIn,
    brandOut,
    quotes,
    quoteMint,
    timer,
  });

  return priceAuthority;
}

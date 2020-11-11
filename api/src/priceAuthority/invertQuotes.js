// @ts-check
import { makeLocalAmountMath } from '@agoric/ertp';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';
import { E } from '@agoric/eventual-send';

import '@agoric/zoe/exported';

import './types';

/**
 * @typedef {Object} InverseQuoteStreamOptions
 * @property {AmountMath} mathIn
 * @property {AmountMath} mathOut
 * @property {ERef<PriceAuthority>} inOutPriceAuthority
 * @property {boolean} [VERIFY_QUOTE_PAYMENTS=true]
 */

/**
 * Create a QuoteStream whose amounts are exactly opposite of an underlying
 * authority.
 *
 * @param {InverseQuoteStreamOptions} options
 * @returns {Promise<QuoteStream>}
 */
export async function makeInverseQuoteStream(options) {
  const {
    mathIn: theirMathIn,
    mathOut: theirMathOut,
    inOutPriceAuthority: theirPa,
    VERIFY_QUOTE_PAYMENTS = true,
  } = options;

  const theirBrandIn = theirMathIn.getBrand();
  const theirBrandOut = theirMathOut.getBrand();

  const theirQuoteIssuer = E(theirPa).getQuoteIssuer(
    theirBrandIn,
    theirBrandOut,
  );
  const theirQuoteMath = await makeLocalAmountMath(theirQuoteIssuer);
  const theirNotifierP = E(theirPa).getQuoteNotifier(
    theirBrandIn,
    theirBrandOut,
  );
  const theirAsyncIterable = makeAsyncIterableFromNotifier(theirNotifierP);

  async function* makeOurQuoteAsyncIterable() {
    for await (const theirQuote of theirAsyncIterable) {
      /** @type {PriceQuote['quoteAmount']} */
      let theirQuoteAmount;
      if (VERIFY_QUOTE_PAYMENTS) {
        // Check that the payment is correct.
        theirQuoteAmount = await E(theirQuoteIssuer).getAmountOf(
          theirQuote.quotePayment,
        );
      } else {
        // Just assume the quote is correct.
        theirQuoteAmount = theirQuote.quoteAmount;
      }

      /** @type {PriceQuoteValue} */
      const theirQuoteValue = theirQuoteMath.getValue(theirQuoteAmount);
      const [
        {
          amountIn: theirAmountIn,
          amountOut: theirAmountOut,
          timestamp,
          timer,
        },
      ] = theirQuoteValue;

      // Ensure the amounts are correct.
      const amountIn = theirMathOut.coerce(theirAmountOut);
      const amountOut = theirMathIn.coerce(theirAmountIn);

      // Feed the inverse quote.
      yield { timer, timestamp, item: { amountIn, amountOut } };
    }
  }

  return makeOurQuoteAsyncIterable();
}

// @ts-check
import { AmountMath } from '@agoric/ertp';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';
import { E } from '@agoric/far';

import '@agoric/zoe/exported';

import './types';

/**
 * @typedef {Object} InverseQuoteStreamOptions
 * @property {Brand} brandIn
 * @property {Brand} brandOut
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
    brandIn: theirBrandIn,
    brandOut: theirBrandOut,
    inOutPriceAuthority: theirPa,
    VERIFY_QUOTE_PAYMENTS = true,
  } = options;

  const theirQuoteIssuer = E(theirPa).getQuoteIssuer(
    theirBrandIn,
    theirBrandOut,
  );
  const theirQuoteBrand = await E(theirQuoteIssuer).getBrand();
  const theirNotifierP = E(theirPa).makeQuoteNotifier(
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
      const theirQuoteValue = AmountMath.getValue(
        theirQuoteBrand,
        theirQuoteAmount,
      );
      const [
        {
          amountIn: theirAmountIn,
          amountOut: theirAmountOut,
          timestamp,
          timer,
        },
      ] = theirQuoteValue;

      // Ensure the amounts are correct.
      const amountIn = AmountMath.coerce(theirBrandOut, theirAmountOut);
      const amountOut = AmountMath.coerce(theirBrandIn, theirAmountIn);

      // Feed the inverse quote.
      yield { timer, timestamp, item: { amountIn, amountOut } };
    }
  }

  return makeOurQuoteAsyncIterable();
}

// @ts-check
import { natSafeMath } from '@agoric/zoe/src/contractSupport';
import { amountMath } from '@agoric/ertp';

import { makeSinglePriceAuthority } from './single';

import '@agoric/zoe/exported';

/**
 * Create a price authority which uses linear-scaled latest quotes from the
 * underlying quote stream to answer queries.
 *
 * So, if the quote stream produces `[moola(2), simolean(3)]`, and the caller
 * asks what it would get if it sold `moola(6)`, then we'll return
 * `simoleans(4)`.
 *
 * @param {BasePriceAuthorityOptions} options
 * @returns {Promise<PriceAuthority>}
 */
export async function makeLinearPriceAuthority(options) {
  const { brandIn, brandOut, quotes, timer: timerP, quoteMint } = options;

  const timer = await timerP;

  // Note: cannot currently be gotten from the brand alone
  // const mathKindIn = brandIn.getAmountMathKind();
  // const mathKindOut = brandOut.getAmountMathKind();

  // // We only support nat math for now.
  // assert.equal(
  //   mathKindIn,
  //   MathKind.NAT,
  //   details`Linear input math kind ${mathKindIn} is not ${q(MathKind.NAT)}`,
  // );
  // assert.equal(
  //   mathKindOut,
  //   MathKind.NAT,
  //   details`Linear output math kind ${mathKindOut} is not ${q(MathKind.NAT)}`,
  // );

  /** @type {bigint} */
  let latestValueIn;
  /** @type {bigint} */
  let latestValueOut;

  /**
   * @param {Amount} amountIn
   * @returns {Amount} How much amountOut we expect to get for amountIn
   */
  const expectedAmountOut = amountIn => {
    const valueIn = amountMath.getValue(brandIn, amountIn);
    const valueOut = natSafeMath.floorDivide(
      natSafeMath.multiply(valueIn, latestValueOut),
      latestValueIn,
    );
    return amountMath.make(brandOut, BigInt(valueOut));
  };

  /**
   * @param {Amount} amountOut
   * @returns {Amount} How much amountIn we need in order to get amountOut
   */
  const neededAmountIn = amountOut => {
    const valueOut = amountMath.getValue(brandOut, amountOut);
    const valueIn = natSafeMath.ceilDivide(
      natSafeMath.multiply(valueOut, latestValueIn),
      latestValueOut,
    );
    return amountMath.make(brandIn, BigInt(valueIn));
  };

  /**
   * Follow the quotes to get the latest values.
   *
   * @param {ERef<QuoteStream>} sourceQuotesP
   */
  async function* makeQuoteFollower(sourceQuotesP) {
    const sourceQuotes = await sourceQuotesP;
    for await (const quote of sourceQuotes) {
      const {
        item: { amountIn: quotedAmountIn, amountOut: quotedAmountOut },
      } = quote;
      const quotedValueIn = amountMath.getValue(brandIn, quotedAmountIn);
      const quotedValueOut = amountMath.getValue(brandOut, quotedAmountOut);

      // Update our cached values before we wait.
      latestValueIn = quotedValueIn;
      latestValueOut = quotedValueOut;

      // We pass through the original quote for our consumer.
      yield quote;
    }
  }

  const priceAuthority = await makeSinglePriceAuthority({
    brandIn,
    brandOut,
    quotes: makeQuoteFollower(quotes),
    quoteMint,
    timer,
    expectedAmountOut,
    neededAmountIn,
  });
  return priceAuthority;
}

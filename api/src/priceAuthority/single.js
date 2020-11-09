// @ts-check
import { makeIssuerKit, MathKind, makeLocalAmountMath } from '@agoric/ertp';
import { makePromiseKit } from '@agoric/promise-kit';
import { updateFromIterable, makeNotifierKit } from '@agoric/notifier';
import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';

import '@agoric/zoe/exported';

/**
 * @typedef {Object} SinglePriceAuthorityOptions
 * @property {(amountIn: Amount) => Amount} expectedAmountOut calculate the
 * amountOut that would be received if somebody sold amountIn
 * @property {(amountOut: Amount) => Amount} neededAmountIn calculate the
 * amountIn needed to sell to received amountOut
 */

/**
 * Create a price authority for a single direction (e.g. `moola -> simolean`).
 *
 * @param {SinglePriceAuthorityOptions & BasePriceAuthorityOptions} options
 * @returns {Promise<PriceAuthority>}
 */
export async function makeSinglePriceAuthority(options) {
  const {
    mathIn,
    mathOut,
    neededAmountIn,
    expectedAmountOut,
    quotes,
    timer: timerP,
    quoteMint = makeIssuerKit('quote', MathKind.SET).mint,
  } = options;

  const timer = await timerP;

  /**
   * @typedef {(a: Amount, b: Amount) => boolean} AmountComparator
   */

  /** @type {AmountComparator} */
  const isGTE = (a, b) => mathOut.isGTE(a, b);
  /** @type {AmountComparator} */
  const isGT = (a, b) => !mathOut.isGTE(b, a);
  /** @type {AmountComparator} */
  const isLTE = (a, b) => mathOut.isGTE(b, a);
  /** @type {AmountComparator} */
  const isLT = (a, b) => !mathOut.isGTE(a, b);

  /**
   * @typedef {Object} Trigger
   * @property {AmountComparator} amountComparator
   * @property {Amount} amountIn
   * @property {Amount} amountOutLimit
   * @property {(quote: PriceQuote) => void} resolve
   */

  /** @type {Array<Trigger>} */
  const triggerQueue = [];

  /**
   * @param {Brand} brandIn
   * @param {Brand} brandOut
   */
  const assertBrands = (brandIn, brandOut) => {
    assert.equal(
      brandIn,
      mathIn.getBrand(),
      details`${brandIn} is not an expected input brand`,
    );
    assert.equal(
      brandOut,
      mathOut.getBrand(),
      details`${brandOut} is not an expected output brand`,
    );
  };

  const quoteIssuer = E(quoteMint).getIssuer();
  const quoteMath = await makeLocalAmountMath(quoteIssuer);

  /** @type {NotifierRecord<PriceQuote>} */
  const { notifier, updater } = makeNotifierKit();

  /**
   * @param {Amount} amountIn
   * @param {Amount} amountOut
   * @param {Timestamp} quoteTime
   * @returns {PriceQuote}
   */
  const makeQuote = (amountIn, amountOut, quoteTime) => {
    const quoteAmount = quoteMath.make(
      harden([
        {
          amountIn,
          amountOut,
          timer,
          timestamp: quoteTime,
        },
      ]),
    );
    const quote = harden({
      quotePayment: E(quoteMint).mintPayment(quoteAmount),
      quoteAmount,
    });
    return quote;
  };

  /**
   * See which triggers have fired.
   *
   * @param {Timestamp} timestamp
   */
  const checkTriggers = timestamp => {
    let i = 0;
    while (i < triggerQueue.length) {
      const {
        amountIn,
        amountComparator,
        amountOutLimit,
        resolve,
      } = triggerQueue[i];
      const amountOut = expectedAmountOut(amountIn);
      if (amountComparator(amountOut, amountOutLimit)) {
        // Fire the trigger!
        triggerQueue.splice(i, 1);
        resolve(makeQuote(amountIn, amountOut, timestamp));
      } else {
        i += 1;
      }
    }
  };

  /** @type {PriceQuote} */
  let latestQuote;

  /** Update from the latest quote. */
  updateFromIterable(
    {
      updateState({ timestamp, item: { amountIn, amountOut } }) {
        latestQuote = makeQuote(amountIn, amountOut, timestamp);
        updater.updateState(latestQuote);

        // Check the triggers with the new quote.
        checkTriggers(timestamp);
      },
      finish(_ignored) {
        if (!latestQuote) {
          updater.fail(Error(`No quotes were generated`));
          return;
        }
        updater.finish(latestQuote);
      },
      fail(reason) {
        updater.fail(reason);
      },
    },
    quotes,
  );

  /**
   * Get a quote for at most the given amountIn
   *
   * @param {Amount} amountIn
   * @param {Brand} brandOut
   * @param {Timestamp} quoteTime
   * @returns {PriceQuote}
   */
  function quoteGivenAtMost(amountIn, brandOut, quoteTime) {
    assertBrands(amountIn.brand, brandOut);
    const amountOut = expectedAmountOut(amountIn);
    return makeQuote(amountIn, amountOut, quoteTime);
  }

  /**
   * Get a quote for at least the given amountOut.
   *
   * @param {Brand} brandIn
   * @param {Amount} amountOut
   * @param {Timestamp} quoteTime
   * @returns {PriceQuote}
   */
  function quoteWantedAtLeast(brandIn, amountOut, quoteTime) {
    assertBrands(brandIn, amountOut.brand);
    const amountIn = neededAmountIn(amountOut);
    return quoteGivenAtMost(amountIn, amountOut.brand, quoteTime);
  }

  /**
   * @param {AmountComparator} amountComparator
   * @param {Amount} amountIn
   * @param {Amount} amountOutLimit
   */
  function resolveQuoteWhen(amountComparator, amountIn, amountOutLimit) {
    assertBrands(amountIn.brand, amountOutLimit.brand);
    mathOut.coerce(amountOutLimit);
    mathIn.coerce(amountIn);
    const promiseKit = makePromiseKit();
    triggerQueue.push({
      amountComparator,
      amountIn,
      amountOutLimit,
      resolve: promiseKit.resolve,
    });
    return promiseKit.promise;
  }

  const getLatestTimestamp = async () => {
    // Get the latest price quote, waiting for it to be published if it hasn't
    // been already.
    const priceQuote = await notifier.getUpdateSince();
    // Extract its timestamp.
    const {
      value: {
        quoteAmount: {
          value: [{ timestamp }],
        },
      },
    } = priceQuote;
    return timestamp;
  };

  /** @type {PriceAuthority} */
  const priceAuthority = {
    async getQuoteIssuer(brandIn, brandOut) {
      assertBrands(brandIn, brandOut);
      return quoteIssuer;
    },
    async getTimerService(brandIn, brandOut) {
      assertBrands(brandIn, brandOut);
      return timer;
    },
    async getQuoteNotifier(brandIn, brandOut) {
      assertBrands(brandIn, brandOut);
      return notifier;
    },
    async quoteAtTime(timeStamp, amountIn, brandOut) {
      assertBrands(amountIn.brand, brandOut);
      const { promise, resolve } = makePromiseKit();
      E(timer).setWakeup(
        timeStamp,
        harden({
          wake: time => {
            return resolve(quoteGivenAtMost(amountIn, brandOut, time));
          },
        }),
      );
      return promise;
    },
    async quoteGiven(amountIn, brandOut) {
      assertBrands(amountIn.brand, brandOut);

      const timestamp = await getLatestTimestamp();
      return quoteGivenAtMost(amountIn, brandOut, timestamp);
    },
    async quoteWanted(brandIn, amountOut) {
      assertBrands(brandIn, amountOut.brand);

      const timestamp = await getLatestTimestamp();
      return quoteWantedAtLeast(brandIn, amountOut, timestamp);
    },
    async quoteWhenGTE(amountIn, amountOutLimit) {
      return resolveQuoteWhen(isGTE, amountIn, amountOutLimit);
    },
    async quoteWhenGT(amountIn, amountOutLimit) {
      return resolveQuoteWhen(isGT, amountIn, amountOutLimit);
    },
    async quoteWhenLTE(amountIn, amountOutLimit) {
      return resolveQuoteWhen(isLTE, amountIn, amountOutLimit);
    },
    async quoteWhenLT(amountIn, amountOutLimit) {
      return resolveQuoteWhen(isLT, amountIn, amountOutLimit);
    },
  };

  return priceAuthority;
}

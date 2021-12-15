// @ts-check
import { makeIssuerKit, AssetKind, AmountMath } from '@agoric/ertp';
import { makePromiseKit } from '@agoric/promise-kit';
import {
  makeNotifierKit,
  makeNotifierFromAsyncIterable,
} from '@agoric/notifier';
import { E, Far } from '@agoric/far';
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
    brandIn: actualBrandIn,
    brandOut: actualBrandOut,
    neededAmountIn,
    expectedAmountOut,
    quotes,
    timer: timerP,
    quoteMint = makeIssuerKit('quote', AssetKind.SET).mint,
  } = options;

  const timer = await timerP;

  /**
   * @typedef {(a: Amount, b: Amount) => boolean} AmountComparator
   */

  /** @type {AmountComparator} */
  const isGTE = (a, b) => AmountMath.isGTE(a, b);
  /** @type {AmountComparator} */
  const isGT = (a, b) => !AmountMath.isGTE(b, a);
  /** @type {AmountComparator} */
  const isLTE = (a, b) => AmountMath.isGTE(b, a);
  /** @type {AmountComparator} */
  const isLT = (a, b) => !AmountMath.isGTE(a, b);

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
      actualBrandIn,
      details`${brandIn} is not an expected input brand`,
    );
    assert.equal(
      brandOut,
      actualBrandOut,
      details`${brandOut} is not an expected output brand`,
    );
  };

  const quoteIssuer = E(quoteMint).getIssuer();
  const quoteBrand = await E(quoteIssuer).getBrand();

  /** @type {NotifierRecord<Timestamp>} */
  const { notifier: ticker, updater } = makeNotifierKit();

  /**
   * @param {Amount} amountIn
   * @param {Amount} amountOut
   * @param {Timestamp} quoteTime
   * @returns {PriceQuote}
   */
  const makeQuote = (amountIn, amountOut, quoteTime) => {
    const quoteAmount = AmountMath.make(
      quoteBrand,
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

  /* Fire the triggers when the quotes move. */
  // FIXME: implement with just a ticker source.
  async function runTriggers() {
    const quoteTicker = await quotes;
    for await (const { timestamp } of quoteTicker) {
      updater.updateState(timestamp);
      checkTriggers(timestamp);
    }
  }

  // Start the triggers in the background.
  runTriggers().catch(e => console.error('Ticker failed', e));

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
    AmountMath.coerce(actualBrandOut, amountOutLimit);
    AmountMath.coerce(actualBrandIn, amountIn);
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
    const { value: timestamp } = await ticker.getUpdateSince();
    return timestamp;
  };

  async function* makeQuoteStream(amountIn, brandOut) {
    let record = await ticker.getUpdateSince();
    while (record.updateCount) {
      const { value: timestamp } = record;
      yield quoteGivenAtMost(amountIn, brandOut, timestamp);
      // eslint-disable-next-line no-await-in-loop
      record = await ticker.getUpdateSince(record.updateCount);
    }
  }

  /** @type {PriceAuthority} */
  const priceAuthority = Far('priceAuthority', {
    async getQuoteIssuer(brandIn, brandOut) {
      assertBrands(brandIn, brandOut);
      return quoteIssuer;
    },
    async getTimerService(brandIn, brandOut) {
      assertBrands(brandIn, brandOut);
      return timer;
    },
    async makeQuoteNotifier(amountIn, brandOut) {
      assertBrands(amountIn.brand, brandOut);
      return makeNotifierFromAsyncIterable(makeQuoteStream(amountIn, brandOut));
    },
    async quoteAtTime(timeStamp, amountIn, brandOut) {
      assertBrands(amountIn.brand, brandOut);
      const { promise, resolve } = makePromiseKit();
      E(timer).setWakeup(
        timeStamp,
        Far('waker', {
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
  });

  return priceAuthority;
}

// @ts-check
import { makeIssuerKit, MathKind, makeLocalAmountMath } from '@agoric/ertp';
import { makePromiseKit } from '@agoric/promise-kit';
import { updateFromIterable, makeNotifierKit } from '@agoric/notifier';
import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';

import { natSafeMath } from '@agoric/zoe/src/contractSupport';

import '@agoric/zoe/exported';

/**
 * @typedef {number} ValueIn
 * @typedef {number} ValueOut
 * @typedef {AsyncIterable<{ timestamp: Timestamp, timer: TimerService, item: [ValueIn, ValueOut] }>} QuoteStream
 */

/**
 * @typedef {Object} FungiblePriceAuthorityOptions
 * @property {AmountMath} mathIn
 * @property {AmountMath} mathOut
 * @property {QuoteStream} quotes
 * @property {ERef<TimerService>} timer
 * @property {ERef<Mint>} [quoteMint]
 */

/**
 * @param {FungiblePriceAuthorityOptions} options
 * @returns {Promise<PriceAuthority>}
 */
export async function makeFungiblePriceAuthority(options) {
  const {
    mathIn,
    mathOut,
    quotes,
    timer: timerP,
    quoteMint = makeIssuerKit('quote', MathKind.SET).mint,
  } = options;

  const timer = await timerP;

  /**
   * @typedef {(a: number, b: number) => boolean} Operator
   */

  /** @type {Operator} */
  const isGTE = (a, b) => a >= b;
  /** @type {Operator} */
  const isGT = (a, b) => a > b;
  /** @type {Operator} */
  const isLTE = (a, b) => a <= b;
  /** @type {Operator} */
  const isLT = (a, b) => a < b;

  /**
   * @typedef {Object} Trigger
   * @property {Operator} operator
   * @property {ValueIn} valueIn
   * @property {ValueOut} valueOutLimit
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
   * @param {ValueIn} valueIn
   * @param {ValueOut} valueOut
   * @param {Timestamp} quoteTime
   * @returns {PriceQuote}
   */
  const makeQuote = (valueIn, valueOut, quoteTime) => {
    const quoteAmount = quoteMath.make(
      harden([
        {
          amountIn: mathIn.make(valueIn),
          amountOut: mathOut.make(valueOut),
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

  /** @type {PriceQuote} */
  let latestQuote;

  /** @type {ValueIn} */
  let latestValueIn;

  /** @type {ValueOut} */
  let latestValueOut;

  /**
   * See which triggers have fired.
   *
   * @param {Timestamp} timestamp
   */
  const checkTriggers = timestamp => {
    let i = 0;
    while (i < triggerQueue.length) {
      const { valueIn, operator, resolve, valueOutLimit } = triggerQueue[i];
      const valueOut = natSafeMath.floorDivide(
        natSafeMath.multiply(valueIn, latestValueOut),
        latestValueIn,
      );

      if (operator(valueOut, valueOutLimit)) {
        // Fire the trigger!
        triggerQueue.splice(i, 1);
        resolve(makeQuote(valueIn, valueOut, timestamp));
      } else {
        i += 1;
      }
    }
  };

  /** Update from the latest quote. */
  updateFromIterable(
    {
      async finish(_ignore) {
        updater.finish(latestQuote);
      },
      fail(reason) {
        if (latestQuote) {
          // We don't fail the updater, just finish with the latest state.
          updater.finish(latestQuote);
        }
        // Failed to produce any values.
        updater.fail(reason);
      },
      updateState({ timestamp, item: [valueIn, valueOut] }) {
        latestQuote = makeQuote(valueIn, valueOut, timestamp);
        latestValueIn = valueIn;
        latestValueOut = valueOut;
        updater.updateState(latestQuote);

        // Check the triggers with the new quote.
        checkTriggers(timestamp);
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
    const valueIn = mathIn.getValue(amountIn);
    const valueOut = natSafeMath.floorDivide(
      natSafeMath.multiply(amountIn.value, latestValueOut),
      latestValueIn,
    );
    return makeQuote(valueIn, valueOut, quoteTime);
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
    const valueOut = mathOut.getValue(amountOut);
    const valueIn = natSafeMath.ceilDivide(
      natSafeMath.multiply(valueOut, latestValueIn),
      latestValueOut,
    );
    return quoteGivenAtMost(mathIn.make(valueIn), amountOut.brand, quoteTime);
  }

  function resolveQuoteWhen(operator, amountIn, amountOutLimit) {
    assertBrands(amountIn.brand, amountOutLimit.brand);
    const promiseKit = makePromiseKit();
    triggerQueue.push({
      operator,
      valueIn: mathIn.getValue(amountIn),
      valueOutLimit: mathOut.getValue(amountOutLimit),
      resolve: promiseKit.resolve,
    });
    return promiseKit.promise;
  }

  const getLatestTimestamp = async () => {
    // Get the first price quote, waiting for it to
    // be published if it hasn't been already.
    const priceQuote = await notifier.getUpdateSince();
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

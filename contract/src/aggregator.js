// @ts-check
import { E } from '@agoric/eventual-send';
import { makeNotifierKit } from '@agoric/notifier';
import makeStore from '@agoric/store';
import { assert, details } from '@agoric/assert';
import { makePromiseKit } from '@agoric/promise-kit';
import { natSafeMath } from '@agoric/zoe/src/contractSupport';

import '@agoric/zoe/exported';
import './types';

/**
 * @callback TriggerWhen
 * @param {AmountMath} math
 * @param {Amount} amount
 * @param {Amount} amountLimit
 * @returns {boolean}
 */

/**
 * @typedef {Object} AmountOutTrigger
 * @property {Amount} amountIn
 * @property {Amount} amountOutLimit amountIn.value * baseValueOut / baseValueIn
 * @property {TriggerWhen} triggerWhen
 * @property {(result: ERef<PriceQuote>) => void} resolve
 * @property {(reason: any) => void} reject
 */

/**
 * This contract aggregates price values from a set of oracles and provides a
 * PriceAuthority for their median.
 *
 * @type {ContractStartFn}
 *
 */
const start = async zcf => {
  const {
    timer: rawTimer,
    POLL_INTERVAL,
    brands: { In: aggBrandIn, Out: aggBrandOut },
    maths: { In: mathIn, Out: mathOut },
    baseAmountIn = mathIn.make(1),
  } = zcf.getTerms();

  const baseValueIn = mathIn.getValue(baseAmountIn);

  /** @type {TimerService} */
  const timer = rawTimer;

  const { add, multiply, floorDivide } = natSafeMath;

  /** @type {IssuerRecord & { mint: ERef<Mint> }} */
  let quoteKit;

  /** @type {TriggerWhen} */
  const whenLT = (math, amountOut, amountLimit) =>
    !math.isGTE(amountOut, amountLimit);

  /** @type {TriggerWhen} */
  const whenLTE = (math, amount, amountLimit) =>
    math.isGTE(amountLimit, amount);

  /** @type {TriggerWhen} */
  const whenGTE = (math, amount, amountLimit) =>
    math.isGTE(amount, amountLimit);

  /** @type {TriggerWhen} */
  const whenGT = (math, amount, amountLimit) =>
    !math.isGTE(amountLimit, amount);

  /**
   *
   * @param {PriceQuoteValue} quote
   */
  const authenticateQuote = async quote => {
    const quoteAmount = quoteKit.amountMath.make(harden(quote));
    const quotePayment = await E(quoteKit.mint).mintPayment(quoteAmount);
    return harden({ quoteAmount, quotePayment });
  };

  const { notifier, updater } = makeNotifierKit();
  const zoe = zcf.getZoeService();

  /**
   * @typedef {Object} OracleRecord
   * @property {(timestamp: Timestamp) => void} querier
   * @property {number} lastSample
   */
  /** @type {Store<Instance, OracleRecord>} */
  const instanceToRecord = makeStore('oracleInstance');

  let recentTimestamp = await E(timer).getCurrentTimestamp();

  /** @type {PriceDescription} */
  let baseQuote;

  const ensureBaseQuote = async () => {
    await notifier.getUpdateSince();
    assert(baseQuote, details`Could not find a recent quote`);
  };

  /** @type {Array<AmountOutTrigger>} */
  let outTriggers = [];

  /**
   * @param {number} timestamp
   */
  const fireTriggers = timestamp => {
    if (!baseQuote) {
      // No quote yet.
      return;
    }

    const baseValueOut = mathOut.getValue(baseQuote.amountOut);

    /**
     * Make a filter function that also fires triggers.
     * @param {AmountOutTrigger} trigger
     * @returns {boolean}
     */
    const firingFilter = trigger => {
      const {
        amountIn,
        amountOutLimit,
        triggerWhen: triggerCondition,
        resolve,
        reject,
      } = trigger;
      try {
        const valueIn = mathIn.getValue(amountIn);
        const amountOut = mathOut.make((valueIn * baseValueOut) / baseValueIn);

        if (!triggerCondition(mathOut, amountOut, amountOutLimit)) {
          // Keep the trigger and don't fire.
          return true;
        }

        // Fire the trigger, then drop it from the pending list.
        resolve(
          authenticateQuote([
            {
              amountIn,
              amountOut,
              timer,
              timestamp,
            },
          ]),
        );
        return false;
      } catch (e) {
        // Trigger failed, so reject and drop.
        reject(e);
        return false;
      }
    };

    outTriggers = outTriggers.filter(firingFilter);
  };

  /**
   * @param {Amount} amountIn
   * @param {TriggerWhen} triggerCondition
   * @param {Amount} amountOutLimit
   */
  const insertOutTrigger = async (
    amountIn,
    triggerCondition,
    amountOutLimit,
  ) => {
    mathOut.coerce(amountOutLimit);
    mathIn.coerce(amountIn);

    /** @type {PromiseRecord<PriceQuote>} */
    const triggerPK = makePromiseKit();

    /** @type {AmountOutTrigger} */
    const newTrigger = {
      amountIn,
      triggerWhen: triggerCondition,
      amountOutLimit,
      resolve: triggerPK.resolve,
      reject: triggerPK.reject,
    };

    outTriggers.push(newTrigger);

    // See if this trigger needs to fire.
    const timestamp = await E(timer).getCurrentTimestamp();
    fireTriggers(timestamp);

    return triggerPK.promise;
  };

  // Wake every POLL_INTERVAL and run the queriers.
  const repeaterP = E(timer).createRepeater(0, POLL_INTERVAL);
  /** @type {TimerServiceHandler} */
  const handler = {
    async wake(timestamp) {
      // Run all the queriers.
      const querierPs = instanceToRecord
        .values()
        .map(({ querier }) => querier && querier(timestamp));
      await Promise.all(querierPs);
    },
  };
  E(repeaterP).schedule(handler);

  /**
   * @param {Timestamp} timestamp
   */
  const updateQuote = async timestamp => {
    const sorted = instanceToRecord
      .values() // Find all the instance records.
      .map(({ lastSample }) => lastSample) // Get the last sample.
      .filter(value => value > 0) // Only allow positive samples.
      .sort((a, b) => a - b); // Sort ascending.
    if (sorted.length === 0) {
      // No valid samples, don't report anything.
      return;
    }
    let median;
    if (sorted.length % 2 === 0) {
      // Even length, take the mean of the two middle values.
      const secondIndex = floorDivide(sorted.length, 2);
      const sum = add(sorted[secondIndex - 1], sorted[secondIndex]);

      // Find the ceiling, since we deal with natural numbers.
      median = floorDivide(sum, 2);
    } else {
      median = sorted[floorDivide(sorted.length - 1, 2)];
    }

    // console.error('found median', median, 'of', sorted);
    const amountOut = mathOut.make(median);

    /** @type {PriceDescription} */
    const quote = {
      amountIn: baseAmountIn,
      amountOut,
      timer,
      timestamp,
    };

    // Authenticate the quote by minting it with our quote issuer, then publish.
    const authenticatedQuote = await authenticateQuote([quote]);

    // Fire any triggers now; we don't care if the timestamp is fully ordered,
    // only if the limit has been met.
    fireTriggers(timestamp);

    if (timestamp < recentTimestamp) {
      // A more recent timestamp has been published already, so we are too late.
      return;
    }

    // Publish a new authenticated quote.
    recentTimestamp = timestamp;
    baseQuote = quote;
    updater.updateState(authenticatedQuote);
  };

  /** @type {AggregatorCreatorFacet} */
  const creatorFacet = harden({
    async initializeQuoteMint(quoteMint) {
      const quoteIssuerRecord = await zcf.saveIssuer(
        E(quoteMint).getIssuer(),
        'Quote',
      );
      quoteKit = {
        ...quoteIssuerRecord,
        mint: quoteMint,
      };
    },
    async addOracle(oracleInstance, query) {
      assert(
        quoteKit,
        details`Must initializeQuoteMint before adding an oracle`,
      );

      // Register our record.
      const record = { querier: undefined, lastSample: NaN };
      instanceToRecord.init(oracleInstance, record);

      // Obtain the oracle's publicFacet and schedule the repeater in the background.
      const oracle = await E(zoe).getPublicFacet(oracleInstance);
      if (!instanceToRecord.has(oracleInstance)) {
        // We were dropped already, no harm done.
        return;
      }

      let lastWakeTimestamp = 0;

      /**
       * @param {Timestamp} timestamp
       */
      record.querier = async timestamp => {
        // Submit the query.
        const result = await E(oracle).query(query);
        // Now that we've received the result, check if we're out of date.
        if (
          timestamp < lastWakeTimestamp ||
          !instanceToRecord.has(oracleInstance)
        ) {
          return;
        }
        lastWakeTimestamp = timestamp;

        // Sample of NaN, 0, or negative numbers are valid, they get culled in
        // the median calculation.
        const sample = parseInt(result, 10);
        record.lastSample = sample;
        await updateQuote(timestamp);
      };
      const now = await E(timer).getCurrentTimestamp();
      await record.querier(now);
    },
    async dropOracle(oracleInstance) {
      // Just remove the map entries.
      instanceToRecord.delete(oracleInstance);
      const now = await E(timer).getCurrentTimestamp();
      await updateQuote(now);
    },
  });

  /**
   * Ensure that the brandIn/brandOut pair is supported.
   *
   * @param {Brand} brandIn
   * @param {Brand} brandOut
   */
  const assertBrands = (brandIn, brandOut) => {
    assert.equal(
      brandIn,
      aggBrandIn,
      details`Desired brandIn ${brandIn} must match ${aggBrandIn}`,
    );
    assert.equal(
      brandOut,
      aggBrandOut,
      details`Desired brandOut ${brandOut} must match ${aggBrandOut}`,
    );
  };

  /** @type {PriceAuthority} */
  const priceAuthority = {
    getQuoteIssuer(brandIn, brandOut) {
      assertBrands(brandIn, brandOut);
      return quoteKit.issuer;
    },
    getTimerService(brandIn, brandOut) {
      assertBrands(brandIn, brandOut);
      return timer;
    },
    getPriceNotifier(brandIn, brandOut) {
      assertBrands(brandIn, brandOut);
      return notifier;
    },
    async quoteGiven(amountIn, brandOut) {
      mathIn.coerce(amountIn);
      assertBrands(amountIn.brand, brandOut);

      // Ensure we have at least one quote.
      await ensureBaseQuote();

      const valueIn = mathIn.getValue(amountIn);
      const baseValueOut = mathOut.getValue(baseQuote.amountOut);

      const amountOut = mathOut.make(valueIn * baseValueOut);
      return authenticateQuote([
        {
          ...baseQuote,
          amountIn,
          amountOut,
        },
      ]);
    },
    async quoteWanted(brandIn, amountOut) {
      mathOut.coerce(amountOut);
      assertBrands(brandIn, amountOut.brand);

      // Ensure we have at least one quote.
      await ensureBaseQuote();

      const valueOut = mathOut.getValue(amountOut);
      const baseValueOut = mathOut.getValue(baseQuote.amountOut);

      const amountIn = mathIn.make(
        floorDivide(multiply(valueOut, baseValueIn), baseValueOut),
      );
      return authenticateQuote([
        {
          ...baseQuote,
          amountIn,
          amountOut,
        },
      ]);
    },
    async quoteAtTime(deadline, amountIn, brandOut) {
      mathIn.coerce(amountIn);
      assertBrands(amountIn.brand, brandOut);

      // Ensure we have at least one quote.
      await ensureBaseQuote();

      const valueIn = mathIn.getValue(amountIn);
      const quotePK = makePromiseKit();
      await E(timer).setWakeup(
        deadline,
        harden({
          async wake(timestamp) {
            try {
              const baseValueOut = mathOut.getValue(baseQuote.amountOut);
              const amountOut = mathOut.make(
                floorDivide(multiply(valueIn, baseValueOut), baseValueIn),
              );

              // We don't wait for the quote to be authenticated; resolve
              // immediately.
              quotePK.resolve(
                authenticateQuote([
                  {
                    amountIn,
                    amountOut,
                    timer,
                    timestamp,
                  },
                ]),
              );
            } catch (e) {
              quotePK.reject(e);
            }
          },
        }),
      );

      // Wait until the wakeup passes.
      return quotePK.promise;
    },
    async quoteWhenGT(amountIn, amountOutLimit) {
      return insertOutTrigger(amountIn, whenGT, amountOutLimit);
    },
    async quoteWhenGTE(amountIn, amountOutLimit) {
      return insertOutTrigger(amountIn, whenGTE, amountOutLimit);
    },
    async quoteWhenLTE(amountIn, amountOutLimit) {
      return insertOutTrigger(amountIn, whenLTE, amountOutLimit);
    },
    async quoteWhenLT(amountIn, amountOutLimit) {
      return insertOutTrigger(amountIn, whenLT, amountOutLimit);
    },
  };
  harden(priceAuthority);

  const publicFacet = {
    getPriceAuthority() {
      return priceAuthority;
    },
  };

  return harden({ creatorFacet, publicFacet });
};

export { start };

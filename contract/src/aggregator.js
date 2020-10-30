// @ts-check
import '@agoric/zoe/exported';

import { E } from '@agoric/eventual-send';
import { makeNotifierKit } from '@agoric/notifier';
import makeStore from '@agoric/store';
import { assert, details } from '@agoric/assert';
import { makePromiseKit } from '@agoric/promise-kit';

import './types';

/**
 * @typedef {(amountOut: Amount, amountOutLimit: Amount) => boolean} TriggerCondition
 */

/**
 * @typedef {Object} PriceTrigger
 * @property {Amount} amountIn expressed in terms of Asset
 * @property {Amount} amountOutLimit expressed in terms of Asset.value*Price
 * @property {TriggerCondition} triggerCondition
 * @property {(result: ERef<PriceQuote>) => void} resolve
 * @property {(reason: any) => void} reject
 */

/**
 * This contract provides oracle queries for a fee or for pay.
 *
 * @type {ContractStartFn}
 *
 */
const start = async zcf => {
  const {
    timer: rawTimer,
    POLL_INTERVAL,
    brands: { Asset: assetBrand, Price: priceBrand },
    maths: { Asset: assetMath, Price: priceMath },
  } = zcf.getTerms();

  /** @type {TimerService} */
  const timer = rawTimer;

  /** @type {IssuerRecord & { mint: ERef<Mint> }} */
  let aggregatorQuoteKit;

  const unitAsset = assetMath.make(1);

  /** @type {TriggerCondition} */
  const priceLT = (price, priceLimit) => !priceMath.isGTE(price, priceLimit);

  /** @type {TriggerCondition} */
  const priceLTE = (price, priceLimit) => priceMath.isGTE(priceLimit, price);

  /** @type {TriggerCondition} */
  const priceGTE = (price, priceLimit) => priceMath.isGTE(price, priceLimit);

  /** @type {TriggerCondition} */
  const priceGT = (price, priceLimit) => !priceMath.isGTE(priceLimit, price);

  /**
   *
   * @param {PriceQuoteValue} quote
   */
  const authenticateQuote = async quote => {
    const quoteAmount = aggregatorQuoteKit.amountMath.make(harden(quote));
    const quotePayment = await E(aggregatorQuoteKit.mint).mintPayment(
      quoteAmount,
    );
    return harden({ quoteAmount, quotePayment });
  };

  const { notifier, updater } = makeNotifierKit();
  const zoe = zcf.getZoeService();

  /** @type {Store<Instance, { querier: (timestamp: number) => void, lastSample: number }>} */
  const instanceToRecord = makeStore('oracleInstance');

  let recentTimestamp = await E(timer).getCurrentTimestamp();

  /** @type {PriceDescription} */
  let recentUnitQuote;

  const ensureRecentUnitQuote = async () => {
    await notifier.getUpdateSince();
    assert(recentUnitQuote, details`Could not find a recent quote`);
  };

  /** @type {Array<PriceTrigger>} */
  let pendingTriggers = [];

  /**
   * @param {number} timestamp
   */
  const fireTriggers = timestamp => {
    if (!recentUnitQuote) {
      // No quote yet.
      return;
    }

    const recentUnitPriceValue = priceMath.getValue(recentUnitQuote.amountOut);

    /**
     * Make a filter function that also fires triggers.
     * @param {PriceTrigger} trigger
     * @returns {boolean}
     */
    const firingFilter = trigger => {
      const {
        amountIn,
        amountOutLimit,
        triggerCondition,
        resolve,
        reject,
      } = trigger;
      try {
        const assetValue = assetMath.getValue(amountIn);
        const amountOut = priceMath.make(assetValue * recentUnitPriceValue);

        if (!triggerCondition(amountOut, amountOutLimit)) {
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

    pendingTriggers = pendingTriggers.filter(firingFilter);
  };

  /**
   * @param {Amount} amountIn
   * @param {Amount} amountOutLimit
   * @param {TriggerCondition} triggerCondition
   */
  const insertTrigger = async (amountIn, triggerCondition, amountOutLimit) => {
    priceMath.coerce(amountOutLimit);
    assetMath.coerce(amountIn);

    const triggerPK = makePromiseKit();
    /** @type {PriceTrigger} */
    const newTrigger = {
      amountIn,
      triggerCondition,
      amountOutLimit,
      resolve: triggerPK.resolve,
      reject: triggerPK.reject,
    };

    pendingTriggers.push(newTrigger);

    // See if this trigger needs to fire.
    const timestamp = await E(timer).getCurrentTimestamp();
    fireTriggers(timestamp);

    return triggerPK.promise;
  };

  const repeaterP = E(timer).createRepeater(0, POLL_INTERVAL);
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
      // Even length, average the two middle values.
      const secondIndex = sorted.length / 2;
      const sum = sorted[secondIndex - 1] + sorted[secondIndex];

      // Find the ceiling, since we deal with natural numbers.
      median = Math.ceil(sum / 2);
    } else {
      median = sorted[(sorted.length - 1) / 2];
    }

    // console.error('found median', median, 'of', sorted);
    const amountOut = priceMath.make(median);

    /** @type {PriceDescription} */
    const quote = {
      amountIn: unitAsset,
      amountOut,
      timer,
      timestamp: recentTimestamp,
    };

    // Authenticate the quote by minting it with our quote issuer, then publish.
    const authenticatedQuote = await authenticateQuote([quote]);

    // Fire any price triggers now; we don't care if the timestamp is fully
    // ordered, only if the limit has been met.
    fireTriggers(timestamp);

    if (timestamp < recentTimestamp) {
      // Too late to publish.
      return;
    }

    // Publish a new authenticated quote.
    recentTimestamp = timestamp;
    recentUnitQuote = quote;
    updater.updateState(authenticatedQuote);
  };

  /** @type {AggregatorCreatorFacet} */
  const creatorFacet = harden({
    async initializeQuoteMint(quoteMint) {
      const quoteIssuerRecord = await zcf.saveIssuer(
        E(quoteMint).getIssuer(),
        'Quote',
      );
      aggregatorQuoteKit = {
        ...quoteIssuerRecord,
        mint: quoteMint,
      };
    },
    async addOracle(oracleInstance, query) {
      assert(
        aggregatorQuoteKit,
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

  /** @type {PriceAuthority} */
  const priceAuthority = {
    getQuoteIssuer() {
      return aggregatorQuoteKit.issuer;
    },
    getTimerService(brandIn, brandOut) {
      assert.equal(
        brandIn,
        assetBrand,
        details`Desired brandIn ${brandIn} must match ${assetBrand}`,
      );
      assert.equal(
        brandOut,
        priceBrand,
        details`Desired brandOut ${brandOut} must match ${priceBrand}`,
      );
      return timer;
    },
    getPriceNotifier(brandIn, brandOut) {
      assert.equal(
        brandIn,
        assetBrand,
        details`Desired brandIn ${brandIn} must match ${assetBrand}`,
      );
      assert.equal(
        brandOut,
        priceBrand,
        details`Desired brandOut ${brandOut} must match ${priceBrand}`,
      );
      return notifier;
    },
    async quoteGiven(amountIn, brandOut) {
      assetMath.coerce(amountIn);
      assert.equal(
        brandOut,
        priceBrand,
        details`Output brand ${brandOut} must match ${priceBrand}`,
      );

      // Ensure we have at least one quote.
      await ensureRecentUnitQuote();

      const assetValue = assetMath.getValue(amountIn);
      const recentUnitPriceValue = priceMath.getValue(
        recentUnitQuote.amountOut,
      );

      const amountOut = priceMath.make(assetValue * recentUnitPriceValue);
      return authenticateQuote([
        {
          ...recentUnitQuote,
          amountIn,
          amountOut,
        },
      ]);
    },
    async quoteWanted(brandIn, amountOut) {
      priceMath.coerce(amountOut);
      assert.equal(
        assetBrand,
        brandIn,
        details`Input brand ${brandIn} must match ${assetBrand}`,
      );

      // Ensure we have at least one quote.
      await ensureRecentUnitQuote();

      const amountOutValue = priceMath.getValue(amountOut);
      const recentUnitPriceValue = priceMath.getValue(
        recentUnitQuote.amountOut,
      );

      const amountIn = assetMath.make(
        Math.ceil(amountOutValue / recentUnitPriceValue),
      );
      return authenticateQuote([
        {
          ...recentUnitQuote,
          amountIn,
          amountOut,
        },
      ]);
    },
    async quoteAtTime(deadline, amountIn, desiredPriceBrand) {
      assetMath.coerce(amountIn);
      assert.equal(priceBrand, desiredPriceBrand);

      // Ensure we have at least one quote.
      await ensureRecentUnitQuote();

      const assetValue = assetMath.getValue(amountIn);
      const quotePK = makePromiseKit();
      await E(timer).setWakeup(
        deadline,
        harden({
          async wake(timestamp) {
            try {
              const recentUnitPriceValue = priceMath.getValue(
                recentUnitQuote.amountOut,
              );
              const amountOut = priceMath.make(
                assetValue * recentUnitPriceValue,
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
      return insertTrigger(amountIn, priceGT, amountOutLimit);
    },
    async quoteWhenGTE(amountIn, amountOutLimit) {
      return insertTrigger(amountIn, priceGTE, amountOutLimit);
    },
    async quoteWhenLTE(amountIn, amountOutLimit) {
      return insertTrigger(amountIn, priceLTE, amountOutLimit);
    },
    async quoteWhenLT(amountIn, amountOutLimit) {
      return insertTrigger(amountIn, priceLT, amountOutLimit);
    },
  };
  harden(priceAuthority);

  const publicFacet = harden({
    getPriceAuthority() {
      return priceAuthority;
    },
  });

  return { creatorFacet, publicFacet };
};

export { start };

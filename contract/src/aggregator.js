// @ts-check
import '@agoric/zoe/exported';

import { E } from '@agoric/eventual-send';
import { makeNotifierKit } from '@agoric/notifier';
import makeStore from '@agoric/store';
import { assert, details } from '@agoric/assert';
import { makePromiseKit } from '@agoric/promise-kit';

import './types';

/**
 * @typedef {(price: Amount, priceLimit: Amount) => boolean} TriggerCondition
 */

/**
 * @typedef {Object} PriceTrigger
 * @property {Amount} assetAmount expressed in terms of Asset
 * @property {Amount} priceLimit expressed in terms of Asset.value*Price
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
    timer: oracleTimer,
    POLL_INTERVAL,
    brands: { Asset: assetBrand, Price: priceBrand },
    maths: { Asset: assetMath, Price: priceMath },
  } = zcf.getTerms();

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
    const quoteAmount = aggregatorQuoteKit.amountMath.make(harden([quote]));
    const quotePayment = await E(aggregatorQuoteKit.mint).mintPayment(
      quoteAmount,
    );
    return harden({ quoteAmount, quotePayment });
  };

  const { notifier, updater } = makeNotifierKit();
  const zoe = zcf.getZoeService();

  /** @type {Store<Instance, { querier: (timestamp: number) => void, lastSample: number }>} */
  const instanceToRecord = makeStore('oracleInstance');

  let recentTimestamp = await E(oracleTimer).getCurrentTimestamp();

  /** @type {PriceQuoteValue} */
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

    const recentUnitPriceValue = priceMath.getValue(recentUnitQuote.price);

    /**
     * Make a filter function that also fires triggers.
     * @param {PriceTrigger} trigger
     * @returns {boolean}
     */
    const firingFilter = trigger => {
      const {
        assetAmount,
        priceLimit,
        triggerCondition,
        resolve,
        reject,
      } = trigger;
      try {
        const assetValue = assetMath.getValue(assetAmount);
        const price = priceMath.make(assetValue * recentUnitPriceValue);

        if (!triggerCondition(price, priceLimit)) {
          // Keep the trigger and don't fire.
          return true;
        }

        // Fire the trigger, then drop it from the pending list.
        resolve(
          authenticateQuote({
            assetAmount,
            price,
            timer: oracleTimer,
            timestamp,
          }),
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
   * @param {Amount} priceLimit
   * @param {TriggerCondition} triggerCondition
   * @param {Amount} assetAmount
   */
  const insertTrigger = async (assetAmount, triggerCondition, priceLimit) => {
    priceMath.coerce(priceLimit);
    assetMath.coerce(assetAmount);

    const triggerPK = makePromiseKit();
    /** @type {PriceTrigger} */
    const newTrigger = {
      assetAmount,
      triggerCondition,
      priceLimit,
      resolve: triggerPK.resolve,
      reject: triggerPK.reject,
    };

    pendingTriggers.push(newTrigger);

    // See if this trigger needs to fire.
    const timestamp = await E(oracleTimer).getCurrentTimestamp();
    fireTriggers(timestamp);

    return triggerPK.promise;
  };

  const repeaterP = E(oracleTimer).createRepeater(0, POLL_INTERVAL);
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
    const price = priceMath.make(median);
    const quote = {
      assetAmount: unitAsset,
      price,
      timer: oracleTimer,
      timestamp: recentTimestamp,
    };

    // Authenticate the quote by minting it with our quote issuer, then publish.
    const authenticatedQuote = await authenticateQuote(quote);

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
      const now = await E(oracleTimer).getCurrentTimestamp();
      await record.querier(now);
    },
    async dropOracle(oracleInstance) {
      // Just remove the map entries.
      instanceToRecord.delete(oracleInstance);
      const now = await E(oracleTimer).getCurrentTimestamp();
      await updateQuote(now);
    },
  });

  /** @type {PriceAuthority} */
  const priceAuthority = {
    getQuoteIssuer() {
      return aggregatorQuoteKit.issuer;
    },
    getPriceNotifier(desiredAssetBrand, desiredPriceBrand) {
      assert.equal(
        desiredAssetBrand,
        assetBrand,
        details`Desired brand ${desiredPriceBrand} must match ${priceBrand}`,
      );
      assert.equal(
        desiredPriceBrand,
        priceBrand,
        details`Desired brand ${desiredPriceBrand} must match ${priceBrand}`,
      );
      return notifier;
    },
    async getInputPrice(amountIn, brandOut = priceBrand) {
      assetMath.coerce(amountIn);
      assert.equal(
        priceBrand,
        brandOut,
        details`Output brand ${brandOut} must match ${priceBrand}`,
      );

      // Ensure we have at least one quote.
      await ensureRecentUnitQuote();

      const assetValue = assetMath.getValue(amountIn);
      const recentUnitPriceValue = priceMath.getValue(recentUnitQuote.price);

      const price = priceMath.make(assetValue * recentUnitPriceValue);
      return authenticateQuote({
        ...recentUnitQuote,
        assetAmount: amountIn,
        price,
      });
    },
    async getOutputPrice(amountOut, brandIn = assetBrand) {
      priceMath.coerce(amountOut);
      assert.equal(
        assetBrand,
        brandIn,
        details`Input brand ${brandIn} must match ${assetBrand}`,
      );

      // Ensure we have at least one quote.
      await ensureRecentUnitQuote();

      const priceValue = priceMath.getValue(amountOut);
      const recentUnitPriceValue = priceMath.getValue(recentUnitQuote.price);

      const assetAmount = assetMath.make(
        Math.ceil(priceValue / recentUnitPriceValue),
      );
      return authenticateQuote({
        ...recentUnitQuote,
        assetAmount,
        price: amountOut,
      });
    },
    async priceAtTime(
      userTimer,
      deadline,
      assetAmount,
      desiredPriceBrand = priceBrand,
    ) {
      assetMath.coerce(assetAmount);
      assert.equal(priceBrand, desiredPriceBrand);

      // Ensure we have at least one quote.
      await ensureRecentUnitQuote();

      const assetValue = assetMath.getValue(assetAmount);
      const quotePK = makePromiseKit();
      await E(userTimer).setWakeup(
        deadline,
        harden({
          async wake(timestamp) {
            try {
              const recentUnitPriceValue = priceMath.getValue(
                recentUnitQuote.price,
              );
              const price = priceMath.make(assetValue * recentUnitPriceValue);

              // We don't wait for the quote to be authenticated; resolve
              // immediately.
              quotePK.resolve(
                authenticateQuote({
                  assetAmount,
                  price,
                  timer: userTimer,
                  timestamp,
                }),
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
    async priceWhenGT(assetAmount, priceLimit) {
      return insertTrigger(assetAmount, priceGT, priceLimit);
    },
    async priceWhenGTE(assetAmount, priceLimit) {
      return insertTrigger(assetAmount, priceGTE, priceLimit);
    },
    async priceWhenLTE(assetAmount, priceLimit) {
      return insertTrigger(assetAmount, priceLTE, priceLimit);
    },
    async priceWhenLT(assetAmount, priceLimit) {
      return insertTrigger(assetAmount, priceLT, priceLimit);
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

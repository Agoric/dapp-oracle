// @ts-check
import '@agoric/zoe/exported';

import { E } from '@agoric/eventual-send';
import { makeNotifierKit } from '@agoric/notifier';
import makeStore from '@agoric/store';
import { assert, details } from '@agoric/assert';
import { makePromiseKit } from '@agoric/promise-kit';

import './types';

/**
 * @typedef {Object} PriceTrigger
 * @property {Amount} asset expressed in terms of Asset
 * @property {Amount} limit expressed in terms of Asset.value*Price
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
    brands: { Price: priceBrand },
    maths: { Asset: assetMath, Price: priceMath },
  } = zcf.getTerms();

  const unitAsset = assetMath.make(1);

  /** @type {IssuerRecord & { mint: ERef<Mint> }} */
  let aggregatorQuoteKit;

  /**
   *
   * @param {PriceQuoteValue} quote
   */
  const authenticateQuote = async quote => {
    const quoteAmount = aggregatorQuoteKit.amountMath.make(harden([quote]));
    return E(aggregatorQuoteKit.mint).mintPayment(quoteAmount);
  };

  const { notifier, updater } = makeNotifierKit();
  const zoe = zcf.getZoeService();

  /** @type {Store<Instance, { querier: (timestamp: number) => void, lastSample: number }>} */
  const instanceToRecord = makeStore('oracleInstance');

  let recentTimestamp = await E(oracleTimer).getCurrentTimestamp();

  /** @type {PriceQuoteValue} */
  let recentUnitQuote;

  /** @type {Array<PriceTrigger>} */
  let pendingAboveTriggers = [];
  /** @type {Array<PriceTrigger>} */
  let pendingBelowTriggers = [];

  /**
   * @param {number} timestamp
   */
  const fireTriggers = timestamp => {
    if (!recentUnitQuote) {
      // No quote yet.
      return;
    }

    const recentUnitPriceValue = priceMath.getValue(recentUnitQuote.Price);

    /**
     * Make a filter function that also fires triggers.
     * @param {boolean} fireIfAboveLimit true iff we should fire above,
     * otherwise below
     * @returns {(trigger: PriceTrigger) => boolean}
     */
    const makeFiringFilter = fireIfAboveLimit => trigger => {
      const { asset: Asset, limit, resolve, reject } = trigger;
      try {
        const assetValue = assetMath.getValue(Asset);
        const Price = priceMath.make(assetValue * recentUnitPriceValue);

        if (fireIfAboveLimit) {
          // Firing if above but ...
          if (!priceMath.isGTE(Price, limit)) {
            // ... it's below the limit, so keep the trigger and don't fire.
            return true;
          }
        } else if (priceMath.isGTE(Price, limit)) {
          // Firing if below but...
          // ... it's above the limit, so keep the trigger and don't fire.
          return true;
        }

        // Fire the trigger, then drop it from the pending list.
        resolve(
          authenticateQuote({ Asset, Price, timer: oracleTimer, timestamp }),
        );
        return false;
      } catch (e) {
        // Trigger failed, so reject and drop.
        reject(e);
        return false;
      }
    };

    pendingAboveTriggers = pendingAboveTriggers.filter(makeFiringFilter(true));
    pendingBelowTriggers = pendingBelowTriggers.filter(makeFiringFilter(false));
  };

  /**
   *
   * @param {Array<PriceTrigger>} triggers
   * @param {Amount} priceLimit
   * @param {Amount} assetAmount
   */
  const insertTrigger = async (triggers, priceLimit, assetAmount) => {
    const triggerPK = makePromiseKit();
    /** @type {PriceTrigger} */
    const newTrigger = {
      asset: assetAmount,
      limit: priceLimit,
      resolve: triggerPK.resolve,
      reject: triggerPK.reject,
    };

    triggers.push(newTrigger);

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
    const Price = priceMath.make(median);
    const quote = {
      Asset: unitAsset,
      Price,
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

  /** @type {AggregatorPublicFacet} */
  const publicFacet = harden({
    getPriceNotifier(desiredPriceBrand = priceBrand) {
      assert.equal(
        priceBrand,
        desiredPriceBrand,
        details`Desired brand ${desiredPriceBrand} must match ${priceBrand}`,
      );
      return notifier;
    },
    async priceAtTime(
      userTimer,
      deadline,
      desiredPriceBrand = priceBrand,
      Asset = unitAsset,
    ) {
      assert.equal(priceBrand, desiredPriceBrand);
      const assetValue = assetMath.getValue(Asset);
      const quotePK = makePromiseKit();
      await E(userTimer).setWakeup(
        deadline,
        harden({
          async wake(timestamp) {
            try {
              // Get the latest quote.
              if (!recentUnitQuote) {
                throw Error(`No valid price quote at ${timestamp}`);
              }
              const recentUnitPriceValue = priceMath.getValue(
                recentUnitQuote.Price,
              );
              const Price = priceMath.make(assetValue * recentUnitPriceValue);

              // We don't wait for the quote to be authenticated; resolve
              // immediately.
              quotePK.resolve(
                authenticateQuote({
                  Asset,
                  Price,
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
    async priceWhenEqualOrAbove(priceLimit, assetAmount = unitAsset) {
      priceMath.coerce(priceLimit);
      return insertTrigger(pendingAboveTriggers, priceLimit, assetAmount);
    },
    async priceWhenBelow(priceLimit, assetAmount = unitAsset) {
      priceMath.coerce(priceLimit);
      return insertTrigger(pendingBelowTriggers, priceLimit, assetAmount);
    },
  });

  return { creatorFacet, publicFacet };
};

export { start };

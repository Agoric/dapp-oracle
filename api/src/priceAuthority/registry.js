// @ts-check

import { E } from '@agoric/eventual-send';
import { makeStore } from '@agoric/store';
import { assert, details } from '@agoric/assert';

import '@agoric/zoe/exported';

/**
 * @typedef {Object} Deleter
 * @property {() => void} delete
 */

/**
 * @typedef {Object} PriceAuthorityRegistryAdmin
 * @property {(pa: ERef<PriceAuthority>, brandIn: Brand, brandOut: Brand, force:
 * boolean | undefined)
 * => Deleter} registerPriceAuthority Add a unique price authority for a given
 * pair
 */

/**
 * @typedef {Object} PriceAuthorityRegistry A price authority that is a facade
 * for other backing price authorities registered for a given asset and price
 * brand
 * @property {PriceAuthority} priceAuthority
 * @property {PriceAuthorityRegistryAdmin} adminFacet
 */

/**
 * @returns {PriceAuthorityRegistry}
 */
export const makePriceAuthorityRegistry = () => {
  /**
   * @typedef {Object} PriceAuthorityRecord A record indicating a registered
   * price authority.  We put a box around the priceAuthority to ensure the
   * deleter doesn't delete the wrong thing.
   * @property {ERef<PriceAuthority>} priceAuthority the sub-authority for a
   * given input and output brand pair
   */

  /** @type {Store<Brand, Store<Brand, PriceAuthorityRecord>>} */
  const assetToPriceStore = makeStore('brandIn');

  /**
   * Get the registered price authority for a given input and output pair.
   *
   * @param {Brand} brandIn
   * @param {Brand} brandOut
   * @returns {ERef<PriceAuthority>}
   */
  const paFor = (brandIn, brandOut) => {
    const priceStore = assetToPriceStore.get(brandIn);
    return priceStore.get(brandOut).priceAuthority;
  };

  /**
   * Create a quoteWhen* method for the given condition.
   *
   * @param {'LT' | 'LTE' | 'GTE' | 'GT'} relation
   */
  const makeQuoteWhen = relation =>
    /**
     * Return a quote when relation is true of the arguments.
     *
     * @param {Amount} amountIn monitor the amountOut corresponding to this amountIn
     * @param {Amount} amountOutLimit the value to compare with the monitored amountOut
     * @returns {Promise<PriceQuote>} resolve with a quote when `amountOut
     * relation amountOutLimit` is true
     */
    async function quoteWhenRelation(amountIn, amountOutLimit) {
      const pa = paFor(amountIn.brand, amountOutLimit.brand);
      return E(pa)[`quoteWhen${relation}`](amountIn, amountOutLimit);
    };

  /**
   * This PriceAuthority is just a wrapper for multiple registered
   * PriceAuthorities.
   *
   * @type {PriceAuthority}
   */
  const priceAuthority = {
    async getQuoteIssuer(brandIn, brandOut) {
      return E(paFor(brandIn, brandOut)).getQuoteIssuer(brandIn, brandOut);
    },
    async getTimerService(brandIn, brandOut) {
      return E(paFor(brandIn, brandOut)).getTimerService(brandIn, brandOut);
    },
    async quoteGiven(amountIn, brandOut) {
      return E(paFor(amountIn.brand, brandOut)).quoteGiven(amountIn, brandOut);
    },
    async quoteWanted(brandIn, amountOut) {
      return E(paFor(brandIn, amountOut.brand)).quoteWanted(brandIn, amountOut);
    },
    async getQuoteNotifier(brandIn, brandOut) {
      return E(paFor(brandIn, brandOut)).getQuoteNotifier(brandIn, brandOut);
    },
    async quoteAtTime(deadline, amountIn, brandOut) {
      return E(paFor(amountIn.brand, brandOut)).quoteAtTime(
        deadline,
        amountIn,
        brandOut,
      );
    },
    quoteWhenLT: makeQuoteWhen('LT'),
    quoteWhenLTE: makeQuoteWhen('LTE'),
    quoteWhenGTE: makeQuoteWhen('GTE'),
    quoteWhenGT: makeQuoteWhen('GT'),
  };

  /** @type {PriceAuthorityRegistryAdmin} */
  const adminFacet = {
    registerPriceAuthority(pa, brandIn, brandOut, force = false) {
      /** @type {Store<Brand, PriceAuthorityRecord>} */
      let priceStore;
      if (assetToPriceStore.has(brandIn)) {
        priceStore = assetToPriceStore.get(brandIn);
      } else {
        priceStore = makeStore('brandOut');
        assetToPriceStore.init(brandIn, priceStore);
      }

      // Put a box around the authority so that we can be ensured the deleter
      // won't delete the wrong thing.
      const record = {
        priceAuthority: pa,
      };

      // Set up the record.
      if (force && priceStore.has(brandOut)) {
        priceStore.set(brandOut, harden(record));
      } else {
        priceStore.init(brandOut, harden(record));
      }

      return harden({
        delete() {
          assert.equal(
            priceStore.has(brandOut) && priceStore.get(brandOut),
            record,
            details`Price authority already dropped`,
          );
          priceStore.delete(brandOut);
        },
      });
    },
  };

  return harden({
    priceAuthority,
    adminFacet,
  });
};

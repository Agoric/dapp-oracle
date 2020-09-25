// @ts-check
import '@agoric/zoe/exported';
import { makePromiseKit } from '@agoric/promise-kit';
import makeWeakStore from '@agoric/weak-store';

import { assert, details } from '@agoric/assert';
import { E } from '@agoric/eventual-send';
import { withdrawFromSeat } from '@agoric/zoe/src/contractSupport';

import './types';

/**
 * @param {ContractFacet} zcf
 * @param {ZCFSeat} seat
 * @param {AmountKeywordRecord} amountKeywordRecord
 * @returns {boolean} true iff the seat's current allocation is at least amountKeywordRecord
 */
const seatHasAtLeast = (zcf, seat, amountKeywordRecord) => {
  for (const [keyword, amount] of Object.entries(amountKeywordRecord)) {
    const alloced = seat.getAmountAllocated(keyword, amount.brand);
    const amountMath = zcf.getAmountMath(amount.brand);
    if (alloced.brand !== amount.brand || !amountMath.isGTE(alloced, amount)) {
      return false;
    }
  }
  return true;
};

/**
 *
 * @param {ContractFacet} zcf
 * @param {ZCFSeat} seat
 * @param {AmountKeywordRecord} amountKeywordRecord
 * @returns {Promise<PaymentPKeywordRecord>}
 */
const withdrawAtMostFromSeat = (zcf, seat, amountKeywordRecord) => {
  /** @type {AmountKeywordRecord} */
  const maximumAmount = {};
  for (const [keyword, amount] of Object.entries(amountKeywordRecord)) {
    const alloced = seat.getAmountAllocated(keyword, amount.brand);
    const amountMath = zcf.getAmountMath(amount.brand);
    if (alloced.brand === amount.brand) {
      if (amountMath.isGTE(alloced, amount)) {
        // Take only what we asked for.
        maximumAmount[keyword] = amount;
      } else {
        // Take everything they have.
        maximumAmount[keyword] = alloced;
      }
    }
  }
  return withdrawFromSeat(zcf, seat, maximumAmount);
};

/**
 * This contract provides encouragement. For a small donation it provides more.
 *
 * @type {ContractStartFn}
 *
 */
const start = async zcf => {
  /** @type {import('@agoric/weak-store').WeakStore<Oracle, Promise<OracleHandler>>} */
  const oracleToHandlerP = makeWeakStore('oracle');

  let lastOracleNonce = 0;

  /**
   * Actually perform the query, handling fees, and returning a result.
   * @param {ERef<Oracle>} oracleP
   * @param {any} query
   * @param {(fee: Promise<Record<Keyword, Amount>>) => Promise<void>} assertDeposit
   * @param {(fee: Promise<Record<Keyword, Amount>>, collect: (collected:
   * PaymentPKeywordRecord) => Promise<void>) => Promise<void>} collectFee
   * @returns {Promise<any>}
   */
  const performQuery = async (oracleP, query, assertDeposit, collectFee) => {
    const oracle = await oracleP;
    const handler = oracleToHandlerP.get(oracle);
    const queryHandler = E(handler).onQuery(oracle, query, handler);
    const deposit = E(queryHandler).calculateDeposit(query, queryHandler);

    // Assert that they can cover the deposit before continuing.
    await assertDeposit(deposit);
    const replyP = E(queryHandler).getReply(query, queryHandler);
    const finalFee = E(queryHandler).calculateFee(query, replyP, queryHandler);

    // Last chance to abort if the oracle is revoked.
    const reply = await replyP;
    await oracleToHandlerP.get(oracle);

    // Collect the described fee.
    const collect = async collected => {
      // Don't return this promise... we want it to happen asynchronously so that
      // the oracle cannot block the receipt of the reply once the funds have
      // been collected from the caller.
      E(queryHandler).receiveFee(query, reply, collected, queryHandler);
    };

    // Try to collect the final fee.
    return collectFee(finalFee, collect).then(
      _ => reply,
      async e => {
        // We had an error, so collect the deposit and rethrow the error.
        await collectFee(deposit, collect);
        throw e;
      },
    );
  };

  /** @type {OraclePublicFacet} */
  const publicFacet = harden({
    makeOracleKit(allegedName) {
      let lastIssuerNonce = 0;
      lastOracleNonce += 1;
      const oracleNonce = lastOracleNonce;
      /** @type {Promise<never>} */
      let revoked;
      const firstHandlerPK = makePromiseKit();
      // Silence unhandled rejection.
      // firstHandlerPK.promise.catch(_ => {});

      /** @type {Oracle} */
      const oracle = {
        getAllegedName() {
          return allegedName;
        },
      };

      oracleToHandlerP.init(oracle, firstHandlerPK.promise);

      /** @type {OracleAdminFacet} */
      const adminFacet = {
        async addFeeIssuer(issuerP) {
          lastIssuerNonce += 1;
          const keyword = `Oracle${oracleNonce}Fee${lastIssuerNonce}`;
          await zcf.saveIssuer(issuerP, keyword);
        },
        replaceHandler(oh) {
          if (revoked) {
            throw revoked;
          }
          // Resolve the first promise if it wasn't.
          firstHandlerPK.resolve(oh);
          oracleToHandlerP.set(
            oracle,
            E(oh)
              .onCreate(oracle, adminFacet, oh)
              .then(_ => oh),
          );
        },
        async revoke() {
          if (revoked) {
            return revoked;
          }

          revoked = Promise.reject(Error(`Oracle ${allegedName} revoked`));

          // Reject the first promise if it wasn't.
          firstHandlerPK.reject(revoked);
          oracleToHandlerP.set(oracle, revoked);
          return undefined;
        },
      };

      return harden({
        oracle,
        adminFacet,
      });
    },
    async query(oracle, query) {
      const makeAssertFee = isDeposit => async fee => {
        const failureDetails = isDeposit
          ? details`Unpaid query did not cover the deposit of ${fee}`
          : details`Unpaid query did not cover the final fee of ${fee}`;
        assert.equal(Object.keys(fee).length, 0, failureDetails);
      };
      return performQuery(
        oracle,
        query,
        makeAssertFee(true),
        makeAssertFee(false),
      );
    },
    async makeQueryInvitation(oracle, query) {
      /** @type {OfferHandler} */
      const offerHandler = async seat => {
        return performQuery(
          oracle,
          query,
          async depositP => {
            const deposit = await depositP;
            assert(
              seatHasAtLeast(zcf, seat, deposit),
              details`Paid query did not cover the deposit of ${deposit}`,
            );
          },
          async (feeP, receive) => {
            const fee = await feeP;
            // Actually collect the fee.  The reply will be released when we return.
            const collected = await withdrawAtMostFromSeat(zcf, seat, fee);
            seat.exit();
            return receive(collected);
          },
        );
      };
      return zcf.makeInvitation(offerHandler, 'oracle query invitation', {
        query,
      });
    },
  });
  return { publicFacet };
};

harden(start);
export { start };

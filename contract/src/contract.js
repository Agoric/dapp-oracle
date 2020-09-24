// @ts-check
import '@agoric/zoe/exported';
import { makePromiseKit } from '@agoric/promise-kit';
import makeWeakStore from '@agoric/weak-store';

import { E } from '@agoric/eventual-send';
import { withdrawFromSeat } from '@agoric/zoe/src/contractSupport';

import './types';
import {
  assert,
  details,
} from '../../../agoric-sdk/node_modules/@agoric/assert/src/assert';

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
    if (!amountMath.isGTE(alloced, amount)) {
      return false;
    }
  }
  return true;
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
   * @param {Oracle} oracle
   * @param {any} query
   * @param {(fee: Record<Keyword, Amount>) => Promise<void>} assertDeposit
   * @param {(fee: Record<Keyword, Amount>, collect: (collected:
   * PaymentPKeywordRecord) => Promise<void>) => Promise<void>} collectFee
   * @returns {Promise<any>}
   */
  const performQuery = async (oracle, query, assertDeposit, collectFee) => {
    const handler = await oracleToHandlerP.get(oracle);
    const queryHandler = await E(handler).onQuery(oracle, query, handler);
    const deposit = await E(queryHandler).calculateDeposit(query, queryHandler);
    // Assert that they can cover the predicted fee.
    await assertDeposit(deposit);
    const reply = await E(queryHandler).getReply(query, queryHandler);
    const finalFee = await E(queryHandler).calculateFee(
      query,
      reply,
      queryHandler,
    );
    // Last chance to abort if the oracle is revoked.
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
      /** @type {Error} */
      let revoked;
      const firstHandlerPK = makePromiseKit();
      // Silence unhandled rejection.
      firstHandlerPK.promise.catch(_ => {});

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
        revoke() {
          if (revoked) {
            throw revoked;
          }
          revoked = Error(`Oracle ${allegedName} revoked`);
          const rejected = Promise.reject(revoked);
          // Silence unhandled rejection.
          rejected.catch(_ => {});

          // Reject the first promise if it wasn't.
          firstHandlerPK.reject(rejected);
          oracleToHandlerP.set(oracle, rejected);
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
        const makeAssertFee = isDeposit => async fee => {
          const failureDetails = isDeposit
            ? details`Paid query did not cover the deposit of ${fee}`
            : details`Paid query did not cover the final fee of ${fee}`;
          assert(seatHasAtLeast(zcf, seat, fee), failureDetails);
        };
        return performQuery(
          oracle,
          query,
          makeAssertFee(true),
          async (fee, receive) => {
            // Assert that seat has at least the fee.
            await makeAssertFee(false)(fee);

            // Actually collect the fee.  The reply will be released when we return.
            const collected = await withdrawFromSeat(zcf, seat, fee);
            seat.exit();
            return receive(collected);
          },
        );
      };
      return zcf.makeInvitation(offerHandler, 'oracle query invitation');
    },
  });
  return { publicFacet };
};

harden(start);
export { start };

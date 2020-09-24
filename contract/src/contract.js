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
   * @param {(fee: Record<Keyword, Amount>, receive?: (collected: PaymentPKeywordRecord) => Promise<void>) => Promise<void>} manageFee
   * @returns {Promise<any>}
   */
  const performQuery = async (oracle, query, manageFee) => {
    const handler = await oracleToHandlerP.get(oracle);
    const queryHandler = await E(handler).onQuery(oracle, query, handler);
    const predictedFee = await E(queryHandler).calculateFee(
      query,
      false,
      undefined,
      queryHandler,
    );
    // Assert that they can cover the predicted fee.
    await manageFee(predictedFee);
    const reply = await E(queryHandler).getReply(query, queryHandler);
    const finalFee = await E(queryHandler).calculateFee(
      query,
      true,
      reply,
      queryHandler,
    );
    // Last chance to abort if the oracle is revoked.
    await oracleToHandlerP.get(oracle);
    // Collect the described fee.
    await manageFee(finalFee, collected =>
      E(queryHandler).receiveFee(query, reply, collected, queryHandler),
    );
    // Only now can we release the reply to the caller.
    return reply;
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
      return performQuery(oracle, query, async (fee, receive) => {
        const failureDetails = receive
          ? details`Unpaid query did not cover the final fee of ${fee}`
          : details`Unpaid query did not cover the predicted fee of ${fee}`;
        assert.equal(Object.keys(fee).length, 0, failureDetails);
      });
    },
    async makeQueryInvitation(oracle, query) {
      /** @type {OfferHandler} */
      const offerHandler = async seat => {
        return performQuery(oracle, query, async (fee, receive) => {
          // Assert that seat has at least the fee.
          const failureDetails = receive
            ? details`Paid query did not cover the final fee of ${fee}`
            : details`Paid query did not cover the predicted fee of ${fee}`;
          assert(seatHasAtLeast(zcf, seat, fee), failureDetails);

          if (!receive || Object.keys(fee).length === 0) {
            // Don't collect the fee right now, just return.
            return undefined;
          }

          // Actually collect the fee now that the query has been replied.
          const collected = await withdrawFromSeat(zcf, seat, fee);
          seat.exit();
          return receive(collected);
        });
      };
      return zcf.makeInvitation(offerHandler, 'oracle query invitation');
    },
  });
  return { publicFacet };
};

harden(start);
export { start };

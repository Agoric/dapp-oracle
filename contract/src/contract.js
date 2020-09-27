// @ts-check
import '@agoric/zoe/exported';

import { assert, details } from '@agoric/assert';
import { E } from '@agoric/eventual-send';
import { trade } from '@agoric/zoe/src/contractSupport';
import { makePromiseKit } from '@agoric/promise-kit';

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
 * @param {AmountKeywordRecord} maximumAmounts
 * @returns {AmountKeywordRecord}
 */
const fromSeatUpToMaximum = (zcf, seat, maximumAmounts) => {
  /** @type {AmountKeywordRecord} */
  const actualAmounts = {};
  for (const [keyword, amount] of Object.entries(maximumAmounts)) {
    const alloced = seat.getAmountAllocated(keyword, amount.brand);
    const amountMath = zcf.getAmountMath(amount.brand);
    if (alloced.brand === amount.brand) {
      if (amountMath.isGTE(alloced, amount)) {
        // Take only what we asked for.
        actualAmounts[keyword] = amount;
      } else {
        // Take everything they have.
        actualAmounts[keyword] = alloced;
      }
    }
  }
  return actualAmounts;
};

/**
 * This contract provides encouragement. For a small donation it provides more.
 *
 * @type {ContractStartFn}
 *
 */
const start = async zcf => {
  const { oracleHandler, oracleDescription } = zcf.getTerms();

  /** @type {OracleHandler} */
  const handler = oracleHandler;
  /** @type {string} */
  const description = oracleDescription;

  const { zcfSeat: feeSeat } = zcf.makeEmptySeatKit();

  let lastIssuerNonce = 0;
  /** @type {string} */
  let revoked;

  /**
   * Actually perform the query, handling fees, and returning a result.
   * @param {any} query
   * @param {(deposit: AmountKeywordRecord) => void} assertDeposit
   * @param {(fee?: AmountKeywordRecord) => AmountKeywordRecord} [collectFee=_=>({})]
   * @returns {Promise<any>}
   */
  const performQuery = async (query, assertDeposit, collectFee = _ => ({})) => {
    if (revoked) {
      throw Error(revoked);
    }

    let failedAssert;
    let fee;

    const collectedPK = makePromiseKit();

    /** @type {OracleQueryActions} */
    const actions = {
      assertDeposit(deposit) {
        try {
          if (revoked) {
            throw Error(revoked);
          }
          assertDeposit(deposit);
        } catch (e) {
          failedAssert = e;
          throw e;
        }
      },
      async collectFee(desiredFee) {
        // We can only collect when we have replied.
        if (revoked) {
          throw Error(revoked);
        }
        fee = desiredFee;
        return collectedPK.promise;
      },
    };

    const replyP = E(handler).onQuery(query, harden(actions));
    // Ensure the promise resolves.
    await replyP.catch(e => (failedAssert = e));
    if (failedAssert) {
      collectedPK.resolve(collectFee());
      throw failedAssert;
    }
    collectedPK.resolve(collectFee(fee));
    return replyP;
  };

  /** @type {OracleCreatorFacet} */
  const creatorFacet = {
    async addFeeIssuer(issuerP) {
      lastIssuerNonce += 1;
      const keyword = `OracleFee${lastIssuerNonce}`;
      await zcf.saveIssuer(issuerP, keyword);
    },
    makeWithdrawInvitation(total = false) {
      return zcf.makeInvitation(seat => {
        const gains = total
          ? feeSeat.getCurrentAllocation()
          : seat.getProposal().want;
        trade(zcf, { seat: feeSeat, gains: {} }, { seat, gains });
        seat.exit();
        return 'liquidated';
      }, 'oracle liquidation');
    },
    getCurrentFees() {
      return feeSeat.getCurrentAllocation();
    },
  };

  /** @type {OraclePublicFacet} */
  const publicFacet = harden({
    getDescription() {
      return description;
    },
    async query(query) {
      return performQuery(query, deposit =>
        assert.fail(
          details`Unpaid query does not cover the deposit of ${deposit}`,
        ),
      );
    },
    async makeQueryInvitation(query) {
      /** @type {OfferHandler} */
      const offerHandler = async seat =>
        performQuery(
          query,
          deposit => {
            assert(
              seatHasAtLeast(zcf, seat, deposit),
              details`Paid query did not cover the deposit of ${deposit}`,
            );
          },
          fee => {
            if (!fee) {
              seat.exit();
              return {};
            }

            const actualAmounts = fromSeatUpToMaximum(zcf, seat, fee);

            // Put the actual amounts on our feeSeat.
            trade(
              zcf,
              { seat, gains: {} },
              { seat: feeSeat, gains: actualAmounts },
            );
            seat.exit();
            return actualAmounts;
          },
        );
      return zcf.makeInvitation(offerHandler, 'oracle query', {
        query,
      });
    },
  });

  const creatorInvitation = zcf.makeInvitation(
    async seat =>
      harden({
        exit() {
          trade(
            zcf,
            { seat: feeSeat, gains: {} },
            { seat, gains: feeSeat.getCurrentAllocation() },
          );
          seat.exit();
          feeSeat.exit();
          revoked = `Oracle ${description} revoked`;
          return 'liquidated';
        },
      }),
    'oracle total liquidation',
  );

  return { creatorFacet, publicFacet, creatorInvitation };
};

harden(start);
export { start };

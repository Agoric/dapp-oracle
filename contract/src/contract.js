// @ts-check
import '@agoric/zoe/exported';
import { makeNotifierKit } from '@agoric/notifier';

/**
 * This contract provides encouragement. For a small donation it provides more.
 *
 * @type {ContractStartFn}
 *
 */
const start = async zcf => {
  let count = 0;
  const messages = {
    basic: `You're doing great!`,
    premium: `Wow, just wow. I have never seen such talent!`,
  };
  const { notifier, updater } = makeNotifierKit(undefined);

  const assuranceMint = await zcf.makeZCFMint('Assurance', 'set');
  // Now ZCF has saved the issuer, brand, and local amountMath so that they
  // can be accessed synchronously.
  const { amountMath: assuranceMath, issuer } = assuranceMint.getIssuerRecord();

  const {
    brands: { Tip: tipBrand },
  } = zcf.getTerms();
  const tipAmountMath = zcf.getAmountMath(tipBrand);

  /** @type {ZCFSeat} */
  let creatorSeat;

  const updateNotification = () => {
    updater.updateState({ messages, count });
  };
  updateNotification();

  /** @type {OfferHandler} */
  const create = seat => {
    creatorSeat = seat;
    return `creator invitation redeemed`;
  };

  /** @type {OfferHandler} */
  const encourage = seat => {
    // if the creatorSeat is no longer active (i.e. the creator exited
    // their seat and retrieved their tips), we just don't give any
    // encouragement.
    if (creatorSeat.hasExited()) {
      throw seat.kickOut(new Error(`We are no longer giving encouragement`));
    }

    let encouragement = messages.basic;

    const tipAmount = seat.getAmountAllocated('Tip', tipBrand);
    if (tipAmountMath.isGTE(tipAmount, tipAmountMath.make(1))) {
      // if the user gives a tip, we provide a premium encouragement message
      encouragement = messages.premium;

      // Create a non-fungible serial number for the new assurance
      const assuranceAmount = assuranceMath.make(harden([count + 1]));
      assuranceMint.mintGains({ Assurance: assuranceAmount }, creatorSeat);

      const userStage = seat.stage({
        Tip: tipAmountMath.getEmpty(),
        Assurance: assuranceAmount,
      });

      // reallocate the tip to the creatorSeat
      const creatorTips = creatorSeat.getAmountAllocated('Tip', tipBrand);
      const creatorStage = creatorSeat.stage({
        Tip: tipAmountMath.add(creatorTips, tipAmount),
        Assurance: assuranceMath.getEmpty(),
      });

      zcf.reallocate(creatorStage, userStage);
    }
    seat.exit();
    count += 1;
    updateNotification();
    return encouragement;
  };

  const publicFacet = {
    makeInvitation() {
      return zcf.makeInvitation(encourage, 'encouragement');
    },
    getFreeEncouragement() {
      count += 1;
      updateNotification();
      return messages.basic;
    },
    getAssuranceIssuer() {
      return issuer;
    },
    getNotifier() {
      return notifier;
    },
  };

  const creatorInvitation = zcf.makeInvitation(create, 'creator');
  return harden({ creatorInvitation, publicFacet });
};

harden(start);
export { start };

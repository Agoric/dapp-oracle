import { makeIssuerKit, AmountMath } from '@agoric/ertp';
import { makeZoeKit } from '@agoric/zoe';
import fakeVatAdmin from '@agoric/zoe/tools/fakeVatAdmin.js';
import { E } from '@agoric/far';

const setup = () => {
  const moolaBundle = makeIssuerKit('moola');
  const simoleanBundle = makeIssuerKit('simoleans');
  const bucksBundle = makeIssuerKit('bucks');
  const allBundles = {
    moola: moolaBundle,
    simoleans: simoleanBundle,
    bucks: bucksBundle,
  };
  const brands = new Map();

  for (const k of Object.getOwnPropertyNames(allBundles)) {
    brands.set(k, allBundles[k].brand);
  }

  const { zoeService } = makeZoeKit(fakeVatAdmin);
  const feePurse = E(zoeService).makeFeePurse();
  const zoe = E(zoeService).bindDefaultFeePurse(feePurse);

  return harden({
    moolaIssuer: moolaBundle.issuer,
    moolaMint: moolaBundle.mint,
    moolaR: moolaBundle,
    moolaKit: moolaBundle,
    simoleanIssuer: simoleanBundle.issuer,
    simoleanMint: simoleanBundle.mint,
    simoleanR: simoleanBundle,
    simoleanKit: simoleanBundle,
    bucksIssuer: bucksBundle.issuer,
    bucksMint: bucksBundle.mint,
    bucksR: bucksBundle,
    bucksKit: bucksBundle,
    brands,
    moola: value => AmountMath.make(moolaBundle.brand, value),
    simoleans: value => AmountMath.make(simoleanBundle.brand, value),
    bucks: value => AmountMath.make(bucksBundle.brand, value),
    zoe,
  });
};
harden(setup);
export { setup };

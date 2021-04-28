import { makeIssuerKit, amountMath } from '@agoric/ertp';
import { makeZoe } from '@agoric/zoe/src/zoeService/zoe';
import fakeVatAdmin from '@agoric/zoe/tools/fakeVatAdmin';

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

  const zoe = makeZoe(fakeVatAdmin);

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
    moola: value => amountMath.make(moolaBundle.brand, value),
    simoleans: value => amountMath.make(simoleanBundle.brand, value),
    bucks: value => amountMath.make(bucksBundle.brand, value),
    zoe,
  });
};
harden(setup);
export { setup };

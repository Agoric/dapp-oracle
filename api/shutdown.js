/**
 * @typedef {Object} DeployPowers The special powers that `agoric deploy` gives us
 * @property {(path: string) => { moduleFormat: string, source: string }} bundleSource
 * @property {(path: string) => string} pathResolve
 */

import { E } from '@agoric/eventual-send';

/**
 * @param {any} referencesPromise A promise for the references
 * available from REPL home
 * @param {DeployPowers} powers
 */
export default async function deployShutdown(referencesPromise) {
  const { scratch, wallet } = await referencesPromise;
  const adminSeat = E(scratch).get('adminSeat');

  await E(E(adminSeat).getOfferResult())
    .exit()
    .catch(e => console.log(e));
  console.log('Contract is shut down.');
  const payout = await E(adminSeat).getPayouts();
  console.log('Got payouts', payout);
  await Promise.all(
    Object.values(payout).map(payment => E(wallet).addPayment(payment)),
  );
  console.log('Payments deposited');
}

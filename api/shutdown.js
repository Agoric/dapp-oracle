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
  const { uploads: scratch, wallet } = await referencesPromise;
  const adminPayoutP = E(scratch).get('adminPayoutP');
  const completeObj = E(scratch).get('completeObj');

  await E(completeObj).complete();
  console.log('Contract is shut down.');
  const payout = await adminPayoutP;
  await Promise.all(
    Object.values(payout).map(payment => E(wallet).addPayment(payment)),
  );
  console.log('Payments deposited');
}

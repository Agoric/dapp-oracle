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
  const { scratch, wallet, zoe } = await referencesPromise;

  console.log('Getting oracleCreator');
  /** @type {OracleCreatorFacet} */
  const creatorFacet = await E(scratch).get('oracleCreator');
  console.log('Shutting down contract.');

  const shutdownInvitation = E(creatorFacet).makeShutdownInvitation();
  const shutdownSeat = E(zoe).offer(shutdownInvitation);
  const payout = await E(shutdownSeat).getPayouts();
  console.log('Got payouts', payout);

  await Promise.all(
    Object.values(payout).map(payment => E(wallet).addPayment(payment)),
  );
  console.log('Payments deposited');
}

// @ts-check
/* global process */
import { E } from '@agoric/far';

import { deeplyFulfilled } from '@endo/marshal';

import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

/**
 * @typedef {Object} DeployPowers The special powers that `agoric deploy` gives us
 * @property {(path: string) => Promise<{ moduleFormat: string, source: string }>} bundleSource
 * @property {(path: string) => string} pathResolve
 * @property {(path: string, opts?: any) => Promise<any>} installUnsafePlugin
 * @property {string} host
 * @property {string} port
 *
 * @typedef {Object} Board
 * @property {(id: string) => any} getValue
 * @property {(value: any) => string} getId
 * @property {(value: any) => boolean} has
 * @property {() => [string]} ids
 */

/**
 * @typedef {{ board: Board, chainTimerService, scratch, zoe }} Home
 * @param {Promise<Home>} homePromise
 * A promise for the references available from REPL home
 */
export default async function priceAuthorityfromNotifier(homePromise) {
  const { ORACLE_ADDRESS } = process.env;

  // Let's wait for the promise to resolve.
  const home = await deeplyFulfilled(homePromise);

  const { creatorFacet } = await E(home.scratch).get(
    'priceAggregatorChainlink',
  );

  const depositFacet = await E(home.namesByAddress).lookup(
    ORACLE_ADDRESS,
    'depositFacet',
  );

  const invitation = await E(creatorFacet).makeOracleInvitation();
  await E(depositFacet).receive(invitation);

  console.log('Deposited', invitation);
}

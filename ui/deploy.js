// @ts-check
// Agoric Dapp UI deployment script

// NOTE: In the future, this will take place via the wallet UI.
// Until that time, this allows contract developers to add their
// issuer and purse to an individual wallet.

import dappConstants from './public/conf/defaults.js';
import { E } from '@agoric/eventual-send';

// deploy.js runs in an ephemeral Node.js outside of swingset. The
// spawner runs within ag-solo, so is persistent.  Once the deploy.js
// script ends, connections to any of its objects are severed.

const ASSURANCE_ISSUER_PETNAME = 'encouragement';
const ASSURANCE_PURSE_PETNAME = 'Emotional bank account';

// The contract's boardId for the assurance issuer.
const {
  issuerBoardIds: { Assurance: ASSURANCE_ISSUER_BOARD_ID },
  brandBoardIds: { Assurance: ASSURANCE_BRAND__BOARD_ID },
} = dappConstants;

/**
 * @typedef {Object} DeployPowers The special powers that `agoric deploy` gives us
 * @property {(path: string) => { moduleFormat: string, source: string }} bundleSource
 * @property {(path: string) => string} pathResolve
 */

/**
 * @param {any} homePromise A promise for the references
 * available from REPL home
 * @param {DeployPowers} powers
 */
export default async function deployWallet(homePromise, { bundleSource, pathResolve }) {

  // Let's wait for the promise to resolve.
  const home = await homePromise;

  // Unpack the home references.
  const { 

    // *** LOCAL REFERENCES ***

    // This wallet only exists on this machine, and only you have
    // access to it. The wallet stores purses and handles transactions.
    wallet, 

    // *** ON-CHAIN REFERENCES ***

    // The board is an on-chain object that is used to make private
    // on-chain objects public to everyone else on-chain. These
    // objects get assigned a unique string id. Given the id, other
    // people can access the object through the board. Ids and values
    // have a one-to-one bidirectional mapping. If a value is added a
    // second time, the original id is just returned.
    board,
  } = home;

  // Install this Dapp's issuer and empty purse in the wallet.
  const assuranceIssuer = await E(board).getValue(ASSURANCE_ISSUER_BOARD_ID);
  if (!assuranceIssuer) {
    throw Error(`The '${ASSURANCE_ISSUER_BOARD_ID}' assurance issuer board id was not found; first:
agoric deploy contract/deploy.js api/deploy.js`);
  }

  // Associate the issuer with a petname.
  await E(wallet).addIssuer(ASSURANCE_ISSUER_PETNAME, assuranceIssuer);

  // Create an empty purse for that issuer, and give it a petname.
  await E(wallet).makeEmptyPurse(ASSURANCE_ISSUER_PETNAME, ASSURANCE_PURSE_PETNAME);

  // We are done!
  console.log('INSTALLED in local wallet');
  console.log(`Encouragement issuer:`, ASSURANCE_ISSUER_PETNAME);
  console.log(`Encouragement purse:`, ASSURANCE_PURSE_PETNAME);
}

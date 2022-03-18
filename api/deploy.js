// @ts-check
/* global process */
// Agoric Dapp api deployment script

import fs from 'fs';
import { E } from '@agoric/far';

import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

import installationConstants from '../ui/public/conf/installationConstants.js';

// deploy.js runs in an ephemeral Node.js outside of swingset. The
// spawner runs within ag-solo, so is persistent.  Once the deploy.js
// script ends, connections to any of its objects are severed.

// Whether the oracle should be exported.
const { INSTALL_ORACLE } = process.env;

// The deployer's wallet's petname for the tip issuer.
const FEE_ISSUER_PETNAME = process.env.FEE_ISSUER_PETNAME || 'RUN';

/**
 * @typedef {Object} DeployPowers The special powers that `agoric deploy` gives us
 * @property {(path: string, opts?: any) => Promise<{ moduleFormat: string }>} bundleSource
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
 * @typedef {{ zoe: ZoeService, board: Board, spawner, agoricNames, scratch, http, wallet }} Home
 * @param {Promise<Home>} homePromise
 * A promise for the references available from REPL home
 * @param {DeployPowers} powers
 */
export default async function deployApi(
  homePromise,
  { pathResolve, port = '8000' },
) {
  // Let's wait for the promise to resolve.
  const home = await homePromise;

  // Unpack the references.
  const {
    // *** LOCAL REFERENCES ***

    // Scratch is a map only on this machine, and can be used for
    // communication in objects between processes/scripts on this
    // machine.
    scratch,

    // *** ON-CHAIN REFERENCES ***

    // Zoe lives on-chain and is shared by everyone who has access to
    // the chain. In this demo, that's just you, but on our testnet,
    // everyone has access to the same Zoe.
    zoe,

    // The board is an on-chain object that is used to make private
    // on-chain objects public to everyone else on-chain. These
    // objects get assigned a unique string id. Given the id, other
    // people can access the object through the board. Ids and values
    // have a one-to-one bidirectional mapping. If a value is added a
    // second time, the original id is just returned.
    board,

    wallet,
  } = home;

  const { CONTRACT_NAME, INSTALLATION_HANDLE_BOARD_ID } = installationConstants;

  // const API_HOST = process.env.API_HOST || host;
  const API_PORT = process.env.API_PORT || port;

  const issuersArray = await E(wallet).getIssuers();
  const issuers = new Map(issuersArray);
  const feeIssuer = issuers.get(FEE_ISSUER_PETNAME);

  if (feeIssuer === undefined) {
    console.error(
      'Cannot find FEE_ISSUER_PETNAME',
      FEE_ISSUER_PETNAME,
      'in home.wallet',
    );
    console.error('Have issuers:', [...issuers.keys()].join(', '));
    process.exit(1);
  }

  // To get the backend of our dapp up and running, first we need to
  // grab the installationHandle that our contract deploy script put
  // in the public board.
  const contractInstallation = await E(board).getValue(
    INSTALLATION_HANDLE_BOARD_ID,
  );

  console.log('Instantiating oracle contract');
  const oracleHandler = await E(scratch).get('oracleHandler');

  const issuerKeywordRecord = harden({ Fee: feeIssuer });
  const { instance, creatorFacet } = await E(zoe).startInstance(
    contractInstallation,
    issuerKeywordRecord,
    {
      oracleDescription: INSTALL_ORACLE || 'Builtin Oracle',
    },
    { oracleHandler },
  );

  await E(scratch).set('oracleCreator', creatorFacet);

  console.log('- SUCCESS! contract instance is running on Zoe');
  const INSTANCE_HANDLE_BOARD_ID = await E(board).getId(instance);
  console.log(`-- INSTANCE_HANDLE_BOARD_ID: ${INSTANCE_HANDLE_BOARD_ID}`);

  // Now that we've done all the admin work, let's share this
  // instanceHandle by adding it to the board. Any users of our
  // contract will use this instanceHandle to get invitations to the
  // contract in order to make an offer.

  console.log(`-- Contract Name: ${CONTRACT_NAME}`);
  console.log(`-- INSTANCE_HANDLE_BOARD_ID: ${INSTANCE_HANDLE_BOARD_ID}`);

  // Re-save the constants somewhere where the UI and api can find it.
  const defaultsFile = pathResolve('../ui/public/conf/defaults.js');
  let defaults;
  try {
    const ns = await import('../ui/public/conf/defaults.js');
    defaults = ns.default;
  } catch (e) {
    // do nothing
  }
  const newDefaults = {
    ...defaults,
    [API_PORT]: { ...defaults?.[API_PORT], INSTANCE_HANDLE_BOARD_ID },
  };

  console.log('writing', defaultsFile);
  const defaultsContents = `\
// GENERATED FROM ${pathResolve('./deploy.js')}
export default ${JSON.stringify(newDefaults, undefined, 2)};
`;
  await fs.promises.writeFile(defaultsFile, defaultsContents);
}

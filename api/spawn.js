/* global process */
import { E } from '@agoric/far';

import fs from 'fs';

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

// The deployer's wallet's petname for the tip issuer.
const { FEE_ISSUER_PETNAME = 'RUN', INSTALL_ORACLE } = process.env;

/**
 * @typedef {{ zoe: ZoeService, board: Board, spawner, agoricNames, scratch, http }} Home
 * @param {Promise<Home>} homePromise
 * A promise for the references available from REPL home
 * @param {DeployPowers} powers
 */
export default async function spawnOracle(
  homePromise,
  { bundleSource, installUnsafePlugin, pathResolve, port = '8000' },
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

    // The spawner persistently runs scripts within ag-solo, off-chain.
    spawner,

    // *** ON-CHAIN REFERENCES ***

    // Zoe lives on-chain and is shared by everyone who has access to
    // the chain. In this demo, that's just you, but on our testnet,
    // everyone has access to the same Zoe.
    zoe,

    // The http request handler.
    // TODO: add more explanation
    http,

    // The board is an on-chain object that is used to make private
    // on-chain objects public to everyone else on-chain. These
    // objects get assigned a unique string id. Given the id, other
    // people can access the object through the board. Ids and values
    // have a one-to-one bidirectional mapping. If a value is added a
    // second time, the original id is just returned.
    board,

    wallet,
  } = home;

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

  const invitationIssuer = await E(zoe).getInvitationIssuer();

  // Bundle up the handler code
  const bundle = await bundleSource(pathResolve('./src/handler.js'));

  // Install it on the spawner
  const handlerInstall = E(spawner).install(bundle);

  // Spawn the running code
  const { handler, oracleMaster } = await E(handlerInstall).spawn(
    harden({
      http,
      board,
      feeIssuer,
      invitationIssuer,
      zoe,
    }),
  );

  await E(http).registerURLHandler(handler, '/api/oracle-client');

  let httpClient;
  if (!INSTALL_ORACLE) {
    // For the builtin oracle, we ask the agoric deploy command to install an
    // HTTP client plugin into the running ag-solo, and provide the handler
    // access to it.
    //
    // The function is named installUnsafePlugin because, unlike any vat or
    // contract, the plugin will get full access to the OS-level account in
    // which the ag-solo is running.
    console.info(
      'Please allow our unsafe plugin to enable builtin oracle HTTP client access',
    );
    httpClient = await installUnsafePlugin(
      './src/http-client.js',
      {},
    ).catch(e => console.error(`${e}`));
  }

  let handlerP;
  if (INSTALL_ORACLE) {
    // This clause is to install an external oracle (serviced by, say, a
    // separate oracle node).
    console.log('Creating external oracle', INSTALL_ORACLE);
    handlerP = E(oracleMaster).makeExternalOracle();
  } else {
    // Builtin oracle.
    console.log('Creating builtin oracle');
    handlerP = E(oracleMaster).makeBuiltinOracle({ httpClient });
  }

  const { oracleHandler, oracleURLHandler } = await handlerP;
  await E(scratch).set('oracleHandler', oracleHandler);

  // Install this oracle on the ag-solo.
  await E(http).registerURLHandler(oracleURLHandler, '/api/oracle');

  // We put the oracleCreator and facet in our scratch location for future use (such as
  // in the shutdown.js script).
  await E(scratch).set('oracleMaster', oracleMaster);

  console.log('Retrieving Board IDs for issuers and brands');
  const invitationBrandP = E(invitationIssuer).getBrand();

  const feeBrandP = E(feeIssuer).getBrand();

  // Now that we've done all the admin work, let's share this
  // instanceHandle by adding it to the board. Any users of our
  // contract will use this instanceHandle to get invitations to the
  // contract in order to make an offer.
  const feeBrand = await feeBrandP;

  const FEE_BRAND_BOARD_ID = await E(board).getId(feeBrand);

  console.log(`-- FEE_BRAND_BOARD_ID: ${FEE_BRAND_BOARD_ID}`);

  const invitationBrand = await invitationBrandP;
  const INVITE_BRAND_BOARD_ID = await E(board).getId(invitationBrand);
  const FEE_ISSUER_BOARD_ID = await E(board).getId(feeIssuer);

  const API_URL = process.env.API_URL || `http://127.0.0.1:${API_PORT}`;

  // Re-save the constants somewhere where the UI and api can find it.
  const dappConstants = {
    INVITE_BRAND_BOARD_ID,
    // BRIDGE_URL: 'agoric-lookup:https://local.agoric.com?append=/bridge',
    brandBoardIds: { Fee: FEE_BRAND_BOARD_ID },
    issuerBoardIds: { Fee: FEE_ISSUER_BOARD_ID },
  };
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
    ...dappConstants,
    [API_PORT]: { API_URL },
  };

  console.log('writing', defaultsFile);
  const defaultsContents = `\
// GENERATED FROM ${pathResolve('./spawn.js')}
export default ${JSON.stringify(newDefaults, undefined, 2)};
`;
  await fs.promises.writeFile(defaultsFile, defaultsContents);

  const addr = await E(E.get(homePromise).myAddressNameAdmin).getMyAddress();
  console.log(`ORACLE_ADDRESS=${addr}`);
}

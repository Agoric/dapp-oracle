// @ts-check
// Agoric Dapp api deployment script

import fs from 'fs';
import { E } from '@agoric/eventual-send';
import harden from '@agoric/harden';
import '@agoric/zoe/exported';
import '@agoric/zoe/src/contracts/exported';

import installationConstants from '../ui/public/conf/installationConstants';

// deploy.js runs in an ephemeral Node.js outside of swingset. The
// spawner runs within ag-solo, so is persistent.  Once the deploy.js
// script ends, connections to any of its objects are severed.

// Whether the oracle should be exported.
const { INSTALL_ORACLE } = process.env;

// The deployer's wallet's petname for the tip issuer.
const FEE_ISSUER_PETNAME = process.env.FEE_ISSUER_PETNAME || 'Testnet.$LINK';

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
 * @typedef {{ zoe: ZoeService, board: Board, spawner, wallet, scratch, http }} Home
 * @param {Promise<Home>} homePromise
 * A promise for the references available from REPL home
 * @param {DeployPowers} powers
 */
export default async function deployApi(
  homePromise,
  { bundleSource, installUnsafePlugin, pathResolve, port = '8000' },
) {
  // Let's wait for the promise to resolve.
  const home = await homePromise;

  // Unpack the references.
  const {
    // *** LOCAL REFERENCES ***

    // This wallet only exists on this machine, and only you have
    // access to it. The wallet stores purses and handles transactions.
    wallet,

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
  } = home;

  const { CONTRACT_NAME, INSTALLATION_HANDLE_BOARD_ID } = installationConstants;

  // const API_HOST = process.env.API_HOST || host;
  const API_PORT = process.env.API_PORT || port;

  // Second, we can use the installationHandle to create a new instance of our
  // contract code on Zoe. A contract instance is a running program that can
  // take offers through Zoe. Creating a contract instance gives you an
  // invitation to the contract. In this case, it is an admin invitation with
  // special authority - whoever redeems this admin invitation will get all of
  // the fees from the contract instance.

  // At the time that we make the contract instance, we need to tell
  // Zoe what kind of token to accept as tip money. In this instance,
  // we will only accept moola. (If we wanted to accept other kinds of
  // tips, we could create other instances or edit the contract code
  // and redeploy.) We need to put this information in the form of a
  // keyword (a string that the contract determines, in this case,
  // 'Tip') plus an issuer for the token kind, the moolaIssuer.

  // In our example, moola is a widely used token that our wallet
  // already knows about.

  // getIssuers returns an array, because we currently cannot
  // serialize maps. We can immediately create a map using the array,
  // though. https://github.com/Agoric/agoric-sdk/issues/838
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
  const { handler, oracleCreator } = await E(handlerInstall).spawn({
    http,
    board,
    feeIssuer,
    invitationIssuer,
    zoe,
  });

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

  let INSTANCE_HANDLE_BOARD_ID;
  if (INSTALL_ORACLE || httpClient) {
    // To get the backend of our dapp up and running, first we need to
    // grab the installationHandle that our contract deploy script put
    // in the public board.
    const contractInstallation = await E(board).getValue(
      INSTALLATION_HANDLE_BOARD_ID,
    );

    console.log('Instantiating oracle contract');
    const issuerKeywordRecord = harden({ Fee: feeIssuer });
    const { instance, creatorFacet: initializationFacet } = await E(
      zoe,
    ).startInstance(contractInstallation, issuerKeywordRecord, {
      oracleDescription: INSTALL_ORACLE || 'Builtin Oracle',
    });

    /** @type {OracleCreatorFacet} */
    let creatorFacet;
    if (INSTALL_ORACLE) {
      // This clause is to install an external oracle (serviced by, say, a
      // separate oracle node).
      console.log('Creating external oracle', INSTALL_ORACLE);
      const { oracleHandler, oracleURLHandler } = await E(
        oracleCreator,
      ).makeExternalOracle();
      const oracleAdmin = E(initializationFacet).initialize({ oracleHandler });

      // Install this oracle on the ag-solo.
      await E(http).registerURLHandler(oracleURLHandler, '/api/oracle');

      // Stash the oracleAdmin.
      await Promise.all([
        oracleAdmin,
        E(scratch).set('oracleAdmin', oracleAdmin),
      ]);

      creatorFacet = await E(initializationFacet).initialize({ oracleHandler });
    } else {
      // Builtin oracle.
      console.log('Creating builtin oracle');
      const { oracleHandler } = await E(oracleCreator).makeBuiltinOracle({
        httpClient,
      });
      creatorFacet = await E(initializationFacet).initialize({ oracleHandler });
    }

    console.log('- SUCCESS! contract instance is running on Zoe');

    // We put the oracleCreator in our scratch location for future use (such as
    // in the shutdown.js script).
    E(scratch).set('oracleCreator', creatorFacet);

    INSTANCE_HANDLE_BOARD_ID = await E(board).getId(instance);
  }

  console.log('Retrieving Board IDs for issuers and brands');
  const invitationBrandP = E(invitationIssuer).getBrand();

  const feeBrandP = E(feeIssuer).getBrand();

  // Now that we've done all the admin work, let's share this
  // instanceHandle by adding it to the board. Any users of our
  // contract will use this instanceHandle to get invitations to the
  // contract in order to make an offer.
  const feeBrand = await feeBrandP;

  const FEE_BRAND_BOARD_ID = await E(board).getId(feeBrand);

  console.log(`-- Contract Name: ${CONTRACT_NAME}`);
  console.log(`-- INSTANCE_HANDLE_BOARD_ID: ${INSTANCE_HANDLE_BOARD_ID}`);
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
    // eslint-disable-next-line global-require,import/no-dynamic-require
    defaults = require(defaultsFile).default;
  } catch (e) {
    // do nothing
  }
  const newDefaults = {
    ...defaults,
    ...dappConstants,
    [API_PORT]: { INSTANCE_HANDLE_BOARD_ID, API_URL },
  };

  console.log('writing', defaultsFile);
  const defaultsContents = `\
// GENERATED FROM ${pathResolve('./deploy.js')}
export default ${JSON.stringify(newDefaults, undefined, 2)};
`;
  await fs.promises.writeFile(defaultsFile, defaultsContents);
}

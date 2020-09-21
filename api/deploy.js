// @ts-check
// Agoric Dapp api deployment script

import fs from 'fs';
import { E } from '@agoric/eventual-send';
import harden from '@agoric/harden';
import '@agoric/zoe/exported';

import installationConstants from '../ui/public/conf/installationConstants';

// deploy.js runs in an ephemeral Node.js outside of swingset. The
// spawner runs within ag-solo, so is persistent.  Once the deploy.js
// script ends, connections to any of its objects are severed.

// The deployer's wallet's petname for the tip issuer.
const TIP_ISSUER_PETNAME = process.env.TIP_ISSUER_PETNAME || 'moola';

/**
 * @typedef {Object} DeployPowers The special powers that `agoric deploy` gives us
 * @property {(path: string) => { moduleFormat: string, source: string }} bundleSource
 * @property {(path: string) => string} pathResolve
 * @property {(path: string, opts?: any) => Promise<any>} installUnsafePlugin
 *
 * @typedef {Object} Board
 * @property {(id: string) => any} getValue
 * @property {(value: any) => string} getId
 * @property {(value: any) => boolean} has
 * @property {() => [string]} ids
 */

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = process.env.API_PORT || '8000';

/**
 * @typedef {{ zoe: ZoeService, board: Board, spawner, wallet, uploads, http }} Home
 * @param {Promise<Home>} homePromise
 * A promise for the references available from REPL home
 * @param {DeployPowers} powers
 */
export default async function deployApi(
  homePromise,
  { bundleSource, pathResolve, installUnsafePlugin },
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
    uploads: scratch,

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

  // To get the backend of our dapp up and running, first we need to
  // grab the installationHandle that our contract deploy script put
  // in the public board.
  const { INSTALLATION_HANDLE_BOARD_ID, CONTRACT_NAME } = installationConstants;
  const contractInstallation = await E(board).getValue(
    INSTALLATION_HANDLE_BOARD_ID,
  );

  // Second, we can use the installationHandle to create a new
  // instance of our contract code on Zoe. A contract instance is a running
  // program that can take offers through Zoe. Creating a contract
  // instance gives you an invitation to the contract. In this case, it is
  // an admin invitation with special authority - whoever redeems this
  // admin invitation will get all of the tips from the encouragement
  // contract instance.

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
  const tipIssuer = issuers.get(TIP_ISSUER_PETNAME);

  if (tipIssuer === undefined) {
    console.error(
      'Cannot find TIP_ISSUER_PETNAME',
      TIP_ISSUER_PETNAME,
      'in home.wallet',
    );
    console.error('Have issuers:', [...issuers.keys()].join(', '));
    process.exit(1);
  }

  console.log('Installing contract');
  const issuerKeywordRecord = harden({ Tip: tipIssuer });
  const { creatorInvitation: adminInvitation, instance, publicFacet } = await E(
    zoe,
  ).startInstance(contractInstallation, issuerKeywordRecord);

  console.log('- SUCCESS! contract instance is running on Zoe');

  // Let's use the adminInvitation to make an offer. Note that we aren't
  // specifying any proposal, and we aren't escrowing any assets with
  // Zoe in this offer. We are doing this so that Zoe will eventually
  // give us a payout of all of the tips. We can trigger this payout
  // by calling the `complete` function on the `completeObj`.
  console.log('Retrieving admin');
  const adminSeat = E(zoe).offer(adminInvitation);
  const outcomeP = E(adminSeat).getOfferResult();

  // When the promise for a payout resolves, we want to deposit the
  // payments in our purses. We will put the adminPayoutP and
  // completeObj in our scratch location so that we can share the
  // live objects with the shutdown.js script.
  E(scratch).set('adminPayoutP', E(adminSeat).getPayouts());
  E(scratch).set('adminSeat', adminSeat);

  const outcome = await outcomeP;
  console.log(`-- ${outcome}`);

  console.log('Retrieving Board IDs for issuers and brands');
  const invitationIssuerP = E(zoe).getInvitationIssuer();
  const invitationBrandP = E(invitationIssuerP).getBrand();

  const assuranceIssuerP = E(publicFacet).getAssuranceIssuer();
  const asurranceBrandP = E(assuranceIssuerP).getBrand();
  const tipBrandP = E(tipIssuer).getBrand();

  // Now that we've done all the admin work, let's share this
  // instanceHandle by adding it to the board. Any users of our
  // contract will use this instanceHandle to get invitations to the
  // contract in order to make an offer.
  const invitationIssuer = await invitationIssuerP;
  const tipBrand = await tipBrandP;
  const assuranceIssuer = await assuranceIssuerP;
  const assuranceBrand = await asurranceBrandP;

  const [
    TIP_BRAND_BOARD_ID,
    INSTANCE_HANDLE_BOARD_ID,
    ASSURANCE_BRAND_BOARD_ID,
    ASSURANCE_ISSUER_BOARD_ID,
  ] = await Promise.all([
    E(board).getId(tipBrand),
    E(board).getId(instance),
    E(board).getId(assuranceBrand),
    E(board).getId(assuranceIssuer),
  ]);

  console.log(`-- Contract Name: ${CONTRACT_NAME}`);
  console.log(`-- INSTANCE_HANDLE_BOARD_ID: ${INSTANCE_HANDLE_BOARD_ID}`);
  console.log(`-- ASSURANCE_ISSUER_BOARD_ID: ${ASSURANCE_ISSUER_BOARD_ID}`);
  console.log(`-- ASSURANCE_BRAND_BOARD_ID: ${ASSURANCE_BRAND_BOARD_ID}`);
  console.log(`-- TIP_BRAND_BOARD_ID: ${TIP_BRAND_BOARD_ID}`);

  // We want the handler to run persistently. (Scripts such as this
  // deploy.js script are ephemeral and all connections to objects
  // within this script are severed when the script is done running.)

  const installLegacyHandler = async () => {
    // To run the handler persistently, we must use the spawner to run
    // the code on this machine even when the script is done running.

    // Bundle up the handler code
    const bundle = await bundleSource(pathResolve('./src/handler.js'));

    // Install it on the spawner
    const handlerInstall = E(spawner).install(bundle);

    // Spawn the running code
    const handler = E(handlerInstall).spawn({
      publicFacet,
      http,
      board,
      invitationIssuer,
    });
    await E(http).registerAPIHandler(handler);
  };

  const installPluginServer = async () => {
    // To run the API persistently, we ask the agoric deploy command to install an
    // HTTP server plugin into the running ag-solo, and give it access to the
    // publicFacet and other capabilities.
    //
    // The function is named installUnsafePlugin because, unlike any vat or
    // contract, the plugin will get full access to the OS-level account in which
    // the ag-solo is running.

    await installUnsafePlugin('./src/server.js', {
      port: API_PORT,
      host: API_HOST,
      CONTRACT_NAME,
      publicFacet,
      board,
      invitationIssuer,
    });
  };

  const installer =
    API_PORT === '8000' ? installLegacyHandler : installPluginServer;
  await installer();

  const invitationBrand = await invitationBrandP;
  const INVITE_BRAND_BOARD_ID = await E(board).getId(invitationBrand);

  const API_URL = process.env.API_URL || `http://127.0.0.1:${API_PORT || 8000}`;

  // Re-save the constants somewhere where the UI and api can find it.
  const dappConstants = {
    INSTANCE_HANDLE_BOARD_ID,
    INSTALLATION_HANDLE_BOARD_ID,
    INVITE_BRAND_BOARD_ID,
    // BRIDGE_URL: 'agoric-lookup:https://local.agoric.com?append=/bridge',
    brandBoardIds: {
      Tip: TIP_BRAND_BOARD_ID,
      Assurance: ASSURANCE_BRAND_BOARD_ID,
    },
    issuerBoardIds: { Assurance: ASSURANCE_ISSUER_BOARD_ID },
    BRIDGE_URL: 'http://127.0.0.1:8000',
    API_URL,
  };
  const defaultsFile = pathResolve(`../ui/public/conf/defaults.js`);
  console.log('writing', defaultsFile);
  const defaultsContents = `\
// GENERATED FROM ${pathResolve('./deploy.js')}
export default ${JSON.stringify(dappConstants, undefined, 2)};
`;
  await fs.promises.writeFile(defaultsFile, defaultsContents);
}

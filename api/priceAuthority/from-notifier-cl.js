// @ts-check
import { E } from '@agoric/far';

import { makeIssuerKit, AssetKind } from '@agoric/ertp'
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
 * @typedef {{ board: Board, chainTimerService, wallet, scratch, zoe }} Home
 * @param {Promise<Home>} homePromise
 * A promise for the references available from REPL home
 */
export default async function priceAuthorityfromNotifier(
  homePromise,
  { bundleSource, pathResolve },
) {
  const {
    FORCE_SPAWN = 'true',
    IN_ISSUER_JSON = JSON.stringify('LINK'),
    OUT_ISSUER_JSON = JSON.stringify('RUN'),
    PRICE_DECIMALS = '0',
    NOTIFIER_BOARD_ID,
    INSTANCE_HANDLE_BOARD_ID,
  } = process.env;

  if (!NOTIFIER_BOARD_ID) {
    console.error(`You must specify NOTIFIER_BOARD_ID`);
    process.exit(1);
  }

  if (!INSTANCE_HANDLE_BOARD_ID) {
    console.error(`You must specify INSTANCE_HANDLE_BOARD_ID`);
    process.exit(1);
  }

  // Let's wait for the promise to resolve.
  const home = await deeplyFulfilled(homePromise);

  // Unpack the references.
  const { board, scratch, wallet, zoe, chainTimerService: timer } = home;

  const issuersArray = await E(wallet).getIssuers();
  const issuerNames = issuersArray.map(([petname]) => JSON.stringify(petname));
  const issuerIn = await E(wallet).getIssuer(JSON.parse(IN_ISSUER_JSON));
  const issuerOut = await E(wallet).getIssuer(JSON.parse(OUT_ISSUER_JSON));

  if (issuerIn === undefined) {
    console.error(
      'Cannot find IN_ISSUER_JSON',
      IN_ISSUER_JSON,
      'in home.wallet',
    );
    console.error('Have issuers:', issuerNames.join(', '));
    process.exit(1);
  }

  if (issuerOut === undefined) {
    console.error(
      'Cannot find OUT_ISSUER_JSON',
      OUT_ISSUER_JSON,
      'in home.wallet',
    );
    console.error('Have issuers:', issuerNames.join(', '));
    process.exit(1);
  }

  const displayInfoOut = await E(E(issuerOut).getBrand()).getDisplayInfo();
  const { decimalPlaces: decimalPlacesOut = 0 } = displayInfoOut || {};

  // Take a price with priceDecimalPlaces and scale it to have decimalPlacesOut.
  const priceDecimalPlaces = parseInt(PRICE_DECIMALS, 10);
  const scaleValueOut = 10 ** (decimalPlacesOut - priceDecimalPlaces);

  // Get the notifier.
  const notifierId = NOTIFIER_BOARD_ID.replace(/^board:/, '');
  const notifier = E(board).getValue(notifierId);

  const oracleId = INSTANCE_HANDLE_BOARD_ID.replace(/^board:/, '');
  const oracleInstance = E(board).getValue(oracleId);

  let aggregator = await E(scratch).get('priceAggregatorChainlink');

  if (FORCE_SPAWN || !aggregator) {
    // Bundle up the notifierPriceAuthority code
    const bundle = await bundleSource(
      pathResolve('./src/chainlinkWrapper.js'),
    );

    // Install it in zoe
    const priceAgg = E(zoe).install(bundle);
    const quote = makeIssuerKit('quote', AssetKind.SET);

    // Start the contract
    aggregator = await E(zoe).startInstance(
      priceAgg,
      { In: issuerIn, Out: issuerOut },
      {
        timer,
        POLL_INTERVAL: 30n,
        // NOTE: here are the parameters to tune
        maxSubmissionCount: 1000,
        minSubmissionCount: 1,
        restartDelay: 5, // in seconds
        timeout: 10, // in seconds
        description: 'Chainlink oracles',
        minSubmissionValue: 1n,
        maxSubmissionValue: 2n ** 256n,
      },
    );
    await E(aggregator.creatorFacet).initializeQuoteMint(quote.mint);

    await E(scratch).set('priceAggregatorChainlink', aggregator);
    console.log('Stored priceAggregatorChainlink in scratch');
  }

  // Adapt the notifier to the price aggregator.
  const oracleAdmin = await E(
    aggregator.creatorFacet,
  ).initOracleWithNotifier(
    oracleInstance,
    notifier,
    Number(scaleValueOut),
  );
  await E(scratch).set('oracleAdmin', oracleAdmin);
  console.log('Stored oracleAdmin in scratch');

  const priceAuthority = await E(aggregator.publicFacet).getPriceAuthority();
  const PRICE_AUTHORITY_BOARD_ID = await E(board).getId(priceAuthority);
  console.log('-- PRICE_AUTHORITY_BOARD_ID:', PRICE_AUTHORITY_BOARD_ID);
}

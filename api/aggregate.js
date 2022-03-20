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
 * @param {object} root0
 * @param {Function} root0.bundleSource
 * @param {Function} root0.pathResolve
 * A promise for the references available from REPL home
 */
export default async function priceAuthorityfromNotifier(
  homePromise,
  { bundleSource, pathResolve },
) {
  const {
    FORCE_SPAWN,
    IN_ISSUER_JSON = JSON.stringify('BLD'),
    OUT_ISSUER_JSON = JSON.stringify('USD'),
    PRICE_DECIMALS = '0',
    NOTIFIER_BOARD_ID,
    INSTANCE_HANDLE_BOARD_ID,
  } = process.env;

  // Let's wait for the promise to resolve.
  const home = await deeplyFulfilled(homePromise);

  // Unpack the references.
  const { board, scratch, zoe, chainTimerService: timer } = home;

  const [brandIn, brandOut] = await Promise.all([
    E(home.agoricNames).lookup('brand', JSON.parse(IN_ISSUER_JSON)),
    E(home.agoricNames).lookup('brand', JSON.parse(OUT_ISSUER_JSON)),
  ]);

  let aggregator = await E(scratch).get('priceAggregatorChainlink');

  if (FORCE_SPAWN || !aggregator) {
    // Bundle up the notifierPriceAuthority code
    const bundle = await bundleSource(pathResolve('./src/chainlinkWrapper.js'));

    // Install it in zoe
    const priceAgg = E(zoe).install(bundle);

    // Start the contract
    aggregator = await E(zoe).startInstance(priceAgg, undefined, {
      brandIn,
      brandOut,
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
    });

    await E(scratch).set('priceAggregatorChainlink', aggregator);
    console.log('Stored priceAggregatorChainlink in scratch');
  }

  // Get the notifier.
  if (NOTIFIER_BOARD_ID || INSTANCE_HANDLE_BOARD_ID) {
    assert(NOTIFIER_BOARD_ID);
    assert(INSTANCE_HANDLE_BOARD_ID);
    const notifierId = NOTIFIER_BOARD_ID.replace(/^board:/, '');
    const oracleId = INSTANCE_HANDLE_BOARD_ID.replace(/^board:/, '');

    const notifier = E(board).getValue(notifierId);
    const oracleInstance = E(board).getValue(oracleId);

    /** @param {ERef<Brand>} brand */
    const getDecimalP = async brand => {
      const displayInfo = E(brand).getDisplayInfo();
      return E.get(displayInfo).decimalPlaces;
    };
    const [decimalPlacesIn = 0, decimalPlacesOut = 0] = await Promise.all([
      getDecimalP(brandIn),
      getDecimalP(brandOut),
    ]);

    // Take a price with priceDecimalPlaces and scale it to have decimalPlacesOut - decimalPlacesIn.
    const priceDecimalPlaces = parseInt(PRICE_DECIMALS, 10);
    const scaleValueOut =
      10 ** (decimalPlacesOut - decimalPlacesIn - priceDecimalPlaces);

    // Adapt the notifier to the price aggregator.
    const oracleAdmin = await E(aggregator.creatorFacet).initOracleWithNotifier(
      oracleInstance,
      notifier,
      Number(scaleValueOut),
    );
    const oadmin = `oracleAdminFor${oracleId}`;
    await E(scratch).set(oadmin, oracleAdmin);
    console.log(
      `Stored oracleAdmin in E(scratch).get(${JSON.stringify(oadmin)})`,
    );
  }

  const priceAuthority = await E(aggregator.publicFacet).getPriceAuthority();

  const AGGREGATOR_INSTANCE_ID = await E(board).getId(aggregator.instance);
  console.log(`-- AGGREGATOR_INSTANCE_ID=${AGGREGATOR_INSTANCE_ID}`);
  const PRICE_AUTHORITY_BOARD_ID = await E(board).getId(priceAuthority);
  console.log(`-- PRICE_AUTHORITY_BOARD_ID=${PRICE_AUTHORITY_BOARD_ID}`);
}

/* global process */
// @ts-check
import { E } from '@agoric/far';
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
 * @typedef {{ board: Board, chainTimerService, agoricNames, scratch, spawner }} Home
 * @param {Promise<Home>} homePromise
 * @param {Object} root0
 * @param {(filename: string) => Promise<any>} root0.bundleSource
 * @param {(filename: string) => string} root0.pathResolve
 * A promise for the references available from REPL home
 */
export default async function priceAuthorityfromNotifier(
  homePromise,
  { bundleSource, pathResolve },
) {
  const {
    FORCE_SPAWN = 'true',
    IN_ISSUER_JSON = JSON.stringify('BLD'),
    OUT_ISSUER_JSON = JSON.stringify('USD'),
    PRICE_DECIMALS = '0',
    NOTIFIER_BOARD_ID,
  } = process.env;

  if (!NOTIFIER_BOARD_ID) {
    console.error(`You must specify PRICE_AUTHORITY_BOARD_ID`);
    process.exit(1);
  }

  // Let's wait for the promise to resolve.
  const home = await homePromise;

  // Unpack the references.
  const { board, scratch, spawner, chainTimerService: timer } = home;

  const [issuerIn, issuerOut] = await Promise.all([
    E(home.agoricNames).lookup('issuer', JSON.parse(IN_ISSUER_JSON)),
    E(home.agoricNames).lookup('issuer', JSON.parse(OUT_ISSUER_JSON)),
  ]);

  const displayInfoIn = await E(E(issuerIn).getBrand()).getDisplayInfo();
  const { decimalPlaces: decimalPlacesIn = 0 } = displayInfoIn || {};

  const unitValueIn = 10n ** BigInt(decimalPlacesIn);

  const displayInfoOut = await E(E(issuerOut).getBrand()).getDisplayInfo();
  const { decimalPlaces: decimalPlacesOut = 0 } = displayInfoOut || {};

  // Take a price with priceDecimalPlaces and scale it to have decimalPlacesOut.
  const priceDecimalPlaces = JSON.parse(PRICE_DECIMALS);
  const scaleValueOut = 10 ** (decimalPlacesOut - priceDecimalPlaces);

  // Get the notifier.
  const notifierId = NOTIFIER_BOARD_ID.replace(/^board:/, '');
  const notifier = E(board).getValue(notifierId);

  let priceAuthorityFactory = E(scratch).get('priceAuthorityFactory');

  if (FORCE_SPAWN || !priceAuthorityFactory) {
    // Bundle up the notifierPriceAuthority code
    const bundle = await bundleSource(pathResolve('./factory.js'));

    // Install it on the spawner
    const notifierFactory = E(spawner).install(bundle);

    // Spawn the running code
    priceAuthorityFactory = await E(notifierFactory).spawn();

    await E(scratch).set('priceAuthorityFactory', priceAuthorityFactory);
    console.log('Stored priceAuthorityFactory in scratch');
  }

  console.log('Waiting for first valid quote from push notifier...');
  const priceAuthority = await E(
    priceAuthorityFactory,
  ).makeNotifierPriceAuthority({
    notifier,
    issuerIn,
    issuerOut,
    timer,
    unitValueIn,
    scaleValueOut,
  });

  const PRICE_AUTHORITY_BOARD_ID = await E(board).getId(priceAuthority);
  console.log('-- PRICE_AUTHORITY_BOARD_ID:', PRICE_AUTHORITY_BOARD_ID);
}

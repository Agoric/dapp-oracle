/* global process */
// @ts-check
import { E } from '@agoric/far';
import '@agoric/zoe/exported';
import '@agoric/zoe/src/contracts/exported';

/**
 * @typedef {Object} DeployPowers The special powers that `agoric deploy` gives us
 * @property {(path: string) => Promise<{ moduleFormat: string, source: string }>} bundleSource
 * @property {(path: string) => string} pathResolve
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
 * @param {(...path: string[]) => Promise<any>} root0.lookup
 * A promise for the references available from REPL home
 */
export default async function priceAuthorityInvert(
  homePromise,
  { bundleSource, pathResolve, lookup },
) {
  const {
    FORCE_SPAWN = 'true',
    IN_BRAND_LOOKUP = JSON.stringify(['wallet', 'brand', 'RUN']),
    OUT_BRAND_LOOKUP = JSON.stringify(['agoricNames', 'oracleBrand', 'USD']),
    PRICE_AUTHORITY_BOARD_ID,
  } = process.env;

  if (!PRICE_AUTHORITY_BOARD_ID) {
    console.error(`You must specify PRICE_AUTHORITY_BOARD_ID`);
    process.exit(1);
  }

  // Let's wait for the promise to resolve.
  const home = await homePromise;

  // Unpack the references.
  const { board, scratch, spawner, chainTimerService: timer } = home;

  const [brandIn, brandOUt] = await Promise.all([
    lookup(JSON.parse(IN_BRAND_LOOKUP)),
    lookup(JSON.parse(OUT_BRAND_LOOKUP)),
  ]);

  const priceAuthority = await E(board).getValue(PRICE_AUTHORITY_BOARD_ID);
  let priceAuthorityFactory = E(scratch).get('priceAuthorityFactory');

  if (FORCE_SPAWN || !priceAuthorityFactory) {
    // Bundle up the priceAuthorityFactory code
    const bundle = await bundleSource(
      pathResolve('./src/priceAuthorityFactory.js'),
    );

    // Install it on the spawner
    const notifierFactory = E(spawner).install(bundle);

    // Spawn the running code
    priceAuthorityFactory = await E(notifierFactory).spawn();

    await E(scratch).set('priceAuthorityFactory', priceAuthorityFactory);
    console.log('Stored priceAuthorityFactory in scratch');
  }

  console.log('Waiting for first valid quote from push notifier...');
  const inversePriceAuthority = await E(
    priceAuthorityFactory,
  ).makeInversePriceAuthority({
    priceAuthority,
    brandIn,
    brandOUt,
    timer,
  });

  const INVERSE_PRICE_AUTHORITY_BOARD_ID = await E(board).getId(
    inversePriceAuthority,
  );
  console.log(
    '-- INVERSE_PRICE_AUTHORITY_BOARD_ID:',
    INVERSE_PRICE_AUTHORITY_BOARD_ID,
  );
}

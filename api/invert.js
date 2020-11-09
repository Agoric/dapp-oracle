// @ts-check
import { E } from '@agoric/eventual-send';
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
 * @typedef {{ board: Board, chainTimerService, wallet, scratch, spawner }} Home
 * @param {Promise<Home>} homePromise
 * A promise for the references available from REPL home
 */
export default async function priceAuthorityInvert(
  homePromise,
  { bundleSource, pathResolve },
) {
  const {
    FORCE_SPAWN = 'true',
    IN_ISSUER_JSON = JSON.stringify('Testnet.$LINK'),
    OUT_ISSUER_JSON = JSON.stringify('Testnet.$USD'),
    PRICE_AUTHORITY_BOARD_ID,
  } = process.env;

  if (!PRICE_AUTHORITY_BOARD_ID) {
    console.error(`You must specify PRICE_AUTHORITY_BOARD_ID`);
    process.exit(1);
  }

  // Let's wait for the promise to resolve.
  const home = await homePromise;

  // Unpack the references.
  const { board, scratch, wallet, spawner, chainTimerService: timer } = home;

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
    issuerIn,
    issuerOut,
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

/* global process */
// @ts-check
import { E } from '@agoric/far';
import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

/**
 * @typedef {Object} Board
 * @property {(id: string) => any} getValue
 * @property {(value: any) => string} getId
 * @property {(value: any) => boolean} has
 * @property {() => [string]} ids
 */

/**
 * @typedef {{ zoe: ZoeService, board: Board, agoricNames, scratch, priceAuthorityAdmin }} Home
 * @param {Promise<Home>} homePromise
 * A promise for the references available from REPL home
 * @param {object} root0
 * @param {(...path: string[]) => Promise<any>} root0.lookup
 */
export default async function registerPriceAuthority(homePromise, { lookup }) {
  const {
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
  const { board, priceAuthorityAdmin, scratch } = home;

  if (!priceAuthorityAdmin) {
    console.error(
      `You need to ask somebody with "agoric.priceAuthorityAdmin" power to run this command.`,
    );
    process.exit(1);
  }

  const priceAuthorityId = PRICE_AUTHORITY_BOARD_ID.replace(/^board:/, '');
  const priceAuthority = E(board).getValue(priceAuthorityId);

  const [brandIn, brandOut] = await Promise.all([
    lookup(JSON.parse(IN_BRAND_LOOKUP)),
    lookup(JSON.parse(OUT_BRAND_LOOKUP)),
  ]);

  const deleter = await E(priceAuthorityAdmin).registerPriceAuthority(
    priceAuthority,
    brandIn,
    brandOut,
    true,
  );

  const DELETER_NAME = `delete ${IN_BRAND_LOOKUP}-${OUT_BRAND_LOOKUP}`;
  await E(scratch).set(DELETER_NAME, deleter);

  console.log(`Delete this registration with:`);
  console.log(`home.scratch~.get(${JSON.stringify(DELETER_NAME)})~.delete()`);
}

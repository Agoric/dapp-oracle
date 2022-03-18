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
 */
export default async function registerPriceAuthority(homePromise) {
  const {
    IN_ISSUER_JSON = JSON.stringify('BLD'),
    OUT_ISSUER_JSON = JSON.stringify('USD'),
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
    E(home.agoricNames).lookup('brand', JSON.parse(IN_ISSUER_JSON)),
    E(home.agoricNames).lookup('brand', JSON.parse(OUT_ISSUER_JSON)),
  ]);

  const deleter = await E(priceAuthorityAdmin).registerPriceAuthority(
    priceAuthority,
    brandIn,
    brandOut,
    true,
  );

  const DELETER_NAME = `delete ${IN_ISSUER_JSON}-${OUT_ISSUER_JSON}`;
  await E(scratch).set(DELETER_NAME, deleter);

  console.log(`Delete this registration with:`);
  console.log(`home.scratch~.get(${JSON.stringify(DELETER_NAME)})~.delete()`);
}

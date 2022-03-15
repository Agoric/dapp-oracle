// @ts-check
/* global process */
import { E } from '@agoric/far';

import { AmountMath } from '@agoric/ertp';
import { deeplyFulfilled } from '@endo/marshal';

import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

// What minimum percentage of the price difference should result in a notification?
const THRESHOLD = 0.1;

// What minimum absolute change in price should result in a notification?
const ABSOLUTE_THRESHOLD = 0;

// This is the query submitted to the oracle.
const PRICE_QUERY = {
  jobId: 'b0b5cafec0ffeeee',
  params: {
    get: 'https://bitstamp.net/api/ticker/',
    path: ['last'],
    times: 100,
  },
};

// If no new round is started in this number of seconds, the oracle will initiate a new round.
const IDLE_TIMER_PERIOD_S = 10n * 60n;

// This is the number of seconds between each poll.
const POLL_TIMER_PERIOD_S = 60n;

// This is sent to the oracle node as the fee amount for the flux monitor
// query.  It isn't actually a real payment, just something to tell the oracle
// job that it has permission to run.
const FEE_PAYMENT_VALUE = 0n;

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
export default async function priceAuthorityfromNotifier(homePromise) {
  const {
    FEE_ISSUER_JSON = JSON.stringify('LINK'),
    AGGREGATOR_INSTANCE_ID,
  } = process.env;

  // Let's wait for the promise to resolve.
  const home = await deeplyFulfilled(homePromise);

  // Unpack the references.
  const { board, scratch, wallet, zoe, localTimerService: timerService } = home;

  const issuersArray = await E(wallet).getIssuers();
  const issuerNames = issuersArray.map(([petname]) => JSON.stringify(petname));
  const feeIssuer = await E(wallet).getIssuer(JSON.parse(FEE_ISSUER_JSON));

  if (feeIssuer === undefined) {
    console.error(
      'Cannot find FEE_ISSUER_JSON',
      FEE_ISSUER_JSON,
      'in home.wallet',
    );
    console.error('Have issuers:', issuerNames.join(', '));
    process.exit(1);
  }

  let roundStartNotifier;
  if (AGGREGATOR_INSTANCE_ID) {
    const aggregatorInstance = await E(board).getValue(AGGREGATOR_INSTANCE_ID);
    roundStartNotifier = E(
      E(zoe).getPublicFacet(aggregatorInstance),
    ).getRoundStartNotifier();
  }

  const [feeBrand, oracleHandler, oracleMaster] = await Promise.all([
    E(feeIssuer).getBrand(),
    E(scratch).get('oracleHandler'),
    E(scratch).get('oracleMaster'),
  ]);

  const DEBUGGING_SPEED_FACTOR = process.env.DEBUG ? 60n : 1n;

  // Create an iterable to drive the query poll loop.
  let pollIterable;
  if (POLL_TIMER_PERIOD_S) {
    const pollTickIterable = E(oracleMaster).makePeriodicTickIterable(
      Number((POLL_TIMER_PERIOD_S * 1000n) / DEBUGGING_SPEED_FACTOR),
    );
    pollIterable = E(oracleMaster).makeTimerIterable(
      pollTickIterable,
      timerService,
    );
  }

  // Put everything together into a flux monitor.
  const fluxNotifier = await E(oracleMaster).makeFluxNotifier(
    {
      query: PRICE_QUERY,
      fee: AmountMath.make(feeBrand, FEE_PAYMENT_VALUE),
      absoluteThreshold: ABSOLUTE_THRESHOLD,
      fractionalThreshold: THRESHOLD / 100.0,
      idleTimerTicks: (IDLE_TIMER_PERIOD_S * 1000n) / DEBUGGING_SPEED_FACTOR,
    },
    { pollIterable, timerService, oracleHandler, roundStartNotifier },
  );

  const NOTIFIER_BOARD_ID = await E(board).getId(fluxNotifier);
  console.log('-- NOTIFIER_BOARD_ID:', NOTIFIER_BOARD_ID);
}

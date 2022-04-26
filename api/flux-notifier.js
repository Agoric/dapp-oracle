// @ts-check
/* global process */
import { E } from '@agoric/far';

import { AmountMath } from '@agoric/ertp';
import { deeplyFulfilled } from '@endo/marshal';

import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

import * as params from './flux-params.js';

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
 * @param {(...path: string[]) => Promise<any>} root0.lookup
 * A promise for the references available from REPL home
 */
export default async function priceAuthorityfromNotifier(
  homePromise,
  { lookup },
) {
  const {
    AGGREGATOR_INSTANCE_LOOKUP,
    FEE_ISSUER_LOOKUP = JSON.stringify(['wallet', 'issuer', 'RUN']),
    IN_BRAND_LOOKUP = JSON.stringify(['wallet', 'brand', 'RUN']),
    OUT_BRAND_LOOKUP = JSON.stringify(['agoricNames', 'oracleBrand', 'USD']),
  } = process.env;

  // Let's wait for the promise to resolve.
  const home = await deeplyFulfilled(homePromise);

  // Unpack the references.
  const { board, scratch, localTimerService: timerService } = home;

  const feeBrand = await E(lookup(JSON.parse(FEE_ISSUER_LOOKUP))).getBrand();

  let aggregatorInstance;
  if (AGGREGATOR_INSTANCE_LOOKUP) {
    aggregatorInstance = await lookup(JSON.parse(AGGREGATOR_INSTANCE_LOOKUP));
  }

  if (!aggregatorInstance) {
    console.log('Autodetecting aggregator instance...');
    const purse = E(home.wallet).getPurse('Default Zoe invite purse');
    const { value } = await E(purse).getCurrentAmount();
    const invitations = value.filter(
      ({ description }) => description === 'oracle invitation',
    );
    if (invitations.length > 1) {
      console.error('Multiple oracle invitations found', invitations);
      throw new Error('You need an AGGREGATOR_INSTANCE_LOOKUP to disambiguate');
    }
    if (invitations.length === 0) {
      throw new Error(
        'No oracle invitations found; you need an AGGREGATOR_INSTANCE_LOOKUP',
      );
    }
    console.log('Found oracle invitation', invitations);
    aggregatorInstance = invitations[0].instance;
  }

  let roundStartNotifier;
  if (aggregatorInstance) {
    const publicFacet = E(home.zoe).getPublicFacet(aggregatorInstance);
    roundStartNotifier = await E(publicFacet).getRoundStartNotifier();
  }

  console.log('Round start notifier:', roundStartNotifier || '*none*');

  const [oracleHandler, oracleMaster] = await Promise.all([
    E(scratch).get('oracleHandler'),
    E(scratch).get('oracleMaster'),
  ]);

  const DEBUGGING_SPEED_FACTOR = process.env.DEBUG ? 60n : 1n;

  // Create an iterable to drive the query poll loop.
  let pollIterable;
  if (params.POLL_TIMER_PERIOD_S) {
    const pollTickIterable = E(oracleMaster).makePeriodicTickIterable(
      Number((params.POLL_TIMER_PERIOD_S * 1000n) / DEBUGGING_SPEED_FACTOR),
    );
    pollIterable = E(oracleMaster).makeTimerIterable(
      pollTickIterable,
      timerService,
    );
  }

  // Put everything together into a flux monitor.
  console.log('Waiting for first price query...');
  const fluxNotifier = await E(oracleMaster).makeFluxNotifier(
    {
      query: params.PRICE_QUERY,
      fee: AmountMath.make(feeBrand, params.FEE_PAYMENT_VALUE),
      absoluteThreshold: params.ABSOLUTE_THRESHOLD,
      fractionalThreshold: params.THRESHOLD / 100.0,
      idleTimerTicks:
        (params.IDLE_TIMER_PERIOD_S * 1000n) / DEBUGGING_SPEED_FACTOR,
    },
    { pollIterable, timerService, oracleHandler, roundStartNotifier },
  );

  const { value } = await E(fluxNotifier).getUpdateSince();
  console.log(`First price query:`, value);

  const NOTIFIER_BOARD_ID = await E(board).getId(fluxNotifier);
  console.log(`-- NOTIFIER_BOARD_ID=${NOTIFIER_BOARD_ID}`);

  if (!aggregatorInstance) {
    return;
  }

  /** @param {ERef<Brand>} brand */
  const getDecimalP = async brand => {
    const displayInfo = E(brand).getDisplayInfo();
    return E.get(displayInfo).decimalPlaces;
  };
  const [decimalPlacesIn = 0, decimalPlacesOut = 0] = await Promise.all([
    getDecimalP(lookup(JSON.parse(IN_BRAND_LOOKUP))),
    getDecimalP(lookup(JSON.parse(OUT_BRAND_LOOKUP))),
  ]);

  // Take a price with priceDecimalPlaces and scale it to have decimalPlacesOut - decimalPlacesIn.
  const scaleValueOut =
    10 ** (decimalPlacesOut - decimalPlacesIn - params.PRICE_DECIMALS);

  const offer = {
    id: Date.now(),
    proposalTemplate: {
      arguments: { notifier: fluxNotifier, scaleValueOut },
    },
    invitationQuery: {
      description: 'oracle invitation',
      instance: aggregatorInstance,
    },
  };

  // Consume an aggregator invitation for this instance.
  console.log(
    `Please approve your wallet's proposal to connect the aggregator ${aggregatorInstance}...`,
  );
  const bridge = E(home.wallet).getBridge();
  await E(bridge).addOffer(offer, { dappOrigin: 'oracle script' });
}

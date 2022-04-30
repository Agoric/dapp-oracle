// @ts-check
/* global process */
import { E } from '@agoric/far';

import { AmountMath } from '@agoric/ertp';
import { deeplyFulfilled } from '@endo/marshal';

import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
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
export default async function priceAuthorityFromNotifier(
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
      console.error(
        'No oracle invitations found; you may need an AGGREGATOR_INSTANCE_LOOKUP',
      );
    } else {
      console.log('Found oracle invitation', invitations);
      aggregatorInstance = invitations[0].instance;
    }
  }

  let roundStartNotifier;
  if (aggregatorInstance) {
    const publicFacet = E(home.zoe).getPublicFacet(aggregatorInstance);
    roundStartNotifier = await E(publicFacet).getRoundStartNotifier();
  }

  console.log('Round start notifier:', roundStartNotifier || '*none*');

  const [
    oracleHandler,
    oracleMaster,
    replaceableNotifiers,
    brandIn,
    brandOut,
  ] = await Promise.all([
    E(scratch).get('oracleHandler'),
    E(scratch).get('oracleMaster'),
    E(scratch).get('replaceableNotifiers'),
    lookup(JSON.parse(IN_BRAND_LOOKUP)),
    lookup(JSON.parse(OUT_BRAND_LOOKUP)),
  ]);

  /**
   * We need the in and out brands' decimalPlaces to be able to make price
   * ratios from their fixed-point values.  The only time we can ignore
   * decimalPlaces when doing math on amount values is when the amount brands
   * match.  In and out brands do not match.
   *
   * @param {ERef<Brand>} brand
   */
  const getDecimalP = async brand => {
    const displayInfo = E(brand).getDisplayInfo();
    return E.get(displayInfo).decimalPlaces;
  };
  const [decimalPlacesIn = 0, decimalPlacesOut = 0] = await Promise.all([
    getDecimalP(brandIn),
    getDecimalP(brandOut),
  ]);

  // Take a price with priceDecimalPlaces and scale it to have decimalPlacesOut - decimalPlacesIn.
  const shiftValueOut =
    decimalPlacesOut - decimalPlacesIn - params.PRICE_DECIMALS;

  /** @type {Ratio} */
  let priceScale;
  if (shiftValueOut < 0) {
    priceScale = makeRatio(
      1n,
      brandOut,
      10n ** BigInt(-shiftValueOut),
      brandIn,
    );
  } else {
    priceScale = makeRatio(10n ** BigInt(shiftValueOut), brandOut, 1n, brandIn);
  }

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
      priceScale,
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

  const replaceableNotifier = await E(replaceableNotifiers).replace(
    [brandIn, brandOut],
    fluxNotifier,
  );

  const NOTIFIER_BOARD_ID = await E(board).getId(replaceableNotifier);
  console.log(`-- NOTIFIER_BOARD_ID=${NOTIFIER_BOARD_ID}`);

  if (!aggregatorInstance) {
    return;
  }

  const offer = {
    id: Date.now(),
    proposalTemplate: {
      arguments: { notifier: replaceableNotifier },
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

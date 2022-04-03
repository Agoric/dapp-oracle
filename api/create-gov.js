/* global process */
import { E } from '@endo/far';
import fs from 'fs';

import { makeHelpers } from '@agoric/deploy-script-support';

export const createGov = async (homeP, endowments) => {
  const { board, scratch, zoe } = E.get(homeP);
  const { bundleSource, pathResolve, lookup } = endowments;

  const {
    FORCE_SPAWN,
    AGORIC_INSTANCE_NAME,
    BUNDLER_MAKER_LOOKUP,
    IN_BRAND_LOOKUP = JSON.stringify(['wallet', 'brand', 'BLD']),
    OUT_BRAND_LOOKUP = JSON.stringify(['agoricNames', 'oracleBrand', 'USD']),
    ORACLE_ADDRESSES,
  } = process.env;

  assert(AGORIC_INSTANCE_NAME, 'AGORIC_INSTANCE_NAME is required');
  assert(ORACLE_ADDRESSES, 'ORACLE_ADDRESSES is required');

  const oracleAddresses = ORACLE_ADDRESSES.split(',');

  const { getBundlerMaker, installInPieces } = await makeHelpers(
    homeP,
    endowments,
  );

  let aggInstall = await E(scratch).get('priceAggregatorInstall');
  if (FORCE_SPAWN || !aggInstall) {
    const bundler = E(getBundlerMaker({ BUNDLER_MAKER_LOOKUP })).makeBundler({
      zoe,
    });
    const bundle = await bundleSource(pathResolve('./src/chainlinkWrapper.js'));
    aggInstall = await installInPieces(bundle, bundler);
    await E(scratch).set('priceAggregatorInstall', aggInstall);
    console.log('Stored priceAggregatorInstall in scratch');
  }

  // Find the in and out brands.
  const [brandIn, brandOut] = await Promise.all([
    lookup(JSON.parse(IN_BRAND_LOOKUP)),
    lookup(JSON.parse(OUT_BRAND_LOOKUP)),
  ]);

  // Assign board Ids to everything.
  const [aggInstallId, brandInId, brandOutId] = await Promise.all([
    E(board).getId(aggInstall),
    E(board).getId(brandIn),
    E(board).getId(brandOut),
  ]);

  const EVAL_PERMIT = `gov-price-feed-permit.json`;
  const EVAL_CODE = `gov-price-feed.js`;

  console.log('creating permit', EVAL_PERMIT);
  fs.writeFileSync(
    EVAL_PERMIT,
    JSON.stringify(
      {
        consume: {
          aggregators: true,
          board: true,
          chainTimerService: true,
          client: true,
          namesByAddress: true,
          priceAuthority: true,
          priceAuthorityAdmin: true,
          zoe: true,
        },
        instance: {
          produce: {
            [AGORIC_INSTANCE_NAME]: true,
          },
        },
        produce: { aggregators: true },
      },
      null,
      2,
    ),
  );

  console.log('creating code', EVAL_CODE);
  const evalCode = `\
// create-gov.js initially created this file.
/* eslint-disable */

const AGORIC_INSTANCE_NAME = ${JSON.stringify(AGORIC_INSTANCE_NAME)};

const contractTerms = {
  POLL_INTERVAL: 30n,
  maxSubmissionCount: 1000,
  minSubmissionCount: 1,
  restartDelay: 5, // in seconds according to chainTimerService
  timeout: 10, // in seconds according to chainTimerService
  description: AGORIC_INSTANCE_NAME,
  minSubmissionValue: 1n,
  maxSubmissionValue: 2n ** 256n,
};

const oracleAddresses = ${JSON.stringify(oracleAddresses, null, 2)};

const aggInstallId = ${JSON.stringify(aggInstallId)};
const brandInId = ${JSON.stringify(brandInId)};
const brandOutId = ${JSON.stringify(brandOutId)};

const behavior = async ({
  consume: { aggregators, board, chainTimerService, client, namesByAddress, priceAuthority, priceAuthorityAdmin, zoe },
  produce: { aggregators: produceAggregators },
  instance: { produce: { [AGORIC_INSTANCE_NAME]: instanceProduce } },
}) => {
  // Default to an empty Map and home.priceAuthority.
  produceAggregators.resolve(new Map());
  E(client).assignBundle([_addr => ({ priceAuthority })]);

  // Look up everything needed by the terms.
  const [aggInstall, brandIn, brandOut, timer] = await Promise.all([
    E(board).getValue(aggInstallId),
    E(board).getValue(brandInId),
    E(board).getValue(brandOutId),
    chainTimerService,
  ]);

  const terms = {
    ...contractTerms,
    brandIn,
    brandOut,
    timer,
  };

  // Create the price feed.
  const aggregator = await E(zoe).startInstance(aggInstall, undefined, terms);
  E(aggregators).set(terms, { aggregator });
  
  // Publish instance in agoricNames.
  instanceProduce.resolve(aggregator.instance);

  // Publish price feed in home.priceAuthority.
  const forceReplace = true;
  E(priceAuthorityAdmin).registerPriceAuthority(
    E(aggregator).getPriceAuthority(),
    brandIn,
    brandOut,
    forceReplace,
  ).then(deleter => E(aggregators).set(terms, { aggregator, deleter }));

  // Send the invitations to the oracles.
  await Promise.all(oracleAddresses.map(async (oracleAddress) => {
    const depositFacet = E(namesByAddress).lookup(oracleAddress, 'depositFacet');

    const invitation = await E(aggregator.creatorFacet).makeOracleInvitation(oracleAddress);
    await E(depositFacet).receive(invitation);
  }));
};

behavior;
`;

  fs.writeFileSync(EVAL_CODE, evalCode);

  console.log(`\
========= Do something like the following: =========
agd tx gov submit-proposal swingset-core-eval ${EVAL_PERMIT} ${EVAL_CODE} \\
  --title="Enable ${AGORIC_INSTANCE_NAME}" --description="Evaluate ${EVAL_CODE}" --deposit=1000000ubld \\
  --gas=auto --gas-adjustment=1.2
`);
};

export default createGov;

// create-gov.js initially created this file.
/* eslint-disable */

const AGORIC_INSTANCE_NAME = "BLD-USD priceAggregator";

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

const oracleAddresses = [
  "agoric14rxtq7g2jfwyyxv43tgj2e962qvh55aup8e8ke",
  "agoric1xm6lhkzapupmyulgkzjukqyvjndkpptt2qg47d",
  "agoric1vqkgfumpn8j5v8zv45h66sls6stawzg0rjjsvh"
];

const aggInstallId = "1675202761";
const brandInId = "433864835";
const brandOutId = "796371127";

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
  const deleter = await E(priceAuthorityAdmin).registerPriceAuthority(
    E(aggregator).getPriceAuthority(),
    brandIn,
    brandOut,
    forceReplace,
  );
  E(aggregators).set(terms, { aggregator, deleter });

  // Send the invitations to the oracles.
  await Promise.all(oracleAddresses.map(async (oracleAddress) => {
    const depositFacet = E(namesByAddress).lookup(oracleAddress, 'depositFacet');

    const invitation = await E(aggregator.creatorFacet).makeOracleInvitation(oracleAddress);
    await E(depositFacet).receive(invitation);
  }));
};

behavior;

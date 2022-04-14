/* global process */
import { makeHelpers } from '@agoric/deploy-script-support';

const DEFAULT_CONTRACT_TERMS = {
  POLL_INTERVAL: 30n,
  maxSubmissionCount: 1000,
  minSubmissionCount: 1,
  restartDelay: 5, // in seconds according to chainTimerService
  timeout: 10, // in seconds according to chainTimerService
  minSubmissionValue: 1n,
  maxSubmissionValue: 2n ** 256n,
};

export const makeCoreProposalBuilder = ({
  brandIn,
  brandOut,
  contractTerms = DEFAULT_CONTRACT_TERMS,
  ...optionsRest
}) => async ({ publishRef, install }) =>
  harden({
    sourceSpec: './src/coreProposal.js',
    getManifestCall: [
      'getManifestForPriceFeed',
      {
        ...optionsRest,
        contractTerms,
        brandInRef: publishRef(brandIn),
        brandOutRef: publishRef(brandOut),
        priceAggregatorRef: publishRef(install('./src/chainlinkWrapper')),
      },
    ],
  });

export const createGov = async (homeP, endowments) => {
  const { lookup } = endowments;

  const {
    AGORIC_INSTANCE_NAME,
    IN_BRAND_LOOKUP = JSON.stringify(['wallet', 'brand', 'BLD']),
    OUT_BRAND_LOOKUP = JSON.stringify(['agoricNames', 'oracleBrand', 'USD']),
    ORACLE_ADDRESSES,
  } = process.env;

  assert(AGORIC_INSTANCE_NAME, 'AGORIC_INSTANCE_NAME is required');
  assert(ORACLE_ADDRESSES, 'ORACLE_ADDRESSES is required');

  const oracleAddresses = ORACLE_ADDRESSES.split(',');

  const { writeCoreProposal } = await makeHelpers(homeP, endowments);

  const proposalBuilder = makeCoreProposalBuilder({
    AGORIC_INSTANCE_NAME,
    oracleAddresses,
    brandIn: lookup(JSON.parse(IN_BRAND_LOOKUP)),
    brandOut: lookup(JSON.parse(OUT_BRAND_LOOKUP)),
  });
  await writeCoreProposal('gov-price-feed', proposalBuilder); // gov-price-feed.js gov-price-feed-permit.json
};

export default createGov;

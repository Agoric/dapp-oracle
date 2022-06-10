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
  AGGREGATOR_INSTANCE_NAME,
  ...optionsRest
} = {}) => async ({ publishRef, install }) =>
  harden({
    sourceSpec: '../src/core-proposal.js',
    getManifestCall: [
      'getManifestForPriceFeed',
      {
        ...optionsRest,
        contractTerms,
        AGGREGATOR_INSTANCE_NAME,
        brandInRef: publishRef(brandIn),
        brandOutRef: publishRef(brandOut),
        ...(AGGREGATOR_INSTANCE_NAME && {
          priceAggregatorRef: publishRef(
            install(
              '@agoric/zoe/src/contracts/priceAggregator.js',
              '../bundles/bundle-priceAggregator.js',
            ),
          ),
        }),
      },
    ],
  });

export const createGov = async (homeP, endowments) => {
  const { lookup } = endowments;

  const {
    AGORIC_INSTANCE_NAME,
    IN_BRAND_DECIMALS,
    IN_BRAND_LOOKUP = JSON.stringify(['wallet', 'brand', 'BLD']),
    OUT_BRAND_DECIMALS,
    OUT_BRAND_LOOKUP = JSON.stringify(['agoricNames', 'oracleBrand', 'USD']),
    ORACLE_ADDRESSES,
    DELETE_ORACLE_ADDRESSES,
  } = process.env;

  const oracleAddresses = ORACLE_ADDRESSES ? ORACLE_ADDRESSES.split(',') : [];
  const deleteOracleAddresses = DELETE_ORACLE_ADDRESSES
    ? DELETE_ORACLE_ADDRESSES.split(',')
    : [];

  const { writeCoreProposal } = await makeHelpers(homeP, endowments);

  const inLookup = JSON.parse(IN_BRAND_LOOKUP);
  const outLookup = JSON.parse(OUT_BRAND_LOOKUP);

  const proposalBuilder = makeCoreProposalBuilder({
    AGORIC_INSTANCE_NAME,
    IN_BRAND_DECIMALS,
    OUT_BRAND_DECIMALS,
    IN_BRAND_NAME: inLookup[inLookup.length - 1],
    OUT_BRAND_NAME: outLookup[outLookup.length - 1],
    oracleAddresses,
    deleteOracleAddresses,
    brandIn: lookup(inLookup).catch(() => undefined),
    brandOut: lookup(outLookup).catch(() => undefined),
  });
  await writeCoreProposal('gov-price-feed', proposalBuilder); // gov-price-feed.js gov-price-feed-permit.json
};

export default createGov;

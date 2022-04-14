import { E } from '@endo/far';

const t = true;

// Return the manifest, installations, and options.
export const getManifestForPriceFeed = async ({ restoreRef }, options) => ({
  manifest: {
    createPriceFeed: {
      consume: {
        aggregators: t,
        chainTimerService: t,
        client: t,
        namesByAddress: t,
        priceAuthority: t,
        priceAuthorityAdmin: t,
        zoe: t,
      },
      produce: { aggregators: t },
      instance: { produce: { [options.AGORIC_INSTANCE_NAME]: t } },
      installation: { consume: { priceAggregator: t } },
    },
  },
  installations: {
    priceAggregator: restoreRef(options.priceAggregatorRef),
  },
  options: {
    ...options,
    brandIn: restoreRef(options.brandInRef),
    brandOut: restoreRef(options.brandOutRef),
  },
});

export const createPriceFeed = async (
  {
    consume: {
      aggregators,
      chainTimerService,
      client,
      namesByAddress,
      priceAuthority,
      priceAuthorityAdmin,
      zoe,
    },
    produce: { aggregators: produceAggregators },
    instance: { produce: instanceProducer },
    installation: {
      consume: { priceAggregator },
    },
  },
  {
    options: {
      AGORIC_INSTANCE_NAME,
      brandIn,
      brandOut,
      oracleAddresses,
      contractTerms,
    },
  },
) => {
  // Default to an empty Map and home.priceAuthority.
  produceAggregators.resolve(new Map());
  E(client).assignBundle([_addr => ({ priceAuthority })]);

  const { [AGORIC_INSTANCE_NAME]: instanceProduce } = instanceProducer;

  const timer = await chainTimerService;

  const terms = {
    ...contractTerms,
    description: AGORIC_INSTANCE_NAME,
    brandIn,
    brandOut,
    timer,
  };

  // Create the price feed.
  const aggregator = await E(zoe).startInstance(
    priceAggregator,
    undefined,
    terms,
  );
  E(aggregators).set(terms, { aggregator });

  // Publish instance in agoricNames.
  instanceProduce.resolve(aggregator.instance);

  // Publish price feed in home.priceAuthority.
  const forceReplace = true;
  E(priceAuthorityAdmin)
    .registerPriceAuthority(
      E(aggregator.publicFacet).getPriceAuthority(),
      brandIn,
      brandOut,
      forceReplace,
    )
    .then(deleter => E(aggregators).set(terms, { aggregator, deleter }));

  // Send the invitations to the oracles.
  await Promise.all(
    oracleAddresses.map(async oracleAddress => {
      const depositFacet = E(namesByAddress).lookup(
        oracleAddress,
        'depositFacet',
      );

      const invitation = await E(aggregator.creatorFacet).makeOracleInvitation(
        oracleAddress,
      );
      await E(depositFacet).receive(invitation);
    }),
  );
};

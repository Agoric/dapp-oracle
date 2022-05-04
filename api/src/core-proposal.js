import { E } from '@endo/far';
import { makeIssuerKit } from '@agoric/ertp';

const t = true;

// Return the manifest, installations, and options.
export const getManifestForPriceFeed = async ({ restoreRef }, options) => ({
  manifest: {
    createPriceFeed: {
      consume: {
        aggregators: t,
        agoricNamesAdmin: t,
        chainTimerService: t,
        client: t,
        namesByAddress: t,
        priceAuthority: t,
        priceAuthorityAdmin: t,
        zoe: t,
      },
      produce: { aggregators: t },
      instance: { produce: { [options.AGORIC_INSTANCE_NAME]: t } },
    },
    ensureOracleBrands: {
      consume: {
        agoricNamesAdmin: t,
      },
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

const reserveThenGetNames = async (nameAdmin, names) => {
  for (const name of names) {
    E(nameAdmin).reserve(name);
  }
  const nameHub = E(nameAdmin).readonly();
  return Promise.all(names.map(name => E(nameHub).lookup(name)));
};

export const ensureOracleBrands = async (
  { consume: { agoricNamesAdmin } },
  {
    options: {
      brandIn: rawBrandIn,
      brandOut: rawBrandOut,
      IN_BRAND_DECIMALS,
      IN_BRAND_NAME,
      OUT_BRAND_DECIMALS,
      OUT_BRAND_NAME,
    },
  },
) => {
  const obAdmin = E(agoricNamesAdmin).lookupAdmin('oracleBrand');

  const updateFreshBrand = async (brand, name, decimals) => {
    const b = await brand;
    if (b) {
      // Don't update if it wasn't fresh.
      return b;
    }
    const freshBrand = makeIssuerKit(
      name,
      undefined,
      harden({ decimalPlaces: parseInt(decimals, 10) }),
    ).brand;

    if (!name) {
      // Don't update unnamed brands.
      return freshBrand;
    }

    await E(obAdmin).update(name, freshBrand);
    return freshBrand;
  };

  return Promise.all([
    updateFreshBrand(rawBrandIn, IN_BRAND_NAME, IN_BRAND_DECIMALS),
    updateFreshBrand(rawBrandOut, OUT_BRAND_NAME, OUT_BRAND_DECIMALS),
  ]);
};

export const createPriceFeed = async (
  {
    consume: {
      agoricNamesAdmin,
      aggregators,
      chainTimerService,
      client,
      namesByAddress,
      priceAuthority,
      priceAuthorityAdmin,
      zoe,
    },
    produce: { aggregators: produceAggregators },
    instance: { produce: instanceProduce },
  },
  {
    options: {
      AGORIC_INSTANCE_NAME,
      oracleAddresses,
      contractTerms,
      IN_BRAND_NAME,
      OUT_BRAND_NAME,
    },
  },
) => {
  // Default to an empty Map and home.priceAuthority.
  produceAggregators.resolve(new Map());
  E(client).assignBundle([_addr => ({ priceAuthority })]);

  const timer = await chainTimerService;

  const [[brandIn, brandOut], [priceAggregator]] = await Promise.all([
    reserveThenGetNames(E(agoricNamesAdmin).lookupAdmin('oracleBrand'), [
      IN_BRAND_NAME,
      OUT_BRAND_NAME,
    ]),
    reserveThenGetNames(E(agoricNamesAdmin).lookupAdmin('installation'), [
      'priceAggregator',
    ]),
  ]);

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

  // TODO: Make this publish even though the instance is not reserved.
  instanceProduce[AGORIC_INSTANCE_NAME].resolve(aggregator.instance);

  // FIXME: Without instanceProduce publish support, this puts an instance in
  // agoricNames for clients to find.
  E(E(agoricNamesAdmin).lookupAdmin('instance')).update(
    AGORIC_INSTANCE_NAME,
    aggregator.instance,
  );

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

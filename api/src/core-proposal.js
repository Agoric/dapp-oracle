import { E } from '@endo/far';
import { makeIssuerKit } from '@agoric/ertp';

const { details: X } = assert;
const t = true;

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
      aggregators: aggregatorsP,
      chainTimerService,
      client,
      namesByAddress,
      priceAuthority,
      priceAuthorityAdmin,
      zoe,
    },
    produce: { aggregators: produceAggregators },
  },
  {
    options: {
      AGORIC_INSTANCE_NAME,
      deleteOracleAddresses = [],
      oracleAddresses = [],
      contractTerms,
      priceAggregatorRef,
      IN_BRAND_NAME,
      OUT_BRAND_NAME,
    },
  },
) => {
  const [brandIn, brandOut] = await reserveThenGetNames(
    E(agoricNamesAdmin).lookupAdmin('oracleBrand'),
    [IN_BRAND_NAME, OUT_BRAND_NAME],
  );

  const provideAggregator = async () => {
    if (!priceAggregatorRef) {
      const aggregators = await aggregatorsP;

      // Find the latest aggregator with these brands.
      const entry = [...aggregators.entries().reverse()].find(
        ([{ brandIn: bin, brandOut: bout }]) =>
          bin === brandIn && bout === brandOut,
      );

      assert(entry, X`No aggregator found for brand ${brandIn}, ${brandOut}`);
      const [{ AGORIC_INSTANCE_NAME: actualName }, { aggregator }] = entry;
      return { actualName, aggregator };
    }

    // Default to an empty Map and home.priceAuthority.
    produceAggregators.resolve(new Map());
    const timer = await chainTimerService;

    const [priceAggregator] = await Promise.all([
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

    const aggregators = await aggregatorsP;
    aggregators.set(terms, { aggregator });
    if (aggregators.size === 1) {
      E(client).assignBundle([_addr => ({ priceAuthority })]);
    }

    // Publish price feed in home.priceAuthority.
    const forceReplace = true;
    await E(priceAuthorityAdmin)
      .registerPriceAuthority(
        E(aggregator.publicFacet).getPriceAuthority(),
        brandIn,
        brandOut,
        forceReplace,
      )
      .then(deleter => E(aggregatorsP).set(terms, { aggregator, deleter }));

    return { actualName: AGORIC_INSTANCE_NAME, aggregator };
  };

  const { actualName, aggregator } = await provideAggregator();

  // Ensure we have an agoricName for this instance.
  await E(E(agoricNamesAdmin).lookupAdmin('instance')).update(
    actualName,
    aggregator.instance,
  );

  // Remove the old oracles first, so we can re-add if requested.
  await Promise.all(
    deleteOracleAddresses.map(async oracleAddress =>
      E(aggregator.creatorFacet)
        .deleteOracle(oracleAddress)
        .catch(e => console.error('Cannot deleteOracle', oracleAddress, e)),
    ),
  );

  // Send the invitations to new oracles, and remove old ones.
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

// Return the manifest, installations, and options.
export const getManifestForPriceFeed = async ({ restoreRef }, options) => ({
  manifest: {
    [createPriceFeed.name]: {
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
    },
    [ensureOracleBrands.name]: {
      consume: {
        agoricNamesAdmin: t,
      },
    },
  },
  ...(options.priceAggregatorRef && {
    installations: {
      priceAggregator: restoreRef(options.priceAggregatorRef),
    },
  }),
  options: {
    ...options,
    brandIn: restoreRef(options.brandInRef),
    brandOut: restoreRef(options.brandOutRef),
  },
});

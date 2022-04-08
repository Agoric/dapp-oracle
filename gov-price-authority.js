const startPriceAuthority = async ({
  consume: { loadVat },
  produce,
}) => {
  const vats = { priceAuthority: E(loadVat)('priceAuthority') };
  const { priceAuthority, adminFacet } = await E(
    vats.priceAuthority,
  ).makePriceAuthorityRegistry();

  produce.priceAuthorityVat.resolve(vats.priceAuthority);
  produce.priceAuthority.resolve(priceAuthority);
  produce.priceAuthorityAdmin.resolve(adminFacet);
};
harden(startPriceAuthority);

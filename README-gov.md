# Creating a price authority with on-chain governance

Use Agoric SDK commit: `cd agoric-sdk && git checkout 86a8bade8b3164588e4c5645a54089dd4844ed5e`

1. Deploy the oracle node integration on each `ag-solo`:

Either a builtin oracle:

```sh
agoric deploy --allow-unsafe-plugins api/spawn.js
```

or for Chainlink:

```sh
INSTALL_ORACLE="Chainlink oracle" agoric deploy api/spawn.js
```

Take note of your node's `ORACLE_ADDRESS`.  You will need to send it to the
governance proposer.

2. Create a governance proposal data:

```sh
ORACLE_ADDRESSES=agoric1...,agoric1...,agoric1... \
AGORIC_INSTANCE_NAME="BLD-USD priceAggregator" \
IN_BRAND_LOOKUP='["wallet","brand","BLD"]' \
OUT_BRAND_LOOKUP='["agoricNames","oracleBrand","USD"]' \
agoric deploy api/create-gov.js
```

3. Submit the proposal to the chain as described by the above command.

4. Wait for proposal voting to pass.

5. Install the Flux Notifier for each oracle that was invited in
   `ORACLE_ADDRESSES` above.
   
   NOTE: You will need to edit `api/flux-params.js` to specify the correct query
   parameters as specified by the oracle coordinator.

```sh
NO_AGGREGATOR_INSTANCE_LOOKUP='["agoricNames","instance","BLD-USD priceAggregator"]' \
IN_BRAND_LOOKUP='["wallet","brand","BLD"]' \
OUT_BRAND_LOOKUP='["agoricNames","oracleBrand","USD"]' \
FEE_ISSUER_LOOKUP='["wallet","issuer","RUN"]' \
agoric deploy api/flux-notifier.js
```

6. Now people should be able to query via `home.priceAuthority` (do the test
   session in `README.md` with `pa = home.priceAuthority`).  Next steps are to
   query and gain confidence in the price feed, then possibly use it in a vault
   collateral proposal.

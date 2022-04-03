# Creating a price authority with on-chain governance

Use Agoric SDK commit: `cd agoric-sdk && git checkout mfig-oracle-management`

1. Deploy the oracle node integration on each `ag-solo`:

Either a builtin oracle:

```sh
agoric deploy --allow-unsafe-plugins api/spawn.js
```

or for Chainlink:

```sh
INSTALL_ORACLE="Chainlink oracle" agoric deploy api/spawn.js
```

Take note of your node's `ORACLE_ADDRESSES`.  You will need to send it to the
governance proposer.

2. Create a governance proposal data:

NOTE: If running on agoricdev-8, and you already have a boardId for the bundler
maker, just set something like `BUNDLER_MAKER_LOOKUP='["board","<boardId>"]'` to
use it without an additional install.

```sh
ORACLE_ADDRESSES=agoric1...,agoric1...,agoric1... \
ORACLE_ADDRESSES=agoric14rxtq7g2jfwyyxv43tgj2e962qvh55aup8e8ke,agoric1xm6lhkzapupmyulgkzjukqyvjndkpptt2qg47d,agoric1vqkgfumpn8j5v8zv45h66sls6stawzg0rjjsvh \
AGORIC_INSTANCE_NAME="BLD-USD priceAggregator" \
IN_BRAND_LOOKUP='["agoricNames","brand","BLD"]' \
OUT_BRAND_LOOKUP='["agoricNames","brand","RUN"]' \
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
IN_BRAND_LOOKUP='["agoricNames","brand","BLD"]' \
OUT_BRAND_LOOKUP='["agoricNames","brand","RUN"]' \
FEE_ISSUER_LOOKUP='["agoricNames","issuer","RUN"]' \
agoric deploy api/flux-notifier.js
```

6. Now people should be able to query via `home.priceAuthority` (do the test
   session in `README.md` with `pa = home.priceAuthority`).  Next steps are to
   query and gain confidence in the price feed, then possibly use it in a vault
   collateral proposal.

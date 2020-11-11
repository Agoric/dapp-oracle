# Oracle Dapp

This Dapp is a generic way to interact with oracles such as the
[Chainlink](https://chain.link) decentralized oracle network.  The oracle
contract represents a single oracle, whose publicFacet can be published for
people to query.

# Chainlink Integration

There are three basic components to a given Chainlink integration:
1. An [External Initiator](https://github.com/smartcontractkit/external-initiator) which monitors the Agoric chain for events indicating
   an oracle request is being made.
2. An [External Adapter](https://github.com/thodges-gh/CL-EA-NodeJS-Template) which accepts requests from the
   Chainlink node and translates them into Agoric transactions.
3. $LINK, a token which secures the oracle network.

The oracle query-only UI is deployed with `agoric deploy api/deploy.js`.

The "external adapter" is [in
Javascript](https://github.com/smartcontractkit/external-adapters-js/pull/114) and
"external initiator" is [in
Golang](https://github.com/smartcontractkit/external-initiator/pull/73).

## See the [`chainlink-agoric` subdirectory for more instructions](chainlink-agoric/README.md) on how to get started with Chainlink nodes.

## Running a Local Builtin Oracle

This dapp provides a builtin oracle for testing, with a single configured job
that implements a tiny subset of the adapters available via the flexible
Chainlink Any API.

Note that using this in production is not recommended: you will have to ensure
your ag-solo as always available, or your contracts will not be able to query
it.  Running a robust oracle is a detailed and time-consuming endeavour, and so
we recommend instead that you use the Chainlink oracles already provided as a
service on the Agoric chain.

Start with
https://agoric.com/documentation/getting-started/before-using-agoric.html

Here is how you can install the builtin oracle on your existing `agoric start`
client:

```sh
# Install the needed dependencies.
agoric install
# Deploy the oracle service contract.
agoric deploy contract/deploy.js
# Deploy the builtin oracle.
agoric deploy --allow-unsafe-plugins api/deploy.js
# Run the UI server.
(cd ui && yarn start)
```

Go to the oracle client page at http://localhost:3000  Use this oracle client UI
to experiment with simple Chainlink HTTP queries while you are defining your
contract.

You can modify the sample query to specify different parameters.  Leave the
`jobId` as it is to use the builtin oracle.  The parameters are taken from:

1. [HttpGet](https://docs.chain.link/docs/adapters#httpget) or
   [HttpPost](https://docs.chain.link/docs/adapters#httppost), as determined by
   the presence of the `get` or `post` parameter respectively.
2. An optional [JsonParse](https://docs.chain.link/docs/adapters#jsonparse), if
   the `path` parameter is defined.  Set `path: []` if you want to parse but not
   extract a specific path.
3. An optional [Multiply](https://docs.chain.link/docs/adapters#multiply), if
   the `times` parameter is defined.

### Publishing a scheduled query

If you want to publish a scheduled query on the chain:

1. Create a push query in the dapp-oracle server page.
2. Create an external oracle job that posts back to Agoric with the results and
   the push `queryId`.
   
As an example for Chainlink, ensure your `"request_id"` param is set to the push
query's `queryId` and use the Agoric external adapter to submit your job's
results.

```json
{
  "initiators": [
    {
      "type": "cron",
      "params": {
          "schedule": "CRON_TZ=UTC */1 * * * *"
      }
    }
  ],
  "tasks": [
    {
      "type": "HTTPGet",
      "confirmations": 0,
      "params": { "get": "https://bitstamp.net/api/ticker/" }
    },
    {
      "type": "JSONParse",
      "params": { "path": [ "last" ] }
    },
    {
      "type": "Multiply",
      "params": { "times": 100 }
    },
    {
      "type": "Agoric",
      "params": {
        "request_id": <push queryId>,
        "payment": "0"
      }
    }
  ]
}
```

### Publishing a price authority

If your scheduled query returns a numeric string as the price of a unit of your
input issuer, you can create a price authority from it.

1. Find out your wallet petnames for the input and output issuers (for example,
   `"Testnet.$LINK"` to `"Testnet.$USD"`).
2. Create a public price authority for your push query.  Set `PRICE_DECIMALS=2`
   because of the scaling factor `"times": 100` in the above `Multiply` task,
   (which is `10^2`). (you will need to push at least one result before the
   deployment will complete):
```sh
NOTIFIER_BOARD_ID=<boardId of push notifier> \
IN_ISSUER_JSON='"Testnet.$LINK"' OUT_ISSUER_JSON='"Testnet.$USD"' \
PRICE_DECIMALS=2 \
agoric deploy --hostport=127.0.0.1:7999 api/from-notifier.js
```
3. Publish the resulting `PRICE_AUTHORITY_BOARD_ID` to the on-chain
   `agoric.priceAuthority`.  If you want to publish to the testnet you will need
   to ask for somebody privileged to do this for you.
```sh
PRICE_AUTHORITY_BOARD_ID=<boardId of price authority> \
IN_ISSUER_JSON='"Testnet.$LINK"' OUT_ISSUER_JSON='"Testnet.$USD"' \
agoric deploy --hostport=127.0.0.1:7999 api/register.js
```

Here is a session testing the `priceAuthority`:

```js
home.wallet~.getIssuer('Testnet.$LINK')~.getBrand().then(brand => link = brand)
// -> [Alleged: presence o-82]{}
home.wallet~.getIssuer('Testnet.$USD')~.getBrand().then(brand => usd = brand)
// -> [Alleged: presence o-81]{}
home.priceAuthority~.getQuoteNotifier(link, usd)~.getUpdateSince()
// {"value":{"quotePayment":[Promise],"quoteAmount":{"brand":[Alleged: presence o-132]{},"value":[{"amountIn":{"brand":[Alleged: presence o-82]{},"value":1000000},"amountOut":{"brand":[Alleged: presence o-81]{},"value":1191},"timer":[Alleged: presence o-68]{},"timestamp":1604759700}]}},"updateCount":2}
```

## Single-query Usage

The `E(publicFacet).makeQueryInvitation(query)` call creates a query invitation,
which can be redeemed (by paying any fees) via `E(zoe).offer(invitation)` for an
oracle result.

The `E(publicFacet).query(query)` call creates an unpaid query.

Queries are answered by the oracle handler provided to the contract.  Each query
calls `E(oracleHandler).onQuery(query, feeAmount)` which returns a promise for
the `{ reply, requiredFee }`.  If the oracle rejects the promise or the caller
did not pay the `requiredFee`, the caller just gets a rejection, and their fee
is refunded.  Otherwise, the `reply` is returned to the caller as the result of
the query.

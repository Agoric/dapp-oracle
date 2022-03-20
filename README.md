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

The oracle query-only UI is deployed with `agoric deploy api/spawn.js`.

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
# Deploy the builtin oracle plugin.
agoric deploy --allow-unsafe-plugins api/spawn.js
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

If you have a jobId that returns a numeric string as the price of a unit of your
input issuer, you can create a price authority from it using the Flux Notifier.

If you're not testing the Chainlink instructions, you don't need to do anything
special for `PRIVILEGED-NODE` versus `ORACLE-NODE`.  If you are testing the
Chainlink instructions, when you see `PRIVILEGED-NODE` use
`--hostport=127.0.0.1:7999`, and when you see `ORACLE-NODE`, use one of
`--hostport=127.0.0.1:689<N>` (like `--hostport=127.0.0.1:6891`).

1. Find out the published `E(E(home.agoricNames).lookup('brand')).keys()` names
   for the input and output brands (for example, `"BLD"` to `"USD"`).
2. Create a public price authority based on an aggregator on the
   `PRIVILEGED-NODE`, and send invitations to the `ORACLE-NODE`s
   (without `ORACLE_NODE_ADDRESSES`, use the current node):
```sh
IN_ISSUER_JSON='"BLD"' OUT_ISSUER_JSON='"USD"' \
agoric deploy api/aggregate.js
```
3. On an `ORACLE-NODE`, find its `agoric1...` (or `sim-...`) address:
```sh
agoric deploy api/show-my-address.js
```
4. On `PRIVILEGED-NODE`, send an aggregator invitation to the specified oracle:
```sh
ORACLE_ADDRESS=agoric1... \
agoric deploy api/invite-oracle.js
```
5. Create a Flux Notifier on an `ORACLE-NODE`.  NOTE: You will need to edit
   parameters at the top of `api/flux-notifier.js` to specify the notifier
   parameters before running this:
```sh
AGGREGATOR_INSTANCE_ID=<boardId of aggregator instance> \
IN_ISSUER_JSON='"BLD"' \
OUT_ISSUER_JSON='"USD"' \
FEE_ISSUER_JSON='"RUN"' \
agoric deploy api/flux-notifier.js
```

This command will wait until the first query returns valid data, and also add it
to the aggregator.

Repeat steps 3 to 5 for as many `ORACLE-NODE`s as necessary.

6. OPTIONAL: You can publish the resulting `PRICE_AUTHORITY_BOARD_ID` to the
sim-chain's `agoric.priceAuthority`.

```sh
PRICE_AUTHORITY_BOARD_ID=<boardId of price authority> \
IN_ISSUER_JSON='"BLD"' \
OUT_ISSUER_JSON='"USD"' \
agoric deploy api/register.js
```

If this step fails (such as with `local-chain` or a public chain), you can use
on-chain governance to install the price authority.  Remember that this step is
optional.

Here is a session testing the `priceAuthority`:

```js
E(home.agoricNames).lookup('brand', 'BLD').then(brand => bld = brand)
// -> [Object Alleged: BLD brand]{}
E(home.agoricNames).lookup('brand', 'USD').then(brand => usd = brand)
// -> [Object Alleged: USD brand]{}
pa = E(home.board).getValue('<boardId of price authority>')
// -> [Object Alleged: PriceAuthority]{}
E(E(pa).makeQuoteNotifier({ value: 1_000n * 10n ** 6n, brand: bld }, usd)).getUpdateSince()
// -> {"updateCount":2,"value":{"quoteAmount":{"brand":[Object Alleged: quote brand]{},"value":[{"amountIn":{"brand":[Object Alleged: BLD brand]{},"value":1000000000000000000n},"amountOut":{"brand":[Object Alleged: USD brand]{},"value":10000000000000000000000n},"timer":[Object Alleged: timerService]{},"timestamp":1644701445n}]},"quotePayment":[Promise]}}
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

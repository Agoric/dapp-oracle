# Oracle Dapp

This Dapp is a generic way to interact with oracles such as the
[Chainlink](https://chain.link) decentralized oracle network.  The oracle
contract represents a single oracle, whose publicFacet can be published for
people to query.

(See the [Chainlink integration details](#chainlink-integration) for instructions
on how to use Chainlink specifically with this Dapp.)

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

## Running a Local External Oracle

The external oracle is used for integrating the oracle contract with a separate
oracle node.  You will typically not do this unless you are a Chainlink oracle
node operator who wants to test the [Chainlink
integration](#chainlink-integration).

Start with
https://agoric.com/documentation/getting-started/before-using-agoric.html

Then:

```sh
# Install the needed dependencies.
agoric install
# Start local chain implementation.
agoric start --reset local-chain >& chain.log &
# Start a solo for the oracle client.
agoric start local-solo 8000 >& 8000.log &
# Start a solo for the oracle.
agoric start local-solo 7999 >& 7999.log &
# Deploy the oracle server contract.
INSTALL_ORACLE='My Oracle' FEE_ISSUER_PETNAME='moola' agoric deploy \
  --hostport=127.0.0.1:7999 contract/deploy.js api/deploy.js
# Deploy the oracle query contract.
agoric deploy api/deploy.js
# Run the UI server.
(cd ui && yarn start)
```

Go to the oracle server page at http://localhost:3000?API_PORT=7999

Go to the oracle query page at http://localhost:3000

### Publishing a scheduled query

If you want to publish a scheduled query on the chain:

1. Create a push query in the dapp-oracle server page.
2. Create an external oracle job that posts back to Agoric with the results and
   the push `queryId`.  For prices in `"Testnet.$USD"` be sure to scale the
   resulting floating point dollar value up to mills (multiply by 1000)
   
For Chainlink, ensure your `"request_id"` param is set to the `queryId` and use
the Agoric external adapter to submit your job's results.

As an example:

```json
{
  "initiators": [
    {
      "type": "cron",
      "params": {
          "schedule": "CRON_TZ=UTC */10 * * *"
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
      "params": { "times": 1000 }
    },
    {
      "type": "Agoric",
      "params": { "request_id": "<your queryId>" }
    }
  ]
}
```

### Publishing a price authority

If your scheduled query returns a numeric string as the price of a unit of your
input issuer, you can create a price authority from it.

1. Find out your wallet petnames for the input and output issuers (for example,
   `"Testnet.$LINK"` to `"Testnet.$USD"`).
2. Create a public price authority for your push query:
```sh
NOTIFIER_BOARD_ID=<boardId of push notifier> \
IN_ISSUER_JSON='"Testnet.$LINK"' OUT_ISSUER_JSON='"Testnet.$USD"' \
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

## WebSocket Oracle API

To create an external oracle to serve an on-chain oracle contract, you will need
to do the following:

```sh
# Initialise a new testnet client in the background.
agoric start testnet >& testnet.log &
# Wait for the testnet ag-solo to start up.
tail -f testnet.log
<Control-C> when 'swingset running'

# Do any setup your ag-solo wallet needs, such as setting a petname
# for the fee tokens you wish to charge ('moola' in this example).

# Deploy the contract and API server when the above is ready.
INSTALL_ORACLE='My wonderful oracle' FEE_ISSUER_PETNAME='moola' \
  agoric deploy contract/deploy.js api/deploy.js
```

Your external oracle service would function like the following JS-like pseudocode:

```js
// Obtain a websocket connection to the oracle API of the above local testnet client.
const ws = new WebSocket('ws://localhost:8000/api/oracle');

ws.addEventListener('open', ev => {
  console.log('Opened connection');

  // A helper to send an object as a JSON websocket message.
  const send = obj => ws.send(JSON.stringify(obj));

  ws.addEventListener('message', ev => {
    // Receive JSON packets according to the recv function defined below.
    recv(JSON.parse(ev.data));
  });

  // Receive from the server.
  async function recv(message) {
    const obj = JSON.parse(message);
    switch (obj.type) {
      case 'oracleServer/onQuery': {
        const { queryId, query, fee } = obj.data;
        try {
          const { requiredFee, reply } = await performQuery(query, fee); // A function you define.
          send({ type: 'oracleServer/reply', data: { queryId, reply, requiredFee } });
        } catch (e) {
          send({ type: 'oracleServer/error', data: { queryId, error: `${(e && e.stack) || e}` }})
        }
        break;
      }

      case 'oracleServer/onError': {
        const { queryId, query, error } = obj.data;
        console.log('Failed query', query, error);
        break;
      }

      case 'oracleServer/onReply': {
        const { queryId, query, reply, fee } = obj.data;
        console.log('Successful query', query, 'reply', reply, 'for fee', fee);
        break;
      }

      default: {
        console.log('Unrecognized message type', obj.type);
        break;
      }
    }
  }
}
```

# Chainlink Integration

There are three basic components to a given Chainlink integration:
1. an External Initiator which monitors the Agoric chain for events indicating an
   oracle request is being made.
2. an External Adapter which accepts requests from the
   Chainlink node and translates them into Agoric transactions.
3. $LINK, a token which secures the oracle network.

## Implementation

The oracle query-only UI is deployed with `agoric deploy api/deploy.js`.

The "external adapter" is [in
Javascript](https://github.com/smartcontractkit/external-adapters-js/pull/114) and
"external initiator" is [in
Golang](https://github.com/smartcontractkit/external-initiator/pull/73).

See the `chainlink-agoric` subdirectory for more instructions on how to run the
Chainlink nodes.

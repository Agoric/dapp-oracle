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


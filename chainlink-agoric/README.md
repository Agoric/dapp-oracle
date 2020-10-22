# Chainlink components for Agoric

This tool automates the setup and running of Chainlink components to read/write from an Agoric chain.

## Prerequisites

The Chainlink components assume that you already have an Agoric chain running.
See `agoric start local-chain` in the instructions.

_See the directory above for more instructions on how to run this._

## Running

### Initial setup

_Note: Make sure you have cd-ed into this directory_

If you are running the Agoric node locally, simply run:

```bash
AG_COSMOS_HELPER_OPTS="--from=<your-keyname>" ./setup
```

If you are running the Agoric chain externally, run something like:

```bash
AG_COSMOS_HELPER_OPTS="--from=<your-keyname>" ./setup "https://testnet.agoric.com/network-config"
```

This will create and start 3 Chainlink nodes, with an adapter and EI connected to each.

It will instruct you to provision 3 different addresses, which you can do via
`ag-cosmos-helper tx swingset provision-one <node-name> <addr>`.

### Start/stop

To stop the nodes, run:

```bash
docker-compose down
```

And to start them again, run:

```bash
docker-compose up
```

The env var `AG_NETWORK_CONFIG` needs to be set before bringing the services up.
`./setup` will default to `$PWD/network-config.json`, but you need to set this again if it is unset.

## Testing end-to-end

Run:

```bash
(cd ../ui && yarn start)
```

then visit `http://localhost:3000/?API_PORT=6891` and submit queries.  You
should see the replies appear when served by the Chainlink node.

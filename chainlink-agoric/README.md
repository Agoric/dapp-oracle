# Chainlink components for Agoric

This tool automates the setup and running of Chainlink components to read/write from an Agoric chain.

## Prerequisites

The Chainlink components assume that you already have an Agoric chain running.
This can either be a public chain or a local chain **BUT NOT the simulated chain**.

To start a local chain, do the following:

Start with https://agoric.com/documentation/getting-started/before-using-agoric.html

Then:

```sh
# Go to the parent directory.
cd ..
# Install the needed dependencies.
agoric install
# Start local chain implementation
AGORIC_CLI_OPTS="" agoric start --reset local-chain >& chain.log &
```

## Running

To complete these steps, you need:
- [Docker](https://docker.io)
- [jq](https://stedolan.github.io/jq/download/)

### Initial setup

_Note: Make sure you have cd-ed into this directory_

If you are running the Agoric local-chain, simply run:

```bash
./setup
```

If you are running the Agoric chain externally, run something like:

```bash
AG_COSMOS_HELPER_OPTS=--from=<your-keyname> ./setup "https://testnet.agoric.com/network-config"
```

This will create and start up to 3 Chainlink nodes, with an adapter and EI
connected to each.  Read further to see how to query the nodes.

It will attempt to provision separate Agoric addresses for each node, which if
you used a non-local chain you can do manually via `ag-cosmos-helper tx swingset
provision-one <node-name> <addr>`.

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

To start the oracle client UI, run:

```sh
# Set up the client UI.
(cd ../ui && yarn start) &
```

Your `setup` script invocation produced a set of oracle descriptions, something
like:

```
board:<board-id> jobId:<chainlink-jobid> ?API_URL=<backend url> CL=<chainlink url>
```

Now you visit `http://localhost:3000?API_URL=<backend url>` to interact with the
oracle's private API server.  Fill out the `jobId` and `board` in the UI
corresponding to that oracle.

Queries you submit will be routed over the chain to the specified on-chain
oracle contract (designated by `board`), to the Chainlink node and back, and you
should see the replies.

### Independent client

The above instructions test the integration, but don't allow you to submit paid
queries or avoid contacting the private `API_PORT` of an oracle.  To use a
completely decoupled oracle client and a fresh wallet, run the following:

```sh
# Start a solo for the oracle client
AGORIC_CLI_OPTS="" agoric start --reset local-solo 8000 agoric.priceAuthorityAdmin >& 8000.log &
# Deploy the oracle client (DON'T allow unsafe plugins)
agoric deploy api/deploy.js
```

then visit `http://localhost:3000` and submit queries as above (you still need
to fill out the board and `jobId`s).  You'll notice that the oracle server
control panel is missing because there is no specific server in the local solo.

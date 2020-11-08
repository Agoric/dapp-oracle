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

### Initial setup

_Note: Make sure you have cd-ed into this directory_

If you are running the Agoric local-chain, simply run:

```bash
./setup
```

If you are running the Agoric chain externally, run something like:

```bash
AG_COSMOS_HELPER_OPTS="--from=<your-keyname>" ./setup "https://testnet.agoric.com/network-config"
```

This will create and start up to 3 Chainlink nodes, with an adapter and EI connected to each.

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

and visit `http://localhost:3000?API_PORT=6891` to interact with the first
oracle's private API server.  You can specify `6892` or `6893` for the second or
third oracles.

Queries you submit will be routed over the chain to the specified on-chain
oracle contract (designated by `board`), to the Chainlink node and back, and you
should see the replies.

### Independent client

If you want to fully test the end-to-end, you can deploy an independent client
that is not associated with a specific oracle node, and has its own wallet:

```sh
# Start a solo for the oracle client
AGORIC_CLI_OPTS="" agoric start --reset local-solo 8000 >& 8000.log &
# Deploy the oracle client (DON'T allow unsafe plugins)
agoric deploy api/deploy.js
```

then visit `http://localhost:3000` and submit queries as above.  You'll notice
that the server control panel is missing because there is no specific server in
the local solo (no `API_PORT` specifieed).

You will need to use one of the pair of `board` and `jobId` identifiers printed
out at the end of the `setup` script's execution, which looks something like:

```
board:<board-id> jobId:"<chainlink-jobid>" http://localhost:<port>
```

That's how your oracle client identifies which on-chain oracle contract to use
(without cheating and directly talking to the `API_PORT`).

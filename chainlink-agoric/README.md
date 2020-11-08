# Chainlink components for Agoric

This tool automates the setup and running of Chainlink components to read/write from an Agoric chain.

## Prerequisites

The Chainlink components assume that you already have an Agoric chain running.
This can either be a public chain or a local chain.

To start a local chain, do the following:

Start with https://agoric.com/documentation/getting-started/before-using-agoric.html

Then:

```sh
# Go to the parent directory.
cd ..
# Install the needed dependencies.
agoric install
# Start local chain implementation in one terminal
AGORIC_CLI_OPTS="" agoric start --reset local-chain
# Start a solo for the oracle client in another terminal
AGORIC_CLI_OPTS="" agoric start --reset local-solo 8000
# Deploy the oracle client in a third terminal
agoric deploy api/deploy.js
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

This will create and start 3 Chainlink nodes, with an adapter and EI connected to each.

It will attempt to provision 3 different Agoric addresses, which if you used a
non-local chain you can do manually via `ag-cosmos-helper tx swingset
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

Run:

```bash
(cd ../ui && yarn start) &
```

then visit `http://localhost:3000` and submit queries.  You will need to use one
of the `board` and `jobId` identifiers printed out at the end of the `setup`
script's execution, which looks something like:

```
board:<board-id> jobId:"<chainlink-jobid>" http://localhost:<port>
```

You should see the replies appear when served by the Chainlink node.

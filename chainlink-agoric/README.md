# Chainlink components for Agoric

This tool automates the setup and running of Chainlink components to read/write from an Agoric chain.

# Prerequisites 

- [Docker](https://docker.io)
- [jq](https://stedolan.github.io/jq/download/)
- [yarn](https://classic.yarnpkg.com/en/docs/install/#mac-stable)
- [nodejs](https://nodejs.org/en/download/)

## 1. Set up the `agoric` command

### Set up the `agoric` command in your shell for you. To do this follow: 

https://agoric.com/documentation/getting-started/before-using-agoric.html

You don't need to proceed to the next page. 

The Chainlink components assume that you already have an Agoric chain running.
This can either be a public chain or a local chain **BUT NOT the simulated chain**.

## 2. Start a local agoric chain

```sh
# Go to the parent directory.
cd ..
# Install the needed dependencies.
agoric install
# Start local chain implementation
AGORIC_CLI_OPTS="--docker-tag=hacktheorb" agoric start --reset local-chain >& chain.log &
```

This will run a job in the background, and when it's complete, you'll see a new docker container running. You can check it out with `docker ps`

## 3. Setup Chainlink node, external adapter, and external initiator

_Note: Make sure you have cd-ed into this directory_

Once you are running the Agoric local-chain, simply run:

```bash
./setup
```

This will take a few minutes.

If you are running the Agoric chain externally, run something like:

```bash
AG_COSMOS_HELPER_OPTS=--from=<your-keyname> ./setup "https://testnet.agoric.com/network-config"
```

This will create and start up to 3 Chainlink nodes, with an adapter and EI
connected to each.  Read further to see how to query the nodes.

### Say `n` to 2 and 3 oracles & copy output

If you want to test with multiple oracles, feel free to say `y`. Copy the output from the setup script. It will look something like:
```
board:1202180815 jobId:"32eb0ee3d28549c189996fba9a420bc1" ?API_URL=http://localhost:6891 CL=http://localhost:6691
```

If you forget or lose the above, run `node show-jobs.js`

### Once it's up, sign into the chainlink node

Go to [`http://localhost:6691/signin`](http://localhost:6691/signin) (or whatever port the node you'd like to connect to is on, if you started up multiple nodes)

The username and password are:
```
notreal@fakeemail.ch
twochains
```

It will attempt to provision separate Agoric addresses for each node, which if
you used a non-local chain you can do manually via `ag-cosmos-helper tx swingset
provision-one <node-name> <addr>`.

## For reference
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

## 4. Start up the UI (testing end-to-end)

Once the setup is done, start the oracle client UI, run:

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
corresponding to that oracle, given by the `node show-jobs.js` script or output of the `./setup` command.

Queries you submit will be routed over the chain to the specified on-chain
oracle contract (designated by `board`), to the Chainlink node and back, and you
should see the replies. You will also see the job runs in the Chainlink Oracle

## Summary 

This is how you can test sending jobs to a chainlink node on the agoric chain. The syntax of the job will be how you define a job in your agoric smart contract. 

## Additional 
### Independent client

The above instructions test the integration, but don't allow you to submit paid
queries or avoid contacting the private `API_PORT` of an oracle.  To use a
completely decoupled oracle client and a fresh wallet, run the following:

```sh
# Start a solo for the oracle client
AGORIC_CLI_OPTS="--docker-tag=hacktheorb" agoric start --reset local-solo 8000 agoric.priceAuthorityAdmin >& 8000.log &
# Deploy the oracle client (DON'T allow unsafe plugins)
agoric deploy api/deploy.js
```

then visit `http://localhost:3000` and submit queries as above (you still need
to fill out the board and `jobId`s).  You'll notice that the oracle server
control panel is missing because there is no specific server in the local solo.

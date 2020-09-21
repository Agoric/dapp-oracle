# Chainlink Dapp

This Dapp interacts with the [Chainlink](https://chain.link) decentralized oracle network.

# Architecture

There are three basic components to a given Chainlink integration:
1. an External Initiator which monitors the Agoric chain for events indicating an
   oracle request is being made.
2. an External Adapter which accepts requests from the
   Chainlink node and translates them into Agoric transactions.
3. $LINK, a token which secures the oracle network.

## Planned Implementation

This initial implementation does not use $LINK.

The "external initiator" is a patch to the [Golang Chainlink External
Initiator](https://github.com/smartcontractkit/external-initiator) that monitors
Cosmos SDK events published from the API server.  This Dapp contract uses the
provided `events` object to publish those events, where `agoric.events` is the
on-chain capability to publish a Cosmos SDK event.

The "external adapter" is an `ag-solo` where `agoric deploy
api/deploy-adapter.js` has been run.  Adapters need to be granted an
`adapterPass` by the Dapp creator with `agoric deploy api/allow-adapter.js` in
order to be able to invoke `E(publicFacet).adapterReply(adapterPass, replyData)`
to answer a Chainlink event.

# Deployment

In order to deploy the contract, you will have to use an ag-solo that has been
provisioned with the `agoric.events` power.  This is done automatically for
the simulated chain used while testing.

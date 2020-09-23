# Oracle Dapp

This Dapp is a generic way to interact with oracles such as the [Chainlink](https://chain.link) decentralized oracle network.

# Architecture

There are three basic components to a given Chainlink integration:
1. an External Initiator which monitors the Agoric chain for events indicating an
   oracle request is being made.
2. an External Adapter which accepts requests from the
   Chainlink node and translates them into Agoric transactions.
3. $LINK, a token which secures the oracle network.

## Planned Implementation

The "external adapter" is [in
Javascript](https://github.com/smartcontractkit/external-adapters-js) and
"external initiator" is [in
Golang](https://github.com/smartcontractkit/external-initiator).  Both contact
the `ag-solo` where `agoric deploy api/deploy-oracle.js` has been run to create
an oracle handler and register it in the board for a UI to pick up.

## Usage

The `publicFacet.makeQueryInvitation(oracleHandle, jobspec)` call creates a
queryInvitation, which can be redeemed (by any paying fees) via
`zoe.offer(invitation)` for an oracle result.

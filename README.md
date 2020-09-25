# Oracle Dapp

This Dapp is a generic way to interact with oracles such as the [Chainlink](https://chain.link) decentralized oracle network.

# Architecture

The oracle contract allows anybody to create an oracle kit, and publish the
resulting oracle for people to query in conjunction with the contract.

For every individual query, the contract:

1. Ensures the oracle's deposit amount (if any) is escrowed by Zoe.
2. Has the oracle service the query and return a reply to the contract.
3. Unescrows the final payment (if any) and sends it to the oracle.
4. Releases the reply to the caller.

If the deposit could not be verified, then the oracle is not asked to service
the query, any provided payment is fully refunded, and the client receives an
error.

If the reply is calculated without error by the oracle, then the lesser of the
client's actual payment (which is guaranteed to be at least the deposit) or the
calculated final payment is collected and the reply is released to the client.
Failures of the oracle to properly handle the payment still result in the
release of the reply.

Other features, such as repeated/streaming queries are not yet implemented.

## Chainlink Integration

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
queryInvitation, which can be redeemed (by paying any fees) via
`zoe.offer(invitation)` for an oracle result.

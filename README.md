# Oracle Dapp

This Dapp is a generic way to interact with oracles such as the [Chainlink](https://chain.link) decentralized oracle network.

The oracle contract represents a single oracle, whose publicFacet can be
published for people to query.

## Single-query Usage

The `publicFacet.makeQueryInvitation(query)` call creates a query invitation,
which can be redeemed (by paying any fees) via `zoe.offer(invitation)` for an
oracle result.

The `publicFacet.query(query)` call creates an unpaid query.

For every single query, the contract:

1. Asks the oracle to calculate the deposit for the query.
2. Ensures the calculated deposit amount (if any) is escrowed by Zoe.  If not,
   refunds the payment and aborts the query.
3. Has the oracle service the query and return a reply to the contract.
4. Asks the oracle to calculate the desired payment for the query and reply.
5. Collects the lesser of the actual payment or calculated desired payment (if
   any).
6. Releases the reply to the caller.

## Streaming Usage

Not yet implemented.

# Chainlink Integration

There are three basic components to a given Chainlink integration:
1. an External Initiator which monitors the Agoric chain for events indicating an
   oracle request is being made.
2. an External Adapter which accepts requests from the
   Chainlink node and translates them into Agoric transactions.
3. $LINK, a token which secures the oracle network.

## Planned Implementation

The oracle query-only UI is deployed with `agoric deploy api/deploy.js`.

The "external adapter" is [in
Javascript](https://github.com/smartcontractkit/external-adapters-js) and
"external initiator" is [in
Golang](https://github.com/smartcontractkit/external-initiator).  Both contact
the `ag-solo` where `SERVE_ORACLE='myOracle' agoric deploy api/deploy.js` has
been run to create an oracle and register it in the board for a UI to pick up.


# Oracle Dapp

This Dapp is a generic way to interact with oracles such as the [Chainlink](https://chain.link) decentralized oracle network.

The oracle contract represents a single oracle, whose publicFacet can be
published for people to query.

## Single-query Usage

The `E(publicFacet).makeQueryInvitation(query)` call creates a query invitation,
which can be redeemed (by paying any fees) via `E(zoe).offer(invitation)` for an
oracle result.

The `E(publicFacet).query(query)` call creates an unpaid query.

Queries are answered by the oracle handler provided to the contract.  Each query
calls `E(oracleHandler).onQuery(query, actions)` which returns a promise for the
reply.

The `actions` additionally allow the oracle to call:

* `E(actions).assertDeposit(depositAmountRecord)` which throws if the caller did
  not provide a large enough deposit.  The oracle should call this before
  engaging in the actual resolution of the query.
* `E(actions).collectFee(desiredFeeAmountRecord)` which only resolves after the
  reply has been returned, and then it resolves to the lesser of the actual
  payment (which is guaranteed to be more than the assertDeposit amount), or the desired fee.

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


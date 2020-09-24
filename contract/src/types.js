/**
 * @typedef {Object} OraclePublicFacet the public methods accessible from the
 * contract instance
 * @property {(allegedName: string) => ERef<OracleKit>} makeOracleKit create an oracle
 * @property {(oracle: Oracle, query: any) => ERef<Invitation>}
 * makeQueryInvitation create an invitation for a paid oracle query
 * @property {(oracle: Oracle, query: any) => ERef<any>} query make an unpaid query
 */

/**
 * @typedef {Object} Oracle public representation of an oracle managed by this
 * contract
 * @property {() => string} getAllegedName
 */

/**
 * @typedef {Object} OracleHandler
 * @property {(o: ERef<Oracle>, adminFacet: ERef<OracleAdminFacet>, oh:
 * ERef<OracleHandler>) => Promise<void>} onCreate callback when the handler is
 * set on a given oracle
 * @property {(o: ERef<Oracle>, query: any, oh: ERef<OracleHandler>) =>
 * Promise<OracleQueryHandler>} onQuery callback for associating a query handler
 * with a given query
 */

/**
 * @typedef {Object} OracleQueryHandler
 * @property {(query: any, oqh: ERef<OracleQueryHandler>) =>
 * ERef<AmountKeywordRecord>} calculateDeposit determine the deposit before we
 * will actually try to perform a query
 * @property {(query: any, reply: any, oqh: ERef<OracleQueryHandler>) =>
 * ERef<AmountKeywordRecord>} calculateFee determine the fee for the query and result
 * @property {(query: any, oqh: ERef<OracleQueryHandler>) => any} getReply
 * actually do the work of the query.  Note that the deposit (calculateFee where
 * isFinal is false) has been guaranteed by the contract, so we will get at
 * least that much if they fail to pay the final fee
 * @property {(query: any, reply: any, collected: ERef<PaymentPKeywordRecord>,
 * oqh: ERef<OracleQueryHandler>) => ERef<void>} receiveFee callback for
 * receiving the fee
 */

/**
 * @typedef {Object} OracleAdminFacet
 * @property {(oh: ERef<OracleHandler>) => void} replaceHandler use a different
 * handler for the oracle
 * @property {(issuerP: ERef<Issuer>) => Promise<void>} addFeeIssuer add an
 * issuer to collect fees for the oracle
 * @property {() => void} revoke prevent the oracle from receiving new requests
 * or exchanging any more replies for fees
 */

/**
 * @typedef {Object} OracleKit
 * @property {Oracle} oracle the public facet used to submit queries via this contract
 * @property {OracleAdminFacet} adminFacet the private facet held by the oracle
 */

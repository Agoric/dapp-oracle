/**
 * @typedef {Object} OraclePublicFacet the public methods accessible from the
 * contract instance
 * @property {(query: any) => ERef<Invitation>} makeQueryInvitation create an
 * invitation for a paid oracle query
 * @property {(query: any) => ERef<any>} query make an unpaid query
 * @property {() => string} getDescription describe this oracle
 */

/**
 * @typedef {Object} OracleCreatorFacet the private methods accessible from the
 * contract instance
 * @property {(issuerP: ERef<Issuer>) => Promise<void>} addFeeIssuer add an
 * issuer to collect fees for the oracle
 * @property {() => ERef<AmountKeywordRecord>} getCurrentFees get the current
 * fee amounts
 * @property {(total: boolean = false) => ERef<Invitation>}
 * makeWithdrawInvitation create an invitation to withdraw fees
 */

/**
 * @typedef {Object} OracleStartFnResult
 * @property {OracleCreatorFacet} creatorFacet
 * @property {OraclePublicFacet} publicFacet
 * @property {Invitation} creatorInvitation
 */

/**
 * @typedef {Object} OracleHandler
 * @property {(query: any) => Promise<OracleQueryHandler>} onQuery callback for
 * associating a query handler with a given query
 */

/**
 * @typedef {Object} OracleQueryHandler
 * @property {() => ERef<AmountKeywordRecord>} calculateDeposit determine the
 * deposit before we will actually try to perform a query
 * @property {(reply: ERef<any>) => ERef<AmountKeywordRecord>} calculateFee
 * determine the fee for the query and result
 * @property {() => any} getReply actually do the work of the query.  Note that
 * the deposit (calculateFee where isFinal is false) has been guaranteed by the
 * contract, so we will get at least that much if they fail to pay the final fee
 * @property {(reply: any, collected: AmountKeywordRecord) => ERef<void>}
 * completed mark a query as completed
 */

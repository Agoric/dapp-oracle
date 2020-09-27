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
 * @property {(query: any, actions: ERef<OracleQueryActions>) => Promise<any>} onQuery
 * callback to reply to a query
 */

/**
 * @typedef {Object} OracleQueryActions
 * @property {(deposit: AmountKeywordRecord) => void} assertDeposit ensure that
 * the caller has deposited this much, failing the query if they haven't
 * @property {(desiredFee: AmountKeywordRecord) => ERef<AmountKeywordRecord>} collectFee
 * determine the fee for the query and result
 */

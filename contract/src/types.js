/**
 * @typedef {Object} AggregatorResult
 * @property {Amount} price
 * @property {number} timestamp
 */

/**
 * @typedef {Object} AggregatorPublicFacet
 * @property {() => Notifier<Payment>} getNotifier
 */

/**
 * @typedef {Object} AggregatorCreatorFacet
 * @property {(quoteMint: Mint) => Promise<void>} initializeQuoteMint
 * @property {(oracleInstance: Instance, query: any) => Promise<void>} addOracle
 * @property {(oracleInstance: Instance) => Promise<void>} dropOracle
 */

/**
 * @typedef {Object} AggregatorKit
 * @property {AggregatorPublicFacet} publicFacet
 * @property {AggregatorCreatorFacet} creatorFacet
 */

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
 * @typedef {Object} OraclePrivateParameters
 * @property {OracleHandler} oracleHandler
 */

/**
 * @typedef {Object} OracleInitializationFacet
 * @property {(privateParams: OraclePrivateParameters) => OracleCreatorFacet} initialize
 */

/**
 * @typedef {Object} OracleStartFnResult
 * @property {OracleInitializationFacet} creatorFacet
 * @property {OraclePublicFacet} publicFacet
 * @property {Instance} instance
 * @property {Invitation} creatorInvitation
 */

/**
 * @typedef {Object} OracleKit
 * @property {OracleCreatorFacet} creatorFacet
 * @property {OraclePublicFacet} publicFacet
 * @property {Instance} instance
 * @property {Invitation} creatorInvitation
 */

/**
 * @typedef {Object} OracleHandler
 * @property {(query: any, fee: Amount) => Promise<{ reply:
 * any, requiredFee: Amount }>} onQuery callback to reply to a query
 * @property {(query: any, reason: any) => void} onError notice an error
 * @property {(query: any, reply: any, requiredFee: Amount) => void} onReply
 * notice a successful reply
 */

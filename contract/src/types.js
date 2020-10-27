/**
 * @typedef {Object} PriceQuote
 * @property {Payment} quotePayment The quote wrapped as a payment
 * @property {Amount} quoteAmount Amount of `quotePayment` (`quoteIssuer.getAmountOf(quotePayment)`)
 */

/**
 * @typedef {Object} PriceQuoteValue An individual quote's value
 * @property {Amount} assetAmount The amount of the asset being quoted
 * @property {Amount} price The quoted price for the `assetAmount`
 * @property {TimerService} timer The service that gave the `timestamp`
 * @property {number} timestamp A timestamp for the quote according to `timer`
 * @property {any=} conditions Additional conditions for the quote
 */

/**
 * @typedef {Object} PriceAuthority An object that mints PriceQuotes and handles
 * triggers and notifiers for changes in the price
 * @property {() => Issuer} getQuoteIssuer Get the ERTP issuer of PriceQuotes
 * @property {(amountIn: Amount, brandOut?: Brand) => Promise<PriceQuote>}
 * getInputPrice calculate the amount of brandOut that will be returned if the
 * amountIn is sold at the current price
 * @property {(amountOut: Amount, brandIn?: Brand) => Promise<PriceQuote>}
 * getOutputPrice calculate the amount of brandIn that is required in order to
 * get amountOut using the current price
 * @property {(assetBrand: Brand, priceBrand: Brand) => Notifier<PriceQuote>}
 * getPriceNotifier
 * @property {(timer: TimerService, deadline: number, assetAmount: Amount,
 * priceBrand?: Brand) => Promise<PriceQuote>} priceAtTime Resolves after
 * `deadline` passes on `timer`  with the price of `assetAmount` at that time
 * @property {(assetAmount: Amount, priceLimit: Amount) => Promise<PriceQuote>}
 * priceWhenGT Resolve when the price of `assetAmount` exceeds `priceLimit`
 * @property {(assetAmount: Amount, priceLimit: Amount) => Promise<PriceQuote>}
 * priceWhenGTE Resolve when the price of `assetAmount` reaches or exceeds
 * `priceLimit`
 * @property {(assetAmount: Amount, priceLimit: Amount) => Promise<PriceQuote>}
 * priceWhenLTE Resolve when the price of `assetAmount` reaches or drops below
 * `priceLimit`
 * @property {(assetAmount: Amount, priceLimit: Amount) => Promise<PriceQuote>}
 * priceWhenLT Resolve when the price of `assetAmount` drops below `priceLimit`
 */

/**
 * @typedef {Object} AggregatorCreatorFacet
 * @property {(quoteMint: Mint) => Promise<void>} initializeQuoteMint
 * @property {(oracleInstance: Instance, query: any) => Promise<void>} addOracle
 * @property {(oracleInstance: Instance) => Promise<void>} dropOracle
 */

/**
 * @typedef {Object} AggregatorPublicFacet
 * @property {() => PriceAuthority} getPriceAuthority
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
 * @property {() => AmountKeywordRecord} getCurrentFees get the current
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

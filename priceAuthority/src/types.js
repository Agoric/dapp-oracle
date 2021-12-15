/**
 * @template T
 * @typedef {Object} Timestamped a timestamped item
 * @property {Timestamp} timestamp the actual timestamp
 * @property {TimerService} timer the service that timestamp is taken from
 * @property {T} item
 */

/**
 * @typedef {Object} Price an instant price between two amounts
 * @property {Amount} amountIn amount to sell
 * @property {Amount} amountOut amount to receive if amountIn is sold
 */

/**
 * @typedef {AsyncIterable<Timestamped<Price>>} QuoteStream a stream of
 * quoted prices (can sell Exchange[0] to receive Exchange[1]) marked with
 * timestamps
 */

/**
 * @typedef {Object} BasePriceAuthorityOptions options needed by all price
 * authorities
 * @property {Brand} brandIn the input brand(for amounts to sell)
 * @property {Brand} brandOut the output brand (for amounts received
 * from sales)
 * @property {ERef<QuoteStream>} quotes an async iterator of the underlying stream
 * FIXME: Don't use a quote stream, just a ticker.
 * @property {ERef<TimerService>} timer the timer that stamps the quotes
 * @property {ERef<Mint>} [quoteMint] the mint used to create quotes
 */

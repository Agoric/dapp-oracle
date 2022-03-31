// These parameters will be different based on what the price aggregator
// expects.  You may have to edit them!

// What minimum percentage of the price difference should result in a notification?
export const THRESHOLD = 0.1;

// What minimum absolute change in price should result in a notification?
export const ABSOLUTE_THRESHOLD = 0;

// How many decimal places does the price need to be shifted by?
export const PRICE_DECIMALS = 2;

// This is the query submitted to the oracle.
export const PRICE_QUERY = {
  jobId: 'b0b5cafec0ffeeee',
  params: {
    get: 'https://bitstamp.net/api/ticker/',
    path: ['last'],
    times: 10 ** PRICE_DECIMALS,
  },
};

// If no new round is started in this number of seconds, the oracle will initiate a new round.
export const IDLE_TIMER_PERIOD_S = 10n * 60n;

// This is the number of seconds between each poll.
export const POLL_TIMER_PERIOD_S = 60n;

// This is sent to the oracle node as the fee amount for the flux monitor
// query.  It isn't actually a real payment, just something to tell the oracle
// job that it has permission to run.
export const FEE_PAYMENT_VALUE = 0n;

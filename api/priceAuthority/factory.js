// @ts-check
import { E, Far } from '@agoric/far';
import { AmountMath } from '@agoric/ertp';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';
import {
  makeLinearPriceAuthority,
  makeInverseQuoteStream,
} from './src/index.js';

const startSpawn = async (_terms, _invitationMaker) => {
  const factory = {
    /**
     * Adapt a price authority into its inverse (quotes sales of issuerOut for
     * receipts of issuerIn).
     *
     * @param {Object} param0
     * @param {ERef<Brand>} param0.brandIn
     * @param {ERef<Brand>} param0.brandOut
     * @param {ERef<PriceAuthority>} param0.inOutPriceAuthority
     * @param {ERef<Mint>} [param0.quoteMint]
     * @param {ERef<TimerService>} [param0.timer]
     * @returns {Promise<PriceAuthority>}
     */
    async makeInversePriceAuthority({
      brandIn,
      brandOut,
      inOutPriceAuthority,
      quoteMint,
      timer,
    }) {
      [brandIn, brandOut] = await Promise.all([brandIn, brandOut]);

      const quotes = makeInverseQuoteStream({
        brandIn,
        brandOut,
        inOutPriceAuthority,
      });
      return makeLinearPriceAuthority({
        brandIn,
        brandOut,
        quotes,
        timer:
          timer || E(inOutPriceAuthority).getTimerService(brandIn, brandOut),
        quoteMint,
      });
    },
    async makeNotifierPriceAuthority({
      notifier,
      brandIn,
      brandOut,
      timer,
      unitValueIn = 1n,
      scaleValueOut = 1,
      quoteMint,
    }) {
      [brandIn, brandOut] = await Promise.all([brandIn, brandOut]);
      const amountIn = AmountMath.make(brandIn, unitValueIn);

      async function* makeQuotes() {
        for await (const sample of makeAsyncIterableFromNotifier(notifier)) {
          /** @type {Amount} */
          let amountOut;
          try {
            // Scale the sample to the specific valueOut.
            const valueOutForUnitIn = BigInt(
              Math.floor(parseInt(sample, 10) * scaleValueOut),
            );
            amountOut = AmountMath.make(brandOut, valueOutForUnitIn);
          } catch (e) {
            console.error(`Cannot parse ${JSON.stringify(sample)}:`, e);
            // eslint-disable-next-line no-continue
            continue;
          }
          const timestamp = await E(timer).getCurrentTimestamp();
          const quote = { timestamp, timer, item: { amountIn, amountOut } };
          // console.error('quoting', quote);
          yield quote;
        }
      }

      const quotes = makeQuotes();
      return makeLinearPriceAuthority({
        brandIn,
        brandOut,
        quotes,
        timer,
        quoteMint,
      });
    },
  };
  return Far('priceAuthorityFactory', factory);
};

export default harden(startSpawn);

// @ts-check
import { E } from '@agoric/eventual-send';
import { makeLocalAmountMath } from '@agoric/ertp';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';
import {
  makeLinearPriceAuthority,
  makeInverseQuoteStream,
} from './priceAuthority';

const startSpawn = async (_terms, _invitationMaker) => {
  const factory = {
    /**
     * Adapt a price authority into its inverse (quotes sales of issuerOut for
     * receipts of issuerIn).
     *
     * @param {Object} param0
     * @param {ERef<Issuer>} param0.issuerIn
     * @param {ERef<Issuer>} param0.issuerOut
     * @param {ERef<PriceAuthority>} param0.inOutPriceAuthority
     * @param {ERef<Mint>} [param0.quoteMint]
     * @param {ERef<TimerService>} [param0.timer]
     * @returns {Promise<PriceAuthority>}
     */
    async makeInversePriceAuthority({
      issuerIn,
      issuerOut,
      inOutPriceAuthority,
      quoteMint,
      timer,
    }) {
      const [mathIn, mathOut] = await Promise.all([
        makeLocalAmountMath(issuerIn),
        makeLocalAmountMath(issuerOut),
      ]);

      const quotes = makeInverseQuoteStream({
        mathIn,
        mathOut,
        inOutPriceAuthority,
      });
      return makeLinearPriceAuthority({
        mathIn,
        mathOut,
        quotes,
        timer:
          timer ||
          E(inOutPriceAuthority).getTimerService(
            mathIn.getBrand(),
            mathOut.getBrand(),
          ),
        quoteMint,
      });
    },
    async makeNotifierPriceAuthority({
      notifier,
      issuerIn,
      issuerOut,
      timer,
      unitValueIn = 1,
      scaleValueOut = 1,
      quoteMint,
    }) {
      const [mathIn, mathOut] = await Promise.all([
        makeLocalAmountMath(issuerIn),
        makeLocalAmountMath(issuerOut),
      ]);
      const amountIn = mathIn.make(unitValueIn);

      async function* makeQuotes() {
        for await (const sample of makeAsyncIterableFromNotifier(notifier)) {
          /** @type {Amount} */
          let amountOut;
          try {
            // Scale the sample to the specifiec valueOut.
            const valueOutForUnitIn = Math.floor(
              parseInt(sample, 10) * scaleValueOut,
            );
            amountOut = mathOut.make(valueOutForUnitIn);
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
        mathIn,
        mathOut,
        quotes,
        timer,
        quoteMint,
      });
    },
  };
  return harden(factory);
};

export default harden(startSpawn);

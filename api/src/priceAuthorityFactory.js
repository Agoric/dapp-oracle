// @ts-check
import { E } from '@agoric/eventual-send';
import { makeLocalAmountMath } from '@agoric/ertp';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';
import { makeFungiblePriceAuthority } from './priceAuthority';

const startSpawn = async (_terms, _invitationMaker) => {
  const factory = {
    async makeNotifierPriceAuthority({
      notifier,
      issuerIn,
      issuerOut,
      timer,
      unitValueIn = 1,
      quoteMint,
    }) {
      const [mathIn, mathOut] = await Promise.all([
        makeLocalAmountMath(issuerIn),
        makeLocalAmountMath(issuerOut),
      ]);
      mathIn.make(unitValueIn);

      async function* makeQuotes() {
        for await (const sample of makeAsyncIterableFromNotifier(notifier)) {
          /** @type {number} */
          let valueOutForUnitIn;
          try {
            valueOutForUnitIn = parseInt(sample, 10);
            mathOut.make(valueOutForUnitIn);
          } catch (e) {
            console.error(`Cannot parse ${JSON.stringify(sample)}:`, e);
            // eslint-disable-next-line no-continue
            continue;
          }
          const timestamp = await E(timer).getCurrentTimestamp();
          /** @type {[number, number]} */
          const item = [unitValueIn, valueOutForUnitIn];
          const quote = { timestamp, timer, item };
          // console.error('quoting', quote);
          yield quote;
        }
      }

      const quotes = makeQuotes();
      return makeFungiblePriceAuthority({
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

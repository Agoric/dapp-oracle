import { E, Far } from '@agoric/far';
// FIXME: We should use the chainlink aggregator, but it is incomplete.
// import { start as startAggregator } from '@agoric/zoe/src/contracts/priceAggregatorChainlink.js';
import { start as startAggregator } from '@agoric/zoe/src/contracts/priceAggregator.js';

export const start = async (...args) => {
  const { creatorFacet, ...rest } = await startAggregator(...args);
  return harden({
    ...rest,
    creatorFacet: Far('wrappedCreatorFacet', {
      ...creatorFacet,

      // This adapter is necessary to make the oracle's notifier work with the
      // CL aggregator.
      initOracleWithNotifier: async (instance, notifier, scaleValueOut = 1) => {
        const { pushResult, delete: del, ...rest } = await creatorFacet.initOracle(instance);

        // Adapt the notifier to push results.
        const recurse = ({ value, updateCount }) => {
          if (!notifier || !updateCount) {
            // Interrupt the cycle because we either are deleted or the notifier
            // finished.
            return;
          }
          // Queue the next update.
          E(notifier).getUpdateSince(updateCount).then(recurse);

          // Push the current scaled result.
          const scaledValue = Math.floor(parseInt(value, 10) * scaleValueOut);
          // pushResult({ data: `${scaledValue}`, roundId }).catch(console.error);
          pushResult(scaledValue).catch(console.error);
        };

        // Start the notifier.
        E(notifier).getUpdateSince().then(recurse);

        // Need to rewrap the oracleAdmin since initOracle returns a non-Far
        // object.
        return Far('oracleAdmin', {
          // Provide the same methods as the oracleAdmin.
          ...rest,
          delete: async () => {
            // Interrupt the notifier adapter.
            notifier = undefined;

            // Delete the oracle entry.
            return del();
          },
        });
      },
    }),
  });
}
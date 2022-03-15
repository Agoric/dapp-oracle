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
      initOracleWithNotifier: async (
        instanceP,
        notifier,
        scaleValueOut = 1,
      ) => {
        const instance = await instanceP;
        const {
          pushResult,
          delete: del,
          ...rest2
        } = await creatorFacet.initOracle(instance);

        // Adapt the notifier to push results.
        const recurse = ({ value, updateCount }) => {
          if (!notifier || !updateCount) {
            // Interrupt the cycle because we either are deleted or the notifier
            // finished.
            return;
          }
          // Queue the next update.
          E(notifier)
            .getUpdateSince(updateCount)
            .then(recurse);

          // See if we have associated parameters or just a raw value.
          const data = value.data || value;

          // Push the current scaled result.
          const scaledData = Math.floor(parseInt(data, 10) * scaleValueOut);
          const newData = BigInt(scaledData);

          if (value.data) {
            // We have some associated parameters to push.
            const newValue = { ...value, data: newData };
            pushResult(newValue).catch(console.error);
          } else {
            pushResult(newData).catch(console.error);
          }
        };

        // Start the notifier.
        E(notifier)
          .getUpdateSince()
          .then(recurse);

        // Need to rewrap the oracleAdmin since initOracle returns a non-Far
        // object.
        return Far('oracleAdmin', {
          // Provide the same methods as the oracleAdmin.
          ...rest2,
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
};

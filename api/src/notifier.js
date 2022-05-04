// @ts-check
import { E, Far } from '@agoric/far';
import { makeLegacyMap } from '@agoric/store';
import { makeNotifierKit, observeNotifier } from '@agoric/notifier';

export const makeReplaceableNotifiers = () => {
  const LEAF_KEY = Far('leaf key', {});
  const rootMap = makeLegacyMap();
  return Far('replaceable notifiers', {
    delete: keyPath => {
      let map = rootMap;
      for (const key of keyPath) {
        if (!map.has(key)) {
          throw new Error(`No such key: ${key}`);
        }
        map = map.get(key);
      }
      if (!map.has(LEAF_KEY)) {
        throw new Error(`No such leaf key: ${keyPath}`);
      }
      const { metaUpdater } = map.get(LEAF_KEY);
      map.delete(LEAF_KEY);
      metaUpdater.finish();
    },
    replace: (keyPath, notifier) => {
      let map = rootMap;
      for (const key of keyPath) {
        if (!map.has(key)) {
          map.init(key, makeLegacyMap('key'));
        }
        map = map.get(key);
      }
      if (!map.has(LEAF_KEY)) {
        /** @type {NotifierRecord<unknown>} */
        const {
          updater: stableUpdater,
          notifier: stableNotifier,
        } = makeNotifierKit();
        /** @type {NotifierRecord<Notifier<unknown>>} */
        const {
          updater: metaUpdater,
          notifier: metaNotifier,
        } = makeNotifierKit();

        /** @type {Notifier<unknown> | undefined} */
        let currentNotifier;
        let finishing = false;
        /**
         * @param {Notifier<unknown>} thisNotifier
         * @param {number} [startCount]
         */
        const updateWhileCurrent = async (thisNotifier, startCount) => {
          // Wait until this notifier produces a new value.
          const { value, updateCount: nextCount } = await E(thisNotifier)
            .getUpdateSince(startCount)
            .catch(e => {
              console.error(thisNotifier, 'failed with', e);
              currentNotifier = undefined;
              return { value: undefined, updateCount: NaN };
            });
          if (thisNotifier !== currentNotifier) {
            // Terminate the recursion; we're no longer the current notifier.
            return;
          }
          // Update the stable notifier.
          if (finishing) {
            stableUpdater.finish(value);
            currentNotifier = undefined;
          } else {
            stableUpdater.updateState(value);
            updateWhileCurrent(thisNotifier, nextCount);
          }
        };

        // Observe our notifier of notifiers.
        observeNotifier(metaNotifier, {
          fail: e => {
            currentNotifier = undefined;
            stableUpdater.fail(e);
          },
          finish: () => {
            finishing = true;
          },
          updateState: newNotifier => {
            currentNotifier = newNotifier;
            updateWhileCurrent(newNotifier);
          },
        });

        map.init(LEAF_KEY, harden({ metaUpdater, stableNotifier }));
      }
      const { metaUpdater, stableNotifier } = map.get(LEAF_KEY);
      metaUpdater.updateState(notifier);
      return stableNotifier;
    },
  });
};

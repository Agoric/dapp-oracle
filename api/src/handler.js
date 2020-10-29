// @ts-check
import { makeLocalAmountMath } from '@agoric/ertp';
import { E } from '@agoric/eventual-send';
import { makeExternalOracle } from './external';
import { makeBuiltinOracle } from './builtin';

/**
 * @param {{ zoe: any, http: any, board: any, installOracle?: string, feeIssuer: Issuer, invitationIssuer: Issuer }} param0
 */
const startSpawn = async (
  { board, feeIssuer, http, invitationIssuer, zoe },
  _invitationMaker,
) => {
  const handler = {
    getCommandHandler() {
      const commandHandler = {
        onError(obj, _meta) {
          console.error('Have error', obj);
        },

        onOpen(_obj, _meta) {},

        onClose(_obj, _meta) {},

        async onMessage(obj, _meta) {
          // These are messages we receive from either POST or WebSocket.
          switch (obj.type) {
            case 'oracle/query': {
              try {
                const { instanceId, query } = obj.data;
                const instance = await E(board).getValue(instanceId);
                const publicFacet = E(zoe).getPublicFacet(instance);
                const reply = await E(publicFacet).query(query);
                return harden({
                  type: 'oracle/queryResponse',
                  data: { ...obj.data, reply },
                });
              } catch (e) {
                return harden({
                  type: 'oracle/queryError',
                  data: { ...obj.data, error: `${(e && e.stack) || e}` },
                });
              }
            }

            case 'oracle/sendInvitation': {
              const { depositFacetId, dappContext, offer } = obj.data;
              const { instanceId, query } = dappContext;
              try {
                const depositFacet = E(board).getValue(depositFacetId);
                const instance = await E(board).getValue(instanceId);
                const publicFacet = E(zoe).getPublicFacet(instance);
                const invitationP = await E(publicFacet).makeQueryInvitation(
                  query,
                );
                const deposited = E(depositFacet).receive(invitationP);
                const invitationAmount = await E(invitationIssuer).getAmountOf(
                  invitationP,
                );
                const {
                  value: [{ handle }],
                } = invitationAmount;
                const invitationHandleBoardId = await E(board).getId(handle);
                const updatedOffer = {
                  ...offer,
                  invitationHandleBoardId,
                  dappContext,
                };

                // We need to wait for the invitation to be
                // received, or we will possibly win the race of
                // proposing the offer before the invitation is ready.
                // TODO: We should make this process more robust.
                await deposited;

                return harden({
                  type: 'oracle/sendInvitationResponse',
                  data: { offer: updatedOffer },
                });
              } catch (e) {
                return harden({
                  type: 'oracle/queryError',
                  data: { ...dappContext, error: `${(e && e.stack) || e}` },
                });
              }
            }

            default:
              return undefined;
          }
        },
      };
      return harden(commandHandler);
    },
  };

  const feeAmountMath = await makeLocalAmountMath(feeIssuer);

  return harden({
    handler,
    oracleCreator: {
      makeExternalOracle() {
        return makeExternalOracle({ http, feeAmountMath });
      },
      makeBuiltinOracle({ httpClient, requiredFee }) {
        return makeBuiltinOracle({ httpClient, requiredFee, feeAmountMath });
      },
    },
  });
};

export default harden(startSpawn);

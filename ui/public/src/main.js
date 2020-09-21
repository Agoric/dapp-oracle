// @ts-check
import 'regenerator-runtime/runtime';
import dappConstants from '../lib/constants.js';
import { connect } from './connect.js';
import { walletUpdatePurses, flipSelectedBrands } from './wallet.js';
import { explode } from '../lib/implode';

const { 
  INVITE_BRAND_BOARD_ID, 
  INSTANCE_HANDLE_BOARD_ID, 
  INSTALLATION_HANDLE_BOARD_ID,
  issuerBoardIds: {
    Assurance: ASSURANCE_ISSUER_BOARD_ID,
  },
} = dappConstants;

/**
 * @type {Object.<string, HTMLSelectElement>}
 */
const selects = {
  $brands: /** @type {HTMLSelectElement} */ (document.getElementById('brands')),
  $tipPurse: /** @type {HTMLSelectElement} */ (document.getElementById('tipPurse')),
  $intoPurse: /** @type {HTMLSelectElement} */ (document.getElementById('intoPurse')),
};

const $forFree = /** @type {HTMLInputElement} */ (document.getElementById('forFree'));
const $forTip = /** @type {HTMLInputElement} */ (document.getElementById('forTip'));
const $encourageForm = /** @type {HTMLFormElement} */ (document.getElementById('encourageForm'));

export default async function main() {
  selects.$brands.addEventListener('change', () => {
    flipSelectedBrands(selects);
  });

  let zoeInvitationDepositFacetId;
  
  /**
   * @param {{ type: string; data: any; walletURL: string }} obj
   */
  const walletRecv = obj => {
    switch (obj.type) {
      case 'walletUpdatePurses': {
        const purses = JSON.parse(obj.data);
        walletUpdatePurses(purses, selects);
        $inputAmount.removeAttribute('disabled');
        break;
      }
      case 'walletDepositFacetIdResponse': {
        zoeInvitationDepositFacetId = obj.data;
      }
    }
  };

  const $numEncouragements = /** @type {HTMLInputElement} */ (document.getElementById('numEncouragements'));
  const $inputAmount = /** @type {HTMLInputElement} */ (document.getElementById('inputAmount'));

  /**
   * @param {{ type: string; data: any; }} obj
   */
  const apiRecv = obj => {
    switch (obj.type) {
      case 'encouragement/getEncouragementResponse': {
        alert(`Encourager says: ${obj.data}`);
        break;
      }
      case 'encouragement/encouragedResponse': {
        $numEncouragements.innerHTML = obj.data.count;
        break;
      }
      case 'encouragement/sendInvitationResponse': {
        // Once the invitation has been sent to the user, we update the
        // offer to include the invitationHandleBoardId. Then we make a
        // request to the user's wallet to send the proposed offer for
        // acceptance/rejection.
        const { offer } = obj.data;
        walletSend({
          type: 'walletAddOffer',
          data: offer,
        });
        break;
      }
    }
  };

  const $encourageMe = /** @type {HTMLInputElement} */ (document.getElementById('encourageMe'));
  
  // All the "suggest" messages below are backward-compatible:
  // the new wallet will confirm them with the user, but the old
  // wallet will just ignore the messages and allow access immediately.
  const walletSend = await connect('wallet', walletRecv, '?suggestedDappPetname=Encouragement').then(walletSend => {
    walletSend({ type: 'walletGetPurses'});
    walletSend({ type: 'walletGetDepositFacetId', brandBoardId: INVITE_BRAND_BOARD_ID });
    walletSend({
      type: 'walletSuggestInstallation',
      petname: 'Installation',
      boardId: INSTALLATION_HANDLE_BOARD_ID,
    });
    walletSend({
      type: 'walletSuggestInstance',
      petname: 'Instance',
      boardId: INSTANCE_HANDLE_BOARD_ID,
    });
    walletSend({
      type: 'walletSuggestIssuer',
      petname: 'Assurance',
      boardId: ASSURANCE_ISSUER_BOARD_ID,
    });
    return walletSend;
  });

  const apiSend = await connect('api', apiRecv).then(apiSend => {
    apiSend({
      type: 'encouragement/subscribeNotifications',
    });

    $encourageMe.removeAttribute('disabled');
    $encourageMe.addEventListener('click', () => {
      if ($forFree.checked) {
        apiSend({
          type: 'encouragement/getEncouragement',
        });
      }
      if ($forTip.checked) {
        let optWant = {};
        const intoPurse = selects.$intoPurse.value;
        if (intoPurse && intoPurse !== 'remove()') {
          optWant = {
            want: {
              Assurance: {
                pursePetname: explode(selects.$intoPurse.value),
                value: [],
              },
            },
          };
        }

        const now = Date.now();
        const offer = {
          // JSONable ID for this offer.  This is scoped to the origin.
          id: now,

          // TODO: get this from the invitation instead in the wallet. We
          // don't want to trust the dapp on this.
          instanceHandleBoardId: INSTANCE_HANDLE_BOARD_ID,
          installationHandleBoardId: INSTALLATION_HANDLE_BOARD_ID,
      
          proposalTemplate: {
            give: {
              Tip: {
                // The pursePetname identifies which purse we want to use
                pursePetname: explode(selects.$tipPurse.value),
                value: Number($inputAmount.value),
              },
            },
            ...optWant,
            exit: { onDemand: null },
          },
        };
        apiSend({
          type: 'encouragement/sendInvitation',
          data: {
            depositFacetId: zoeInvitationDepositFacetId,
            offer,
          },
        });
        // alert('Please approve your tip, then close the wallet.')
      }
    });
    
    return apiSend;
  });
}

main();

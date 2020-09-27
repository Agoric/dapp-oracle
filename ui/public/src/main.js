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
    Fee: FEE_ISSUER_BOARD_ID,
  },
} = dappConstants;

/**
 * @type {Object.<string, HTMLSelectElement>}
 */
const selects = {
  $brands: /** @type {HTMLSelectElement} */ (document.getElementById('brands')),
  $feePurse: /** @type {HTMLSelectElement} */ (document.getElementById('feePurse')),
};

const $forFree = /** @type {HTMLInputElement} */ (document.getElementById('forFree'));
const $forFee = /** @type {HTMLInputElement} */ (document.getElementById('forFee'));

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

  const $oracleInstanceId = /** @type {HTMLInputElement} */ (document.getElementById('oracleInstanceId'));
  const $oracleQuery = /** @type {HTMLInputElement} */ (document.getElementById('oracleQuery'));
  const $inputAmount = /** @type {HTMLInputElement} */ (document.getElementById('inputAmount'));
  const $oracleRequests = /** @type {HTMLDivElement} */ (document.getElementById('oracleRequests'));

  if (INSTANCE_HANDLE_BOARD_ID) {
    // Make the oracle visible.
    const boardId = `board:${INSTANCE_HANDLE_BOARD_ID}`;
    $oracleInstanceId.value = boardId;
    document.getElementById('myOracleInstanceId').innerText = boardId;
    for (const el of document.getElementsByClassName('visibleOnlyToOracleService')) {
      const hel = /** @type {HTMLElement} */ (el);
      hel.style.display = 'block';
    }
  }

  let apiSend;
  const queryIdToDeposit = new Map();

  /**
   * @param {{ type: string; data: any; }} obj
   */
  const apiRecv = obj => {
    const doAnswer = (requestId, answer) =>
      apiSend({
        type: 'oracle/requestResponse',
        data: { requestId, answer }
      });
    switch (obj.type) {
      case 'oracle/queryResponse': {
        const { instanceId, query, reply } = obj.data;
        alert(`\
Oracle ${instanceId}
says ${JSON.stringify(query)}
is ${JSON.stringify(reply)}`);
        break;
      }
      case 'oracle/queryError': {
        alert(`Oracle failed: ${obj.data}`);
        break;
      }
      case 'oracle/request': {
        const { method, query, queryId, requestId } = obj.data;
        const id = `query-${queryId}`;
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement('li');
          el.id = id;
          $oracleRequests.appendChild(el);
        }
        if (!el.querySelector('.query')) {
          const ql = document.createElement('div');
          ql.innerText = JSON.stringify(query, null, 2);
          ql.setAttribute('class', 'query');
          el.appendChild(ql);
        }
        let actions = el.querySelector('.actions');
        if (!actions) {
          actions = document.createElement('div');
          actions.setAttribute('class', 'actions');
          el.appendChild(actions);
        }
        switch (method) {
          case 'calculateDeposit': {
            actions.innerHTML = `\
Required deposit: <input type="number" value="0"/> <button>Continue</button>
`;
            const dep = actions.querySelector('input');
            actions.querySelector('button').addEventListener('click', _ev => {
              const deposit = dep.valueAsNumber;
              queryIdToDeposit.set(queryId, deposit);
              doAnswer(requestId, deposit);
              actions.innerHTML = `Waiting for deposit ${deposit}`;
            });
            break;
          }
          case 'getReply': {
            actions.innerHTML = `\
<textarea></textarea>
<button>Reply</button>
`;
            const txt = actions.querySelector('textarea');
            actions.querySelector('button').addEventListener('click', _ev => {
              let reply;
              try {
                reply = JSON.parse(txt.value);
              } catch (e) {
                alert(`Cannot parse reply: ${e && e.stack || e}`);
                return;
              }
              doAnswer(requestId, reply);
              actions.innerHTML = `Waiting for confirmation`;
            });
            break;
          }
          case 'calculateFee': {
            // FIXME: Allow specification.
            const fee = queryIdToDeposit.get(queryId);
            doAnswer(requestId, fee);
            queryIdToDeposit.delete(queryId);
            actions.innerHTML = `Waiting for fee ${fee}`;
            break;
          }
          default: {
            actions.innerHTML = `Unknown method ${method}`;
            break;
          }
        }
        break;
      }
      case 'oracle/completed': {
        const { queryId } = obj.data;
        const id = `query-${queryId}`;
        const el = document.getElementById(id);
        if (el) {
          $oracleRequests.removeChild(el);
        }
        break;
      }
      case 'oracle/sendInvitationResponse': {
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

  const $queryOracle = /** @type {HTMLInputElement} */ (document.getElementById('queryOracle'));
  
  // All the "suggest" messages below are backward-compatible:
  // the new wallet will confirm them with the user, but the old
  // wallet will just ignore the messages and allow access immediately.
  const walletSend = await connect('wallet', walletRecv, '?suggestedDappPetname=Oracle').then(walletSend => {
    walletSend({ type: 'walletGetPurses'});
    walletSend({ type: 'walletGetDepositFacetId', brandBoardId: INVITE_BRAND_BOARD_ID });
    if (INSTALLATION_HANDLE_BOARD_ID) {
      walletSend({
        type: 'walletSuggestInstallation',
        petname: 'Installation',
        boardId: INSTALLATION_HANDLE_BOARD_ID,
      });
    }
    if (INSTANCE_HANDLE_BOARD_ID) {
      walletSend({
        type: 'walletSuggestInstance',
        petname: 'Instance',
        boardId: INSTANCE_HANDLE_BOARD_ID,
      });
    }
    walletSend({
      type: 'walletSuggestIssuer',
      petname: 'Fee',
      boardId: FEE_ISSUER_BOARD_ID,
    });
    return walletSend;
  });

  apiSend = await connect('api', apiRecv).then(apiSend => {
    $queryOracle.removeAttribute('disabled');
    $queryOracle.addEventListener('click', () => {
      let instanceId = $oracleInstanceId.value;
      if (instanceId.startsWith('board:')) {
        instanceId = instanceId.slice('board:'.length);
      }
      let query;
      try {
        query = JSON.parse($oracleQuery.value);
      } catch (e) {
        alert(`Query ${query} is not valid JSON: ${e}`);
        return;
      }
      if ($forFree.checked) {
        apiSend({
          type: 'oracle/query',
          data: {
            instanceId,
            query,
          }
        });
      }
      if ($forFee.checked) {
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
              Fee: {
                // The pursePetname identifies which purse we want to use
                pursePetname: explode(selects.$feePurse.value),
                value: Number($inputAmount.value),
              },
            },
            exit: { onDemand: null },
          },
        };
        apiSend({
          type: 'oracle/sendInvitation',
          data: {
            depositFacetId: zoeInvitationDepositFacetId,
            instanceId,
            query,
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

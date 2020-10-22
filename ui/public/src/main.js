// @ts-check
import 'regenerator-runtime/runtime';
import JSON5 from 'json5';
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
  
  const $oracleInstanceId = /** @type {HTMLInputElement} */ (document.getElementById('oracleInstanceId'));
  const $oracleQuery = /** @type {HTMLInputElement} */ (document.getElementById('oracleQuery'));
  const $inputAmount = /** @type {HTMLInputElement} */ (document.getElementById('inputAmount'));
  const $oracleRequests = /** @type {HTMLDivElement} */ (document.getElementById('oracleRequests'));
  const $oracleReplies = /** @type {HTMLDivElement} */ (document.getElementById('oracleReplies'));

  if (INSTANCE_HANDLE_BOARD_ID) {
    const boardId = `board:${INSTANCE_HANDLE_BOARD_ID}`;
    $oracleInstanceId.value = boardId;
  
      // Make the oracle visible.
    document.getElementById('myOracleInstanceId').innerText = boardId;
    for (const el of document.getElementsByClassName('visibleOnlyToOracleService')) {
      const hel = /** @type {HTMLElement} */ (el);
      hel.style.display = 'block';
    }
  }

  const oracleSend = await connect(
    '/api/oracle', 
    obj => {
      switch (obj.type) {
        case 'oracleServer/onQuery': {
          const { queryId, query, fee, replyId } = obj.data;
          const el = document.createElement('li');
          $oracleRequests.appendChild(el);
          if (!el.querySelector('.query')) {
            const ql = document.createElement('pre');
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
          actions.innerHTML = `\
Fee <input id="fee-${queryId}" value="${Number(fee)}" type="number"/>
<textarea placeholder="JSON reply">null</textarea><br />
<button class="reply">Reply and Collect</button> <button class="cancel">Cancel</button>
`;
          const $fee = actions.querySelector('input');
          actions.querySelector('button.cancel').addEventListener('click', _ev => {
            oracleSend({
              type: 'oracleServer/error',
              data: {
                queryId,
                error: 'cancelled',
              },
            });
            $oracleRequests.removeChild(el);
          });
          const $txt = actions.querySelector('textarea');
          actions.querySelector('button.reply').addEventListener('click', _ev => {
            let reply;
            try {
              reply = JSON5.parse($txt.value);
            } catch (e) {
              alert(`Cannot parse reply: ${e && e.stack || e}`);
              return;
            }
            oracleSend({
              type: 'oracleServer/reply',
              data: {
                queryId,
                reply,
                requiredFee: $fee.valueAsNumber,
              },
            });
            $oracleRequests.removeChild(el);
          });
          break;
        }
      }
    },
  );

  const $queryOracle = /** @type {HTMLInputElement} */ (document.getElementById('queryOracle'));
  
  const answer = ({ replyId, reply, error }) => {
    const $reply = document.querySelector(`#reply-${replyId} .reply`);
    if (error) {
      $reply.innerHTML = error;
    } else {
      const $pre = document.createElement('pre');
      $pre.className = 'reply';
      $pre.innerText = JSON.stringify(reply, null, 2);
      $reply.replaceWith($pre);
    }
  };
  
  // All the "suggest" messages below are backward-compatible:
  // the new wallet will confirm them with the user, but the old
  // wallet will just ignore the messages and allow access immediately.
  const walletSend = await connect(
    'wallet',
    obj => {
      switch (obj.type) {
        case 'walletUpdatePurses': {
          const purses = JSON.parse(obj.data);
          walletUpdatePurses(purses, selects);
          $inputAmount.removeAttribute('disabled');
          break;
        }
        case 'walletDepositFacetIdResponse': {
          zoeInvitationDepositFacetId = obj.data;
          break;
        }
        case 'walletOfferResult': {
          const { dappContext, outcome, error } = obj.data;
          answer({ ...dappContext, reply: outcome, error });
          break;
        }
      }
    },
    '?suggestedDappPetname=Oracle',
  ).then(walletSend => {
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
    if (FEE_ISSUER_BOARD_ID) {
      walletSend({
        type: 'walletSuggestIssuer',
        petname: 'Fee',
        boardId: FEE_ISSUER_BOARD_ID,
      });
    }
    return walletSend;
  });

  /**
   * @param {{ type: string; data: any; }} obj
   */
  const apiRecv = obj => {
    switch (obj.type) {
      case 'oracle/queryResponse': {
        answer(obj.data);
        break;
      }
      case 'oracle/queryError': {
        answer(obj.data);
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

  let lastReplyId;
  connect('/api/oracle-client', apiRecv).then(apiSend => {
    $queryOracle.removeAttribute('disabled');
    $queryOracle.addEventListener('click', () => {
      let instanceId = $oracleInstanceId.value.trim();
      if (instanceId.startsWith('board:')) {
        instanceId = instanceId.slice('board:'.length);
      }
      if (!instanceId) {
        alert(`Oracle ID is not set`);
        return;
      }
      let query;
      try {
        query = JSON5.parse($oracleQuery.value);
        if (Object(query) !== query) {
          throw Error(`Not a JSON object`);
        }
      } catch (e) {
        alert(`Query is invalid: ${e}`);
        return;
      }
      lastReplyId = Date.now();
      const replyId = lastReplyId;
      if ($forFree.checked) {
        apiSend({
          type: 'oracle/query',
          data: {
            instanceId,
            query,
            replyId,
          }
        });
      }
      if ($forFee.checked) {
        const now = Date.now();
        const offer = {
          // JSONable ID for this offer.  This is scoped to the origin.
          id: now,
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
            dappContext: {
              instanceId,
              query,
              replyId,
            },
            offer,
          },
        });
        // alert('Please approve your tip, then close the wallet.')
      }
      const el = document.createElement('li');
      el.id = `reply-${replyId}`;
      el.innerHTML = `\
<div>board:${instanceId}</div>
<div class="queryReply">
  <pre class="query"></pre>
  <div>-&gt;</div>
  <div class="reply">Waiting...</div>
</div>
`;
      const $query = /** @type {HTMLElement} */ (el.querySelector('.query'));
      if ($query) {
        $query.innerText = JSON.stringify(query, null, 2);
      }
      $oracleReplies.prepend(el);
    });
    
    return apiSend;
  });
}

main();

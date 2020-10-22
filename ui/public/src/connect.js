// @ts-check
import { rpc } from '../lib/socket.js';
import { activateSocket as startApi, deactivateSocket as stopApi } from '../lib/api-client.js';
import { activateSocket as startBridge, deactivateSocket as stopBridge } from '../lib/wallet-client.js';

const $messages = /** @type {HTMLDivElement} */ (document.getElementById(`messages`));
const $debug = /** @type {HTMLInputElement} */ (document.getElementById('debug'));

function debugChange() {
  // console.log('checked', $debug.checked);
  if ($debug.checked) {
    $messages.style.display = '';
  } else {
    $messages.style.display = 'none';
  }
}
$debug.addEventListener('change', debugChange);
debugChange();

/**
 * @param {string} endpointPath
 * @param {(obj: { type: string, data: any }) => void} recv
 * @param {string} [query='']
 */
export const connect = (endpointPath, recv, query = '') => {
  const statusId = `${endpointPath}-status`;
  console.log('have' ,statusId);
  const $status = /** @type {HTMLSpanElement} */(document.getElementById(statusId));
  if ($status) {
    $status.innerHTML = 'Connecting...';
  }

  let endpoint;
  switch (endpointPath) {
    case 'wallet': {
      endpoint = `/private/wallet-bridge${query}`;
      break;
     }
    default: {
      endpoint = endpointPath;
      break;
    }
  }

  /**
   * @param {{ type: string, data: any}} obj
   */
  const send = obj => {
    const $m = document.createElement('div');
    $m.className = `message send ${endpointPath}`;
    $m.innerText = `${endpointPath}> ${JSON.stringify(obj)}`;
    $messages.appendChild($m);
    console.log(`${endpointPath}>`, obj);
    return rpc(obj, endpoint);
  };

  /**
   * @type {(value?: any) => void}
   */
  let resolve;
  /**
   * @type {(reason?: any) => void}
   */
  let reject;
  const sendP = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  })
  const activator = endpointPath === 'wallet' ? startBridge : startApi;
  activator({
    onConnect() {
      if ($status) {
        $status.innerHTML = 'Connected';
      }
      resolve(send);
    },
    /**
     * @param {{ type: string, data: any }} obj
     */
    onMessage(obj) {
      if (!obj || typeof obj.type !== 'string') {
        return;
      }
      const $m = document.createElement('div');
      $m.className = `message receive ${endpointPath}`;
      $m.innerText = `${endpointPath}< ${JSON.stringify(obj)}`;
      $messages.appendChild($m);
      console.log(`${endpointPath}<`, obj);
      recv(obj);
    },
    onDisconnect() {
      if ($status) {
        $status.innerHTML = 'Disconnected';
      }
      reject();
    },
  }, endpoint);

  return sendP;
};

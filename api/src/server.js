import anylogger from 'anylogger';
import http from 'http';
import { createConnection } from 'net';
import express from 'express';
import WebSocket from 'ws';

// OCaps FTW.
import { E } from '@agoric/eventual-send';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';

// We need to CommonJS require morgan or else it warns, until:
// https://github.com/expressjs/morgan/issues/190
// is fixed.
const morgan = require('morgan');

export const bootPlugin = ({ getState, setState }) => {
  let state = getState() || { count: 0 };
  console.error('got saved state', state);
  return harden({
    async start(opts) {
      const {
        CONTRACT_NAME = 'Encouragement',
        port = '5000',
        host = '127.0.0.1',
        publicFacet,
        board,
        invitationIssuer,
      } = opts;
      const console = anylogger(`encouragement-api:${port}`);

      // Create a web server with web socket.
      const app = express();
      // HTTP logging
      app.use(
        morgan(
          `:method :url :status :res[content-length] - :response-time ms`,
          {
            stream: {
              write(msg) {
                console.log(msg.trimRight());
              },
            },
          },
        ),
      );
      const server = http.createServer(app);

      state = { count: state.count + 1 };
      setState(state);

      /**
       * @type {Set<WebSocket>}
       */
      const subscribedWS = new Set();
      const sendToAll = obj => {
        const data = JSON.stringify(obj);
        for (const ws of subscribedWS.values()) {
          try {
            ws.send(data);
          } catch (e) {
            // Failed to deliver, so hang up.
            console.error(`Cannot deliver message, closing:`, e);
            try {
              ws.close();
            } catch (e2) {
              // do nothing
            }
            subscribedWS.delete(ws);
          }
        }
      };
      const subscribeNotifier = async notifierP => {
        for await (const value of makeAsyncIterableFromNotifier(notifierP)) {
          sendToAll({
            type: 'encouragement/encouragedResponse',
            data: value,
          });
        }
      };
      let notifierError;
      subscribeNotifier(E(publicFacet).getNotifier()).catch(e => {
        notifierError = e;
        console.error(`Error subscribing to notifier:`, e);
        sendToAll({
          type: 'encouragement/encouragedError',
          data: (e && e.message) || e,
        });
      });

      // Serve up the UI files.
      app.use(express.static(`${__dirname}/../../ui/dist`));

      // accept WebSocket channels at the root path
      // This senses the Upgrade header to distinguish between plain
      // GETs (which should return index.html) and WebSocket requests.
      const wss = new WebSocket.Server({ noServer: true });
      server.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, ws => {
          wss.emit('connection', ws, req);
        });
      });

      // Test to see if the listener already exists.
      await new Promise((resolve, reject) => {
        const to = setTimeout(
          () =>
            reject(
              Error(
                `Something is listening (but suspended) on ${host}:${port}`,
              ),
            ),
          3000,
        );
        const existing = createConnection(port, host, _c => {
          clearTimeout(to);
          reject(Error(`Something is aready listening on ${host}:${port}`));
        });
        existing.on('error', err => {
          clearTimeout(to);
          if (err.code === 'ECONNREFUSED') {
            // Success! host:port is not currently listening.
            resolve();
          } else {
            reject(err);
          }
        });
      });

      const wsActions = {
        noop() {
          // do nothing.
        },
        heartbeat() {
          this.isAlive = true;
        },
      };

      const pingInterval = setInterval(function ping() {
        wss.clients.forEach(ws => {
          if (!ws.isAlive) {
            ws.terminate();
            return;
          }
          ws.isAlive = false;
          ws.ping(wsActions.noop);
        });
      }, 30000);

      wss.on('close', () => clearInterval(pingInterval));

      // Handle inbound WebSocket connections.
      wss.on('connection', ws => {
        ws.isAlive = true;
        ws.on('pong', wsActions.heartbeat);

        const send = obj => ws.send(JSON.stringify(obj));
        ws.on('close', () => {
          subscribedWS.delete(ws);
        });
        ws.on('message', async data => {
          const obj = JSON.parse(data);
          switch (obj.type) {
            case 'encouragement/getEncouragement': {
              send({
                type: 'encouragement/getEncouragementResponse',
                data: await E(publicFacet).getFreeEncouragement(),
              });
              break;
            }

            case 'encouragement/subscribeNotifications': {
              subscribedWS.add(ws);
              send({
                type: 'encouragement/subscribeNotificationsResponse',
                data: !notifierError,
              });
              break;
            }

            case 'encouragement/sendInvitation': {
              const { depositFacetId, offer } = obj.data;
              const depositFacet = E(board).getValue(depositFacetId);
              const invitation = await E(publicFacet).makeInvitation();
              const invitationAmount = await E(invitationIssuer).getAmountOf(
                invitation,
              );
              const {
                value: [{ handle }],
              } = invitationAmount;
              const invitationHandleBoardId = await E(board).getId(handle);
              const updatedOffer = { ...offer, invitationHandleBoardId };
              // We need to wait for the invitation to be
              // received, or we will possibly win the race of
              // proposing the offer before the invitation is ready.
              // TODO: We should make this process more robust.
              await E(depositFacet).receive(invitation);

              send({
                type: 'encouragement/sendInvitationResponse',
                data: { offer: updatedOffer },
              });
              break;
            }

            default: {
              console.error(`Unrecognized message type ${obj.type}`);
              send({
                type: `${obj.type}Response`,
                error: `Unrecognized message type ${obj.type}`,
              });
              break;
            }
          }
        });
      });

      server.listen(port, host, () =>
        console.info(`${CONTRACT_NAME} API listening on`, `${host}:${port}`),
      );
    },
  });
};

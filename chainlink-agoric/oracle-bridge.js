/* eslint-disable no-use-before-define */
// Run with `agoric run oracle.js arg1 arg2 arg3`.

import express from 'express';
import WebSocket from 'ws';

import { Far } from '@endo/far';
import { makePromiseKit } from '@endo/promise-kit';

const { details: X } = assert;

const agoricMain = async (_homeP, { env = process.env }) => {
  console.log('Starting oracle bridge');
  const { PORT = '3000', EI_CHAINLINKURL, POLL_INTERVAL = '60' } = env;
  assert(EI_CHAINLINKURL, '$EI_CHAINLINKURL is required');

  assert(POLL_INTERVAL, '$POLL_INTERVAL is required');
  const intervalSeconds = parseInt(POLL_INTERVAL, 10);
  assert(!isNaN(intervalSeconds), X`$POLL_INTERVAL ${POLL_INTERVAL} must be a number`);

  const { exit, atExit } = makeExiter();

  const powers = { exit, atExit };

  const initiator = startExternalInitiator(EI_CHAINLINKURL, powers)
  const controller = makeFakeController(initiator, intervalSeconds, powers);
  startExternalAdapter(PORT, controller, powers);

  return atExit;
};

export default agoricMain;

const makeFakeController = (initiator, intervalSeconds, { atExit }) => {
  const pollInterval = intervalSeconds * 1_000;
  const it = setInterval(() => {
    updater.updateState();
  }, pollInterval);
  atExit.finally(() => { clearInterval(it); });
  return Far('fakeController', {
    // methods
  });
}

const startExternalAdapter = (PORT, controller, { atExit, exit }) => {
  const app = express();

  app.get('/', (req, res) => {
    res.end('Hello, world!');
  });

  const listener = app.listen(PORT, () => {
    console.log(`External adapter listening on port`, PORT);
  });

  listener.on('error', err => { exit(err) })
  atExit.finally(() => { listener.close(); });
}

const startExternalInitiator = (EI_CHAINLINKURL, { exit, atExit }) => {
  console.log('Starting external initiator with', EI_CHAINLINKURL);
  const ws = new WebSocket(EI_CHAINLINKURL);
  ws.on('close', () => {
    // Be sure to exit the process if the socket goes bad.
    exit(Error('WebSocket closed'));
  });

  ws.on('error', () => {
    // Be sure to exit the process if the socket goes bad.
    exit(Error('WebSocket error'));
  });

  ws.on('open', () => {
    ws.send('Hello, world!');
  });

  atExit.finally(() => { ws.close(); });

  return Far('initiator', {
    // methods
  });
}

function makeExiter() {
  const exitP = makePromiseKit();
  const exit = (status = 0) => {
    if (typeof status !== 'number') {
      console.log(`Rejecting exit promise with`, status);
      exitP.reject(status);
      throw status;
    }
    console.log(`Resolving exit promise with`, status);
    exitP.resolve(status);
    return status;
  }

  return {
    exit,
    atExit: exitP.promise,
  };
}

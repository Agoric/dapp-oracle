/* eslint-disable no-use-before-define */
// Run with `agoric run oracle.js arg1 arg2 arg3`.

import express from 'express';
import WebSocket from 'ws';

async function agoricMain(_homeP, { args, env = process.env }) {
  const { PORT = '3000', EI_CHAINLINKURL } = env;
  assert(EI_CHAINLINKURL, '$EI_CHAINLINKURL is required');

  const { exit, exitPromise } = makeExiter();

  startExternalAdapter(PORT, args);

  startExternalInitiator(EI_CHAINLINKURL, exit);

  return exitPromise;
}

export default agoricMain;

function startExternalAdapter(PORT, args) {
  const app = express();

  app.get('/', (req, res) => {
    res.end('Hello, world!');
  });

  app.listen(PORT, () => {
    console.log(`Listening on port ${PORT} with ${args}`);
  });
}

function makeExiter() {
  let exit;
  const exitPromise = new Promise((_resolve, reject) => (exit = reject));
  return {
    exit,
    exitPromise,
  };
}

function startExternalInitiator(EI_CHAINLINKURL, exit) {
  const ws = new WebSocket(EI_CHAINLINKURL);
  ws.on('close', () => {
    // Be sure to exit the process if the socket goes bad.
    exit(Error('WebSocket closed'));
  });

  exit(Error('Test error'));

  ws.on('open', () => {
    ws.send('Hello, world!');
  });
}

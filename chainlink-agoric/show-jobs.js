#! /usr/bin/env node
import fs from 'fs';
import defaults from '../ui/public/conf/defaults.js';

// console.log(defaults);
const jobids = new URL('./jobids.txt', import.meta.url).pathname;
const lines = fs.readFileSync(jobids, 'utf-8');
for (const line of lines.trimRight().split('\n')) {
  const [jobid, port] = line.split(/\s+/);
  const oraclePort = Number(port) + 200;
  const { INSTANCE_HANDLE_BOARD_ID: instanceId } = defaults[oraclePort] || {};
  process.stdout.write(`board:${instanceId} jobId:${JSON.stringify(jobid)} ?API_URL=http://localhost:${oraclePort} CL=http://localhost:${port}\n`);
}

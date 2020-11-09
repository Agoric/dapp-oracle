#! /usr/bin/env node
const esmRequire = require('esm')(module);
const fs = require('fs');
const defaults = esmRequire('../ui/public/conf/defaults').default;

// console.log(defaults);
const lines = fs.readFileSync(`${__dirname}/jobids.txt`, 'utf-8');
for (const line of lines.trimRight().split('\n')) {
  const [jobid, port] = line.split(/\s+/);
  const oraclePort = Number(port) + 200;
  const { INSTANCE_HANDLE_BOARD_ID: instanceId } = defaults[oraclePort] || {};
  process.stdout.write(`board:${instanceId} jobId:${JSON.stringify(jobid)} ?API_URL=http://localhost:${oraclePort} CL=http://localhost:${port}\n`);
}

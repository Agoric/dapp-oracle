#! /usr/bin/env node
const esmRequire = require('esm')(module);
const fs = require('fs');
const defaults = esmRequire('../ui/public/conf/defaults').default;

// console.log(defaults);
const lines = fs.readFileSync(`${__dirname}/jobids.txt`, 'utf-8');
for (const line of lines.trimRight().split('\n')) {
  const [jobid, port] = line.split(/\s+/);
  const { INSTANCE_HANDLE_BOARD_ID: instanceId } = defaults[port] || {};
  process.stdout.write(`board:${instanceId} jobId:${JSON.stringify(jobid)} http://localhost:${port}\n`);
}

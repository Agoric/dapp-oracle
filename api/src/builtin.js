// @ts-check
/* global BigInt */

import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';

import './types';

/**
 * Create a builtin oracle handler.  This is used for testing (such as on the
 * simulated chain) when decentralized oracles cannot be used.
 *
 * @param {Object} param0
 * @param {HttpClient} param0.httpClient
 * @param {Amount} [param0.requiredFee]
 * @param {AmountMath} param0.feeAmountMath
 */
function makeBuiltinOracle({
  httpClient,
  feeAmountMath,
  requiredFee = feeAmountMath.getEmpty(),
}) {
  /**
   * @type {{ [taskName: string]: (input: any, params: Record<string, any>) =>
   * Promise<any> }}
   */
  const tasks = {
    async httpget(_input, { get }) {
      assert.typeof(
        get,
        'string',
        details`httpget.get ${get} must be a string`,
      );
      const reply = await E(httpClient).get(get);
      assert(
        reply.status >= 200 && reply.status < 300,
        details`httpget reply status ${reply.status} is not 2xx`,
      );
      return reply.data;
    },
    async jsonparse(input, { path = [] }) {
      assert(
        Array.isArray(path),
        details`jsonparse.path ${path} must be an array of strings`,
      );
      path.forEach(el =>
        assert.typeof(
          el,
          'string',
          details`jsonparse.path element ${el} must be a string`,
        ),
      );
      assert.typeof(
        input,
        'string',
        details`jsonparse.input ${input} must be a string`,
      );
      let result = JSON.parse(input);
      for (const el of path) {
        if (!result) {
          break;
        }
        result = result[el];
      }
      return result;
    },
    async multiply(input, { times = 1 }) {
      assert(
        Number.isSafeInteger(times),
        details`multiply.times ${times} must be a safe integer`,
      );

      // Parse result as a big decimal.
      const match = `${input}`.match(/^(\d+)(\.(\d*[1-9])?0*)$/);
      assert(match, details`multiply.input ${input} must be a decimal number`);

      // Convert the input decimal to a scaled natural.
      const sInputNat = match[1];
      const sInputDecimals = match[3];
      const bInScaled = BigInt(`${sInputNat}${sInputDecimals}`);

      // Actually multiply.
      const bOutScaled = bInScaled * BigInt(times);

      // Determine the scale to unscale the scaled natural.
      const places = sInputDecimals.length;
      const bScale = BigInt(10) ** BigInt(places);

      // Get the natural part of the output.
      const sResultNat = `${bOutScaled / bScale}`;
      const sResultDecimals = `${bOutScaled % bScale}`.padStart(places, '0');

      if (sResultDecimals.match(/^0*$/)) {
        // No non-zero decimal places, so omit the decimal point.
        return sResultNat;
      }

      // Some decimal places, so use the decimal point.
      return `${sResultNat}.${sResultDecimals}`;
    },
  };

  async function chainlinkSampleJob(params) {
    let result = '';
    for (const task of ['httpget', 'jsonparse', 'multiply']) {
      console.error('begin', task);
      // eslint-disable-next-line no-await-in-loop
      result = await tasks[task](result, params);
      console.error('end', task);
    }
    return result;
  }

  /** @type {OracleHandler} */
  const oracleHandler = {
    async onQuery(query, fee) {
      assert(
        !requiredFee || feeAmountMath.isGTE(fee, requiredFee),
        details`Minimum fee of ${requiredFee} has not been supplied`,
      );

      // Decide how to handle the query.
      let replyP;
      if (query.jobId === '<chainlink-jobid>') {
        replyP = chainlinkSampleJob(query.params);
      }

      assert(replyP, details`Unimplemented builtin oracle query ${query}`);

      // Return the calculated reply.
      const reply = await replyP;
      return harden({ reply, requiredFee });
    },
    async onReply(_query, _reply, _fee) {
      return undefined;
    },
    async onError(query, e) {
      console.error(`Builtin oracle failed`, query, `with:`, e);
    },
  };

  return harden({
    oracleHandler,
  });
}

harden(makeBuiltinOracle);
export { makeBuiltinOracle };

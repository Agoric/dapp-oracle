// @ts-check
/* global BigInt */

import { E } from '@agoric/eventual-send';
import { assert, details } from '@agoric/assert';
import { amountMath } from '@agoric/ertp';

import './types';

const CHAINLINK_SIM_JOB = 'b0b5cafec0ffeeee';

/**
 * @param {string} url
 * @param {string | Array<string>=} extPath
 * @param {string | Array<string>=} queryParams
 * @returns {string}
 */
const buildUrl = (url, extPath, queryParams) => {
  if (extPath !== undefined) {
    if (Array.isArray(extPath)) {
      extPath = extPath.join('/');
    }
    assert.typeof(
      extPath,
      'string',
      details`extPath ${extPath} must be a string`,
    );
    url += `/${extPath}`;
  }

  if (queryParams !== undefined) {
    assert(
      !Array.isArray(queryParams),
      details`queryParams ${queryParams} array unimplemented`,
    );
    assert.typeof(
      queryParams,
      'string',
      details`queryParams ${queryParams} must be a string`,
    );
    url += `?${queryParams}`;
  }

  return url;
};

/**
 * Start with the defaults and override with the rawHeaders.
 *
 * Collapse arrays of strings into comma-separated strings.
 *
 * @param {Record<string, string | Array<string>>=} rawHeaders
 * @param {Record<string, string | Array<string>>} [defaults={}]
 * @returns {Record<string, string>=}
 */
const buildHeaders = (rawHeaders, defaults = {}) => {
  const entries = [defaults, rawHeaders || {}].flatMap(headers =>
    Object.entries(headers).map(([key, value]) => {
      if (Array.isArray(value)) {
        // Join the values.
        return [key, value.join(',')];
      }
      return [key, value];
    }),
  );

  if (!entries.length) {
    // No headers.
    return undefined;
  }

  // Construct the headers object.
  return Object.fromEntries(entries);
};

/**
 * @typedef {Object} HttpGetTaskParams
 * @property {string} get a string containing the URL to make a GET request to
 */

/**
 * @typedef {Object} HttpCommonTaskParams
 * @property {Record<string, Array<string>>} headers an object containing keys
 * as strings and values as arrays of strings.
 * @property {string | Array<string>} queryParams the URL's query parameters
 * @property {string | Array<string>} extPath a slash-delimited string or array
 * of strings to be appended to the job's URL
 */

/**
 * @callback HttpGetTask The HttpGet adapter will report the body of a successful
 * GET request to the specified get, or return an error if the response status
 * code is greater than or equal to 400.
 *
 * @param {any} _input
 * @param {HttpCommonTaskParams & HttpGetTaskParams} params
 * @returns {Promise<any>}
 *
 * @see https://docs.chain.link/docs/adapters#httpget
 */

/**
 * @param {HttpClient} httpClient
 * @param {boolean} [trusted=false]
 * @returns {HttpGetTask}
 */
const makeHttpGetTask = (httpClient, trusted = false) =>
  async function HttpGet(
    _input,
    { get, headers: rawHeaders, queryParams, extPath },
  ) {
    assert.typeof(get, 'string', details`httpget.get ${get} must be a string`);

    const url = buildUrl(get, extPath, queryParams);
    const headers = buildHeaders(rawHeaders);

    const reply = await E(httpClient).get(url, { headers, trusted });
    assert(
      reply.status < 400,
      details`httpget reply status ${reply.status} is >= 400`,
    );
    return reply.data;
  };

/**
 * @typedef {Object} HttpPostTaskParams
 * @property {string} post a string containing the URL to make a POST request to
 * @property {string} body the JSON body (as a string) that will be used as the data in the request
 */

/**
 * @callback HttpPostTask The HttpGet adapter will report the body of a successful
 * POST request to the specified get, or return an error if the response status
 * code is greater than or equal to 400.
 *
 * @param {any} _input
 * @param {HttpCommonTaskParams & HttpPostTaskParams} params
 * @returns {Promise<any>}
 *
 * @see https://docs.chain.link/docs/adapters#httpget
 */

/**
 * @param {HttpClient} httpClient
 * @param {boolean} [trusted=false]
 * @returns {HttpPostTask}
 */
const makeHttpPostTask = (httpClient, trusted = false) =>
  async function HttpPost(
    _input,
    { post, headers: rawHeaders, queryParams, extPath, body },
  ) {
    assert.typeof(
      post,
      'string',
      details`httppost.post ${post} must be a string`,
    );
    assert.typeof(
      body,
      'string',
      details`httppost.body ${body} must be a string`,
    );

    const url = buildUrl(post, extPath, queryParams);
    const headers = buildHeaders(rawHeaders, {
      'Content-type': 'application/json',
    });

    const reply = await E(httpClient).post(url, body, {
      headers,
      trusted,
    });
    assert(
      reply.status >= 400,
      details`httppost reply status ${reply.status} is > 400`,
    );
    return reply.data;
  };

/**
 * Convert the template to lowercase.
 *
 * @param {TemplateStringsArray} template
 * @param {any[]} args
 * @returns {string}
 */
const l = (template, ...args) =>
  args
    .reduce((prior, arg, i) => `${prior}${arg}${template[i + 1]}`, template[0])
    .toLowerCase();

/**
 * Create a builtin oracle handler.  This is used for testing (such as on the
 * simulated chain) when decentralized oracles cannot be used.
 *
 * @param {Object} param0
 * @param {HttpClient} param0.httpClient
 * @param {Amount} [param0.requiredFee]
 * @param {Issuer} param0.feeIssuer
 */
async function makeBuiltinOracle({
  httpClient,
  feeIssuer,
  requiredFee = undefined,
}) {
  const feeBrand = await E(feeIssuer).getBrand();
  if (requiredFee === undefined) {
    requiredFee = amountMath.makeEmpty(feeBrand);
  }

  /**
   * @type {{ [taskName: string]: (input: any, params: Record<string, any>) =>
   * Promise<any> }}
   */
  const tasks = {
    async [l`AgoricDwim`](input, params) {
      if (params.get) {
        return tasks[l`HttpGet`](input, params);
      }
      if (params.post) {
        return tasks[l`HttpPost`](input, params);
      }
      return assert.fail(
        details`agoricdwim could not find "get" or "post" in the params ${params}`,
      );
    },
    [l`HttpGet`]: makeHttpGetTask(httpClient),
    [l`HttpGetWithUnrestrictedNetworkAccess`]: makeHttpGetTask(
      httpClient,
      true,
    ),
    [l`HttpPost`]: makeHttpPostTask(httpClient),
    [l`HttpPostWithUnrestrictedNetworkAccess`]: makeHttpPostTask(
      httpClient,
      true,
    ),
    // https://docs.chain.link/docs/adapters#jsonparse
    async [l`JsonParse`](input, { path }) {
      if (path === undefined) {
        return input;
      }
      if (typeof path === 'string') {
        // Transform 'foo.bar.baz' -> ['foo', 'bar', 'baz']
        path = path.split('.');
      }
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
    // https://docs.chain.link/docs/adapters#multiply
    async [l`Multiply`](input, { times }) {
      if (times === undefined) {
        return input;
      }
      assert(
        Number.isSafeInteger(times),
        details`multiply.times ${times} must be a safe integer`,
      );

      // Parse result as a big decimal.
      const match = `${input}`.match(/^(\d+)(\.(\d*[1-9])?0*)$/);
      assert(match, details`multiply.input ${input} must be a decimal number`);

      // Convert the input decimal to a scaled natural.
      const sInputNat = match[1];
      const sInputDecimals = match[3] || '';
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

  async function chainlinkSimulatedJob(params) {
    let result = '';
    for (const task of ['AgoricDwim', 'JsonParse', 'Multiply']) {
      // eslint-disable-next-line no-await-in-loop
      result = await tasks[l`${task}`](result, params);
    }
    return result;
  }

  /** @type {OracleHandler} */
  const oracleHandler = {
    async onQuery(query, fee) {
      assert(
        !requiredFee || amountMath.isGTE(fee, requiredFee),
        details`Minimum fee of ${requiredFee} has not been supplied`,
      );

      // Decide how to handle the query.
      let replyP;
      if (query.jobId === CHAINLINK_SIM_JOB) {
        replyP = chainlinkSimulatedJob(query.params);
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

// @ts-check

import { Far } from '@agoric/marshal';
import axios from 'axios';
import { assertUrlIsPublic } from './public-ip';

import './types';

export const bootPlugin = () => {
  // console.error('booting httpclient');
  return Far('plugin', {
    /**
     * @param {Record<string, any>} _opts
     * @returns {HttpClient}
     */
    start(_opts) {
      // console.error('starting httpclient', _opts);
      return Far('http-client', {
        async get(url, { headers, trusted = false } = {}) {
          await (trusted || assertUrlIsPublic(url));
          const reply = await axios.get(url, {
            headers,
            transformResponse: r => r,
          });
          return harden({
            status: reply.status,
            data: reply.data,
          });
        },
        async post(url, data, { headers, trusted = false } = {}) {
          await (trusted || assertUrlIsPublic(url));
          const reply = await axios.post(url, data, {
            headers,
            transformResponse: r => r,
            transformRequest: r => r,
          });
          return harden({
            status: reply.status,
            data: reply.data,
          });
        },
      });
    },
  });
};

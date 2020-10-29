// @ts-check

import axios from 'axios';
import './types';

export const bootPlugin = () => {
  // console.error('booting httpclient');
  return harden({
    /**
     * @param {Record<string, any>} _opts
     * @returns {HttpClient}
     */
    start(_opts) {
      // console.error('starting httpclient', _opts);
      return harden({
        async get(url) {
          const reply = await axios.get(url, { transformResponse: r => r });
          return harden({
            status: reply.status,
            data: reply.data,
          });
        },
      });
    },
  });
};

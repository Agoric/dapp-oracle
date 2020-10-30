/**
 * @typedef {Object} HttpClientResponse
 * @property {string} data Reply data
 * @property {number} status HTTP status code (e.g. `200`)
 */

/**
 * @typedef {Object} HttpClientOptions
 * @property {Record<string, string>} [headers]
 * @property {boolean} [trusted=false]
 */

/**
 * @typedef {Object} HttpClient
 * @property {(url: string, options: HttpClientOptions=) =>
 * Promise<HttpClientResponse>} get Issue an HTTP GET request, and return the
 * response
 * @property {(url: string, data: string, options: HttpClientOptions=) =>
 * Promise<HttpClientResponse>} post Issue an HTTP POST request and return the
 * response
 */

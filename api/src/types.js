/**
 * @typedef {Object} HttpClientResponse
 * @property {string} data Reply data
 * @property {number} status HTTP status code (e.g. `200`)
 */

/**
 * @typedef {Object} HttpClient
 * @property {(url: string) => Promise<HttpClientResponse>} get Issue an HTTP GET request,
 * and return the response
 */

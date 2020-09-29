// Allow the runtime to override the defaults with __DAPP_CONSTANTS__
import defaults from '../conf/defaults.js';

const params = new URLSearchParams(window.location.search);
const API_PORT = params.get('API_PORT') || '8000';
const fullDefaults = { ...defaults, ...defaults[API_PORT], API_PORT };

// eslint-disable-next-line no-underscore-dangle
export default globalThis.__DAPP_CONSTANTS__ || fullDefaults;

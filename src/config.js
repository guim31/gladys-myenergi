// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds. One minute is
// the fastest: the myenergi cloud is a shared service, the HACS integration
// reads it every minute too.
export const REFRESH_INTERVALS = ['60', '120', '300', '600'];

export const DEFAULT_CONFIG = {
  hub_serial: '',
  api_key: '',
  refresh_interval: '60',
  language: 'fr',
};

/**
 * The serial number of the hub, as printed on its label or shown in the app:
 * digits only. Spaces and dashes typed by the user are dropped.
 * @param {unknown} raw
 * @returns {string} the digits, '' when unusable
 */
export function parseSerial(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return '';
  }
  const digits = String(raw).replace(/[\s-]/g, '');
  return /^\d{4,12}$/.test(digits) ? digits : '';
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const interval = String(source.refresh_interval ?? DEFAULT_CONFIG.refresh_interval);
  const language = LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language;
  return {
    hubSerial: parseSerial(source.hub_serial),
    // A serial was typed, but it is not a serial: said in the connection status.
    invalidSerial:
      typeof source.hub_serial === 'string' &&
      source.hub_serial.trim() !== '' &&
      parseSerial(source.hub_serial) === '',
    apiKey: typeof source.api_key === 'string' ? source.api_key.trim() : '',
    refreshMs:
      Number(REFRESH_INTERVALS.includes(interval) ? interval : DEFAULT_CONFIG.refresh_interval) *
      1000,
    language,
  };
}

/** Both credentials are there: the cloud can be read. */
export const isConfigured = (config) => Boolean(config?.hubSerial && config?.apiKey);

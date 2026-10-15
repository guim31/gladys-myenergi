// -----------------------------------------------------------------------------
// HTTP digest authentication (RFC 7616), the scheme of the myenergi cloud: the
// user name is the serial number of the hub, the password the API key created
// in the myenergi app. Only what the myenergi servers need: MD5 (and SHA-256,
// MD5-sess for good measure), qop "auth" or none, GET requests.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

/**
 * Parse a `WWW-Authenticate: Digest ...` header.
 * @param {string|undefined} header
 * @returns {Record<string, string>|null} the lower-cased parameters, null when not Digest
 */
export function parseChallenge(header) {
  if (typeof header !== 'string') {
    return null;
  }
  const match = header.match(/^\s*Digest\s+(.*)$/is);
  if (!match) {
    return null;
  }
  const params = {};
  const pattern = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi;
  for (const [, key, quoted, bare] of match[1].matchAll(pattern)) {
    params[key.toLowerCase()] = quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : bare;
  }
  return params.nonce && params.realm !== undefined ? params : null;
}

const HASHES = { MD5: 'md5', 'MD5-SESS': 'md5', 'SHA-256': 'sha256', 'SHA-256-SESS': 'sha256' };

/** Whether this client can answer the challenge. */
export const isSupported = (challenge) =>
  Boolean(challenge) && HASHES[(challenge.algorithm ?? 'MD5').toUpperCase()] !== undefined;

/**
 * The `Authorization` header answering a challenge.
 * @param {object} options
 * @param {Record<string, string>} options.challenge parsed by parseChallenge
 * @param {string} options.username
 * @param {string} options.password
 * @param {string} options.method
 * @param {string} options.uri path and query of the request
 * @param {number} options.nc request counter for this nonce (1, 2, ...)
 * @param {string} [options.cnonce]
 */
export function authorization({
  challenge,
  username,
  password,
  method,
  uri,
  nc,
  cnonce = randomBytes(8).toString('hex'),
}) {
  const algorithm = (challenge.algorithm ?? 'MD5').toUpperCase();
  const hash = (text) => createHash(HASHES[algorithm]).update(text).digest('hex');
  const qops = (challenge.qop ?? '').split(',').map((qop) => qop.trim().toLowerCase());
  const qop = qops.includes('auth') ? 'auth' : null;
  const ncHex = nc.toString(16).padStart(8, '0');

  let ha1 = hash(`${username}:${challenge.realm}:${password}`);
  if (algorithm.endsWith('-SESS')) {
    ha1 = hash(`${ha1}:${challenge.nonce}:${cnonce}`);
  }
  const ha2 = hash(`${method}:${uri}`);
  const response = qop
    ? hash(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `algorithm=${challenge.algorithm ?? 'MD5'}`,
    `response="${response}"`,
  ];
  if (qop) {
    parts.push(`qop=${qop}`, `nc=${ncHex}`, `cnonce="${cnonce}"`);
  }
  if (challenge.opaque !== undefined) {
    parts.push(`opaque="${challenge.opaque}"`);
  }
  return `Digest ${parts.join(', ')}`;
}

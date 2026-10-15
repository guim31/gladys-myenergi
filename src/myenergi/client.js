// -----------------------------------------------------------------------------
// Client of the myenergi cloud, the API the myenergi app uses (the same one
// as the HACS integration, through CJNE/pymyenergi):
//
//   1. GET https://director.myenergi.net/cgi-jstatus-E, digest authenticated
//      with the hub serial and the API key: the `x_myenergi-asn` header of the
//      answer names the server that holds the account (s18.myenergi.net...);
//   2. every request then goes to that server, which may name another one in
//      the same header (followed); after a network error or a server error,
//      the director is asked again.
//
// Every command is a GET too (`/cgi-zappi-mode-...`). The client never logs:
// the hub (src/hub.js) decides what is worth a line.
// -----------------------------------------------------------------------------

import { authorization, isSupported, parseChallenge } from './digest.js';

export const DIRECTOR_HOST = 'director.myenergi.net';

// The servers the director may send the client to. The credentials are sent
// (digest, never in clear) to the host the header names: anything outside the
// myenergi domain is refused rather than followed.
const ASN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.myenergi\.net$/i;

// pymyenergi sends this User-Agent: the cloud is known to answer it.
const USER_AGENT = 'Wget/1.14 (linux-gnu)';

export const ERROR_KINDS = Object.freeze({
  AUTH: 'auth', // serial or API key refused
  UNREACHABLE: 'unreachable', // network error, timeout
  RATE: 'rate', // 429: too many requests
  SERVER: 'server', // 5xx or any other unexpected status
  ANSWER: 'answer', // the answer is not what the API documents
  REFUSED: 'refused', // a command answered with a non-zero status
});

export class MyenergiError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message never carries a credential
   * @param {object} [details]
   */
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'MyenergiError';
    this.kind = kind;
    Object.assign(this, details);
  }
}

/**
 * Default transport: `fetch`, the whole body read as text.
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export async function fetchRequest(url, { method = 'GET', headers = {}, timeoutMs = 20_000 } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
}

const header = (headers, name) => {
  const key = Object.keys(headers ?? {}).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
};

export class MyenergiClient {
  /**
   * @param {object} options
   * @param {string} options.serial serial number of the hub (digest user name)
   * @param {string} options.apiKey API key created in the myenergi app
   * @param {Function} [options.request] transport seam, see fetchRequest
   * @param {number} [options.timeoutMs]
   */
  constructor({ serial, apiKey, request = fetchRequest, timeoutMs = 20_000 }) {
    this.serial = serial;
    this.apiKey = apiKey;
    this.request = request;
    this.timeoutMs = timeoutMs;
    /** Server of the account, from the director; null: ask the director. */
    this.host = null;
    /** Last digest challenge and its counter, per host. */
    this.challenges = new Map();
  }

  /** One HTTP exchange, digest answered (at most one retry on a new challenge). */
  async exchange(host, path) {
    const url = `https://${host}${path}`;
    const send = async () => {
      const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
      const known = this.challenges.get(host);
      if (known) {
        known.nc += 1;
        headers.Authorization = authorization({
          challenge: known.challenge,
          username: this.serial,
          password: this.apiKey,
          method: 'GET',
          uri: path,
          nc: known.nc,
        });
      }
      try {
        return await this.request(url, { method: 'GET', headers, timeoutMs: this.timeoutMs });
      } catch (err) {
        throw new MyenergiError(
          ERROR_KINDS.UNREACHABLE,
          `${host} unreachable (${err.cause?.code ?? err.name ?? 'network error'})`,
        );
      }
    };

    let response = await send();
    if (response.status === 401) {
      const challenge = parseChallenge(header(response.headers, 'www-authenticate'));
      const previous = this.challenges.get(host);
      // A first challenge, a new nonce or a stale one: answer it once. The
      // same nonce refused again means the credentials are wrong.
      const retry =
        isSupported(challenge) &&
        (!previous ||
          previous.challenge.nonce !== challenge.nonce ||
          /true/i.test(challenge.stale));
      if (retry) {
        this.challenges.set(host, { challenge, nc: 0 });
        response = await send();
      }
    }
    return response;
  }

  /** Learn the server of the account from the director. */
  async locate() {
    const response = await this.exchange(DIRECTOR_HOST, '/cgi-jstatus-E');
    if (response.status === 401) {
      throw new MyenergiError(ERROR_KINDS.AUTH, 'hub serial number or API key refused', {
        status: 401,
      });
    }
    this.checkStatus(response, DIRECTOR_HOST);
    const asn = header(response.headers, 'x_myenergi-asn');
    if (!asn) {
      // pymyenergi reads a missing header the same way: the director did not
      // recognize the account.
      throw new MyenergiError(ERROR_KINDS.AUTH, 'the director did not name a server');
    }
    if (!ASN_PATTERN.test(asn)) {
      throw new MyenergiError(ERROR_KINDS.ANSWER, 'the director named a server outside myenergi');
    }
    this.host = asn.toLowerCase();
    return this.host;
  }

  checkStatus(response, host) {
    if (response.status === 200) {
      return;
    }
    if (response.status === 429) {
      throw new MyenergiError(ERROR_KINDS.RATE, `${host} answered 429 (too many requests)`, {
        status: 429,
      });
    }
    throw new MyenergiError(ERROR_KINDS.SERVER, `${host} answered HTTP ${response.status}`, {
      status: response.status,
    });
  }

  /**
   * GET a path of the account server, parsed as JSON.
   * @param {string} path e.g. `/cgi-jstatus-*`
   */
  async get(path) {
    if (!this.serial || !this.apiKey) {
      throw new MyenergiError(ERROR_KINDS.AUTH, 'hub serial number or API key missing');
    }
    const host = this.host ?? (await this.locate());
    let response;
    try {
      response = await this.exchange(host, path);
    } catch (err) {
      this.host = null; // maybe the server moved: ask the director next time
      throw err;
    }
    if (response.status === 401) {
      this.host = null;
      throw new MyenergiError(ERROR_KINDS.AUTH, 'hub serial number or API key refused', {
        status: 401,
      });
    }
    // The server of the account changed: follow it from the next request.
    const asn = header(response.headers, 'x_myenergi-asn');
    if (asn && ASN_PATTERN.test(asn)) {
      this.host = asn.toLowerCase();
    }
    try {
      this.checkStatus(response, host);
    } catch (err) {
      if (err.kind === ERROR_KINDS.SERVER) {
        this.host = null;
      }
      throw err;
    }
    try {
      return JSON.parse(response.body);
    } catch {
      throw new MyenergiError(ERROR_KINDS.ANSWER, `${host} answered something else than JSON`);
    }
  }

  /** Every device of the account, in one request. */
  getStatus() {
    return this.get('/cgi-jstatus-*');
  }

  /** The names given to the site and the devices in the app. */
  getNames() {
    return this.get('/cgi-get-app-key-');
  }

  /**
   * Hourly history of one device, from an instant given in UTC.
   * @param {string} prefix Z, E, H or L
   * @param {string} serial
   * @param {Date} from start, on the hour (UTC)
   * @param {number} hours how many hours (1 to 48)
   */
  getHourlyHistory(prefix, serial, from, hours) {
    const parts = [
      from.getUTCFullYear(),
      from.getUTCMonth() + 1,
      from.getUTCDate(),
      from.getUTCHours(),
      hours,
    ].join('-');
    return this.get(`/cgi-jdayhour-${prefix}${serial}-${parts}`);
  }

  /** A command: refused when the answer carries a non-zero status. */
  async command(path) {
    const answer = await this.get(path);
    if (answer && typeof answer === 'object' && !Array.isArray(answer) && 'status' in answer) {
      const code = Number(answer.status);
      if (Number.isFinite(code) && code !== 0) {
        throw new MyenergiError(
          ERROR_KINDS.REFUSED,
          `command refused (status ${code}${answer.statustext ? `: ${answer.statustext}` : ''})`,
          { code },
        );
      }
    }
    return answer;
  }

  /** zappi charge mode: 1 Fast, 2 Eco, 3 Eco+, 4 Stop. */
  setZappiMode(serial, mode) {
    return this.command(`/cgi-zappi-mode-Z${serial}-${mode}-0-0-0000`);
  }

  /** zappi manual boost of `kwh` kWh. */
  startZappiBoost(serial, kwh) {
    return this.command(`/cgi-zappi-mode-Z${serial}-0-10-${kwh}-0000`);
  }

  /** zappi smart boost: `kwh` kWh ready by `hhmm` (e.g. "0730"). */
  startZappiSmartBoost(serial, kwh, hhmm) {
    return this.command(`/cgi-zappi-mode-Z${serial}-0-11-${kwh}-${hhmm}`);
  }

  stopZappiBoost(serial) {
    return this.command(`/cgi-zappi-mode-Z${serial}-0-2-0-0000`);
  }

  /** eddi operating mode: on (normal, diverts the surplus) or stopped. */
  setEddiEnabled(serial, enabled) {
    return this.command(`/cgi-eddi-mode-E${serial}-${enabled ? 1 : 0}`);
  }

  /** eddi manual boost of heater 1 or 2 for `minutes` minutes. */
  startEddiBoost(serial, heater, minutes) {
    return this.command(`/cgi-eddi-boost-E${serial}-10-${heater}-${minutes}`);
  }

  stopEddiBoost(serial, heater) {
    return this.command(`/cgi-eddi-boost-E${serial}-1-${heater}-0`);
  }
}

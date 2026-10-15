// -----------------------------------------------------------------------------
// A fake myenergi cloud behind the transport seam of the client: the director,
// one account server, real digest authentication (a wrong key is refused like
// the cloud does), the status of the fixtures, the hourly history and the
// commands, which change the status the next reading returns.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseChallenge } from '../../src/myenergi/digest.js';

export const SERIAL = '12345678';
export const API_KEY = 'test-api-key-not-real';
export const ASN = 's18.myenergi.net';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/myenergi/${name}`, import.meta.url), 'utf8'));

export const loadFixture = fixture;

const md5 = (text) => createHash('md5').update(text).digest('hex');
const KIND_OF = { Z: 'zappi', E: 'eddi', H: 'harvi', L: 'libbi' };

const json = (body, headers = {}) => ({
  status: 200,
  headers: { 'content-type': 'application/json', 'x_myenergi-asn': ASN, ...headers },
  body: JSON.stringify(body),
});

// The `Authorization: Digest ...` header has the grammar of the challenge.
const parseAuthorization = (header) => parseChallenge(header);

export class FakeCloud {
  /**
   * @param {object} [options]
   * @param {() => number} [options.now] clock of the history
   * @param {Array} [options.status] the `/cgi-jstatus-*` answer
   */
  constructor({
    now = () => Date.now(),
    status = fixture('status.json'),
    names = fixture('names.json'),
  } = {}) {
    this.now = now;
    this.status = structuredClone(status);
    this.names = structuredClone(names);
    this.serial = SERIAL;
    this.apiKey = API_KEY;
    this.realm = 'MyEnergi Telemetry';
    this.nonce = 'nonce-1';
    this.online = true;
    /** Status code answered instead of the real answer (500, 429...), once set. */
    this.failWith = null;
    /** Every request: `{ host, path, authorized }`. */
    this.requests = [];
    /** Energy of each hour, in joules, by `<kind>:<serial>`: `(hourStartMs) => { h1d, h1b }`. */
    this.hourly = {
      zappi: () => ({ h1d: 3_600_000, h1b: 1_800_000 }), // 1 kWh diverted + 0.5 kWh boosted
      eddi: () => ({ h1d: 900_000, h1b: 0 }), // 0.25 kWh diverted
    };
    this.request = this.request.bind(this);
  }

  /** The raw status of one device (mutable: the next reading returns it). */
  device(kind, serial) {
    for (const group of this.status) {
      const found = (group[kind] ?? []).find((device) => String(device.sno) === String(serial));
      if (found) {
        return found;
      }
    }
    throw new Error(`no ${kind} ${serial} in the fake status`);
  }

  challenge() {
    return {
      status: 401,
      headers: {
        'www-authenticate': `Digest realm="${this.realm}", qop="auth", nonce="${this.nonce}", opaque="opaque-1", algorithm=MD5`,
      },
      body: '',
    };
  }

  authorized(headers, path) {
    const auth = parseAuthorization(headers?.Authorization);
    if (!auth || auth.nonce !== this.nonce || auth.username !== this.serial) {
      return false;
    }
    const ha1 = md5(`${auth.username}:${this.realm}:${this.apiKey}`);
    const ha2 = md5(`GET:${auth.uri}`);
    const expected = md5(`${ha1}:${auth.nonce}:${auth.nc}:${auth.cnonce}:${auth.qop}:${ha2}`);
    return auth.uri === path && auth.response === expected;
  }

  async request(url, { headers } = {}) {
    const { host, pathname } = new URL(url);
    const path = decodeURIComponent(pathname);
    const authorized = this.authorized(headers, path);
    this.requests.push({ host, path, authorized });
    if (!this.online) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    if (host !== 'director.myenergi.net' && host !== ASN) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ENOTFOUND' };
      throw err;
    }
    if (!authorized) {
      return this.challenge();
    }
    if (this.failWith) {
      return { status: this.failWith, headers: {}, body: '' };
    }
    if (host === 'director.myenergi.net') {
      return json([]);
    }
    return this.answer(path);
  }

  answer(path) {
    if (path === '/cgi-jstatus-*') {
      return json(this.status);
    }
    if (path === '/cgi-get-app-key-') {
      return json(this.names);
    }
    let match = path.match(/^\/cgi-jdayhour-([ZEHL])(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/);
    if (match) {
      const [, prefix, serial, year, month, day, hour, hours] = match;
      return json({
        [`U${serial}`]: this.history(KIND_OF[prefix], serial, year, month, day, hour, hours),
      });
    }
    match = path.match(/^\/cgi-zappi-mode-Z(\d+)-(\d+)-(\d+)-(\d+)-(\d{4})$/);
    if (match) {
      const [, serial, mode, boost, kwh] = match.map(Number);
      const zappi = this.device('zappi', serial);
      if (mode > 0) {
        zappi.zmo = mode;
      } else if (boost === 10) {
        zappi.bsm = 1;
        zappi.tbk = kwh;
      } else if (boost === 11) {
        zappi.bss = 1;
        zappi.sbk = kwh;
      } else if (boost === 2) {
        zappi.bsm = 0;
        zappi.bss = 0;
      }
      return json({ status: 0, statustext: '', asn: ASN });
    }
    match = path.match(/^\/cgi-eddi-mode-E(\d+)-([01])$/);
    if (match) {
      this.device('eddi', match[1]).sta = match[2] === '1' ? 1 : 6;
      return json({ status: 0, statustext: '' });
    }
    match = path.match(/^\/cgi-eddi-boost-E(\d+)-(1|10)-(\d+)-(\d+)$/);
    if (match) {
      const eddi = this.device('eddi', match[1]);
      if (match[2] === '10') {
        Object.assign(eddi, { bsm: 1, sta: 4, rbt: Number(match[4]) * 60 });
      } else {
        Object.assign(eddi, { bsm: 0, sta: 1, rbt: 0 });
      }
      return json({ status: 0, statustext: '' });
    }
    return { status: 404, headers: {}, body: '' };
  }

  /** Rows of the elapsed hours of a range, in the format of pymyenergi's jdayhour.json. */
  history(kind, serial, year, month, day, hour, hours) {
    const start = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour));
    const rows = [];
    for (let i = 0; i < Number(hours); i += 1) {
      const at = start + i * 3_600_000;
      if (at >= this.now()) {
        break;
      }
      const date = new Date(at);
      const row = {
        yr: date.getUTCFullYear(),
        mon: date.getUTCMonth() + 1,
        dom: date.getUTCDate(),
        dow: date.toUTCString().slice(0, 3),
        ...(this.hourly[kind]?.(at, serial) ?? {}),
      };
      if (date.getUTCHours() !== 0) {
        row.hr = date.getUTCHours();
      }
      rows.push(row);
    }
    return rows;
  }
}

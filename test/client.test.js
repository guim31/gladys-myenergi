// -----------------------------------------------------------------------------
// The myenergi client: digest authentication, the director and the server of
// the account, the error kinds, and the commands (the paths of pymyenergi).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorization, parseChallenge } from '../src/myenergi/digest.js';
import { ERROR_KINDS, MyenergiClient } from '../src/myenergi/client.js';
import { API_KEY, ASN, FakeCloud, SERIAL } from './helpers/fakeCloud.js';

test('digest: the example of RFC 2617 gives its documented response', () => {
  const challenge = parseChallenge(
    'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
  );
  const header = authorization({
    challenge,
    username: 'Mufasa',
    password: 'Circle Of Life',
    method: 'GET',
    uri: '/dir/index.html',
    nc: 1,
    cnonce: '0a4f113b',
  });
  assert.match(header, /response="6629fae49393a05397450978507c4ef1"/);
  assert.match(header, /qop=auth, nc=00000001, cnonce="0a4f113b"/);
  assert.match(header, /opaque="5ccc069c403ebaf9f0171e9517f40e41"/);
});

test('digest: a Basic challenge or a header without nonce is not answered', () => {
  assert.equal(parseChallenge('Basic realm="x"'), null);
  assert.equal(parseChallenge('Digest realm="x"'), null);
  assert.equal(parseChallenge(undefined), null);
});

const client = (cloud, options = {}) =>
  new MyenergiClient({ serial: SERIAL, apiKey: API_KEY, request: cloud.request, ...options });

test('the director names the server of the account, which is then used', async () => {
  const cloud = new FakeCloud();
  const c = client(cloud);
  const status = await c.getStatus();
  assert.ok(Array.isArray(status));
  assert.equal(c.host, ASN);
  assert.deepEqual(
    cloud.requests.filter((r) => r.authorized).map((r) => `${r.host}${r.path}`),
    ['director.myenergi.net/cgi-jstatus-E', `${ASN}/cgi-jstatus-*`],
  );
  // The next request reuses the challenge: no 401 round trip.
  cloud.requests.length = 0;
  await c.getStatus();
  assert.deepEqual(
    cloud.requests.map((r) => r.authorized),
    [true],
  );
});

test('the API key never travels in clear', async () => {
  const seen = [];
  const cloud = new FakeCloud();
  const c = new MyenergiClient({
    serial: SERIAL,
    apiKey: API_KEY,
    request: (url, options) => {
      seen.push(url, JSON.stringify(options.headers));
      return cloud.request(url, options);
    },
  });
  await c.getStatus();
  assert.ok(seen.length > 0);
  assert.ok(!seen.join('\n').includes(API_KEY));
});

test('a wrong API key is an authentication error', async () => {
  const cloud = new FakeCloud();
  const c = new MyenergiClient({ serial: SERIAL, apiKey: 'wrong', request: cloud.request });
  await assert.rejects(c.getStatus(), { kind: ERROR_KINDS.AUTH });
  // One answered challenge, then the same nonce refused again: no loop.
  assert.equal(cloud.requests.length, 2);
});

test('a director that names no server, or one outside myenergi, is refused', async () => {
  const noAsn = async () => ({ status: 200, headers: {}, body: '[]' });
  await assert.rejects(client({ request: noAsn }).getStatus(), { kind: ERROR_KINDS.AUTH });
  const elsewhere = async () => ({
    status: 200,
    headers: { 'X_MYENERGI-asn': 'evil.example.com' },
    body: '[]',
  });
  await assert.rejects(client({ request: elsewhere }).getStatus(), { kind: ERROR_KINDS.ANSWER });
});

test('the server named by a later answer is followed', async () => {
  const cloud = new FakeCloud();
  const c = client(cloud);
  await c.getStatus();
  const moved = async (url, options) => {
    const answer = await cloud.request(url, options);
    return { ...answer, headers: { ...answer.headers, 'x_myenergi-asn': 's9.myenergi.net' } };
  };
  c.request = moved;
  await c.getStatus();
  assert.equal(c.host, 's9.myenergi.net');
});

test('a network error asks the director again at the next request', async () => {
  const cloud = new FakeCloud();
  const c = client(cloud);
  await c.getStatus();
  cloud.online = false;
  await assert.rejects(c.getStatus(), { kind: ERROR_KINDS.UNREACHABLE });
  assert.equal(c.host, null);
  cloud.online = true;
  cloud.requests.length = 0;
  await c.getStatus();
  assert.equal(cloud.requests[0].host, 'director.myenergi.net');
});

test('HTTP errors have their own kinds', async () => {
  const cloud = new FakeCloud();
  const c = client(cloud);
  await c.getStatus();
  cloud.failWith = 429;
  await assert.rejects(c.getStatus(), { kind: ERROR_KINDS.RATE });
  cloud.failWith = 500;
  await assert.rejects(c.getStatus(), { kind: ERROR_KINDS.SERVER });
  cloud.failWith = null;
  c.request = async () => ({ status: 200, headers: {}, body: '<html>' });
  c.host = ASN;
  await assert.rejects(c.getStatus(), { kind: ERROR_KINDS.ANSWER });
});

test('missing credentials fail before any request', async () => {
  const cloud = new FakeCloud();
  const c = new MyenergiClient({ serial: '', apiKey: '', request: cloud.request });
  await assert.rejects(c.getStatus(), { kind: ERROR_KINDS.AUTH });
  assert.equal(cloud.requests.length, 0);
});

test('the commands use the paths of pymyenergi', async () => {
  const paths = [];
  const cloud = new FakeCloud();
  const c = new MyenergiClient({
    serial: SERIAL,
    apiKey: API_KEY,
    request: (url, options) => {
      paths.push(new URL(url).pathname);
      return cloud.request(url, options);
    },
  });
  await c.setZappiMode('11000001', 3);
  await c.startZappiBoost('11000001', 15);
  await c.startZappiSmartBoost('11000001', 20, '0730');
  await c.stopZappiBoost('11000001');
  await c.setEddiEnabled('21000001', false);
  await c.startEddiBoost('21000001', 2, 45);
  await c.stopEddiBoost('21000001', 1);
  await c.getHourlyHistory('Z', '11000001', new Date(Date.UTC(2026, 9, 14, 22)), 24);
  const sent = [...new Set(paths)].filter((p) => !p.startsWith('/cgi-jstatus-E'));
  assert.deepEqual(sent, [
    '/cgi-zappi-mode-Z11000001-3-0-0-0000',
    '/cgi-zappi-mode-Z11000001-0-10-15-0000',
    '/cgi-zappi-mode-Z11000001-0-11-20-0730',
    '/cgi-zappi-mode-Z11000001-0-2-0-0000',
    '/cgi-eddi-mode-E21000001-0',
    '/cgi-eddi-boost-E21000001-10-2-45',
    '/cgi-eddi-boost-E21000001-1-1-0',
    '/cgi-jdayhour-Z11000001-2026-10-14-22-24',
  ]);
});

test('a command answered with a non-zero status is refused', async () => {
  const cloud = new FakeCloud();
  const c = client(cloud);
  await c.getStatus();
  c.request = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ status: -14, statustext: 'Invalid' }),
  });
  await assert.rejects(c.setZappiMode('11000001', 2), {
    kind: ERROR_KINDS.REFUSED,
    message: /status -14: Invalid/,
  });
});

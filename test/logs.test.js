// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never the API key, at any level.
// (From guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY } from './helpers/fakeCloud.js';
import { CONFIG, createAll, createWorld, ids } from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to myenergi')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (let i = 0; i < 15; i += 1) {
    w.cloud.device('eddi', '21000001').div = 100 * i;
    w.cloud.device('zappi', '11000001').che = i;
    w.clock.advance(60_000); // the history is read again every 10 minutes
    await w.hub.refresh();
  }
  assert.deepEqual(logs.texts(), []);
});

test('an outage is logged once, and once when myenergi is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();

  w.cloud.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  assert.match(logs.lines[0].text, /unreachable/);

  logs.clear();
  w.cloud.online = true;
  for (let i = 0; i < 3; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again \(after 6 min\)/);
});

test('a refused key is logged once, its repeats only at debug', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { config: { ...CONFIG, api_key: 'wrong-key-1234' } });
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(warnings[0].text, /refused/);
});

test('a history that keeps failing is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  const original = w.cloud.answer.bind(w.cloud);
  w.cloud.answer = (path) =>
    path.startsWith('/cgi-jdayhour-Z11000001')
      ? { status: 500, headers: {}, body: '' }
      : original(path);
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(10 * 60_000);
    await w.hub.refresh();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /zappi 11000001: energy history not read/);
});

test('a user command is one info line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  await w.fake.sceneAction('zappi_set_mode', {
    device: ids(w.gladys, 'zappi', '11000001').device,
    mode: 'eco',
  });
  assert.deepEqual(logs.texts().length, 1);
  assert.match(logs.texts()[0], /Test Zappi 1: mode eco/);
});

test('the API key never appears in the logs, even at debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createAll(w);
  await w.fake.action('test_connection', {});
  w.cloud.online = false;
  w.clock.advance(60_000);
  await w.hub.refresh();
  w.cloud.online = true;
  await w.fake.configUpdated({ ...CONFIG, api_key: 'another-secret-key' });
  const all = logs.texts().join('\n');
  assert.ok(logs.lines.length > 5, 'debug lines were written');
  for (const secret of [API_KEY, 'another-secret-key']) {
    assert.ok(!all.includes(secret), `the key ${secret} leaked`);
  }
});

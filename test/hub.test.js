// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and the fake cloud: discovery, the
// refresh by the container's own timer (no onPoll), the onPoll fallback, the
// states of a device just added, the connection status, the scene event and
// the device commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG, create, createAll, createWorld, ids } from './helpers/world.js';

const ZAPPI = '11000001';
const EDDI = '21000001';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

/** Let the promise chains of a timer callback run. */
async function settle() {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test('the search publishes the site and every device of the account', async (t) => {
  const w = await world(t);
  const names = w.fake.discoveredDevices.map((d) => d.name);
  assert.deepEqual(names, [
    'Test Site',
    'Test Eddi 1',
    'Test Zappi 1',
    'Test Zappi 2',
    'Test Harvi 1',
    'Test Harvi 2',
    'Test Libbi 1',
  ]);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // Nothing added yet: no state sent (Gladys would drop them).
  assert.equal(w.fake.states.length, 0);
});

test('a device added in Gladys gets its states at once, energy included', async (t) => {
  const w = await world(t);
  const z = ids(w.gladys, 'zappi', ZAPPI);
  await create(w, z.device);
  assert.equal(w.fake.lastState(z.feature('mode')), 'fast');
  assert.equal(w.fake.lastState(z.feature('connector_status')), 1);
  assert.equal(w.fake.lastState(z.feature('charging_state')), 2); // pst B2: waiting for the car
  assert.equal(w.fake.lastState(z.feature('session_energy')), 0);
  // 08:30 UTC = 10:30 in Paris: 11 hours since midnight, 1.5 kWh each.
  assert.equal(w.fake.lastState(z.feature('energy_today')), 16.5);
  assert.equal(w.fake.lastState(z.feature('energy_total')), 16.5);
  assert.deepEqual(w.fake.transports.at(-1), { device_external_id: z.device, transport: 'cloud' });
});

test('the states refresh on the container timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  await createAll(w);
  const z = ids(w.gladys, 'zappi', ZAPPI);
  const site = ids(w.gladys, 'site', CONFIG.hub_serial);
  const onPoll = t.mock.method(w.hub, 'pollFromCore');

  w.cloud.device('zappi', ZAPPI).zmo = 3;
  w.cloud.device('zappi', ZAPPI).ectp1 = 0;
  w.cloud.device('harvi', '31000002').ectp1 = 1500;
  w.clock.advance(60_000);
  t.mock.timers.tick(60_000);
  await settle();

  assert.equal(onPoll.mock.callCount(), 0);
  assert.equal(w.fake.lastState(z.feature('mode')), 'eco_plus');
  // The clamps typed Grid: harvi 2 (1500 + 3068 + 1420), eddi (1), libbi (-72).
  assert.equal(w.fake.lastState(site.feature('grid_power')), 5917);

  // A second turn: the timer keeps going.
  w.cloud.device('zappi', ZAPPI).zmo = 2;
  w.clock.advance(60_000);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(w.fake.lastState(z.feature('mode')), 'eco');
});

test('the timer reads nothing while no device is added', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  const reads = () => w.cloud.requests.filter((r) => r.path === '/cgi-jstatus-*').length;
  const before = reads();
  for (let i = 0; i < 3; i += 1) {
    w.clock.advance(60_000);
    t.mock.timers.tick(60_000);
    await settle();
  }
  assert.equal(reads(), before);
});

test('only the changes are published', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.length;
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.states.length, before);
  w.cloud.device('eddi', EDDI).div = 1234;
  w.clock.advance(60_000);
  await w.hub.refresh();
  const sent = w.fake.states.slice(before).flat();
  assert.deepEqual(
    sent.map((s) => s.device_feature_external_id),
    [ids(w.gladys, 'eddi', EDDI).feature('heating_power')],
  );
});

test("the core's onPoll is a fallback: it reads only when the timer did not", async (t) => {
  const w = await world(t);
  await createAll(w);
  const device = w.fake.devices.find((d) => d.external_id.includes(ZAPPI));
  const reads = () => w.cloud.requests.filter((r) => r.path === '/cgi-jstatus-*').length;
  const before = reads();
  await w.fake.poll(device);
  assert.equal(reads(), before, 'read less than an interval ago: skipped');
  w.clock.advance(60_000);
  assert.deepEqual(await w.fake.poll(device), { success: true });
  assert.equal(reads(), before + 1);
});

test('the history is read every 10 minutes, and at once after midnight', async (t) => {
  const w = await world(t);
  await create(w, ids(w.gladys, 'eddi', EDDI).device);
  const historyReads = () =>
    w.cloud.requests.filter((r) => r.path.startsWith('/cgi-jdayhour')).length;
  const first = historyReads();
  w.clock.advance(5 * 60_000);
  await w.hub.refresh();
  assert.equal(historyReads(), first);
  w.clock.advance(5 * 60_000);
  await w.hub.refresh();
  assert.equal(historyReads(), first + 1);

  // 22:01 UTC: midnight in Paris. The 15th is read whole, then the 16th.
  w.clock.time = Date.UTC(2026, 9, 15, 22, 1);
  await w.hub.refresh();
  const e = ids(w.gladys, 'eddi', EDDI);
  // 24 hours of 0.25 kWh on the 15th, and the hour begun on the 16th.
  assert.equal(w.fake.lastState(e.feature('energy_total')), 6.25);
  assert.equal(w.fake.lastState(e.feature('diverted_today')), 0.25);
  await w.hub.store.flush();
  const saved = JSON.parse(await readFile(join(w.dataDir, 'myenergi-state.json'), 'utf8'));
  assert.equal(saved.version, 1);
  assert.ok(saved.energy[`eddi:${EDDI}`]);
});

test('the total energy survives a restart', async (t) => {
  const first = await world(t);
  await create(first, ids(first.gladys, 'zappi', ZAPPI).device);
  await first.app.stop();
  const second = await world(t, {
    dataDir: first.dataDir,
    devices: first.fake.devices,
    clock: first.clock,
  });
  second.clock.time = Date.UTC(2026, 9, 16, 8, 30);
  await second.hub.refresh();
  // The whole 15th (24 × 1.5 kWh) + 11 hours of the 16th.
  assert.equal(
    second.fake.lastState(ids(second.gladys, 'zappi', ZAPPI).feature('energy_total')),
    36 + 16.5,
  );
});

test('a completed charge fires the scene event, with the energy of the session', async (t) => {
  const w = await world(t);
  const zappi = w.cloud.device('zappi', ZAPPI);
  Object.assign(zappi, { pst: 'C2', sta: 3, div: 7000, che: 12.3 });
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 0);
  Object.assign(zappi, { pst: 'B2', sta: 5, div: 0, che: 18.4 });
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: 'charge_completed',
      data: {
        device: ids(w.gladys, 'zappi', ZAPPI).device,
        energy_kwh: 18.4,
        name: 'Test Zappi 1',
      },
    },
  ]);
  // Still complete at the next reading: no second event.
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 1);
});

test('a charge already complete at startup fires nothing', async (t) => {
  const w = await world(t, { connect: false });
  Object.assign(w.cloud.device('zappi', ZAPPI), { pst: 'B2', sta: 5 });
  await w.gladys.connect();
  await w.app.ready;
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.sceneEvents.length, 0);
});

test('the zappi mode and the eddi diversion are device commands', async (t) => {
  const w = await world(t);
  await createAll(w);
  const z = ids(w.gladys, 'zappi', ZAPPI);
  const e = ids(w.gladys, 'eddi', EDDI);
  const zappi = w.fake.devices.find((d) => d.external_id === z.device);
  const eddi = w.fake.devices.find((d) => d.external_id === e.device);
  const mode = zappi.features.find((f) => f.external_id === z.feature('mode'));
  const enabled = eddi.features.find((f) => f.external_id === e.feature('enabled'));

  assert.deepEqual(await w.fake.setValue(zappi, mode, 'eco_plus'), { success: true });
  assert.equal(w.cloud.device('zappi', ZAPPI).zmo, 3);
  assert.equal(w.fake.lastState(z.feature('mode')), 'eco_plus');

  assert.deepEqual(await w.fake.setValue(eddi, enabled, 0), { success: true });
  assert.equal(w.cloud.device('eddi', EDDI).sta, 6);
  assert.equal(w.fake.lastState(e.feature('enabled')), 0);
  assert.equal(w.fake.lastState(e.feature('status')), 'stopped');

  const refused = await w.fake.setValue(zappi, mode, 'turbo');
  assert.equal(refused.success, false);
  assert.match(refused.error, /Unknown charge mode/);
  const readOnly = zappi.features.find((f) => f.external_id === z.feature('energy_total'));
  assert.equal((await w.fake.setValue(zappi, readOnly, 1)).success, false);
});

test('a reconnection publishes everything again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.flat().length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await w.hub.refreshing;
  assert.ok(w.fake.states.flat().length > before + 20, 'every value sent again');
});

test('the connection status says what is wrong, in the four languages', async (t) => {
  const missing = await world(t, { config: { language: 'en' } });
  assert.equal(missing.fake.connectionStatus.connected, false);
  assert.match(missing.fake.connectionStatus.message.fr, /numéro de série/);
  assert.deepEqual(missing.fake.discoveredDevices, []);

  const invalid = await world(t, { config: { ...CONFIG, hub_serial: 'ABC' } });
  assert.match(invalid.fake.connectionStatus.message.en, /digits only/);

  const refused = await world(t, { config: { ...CONFIG, api_key: 'wrong-key' } });
  assert.equal(refused.fake.connectionStatus.connected, false);
  assert.match(refused.fake.connectionStatus.message.de, /API-Schlüssel/);
  assert.deepEqual(Object.keys(refused.fake.connectionStatus.message), ['en', 'fr', 'de', 'es']);
});

test('an outage marks the devices unreachable, and the return reconnects them', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.online = false;
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.equal(w.fake.connectionStatus.connected, false);
  const latest = () => new Map(w.fake.transports.map((e) => [e.device_external_id, e.transport]));
  assert.ok([...latest().values()].every((transport) => transport === 'unreachable'));
  w.cloud.online = true;
  w.clock.advance(60_000);
  await w.hub.refresh();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.ok([...latest().values()].every((transport) => transport === 'cloud'));
});

test('new credentials start over with the new account', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated({ ...CONFIG, api_key: 'another-key' });
  assert.equal(w.fake.connectionStatus.connected, false);
  w.cloud.apiKey = 'another-key';
  await w.fake.configUpdated({ ...CONFIG, api_key: 'another-key', language: 'fr' });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(
    w.fake.discoveredDevices[2].features.find((f) => f.external_id.endsWith(':mode')).name,
    'Mode de charge',
  );
});

test('"Test the connection" lists the devices found', async (t) => {
  const w = await world(t);
  const answer = await w.fake.action('test_connection', {});
  assert.equal(answer.success, true);
  assert.match(answer.data.message.en, /6 device\(s\), Test Eddi 1, Test Zappi 1/);
  assert.match(answer.data.message.en, /s18\.myenergi\.net/);
  const unconfigured = await world(t, { config: {} });
  const refused = await unconfigured.fake.action('test_connection', {});
  assert.equal(refused.success, false);
});

test('the heartbeat sends an unchanged value again after 6 hours', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 15, 8, 30) });
  const w = await world(t);
  await create(w, ids(w.gladys, 'harvi', '31000001').device);
  const before = w.fake.states.flat().length;
  t.mock.timers.tick(6 * 60 * 60_000);
  w.clock.advance(6 * 60 * 60_000);
  await w.hub.refresh();
  assert.equal(w.fake.states.flat().length, before + 3, 'the three clamps of the harvi');
});

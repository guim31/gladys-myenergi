// -----------------------------------------------------------------------------
// The scene actions, as the core runs them: resolved fields, the message of a
// failure in the configured language, nothing sent to the cloud when a field
// is wrong.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, ids } from './helpers/world.js';

const ZAPPI = '11000001';
const EDDI = '21000001';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const commands = (w) =>
  w.cloud.requests.map((r) => r.path).filter((path) => /cgi-(zappi|eddi)-(mode|boost)/.test(path));

test('set the zappi mode', async (t) => {
  const w = await world(t);
  const device = ids(w.gladys, 'zappi', ZAPPI).device;
  const ack = await w.fake.sceneAction('zappi_set_mode', { device, mode: 'eco' });
  assert.deepEqual(ack, { success: true });
  assert.equal(w.cloud.device('zappi', ZAPPI).zmo, 2);
});

test('boost the zappi now, or for a time; refused outside Eco and Eco+', async (t) => {
  const w = await world(t);
  const device = ids(w.gladys, 'zappi', ZAPPI).device;
  // The fixture zappi is in Fast mode.
  let ack = await w.fake.sceneAction('zappi_boost', { device, energy_kwh: 10 });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Eco or Eco\+/);
  assert.deepEqual(commands(w), []);

  await w.fake.sceneAction('zappi_set_mode', { device, mode: 'eco_plus' });
  ack = await w.fake.sceneAction('zappi_boost', { device, energy_kwh: '10', ready_by: null });
  assert.deepEqual(ack, { success: true });
  ack = await w.fake.sceneAction('zappi_boost', { device, energy_kwh: 25, ready_by: '06:45' });
  assert.deepEqual(ack, { success: true });
  ack = await w.fake.sceneAction('zappi_stop_boost', { device });
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(commands(w), [
    '/cgi-zappi-mode-Z11000001-3-0-0-0000',
    '/cgi-zappi-mode-Z11000001-0-10-10-0000',
    '/cgi-zappi-mode-Z11000001-0-11-25-0645',
    '/cgi-zappi-mode-Z11000001-0-2-0-0000',
  ]);
});

test('wrong fields are refused before anything is sent', async (t) => {
  const w = await world(t, {
    config: { hub_serial: '12345678', api_key: 'test-api-key-not-real', language: 'fr' },
  });
  const zappi = ids(w.gladys, 'zappi', ZAPPI).device;
  const eddi = ids(w.gladys, 'eddi', EDDI).device;
  const cases = [
    ['zappi_boost', { device: zappi, energy_kwh: 0 }, /entier de kWh/],
    ['zappi_boost', { device: zappi, energy_kwh: 2.5 }, /entier de kWh/],
    ['zappi_boost', { device: zappi, energy_kwh: 5, ready_by: '25:00' }, /HH:MM/],
    ['zappi_set_mode', { device: zappi, mode: 'turbo' }, /Mode de charge inconnu/],
    ['zappi_set_mode', { device: eddi, mode: 'eco' }, /Choisissez une zappi/],
    ['eddi_boost', { device: eddi, minutes: 500, heater: '1' }, /minutes de 1 à 240/],
    ['eddi_boost', { device: eddi, minutes: 30, heater: '3' }, /Résistance : 1 ou 2/],
    ['eddi_boost', { device: zappi, minutes: 30, heater: '1' }, /Choisissez un eddi/],
    ['eddi_stop_boost', { device: 'ext:test-integration:eddi:99999999' }, /pas dans le compte/],
  ];
  for (const [key, fields, message] of cases) {
    const ack = await w.fake.sceneAction(key, fields);
    assert.equal(ack.success, false, `${key} ${JSON.stringify(fields)}`);
    assert.match(ack.error, message, `${key} ${JSON.stringify(fields)}`);
  }
  assert.deepEqual(commands(w), []);
});

test('boost the eddi and stop it', async (t) => {
  const w = await world(t);
  const device = ids(w.gladys, 'eddi', EDDI).device;
  let ack = await w.fake.sceneAction('eddi_boost', { device, minutes: 60, heater: '1' });
  assert.deepEqual(ack, { success: true });
  assert.equal(w.cloud.device('eddi', EDDI).bsm, 1);
  ack = await w.fake.sceneAction('eddi_stop_boost', { device });
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(commands(w), [
    '/cgi-eddi-boost-E21000001-10-1-60',
    '/cgi-eddi-boost-E21000001-1-1-0',
    '/cgi-eddi-boost-E21000001-1-2-0',
  ]);
});

test('the cloud refusing a command fails the action with a sentence', async (t) => {
  const w = await world(t);
  const device = ids(w.gladys, 'zappi', ZAPPI).device;
  w.cloud.failWith = 500;
  const ack = await w.fake.sceneAction('zappi_set_mode', { device, mode: 'stop' });
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'The myenergi cloud answered with an error.');
});

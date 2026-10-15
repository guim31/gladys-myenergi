// -----------------------------------------------------------------------------
// The dashboard widget: rendered exactly as sent (validateWidgetContent of the
// SDK: vocabulary and budget), live tiles bound to features that exist, the
// boost buttons and their forms, and the actions they run.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createAll, createWorld, ids } from './helpers/world.js';

const ZAPPI = '11000001';
const EDDI = '21000001';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, request = {}) {
  const ack = await w.fake.widgetGet('overview', { settings: {}, language: 'en', ...request });
  assert.equal(ack.success, true, ack.error);
  const { content: body } = ack.data;
  assert.deepEqual(validateWidgetContent(body), [], JSON.stringify(body, null, 1));
  return body;
}

const buttons = (body) => body.components.filter((c) => c.type === 'button');

/** Every feature external id of the discovered devices. */
const featureIds = (w) =>
  new Set(w.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)));

test('not configured: one sentence', async (t) => {
  const w = await world(t, { config: {} });
  const body = await content(w, { language: 'fr' });
  assert.equal(body.components.length, 1);
  assert.match(body.components[0].text, /numéro de série/);
});

test('the overview of a configured account, devices added: live tiles', async (t) => {
  const w = await world(t);
  await createAll(w);
  const body = await content(w);
  const tiles = body.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((c) => c.label),
    ['Solar', 'Grid', 'Test Zappi 1', 'Test Eddi 1'],
  );
  const known = featureIds(w);
  for (const tile of tiles) {
    assert.ok(
      known.has(tile.device_feature),
      `${tile.label}: ${tile.device_feature} is not a feature`,
    );
  }
  const status = body.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Test Zappi 1', 'Waiting for the car · Fast'],
      ['Session', '0 kWh'],
      ['Test Eddi 1', 'Waiting for surplus'],
      ['Diverted today', '2.8 kWh'],
    ],
  );
  // Fast mode: no zappi boost button (it already charges at full power).
  assert.deepEqual(
    buttons(body).map((b) => b.action.key),
    ['eddi_boost'],
  );
});

test('devices not added yet: the tiles show the last reading', async (t) => {
  const w = await world(t);
  const body = await content(w);
  const solar = body.components.find((c) => c.label === 'Solar');
  assert.equal(solar.device_feature, undefined);
  assert.equal(solar.unit, 'W');
  assert.equal(typeof solar.value, 'number');
});

test('in Eco+ with boosts running: the three buttons, within the budget', async (t) => {
  const w = await world(t);
  Object.assign(w.cloud.device('zappi', ZAPPI), {
    zmo: 3,
    bsm: 1,
    pst: 'C2',
    sta: 4,
    div: 7000,
    tbk: 15,
  });
  Object.assign(w.cloud.device('eddi', EDDI), { sta: 4, bsm: 1, rbt: 1200 });
  w.clock.advance(60_000);
  await w.hub.refresh();
  const body = await content(w, { language: 'de' });
  assert.ok(body.components.length <= 8);
  assert.deepEqual(
    buttons(body).map((b) => b.action.key),
    ['zappi_boost', 'eddi_boost', 'stop_boost'],
  );
  const boost = buttons(body)[0];
  assert.equal(boost.label, 'Auto-Boost');
  // The last boost of the zappi pre-fills the form.
  assert.equal(boost.action.fields.find((f) => f.key === 'energy_kwh').default, 15);
  const status = body.components.find((c) => c.type === 'status');
  assert.equal(status.items[0].value, 'Boost · Eco+');
  assert.equal(status.items[2].value, 'Boost läuft · 20 min');
  assert.equal(buttons(body)[2].action.confirm, true);
});

test('the widget buttons start and stop the boosts', async (t) => {
  const w = await world(t);
  w.cloud.device('zappi', ZAPPI).zmo = 2;
  w.clock.advance(60_000);
  await w.hub.refresh();
  const z = ids(w.gladys, 'zappi', ZAPPI).device;
  const e = ids(w.gladys, 'eddi', EDDI).device;

  let ack = await w.fake.widgetAction(
    'overview',
    'zappi_boost',
    { device: z },
    {
      settings: {},
      values: { energy_kwh: 12, ready_by: '' },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.cloud.device('zappi', ZAPPI).bsm, 1);
  assert.equal(w.cloud.device('zappi', ZAPPI).tbk, 12);

  ack = await w.fake.widgetAction(
    'overview',
    'zappi_boost',
    { device: z },
    {
      settings: {},
      values: { energy_kwh: 20, ready_by: '7:30' },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.cloud.device('zappi', ZAPPI).bss, 1);
  assert.match(
    w.cloud.requests.map((r) => r.path).join('\n'),
    /cgi-zappi-mode-Z11000001-0-11-20-0730/,
  );

  ack = await w.fake.widgetAction(
    'overview',
    'eddi_boost',
    { device: e },
    {
      settings: {},
      values: { minutes: 45, heater: '2' },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.match(w.cloud.requests.map((r) => r.path).join('\n'), /cgi-eddi-boost-E21000001-10-2-45/);

  ack = await w.fake.widgetAction('overview', 'stop_boost', {}, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.cloud.device('zappi', ZAPPI).bsm, 0);
  assert.equal(w.cloud.device('eddi', EDDI).bsm, 0);
});

test('a form sent without its values (an older core) is refused', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetAction(
    'overview',
    'eddi_boost',
    { device: ids(w.gladys, 'eddi', EDDI).device },
    { settings: {} },
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /5\.2\.0/);
});

test('myenergi down: the last reading, said to be old, and no button', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.cloud.online = false;
  w.clock.advance(60_000);
  await w.hub.refresh();
  const body = await content(w, { language: 'es' });
  assert.equal(body.components[0].type, 'text');
  assert.match(body.components[0].text, /no responde/);
  assert.equal(buttons(body).length, 0);
});

test('the settings choose the zappi shown', async (t) => {
  const w = await world(t);
  const second = ids(w.gladys, 'zappi', '11000002').device;
  const body = await content(w, { settings: { zappi: second } });
  assert.ok(body.components.some((c) => c.label === 'Test Zappi 2'));
});

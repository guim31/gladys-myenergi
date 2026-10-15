// -----------------------------------------------------------------------------
// Reading the answers of the cloud, on the fixtures of pymyenergi.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARGING_STATE,
  CONNECTOR_STATUS,
  clamps,
  eddiView,
  libbiView,
  parseHistory,
  parseNames,
  parseStatus,
  siteView,
  zappiChargeState,
  zappiView,
} from '../src/myenergi/model.js';
import { loadFixture } from './helpers/fakeCloud.js';

test('the status lists every device of the account and the hub firmware', () => {
  const { devices, firmware } = parseStatus(loadFixture('status.json'));
  assert.deepEqual(
    devices.map(({ kind, serial }) => `${kind}:${serial}`),
    [
      'eddi:21000001',
      'zappi:11000001',
      'zappi:11000002',
      'harvi:31000001',
      'harvi:31000002',
      'libbi:41000001',
    ],
  );
  assert.equal(firmware, '3401S3077');
  assert.throws(() => parseStatus({ status: -1 }));
});

test('the names given in the app are read by kind and serial', () => {
  const names = parseNames(loadFixture('names.json'));
  assert.equal(names.site, 'Test Site');
  assert.equal(names.devices['zappi:11000001'], 'Test Zappi 1');
  assert.equal(names.devices['libbi:41000001'], 'Test Libbi 1');
  assert.deepEqual(parseNames(null), { site: null, devices: {} });
});

test('the zappi plug and status give the Gladys connector and charge states', () => {
  const cases = [
    [{ pst: 'A', sta: 1 }, CONNECTOR_STATUS.AVAILABLE, CHARGING_STATE.IDLE, 0],
    [{ pst: 'F', sta: 1 }, CONNECTOR_STATUS.FAULTED, CHARGING_STATE.IDLE, 0],
    [{ pst: 'B1', sta: 1 }, CONNECTOR_STATUS.OCCUPIED, CHARGING_STATE.EV_CONNECTED, 1],
    [{ pst: 'B2', sta: 1 }, CONNECTOR_STATUS.OCCUPIED, CHARGING_STATE.PAUSED_BY_VEHICLE, 1],
    [{ pst: 'C1', sta: 1 }, CONNECTOR_STATUS.OCCUPIED, CHARGING_STATE.PAUSED_BY_CHARGER, 1],
    [{ pst: 'C2', sta: 3 }, CONNECTOR_STATUS.OCCUPIED, CHARGING_STATE.CHARGING, 1],
    [{ pst: 'C2', sta: 4 }, CONNECTOR_STATUS.OCCUPIED, CHARGING_STATE.CHARGING, 1],
    [{ pst: 'B2', sta: 5 }, CONNECTOR_STATUS.OCCUPIED, CHARGING_STATE.IDLE, 1],
  ];
  for (const [raw, connector, charging, plugged] of cases) {
    assert.deepEqual(zappiChargeState(raw), { connector, charging, plugged }, JSON.stringify(raw));
  }
  assert.deepEqual(zappiChargeState({}), { connector: null, charging: null, plugged: null });
});

test('the zappi of the fixture: mode, session energy, power', () => {
  const view = zappiView(loadFixture('zappi.json'));
  assert.equal(view.mode, 'fast'); // zmo 1
  assert.equal(view.sessionKwh, 4.2);
  assert.equal(view.chargePowerKw, 0);
  assert.equal(view.boosting, false);
  const charging = zappiView({ ...loadFixture('zappi.json'), zmo: 3, div: 7360, sta: 3, bsm: 1 });
  assert.equal(charging.mode, 'eco_plus');
  assert.equal(charging.chargePowerKw, 7.36);
  assert.equal(charging.boosting, true);
});

test('the eddi of the fixture: status, probes absent, boost', () => {
  const view = eddiView(loadFixture('eddi.json'));
  assert.equal(view.status, 'paused');
  assert.equal(view.enabled, 1);
  assert.equal(view.heating, 0);
  assert.equal(view.temp1, null); // tp1: -1, no probe
  const boosting = eddiView({
    ...loadFixture('eddi.json'),
    sta: 4,
    bsm: 1,
    rbt: 1500,
    div: 3000,
    tp1: 55,
  });
  assert.equal(boosting.status, 'boosting');
  assert.equal(boosting.heating, 1);
  assert.equal(boosting.boostMinutes, 25);
  assert.equal(boosting.powerW, 3000);
  assert.equal(boosting.temp1, 55);
  assert.equal(eddiView({ sta: 6 }).enabled, 0);
});

test('the libbi of the fixture: discharging at 457 W, 45 %', () => {
  const view = libbiView(loadFixture('libbi.json'));
  assert.deepEqual(view, { status: 'discharging', chargeW: 0, dischargeW: 457, batteryLevel: 45 });
  assert.equal(libbiView({ sta: 168 }).status, 'fault');
});

test('only the assigned clamps are read', () => {
  assert.deepEqual(clamps('harvi', loadFixture('harvi.json')), [
    { index: 1, type: 'Generation', power: 888 },
    { index: 2, type: 'Grid', power: 999 },
    { index: 3, type: 'AC Battery', power: 777 },
  ]);
  assert.deepEqual(
    clamps('libbi', loadFixture('libbi.json')).map((c) => `${c.index}:${c.type}`),
    ['1:Internal Load', '2:Grid', '5:DCPV'],
  );
});

test('grid and solar of the site are those pymyenergi computes', () => {
  // pymyenergi test_1p_harvi_eddi_solar_battery: grid 10000 W, generation 5000 W.
  const { devices } = parseStatus(loadFixture('status-zappi-harvi-battery.json'));
  assert.deepEqual(siteView(devices), { gridW: 10000, solarW: 5000, voltageV: 234.7 });
  // No clamp typed Grid: the value the zappi computed itself.
  assert.deepEqual(siteView([{ kind: 'zappi', raw: { grd: -1200, gen: -8, vol: 2300 } }]), {
    gridW: -1200,
    solarW: 0,
    voltageV: 230,
  });
  assert.deepEqual(siteView([]), { gridW: null, solarW: null, voltageV: null });
});

test('the hourly history sums the diverted and boosted energy, in kWh', () => {
  const answer = {
    U11000001: [
      { yr: 2026, mon: 10, dom: 14, hr: 22, h1d: 3_600_000, h1b: 1_800_000 },
      { yr: 2026, mon: 10, dom: 15, h2d: 360_000 },
      { yr: 2026, mon: 10, dom: 15, hr: 1, imp: 9_000_000 },
    ],
  };
  assert.deepEqual(parseHistory(answer, '11000001'), { total: 1.6, diverted: 1.1 });
  assert.deepEqual(parseHistory({ U11000001: [] }, '11000001'), { total: 0, diverted: 0 });
  assert.throws(() => parseHistory({ U99: [] }, '11000001'));
});

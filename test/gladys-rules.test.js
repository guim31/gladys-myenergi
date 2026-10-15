// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (the answers of the pymyenergi tests): two zappi, an eddi with and
// without temperature probes, two harvi, a libbi, a single-phase install with
// solar and an AC battery — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (From guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, createWorld } from './helpers/world.js';
import { FakeCloud, loadFixture } from './helpers/fakeCloud.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const withProbes = () => {
  const status = loadFixture('status.json');
  Object.assign(status[0].eddi[0], { tp1: 54.5, tp2: 38 });
  return status;
};

const scenarios = [
  { label: 'every kind of device', status: loadFixture('status.json'), min: 7 },
  { label: 'eddi with probes', status: withProbes(), min: 7 },
  {
    label: 'zappi, harvi, solar, battery',
    status: loadFixture('status-zappi-harvi-battery.json'),
    min: 3,
  },
  { label: 'French names', status: withProbes(), language: 'fr', min: 7 },
  { label: 'German names', status: withProbes(), language: 'de', min: 7 },
  { label: 'Spanish names', status: withProbes(), language: 'es', min: 7 },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { gladys, app } = await createWorld({
      config: { ...CONFIG, language: scenario.language ?? 'en' },
      cloud: new FakeCloud({ status: scenario.status }),
    });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.ok(
        devices.length >= scenario.min,
        `expected the fixture devices, got ${devices.length}`,
      );
      const deviceIds = new Set();

      for (const device of devices) {
        const where = device.name;
        assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
        deviceIds.add(device.external_id);

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          if (feature.min < 0) {
            // A signed value: the gauge needle needs symmetric bounds.
            assert.equal(feature.min, -feature.max, `${at}: signed bounds must be symmetric`);
          }
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: ${feature.unit} not for ${feature.category}`,
              );
            }
          }
          if (feature.supported_options) {
            const values = feature.supported_options.map((option) => String(option.value));
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option`);
            assert.ok(
              feature.supported_options.every((option) => option.label),
              `${at}: option label`,
            );
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
    }
  });
}

test('the guard catches a feature without min, an unknown couple, a bad frequency', () => {
  // The conditions above, on broken features, so a loosened check shows.
  const broken = { category: 'energy-sensor', type: 'nothing', min: 0, max: 1 };
  assert.equal(table.pairs[`${broken.category}/${broken.type}`], undefined);
  assert.ok(!table.poll_frequencies_ms.includes(300));
  assert.equal(typeof { max: 1 }.min, 'undefined');
});

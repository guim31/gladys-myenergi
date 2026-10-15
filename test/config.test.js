import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, parseSerial } from '../src/config.js';

test('the serial number keeps its digits only', () => {
  assert.equal(parseSerial('12345678'), '12345678');
  assert.equal(parseSerial(' 1234 5678 '), '12345678');
  assert.equal(parseSerial('1234-5678'), '12345678');
  assert.equal(parseSerial(12345678), '12345678');
  assert.equal(parseSerial('H12345678'), '');
  assert.equal(parseSerial('12'), '');
  assert.equal(parseSerial(undefined), '');
});

test('the configuration is normalized', () => {
  assert.deepEqual(normalizeConfig(), {
    hubSerial: '',
    invalidSerial: false,
    apiKey: '',
    refreshMs: 60_000,
    language: 'fr',
  });
  const config = normalizeConfig({
    hub_serial: '12345678',
    api_key: '  key  ',
    refresh_interval: '300',
    language: 'de',
  });
  assert.equal(config.apiKey, 'key');
  assert.equal(config.refreshMs, 300_000);
  assert.equal(config.language, 'de');
  assert.ok(isConfigured(config));
});

test('values out of the lists fall back to the defaults', () => {
  const config = normalizeConfig({ hub_serial: 'abc', refresh_interval: '5', language: 'it' });
  assert.equal(config.invalidSerial, true);
  assert.equal(config.refreshMs, Number(DEFAULT_CONFIG.refresh_interval) * 1000);
  assert.equal(config.language, DEFAULT_CONFIG.language);
  assert.equal(isConfigured(config), false);
  assert.equal(normalizeConfig(null).hubSerial, '');
});

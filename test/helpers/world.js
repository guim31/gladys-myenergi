// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, the fake myenergi cloud, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the cloud with `world.hub.refresh()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { API_KEY, FakeCloud, SERIAL } from './fakeCloud.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const TIME_ZONE = 'Europe/Paris';

/** A manual clock, shared by the hub and the fake cloud. */
export function createClock(start = Date.UTC(2026, 9, 15, 8, 30, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = {
  hub_serial: SERIAL,
  api_key: API_KEY,
  refresh_interval: '60',
  language: 'en',
};

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {FakeCloud} [options.cloud]
 */
export async function createWorld({
  clock = createClock(),
  cloud,
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-myenergi-')),
  timings = {},
  timers = false,
} = {}) {
  const fakeCloud = cloud ?? new FakeCloud({ now: clock.now });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: fakeCloud.request,
    timers,
    timings,
    now: clock.now,
    timeZone: TIME_ZONE,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, cloud: fakeCloud, app, hub: app.hub, clock, dataDir };
}

/** External ids of a device: `{ device, feature(key) }`. */
export const ids = (gladys, kind, serial) => gladys.externalIds(kind, serial);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

/** Add one discovered device in Gladys. */
export async function create(world, externalId) {
  const device = world.fake.discoveredDevices.find((d) => d.external_id === externalId);
  if (!device) {
    throw new Error(`${externalId} was not discovered`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

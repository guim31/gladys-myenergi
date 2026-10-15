// -----------------------------------------------------------------------------
// The Gladys devices of a myenergi account, and the values of their features.
//
//   site   grid and solar power of the installation, grid voltage
//   zappi  car charger: connector, charge state, mode (command), power,
//          energy of the session, of the day and in total, clamps
//   eddi   hot water diverter: status, heating, power, energy diverted today
//          and in total, surplus diversion on/off (command), boost, probes, clamps
//   harvi  wireless clamp sensor: its clamps
//   libbi  battery: level, charge and discharge power, status, clamps
//
// External ids are `<kind>:<serial>` (the serial the cloud gives the device)
// and `site:<hub serial>`: they never change. Every feature key below is
// permanent too.
//
// should_poll + poll_frequency (1 minute) let a fixed core poll the devices,
// but the hub refreshes them on its own timer (Gladys#3198): onPoll is only
// the fallback, see src/hub.js.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import {
  KINDS,
  EDDI_STATUSES,
  LIBBI_STATUSES,
  ZAPPI_MODES,
  clamps,
  eddiView,
  libbiView,
  siteView,
  zappiView,
} from './myenergi/model.js';
import {
  DEVICE_NAMES,
  EDDI_STATUS_LABELS,
  LIBBI_STATUS_LABELS,
  NAMES,
  ZAPPI_MODE_LABELS,
  clampName,
} from './texts.js';

export const SITE = 'site';

// Bounds of the power features, in W. A signed value needs symmetric bounds
// (the gauge places its needle on (value - min) / (max - min)): ±24 kW covers
// a three-phase 32 A connection.
const POWER_MAX = 24_000;

/** Ids of one device: `{ device, feature(key) }`. */
export const deviceIds = (gladys, kind, serial) => gladys.externalIds(kind, serial);

/** `{ kind, serial }` of one of our external ids, null otherwise. */
export function parseExternalId(gladys, externalId) {
  const prefix = gladys.externalId('');
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [kind, serial] = externalId.slice(prefix.length).split(':');
  if (![SITE, ...Object.values(KINDS)].includes(kind) || !/^\d+$/.test(serial ?? '')) {
    return null;
  }
  return { kind, serial };
}

function feature(ids, key, spec) {
  return {
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...spec,
  };
}

const sensor = (ids, key, name, category, type, unit, min, max, extra = {}) =>
  feature(ids, key, { name, category, type, unit, min, max, ...extra });

const options = (labels, keys) =>
  keys.map((value, index) => ({ value, label: labels[value], sort_order: index }));

function clampFeatures(ids, kind, raw, language) {
  return clamps(kind, raw).map((clamp) =>
    sensor(
      ids,
      `ct${clamp.index}`,
      clampName(clamp.index, clamp.type, language),
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.POWER,
      U.WATT,
      -POWER_MAX,
      POWER_MAX,
    ),
  );
}

/** Fields every device carries. */
const deviceBase = (ids, name, model) => ({
  name,
  external_id: ids.device,
  model,
  should_poll: true,
  poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
  features: [],
});

function siteDevice(gladys, hubSerial, siteName, language) {
  const ids = deviceIds(gladys, SITE, hubSerial);
  const n = NAMES[language];
  const device = deviceBase(ids, siteName || DEVICE_NAMES[language].site, 'myenergi hub');
  device.features = [
    sensor(
      ids,
      'grid_power',
      n.grid_power,
      C.GRID_SENSOR,
      T.GRID_SENSOR.POWER,
      U.WATT,
      -POWER_MAX,
      POWER_MAX,
    ),
    sensor(
      ids,
      'solar_power',
      n.solar_power,
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.POWER,
      U.WATT,
      0,
      POWER_MAX,
    ),
    sensor(ids, 'voltage', n.voltage, C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE, U.VOLT, 0, 300),
  ];
  return device;
}

function zappiDevice(ids, raw, language) {
  const n = NAMES[language];
  return [
    sensor(
      ids,
      'connector_status',
      n.connector_status,
      C.CHARGING_STATION,
      T.CHARGING_STATION.CONNECTOR_STATUS,
      undefined,
      0,
      4,
    ),
    sensor(
      ids,
      'charging_state',
      n.charging_state,
      C.CHARGING_STATION,
      T.CHARGING_STATION.CHARGING_STATE,
      undefined,
      0,
      5,
    ),
    sensor(
      ids,
      'plugged',
      n.plugged,
      C.ELECTRICAL_VEHICLE_CHARGE,
      T.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
      undefined,
      0,
      1,
    ),
    feature(ids, 'mode', {
      name: n.mode,
      category: C.TEXT,
      type: T.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: options(ZAPPI_MODE_LABELS[language], Object.keys(ZAPPI_MODES)),
    }),
    sensor(
      ids,
      'charge_power',
      n.charge_power,
      C.ELECTRICAL_VEHICLE_CHARGE,
      T.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
      U.KILOWATT,
      0,
      22,
    ),
    sensor(
      ids,
      'session_energy',
      n.session_energy,
      C.ELECTRICAL_VEHICLE_CHARGE,
      T.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
      U.KILOWATT_HOUR,
      0,
      200,
    ),
    sensor(
      ids,
      'energy_today',
      n.energy_today,
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX_TODAY,
      U.KILOWATT_HOUR,
      0,
      600,
    ),
    sensor(
      ids,
      'energy_total',
      n.energy_total,
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX,
      U.KILOWATT_HOUR,
      0,
      10_000_000,
    ),
    ...clampFeatures(ids, KINDS.ZAPPI, raw, language),
  ];
}

function eddiDevice(ids, raw, language) {
  const n = NAMES[language];
  const view = eddiView(raw);
  const features = [
    feature(ids, 'status', {
      name: n.status,
      category: C.TEXT,
      type: T.TEXT.SELECT,
      min: 0,
      max: 0,
      keep_history: false,
      supported_options: options(EDDI_STATUS_LABELS[language], EDDI_STATUSES),
    }),
    sensor(ids, 'heating', n.heating, C.WATER_HEATER, T.WATER_HEATER.HEATING, undefined, 0, 1),
    sensor(
      ids,
      'heating_power',
      n.heating_power,
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.POWER,
      U.WATT,
      0,
      8000,
    ),
    sensor(
      ids,
      'diverted_today',
      n.diverted_today,
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX_TODAY,
      U.KILOWATT_HOUR,
      0,
      200,
    ),
    sensor(
      ids,
      'energy_total',
      n.energy_total,
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX,
      U.KILOWATT_HOUR,
      0,
      10_000_000,
    ),
    feature(ids, 'enabled', {
      name: n.enabled,
      category: C.WATER_HEATER,
      type: T.WATER_HEATER.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
    }),
    sensor(ids, 'boost', n.boost, C.WATER_HEATER, T.WATER_HEATER.BOOST, undefined, 0, 1),
    sensor(
      ids,
      'boost_remaining',
      n.boost_remaining,
      C.DURATION,
      T.DURATION.INTEGER,
      U.MINUTES,
      0,
      240,
    ),
  ];
  for (const key of ['temp1', 'temp2']) {
    if (view[key] !== null) {
      features.push(
        sensor(ids, key, n[key], C.TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, U.CELSIUS, 0, 100),
      );
    }
  }
  return [...features, ...clampFeatures(ids, KINDS.EDDI, raw, language)];
}

function libbiDevice(ids, raw, language) {
  const n = NAMES[language];
  return [
    sensor(
      ids,
      'battery_level',
      n.battery_level,
      C.BATTERY_STORAGE,
      T.BATTERY_STORAGE.BATTERY_LEVEL,
      U.PERCENT,
      0,
      100,
    ),
    sensor(
      ids,
      'charge_power',
      n.battery_charge,
      C.BATTERY_STORAGE,
      T.BATTERY_STORAGE.CHARGE_POWER,
      U.WATT,
      0,
      12_000,
    ),
    sensor(
      ids,
      'discharge_power',
      n.battery_discharge,
      C.BATTERY_STORAGE,
      T.BATTERY_STORAGE.DISCHARGE_POWER,
      U.WATT,
      0,
      12_000,
    ),
    feature(ids, 'status', {
      name: n.status,
      category: C.TEXT,
      type: T.TEXT.SELECT,
      min: 0,
      max: 0,
      keep_history: false,
      supported_options: options(LIBBI_STATUS_LABELS[language], LIBBI_STATUSES),
    }),
    ...clampFeatures(ids, KINDS.LIBBI, raw, language),
  ];
}

const MODELS = { zappi: 'zappi', eddi: 'eddi', harvi: 'harvi', libbi: 'libbi' };

/** Default name of a device the app did not name: "zappi 16042300". */
export const defaultName = (kind, serial) => `${kind} ${serial}`;

/**
 * Every device of the account, as published to the Discovery tab.
 * @param {object} gladys
 * @param {object} options
 * @param {string} options.hubSerial
 * @param {Array<{ kind: string, serial: string, raw: object }>} options.devices
 * @param {{ site: string|null, devices: Record<string, string> }} options.names
 * @param {string} options.language
 */
export function buildDevices(gladys, { hubSerial, devices, names, language }) {
  const list = [siteDevice(gladys, hubSerial, names?.site, language)];
  for (const { kind, serial, raw } of devices) {
    const ids = deviceIds(gladys, kind, serial);
    const device = deviceBase(
      ids,
      names?.devices?.[`${kind}:${serial}`] ?? defaultName(kind, serial),
      MODELS[kind],
    );
    if (kind === KINDS.ZAPPI) {
      device.features = zappiDevice(ids, raw, language);
    } else if (kind === KINDS.EDDI) {
      device.features = eddiDevice(ids, raw, language);
    } else if (kind === KINDS.LIBBI) {
      device.features = libbiDevice(ids, raw, language);
    } else {
      device.features = clampFeatures(ids, kind, raw, language);
    }
    // A harvi with no clamp assigned measures nothing.
    if (device.features.length > 0) {
      list.push(device);
    }
  }
  return list.map((device) => ({
    ...device,
    // A feature without unit carries no `unit` key at all.
    features: device.features.map(({ unit, ...rest }) =>
      unit === undefined ? rest : { ...rest, unit },
    ),
  }));
}

/**
 * The states of a device, from the last status and the energy read from the
 * history: `[{ key, state }]` or `[{ key, text }]`; unknown values are left out.
 * @param {string} kind
 * @param {object} raw the status of the device (for the site: unused)
 * @param {object} [extra] `{ site }` for the site, `{ energy }` for zappi / eddi
 */
export function featureStates(kind, raw, extra = {}) {
  const states = [];
  const put = (key, state) => {
    if (typeof state === 'number' && Number.isFinite(state)) {
      states.push({ key, state });
    }
  };
  const text = (key, value) => {
    if (typeof value === 'string' && value !== '') {
      states.push({ key, text: value });
    }
  };
  if (kind === SITE) {
    const site = extra.site ?? siteView([]);
    put('grid_power', site.gridW);
    put('solar_power', site.solarW);
    put('voltage', site.voltageV);
    return states;
  }
  if (kind === KINDS.ZAPPI) {
    const view = zappiView(raw);
    put('connector_status', view.connector);
    put('charging_state', view.charging);
    put('plugged', view.plugged);
    text('mode', view.mode);
    put('charge_power', view.chargePowerKw);
    put('session_energy', view.sessionKwh);
    put('energy_today', extra.energy?.today?.total);
    put('energy_total', extra.energy?.index);
  } else if (kind === KINDS.EDDI) {
    const view = eddiView(raw);
    text('status', view.status);
    put('heating', view.heating);
    put('heating_power', view.powerW);
    put('diverted_today', extra.energy?.today?.diverted);
    put('energy_total', extra.energy?.index);
    put('enabled', view.enabled);
    put('boost', view.boosting);
    put('boost_remaining', view.boostMinutes);
    put('temp1', view.temp1);
    put('temp2', view.temp2);
  } else if (kind === KINDS.LIBBI) {
    const view = libbiView(raw);
    put('battery_level', view.batteryLevel);
    put('charge_power', view.chargeW);
    put('discharge_power', view.dischargeW);
    text('status', view.status);
  }
  for (const clamp of clamps(kind, raw)) {
    put(`ct${clamp.index}`, clamp.power);
  }
  return states;
}

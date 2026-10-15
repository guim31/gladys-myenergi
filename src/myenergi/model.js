// -----------------------------------------------------------------------------
// Reading the answers of the myenergi cloud: pure functions, no I/O.
//
// The field names come from CJNE/pymyenergi (MIT) and its fixtures, the only
// public description of this API: `sta` status, `pst` plug state, `zmo` zappi
// mode, `div` power sent to the load (W), `che` energy of the session (kWh),
// `ectt<n>` / `ectp<n>` type and power (W) of the current clamp n, `tp1`/`tp2`
// eddi probe temperatures, `soc` libbi state of charge, `grd`/`gen` grid and
// generation power seen by the device (W).
// -----------------------------------------------------------------------------

export const KINDS = Object.freeze({
  ZAPPI: 'zappi',
  EDDI: 'eddi',
  HARVI: 'harvi',
  LIBBI: 'libbi',
});

// Letter of each kind in the API paths (`/cgi-jstatus-Z12345678`).
export const PREFIXES = Object.freeze({ zappi: 'Z', eddi: 'E', harvi: 'H', libbi: 'L' });

// Number of current clamps per kind (pymyenergi: ct1..ct6 on zappi and libbi).
export const CT_COUNT = Object.freeze({ zappi: 6, eddi: 3, harvi: 3, libbi: 6 });

// --- zappi ---------------------------------------------------------------------

// zappi modes, by the value of `zmo` and of the mode command.
export const ZAPPI_MODES = Object.freeze({ fast: 1, eco: 2, eco_plus: 3, stop: 4 });
const ZAPPI_MODE_BY_CODE = Object.fromEntries(
  Object.entries(ZAPPI_MODES).map(([key, code]) => [code, key]),
);

// The Gladys enums (server/utils/constants.js), OCPP-aligned.
export const CONNECTOR_STATUS = Object.freeze({ AVAILABLE: 0, OCCUPIED: 1, FAULTED: 4 });
export const CHARGING_STATE = Object.freeze({
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
});

// zappi `sta`: 1 paused, 3 charging (diverting), 4 boosting, 5 complete.
const ZAPPI_STA = Object.freeze({ PAUSED: 1, CHARGING: 3, BOOSTING: 4, COMPLETE: 5 });

/** Number, or null when absent or not a number. */
const num = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * What the zappi says about the car: the Gladys connector status and charging
 * state, from the plug state (`pst`) and the status (`sta`).
 *
 *   pst A          no car                 -> available, idle
 *   pst F          fault                  -> faulted
 *   sta 5          charge complete        -> occupied, idle
 *   sta 3 or 4     charging, boosting     -> occupied, charging
 *   pst B1         car connected          -> occupied, car connected
 *   pst B2         waiting for the car    -> occupied, paused by the car
 *   anything else  paused, plugged in     -> occupied, paused by the charger
 *                  (waiting for surplus in Eco+, or stopped)
 */
export function zappiChargeState(raw) {
  const pst = typeof raw.pst === 'string' ? raw.pst : '';
  const sta = num(raw.sta);
  if (pst === 'A') {
    return { connector: CONNECTOR_STATUS.AVAILABLE, charging: CHARGING_STATE.IDLE, plugged: 0 };
  }
  if (pst === 'F') {
    return { connector: CONNECTOR_STATUS.FAULTED, charging: CHARGING_STATE.IDLE, plugged: 0 };
  }
  if (!pst || pst === 'U') {
    return { connector: null, charging: null, plugged: null };
  }
  const occupied = { connector: CONNECTOR_STATUS.OCCUPIED, plugged: 1 };
  if (sta === ZAPPI_STA.COMPLETE) {
    return { ...occupied, charging: CHARGING_STATE.IDLE };
  }
  if (sta === ZAPPI_STA.CHARGING || sta === ZAPPI_STA.BOOSTING || pst === 'C2') {
    return { ...occupied, charging: CHARGING_STATE.CHARGING };
  }
  if (pst === 'B1') {
    return { ...occupied, charging: CHARGING_STATE.EV_CONNECTED };
  }
  if (pst === 'B2') {
    return { ...occupied, charging: CHARGING_STATE.PAUSED_BY_VEHICLE };
  }
  return { ...occupied, charging: CHARGING_STATE.PAUSED_BY_CHARGER };
}

export function zappiView(raw) {
  const state = zappiChargeState(raw);
  const div = num(raw.div);
  return {
    ...state,
    mode: ZAPPI_MODE_BY_CODE[num(raw.zmo)] ?? null,
    // `div` is the power sent to the car; absent while it does not charge.
    chargePowerKw: div === null ? 0 : round(Math.max(0, div) / 1000, 2),
    sessionKwh: num(raw.che) === null ? null : round(Math.max(0, num(raw.che)), 2),
    // bsm: manual boost, bss: smart boost, bst: timed boost.
    boosting: [raw.bsm, raw.bss, raw.bst].some((flag) => num(flag) === 1),
    complete: num(raw.sta) === ZAPPI_STA.COMPLETE,
  };
}

// --- eddi ----------------------------------------------------------------------

// eddi `sta`, by the stable key the integration publishes.
const EDDI_STATUS_BY_STA = Object.freeze({
  1: 'paused',
  3: 'diverting',
  4: 'boosting',
  5: 'hot',
  6: 'stopped',
});
export const EDDI_STATUSES = Object.freeze(['paused', 'diverting', 'boosting', 'hot', 'stopped']);

export function eddiView(raw) {
  const status = EDDI_STATUS_BY_STA[num(raw.sta)] ?? null;
  const div = num(raw.div);
  const remaining = num(raw.rbt);
  const boosting = num(raw.bsm) === 1 || status === 'boosting';
  const probe = (key) => {
    const value = num(raw[key]);
    // -1 (or nothing) when no probe is connected.
    return value === null || value === -1 ? null : round(value, 1);
  };
  return {
    status,
    enabled: status === null ? null : status === 'stopped' ? 0 : 1,
    heating: status === 'diverting' || status === 'boosting' ? 1 : 0,
    powerW: div === null ? 0 : Math.max(0, Math.round(div)),
    boosting: boosting ? 1 : 0,
    boostMinutes: boosting && remaining !== null ? Math.ceil(Math.max(0, remaining) / 60) : 0,
    temp1: probe('tp1'),
    temp2: probe('tp2'),
  };
}

// --- libbi ---------------------------------------------------------------------

export const LIBBI_STATUSES = Object.freeze([
  'off',
  'on',
  'full',
  'idle',
  'charging',
  'discharging',
  'duration_charging',
  'duration_drain',
  'stopped',
  'target_charge',
  'boosting',
  'upgrading',
  'fault',
]);

// libbi `sta` (pymyenergi STATES): the operating states; every other code of
// that table is a fault reported by the battery.
const LIBBI_STATUS_BY_STA = Object.freeze({
  0: 'off',
  1: 'on',
  2: 'full',
  4: 'idle',
  5: 'charging',
  6: 'discharging',
  7: 'duration_charging',
  8: 'duration_drain',
  11: 'stopped',
  12: 'target_charge',
  51: 'boosting',
  53: 'boosting',
  55: 'boosting',
  102: 'full',
  104: 'full',
  233: 'charging', // SoC recovery
  234: 'charging', // calibration charge
  251: 'upgrading',
  252: 'upgrading',
  253: 'upgrading',
});

export function libbiView(raw) {
  const sta = num(raw.sta);
  const div = num(raw.div);
  const soc = num(raw.soc);
  return {
    status: sta === null ? null : (LIBBI_STATUS_BY_STA[sta] ?? 'fault'),
    // `div` is the power of the battery inverter: > 0 charging, < 0 discharging
    // (pymyenergi fixture: discharging at -457 W).
    chargeW: div === null ? 0 : Math.max(0, Math.round(div)),
    dischargeW: div === null ? 0 : Math.max(0, Math.round(-div)),
    batteryLevel: soc === null ? null : Math.min(100, Math.max(0, Math.round(soc))),
  };
}

// --- Current clamps --------------------------------------------------------------

/**
 * The clamps of a device that are assigned (type other than "None"), with
 * their power in W.
 * @returns {Array<{ index: number, type: string, power: number }>}
 */
export function clamps(kind, raw) {
  const list = [];
  for (let index = 1; index <= (CT_COUNT[kind] ?? 0); index += 1) {
    const type = raw[`ectt${index}`];
    if (typeof type !== 'string' || type.trim() === '' || type === 'None') {
      continue;
    }
    list.push({ index, type: type.trim(), power: Math.round(num(raw[`ectp${index}`]) ?? 0) });
  }
  return list;
}

// --- The whole account -------------------------------------------------------------

/**
 * Parse `/cgi-jstatus-*`: a list of groups, one per kind (`{ zappi: [...] }`),
 * plus a group carrying the hub firmware (`{ asn, fwv }`).
 * @returns {{ devices: Array<{ kind: string, serial: string, raw: object }>, firmware: string|null }}
 */
export function parseStatus(answer) {
  if (!Array.isArray(answer)) {
    throw new TypeError('the status is not a list');
  }
  const devices = [];
  let firmware = null;
  for (const group of answer) {
    if (!group || typeof group !== 'object') {
      continue;
    }
    if (typeof group.fwv === 'string' && !Object.values(KINDS).some((kind) => kind in group)) {
      firmware = group.fwv;
    }
    for (const kind of Object.values(KINDS)) {
      for (const raw of Array.isArray(group[kind]) ? group[kind] : []) {
        const serial = raw && num(raw.sno) !== null ? String(Math.trunc(num(raw.sno))) : null;
        if (serial && !devices.some((d) => d.kind === kind && d.serial === serial)) {
          devices.push({ kind, serial, raw });
        }
      }
    }
  }
  return { devices, firmware };
}

/**
 * Parse `/cgi-get-app-key-`: `{ "<hub>": [{ key: "Z16042300", val: "Garage" }, ...] }`.
 * @returns {{ site: string|null, devices: Record<string, string> }} names by `<kind>:<serial>`
 */
export function parseNames(answer) {
  const names = { site: null, devices: {} };
  if (!answer || typeof answer !== 'object') {
    return names;
  }
  const kindOfPrefix = Object.fromEntries(Object.entries(PREFIXES).map(([k, p]) => [p, k]));
  for (const list of Object.values(answer)) {
    for (const entry of Array.isArray(list) ? list : []) {
      if (!entry || typeof entry.key !== 'string' || typeof entry.val !== 'string') {
        continue;
      }
      const name = entry.val.trim().slice(0, 60);
      if (!name) {
        continue;
      }
      if (entry.key === 'siteName') {
        names.site = name;
        continue;
      }
      const match = entry.key.match(/^([ZEHL])(\d+)$/);
      if (match) {
        names.devices[`${kindOfPrefix[match[1]]}:${match[2]}`] = name;
      }
    }
  }
  return names;
}

/**
 * Grid and generation power of the site, as pymyenergi computes them: the sum
 * of the clamps typed "Grid" (or "Generation") of every device, else the
 * values a zappi, eddi or libbi computed itself (`grd`, `gen`).
 * @param {Array<{ kind: string, raw: object }>} devices
 */
export function siteView(devices) {
  const sums = { Grid: null, Generation: null };
  let reporter = null;
  for (const { kind, raw } of devices) {
    // pymyenergi leaves out the third clamp of the eddi.
    const count = kind === KINDS.EDDI ? 2 : CT_COUNT[kind];
    for (const clamp of clamps(kind, raw)) {
      if (clamp.index <= count && clamp.type in sums) {
        sums[clamp.type] = (sums[clamp.type] ?? 0) + clamp.power;
      }
    }
    if (kind !== KINDS.HARVI && reporter === null) {
      reporter = raw;
    }
  }
  const fallback = (key) => (reporter && num(reporter[key]) !== null ? num(reporter[key]) : null);
  const voltage = reporter ? num(reporter.vol) : null;
  const grid = sums.Grid ?? fallback('grd');
  const generation = sums.Generation ?? fallback('gen');
  return {
    gridW: grid === null ? null : Math.round(grid),
    // A solar inverter draws a few watts at night: production never goes below 0.
    solarW: generation === null ? null : Math.max(0, Math.round(generation)),
    // `vol` is in tenths of a volt; 0 when the device does not measure it.
    voltageV: voltage ? round(voltage / 10, 1) : null,
  };
}

/**
 * Energy of a day of hourly history, in kWh: the `h1d`..`h3d` (diverted
 * surplus) and `h1b`..`h3b` (boost from the grid) counters, in joules.
 * @param {object} answer `{ "U<serial>": [rows] }`
 * @param {string} serial
 * @returns {{ total: number, diverted: number }}
 */
export function parseHistory(answer, serial) {
  const rows = answer?.[`U${serial}`];
  if (!Array.isArray(rows)) {
    throw new TypeError('the history does not carry this device');
  }
  let diverted = 0;
  let boosted = 0;
  for (const row of rows) {
    for (const heater of [1, 2, 3]) {
      diverted += Math.max(0, num(row?.[`h${heater}d`]) ?? 0);
      boosted += Math.max(0, num(row?.[`h${heater}b`]) ?? 0);
    }
  }
  const kwh = (joules) => round(joules / 3_600_000, 3);
  return { total: kwh(diverted + boosted), diverted: kwh(diverted) };
}

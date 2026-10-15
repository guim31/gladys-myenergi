// -----------------------------------------------------------------------------
// The myenergi hub of the integration: reads the account on a timer of the
// container, publishes the devices and their states to Gladys (changes only,
// plus a heartbeat), fires the "charge completed" scene event, and runs the
// commands of the devices, the scene actions and the widget.
//
// Refreshing. The devices are published with should_poll and a 1-minute
// poll_frequency, but the core cannot be trusted to call onPoll (Gladys#3198:
// a device created without should_poll is never polled). So the hub reads the
// cloud on its own timer, at the configured interval; the core's onPoll is a
// fallback that does nothing while the timer runs (it skips when the account
// was read less than 90 % of an interval ago), and the timer skips a turn when
// the core has just read it. One request (`/cgi-jstatus-*`) reads every
// device; the hourly history (energy of the day, total energy) is read every
// HUB_TIMINGS.historyMs, for the zappi and eddi the user added only.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { dayKey, hoursIn, startOfDay } from './clock.js';
import {
  SITE,
  buildDevices,
  defaultName,
  deviceIds,
  featureStates,
  parseExternalId,
} from './devices.js';
import { EnergyLedger } from './energy.js';
import { createIssueLog } from './issues.js';
import { ERROR_KINDS, MyenergiClient } from './myenergi/client.js';
import {
  KINDS,
  PREFIXES,
  ZAPPI_MODES,
  eddiView,
  parseHistory,
  parseNames,
  parseStatus,
  siteView,
  zappiView,
} from './myenergi/model.js';
import { isConfigured } from './config.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  UserError,
  ZAPPI_MODE_LABELS,
  perLanguage,
} from './texts.js';

const logger = createLogger({ name: 'myenergi' });

export const WIDGET_KEY = 'overview';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({ CHARGE_COMPLETED: 'charge_completed' });

export const HUB_TIMINGS = {
  // The history is hourly: reading it every 10 minutes is plenty.
  historyMs: 10 * 60_000,
  // Names change when the user renames a device in the app.
  namesMs: 6 * 60 * 60_000,
  // An unchanged value is sent again this often (the front shows "no recent
  // value" past 48 h; the maintainer asks for 12 h at most).
  heartbeatMs: 6 * 60 * 60_000,
  // The cloud takes a few seconds to apply a command: read again after it.
  afterCommandMs: 5_000,
};

export const BOOST_LIMITS = Object.freeze({
  kwhMin: 1,
  kwhMax: 99,
  minutesMin: 1,
  minutesMax: 240,
});

/** A whole number from a scene field or a form ("10", 10, "10,0"), else null. */
export function parseWhole(raw, min, max) {
  const number =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : NaN;
  if (!Number.isInteger(number) || number < min || number > max) {
    return null;
  }
  return number;
}

/** "7:30" / "07:30" -> "0730"; null when it is not a time of day. */
export function parseTime(raw) {
  const match = typeof raw === 'string' ? raw.trim().match(/^(\d{1,2})[:hH](\d{2})$/) : null;
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return null;
  }
  return `${match[1].padStart(2, '0')}${match[2]}`;
}

const idOf = (kind, serial) => `${kind}:${serial}`;
const credentials = (config) => JSON.stringify([config?.hubSerial, config?.apiKey]);

export class MyenergiHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/myenergi/client.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {string} [options.timeZone] undefined: the TZ of the container
   */
  constructor({ gladys, store, request, timers = true, timings, now, timeZone }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.timeZone = timeZone;
    this.config = null;
    this.client = null;
    this.ledger = new EnergyLedger({ timeZone });
    this.resetAccount();
    this.timer = null;
    this.commandTimer = null;
    this.stopped = false;
    this.issues = createIssueLog(logger);
  }

  /** Forget everything read from the account (new credentials). */
  resetAccount() {
    /** Last successful reading: devices, names, site view; null before the first. */
    this.snapshot = null;
    this.names = { site: null, devices: {} };
    this.namesAt = 0;
    this.lastRefreshAt = 0;
    this.error = null;
    this.downSince = null;
    this.structure = null;
    /** Energy of the day and index, per `<kind>:<serial>`. */
    this.energy = new Map();
    this.historyAt = new Map();
    /** Previous zappi views, for the "charge completed" transition. */
    this.previousZappi = new Map();
    this.transports = new Map();
    this.connection = null;
    this.refreshing = null;
    this.widgetSignature = null;
  }

  // --- Lifecycle ------------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.ledger = new EnergyLedger({ saved: saved.energy, timeZone: this.timeZone });
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    this.structure = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const changed = credentials(config) !== credentials(this.config);
    this.config = config;
    if (changed) {
      this.resetAccount();
      this.client = isConfigured(config)
        ? new MyenergiClient({
            serial: config.hubSerial,
            apiKey: config.apiKey,
            request: this.request,
          })
        : null;
    }
    await this.refresh({ discover: true });
    this.schedule();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.commandTimer);
    await this.store.flush();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      // Nothing added in Gladys: nothing to read (the search and "Test the
      // connection" still read the account on demand). And the core's onPoll
      // may have read it less than half an interval ago.
      const due = this.now() - this.lastRefreshAt >= this.config.refreshMs / 2;
      if (due && this.hasCreatedDevices()) {
        await this.refresh().catch((err) => logger.error('Refresh failed', err));
      }
      this.schedule();
    }, this.config.refreshMs);
  }

  /** Read again a few seconds after a command, to show what the cloud applied. */
  scheduleAfterCommand() {
    clearTimeout(this.commandTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.commandTimer = setTimeout(() => {
      this.commandTimer = null;
      this.refresh().catch((err) => logger.error('Refresh failed', err));
    }, this.timings.afterCommandMs);
  }

  // --- Devices added in Gladys ------------------------------------------------------

  /** The external ids of the devices the user added. */
  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  hasCreatedDevices() {
    return [...this.createdIds()].some((id) => parseExternalId(this.gladys, id) !== null);
  }

  /** The core's onPoll: read the account, unless the timer just did. */
  async pollFromCore(device) {
    if (!parseExternalId(this.gladys, device?.external_id) || !this.config) {
      return;
    }
    if (this.now() - this.lastRefreshAt < this.config.refreshMs * 0.9) {
      logger.debug(`onPoll ${device.external_id}: read ${this.now() - this.lastRefreshAt} ms ago`);
      return;
    }
    await this.refresh();
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const parsed = parseExternalId(this.gladys, device?.external_id);
    if (!parsed) {
      return;
    }
    // The SDK forgot the published values of this device: everything is sent
    // again now, with the energy read at once for a zappi or an eddi.
    this.historyAt.delete(idOf(parsed.kind, parsed.serial));
    this.transports.delete(device.external_id);
    await this.refreshing?.catch(() => {});
    if (this.snapshot && this.now() - this.snapshot.at < this.config.refreshMs) {
      // A fresh reading is there (the user adds the devices one after the
      // other, right after the search): publish it, read the cloud less.
      await this.readEnergy(this.now());
      await this.publishStates();
      await this.publishTransports();
    } else {
      await this.refresh();
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the account ------------------------------------------------------------

  /** Concurrent callers share the reading in progress. */
  refresh({ discover = false } = {}) {
    if (this.refreshing) {
      return discover
        ? this.refreshing.then(() => this.refresh({ discover: true }))
        : this.refreshing;
    }
    this.refreshing = this.read({ discover }).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async read({ discover }) {
    if (!this.client || this.gladys.connected === false) {
      if (!this.client) {
        await this.publishConnectionStatus();
        if (discover) {
          await this.publishDevices([]);
        }
      }
      return;
    }
    const startedAt = this.now();
    this.lastRefreshAt = startedAt;
    let status;
    try {
      status = parseStatus(await this.client.getStatus());
    } catch (err) {
      await this.applyFailure(err.kind ? err : wrapAnswer(err));
      return;
    }
    if (discover || startedAt - this.namesAt >= this.timings.namesMs) {
      await this.readNames(startedAt);
    }
    this.applySuccess(status, startedAt);
    await this.publishDevices(status.devices, { force: discover });
    await this.readEnergy(startedAt);
    await this.publishStates();
    await this.fireTransitions();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.refreshWidgetIfChanged();
  }

  async readNames(at) {
    try {
      this.names = parseNames(await this.client.getNames());
      this.namesAt = at;
      this.issues.ok('names', 'myenergi: device names read again');
    } catch (err) {
      // The names are a comfort: the serials stand in for them.
      this.namesAt = at;
      this.issues.fail('names', `myenergi: device names not read (${err.message})`);
    }
  }

  applySuccess(status, at) {
    if (this.error) {
      const minutes = Math.round((at - this.downSince) / 60_000);
      logger.info(`myenergi answers again (after ${minutes} min)`);
    } else if (this.snapshot === null) {
      logger.info(
        `Connected to myenergi (${this.client.host}): ${status.devices.length} device(s)` +
          ` ${status.devices.map((d) => d.kind).join(', ')}`.trimEnd(),
      );
    }
    this.error = null;
    this.downSince = null;
    this.snapshot = {
      at,
      devices: status.devices,
      firmware: status.firmware,
      site: siteView(status.devices),
    };
  }

  async applyFailure(err) {
    const previous = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.downSince ??= this.now();
    if (previous !== err.kind) {
      logger.warn(`myenergi: ${err.message}`);
    } else {
      logger.debug(`myenergi: ${err.message} (again)`);
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (previous !== err.kind) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** Publish the devices when their structure changed (or on demand). */
  async publishDevices(devices, { force = false } = {}) {
    const list = this.config
      ? buildDevices(this.gladys, {
          hubSerial: this.config.hubSerial,
          devices,
          names: this.names,
          language: this.config.language,
        })
      : [];
    // Nothing configured: an empty list, the Discovery tab shows no stale device.
    const published = this.client ? list : [];
    const signature = JSON.stringify(published);
    if (!force && signature === this.structure) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(published);
      this.structure = signature;
      this.issues.ok('discovery', 'myenergi: devices published again');
    } catch (err) {
      this.issues.fail('discovery', `myenergi: devices refused by Gladys (${err.message})`);
    }
  }

  /** Energy of the day and total index of the zappi and eddi the user added. */
  async readEnergy(at) {
    const created = this.createdIds();
    let saved = false;
    for (const { kind, serial } of this.snapshot.devices) {
      if (kind !== KINDS.ZAPPI && kind !== KINDS.EDDI) {
        continue;
      }
      if (!created.has(deviceIds(this.gladys, kind, serial).device)) {
        continue;
      }
      const id = idOf(kind, serial);
      const last = this.historyAt.get(id);
      // Just after midnight the ledger adds the day that ended: read at once.
      const dayChanged = this.ledger.dayOf(id) !== dayKey(at, this.timeZone);
      if (last !== undefined && at - last < this.timings.historyMs && !dayChanged) {
        continue;
      }
      try {
        const result = await this.ledger.update(id, {
          now: at,
          readDay: (day) => this.readDay(kind, serial, day),
        });
        this.energy.set(id, result);
        this.historyAt.set(id, at);
        saved = true;
        if (result.skippedDays > 0) {
          logger.warn(
            `${kind} ${serial}: ${result.skippedDays} day(s) older than the history kept were not added to the total energy`,
          );
        }
        this.issues.ok(`history:${id}`, `${kind} ${serial}: energy history read again`);
      } catch (err) {
        this.issues.fail(
          `history:${id}`,
          `${kind} ${serial}: energy history not read (${err.message})`,
        );
      }
    }
    if (saved) {
      this.store.save({ version: 1, energy: this.ledger.toJSON() });
    }
  }

  async readDay(kind, serial, day) {
    const from = new Date(startOfDay(day, this.timeZone));
    const answer = await this.client.getHourlyHistory(
      PREFIXES[kind],
      serial,
      from,
      hoursIn(day, this.timeZone),
    );
    try {
      return parseHistory(answer, serial);
    } catch (err) {
      throw wrapAnswer(err);
    }
  }

  // --- Publishing to Gladys ---------------------------------------------------------------

  /** The states of the created devices, changes only, plus the heartbeat. */
  async publishStates() {
    if (!this.snapshot) {
      return;
    }
    const created = this.createdIds();
    const states = [];
    const add = (ids, list) => {
      if (!created.has(ids.device)) {
        return;
      }
      for (const { key, ...value } of list) {
        states.push({ device_feature_external_id: ids.feature(key), ...value });
      }
    };
    add(
      deviceIds(this.gladys, SITE, this.config.hubSerial),
      featureStates(SITE, null, { site: this.snapshot.site }),
    );
    for (const { kind, serial, raw } of this.snapshot.devices) {
      add(
        deviceIds(this.gladys, kind, serial),
        featureStates(kind, raw, { energy: this.energy.get(idOf(kind, serial)) }),
      );
    }
    if (states.length === 0) {
      return;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeatMs,
      });
      logger.debug(`${count} state(s) published`);
      this.issues.ok('states', 'myenergi: states accepted by Gladys again');
    } catch (err) {
      this.issues.fail('states', `myenergi: states refused by Gladys (${err.message})`);
    }
  }

  async fireTransitions() {
    for (const { kind, serial, raw } of this.snapshot.devices) {
      if (kind !== KINDS.ZAPPI) {
        continue;
      }
      const id = idOf(kind, serial);
      const view = zappiView(raw);
      const previous = this.previousZappi.get(id);
      this.previousZappi.set(id, view);
      // Not at the first reading: a charge completed before the start is old news.
      if (!previous || previous.complete || !view.complete || view.plugged !== 1) {
        continue;
      }
      const name = this.deviceName(kind, serial);
      logger.info(`${name}: charge completed (${view.sessionKwh ?? 0} kWh)`);
      try {
        await this.gladys.publishSceneEvent(TRIGGERS.CHARGE_COMPLETED, {
          device: deviceIds(this.gladys, kind, serial).device,
          energy_kwh: view.sessionKwh ?? 0,
          name,
        });
        this.issues.ok('scene-event', 'myenergi: scene events accepted again');
      } catch (err) {
        this.issues.fail('scene-event', `myenergi: scene event refused (${err.message})`);
      }
    }
  }

  async publishTransports() {
    const created = this.createdIds();
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
    const entries = [];
    for (const externalId of created) {
      if (!parseExternalId(this.gladys, externalId)) {
        continue;
      }
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.issues.ok('transports', 'myenergi: transports accepted again');
    } catch (err) {
      this.issues.fail('transports', `myenergi: transports refused (${err.message})`);
    }
  }

  connectionStatus() {
    if (!this.config || !isConfigured(this.config)) {
      return {
        connected: false,
        message: this.config?.invalidSerial
          ? CONNECTION_TEXT.invalidSerial
          : CONNECTION_TEXT.notConfigured,
      };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    if (!this.snapshot) {
      return null; // not read yet
    }
    return this.snapshot.devices.length
      ? { connected: true }
      : { connected: true, message: CONNECTION_TEXT.noDevice };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (status === null || key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection-status', 'myenergi: connection status accepted again');
    } catch (err) {
      this.issues.fail('connection-status', `myenergi: connection status refused (${err.message})`);
    }
  }

  /** The widget shows states and modes: ask Gladys to re-pull it when they change. */
  refreshWidgetIfChanged() {
    const signature = JSON.stringify(
      this.snapshot.devices
        .filter(({ kind }) => kind === KINDS.ZAPPI || kind === KINDS.EDDI)
        .map(({ kind, raw }) =>
          kind === KINDS.ZAPPI
            ? [zappiView(raw).mode, zappiView(raw).charging, zappiView(raw).boosting]
            : [eddiView(raw).status, eddiView(raw).boosting],
        ),
    );
    if (signature !== this.widgetSignature) {
      if (this.widgetSignature !== null) {
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      }
      this.widgetSignature = signature;
    }
  }

  // --- Commands ----------------------------------------------------------------------------

  deviceName(kind, serial) {
    return this.names.devices[idOf(kind, serial)] ?? defaultName(kind, serial);
  }

  /** A fresh enough snapshot, read now when there is none. */
  async ensureSnapshot() {
    if (!this.client) {
      throw new UserError(ACTION_TEXT.notConfigured, this.config?.language);
    }
    if (!this.snapshot) {
      await this.refresh();
    }
    if (!this.snapshot) {
      throw new UserError(
        ERROR_TEXT[this.error?.kind] ?? ERROR_TEXT.unreachable,
        this.config.language,
      );
    }
    return this.snapshot;
  }

  /**
   * The device a command targets: the one chosen, or the only one of its kind.
   * @returns {Promise<{ kind: string, serial: string, raw: object, name: string }>}
   */
  async target(kind, externalId) {
    const snapshot = await this.ensureSnapshot();
    const language = this.config.language;
    const wrongKind = kind === KINDS.ZAPPI ? ACTION_TEXT.notZappi : ACTION_TEXT.notEddi;
    let device;
    if (externalId) {
      const parsed = parseExternalId(this.gladys, externalId);
      if (!parsed || parsed.kind !== kind) {
        throw new UserError(wrongKind, language);
      }
      device = snapshot.devices.find((d) => d.kind === kind && d.serial === parsed.serial);
      if (!device) {
        throw new UserError(ACTION_TEXT.unknownDevice, language);
      }
    } else {
      const candidates = snapshot.devices.filter((d) => d.kind === kind);
      if (candidates.length === 0) {
        throw new UserError(
          kind === KINDS.ZAPPI ? ACTION_TEXT.noZappi : ACTION_TEXT.noEddi,
          language,
        );
      }
      if (candidates.length > 1) {
        throw new UserError(wrongKind, language);
      }
      [device] = candidates;
    }
    return { ...device, name: this.deviceName(device.kind, device.serial) };
  }

  /** Run a command against the cloud: one info line, a sentence for the user on failure. */
  async run(device, description, command) {
    try {
      await command();
    } catch (err) {
      logger.warn(`${device.name}: ${description} failed (${err.message})`);
      if (err.kind === ERROR_KINDS.AUTH || err.kind === ERROR_KINDS.UNREACHABLE) {
        await this.applyFailure(err);
      }
      throw new UserError(ERROR_TEXT[err.kind] ?? ERROR_TEXT.server, this.config.language);
    }
    logger.info(`${device.name}: ${description}`);
    this.scheduleAfterCommand();
  }

  /** Apply a field the command changed right away, then publish (the next read confirms). */
  async patch(device, fields) {
    Object.assign(device.raw, fields);
    await this.publishStates();
    this.refreshWidgetIfChanged();
  }

  async setZappiMode(externalId, mode) {
    if (!(mode in ZAPPI_MODES)) {
      throw new UserError(ACTION_TEXT.badMode, this.config?.language);
    }
    const device = await this.target(KINDS.ZAPPI, externalId);
    await this.run(device, `mode ${mode}`, () =>
      this.client.setZappiMode(device.serial, ZAPPI_MODES[mode]),
    );
    await this.patch(device, { zmo: ZAPPI_MODES[mode] });
    return perLanguage((language) =>
      ACTION_TEXT.modeSet[language](device.name, ZAPPI_MODE_LABELS[language][mode]),
    );
  }

  /**
   * A zappi boost of `kwh` kWh, now or ready by `readyBy` (smart boost).
   * Only in Eco and Eco+: in Fast the zappi already charges at full power.
   */
  async startZappiBoost(externalId, kwhRaw, readyByRaw) {
    const language = this.config?.language;
    const kwh = parseWhole(kwhRaw, BOOST_LIMITS.kwhMin, BOOST_LIMITS.kwhMax);
    if (kwh === null) {
      throw new UserError(ACTION_TEXT.badEnergy, language);
    }
    const hasTime = typeof readyByRaw === 'string' && readyByRaw.trim() !== '';
    const hhmm = hasTime ? parseTime(readyByRaw) : null;
    if (hasTime && hhmm === null) {
      throw new UserError(ACTION_TEXT.badTime, language);
    }
    const device = await this.target(KINDS.ZAPPI, externalId);
    const { mode } = zappiView(device.raw);
    if (mode !== 'eco' && mode !== 'eco_plus') {
      throw new UserError(ACTION_TEXT.boostNeedsEco, language);
    }
    if (hhmm) {
      const time = `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
      await this.run(device, `smart boost ${kwh} kWh by ${time}`, () =>
        this.client.startZappiSmartBoost(device.serial, kwh, hhmm),
      );
      return perLanguage((l) => ACTION_TEXT.zappiSmartBoost[l](device.name, kwh, time));
    }
    await this.run(device, `boost ${kwh} kWh`, () =>
      this.client.startZappiBoost(device.serial, kwh),
    );
    await this.patch(device, { bsm: 1 });
    return perLanguage((l) => ACTION_TEXT.zappiBoost[l](device.name, kwh));
  }

  async stopZappiBoost(externalId) {
    const device = await this.target(KINDS.ZAPPI, externalId);
    await this.run(device, 'boost stopped', () => this.client.stopZappiBoost(device.serial));
    await this.patch(device, { bsm: 0, bss: 0, bst: 0 });
    return perLanguage((l) => ACTION_TEXT.boostStopped[l](device.name));
  }

  async startEddiBoost(externalId, heaterRaw, minutesRaw) {
    const language = this.config?.language;
    const heater = parseWhole(heaterRaw ?? 1, 1, 2);
    if (heater === null) {
      throw new UserError(ACTION_TEXT.badHeater, language);
    }
    const minutes = parseWhole(minutesRaw, BOOST_LIMITS.minutesMin, BOOST_LIMITS.minutesMax);
    if (minutes === null) {
      throw new UserError(ACTION_TEXT.badMinutes, language);
    }
    const device = await this.target(KINDS.EDDI, externalId);
    await this.run(device, `boost heater ${heater} for ${minutes} min`, () =>
      this.client.startEddiBoost(device.serial, heater, minutes),
    );
    await this.patch(device, { bsm: 1, rbt: minutes * 60 });
    return perLanguage((l) => ACTION_TEXT.eddiBoost[l](device.name, minutes));
  }

  /** Cancel the boost of both heaters: the one without a boost ignores it. */
  async stopEddiBoost(externalId) {
    const device = await this.target(KINDS.EDDI, externalId);
    await this.run(device, 'boost stopped', async () => {
      await this.client.stopEddiBoost(device.serial, 1);
      await this.client.stopEddiBoost(device.serial, 2).catch((err) => {
        logger.debug(`${device.name}: heater 2 boost not cancelled (${err.message})`);
      });
    });
    await this.patch(device, { bsm: 0, rbt: 0 });
    return perLanguage((l) => ACTION_TEXT.boostStopped[l](device.name));
  }

  async setEddiEnabled(externalId, enabled) {
    const device = await this.target(KINDS.EDDI, externalId);
    await this.run(device, `surplus diversion ${enabled ? 'on' : 'stopped'}`, () =>
      this.client.setEddiEnabled(device.serial, enabled),
    );
    // sta 6: stopped; back on, the eddi waits for surplus (1) until it reads again.
    await this.patch(device, { sta: enabled ? 1 : 6 });
    return perLanguage((l) => ACTION_TEXT.eddiEnabled[l](device.name, enabled));
  }

  /** Stop every boost in progress (the widget button). */
  async stopAllBoosts() {
    const snapshot = await this.ensureSnapshot();
    const stopped = [];
    for (const { kind, serial, raw } of snapshot.devices) {
      const externalId = deviceIds(this.gladys, kind, serial).device;
      if (kind === KINDS.ZAPPI && zappiView(raw).boosting) {
        await this.stopZappiBoost(externalId);
        stopped.push(this.deviceName(kind, serial));
      } else if (kind === KINDS.EDDI && eddiView(raw).boosting) {
        await this.stopEddiBoost(externalId);
        stopped.push(this.deviceName(kind, serial));
      }
    }
    return perLanguage((l) => ACTION_TEXT.boostStopped[l](stopped.join(', ') || '—'));
  }

  /** The commands of the device features: zappi mode, eddi surplus diversion. */
  async setValue(device, feature, value) {
    const parsed = parseExternalId(this.gladys, device?.external_id);
    const ids = parsed && deviceIds(this.gladys, parsed.kind, parsed.serial);
    // Resolved without a value: a device command expects no answer.
    if (parsed?.kind === KINDS.ZAPPI && feature?.external_id === ids.feature('mode')) {
      await this.setZappiMode(device.external_id, String(value));
      return;
    }
    if (parsed?.kind === KINDS.EDDI && feature?.external_id === ids.feature('enabled')) {
      await this.setEddiEnabled(device.external_id, Number(value) === 1);
      return;
    }
    throw new Error(`Feature ${feature?.external_id} cannot be controlled`);
  }

  // --- Reports ---------------------------------------------------------------------------------

  /** "Test the connection": read the account now. */
  async testConnection() {
    if (!this.client) {
      throw new UserError(
        this.config?.invalidSerial ? CONNECTION_TEXT.invalidSerial : CONNECTION_TEXT.notConfigured,
        this.config?.language,
      );
    }
    await this.refresh({ discover: true });
    if (this.error) {
      throw new UserError(ERROR_TEXT[this.error.kind], this.config.language);
    }
    const devices = this.snapshot.devices;
    if (devices.length === 0) {
      return CONNECTION_TEXT.noDevice;
    }
    const list = devices.map(({ kind, serial }) => this.deviceName(kind, serial)).join(', ');
    return perLanguage((l) =>
      `${REPORT_TEXT[l].ok(devices.length, list)} ${REPORT_TEXT[l].server(this.client.host)}`.slice(
        0,
        400,
      ),
    );
  }

  /** What the widget shows. */
  view() {
    return {
      configured: Boolean(this.client),
      error: this.error,
      snapshot: this.snapshot,
      energy: this.energy,
      created: this.createdIds(),
      hubSerial: this.config?.hubSerial,
      name: (kind, serial) => this.deviceName(kind, serial),
    };
  }
}

/** An answer the model could not read. */
function wrapAnswer(err) {
  const wrapped = new Error(`unexpected answer (${err.message})`);
  wrapped.kind = ERROR_KINDS.ANSWER;
  return wrapped;
}

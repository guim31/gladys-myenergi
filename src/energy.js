// -----------------------------------------------------------------------------
// The "total energy" index of a zappi or an eddi.
//
// The myenergi cloud has no lifetime counter: it serves an hourly history.
// The ledger turns it into the cumulative index Gladys expects (an
// `energy-sensor/index`, from which the core derives the 30-minute
// consumption and its cost):
//
//   index = base + energy of today
//
// where `base` is the sum of the complete days already seen. At the first
// reading after midnight, the whole previous day (and any day missed while the
// container was stopped, up to MAX_BACKFILL_DAYS) is read again and added to
// the base. The index never goes down. The ledger lives in /data.
// -----------------------------------------------------------------------------

import { dayKey, nextDay } from './clock.js';

export const MAX_BACKFILL_DAYS = 31;

const round3 = (value) => Math.round(value * 1000) / 1000;

export class EnergyLedger {
  /**
   * @param {object} [options]
   * @param {object} [options.saved] the ledger read from /data
   * @param {string} [options.timeZone] undefined: the zone of the container (TZ)
   */
  constructor({ saved = {}, timeZone } = {}) {
    this.timeZone = timeZone;
    this.records = {};
    for (const [id, record] of Object.entries(saved ?? {})) {
      if (
        record &&
        /^\d{4}-\d{2}-\d{2}$/.test(record.day) &&
        Number.isFinite(record.base) &&
        Number.isFinite(record.index)
      ) {
        this.records[id] = { day: record.day, base: record.base, index: record.index };
      }
    }
  }

  toJSON() {
    return this.records;
  }

  /** The day the ledger of a device last read, null when never. */
  dayOf(id) {
    return this.records[id]?.day ?? null;
  }

  /**
   * Read today (and the days completed since the last reading) and move the
   * index. Nothing changes when a read fails: the next call starts over.
   * @param {string} id `<kind>:<serial>`
   * @param {object} options
   * @param {number} options.now
   * @param {(day: string) => Promise<{ total: number, diverted: number }>} options.readDay
   * @returns {Promise<{ today: { total: number, diverted: number }, index: number, skippedDays: number }>}
   */
  async update(id, { now, readDay }) {
    const today = dayKey(now, this.timeZone);
    const record = this.records[id] ?? { day: today, base: 0, index: 0 };
    let base = record.base;
    let skippedDays = 0;
    if (record.day < today) {
      let days = [];
      for (let day = record.day; day < today; day = nextDay(day)) {
        days.push(day);
      }
      if (days.length > MAX_BACKFILL_DAYS) {
        skippedDays = days.length - MAX_BACKFILL_DAYS;
        days = days.slice(-MAX_BACKFILL_DAYS);
      }
      for (const day of days) {
        base += (await readDay(day)).total;
      }
    }
    const energyToday = await readDay(today);
    const index = round3(Math.max(record.index, base + energyToday.total));
    this.records[id] = { day: today, base: round3(base), index };
    return { today: energyToday, index, skippedDays };
  }
}

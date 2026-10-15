// -----------------------------------------------------------------------------
// The local days of Gladys and the "total energy" index built from the daily
// history: monotonic, complete across midnight and across a stop.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, hoursIn, nextDay, startOfDay } from '../src/clock.js';
import { EnergyLedger, MAX_BACKFILL_DAYS } from '../src/energy.js';

const PARIS = 'Europe/Paris';

test('local days follow the time zone of Gladys, DST included', () => {
  assert.equal(dayKey(Date.UTC(2026, 9, 14, 22, 30), PARIS), '2026-10-15');
  assert.equal(dayKey(Date.UTC(2026, 9, 14, 22, 30), 'UTC'), '2026-10-14');
  assert.equal(new Date(startOfDay('2026-10-15', PARIS)).toISOString(), '2026-10-14T22:00:00.000Z');
  assert.equal(new Date(startOfDay('2026-12-01', PARIS)).toISOString(), '2026-11-30T23:00:00.000Z');
  assert.equal(hoursIn('2026-10-15', PARIS), 24);
  assert.equal(hoursIn('2026-10-25', PARIS), 25); // back to winter time
  assert.equal(hoursIn('2026-03-29', PARIS), 23); // summer time
  assert.equal(new Date(startOfDay('2026-03-30', PARIS)).toISOString(), '2026-03-29T22:00:00.000Z');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
});

/** A history of `perDay[day]` kWh per complete day, `today` for the current one. */
const history = (perDay) => async (day) => {
  if (!(day in perDay)) {
    throw new Error(`unexpected day ${day}`);
  }
  return { total: perDay[day], diverted: perDay[day] / 2 };
};

const at = (iso) => Date.parse(iso);

test('the index starts at the energy of today, then adds every complete day', async () => {
  const ledger = new EnergyLedger({ timeZone: PARIS });
  let result = await ledger.update('zappi:1', {
    now: at('2026-10-15T10:00:00Z'),
    readDay: history({ '2026-10-15': 4 }),
  });
  assert.equal(result.index, 4);
  assert.deepEqual(result.today, { total: 4, diverted: 2 });

  result = await ledger.update('zappi:1', {
    now: at('2026-10-15T20:00:00Z'),
    readDay: history({ '2026-10-15': 9.5 }),
  });
  assert.equal(result.index, 9.5);

  // After midnight: the whole of the 15th (read again: 11 kWh) + the 16th so far.
  result = await ledger.update('zappi:1', {
    now: at('2026-10-15T22:10:00Z'),
    readDay: history({ '2026-10-15': 11, '2026-10-16': 0.2 }),
  });
  assert.equal(result.index, 11.2);
  assert.deepEqual(ledger.toJSON()['zappi:1'], { day: '2026-10-16', base: 11, index: 11.2 });
});

test('the days missed while the container was stopped are added', async () => {
  const ledger = new EnergyLedger({
    saved: { 'eddi:2': { day: '2026-10-12', base: 100, index: 103 } },
    timeZone: PARIS,
  });
  const result = await ledger.update('eddi:2', {
    now: at('2026-10-15T10:00:00Z'),
    readDay: history({ '2026-10-12': 5, '2026-10-13': 6, '2026-10-14': 7, '2026-10-15': 1 }),
  });
  assert.equal(result.index, 119);
  assert.equal(result.skippedDays, 0);
});

test('a stop longer than the backfill only adds the last days', async () => {
  const ledger = new EnergyLedger({
    saved: { 'eddi:2': { day: '2026-01-01', base: 0, index: 0 } },
    timeZone: PARIS,
  });
  const days = [];
  const result = await ledger.update('eddi:2', {
    now: at('2026-10-15T10:00:00Z'),
    readDay: async (day) => {
      days.push(day);
      return { total: 1, diverted: 0 };
    },
  });
  assert.equal(days.length, MAX_BACKFILL_DAYS + 1);
  assert.equal(result.index, MAX_BACKFILL_DAYS + 1);
  assert.ok(result.skippedDays > 200);
});

test('the index never goes down, and a failed read changes nothing', async () => {
  const ledger = new EnergyLedger({
    saved: { 'zappi:1': { day: '2026-10-15', base: 50, index: 58 } },
    timeZone: PARIS,
  });
  // The cloud answers less than before for today (revised history).
  let result = await ledger.update('zappi:1', {
    now: at('2026-10-15T12:00:00Z'),
    readDay: history({ '2026-10-15': 6 }),
  });
  assert.equal(result.index, 58);

  await assert.rejects(
    ledger.update('zappi:1', {
      now: at('2026-10-16T12:00:00Z'),
      readDay: async () => {
        throw new Error('down');
      },
    }),
  );
  assert.deepEqual(ledger.toJSON()['zappi:1'], { day: '2026-10-15', base: 50, index: 58 });
});

test('a corrupt saved ledger is ignored', () => {
  const ledger = new EnergyLedger({
    saved: { a: { day: 'yesterday', base: 1, index: 1 }, b: null, c: { day: '2026-10-15' } },
  });
  assert.deepEqual(ledger.toJSON(), {});
});

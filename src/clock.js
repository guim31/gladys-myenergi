// -----------------------------------------------------------------------------
// Local days in the time zone of Gladys. The supervisor gives the container
// the `TZ` of Gladys, so "today" here is the day the user sees; the myenergi
// history is asked in UTC hours, from the local midnight.
// -----------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const formatters = new Map();

function partsOf(ms, timeZone) {
  const key = timeZone ?? '';
  if (!formatters.has(key)) {
    formatters.set(
      key,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }),
    );
  }
  const parts = {};
  for (const { type, value } of formatters.get(key).formatToParts(new Date(ms))) {
    parts[type] = Number(value);
  }
  return parts;
}

/** Offset of the zone at an instant, in ms (local = UTC + offset). */
function offsetAt(ms, timeZone) {
  const p = partsOf(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** `YYYY-MM-DD` of the local day of an instant. */
export function dayKey(ms, timeZone) {
  const p = partsOf(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The instant of the local midnight that starts a day. */
export function startOfDay(key, timeZone) {
  const [year, month, day] = key.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);
  let start = guess - offsetAt(guess, timeZone);
  // Across a DST change the offset at midnight differs from the one at the guess.
  start = guess - offsetAt(start, timeZone);
  return start;
}

/** The next day key. */
export function nextDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + DAY_MS).toISOString().slice(0, 10);
}

/** Hours in a local day: 24, or 23 / 25 on a DST change. */
export function hoursIn(key, timeZone) {
  return Math.round((startOfDay(nextDay(key), timeZone) - startOfDay(key, timeZone)) / 3_600_000);
}

'use strict';

function pad2(n) { return String(n).padStart(2, '0'); }

function isValidDateOnlyString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidMonthString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

function isValidTimeOfDay(value) {
  return typeof value === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(value);
}

/** Return YYYY-MM-DD for `instant` evaluated in `timezone` (IANA). */
function localDateStringInTimezone(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const lookup = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/** Parse "YYYY-MM-DD" plus "HH:MM" local wall time in `timezone` into a UTC Date. */
function zonedWallTimeToInstant(dateStr, timeStr, timezone) {
  if (!isValidDateOnlyString(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
  if (!isValidTimeOfDay(timeStr)) throw new Error(`Invalid time: ${timeStr}`);
  const [hh, mm, ss = '0'] = timeStr.split(':');
  // Start from a naive UTC guess, then measure offset for that instant in the target zone
  // and correct. Two iterations cover DST transition edges.
  const [y, m, d] = dateStr.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, Number(hh), Number(mm), Number(ss));
  for (let i = 0; i < 2; i++) {
    const offsetMs = getTimezoneOffsetMs(new Date(guess), timezone);
    guess = Date.UTC(y, m - 1, d, Number(hh), Number(mm), Number(ss)) - offsetMs;
  }
  return new Date(guess);
}

/** Return timezone offset (ms east of UTC) for `instant` in `timezone`. */
function getTimezoneOffsetMs(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instant);
  const lookup = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(lookup.year), Number(lookup.month) - 1, Number(lookup.day),
    Number(lookup.hour === '24' ? '00' : lookup.hour),
    Number(lookup.minute), Number(lookup.second)
  );
  return asUtc - instant.getTime();
}

function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + days);
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Return YYYY-MM-DD for each day in the given YYYY-MM month (in the given tz). */
function daysInMonth(monthStr, timezone) {
  if (!isValidMonthString(monthStr)) throw new Error(`Invalid month: ${monthStr}`);
  const [year, month] = monthStr.split('-').map(Number);
  const out = [];
  for (let day = 1; day <= 31; day++) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCMonth() + 1 !== month) break;
    out.push(`${year}-${pad2(month)}-${pad2(day)}`);
  }
  // Timezone parameter reserved for future use; month boundaries are unambiguous by local wall date.
  void timezone;
  return out;
}

module.exports = {
  addDaysToDateString,
  daysInMonth,
  getTimezoneOffsetMs,
  isValidDateOnlyString,
  isValidMonthString,
  isValidTimeOfDay,
  localDateStringInTimezone,
  pad2,
  zonedWallTimeToInstant,
};

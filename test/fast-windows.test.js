'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { currentWindow, effectiveWindow, planHours, addHoursToTime } = require('../lib/fast-windows');
const { localDateStringInTimezone, zonedWallTimeToInstant } = require('../lib/date-utils');

const TZ = 'America/Los_Angeles';

test('planHours returns 16/8/14/10/12/12 shapes', () => {
  assert.deepEqual(planHours('16:8'), { fast: 16, eat: 8 });
  assert.deepEqual(planHours('14:10'), { fast: 14, eat: 10 });
  assert.deepEqual(planHours('12:12'), { fast: 12, eat: 12 });
  assert.throws(() => planHours('20:4'));
});

test('addHoursToTime wraps across midnight', () => {
  assert.equal(addHoursToTime('12:00', 8), '20:00');
  assert.equal(addHoursToTime('20:00', 6), '02:00');
  assert.equal(addHoursToTime('23:30', 1), '00:30');
});

test('currentWindow: before today eat window → in fast', () => {
  // 2026-04-21 08:00 PT, plan 16:8 starting at 12:00
  const now = zonedWallTimeToInstant('2026-04-21', '08:00', TZ);
  const w = currentWindow('16:8', '12:00', TZ, now);
  assert.equal(w.todayLocalDate, '2026-04-21');
  assert.equal(w.inFastWindow, true);
  assert.equal(w.inEatWindow, false);
  assert.equal(localDateStringInTimezone(w.eatStart, TZ), '2026-04-21');
  // fast started at yesterday eat end = yesterday 12:00 + 8h = yesterday 20:00
  assert.equal(localDateStringInTimezone(w.fastStart, TZ), '2026-04-20');
});

test('currentWindow: middle of eat window → in eat', () => {
  const now = zonedWallTimeToInstant('2026-04-21', '15:00', TZ);
  const w = currentWindow('16:8', '12:00', TZ, now);
  assert.equal(w.inEatWindow, true);
  assert.equal(w.inFastWindow, false);
});

test('currentWindow: after eat window → fasting toward tomorrow', () => {
  const now = zonedWallTimeToInstant('2026-04-21', '22:00', TZ);
  const w = currentWindow('16:8', '12:00', TZ, now);
  assert.equal(w.inFastWindow, true);
  assert.equal(localDateStringInTimezone(w.eatStart, TZ), '2026-04-22');
});

// ── effectiveWindow tests ────────────────────────────────────

test('effectiveWindow: early fast end opens eat window immediately', () => {
  // Scheduled eat window: 12:00–20:00. User ends fast at 10:00.
  const now = zonedWallTimeToInstant('2026-04-21', '10:30', TZ);
  const lastEndedAt = zonedWallTimeToInstant('2026-04-21', '10:00', TZ);
  const w = effectiveWindow('16:8', '12:00', TZ, now, lastEndedAt);
  assert.equal(w.inEatWindow, true);
  assert.equal(w.inFastWindow, false);
  assert.equal(w.eatStart.getTime(), lastEndedAt.getTime());
  const expectedEnd = new Date(lastEndedAt.getTime() + 8 * 3600 * 1000);
  assert.equal(w.eatEnd.getTime(), expectedEnd.getTime());
});

test('effectiveWindow: overridden window already passed → falls back to scheduled', () => {
  // User ended fast at 10:00, eat window was 10:00–18:00, now is 19:00.
  const lastEndedAt = zonedWallTimeToInstant('2026-04-21', '10:00', TZ);
  const now = zonedWallTimeToInstant('2026-04-21', '19:00', TZ);
  const w = effectiveWindow('16:8', '12:00', TZ, now, lastEndedAt);
  // Should be in fast window toward tomorrow, not eat window
  assert.equal(w.inFastWindow, true);
  assert.equal(w.inEatWindow, false);
});

test('effectiveWindow: no lastEndedAt → same as currentWindow', () => {
  const now = zonedWallTimeToInstant('2026-04-21', '10:30', TZ);
  const eff = effectiveWindow('16:8', '12:00', TZ, now, null);
  const sched = currentWindow('16:8', '12:00', TZ, now);
  assert.deepEqual(eff, sched);
});

test('effectiveWindow: ended during scheduled window → no override', () => {
  // Ended at 13:00, scheduled window 12:00–20:00 → no change needed
  const lastEndedAt = zonedWallTimeToInstant('2026-04-21', '13:00', TZ);
  const now = zonedWallTimeToInstant('2026-04-21', '14:00', TZ);
  const w = effectiveWindow('16:8', '12:00', TZ, now, lastEndedAt);
  const sched = currentWindow('16:8', '12:00', TZ, now);
  assert.deepEqual(w, sched);
});

test('effectiveWindow: ended yesterday → no override today', () => {
  const lastEndedAt = zonedWallTimeToInstant('2026-04-20', '10:00', TZ);
  const now = zonedWallTimeToInstant('2026-04-21', '10:30', TZ);
  const w = effectiveWindow('16:8', '12:00', TZ, now, lastEndedAt);
  const sched = currentWindow('16:8', '12:00', TZ, now);
  assert.deepEqual(w, sched);
});

test('currentWindow: DST spring-forward does not skip fast start', () => {
  // US DST 2026 starts Sun 2026-03-08 at 02:00. Plan 16:8 eat window 12:00–20:00.
  // At 2026-03-08 09:00 local (during DST transition day), we're still pre-eat.
  const now = zonedWallTimeToInstant('2026-03-08', '09:00', TZ);
  const w = currentWindow('16:8', '12:00', TZ, now);
  assert.equal(w.inFastWindow, true);
  // eat window boundaries are well-defined wall times on each side of DST
  assert.equal(localDateStringInTimezone(w.eatStart, TZ), '2026-03-08');
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { currentWindow, planHours, addHoursToTime } = require('../lib/fast-windows');
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

test('currentWindow: DST spring-forward does not skip fast start', () => {
  // US DST 2026 starts Sun 2026-03-08 at 02:00. Plan 16:8 eat window 12:00–20:00.
  // At 2026-03-08 09:00 local (during DST transition day), we're still pre-eat.
  const now = zonedWallTimeToInstant('2026-03-08', '09:00', TZ);
  const w = currentWindow('16:8', '12:00', TZ, now);
  assert.equal(w.inFastWindow, true);
  // eat window boundaries are well-defined wall times on each side of DST
  assert.equal(localDateStringInTimezone(w.eatStart, TZ), '2026-03-08');
});

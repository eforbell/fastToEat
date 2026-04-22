'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { computeStreak } = require('../lib/streaks');
const { zonedWallTimeToInstant } = require('../lib/date-utils');

const TZ = 'America/Los_Angeles';

function fakePool(rows) {
  return {
    async query(_sql, _params) {
      return { rows };
    },
  };
}

test('empty history → zero streaks', async () => {
  const now = zonedWallTimeToInstant('2026-04-21', '09:00', TZ);
  const result = await computeStreak(fakePool([]), 1, TZ, now);
  assert.deepEqual(result, { current: 0, longest: 0, last_met_date: null });
});

test('today-in-progress (no row yet) does not break a prior streak', async () => {
  const rows = [
    { log_date: '2026-04-18', met_goal: true },
    { log_date: '2026-04-19', met_goal: true },
    { log_date: '2026-04-20', met_goal: true },
  ];
  const now = zonedWallTimeToInstant('2026-04-21', '09:00', TZ);
  const result = await computeStreak(fakePool(rows), 1, TZ, now);
  assert.equal(result.current, 3);
  assert.equal(result.longest, 3);
  assert.equal(result.last_met_date, '2026-04-20');
});

test('today met adds to streak; longest grows', async () => {
  const rows = [
    { log_date: '2026-04-18', met_goal: true },
    { log_date: '2026-04-19', met_goal: true },
    { log_date: '2026-04-20', met_goal: true },
    { log_date: '2026-04-21', met_goal: true },
  ];
  const now = zonedWallTimeToInstant('2026-04-21', '22:00', TZ);
  const result = await computeStreak(fakePool(rows), 1, TZ, now);
  assert.equal(result.current, 4);
  assert.equal(result.longest, 4);
});

test('a missed yesterday breaks the streak; longest keeps historical max', async () => {
  const rows = [
    { log_date: '2026-04-15', met_goal: true },
    { log_date: '2026-04-16', met_goal: true },
    { log_date: '2026-04-17', met_goal: true },
    { log_date: '2026-04-18', met_goal: true },
    { log_date: '2026-04-19', met_goal: false },
    { log_date: '2026-04-20', met_goal: true },
  ];
  const now = zonedWallTimeToInstant('2026-04-21', '09:00', TZ);
  const result = await computeStreak(fakePool(rows), 1, TZ, now);
  assert.equal(result.current, 1); // just 04-20
  assert.equal(result.longest, 4); // 04-15..04-18
});

test('today=false breaks streak immediately', async () => {
  const rows = [
    { log_date: '2026-04-19', met_goal: true },
    { log_date: '2026-04-20', met_goal: true },
    { log_date: '2026-04-21', met_goal: false },
  ];
  const now = zonedWallTimeToInstant('2026-04-21', '23:00', TZ);
  const result = await computeStreak(fakePool(rows), 1, TZ, now);
  assert.equal(result.current, 0);
  assert.equal(result.longest, 2);
});

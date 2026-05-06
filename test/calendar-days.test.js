'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildCalendarDays, overGoalHours } = require('../lib/calendar-days');

test('overGoalHours clamps at zero and rounds to cents', () => {
  assert.equal(overGoalHours(18.25, 16), 2.25);
  assert.equal(overGoalHours(12, 16), 0);
  assert.equal(overGoalHours(null, 16), null);
});

test('buildCalendarDays returns detail payload with super-star classification', () => {
  const days = ['2026-04-10', '2026-04-11'];
  const logRows = [
    { log_date: '2026-04-10', met_goal: true },
    { log_date: '2026-04-11', met_goal: false },
  ];
  const sessionRows = [
    {
      local_date: '2026-04-10',
      ended_at: '2026-04-10T15:15:00.000Z',
      planned_duration_hours: '16',
      actual_duration_hours: '18.25',
      met_goal: true,
      break_meal_note: 'Eggs + avocado',
    },
    {
      local_date: '2026-04-11',
      ended_at: '2026-04-11T16:00:00.000Z',
      planned_duration_hours: '16',
      actual_duration_hours: '12',
      met_goal: false,
      break_meal_note: null,
    },
  ];

  const result = buildCalendarDays(days, logRows, sessionRows);
  assert.deepEqual(result[0], {
    date: '2026-04-10',
    met_goal: true,
    star_level: 'super',
    planned_duration_hours: 16,
    actual_duration_hours: 18.25,
    over_goal_hours: 2.25,
    break_meal_note: 'Eggs + avocado',
    ended_at: '2026-04-10T15:15:00.000Z',
  });
  assert.deepEqual(result[1], {
    date: '2026-04-11',
    met_goal: false,
    star_level: 'miss',
    planned_duration_hours: 16,
    actual_duration_hours: 12,
    over_goal_hours: 0,
    break_meal_note: null,
    ended_at: '2026-04-11T16:00:00.000Z',
  });
});

test('buildCalendarDays prefers the strongest successful session when daily log session linkage is stale', () => {
  const days = ['2026-04-12'];
  const logRows = [{ log_date: '2026-04-12', met_goal: true }];
  const sessionRows = [
    {
      local_date: '2026-04-12',
      ended_at: '2026-04-12T15:00:00.000Z',
      planned_duration_hours: '16',
      actual_duration_hours: '18',
      met_goal: true,
      break_meal_note: 'Salmon bowl',
    },
    {
      local_date: '2026-04-12',
      ended_at: '2026-04-13T04:00:00.000Z',
      planned_duration_hours: '16',
      actual_duration_hours: '5.5',
      met_goal: false,
      break_meal_note: 'Late snack',
    },
  ];

  const [day] = buildCalendarDays(days, logRows, sessionRows);
  assert.equal(day.met_goal, true);
  assert.equal(day.star_level, 'super');
  assert.equal(day.actual_duration_hours, 18);
  assert.equal(day.break_meal_note, 'Salmon bowl');
});

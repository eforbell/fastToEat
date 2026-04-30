'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { zonedWallTimeToInstant } = require('../lib/date-utils');
const { evaluateCandidates } = require('../lib/reminder-candidates');

const TZ = 'America/Los_Angeles';

test('fast_complete uses actual open-session target end (not scheduled window boundary)', () => {
  const now = zonedWallTimeToInstant('2026-04-21', '15:05', TZ);
  const startedAt = zonedWallTimeToInstant('2026-04-20', '23:00', TZ);
  const member = {
    plan: '16:8',
    eat_window_start_local: '12:00',
    timezone: TZ,
    last_ended_at: null,
    open_session_started_at: startedAt.toISOString(),
    open_session_planned_hours: 16,
  };

  const candidates = evaluateCandidates(member, now);
  const fastComplete = candidates.find(c => c.event_type === 'fast_complete');

  assert.ok(fastComplete);
  assert.equal(fastComplete.payload.message, 'Your 16h fast just ended — open the app to log the break meal.');
});

test('fast_complete is not considered when there is no active open session', () => {
  const now = zonedWallTimeToInstant('2026-04-21', '12:05', TZ);
  const member = {
    plan: '16:8',
    eat_window_start_local: '12:00',
    timezone: TZ,
    last_ended_at: null,
    open_session_started_at: null,
    open_session_planned_hours: null,
  };

  const candidates = evaluateCandidates(member, now);
  const fastComplete = candidates.find(c => c.event_type === 'fast_complete');
  assert.equal(fastComplete, undefined);
});

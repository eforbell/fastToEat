'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { zonedWallTimeToInstant, localDateStringInTimezone } = require('../lib/date-utils');
const { evaluateCandidates } = require('../lib/reminder-candidates');
const { runReminderPass } = require('../lib/reminder-runner');

const TZ = 'America/Los_Angeles';

function createFakePool({ appConfigValue = 'true', members = [], statesByKey = new Map() } = {}) {
  const upserts = [];
  return {
    upserts,
    async query(sql, params) {
      if (sql.includes('FROM app_config')) {
        return { rows: [{ value: appConfigValue }] };
      }
      if (sql.includes('FROM family_members fm')) {
        return { rows: members };
      }
      if (sql.includes('FROM notification_event_state') && sql.includes('SELECT last_sent_at')) {
        const key = `${params[0]}|${params[1]}|${params[2]}`;
        const row = statesByKey.get(key);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('INSERT INTO notification_event_state')) {
        upserts.push({
          memberId: params[0],
          eventType: params[1],
          sourceKey: params[2],
          lastDeliveryAttemptAt: params[3],
          lastSentAt: params[4],
          cooldownUntil: params[5],
          status: params[6],
          errorMessage: params[7],
        });
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test pool: ${sql.slice(0, 80)}...`);
    },
  };
}

function quietLogger() {
  return { log() {}, error() {} };
}

test('runReminderPass sends fast_complete and records sent event state', async () => {
  const now = zonedWallTimeToInstant('2026-04-21', '15:05', TZ);
  const startedAt = zonedWallTimeToInstant('2026-04-20', '23:00', TZ);
  const member = {
    member_id: 101,
    target_secret: 'test-secret',
    plan: '16:8',
    eat_window_start_local: '12:00',
    timezone: TZ,
    last_ended_at: null,
    open_session_started_at: startedAt.toISOString(),
    open_session_planned_hours: 16,
  };
  const pool = createFakePool({ members: [member] });
  const sends = [];
  const deliveries = [];

  const summary = await runReminderPass({
    pool,
    sendNotification: async (target, payload) => {
      sends.push({ target, payload });
      return { status: 202 };
    },
    logNotificationDelivery: async (_pool, delivery) => {
      deliveries.push(delivery);
    },
    evaluateCandidates,
    buildNotificationOpenUrl: null,
    now,
    logger: quietLogger(),
  });

  assert.equal(summary.sent, 1);
  assert.equal(summary.errors, 0);
  assert.equal(summary.skipped, 0);
  assert.equal(sends.length, 1);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].eventType, 'fast_complete');
  assert.equal(deliveries[0].status, 'sent');
  assert.equal(pool.upserts.length, 1);
  assert.equal(pool.upserts[0].status, 'sent');
  assert.equal(pool.upserts[0].errorMessage, null);
  assert.ok(pool.upserts[0].lastSentAt instanceof Date);
});

test('runReminderPass skips candidate with active cooldown', async () => {
  const now = zonedWallTimeToInstant('2026-04-21', '15:05', TZ);
  const startedAt = zonedWallTimeToInstant('2026-04-20', '23:00', TZ);
  const sourceKey = localDateStringInTimezone(now, TZ);
  const member = {
    member_id: 102,
    target_secret: 'test-secret',
    plan: '16:8',
    eat_window_start_local: '12:00',
    timezone: TZ,
    last_ended_at: null,
    open_session_started_at: startedAt.toISOString(),
    open_session_planned_hours: 16,
  };
  const statesByKey = new Map();
  statesByKey.set(`102|fast_complete|${sourceKey}`, {
    cooldown_until: new Date(now.getTime() + 10 * 60000).toISOString(),
    last_sent_at: null,
    last_result: 'sent',
  });
  const pool = createFakePool({ members: [member], statesByKey });
  const sends = [];
  const deliveries = [];

  const summary = await runReminderPass({
    pool,
    sendNotification: async (target, payload) => {
      sends.push({ target, payload });
      return { status: 200 };
    },
    logNotificationDelivery: async (_pool, delivery) => {
      deliveries.push(delivery);
    },
    evaluateCandidates,
    buildNotificationOpenUrl: null,
    now,
    logger: quietLogger(),
  });

  assert.equal(summary.sent, 0);
  assert.equal(summary.errors, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(sends.length, 0);
  assert.equal(deliveries.length, 0);
  assert.equal(pool.upserts.length, 0);
});

test('runReminderPass logs error and persists error state when delivery fails', async () => {
  const now = zonedWallTimeToInstant('2026-04-21', '15:05', TZ);
  const startedAt = zonedWallTimeToInstant('2026-04-20', '23:00', TZ);
  const member = {
    member_id: 103,
    target_secret: 'test-secret',
    plan: '16:8',
    eat_window_start_local: '12:00',
    timezone: TZ,
    last_ended_at: null,
    open_session_started_at: startedAt.toISOString(),
    open_session_planned_hours: 16,
  };
  const pool = createFakePool({ members: [member] });
  const deliveries = [];
  const failure = new Error('brrr down');
  failure.statusCode = 503;

  const summary = await runReminderPass({
    pool,
    sendNotification: async () => { throw failure; },
    logNotificationDelivery: async (_pool, delivery) => {
      deliveries.push(delivery);
    },
    evaluateCandidates,
    buildNotificationOpenUrl: null,
    now,
    logger: quietLogger(),
  });

  assert.equal(summary.sent, 0);
  assert.equal(summary.errors, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, 'error');
  assert.equal(deliveries[0].responseStatus, 503);
  assert.equal(pool.upserts.length, 1);
  assert.equal(pool.upserts[0].status, 'error');
  assert.equal(pool.upserts[0].errorMessage, 'brrr down');
  assert.equal(pool.upserts[0].lastSentAt, null);
});

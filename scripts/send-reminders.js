#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const {
  logNotificationDelivery,
  sendBrrrNotification,
  buildNotificationOpenUrl,
} = require('../lib/notifications');
const { currentWindow, planHours } = require('../lib/fast-windows');

const DRY_RUN = process.argv.includes('--dry-run');
const WINDOW_EDGE_MINUTES = Number(process.env.REMINDER_EDGE_MINUTES || 15);
const COOLDOWN_HOURS_OK = Number(process.env.REMINDER_COOLDOWN_HOURS || 20);
const COOLDOWN_HOURS_ERR = 1;
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL || null;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function appConfig(key) {
  const { rows } = await pool.query('SELECT value FROM app_config WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

async function loadEligibleMembers() {
  const { rows } = await pool.query(`
    SELECT fm.id AS member_id, fm.name,
           fp.plan, to_char(fp.eat_window_start_local, 'HH24:MI') AS eat_window_start_local,
           fp.timezone, fp.reminders_enabled,
           mnc.target_secret, mnc.enabled AS notif_enabled
      FROM family_members fm
      JOIN fast_plans fp ON fp.member_id = fm.id
      LEFT JOIN member_notification_channels mnc
        ON mnc.member_id = fm.id AND mnc.channel_type = 'brrr'
      WHERE fp.reminders_enabled = TRUE
        AND mnc.enabled = TRUE
        AND mnc.target_secret IS NOT NULL
  `);
  return rows;
}

async function lastEventState(memberId, eventType, sourceKey) {
  const { rows } = await pool.query(`
    SELECT last_sent_at, cooldown_until, last_result
      FROM notification_event_state
      WHERE member_id = $1 AND event_type = $2 AND source_key = $3
  `, [memberId, eventType, sourceKey]);
  return rows[0] || null;
}

async function upsertEventState(memberId, eventType, sourceKey, { status, sent, cooldownHours, errorMessage = null }) {
  const now = new Date();
  const cooldownUntil = Number.isFinite(cooldownHours)
    ? new Date(now.getTime() + cooldownHours * 3600 * 1000)
    : null;
  await pool.query(`
    INSERT INTO notification_event_state
      (member_id, event_type, source_key, last_delivery_attempt_at, last_sent_at, cooldown_until, last_result, last_error, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (member_id, event_type, source_key)
    DO UPDATE SET
      last_delivery_attempt_at = EXCLUDED.last_delivery_attempt_at,
      last_sent_at = COALESCE(EXCLUDED.last_sent_at, notification_event_state.last_sent_at),
      cooldown_until = EXCLUDED.cooldown_until,
      last_result = EXCLUDED.last_result,
      last_error = EXCLUDED.last_error,
      updated_at = NOW()
  `, [memberId, eventType, sourceKey, now, sent ? now : null, cooldownUntil, status, errorMessage]);
}

function minutesBetween(a, b) { return Math.round((a.getTime() - b.getTime()) / 60000); }

function evaluateCandidates(member, now) {
  const window = currentWindow(member.plan, member.eat_window_start_local, member.timezone, now);
  const { fast } = planHours(member.plan);
  const candidates = [];

  // "eat window closing soon" — fires when we're inside the eat window and eat_end is ≤ edge minutes away
  if (window.inEatWindow) {
    const minsToClose = minutesBetween(window.eatEnd, now);
    if (minsToClose >= 0 && minsToClose <= WINDOW_EDGE_MINUTES) {
      candidates.push({
        event_type: 'eat_window_closing',
        source_key: window.todayLocalDate,
        payload: {
          title: '⏱️ Eat window closing',
          message: `Last bite in ~${minsToClose} min — ${fast}h fast starts soon.`,
          interruption_level: 'active',
          ...(APP_PUBLIC_URL ? { url: buildNotificationOpenUrl(APP_PUBLIC_URL) } : {}),
        },
      });
    }
  }

  // "fast complete" — fires once at/after planned fast end
  if (window.inFastWindow) {
    const minsPastEnd = -minutesBetween(window.fastEnd, now); // positive if we've passed fastEnd
    if (minsPastEnd >= 0 && minsPastEnd <= WINDOW_EDGE_MINUTES) {
      candidates.push({
        event_type: 'fast_complete',
        source_key: window.todayLocalDate,
        payload: {
          title: '⭐ Fast complete',
          message: `Your ${fast}h fast just ended — open the app to log the break meal.`,
          interruption_level: 'active',
          ...(APP_PUBLIC_URL ? { url: buildNotificationOpenUrl(APP_PUBLIC_URL) } : {}),
        },
      });
    }
  }

  return candidates;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const enabled = await appConfig('notifications_enabled');
  if (enabled === 'false') {
    console.log('Notifications disabled (app_config). Nothing to do.');
    return;
  }

  const members = await loadEligibleMembers();
  if (!members.length) {
    console.log('No members with enabled brrr channels.');
    return;
  }

  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const member of members) {
    const candidates = evaluateCandidates(member, now);
    for (const cand of candidates) {
      const state = await lastEventState(member.member_id, cand.event_type, cand.source_key);
      if (state?.cooldown_until && new Date(state.cooldown_until) > now) {
        skipped++;
        continue;
      }
      if (state?.last_sent_at) {
        const minsSinceSent = minutesBetween(now, new Date(state.last_sent_at));
        if (minsSinceSent < 60) { // never re-send the same (member,event,source) inside an hour
          skipped++;
          continue;
        }
      }

      if (DRY_RUN) {
        console.log(`[dry-run] member=${member.member_id} event=${cand.event_type} source=${cand.source_key}`);
        continue;
      }

      try {
        const res = await sendBrrrNotification(member.target_secret, cand.payload);
        await logNotificationDelivery(pool, {
          memberId: member.member_id,
          eventType: cand.event_type,
          sourceKey: cand.source_key,
          status: 'sent',
          responseStatus: res.status || 200,
          payload: cand.payload,
        });
        await upsertEventState(member.member_id, cand.event_type, cand.source_key, {
          status: 'sent',
          sent: true,
          cooldownHours: COOLDOWN_HOURS_OK,
        });
        sent++;
      } catch (err) {
        errors++;
        await logNotificationDelivery(pool, {
          memberId: member.member_id,
          eventType: cand.event_type,
          sourceKey: cand.source_key,
          status: 'error',
          payload: cand.payload,
          errorMessage: err.message,
          responseStatus: err.statusCode || null,
        });
        await upsertEventState(member.member_id, cand.event_type, cand.source_key, {
          status: 'error',
          sent: false,
          cooldownHours: COOLDOWN_HOURS_ERR,
          errorMessage: err.message,
        });
        console.error(`[error] member=${member.member_id} event=${cand.event_type}: ${err.message}`);
      }
    }
  }

  console.log(DRY_RUN
    ? `Dry run complete. (members=${members.length})`
    : `Reminder run complete. sent=${sent} skipped=${skipped} errors=${errors}`);
}

main()
  .catch(err => {
    console.error('Reminder run failed:', err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

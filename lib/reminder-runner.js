'use strict';

function minutesBetween(a, b) { return Math.round((a.getTime() - b.getTime()) / 60000); }

async function appConfig(pool, key) {
  const { rows } = await pool.query('SELECT value FROM app_config WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

async function loadEligibleMembers(pool) {
  const { rows } = await pool.query(`
    SELECT fm.id AS member_id, fm.name,
           fp.plan, to_char(fp.eat_window_start_local, 'HH24:MI') AS eat_window_start_local,
           fp.timezone, fp.reminders_enabled,
           mnc.target_secret, mnc.enabled AS notif_enabled,
           mwp.goal_type AS weight_goal_type,
           mwp.weekly_checkin_day,
           to_char(mwp.weekly_checkin_time_local, 'HH24:MI') AS weekly_checkin_time_local,
           mwp.weekly_reminder_enabled,
           os.started_at AS open_session_started_at,
           os.planned_duration_hours AS open_session_planned_hours,
           ls.ended_at AS last_ended_at
      FROM family_members fm
      JOIN fast_plans fp ON fp.member_id = fm.id
      LEFT JOIN member_notification_channels mnc
        ON mnc.member_id = fm.id AND mnc.channel_type = 'brrr'
      LEFT JOIN member_weight_preferences mwp
        ON mwp.member_id = fm.id
      LEFT JOIN fast_sessions os
        ON os.member_id = fm.id AND os.ended_at IS NULL
      LEFT JOIN LATERAL (
        SELECT ended_at FROM fast_sessions
        WHERE member_id = fm.id AND ended_at IS NOT NULL
        ORDER BY ended_at DESC LIMIT 1
      ) ls ON TRUE
      WHERE fp.reminders_enabled = TRUE
        AND mnc.enabled = TRUE
        AND mnc.target_secret IS NOT NULL
  `);
  return rows;
}

async function lastEventState(pool, memberId, eventType, sourceKey) {
  const { rows } = await pool.query(`
    SELECT last_sent_at, cooldown_until, last_result
      FROM notification_event_state
      WHERE member_id = $1 AND event_type = $2 AND source_key = $3
  `, [memberId, eventType, sourceKey]);
  return rows[0] || null;
}

async function upsertEventState(pool, memberId, eventType, sourceKey, { status, sent, cooldownHours, errorMessage = null }) {
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

async function runReminderPass({
  pool,
  sendNotification,
  logNotificationDelivery,
  evaluateCandidates,
  buildNotificationOpenUrl,
  now = new Date(),
  dryRun = false,
  windowEdgeMinutes = 15,
  cooldownHoursOk = 20,
  cooldownHoursErr = 1,
  appPublicUrl = null,
  appOpenPath = '',
  logger = console,
}) {
  const enabled = await appConfig(pool, 'notifications_enabled');
  if (enabled === 'false') {
    logger.log('Notifications disabled (app_config). Nothing to do.');
    return { sent: 0, skipped: 0, errors: 0, members: 0, disabled: true, dryRun };
  }

  const members = await loadEligibleMembers(pool);
  if (!members.length) {
    logger.log('No members with enabled brrr channels.');
    return { sent: 0, skipped: 0, errors: 0, members: 0, disabled: false, dryRun };
  }

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const member of members) {
    const candidates = evaluateCandidates(member, now, {
      windowEdgeMinutes,
      appPublicUrl,
      appOpenPath,
      buildNotificationOpenUrl,
    });
    for (const cand of candidates) {
      const state = await lastEventState(pool, member.member_id, cand.event_type, cand.source_key);
      if (state?.cooldown_until && new Date(state.cooldown_until) > now) {
        skipped++;
        continue;
      }
      if (state?.last_sent_at) {
        const minsSinceSent = minutesBetween(now, new Date(state.last_sent_at));
        if (minsSinceSent < 60) {
          skipped++;
          continue;
        }
      }

      if (dryRun) {
        logger.log(`[dry-run] member=${member.member_id} event=${cand.event_type} source=${cand.source_key}`);
        continue;
      }

      try {
        const res = await sendNotification(member.target_secret, cand.payload);
        await logNotificationDelivery(pool, {
          memberId: member.member_id,
          eventType: cand.event_type,
          sourceKey: cand.source_key,
          status: 'sent',
          responseStatus: res.status || 200,
          payload: cand.payload,
        });
        await upsertEventState(pool, member.member_id, cand.event_type, cand.source_key, {
          status: 'sent',
          sent: true,
          cooldownHours: cooldownHoursOk,
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
        await upsertEventState(pool, member.member_id, cand.event_type, cand.source_key, {
          status: 'error',
          sent: false,
          cooldownHours: cooldownHoursErr,
          errorMessage: err.message,
        });
        logger.error(`[error] member=${member.member_id} event=${cand.event_type}: ${err.message}`);
      }
    }
  }

  logger.log(dryRun
    ? `Dry run complete. (members=${members.length})`
    : `Reminder run complete. sent=${sent} skipped=${skipped} errors=${errors}`);

  return { sent, skipped, errors, members: members.length, disabled: false, dryRun };
}

module.exports = {
  runReminderPass,
};

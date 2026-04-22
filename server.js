'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const {
  daysInMonth,
  isValidDateOnlyString,
  isValidMonthString,
  isValidTimeOfDay,
  localDateStringInTimezone,
} = require('./lib/date-utils');
const { PLAN_HOURS, currentWindow, planHours } = require('./lib/fast-windows');
const { computeStreak } = require('./lib/streaks');
const { maskSecret } = require('./lib/notifications');

const app = express();
const PORT = Number(process.env.PORT || 3005);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DEFAULT_TIMEZONE = process.env.HOUSEHOLD_TIMEZONE || 'America/Los_Angeles';

app.use(express.json({ limit: '64kb' }));

// ── Bootstrap gate ────────────────────────────────────────────

async function bootstrapState() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM family_members');
  const members = Number(rows[0]?.count || 0);
  const needsHousehold = members === 0;
  return {
    status: needsHousehold ? 'needs_setup' : 'ready',
    app: 'fast-to-eat',
    version: '1.0.0',
    bootstrap: {
      needs_household: needsHousehold,
      needs_auth: false,
      ready: !needsHousehold,
    },
    counts: { family_members: members },
  };
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function redirectToSetupIfNeeded(req, res, target = 'setup') {
  try {
    const state = await bootstrapState();
    if (state.bootstrap.needs_household) {
      res.redirect(target);
      return true;
    }
    return false;
  } catch (err) {
    res.status(500).json({ error: err.message });
    return true;
  }
}

app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  if (req.path === '/setup' || req.path === '/setup.html') return next();
  if (req.path === '/' || req.path === '/index.html') {
    if (await redirectToSetupIfNeeded(req, res, 'setup')) return;
  }
  return next();
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── Health / bootstrap ────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'fast-to-eat', timestamp: new Date().toISOString() });
});

app.get('/api/bootstrap', async (_req, res) => {
  try { res.json(await bootstrapState()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

const BOOTSTRAP_PARENT_AVATARS = ['🧑', '👩', '👨', '🧑‍🎓'];
const BOOTSTRAP_KID_AVATARS = ['🧒', '👧', '👦'];

function normalizeBootstrapMembers(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  let parentIndex = 0;
  let kidIndex = 0;
  return input
    .map(m => ({ name: String(m?.name || '').trim(), role: m?.role === 'kid' ? 'kid' : 'parent' }))
    .filter(m => m.name)
    .filter(m => {
      const key = m.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(m => {
      const avatars = m.role === 'parent' ? BOOTSTRAP_PARENT_AVATARS : BOOTSTRAP_KID_AVATARS;
      const index = m.role === 'parent' ? parentIndex++ : kidIndex++;
      return { ...m, avatar_emoji: avatars[index % avatars.length] };
    });
}

app.post('/api/bootstrap/household', async (req, res) => {
  try {
    const state = await bootstrapState();
    if (!state.bootstrap.needs_household) {
      return res.status(409).json({ error: 'Household already initialized', code: 'household_already_initialized' });
    }
    const members = normalizeBootstrapMembers(req.body?.members);
    if (!members.length) {
      return res.status(400).json({ error: 'At least one household member is required', code: 'members_required' });
    }
    if (!members.some(m => m.role === 'parent')) {
      return res.status(400).json({ error: 'At least one parent is required', code: 'parent_required' });
    }

    const created = await withTransaction(async client => {
      const out = [];
      for (const m of members) {
        const { rows } = await client.query(
          `INSERT INTO family_members (name, role, avatar_emoji)
             VALUES ($1, $2, $3)
             RETURNING id, name, role, avatar_emoji`,
          [m.name, m.role, m.avatar_emoji]
        );
        out.push(rows[0]);
        // seed a default plan for each member (16:8, eat 12:00–20:00 in household tz)
        await client.query(
          `INSERT INTO fast_plans (member_id, plan, eat_window_start_local, timezone)
             VALUES ($1, '16:8', '12:00', $2)
             ON CONFLICT (member_id) DO NOTHING`,
          [rows[0].id, DEFAULT_TIMEZONE]
        );
      }
      await client.query(
        `INSERT INTO app_config (key, value)
           VALUES ('notifications_enabled', 'true')
           ON CONFLICT (key) DO NOTHING`
      );
      return out;
    });

    res.status(201).json({
      ok: true,
      created_members: created,
      bootstrap: (await bootstrapState()).bootstrap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Members ──────────────────────────────────────────────────

app.get('/api/members', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, role, avatar_emoji, color FROM family_members ORDER BY id`
    );
    res.json({ members: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Plan ─────────────────────────────────────────────────────

async function ensurePlan(client, memberId) {
  const { rows } = await client.query(
    `SELECT member_id, plan, to_char(eat_window_start_local, 'HH24:MI') AS eat_window_start_local,
            timezone, reminders_enabled
       FROM fast_plans WHERE member_id = $1`,
    [memberId]
  );
  if (rows[0]) return rows[0];
  const inserted = await client.query(
    `INSERT INTO fast_plans (member_id, plan, eat_window_start_local, timezone)
       VALUES ($1, '16:8', '12:00', $2)
       RETURNING member_id, plan, to_char(eat_window_start_local, 'HH24:MI') AS eat_window_start_local,
                 timezone, reminders_enabled`,
    [memberId, DEFAULT_TIMEZONE]
  );
  return inserted.rows[0];
}

app.get('/api/me/:id/plan', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad id' });
    const plan = await ensurePlan(pool, memberId);
    res.json(plan);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/me/:id/plan', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad id' });
    const { plan, eat_window_start_local, timezone, reminders_enabled } = req.body || {};
    if (plan && !PLAN_HOURS[plan]) return res.status(400).json({ error: 'plan must be 16:8 | 14:10 | 12:12' });
    if (eat_window_start_local && !isValidTimeOfDay(eat_window_start_local)) return res.status(400).json({ error: 'bad time' });
    await ensurePlan(pool, memberId);
    const { rows } = await pool.query(
      `UPDATE fast_plans SET
         plan = COALESCE($2, plan),
         eat_window_start_local = COALESCE($3::time, eat_window_start_local),
         timezone = COALESCE($4, timezone),
         reminders_enabled = COALESCE($5, reminders_enabled),
         updated_at = NOW()
       WHERE member_id = $1
       RETURNING member_id, plan, to_char(eat_window_start_local, 'HH24:MI') AS eat_window_start_local,
                 timezone, reminders_enabled`,
      [memberId, plan ?? null, eat_window_start_local ?? null, timezone ?? null,
       typeof reminders_enabled === 'boolean' ? reminders_enabled : null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Status / sessions ────────────────────────────────────────

async function loadStatus(memberId, now = new Date()) {
  const plan = await ensurePlan(pool, memberId);
  const window = currentWindow(plan.plan, plan.eat_window_start_local, plan.timezone, now);

  const { rows: openRows } = await pool.query(
    `SELECT id, started_at, planned_duration_hours
       FROM fast_sessions WHERE member_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
    [memberId]
  );
  const openSession = openRows[0] || null;

  const streak = await computeStreak(pool, memberId, plan.timezone, now);

  return {
    member_id: memberId,
    now: now.toISOString(),
    plan,
    window: {
      today_local_date: window.todayLocalDate,
      eat_start: window.eatStart.toISOString(),
      eat_end: window.eatEnd.toISOString(),
      fast_start: window.fastStart.toISOString(),
      fast_end: window.fastEnd.toISOString(),
      in_eat_window: window.inEatWindow,
      in_fast_window: window.inFastWindow,
    },
    open_session: openSession ? {
      id: openSession.id,
      started_at: openSession.started_at,
      planned_duration_hours: Number(openSession.planned_duration_hours),
    } : null,
    streak,
  };
}

app.get('/api/me/:id/status', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad id' });
    res.json(await loadStatus(memberId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fast/start', async (req, res) => {
  try {
    const memberId = Number(req.body?.member_id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad member_id' });

    const plan = await ensurePlan(pool, memberId);
    const { fast } = planHours(plan.plan);

    const { rows: openRows } = await pool.query(
      `SELECT id FROM fast_sessions WHERE member_id = $1 AND ended_at IS NULL`,
      [memberId]
    );
    if (openRows[0]) {
      return res.status(409).json({ error: 'Already fasting', code: 'fast_in_progress', session_id: openRows[0].id });
    }

    const { rows } = await pool.query(
      `INSERT INTO fast_sessions (member_id, started_at, planned_duration_hours)
         VALUES ($1, NOW(), $2)
         RETURNING id, started_at, planned_duration_hours`,
      [memberId, fast]
    );
    res.status(201).json({ ok: true, session: rows[0], status: await loadStatus(memberId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fast/end', async (req, res) => {
  try {
    const memberId = Number(req.body?.member_id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad member_id' });
    const note = req.body?.break_meal_note ? String(req.body.break_meal_note).slice(0, 500) : null;

    const result = await withTransaction(async client => {
      const plan = await ensurePlan(client, memberId);
      const { rows: openRows } = await client.query(
        `SELECT id, started_at, planned_duration_hours
           FROM fast_sessions WHERE member_id = $1 AND ended_at IS NULL
           ORDER BY started_at DESC LIMIT 1
           FOR UPDATE`,
        [memberId]
      );
      const session = openRows[0];
      if (!session) {
        const err = new Error('No fast in progress');
        err.statusCode = 409;
        err.code = 'no_fast_in_progress';
        throw err;
      }

      const now = new Date();
      const startedAt = new Date(session.started_at);
      const actualHours = (now.getTime() - startedAt.getTime()) / 3600000;
      const planned = Number(session.planned_duration_hours);
      const metGoal = actualHours >= planned;

      const { rows: updated } = await client.query(
        `UPDATE fast_sessions SET
           ended_at = $2,
           actual_duration_hours = $3,
           met_goal = $4,
           break_meal_note = COALESCE($5, break_meal_note)
         WHERE id = $1
         RETURNING id, started_at, ended_at, planned_duration_hours, actual_duration_hours, met_goal, break_meal_note`,
        [session.id, now, Number(actualHours.toFixed(2)), metGoal, note]
      );

      const logDate = localDateStringInTimezone(now, plan.timezone);
      // Upsert daily_fast_log — if this session counts, stamp met_goal=true; never downgrade an existing met_goal=true row.
      await client.query(
        `INSERT INTO daily_fast_log (member_id, log_date, session_id, met_goal)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (member_id, log_date)
           DO UPDATE SET
             session_id = EXCLUDED.session_id,
             met_goal = daily_fast_log.met_goal OR EXCLUDED.met_goal`,
        [memberId, logDate, session.id, metGoal]
      );

      return updated[0];
    });

    res.json({ ok: true, session: result, status: await loadStatus(memberId) });
  } catch (err) {
    const code = err.statusCode || 500;
    res.status(code).json({ error: err.message, code: err.code });
  }
});

// ── Calendar / streak / leaderboard ──────────────────────────

app.get('/api/me/:id/calendar', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad id' });
    const month = String(req.query.month || '');
    if (!isValidMonthString(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });

    const plan = await ensurePlan(pool, memberId);
    const days = daysInMonth(month, plan.timezone);
    const first = days[0];
    const last = days[days.length - 1];

    const { rows } = await pool.query(
      `SELECT log_date::text AS log_date, met_goal FROM daily_fast_log
         WHERE member_id = $1 AND log_date >= $2::date AND log_date <= $3::date`,
      [memberId, first, last]
    );
    const byDate = new Map(rows.map(r => [r.log_date, r.met_goal]));
    res.json({
      month,
      timezone: plan.timezone,
      days: days.map(date => ({ date, met_goal: byDate.has(date) ? Boolean(byDate.get(date)) : null })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me/:id/streak', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad id' });
    const plan = await ensurePlan(pool, memberId);
    const streak = await computeStreak(pool, memberId, plan.timezone);
    res.json(streak);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/family/leaderboard', async (_req, res) => {
  try {
    const { rows: members } = await pool.query(
      `SELECT fm.id, fm.name, fm.avatar_emoji, fp.timezone
         FROM family_members fm
         LEFT JOIN fast_plans fp ON fp.member_id = fm.id
         ORDER BY fm.id`
    );
    const board = [];
    for (const m of members) {
      const tz = m.timezone || DEFAULT_TIMEZONE;
      const s = await computeStreak(pool, m.id, tz);
      board.push({
        member_id: m.id,
        name: m.name,
        avatar_emoji: m.avatar_emoji,
        current_streak: s.current,
        longest_streak: s.longest,
      });
    }
    board.sort((a, b) => b.current_streak - a.current_streak || b.longest_streak - a.longest_streak);
    res.json({ leaderboard: board });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Notification channels ────────────────────────────────────

app.get('/api/me/:id/notifications', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad id' });
    const { rows } = await pool.query(
      `SELECT id, channel_type, target_secret, enabled
         FROM member_notification_channels
         WHERE member_id = $1 AND channel_type = 'brrr'
         LIMIT 1`,
      [memberId]
    );
    const row = rows[0];
    res.json({
      channel_type: 'brrr',
      enabled: row ? row.enabled : false,
      has_secret: Boolean(row?.target_secret),
      secret_preview: row?.target_secret ? maskSecret(row.target_secret) : null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/me/:id/notifications', async (req, res) => {
  try {
    const memberId = Number(req.params.id);
    if (!Number.isInteger(memberId) || memberId <= 0) return res.status(400).json({ error: 'bad id' });
    const enabled = Boolean(req.body?.enabled);
    const targetSecretInput = req.body?.target_secret;
    const clearSecret = req.body?.clear_secret === true;

    const { rows: existing } = await pool.query(
      `SELECT target_secret FROM member_notification_channels
         WHERE member_id = $1 AND channel_type = 'brrr'`,
      [memberId]
    );
    let newSecret = existing[0]?.target_secret || null;
    if (clearSecret) newSecret = null;
    if (typeof targetSecretInput === 'string' && targetSecretInput.trim()) {
      newSecret = targetSecretInput.trim();
    }

    await pool.query(
      `INSERT INTO member_notification_channels (member_id, channel_type, target_secret, enabled, updated_at)
         VALUES ($1, 'brrr', $2, $3, NOW())
         ON CONFLICT (member_id, channel_type)
         DO UPDATE SET target_secret = EXCLUDED.target_secret,
                       enabled = EXCLUDED.enabled,
                       updated_at = NOW()`,
      [memberId, newSecret, enabled]
    );

    res.json({
      channel_type: 'brrr',
      enabled,
      has_secret: Boolean(newSecret),
      secret_preview: newSecret ? maskSecret(newSecret) : null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Static page routes ──────────────────────────────────────

app.get('/', async (req, res) => {
  if (await redirectToSetupIfNeeded(req, res, 'setup')) return;
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/setup', async (_req, res) => {
  try {
    const state = await bootstrapState();
    if (!state.bootstrap.needs_household) return res.redirect('./');
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
  } catch (err) { res.status(500).send(err.message); }
});

app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/calendar', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'calendar.html')));
app.get('/settings', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));

app.listen(PORT, () => {
  console.log(`fast-to-eat listening on http://127.0.0.1:${PORT}`);
});

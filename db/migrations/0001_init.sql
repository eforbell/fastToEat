-- 0001_init.sql — initial schema for fastToEat.
-- Mirrors db/schema.sql verbatim so both paths converge on the same state.

CREATE TABLE IF NOT EXISTS family_members (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  role            TEXT NOT NULL CHECK (role IN ('parent', 'kid')),
  avatar_emoji    TEXT DEFAULT '👤',
  color           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_notification_channels (
  id             SERIAL PRIMARY KEY,
  member_id      INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  channel_type   TEXT NOT NULL CHECK (channel_type IN ('brrr')),
  target_secret  TEXT,
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, channel_type)
);

CREATE TABLE IF NOT EXISTS fast_plans (
  member_id              INTEGER PRIMARY KEY REFERENCES family_members(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL CHECK (plan IN ('16:8', '14:10', '12:12')),
  eat_window_start_local TIME NOT NULL DEFAULT '12:00',
  timezone               TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  reminders_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fast_sessions (
  id                      SERIAL PRIMARY KEY,
  member_id               INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  started_at              TIMESTAMPTZ NOT NULL,
  ended_at                TIMESTAMPTZ,
  planned_duration_hours  NUMERIC(4,2) NOT NULL,
  actual_duration_hours   NUMERIC(5,2),
  met_goal                BOOLEAN,
  break_meal_note         TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fast_sessions_member_started
  ON fast_sessions (member_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fast_sessions_member_open
  ON fast_sessions (member_id)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS daily_fast_log (
  member_id  INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  log_date   DATE NOT NULL,
  session_id INTEGER REFERENCES fast_sessions(id) ON DELETE SET NULL,
  met_goal   BOOLEAN NOT NULL,
  PRIMARY KEY (member_id, log_date)
);

CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id                 SERIAL PRIMARY KEY,
  member_id          INTEGER REFERENCES family_members(id) ON DELETE SET NULL,
  event_type         TEXT NOT NULL,
  source_key         TEXT,
  status             TEXT NOT NULL,
  response_status    INTEGER,
  payload_json       JSONB,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_event_state (
  member_id                 INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  event_type                TEXT NOT NULL,
  source_key                TEXT NOT NULL DEFAULT '',
  last_delivery_attempt_at  TIMESTAMPTZ,
  last_sent_at              TIMESTAMPTZ,
  cooldown_until            TIMESTAMPTZ,
  last_result               TEXT,
  last_error                TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (member_id, event_type, source_key)
);

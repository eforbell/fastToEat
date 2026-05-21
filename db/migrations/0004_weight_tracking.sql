CREATE TABLE IF NOT EXISTS member_weight_preferences (
  member_id                INTEGER PRIMARY KEY REFERENCES family_members(id) ON DELETE CASCADE,
  goal_type                TEXT NOT NULL CHECK (goal_type IN ('lose', 'maintain', 'gain')),
  goal_weight_lbs          NUMERIC(6,2),
  weekly_checkin_day       SMALLINT NOT NULL DEFAULT 1 CHECK (weekly_checkin_day >= 0 AND weekly_checkin_day <= 6),
  weekly_checkin_time_local TIME NOT NULL DEFAULT '08:00',
  weekly_reminder_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weight_checkins (
  id                 SERIAL PRIMARY KEY,
  member_id          INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  measured_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source             TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reminder')),
  weight_lbs         NUMERIC(6,2) NOT NULL CHECK (weight_lbs > 0),
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_checkins_member_measured
  ON weight_checkins (member_id, measured_at DESC);

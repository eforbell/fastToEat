'use strict';

function parseHours(value) {
  return value == null ? null : Number(value);
}

function roundHours(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function overGoalHours(actual, planned) {
  if (actual == null || planned == null) return null;
  return roundHours(Math.max(actual - planned, 0));
}

function scoreCalendarSession(session) {
  return [
    session.met_goal ? 1 : 0,
    session.over_goal_hours ?? -1,
    session.actual_duration_hours ?? -1,
    new Date(session.ended_at).getTime(),
  ];
}

function compareCalendarSessions(a, b) {
  const aScore = scoreCalendarSession(a);
  const bScore = scoreCalendarSession(b);
  for (let i = 0; i < aScore.length; i++) {
    if (aScore[i] > bScore[i]) return 1;
    if (aScore[i] < bScore[i]) return -1;
  }
  return 0;
}

function normalizeSessionRow(row) {
  const session = {
    ended_at: row.ended_at,
    planned_duration_hours: roundHours(parseHours(row.planned_duration_hours)),
    actual_duration_hours: roundHours(parseHours(row.actual_duration_hours)),
    met_goal: row.met_goal == null ? null : Boolean(row.met_goal),
    break_meal_note: row.break_meal_note || null,
  };
  session.over_goal_hours = overGoalHours(session.actual_duration_hours, session.planned_duration_hours);
  return session;
}

function buildCalendarDays(days, logRows, sessionRows) {
  const byDate = new Map(logRows.map(r => [r.log_date, r.met_goal]));
  const sessionByDate = new Map();

  for (const row of sessionRows) {
    const session = normalizeSessionRow(row);
    const current = sessionByDate.get(row.local_date);
    if (!current || compareCalendarSessions(session, current) > 0) {
      sessionByDate.set(row.local_date, session);
    }
  }

  return days.map(date => {
    const detail = sessionByDate.get(date) || null;
    const metGoal = byDate.has(date)
      ? Boolean(byDate.get(date))
      : (detail && detail.met_goal != null ? Boolean(detail.met_goal) : null);
    const star_level = metGoal === true
      ? ((detail?.over_goal_hours ?? 0) >= 2 ? 'super' : 'met')
      : (metGoal === false ? 'miss' : null);

    return {
      date,
      met_goal: metGoal,
      star_level,
      planned_duration_hours: detail?.planned_duration_hours ?? null,
      actual_duration_hours: detail?.actual_duration_hours ?? null,
      over_goal_hours: detail?.over_goal_hours ?? null,
      break_meal_note: detail?.break_meal_note ?? null,
      ended_at: detail?.ended_at ?? null,
    };
  });
}

module.exports = {
  buildCalendarDays,
  compareCalendarSessions,
  normalizeSessionRow,
  overGoalHours,
};

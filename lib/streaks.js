'use strict';

const { addDaysToDateString, localDateStringInTimezone } = require('./date-utils');

/**
 * Query daily_fast_log for a member and walk backwards from today (in their tz)
 * to compute the current consecutive-day streak and the longest historical streak.
 *
 * Today counts if met_goal=true; today-in-progress (no row yet) does not break the streak.
 */
async function computeStreak(pool, memberId, timezone, now = new Date()) {
  const todayLocal = localDateStringInTimezone(now, timezone);
  const { rows } = await pool.query(
    `SELECT log_date::text AS log_date, met_goal
       FROM daily_fast_log
       WHERE member_id = $1
       ORDER BY log_date ASC`,
    [memberId]
  );

  const byDate = new Map(rows.map(r => [r.log_date, r.met_goal]));

  // current streak: walk back day-by-day from yesterday (or today if there's a row)
  let current = 0;
  let cursor = todayLocal;
  if (byDate.get(todayLocal) === true) {
    current += 1;
    cursor = addDaysToDateString(cursor, -1);
  } else if (byDate.has(todayLocal)) {
    // present but false → broken today
    current = 0;
    return buildResult(current, rows);
  } else {
    cursor = addDaysToDateString(cursor, -1);
  }
  while (byDate.get(cursor) === true) {
    current += 1;
    cursor = addDaysToDateString(cursor, -1);
  }

  return buildResult(current, rows);
}

function buildResult(current, rows) {
  let longest = 0;
  let run = 0;
  let lastMetDate = null;
  for (const row of rows) {
    if (row.met_goal) {
      run += 1;
      if (run > longest) longest = run;
      lastMetDate = row.log_date;
    } else {
      run = 0;
    }
  }
  if (current > longest) longest = current;
  return { current, longest, last_met_date: lastMetDate };
}

module.exports = { computeStreak };

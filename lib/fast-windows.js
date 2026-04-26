'use strict';

const {
  addDaysToDateString,
  isValidTimeOfDay,
  localDateStringInTimezone,
  zonedWallTimeToInstant,
} = require('./date-utils');

const PLAN_HOURS = Object.freeze({
  '18:6':  { fast: 18, eat: 6 },
  '16:8':  { fast: 16, eat: 8 },
  '14:10': { fast: 14, eat: 10 },
  '12:12': { fast: 12, eat: 12 },
});

function planHours(plan) {
  const hours = PLAN_HOURS[plan];
  if (!hours) throw new Error(`Unknown plan: ${plan}`);
  return hours;
}

function addHoursToTime(timeStr, hours) {
  if (!isValidTimeOfDay(timeStr)) throw new Error(`Invalid time: ${timeStr}`);
  const [hh, mm] = timeStr.split(':').map(Number);
  const minutes = hh * 60 + mm + Math.round(hours * 60);
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const pad2 = n => String(n).padStart(2, '0');
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/**
 * Given a fast plan and a reference instant `now`, compute the fast/eat window instants
 * that bracket `now`. Semantics:
 *   - eat window starts at `eat_window_start_local` on a local date in `timezone`
 *   - eat window duration = PLAN_HOURS[plan].eat hours
 *   - fast window runs from previous eat-window end until next eat-window start
 *
 * Returns { todayLocalDate, eatStart, eatEnd, fastStart, fastEnd, inEatWindow, inFastWindow }.
 */
function currentWindow(plan, eatWindowStartLocal, timezone, now = new Date()) {
  const { eat } = planHours(plan);
  const todayDate = localDateStringInTimezone(now, timezone);
  const todayEatStart = zonedWallTimeToInstant(todayDate, eatWindowStartLocal, timezone);
  const todayEatEnd = new Date(todayEatStart.getTime() + eat * 3600 * 1000);

  if (now < todayEatStart) {
    // currently fasting; eat window starts later today
    const yesterday = addDaysToDateString(todayDate, -1);
    const yesterdayEatStart = zonedWallTimeToInstant(yesterday, eatWindowStartLocal, timezone);
    const yesterdayEatEnd = new Date(yesterdayEatStart.getTime() + eat * 3600 * 1000);
    return {
      todayLocalDate: todayDate,
      eatStart: todayEatStart,
      eatEnd: todayEatEnd,
      fastStart: yesterdayEatEnd,
      fastEnd: todayEatStart,
      inEatWindow: false,
      inFastWindow: true,
    };
  }

  if (now < todayEatEnd) {
    // currently in the eat window
    const yesterday = addDaysToDateString(todayDate, -1);
    const yesterdayEatStart = zonedWallTimeToInstant(yesterday, eatWindowStartLocal, timezone);
    const yesterdayEatEnd = new Date(yesterdayEatStart.getTime() + eat * 3600 * 1000);
    return {
      todayLocalDate: todayDate,
      eatStart: todayEatStart,
      eatEnd: todayEatEnd,
      fastStart: yesterdayEatEnd,
      fastEnd: todayEatStart,
      inEatWindow: true,
      inFastWindow: false,
    };
  }

  // after today's eat window closed → currently fasting toward tomorrow's eat window
  const tomorrow = addDaysToDateString(todayDate, 1);
  const tomorrowEatStart = zonedWallTimeToInstant(tomorrow, eatWindowStartLocal, timezone);
  return {
    todayLocalDate: todayDate,
    eatStart: tomorrowEatStart,
    eatEnd: new Date(tomorrowEatStart.getTime() + eat * 3600 * 1000),
    fastStart: todayEatEnd,
    fastEnd: tomorrowEatStart,
    inEatWindow: false,
    inFastWindow: true,
  };
}

function effectiveWindow(plan, eatWindowStartLocal, timezone, now = new Date(), lastEndedAt = null) {
  const scheduled = currentWindow(plan, eatWindowStartLocal, timezone, now);
  if (!lastEndedAt) return scheduled;

  const { eat } = planHours(plan);
  const endedDate = localDateStringInTimezone(lastEndedAt, timezone);
  const todayDate = localDateStringInTimezone(now, timezone);
  if (endedDate !== todayDate) return scheduled;

  if (lastEndedAt >= scheduled.eatStart) return scheduled;

  const overrideEnd = new Date(lastEndedAt.getTime() + eat * 3600 * 1000);
  if (now >= overrideEnd) {
    const tomorrow = addDaysToDateString(scheduled.todayLocalDate, 1);
    const tomorrowEatStart = zonedWallTimeToInstant(tomorrow, eatWindowStartLocal, timezone);
    return {
      todayLocalDate: scheduled.todayLocalDate,
      eatStart: tomorrowEatStart,
      eatEnd: new Date(tomorrowEatStart.getTime() + eat * 3600 * 1000),
      fastStart: overrideEnd,
      fastEnd: tomorrowEatStart,
      inEatWindow: false,
      inFastWindow: true,
    };
  }

  return {
    todayLocalDate: scheduled.todayLocalDate,
    eatStart: lastEndedAt,
    eatEnd: overrideEnd,
    fastStart: scheduled.fastStart,
    fastEnd: lastEndedAt,
    inEatWindow: true,
    inFastWindow: false,
  };
}

module.exports = {
  PLAN_HOURS,
  addHoursToTime,
  currentWindow,
  effectiveWindow,
  planHours,
};

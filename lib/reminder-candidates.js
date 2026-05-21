'use strict';

const { effectiveWindow, planHours } = require('./fast-windows');
const { localDateStringInTimezone } = require('./date-utils');

function minutesBetween(a, b) { return Math.round((a.getTime() - b.getTime()) / 60000); }

function localWeekdayAndMinutes(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.find(p => p.type === 'weekday')?.value] ?? null;
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return { weekday, minuteOfDay: (hour * 60) + minute };
}

function evaluateCandidates(member, now, options = {}) {
  const {
    windowEdgeMinutes = 15,
    appPublicUrl = null,
    buildNotificationOpenUrl = null,
    appOpenPath = '',
  } = options;

  const lastEndedAt = member.last_ended_at ? new Date(member.last_ended_at) : null;
  const window = effectiveWindow(member.plan, member.eat_window_start_local, member.timezone, now, lastEndedAt);
  const { fast } = planHours(member.plan);
  const candidates = [];

  if (window.inEatWindow) {
    const minsToClose = minutesBetween(window.eatEnd, now);
    if (minsToClose >= 0 && minsToClose <= windowEdgeMinutes) {
      const payload = {
        title: '⏱️ Eat window closing',
        message: `Last bite in ~${minsToClose} min — ${fast}h fast starts soon.`,
        interruption_level: 'active',
      };
      if (appPublicUrl && typeof buildNotificationOpenUrl === 'function') {
        payload.url = buildNotificationOpenUrl(appPublicUrl, appOpenPath);
      }
      candidates.push({
        event_type: 'eat_window_closing',
        source_key: window.todayLocalDate,
        payload,
      });
    }
  }

  if (member.open_session_started_at) {
    const startedAt = new Date(member.open_session_started_at);
    const plannedHours = Number(member.open_session_planned_hours);
    const fastTargetEnd = new Date(startedAt.getTime() + plannedHours * 3600 * 1000);
    const minsPastEnd = minutesBetween(now, fastTargetEnd);
    if (minsPastEnd >= 0 && minsPastEnd <= windowEdgeMinutes) {
      const payload = {
        title: '⭐ Fast complete',
        message: `Your ${plannedHours}h fast just ended — open the app to log the break meal.`,
        interruption_level: 'active',
      };
      if (appPublicUrl && typeof buildNotificationOpenUrl === 'function') {
        payload.url = buildNotificationOpenUrl(appPublicUrl, appOpenPath);
      }
      candidates.push({
        event_type: 'fast_complete',
        source_key: localDateStringInTimezone(now, member.timezone),
        payload,
      });
    }
  }

  if (member.weight_goal_type && member.weekly_reminder_enabled) {
    const { weekday, minuteOfDay } = localWeekdayAndMinutes(now, member.timezone);
    const targetDay = Number(member.weekly_checkin_day ?? 1);
    const [hh, mm] = String(member.weekly_checkin_time_local || '08:00').split(':');
    const targetMinuteOfDay = (Number(hh) * 60) + Number(mm);
    if (weekday === targetDay && Math.abs(minuteOfDay - targetMinuteOfDay) <= windowEdgeMinutes) {
      const payload = {
        title: '⚖️ Weekly weigh-in',
        message: 'Quick check-in time: log your current weight in Fast to Eat.',
        interruption_level: 'active',
      };
      if (appPublicUrl && typeof buildNotificationOpenUrl === 'function') {
        payload.url = buildNotificationOpenUrl(appPublicUrl, `${appOpenPath.replace(/\/+$/, '')}/progress`);
      }
      candidates.push({
        event_type: 'weekly_weight_checkin',
        source_key: localDateStringInTimezone(now, member.timezone),
        payload,
      });
    }
  }

  return candidates;
}

module.exports = {
  evaluateCandidates,
};

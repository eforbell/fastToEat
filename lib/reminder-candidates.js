'use strict';

const { effectiveWindow, planHours } = require('./fast-windows');
const { localDateStringInTimezone } = require('./date-utils');

function minutesBetween(a, b) { return Math.round((a.getTime() - b.getTime()) / 60000); }

function evaluateCandidates(member, now, options = {}) {
  const {
    windowEdgeMinutes = 15,
    appPublicUrl = null,
    buildNotificationOpenUrl = null,
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
        payload.url = buildNotificationOpenUrl(appPublicUrl);
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
        payload.url = buildNotificationOpenUrl(appPublicUrl);
      }
      candidates.push({
        event_type: 'fast_complete',
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

'use strict';

let currentMember = null;
let currentMonth = null;
let currentDays = [];
let currentTimezone = 'UTC';
let selectedDate = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentMember = loadMember();
  if (!currentMember) return window.location.replace('login');

  const now = new Date();
  currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  document.getElementById('prev-month').addEventListener('click', () => shift(-1));
  document.getElementById('next-month').addEventListener('click', () => shift(1));

  await render();
});

function loadMember() {
  try {
    const raw = localStorage.getItem('fte_member');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : null;
  } catch { return null; }
}

function shift(delta) {
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  currentMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  render();
}

async function render() {
  const status = document.getElementById('cal-status');
  const grid = document.getElementById('cal');
  const label = document.getElementById('month-label');
  status.textContent = '';
  status.classList.remove('error');
  grid.innerHTML = '';

  label.textContent = formatMonthLabel(currentMonth);

  try {
    const res = await fetch(`api/me/${currentMember.id}/calendar?month=${currentMonth}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load');
    currentDays = data.days || [];
    currentTimezone = data.timezone || 'UTC';

    const todayIso = new Date().toISOString().slice(0, 10);
    const dows = ['S','M','T','W','T','F','S'];
    for (const dow of dows) {
      const el = document.createElement('div');
      el.className = 'dow';
      el.textContent = dow;
      grid.appendChild(el);
    }

    if (!currentDays.length) {
      renderDayDetail(null);
      return;
    }
    const [y, m] = currentMonth.split('-').map(Number);
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    for (let i = 0; i < firstDow; i++) {
      const spacer = document.createElement('div');
      grid.appendChild(spacer);
    }

    for (const day of currentDays) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'day';
      const dayNum = Number(day.date.slice(-2));
      if (day.met_goal === true) el.classList.add('met');
      if (day.met_goal === false) el.classList.add('miss');
      if (day.star_level === 'super') el.classList.add('super');
      if (day.date === todayIso) el.classList.add('today');
      if (day.date === selectedDate) el.classList.add('selected');
      el.dataset.date = day.date;
      el.innerHTML = `
        <span>${dayNum}</span>
        <span class="star">${starGlyph(day)}</span>
      `;
      el.addEventListener('click', () => {
        selectedDate = day.date;
        renderDayDetail(day);
        updateSelectedDayButtons();
      });
      grid.appendChild(el);
    }

    if (!selectedDate) {
      renderDayDetail(null);
    } else {
      renderDayDetail(currentDays.find(day => day.date === selectedDate) || null);
    }
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
    renderDayDetail(null);
  }
}

function updateSelectedDayButtons() {
  document.querySelectorAll('#cal .day[data-date]').forEach(el => {
    el.classList.toggle('selected', el.dataset.date === selectedDate);
  });
}

function starGlyph(day) {
  if (day.star_level === 'super') return '🌟';
  if (day.met_goal === true) return '⭐';
  if (day.met_goal === false) return '·';
  return '';
}

function renderDayDetail(day) {
  const title = document.getElementById('day-detail-title');
  const badge = document.getElementById('day-detail-badge');
  const empty = document.getElementById('day-detail-empty');
  const body = document.getElementById('day-detail-body');
  const noteWrap = document.getElementById('day-detail-note-wrap');

  if (!day) {
    title.textContent = 'Tap a day to inspect';
    badge.className = 'day-detail-badge hidden';
    empty.textContent = 'Tap any starred day to see fast length, over-goal streak strength, and any break-meal note.';
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    noteWrap.classList.add('hidden');
    return;
  }

  title.textContent = formatDayLabel(day.date);
  badge.className = `day-detail-badge${day.star_level ? ` ${day.star_level}` : ''}`;
  badge.textContent = badgeText(day);
  badge.classList.toggle('hidden', !day.star_level);

  const hasSession = day.actual_duration_hours != null || day.planned_duration_hours != null || day.ended_at || day.break_meal_note;
  if (!hasSession) {
    empty.textContent = day.met_goal === false
      ? 'Missed day logged, but no session detail is available.'
      : 'No completed fast details logged for this day.';
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    noteWrap.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  body.classList.remove('hidden');
  document.getElementById('day-detail-actual').textContent = formatHours(day.actual_duration_hours);
  document.getElementById('day-detail-goal').textContent = formatHours(day.planned_duration_hours);
  document.getElementById('day-detail-over').textContent = day.over_goal_hours != null
    ? (day.over_goal_hours > 0 ? `+${formatHours(day.over_goal_hours)}` : '—')
    : '—';
  document.getElementById('day-detail-ended').textContent = day.ended_at
    ? formatDateTime(day.ended_at, currentTimezone)
    : '—';

  if (day.break_meal_note) {
    noteWrap.classList.remove('hidden');
    document.getElementById('day-detail-note').textContent = day.break_meal_note;
  } else {
    noteWrap.classList.add('hidden');
    document.getElementById('day-detail-note').textContent = '';
  }
}

function formatMonthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatDayLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatHours(value) {
  if (value == null) return '—';
  const rounded = Math.round(Number(value) * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}h`;
}

function formatDateTime(isoString, timezone) {
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function badgeText(day) {
  if (day.star_level === 'super') return '🌟 Super star';
  if (day.star_level === 'met') return '⭐ Goal met';
  if (day.star_level === 'miss') return '· Missed';
  return '';
}

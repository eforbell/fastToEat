'use strict';

let currentMember = null;
let currentStatus = null;
let tickTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentMember = loadMember();
  if (!currentMember) return window.location.replace('login');

  document.getElementById('greeting').textContent = `⏱️ Hi, ${currentMember.name}`;
  document.getElementById('action-btn').addEventListener('click', handleAction);
  document.getElementById('switch-user').addEventListener('click', () => {
    localStorage.removeItem('fte_member');
    window.location.replace('login');
  });

  await refreshStatus();
  await refreshLeaderboard();
  tickTimer = setInterval(tick, 1000);
});

function loadMember() {
  try {
    const raw = localStorage.getItem('fte_member');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : null;
  } catch { return null; }
}

async function refreshStatus() {
  try {
    const res = await fetch(`api/me/${currentMember.id}/status`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    currentStatus = await res.json();
    renderStatus();
  } catch (err) {
    setStatus(err.message, true);
  }
}

function renderStatus() {
  const btn = document.getElementById('action-btn');
  const label = document.getElementById('state-label');
  const target = document.getElementById('target-line');
  const streakBadge = document.getElementById('streak-badge');
  const streakCount = document.getElementById('streak-count');

  if (currentStatus.streak && currentStatus.streak.current > 0) {
    streakBadge.classList.remove('hidden');
    streakCount.textContent = currentStatus.streak.current;
  } else {
    streakBadge.classList.add('hidden');
  }

  btn.classList.remove('hidden');

  if (currentStatus.open_session) {
    const started = new Date(currentStatus.open_session.started_at);
    const plannedEnd = new Date(started.getTime() + currentStatus.open_session.planned_duration_hours * 3600 * 1000);
    label.textContent = 'Fasting';
    target.textContent = `Target end: ${formatLocalTime(plannedEnd, currentStatus.plan.timezone)} · Plan ${currentStatus.plan.plan}`;
    btn.textContent = 'End fast';
    btn.dataset.mode = 'end';
  } else {
    label.textContent = currentStatus.window.in_eat_window ? 'Eating window open' : 'Not fasting';
    const nextBoundary = currentStatus.window.in_eat_window
      ? new Date(currentStatus.window.eat_end)
      : new Date(currentStatus.window.eat_start);
    target.textContent = currentStatus.window.in_eat_window
      ? `Eat window closes at ${formatLocalTime(nextBoundary, currentStatus.plan.timezone)} · Plan ${currentStatus.plan.plan}`
      : `Next eat window opens at ${formatLocalTime(nextBoundary, currentStatus.plan.timezone)} · Plan ${currentStatus.plan.plan}`;
    btn.textContent = 'Start fast';
    btn.dataset.mode = 'start';
  }

  tick();
}

function tick() {
  if (!currentStatus) return;
  const countdown = document.getElementById('countdown');
  let targetMs;
  if (currentStatus.open_session) {
    const started = new Date(currentStatus.open_session.started_at).getTime();
    const plannedEnd = started + currentStatus.open_session.planned_duration_hours * 3600 * 1000;
    targetMs = plannedEnd;
  } else if (currentStatus.window.in_eat_window) {
    targetMs = new Date(currentStatus.window.eat_end).getTime();
  } else {
    targetMs = new Date(currentStatus.window.eat_start).getTime();
  }
  const remaining = targetMs - Date.now();
  countdown.textContent = formatDuration(remaining);
}

function formatDuration(ms) {
  const sign = ms < 0 ? '-' : '';
  const total = Math.floor(Math.abs(ms) / 1000);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return `${sign}${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function formatLocalTime(date, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

async function handleAction() {
  const btn = document.getElementById('action-btn');
  const mode = btn.dataset.mode;
  btn.disabled = true;

  try {
    if (mode === 'start') {
      const res = await fetch('api/fast/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: currentMember.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start fast');
      currentStatus = data.status;
      setStatus('Fast started. Good luck.', false);
      renderStatus();
    } else if (mode === 'end') {
      const note = document.getElementById('break-meal-note').value.trim();
      const res = await fetch('api/fast/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: currentMember.id, break_meal_note: note || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not end fast');
      currentStatus = data.status;
      const met = data.session.met_goal;
      setStatus(met
        ? `Fast complete (${Number(data.session.actual_duration_hours).toFixed(1)}h). Goal met. ⭐`
        : `Fast ended early (${Number(data.session.actual_duration_hours).toFixed(1)}h). No star today.`,
        false);
      document.getElementById('break-meal-note').value = '';
      renderStatus();
      await refreshLeaderboard();
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function setStatus(message, isError) {
  const el = document.getElementById('action-status');
  el.textContent = message;
  el.classList.toggle('error', !!isError);
}

async function refreshLeaderboard() {
  try {
    const res = await fetch('api/family/leaderboard', { cache: 'no-store' });
    const data = await res.json();
    const rows = data.leaderboard || [];
    document.getElementById('leaderboard').innerHTML = rows.map((r, i) => `
      <div class="board-row">
        <span class="rank">${i + 1}.</span>
        <span class="avatar">${r.avatar_emoji || '👤'}</span>
        <span class="name">${escapeHtml(r.name)}</span>
        <span class="streak">${r.current_streak} ⭐</span>
      </div>
    `).join('') || '<p class="muted">No members yet.</p>';
  } catch {
    document.getElementById('leaderboard').innerHTML = '<p class="muted">Could not load board.</p>';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

'use strict';

let currentMember = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentMember = loadMember();
  if (!currentMember) return window.location.replace('login');

  document.getElementById('save-goal').addEventListener('click', saveGoal);
  document.getElementById('add-weight').addEventListener('click', addWeight);
  document.getElementById('range').addEventListener('change', loadCheckins);

  await loadGoal();
  await loadCheckins();
});

function loadMember() {
  try {
    const raw = localStorage.getItem('fte_member');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : null;
  } catch { return null; }
}

async function loadGoal() {
  const res = await fetch(`api/me/${currentMember.id}/weight-goal`, { cache: 'no-store' });
  const data = await res.json();
  if (!data.goal) return;
  document.getElementById('goal-type').value = data.goal.goal_type;
  document.getElementById('goal-weight').value = data.goal.goal_weight_lbs || '';
  document.getElementById('checkin-day').value = data.goal.weekly_checkin_day;
  document.getElementById('checkin-time').value = data.goal.weekly_checkin_time_local;
}

async function saveGoal() {
  const status = document.getElementById('goal-status');
  try {
    const body = {
      goal_type: document.getElementById('goal-type').value,
      goal_weight_lbs: document.getElementById('goal-weight').value || null,
      weekly_checkin_day: Number(document.getElementById('checkin-day').value),
      weekly_checkin_time_local: document.getElementById('checkin-time').value,
      weekly_reminder_enabled: true,
    };
    const res = await fetch(`api/me/${currentMember.id}/weight-goal`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save goal');
    status.textContent = 'Goal saved.';
    status.classList.remove('error');
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }
}

async function addWeight() {
  const status = document.getElementById('weight-status');
  try {
    const weight = Number(document.getElementById('weight-input').value);
    const res = await fetch(`api/me/${currentMember.id}/weight-checkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight_lbs: weight }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to record weight');
    document.getElementById('weight-input').value = '';
    status.textContent = 'Weight recorded.';
    status.classList.remove('error');
    await loadCheckins();
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }
}

async function loadCheckins() {
  const range = document.getElementById('range').value;
  const res = await fetch(`api/me/${currentMember.id}/weight-checkins?range=${encodeURIComponent(range)}`, { cache: 'no-store' });
  const data = await res.json();
  renderChart(data.checkins || []);
}

function renderChart(checkins) {
  const chart = document.getElementById('chart');
  const empty = document.getElementById('chart-empty');
  if (!checkins.length) {
    chart.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const minW = Math.min(...checkins.map(c => Number(c.weight_lbs)));
  const maxW = Math.max(...checkins.map(c => Number(c.weight_lbs)));
  const minT = new Date(checkins[0].measured_at).getTime();
  const maxT = new Date(checkins[checkins.length - 1].measured_at).getTime();
  const spanW = Math.max(1, maxW - minW);
  const spanT = Math.max(1, maxT - minT);

  const points = checkins.map(c => {
    const t = new Date(c.measured_at).getTime();
    const x = 16 + ((t - minT) / spanT) * 288;
    const y = 124 - ((Number(c.weight_lbs) - minW) / spanW) * 108;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  chart.innerHTML = `
    <line x1="16" y1="124" x2="304" y2="124" stroke="var(--border)" />
    <line x1="16" y1="16" x2="16" y2="124" stroke="var(--border)" />
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${points}" />
  `;
}

'use strict';

let currentMember = null;
let currentMonth = null;

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
  grid.innerHTML = '';

  label.textContent = formatMonthLabel(currentMonth);

  try {
    const res = await fetch(`api/me/${currentMember.id}/calendar?month=${currentMonth}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load');

    const todayIso = new Date().toISOString().slice(0, 10);
    const dows = ['S','M','T','W','T','F','S'];
    for (const dow of dows) {
      const el = document.createElement('div');
      el.className = 'dow';
      el.textContent = dow;
      grid.appendChild(el);
    }

    if (!data.days.length) return;
    const [y, m] = currentMonth.split('-').map(Number);
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    for (let i = 0; i < firstDow; i++) {
      const spacer = document.createElement('div');
      grid.appendChild(spacer);
    }

    for (const day of data.days) {
      const el = document.createElement('div');
      el.className = 'day';
      const dayNum = Number(day.date.slice(-2));
      if (day.met_goal === true) el.classList.add('met');
      if (day.met_goal === false) el.classList.add('miss');
      if (day.date === todayIso) el.classList.add('today');
      el.innerHTML = `
        <span>${dayNum}</span>
        <span class="star">${day.met_goal === true ? '⭐' : (day.met_goal === false ? '·' : '')}</span>
      `;
      grid.appendChild(el);
    }
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }
}

function formatMonthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

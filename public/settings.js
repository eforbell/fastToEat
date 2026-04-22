'use strict';

let currentMember = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentMember = loadMember();
  if (!currentMember) return window.location.replace('login');

  document.getElementById('save-plan').addEventListener('click', savePlan);
  document.getElementById('save-notif').addEventListener('click', () => saveNotifications(false));
  document.getElementById('clear-notif').addEventListener('click', () => saveNotifications(true));

  await Promise.all([loadPlan(), loadNotifications()]);
});

function loadMember() {
  try {
    const raw = localStorage.getItem('fte_member');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : null;
  } catch { return null; }
}

async function loadPlan() {
  const res = await fetch(`api/me/${currentMember.id}/plan`, { cache: 'no-store' });
  const data = await res.json();
  document.getElementById('plan').value = data.plan;
  document.getElementById('eat-start').value = data.eat_window_start_local;
  document.getElementById('timezone').value = data.timezone;
  document.getElementById('reminders-enabled').checked = data.reminders_enabled;
}

async function savePlan() {
  const status = document.getElementById('plan-status');
  try {
    const body = {
      plan: document.getElementById('plan').value,
      eat_window_start_local: document.getElementById('eat-start').value,
      timezone: document.getElementById('timezone').value.trim() || 'America/Los_Angeles',
      reminders_enabled: document.getElementById('reminders-enabled').checked,
    };
    const res = await fetch(`api/me/${currentMember.id}/plan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    status.textContent = 'Saved.';
    status.classList.remove('error');
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }
}

async function loadNotifications() {
  const res = await fetch(`api/me/${currentMember.id}/notifications`, { cache: 'no-store' });
  const data = await res.json();
  document.getElementById('secret-preview').textContent = data.has_secret
    ? `Saved secret: ${data.secret_preview}`
    : 'No brrr secret saved.';
  // Don't overwrite user typing
}

async function saveNotifications(clear) {
  const status = document.getElementById('notif-status');
  const secretInput = document.getElementById('brrr-secret');
  try {
    const body = {
      enabled: !clear && Boolean(secretInput.value.trim() || await hasExistingSecret()),
      target_secret: clear ? null : secretInput.value.trim() || undefined,
      clear_secret: clear,
    };
    const res = await fetch(`api/me/${currentMember.id}/notifications`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    secretInput.value = '';
    document.getElementById('secret-preview').textContent = data.has_secret
      ? `Saved secret: ${data.secret_preview} (${data.enabled ? 'enabled' : 'disabled'})`
      : 'No brrr secret saved.';
    status.textContent = clear ? 'Secret cleared.' : 'Saved.';
    status.classList.remove('error');
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }
}

async function hasExistingSecret() {
  const res = await fetch(`api/me/${currentMember.id}/notifications`, { cache: 'no-store' });
  const data = await res.json();
  return Boolean(data.has_secret);
}

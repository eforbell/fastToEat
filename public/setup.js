'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('setup-submit').addEventListener('click', submit);
  await refreshState();
});

async function refreshState() {
  const el = document.getElementById('setup-status');
  try {
    const res = await fetch('api/bootstrap', { cache: 'no-store' });
    const data = await res.json();
    if (!data?.bootstrap?.needs_household) {
      window.location.replace('.');
      return;
    }
    el.textContent = 'This install needs a household before anyone can track fasts.';
  } catch {
    el.textContent = 'Could not check setup state.';
    el.classList.add('error');
  }
}

function splitNames(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function submit() {
  const p1 = document.getElementById('setup-parent-1').value.trim();
  const p2 = document.getElementById('setup-parent-2').value.trim();
  const kids = splitNames(document.getElementById('setup-kids').value);
  const btn = document.getElementById('setup-submit');
  const status = document.getElementById('setup-submit-status');

  const members = [];
  if (p1) members.push({ name: p1, role: 'parent' });
  if (p2) members.push({ name: p2, role: 'parent' });
  for (const k of kids) members.push({ name: k, role: 'kid' });

  if (!p1) return setStatus(status, 'Enter at least one parent name.', true);

  btn.disabled = true;
  btn.textContent = 'Creating…';
  setStatus(status, 'Creating household…', false);

  try {
    const res = await fetch('api/bootstrap/household', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create household');

    const firstParent = (data.created_members || []).find(m => m.role === 'parent') || data.created_members?.[0];
    if (firstParent) localStorage.setItem('fte_member', JSON.stringify(firstParent));

    setStatus(status, 'Created. Opening Fast to Eat…', false);
    setTimeout(() => window.location.replace('.'), 300);
  } catch (err) {
    setStatus(status, err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create household';
  }
}

function setStatus(el, msg, isError) {
  el.textContent = msg;
  el.classList.remove('hidden', 'error');
  if (isError) el.classList.add('error');
}

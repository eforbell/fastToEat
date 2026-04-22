'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('members');
  const status = document.getElementById('login-status');
  try {
    const res = await fetch('api/members', { cache: 'no-store' });
    const data = await res.json();
    const members = data.members || [];
    if (!members.length) {
      status.textContent = 'No household members yet. Redirecting to setup…';
      setTimeout(() => window.location.replace('setup'), 500);
      return;
    }
    container.innerHTML = members.map(m => `
      <button class="member-card" data-id="${m.id}" type="button">
        <span class="avatar">${m.avatar_emoji || '👤'}</span>
        <span class="name">${escapeHtml(m.name)}</span>
        <span class="role">${m.role}</span>
      </button>
    `).join('');
    container.addEventListener('click', e => {
      const btn = e.target.closest('.member-card');
      if (!btn) return;
      const member = members.find(m => String(m.id) === btn.dataset.id);
      if (!member) return;
      localStorage.setItem('fte_member', JSON.stringify(member));
      window.location.replace('.');
    });
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

'use strict';

(function () {
  const active = document.body.dataset.navPage;
  if (!active) return;

  const items = [
    { id: 'today',    label: 'Today',    path: '',         icon: '🍽️' },
    { id: 'calendar', label: 'Calendar', path: 'calendar', icon: '⭐' },
    { id: 'board',    label: 'Family',   path: '#board',   icon: '👪' },
    { id: 'settings', label: 'Settings', path: 'settings', icon: '⚙️' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.setAttribute('aria-label', 'Primary');
  nav.innerHTML = items.map(i => {
    const href = i.path.startsWith('#') ? i.path : (i.path || '.');
    return `<a href="${href}" class="${i.id === active ? 'active' : ''}">
      <span class="icon">${i.icon}</span>
      <span>${i.label}</span>
    </a>`;
  }).join('');
  document.body.appendChild(nav);
})();

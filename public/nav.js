'use strict';

(function () {
  const active = document.body.dataset.navPage;
  if (!active) return;

  const items = [
    { id: 'today',    label: 'Today',    path: '',         icon: '🍽️' },
    { id: 'calendar', label: 'Calendar', path: 'calendar', icon: '⭐' },
    { id: 'progress', label: 'Progress', path: 'progress', icon: '⚖️' },
    { id: 'more',     label: 'More',     path: '#',        icon: '⋯' },
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

  const moreLink = nav.querySelector('a:last-child');
  const menu = document.createElement('div');
  menu.className = 'nav-more-menu hidden';
  menu.innerHTML = `
    <a href="./#board">👪 Family board</a>
    <a href="settings">⚙️ Settings</a>
  `;
  document.body.appendChild(menu);
  moreLink.addEventListener('click', (ev) => {
    ev.preventDefault();
    menu.classList.toggle('hidden');
  });
  document.addEventListener('click', (ev) => {
    if (menu.contains(ev.target) || ev.target === moreLink || moreLink.contains(ev.target)) return;
    menu.classList.add('hidden');
  });
})();

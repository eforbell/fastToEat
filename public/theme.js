'use strict';

const THEME_STORAGE_KEY = 'fte_theme';

function preferredTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f6f1eb' : '#0f0f0f');
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
    btn.textContent = next === 'light' ? '🌙' : '☀️';
    btn.setAttribute('aria-label', next === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  });
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || preferredTheme();
  const next = current === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
}

window.addEventListener('DOMContentLoaded', () => {
  applyTheme(preferredTheme());
  document.querySelectorAll('[data-theme-toggle]').forEach(b => b.addEventListener('click', toggleTheme));
});

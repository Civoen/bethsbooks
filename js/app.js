// Beth's Books — app shell, router and boot.
import * as store from './store.js';
import { I, esc } from './util.js';
import { openSheet, closeSheet, toast, sheetOpen } from './ui.js';
import home from './views/home.js';
import books from './views/books.js';
import detail from './views/detail.js';
import form from './views/form.js';
import stats from './views/stats.js';
import more from './views/more.js';

const routes = [
  [/^\/?$|^\/home$/, home, 'home'],
  [/^\/books$/, books, 'books'],
  [/^\/book\/([^/]+)$/, detail, 'books'],
  [/^\/shelf\/([^/]+)$/, books, 'books'],
  [/^\/add$/, form, 'add'],
  [/^\/edit\/([^/]+)$/, form, 'books'],
  [/^\/stats$/, stats, 'stats'],
  [/^\/(more|genres|shelves|data)$/, more, 'more'],
];

const main = document.getElementById('main');
let active = null; // { view, params, tab }

export function navigate(path) { location.hash = '#' + path; }

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  for (const [re, view, tab] of routes) {
    const m = path.match(re);
    if (m) return { view, params: m.slice(1), query, path, tab };
  }
  return { view: home, params: [], query, path: '/', tab: 'home' };
}

function render(scrollTop = true) {
  const r = parse();
  if (active && active.view.leave) active.view.leave();
  active = r;
  r.host = document.createElement('div');
  main.replaceChildren(r.host);
  r.view.render(r.host, r);
  setNav(r.tab);
  if (scrollTop) window.scrollTo(0, 0);
  const h = main.querySelector('h1');
  document.title = h ? `${h.textContent.trim()} · Beth's Books` : "Beth's Books";
}

function rerender() {
  if (!active) return;
  if (active.view.live === false) return;             // forms keep their own state
  if (active.view.update) { active.view.update(active.host, active); return; }
  const y = window.scrollY;
  const focusId = document.activeElement?.id;
  active.host = document.createElement('div');
  main.replaceChildren(active.host);
  active.view.render(active.host, active);
  window.scrollTo(0, y);
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}

function setNav(tab) {
  document.querySelectorAll('.nav [data-tab]').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function buildNav() {
  const nav = document.getElementById('nav');
  const item = (tab, href, icon, label) => `<a class="nav-item" href="#${href}" data-tab="${tab}">${icon}<span>${label}</span></a>`;
  nav.innerHTML = item('home', '/home', I.home, 'Home') + item('books', '/books', I.books, 'Books') +
    `<button class="nav-add" type="button" aria-label="Add a book" id="nav-add">${I.plus}</button>` +
    item('stats', '/stats', I.stats, 'Stats') + item('more', '/more', I.more, 'More');
  document.getElementById('nav-add').addEventListener('click', openAddMenu);
}

export function openAddMenu() {
  const opt = (a, icon, title, sub) => `<button class="menu-item" data-a="${a}"><span class="ic">${icon}</span><span class="tx"><b>${title}</b><span>${sub}</span></span><span class="chev">${I.chev}</span></button>`;
  openSheet({
    title: 'Add a book',
    body: `<div class="menu">${opt('search', I.search, 'Search for a book', 'Check your library, then look it up online')}${opt('manual', I.pen, 'Enter manually', 'Type in the title and author')}</div>`,
    onMount: el => el.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'search') closeSheet('/add?mode=search');
      if (a === 'manual') closeSheet('/add');
    }),
  });
}

// ---------- Theme ----------
export function applyTheme() {
  const t = store.state.settings.theme;
  try { localStorage.setItem('bb-theme', t || 'system'); } catch {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#111613' : '#EEF1EA');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Install prompt ----------
export let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (active?.tab === 'more') rerender(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast("Beth's Books is installed"); });
export async function promptInstall() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null; rerender();
  return true;
}

// ---------- Boot ----------
async function boot() {
  try {
    await store.load();
  } catch (e) {
    console.error(e);
  }
  applyTheme();
  buildNav();
  store.onChange(() => { applyTheme(); rerender(); });
  window.__bbNav = 0;
  window.addEventListener('hashchange', () => {
    window.__bbNav++;
    const prev = active;
    const keep = prev && prev.tab === 'books' && /^#\/(book\/|books)/.test(location.hash) && matchMedia('(min-width: 900px)').matches;
    render(!keep);
  });
  render();
  const splash = document.getElementById('splash');
  splash.classList.add('gone');
  setTimeout(() => splash.remove(), 400);
  if (!store.isPersistent()) {
    toast("This browser isn't letting Beth's Books save. Changes will be lost when you close it.", { timeout: 9000 });
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready', { action: 'Refresh', onAction: () => location.reload(), timeout: 10000 });
          }
        });
      });
    }).catch(() => {});
  }
}
boot();

export { esc };

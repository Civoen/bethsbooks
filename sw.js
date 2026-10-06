// Beth's Books service worker — makes the app open and work fully offline.
const VERSION = 'bb-v1.6.0';
const SHELL = [
  './', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/store.js', './js/ui.js', './js/util.js', './js/sync.js', './js/syncui.js', './js/covers.js', './js/share.js', './js/incoming.js', './js/fx.js', './js/polish.js',
  './js/views/home.js', './js/views/books.js', './js/views/detail.js', './js/views/form.js',
  './js/views/stats.js', './js/views/scan.js', './js/views/more.js', './js/views/io.js',
  './vendor/xlsx.full.min.js',
  './fonts/figtree-latin-400-normal.woff2', './fonts/figtree-latin-500-normal.woff2',
  './fonts/figtree-latin-600-normal.woff2', './fonts/figtree-latin-700-normal.woff2',
  './fonts/newsreader-latin-500-normal.woff2', './fonts/newsreader-latin-500-italic.woff2',
  './fonts/newsreader-latin-600-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-64.png',
];
const COVERS = 'bb-covers';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== COVERS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  const scope = new URL(self.registration.scope).pathname;
  if (url.origin === location.origin && url.pathname.startsWith(scope + 'api/')) return; // sync API: never cached
  const isApp = url.pathname === scope || url.pathname === scope + 'index.html';

  // Anything outside the app shell (e.g. the /x importer): network first, cache as a fallback.
  if (url.origin === location.origin && !isApp && (req.mode === 'navigate' || url.pathname.startsWith(scope + 'x/'))) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // App pages: serve the cached shell, refresh it in the background.
  if (req.mode === 'navigate' && url.origin === location.origin) {
    // Cloudflare Pages redirects /index.html to /, so the shell is cached under './'.
    e.respondWith(caches.match('./').then(cached => {
      const fresh = fetch(scope).then(res => { if (res.ok && !res.redirected) caches.open(VERSION).then(c => c.put('./', res.clone())); return res; }).catch(() => cached);
      return cached || fresh;
    }));
    return;
  }

  // Own files: cache first, then network (and remember it).
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => cached || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Book covers from Open Library: keep a copy so they show offline.
  if (url.hostname === 'covers.openlibrary.org' || url.hostname.endsWith('.archive.org') || url.hostname === 'books.google.com' || url.hostname.endsWith('.googleusercontent.com')) {
    e.respondWith(caches.open(COVERS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }
      catch { return hit || Response.error(); }
    }));
  }
  // Everything else (e.g. online book search) goes straight to the network.
});

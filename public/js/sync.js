// Sync with the Beth's Books server (Cloudflare Pages Function + D1).
// The app stays fully usable offline; changes queue up and are sent when a connection is back.
import * as db from './db.js';
import * as store from './store.js';

const CFG_KEY = 'bb-sync';
const API = new URL('../api/sync', import.meta.url).href;

export const status = { state: 'off', lastSync: null, message: '' }; // off | idle | syncing | offline | error | unauthorised
const listeners = new Set();
export const onStatus = (fn) => listeners.add(fn);
const setStatus = (patch) => { Object.assign(status, patch); listeners.forEach(fn => fn(status)); };

export function config() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; } }
function saveConfig(c) { try { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); } catch {} }
export const enabled = () => !!config()?.key;

/** Check a sync key against the server. Returns { ok, books } or { ok:false, reason }. */
export async function verify(key) {
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  try {
    const res = await fetch(API, { headers: { 'x-sync-key': key }, cache: 'no-store' });
    if (res.status === 401) return { ok: false, reason: 'wrong-key' };
    if (res.status === 503) return { ok: false, reason: 'not-configured' };
    if (!res.ok) return { ok: false, reason: 'server' };
    const body = await res.json();
    return { ok: true, books: body.books };
  } catch { return { ok: false, reason: 'offline' }; }
}

/** Turn sync on for this device. Everything already here is sent up, then the shared library comes down. */
export async function enable(key) {
  saveConfig({ key, seq: 0, epoch: null, lastSync: null });
  await db.markAllDirty();
  return syncNow();
}

export function disable() { saveConfig(null); setStatus({ state: 'off', lastSync: null, message: '' }); }

let running = null;
let again = false;

/** Push queued changes and pull everything new. Safe to call often. */
export function syncNow() {
  if (!enabled()) return Promise.resolve(false);
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await once(); } while (again);
      return true;
    } catch (e) {
      return false;
    } finally { running = null; }
  })();
  return running;
}

async function once() {
  const cfg = config(); if (!cfg) return;
  if (!navigator.onLine) { setStatus({ state: 'offline' }); throw new Error('offline'); }
  setStatus({ state: 'syncing' });
  const outbox = await db.getOutbox();
  const changes = [];
  for (const o of outbox) {
    const rec = await db.get(o.store, o.id);
    changes.push({ store: o.store, id: o.id, data: rec ? JSON.stringify(rec) : null, updatedAt: (rec && rec.updatedAt) || o.ts });
  }
  let res;
  try {
    res = await fetch(API, {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-sync-key': cfg.key },
      body: JSON.stringify({ since: cfg.seq || 0, epoch: cfg.epoch, changes }),
    });
  } catch { setStatus({ state: 'offline' }); throw new Error('offline'); }
  if (res.status === 401) { setStatus({ state: 'unauthorised', message: 'The sync key was not accepted.' }); throw new Error('401'); }
  if (!res.ok) { setStatus({ state: 'error', message: res.status === 503 ? 'Sync is not set up on the server yet.' : 'The server had a problem. Will try again later.' }); throw new Error(String(res.status)); }
  const body = await res.json();

  await db.ackOutbox(outbox);
  // Anything edited here while this sync was running wins; it goes up next time.
  const stillDirty = new Set((await db.getOutbox()).map(o => o.key));
  const localTheme = store.state.settings.theme;
  const incoming = [];
  for (const c of body.changes || []) {
    if (stillDirty.has(`${c.store}:${c.id}`)) continue;
    let data = null;
    if (c.data != null) { try { data = JSON.parse(c.data); } catch { continue; } }
    if (data && c.store === 'meta' && c.id === 'settings') data.theme = localTheme; // theme stays per device
    incoming.push({ store: c.store, id: c.id, data });
  }
  await db.applyRemote(incoming);
  const now = new Date().toISOString();
  saveConfig({ ...config(), seq: body.seq, epoch: body.epoch, lastSync: now });
  setStatus({ state: 'idle', lastSync: now, message: '' });
  if (incoming.length) await store.reload();
}

/** Keep the library in sync: on start, after edits, when back online, when the app is reopened, and every few minutes. */
export function startAutoSync() {
  if (enabled()) { const c = config(); setStatus({ state: navigator.onLine ? 'idle' : 'offline', lastSync: c.lastSync }); }
  let t = null;
  const soon = (ms = 1500) => { if (!enabled()) return; clearTimeout(t); t = setTimeout(syncNow, ms); };
  db.onDirty(() => soon());
  window.addEventListener('online', () => soon(200));
  window.addEventListener('offline', () => enabled() && setStatus({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(200); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 3 * 60 * 1000);
  soon(100);
}

export function describe() {
  const s = status;
  if (!enabled()) return 'Off — books are only on this device';
  if (s.state === 'syncing') return 'Syncing…';
  if (s.state === 'offline') return `Offline — changes will sync later${s.lastSync ? ` · last synced ${ago(s.lastSync)}` : ''}`;
  if (s.state === 'unauthorised') return 'The sync key was not accepted';
  if (s.state === 'error') return s.message || 'Sync problem — will try again';
  return s.lastSync ? `Synced ${ago(s.lastSync)}` : 'On';
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

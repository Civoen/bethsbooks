// Local-first storage. IndexedDB when available, in-memory fallback otherwise.
// Every local change is also noted in an "outbox" so it can be synced to the server later.
const DB_NAME = 'bethsbooks';
const DB_VERSION = 2;
export const STORES = ['books', 'genres', 'shelves', 'meta'];
const OUTBOX = 'outbox';

let dbp = null;
let memory = null;
export let persistent = true;

const dirtyListeners = new Set();
export const onDirty = (fn) => dirtyListeners.add(fn);
const dirtied = () => dirtyListeners.forEach(fn => fn());

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
  return dbp;
}

export async function init() {
  try {
    if (!('indexedDB' in window)) throw new Error('no idb');
    await open();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
  } catch (e) {
    persistent = false;
    memory = Object.fromEntries([...STORES, OUTBOX].map(s => [s, new Map()]));
  }
}

const outboxEntry = (store, id) => ({ key: `${store}:${id}`, store, id, ts: new Date().toISOString() });

/** Run a read-write transaction over one or more stores. */
function write(stores, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    fn(Object.fromEntries(stores.map(s => [s, t.objectStore(s)])));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  }));
}

function req2p(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function getAll(store) {
  if (!persistent) return [...memory[store].values()].map(v => structuredClone(v));
  const db = await open();
  return req2p(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function get(store, id) {
  if (!persistent) { const v = memory[store].get(id); return v ? structuredClone(v) : undefined; }
  const db = await open();
  return req2p(db.transaction(store, 'readonly').objectStore(store).get(id));
}

export async function put(store, value, { track = true } = {}) { return putMany(store, [value], { track }); }

export async function putMany(store, values, { track = true } = {}) {
  if (!values.length) return;
  if (!persistent) {
    for (const v of values) { memory[store].set(v.id, structuredClone(v)); if (track) { const o = outboxEntry(store, v.id); memory[OUTBOX].set(o.key, o); } }
  } else {
    await write(track ? [store, OUTBOX] : [store], os => {
      for (const v of values) { os[store].put(v); if (track) os[OUTBOX].put(outboxEntry(store, v.id)); }
    });
  }
  if (track) dirtied();
}

export async function del(store, id, { track = true } = {}) { return delMany(store, [id], { track }); }

export async function delMany(store, ids, { track = true } = {}) {
  if (!ids.length) return;
  if (!persistent) {
    for (const id of ids) { memory[store].delete(id); if (track) { const o = outboxEntry(store, id); memory[OUTBOX].set(o.key, o); } }
  } else {
    await write(track ? [store, OUTBOX] : [store], os => {
      for (const id of ids) { os[store].delete(id); if (track) os[OUTBOX].put(outboxEntry(store, id)); }
    });
  }
  if (track) dirtied();
}

/** Replace everything (restore / clear). Removed records are noted so the deletion syncs too. */
export async function replaceAll(data) {
  const before = {};
  for (const s of STORES) before[s] = (await getAll(s)).map(v => v.id);
  if (!persistent) {
    for (const s of STORES) {
      const keep = new Set((data[s] || []).map(v => v.id));
      for (const id of before[s]) if (!keep.has(id)) { const o = outboxEntry(s, id); memory[OUTBOX].set(o.key, o); }
      memory[s].clear();
      for (const v of data[s] || []) { memory[s].set(v.id, structuredClone(v)); const o = outboxEntry(s, v.id); memory[OUTBOX].set(o.key, o); }
    }
  } else {
    await write([...STORES, OUTBOX], os => {
      for (const s of STORES) {
        const keep = new Set((data[s] || []).map(v => v.id));
        for (const id of before[s]) if (!keep.has(id)) os[OUTBOX].put(outboxEntry(s, id));
        os[s].clear();
        for (const v of data[s] || []) { os[s].put(v); os[OUTBOX].put(outboxEntry(s, v.id)); }
      }
    });
  }
  dirtied();
}

// ---------- Outbox (for sync) ----------
export async function getOutbox() {
  if (!persistent) return [...memory[OUTBOX].values()].map(v => ({ ...v }));
  return getAll(OUTBOX);
}

/** Remove outbox entries that were sent, unless they changed again while the sync was running. */
export async function ackOutbox(sent) {
  if (!sent.length) return;
  if (!persistent) { for (const o of sent) { const cur = memory[OUTBOX].get(o.key); if (cur && cur.ts === o.ts) memory[OUTBOX].delete(o.key); } return; }
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction(OUTBOX, 'readwrite'); const os = t.objectStore(OUTBOX);
    for (const o of sent) { const r = os.get(o.key); r.onsuccess = () => { if (r.result && r.result.ts === o.ts) os.delete(o.key); }; }
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error);
  });
}

/** Note every local record as changed (used when sync is first switched on). */
export async function markAllDirty() {
  for (const s of STORES) {
    const all = await getAll(s);
    if (!persistent) { for (const v of all) { const o = outboxEntry(s, v.id); memory[OUTBOX].set(o.key, o); } continue; }
    if (all.length) await write([OUTBOX], os => { for (const v of all) os[OUTBOX].put(outboxEntry(s, v.id)); });
  }
  dirtied();
}

/** Apply changes that came from the server, without noting them in the outbox. */
export async function applyRemote(changes) {
  const byStore = {};
  for (const c of changes) {
    if (!STORES.includes(c.store)) continue;
    const bucket = (byStore[c.store] ||= { put: [], del: [] });
    if (c.data == null) bucket.del.push(c.id); else bucket.put.push(c.data);
  }
  for (const [s, { put, del }] of Object.entries(byStore)) {
    await putMany(s, put, { track: false });
    await delMany(s, del, { track: false });
  }
}

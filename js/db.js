// Local-first storage. IndexedDB when available, in-memory fallback otherwise.
const DB_NAME = 'bethsbooks';
const DB_VERSION = 1;
export const STORES = ['books', 'genres', 'shelves', 'meta'];

let dbp = null;
let memory = null; // fallback: { books: Map, ... }
export let persistent = true;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
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
    // Ask the browser to keep our data even under storage pressure.
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
  } catch (e) {
    persistent = false;
    memory = Object.fromEntries(STORES.map(s => [s, new Map()]));
  }
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  }));
}

export async function getAll(store) {
  if (!persistent) return [...memory[store].values()].map(v => structuredClone(v));
  return tx(store, 'readonly', os => new Promise((res, rej) => {
    const r = os.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}

export async function put(store, value) {
  if (!persistent) { memory[store].set(value.id, structuredClone(value)); return; }
  return tx(store, 'readwrite', os => { os.put(value); });
}

export async function putMany(store, values) {
  if (!persistent) { for (const v of values) memory[store].set(v.id, structuredClone(v)); return; }
  return tx(store, 'readwrite', os => { for (const v of values) os.put(v); });
}

export async function del(store, id) {
  if (!persistent) { memory[store].delete(id); return; }
  return tx(store, 'readwrite', os => { os.delete(id); });
}

export async function clear(store) {
  if (!persistent) { memory[store].clear(); return; }
  return tx(store, 'readwrite', os => { os.clear(); });
}

/** Replace everything in one go (used by restore). */
export async function replaceAll(data) {
  if (!persistent) {
    for (const s of STORES) { memory[s].clear(); for (const v of data[s] || []) memory[s].set(v.id, structuredClone(v)); }
    return;
  }
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORES, 'readwrite');
    for (const s of STORES) {
      const os = t.objectStore(s);
      os.clear();
      for (const v of data[s] || []) os.put(v);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

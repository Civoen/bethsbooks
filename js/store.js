// App state + all data mutations. Everything is held in memory and written through to IndexedDB.
import * as db from './db.js';
import { uid, nowISO, todayISO, dupKey, norm, yearOf } from './util.js';

export const state = {
  books: [],      // array of book objects
  genres: [],     // {id, name}
  shelves: [],    // {id, name, createdAt}
  settings: { id: 'settings', name: 'Beth', theme: 'rose', goals: {}, sort: 'recent' },
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

export const SCHEMA_VERSION = 1;
export const MAX_GENRES = 3;

export async function load() {
  await db.init();
  await readAll();
}
async function readAll() {
  const [books, genres, shelves, meta] = await Promise.all(db.STORES.map(s => db.getAll(s)));
  state.books = books.map(cleanBook);
  state.genres = genres.sort(byName);
  state.shelves = shelves.sort(byName);
  const s = meta.find(m => m.id === 'settings');
  if (s) state.settings = { ...state.settings, ...s, goals: { ...(s.goals || {}) } };
}
/** Re-read everything from storage (after a sync brought in changes). */
export async function reload() { await readAll(); emit(); }
export const isPersistent = () => db.persistent;

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// ---------- Books ----------
export function cleanBook(b) {
  const status = ['want', 'reading', 'read'].includes(b.status) ? b.status : 'read';
  const rating = Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5 ? b.rating : null;
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  return {
    id: b.id || uid(),
    title: String(b.title ?? '').trim(),
    author: String(b.author ?? '').trim(),
    status,
    genres: Array.isArray(b.genres) ? [...new Set(b.genres)].slice(0, MAX_GENRES) : [],
    shelves: Array.isArray(b.shelves) ? [...new Set(b.shelves)] : [],
    rating,
    review: String(b.review ?? ''),
    favourite: !!b.favourite,
    pageCount: num(b.pageCount),
    isbn: /^\d{13}$/.test(String(b.isbn || '')) ? String(b.isbn) : null,
    currentPage: num(b.currentPage),
    cover: typeof b.cover === 'string' && /^https:\/\//.test(b.cover) ? b.cover : null,
    coverChecked: !!b.coverChecked,   // automatic cover lookup has been tried
    dateAdded: b.dateAdded || nowISO(),
    dateStarted: b.dateStarted || null,
    dateFinished: b.dateFinished || null,
    updatedAt: b.updatedAt || nowISO(),
  };
}

export const getBook = (id) => state.books.find(b => b.id === id);

function applyStatusDates(b, prevStatus) {
  if (b.status === prevStatus) return b;
  if (b.status === 'reading' && !b.dateStarted) b.dateStarted = todayISO();
  if (b.status === 'read') {
    if (!b.dateFinished || prevStatus !== 'read') b.dateFinished = todayISO();
    if (!b.dateStarted && prevStatus === 'reading') b.dateStarted = todayISO();
  }
  return b;
}

export async function addBook(data) {
  const b = cleanBook({ ...data, id: uid(), dateAdded: nowISO() });
  if (b.status === 'reading' && !b.dateStarted) b.dateStarted = todayISO();
  if (b.status === 'read' && !('dateFinished' in data)) b.dateFinished = todayISO();
  await db.put('books', b);
  state.books.push(b);
  emit();
  return b;
}

export async function updateBook(id, patch) {
  const old = getBook(id);
  if (!old) return;
  const next = cleanBook({ ...old, ...patch, id, updatedAt: nowISO() });
  if (!('dateFinished' in patch) && !('dateStarted' in patch)) applyStatusDates(next, old.status);
  if (next.status === 'read' && next.pageCount && old.status !== 'read') next.currentPage = next.pageCount;
  await db.put('books', next);
  Object.assign(old, next);
  emit();
  return old;
}

export const setStatus = (id, status) => updateBook(id, { status });
export const toggleFavourite = (id) => updateBook(id, { favourite: !getBook(id).favourite });
export const setRating = (id, rating) => updateBook(id, { rating });
export function setProgress(id, page) {
  const b = getBook(id);
  const p = Math.max(0, Math.min(b.pageCount || Infinity, Math.round(page)));
  return updateBook(id, { currentPage: p || null });
}

export async function deleteBook(id) {
  const b = getBook(id);
  if (!b) return null;
  await db.del('books', id);
  state.books = state.books.filter(x => x.id !== id);
  emit();
  return b;
}
export async function restoreBook(b) {
  b.updatedAt = nowISO(); // newer than the deletion, so the undo also syncs
  await db.put('books', b);
  state.books.push(b);
  emit();
}

export function findDuplicate(title, author, exceptId) {
  const k = dupKey({ title, author });
  return state.books.find(b => b.id !== exceptId && dupKey(b) === k) || null;
}

// ---------- Genres ----------
export const genreName = (id) => state.genres.find(g => g.id === id)?.name || '';
export function findGenre(name) { const n = norm(name); return state.genres.find(g => norm(g.name) === n); }

export async function ensureGenre(name, { silent = false } = {}) {
  name = String(name).trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const found = findGenre(name);
  if (found) return found.id;
  const g = { id: uid(), name: name.charAt(0).toUpperCase() + name.slice(1), updatedAt: nowISO() };
  await db.put('genres', g);
  state.genres.push(g); state.genres.sort(byName);
  if (!silent) emit();
  return g.id;
}
export async function renameGenre(id, name) {
  const g = state.genres.find(x => x.id === id); if (!g) return;
  const clash = findGenre(name);
  if (clash && clash.id !== id) {
    // merge into the existing genre
    await mergeGenre(id, clash.id); return;
  }
  g.name = name.trim(); g.updatedAt = nowISO(); await db.put('genres', g); state.genres.sort(byName); emit();
}
async function mergeGenre(fromId, toId) {
  const changed = [];
  for (const b of state.books) if (b.genres.includes(fromId)) {
    b.genres = [...new Set(b.genres.map(x => x === fromId ? toId : x))]; b.updatedAt = nowISO(); changed.push(b);
  }
  await db.putMany('books', changed);
  await db.del('genres', fromId);
  state.genres = state.genres.filter(g => g.id !== fromId);
  emit();
}
export async function deleteGenre(id) {
  const changed = [];
  for (const b of state.books) if (b.genres.includes(id)) { b.genres = b.genres.filter(x => x !== id); b.updatedAt = nowISO(); changed.push(b); }
  await db.putMany('books', changed);
  await db.del('genres', id);
  state.genres = state.genres.filter(g => g.id !== id);
  emit();
}

// ---------- Shelves ----------
export const shelfName = (id) => state.shelves.find(s => s.id === id)?.name || '';
export function findShelf(name) { const n = norm(name); return state.shelves.find(s => norm(s.name) === n); }
export async function createShelf(name, { silent = false } = {}) {
  name = String(name).trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const found = findShelf(name); if (found) return found.id;
  const s = { id: uid(), name, createdAt: nowISO(), updatedAt: nowISO() };
  await db.put('shelves', s);
  state.shelves.push(s); state.shelves.sort(byName);
  if (!silent) emit();
  return s.id;
}
export async function renameShelf(id, name) {
  const s = state.shelves.find(x => x.id === id); if (!s || !name.trim()) return;
  s.name = name.trim(); s.updatedAt = nowISO(); await db.put('shelves', s); state.shelves.sort(byName); emit();
}
export async function deleteShelf(id) {
  // Books are kept — only their membership of this shelf is removed.
  const changed = [];
  for (const b of state.books) if (b.shelves.includes(id)) { b.shelves = b.shelves.filter(x => x !== id); b.updatedAt = nowISO(); changed.push(b); }
  await db.putMany('books', changed);
  await db.del('shelves', id);
  state.shelves = state.shelves.filter(s => s.id !== id);
  emit();
}
export async function toggleShelf(bookId, shelfId) {
  const b = getBook(bookId);
  const shelves = b.shelves.includes(shelfId) ? b.shelves.filter(x => x !== shelfId) : [...b.shelves, shelfId];
  return updateBook(bookId, { shelves });
}

// ---------- Settings & goals ----------
export async function saveSettings(patch) {
  const next = { ...state.settings, ...patch, id: 'settings', updatedAt: nowISO() };
  await db.put('meta', next);
  state.settings = next;
  emit();
}
export const goalFor = (year) => state.settings.goals?.[year] || null;
export const setGoal = (year, n) => {
  const goals = { ...(state.settings.goals || {}) };
  if (n && n > 0) goals[year] = Math.round(n); else delete goals[year];
  return saveSettings({ goals });
};
export const finishedIn = (year) => state.books.filter(b => b.status === 'read' && yearOf(b.dateFinished) === year);

// ---------- Bulk ----------
export async function bulkPutBooks(books) {
  await db.putMany('books', books);
  const byId = new Map(state.books.map(b => [b.id, b]));
  for (const b of books) byId.set(b.id, b);
  state.books = [...byId.values()];
  emit();
}

export function snapshot() {
  return {
    app: "Beth's Books",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowISO(),
    books: state.books,
    genres: state.genres,
    shelves: state.shelves,
    settings: state.settings,
  };
}

export async function replaceAllData(data) {
  // Restored records count as edited now, so they win over older copies on other devices.
  const now = nowISO();
  const books = (data.books || []).map(b => ({ ...cleanBook(b), updatedAt: now }));
  const genres = (data.genres || []).filter(g => g && g.id && g.name).map(g => ({ ...g, updatedAt: now }));
  const shelves = (data.shelves || []).filter(s => s && s.id && s.name).map(s => ({ ...s, updatedAt: now }));
  const settings = { ...state.settings, ...(data.settings || {}), id: 'settings', updatedAt: now };
  await db.replaceAll({ books, genres, shelves, meta: [settings] });
  state.books = books; state.genres = genres.sort(byName); state.shelves = shelves.sort(byName); state.settings = settings;
  emit();
}

/** Merge a backup into the current library. Books matched by id or title+author; newer edit wins. */
export async function mergeData(data) {
  const genreMap = new Map(); // backup genre id -> local id
  for (const g of data.genres || []) genreMap.set(g.id, await ensureGenre(g.name, { silent: true }));
  const shelfMap = new Map();
  for (const s of data.shelves || []) shelfMap.set(s.id, await createShelf(s.name, { silent: true }));
  let added = 0, updated = 0, kept = 0;
  const out = [];
  for (const raw of data.books || []) {
    const b = cleanBook(raw);
    b.genres = b.genres.map(id => genreMap.get(id)).filter(Boolean);
    b.shelves = b.shelves.map(id => shelfMap.get(id)).filter(Boolean);
    const existing = getBook(b.id) || findDuplicate(b.title, b.author);
    if (!existing) { out.push(b); added++; continue; }
    if ((b.updatedAt || '') > (existing.updatedAt || '')) { out.push({ ...b, id: existing.id }); updated++; } else kept++;
  }
  await bulkPutBooks(out);
  const goals = { ...(data.settings?.goals || {}), ...(state.settings.goals || {}) };
  await saveSettings({ goals });
  return { added, updated, kept };
}

export async function clearAll() {
  await db.replaceAll({ books: [], genres: [], shelves: [], meta: [] });
  state.books = []; state.genres = []; state.shelves = [];
  state.settings = { id: 'settings', name: state.settings.name, theme: state.settings.theme, goals: {}, sort: 'recent', updatedAt: nowISO() };
  await db.put('meta', state.settings);
  emit();
}

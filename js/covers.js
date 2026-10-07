// Automatic book covers from Open Library (free, no key). Covers are stored as image links;
// the service worker keeps a copy of each one it shows so they still appear offline.
import { state, getBook, updateBook, bulkPutBooks, cleanBook, saveSettings } from './store.js';
import { esc, I, debounce } from './util.js';
import { openSheet, closeSheet, toast, safely } from './ui.js';

const SEARCH = 'https://openlibrary.org/search.json';
const coverUrl = (id) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;
export const autoCoversOn = () => state.settings.autoCovers !== false;

async function search(params, limit) {
  const q = new URLSearchParams({ ...params, limit: String(limit), fields: 'title,author_name,cover_i,first_publish_year,number_of_pages_median' });
  const res = await fetch(`${SEARCH}?${q}`);
  if (!res.ok) throw new Error('lookup ' + res.status);
  return (await res.json()).docs || [];
}

// ---------- Matching ----------
/** "Title (Series #1)" / "Title: A Novel" / "Title [Paperback]" → "Title" */
export function searchTitle(t) {
  return String(t || '').replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+#\d+.*$/, '').split(/\s*:\s+/)[0].replace(/\s+/g, ' ').trim() || String(t || '').trim();
}
/** "Maas, Sarah J." → "Sarah J. Maas"; "A & B" → "A"; "Unknown author" → "" */
export function searchAuthor(a) {
  a = String(a || '').trim();
  if (!a || /^unknown/i.test(a)) return '';
  a = a.split(/\s*(?:&|;|\/|\band\b|,\s*(?=[^,]+,))\s*/i)[0].trim();
  const m = a.match(/^([^,]+),\s*(.+)$/);
  return (m ? `${m[2]} ${m[1]}` : a).replace(/\s+/g, ' ').trim();
}
const surnameOf = (a) => (a.split(' ').pop() || '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
const docAuthorMatches = (d, sur) => !sur || (d.author_name || []).some(n => surnameOf(n) === sur || n.toLowerCase().includes(sur));

/** Candidate covers for a title/author, best match first. */
export async function findCovers(title, author, limit = 12) {
  const t = searchTitle(title), a = searchAuthor(author), sur = surnameOf(a);
  const attempts = [
    a ? { title: t, author: a } : { title: t },
    a ? { q: `${t} ${a}` } : null,
    a && t !== String(title).trim() ? { title: String(title).trim(), author: a } : null,
    a ? { title: t, _check: true } : null, // title only, keeping matches by the same author
  ].filter(Boolean);
  for (const params of attempts) {
    const check = params._check; delete params._check;
    let docs = await search(params, limit);
    if (check) docs = docs.filter(d => docAuthorMatches(d, sur));
    const seen = new Set();
    const found = docs.filter(d => d.cover_i && !seen.has(d.cover_i) && seen.add(d.cover_i)).map(d => ({
      url: coverUrl(d.cover_i), title: d.title, author: (d.author_name || [])[0] || '', year: d.first_publish_year || null,
    }));
    if (found.length) return found;
  }
  return [];
}

// ---------- Automatic covers ----------
const MAX_MISSES = 3;                 // stop trying a book after this many "no match" lookups…
const RETRY_AFTER = 3 * 86400e3;      // …spaced at least three days apart
const needsCover = (b, now = Date.now()) => b.title && !b.cover && !b.coverChecked &&
  (!b.coverMiss || (b.coverMiss < MAX_MISSES && now - Date.parse(b.coverMissAt || 0) > RETRY_AFTER));

/** Look one book up. Returns a patch for it, or throws if Open Library couldn't be reached. */
async function lookupPatch(b) {
  const found = await findCovers(b.title, b.author, 5);
  if (found[0]) return { cover: found[0].url, coverChecked: true, coverMiss: 0, coverMissAt: null };
  return { coverMiss: (b.coverMiss || 0) + 1, coverMissAt: new Date().toISOString() };
}

/** Give one book its best-match cover (used straight after adding a book). */
export async function autoCover(id) {
  const b = getBook(id);
  if (!b || !needsCover(b) || !autoCoversOn() || !navigator.onLine) return;
  try {
    const patch = await lookupPatch(b);
    if (getBook(id) && !getBook(id).cover) await updateBook(id, patch);
  } catch {}
}

// Progress, for the Covers section under More
export const coverProgress = { running: false, done: 0, total: 0, found: 0 };
const progressListeners = new Set();
export const onCoverProgress = (fn) => progressListeners.add(fn);
const tell = () => progressListeners.forEach(fn => fn(coverProgress));

let filling = false;
/** Quietly find covers for every book that doesn't have one yet (e.g. after an import). */
export async function fillMissingCovers() {
  if (filling || !autoCoversOn() || !navigator.onLine) return;
  const queue = state.books.filter(b => needsCover(b)).map(b => b.id);
  if (!queue.length) return;
  filling = true;
  Object.assign(coverProgress, { running: true, done: 0, total: queue.length, found: 0 }); tell();
  const pending = new Map();           // id → patch, saved in batches so the screen isn't redrawn per book
  let failures = 0, stop = false;
  const flush = async () => {
    if (!pending.size) return;
    const now = new Date().toISOString();
    const books = [...pending].map(([id, patch]) => getBook(id) && !getBook(id).cover ? cleanBook({ ...getBook(id), ...patch, updatedAt: now }) : null).filter(Boolean);
    pending.clear();
    if (books.length) { try { await bulkPutBooks(books); } catch {} }
  };
  const timer = setInterval(flush, 2500);
  const worker = async () => {
    while (!stop && queue.length) {
      if (!navigator.onLine || !autoCoversOn()) { stop = true; break; }
      const id = queue.shift(), b = getBook(id);
      if (!b || !needsCover(b)) { coverProgress.done++; tell(); continue; }
      try {
        const patch = await lookupPatch(b);
        pending.set(id, patch);
        if (patch.cover) coverProgress.found++;
        failures = 0;
        coverProgress.done++; tell();
      } catch {
        // Open Library busy or unreachable: wait and retry this book, giving up after a few failures in a row.
        queue.unshift(id);
        if (++failures >= 6) { stop = true; break; }
        await new Promise(r => setTimeout(r, Math.min(8000, 1500 * failures)));
      }
      await new Promise(r => setTimeout(r, 350)); // be gentle with Open Library
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); }
  finally {
    clearInterval(timer);
    await flush();
    filling = false;
    coverProgress.running = false; tell();
  }
}

/** Forget earlier "no match" results, so every book without a cover is tried again. */
export async function retryAllCovers() {
  const now = new Date().toISOString();
  const books = state.books.filter(b => !b.cover && (b.coverChecked || b.coverMiss))
    .map(b => cleanBook({ ...b, coverChecked: false, coverMiss: 0, coverMissAt: null, updatedAt: now }));
  if (books.length) await bulkPutBooks(books);
  fillMissingCovers();
  return state.books.filter(b => !b.cover).length;
}

/** One-off for libraries from earlier versions, where a single "no match" switched a book off for good. */
export async function migrateCoverChecks() {
  if (state.settings.coversV2) return;
  const books = state.books.filter(b => !b.cover && b.coverChecked && !b.coverMiss)
    .map(b => cleanBook({ ...b, coverChecked: false, coverMiss: 1, coverMissAt: new Date(0).toISOString(), updatedAt: new Date().toISOString() }));
  if (books.length) await bulkPutBooks(books);
  await saveSettings({ coversV2: true });
}

/** Let Beth pick a different cover. onPick(url|null) is called with her choice. */
export function openCoverPicker({ title, author, current, onPick }) {
  openSheet({
    title: 'Choose a cover',
    sub: 'From Open Library. Tap the one that matches your copy.',
    body: `<form class="search" role="search" id="cv-form" style="height:48px"><label for="cv-q" class="sr">Search for covers</label>${I.search}<input id="cv-q" type="search" value="${esc(title)}${author && author !== 'Unknown author' ? ' ' + esc(author) : ''}" autocomplete="off" enterkeyhint="search"></form>
      <div id="cv-res" aria-live="polite"></div>
      <div class="sheet-actions">${current ? '<button class="btn btn-outline" data-a="none">No cover</button>' : ''}<button class="btn btn-soft" data-a="cancel">Cancel</button></div>`,
    onMount: el => {
      const res = el.querySelector('#cv-res');
      const run = async (q) => {
        if (!navigator.onLine) { res.innerHTML = `<div class="notice">${I.info}<span>You're offline. Covers can be chosen once you're connected.</span></div>`; return; }
        res.innerHTML = '<p class="muted" style="margin:0">Looking for covers…</p>';
        try {
          const list = q === null ? await findCovers(title, author, 18) : (await search({ q }, 18)).filter(d => d.cover_i).map(d => ({ url: coverUrl(d.cover_i), title: d.title, author: (d.author_name || [])[0] || '', year: d.first_publish_year }));
          const uniq = [...new Map(list.map(x => [x.url, x])).values()].slice(0, 12);
          res.innerHTML = uniq.length ? `<div class="cover-grid">${uniq.map((c, i) => `<button class="cover-opt" data-i="${i}" aria-pressed="${c.url === current}" aria-label="${esc(c.title)}${c.author ? ' by ' + esc(c.author) : ''}${c.year ? ', ' + c.year : ''}"><img src="${esc(c.url)}" alt="" loading="lazy"></button>`).join('')}</div>`
            : `<div class="empty-inline"><b>No covers found</b><span>Try fewer or different words.</span></div>`;
          res._list = uniq;
        } catch {
          res.innerHTML = `<div class="notice">${I.info}<span>Open Library isn't responding right now. Try again in a moment.</span></div>`;
        }
      };
      run(null);
      el.querySelector('#cv-form').addEventListener('submit', e => { e.preventDefault(); run(el.querySelector('#cv-q').value.trim()); });
      el.addEventListener('click', e => {
        const o = e.target.closest('[data-i]');
        if (o) { const c = res._list[Number(o.dataset.i)]; closeSheet(); onPick(c.url); return; }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'none') { closeSheet(); onPick(null); }
        if (a === 'cancel') closeSheet();
      });
    },
  });
}

/** Change the cover of a saved book. */
export function changeCover(id) {
  const b = getBook(id); if (!b) return;
  openCoverPicker({
    title: b.title, author: b.author, current: b.cover,
    onPick: async (url) => { await safely(() => updateBook(id, { cover: url, coverChecked: true, coverMiss: 0, coverMissAt: null })); toast(url ? 'Cover updated' : 'Cover removed'); },
  });
}

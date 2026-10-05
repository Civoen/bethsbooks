// Automatic book covers from Open Library (free, no key). Covers are stored as image links;
// the service worker keeps a copy of each one it shows so they still appear offline.
import { state, getBook, updateBook } from './store.js';
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

/** Candidate covers for a title/author, best match first. */
export async function findCovers(title, author, limit = 12) {
  const a = author && author !== 'Unknown author' ? author : '';
  let docs = await search(a ? { title, author: a } : { title }, limit);
  if (!docs.some(d => d.cover_i)) docs = await search({ q: `${title} ${a}`.trim() }, limit);
  const seen = new Set();
  return docs.filter(d => d.cover_i && !seen.has(d.cover_i) && seen.add(d.cover_i)).map(d => ({
    url: coverUrl(d.cover_i), title: d.title, author: (d.author_name || [])[0] || '', year: d.first_publish_year || null,
  }));
}

/** Give one book its best-match cover (once). Returns false if the lookup couldn't run. */
export async function autoCover(id) {
  const b = getBook(id);
  if (!b || b.cover || b.coverChecked || !autoCoversOn()) return true;
  if (!navigator.onLine) return false;
  try {
    const found = await findCovers(b.title, b.author, 5);
    if (!getBook(id) || getBook(id).cover) return true;
    await updateBook(id, { cover: found[0]?.url || null, coverChecked: true });
    return true;
  } catch { return false; }
}

let filling = false;
/** Quietly find covers for every book that doesn't have one yet (e.g. after an import). */
export async function fillMissingCovers() {
  if (filling || !autoCoversOn()) return;
  filling = true;
  try {
    for (;;) {
      if (!navigator.onLine || !autoCoversOn()) break;
      const b = state.books.find(x => !x.cover && !x.coverChecked && x.title);
      if (!b) break;
      const ok = await autoCover(b.id);
      if (!ok) break; // network trouble — try again another time
      await new Promise(r => setTimeout(r, 900)); // be gentle with Open Library
    }
  } finally { filling = false; }
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
    onPick: async (url) => { await safely(() => updateBook(id, { cover: url, coverChecked: true })); toast(url ? 'Cover updated' : 'Cover removed'); },
  });
}

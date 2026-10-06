import { state, genreName, shelfName, toggleFavourite, renameShelf, deleteShelf, getBook } from '../store.js';
import { esc, I, coverHTML, starsText, badgeHTML, norm, plural, STATUS, debounce, authorKey } from '../util.js';
import { shareWishlist } from '../share.js';
import { openSheet, closeSheet, confirmDialog, promptText, toast, safely } from '../ui.js';
import { openQuickActions } from './detail.js';
import detailView from './detail.js';
import { tap, pop, heartBurst, centreOf } from '../fx.js';

// Library filters survive navigation between screens.
export const filters = { q: '', status: 'all', fav: false, genre: '', shelf: '', minRating: 0, author: '', sort: 'recent' };

const SORTS = {
  recent: ['Recently added', (a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '')],
  finished: ['Recently finished', (a, b) => (b.dateFinished || '').localeCompare(a.dateFinished || '') || (b.dateAdded || '').localeCompare(a.dateAdded || '')],
  title: ['Title A–Z', (a, b) => sortTitle(a).localeCompare(sortTitle(b))],
  author: ['Author A–Z', (a, b) => surname(a.author).localeCompare(surname(b.author)) || sortTitle(a).localeCompare(sortTitle(b))],
  rating: ['Highest rated', (a, b) => (b.rating || 0) - (a.rating || 0) || sortTitle(a).localeCompare(sortTitle(b))],
};
const sortTitle = (b) => norm(b.title).replace(/^(the|a|an) /, '');
const surname = (a) => { a = String(a || '').trim(); if (a.includes(',')) return norm(a); const p = norm(a).split(' '); return (p.pop() || '') + ' ' + p.join(' '); };

export const isWide = () => matchMedia('(min-width: 900px)').matches;

/** Search across title, author, genres, shelves and review. Every word must match somewhere. */
export function searchBooks(list, q) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return list;
  const scored = [];
  for (const b of list) {
    const head = norm(b.title + ' ' + b.author + ' ' + (b.isbn || ''));
    const rest = norm([...b.genres.map(genreName), ...b.shelves.map(shelfName), b.review].join(' '));
    let score = 0, ok = true;
    for (const word of words) {
      // "dragons" also finds "dragon"
      const w = word.length > 3 && word.endsWith('s') && !head.includes(word) && !rest.includes(word) ? word.slice(0, -1) : word;
      if (head.includes(w)) score += norm(b.title).startsWith(w) ? 3 : 2;
      else if (rest.includes(w)) score += 1;
      else { ok = false; break; }
    }
    if (ok) scored.push([score, b]);
  }
  return scored.sort((x, y) => y[0] - x[0]).map(x => x[1]);
}

export function rowHTML(b, selectedId, { heart = true } = {}) {
  const genres = b.genres.map(genreName).filter(Boolean);
  const sub = [badgeHTML(b.status)];
  if (b.status === 'read' && b.rating) sub.push(starsText(b.rating));
  else if (b.status === 'reading' && b.pageCount) sub.push(`<span class="count-line" style="font-size:12px">${Math.round((b.currentPage || 0) / b.pageCount * 100)}%</span>`);
  else if (genres.length) sub.push(`<span class="count-line" style="font-size:12px">${esc(genres[0])}</span>`);
  return `<div class="book-row${b.id === selectedId ? ' selected' : ''}" data-id="${b.id}">
    <a class="main" href="#/book/${b.id}"${b.id === selectedId ? ' aria-current="true"' : ''}>${coverHTML(b, 'sm')}
      <div class="meta"><div class="t">${esc(b.title)}</div><div class="a">${esc(b.author)}</div><div class="sub">${sub.join('')}</div></div></a>
    ${heart ? `<button class="icon-btn heart-btn" data-fav="${b.id}" aria-pressed="${b.favourite}" aria-label="${b.favourite ? 'Remove from favourites' : 'Add to favourites'}: ${esc(b.title)}">${b.favourite ? I.heartFill : I.heart}</button>` : ''}
  </div>`;
}

function applyFilters(lockedShelf) {
  let list = state.books;
  const shelf = lockedShelf || filters.shelf;
  if (shelf) list = list.filter(b => b.shelves.includes(shelf));
  if (filters.fav) list = list.filter(b => b.favourite);
  if (filters.genre) list = list.filter(b => b.genres.includes(filters.genre));
  if (filters.minRating) list = list.filter(b => (b.rating || 0) >= filters.minRating);
  if (filters.author) { const k = authorKey(filters.author); list = list.filter(b => authorKey(b.author) === k); }
  const counts = { all: list.length, want: 0, reading: 0, read: 0 };
  for (const b of list) counts[b.status]++;
  if (filters.status !== 'all') list = list.filter(b => b.status === filters.status);
  if (filters.q.trim()) list = searchBooks(list, filters.q);
  else list = [...list].sort(SORTS[filters.sort]?.[1] || SORTS.recent[1]);
  return { list, counts };
}

const activeFilterCount = (locked) => (filters.fav ? 1 : 0) + (filters.genre ? 1 : 0) + (!locked && filters.shelf ? 1 : 0) + (filters.minRating ? 1 : 0) + (filters.author ? 1 : 0);

function dynamicHTML(lockedShelf, selectedId) {
  const { list, counts } = applyFilters(lockedShelf);
  const chip = (k, label) => `<button class="chip" data-status="${k}" aria-pressed="${filters.status === k}">${label}${counts[k] ? ` · ${counts[k]}` : ''}</button>`;
  const af = [];
  if (filters.fav) af.push(['fav', `${I.heartFill} Favourites`]);
  if (filters.genre) af.push(['genre', esc(genreName(filters.genre))]);
  if (filters.shelf && !lockedShelf) af.push(['shelf', esc(shelfName(filters.shelf))]);
  if (filters.author) af.push(['author', `By ${esc(filters.author)}`]);
  if (filters.minRating) af.push(['minRating', `${filters.minRating}+ stars`]);
  const n = activeFilterCount(lockedShelf);

  let results;
  const q = filters.q.trim();
  if (!state.books.length) {
    results = `<div class="empty"><div class="art">${I.books}</div><h2>Your library is waiting</h2><p>Add your first book to get started.</p><a class="btn btn-primary" href="#/add">${I.plus} Add a book</a></div>`;
  } else if (!list.length && q) {
    results = `<div class="empty"><div class="art">${I.search}</div><h2>Not in your library</h2><p>Nothing matches “${esc(q)}”${n || filters.status !== 'all' ? ' with these filters' : ''}.</p>
      <a class="btn btn-primary" href="#/add?title=${encodeURIComponent(q)}">${I.plus} Add “${esc(q.length > 24 ? q.slice(0, 24) + '…' : q)}”</a>
      <a class="btn btn-ghost" href="#/add?mode=search&q=${encodeURIComponent(q)}">${I.globe} Look it up online</a>
      ${n || filters.status !== 'all' ? `<button class="btn btn-ghost" data-clear-all>Clear filters</button>` : ''}</div>`;
  } else if (!list.length) {
    results = lockedShelf && !counts.all
      ? `<div class="empty"><div class="art">${I.shelf}</div><h2>This shelf is empty</h2><p>Open any book and choose “Shelves” to put it here.</p></div>`
      : `<div class="empty"><div class="art">${I.filter}</div><h2>No books here</h2><p>Nothing matches these filters.</p><button class="btn btn-soft" data-clear-all>Clear filters</button></div>`;
  } else {
    const LIMIT = 300; // keep very large libraries snappy
    results = `<div class="list" role="list">${list.slice(0, LIMIT).map(b => rowHTML(b, selectedId)).join('')}</div>${list.length > LIMIT ? `<p class="count-line" style="text-align:center">Showing ${LIMIT} of ${list.length}. Search to narrow it down.</p>` : ''}`;
  }

  return `<div class="chips" role="group" aria-label="Reading status">${chip('all', 'All')}${chip('read', 'Read')}${chip('reading', 'Reading')}${chip('want', 'Want to read')}</div>
    ${af.length ? `<div class="chips" aria-label="Active filters">${af.map(([k, l]) => `<button class="chip on" data-clear="${k}" aria-label="Remove filter">${l}<span class="x">${I.close}</span></button>`).join('')}${af.length > 1 ? `<button class="chip" data-clear-all>Clear all</button>` : ''}</div>` : ''}
    <div class="toolbar">
      <button class="btn btn-ghost btn-sm" data-a="filters" style="padding:0 6px">${I.filter} Filters${n ? ` (${n})` : ''}</button>
      <span class="count-line" aria-live="polite">${q ? plural(list.length, 'match', 'matches') : plural(list.length, 'book')}</span>
      ${q ? '<span></span>' : `<label class="sr" for="sort">Sort by</label><select id="sort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${filters.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`}
    </div>
    ${filters.status === 'want' && counts.want && !q && !lockedShelf ? `<button class="wish-banner" data-a="share-wish"><span class="ic">${I.gift}</span><span><b>Share as a wishlist</b><span>Send your Want to Read list, handy for birthdays and Christmas</span></span>${I.share}</button>` : ''}
    ${results}`;
}

function render(host, r, selectedId) {
  const lockedShelf = r.path?.startsWith('/shelf/') ? r.params[0] : null;
  if (lockedShelf && !state.shelves.find(s => s.id === lockedShelf)) {
    host.innerHTML = `<div class="view"><div class="empty"><h2>Shelf not found</h2><p>It may have been deleted.</p><a class="btn btn-primary" href="#/shelves">Your shelves</a></div></div>`; return;
  }
  // Query-string shortcuts from the dashboard
  if (r.query && Object.keys(r.query).length && !r._applied) {
    r._applied = true;
    if (r.query.status) { filters.status = r.query.status; filters.fav = false; filters.genre = ''; filters.shelf = ''; filters.minRating = 0; filters.author = ''; filters.q = ''; }
    if (r.query.author) { Object.assign(filters, { author: r.query.author, status: 'all', fav: false, genre: '', shelf: '', minRating: 0, q: '' }); }
    if (r.query.fav) { filters.fav = true; filters.status = 'all'; filters.q = ''; }
    if (r.query.sort) filters.sort = r.query.sort;
    if (r.query.genre) { filters.genre = r.query.genre; filters.status = 'all'; filters.q = ''; }
  }
  const wide = isWide();
  const title = lockedShelf ? shelfName(lockedShelf) : 'My books';
  const listPane = `<div class="view${wide ? '' : ''}" style="${wide ? 'padding:0;max-width:none' : ''}">
    ${lockedShelf ? `<div class="topbar"><a class="icon-btn" href="#/shelves" aria-label="Back to shelves">${I.back}</a><span class="grow"></span>
      <button class="icon-btn" data-a="shelf-menu" aria-label="Shelf options">${I.more}</button></div>` : ''}
    <div class="page-head"><h1 class="page-title">${esc(title)}</h1>${lockedShelf ? '' : `<span class="count-line" style="padding-top:12px">${plural(state.books.length, 'book')}</span>`}</div>
    <div class="search" role="search"><label for="q" class="sr">Search your library</label>${I.search}
      <input id="q" type="search" placeholder="${lockedShelf ? 'Search this shelf' : 'Have I read…? Title, author, review'}" value="${esc(filters.q)}" autocomplete="off" enterkeyhint="search">
      <button class="icon-btn" data-a="clear-q" aria-label="Clear search" ${filters.q ? '' : 'hidden'}>${I.close}</button></div>
    <div id="lib-dyn" style="display:flex;flex-direction:column;gap:14px">${dynamicHTML(lockedShelf, selectedId)}</div>
  </div>`;

  if (wide) {
    host.innerHTML = `<div class="view wide"><div class="split"><div>${listPane}</div><div class="pane-detail" id="pane-detail"></div></div></div>`;
    const pane = host.querySelector('#pane-detail');
    if (selectedId) detailView.render(pane, { params: [selectedId], query: {}, path: '/book/' + selectedId, embedded: true });
    else pane.innerHTML = `<div class="empty"><div class="art">${I.bookOpen}</div><h2>Pick a book</h2><p>Choose a book on the left to see its details.</p></div>`;
  } else {
    host.innerHTML = listPane;
  }

  const dyn = host.querySelector('#lib-dyn');
  const q = host.querySelector('#q');
  const clearBtn = host.querySelector('[data-a="clear-q"]');
  const refresh = () => { host.closest('.enter')?.classList.remove('enter'); dyn.innerHTML = dynamicHTML(lockedShelf, selectedId); };
  host._refresh = refresh;
  const onInput = debounce(() => { filters.q = q.value; clearBtn.hidden = !q.value; refresh(); }, 90);
  q.addEventListener('input', onInput);
  if (r.query?.focus) setTimeout(() => q.focus(), 50);

  host.addEventListener('change', e => { if (e.target.id === 'sort') { filters.sort = e.target.value; refresh(); } });
  host.addEventListener('click', async e => {
    const t = e.target;
    const st = t.closest('[data-status]'); if (st) { filters.status = st.dataset.status; refresh(); pop(dyn.querySelectorAll(`[data-status="${filters.status}"]`)); return; }
    const fav = t.closest('[data-fav]');
    if (fav) {
      e.preventDefault(); tap();
      const id = fav.dataset.fav, b = getBook(id), [x, y] = centreOf(fav);
      await safely(() => toggleFavourite(id));
      if (b?.favourite) heartBurst(x, y);
      pop(document.querySelectorAll(`[data-fav="${id}"] svg`));
      if (b) toast(b.favourite ? 'Added to favourites' : 'Removed from favourites');
      return;
    }
    const cl = t.closest('[data-clear]');
    if (cl) { const k = cl.dataset.clear; filters[k] = k === 'minRating' ? 0 : k === 'fav' ? false : ''; refresh(); return; }
    if (t.closest('[data-clear-all]')) { Object.assign(filters, { fav: false, genre: '', shelf: '', minRating: 0, author: '', status: 'all' }); refresh(); return; }
    if (t.closest('[data-a="clear-q"]')) { q.value = ''; filters.q = ''; clearBtn.hidden = true; refresh(); q.focus(); return; }
    if (t.closest('[data-a="filters"]')) { openFilterSheet(lockedShelf, refresh); return; }
    if (t.closest('[data-a="share-wish"]')) { shareWishlist(); return; }
    if (t.closest('[data-a="shelf-menu"]')) { openShelfMenu(lockedShelf); return; }
  });

  // Long-press a book for quick actions
  let timer = null, startX = 0, startY = 0, fired = false;
  host.addEventListener('pointerdown', e => {
    const row = e.target.closest('.book-row'); if (!row || e.target.closest('[data-fav]')) return;
    fired = false; startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => { fired = true; navigator.vibrate?.(15); openQuickActions(row.dataset.id); }, 480);
  });
  const cancel = (e) => { if (timer && (!e || e.type !== 'pointermove' || Math.hypot(e.clientX - startX, e.clientY - startY) > 10)) { clearTimeout(timer); timer = null; } };
  host.addEventListener('pointermove', cancel); host.addEventListener('pointerup', () => cancel()); host.addEventListener('pointercancel', () => cancel());
  host.addEventListener('click', e => { if (fired && e.target.closest('.book-row')) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  host.addEventListener('contextmenu', e => { const row = e.target.closest('.book-row'); if (row) { e.preventDefault(); if (!fired) openQuickActions(row.dataset.id); } });
}

function update(host, r) {
  // Keep the search box (and keyboard) alive; refresh everything else.
  if (host._refresh && !isWide()) { host._refresh(); return; }
  const y = window.scrollY;
  const had = document.activeElement?.id === 'q';
  host.innerHTML = '';
  const fresh = document.createElement('div'); host.appendChild(fresh);
  render(fresh, r, r.path?.startsWith('/book/') ? r.params[0] : null);
  host._refresh = fresh._refresh;
  window.scrollTo(0, y);
  if (had) host.querySelector('#q')?.focus({ preventScroll: true });
}

function openFilterSheet(lockedShelf, refresh) {
  const opts = (arr, cur, none) => `<option value="">${none}</option>` + arr.map(x => `<option value="${x.id}"${x.id === cur ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  openSheet({
    title: 'Filter books',
    body: `<label class="switch-row"><span><b>Favourites only</b></span><span class="switch"><input type="checkbox" id="f-fav" ${filters.fav ? 'checked' : ''}><span></span></span></label>
      <div class="field"><label for="f-genre">Genre</label><select id="f-genre" class="select">${opts(state.genres, filters.genre, 'Any genre')}</select></div>
      ${lockedShelf ? '' : `<div class="field"><label for="f-shelf">Shelf</label><select id="f-shelf" class="select">${opts(state.shelves, filters.shelf, 'Any shelf')}</select></div>`}
      <div class="field"><span class="lbl" id="f-r-l">Rating</span><div class="tags" role="group" aria-labelledby="f-r-l">${[0, 3, 4, 5].map(n => `<button class="chip" data-r="${n}" aria-pressed="${filters.minRating === n}">${n ? `${n}${n < 5 ? '+' : ''} stars` : 'Any'}</button>`).join('')}</div></div>
      <div class="sheet-actions"><button class="btn btn-outline" data-a="reset">Clear filters</button><button class="btn btn-primary" data-a="done">Show books</button></div>`,
    onMount: el => {
      let minRating = filters.minRating;
      el.addEventListener('click', e => {
        const r = e.target.closest('[data-r]');
        if (r) { minRating = Number(r.dataset.r); el.querySelectorAll('[data-r]').forEach(b => b.setAttribute('aria-pressed', b === r)); }
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'reset') { Object.assign(filters, { fav: false, genre: '', shelf: '', minRating: 0 }); refresh(); closeSheet(); }
        if (a === 'done') {
          filters.fav = el.querySelector('#f-fav').checked;
          filters.genre = el.querySelector('#f-genre').value;
          if (!lockedShelf) filters.shelf = el.querySelector('#f-shelf').value;
          filters.minRating = minRating;
          refresh(); closeSheet();
        }
      });
    },
  });
}

function openShelfMenu(id) {
  openSheet({
    title: shelfName(id),
    body: `<div class="menu"><button class="menu-item" data-a="rename"><span class="ic">${I.edit}</span><span class="tx"><b>Rename shelf</b></span></button>
      <button class="menu-item danger" data-a="delete"><span class="ic">${I.trash}</span><span class="tx"><b>Delete shelf</b><span>Your books are kept</span></span></button></div>`,
    onMount: el => el.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'rename') {
        const name = await promptText({ title: 'Rename shelf', label: 'Shelf name', value: shelfName(id) });
        if (name) await safely(() => renameShelf(id, name));
      }
      if (a === 'delete') {
        const n = state.books.filter(b => b.shelves.includes(id)).length;
        const ok = await confirmDialog({ title: `Delete “${shelfName(id)}”?`, message: `The shelf will be removed. ${n ? `The ${plural(n, 'book')} on it will stay in your library.` : ''}`, confirmLabel: 'Delete shelf', danger: true });
        if (ok) { await safely(() => deleteShelf(id)); toast('Shelf deleted'); location.hash = '#/shelves'; }
      }
    }),
  });
}

export default { render: (host, r) => render(host, r, null), update };
export { render as renderBooks, STATUS };

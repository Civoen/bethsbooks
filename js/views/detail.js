import { state, getBook, genreName, shelfName, setStatus, toggleFavourite, setRating, setProgress, updateBook, deleteBook, restoreBook, toggleShelf, createShelf, goalFor, setGoal, finishedIn } from '../store.js';
import { esc, I, coverHTML, fmtDate, pct, STATUS, plural } from '../util.js';
import { openSheet, closeSheet, confirmDialog, toast, safely } from '../ui.js';
import { isWide, renderBooks } from './books.js';
import { changeCover } from '../covers.js';

function statusSeg(b) {
  const opt = (k, label) => `<button data-status="${k}" aria-pressed="${b.status === k}">${b.status === k ? I.check : ''}${label}</button>`;
  return `<div class="segmented" role="group" aria-label="Reading status">${opt('want', 'Want to read')}${opt('reading', 'Reading')}${opt('read', 'Read')}</div>`;
}

export function ratingHTML(r, id = 'rate') {
  return `<div class="rate" role="radiogroup" aria-label="Rating" id="${id}">${[1, 2, 3, 4, 5].map(n => `<button role="radio" aria-checked="${r === n}" data-rate="${n}" class="${r >= n ? 'on' : ''}" aria-label="${n} out of 5 stars">${I.star}</button>`).join('')}<span class="val">${r ? `${r}/5` : 'Not rated'}</span></div>`;
}

function render(host, r) {
  const id = r.params[0];
  if (!r.embedded && isWide()) { renderBooks(host, r, id); return; }
  const b = getBook(id);
  if (!b) {
    host.innerHTML = `<div class="view"><div class="empty"><div class="art">${I.books}</div><h2>Book not found</h2><p>It may have been deleted.</p><a class="btn btn-primary" href="#/books">Back to My books</a></div></div>`;
    return;
  }
  const genres = b.genres.map(g => [g, genreName(g)]).filter(x => x[1]);
  const shelves = b.shelves.map(s => [s, shelfName(s)]).filter(x => x[1]);
  const p = pct(b);

  let statusPanel = '';
  if (b.status === 'want') {
    statusPanel = `<button class="btn btn-primary btn-block" data-status="reading">${I.bookOpen} Start reading</button>`;
  } else if (b.status === 'reading') {
    statusPanel = `<div class="panel"><h2>Progress</h2>
      <div class="progress progress-big" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><span style="width:${p}%"></span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <span>${b.pageCount ? `<b>Page ${b.currentPage || 0}</b> <span class="muted">of ${b.pageCount} · ${p}% complete</span>` : b.currentPage ? `<b>Page ${b.currentPage}</b>` : '<span class="muted">No progress logged yet</span>'}</span>
        <span style="display:flex;gap:8px"><button class="btn btn-soft btn-sm" data-a="progress">Update progress</button></span>
      </div>
      <button class="btn btn-outline btn-sm" data-status="read" style="align-self:flex-start">${I.check} Finished it</button></div>`;
  }

  const ratingPanel = b.status === 'read' ? `<div class="panel"><h2>Your rating</h2>${ratingHTML(b.rating)}</div>` : '';
  const reviewPanel = (b.status === 'read' || b.review) ? `<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center"><h2>Review</h2>${b.review ? `<button class="btn btn-ghost btn-sm" data-a="review">${I.edit} Edit</button>` : ''}</div>
      ${b.review ? `<div class="review">${esc(b.review)}</div>` : `<button class="btn btn-soft" data-a="review" style="align-self:flex-start">${I.pen} Write a review</button>`}</div>` : '';

  const dates = [['Added', b.dateAdded], ['Started', b.dateStarted], ['Finished', b.status === 'read' ? b.dateFinished : null]].filter(d => d[1]);

  host.innerHTML = `<div class="view">
    ${r.embedded ? '' : `<div class="topbar"><button class="icon-btn" data-a="back" aria-label="Back">${I.back}</button><span class="grow"></span>
      <a class="icon-btn" href="#/edit/${b.id}" aria-label="Edit book">${I.edit}</a>
      <button class="icon-btn" data-a="menu" aria-label="More options">${I.more}</button></div>`}
    <div class="detail-hero"><button class="cover-btn" data-a="cover" aria-label="${b.cover ? 'Change cover' : 'Choose a cover'}">${coverHTML(b, 'lg')}</button>
      <div class="ti"><h1>${esc(b.title)}</h1><div class="by">${esc(b.author)}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-left:-10px">
          <button class="icon-btn heart-btn" data-a="fav" aria-pressed="${b.favourite}" aria-label="${b.favourite ? 'Remove from favourites' : 'Add to favourites'}">${b.favourite ? I.heartFill : I.heart}</button>
          <span class="count-line">${b.favourite ? 'Favourite' : ''}</span>
        </div>
      </div>
    </div>
    ${statusSeg(b)}
    ${statusPanel}
    ${ratingPanel}
    ${reviewPanel}
    <div class="panel"><h2>Genres</h2><div class="tags">${genres.map(([gid, n]) => `<a class="tag" href="#/books?genre=${gid}">${esc(n)}</a>`).join('')}<a class="tag add" href="#/edit/${b.id}">${genres.length ? 'Edit' : '+ Add genres'}</a></div>
      <h2 style="margin-top:6px">Shelves</h2><div class="tags">${shelves.map(([sid, n]) => `<a class="tag" href="#/shelf/${sid}">${I.shelf.replace('<svg', '<svg width="14" height="14"')} ${esc(n)}</a>`).join('')}<button class="tag add" data-a="shelves">+ ${shelves.length ? 'Change' : 'Add to shelf'}</button></div></div>
    ${dates.length || b.pageCount ? `<div class="panel"><h2>Details</h2><dl class="dates">${dates.map(([k, v]) => `<dt>${k}</dt><dd>${fmtDate(v)}</dd>`).join('')}${b.pageCount ? `<dt>Pages</dt><dd>${b.pageCount}</dd>` : ''}</dl></div>` : ''}
    <div class="detail-actions"><a class="btn btn-outline" href="#/edit/${b.id}">${I.edit} Edit</a><button class="btn btn-danger" data-a="delete">${I.trash} Delete</button></div>
  </div>`;

  host.addEventListener('click', async e => {
    const t = e.target;
    const st = t.closest('[data-status]');
    if (st) { const s = st.dataset.status; if (s !== getBook(id)?.status) { await safely(() => setStatus(id, s)); toast(s === 'read' ? `Marked as read${b.pageCount ? '' : ''} — nice one` : `Moved to ${STATUS[s].label}`); } return; }
    const rt = t.closest('[data-rate]');
    if (rt) { const n = Number(rt.dataset.rate); await safely(() => setRating(id, getBook(id).rating === n ? null : n)); return; }
    const a = t.closest('[data-a]')?.dataset.a;
    if (a === 'back') { if (window.__bbNav > 0) history.back(); else location.hash = '#/books'; }
    if (a === 'fav') { await safely(() => toggleFavourite(id)); }
    if (a === 'progress') openProgressSheet(id);
    if (a === 'cover') changeCover(id);
    if (a === 'review') openReviewSheet(id);
    if (a === 'shelves') openShelvesSheet(id);
    if (a === 'menu') openQuickActions(id, { detail: true });
    if (a === 'delete') confirmDelete(id);
  });
}

export async function confirmDelete(id) {
  const b = getBook(id); if (!b) return;
  const ok = await confirmDialog({ title: `Delete “${b.title}”?`, message: 'This removes the book, its rating and review from your library.', confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  const removed = await safely(() => deleteBook(id), "We couldn't delete that book. Please try again.");
  if (!removed) return;
  if (location.hash.startsWith('#/book/' + id) || location.hash.startsWith('#/edit/' + id)) location.hash = '#/books';
  toast(`Deleted “${removed.title}”`, { action: 'Undo', onAction: () => safely(() => restoreBook(removed)) });
}

export function openProgressSheet(id) {
  const b = getBook(id); if (!b) return;
  const hasTotal = !!b.pageCount;
  openSheet({
    title: 'Update progress', sub: esc(b.title),
    body: `<form class="form" novalidate>
      <div class="field"><label for="pg">Current page</label>
        <div class="page-stepper"><button type="button" class="icon-btn outlined" data-step="-10" aria-label="Back 10 pages">${I.minus}</button>
          <input id="pg" class="input" type="number" inputmode="numeric" min="0" ${hasTotal ? `max="${b.pageCount}"` : ''} value="${b.currentPage || 0}" autofocus>
          <button type="button" class="icon-btn outlined" data-step="10" aria-label="Forward 10 pages">${I.plus}</button></div>
        ${hasTotal ? `<input class="range" id="pg-r" type="range" min="0" max="${b.pageCount}" value="${b.currentPage || 0}" aria-label="Current page slider">` : ''}
        <div class="hint" id="pg-h"></div></div>
      ${hasTotal ? '' : `<div class="field"><label for="pt">Total pages <span style="font-weight:400">(optional — shows a percentage)</span></label><input id="pt" class="input" type="number" inputmode="numeric" min="1" placeholder="e.g. 352"></div>`}
      <div class="sheet-actions"><button type="button" class="btn btn-outline" data-a="finish">${I.check} Finished</button><button class="btn btn-primary" type="submit">Save</button></div></form>`,
    onMount: el => {
      const pg = el.querySelector('#pg'), rg = el.querySelector('#pg-r'), hint = el.querySelector('#pg-h'), pt = el.querySelector('#pt');
      const total = () => b.pageCount || (pt && parseInt(pt.value, 10)) || null;
      const upd = () => { const v = parseInt(pg.value, 10) || 0; const t = total(); hint.textContent = t ? `${Math.min(100, Math.round(v / t * 100))}% complete` : ''; if (rg) rg.value = v; };
      upd();
      pg.addEventListener('input', upd); pt && pt.addEventListener('input', upd);
      rg && rg.addEventListener('input', () => { pg.value = rg.value; upd(); });
      el.addEventListener('click', async e => {
        const s = e.target.closest('[data-step]');
        if (s) { let v = (parseInt(pg.value, 10) || 0) + Number(s.dataset.step); const t = total(); v = Math.max(0, t ? Math.min(t, v) : v); pg.value = v; upd(); }
        if (e.target.closest('[data-a="finish"]')) { closeSheet(); await safely(() => setStatus(id, 'read')); toast('Marked as read — nice one'); }
      });
      el.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const v = parseInt(pg.value, 10) || 0; const t = total();
        if (pt && t) await safely(() => updateBook(id, { pageCount: t }));
        await safely(() => setProgress(id, v));
        closeSheet();
        if (t && v >= t) toast('That’s the last page!', { action: 'Mark as read', onAction: () => safely(() => setStatus(id, 'read')) });
        else toast('Progress saved');
      });
    },
  });
}

function openReviewSheet(id) {
  const b = getBook(id);
  openSheet({
    title: b.review ? 'Edit review' : 'Write a review', sub: esc(b.title),
    body: `<form class="form" novalidate><div class="field"><label for="rv" class="sr">Review</label><textarea id="rv" class="textarea" style="min-height:200px" placeholder="What did you think?" autofocus>${esc(b.review)}</textarea></div>
      <div class="sheet-actions"><button type="button" class="btn btn-outline" data-a="cancel">Cancel</button><button class="btn btn-primary" type="submit">Save review</button></div></form>`,
    onMount: el => {
      el.querySelector('[data-a="cancel"]').onclick = () => closeSheet();
      el.querySelector('form').addEventListener('submit', async e => { e.preventDefault(); const v = el.querySelector('#rv').value.trim(); closeSheet(); await safely(() => updateBook(id, { review: v })); toast('Review saved'); });
    },
  });
}

export function openShelvesSheet(id) {
  const draw = (el) => {
    const b = getBook(id);
    el.querySelector('#sh-list').innerHTML = state.shelves.length ? state.shelves.map(s => `<label class="switch-row"><span>${esc(s.name)}</span><span class="switch"><input type="checkbox" data-shelf="${s.id}" ${b.shelves.includes(s.id) ? 'checked' : ''}><span></span></span></label>`).join('')
      : `<p class="muted" style="margin:0">No shelves yet. Shelves are your own collections — like “Holiday reads” or “Books to reread”.</p>`;
  };
  openSheet({
    title: 'Shelves', sub: esc(getBook(id).title),
    body: `<div id="sh-list"></div>
      <form class="form" novalidate style="flex-direction:row;gap:8px"><label for="sh-new" class="sr">New shelf name</label><input id="sh-new" class="input" placeholder="New shelf name" maxlength="60" autocomplete="off"><button class="btn btn-soft" type="submit" style="height:50px">Create</button></form>
      <button class="btn btn-primary btn-block" data-a="done">Done</button>`,
    onMount: el => {
      draw(el);
      el.addEventListener('change', async e => { const s = e.target.dataset.shelf; if (s) await safely(() => toggleShelf(id, s)); });
      el.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault(); const inp = el.querySelector('#sh-new'); const name = inp.value.trim(); if (!name) return;
        const sid = await safely(() => createShelf(name));
        if (sid && !getBook(id).shelves.includes(sid)) await safely(() => toggleShelf(id, sid));
        inp.value = ''; draw(el);
      });
      el.querySelector('[data-a="done"]').onclick = () => closeSheet();
    },
  });
}

export function openQuickActions(id, { detail = false } = {}) {
  const b = getBook(id); if (!b) return;
  const st = (k) => `<button class="menu-item" data-status="${k}" role="menuitemradio" aria-checked="${b.status === k}"><span class="ic">${k === 'read' ? I.books : k === 'reading' ? I.bookOpen : I.bookmark}</span><span class="tx"><b>${STATUS[k].label}</b>${b.status === k ? '<span>Current status</span>' : ''}</span>${b.status === k ? `<span style="color:var(--primary)">${I.check}</span>` : ''}</button>`;
  openSheet({
    title: b.title, sub: esc(b.author),
    body: `<div class="menu" role="menu">${detail ? '' : st('want') + st('reading') + st('read')}
      <button class="menu-item" data-a="fav"><span class="ic">${b.favourite ? I.heartFill : I.heart}</span><span class="tx"><b>${b.favourite ? 'Remove from favourites' : 'Add to favourites'}</b></span></button>
      <button class="menu-item" data-a="shelves"><span class="ic">${I.shelf}</span><span class="tx"><b>Shelves</b><span>${b.shelves.length ? esc(b.shelves.map(shelfName).join(', ')) : 'Not on any shelf'}</span></span></button>
      ${detail ? '' : `<button class="menu-item" data-a="open"><span class="ic">${I.books}</span><span class="tx"><b>Open book</b></span></button>`}
      <button class="menu-item" data-a="cover"><span class="ic">${I.bookOpen}</span><span class="tx"><b>${b.cover ? 'Change cover' : 'Choose a cover'}</b><span>From Open Library</span></span></button>
      <button class="menu-item" data-a="edit"><span class="ic">${I.edit}</span><span class="tx"><b>Edit details</b></span></button>
      <button class="menu-item danger" data-a="delete"><span class="ic">${I.trash}</span><span class="tx"><b>Delete book</b></span></button></div>`,
    onMount: el => el.addEventListener('click', async e => {
      const s = e.target.closest('[data-status]');
      if (s) { closeSheet(); if (s.dataset.status !== b.status) { await safely(() => setStatus(id, s.dataset.status)); toast(`Moved to ${STATUS[s.dataset.status].label}`); } return; }
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'fav') { closeSheet(); await safely(() => toggleFavourite(id)); toast(getBook(id).favourite ? 'Added to favourites' : 'Removed from favourites'); }
      if (a === 'shelves') openShelvesSheet(id);
      if (a === 'open') closeSheet('/book/' + id);
      if (a === 'edit') closeSheet('/edit/' + id);
      if (a === 'cover') changeCover(id);
      if (a === 'delete') confirmDelete(id);
    }),
  });
}

export function openGoalSheet() {
  const year = new Date().getFullYear();
  const cur = goalFor(year);
  const done = finishedIn(year).length;
  openSheet({
    title: `${year} reading goal`, sub: `You've finished ${plural(done, 'book')} so far this year. A goal is just for fun — change it any time.`,
    body: `<form class="form" novalidate><div class="field"><label for="goal">Books to read in ${year}</label><input id="goal" class="input" type="number" inputmode="numeric" min="1" max="999" value="${cur || ''}" placeholder="e.g. 24" autofocus></div>
      <div class="sheet-actions">${cur ? '<button type="button" class="btn btn-outline" data-a="off">Turn off goal</button>' : ''}<button class="btn btn-primary" type="submit">Save goal</button></div></form>`,
    onMount: el => {
      el.querySelector('[data-a="off"]')?.addEventListener('click', async () => { closeSheet(); await safely(() => setGoal(year, null)); toast('Reading goal turned off'); });
      el.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault(); const n = parseInt(el.querySelector('#goal').value, 10);
        if (!n || n < 1) { el.querySelector('#goal').classList.add('err'); return; }
        closeSheet(); await safely(() => setGoal(year, n)); toast('Reading goal saved');
      });
    },
  });
}

export default { render };

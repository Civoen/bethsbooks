import { state, getBook, addBook, updateBook, ensureGenre, createShelf, findDuplicate, genreName, MAX_GENRES } from '../store.js';
import { esc, I, coverHTML, todayISO, STATUS, badgeHTML, starsText, debounce, norm } from '../util.js';
import { openCoverPicker, autoCover, autoCoversOn } from '../covers.js';
import { tap, pop } from '../fx.js';
import { confirmDialog, toast, safely } from '../ui.js';
import { searchBooks, rowHTML } from './books.js';
import { ratingHTML } from './detail.js';

function render(host, r) {
  if (r.path === '/add' && r.query.mode === 'search') return renderSearch(host, r);
  const editing = r.path.startsWith('/edit/');
  const existing = editing ? getBook(r.params[0]) : null;
  if (editing && !existing) { host.innerHTML = `<div class="view"><div class="empty"><h2>Book not found</h2><a class="btn btn-primary" href="#/books">My books</a></div></div>`; return; }

  const prefill = r._prefill || {};
  const f = existing ? structuredClone(existing) : {
    title: r.query.title || prefill.title || '', author: prefill.author || '', status: 'read', genres: [], shelves: [], rating: null, review: '',
    favourite: false, pageCount: prefill.pageCount || null, currentPage: null, cover: prefill.cover || null,
    dateStarted: null, dateFinished: todayISO(),
  };
  // Genres/shelves are tracked by name so new ones can be created on save.
  let genres = f.genres.map(genreName).filter(Boolean);
  let shelves = f.shelves.map(id => state.shelves.find(s => s.id === id)?.name).filter(Boolean);

  host.innerHTML = `<div class="view">
    <div class="topbar"><button class="icon-btn" data-a="cancel" aria-label="Cancel">${I.close}</button><span class="grow"></span></div>
    <h1 class="page-title">${editing ? 'Edit book' : 'Add a book'}</h1>
    <form class="form" novalidate id="book-form">
      <div class="cover-pick"><div id="cv"></div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">
          <button type="button" class="btn btn-soft btn-sm" data-a="cv-pick">${I.search} <span id="cv-lbl">${f.cover ? 'Change cover' : 'Choose cover'}</span></button>
          <button type="button" class="btn btn-ghost btn-sm" data-a="cv-remove" ${f.cover ? '' : 'hidden'}>Remove cover</button>
          <span class="hint" id="cv-hint">${!f.cover && !editing && autoCoversOn() ? 'Found automatically when you save' : ''}</span>
        </div></div>
      <div class="field"><label for="title">Title</label><input id="title" class="input" value="${esc(f.title)}" autocomplete="off" required autocapitalize="words"><div class="err-msg" id="title-err" hidden>Please add a title</div></div>
      <div class="field"><label for="author">Author</label><input id="author" class="input" value="${esc(f.author)}" autocomplete="off" list="authors" autocapitalize="words"><div class="err-msg" id="author-err" hidden>Please add an author</div>
        <datalist id="authors">${[...new Set(state.books.map(b => b.author))].sort().map(a => `<option value="${esc(a)}">`).join('')}</datalist></div>
      <div class="field"><span class="lbl" id="st-l">Status</span><div class="segmented" role="group" aria-labelledby="st-l">${Object.keys(STATUS).map(k => `<button type="button" data-st="${k}" aria-pressed="${f.status === k}">${STATUS[k].short}</button>`).join('')}</div></div>
      <div id="dyn-fields" class="form"></div>
      <div class="field"><span class="lbl">Genres <span style="font-weight:400" id="g-count"></span></span>
        <div class="tags" id="g-tags"></div>
        <div style="display:flex;gap:8px"><label for="g-new" class="sr">New genre</label><input id="g-new" class="input" placeholder="New genre" maxlength="40" autocomplete="off"><button type="button" class="btn btn-soft" data-a="g-add" style="height:50px">Add</button></div>
        <div class="hint" id="g-hint"></div></div>
      <div class="field"><span class="lbl">Shelves</span><div class="tags" id="s-tags"></div>
        <div style="display:flex;gap:8px"><label for="s-new" class="sr">New shelf</label><input id="s-new" class="input" placeholder="New shelf, e.g. Holiday reads" maxlength="60" autocomplete="off"><button type="button" class="btn btn-soft" data-a="s-add" style="height:50px">Add</button></div></div>
      <label class="switch-row"><span><b>Favourite</b><br><span class="muted" style="font-size:13px">Independent of the star rating</span></span><span class="switch"><input type="checkbox" id="fav" ${f.favourite ? 'checked' : ''}><span></span></span></label>
      <div class="form-actions"><button type="button" class="btn btn-outline" data-a="cancel">Cancel</button><button type="submit" class="btn btn-primary">${editing ? 'Save changes' : 'Add book'}</button></div>
    </form></div>`;

  const $ = (s) => host.querySelector(s);
  const drawCover = () => { $('#cv').innerHTML = coverHTML({ title: $('#title').value || 'Untitled', author: $('#author').value, cover: f.cover }, 'md'); $('[data-a="cv-remove"]').hidden = !f.cover; $('#cv-lbl').textContent = f.cover ? 'Change cover' : 'Choose cover'; };
  drawCover();
  $('#title').addEventListener('input', debounce(drawCover, 150));

  const drawDyn = () => {
    const s = f.status;
    let h = `<div class="row2"><div class="field"><label for="pages">Total pages</label><input id="pages" class="input" type="number" inputmode="numeric" min="1" value="${f.pageCount || ''}" placeholder="Optional"></div>`;
    if (s === 'reading') h += `<div class="field"><label for="cur">Current page</label><input id="cur" class="input" type="number" inputmode="numeric" min="0" value="${f.currentPage || ''}" placeholder="Optional"></div>`;
    else h += '<div></div>';
    h += '</div>';
    if (s !== 'want') {
      h += `<div class="row2"><div class="field"><label for="d-start">Started</label><input id="d-start" class="input" type="date" value="${f.dateStarted || ''}" max="${todayISO()}"></div>`;
      h += s === 'read' ? `<div class="field"><label for="d-fin">Finished</label><input id="d-fin" class="input" type="date" value="${f.dateFinished || ''}" max="${todayISO()}"></div></div><div class="hint" style="margin-top:-12px">Leave the finish date empty for books you read long ago — they won't count toward this year's goal.</div>` : '<div></div></div>';
    }
    if (s === 'read') {
      h += `<div class="field"><span class="lbl">Rating</span>${ratingHTML(f.rating, 'f-rate')}</div>
        <div class="field"><label for="review">Review</label><textarea id="review" class="textarea" placeholder="What did you think?">${esc(f.review)}</textarea></div>`;
    } else if (f.review) {
      h += `<div class="field"><label for="review">Notes / review</label><textarea id="review" class="textarea">${esc(f.review)}</textarea></div>`;
    }
    $('#dyn-fields').innerHTML = h;
  };
  // Keep typed values when the status changes
  const capture = () => {
    const v = (id) => host.querySelector('#' + id);
    if (v('pages')) f.pageCount = parseInt(v('pages').value, 10) || null;
    if (v('cur')) f.currentPage = parseInt(v('cur').value, 10) || null;
    if (v('d-start')) f.dateStarted = v('d-start').value || null;
    if (v('d-fin')) f.dateFinished = v('d-fin').value || null;
    if (v('review')) f.review = v('review').value;
  };
  drawDyn();

  const allGenres = () => [...new Set([...state.genres.map(g => g.name), ...genres])].sort((a, b) => a.localeCompare(b));
  const drawGenres = () => {
    const full = genres.length >= MAX_GENRES;
    $('#g-tags').innerHTML = allGenres().map(n => { const on = genres.some(g => norm(g) === norm(n)); return `<button type="button" class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-g="${esc(n)}" ${!on && full ? 'disabled style="opacity:.45"' : ''}>${on ? I.check : ''}${esc(n)}</button>`; }).join('') || '<span class="muted" style="font-size:14px">No genres yet — add one below.</span>';
    $('#g-count').textContent = `(${genres.length}/${MAX_GENRES})`;
    $('#g-hint').textContent = full ? `That's the maximum of ${MAX_GENRES} genres. Tap one to remove it.` : '';
    $('#g-new').disabled = full; $('[data-a="g-add"]').disabled = full;
  };
  const allShelves = () => [...new Set([...state.shelves.map(s => s.name), ...shelves])].sort((a, b) => a.localeCompare(b));
  const drawShelves = () => {
    $('#s-tags').innerHTML = allShelves().map(n => { const on = shelves.includes(n); return `<button type="button" class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-s="${esc(n)}">${on ? I.check : ''}${esc(n)}</button>`; }).join('') || '<span class="muted" style="font-size:14px">Shelves are optional collections, like “Holiday reads”.</span>';
  };
  drawGenres(); drawShelves();

  const addGenre = () => {
    const n = $('#g-new').value.trim(); if (!n || genres.length >= MAX_GENRES) return;
    const existingName = allGenres().find(x => norm(x) === norm(n));
    const name = existingName || n.charAt(0).toUpperCase() + n.slice(1);
    if (!genres.some(g => norm(g) === norm(name))) genres.push(name);
    $('#g-new').value = ''; drawGenres();
  };
  const addShelf = () => { const n = $('#s-new').value.trim(); if (!n) return; const ex = allShelves().find(x => norm(x) === norm(n)) || n; if (!shelves.includes(ex)) shelves.push(ex); $('#s-new').value = ''; drawShelves(); };
  $('#g-new').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addGenre(); } });
  $('#s-new').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addShelf(); } });


  host.addEventListener('click', e => {
    const t = e.target;
    const st = t.closest('[data-st]');
    if (st) { tap(); capture(); const prev = f.status; f.status = st.dataset.st; host.querySelectorAll('[data-st]').forEach(b => b.setAttribute('aria-pressed', b === st)); if (f.status === 'read' && prev !== 'read' && !f.dateFinished && !editing) f.dateFinished = todayISO(); drawDyn(); return; }
    const rt = t.closest('[data-rate]');
    if (rt) { e.preventDefault(); tap(); const n = Number(rt.dataset.rate); f.rating = f.rating === n ? null : n; capture(); drawDyn(); host.querySelector(`[data-rate="${n}"]`)?.focus(); pop(host.querySelectorAll('#f-rate button.on'), host, 45); return; }
    const g = t.closest('[data-g]');
    if (g) { const n = g.dataset.g; if (genres.some(x => norm(x) === norm(n))) genres = genres.filter(x => norm(x) !== norm(n)); else if (genres.length < MAX_GENRES) genres.push(n); drawGenres(); return; }
    const s = t.closest('[data-s]');
    if (s) { const n = s.dataset.s; shelves = shelves.includes(n) ? shelves.filter(x => x !== n) : [...shelves, n]; drawShelves(); return; }
    const a = t.closest('[data-a]')?.dataset.a;
    if (a === 'g-add') addGenre();
    if (a === 's-add') addShelf();
    if (a === 'cv-remove') { f.cover = null; f.coverChecked = true; drawCover(); }
    if (a === 'cv-pick') {
      const title = $('#title').value.trim();
      if (!title) { $('#title').focus(); $('#title-err').hidden = false; return; }
      openCoverPicker({ title, author: $('#author').value.trim(), current: f.cover, onPick: (url) => { f.cover = url; f.coverChecked = true; drawCover(); } });
    }
    if (a === 'cancel') { if (window.__bbNav > 0) history.back(); else location.hash = editing ? '#/book/' + existing.id : '#/home'; }
  });

  $('#book-form').addEventListener('submit', async e => {
    e.preventDefault();
    capture();
    const title = $('#title').value.trim(), author = $('#author').value.trim();
    $('#title-err').hidden = !!title; $('#author-err').hidden = !!author;
    $('#title').classList.toggle('err', !title); $('#author').classList.toggle('err', !author);
    if (!title || !author) { (!title ? $('#title') : $('#author')).focus(); return; }

    const dup = findDuplicate(title, author, existing?.id);
    if (dup && !editing) {
      const ok = await confirmDialog({ title: 'Already in your library', message: `“${dup.title}” by ${dup.author} is already on your list (${STATUS[dup.status].label}). Add it again anyway?`, confirmLabel: 'Add anyway', cancelLabel: 'Go back' });
      if (!ok) return;
    }
    if (f.status === 'reading' && f.pageCount && f.currentPage > f.pageCount) f.currentPage = f.pageCount;

    const saved = await safely(async () => {
      const genreIds = [];
      for (const n of genres) genreIds.push(await ensureGenre(n, { silent: true }));
      const shelfIds = [];
      for (const n of shelves) shelfIds.push(await createShelf(n, { silent: true }));
      const data = {
        title, author, status: f.status, genres: genreIds.filter(Boolean), shelves: shelfIds.filter(Boolean),
        rating: f.status === 'read' ? f.rating : (existing ? existing.rating : null),
        review: f.review || '', favourite: $('#fav').checked, pageCount: f.pageCount, currentPage: f.status === 'read' && f.pageCount ? f.pageCount : f.currentPage,
        cover: f.cover, coverChecked: !!f.coverChecked || !!f.cover, dateStarted: f.status === 'want' ? (existing?.dateStarted || null) : f.dateStarted,
        dateFinished: f.status === 'read' ? f.dateFinished : (existing?.dateFinished || null),
      };
      return editing ? updateBook(existing.id, data) : addBook(data);
    }, "We couldn't save that book. Please try again.");
    if (!saved) return;
    toast(editing ? 'Changes saved' : `Added “${saved.title}”`);
    location.replace('#/book/' + saved.id);
    if (!saved.cover) autoCover(saved.id); // finds a cover in the background when online
  });
}

// ---------- Search for a book (library first, then online) ----------
function renderSearch(host, r) {
  host.innerHTML = `<div class="view">
    <div class="topbar"><button class="icon-btn" data-a="cancel" aria-label="Back">${I.back}</button><span class="grow"></span></div>
    <h1 class="page-title">Search for a book</h1>
    <div class="search" role="search"><label for="sq" class="sr">Title or author</label>${I.search}<input id="sq" type="search" placeholder="Title or author" value="${esc(r.query.q || '')}" autocomplete="off" enterkeyhint="search" autofocus></div>
    <div id="s-lib"></div>
    <div id="s-web"></div>
    <a class="btn btn-ghost" href="#/add" id="s-manual">${I.pen} Enter it manually instead</a>
  </div>`;
  const q = host.querySelector('#sq');
  let seq = 0;
  let results = [];
  const run = async () => {
    const v = q.value.trim();
    host.querySelector('#s-manual').href = '#/add' + (v ? '?title=' + encodeURIComponent(v) : '');
    const lib = v ? searchBooks(state.books, v).slice(0, 5) : [];
    host.querySelector('#s-lib').innerHTML = lib.length ? `<section class="section"><div class="section-head"><h2>Already in your library</h2></div><div class="list">${lib.map(b => rowHTML(b, null, { heart: false })).join('')}</div></section>` : '';
    const web = host.querySelector('#s-web');
    if (v.length < 3) { web.innerHTML = v ? '' : `<p class="muted" style="margin:0">Type a title or author. Your own library is checked first, then the online catalogue (Open Library) when you're connected.</p>`; return; }
    if (!navigator.onLine) { web.innerHTML = `<div class="notice">${I.info}<span>You're offline, so online search isn't available. You can still add the book manually.</span></div>`; return; }
    const my = ++seq;
    web.innerHTML = `<p class="muted" style="margin:0">Searching online…</p>`;
    try {
      const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(v)}&limit=12&fields=key,title,author_name,cover_i,number_of_pages_median,first_publish_year`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (my !== seq) return;
      results = (data.docs || []).filter(d => d.title);
      web.innerHTML = results.length ? `<section class="section"><div class="section-head"><h2>From Open Library</h2></div><div class="list">${results.map((d, i) => {
        const fake = { title: d.title, author: (d.author_name || [''])[0], cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null };
        const mine = findDuplicate(fake.title, fake.author);
        return `<div class="book-row"><div class="main" style="cursor:default">${coverHTML(fake, 'sm')}<div class="meta"><div class="t">${esc(fake.title)}</div><div class="a">${esc(fake.author || 'Unknown author')}</div>
          <div class="sub">${mine ? badgeHTML(mine.status) + '<span class="count-line" style="font-size:12px">In your library</span>' : `<span class="count-line" style="font-size:12px">${[d.first_publish_year, d.number_of_pages_median ? d.number_of_pages_median + ' pages' : ''].filter(Boolean).join(' · ')}</span>`}</div></div></div>
          ${mine ? `<a class="btn btn-outline btn-sm" href="#/book/${mine.id}">Open</a>` : `<button class="btn btn-soft btn-sm" data-pick="${i}">Add</button>`}</div>`;
      }).join('')}</div></section>` : `<div class="empty-inline"><b>No matches online</b><span>Try different words, or add it manually.</span></div>`;
    } catch {
      if (my !== seq) return;
      web.innerHTML = `<div class="notice">${I.info}<span>Online search isn't responding right now. You can still add the book manually.</span></div>`;
    }
  };
  q.addEventListener('input', debounce(run, 350));
  if (q.value) run(); else run();
  setTimeout(() => q.focus(), 50);

  host.addEventListener('click', async e => {
    if (!host.querySelector('#sq')) return; // the add form has taken over this screen
    if (e.target.closest('[data-a="cancel"]')) { if (window.__bbNav > 0) history.back(); else location.hash = '#/home'; return; }
    const p = e.target.closest('[data-pick]'); if (!p) return;
    const d = results[Number(p.dataset.pick)];
    p.disabled = true; p.textContent = '…';
    const cover = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null;
    const prefill = { title: d.title, author: (d.author_name || []).slice(0, 2).join(' & '), pageCount: d.number_of_pages_median || null, cover };
    // Open the add form pre-filled
    const fakeRoute = { path: '/add', params: [], query: {}, _prefill: prefill };
    host.innerHTML = '';
    const fresh = document.createElement('div'); host.appendChild(fresh);
    render(fresh, fakeRoute);
    window.scrollTo(0, 0);
  });
}

export default { render, live: false };

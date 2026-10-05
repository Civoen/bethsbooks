import { state, goalFor, finishedIn } from '../store.js';
import { esc, I, coverHTML, starsText, greeting, longDate, pct, plural } from '../util.js';
import { openAddMenu } from '../app.js';
import { openProgressSheet, openGoalSheet } from './detail.js';

function render(el) {
  const s = state.settings;
  const year = new Date().getFullYear();
  const books = state.books;
  const reading = books.filter(b => b.status === 'reading').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const finished = books.filter(b => b.status === 'read' && b.dateFinished)
    .sort((a, b) => (b.dateFinished).localeCompare(a.dateFinished) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const favs = books.filter(b => b.favourite).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const read = books.filter(b => b.status === 'read');
  const rated = read.filter(b => b.rating);
  const avg = rated.length ? (rated.reduce((n, b) => n + b.rating, 0) / rated.length) : null;
  const tbr = books.filter(b => b.status === 'want').length;

  const head = `<div class="page-head"><div><div class="eyebrow">${esc(longDate())}</div><h1 class="page-title">${esc(greeting(s.name))}</h1></div>
    <a class="icon-btn outlined" href="#/books?focus=1" aria-label="Search your library">${I.search}</a></div>`;

  if (!books.length) {
    el.innerHTML = `<div class="view">${head}
      <div class="empty"><div class="art">${I.books}</div><h2>Your library is waiting</h2><p>Add your first book to get started.</p>
      <button class="btn btn-primary" data-a="add">${I.plus} Add a book</button></div></div>`;
    el.querySelector('[data-a="add"]').addEventListener('click', openAddMenu);
    return;
  }

  // Currently reading
  let readingHTML;
  if (!reading.length) {
    readingHTML = `<div class="empty-inline"><b>Nothing on the go</b><span>Pick something from your TBR when you're ready.</span>${tbr ? `<div style="margin-top:10px"><a class="btn btn-soft btn-sm" href="#/books?status=want">See your TBR</a></div>` : ''}</div>`;
  } else {
    const [first, ...rest] = reading;
    const p = pct(first);
    const progressLine = first.pageCount ? `Page ${first.currentPage || 0} of ${first.pageCount} · ${p}%` : (first.currentPage ? `Page ${first.currentPage}` : 'No progress yet');
    readingHTML = `<div class="card reading-card">
      <a href="#/book/${first.id}" tabindex="-1" aria-hidden="true">${coverHTML(first, 'md')}</a>
      <div class="info"><a class="title title-link" href="#/book/${first.id}">${esc(first.title)}</a><div class="muted" style="font-size:13px">${esc(first.author)}</div>
        <div style="margin-top:auto" class="progress" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><span style="width:${p}%"></span></div>
        <div class="row" style="margin-top:2px"><span class="muted" style="font-size:12px">${progressLine}</span><button class="btn btn-soft btn-sm" data-progress="${first.id}" aria-label="Update progress for ${esc(first.title)}">Update</button></div>
      </div>
    </div>
    ${rest.map(b => { const q = pct(b); return `<a class="card reading-mini" href="#/book/${b.id}" style="text-decoration:none;color:inherit">${coverHTML(b, 'xs')}
      <div style="flex:1;min-width:0"><div class="t">${esc(b.title)}</div><div class="muted" style="font-size:12px">${esc(b.author)}${b.pageCount ? ` · ${q}%` : ''}</div></div>
      <div class="progress mini-track"><span style="width:${q}%"></span></div></a>`; }).join('')}`;
  }

  // Goal
  const goal = goalFor(year);
  let goalHTML;
  if (goal) {
    const done = finishedIn(year).length;
    const gp = Math.min(100, Math.round(done / goal * 100));
    const left = Math.max(0, goal - done);
    const note = left === 0 ? (done > goal ? `${done - goal} past your goal — wonderful.` : 'Goal reached — wonderful.') : done === 0 ? 'Every book counts. Enjoy the reading.' : `${plural(left, 'book')} to go — lovely reading so far.`;
    goalHTML = `<button class="goal-card" data-a="goal" aria-label="${year} reading goal: ${done} of ${goal} books. Change goal">
      <div style="display:flex;justify-content:space-between;align-items:baseline;width:100%"><span class="lbl">${year} reading goal</span><span class="lbl" style="text-transform:none;letter-spacing:0">${gp}%</span></div>
      <div class="big">${done} <small>of ${plural(goal, 'book')}</small></div>
      <div class="bar" style="width:100%"><span style="width:${gp}%"></span></div>
      <div class="note">${note}</div></button>`;
  } else {
    goalHTML = `<button class="goal-empty" data-a="goal"><span class="menu-item" style="padding:0;min-height:0;width:auto"><span class="ic">${I.target}</span></span><span><b style="display:block">Set a ${year} reading goal</b><span class="muted" style="font-size:13px">Optional — just for fun</span></span></button>`;
  }

  const tiles = (list, withRating) => `<div class="cover-row">${list.map(b => `<a class="cover-tile" href="#/book/${b.id}" style="text-decoration:none">${coverHTML(b, 'tile')}<div class="t">${esc(b.title)}</div>${withRating && b.rating ? `<div>${starsText(b.rating)}</div>` : ''}</a>`).join('')}</div>`;

  // Imported books often have no finish date — show her top-rated reads until some dated ones exist.
  const topRated = read.filter(b => b.rating).sort((a, b) => b.rating - a.rating || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const finishedHTML = finished.length
    ? `<section class="section"><div class="section-head"><h2>Recently finished</h2><a class="link" href="#/books?status=read&sort=finished">See all</a></div>${tiles(finished.slice(0, 10), true)}</section>`
    : topRated.length ? `<section class="section"><div class="section-head"><h2>Top rated in your library</h2><a class="link" href="#/books?status=read&sort=rating">See all</a></div>${tiles(topRated.slice(0, 10), true)}</section>` : '';

  const favHTML = `<section class="section"><div class="section-head"><h2>Favourites</h2>${favs.length ? `<a class="link" href="#/books?fav=1">See all</a>` : ''}</div>
    ${favs.length ? tiles(favs.slice(0, 10), false) : `<div class="empty-inline"><b>No favourites yet</b><span>When a book becomes special, give it a heart.</span></div>`}</section>`;

  const statsHTML = `<section class="section"><div class="section-head"><h2>At a glance</h2><a class="link" href="#/stats">More stats</a></div>
    <div class="stat-grid">
      <a class="stat" href="#/books?status=read" style="text-decoration:none;color:inherit"><div class="n">${read.length}</div><div class="l">Books read</div></a>
      <div class="stat"><div class="n">${avg ? avg.toFixed(1) : '–'}${avg ? ' <span style="font-size:18px;color:var(--star)" aria-hidden="true">★</span>' : ''}</div><div class="l">Average rating</div></div>
      <a class="stat" href="#/books?status=want" style="text-decoration:none;color:inherit"><div class="n">${tbr}</div><div class="l">On your TBR</div></a>
      <a class="stat" href="#/books?fav=1" style="text-decoration:none;color:inherit"><div class="n">${favs.length}</div><div class="l">Favourites</div></a>
    </div></section>`;

  el.innerHTML = `<div class="view">${head}
    <section class="section"><div class="section-head"><h2>Currently reading</h2>${reading.length ? `<span class="count-line">${plural(reading.length, 'book')}</span>` : ''}</div>${readingHTML}</section>
    ${goalHTML}
    ${finishedHTML}
    ${favHTML}
    ${statsHTML}
  </div>`;

  el.addEventListener('click', e => {
    const pr = e.target.closest('[data-progress]');
    if (pr) { e.preventDefault(); openProgressSheet(pr.dataset.progress); }
    if (e.target.closest('[data-a="goal"]')) openGoalSheet();
  });
}

export default { render };

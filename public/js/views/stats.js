import { state, genreName } from '../store.js';
import { esc, I, MONTHS_SHORT, yearOf, plural, coverHTML, starsText } from '../util.js';

let chosenYear = null;

const avgOf = (list) => { const r = list.filter(b => b.rating); return r.length ? r.reduce((n, b) => n + b.rating, 0) / r.length : null; };
const fmtAvg = (a) => a == null ? '–' : a.toFixed(1);

function bars(items, label) {
  const max = Math.max(1, ...items.map(i => i.n));
  return `<div class="bars" role="img" aria-label="${esc(label)}: ${items.map(i => `${i.full || i.label} ${i.n}`).join(', ')}">${items.map(i =>
    `<div class="b"><strong>${i.n || ''}</strong><i class="${i.n ? '' : 'zero'}" style="height:${Math.max(2, i.n / max * 100)}%"></i><em>${esc(i.label)}</em>${i.extra ? `<em>${i.extra}</em>` : ''}</div>`).join('')}</div>`;
}

function hbars(rows, max) {
  return `<div class="hbars">${rows.map(r => `<div class="hbar"><div class="top"><span>${r.name}</span><span>${r.right}</span></div><div class="progress" aria-hidden="true"><span style="width:${r.n ? Math.max(3, r.n / max * 100) : 0}%"></span></div></div>`).join('')}</div>`;
}

function render(host) {
  const books = state.books;
  const read = books.filter(b => b.status === 'read');
  const thisYear = new Date().getFullYear();
  const favs = books.filter(b => b.favourite);
  const avg = avgOf(read);

  const tiles = `<div class="stat-grid wide">
    <div class="stat"><div class="n">${read.length}</div><div class="l">Books read</div></div>
    <div class="stat"><div class="n">${read.filter(b => yearOf(b.dateFinished) === thisYear).length}</div><div class="l">Read in ${thisYear}</div></div>
    <div class="stat"><div class="n">${books.filter(b => b.status === 'reading').length}</div><div class="l">Currently reading</div></div>
    <div class="stat"><div class="n">${books.filter(b => b.status === 'want').length}</div><div class="l">Want to read</div></div>
    <div class="stat"><div class="n">${fmtAvg(avg)}${avg ? ' <span style="font-size:18px;color:var(--star)" aria-hidden="true">★</span>' : ''}</div><div class="l">Average rating</div></div>
    <div class="stat"><div class="n">${favs.length}</div><div class="l">Favourites</div></div>
  </div>`;

  if (read.length < 3) {
    host.innerHTML = `<div class="view"><h1 class="page-title">Your reading</h1>${tiles}
      <div class="empty"><div class="art">${I.stats}</div><h2>Keep reading</h2><p>Your statistics will start appearing as your library grows. Mark a few books as read to see trends, genres and favourites here.</p></div></div>`;
    return;
  }

  // ---- Trends ----
  const dated = read.filter(b => b.dateFinished);
  const years = [...new Set(dated.map(b => yearOf(b.dateFinished)))].sort((a, b) => a - b);
  if (!chosenYear || !years.includes(chosenYear)) chosenYear = years.includes(thisYear) ? thisYear : years[years.length - 1];
  let trends = '';
  if (dated.length) {
    const inYear = dated.filter(b => yearOf(b.dateFinished) === chosenYear);
    const months = MONTHS_SHORT.map((m, i) => ({ label: m[0], full: m, n: inYear.filter(b => Number(b.dateFinished.slice(5, 7)) === i + 1).length }));
    trends += `<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2>Books per month</h2>
      ${years.length > 1 ? `<label class="sr" for="yr">Year</label><select id="yr" class="select" style="width:auto;min-height:40px;padding:6px 10px">${years.slice().reverse().map(y => `<option${y === chosenYear ? ' selected' : ''}>${y}</option>`).join('')}</select>` : `<span class="count-line">${chosenYear}</span>`}</div>
      ${bars(months, `Books finished per month in ${chosenYear}`)}<div class="count-line">${plural(inYear.length, 'book')} finished in ${chosenYear}${avgOf(inYear) ? ` · average ${fmtAvg(avgOf(inYear))}★` : ''}</div></div>`;
    if (years.length > 1) {
      const span = years.slice(-8);
      trends += `<div class="panel"><h2>Books per year</h2>${bars(span.map(y => { const l = dated.filter(b => yearOf(b.dateFinished) === y); const a = avgOf(l); return { label: String(y).slice(2).padStart(3, "'"), full: String(y), n: l.length, extra: a ? a.toFixed(1) + '★' : '' }; }), 'Books finished per year')}
        <div class="count-line">Average rating shown under each year</div></div>`;
    }
  }
  const undated = read.length - dated.length;

  // ---- Ratings ----
  const ratingRows = [5, 4, 3, 2, 1].map(n => ({ n: read.filter(b => b.rating === n).length, stars: n }));
  const rmax = Math.max(1, ...ratingRows.map(r => r.n));
  const ratingsHTML = read.some(b => b.rating) ? `<div class="panel"><h2>Your ratings</h2>${hbars(ratingRows.map(r => ({ name: `<span style="color:var(--star)" aria-hidden="true">${'★'.repeat(r.stars)}</span><span class="sr">${r.stars} stars</span>`, right: plural(r.n, 'book'), n: r.n })), rmax)}</div>` : '';

  // ---- Genres (each genre on a book gets credit) ----
  const gmap = new Map();
  for (const b of read) for (const g of b.genres) { const n = genreName(g); if (!n) continue; if (!gmap.has(g)) gmap.set(g, { name: n, list: [] }); gmap.get(g).list.push(b); }
  const genres = [...gmap.entries()].map(([id, v]) => ({ id, name: v.name, n: v.list.length, avg: avgOf(v.list), rated: v.list.filter(b => b.rating).length })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const topRated = genres.filter(g => g.rated >= 2).sort((a, b) => b.avg - a.avg)[0];
  const genresHTML = genres.length ? `<div class="panel"><h2>Genres</h2>
    <div class="row2"><div><div class="count-line">Most read</div><div class="serif" style="font-size:20px;font-weight:600">${esc(genres[0].name)}</div></div>
    <div><div class="count-line">Highest rated</div><div class="serif" style="font-size:20px;font-weight:600">${topRated ? `${esc(topRated.name)} <span style="font-size:14px;color:var(--muted)">${fmtAvg(topRated.avg)}★</span>` : '–'}</div></div></div>
    ${hbars(genres.slice(0, 8).map(g => ({ name: `<a href="#/books?genre=${g.id}" style="color:inherit;text-decoration:none">${esc(g.name)}</a>`, right: `${plural(g.n, 'book')}${g.avg ? ` · ${fmtAvg(g.avg)}★` : ''}`, n: g.n })), genres[0].n)}
    ${genres.length > 8 ? `<div class="count-line">+ ${plural(genres.length - 8, 'more genre')}</div>` : ''}</div>` : '';

  // ---- Authors ----
  const amap = new Map();
  for (const b of read) { const k = b.author.trim().toLowerCase(); if (!k) continue; if (!amap.has(k)) amap.set(k, { name: b.author, list: [] }); amap.get(k).list.push(b); }
  const authors = [...amap.values()].map(a => ({ name: a.name, n: a.list.length, avg: avgOf(a.list) })).sort((a, b) => b.n - a.n || (b.avg || 0) - (a.avg || 0));
  const authorsHTML = authors.length && authors[0].n > 1 ? `<div class="panel"><h2>Authors</h2>${hbars(authors.slice(0, 6).map(a => ({ name: esc(a.name), right: `${plural(a.n, 'book')}${a.avg ? ` · ${fmtAvg(a.avg)}★` : ''}`, n: a.n })), authors[0].n)}</div>` : '';

  // ---- Fun facts ----
  const fun = [];
  const rated = read.filter(b => b.rating);
  const pick = (list, cmp) => list.slice().sort(cmp)[0];
  if (rated.length >= 2) {
    const hi = pick(rated, (a, b) => b.rating - a.rating || (b.dateFinished || '').localeCompare(a.dateFinished || ''));
    const lo = pick(rated, (a, b) => a.rating - b.rating || (b.dateFinished || '').localeCompare(a.dateFinished || ''));
    fun.push(['Highest rated', hi, starsText(hi.rating)]);
    if (lo.id !== hi.id && lo.rating < hi.rating) fun.push(['Lowest rated', lo, starsText(lo.rating)]);
  }
  const paged = read.filter(b => b.pageCount);
  if (paged.length >= 2) {
    const long = pick(paged, (a, b) => b.pageCount - a.pageCount), short = pick(paged, (a, b) => a.pageCount - b.pageCount);
    fun.push(['Longest book', long, `${long.pageCount} pages`]);
    if (short.id !== long.id) fun.push(['Shortest book', short, `${short.pageCount} pages`]);
  }
  const totalPages = paged.reduce((n, b) => n + b.pageCount, 0);
  const funHTML = fun.length || (authors[0]?.n > 1) ? `<div class="panel"><h2>Fun facts</h2><div class="fun">
    ${fun.map(([k, b, v]) => `<a class="fun-row" href="#/book/${b.id}" style="text-decoration:none">${coverHTML(b, 'xs')}<div style="min-width:0;flex:1"><div class="k">${k}</div><div class="v">${esc(b.title)}</div><div class="count-line">${v}</div></div></a>`).join('')}
    ${authors[0]?.n > 1 ? `<div class="fun-row"><span class="menu-item" style="padding:0;min-height:0;width:auto"><span class="ic" style="width:34px;height:34px">${I.user}</span></span><div><div class="k">Most-read author</div><div class="v">${esc(authors[0].name)}</div><div class="count-line">${plural(authors[0].n, 'book')}</div></div></div>` : ''}
    ${totalPages ? `<div class="fun-row"><span class="menu-item" style="padding:0;min-height:0;width:auto"><span class="ic" style="width:34px;height:34px">${I.bookOpen}</span></span><div><div class="k">Pages read</div><div class="v">${totalPages.toLocaleString('en-GB')}</div><div class="count-line">across ${plural(paged.length, 'book')} with a page count</div></div></div>` : ''}
  </div></div>` : '';

  const favHTML = favs.length ? `<div class="panel"><h2>Favourite books</h2><div class="cover-row" style="margin:0;padding:2px 0 6px">${favs.slice(0, 12).map(b => `<a class="cover-tile" href="#/book/${b.id}" style="text-decoration:none">${coverHTML(b, 'tile')}<div class="t">${esc(b.title)}</div></a>`).join('')}</div></div>` : '';

  host.innerHTML = `<div class="view"><h1 class="page-title">Your reading</h1>${tiles}${trends}
    ${undated ? `<p class="count-line" style="margin:-8px 0 0">${plural(undated, 'read book')} without a finish date ${undated === 1 ? "isn't" : "aren't"} included in the monthly and yearly charts.</p>` : ''}
    ${genresHTML}${ratingsHTML}${authorsHTML}${funHTML}${favHTML}</div>`;
  host.querySelector('#yr')?.addEventListener('change', e => { chosenYear = Number(e.target.value); host.innerHTML = ''; render(host); });
}

export default { render };

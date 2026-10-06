// Shows a shared Want to Read list from the data packed into the link (after "#").
import { unpack } from '../js/share.js';
import { esc, coverHTML, fmtDate, plural } from '../js/util.js';

const BG = { rose: '#FBEFF2', cream: '#F7F0E3', blue: '#EEF2FC' };
const grid = document.getElementById('w-grid'), title = document.getElementById('w-title'), lede = document.getElementById('w-lede');

async function show() {
  let d = null;
  try { d = await unpack(location.hash.slice(1)); } catch {}
  if (!d || !Array.isArray(d.b)) {
    title.textContent = "This link isn't complete";
    lede.textContent = 'Part of the link may have been cut off when it was copied. Ask for it to be sent again.';
    grid.innerHTML = '';
    return;
  }
  const theme = BG[d.p] ? d.p : 'rose';
  if (theme !== 'rose') document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', BG[theme]);
  const name = String(d.n || 'Beth').slice(0, 40);
  title.textContent = `${name}'s wishlist`;
  document.title = `${name}'s wishlist · Beth's Books`;
  const books = d.b.filter(x => Array.isArray(x) && typeof x[0] === 'string').slice(0, 300);
  lede.textContent = `${plural(books.length, 'book')} ${name} would love to read${d.d ? ` · shared ${fmtDate(d.d)}` : ''}`;
  grid.innerHTML = books.map(([t, a, c]) => {
    const t2 = String(t).slice(0, 200), a2 = String(a || '').slice(0, 120);
    let cover = null;
    if (Number.isInteger(c) && c > 0) cover = `https://covers.openlibrary.org/b/id/${c}-M.jpg`;
    else if (typeof c === 'string' && /^i97[89]\d{10}$/.test(c)) cover = `https://covers.openlibrary.org/b/isbn/${c.slice(1)}-M.jpg?default=false`;
    const q = encodeURIComponent(`${t2} ${a2}`.trim());
    return `<div class="wish-item">${coverHTML({ title: t2, author: a2, cover }, 'md')}
      <div><div class="t">${esc(t2)}</div>${a2 ? `<div class="a">${esc(a2)}</div>` : ''}</div>
      <a class="find" href="https://uk.bookshop.org/search?keywords=${q}" target="_blank" rel="noopener">Find it ›</a></div>`;
  }).join('') || '<p class="muted">This list is empty.</p>';
}
show();
window.addEventListener('hashchange', show);

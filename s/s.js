// Shows a shared book from the data packed into the link (after "#").
import { fromBase64Url } from '../js/share.js';
import { esc, coverHTML } from '../js/util.js';

const box = document.getElementById('book');
const BG = { rose: '#FBEFF2', cream: '#F7F0E3', blue: '#EEF2FC' };

function show() {
  let d = null;
  try { d = JSON.parse(fromBase64Url(location.hash.slice(1))); } catch {}
  if (!d || typeof d.t !== 'string' || !d.t) {
    box.innerHTML = `<h1 style="font-size:24px">This link isn't complete</h1><p class="muted" style="margin:0">Part of the link may have been cut off when it was copied. Ask for it to be sent again.</p>`;
    return;
  }
  const theme = BG[d.p] ? d.p : 'rose';
  if (theme !== 'rose') document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', BG[theme]);

  const title = String(d.t).slice(0, 300), author = String(d.a || '').slice(0, 200);
  const r = Number.isInteger(d.r) && d.r >= 1 && d.r <= 5 ? d.r : null;
  const cover = typeof d.c === 'string' && /^https:\/\/(covers\.openlibrary\.org|books\.google\.com|books\.googleusercontent\.com)\//.test(d.c) ? d.c : null;
  const review = typeof d.v === 'string' ? d.v.slice(0, 2100) : '';
  document.title = `${title}${author ? ' by ' + author : ''} · Beth's Books`;

  box.innerHTML = `<div class="hero">${coverHTML({ title, author, cover }, 'lg')}
      <div><h1>${esc(title)}</h1>${author ? `<div class="by">${esc(author)}</div>` : ''}
      ${r ? `<div class="stars"><span aria-hidden="true">${'★'.repeat(r)}${'☆'.repeat(5 - r)}</span><small>${r}/5</small><span class="sr">Beth rated it ${r} out of 5 stars</span></div>` : ''}</div></div>
    ${review ? `<div><div class="label">Beth's review</div><div class="review">${esc(review)}</div></div>` : ''}`;
}
show();
window.addEventListener('hashchange', show);

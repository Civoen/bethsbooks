// Share a book as a link. Everything needed to show the book (title, author, rating, review, cover)
// is packed into the part of the link after "#", so nothing is uploaded and the link works for anyone.
import { getBook, state } from './store.js';
import { toast } from './ui.js';

const MAX_REVIEW = 2000;

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

export function shareUrl(book) {
  let review = (book.review || '').trim();
  if (review.length > MAX_REVIEW) review = review.slice(0, MAX_REVIEW).trimEnd() + '…';
  const data = { t: book.title, a: book.author };
  if (book.rating) data.r = book.rating;
  if (review) data.v = review;
  if (book.cover) data.c = book.cover;
  let theme = 'rose';
  try { theme = localStorage.getItem('bb-theme') || 'rose'; } catch {}
  if (theme !== 'rose') data.p = theme;
  return new URL(`../s/#${toBase64Url(JSON.stringify(data))}`, import.meta.url).href;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  // Fallback for browsers that block the clipboard API.
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

/** Copy a share link for a book. On phones, also offers the system share sheet. */
export async function shareBook(id) {
  const b = getBook(id); if (!b) return;
  const url = shareUrl(b);
  const copied = await copyText(url);
  const canShare = typeof navigator.share === 'function';
  const openSheet = () => navigator.share({ title: `${b.title} by ${b.author}`, url }).catch(() => {});
  if (copied) toast('Link copied', canShare ? { action: 'Share…', onAction: openSheet } : {});
  else if (canShare) openSheet();
  else toast("Couldn't copy the link on this device");
}

// ---------- Wishlist (Want to Read list) ----------
const MAX_WISH = 250;

/** Pack data into a short link-safe string: deflate-compressed where the browser supports it. */
async function pack(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream === 'function') {
    try {
      const out = new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw')));
      const bytes = new Uint8Array(await out.arrayBuffer());
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return 'z' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch {}
  }
  return 'j' + toBase64Url(json);
}

/** Reverse of pack(). Throws if the data is damaged. */
export async function unpack(str) {
  if (str[0] === 'j') return JSON.parse(fromBase64Url(str.slice(1)));
  if (str[0] !== 'z') throw new Error('format');
  const s = str.slice(1);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
  return JSON.parse(await out.text());
}

/** Copy a link to Beth's Want to Read list, as a snapshot of how it looks right now. */
export async function shareWishlist() {
  const want = state.books.filter(b => b.status === 'want')
    .sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));
  if (!want.length) { toast('Your Want to Read list is empty'); return; }
  const list = want.slice(0, MAX_WISH).map(b => {
    const item = [b.title, b.author];
    const m = /covers\.openlibrary\.org\/b\/id\/(\d+)-/.exec(b.cover || '');
    if (m) item.push(Number(m[1])); // Open Library cover id (short)
    else if (b.isbn) item.push('i' + b.isbn);
    return item;
  });
  let theme = 'rose';
  try { theme = localStorage.getItem('bb-theme') || 'rose'; } catch {}
  const data = { n: state.settings.name || 'Beth', d: new Date().toISOString().slice(0, 10), b: list };
  if (theme !== 'rose') data.p = theme;
  const url = new URL(`../w/#${await pack(data)}`, import.meta.url).href;
  const copied = await copyText(url);
  const canShare = typeof navigator.share === 'function';
  const sheet = () => navigator.share({ title: `${data.n}'s wishlist`, url }).catch(() => {});
  const extra = want.length > MAX_WISH ? ` (the newest ${MAX_WISH})` : '';
  if (copied) toast(`Wishlist link copied${extra}`, canShare ? { action: 'Share…', onAction: sheet } : {});
  else if (canShare) sheet();
  else toast("Couldn't copy the link on this device");
}

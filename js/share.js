// Share a book as a link. Everything needed to show the book (title, author, rating, review, cover)
// is packed into the part of the link after "#", so nothing is uploaded and the link works for anyone.
import { getBook } from './store.js';
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

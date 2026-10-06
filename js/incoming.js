// Books shared into the app from another app (Android share sheet → Beth's Books).
// Chrome opens the app with ?title=…&text=…&url=…; this works out which book it is.
import { normaliseIsbn } from './util.js';

const GENERIC = /^(check out|have a look|look at|i found|shared|sent from)/i;

/** Pull an ISBN out of shared text or a link (Waterstones, Amazon, Bookshop.org, publisher sites…). */
export function findIsbn(...parts) {
  const all = parts.filter(Boolean).join(' ');
  // ISBN-13, with or without hyphens/spaces
  for (const m of all.matchAll(/97[89][\d\- ]{10,14}/g)) { const i = normaliseIsbn(m[0]); if (i) return i; }
  // Amazon book pages use the ISBN-10 as the product code: /dp/0571334652 or /gp/product/0571334652
  for (const m of all.matchAll(/\/(?:dp|gp\/product|ASIN)\/([0-9]{9}[0-9X])(?:[/?#]|$)/gi)) { const i = normaliseIsbn(m[1]); if (i) return i; }
  // "ISBN: 0-571-33465-2" written out in text
  for (const m of all.matchAll(/ISBN(?:-1[03])?:?\s*([0-9][\d\- ]{8,16}[\dX])/gi)) { const i = normaliseIsbn(m[1]); if (i) return i; }
  return null;
}

/** Turn a shop's page title into something searchable: "Klara and the Sun : Ishiguro, Kazuo: Amazon.co.uk: Books" → "Klara and the Sun Ishiguro, Kazuo". */
export function cleanTitle(s) {
  s = String(s || '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || GENERIC.test(s)) return '';
  s = s.split(/\s+[|•·]\s+|\s+[-–—]\s+(?=(?:Waterstones|Amazon|Goodreads|Bookshop|WHSmith|Blackwell|eBay|Google)\b)/i)[0];
  s = s.replace(/\b(Amazon(\.co)?\.?[a-z.]*|Goodreads|Waterstones|Bookshop\.org|Books?)\s*$/i, '');
  const parts = s.split(/\s*:\s*/).filter(p => p && !/^(amazon|books?|kindle edition|paperback|hardcover|hardback|\d{10,13})$/i.test(p) && !/amazon\./i.test(p));
  s = parts.slice(0, 2).join(' ');
  s = s.replace(/\((paperback|hardcover|hardback|kindle edition|ebook|audiobook)\)/gi, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 120);
}

/** If the app was opened by a share, return the screen to show (and tidy the address). */
export function takeIncomingShare() {
  const sp = new URLSearchParams(location.search);
  if (!sp.has('title') && !sp.has('text') && !sp.has('url')) return null;
  const title = sp.get('title') || '', text = sp.get('text') || '', url = sp.get('url') || '';
  const isbn = findIsbn(url, text, title);
  let target;
  if (isbn) target = `/scan?isbn=${isbn}`;
  else {
    const q = cleanTitle(title) || cleanTitle(text.replace(url, ''));
    target = `/add?mode=search&shared=1${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  }
  history.replaceState(null, '', location.pathname + '#' + target);
  return target;
}

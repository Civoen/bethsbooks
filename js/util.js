// Small shared helpers.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const nowISO = () => new Date().toISOString();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function yearOf(iso) { return iso ? Number(iso.slice(0, 4)) : null; }

/** Lowercase, strip accents/punctuation/leading articles — for duplicate detection and search. */
export function norm(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function titleKey(t) { return norm(t).replace(/^(the|a|an) /, ''); }
export function authorKey(a) {
  // "Tolkien, J.R.R." → "j r r tolkien"; also collapse initials spacing
  let s = String(a ?? '').trim();
  const m = s.match(/^([^,]+),\s*(.+)$/);
  if (m) s = `${m[2]} ${m[1]}`;
  return norm(s).replace(/\b(\w) (?=\w\b)/g, '$1');
}
export const dupKey = (b) => titleKey(b.title) + '|' + authorKey(b.author);

export function greeting(name) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

export function longDate() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Generated cover colours for books without an image.
const COVER_COLOURS = [
  ['#7A3E5C', '#FCEEF4'], ['#C25B86', '#FFF4F9'], ['#E8A0B4', '#4A1F30'], ['#9E6B8F', '#FFF4FA'],
  ['#5E4636', '#F7EFE4'], ['#96593A', '#FFF3EA'], ['#D9B48F', '#3E2A18'], ['#8E5B4A', '#FBF0EA'],
  ['#2E3E6E', '#EEF2FC'], ['#5A6FB8', '#F4F7FF'], ['#8FA7C9', '#1F2542'], ['#5A5F9E', '#F3F4FF'],
];
export function coverColour(title) {
  let h = 0; const s = norm(title);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COVER_COLOURS[h % COVER_COLOURS.length];
}

export function coverHTML(book, size = 'md') {
  const [bg, fg] = coverColour(book.title);
  const img = book.cover ? `<img src="${esc(book.cover)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="cover ${size}" style="--c:${bg};--ct:${fg}" aria-hidden="true"><div class="ct">${esc(book.title)}</div><div class="ca">${esc(book.author)}</div>${img}</div>`;
}

export function starsText(r) {
  if (!r) return '';
  return `<span class="stars-static"><span aria-hidden="true">${'★'.repeat(r)}${'☆'.repeat(5 - r)}</span><span class="sr">${r} out of 5 stars</span></span>`;
}

export const STATUS = {
  want: { label: 'Want to Read', short: 'Want to read', badge: 'Want' },
  reading: { label: 'Currently Reading', short: 'Reading', badge: 'Reading' },
  read: { label: 'Read', short: 'Read', badge: 'Read' },
};
export const badgeHTML = (s) => `<span class="badge ${s}">${STATUS[s].badge}</span>`;

export function pct(book) {
  if (book.status === 'read') return 100;
  if (!book.pageCount || !book.currentPage) return 0;
  return Math.max(0, Math.min(100, Math.round(book.currentPage / book.pageCount * 100)));
}

export function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/** Resize an image file to a small JPEG data URL suitable for local storage. */
export function resizeImage(file, maxW = 360) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

export function download(filename, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let xlsxPromise = null;
/** Lazy-load the spreadsheet library only when it is needed. */
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/xlsx.full.min.js', import.meta.url).href; // works from any page
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxPromise = null; reject(new Error('xlsx')); };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

// ---- Icons (inline SVG, stroke based) ----
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const I = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  books: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.2"'),
  stats: svg('<path d="M5 20V11M12 20V4M19 20v-6"/>'),
  more: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`,
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  heartFill: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`,
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>', 'stroke-width="2"'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2"'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  filter: svg('<path d="M4 6h16M7 12h10M10 18h4"/>', 'stroke-width="2"'),
  chev: svg('<path d="m9 6 6 6-6 6"/>', 'stroke-width="2"'),
  check: svg('<path d="m5 12 5 5 9-10"/>', 'stroke-width="2.4"'),
  bookOpen: svg('<path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"/>'),
  bookmark: svg('<path d="M6 3h12v18l-6-4-6 4z"/>'),
  sheet: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>'),
  pen: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  downloadI: svg('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  shelf: svg('<path d="M3 20h18M5 20V6h3v14M10 20V4h3v16M15 20l2.5-13 3 .6L18 20"/>'),
  tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.7 0-1.3-1-1.6-1-2.6 0-.9.7-1.7 1.7-1.7H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  refresh: svg('<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/>'),
  phone: svg('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>'),
  share: svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>'),
  minus: svg('<path d="M5 12h14"/>', 'stroke-width="2.2"'),
  database: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
};

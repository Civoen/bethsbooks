// Scan a book's barcode (ISBN) with the phone camera, check the library, then look it up online.
// Uses Chrome's built-in BarcodeDetector (Android). Anywhere it isn't available, the ISBN can be typed instead.
import { state, addBook, findDuplicate, updateBook } from '../store.js';
import { esc, I, coverHTML, badgeHTML, starsText, fmtDate, STATUS, normaliseIsbn } from '../util.js';
import { toast, safely } from '../ui.js';
import { tap, petals } from '../fx.js';
import formView from './form.js';

const pretty = (isbn) => isbn.replace(/^(\d{3})(\d)(\d{4})(\d{4})(\d)$/, '$1-$2-$3-$4-$5');

// ---------- Online lookup ----------
async function getJSON(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('lookup ' + res.status);
  return res.json();
}

/** Look an ISBN up on Open Library, then Google Books. Returns { title, author, pageCount, cover } or null. */
export async function lookupIsbn(isbn) {
  // 1. Open Library search (title, authors, cover and page count in one request)
  try {
    const d = await getJSON(`https://openlibrary.org/search.json?isbn=${isbn}&limit=1&fields=title,author_name,cover_i,number_of_pages_median`);
    const doc = d?.docs?.[0];
    if (doc?.title) {
      return {
        title: doc.title, author: (doc.author_name || []).slice(0, 2).join(' & '),
        pageCount: doc.number_of_pages_median || null,
        cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
      };
    }
  } catch {}
  // 2. Open Library edition record
  try {
    const ed = await getJSON(`https://openlibrary.org/isbn/${isbn}.json`);
    if (ed?.title) {
      let author = '';
      const key = ed.authors?.[0]?.key;
      if (key) { try { author = (await getJSON(`https://openlibrary.org${key}.json`))?.name || ''; } catch {} }
      return { title: ed.title, author, pageCount: ed.number_of_pages || null, cover: ed.covers?.[0] > 0 ? `https://covers.openlibrary.org/b/id/${ed.covers[0]}-M.jpg` : null };
    }
  } catch {}
  // 3. Google Books (better for some UK editions)
  try {
    const g = await getJSON(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    const v = g?.items?.[0]?.volumeInfo;
    if (v?.title) {
      const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail;
      return {
        title: v.subtitle && v.title.length < 20 ? `${v.title}: ${v.subtitle}` : v.title,
        author: (v.authors || []).slice(0, 2).join(' & '), pageCount: v.pageCount || null,
        cover: img ? img.replace(/^http:/, 'https:').replace('&edge=curl', '') : null,
      };
    }
  } catch {}
  return null;
}

// ---------- Camera ----------
let stream = null, timer = null, stopped = true, session = 0;

function stopCamera() {
  stopped = true;
  session++; // any camera start still in progress is abandoned
  clearTimeout(timer); timer = null;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopCamera(); });

export const canScan = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

// ---------- Screens ----------
let host = null;

function render(h, r) {
  host = h;
  const shared = normaliseIsbn(r?.query?.isbn);
  if (shared) { found(shared); return; }
  if (canScan()) startScanner(); else showManual("This phone's browser can't scan barcodes, but you can type the ISBN from the back of the book.");
}

function close() {
  stopCamera();
  if (window.__bbNav > 0) history.back(); else location.hash = '#/home';
}

async function startScanner(note = '') {
  host.innerHTML = `<div class="scanner" role="dialog" aria-label="Scan a barcode">
    <video id="sc-video" playsinline muted autoplay></video>
    <div class="scan-shade"></div>
    <div class="scan-top"><button class="icon-btn scan-btn" data-a="close" aria-label="Close scanner">${I.close}</button>
      <button class="icon-btn scan-btn" data-a="torch" aria-label="Turn on the torch" hidden>${I.bulb}</button></div>
    <div class="scan-frame" aria-hidden="true"><span class="scan-line"></span></div>
    <div class="scan-bottom">
      <p class="scan-hint" id="sc-hint" aria-live="polite">${esc(note || 'Point the camera at the barcode on the back of the book')}</p>
      <button class="btn btn-soft" data-a="manual">${I.pen} Type the ISBN instead</button>
    </div></div>`;
  host.onclick = onScannerClick;
  const video = host.querySelector('#sc-video'), hint = host.querySelector('#sc-hint');

  let detector;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(f => supported.includes(f));
    if (!formats.includes('ean_13')) throw new Error('no ean');
    detector = new BarcodeDetector({ formats });
  } catch {
    showManual("This phone can't read book barcodes, but you can type the ISBN from the back of the book."); return;
  }

  let s;
  stopCamera();
  const mine = session;
  try {
    s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    if (mine !== session) return;
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    showManual(denied
      ? "The camera isn't allowed for Beth's Books. To scan, tap the icon left of the address in Chrome (or long-press the app icon → App info), choose Permissions → Camera → Allow, then try again."
      : "The camera couldn't start. Close any other app using it and try again, or type the ISBN instead.", true);
    return;
  }
  // Closed or restarted while the camera was starting: release it and stop here.
  if (mine !== session || !video.isConnected) { s.getTracks().forEach(t => t.stop()); return; }
  stream = s;
  video.srcObject = s;
  stopped = false;
  try { await video.play(); } catch {}
  if (mine !== session) return;

  // Torch, where the phone supports it
  const track = s.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() || {};
  if (caps.torch) {
    const btn = host.querySelector('[data-a="torch"]'); btn.hidden = false;
    let on = false;
    btn.onclick = async (e) => { e.stopPropagation(); on = !on; try { await track.applyConstraints({ advanced: [{ torch: on }] }); btn.classList.toggle('on', on); btn.setAttribute('aria-label', on ? 'Turn off the torch' : 'Turn on the torch'); } catch {} };
  }

  let warned = false;
  const tick = async () => {
    if (stopped || mine !== session) return;
    try {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video);
        if (mine !== session) return;
        for (const c of codes) {
          const isbn = normaliseIsbn(c.rawValue);
          if (isbn) { tap(30); stopCamera(); found(isbn); return; }
        }
        if (codes.length && !warned) { warned = true; hint.textContent = "That's not a book barcode. Try the one on the back cover, usually starting 978."; }
      }
    } catch {}
    timer = setTimeout(tick, 120);
  };
  tick();
}

function onScannerClick(e) {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'close') close();
  if (a === 'manual') { stopCamera(); showManual(); }
}

function showManual(message = '', isError = false) {
  stopCamera();
  host.innerHTML = `<div class="view">
    <div class="topbar"><button class="icon-btn" data-a="close" aria-label="Back">${I.back}</button><span class="grow"></span></div>
    <h1 class="page-title">${canScan() ? 'Type the ISBN' : 'Look up by ISBN'}</h1>
    ${message ? `<div class="notice ${isError ? 'bad' : ''}">${I.info}<span>${esc(message)}</span></div>` : ''}
    <form class="form" novalidate id="isbn-form">
      <div class="field"><label for="isbn">ISBN</label><input id="isbn" class="input" inputmode="numeric" autocomplete="off" placeholder="978…" maxlength="17" autofocus>
        <span class="hint">The 10 or 13 digits printed above or below the barcode.</span><div class="err-msg" id="isbn-err" hidden>That isn't a valid ISBN — check the digits and try again.</div></div>
      <button class="btn btn-primary" type="submit">${I.search} Look it up</button>
    </form>
    ${canScan() ? `<button class="btn btn-ghost" data-a="rescan">${I.camera} Scan instead</button>` : ''}
  </div>`;
  host.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'rescan') startScanner();
  };
  host.querySelector('#isbn-form').onsubmit = (e) => {
    e.preventDefault();
    const isbn = normaliseIsbn(host.querySelector('#isbn').value);
    host.querySelector('#isbn-err').hidden = !!isbn;
    if (isbn) found(isbn);
  };
  setTimeout(() => host.querySelector('#isbn')?.focus(), 50);
}

async function found(isbn) {
  // 1. Already in the library with this ISBN?
  const mine = state.books.find(b => b.isbn === isbn);
  if (mine) return showOwned(mine, isbn);
  host.innerHTML = `<div class="view"><div class="topbar"><button class="icon-btn" data-a="close" aria-label="Close">${I.close}</button><span class="grow"></span></div>
    <div class="empty"><div class="art">${I.search}</div><h2>Looking it up…</h2><p>ISBN ${pretty(isbn)}</p></div></div>`;
  host.onclick = (e) => { if (e.target.closest('[data-a="close"]')) close(); };
  if (!navigator.onLine) return showNotFound(isbn, "You're offline, so the book can't be looked up right now. You can add it by hand, or scan again when you're connected.");
  const info = await lookupIsbn(isbn);
  if (!host.isConnected) return;
  if (!info) return showNotFound(isbn);
  // 2. Same title and author already in the library (e.g. imported without an ISBN)?
  const dup = findDuplicate(info.title, info.author);
  if (dup) return showOwned(dup, isbn, info);
  showFound(isbn, info);
}

function bookSummary(b) {
  const bits = [badgeHTML(b.status)];
  if (b.rating) bits.push(starsText(b.rating));
  return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${bits.join('')}</div>`;
}

function showOwned(b, isbn, info) {
  const read = b.status === 'read';
  host.innerHTML = `<div class="view">
    <div class="topbar"><button class="icon-btn" data-a="close" aria-label="Close">${I.close}</button><span class="grow"></span></div>
    <div class="scan-answer ${read ? 'yes' : 'maybe'}"><span class="ic">${read ? I.check : I.bookmark}</span>
      <b>${read ? "Yes — you've read this" : b.status === 'reading' ? "You're reading this now" : "It's already on your Want to Read list"}</b></div>
    <div class="detail-hero">${coverHTML(b, 'lg')}<div class="ti"><h1>${esc(b.title)}</h1><div class="by">${esc(b.author)}</div>${bookSummary(b)}
      ${read && b.dateFinished ? `<div class="count-line">Finished ${fmtDate(b.dateFinished)}</div>` : ''}</div></div>
    ${b.review ? `<div class="panel"><h2>Your review</h2><div class="review">${esc(b.review)}</div></div>` : ''}
    <div class="sheet-actions"><a class="btn btn-primary" href="#/book/${b.id}">${I.books} Open book</a><button class="btn btn-outline" data-a="again">${I.camera} Scan another</button></div>
  </div>`;
  if (read) petals(14);
  // Remember the ISBN on the book (and fill in anything missing) so the next scan matches instantly.
  const patch = {};
  if (!b.isbn) patch.isbn = isbn;
  if (info?.pageCount && !b.pageCount) patch.pageCount = info.pageCount;
  if (info?.cover && !b.cover) { patch.cover = info.cover; patch.coverChecked = true; }
  if (Object.keys(patch).length) safely(() => updateBook(b.id, patch));
  host.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'again') startScanner();
  };
}

function showFound(isbn, info) {
  const book = { title: info.title, author: info.author || 'Unknown author', cover: info.cover };
  host.innerHTML = `<div class="view">
    <div class="topbar"><button class="icon-btn" data-a="close" aria-label="Close">${I.close}</button><span class="grow"></span></div>
    <div class="scan-answer new"><span class="ic">${I.plus}</span><b>Not in your library yet</b></div>
    <div class="detail-hero">${coverHTML(book, 'lg')}<div class="ti"><h1>${esc(book.title)}</h1><div class="by">${esc(book.author)}</div>
      <div class="count-line">${[info.pageCount ? `${info.pageCount} pages` : '', `ISBN ${pretty(isbn)}`].filter(Boolean).join(' · ')}</div></div></div>
    <div class="section"><div class="section-head"><h2>Add it as</h2></div>
      <div class="add-as">
        <button class="btn btn-primary" data-add="want">${I.bookmark} Want to read</button>
        <button class="btn btn-soft" data-add="reading">${I.bookOpen} Reading</button>
        <button class="btn btn-soft" data-add="read">${I.check} Read</button>
      </div></div>
    <button class="btn btn-ghost" data-a="edit">${I.edit} Check the details first</button>
    <button class="btn btn-ghost" data-a="again">${I.camera} Scan another</button>
  </div>`;
  const data = { title: book.title, author: book.author, pageCount: info.pageCount, cover: info.cover, coverChecked: true, isbn };
  host.onclick = async (e) => {
    const add = e.target.closest('[data-add]')?.dataset.add;
    if (add === 'read') { openForm({ ...data, status: 'read' }); return; } // so she can rate and review it
    if (add) {
      tap();
      const saved = await safely(() => addBook({ ...data, status: add }), "We couldn't save that book. Please try again.");
      if (!saved) return;
      toast(`Added “${saved.title}” to ${STATUS[add].label}`, { action: 'Open', onAction: () => { location.hash = '#/book/' + saved.id; } });
      startScanner('Added! Scan another book, or close the scanner.');
      return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'again') startScanner();
    if (a === 'edit') openForm(data);
  };
}

function showNotFound(isbn, message) {
  host.innerHTML = `<div class="view">
    <div class="topbar"><button class="icon-btn" data-a="close" aria-label="Close">${I.close}</button><span class="grow"></span></div>
    <div class="empty"><div class="art">${I.search}</div><h2>${message ? "Can't look it up" : 'Book not found'}</h2>
      <p>${esc(message || `We couldn't find ISBN ${pretty(isbn)} online. It may be a very new or unusual edition.`)}</p>
      <button class="btn btn-primary" data-a="manual-add">${I.pen} Add it by hand</button>
      <button class="btn btn-ghost" data-a="again">${I.camera} Scan another</button></div></div>`;
  host.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'again') startScanner();
    if (a === 'manual-add') openForm({ isbn });
  };
}

function openForm(prefill) {
  stopCamera();
  // Show the add form's address, so choosing "Scan a barcode" again opens the scanner.
  try { history.replaceState(history.state, '', '#/add'); } catch {}
  host.onclick = null;
  host.innerHTML = '';
  const fresh = document.createElement('div');
  host.appendChild(fresh);
  formView.render(fresh, { path: '/add', params: [], query: {}, _prefill: prefill });
  window.scrollTo(0, 0);
}

export default { render, leave: stopCamera, live: false };
export { normaliseIsbn };

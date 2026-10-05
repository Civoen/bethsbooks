// Spreadsheet import, spreadsheet export, JSON backup and restore.
import { state, cleanBook, ensureGenre, createShelf, bulkPutBooks, snapshot, saveSettings, replaceAllData, mergeData, genreName, shelfName, MAX_GENRES } from '../store.js';
import { esc, I, uid, nowISO, todayISO, dupKey, norm, plural, download, loadXLSX, STATUS, starsText } from '../util.js';
import { openSheet, closeSheet, confirmDialog, toast, safely } from '../ui.js';

// ================= Export =================
function rowsForExport() {
  return state.books.slice().sort((a, b) => a.title.localeCompare(b.title)).map(b => ({
    Title: b.title,
    Author: b.author,
    Status: STATUS[b.status].label,
    Genres: b.genres.map(genreName).filter(Boolean).join(', '),
    Rating: b.rating ?? '',
    Review: b.review || '',
    Favourite: b.favourite ? 'Yes' : '',
    Shelves: b.shelves.map(shelfName).filter(Boolean).join(', '),
    Pages: b.pageCount ?? '',
    'Current page': b.status === 'reading' ? (b.currentPage ?? '') : '',
    'Date added': (b.dateAdded || '').slice(0, 10),
    'Date started': b.dateStarted || '',
    'Date finished': b.dateFinished || '',
  }));
}
const stamp = () => todayISO();

export async function exportCSV() {
  const rows = rowsForExport();
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
  download(`bethsbooks-${stamp()}.csv`, csv, 'text/csv;charset=utf-8');
  toast(`Exported ${plural(rows.length, 'book')} to CSV`);
}

export async function exportXLSX() {
  const rows = rowsForExport();
  if (!rows.length) return;
  let XLSX;
  try { XLSX = await loadXLSX(); } catch { toast("The Excel exporter couldn't load. Try CSV instead."); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 36 }, { wch: 24 }, { wch: 18 }, { wch: 26 }, { wch: 7 }, { wch: 60 }, { wch: 10 }, { wch: 26 }, { wch: 7 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Library');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(`bethsbooks-${stamp()}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  toast(`Exported ${plural(rows.length, 'book')} to Excel`);
}

export async function exportBackup() {
  const data = snapshot();
  download(`bethsbooks-backup-${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
  await safely(() => saveSettings({ lastBackup: todayISO() }));
  toast('Backup downloaded — keep it somewhere safe');
}

// ================= Restore =================
function pickFile(accept) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.style.display = 'none';
    inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

export async function pickRestore() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.books)) throw new Error('shape');
  } catch {
    openSheet({ title: "That file can't be restored", sub: "It doesn't look like a Beth's Books backup. Choose a .json file made with “Download full backup”.", body: `<button class="btn btn-primary btn-block" data-x>OK</button>`, onMount: el => el.querySelector('[data-x]').onclick = () => closeSheet() });
    return;
  }
  const n = data.books.length, cur = state.books.length;
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'an unknown date';
  openSheet({
    title: 'Restore backup',
    sub: `This backup from ${esc(when)} has ${plural(n, 'book')}. You currently have ${plural(cur, 'book')} on this device.`,
    body: `<div class="menu">
      <button class="menu-item" data-a="merge"><span class="ic">${I.refresh}</span><span class="tx"><b>Merge with my library</b><span>Adds missing books; keeps the most recently edited version of each</span></span></button>
      <button class="menu-item danger" data-a="replace"><span class="ic">${I.alert}</span><span class="tx"><b>Replace my library</b><span>Everything on this device is swapped for the backup</span></span></button></div>
      <button class="btn btn-outline btn-block" data-a="cancel">Cancel</button>`,
    onMount: el => el.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'cancel') return closeSheet();
      if (a === 'merge') {
        closeSheet();
        const res = await safely(() => mergeData(data), "We couldn't restore that backup. Your library hasn't changed.");
        if (res) toast(`Merged: ${res.added} added, ${res.updated} updated, ${res.kept} unchanged`, { timeout: 6000 });
      }
      if (a === 'replace') {
        const ok = await confirmDialog({ title: 'Replace your whole library?', message: `Your ${plural(cur, 'current book')} will be replaced by the ${plural(n, 'book')} in the backup. This can't be undone.`, confirmLabel: 'Replace', danger: true });
        if (!ok) return;
        const done = await safely(async () => { await replaceAllData(data); return true; }, "We couldn't restore that backup. Your library hasn't changed.");
        if (done) { toast(`Restored ${plural(n, 'book')}`); location.hash = '#/home'; }
      }
    }),
  });
}

// ================= Spreadsheet import =================
const FIELDS = [
  ['title', 'Title', ['title', 'book title', 'book', 'name', 'book name'], true],
  ['author', 'Author', ['author', 'authors', 'author name', 'writer', 'by', 'author l f'], true],
  ['genre', 'Genre', ['genre', 'genres', 'category', 'categories', 'type']],
  ['rating', 'Rating', ['rating', 'my rating', 'stars', 'score', 'rated']],
  ['review', 'Review', ['review', 'my review', 'notes', 'comments', 'comment', 'thoughts', 'private notes']],
  ['status', 'Status', ['status', 'reading status', 'exclusive shelf', 'read status', 'state']],
  ['favourite', 'Favourite', ['favourite', 'favorite', 'fav', 'favourites', 'favorites', 'loved']],
  ['shelves', 'Shelves', ['shelves', 'shelf', 'bookshelves', 'collections', 'collection', 'lists', 'tags']],
  ['pageCount', 'Pages', ['pages', 'page count', 'number of pages', 'no of pages', 'length']],
  ['dateFinished', 'Date finished', ['date read', 'date finished', 'finished', 'read date', 'completed', 'date completed', 'finished on', 'read on']],
  ['dateStarted', 'Date started', ['date started', 'started', 'start date', 'started on']],
];

function autoMap(headers) {
  const map = {};
  const used = new Set();
  const H = headers.map(h => norm(h));
  for (const [key, , syn] of FIELDS) {
    let idx = H.findIndex((h, i) => !used.has(i) && syn.includes(h));
    if (idx < 0) idx = H.findIndex((h, i) => !used.has(i) && h && syn.some(s => s.length > 3 && h.includes(s)));
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  // Goodreads exports both "Author" and "Author l-f"; prefer plain "Author".
  return map;
}

function parseRating(v) {
  if (v === '' || v == null) return { value: null };
  if (typeof v === 'number') {
    if (v === 0) return { value: null };
    if (v >= 1 && v <= 5) return Number.isInteger(v) ? { value: v } : { value: Math.round(v), note: `rounded ${v} to ${Math.round(v)}` };
    return { value: null, bad: String(v) };
  }
  const s = String(v).trim();
  const starCount = (s.match(/★|⭐|\*/g) || []).length;
  if (starCount && !/\d/.test(s)) return starCount <= 5 ? { value: starCount } : { value: null, bad: s };
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:\/\s*5|out of 5|stars?)?$/i);
  if (m) return parseRating(Number(m[1].replace(',', '.')));
  return { value: null, bad: s };
}

function parseStatus(v, fallback) {
  const s = norm(v);
  if (!s) return fallback;
  if (/^(read|finished|done|completed|yes|y)$/.test(s)) return 'read';
  if (/(currently|reading|in progress|started)/.test(s)) return 'reading';
  if (/(to read|want|tbr|wishlist|to be read|not started|unread|no)/.test(s)) return 'want';
  return fallback;
}

const truthy = (v) => /^(y|yes|true|1|x|♥|❤|❤️|fav|favourite|favorite|✓|✔)$/i.test(String(v ?? '').trim());

function parseDate(v) {
  if (!v) return null;
  // Spreadsheet dates can land a few seconds before midnight; nudge to midday before reading the day.
  if (v instanceof Date && !isNaN(v)) v = new Date(v.getTime() + 12 * 3600e3);
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // 2024-03-14 or 2024/03/14
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); // UK: 14/03/2024
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return +m[2] > 12 ? valid(y, +m[1], +m[2]) : valid(y, +m[2], +m[1]); }
  if (/^\d{4}$/.test(s)) return valid(+s, 1, 1);
  const d = new Date(s);
  if (isNaN(d)) return null;
  return valid(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function valid(y, mo, d) { if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }

const splitList = (v) => String(v ?? '').split(/[,;|/\n]+/).map(s => s.trim()).filter(Boolean);

let wiz = null; // import wizard state

function render(host, r) {
  wiz = { standalone: !!r?.standalone, step: 1, file: null, wb: null, sheet: null, headers: [], rows: [], map: {}, defaultStatus: 'read', dupAction: 'skip', plan: null, result: null };
  draw(host);
}

function stepsBar() { return `<div class="steps" aria-hidden="true">${[1, 2, 3, 4].map(n => `<span class="${wiz.step >= n ? 'on' : ''}"></span>`).join('')}</div>`; }

function draw(host) {
  const app = wiz.standalone ? '../' : ''; // where the main app lives, relative to this page
  const top = wiz.standalone
    ? `<div class="topbar"><a class="btn btn-ghost btn-sm" href="${app}#/home">${I.back} Beth's Books</a><span class="grow"></span></div>`
    : `<div class="topbar"><button class="icon-btn" data-a="exit" aria-label="Close import">${I.close}</button><span class="grow"></span></div>`;
  if (wiz.step === 1) {
    host.innerHTML = `<div class="view">${top}<h1 class="page-title">Import from spreadsheet</h1>${stepsBar()}
      <p class="muted" style="margin:0">Bring in books from a CSV or Excel file. You'll match up the columns and check everything before anything is added. Books go into Beth's Books on this device and browser — open this page on the same phone she uses.</p>
      <label class="file-drop" id="drop"><span>${I.upload}</span><b>Choose a spreadsheet</b><span class="muted" style="font-size:13px">.xlsx, .xls or .csv</span>
        <input type="file" id="file" accept=".xlsx,.xls,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
      <div id="f-msg"></div>
      <div class="notice">${I.info}<span>Tip: a header row helps — e.g. <b>Title, Author, Genre, Rating, Review</b>. Several genres in one cell can be separated with commas.</span></div>
    </div>`;
    const fileIn = host.querySelector('#file');
    fileIn.addEventListener('change', () => fileIn.files[0] && readFile(host, fileIn.files[0]));
    const drop = host.querySelector('#drop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--primary)'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = ''; const f = e.dataTransfer.files[0]; if (f) readFile(host, f); });
  }
  if (wiz.step === 2) {
    const sample = (i) => { if (i == null) return ''; const v = wiz.rows.map(r => r[i]).find(x => x !== '' && x != null); return v == null ? '' : (v instanceof Date ? parseDate(v) : String(v)).slice(0, 40); };
    const sel = (key) => `<select class="select" data-map="${key}" aria-label="Column for ${key}"><option value="">Don't import</option>${wiz.headers.map((h, i) => `<option value="${i}"${wiz.map[key] === i ? ' selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}</select>`;
    host.innerHTML = `<div class="view">${top}<h1 class="page-title">Match your columns</h1>${stepsBar()}
      <p class="muted" style="margin:0"><b>${esc(wiz.file.name)}</b> · ${plural(wiz.rows.length, 'row')}${wiz.wb.SheetNames.length > 1 ? ` · sheet “${esc(wiz.sheet)}”` : ''}. We've matched what we could — adjust anything that looks wrong.</p>
      ${wiz.wb.SheetNames.length > 1 ? `<div class="field"><label for="sheet">Sheet</label><select id="sheet" class="select">${wiz.wb.SheetNames.map(n => `<option${n === wiz.sheet ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>` : ''}
      <div class="card" style="padding:8px 14px">${FIELDS.map(([key, label, , req]) => `<div class="map-row"><div class="f">${label}${req ? ' <span style="color:var(--danger)" aria-label="required">*</span>' : ''}<small>${esc(sample(wiz.map[key])) || '&nbsp;'}</small></div>${sel(key)}</div>`).join('')}</div>
      <div class="field"><label for="defst">${wiz.map.status != null ? 'Status for rows without one' : 'Import these books as'}</label>
        <select id="defst" class="select">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${wiz.defaultStatus === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select>
        <span class="hint">Your existing spreadsheet is books you've read, so “Read” is the default.</span></div>
      <div id="map-err"></div>
      <div class="form-actions"><button class="btn btn-outline" data-a="back">Back</button><button class="btn btn-primary" data-a="preview">Preview</button></div></div>`;
    host.querySelectorAll('[data-map]').forEach(s => s.addEventListener('change', () => { wiz.map[s.dataset.map] = s.value === '' ? undefined : Number(s.value); draw(host); }));
    host.querySelector('#defst').addEventListener('change', e => { wiz.defaultStatus = e.target.value; });
    host.querySelector('#sheet')?.addEventListener('change', e => { loadSheet(e.target.value); draw(host); });
  }
  if (wiz.step === 3) {
    const p = wiz.plan;
    const dupCount = p.dups.length;
    host.innerHTML = `<div class="view">${top}<h1 class="page-title">Check before importing</h1>${stepsBar()}
      <div class="stat-grid">
        <div class="stat"><div class="n">${p.items.length}</div><div class="l">Books found</div></div>
        <div class="stat"><div class="n">${dupCount}</div><div class="l">Possible duplicates</div></div>
        <div class="stat"><div class="n">${p.skipped.length}</div><div class="l">Rows skipped</div></div>
        <div class="stat"><div class="n">${p.warnings.length}</div><div class="l">Things to know</div></div>
      </div>
      ${dupCount ? `<div class="panel"><h2>Duplicates</h2><p style="margin:0">${plural(dupCount, 'book')} ${dupCount === 1 ? 'looks' : 'look'} like ${dupCount === 1 ? 'it is' : 'they are'} already in your library${p.dups.some(d => d.inFile) ? ' or appear twice in the file' : ''} — matched by title and author.</p>
        <div class="dup-choice" role="radiogroup" aria-label="What to do with duplicates">
          ${[['skip', 'Skip them', 'Keep what you already have'], ['update', 'Update existing', 'Fill in rating, review, genres and other details from the spreadsheet'], ['import', 'Import anyway', 'Add them as separate copies']].map(([v, l, d]) => `<label class="radio-row"><input type="radio" name="dup" value="${v}" ${wiz.dupAction === v ? 'checked' : ''}><span><b>${l}</b><br><span class="muted" style="font-size:13px">${d}</span></span></label>`).join('')}
        </div>
        <details><summary style="cursor:pointer;color:var(--primary);font-weight:600;min-height:44px;display:flex;align-items:center">Show duplicates</summary>${p.dups.slice(0, 50).map(d => `<div class="problem">Row ${d.row}: <b>${esc(d.title)}</b> — ${esc(d.author)}${d.inFile ? ' (repeated in the file)' : ''}</div>`).join('')}${p.dups.length > 50 ? `<div class="problem">…and ${p.dups.length - 50} more</div>` : ''}</details></div>` : ''}
      ${p.skipped.length ? `<div class="panel"><h2>Rows that will be skipped</h2>${p.skipped.slice(0, 30).map(s => `<div class="problem">Row ${s.row}: ${esc(s.why)}</div>`).join('')}${p.skipped.length > 30 ? `<div class="problem">…and ${p.skipped.length - 30} more</div>` : ''}</div>` : ''}
      ${p.warnings.length ? `<div class="panel"><h2>Things to know</h2>${summariseWarnings(p.warnings)}<details><summary style="cursor:pointer;color:var(--primary);font-weight:600;min-height:44px;display:flex;align-items:center">Show details</summary>${p.warnings.slice(0, 80).map(w => `<div class="problem">Row ${w.row} (${esc(w.title)}): ${esc(w.msg)}</div>`).join('')}${p.warnings.length > 80 ? `<div class="problem">…and ${p.warnings.length - 80} more</div>` : ''}</details></div>` : ''}
      <div class="panel"><h2>Example rows</h2>${p.items.slice(0, 5).map(it => `<div class="preview-row"><b class="serif" style="font-size:16px">${esc(it.book.title)}</b> <span class="muted">· ${esc(it.book.author)}</span><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px"><span class="badge ${it.book.status}">${STATUS[it.book.status].badge}</span>${it.book.rating ? starsText(it.book.rating) : ''}${it.genreNames.length ? `<span class="count-line">${esc(it.genreNames.join(', '))}</span>` : ''}</div>${it.book.review ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(it.book.review.slice(0, 120))}${it.book.review.length > 120 ? '…' : ''}</div>` : ''}</div>`).join('') || '<p class="muted" style="margin:0">No importable rows.</p>'}</div>
      <div class="form-actions"><button class="btn btn-outline" data-a="back">Back</button><button class="btn btn-primary" data-a="import" ${importCount() ? '' : 'disabled'}>${importLabel()}</button></div></div>`;
    host.querySelectorAll('input[name="dup"]').forEach(r => r.addEventListener('change', () => { wiz.dupAction = r.value; const btn = host.querySelector('[data-a="import"]'); btn.textContent = importLabel(); btn.disabled = !importCount(); }));
  }
  if (wiz.step === 4) {
    const r = wiz.result;
    host.innerHTML = `<div class="view">${stepsBar()}
      <div class="empty"><div class="art">${I.check}</div><h2>Import complete</h2>
        <p>${plural(r.added, 'book')} added${r.updated ? `, ${r.updated} updated` : ''}${r.skippedDups ? `, ${plural(r.skippedDups, 'duplicate')} skipped` : ''}${r.skippedRows ? `, ${plural(r.skippedRows, 'row')} couldn't be imported` : ''}.</p>
        <a class="btn btn-primary" href="${app}#/books">${I.books} See my books</a><a class="btn btn-ghost" href="${app}#/home">Go to Home</a></div>
      ${r.warnings ? `<div class="notice">${I.info}<span>${plural(r.warnings, 'book')} came in with a note (for example a rating that wasn't between 1 and 5, or more than ${MAX_GENRES} genres). You can tidy these up from each book's page.</span></div>` : ''}
    </div>`;
  }

  host.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'exit') {
      if (wiz.step === 2 || wiz.step === 3) { const ok = await confirmDialog({ title: 'Stop importing?', message: 'Nothing has been added yet.', confirmLabel: 'Stop', cancelLabel: 'Keep going' }); if (!ok) return; }
      if (window.__bbNav > 0) history.back(); else location.hash = '#/more';
    }
    if (a === 'back') { wiz.step--; draw(host); window.scrollTo(0, 0); }
    if (a === 'preview') {
      if (wiz.map.title == null || wiz.map.author == null) {
        host.querySelector('#map-err').innerHTML = `<div class="notice bad">${I.alert}<span>Please choose which columns hold the <b>title</b> and the <b>author</b>.</span></div>`; return;
      }
      wiz.plan = buildPlan(); wiz.step = 3; draw(host); window.scrollTo(0, 0);
    }
    if (a === 'import') {
      const btn = e.target.closest('button'); btn.disabled = true; btn.textContent = 'Importing…';
      const res = await safely(() => runImport(), "We couldn't finish the import. Nothing was changed — please try again.");
      if (!res) { btn.disabled = false; btn.textContent = importLabel(); return; }
      wiz.result = res; wiz.step = 4; draw(host); window.scrollTo(0, 0);
    }
  };
}

function summariseWarnings(ws) {
  const counts = {};
  for (const w of ws) counts[w.kind] = (counts[w.kind] || 0) + 1;
  const lines = {
    rating: (n) => `${plural(n, 'rating')} ${n === 1 ? "wasn't" : "weren't"} recognised (not between 1 and 5). Those books will come in without a rating.`,
    rounded: (n) => `${plural(n, 'half-star rating')} will be rounded to whole stars.`,
    genres: (n) => `${plural(n, 'book')} ${n === 1 ? 'has' : 'have'} more than ${MAX_GENRES} genres. The first ${MAX_GENRES} are kept; the rest are listed in the details below so nothing is lost silently.`,
    author: (n) => `${plural(n, 'row')} had no author and will be saved as “Unknown author”.`,
    date: (n) => `${plural(n, 'date')} couldn't be read and will be left blank.`,
    pages: (n) => `${plural(n, 'page count')} wasn't a number and will be left blank.`,
  };
  return Object.entries(counts).map(([k, n]) => `<div class="problem">${lines[k] ? lines[k](n) : `${n} × ${k}`}</div>`).join('');
}

function importLabel() {
  const n = importCount();
  if (n) return wiz.dupAction === 'update' && wiz.plan.dups.length ? 'Import & update' : `Import ${plural(n, 'book')}`;
  return 'Nothing new to import';
}

function importCount() {
  const p = wiz.plan; if (!p) return 0;
  return wiz.dupAction === 'skip' ? p.items.filter(i => !i.dupOf && !i.dupInFile).length : wiz.dupAction === 'update' ? p.items.filter(i => !i.dupInFile).length : p.items.length;
}

async function readFile(host, file) {
  const msg = host.querySelector('#f-msg');
  msg.innerHTML = `<p class="muted" style="margin:0">Reading ${esc(file.name)}…</p>`;
  try {
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const isText = /\.(csv|tsv|txt)$/i.test(file.name);
    let text = '';
    if (isText) {
      text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // older Excel "CSV" files
    }
    const wb = isText
      ? XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true })
      : XLSX.read(buf, { type: 'array', cellDates: true });
    wiz.file = file; wiz.wb = wb;
    const first = wb.SheetNames.find(n => { const ws = wb.Sheets[n]; return ws && ws['!ref']; }) || wb.SheetNames[0];
    loadSheet(first);
    if (!wiz.rows.length) { msg.innerHTML = `<div class="notice bad">${I.alert}<span>That spreadsheet looks empty. Check it has a header row and at least one book.</span></div>`; return; }
    wiz.step = 2; draw(host); window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    msg.innerHTML = `<div class="notice bad">${I.alert}<span>We couldn't read that file. Make sure it's an Excel (.xlsx) or CSV file and try again.</span></div>`;
  }
}

function loadSheet(name) {
  const XLSX = window.XLSX;
  const ws = wiz.wb.Sheets[name];
  wiz.sheet = name;
  const grid = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false }) : [];
  // Header = first row with at least two text cells (within the first 10 rows)
  let hi = grid.slice(0, 10).findIndex(r => r.filter(c => typeof c === 'string' && c.trim()).length >= 2);
  if (hi < 0) hi = 0;
  const width = Math.max(0, ...grid.map(r => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(grid[hi]?.[i] ?? '').trim());
  wiz.headers = headers;
  wiz.headerRow = hi;
  wiz.rows = grid.slice(hi + 1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
  wiz.map = autoMap(headers);
  if (wiz.map.title == null && wiz.map.author == null && width >= 2) { wiz.map.title = 0; wiz.map.author = 1; }
}

function buildPlan() {
  const m = wiz.map;
  const get = (row, key) => m[key] == null ? '' : row[m[key]];
  const existing = new Map(state.books.map(b => [dupKey(b), b]));
  const seen = new Set();
  const items = [], skipped = [], warnings = [], dups = [];
  wiz.rows.forEach((row, i) => {
    const rowNo = wiz.headerRow + i + 2; // 1-based spreadsheet row
    const title = String(get(row, 'title') ?? '').trim();
    let author = String(get(row, 'author') ?? '').trim();
    if (!title) { skipped.push({ row: rowNo, why: author ? `no title (author “${author}”)` : 'no title' }); return; }
    const warn = (kind, msg) => warnings.push({ row: rowNo, title, kind, msg });
    if (!author) { author = 'Unknown author'; warn('author', 'no author — saved as “Unknown author”'); }

    const r = parseRating(get(row, 'rating'));
    if (r.bad) warn('rating', `rating “${r.bad}” isn't between 1 and 5, so it was left out`);
    if (r.note) warn('rounded', r.note);

    let genreNames = [...new Set(splitList(get(row, 'genre')).map(g => g.charAt(0).toUpperCase() + g.slice(1)))];
    if (genreNames.length > MAX_GENRES) { warn('genres', `kept ${genreNames.slice(0, MAX_GENRES).join(', ')}; left out ${genreNames.slice(MAX_GENRES).join(', ')}`); genreNames = genreNames.slice(0, MAX_GENRES); }

    const status = m.status != null ? parseStatus(get(row, 'status'), wiz.defaultStatus) : wiz.defaultStatus;
    const rawFin = get(row, 'dateFinished'), rawStart = get(row, 'dateStarted');
    const dateFinished = parseDate(rawFin), dateStarted = parseDate(rawStart);
    if (rawFin && !dateFinished) warn('date', `finish date “${String(rawFin)}” wasn't recognised`);
    if (rawStart && !dateStarted) warn('date', `start date “${String(rawStart)}” wasn't recognised`);
    const rawPages = get(row, 'pageCount');
    const pageCount = parseInt(String(rawPages).replace(/[^\d]/g, ''), 10) || null;
    if (rawPages !== '' && !pageCount) warn('pages', `pages “${rawPages}” isn't a number`);

    const book = {
      title, author, status, rating: r.value, review: String(get(row, 'review') ?? '').trim(),
      favourite: m.favourite != null ? truthy(get(row, 'favourite')) : false,
      pageCount, dateStarted, dateFinished: status === 'read' ? dateFinished : null,
    };
    const shelfNames = m.shelves != null ? splitList(get(row, 'shelves')).filter(s => !/^(read|to-read|currently-reading)$/i.test(s)) : [];
    const key = dupKey(book);
    const item = { row: rowNo, book, genreNames, shelfNames, dupOf: existing.get(key) || null, dupInFile: seen.has(key) };
    if (item.dupOf || item.dupInFile) dups.push({ row: rowNo, title, author, inFile: item.dupInFile && !item.dupOf });
    seen.add(key);
    items.push(item);
  });
  return { items, skipped, warnings, dups };
}

async function runImport() {
  const p = wiz.plan;
  const act = wiz.dupAction;
  const genreIds = new Map(), shelfIds = new Map();
  const gid = async (n) => { const k = norm(n); if (!genreIds.has(k)) genreIds.set(k, await ensureGenre(n, { silent: true })); return genreIds.get(k); };
  const sid = async (n) => { const k = norm(n); if (!shelfIds.has(k)) shelfIds.set(k, await createShelf(n, { silent: true })); return shelfIds.get(k); };
  const out = [];
  let added = 0, updated = 0, skippedDups = 0;
  const now = nowISO();
  const touched = new Map(); // updated existing books, by id
  for (const it of p.items) {
    if ((it.dupOf || it.dupInFile) && act === 'skip') { skippedDups++; continue; }
    if (it.dupInFile && act === 'update' && !it.dupOf) { skippedDups++; continue; }
    const genres = []; for (const n of it.genreNames) genres.push(await gid(n));
    const shelves = []; for (const n of it.shelfNames) shelves.push(await sid(n));
    if (it.dupOf && act === 'update') {
      const base = touched.get(it.dupOf.id) || structuredClone(it.dupOf);
      const b = it.book;
      if (b.rating) base.rating = b.rating;
      if (b.review) base.review = b.review;
      if (genres.length) base.genres = [...new Set([...base.genres, ...genres])].slice(0, MAX_GENRES);
      if (shelves.length) base.shelves = [...new Set([...base.shelves, ...shelves])];
      if (b.favourite) base.favourite = true;
      if (b.pageCount) base.pageCount = b.pageCount;
      if (b.dateFinished) base.dateFinished = b.dateFinished;
      if (b.dateStarted) base.dateStarted = b.dateStarted;
      if (wiz.map.status != null) base.status = b.status;
      base.updatedAt = now;
      touched.set(base.id, base);
      continue;
    }
    out.push(cleanBook({ ...it.book, id: uid(), genres: genres.filter(Boolean), shelves: shelves.filter(Boolean), dateAdded: now, updatedAt: now }));
    added++;
  }
  updated = touched.size;
  await bulkPutBooks([...out, ...[...touched.values()].map(cleanBook)]);
  return { added, updated, skippedDups, skippedRows: p.skipped.length, warnings: new Set(p.warnings.filter(w => w.kind !== 'rounded').map(w => w.row)).size };
}

export default { render, live: false };

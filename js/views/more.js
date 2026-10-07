import { state, saveSettings, renameGenre, deleteGenre, ensureGenre, createShelf, renameShelf, deleteShelf, goalFor, isPersistent, clearAll } from '../store.js';
import { esc, I, plural, fmtDate } from '../util.js';
import { openSheet, closeSheet, confirmDialog, promptText, toast, safely } from '../ui.js';
import { openGoalSheet } from './detail.js';
import { installPrompt, promptInstall, PALETTES } from '../app.js';
import { exportCSV, exportXLSX, exportBackup, pickRestore } from './io.js';
import { shareWishlist } from '../share.js';
import * as sync from '../sync.js';
import { openSyncSetup } from '../syncui.js';
import { fillMissingCovers, retryAllCovers, coverProgress, onCoverProgress } from '../covers.js';

const VERSION = '1.6.1';

const item = (href, icon, title, sub, attrs = '') => `<${href ? `a href="${href}"` : `button ${attrs}`} class="menu-item"><span class="ic">${icon}</span><span class="tx"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</span><span class="chev">${I.chev}</span></${href ? 'a' : 'button'}>`;

function syncHTML() {
  if (!sync.enabled()) return item(null, I.refresh, 'Connect to online library', 'Sync books with the online library (e.g. after importing on a laptop)', 'data-a="sync-setup"');
  const st = sync.status.state;
  const dot = st === 'idle' ? 'ok' : st === 'syncing' || st === 'offline' ? 'warn' : 'bad';
  return `<div class="menu-item" style="cursor:default"><span class="ic">${I.refresh}</span><span class="tx"><b><span class="sync-dot ${dot}" aria-hidden="true"></span>Sync is on</b><span>${esc(sync.describe())}</span></span></div>
    ${st === 'unauthorised' ? item(null, I.alert, 'Enter the sync key again', 'The saved key was not accepted', 'data-a="sync-setup"') : item(null, I.refresh, 'Sync now', '', 'data-a="sync-now"')}
    ${item(null, I.close, 'Disconnect this device', 'Stop syncing here', 'data-a="sync-off"')}`;
}

function coverStatusHTML() {
  const without = state.books.filter(b => !b.cover).length;
  const p = coverProgress;
  if (p.running) return `<div class="cv-line"><span>Finding covers… ${p.done} of ${p.total}</span><span class="muted">${p.found} found</span></div><div class="progress"><span style="width:${p.total ? Math.round(p.done / p.total * 100) : 0}%"></span></div>`;
  return `<div class="cv-line"><span class="muted">${without ? `${plural(state.books.length - without, 'book')} with covers · ${without} without` : 'Every book has a cover'}</span>${without ? '<button class="btn btn-soft btn-sm" data-a="cv-retry">Find missing covers</button>' : ''}</div>`;
}

function renderMore(host) {
  const s = state.settings;
  const year = new Date().getFullYear();
  const goal = goalFor(year);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  host.innerHTML = `<div class="view"><h1 class="page-title">More</h1>
    <div class="settings-group"><h2>Library</h2><div class="card menu">
      ${item('#/shelves', I.shelf, 'Shelves', plural(state.shelves.length, 'shelf', 'shelves'))}
      ${item('#/genres', I.tag, 'Genres', plural(state.genres.length, 'genre'))}
      ${item(null, I.gift, 'Share wishlist', `${plural(state.books.filter(b => b.status === 'want').length, 'book')} on your Want to Read list`, 'data-a="wish"')}
      ${item('#/data', I.database, 'Export & backup', s.lastBackup ? `Last backup ${fmtDate(s.lastBackup)}` : 'No backup yet')}
    </div></div>
    <div class="settings-group"><h2>Online library</h2><div class="card menu">${syncHTML()}</div></div>
    <div class="settings-group"><h2>Reading</h2><div class="card menu">
      ${item(null, I.target, `${year} reading goal`, goal ? plural(goal, 'book') : 'Off', 'data-a="goal"')}
      ${item(null, I.user, 'Your name', esc(s.name || 'Not set') + ' · used in the greeting', 'data-a="name"')}
    </div></div>
    <div class="settings-group"><h2>Covers</h2><div class="card" style="padding:4px 10px">
      <label class="switch-row"><span><b>Find covers automatically</b><br><span class="muted" style="font-size:13px">Looks up each book on Open Library. Tap a book's cover to pick a different one.</span></span><span class="switch"><input type="checkbox" id="auto-cv" ${s.autoCovers !== false ? 'checked' : ''}><span></span></span></label>
      <div class="cover-status" id="cv-status" aria-live="polite">${coverStatusHTML()}</div>
    </div></div>
    <div class="settings-group"><h2 id="th-l">Colour palette</h2><div class="palettes" role="radiogroup" aria-labelledby="th-l">
      ${Object.entries(PALETTES).map(([v, p]) => `<label class="palette"><input type="radio" name="theme" value="${v}" ${(PALETTES[s.theme] ? s.theme : 'rose') === v ? 'checked' : ''}>
        <span class="sw" style="background:${p.bg}">${p.dots.map(c => `<i style="background:${c}"></i>`).join('')}</span><b>${p.name}</b><span class="tick" aria-hidden="true">${I.check}</span></label>`).join('')}
    </div></div>
    <div class="settings-group"><h2>App</h2><div class="card menu">
      ${standalone ? '' : installPrompt ? item(null, I.phone, "Install Beth's Books", 'Add it to your home screen', 'data-a="install"') : item(null, I.phone, "Install on your phone", 'How to add it to your home screen', 'data-a="install-help"')}
      <div class="menu-item" style="cursor:default"><span class="ic">${I.info}</span><span class="tx"><b>Stored on this device</b><span>${!isPersistent() ? "This browser isn't allowing storage — changes won't be kept." : sync.enabled() ? 'Works offline. Changes sync to the online library when you’re connected.' : 'Works offline. Your books stay on this device unless you connect the online library.'}</span></span></div>
      <div class="menu-item" style="cursor:default"><span class="ic">${I.bookOpen}</span><span class="tx"><b>Beth's Books</b><span>Version ${VERSION}</span></span></div>
    </div></div>
  </div>`;

  // Live progress while covers are being found
  const status = host.querySelector('#cv-status');
  const paint = () => { if (status.isConnected) status.innerHTML = coverStatusHTML(); };
  onCoverProgress(paint);

  host.addEventListener('change', async e => {
    if (e.target.name === 'theme') safely(() => saveSettings({ theme: e.target.value }));
    if (e.target.id === 'auto-cv') { await safely(() => saveSettings({ autoCovers: e.target.checked })); if (e.target.checked) fillMissingCovers(); }
  });
  host.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'goal') openGoalSheet();
    if (a === 'name') { const n = await promptText({ title: 'Your name', label: 'Name for the greeting', value: s.name || '' }); if (n) await safely(() => saveSettings({ name: n })); }
    if (a === 'install') promptInstall();
    if (a === 'cv-retry') {
      if (!navigator.onLine) { toast("You're offline. Try again when you're connected."); return; }
      const n = await safely(() => retryAllCovers());
      if (n) toast(`Looking for ${plural(n, 'cover')}…`);
    }
    if (a === 'wish') shareWishlist();
    if (a === 'sync-setup') { if (await openSyncSetup()) toast('Connected — your library is synced'); }
    if (a === 'sync-now') { await sync.syncNow(); toast(sync.status.state === 'idle' ? 'Synced' : sync.describe()); }
    if (a === 'sync-off') {
      const ok = await confirmDialog({ title: 'Disconnect this device?', message: 'Books stay on this device and in the online library, but changes here will stop syncing.', confirmLabel: 'Disconnect' });
      if (ok) { sync.disable(); toast('Sync turned off on this device'); }
    }
    if (a === 'install-help') openSheet({ title: 'Install on your phone', body: `<ol style="margin:0;padding-left:20px;line-height:1.7"><li>Open Beth's Books in <b>Chrome</b> on your Android phone.</li><li>Tap the <b>⋮</b> menu in the top corner.</li><li>Choose <b>Install app</b> (or <b>Add to Home screen</b>).</li><li>Open it from your home screen — it runs full-screen and works offline.</li></ol><button class="btn btn-primary btn-block" data-x>Got it</button>`, onMount: el => el.querySelector('[data-x]').onclick = () => closeSheet() });
  });
}

function renderManage(host, kind) {
  const isG = kind === 'genres';
  const list = isG ? state.genres : state.shelves;
  const count = (id) => state.books.filter(b => (isG ? b.genres : b.shelves).includes(id)).length;
  host.innerHTML = `<div class="view">
    <div class="topbar"><a class="icon-btn" href="#/more" aria-label="Back">${I.back}</a><span class="grow"></span></div>
    <div class="page-head"><h1 class="page-title">${isG ? 'Genres' : 'Shelves'}</h1><button class="btn btn-primary btn-sm" data-a="new">${I.plus} New</button></div>
    <p class="muted" style="margin:-10px 0 0">${isG ? 'Genres describe what a book is. Each book can have up to three.' : 'Shelves are your own collections. Deleting a shelf never deletes its books.'}</p>
    ${list.length ? `<div class="card" style="padding:2px 6px 2px 10px">${list.map(x => `<div class="manage-row">
        ${isG ? `<a class="nm" href="#/books?genre=${x.id}">${esc(x.name)}<small>${plural(count(x.id), 'book')}</small></a>` : `<a class="nm" href="#/shelf/${x.id}">${esc(x.name)}<small>${plural(count(x.id), 'book')}</small></a>`}
        <button class="icon-btn" data-ren="${x.id}" aria-label="Rename ${esc(x.name)}">${I.edit}</button>
        <button class="icon-btn" data-del="${x.id}" aria-label="Delete ${esc(x.name)}" style="color:var(--danger)">${I.trash}</button></div>`).join('')}</div>`
      : `<div class="empty"><div class="art">${isG ? I.tag : I.shelf}</div><h2>No ${kind} yet</h2><p>${isG ? 'Add genres when you add or edit a book, or create one here.' : 'Try “Holiday reads”, “Classics” or “Books to reread”.'}</p></div>`}
  </div>`;
  host.addEventListener('click', async e => {
    const nameOf = (id) => list.find(x => x.id === id)?.name;
    if (e.target.closest('[data-a="new"]')) {
      const n = await promptText({ title: isG ? 'New genre' : 'New shelf', label: 'Name', confirmLabel: 'Create', placeholder: isG ? 'e.g. Cosy mystery' : 'e.g. Holiday reads' });
      if (n) { await safely(() => isG ? ensureGenre(n) : createShelf(n)); toast(`${isG ? 'Genre' : 'Shelf'} created`); }
    }
    const ren = e.target.closest('[data-ren]');
    if (ren) {
      const n = await promptText({ title: `Rename ${isG ? 'genre' : 'shelf'}`, label: 'Name', value: nameOf(ren.dataset.ren) });
      if (n) await safely(() => isG ? renameGenre(ren.dataset.ren, n) : renameShelf(ren.dataset.ren, n));
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del, c = count(id);
      const ok = await confirmDialog({
        title: `Delete “${nameOf(id)}”?`,
        message: isG ? (c ? `It will be removed from ${plural(c, 'book')}. The books themselves are kept.` : 'No books use this genre.') : (c ? `The ${plural(c, 'book')} on this shelf will stay in your library.` : 'This shelf is empty.'),
        confirmLabel: 'Delete', danger: true,
      });
      if (ok) { await safely(() => isG ? deleteGenre(id) : deleteShelf(id)); toast(`${isG ? 'Genre' : 'Shelf'} deleted`); }
    }
  });
}

function renderData(host) {
  const s = state.settings;
  const n = state.books.length;
  host.innerHTML = `<div class="view">
    <div class="topbar"><a class="icon-btn" href="#/more" aria-label="Back">${I.back}</a><span class="grow"></span></div>
    <h1 class="page-title">Export & backup</h1>
    <div class="notice ${s.lastBackup ? 'ok' : ''}">${I.info}<span>${s.lastBackup ? `Last full backup: ${fmtDate(s.lastBackup)}.` : 'You haven’t made a backup yet.'} Your library lives on this device — a backup file lets you restore it on a new phone or after clearing your browser.</span></div>
    <div class="settings-group"><h2>Full backup</h2><div class="card menu">
      ${item(null, I.downloadI, 'Download full backup', 'Everything: books, shelves, goals, settings (.json)', 'data-a="backup"' + (n ? '' : ' disabled'))}
      ${item(null, I.refresh, 'Restore from backup', 'Choose a Beth’s Books .json file', 'data-a="restore"')}
    </div></div>
    <div class="settings-group"><h2>Spreadsheet</h2><div class="card menu">
      ${item(null, I.sheet, 'Export to Excel', 'Readable .xlsx of your library', 'data-a="xlsx"' + (n ? '' : ' disabled'))}
      ${item(null, I.sheet, 'Export to CSV', 'Works with any spreadsheet app', 'data-a="csv"' + (n ? '' : ' disabled'))}
    </div></div>
    <div class="settings-group"><h2>Danger zone</h2><div class="card menu">
      <button class="menu-item danger" data-a="clear"><span class="ic">${I.trash}</span><span class="tx"><b>Clear all data</b><span>Remove every book from this device</span></span></button>
    </div></div>
  </div>`;
  host.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'backup') await exportBackup();
    if (a === 'csv') await exportCSV();
    if (a === 'xlsx') await exportXLSX();
    if (a === 'restore') pickRestore();
    if (a === 'clear') {
      if (!n) { toast('Your library is already empty'); return; }
      const ok = await confirmDialog({ title: 'Clear all data?', message: `This permanently removes all ${plural(n, 'book')}, shelves, genres and goals from this device${sync.enabled() ? ' and from the online library' : ''}. Download a backup first if you might want them back.`, confirmLabel: 'Continue', danger: true });
      if (!ok) return;
      const typed = await promptText({ title: 'Are you sure?', label: 'Type DELETE to confirm', confirmLabel: 'Delete everything', placeholder: 'DELETE' });
      if (typed && typed.trim().toUpperCase() === 'DELETE') { await safely(() => clearAll()); toast('All data cleared'); location.hash = '#/home'; }
      else if (typed !== null) toast('Nothing was deleted');
    }
  });
}

function render(host, r) {
  if (r.path === '/genres') return renderManage(host, 'genres');
  if (r.path === '/shelves') return renderManage(host, 'shelves');
  if (r.path === '/data') return renderData(host);
  return renderMore(host);
}

export default { render };

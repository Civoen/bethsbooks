// One-off importer at /x — connects to Beth's online library, imports a spreadsheet, and syncs it up.
import * as store from '../js/store.js';
import * as sync from '../js/sync.js';
import { openSyncSetup } from '../js/syncui.js';
import io from '../js/views/io.js';
import { I, esc } from '../js/util.js';

const host = document.getElementById('host');

async function afterImport() {
  await sync.syncNow();
  return sync.status.state === 'idle'
    ? `<div class="notice ok" style="text-align:left">${I.check}<span>Uploaded to the online library. Beth's phone picks them up next time the app is open and online.</span></div>`
    : `<div class="notice bad" style="text-align:left">${I.alert}<span>Imported here, but the upload didn't finish (${esc(sync.describe())}). Keep this page open and reload it when you're back online — it will finish syncing.</span></div>`;
}

function showConnect(message = '') {
  host.innerHTML = `<div class="view">
    <h1 class="page-title">Import into Beth's Books</h1>
    <p class="muted" style="margin:0">This page adds books from a spreadsheet to Beth's online library. First, connect with the sync key.</p>
    ${message}
    <button class="btn btn-primary" id="connect">${I.refresh} Connect</button>
    <a class="btn btn-ghost" href="../#/home">${I.back} Open the app instead</a></div>`;
  host.querySelector('#connect').onclick = async () => {
    if (await openSyncSetup({ intro: 'Enter the sync key you set in Cloudflare (SYNC_KEY).' })) startWizard();
  };
}

function startWizard() { io.render(host, { standalone: true, afterImport }); }

try { await store.load(); } catch (e) { console.error(e); }
if (!store.isPersistent()) {
  host.innerHTML = `<div class="view"><h1 class="page-title">Can't import here</h1>
    <p class="muted">This browser isn't allowing the page to save data (it may be a private window). Open it in a normal browser window.</p></div>`;
} else if (!sync.enabled()) {
  showConnect();
} else {
  host.innerHTML = `<div class="view"><p class="muted">Getting the latest library…</p></div>`;
  await sync.syncNow();
  if (sync.status.state === 'unauthorised') { sync.disable(); showConnect(`<div class="notice bad">${I.alert}<span>The saved sync key is no longer accepted. Connect again.</span></div>`); }
  else startWizard();
}

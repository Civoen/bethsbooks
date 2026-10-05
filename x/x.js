// One-off importer at /x — reuses the app's import wizard and writes into the same IndexedDB library.
import * as store from '../js/store.js';
import io from '../js/views/io.js';

const host = document.getElementById('host');
try {
  await store.load();
} catch (e) {
  console.error(e);
}
if (!store.isPersistent()) {
  host.innerHTML = `<div class="view"><h1 class="page-title">Can't import here</h1>
    <p class="muted">This browser isn't allowing Beth's Books to save data (it may be a private window). Open this page in normal Chrome on Beth's phone.</p></div>`;
} else {
  io.render(host, { standalone: true });
}

// "Connect to Beth's online library" sheet, shared by the app and the /x importer.
import * as sync from './sync.js';
import { I, esc, plural } from './util.js';
import { openSheet, closeSheet } from './ui.js';

const REASONS = {
  'wrong-key': "That sync key wasn't accepted. Check it matches the SYNC_KEY set in Cloudflare.",
  'offline': "Couldn't reach the server. Check you're online and try again.",
  'not-configured': 'Sync isn’t set up on the server yet — the Cloudflare project needs the D1 database binding (DB) and the SYNC_KEY secret.',
  'server': 'The server had a problem. Try again in a moment.',
};

/** Ask for the sync key, check it, switch sync on and do the first sync. Resolves true when connected. */
export function openSyncSetup({ intro } = {}) {
  return new Promise(resolve => {
    let connected = false;
    openSheet({
      title: 'Connect to online library',
      sub: intro || 'Enter the sync key you set in Cloudflare. Books on this device are added to the online library, and everything there comes down here.',
      body: `<form class="form" novalidate id="sy-form">
        <div class="field"><label for="sy-key">Sync key</label><input id="sy-key" class="input" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" autofocus>
          <label class="switch-row" style="min-height:40px"><span class="muted" style="font-size:13px">Show key</span><span class="switch"><input type="checkbox" id="sy-show"><span></span></span></label></div>
        <div id="sy-msg" aria-live="polite"></div>
        <div class="sheet-actions"><button type="button" class="btn btn-outline" data-a="cancel">Cancel</button><button class="btn btn-primary" type="submit" id="sy-go">Connect</button></div></form>`,
      onMount: el => {
        const key = el.querySelector('#sy-key'), msg = el.querySelector('#sy-msg'), go = el.querySelector('#sy-go');
        el.querySelector('#sy-show').addEventListener('change', e => { key.type = e.target.checked ? 'text' : 'password'; });
        el.querySelector('[data-a="cancel"]').onclick = () => closeSheet();
        el.querySelector('#sy-form').addEventListener('submit', async e => {
          e.preventDefault();
          const k = key.value.trim();
          if (!k) { key.classList.add('err'); key.focus(); return; }
          go.disabled = true; go.textContent = 'Checking…'; msg.innerHTML = '';
          const v = await sync.verify(k);
          if (!v.ok) {
            go.disabled = false; go.textContent = 'Connect';
            msg.innerHTML = `<div class="notice bad">${I.alert}<span>${esc(REASONS[v.reason] || REASONS.server)}</span></div>`;
            return;
          }
          go.textContent = `Syncing${v.books ? ` ${plural(v.books, 'book')}` : ''}…`;
          await sync.enable(k);
          connected = sync.status.state === 'idle';
          if (!connected) {
            go.disabled = false; go.textContent = 'Try again';
            msg.innerHTML = `<div class="notice bad">${I.alert}<span>${esc(sync.status.message || 'The first sync didn’t finish. Try again.')}</span></div>`;
            return;
          }
          closeSheet();
        });
      },
      onClose: () => resolve(connected),
    });
  });
}

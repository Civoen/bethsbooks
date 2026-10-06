// Bottom sheets, dialogs and toasts. Sheets integrate with the Android back button.
import { esc } from './util.js';

let current = null; // { el, scrim, pushed, onClose, prevFocus }
let pendingNav = null;
let ignoreNextPop = false;

window.addEventListener('popstate', () => {
  if (ignoreNextPop) { ignoreNextPop = false; return; }
  if (current && current.pushed) {
    current.pushed = false; // the back button consumed our history entry
    teardown();
    if (pendingNav) { const n = pendingNav; pendingNav = null; location.hash = n; }
  }
});

export const sheetOpen = () => !!current;

function teardown() {
  if (!current) return;
  const { el, scrim, onClose, prevFocus, resolve } = current;
  current = null;
  el.classList.remove('open'); scrim.classList.remove('open');
  setTimeout(() => { el.remove(); scrim.remove(); }, 260);
  document.removeEventListener('keydown', onKey);
  if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
  onClose && onClose();
  resolve && resolve();
}

function onKey(e) {
  if (!current) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSheet(); }
  if (e.key === 'Tab') {
    const f = [...current.el.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

/** Open a bottom sheet. Returns the sheet element. */
export function openSheet({ title, sub, body, onMount, onClose, label }) {
  // Replacing an open sheet reuses its history entry.
  let reuse = false;
  const prevFocus = current ? current.prevFocus : document.activeElement;
  if (current) { reuse = current.pushed; current.pushed = false; teardown(); }
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', label || title || 'Dialog');
  el.innerHTML = `<div class="handle" aria-hidden="true"></div>${title ? `<h2>${esc(title)}</h2>` : ''}${sub ? `<p class="sub">${sub}</p>` : ''}<div class="sheet-body">${body || ''}</div>`;
  document.body.append(scrim, el);
  scrim.addEventListener('click', () => closeSheet());
  current = { el, scrim, pushed: true, onClose, prevFocus };
  if (!reuse) history.pushState({ sheet: true }, '', location.href);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => { scrim.classList.add('open'); el.classList.add('open'); });
  onMount && onMount(el);
  attachSheetDrag(el, scrim);
  setTimeout(() => {
    if (!current || current.el !== el) return;
    const auto = el.querySelector('[autofocus]') || el.querySelector('button,a[href],input,select,textarea');
    auto && auto.focus({ preventScroll: true });
  }, 60);
  return el;
}

/** Close the open sheet. If navigateTo is given, go there once the sheet's history entry is unwound. */
export function closeSheet(navigateTo) {
  if (!current) { if (navigateTo) location.hash = navigateTo; return; }
  if (current.pushed) {
    pendingNav = navigateTo || null;
    history.back(); // popstate handler tears down
  } else {
    teardown();
    if (navigateTo) location.hash = navigateTo;
  }
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    let answer = false;
    openSheet({
      title, sub: message ? esc(message) : '', label: title,
      body: `<div class="sheet-actions"><button class="btn btn-outline" data-a="no">${esc(cancelLabel)}</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-a="yes">${esc(confirmLabel)}</button></div>`,
      onMount: el => el.addEventListener('click', e => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        answer = a === 'yes'; closeSheet();
      }),
      // Resolve only once the sheet (and its history entry) is gone, so callers can navigate safely.
      onClose: () => resolve(answer),
    });
  });
}

export function promptText({ title, label, value = '', confirmLabel = 'Save', placeholder = '' }) {
  return new Promise(resolve => {
    let answer = null;
    openSheet({
      title,
      body: `<form class="form" novalidate><div class="field"><label for="pt">${esc(label)}</label><input id="pt" class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autofocus maxlength="80"></div><div class="sheet-actions"><button type="button" class="btn btn-outline" data-a="no">Cancel</button><button class="btn btn-primary" type="submit">${esc(confirmLabel)}</button></div></form>`,
      onMount: el => {
        const f = el.querySelector('form');
        f.addEventListener('submit', e => { e.preventDefault(); const v = f.pt.value.trim(); if (!v) { f.pt.classList.add('err'); f.pt.focus(); return; } answer = v; closeSheet(); });
        el.querySelector('[data-a="no"]').addEventListener('click', () => closeSheet());
      },
      onClose: () => resolve(answer),
    });
  });
}

let toastEl, toastTimer;
export function toast(message, { action, onAction, timeout = 4000 } = {}) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span class="msg">${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  if (action) toastEl.querySelector('button').onclick = () => { hideToast(); onAction && onAction(); };
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(hideToast, action ? Math.max(timeout, 6000) : timeout);
}
export function hideToast() { toastEl && toastEl.classList.remove('show'); }

/** Run a data operation, showing a friendly error if it fails. */
export async function safely(fn, msg = "We couldn't save that. Please try again.") {
  try { return await fn(); } catch (e) { console.error(e); toast(msg); return undefined; }
}

/** Drag a bottom sheet down to close it, like a native Android sheet. */
function attachSheetDrag(el, scrim) {
  if (matchMedia('(min-width: 900px)').matches) return; // a centred dialog on big screens
  let startY = 0, startX = 0, dy = 0, dragging = false, decided = false, t0 = 0;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const tag = e.target.closest('input, textarea, select, [type=range], .cover-grid');
    const onHandle = !!e.target.closest('.handle, h2');
    // From the handle/title always; from elsewhere only when the sheet is scrolled to the top.
    if (tag || (!onHandle && el.scrollTop > 0)) { decided = true; dragging = false; return; }
    startY = e.touches[0].clientY; startX = e.touches[0].clientX; dy = 0; dragging = false; decided = false; t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (decided && !dragging) return;
    const my = e.touches[0].clientY - startY, mx = e.touches[0].clientX - startX;
    if (!decided) {
      if (my > 8 && my > Math.abs(mx)) { decided = true; dragging = true; el.style.transition = 'none'; }
      else if (Math.abs(my) > 8 || Math.abs(mx) > 8) { decided = true; return; }
      else return;
    }
    e.preventDefault();
    dy = Math.max(0, my);
    el.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / (el.offsetHeight || 400)));
  }, { passive: false });
  el.addEventListener('touchend', () => {
    if (!dragging) { decided = false; return; }
    dragging = false; decided = false;
    const fast = dy / Math.max(1, Date.now() - t0) > 0.5;
    el.style.transition = '';
    if (dy > Math.min(140, el.offsetHeight * 0.3) || (fast && dy > 40)) {
      el.style.transform = 'translateY(100%)';
      scrim.style.opacity = '';
      closeSheet();
    } else {
      el.style.transform = '';
      scrim.style.opacity = '';
    }
  });
}

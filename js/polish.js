// Native-app polish: offline banner, collapsing header, pull to refresh, swipe actions on rows,
// A–Z fast scroll, tap ripples and the cover-to-page transition.
import { I } from './util.js';
import { tap } from './fx.js';

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wide = () => matchMedia('(min-width: 900px)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Offline banner ----------
export function initOfflineBanner(syncOn) {
  const el = document.createElement('div');
  el.id = 'offline';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  let hideTimer;
  const show = (text, cls) => { clearTimeout(hideTimer); el.innerHTML = `${cls === 'on' ? I.check : I.info}<span>${text}</span>`; el.className = 'show ' + cls; };
  const offline = () => show(syncOn() ? "You're offline. Changes will sync when you're back." : "You're offline. Everything still works.", 'off');
  window.addEventListener('offline', offline);
  window.addEventListener('online', () => {
    if (!el.classList.contains('show')) return;
    show('Back online', 'on');
    hideTimer = setTimeout(() => { el.className = ''; }, 2200);
  });
  el.addEventListener('click', () => { el.className = ''; });
  if (!navigator.onLine) offline();
}

// ---------- Collapsing header ----------
let mini, miniTitle, miniBack;
export function initMiniBar() {
  mini = document.createElement('div');
  mini.id = 'minibar';
  mini.innerHTML = `<button class="icon-btn" type="button" aria-label="Back" hidden>${I.back}</button><span class="t"></span>`;
  document.body.appendChild(mini);
  miniTitle = mini.querySelector('.t');
  miniBack = mini.querySelector('button');
  miniBack.addEventListener('click', () => {
    document.querySelector('#main .topbar [data-a="back"], #main .topbar a[aria-label^="Back"], #main .topbar [data-a="close"], #main .topbar [data-a="cancel"]')?.click();
  });
  let queued = false;
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; updateMiniBar(); }); } }, { passive: true });
  addEventListener('resize', updateMiniBar);
}
export function updateMiniBar() {
  if (!mini) return;
  const h1 = document.querySelector('#main h1');
  const scanning = !!document.querySelector('.scanner');
  if (!h1 || scanning) { mini.classList.remove('show'); document.body.classList.remove('mini-on'); return; }
  const inset = parseFloat(getComputedStyle(mini).paddingTop) || 0;
  const r = h1.getBoundingClientRect();
  const on = r.bottom < inset + 52;
  miniTitle.textContent = h1.textContent.trim();
  miniBack.hidden = !document.querySelector('#main .topbar [data-a="back"], #main .topbar a[aria-label^="Back"], #main .topbar [data-a="close"], #main .topbar [data-a="cancel"]');
  mini.classList.toggle('show', on);
  document.body.classList.toggle('mini-on', on);
  // The big title gently fades and shrinks as it slides under the bar.
  // Only once the title reaches the top edge (nothing changes while the page is at rest).
  const p = clamp((inset + 8 - r.top) / Math.max(40, r.height * 0.8), 0, 1);
  h1.style.opacity = calm() ? '' : String(1 - p * 0.85);
  h1.style.transform = calm() ? '' : `scale(${1 - p * 0.06})`;
  h1.style.transformOrigin = 'left center';
}

// ---------- Pull to refresh ----------
export function initPullToRefresh({ canPull, onRefresh }) {
  const ind = document.createElement('div');
  ind.id = 'ptr';
  ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = I.books;
  document.body.appendChild(ind);
  let startY = 0, startX = 0, pulling = false, dist = 0, busy = false, tracking = false;
  const set = (d, anim) => {
    ind.style.transition = anim ? 'transform .3s var(--spring), opacity .2s' : 'none';
    ind.style.transform = `translate(-50%, ${d - 56}px) rotate(${d * 3}deg)`;
    ind.style.opacity = d > 4 ? String(clamp(d / 60, 0, 1)) : '0';
  };
  addEventListener('touchstart', e => {
    tracking = !busy && e.touches.length === 1 && scrollY <= 0 && canPull();
    pulling = false; dist = 0;
    if (tracking) { startY = e.touches[0].clientY; startX = e.touches[0].clientX; }
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (!tracking) return;
    const dy = e.touches[0].clientY - startY, dx = e.touches[0].clientX - startX;
    if (!pulling) {
      if (dy > 8 && Math.abs(dx) < dy && scrollY <= 0) pulling = true;
      else if (dy < -4 || Math.abs(dx) > 10) { tracking = false; return; }
      else return;
    }
    e.preventDefault();
    dist = clamp(dy * 0.5, 0, 110);
    set(dist, false);
    ind.classList.toggle('armed', dist >= 70);
    if (dist >= 70 && !ind.dataset.buzzed) { ind.dataset.buzzed = '1'; tap(6); }
    if (dist < 70) delete ind.dataset.buzzed;
  }, { passive: false });
  addEventListener('touchend', async () => {
    if (!tracking || !pulling) { tracking = false; return; }
    tracking = false; delete ind.dataset.buzzed;
    if (dist < 70) { set(0, true); return; }
    busy = true;
    set(64, true);
    ind.classList.add('spin');
    const started = Date.now();
    try { await onRefresh(); } catch {}
    await new Promise(r => setTimeout(r, Math.max(0, 700 - (Date.now() - started))));
    ind.classList.remove('spin', 'armed');
    set(0, true);
    busy = false;
  });
}

// ---------- Swipe actions on book rows ----------
/** actions(id) → { right: {label, icon, run}, left: {label, icon, run} } */
export function initRowSwipe(host, actions) {
  let wrap = null, row = null, startX = 0, startY = 0, dx = 0, mode = null, armed = null, act = null;
  const reset = (animate = true) => {
    if (!row) return;
    row.style.transition = animate ? 'transform .32s var(--spring)' : 'none';
    row.style.transform = '';
    wrap.classList.remove('swiping', 'go-left', 'go-right', 'armed');
  };
  host.addEventListener('touchstart', e => {
    const w = e.target.closest('.swipe-wrap');
    if (!w || e.touches.length !== 1 || e.target.closest('.az')) { wrap = null; return; }
    wrap = w; row = w.querySelector('.book-row');
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; dx = 0; mode = null; armed = null;
    act = actions(w.dataset.id);
  }, { passive: true });
  host.addEventListener('touchmove', e => {
    if (!wrap || !act) return;
    const mx = e.touches[0].clientX - startX, my = e.touches[0].clientY - startY;
    if (!mode) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) mode = 'h';
      else if (Math.abs(my) > 10) { mode = 'v'; wrap = null; return; }
      else return;
      wrap.classList.add('swiping');
      wrap.querySelector('.sw-left').innerHTML = `${act.right.icon}<span>${act.right.label}</span>`;
      wrap.querySelector('.sw-right').innerHTML = `<span>${act.left.label}</span>${act.left.icon}`;
    }
    e.preventDefault();
    const w = wrap.offsetWidth;
    dx = mx > 0 ? Math.min(mx, w * 0.6) : Math.max(mx, -w * 0.6);
    row.style.transition = 'none';
    row.style.transform = `translateX(${dx}px)`;
    wrap.classList.toggle('go-right', dx > 0);
    wrap.classList.toggle('go-left', dx < 0);
    const th = Math.min(110, w * 0.28);
    const now = dx > th ? 'right' : dx < -th ? 'left' : null;
    if (now !== armed) { armed = now; wrap.classList.toggle('armed', !!now); if (now) tap(10); }
  }, { passive: false });
  host.addEventListener('touchend', () => {
    if (!wrap || mode !== 'h') { wrap = null; return; }
    const w = wrap, a = armed, id = w.dataset.id;
    w.dataset.swiped = String(Date.now());
    reset(true);
    if (a === 'right') act.right.run(id, w);
    if (a === 'left') act.left.run(id, w);
    wrap = null;
  });
  host.addEventListener('touchcancel', () => { reset(true); wrap = null; });
  // A swipe shouldn't also open the book.
  host.addEventListener('click', e => {
    const w = e.target.closest('.swipe-wrap');
    if (w && w.dataset.swiped && Date.now() - Number(w.dataset.swiped) < 450) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

// ---------- A–Z fast scroll ----------
export function initAZ(host) {
  let bubble = null;
  const jump = (clientY, bar) => {
    const btns = [...bar.querySelectorAll('button')];
    const r = bar.getBoundingClientRect();
    const i = clamp(Math.floor((clientY - r.top) / (r.height / btns.length)), 0, btns.length - 1);
    // Nearest letter that has books, looking forward first
    let b = btns.slice(i).find(x => !x.disabled) || btns.slice(0, i).reverse().find(x => !x.disabled);
    if (!b) return;
    const L = b.dataset.az;
    const target = host.querySelector(`.swipe-wrap[data-l="${CSS.escape(L)}"]`);
    if (!target) return;
    const offset = (document.querySelector('.sticky-search')?.offsetHeight || 0) + 70;
    scrollTo({ top: target.getBoundingClientRect().top + scrollY - offset, behavior: 'instant' });
    if (!bubble) { bubble = document.createElement('div'); bubble.className = 'az-bubble'; document.body.appendChild(bubble); }
    if (bubble.textContent !== L) tap(4);
    bubble.textContent = L;
    bubble.style.top = `${clamp(clientY, r.top, r.bottom)}px`;
    bubble.classList.add('show');
  };
  const end = () => bubble?.classList.remove('show');
  host.addEventListener('pointerdown', e => {
    const bar = e.target.closest('.az'); if (!bar) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    jump(e.clientY, bar);
    const move = ev => jump(ev.clientY, bar);
    const up = () => { end(); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
  // Keyboard / screen reader: each letter is a real button.
  host.addEventListener('click', e => {
    const b = e.target.closest('.az button'); if (!b || e.detail) return; // pointer taps are handled above
    const target = host.querySelector(`.swipe-wrap[data-l="${CSS.escape(b.dataset.az)}"]`);
    target?.scrollIntoView({ block: 'start' });
    target?.querySelector('a')?.focus({ preventScroll: true });
  });
}

// ---------- Tap ripples ----------
const RIPPLE = '.btn, .menu-item, .chip, .stat, .fun-row, .palette, .segmented button, .goal-card, .goal-empty, .wish-banner, .book-row .main, .reading-mini, .tag, .cover-opt, .icon-btn, .nav-item';
export function initRipples() {
  addEventListener('pointerdown', e => {
    if (calm() || e.button > 0) return;
    const el = e.target.closest(RIPPLE);
    if (!el || el.disabled || el.closest('.scanner')) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    el.classList.add('has-ripple');
    el.appendChild(s);
    const anim = s.animate([{ transform: 'scale(0)', opacity: 0.22 }, { transform: 'scale(1)', opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anim.onfinish = () => s.remove();
  }, { passive: true });
}

// ---------- Cover-to-page transition ----------
export const canMorph = () => typeof document.startViewTransition === 'function' && !calm() && !wide();

/** Find the cover that belongs to a link or row on screen. */
export function coverNear(el) {
  return el.querySelector?.('.cover') || el.closest('.swipe-wrap, .book-row, .cover-tile, .reading-card, .fun-row, .reading-mini')?.querySelector('.cover') || null;
}

/** Run a screen change as a view transition, morphing one cover into another. */
export function morph(update, { from, findTo } = {}) {
  if (from) from.style.viewTransitionName = 'book-cover';
  let to = null;
  const t = document.startViewTransition(() => {
    if (from) from.style.viewTransitionName = '';
    update();
    to = findTo ? findTo() : null;
    if (to) to.style.viewTransitionName = 'book-cover';
  });
  const clear = () => { if (to) to.style.viewTransitionName = ''; if (from) from.style.viewTransitionName = ''; };
  t.finished.then(clear, clear);
  return t;
}

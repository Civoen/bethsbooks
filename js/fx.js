// Small tactile touches: haptic taps, heart bursts, a petal shower, and "pop" helpers.
// Everything is skipped when the phone is set to reduce motion.

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A tiny vibration, like a real app's tap feedback (Android only). */
export function tap(ms = 8) { try { navigator.vibrate?.(ms); } catch {} }

const HEART = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';

function layer() {
  let l = document.getElementById('fx-layer');
  if (!l) { l = document.createElement('div'); l.id = 'fx-layer'; l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l); }
  return l;
}

/** Little hearts that float up and out from a point (e.g. the heart button). */
export function heartBurst(x, y, count = 7) {
  if (calm()) return;
  const l = layer();
  const colours = ['var(--heart)', 'var(--primary)', 'var(--goal-fill)', 'var(--heart)'];
  for (let i = 0; i < count; i++) {
    const h = document.createElement('span');
    h.className = 'fx-heart';
    const size = 9 + Math.random() * 8;
    h.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;color:${colours[i % colours.length]}`;
    h.innerHTML = HEART;
    l.appendChild(h);
    const angle = (-90 + (i - (count - 1) / 2) * (110 / count)) * Math.PI / 180;
    const dist = 26 + Math.random() * 22;
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist - 10;
    h.animate([
      { transform: 'translate(0,0) scale(.3) rotate(0deg)', opacity: 0 },
      { transform: `translate(${dx * .6}px,${dy * .6}px) scale(1.1) rotate(${dx / 3}deg)`, opacity: 1, offset: .35 },
      { transform: `translate(${dx}px,${dy - 14}px) scale(.8) rotate(${dx / 2}deg)`, opacity: 0 },
    ], { duration: 720 + Math.random() * 200, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => h.remove();
  }
}

/** A gentle shower of hearts and petals from the top of the screen (finishing a book, reaching a goal). */
export function petals(amount = 22) {
  if (calm()) return;
  const l = layer();
  const colours = ['var(--heart)', 'var(--primary)', 'var(--primary-soft)', 'var(--goal-fill)', 'var(--star)'];
  const w = window.innerWidth, h = window.innerHeight;
  for (let i = 0; i < amount; i++) {
    const p = document.createElement('span');
    const isHeart = i % 3 === 0;
    const size = isHeart ? 10 + Math.random() * 8 : 7 + Math.random() * 6;
    p.className = isHeart ? 'fx-heart' : 'fx-petal';
    p.style.cssText = `left:${Math.random() * w}px;top:-24px;width:${size}px;height:${size * (isHeart ? 1 : 1.4)}px;color:${colours[i % colours.length]};background:${isHeart ? 'none' : colours[i % colours.length]}`;
    if (isHeart) p.innerHTML = HEART;
    l.appendChild(p);
    const drift = (Math.random() - .5) * 120;
    const fall = h * (.55 + Math.random() * .35);
    const spin = (Math.random() - .5) * 540;
    p.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: .1 },
      { transform: `translate(${drift * .5}px,${fall * .5}px) rotate(${spin * .5}deg)`, offset: .5 },
      { transform: `translate(${drift}px,${fall}px) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: 1600 + Math.random() * 900, delay: Math.random() * 350, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'backwards' }).onfinish = () => p.remove();
  }
}

/** Centre of an element on screen, for starting a burst. */
export function centreOf(el) {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

/** Replay a CSS "pop" animation on elements (after the screen has re-drawn them). */
export function pop(selectorOrEls, root = document, stagger = 0) {
  if (calm()) return;
  const els = typeof selectorOrEls === 'string' ? root.querySelectorAll(selectorOrEls) : selectorOrEls;
  [...els].forEach((el, i) => {
    el.classList.remove('pop');
    void el.offsetWidth; // restart the animation
    el.style.animationDelay = stagger ? `${i * stagger}ms` : '';
    el.classList.add('pop');
    el.addEventListener('animationend', () => { el.classList.remove('pop'); el.style.animationDelay = ''; }, { once: true });
  });
}

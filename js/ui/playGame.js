// V18 play mini-game (CONTRACT_V18 §2), V19 "น้องอยากได้อะไร" (CONTRACT_V19 §2): the pet wishes for one toy at a time (💭, changes every
// few seconds); toys pop up around the pet; tapping the wished toy scores, a wrong toy costs a point and makes the pet cry. Pure DOM,
// shared by the 3D close-up (barn3d.js) and the list view's modal (petsView.js). The caller turns the callbacks into pet reactions
// and the final score into playSession().
//
//   const g = startPlayGame({ host, title, anchor: () => ({ x, y }), spread, favToy: '🧶',
//     onWish(emoji), onHit(n, el, combo, { fav }), onWrong(el), onMissWish(), onEnd(score, counted, { favFound }) })
//   g.stop()   // ends early (the ✕ button does the same); onEnd fires exactly once
//   counted: the round ran to the end or for at least MIN_PLAY_MS — quitting at once must not count as playing
//   favFound: the favourite toy was tapped while the pet wished for it (worth 2 points)

import { PLAY_TOYS } from '../pets.js';

export const PLAY_MS = 20000;
export const MIN_PLAY_MS = 8000;
const TOYS = PLAY_TOYS.map(t => t.emoji);
const TOY_LIFE_MS = 1900;
const SPAWN_MS = 700;
const WISH_MS = [3600, 4800];
const WISH_SHARE = 0.5;   // share of spawned toys that are the wished one
const FAV_WISH = 0.35;    // chance the next wish is the pet's favourite toy

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = list => list[Math.floor(Math.random() * list.length)];

export function startPlayGame({ host, title = '', anchor = null, spread = 150, favToy = null,
  onWish = () => {}, onHit = () => {}, onWrong = () => {}, onMissWish = () => {}, onEnd = () => {} }) {
  const root = document.createElement('div');
  root.className = 'pg';
  root.innerHTML =
    `<div class="pg-bar"><span class="pg-title">${esc(title)}</span><span class="pg-wish" aria-live="polite"></span><span class="pg-score" aria-live="polite">⭐ 0</span>` +
    '<button type="button" class="pg-close" aria-label="จบการเล่น">✕</button></div>' +
    '<div class="pg-time"><div class="pg-time-fill"></div></div>' +
    '<div class="pg-hint">แตะเฉพาะของที่น้องอยากได้ 💭 ผิดชิ้นน้องจะร้องไห้นะ</div>' +
    '<div class="pg-field"></div>';
  host.appendChild(root);
  const field = root.querySelector('.pg-field');
  const scoreEl = root.querySelector('.pg-score');
  const wishEl = root.querySelector('.pg-wish');
  const fill = root.querySelector('.pg-time-fill');
  let score = 0, combo = 0, ended = false, wish = null, favFound = false;
  const t0 = performance.now();
  const timers = new Set();
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const safe = (fn, ...a) => { try { fn(...a); } catch (e) { console.error(e); } };
  const showScore = () => { scoreEl.textContent = `⭐ ${score}${combo >= 3 ? ` · คอมโบ x${combo}` : ''}`; };

  function nextWish() {
    if (ended) return;
    const prev = wish;
    const others = TOYS.filter(t => t !== prev);
    wish = favToy && favToy !== prev && Math.random() < FAV_WISH ? favToy : pick(others);
    wishEl.textContent = `💭 ${wish}`;
    wishEl.classList.remove('is-new'); void wishEl.offsetWidth; wishEl.classList.add('is-new');
    // toys of the old wish leave quietly: tapping one now would be "wrong" through no fault of the player
    for (const b of field.querySelectorAll('.pg-toy')) {
      if (b.textContent === prev && !b.dataset.gone) { b.dataset.gone = '1'; b.classList.add('is-miss'); later(220, () => b.remove()); }
    }
    safe(onWish, wish);
    later(300, () => spawn(wish));   // the new wish shows up quickly
    later(WISH_MS[0] + Math.random() * (WISH_MS[1] - WISH_MS[0]), nextWish);
  }

  function spawn(force = null) {
    if (ended) return;
    const w = field.clientWidth || host.clientWidth || 320, h = field.clientHeight || host.clientHeight || 320;
    const c = (anchor && anchor()) || { x: w / 2, y: h / 2 };
    const a = Math.random() * Math.PI * 2, r = spread * (0.45 + Math.random() * 0.55);
    const x = Math.max(28, Math.min(w - 28, c.x + Math.cos(a) * r));
    const y = Math.max(70, Math.min(h - 28, c.y + Math.sin(a) * r * 0.75));
    const emoji = force || (Math.random() < WISH_SHARE ? wish : pick(TOYS.filter(t => t !== wish)));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pg-toy';
    b.textContent = emoji;
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.setAttribute('aria-label', 'แตะของเล่น');
    b.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (b.dataset.gone || ended) return;
      b.dataset.gone = '1';
      if (emoji === wish) {
        const fav = !!favToy && emoji === favToy;
        if (fav) favFound = true;
        score += fav ? 2 : 1;
        combo++;
        b.classList.add('is-hit');
        showScore();
        safe(onHit, score, b, combo, { fav });
        later(260, () => b.remove());
      } else {
        score = Math.max(0, score - 1);
        combo = 0;
        b.classList.add('is-wrong');
        showScore();
        safe(onWrong, b);
        later(420, () => b.remove());
      }
    });
    field.appendChild(b);
    later(TOY_LIFE_MS, () => {
      if (b.dataset.gone) return;
      b.dataset.gone = '1';
      b.classList.add('is-miss');
      later(220, () => b.remove());
      if (emoji === wish) { combo = 0; showScore(); safe(onMissWish); }   // the wished toy got away
    });
    if (!force) later(SPAWN_MS * (0.7 + Math.random() * 0.6), () => spawn());
  }

  const tick = setInterval(() => {
    const u = Math.min(1, (performance.now() - t0) / PLAY_MS);
    fill.style.width = `${(100 * (1 - u)).toFixed(1)}%`;
    if (u >= 1) finish(true);
  }, 100);

  function finish(finished) {
    if (ended) return;
    ended = true;
    clearInterval(tick);
    for (const id of timers) clearTimeout(id);
    timers.clear();
    root.remove();
    safe(onEnd, score, finished || performance.now() - t0 >= MIN_PLAY_MS, { favFound });
  }

  root.querySelector('.pg-close').addEventListener('click', () => finish(false));
  nextWish();
  later(900, () => spawn());
  return { stop: () => finish(false), get score() { return score; }, get wish() { return wish; } };
}

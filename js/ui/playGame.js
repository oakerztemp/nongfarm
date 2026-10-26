// V18 play mini-game (CONTRACT_V18 §2): toys pop up around the pet, tap them before they fade. Pure DOM, shared by the 3D close-up
// (barn3d.js) and the list view's modal (petsView.js). The caller turns hits into pet reactions and the final score into playSession().
//
//   const g = startPlayGame({ host, title, anchor: () => ({ x, y }), spread, onHit(n, el, combo), onEnd(score, counted) })
//   g.stop()   // ends early (the ✕ button does the same); onEnd fires exactly once
//   counted: the round ran to the end or for at least MIN_PLAY_MS — quitting at once must not count as playing

export const PLAY_MS = 20000;
export const MIN_PLAY_MS = 8000;
const TOYS = ['🎾', '🪶', '🧶', '🫧', '⭐', '🦴', '🎈'];
const TOY_LIFE_MS = 1700;
const SPAWN_MS = 650;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function startPlayGame({ host, title = '', anchor = null, spread = 150, onHit = () => {}, onEnd = () => {} }) {
  const root = document.createElement('div');
  root.className = 'pg';
  root.innerHTML =
    `<div class="pg-bar"><span class="pg-title">${esc(title)}</span><span class="pg-score" aria-live="polite">⭐ 0</span>` +
    '<button type="button" class="pg-close" aria-label="จบการเล่น">✕</button></div>' +
    '<div class="pg-time"><div class="pg-time-fill"></div></div>' +
    '<div class="pg-hint">แตะของเล่นที่โผล่มาให้ทัน! 🎾</div>' +
    '<div class="pg-field"></div>';
  host.appendChild(root);
  const field = root.querySelector('.pg-field');
  const scoreEl = root.querySelector('.pg-score');
  const fill = root.querySelector('.pg-time-fill');
  let score = 0, combo = 0, ended = false;
  const t0 = performance.now();
  const timers = new Set();
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  function spawn() {
    if (ended) return;
    const w = field.clientWidth || host.clientWidth || 320, h = field.clientHeight || host.clientHeight || 320;
    const c = (anchor && anchor()) || { x: w / 2, y: h / 2 };
    const a = Math.random() * Math.PI * 2, r = spread * (0.45 + Math.random() * 0.55);
    const x = Math.max(28, Math.min(w - 28, c.x + Math.cos(a) * r));
    const y = Math.max(28, Math.min(h - 28, c.y + Math.sin(a) * r * 0.75));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pg-toy';
    b.textContent = TOYS[Math.floor(Math.random() * TOYS.length)];
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.setAttribute('aria-label', 'แตะของเล่น');
    let gone = false;
    b.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (gone || ended) return;
      gone = true;
      score++;
      combo++;
      scoreEl.textContent = `⭐ ${score}${combo >= 3 ? ` · คอมโบ x${combo}` : ''}`;
      b.classList.add('is-hit');
      try { onHit(score, b, combo); } catch (e) { console.error(e); }
      later(260, () => b.remove());
    });
    field.appendChild(b);
    later(TOY_LIFE_MS, () => { if (!gone) { gone = true; combo = 0; b.classList.add('is-miss'); later(220, () => b.remove()); } });
    later(SPAWN_MS * (0.7 + Math.random() * 0.6), spawn);
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
    try { onEnd(score, finished || performance.now() - t0 >= MIN_PLAY_MS); } catch (e) { console.error(e); }
  }

  root.querySelector('.pg-close').addEventListener('click', () => finish(false));
  later(400, spawn);
  return { stop: () => finish(false), get score() { return score; } };
}

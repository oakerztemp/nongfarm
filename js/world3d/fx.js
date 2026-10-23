// Small sprite effects shared by every 3D scene. All functions take the world from engine.createWorld().
//
//   import * as fx from '../world3d/fx.js';
//   fx.heart(world, pos)                         // pat: a pink heart + two small ones float up
//   fx.emojiPop(world, pos, '🍖')                // emoji pops in, rises and fades
//   fx.flyEmoji(world, from, to, '🍎', onDone)   // arcs from -> to; onDone() when it lands (NOT called if the world
//                                                //   is disposed first, so a game action tied to it never half-happens)
//   const b = fx.bubble(world, actorId, '🍖')    // thought bubble that follows the actor; b.remove(), b.setEmoji(e)
//                                                //   one bubble per actor (calling again swaps the emoji)
//   fx.clearBubble(world, actorId)
//   fx.sparkle(world, actorId)                   // ✨ burst around an actor  (fx.sparkleAt(world, pos) for a point)
//   fx.confetti(world, pos)                      // coloured paper burst (hatching, level up)
//
// `pos` / `from` / `to` are THREE.Vector3 or plain { x, y, z } in world units. Effects render on top of the scene
// (no depth test), are cosmetic only, and clean up after themselves; engine.dispose() frees everything via
// world.onDispose, so you never need to dispose fx yourself. At most MAX_EFFECTS run at once (extra spawns are dropped).

export const MAX_EFFECTS = 80;
const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
const CONFETTI_COLORS = ['#ff6b6b', '#ffd84a', '#6bcB77', '#4d96ff', '#c77dff', '#ff9f43'];

// ---------------------------------------------------------------- pure helpers (unit-tested)

export const clamp01 = u => Math.min(1, Math.max(0, u));
export const easeOutCubic = u => 1 - Math.pow(1 - clamp01(u), 3);
/** Overshooting pop: 0 -> ~1.1 -> 1. */
export function easeOutBack(u) {
  const x = clamp01(u);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
/** Point on a parabola-like arc from `a` to `b`; `lift` is the extra height at the middle. */
export function arcPoint(a, b, u, lift) {
  const t = clamp01(u);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * lift,
    z: a.z + (b.z - a.z) * t,
  };
}
/** Fade-out factor: 1 until `from` (0..1 of the lifetime), then linearly to 0. */
export const fadeOut = (u, from = 0.6) => (u <= from ? 1 : 1 - clamp01((u - from) / (1 - from)));
/** Flight time in seconds for flyEmoji, longer for longer distances but bounded. */
export function flightDuration(a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return Math.min(1.1, 0.5 + d * 0.06);
}

// ---------------------------------------------------------------- per-world state

const states = new WeakMap();

function stateFor(world) {
  let s = states.get(world);
  if (s) return s;
  s = { world, textures: new Map(), effects: [], bubbles: new Map(), disposed: false };
  s.unsubFrame = world.onFrame(dt => update(s, dt));
  s.unsubDispose = world.onDispose(() => disposeState(s));
  states.set(world, s);
  return s;
}

function disposeState(s) {
  if (s.disposed) return;
  s.disposed = true;
  s.unsubFrame();
  for (const e of s.effects) killSprite(s, e.sprite);
  s.effects.length = 0;
  for (const b of s.bubbles.values()) killSprite(s, b.sprite);
  s.bubbles.clear();
  for (const t of s.textures.values()) t.dispose();
  s.textures.clear();
  states.delete(s.world);
}

function killSprite(s, sprite) {
  s.world.scene.remove(sprite);
  sprite.material.dispose(); // the texture is cached and shared: freed in disposeState
}

// ---------------------------------------------------------------- textures

function canvasTexture(s, key, draw, size = 128) {
  let tex = s.textures.get(key);
  if (tex) return tex;
  const { THREE } = s.world;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  s.textures.set(key, tex);
  return tex;
}

function drawEmoji(g, size, emoji, px, cy = size / 2) {
  g.font = `${px}px ${EMOJI_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, size / 2, cy + px * 0.06);
}

/** Cached emoji texture (one per emoji per world). */
export function emojiTexture(world, emoji) {
  const s = stateFor(world);
  return canvasTexture(s, `e:${emoji}`, (g, size) => drawEmoji(g, size, emoji, 92));
}

function bubbleTexture(s, emoji) {
  return canvasTexture(s, `b:${emoji}`, (g, size) => {
    g.fillStyle = 'rgba(255,255,255,0.97)';
    g.strokeStyle = 'rgba(120,90,50,0.6)';
    g.lineWidth = 4;
    g.beginPath(); // tail
    g.moveTo(46, 88); g.lineTo(64, 122); g.lineTo(80, 90);
    g.closePath();
    g.fill(); g.stroke();
    g.beginPath(); // body
    g.arc(64, 52, 46, 0, Math.PI * 2);
    g.fill(); g.stroke();
    g.beginPath(); // hide the outline where tail and body join
    g.moveTo(52, 86); g.lineTo(64, 104); g.lineTo(76, 88);
    g.closePath();
    g.fill();
    g.fillStyle = '#000';
    drawEmoji(g, size, emoji, 56, 52);
  }, 128);
}

function confettiTexture(s, color) {
  return canvasTexture(s, `c:${color}`, (g, size) => {
    g.fillStyle = color;
    g.fillRect(size * 0.25, size * 0.1, size * 0.5, size * 0.8);
  }, 32);
}

// ---------------------------------------------------------------- sprite plumbing

function makeSprite(s, texture, size, opacity = 1) {
  const { THREE, scene } = s.world;
  const mat = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  sprite.renderOrder = 20;
  sprite.userData.noPick = true;
  scene.add(sprite);
  return sprite;
}

/**
 * Registers a timed effect. tick(u, sprite, e) gets u = 0..1 of the lifetime after `delay`.
 * The sprite is hidden during the delay. onDone() runs after the last tick.
 */
function spawn(s, { texture, size, duration, delay = 0, tick, onDone }) {
  if (s.disposed || s.effects.length >= MAX_EFFECTS) return null;
  const sprite = makeSprite(s, texture, size);
  sprite.visible = false;
  const e = { sprite, age: -delay, duration, tick, onDone, size };
  s.effects.push(e);
  return e;
}

function update(s, dt) {
  if (!s.effects.length && !s.bubbles.size) return;
  for (let i = s.effects.length - 1; i >= 0; i--) {
    const e = s.effects[i];
    e.age += dt;
    if (e.age < 0) continue;
    const u = e.age / e.duration;
    e.sprite.visible = true;
    if (u >= 1) {
      s.effects.splice(i, 1);
      killSprite(s, e.sprite);
      if (e.onDone) { try { e.onDone(); } catch (err) { console.error(err); } }
      continue;
    }
    e.tick(u, e.sprite, e);
  }
  for (const [id, b] of s.bubbles) {
    const actor = s.world.getActor(id);
    if (!actor) { removeBubbleRecord(s, id); continue; }
    b.age += dt;
    if (b.life != null && b.age >= b.life) { removeBubbleRecord(s, id); continue; }
    const p = actor.object.position;
    const pop = easeOutBack(b.age / 0.25);
    const bob = Math.sin(b.age * 3) * 0.05;
    b.sprite.position.set(p.x, p.y + actor.height + 0.55 + bob, p.z);
    const size = b.size * Math.max(0.01, pop);
    b.sprite.scale.set(size, size, 1);
    b.sprite.visible = actor.object.visible;
  }
}

const vec = p => ({ x: p.x || 0, y: p.y || 0, z: p.z || 0 });

// ---------------------------------------------------------------- effects

/** A pink heart (plus two small ones) floats up from `pos`. */
export function heart(world, pos) {
  const s = stateFor(world);
  const p = vec(pos);
  const specs = [
    { emoji: '❤️', size: 0.8, dx: 0, delay: 0, rise: 1.3, sway: 0.1 },
    { emoji: '💗', size: 0.45, dx: -0.4, delay: 0.12, rise: 1.1, sway: 0.14 },
    { emoji: '💗', size: 0.4, dx: 0.4, delay: 0.24, rise: 1.0, sway: 0.12 },
  ];
  for (const sp of specs) {
    spawn(s, {
      texture: emojiTexture(world, sp.emoji), size: sp.size, duration: 1.1, delay: sp.delay,
      tick(u, sprite) {
        const pop = easeOutBack(u / 0.22);
        sprite.position.set(p.x + sp.dx + Math.sin(u * 7) * sp.sway, p.y + easeOutCubic(u) * sp.rise, p.z);
        sprite.material.opacity = fadeOut(u, 0.55);
        const sz = sp.size * Math.max(0.01, pop);
        sprite.scale.set(sz, sz, 1);
      },
    });
  }
}

/** An emoji pops in at `pos`, drifts up and fades. */
export function emojiPop(world, pos, emoji) {
  const s = stateFor(world);
  const p = vec(pos);
  spawn(s, {
    texture: emojiTexture(world, emoji), size: 0.7, duration: 1.1,
    tick(u, sprite, e) {
      const pop = easeOutBack(u / 0.2);
      sprite.position.set(p.x, p.y + easeOutCubic(u) * 0.7, p.z);
      sprite.material.opacity = fadeOut(u, 0.55);
      const sz = e.size * Math.max(0.01, pop);
      sprite.scale.set(sz, sz, 1);
    },
  });
}

/** An emoji flies on an arc from `from` to `to`; onDone() runs when it arrives. */
export function flyEmoji(world, fromPos, toPos, emoji, onDone) {
  const s = stateFor(world);
  const a = vec(fromPos);
  const b = vec(toPos);
  const lift = 0.6 + Math.hypot(b.x - a.x, b.z - a.z) * 0.12;
  const e = spawn(s, {
    texture: emojiTexture(world, emoji), size: 0.6, duration: flightDuration(a, b), onDone,
    tick(u, sprite, eff) {
      const q = arcPoint(a, b, easeOutCubic(u * 0.85 + 0.15 * u * u), lift);
      sprite.position.set(q.x, q.y, q.z);
      const sz = eff.size * (1 - 0.35 * u);
      sprite.scale.set(sz, sz, 1);
    },
  });
  if (!e && onDone) { try { onDone(); } catch (err) { console.error(err); } } // effect cap hit: still finish the action
  return !!e;
}

function removeBubbleRecord(s, actorId) {
  const b = s.bubbles.get(actorId);
  if (!b) return;
  s.bubbles.delete(actorId);
  killSprite(s, b.sprite);
}

/** Thought bubble above an actor, following it. Returns { remove(), setEmoji(emoji) }. */
export function bubble(world, actorId, emoji, { duration = null } = {}) {
  const s = stateFor(world);
  let rec = s.bubbles.get(actorId);
  if (rec) {
    if (rec.emoji !== emoji) { rec.emoji = emoji; rec.sprite.material.map = bubbleTexture(s, emoji); rec.sprite.material.needsUpdate = true; }
    rec.life = duration;
  } else {
    const sprite = makeSprite(s, bubbleTexture(s, emoji), 0.9);
    sprite.visible = false;
    rec = { sprite, emoji, age: 0, size: 0.9, life: duration };
    s.bubbles.set(actorId, rec);
  }
  const mine = rec;
  return {
    remove() { if (s.bubbles.get(actorId) === mine) removeBubbleRecord(s, actorId); },
    setEmoji(next) {
      if (s.bubbles.get(actorId) !== mine || mine.emoji === next) return;
      mine.emoji = next;
      mine.sprite.material.map = bubbleTexture(s, next);
      mine.sprite.material.needsUpdate = true;
    },
  };
}

export function clearBubble(world, actorId) {
  const s = states.get(world);
  if (s) removeBubbleRecord(s, actorId);
}

/** ✨ burst around a point. */
export function sparkleAt(world, pos) {
  const s = stateFor(world);
  const p = vec(pos);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.4;
    const r = 0.45 + (i % 2) * 0.2;
    spawn(s, {
      texture: emojiTexture(world, '✨'), size: 0.4, duration: 0.9, delay: i * 0.05,
      tick(u, sprite, e) {
        const k = easeOutCubic(u);
        sprite.position.set(p.x + Math.cos(ang) * r * k, p.y + 0.2 + k * 0.5 + (i % 3) * 0.12, p.z + Math.sin(ang) * r * k);
        sprite.material.opacity = fadeOut(u, 0.4);
        const sz = e.size * (0.6 + 0.6 * Math.sin(u * Math.PI));
        sprite.scale.set(sz, sz, 1);
      },
    });
  }
}

/** ✨ burst around an actor (at its centre height). */
export function sparkle(world, actorId) {
  const actor = world.getActor(actorId);
  if (!actor) return;
  const p = actor.object.position;
  sparkleAt(world, { x: p.x, y: p.y + actor.height * 0.5, z: p.z });
}

/** Coloured paper pieces burst up and fall (hatching, level up). */
export function confetti(world, pos, count = null) {
  const s = stateFor(world);
  const p = vec(pos);
  let n = count;
  if (n == null) {
    const tier = world.getStats ? world.getStats().tier : 'medium';
    n = tier === 'low' ? 12 : 22;
  }
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 1.2 + Math.random() * 1.6;
    const vx = Math.cos(ang) * speed;
    const vz = Math.sin(ang) * speed;
    const vy = 3 + Math.random() * 2.5;
    const spin = (Math.random() - 0.5) * 12;
    spawn(s, {
      texture: confettiTexture(s, CONFETTI_COLORS[i % CONFETTI_COLORS.length]), size: 0.14, duration: 1.3 + Math.random() * 0.4,
      tick(u, sprite, e) {
        const t = e.age;
        sprite.position.set(p.x + vx * t * 0.5, Math.max(0.02, p.y + 0.3 + vy * t - 4.5 * t * t), p.z + vz * t * 0.5);
        sprite.material.rotation = spin * t;
        sprite.material.opacity = fadeOut(u, 0.7);
      },
    });
  }
}

/** Number of running timed effects + bubbles (for tests / debugging). */
export function activeCount(world) {
  const s = states.get(world);
  return s ? s.effects.length + s.bubbles.size : 0;
}

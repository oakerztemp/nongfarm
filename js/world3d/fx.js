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

import { prefersReducedMotion } from './support.js';

export const MAX_EFFECTS = 80;
/** Sprite effects are not batched (1 draw call each), so the cap and the confetti burst shrink with the tier. */
export function effectCapForTier(tier) { return tier === 'high' ? MAX_EFFECTS : tier === 'low' ? 24 : 48; }
export function confettiCountForTier(tier, requested = null) {
  const max = tier === 'high' ? 40 : tier === 'low' ? 16 : 28;
  const want = requested == null ? (tier === 'low' ? 12 : 22) : requested;
  return Math.max(0, Math.min(max, Math.floor(want)));
}
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
  s = {
    world, textures: new Map(), effects: [], bubbles: new Map(), disposed: false,
    auras: [], emitters: [], trails: [], halos: [], timed: [], cleanups: [],
    aura: null, particles: null, dim: null, dimValue: 0, shake: null,
  };
  s.unsubFrame = world.onFrame((dt, t) => update(s, dt, t));
  s.unsubDispose = world.onDispose(() => disposeState(s));
  states.set(world, s);
  return s;
}

function disposeState(s) {
  if (s.disposed) return;
  s.disposed = true;
  s.unsubFrame();
  for (const tr of [...s.trails]) killTrail(s, tr);
  for (const h of [...s.halos]) removeHalo(s, h);
  for (const rec of s.timed) rec.dispose();
  s.timed.length = 0; s.auras.length = 0; s.emitters.length = 0;
  for (const fn of s.cleanups) { try { fn(); } catch (e) { console.error(e); } }
  s.cleanups.length = 0;
  try { s.world.setDim(0); s.world.setShakeOffset(0, 0, 0); } catch { /* world already torn down */ }
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
  if (s.disposed || s.effects.length >= effectCapForTier(s.world.tier || 'medium')) return null;
  const sprite = makeSprite(s, texture, size);
  sprite.visible = false;
  const e = { sprite, age: -delay, duration, tick, onDone, size };
  s.effects.push(e);
  return e;
}

function update(s, dt, t = 0) {
  updateAuras(s, dt, t);
  updateParticles(s, dt);
  updateTrails(s, dt);
  updateTimed(s, dt);
  updateDim(s, dt);
  updateShake(s, dt);
  updateHalos(s, dt, t);
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

/** V19: a small tear (or any emoji) that drips down from `pos` and fades. */
export function tearDrop(world, pos, emoji = '💧') {
  const s = stateFor(world);
  const p = vec(pos);
  spawn(s, {
    texture: emojiTexture(world, emoji), size: 0.3, duration: 0.85,
    tick(u, sprite, e) {
      sprite.position.set(p.x, p.y - u * u * 0.55, p.z);
      sprite.material.opacity = fadeOut(u, 0.6);
      const sz = e.size * Math.min(1, 0.3 + u / 0.15);
      sprite.scale.set(sz * 0.8, sz, 1);
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
    /** V22: world size of the bubble (default 0.9), e.g. smaller in a close-up. */
    setSize(n) { mine.size = Number(n) > 0 ? Number(n) : 0.9; },
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
  const n = confettiCountForTier(world.tier || 'medium', count);
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

// =====================================================================================================
// V5 primitives: aura, particles, trail, lightBeam, dimScene, shake, glowHalo, twinkle.
//
//   const h = fx.aura(world, actorId, { color: 0x9b6bff, intensity: 1 })   // h.remove(), h.setColor(c)
//   fx.particles(world, actorId, { kind: 'motes'|'embers'|'stars'|'petals', rate: 8, color })  // h.remove/setRate/setColor
//   fx.trail(world, actorId, { colors: ['#f55', '#fd4', ...], width: 0.35, length: 22 })        // h.remove() fades it out
//   fx.lightBeam(world, pos, { color, duration })  fx.dimScene(world, amount, ms)  fx.shake(world, ms, strength)
//   fx.glowHalo(world, actorId, { color })  fx.twinkle(world, actorId)       // shiny billboards (no colour filter!)
//
// All handles end by themselves when the actor is removed or the world is disposed. Draw-call cost (high/medium tier):
//   aura: 2 calls TOTAL for any number of auras (1 on 'low': flat glow ring, no rune ring)
//   particles + twinkle: 1 call TOTAL (shared pool, <= 300 on high, 180 medium, none on 'low')
//   trail: 1 call each, max 4 alive (none on 'low' / reduced motion)     glowHalo: 1 call each
//   lightBeam: 2 calls while it plays   dimScene / shake: 0 calls
// Reduced motion: no shake, no trails, no rune rotation. Everything pauses with the world (driven by world.onFrame).
// =====================================================================================================

export const MAX_AURAS = 32;
export const MAX_PARTICLES = 300;
export const MAX_TRAILS = 4;
export const MAX_HALOS = 32;
const MAX_EMITTERS = 64;
const PARTICLE_KINDS = ['motes', 'embers', 'stars', 'petals'];
const PARTICLE_DEFAULT_COLOR = { motes: 0xffe9a8, embers: 0xff7a2a, stars: 0xfff3b0, petals: 0xffb8d0 };

// ---- pure helpers (unit-tested)

/** Particle pool cap for a tier ('low' = none). */
export function particleCapForTier(tier) {
  return tier === 'high' ? MAX_PARTICLES : tier === 'low' ? 0 : 180;
}
/** Emission-rate multiplier for a tier. */
export function particleRateScale(tier) {
  return tier === 'high' ? 1 : tier === 'low' ? 0 : 0.6;
}
/** What is allowed for a tier / reduced-motion combination. */
export function fxPolicy(tier, reducedMotion = false) {
  const low = tier === 'low';
  return {
    particles: !low,
    trails: !low && !reducedMotion,
    shake: !reducedMotion,
    runeRing: !low,
    runeSpin: !reducedMotion,
    pulse: !reducedMotion,
  };
}
/** Brightness envelope of one particle over its life u (0..1): quick fade in, long fade out; stars twinkle. */
export function particleEnvelope(kind, u) {
  const x = clamp01(u);
  const base = Math.min(1, x / 0.15) * (x < 0.55 ? 1 : 1 - (x - 0.55) / 0.45);
  return kind === 'stars' ? base * (0.35 + 0.65 * Math.abs(Math.sin(x * Math.PI * 3))) : base;
}
/** Samples an array of [r,g,b] stops at t (0..1) with linear interpolation. */
export function colorRamp(stops, t) {
  if (!stops.length) return [1, 1, 1];
  if (stops.length === 1) return stops[0];
  const x = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
/** Half-width of a ribbon at position i of n (0 = head): tapers to 0 at the tail. */
export function trailHalfWidth(i, n, width) {
  const t = n <= 1 ? 0 : i / (n - 1);
  return (width / 2) * Math.pow(1 - t, 0.8);
}
/** Dim amount multiplier: eases in over tin seconds (from `from`), holds, eases out over tout. Returns 0..1. */
export function dimEnvelope(age, tin, hold, tout, from = 0) {
  if (age < tin) return from + (1 - from) * easeOutCubic(age / tin);
  if (age < tin + hold) return 1;
  return 1 - easeOutCubic((age - tin - hold) / tout);
}
/** Shake amplitude at age for a total duration (quadratic decay). */
export function shakeAmplitude(age, durSec, strength) {
  const u = clamp01(age / Math.max(0.001, durSec));
  return strength * (1 - u) * (1 - u);
}

let reducedOverride = null;
/** Tests only: force reduced motion on/off (null = follow the OS setting). */
export function setReducedMotionOverride(v) { reducedOverride = v; }
const isReduced = () => (reducedOverride !== null ? reducedOverride : prefersReducedMotion());
const tierOf = world => world.tier || 'medium';

const NOOP_HANDLE = Object.freeze({
  active: false, remove() {}, setColor() {}, setRate() {},
});

function rgb(THREE, c) {
  const col = new THREE.Color(c);
  return [col.r, col.g, col.b];
}

// ---- aura: two instanced layers (soft ground glow + rotating rune ring), shared by every aura

function drawGlow(g, size) {
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
}

function drawRunes(g, size) {
  const c = size / 2;
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = size * 0.012;
  for (const r of [0.46, 0.36]) {
    g.beginPath(); g.arc(c, c, size * r, 0, Math.PI * 2); g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = size * 0.37;
    const r2 = size * 0.45;
    if (i % 2 === 0) { // diamond glyph between the rings
      const m = (r1 + r2) / 2;
      const x = c + Math.cos(a) * m;
      const y = c + Math.sin(a) * m;
      const d = size * 0.032;
      g.beginPath();
      g.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
      g.lineTo(x - Math.sin(a) * d * 0.6, y + Math.cos(a) * d * 0.6);
      g.lineTo(x - Math.cos(a) * d, y - Math.sin(a) * d);
      g.lineTo(x + Math.sin(a) * d * 0.6, y - Math.cos(a) * d * 0.6);
      g.closePath(); g.fill();
    } else { // tick mark
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
      g.stroke();
    }
  }
  for (let i = 0; i < 24; i++) { // dotted inner ring
    const a = (i / 24) * Math.PI * 2;
    g.beginPath(); g.arc(c + Math.cos(a) * size * 0.29, c + Math.sin(a) * size * 0.29, size * 0.008, 0, Math.PI * 2); g.fill();
  }
}

function auraLayers(s) {
  if (s.aura) return s.aura;
  const { THREE, scene } = s.world;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const make = (tex, order) => {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_AURAS);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.userData.noPick = true;
    mesh.setColorAt(0, new THREE.Color(0)); // allocates the per-instance colour buffer
    scene.add(mesh);
    return mesh;
  };
  const glow = make(canvasTexture(s, 'glow', drawGlow, 128), -0.95);
  const rune = make(canvasTexture(s, 'runes', drawRunes, 256), -0.9);
  s.aura = { geo, glow, rune, dummy: new THREE.Object3D(), color: new THREE.Color() };
  s.cleanups.push(() => {
    for (const m of [glow, rune]) { s.world.scene.remove(m); m.material.dispose(); m.dispose(); }
    geo.dispose();
    s.aura = null;
  });
  return s.aura;
}

/** Soft additive glow + slowly rotating rune ring on the ground under an actor. */
export function aura(world, actorId, { color = 0xffd84a, intensity = 1 } = {}) {
  const s = stateFor(world);
  if (s.disposed) return NOOP_HANDLE;
  const existing = s.auras.find(a => a.id === actorId);
  if (existing) { existing.rgb = rgb(world.THREE, color); existing.intensity = intensity; return existing.handle; }
  if (s.auras.length >= MAX_AURAS || !world.getActor(actorId)) return NOOP_HANDLE;
  auraLayers(s);
  const rec = { id: actorId, rgb: rgb(world.THREE, color), intensity, phase: Math.random() * 6.28 };
  rec.handle = {
    get active() { return s.auras.includes(rec); },
    remove() { const i = s.auras.indexOf(rec); if (i >= 0) s.auras.splice(i, 1); },
    setColor(c) { rec.rgb = rgb(world.THREE, c); },
    setRate() {},
  };
  s.auras.push(rec);
  return rec.handle;
}

function updateAuras(s, dt, t) {
  const L = s.aura;
  if (!L) return;
  const world = s.world;
  const pol = fxPolicy(tierOf(world), isReduced());
  const { dummy, color } = L;
  let n = 0;
  for (let i = s.auras.length - 1; i >= 0; i--) if (!world.getActor(s.auras[i].id)) s.auras.splice(i, 1);
  for (const rec of s.auras) {
    const a = world.getActor(rec.id);
    if (!a.object.visible) continue;
    const p = a.object.position;
    const pulse = pol.pulse ? 0.85 + 0.15 * Math.sin(t * 2.2 + rec.phase) : 1;
    const k = rec.intensity * pulse;
    dummy.position.set(p.x, 0.03, p.z);
    dummy.rotation.set(0, 0, 0);
    const gs = Math.max(1.2, a.radius * 3.6) * (0.96 + (pol.pulse ? 0.04 * Math.sin(t * 2.2 + rec.phase) : 0));
    dummy.scale.set(gs, 1, gs);
    dummy.updateMatrix();
    L.glow.setMatrixAt(n, dummy.matrix);
    color.setRGB(rec.rgb[0] * k * 0.8, rec.rgb[1] * k * 0.8, rec.rgb[2] * k * 0.8);
    L.glow.setColorAt(n, color);
    if (pol.runeRing) {
      dummy.position.y = 0.04;
      dummy.rotation.set(0, pol.runeSpin ? t * 0.45 + rec.phase : rec.phase, 0);
      const rs = Math.max(1, a.radius * 2.7);
      dummy.scale.set(rs, 1, rs);
      dummy.updateMatrix();
      L.rune.setMatrixAt(n, dummy.matrix);
      color.setRGB(rec.rgb[0] * k, rec.rgb[1] * k, rec.rgb[2] * k);
      L.rune.setColorAt(n, color);
    }
    n++;
  }
  L.glow.count = n;
  L.rune.count = pol.runeRing ? n : 0;
  for (const m of [L.glow, L.rune]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

// ---- particles: one shared Points object for every emitter

function drawDot(g, size) {
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
}

function particleSystem(s) {
  if (s.particles) return s.particles;
  const { THREE, scene } = s.world;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_PARTICLES * 3);
  const col = new Float32Array(MAX_PARTICLES * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    size: 0.22, map: canvasTexture(s, 'dot', drawDot, 64), vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  points.userData.noPick = true;
  scene.add(points);
  const ps = {
    geo, mat, points, pos, col, n: 0,
    vel: new Float32Array(MAX_PARTICLES * 3), base: new Float32Array(MAX_PARTICLES * 3),
    age: new Float32Array(MAX_PARTICLES), life: new Float32Array(MAX_PARTICLES),
    phase: new Float32Array(MAX_PARTICLES), kind: new Uint8Array(MAX_PARTICLES),
  };
  s.particles = ps;
  s.cleanups.push(() => { scene.remove(points); geo.dispose(); mat.dispose(); s.particles = null; });
  return ps;
}

function spawnParticle(ps, kindIndex, a, rgbBase) {
  const i = ps.n++;
  const p = a.object.position;
  const r = a.radius;
  const h = a.height;
  const ang = Math.random() * Math.PI * 2;
  let x; let y; let z; let vx = 0; let vy = 0; let vz = 0; let life;
  switch (PARTICLE_KINDS[kindIndex]) {
    case 'embers':
      x = p.x + Math.cos(ang) * r * 0.8 * Math.random(); z = p.z + Math.sin(ang) * r * 0.8 * Math.random();
      y = p.y + Math.random() * h * 0.7; vy = 0.7 + Math.random() * 0.6; vx = (Math.random() - 0.5) * 0.3;
      life = 0.7 + Math.random() * 0.6; break;
    case 'stars': {
      const rad = r * (1 + Math.random() * 0.8);
      x = p.x + Math.cos(ang) * rad; z = p.z + Math.sin(ang) * rad;
      y = p.y + h * (0.2 + Math.random() * 0.9); vy = 0.08;
      life = 0.6 + Math.random() * 0.6; break;
    }
    case 'petals':
      x = p.x + Math.cos(ang) * r * 1.5; z = p.z + Math.sin(ang) * r * 1.5;
      y = p.y + h + 0.5 + Math.random() * 0.4; vy = -0.35; vx = (Math.random() - 0.5) * 0.2;
      life = 2.2 + Math.random(); break;
    default: { // motes
      const rad = r * (0.6 + Math.random() * 0.9);
      x = p.x + Math.cos(ang) * rad; z = p.z + Math.sin(ang) * rad;
      y = p.y + 0.1 + Math.random() * h; vy = 0.25 + Math.random() * 0.35;
      life = 1.6 + Math.random();
    }
  }
  ps.pos[i * 3] = x; ps.pos[i * 3 + 1] = y; ps.pos[i * 3 + 2] = z;
  ps.vel[i * 3] = vx; ps.vel[i * 3 + 1] = vy; ps.vel[i * 3 + 2] = vz;
  ps.base[i * 3] = rgbBase[0]; ps.base[i * 3 + 1] = rgbBase[1]; ps.base[i * 3 + 2] = rgbBase[2];
  ps.age[i] = 0; ps.life[i] = life; ps.phase[i] = Math.random() * 6.28; ps.kind[i] = kindIndex;
}

function updateParticles(s, dt) {
  const ps = s.particles;
  if (!ps) return;
  const tier = tierOf(s.world);
  const cap = particleCapForTier(tier);
  const scale = particleRateScale(tier);
  // emit
  for (let e = s.emitters.length - 1; e >= 0; e--) {
    const em = s.emitters[e];
    const a = s.world.getActor(em.id);
    if (!a) { s.emitters.splice(e, 1); continue; }
    if (!a.object.visible || cap === 0) continue;
    em.acc = Math.min(em.acc + em.rate * scale * dt, 4);
    let guard = 3;
    while (em.acc >= 1 && guard-- > 0) {
      em.acc -= 1;
      if (ps.n < Math.min(cap, MAX_PARTICLES)) spawnParticle(ps, em.kindIndex, a, em.rgb);
    }
  }
  // tier dropped at runtime: shed the excess
  if (ps.n > cap) ps.n = cap;
  // simulate
  for (let i = 0; i < ps.n;) {
    ps.age[i] += dt;
    if (ps.age[i] >= ps.life[i]) { // swap-remove
      const last = --ps.n;
      if (i !== last) {
        for (let k = 0; k < 3; k++) {
          ps.pos[i * 3 + k] = ps.pos[last * 3 + k]; ps.vel[i * 3 + k] = ps.vel[last * 3 + k]; ps.base[i * 3 + k] = ps.base[last * 3 + k];
        }
        ps.age[i] = ps.age[last]; ps.life[i] = ps.life[last]; ps.phase[i] = ps.phase[last]; ps.kind[i] = ps.kind[last];
      }
      continue;
    }
    const u = ps.age[i] / ps.life[i];
    const kind = PARTICLE_KINDS[ps.kind[i]];
    const sway = kind === 'motes' || kind === 'petals' ? Math.sin(ps.age[i] * 2 + ps.phase[i]) * (kind === 'petals' ? 0.5 : 0.15) : 0;
    ps.pos[i * 3] += (ps.vel[i * 3] + sway) * dt;
    ps.pos[i * 3 + 1] += ps.vel[i * 3 + 1] * dt;
    ps.pos[i * 3 + 2] += ps.vel[i * 3 + 2] * dt;
    const env = particleEnvelope(kind, u);
    let r = ps.base[i * 3]; let g = ps.base[i * 3 + 1]; let b = ps.base[i * 3 + 2];
    if (kind === 'embers') { r += (0.8 - r) * u; g += (0.12 - g) * u; b += (0.04 - b) * u; }
    ps.col[i * 3] = r * env; ps.col[i * 3 + 1] = g * env; ps.col[i * 3 + 2] = b * env;
    i++;
  }
  ps.geo.setDrawRange(0, ps.n);
  ps.geo.attributes.position.needsUpdate = true;
  ps.geo.attributes.color.needsUpdate = true;
}

/** Rising glowing particles around an actor. All emitters share one pool (<= 300, tier scaled). */
export function particles(world, actorId, { kind = 'motes', rate = 8, color } = {}) {
  const s = stateFor(world);
  const kindIndex = PARTICLE_KINDS.indexOf(kind);
  if (s.disposed || kindIndex < 0 || s.emitters.length >= MAX_EMITTERS || !world.getActor(actorId)) return NOOP_HANDLE;
  particleSystem(s);
  const em = { id: actorId, kindIndex, rate, acc: Math.random(), rgb: rgb(world.THREE, color ?? PARTICLE_DEFAULT_COLOR[kind]) };
  em.handle = {
    get active() { return s.emitters.includes(em); },
    remove() { const i = s.emitters.indexOf(em); if (i >= 0) s.emitters.splice(i, 1); },
    setRate(r) { em.rate = Math.max(0, Number(r) || 0); },
    setColor(c) { em.rgb = rgb(world.THREE, c); },
  };
  s.emitters.push(em);
  return em.handle;
}

/** Small star sparkles around a (shiny) actor: a tight 'stars' emitter. */
export function twinkle(world, actorId, opts = {}) {
  return particles(world, actorId, { kind: 'stars', rate: 5, color: 0xfff6c8, ...opts });
}

// ---- trail: ribbon following an actor

const TRAIL_STEP = 1 / 30;
const DEFAULT_TRAIL_COLORS = ['#ff6b6b', '#ffd84a', '#6bcb77', '#4d96ff', '#c77dff'];

function killTrail(s, tr) {
  const i = s.trails.indexOf(tr);
  if (i >= 0) s.trails.splice(i, 1);
  s.world.scene.remove(tr.mesh);
  tr.geo.dispose();
  tr.mat.dispose();
}

/** Ribbon behind a moving actor (<= 4 alive, 1 draw call each). Returns a handle; remove() lets it fade out. */
export function trail(world, actorId, { colors = DEFAULT_TRAIL_COLORS, width = 0.35, length = 22 } = {}) {
  const s = stateFor(world);
  const pol = fxPolicy(tierOf(world), isReduced());
  if (s.disposed || !pol.trails || !world.getActor(actorId)) return NOOP_HANDLE;
  if (s.trails.length >= MAX_TRAILS) {
    const fading = s.trails.find(t => t.fading);
    if (!fading) return NOOP_HANDLE;
    killTrail(s, fading);
  }
  const { THREE, scene } = world;
  const L = Math.max(4, Math.min(48, Math.floor(length) || 22));
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(L * 2 * 3);
  const cols = new Float32Array(L * 2 * 3);
  const index = [];
  for (let i = 0; i < L - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(index);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  mat.forceSinglePass = true; // transparent + DoubleSide would otherwise cost 2 draw calls
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.userData.noPick = true;
  scene.add(mesh);
  const tr = {
    id: actorId, L, width, geo, mat, mesh, positions, cols, hist: [], acc: 0, fading: false, fadeSteps: 0,
    stops: (colors && colors.length ? colors : DEFAULT_TRAIL_COLORS).map(c => rgb(THREE, c)),
  };
  tr.handle = {
    get active() { return s.trails.includes(tr) && !tr.fading; },
    remove() { tr.fading = true; },
    setColor() {},
    setRate() {},
  };
  s.trails.push(tr);
  return tr.handle;
}

function updateTrails(s, dt) {
  if (!s.trails.length) return;
  const world = s.world;
  const cam = world.camera;
  const right = { x: 0, y: 0, z: 0 };
  cam.updateMatrixWorld();
  right.x = cam.matrixWorld.elements[0]; right.y = cam.matrixWorld.elements[1]; right.z = cam.matrixWorld.elements[2];
  const pol = fxPolicy(tierOf(world), isReduced());
  for (const tr of [...s.trails]) {
    const a = world.getActor(tr.id);
    if (!a || !pol.trails) tr.fading = true;
    if (!tr.fading && a) {
      const p = a.object.position;
      const cur = { x: p.x, y: p.y + a.height * 0.45, z: p.z };
      if (!tr.hist.length) for (let i = 0; i < tr.L; i++) tr.hist.push({ ...cur });
      tr.hist[0] = cur;
      tr.acc += dt;
      while (tr.acc >= TRAIL_STEP) { tr.acc -= TRAIL_STEP; tr.hist.unshift({ ...cur }); tr.hist.length = Math.min(tr.hist.length, tr.L); }
    } else if (tr.fading) {
      tr.acc += dt;
      while (tr.acc >= TRAIL_STEP) { tr.acc -= TRAIL_STEP; tr.hist.unshift({ ...tr.hist[0] }); tr.hist.length = Math.min(tr.hist.length, tr.L); tr.fadeSteps++; }
      if (tr.fadeSteps >= tr.L) { killTrail(s, tr); continue; }
    }
    const h = tr.hist;
    for (let i = 0; i < tr.L; i++) {
      const pt = h[Math.min(i, h.length - 1)];
      const prev = h[Math.max(0, Math.min(i, h.length - 1) - 1)];
      const next = h[Math.min(h.length - 1, Math.min(i, h.length - 1) + 1)];
      // side vector = tangent x view, falling back to the camera's right vector when standing still
      const tx = prev.x - next.x; const ty = prev.y - next.y; const tz = prev.z - next.z;
      const vx = cam.position.x - pt.x; const vy = cam.position.y - pt.y; const vz = cam.position.z - pt.z;
      let sx = ty * vz - tz * vy; let sy = tz * vx - tx * vz; let sz = tx * vy - ty * vx;
      let len = Math.hypot(sx, sy, sz);
      if (len < 1e-5) { sx = right.x; sy = right.y; sz = right.z; len = Math.hypot(sx, sy, sz) || 1; }
      const w = trailHalfWidth(i, tr.L, tr.width) / len;
      const o = i * 6;
      tr.positions[o] = pt.x + sx * w; tr.positions[o + 1] = pt.y + sy * w; tr.positions[o + 2] = pt.z + sz * w;
      tr.positions[o + 3] = pt.x - sx * w; tr.positions[o + 4] = pt.y - sy * w; tr.positions[o + 5] = pt.z - sz * w;
      const t = i / (tr.L - 1);
      const c = colorRamp(tr.stops, t);
      const f = Math.pow(1 - t, 1.2);
      tr.cols[o] = tr.cols[o + 3] = c[0] * f; tr.cols[o + 1] = tr.cols[o + 4] = c[1] * f; tr.cols[o + 2] = tr.cols[o + 5] = c[2] * f;
    }
    tr.geo.attributes.position.needsUpdate = true;
    tr.geo.attributes.color.needsUpdate = true;
  }
}

// ---- lightBeam (timed, 2 draw calls while it plays)

/** A pillar of light with a ground flash at `pos` (legendary hatch). */
export function lightBeam(world, pos, { color = 0xfff2b0, duration = 1.6 } = {}) {
  const s = stateFor(world);
  if (s.disposed) return NOOP_HANDLE;
  const { THREE, scene } = world;
  const p = vec(pos);
  const H = 16;
  const geo = new THREE.CylinderGeometry(0.22, 0.5, H, 20, 1, true);
  geo.translate(0, H / 2, 0);
  const posAttr = geo.attributes.position;
  const cols = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const k = Math.pow(1 - posAttr.getY(i) / H, 1.5);
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const rgbc = new THREE.Color(color);
  const beamMat = new THREE.MeshBasicMaterial({
    color: rgbc, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  beamMat.forceSinglePass = true;
  const beam = new THREE.Mesh(geo, beamMat);
  beam.position.set(p.x, p.y, p.z);
  beam.renderOrder = 14;
  beam.userData.noPick = true;
  const flashGeo = new THREE.PlaneGeometry(1, 1);
  flashGeo.rotateX(-Math.PI / 2);
  const flashMat = new THREE.MeshBasicMaterial({
    map: canvasTexture(s, 'glow', drawGlow, 128), color: rgbc, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.position.set(p.x, p.y + 0.05, p.z);
  flash.renderOrder = 13;
  flash.userData.noPick = true;
  scene.add(beam, flash);
  world.boost(duration * 1000 + 300);
  const rec = {
    age: 0, dur: Math.max(0.2, duration), done: false,
    tick(dt) {
      this.age += dt;
      const u = clamp01(this.age / this.dur);
      const grow = easeOutCubic(Math.min(1, u / 0.2));
      const fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      const w = grow * (1 + 0.25 * Math.sin(u * 14)) * (u > 0.7 ? fade : 1);
      beam.scale.set(Math.max(0.01, w), 1, Math.max(0.01, w));
      beamMat.opacity = 0.4 * grow * fade;
      const fs = 1.5 + 4.5 * easeOutCubic(u);
      flash.scale.set(fs, 1, fs);
      flashMat.opacity = 0.6 * (1 - u) * grow;
      return u >= 1;
    },
    dispose() {
      scene.remove(beam, flash);
      geo.dispose(); beamMat.dispose(); flashGeo.dispose(); flashMat.dispose();
    },
  };
  s.timed.push(rec);
  return { get active() { return s.timed.includes(rec); }, remove() { rec.age = rec.dur; }, setColor() {}, setRate() {} };
}

function updateTimed(s, dt) {
  for (let i = s.timed.length - 1; i >= 0; i--) {
    const rec = s.timed[i];
    if (rec.tick(dt)) { s.timed.splice(i, 1); rec.dispose(); }
  }
}

// ---- dimScene + shake

/** Darkens the scene by `amount` (0..1) for `ms` milliseconds, then restores it automatically. */
export function dimScene(world, amount = 0.6, ms = 1500) {
  const s = stateFor(world);
  if (s.disposed) return;
  s.dim = { amount: clamp01(amount), age: 0, tin: 0.35, hold: Math.max(0, ms / 1000), tout: 0.6, from: s.dimValue || 0 };
}

function updateDim(s, dt) {
  const d = s.dim;
  if (!d) return;
  d.age += dt;
  const total = d.tin + d.hold + d.tout;
  const v = d.age >= total ? 0 : dimEnvelope(d.age, d.tin, d.hold, d.tout, d.amount ? Math.min(1, d.from / d.amount) : 0) * d.amount;
  s.dimValue = v;
  s.world.setDim(v);
  if (d.age >= total) { s.dim = null; s.dimValue = 0; }
}

/** Camera shake for `ms` milliseconds (no-op with reduced motion). */
export function shake(world, ms = 500, strength = 0.15) {
  const s = stateFor(world);
  if (s.disposed || !fxPolicy(tierOf(world), isReduced()).shake) return;
  const dur = Math.max(0.05, ms / 1000);
  if (!s.shake || shakeAmplitude(s.shake.age, s.shake.dur, s.shake.strength) <= strength) s.shake = { age: 0, dur, strength };
  world.boost(ms + 100);
}

function updateShake(s, dt) {
  const k = s.shake;
  if (!k) return;
  k.age += dt;
  if (k.age >= k.dur) { s.shake = null; s.world.setShakeOffset(0, 0, 0); return; }
  const amp = shakeAmplitude(k.age, k.dur, k.strength);
  s.world.setShakeOffset((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 1.2 * amp, (Math.random() - 0.5) * 2 * amp);
}

// ---- glowHalo (shiny billboards)

/** Additive glow sprite behind an actor's emoji billboard (instead of a colour filter). */
export function glowHalo(world, actorId, { color = 0xffe28a } = {}) {
  const s = stateFor(world);
  if (s.disposed) return NOOP_HANDLE;
  const old = s.halos.find(h => h.id === actorId);
  if (old) { old.sprite.material.color.set(color); return old.handle; }
  if (s.halos.length >= MAX_HALOS || !world.getActor(actorId)) return NOOP_HANDLE;
  const { THREE, scene } = world;
  const mat = new THREE.SpriteMaterial({
    map: canvasTexture(s, 'glow', drawGlow, 128), color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = -0.5;
  sprite.userData.noPick = true;
  scene.add(sprite);
  const rec = { id: actorId, sprite, phase: Math.random() * 6.28 };
  rec.handle = {
    get active() { return s.halos.includes(rec); },
    remove() { removeHalo(s, rec); },
    setColor(c) { mat.color.set(c); },
    setRate() {},
  };
  s.halos.push(rec);
  return rec.handle;
}

function removeHalo(s, rec) {
  const i = s.halos.indexOf(rec);
  if (i < 0) return;
  s.halos.splice(i, 1);
  s.world.scene.remove(rec.sprite);
  rec.sprite.material.dispose();
}

const haloDir = { x: 0, y: 0, z: 0 };
function updateHalos(s, dt, t) {
  const pulse = fxPolicy(tierOf(s.world), isReduced()).pulse;
  const cam = s.world.camera.position;
  for (const rec of [...s.halos]) {
    const a = s.world.getActor(rec.id);
    if (!a) { removeHalo(s, rec); continue; }
    rec.sprite.visible = a.object.visible;
    const p = a.object.position;
    const cx = p.x; const cy = p.y + a.height * 0.5; const cz = p.z;
    haloDir.x = cx - cam.x; haloDir.y = cy - cam.y; haloDir.z = cz - cam.z;
    const len = Math.hypot(haloDir.x, haloDir.y, haloDir.z) || 1;
    const off = 0.08 / len; // nudge away from the camera so the emoji sprite draws in front
    rec.sprite.position.set(cx + haloDir.x * off, cy + haloDir.y * off, cz + haloDir.z * off);
    const size = Math.max(a.height, a.radius * 2) * 2.1 * (pulse ? 0.94 + 0.06 * Math.sin(t * 2.6 + rec.phase) : 1);
    rec.sprite.scale.set(size, size, 1);
  }
}

// ---- stats (tests / debugging)

/** Counts of live V5 effects for a world. */
export function fxStats(world) {
  const s = states.get(world);
  if (!s) return { auras: 0, emitters: 0, particles: 0, trails: 0, halos: 0, timed: 0 };
  return {
    auras: s.auras.length, emitters: s.emitters.length, particles: s.particles ? s.particles.n : 0,
    trails: s.trails.length, halos: s.halos.length, timed: s.timed.length,
  };
}

/** Draw calls these effects currently cost (what the contract budgets): see the header table. */
export function fxDrawCalls(world) {
  const st = fxStats(world);
  const low = tierOf(world) === 'low';
  return (st.auras ? (low ? 1 : 2) : 0) + (st.particles ? 1 : 0) + st.trails + st.halos + st.timed * 2;
}

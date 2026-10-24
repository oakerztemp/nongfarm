// Idle behaviour for the 3D barn (CONTRACT_V4 §3). DOM-free and three-free: pure decisions from the
// pet's state + personality, so they are unit-tested with a seeded rng.
//
// World units: the yard is a disc centred on (0,0) in the x/z plane, +z points toward the default camera.
// Positions are cosmetic and never saved.

import { getSpecies } from './data/species.js';
import { getItem } from './data/items.js';

/**
 * Layout shared with barn3d.js, matched to js/world3d/engine.js (island radius 7, fence 6.3, barn prop at z = -4.9
 * facing +z, default camera at +z). Pets use a smaller circle than the engine allows so they stay big on screen.
 */
export const YARD = {
  walkRadius: 4.3,                   // pets never walk beyond this
  backLimit: -1.9,                   // z below this is the nest row / barn strip: no wander targets there
  nestZ: -2.55,                      // incubator nests stand in a row in front of the barn door
  bowl: { x: 1.7, z: 2.3 },          // food bowl, front right
  bowlClear: 0.9,                    // wander targets keep this far from the bowl centre
  obstacles: [],                     // static prop circles { x, z, r } of the current yard tier (pond, tree, ...)
};

// ── Yard tiers (CONTRACT_V6 §4) ─────────────────────────────────────────────
// Mirrors engine.YARD_TIERS (walk radius + barn z); a test keeps the two in sync. Props are static scenery that
// barn3d builds; the circles also keep wander targets away from them.
export const YARD_TIER_LAYOUT = {
  S: { walk: 4.3, barnZ: -3.6 },
  M: { walk: 5.0, barnZ: -4.3 },
  L: { walk: 5.6, barnZ: -4.9 },
  XL: { walk: 6.2, barnZ: -5.5 },
};
const TIER_RANK = { S: 0, M: 1, L: 2, XL: 3 };

/** Tier for a barnCapacity: 3-5 S, 6-9 M, 10-14 L, 15+ XL (same rule as the engine). */
export function yardTierOf(capacity) {
  const c = Number(capacity) || 0;
  return c >= 15 ? 'XL' : c >= 10 ? 'L' : c >= 6 ? 'M' : 'S';
}

/** Static props of a tier: M pond + tree, L + flower bed + playground, XL + hill with gazebo + 4 lanterns. r = blocked radius. */
export function yardProps(tier) {
  const rank = TIER_RANK[tier] ?? 0;
  const out = [];
  if (rank >= 1) out.push({ id: 'pond', kind: 'pond', x: -3.6, z: 1.6, r: 1.1 }, { id: 'tree', kind: 'tree', x: 3.9, z: -0.4, r: 0.55 });
  if (rank >= 2) out.push({ id: 'flowerbed', kind: 'flowerbed', x: 3.3, z: 3.5, r: 0.9 }, { id: 'playground', kind: 'playground', x: -3.8, z: -0.9, r: 1.0 });
  if (rank >= 3) {
    out.push({ id: 'hill', kind: 'hill', x: 5.2, z: -2.4, r: 1.3 });
    for (const [i, [x, z]] of [[-4.6, 2.9], [4.6, 2.9], [-2.6, 4.9], [2.6, 4.9]].entries()) out.push({ id: `lantern${i}`, kind: 'lantern', x, z, r: 0.25 });
  }
  return out;
}

/** Re-targets the behaviour layout (walk radius, nest row, blocked props) when the yard changes tier. */
export function configureYard(tier = 'L') {
  const lay = YARD_TIER_LAYOUT[tier] || YARD_TIER_LAYOUT.L;
  YARD.walkRadius = lay.walk - 0.1;
  YARD.nestZ = lay.barnZ + 2.35;
  YARD.backLimit = lay.barnZ + 3.0;
  YARD.obstacles = yardProps(tier).map(({ x, z, r }) => ({ x, z, r }));
  return YARD;
}

/** Position of incubator nest i of n (a row in front of the barn door). */
export function nestSpot(i, n) {
  return { x: (i - (n - 1) / 2) * 1.25, z: YARD.nestZ };
}

/** Small seeded rng (mulberry32). Returns () => [0,1). */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable small hash of a string (pet id) -> uint32. */
export function hashId(id) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Keep a point inside the walkable disc (and never NaN). */
export function clampToYard(x, z, r = YARD.walkRadius) {
  x = num(x); z = num(z);
  const d = Math.hypot(x, z);
  if (d > r && d > 0) { x = (x / d) * r; z = (z / d) * r; }
  return { x, z };
}

/** A pet-specific standing spot beside the food bowl (so hungry pets do not stack on one point). */
export function bowlSpot(petId) {
  const ang = ((hashId(petId) % 1000) / 1000) * Math.PI * 1.6 + Math.PI * 0.1; // fan in front/side of the bowl
  const r = 0.75 + ((hashId(petId + 'r') % 100) / 100) * 0.35;
  const p = clampToYard(YARD.bowl.x + Math.cos(ang) * r, YARD.bowl.z + Math.sin(ang) * r);
  return p;
}

/** Hungry / dirty / sick / sad etc. -> what should float over the pet. Highest priority first. */
export function bubbleFor(pet) {
  if (!pet) return null;
  const s = pet.stats || {};
  if (pet.sick) return { kind: 'sick', emoji: '🤒' };
  if (pet.status === 'sleeping') return { kind: 'sleep', emoji: '💤' };
  if (num(s.hunger, 100) < 25) {
    const sp = getSpecies(pet.speciesId);
    const it = sp && getItem(sp.favorite);
    return { kind: 'food', emoji: it ? it.emoji : '🍖' };
  }
  if (num(s.clean, 100) < 25 || num(pet.poop) >= 2) return { kind: 'fly', emoji: '🪰' };
  if (num(s.happy, 100) < 25) return { kind: 'sad', emoji: '😢' };
  if (num(s.energy, 100) < 20) return { kind: 'tired', emoji: '🥱' };
  return null;
}

// personality -> behaviour weights. wander/idle/look/hop/nap/approach are relative weights; speed multiplies
// walking pace, pause multiplies how long calm pauses last.
const PERS = {
  hardworking: { wander: 4,   idle: 2.6, look: 0.8, hop: 0.4, nap: 0.1, approach: 0.4, speed: 1,    pause: 0.9 },
  lazy:        { wander: 1.1, idle: 4,   look: 0.6, hop: 0.2, nap: 2.4, approach: 0.1, speed: 0.7,  pause: 1.7 },
  glutton:     { wander: 2.8, idle: 3,   look: 0.7, hop: 0.4, nap: 0.3, approach: 0.5, speed: 0.9,  pause: 1.1 },
  cheerful:    { wander: 3.2, idle: 2.4, look: 1.2, hop: 1.2, nap: 0.1, approach: 1.3, speed: 1.1,  pause: 0.8 },
  shy:         { wander: 2,   idle: 3.5, look: 0.15, hop: 0.2, nap: 0.4, approach: 0,  speed: 0.85, pause: 1.3 },
  naughty:     { wander: 4.2, idle: 1.4, look: 1,   hop: 1.1, nap: 0.1, approach: 0.9, speed: 1.7,  pause: 0.5 },
};
const DEFAULT_PERS = PERS.cheerful;

/** Walking speed multiplier for a pet (barn3d multiplies by its base units/s). */
export function paceOf(pet) {
  const p = PERS[pet && pet.personality] || DEFAULT_PERS;
  let v = p.speed;
  const sad = pet && pet.stats && num(pet.stats.happy, 100) < 25;
  const tired = pet && pet.stats && num(pet.stats.energy, 100) < 25;
  if (sad || tired) v *= 0.7;
  return v;
}

function weightedPick(entries, rng) {
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  if (total <= 0) return entries[0][0];
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= Math.max(0, w);
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

function validTarget(x, z, fromX, fromZ) {
  if (dist(x, z, YARD.bowl.x, YARD.bowl.z) < YARD.bowlClear) return false;
  if (z < YARD.backLimit) return false; // the nest row / barn strip stays clear
  for (const o of YARD.obstacles) if (dist(x, z, o.x, o.z) < o.r + 0.6) return false; // pond, tree, hill ...
  if (dist(x, z, fromX, fromZ) < 0.9) return false; // tiny shuffles look jittery
  return true;
}

function randomYardPoint(rng) {
  const ang = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * YARD.walkRadius;
  return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
}

/**
 * Picks a wander target by occupancy: several random yard points are scored by their distance to every other pet
 * (and to where the others are heading: `tx`,`tz`), so the crowd spreads out instead of clumping in the middle.
 * Shy pets only look at the distance; everyone else adds a little randomness so paths do not look planned.
 */
export function pickTarget(rng, ax, az, others, shy) {
  let best = null, bestScore = -Infinity;
  const tries = shy ? 8 : 7;
  for (let i = 0; i < tries; i++) {
    const c = randomYardPoint(rng);
    if (!validTarget(c.x, c.z, ax, az)) continue;
    let nearest = 9;
    for (const o of others) {
      let d = dist(c.x, c.z, o.x, o.z);
      if (Number.isFinite(o.tx) && Number.isFinite(o.tz)) d = Math.min(d, dist(c.x, c.z, o.tx, o.tz));
      if (d < nearest) nearest = d;
    }
    const score = Math.min(nearest, 3) + (shy ? 0 : rng() * 0.6);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best) return best;
  // fallback: a guaranteed-valid point on the opposite side of the yard
  const away = clampToYard(-ax * 0.8 + 0.4, -az * 0.8 + 0.4);
  return validTarget(away.x, away.z, ax, az) ? away : { x: 1.2, z: -0.4 };
}

// Signature idle moves (CONTRACT_V5): legendary pets get the full version, epic pets a smaller one.
export const SIGNATURE = {
  dragon: 'flyCircle', unicorn: 'gallop', eagle: 'soar', humpback: 'breach', lion: 'roar',
  panda: 'munch', polarbear: 'snowPuff', beetle: 'shimmer', racehorse: 'sprint',
};
const EPIC_SIGNATURE = {
  dragonhead: 'flyCircle', mammoth: 'roar', tiger: 'roar', gorilla: 'roar', shark: 'breach', dolphin: 'breach',
  peacock: 'shimmer', flamingo: 'shimmer', leopard: 'sprint', poodle: 'flourish', turkey: 'flourish',
  spider: 'shimmer', scorpion: 'flourish', rhino: 'sprint', yak: 'snowPuff', arcticwolf: 'snowPuff',
};
export const SIGNATURE_TYPES = new Set(['flyCircle', 'gallop', 'soar', 'breach', 'roar', 'munch', 'snowPuff', 'shimmer', 'sprint', 'flourish']);

/** { type, tier:'legendary'|'epic' } for rare species, null for everyone else. */
export function signatureFor(speciesId) {
  const sp = getSpecies(speciesId);
  if (!sp) return null;
  if (sp.rarity === 'legendary') return { type: SIGNATURE[speciesId] || 'flourish', tier: 'legendary' };
  if (sp.rarity === 'epic') return { type: EPIC_SIGNATURE[speciesId] || 'flourish', tier: 'epic' };
  return null;
}

/** Share of awake pets that may nap at the same time (keeps the yard from being full of 💤). */
export const NAP_CAP = 0.25;

const pause = (rng, mult, lo = 3, hi = 8) => (lo + rng() * (hi - lo)) * mult;

/**
 * Decides what a pet does next. Called when its previous action finished (or the state changed).
 *   pet         the saved pet (status/sick/stats/personality)
 *   actorState  { x, z, others:[{id,x,z}], last:'wander'|'idle'|... }   (positions are cosmetic, may be missing)
 *   rng         () => [0,1)
 *   now         ms (reserved for time-of-day flavour; not needed today)
 * Returns { type, duration, target?, speed?, reason?, otherId?, nap?, small? } where type is one of
 *   wander | idle | sleep | eat | poop | sick | lookAtCamera | hop | approach
 * or (legendary / epic species only, chosen occasionally) a signature move: flyCircle | gallop | soar | breach |
 * roar | munch | snowPuff | shimmer | sprint | flourish.
 * actorState may also carry napRatio (share of awake pets already napping) and others[].tx/tz (their targets).
 * and every `target` is a finite point inside the walkable yard. `eat` and `poop` are never chosen here:
 * barn3d plays them as reactions (feedPet result / a poop appearing).
 */
export function nextAction(pet, actorState = {}, rng = Math.random, now = 0) { // eslint-disable-line no-unused-vars
  const st = (pet && pet.stats) || {};
  const ax = num(actorState.x), az = num(actorState.z);
  const others = (Array.isArray(actorState.others) ? actorState.others : [])
    .filter(o => o && Number.isFinite(o.x) && Number.isFinite(o.z));
  const pers = PERS[pet && pet.personality] || DEFAULT_PERS;
  const last = actorState.last || 'idle';
  const pace = paceOf(pet);

  // 1. Sleeping pets stay curled up (re-evaluated every few seconds in case they wake).
  if (pet && pet.status === 'sleeping') return { type: 'sleep', duration: 12 };

  // 2. Sick pets shiver in place; once in a while they shuffle a little.
  if (pet && pet.sick) {
    if (last === 'sick' && rng() < 0.25) {
      const t = pickTarget(rng, ax, az, others, true);
      const near = clampToYard(ax + (t.x - ax) * 0.3, az + (t.z - az) * 0.3);
      if (dist(near.x, near.z, ax, az) > 0.3) {
        return { type: 'wander', target: near, speed: 0.5, reason: 'sick', duration: 0 };
      }
    }
    return { type: 'sick', duration: pause(rng, 1, 4, 8) };
  }

  // 3. Hungry (<25): go stand by the food bowl and wait, bubble shows the favourite food.
  if (num(st.hunger, 100) < 25) {
    const spot = bowlSpot(pet.id);
    if (dist(ax, az, spot.x, spot.z) > 0.55) {
      return { type: 'wander', target: spot, speed: Math.min(1.3, pace * 1.15), reason: 'hungry', duration: 0 };
    }
    return { type: 'idle', reason: 'hungry', duration: pause(rng, 1, 3, 6) };
  }

  // 4. Shy pets back away when someone gets close.
  if (pet && pet.personality === 'shy' && others.length) {
    const closest = others.reduce((b, o) => (dist(ax, az, o.x, o.z) < dist(ax, az, b.x, b.z) ? o : b), others[0]);
    if (dist(ax, az, closest.x, closest.z) < 1.8 && rng() < 0.8) {
      return { type: 'wander', target: pickTarget(rng, ax, az, others, true), speed: pace, reason: 'shy', duration: 0 };
    }
  }

  // 5. Peckish gluttons hang around the bowl.
  if (pet && pet.personality === 'glutton' && num(st.hunger, 100) < 60 && rng() < 0.35) {
    const spot = bowlSpot(pet.id);
    if (dist(ax, az, spot.x, spot.z) > 0.8) {
      return { type: 'wander', target: spot, speed: pace, reason: 'peckish', duration: 0 };
    }
  }

  // 6. Free time: weighted choice with long calm pauses (after walking, mostly stand still for a while).
  const happy = num(st.happy, 100);
  const energy = num(st.energy, 100);
  const sad = happy < 25;
  const w = {
    wander: pers.wander * (sad ? 0.5 : 1) * (last === 'wander' ? 0.25 : 1),
    idle: pers.idle * (last === 'wander' ? 2.2 : 1) * (sad ? 1.5 : 1),
    lookAtCamera: pers.look,
    hop: (pers.hop + (happy >= 80 ? 1.6 : 0)) * (sad ? 0 : 1) * (last === 'hop' ? 0.2 : 1),
    nap: (pers.nap + (energy < 30 ? 1.5 : 0)) * (energy >= 95 ? 0.15 : 1) * (last === 'sleep' ? 0.2 : 1),
    approach: others.length && !sad ? pers.approach : 0,
    signature: 0,
  };
  // staggered naps: when a quarter of the awake pets already nap, nobody starts another one
  if ((Number(actorState.napRatio) || 0) >= NAP_CAP) w.nap = 0;
  const sig = signatureFor(pet && pet.speciesId);
  if (sig && !sad && !SIGNATURE_TYPES.has(last)) w.signature = sig.tier === 'legendary' ? 0.75 : 0.35;
  const choice = weightedPick(Object.entries(w), rng);

  switch (choice) {
    case 'wander':
      return { type: 'wander', target: pickTarget(rng, ax, az, others, pet && pet.personality === 'shy'), speed: pace, duration: 0 };
    case 'signature':
      return { type: sig.type, duration: DEFAULT_DUR[sig.type], small: sig.tier === 'epic', tier: sig.tier };
    case 'lookAtCamera':
      return { type: 'lookAtCamera', duration: 2 + rng() * 2.5 };
    case 'hop':
      return { type: 'hop', duration: 1.6, hops: 2 + Math.floor(rng() * 3) };
    case 'nap':
      return { type: 'sleep', nap: true, duration: 6 + rng() * 6 };
    case 'approach': {
      const o = others[Math.floor(rng() * others.length)];
      const ang = rng() * Math.PI * 2;
      const t = clampToYard(o.x + Math.cos(ang) * 0.9, o.z + Math.sin(ang) * 0.9);
      if (!validTarget(t.x, t.z, ax, az)) return { type: 'idle', duration: pause(rng, pers.pause), reason: 'approach-blocked' };
      return { type: 'approach', otherId: o.id, target: t, speed: pace, duration: 0 };
    }
    default:
      return { type: 'idle', duration: pause(rng, pers.pause) };
  }
}

// ── Action loop (pure; barn3d.js drives it every frame, tests drive it with a fake clock) ──────────────────
export const WALK_BASE = 1.25;   // world units / second at pace 1
export const TURN_RATE = 9;      // heading smoothing (1/s)
const WALKS = new Set(['wander', 'approach', 'walkTo']);
/** Fallback durations (s) for timed actions that do not carry one. */
export const DEFAULT_DUR = {
  idle: 3, sleep: 12, sick: 5, lookAtCamera: 2, hop: 1.6, eat: 1.8, no: 0.7, bathe: 2.2, poop: 1.1, play: 3,
  flyCircle: 9, soar: 8, gallop: 6, sprint: 5, breach: 2.2, roar: 2.6, munch: 5, snowPuff: 3, shimmer: 2.4, flourish: 1.4,
};

/** Shortest signed angle from a to b. */
export function angDiff(a, b) {
  const T = Math.PI * 2;
  let d = (b - a) % T;
  if (d > Math.PI) d -= T;
  if (d < -Math.PI) d += T;
  return d;
}

/** Turns a nextAction() result (which says `duration`) or a scripted reaction (`dur`) into a running action. */
export function beginAction(act) {
  const dur = Number.isFinite(act.dur) ? act.dur : Number.isFinite(act.duration) ? act.duration : (DEFAULT_DUR[act.type] ?? 0);
  return { ...act, t: 0, dur };
}

/**
 * Advances actor A = { x, z, heading, phase, act } by dt seconds: timers, walking and arrival.
 * decide(A) is called (once) only when the current action finished; it must set A.act = beginAction(...).
 * Returns { moving, decided }.
 */
export function advanceActor(A, dt, decide) {
  const act = A.act;
  act.t += dt;
  const finish = () => { if (A.act === act) decide(A); }; // a callback may already have started a new action
  if (WALKS.has(act.type)) {
    const tgt = act.target;
    if (!tgt || !Number.isFinite(tgt.x) || !Number.isFinite(tgt.z)) { finish(); return { moving: false, decided: true }; }
    const dx = tgt.x - A.x, dz = tgt.z - A.z, d = Math.hypot(dx, dz);
    if (d < 0.12 || act.t > 25) {
      if (act.onArrive) act.onArrive(A);
      finish();
      return { moving: false, decided: true };
    }
    const sp = WALK_BASE * (act.speed || 1);
    const stp = Math.min(d, sp * dt);
    A.x += (dx / d) * stp; A.z += (dz / d) * stp;
    A.heading += angDiff(A.heading, Math.atan2(dx, dz)) * Math.min(1, dt * TURN_RATE);
    A.phase += dt * (5.2 + sp * 3);
    return { moving: true, decided: false };
  }
  if (act.t >= act.dur) {
    if (act.then) act.then(A);
    finish();
    return { moving: false, decided: true };
  }
  return { moving: false, decided: false };
}

/** Which hatch ceremony a freshly hatched pet gets (decided from the real hatchReady() result). */
export function ceremonyKind(pet) {
  const sp = pet && getSpecies(pet.speciesId);
  return sp && sp.rarity === 'legendary' ? 'legendary' : 'common';
}

// ── Animated model parts (critters kit): wingL/wingR, tail, tailTip, trunk, mane. Every part is optional. ─────
const rot = o => (o && o.rotation && Number.isFinite(o.rotation.x) ? { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z } : null);

/** Remembers the resting rotation of the optional parts so animations are offsets from it. */
export function partBases(parts) {
  const p = parts || {};
  return { wingL: rot(p.wingL), wingR: rot(p.wingR), tail: rot(p.tail), tailTip: rot(p.tailTip), trunk: rot(p.trunk), mane: rot(p.mane), fluke: rot(p.fluke) };
}

/**
 * Applies pose offsets (P.wing flap, P.tail / P.tailTip swish, P.trunk swing, P.mane shake) to whatever parts a
 * model has. Missing parts (billboards, other species) are simply skipped.
 */
export function applyPartPose(parts, base, P) {
  if (!parts || !base || !P) return;
  const set = (name, axis, value) => {
    const part = parts[name], b = base[name];
    if (part && part.rotation && b && Number.isFinite(value)) part.rotation[axis] = b[axis] + value;
  };
  const w = P.wing || 0;
  set('wingL', 'z', w);
  set('wingR', 'z', -w);
  set('tail', 'y', P.tail || 0);
  set('tailTip', 'y', P.tailTip || 0);
  set('trunk', 'x', P.trunk || 0);
  set('mane', 'z', P.mane || 0);
  set('fluke', 'x', P.fluke || 0);
}

/** A new hatch ceremony may start unless another one is still before its burst (egg still in the nest). */
export function canStartCeremony(h) {
  return !h || h.phase === 'burst';
}

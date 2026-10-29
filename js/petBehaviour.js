// Idle behaviour for the 3D barn (CONTRACT_V4 §3). DOM-free and three-free: pure decisions from the
// pet's state + personality, so they are unit-tested with a seeded rng.
//
// World units: the yard is a disc centred on (0,0) in the x/z plane, +z points toward the default camera.
// Positions are cosmetic and never saved.

import { getSpecies } from './data/species.js';
import { getItem } from './data/items.js';

/**
 * Layout shared with barn3d.js, matched to js/world3d/engine.js (V23: tier L island radius 9.0, fence 8.3, barn prop at
 * z = -5.8 facing +z, default camera at +z). Pets use a smaller circle than the engine allows so they stay big on screen.
 * The defaults below are tier L; configureYard(tier) re-targets them.
 */
export const YARD = {
  walkRadius: 7.5,                   // pets never walk beyond this
  backLimit: -2.8,                   // z below this (and x in the barn/kitchen strip) is the nest row / barn strip: no wander targets there
  nestZ: -3.45,                      // incubator nests stand in a row in front of the barn door
  bowl: { x: 1.7, z: 2.3 },          // food bowl, front right
  bowlClear: 0.9,                    // wander targets keep this far from the bowl centre
  kitchen: { x: 4.17, z: -4.7, r: 1.1 }, // the kitchen hut (V23 section 3), right behind the yard; also an obstacle
  landmarks: { mailbox: { x: 3.3, z: 3.6, r: 0.35 }, board: { x: 3.6, z: -2.1, r: 0.6 }, bench: { x: -3.4, z: 3.4, r: 0.7 } }, // V24 section 2 (also obstacles)
  pathLights: [],                    // V25 path lamp posts { x, z } of the current tier (also obstacles, r 0.15)
  playground: null,                  // { x, z, r } of the playground prop (L+), where cheerful pets like to play
  obstacles: [],                     // static prop circles { x, z, r } of the current yard tier (pond, tree, kitchen ...)
  flowers: [],                       // where a bee may visit: flowerbed blooms and pond lilies of the current tier (V11 §5)
  trees: [],                         // tree props { id, x, z } of the current tier (a spider hangs from one)
};

// ── Yard tiers (CONTRACT_V6 §4) ─────────────────────────────────────────────
// Mirrors engine.YARD_TIERS (walk radius + barn z; V23 sizes, CONTRACT_V23 section 1); a test keeps the two in sync. Props are
// static scenery that barn3d builds; the circles also keep wander targets away from them.
export const YARD_TIER_LAYOUT = {
  S: { walk: 5.0, barnZ: -4.3 },
  M: { walk: 6.4, barnZ: -5.2 },
  L: { walk: 7.6, barnZ: -5.8 },
  XL: { walk: 9.0, barnZ: -6.4 },
};
const TIER_RANK = { S: 0, M: 1, L: 2, XL: 3 };

/** Tier for a barnCapacity: 3-5 S, 6-9 M, 10-14 L, 15+ XL (same rule as the engine). */
export function yardTierOf(capacity) {
  const c = Number(capacity) || 0;
  return c >= 15 ? 'XL' : c >= 10 ? 'L' : c >= 6 ? 'M' : 'S';
}

/** Static props of a tier (V23 zones): M pond + tree, L + flower bed + playground, XL + hill with gazebo + 4 lanterns. r = blocked radius. */
export function yardProps(tier) {
  const rank = TIER_RANK[tier] ?? 0;
  const out = [];
  if (rank >= 1) out.push({ id: 'pond', kind: 'pond', x: 4.3, z: 1.4, r: 1.1 }, { id: 'tree', kind: 'tree', x: -4.6, z: -1.6, r: 0.55 });
  if (rank >= 2) out.push({ id: 'flowerbed', kind: 'flowerbed', x: -3.4, z: 5.8, r: 0.9 }, { id: 'playground', kind: 'playground', x: -5.4, z: 1.6, r: 1.0 });
  if (rank >= 3) {
    out.push({ id: 'hill', kind: 'hill', x: -6.6, z: -3.6, r: 1.3 });
    for (const [i, [x, z]] of [[-6.6, 4.8], [6.6, 4.8], [-2.2, 7.4], [2.2, 7.4]].entries()) out.push({ id: `lantern${i}`, kind: 'lantern', x, z, r: 0.25 });
  }
  return out;
}

/** The kitchen hut (CONTRACT_V23 section 3): right behind the yard, beside the barn, at every tier. r = footprint radius. */
export function kitchenSpot(tier) {
  const lay = YARD_TIER_LAYOUT[tier] || YARD_TIER_LAYOUT.L;
  return { x: 3.0 + (lay.walk - 5) * 0.45, z: lay.barnZ + 1.1, r: 1.1 };
}

/**
 * The three tappable landmarks (CONTRACT_V24 section 2): mailbox (postcards), notice board (journal), bench (photo / album).
 * Per-tier coordinates, all inside the default view (|x| <= 3.6, z <= 4.6), each clear (>= 0.8 edge to edge) of props, kitchen, decor spots, bowl, nests, cribs, the barn box and
 * each other, outside the central lawn and the back strip, and away from the greet row and the party spot.
 */
const LANDMARKS = {
  S: { mailbox: { x: 3.2, z: 3.4, r: 0.35 }, board: { x: 2.7, z: -0.6, r: 0.6 }, bench: { x: -3.3, z: 3.2, r: 0.7 } },
  M: { mailbox: { x: 3.3, z: 3.6, r: 0.35 }, board: { x: 3.2, z: -1.6, r: 0.6 }, bench: { x: -3.4, z: 3.4, r: 0.7 } },
  L: { mailbox: { x: 3.3, z: 3.6, r: 0.35 }, board: { x: 3.6, z: -2.1, r: 0.6 }, bench: { x: -3.4, z: 3.4, r: 0.7 } },
  XL: { mailbox: { x: 3.3, z: 3.6, r: 0.35 }, board: { x: 3.6, z: -2.8, r: 0.6 }, bench: { x: -3.4, z: 3.4, r: 0.7 } },
};
export function landmarkSpots(tier) {
  const l = LANDMARKS[tier] || LANDMARKS.L;
  return { mailbox: { ...l.mailbox }, board: { ...l.board }, bench: { ...l.bench } };
}

// ── V25 yard paths, fence gates and path lights (CONTRACT_V25 section 2) ───────────────────────────
// Pure data. barn3d draws the paths (placePaths used to build the first three itself in V23), engine cuts the fence gaps from
// fenceGates(). The fence constants below mirror engine.YARD_TIERS / fenceRadiusAt / WILD / DECOR_SPOTS (tests keep them in sync).
const FENCE_R = { S: 5.7, M: 7.1, L: 8.3, XL: 9.7 };
const fenceR = (tier, x, z) => {
  const f = FENCE_R[tier] || FENCE_R.L, th = Math.atan2(x, z);
  return f * (1 + 0.035 * Math.sin(3 * th + 1.0) + 0.02 * Math.sin(5 * th + 2.0));
};
const STREAM = { x: 14.5, amp: 1.6, freq: 0.22 };
const streamXAt = z => STREAM.x + STREAM.amp * Math.sin(z * STREAM.freq);
const DECOR_SPOT_XZ = [[0.0, 3.6], [-2.8, 1.6], [2.6, 4.6], [-2.9, -0.9], [0.0, 6.6], [5.6, 4.0], [-7.6, -0.2], [7.6, -1.4]];
const DECOR_SPOT_N = { S: 2, M: 4, L: 6, XL: 8 };
export const PATH_WIDTH = 0.9;
export const PATH_LIGHT_OFFSET = 0.75;
export const PATH_LIGHT_R = 0.15;
export const PATH_LIGHT_MAX = { S: 2, M: 3, L: 4, XL: 5 };

const bez = (a, c, b, n = 8) => Array.from({ length: n + 1 }, (_, i) => {
  const u = i / n, v = 1 - u;
  return { x: v * v * a.x + 2 * u * v * c.x + u * u * b.x, z: v * v * a.z + 2 * u * v * c.z + u * u * b.z };
});
/** Chaikin corner cutting that keeps both end points. */
function smooth(pts, iter = 3) {
  let p = pts.map(([x, z]) => ({ x, z }));
  for (let k = 0; k < iter; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push({ x: 0.75 * a.x + 0.25 * b.x, z: 0.75 * a.z + 0.25 * b.z }, { x: 0.25 * a.x + 0.75 * b.x, z: 0.25 * a.z + 0.75 * b.z });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/**
 * The paths of a tier: barn door -> centre -> bowl, centre -> kitchen door, centre -> pond (M+), centre -> front gate -> field ('gate'),
 * centre -> east gate -> stream bank ('bridge'). Points are the centre line; the 'gate' and 'bridge' lines leave the fence.
 */
export function yardPaths(tier) {
  const t = FENCE_R[tier] ? tier : 'L';
  const lay = YARD_TIER_LAYOUT[t];
  const spot = kitchenSpot(t);
  const centre = { x: 0, z: 0 };
  const barnDoor = { x: 0, z: lay.barnZ + 1.2 };
  const bowlEdge = { x: YARD.bowl.x - 0.55, z: YARD.bowl.z - 0.4 };
  const kDoor = { x: spot.x - 0.25, z: spot.z + 0.8 + 0.15 };
  const out = [
    { id: 'barn-bowl', points: [...bez(barnDoor, { x: -0.5, z: barnDoor.z * 0.45 }, centre, 8), ...bez(centre, { x: 0.3, z: 1.6 }, bowlEdge, 6).slice(1)], width: PATH_WIDTH },
    { id: 'kitchen', points: bez(centre, { x: kDoor.x * 0.2, z: (centre.z + kDoor.z) * 0.5 }, kDoor, 8), width: PATH_WIDTH },
  ];
  const pond = yardProps(t).find(p => p.kind === 'pond');
  if (pond) out.push({ id: 'pond', points: bez(centre, { x: pond.x * 0.35, z: pond.z * 0.2 }, { x: pond.x - 1.2, z: pond.z - 0.2 }, 6), width: PATH_WIDTH });
  // front gate: out of the +z fence, 3 units into the field
  const zf = fenceR(t, 0, 1);
  out.push({ id: 'gate', points: smooth([[0, 0], [-0.3, 1.6], [-0.35, 3.4], [-0.2, zf - 0.6], [-0.1, zf + 0.8], [-0.1, zf + 3.0]]), width: PATH_WIDTH });
  // bridge: east, between the board and the pond (or low in the yard at S), through the +x fence, up to 1.2 short of the stream centre line
  const zEnd = 0.1;
  const xEnd = streamXAt(zEnd) - 1.2;
  const wp = t === 'S'
    ? [[0, 0], [1.4, 0.6], [3, 1.1], [5, 1.2], [8, 1.0], [11, 0.5], [xEnd, zEnd]]
    : [[0, 0], [1.6, -0.25], [3.8, -0.35], [6.5, -0.3], [10, -0.2], [xEnd, zEnd]];
  out.push({ id: 'bridge', points: smooth(wp), width: PATH_WIDTH });
  return out;
}

/** Where the 'gate' and 'bridge' lines cross the wavy fence: { id, angle (atan2(z, x)), halfWidth } (the fence gaps). */
export function fenceGates(tier) {
  const t = FENCE_R[tier] ? tier : 'L';
  const res = [];
  for (const p of yardPaths(t)) {
    const pts = p.points;
    const inside = q => Math.hypot(q.x, q.z) < fenceR(t, q.x, q.z);
    for (let i = 0; i < pts.length - 1; i++) {
      if (!inside(pts[i]) || inside(pts[i + 1])) continue;
      let a = pts[i], b = pts[i + 1];
      for (let k = 0; k < 24; k++) {
        const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        if (inside(m)) a = m; else b = m;
      }
      res.push({ id: p.id, angle: Math.atan2((a.z + b.z) / 2, (a.x + b.x) / 2), halfWidth: p.width / 2 + 0.25 });
      break;
    }
  }
  return res;
}

/**
 * Path lamp posts (V26: only the key spots, S 2 / M 3 / L 4 / XL 5, >= 3.5 apart). Priority: beside the front gate (one post), the central
 * junction, along the kitchen path, beside the bridge-side gate, by the pond (M+). 0.75 beside a centre line, inside the fence, never on a
 * prop / kitchen / landmark / decor spot / bowl / nest row, 0.4 clear edge to edge (post r 0.15).
 */
export function pathLightSpots(tier) {
  const t = FENCE_R[tier] ? tier : 'L';
  const lay = YARD_TIER_LAYOUT[t];
  const paths = yardPaths(t);
  const sol = [...yardProps(t), kitchenSpot(t), ...Object.values(landmarkSpots(t))].map(o => ({ x: o.x, z: o.z, r: o.r }));
  sol.push({ x: YARD.bowl.x, z: YARD.bowl.z, r: 0.4 });
  for (let i = 0; i < DECOR_SPOT_N[t]; i++) sol.push({ x: DECOR_SPOT_XZ[i][0], z: DECOR_SPOT_XZ[i][1], r: 0 });
  const zMin = lay.barnZ + 3.0 + 0.4;   // nest row / cribs / barn strip
  const distToPath = (q, skipId) => {
    let m = Infinity;
    for (const p of paths) {
      if (p.id === skipId) continue;
      for (let i = 0; i < p.points.length - 1; i++) {
        const a = p.points[i], b = p.points[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2));
        m = Math.min(m, Math.hypot(q.x - a.x - u * dx, q.z - a.z - u * dz));
      }
    }
    return m;
  };
  const lights = [];
  const max = PATH_LIGHT_MAX[t];
  const okAt = (c, skipId) => {
    if (c.z < zMin) return false;
    if (Math.hypot(c.x, c.z) + 0.6 > fenceR(t, c.x, c.z)) return false;
    for (const o of sol) if (Math.hypot(c.x - o.x, c.z - o.z) - o.r - PATH_LIGHT_R < 0.4) return false;
    for (const l of lights) if (Math.hypot(c.x - l.x, c.z - l.z) < 3.5) return false;
    return distToPath(c, skipId) >= 0.55;
  };
  const add = (c, skipId) => {
    if (lights.length >= max || !okAt(c, skipId)) return false;
    lights.push({ x: +c.x.toFixed(3), z: +c.z.toFixed(3) });
    return true;
  };
  const byId = id => paths.find(p => p.id === id);
  /** Point + left normal at arc length s of a path. */
  const at = (p, s) => {
    const pts = p.points;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len > 0 && s <= acc + len) {
        const u = (s - acc) / len;
        return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, nx: -(b.z - a.z) / len, nz: (b.x - a.x) / len };
      }
      acc += len;
    }
    return null;
  };
  const pathLen = p => p.points.slice(1).reduce((m, c, i) => m + Math.hypot(c.x - p.points[i].x, c.z - p.points[i].z), 0);
  /** First s in the list where a post fits beside the path (either side). */
  const tryPath = (p, sList, side0 = 1) => {
    if (!p) return false;
    for (const s of sList) {
      const q = at(p, s);
      if (!q || Math.hypot(q.x, q.z) + 0.6 > fenceR(t, q.x, q.z)) continue;
      for (const sd of [side0, -side0]) if (add({ x: q.x + q.nx * PATH_LIGHT_OFFSET * sd, z: q.z + q.nz * PATH_LIGHT_OFFSET * sd }, p.id)) return true;
    }
    return false;
  };
  const range = (a, b, st) => { const r = []; for (let v = a; v <= b + 1e-9; v += st) r.push(v); return r; };
  // 1. one post just inside the fence beside the front gate
  const gate = byId('gate'), zf = fenceR(t, 0, 1);
  gateLoop: for (const sx of [1, -1]) {
    for (const dz of [0.9, 1.2, 1.5, 1.8]) {
      const q = gate.points.reduce((m, c) => (Math.abs(c.z - (zf - dz)) < Math.abs(m.z - (zf - dz)) ? c : m));
      if (add({ x: q.x + sx * 1.15, z: zf - dz }, 'gate')) break gateLoop;
    }
  }
  // 2. the central junction (a post on a ring round the middle, away from every path)
  const ring = [];
  for (const r of [1.3, 1.6, 1.9, 2.2, 2.6]) for (let k = 0; k < 16; k++) {   // south-west first: keeps the kitchen / pond / bridge sides free for their own posts
    const an = 2.356 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.3927;
    ring.push({ x: Math.cos(an) * r, z: Math.sin(an) * r });
  }
  for (const c of ring) if (add(c, null)) break;
  // 3. along the kitchen path, 4. beside the bridge-side gate (just inside the fence), 5. by the pond
  const kit = byId('kitchen');
  if (kit) tryPath(kit, range(2.0, pathLen(kit) - 0.4, 0.4), -1);
  const br = byId('bridge');
  if (br) {
    let sF = 0, acc = 0;
    for (let i = 0; i < br.points.length - 1 && !sF; i++) {
      const a = br.points[i], b = br.points[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (Math.hypot(b.x, b.z) + 0.6 > fenceR(t, b.x, b.z)) sF = acc + len;
      acc += len;
    }
    tryPath(br, range(sF - 3.4, sF - 0.6, 0.4).reverse().filter(s => s > 1), -1);
  }
  const pond = byId('pond');
  if (pond) tryPath(pond, range(1.5, pathLen(pond), 0.4), 1);
  return lights;
}

/** Re-targets the behaviour layout (walk radius, nest row, blocked props) when the yard changes tier. */
export function configureYard(tier = 'L') {
  const lay = YARD_TIER_LAYOUT[tier] || YARD_TIER_LAYOUT.L;
  YARD.walkRadius = lay.walk - 0.1;
  YARD.nestZ = lay.barnZ + 2.35;
  YARD.backLimit = lay.barnZ + 3.0;
  const props = yardProps(tier);
  YARD.kitchen = kitchenSpot(YARD_TIER_LAYOUT[tier] ? tier : 'L');
  YARD.playground = props.find(p => p.kind === 'playground') || null;
  YARD.landmarks = landmarkSpots(YARD_TIER_LAYOUT[tier] ? tier : 'L');
  YARD.obstacles = [...props.map(({ x, z, r }) => ({ x, z, r })), { ...YARD.kitchen }, ...Object.values(YARD.landmarks).map(l => ({ ...l }))];
  YARD.pathLights = pathLightSpots(YARD_TIER_LAYOUT[tier] ? tier : 'L');
  for (const l of YARD.pathLights) YARD.obstacles.push({ x: l.x, z: l.z, r: PATH_LIGHT_R });
  YARD.trees = props.filter(p => p.kind === 'tree').map(({ id, x, z }) => ({ id, x, z }));
  YARD.flowers = [];
  for (const p of props) {
    if (p.kind === 'flowerbed') for (const a of [0.6, 2.7, 4.6]) YARD.flowers.push({ x: p.x + Math.cos(a) * 0.4, z: p.z + Math.sin(a) * 0.4 });
    if (p.kind === 'pond') YARD.flowers.push({ x: p.x - 0.35, z: p.z + 0.25 }, { x: p.x + 0.3, z: p.z - 0.3 });   // the two lily pads
  }
  return YARD;
}

/** Position of incubator nest i of n (a row in front of the barn door). */
export function nestSpot(i, n) {
  return { x: (i - (n - 1) / 2) * 1.25, z: YARD.nestZ };
}

/**
 * Nursery crib i (0..2) beside the nest row, to the left of it and behind the wander limit, so pets never walk through
 * a crib. n = how many nests stand in the row.
 */
export function cribSpot(i, n = 1) {
  const half = ((Math.max(1, Number(n) || 1) - 1) / 2) * 1.25;
  const x0 = -(half + 1.55);
  const slots = [[0, 0], [0, -1.0], [-1.1, -0.5]];
  const [dx, dz] = slots[((Number(i) || 0) % 3 + 3) % 3];
  return { x: x0 + dx, z: YARD.nestZ + dz };
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

const BACK_STRIP_X0 = -5.2;   // the barn strip spans x from here to the kitchen's far edge; beyond it pets may walk behind the barn
function validTarget(x, z, fromX, fromZ) {
  if (dist(x, z, YARD.bowl.x, YARD.bowl.z) < YARD.bowlClear) return false;
  if (z < YARD.backLimit && x >= BACK_STRIP_X0 && x <= YARD.kitchen.x + YARD.kitchen.r + 0.3) return false; // the nest row / barn / kitchen strip stays clear
  for (const o of YARD.obstacles) if (dist(x, z, o.x, o.z) < o.r + 0.6) return false; // pond, tree, hill ...
  if (dist(x, z, fromX, fromZ) < 0.9) return false; // tiny shuffles look jittery
  return true;
}

function randomYardPoint(rng) {
  const ang = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * YARD.walkRadius;
  return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
}

/** Zone bonus (0..0.5, V23 section 4): a small pull toward the part of the yard a personality likes. Never decides alone. */
export const ZONE_BONUS_MAX = 0.5;
export function zoneBonus(personality, x, z) {
  const near = (c, rad) => (c ? Math.max(0, 1 - dist(x, z, c.x, c.z) / rad) : 0);
  let k = 0;
  switch (personality) {
    case 'lazy': k = near({ x: 0, z: YARD.backLimit + 0.8 }, 4); break;                              // near the barn
    case 'glutton': k = Math.max(near(YARD.kitchen, 3.5), near(YARD.bowl, 3)); break;                // kitchen and bowl
    case 'cheerful': case 'naughty': k = Math.max(near({ x: 0, z: 0 }, 3.5), near(YARD.playground, 3)); break;   // middle of the yard and the playground
    case 'shy': k = Math.max(0, Math.min(1, (Math.hypot(x, z) / Math.max(1, YARD.walkRadius) - 0.6) / 0.4)); break;   // the rim
    default: break;
  }
  return ZONE_BONUS_MAX * k;
}

/**
 * Picks a wander target by occupancy: several random yard points are scored by their distance to every other pet
 * (and to where the others are heading: `tx`,`tz`), so the crowd spreads out instead of clumping in the middle.
 * Shy pets only look at the distance; everyone else adds a little randomness so paths do not look planned.
 * `personality` (optional) adds the small zone bonus (V23 section 4).
 */
export function pickTarget(rng, ax, az, others, shy, personality) {
  let best = null, bestScore = -Infinity;
  const tries = 10;
  for (let i = 0; i < tries; i++) {
    const c = randomYardPoint(rng);
    if (!validTarget(c.x, c.z, ax, az)) continue;
    let nearest = 9;
    for (const o of others) {
      let d = dist(c.x, c.z, o.x, o.z);
      if (Number.isFinite(o.tx) && Number.isFinite(o.tz)) d = Math.min(d, dist(c.x, c.z, o.tx, o.tz));
      if (d < nearest) nearest = d;
    }
    const score = Math.min(nearest, 3) + (shy ? 0 : rng() * 0.6) + zoneBonus(personality, c.x, c.z);
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

// ── Placed decor (CONTRACT_V7 §3): pets walk to it and use it. Cosmetic only. ────────────────────────────────
/** decorId -> what a pet does with it (the sign has no use). Mirrors `use` in js/data/decor.js; a test keeps them in sync. */
export const DECOR_USE = { bed: 'nap', bowl: 'eat', ball: 'kick', horse: 'rock', leaves: 'jump' };
export const DECOR_USE_TYPES = new Set(['nap', 'eat', 'kick', 'rock', 'jump']);
/** Pets bigger than this radius skip the rocking horse. */
export const ROCK_MAX_RADIUS = 0.8;

/** Where a pet stands to use a decor lying at (x, z): the bowl is eaten from the front, the ball is kicked from the side. */
export function decorStand(use, x, z) {
  switch (use) {
    case 'eat': return clampToYard(x, z + 0.62);
    case 'kick': return clampToYard(x - 0.62, z + 0.18);
    default: return clampToYard(x, z);
  }
}

/** Seconds a pet spends on one visit (after walking there). */
function decorDuration(use, rng) {
  switch (use) {
    case 'nap': return 8 + rng() * 6;
    case 'eat': return 4 + rng() * 2.5;
    case 'kick': return 5 + rng() * 1.5;
    case 'rock': return 6 + rng() * 3;
    default: return 4 + rng() * 1.5;
  }
}

/**
 * The decor a pet may visit right now, with weights: [{ d, use, wt }]. `actorState.decor` = [{ id, decorId, x, z, busy }]
 * (busy = somebody is already using it). Sleepy pets love the bed, gluttons the bowl, cheerful / naughty pets the ball
 * and the leaves; only small pets climb the rocking horse. Nearer decor is a little more attractive.
 */
export function decorOptions(pet, actorState = {}) {
  const list = Array.isArray(actorState.decor) ? actorState.decor : [];
  if (!list.length || !pet) return [];
  const st = pet.stats || {};
  const pers = PERS[pet.personality] || DEFAULT_PERS;
  const happy = num(st.happy, 100), energy = num(st.energy, 100), hunger = num(st.hunger, 100);
  const ax = num(actorState.x), az = num(actorState.z);
  const size = Number.isFinite(actorState.size) ? actorState.size : 0.5;
  const out = [];
  for (const d of list) {
    if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
    const joining = !!d.busy && !!actorState.friendId && d.busy === actorState.friendId; // best friends share a bed / ball
    if (d.busy && !joining) continue;
    const use = DECOR_USE[d.decorId];
    if (!use || (joining && use === 'rock')) continue;
    let wt = 0;
    switch (use) {
      case 'nap': wt = (num(actorState.napRatio) >= NAP_CAP) ? 0 : pers.nap * 2 + (energy < 60 ? 1.6 : 0) + 0.3; break;
      case 'eat': wt = (hunger < 95 ? 0.8 : 0.25) * (pet.personality === 'glutton' ? 3 : 1); break;
      case 'kick': wt = happy < 25 ? 0 : 0.5 + pers.hop * 0.8; break;
      case 'rock': wt = happy < 25 || size > ROCK_MAX_RADIUS ? 0 : 0.45 + pers.hop * 0.6; break;
      case 'jump': wt = happy < 25 ? 0 : 0.5 + pers.hop * 0.9; break;
      default: break;
    }
    if (wt <= 0) continue;
    wt /= 1 + dist(ax, az, d.x, d.z) * 0.1;
    if (joining) wt *= 3;
    out.push({ d, use, wt, joining });
  }
  return out;
}

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
export function nextAction(pet, actorState = {}, rng = Math.random, now = 0) {
  return applyLoco(pet, nextActionBase(pet, actorState, rng, now), rng, now, actorState);
}

function nextActionBase(pet, actorState, rng, now) { // eslint-disable-line no-unused-vars
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
      return { type: 'wander', target: pickTarget(rng, ax, az, others, true, 'shy'), speed: pace, reason: 'shy', duration: 0 };
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
    decor: 0,
    buddy: 0,
    party: 0,
    puddle: 0,
    shelter: 0,
  };
  // 🎂 a birthday party (CONTRACT_V9 §5): the birthday pet stays by the cake, the others gather and hop around it
  const pty = actorState.party && Number.isFinite(actorState.party.x) && Number.isFinite(actorState.party.z) ? actorState.party : null;
  if (pty && !sad) {
    if (pty.hostId === (pet && pet.id)) return { type: 'party', host: true, target: partySpot(-1, 1, pty.x, pty.z), speed: Math.min(1.4, pace * 1.2), duration: 5 + rng() * 3 };
    w.party = (pet && pet.personality === 'shy' ? 1.2 : 3.6 + pers.approach) * (last === 'party' ? 0.5 : 1);
  }
  // 🌧️ rain (CONTRACT_V9 §4): puddle jumping for water lovers, sheltering for the rest
  const rain = actorState.rain && (actorState.rain.puddles || actorState.rain.shelters) ? actorState.rain : null;
  let puddles = [], shelters = [];
  if (rain) {
    const lover = rainLover(pet);
    puddles = (rain.puddles || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.z));
    shelters = (rain.shelters || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.z) && !p.busy);
    const loco = locomotionOf(pet && pet.speciesId);
    if (puddles.length && !sad && loco.kind !== 'float' && loco.kind !== 'shell' && loco.kind !== 'hover') w.puddle = lover ? 5.5 : 0.7 + pers.hop * 0.8;
    if (shelters.length && loco.kind !== 'float' && loco.kind !== 'shell') w.shelter = lover ? 0.5 : 1.4 + pers.idle * 0.35 + (pet && (pet.personality === 'shy' || pet.personality === 'lazy') ? 2.5 : 0);
    w.wander *= 0.7;
  }
  // best friends: nap beside a napping friend, trot over to say hi when the friend is far away
  const fr = actorState.friend && Number.isFinite(actorState.friend.x) && Number.isFinite(actorState.friend.z) ? actorState.friend : null;
  let buddyMode = null;
  if (fr && fr.id !== (pet && pet.id)) {
    const far = dist(ax, az, fr.x, fr.z);
    if (fr.napping && energy < 96 && !sad) { buddyMode = 'nap'; w.buddy = 1.6 + pers.nap * 2 + (energy < 60 ? 1.4 : 0); w.nap = 0; }
    else if (far > 2.4 && !sad && !fr.napping) { buddyMode = 'nuzzle'; w.buddy = 1.8 + pers.approach + (far > 4 ? 1.2 : 0); }
  }
  const decorOpts = decorOptions(pet, { ...actorState, x: ax, z: az });
  if (decorOpts.length) w.decor = decorOpts.reduce((a, o) => a + o.wt, 0);
  // staggered naps: when a quarter of the awake pets already nap, nobody starts another one
  if ((Number(actorState.napRatio) || 0) >= NAP_CAP) w.nap = 0;
  const sig = signatureFor(pet && pet.speciesId);
  if (sig && !sad && !SIGNATURE_TYPES.has(last)) w.signature = sig.tier === 'legendary' ? 0.75 : 0.35;
  const choice = weightedPick(Object.entries(w), rng);

  switch (choice) {
    case 'party': {
      const slot = hashId(pet.id) % 8;
      return { type: 'party', target: partySpot(slot, 8, pty.x, pty.z), speed: pace * 1.15, duration: 5 + rng() * 4 };
    }
    case 'puddle': {
      const pu = puddles[Math.floor(rng() * puddles.length)];
      return { type: 'puddle', puddle: { x: pu.x, z: pu.z }, target: clampToYard(pu.x, pu.z), speed: pace * 1.2, duration: 3.5 + rng() * 3 };
    }
    case 'shelter': {
      const free = shelters.slice().sort((a, b) => dist(ax, az, a.x, a.z) - dist(ax, az, b.x, b.z));
      const sh = free[Math.min(free.length - 1, Math.floor(rng() * 2))];
      return { type: 'shelter', target: clampToYard(sh.x, sh.z), shelterId: sh.id, speed: pace * 1.3, duration: 8 + rng() * 8 };
    }
    case 'buddy': {
      const side = (hashId(pet.id) % 2 ? 1 : -1) * (buddyMode === 'nap' ? 0.8 : 0.9);
      const target = clampToYard(fr.x + side, fr.z + 0.15);
      return { type: 'buddy', mode: buddyMode, friendId: fr.id, target, speed: pace * 1.15, duration: buddyMode === 'nap' ? 8 + rng() * 6 : 1.6, nap: buddyMode === 'nap', side };
    }
    case 'decor': {
      let r = rng() * w.decor, pick = decorOpts[decorOpts.length - 1];
      for (const o of decorOpts) { r -= o.wt; if (r < 0) { pick = o; break; } }
      return {
        type: 'decor', use: pick.use, decorId: pick.d.decorId, instId: pick.d.id,
        target: pick.joining ? clampToYard(decorStand(pick.use, pick.d.x, pick.d.z).x + 0.5, decorStand(pick.use, pick.d.x, pick.d.z).z + 0.1) : decorStand(pick.use, pick.d.x, pick.d.z),
        speed: pace, duration: decorDuration(pick.use, rng), nap: pick.use === 'nap', joining: !!pick.joining,
      };
    }
    case 'wander':
      return { type: 'wander', target: pickTarget(rng, ax, az, others, pet && pet.personality === 'shy', pet && pet.personality), speed: pace, duration: 0 };
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

// ── Touch (CONTRACT_V8 §1): stroking a pet ──────────────────────────────────────────────────────────────────
export const FAV_SPOTS = ['head', 'chin', 'back'];
export const FAV_LABEL = { head: 'ลูบหัว', chin: 'เกาคาง', back: 'ลูบหลัง' };
export const STROKE_MIN_MS = 600;      // a stroke shorter than this is no session (no reward)
export const STROKE_MELT_S = 2;        // after about 2 s of stroking the pet melts
export const STROKE_FAST = 3.5;        // world units / s of the hand: faster than this is a scrub (giggle)

/** The spot a pet loves to be touched, from its id only (no RNG, same every time and on every device). */
export function favoriteSpot(petId) {
  return FAV_SPOTS[hashId(`${petId}:fav`) % FAV_SPOTS.length];
}

/**
 * Region of a hit point on a pet: `local` = the point relative to the pet's feet in its own frame
 * ({ x: right, y: up, z: forward }), `height` = model height. Upper part = head, lower front = chin, the rest = back.
 * (The engine reports a region itself; this is the fallback and what the tests use.)
 */
export function regionFromLocal(local, height) {
  const h = Math.max(0.2, num(height, 1));
  const y = num(local && local.y) / h;
  const f = num(local && local.z) / h;
  if (y >= 0.68) return 'head';
  if (f > 0.12 && y < 0.5) return 'chin';
  return 'back';
}

/**
 * One stroke session = press on a pet ... release. It owns its clock, the hand speed and the "already paid" flag, so
 * however many 'move' events arrive it can be committed (patPet) exactly once.
 */
export function createStroke(petId, region = 'head') {
  return { petId, region, t: 0, speed: 0, giggle: 0, last: null, regionT: { head: 0, chin: 0, back: 0 }, ended: false, committed: false };
}

/** The hand moved to `point` (world units) dt seconds after its last position: updates the smoothed hand speed. */
export function handStroke(s, point, dt) {
  if (!s || s.ended || !point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return s;
  const d = Math.max(0, num(dt));
  if (s.last && d > 0) {
    const v = Math.hypot(point.x - s.last.x, (num(point.y) - num(s.last.y)) * 0.5, point.z - s.last.z) / d;
    s.speed += (Math.min(v, 30) - s.speed) * Math.min(1, d * 8);
  }
  s.last = { x: point.x, y: num(point.y), z: point.z };
  return s;
}

/** Advances the session clock by dt seconds (a still hand slows the speed down, a fast one makes the pet giggle). */
export function tickStroke(s, dt) {
  if (!s || s.ended) return s;
  const d = Math.max(0, num(dt));
  s.t += d;
  s.speed *= Math.max(0, 1 - d * 1.5);
  if (s.regionT[s.region] !== undefined) s.regionT[s.region] += d;
  s.giggle = s.speed > STROKE_FAST ? Math.min(1, s.giggle + d * 4) : Math.max(0, s.giggle - d * 2);
  return s;
}

/** One step with both: the hand is at `point` and dt seconds went by. */
export function moveStroke(s, dt, point) {
  handStroke(s, point, dt);
  return tickStroke(s, dt);
}

/** The spot the hand spent most of the session on. */
export function dominantRegion(s) {
  if (!s) return null;
  let best = s.region, bt = -1;
  for (const k of FAV_SPOTS) if (s.regionT[k] > bt) { bt = s.regionT[k]; best = k; }
  return bt > 0 ? best : s.region;
}

/** 0 -> 1 while the pet melts (lies down / rolls over), starting at STROKE_MELT_S. */
export function strokeMelt(s) {
  return s ? Math.min(1, Math.max(0, (s.t - STROKE_MELT_S) / 0.6)) : 0;
}

/** Ends the session. Returns { commit, durationMs }: commit is true for the first end of a long-enough stroke only. */
export function endStroke(s, durationMs = null) {
  if (!s) return { commit: false, durationMs: 0 };
  const ms = Math.max(num(durationMs, 0), s.t * 1000);
  const commit = !s.ended && !s.committed && ms >= STROKE_MIN_MS;
  s.ended = true;
  if (commit) s.committed = true;
  return { commit, durationMs: ms };
}

/** Forgets every trace of a stroke on an actor record (pose, squint, melt). */
export function clearStrokeState(A) {
  A.stroke = null; A.strokeMelt = 0; A.squint = 0; A.strokePoint = null; A.strokeEnd = null;
}

/**
 * The 'end' of a stroke on actor record A. The session is always released (a pet that hid or is still spawning must not
 * keep a stale stroke); the reward info { commit, durationMs, region } comes back only when the pet may be paid.
 */
export function finishActorStroke(A, durationMs, { canReward = true } = {}) {
  const S = A && A.stroke;
  if (!S) return null;
  const res = endStroke(S, durationMs);
  const region = dominantRegion(S);
  if (!canReward) { clearStrokeState(A); return null; }
  A.stroke = null;
  return { ...res, region };
}

// ── 🎁 labels over pets (CONTRACT_V8 follow-up): at most a few at a time ─────────────────────────────────────
export const GIFT_LABEL_MAX = 4;

/**
 * Which gifted pets get a 🎁 label. cands: [{ id, full, size, dist }] (size = how big the gift is, dist = distance from the
 * middle of the screen). Full pets (🎁✨) first, then the biggest gifts, then the ones nearer the middle; at most `max`.
 */
export function pickGiftLabels(cands, max = GIFT_LABEL_MAX) {
  return [...(cands || [])]
    .sort((a, b) => (b.full ? 1 : 0) - (a.full ? 1 : 0) || b.size - a.size || a.dist - b.dist || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, max))
    .map(c => c.id);
}

// ── Drag-feed (CONTRACT_V8 §2) ──────────────────────────────────────────────────────────────────────────────
export const FEED_RANGE = 1.2;   // world units: food this close to a pet makes it look, open its mouth and lean in

/** Closest candidate within `range` of the food. candidates: [{ id, x, z }]; food: { x, z } (or null). */
export function pickFeedTarget(food, candidates, range = FEED_RANGE) {
  if (!food || !Number.isFinite(food.x) || !Number.isFinite(food.z)) return null;
  let best = null, bd = range;
  for (const c of candidates || []) {
    const d = Math.hypot(c.x - food.x, c.z - food.z);
    if (d <= bd) { bd = d; best = c.id; }
  }
  return best;
}

/** A food item being dragged from the tray: drop() hands out the feeding exactly once (a miss springs back). */
export function createFeedDrag(itemId) {
  return {
    itemId, over: null, done: false,
    hover(petId) { if (!this.done) this.over = petId || null; },
    drop() {
      if (this.done) return null;
      this.done = true;
      return this.over ? { petId: this.over, itemId: this.itemId } : null;
    },
  };
}

// ── Greeting scene (CONTRACT_V8 §3) ─────────────────────────────────────────────────────────────────────────
/**
 * Who runs to the camera and what they say. digest = { lines: [{ petId?, emoji, text }], highlights: [petId] }.
 * 2-4 pets that are in the yard and awake (highlights first, then a deterministic top-up); null when there is nothing to say.
 */
export function greetingPlan(digest, pets, { min = 2, max = 4 } = {}) {
  const lines = digest && Array.isArray(digest.lines) ? digest.lines.filter(l => l && l.text).slice(0, 5) : [];
  if (!lines.length) return null;
  const ok = new Map();
  for (const p of pets || []) if (p && p.status !== 'sleeping' && p.status !== 'working' && p.status !== 'expedition' && !p.sick) ok.set(p.id, p);
  if (!ok.size) return null;
  const ids = [];
  for (const id of [...((digest && digest.highlights) || []), ...lines.map(l => l.petId)]) if (id && ok.has(id) && !ids.includes(id)) ids.push(id);
  if (ids.length < min) {
    const rest = [...ok.keys()].filter(id => !ids.includes(id)).sort((a, b) => hashId(a) - hashId(b));
    for (const id of rest) { if (ids.length >= min) break; ids.push(id); }
  }
  return { ids: ids.slice(0, max), lines };
}

/** Standing spots in a row near the camera for n pets. */
export function greetSpots(n) {
  const z = Math.min(YARD.walkRadius - 0.9, 1.8);   // high enough to stay above the food tray
  return Array.from({ length: n }, (_, i) => clampToYard((i - (n - 1) / 2) * 1.35, z));
}

// ── Action loop (pure; barn3d.js drives it every frame, tests drive it with a fake clock) ──────────────────
export const WALK_BASE = 1.25;   // world units / second at pace 1
export const TURN_RATE = 9;      // heading smoothing (1/s)
const WALKS = new Set(['wander', 'approach', 'walkTo']);
const ARRIVE_TYPES = new Set(['decor', 'buddy', 'party', 'puddle', 'shelter', 'breedMeet', 'visit', 'antLine', 'dangle', 'krathongWalk']);   // walk to the spot first, then the timer runs from arrival
/** Fallback durations (s) for timed actions that do not carry one. */
export const DEFAULT_DUR = {
  idle: 3, sleep: 12, sick: 5, lookAtCamera: 2, hop: 1.6, eat: 1.8, no: 0.7, bathe: 2.2, poop: 1.1, play: 3,
  flyCircle: 9, soar: 8, gallop: 6, sprint: 5, breach: 2.2, roar: 2.6, munch: 5, snowPuff: 3, shimmer: 2.4, flourish: 1.4,
  wave: 1.7, decor: 5, buddy: 5, party: 6, puddle: 5, shelter: 10,
  batLoop: 6, headTurn: 2.4, fan: 3.2,
  flutterLoop: 6, visit: 4, antLine: 5, burrow: 3.8, hide: 3.4, chirp: 3.2, dangle: 6, tailCurl: 2.4, krathongWalk: 4,
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
  // A decor visit first walks to its stand point (act.arrived = false), then uses the decor for `dur` seconds from arrival.
  const walkingToDecor = ARRIVE_TYPES.has(act.type) && !act.arrived;
  if (WALKS.has(act.type) || walkingToDecor) {
    const tgt = act.target;
    if (!tgt || !Number.isFinite(tgt.x) || !Number.isFinite(tgt.z)) { finish(); return { moving: false, decided: true }; }
    const dx = tgt.x - A.x, dz = tgt.z - A.z, d = Math.hypot(dx, dz);
    // (a pet walking to its friend is held off by the yard's personal-space push, so "there" is a little looser)
    if (d < (act.type === 'buddy' ? 0.5 : act.type === 'breedMeet' ? 0.3 : act.type === 'party' ? 0.35 : 0.12) || act.t > 25) {
      if (walkingToDecor) {
        act.arrived = true;
        act.t = 0;
        if (act.onArrive) act.onArrive(A);
        return { moving: false, decided: false };
      }
      if (act.onArrive) act.onArrive(A);
      finish();
      return { moving: false, decided: true };
    }
    const sp = WALK_BASE * (act.speed || 1);
    const stp = Math.min(d, sp * dt * (Number.isFinite(A.speedMod) ? A.speedMod : 1));
    A.x += (dx / d) * stp; A.z += (dz / d) * stp;
    const lo = A.loco; // water critters: a crab walks sideways, a turtle / floating fish turn slowly
    const aim = Math.atan2(dx, dz) + (lo && lo.kind === 'side' ? (A.sideDir || 1) * Math.PI / 2 : 0);
    A.heading += angDiff(A.heading, aim) * Math.min(1, dt * TURN_RATE * (lo && lo.turn ? lo.turn : 1));
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
  const tailScale = p.tail && p.tail.scale && Number.isFinite(p.tail.scale.x) ? { x: p.tail.scale.x, y: p.tail.scale.y, z: p.tail.scale.z } : null;
  return { wingL: rot(p.wingL), wingR: rot(p.wingR), tail: rot(p.tail), tailTip: rot(p.tailTip), trunk: rot(p.trunk), mane: rot(p.mane), fluke: rot(p.fluke), lid: rot(p.lid), shell: rot(p.shell), legR: rot(p.legR), earL: rot(p.earL), earR: rot(p.earR), tailScale };
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
  set('lid', 'x', -(P.shell || 0));
  set('shell', 'x', -(P.shell || 0) * 0.8 + 0.5 * (P.tuck || 0));   // snail: +x tips the spiral forward over the head (a hide)      // oyster / conch: the shell top opens and closes
  // peacock: P.tailUp 0..1 = how open the fan is. The fan trails back at rest (models.js); +x stands it upright and it spreads wider.
  const up = Math.max(0, Math.min(1, P.tailUp || 0));
  set('tail', 'x', 0.8 * up + 0.6 * Math.max(0, Math.min(1, P.tailCurl || 0)));   // scorpion: +x curls the tail further forward over the head (models.js V11 notes)
  if (parts.tail && parts.tail.scale && base.tailScale) parts.tail.scale.set(base.tailScale.x * (1 + up), base.tailScale.y * (1 + 0.5 * up), base.tailScale.z);
  set('legR', 'x', P.leg || 0);                   // flamingo: +x folds the foot back and up
  // V21 ear twitch: a quick flick of one ear (P.earL / P.earR are small x offsets; 0 = the resting pose)
  if (P.earL) set('earL', 'x', P.earL);
  else if (parts.earL && base.earL) parts.earL.rotation.x = base.earL.x;
  if (P.earR) set('earR', 'x', P.earR);
  else if (parts.earR && base.earR) parts.earR.rotation.x = base.earR.x;
}

/** V21: ear twitch offset (radians) for a twitch that started `age` seconds ago: a fast flick and a softer settle, 0 after 0.5 s. */
export function earTwitch(age) {
  if (!(age >= 0) || age >= 0.5) return 0;
  return -0.55 * Math.sin((age / 0.5) * Math.PI) * Math.exp(-age * 5);
}

/** A new hatch ceremony may start unless another one is still before its burst (egg still in the nest). */
export function canStartCeremony(h) {
  return !h || h.phase === 'burst';
}

// ── Locomotion of the water critters (CONTRACT_V9 §6) ───────────────────────────────────────────────────────
/** Fully aquatic species live in a floating water bubble (model built by critters.js): they hover and bob, never walk. */
export const AQUATIC = new Set(['fish', 'tropicalfish', 'blowfish', 'squid', 'octopus', 'dolphin', 'shark']);
const LOCO = {
  crab: { kind: 'side', speed: 0.9 }, lobster: { kind: 'side', speed: 0.8 },
  frog: { kind: 'hop', speed: 1.15 }, shrimp: { kind: 'hop', speed: 1.1 },
  turtle: { kind: 'slow', speed: 0.5, turn: 0.45 }, otter: { kind: 'play', speed: 1.15 },
  oyster: { kind: 'shell', speed: 0.3 }, conch: { kind: 'shell', speed: 0.3 },
};
for (const id of AQUATIC) LOCO[id] = { kind: 'float', speed: 0.7, turn: 0.4 };
const WALK_LOCO = { kind: 'walk', speed: 1 };
/** { kind: 'walk'|'float'|'side'|'hop'|'slow'|'play'|'shell', speed (x walking pace), turn? (x turn rate) } */
export function locomotionOf(speciesId) { return LOCO[speciesId] || WALK_LOCO; }

// ── Sky locomotion (CONTRACT_V10 §4) ──────────────────────────────────────────────────────────────────────
/** Small birds hop-hop along the ground and sometimes flutter up for a short hop-flight. */
export const SKY_SMALL = new Set(['sparrow', 'dove', 'canary', 'tit', 'parrot']);
for (const id of SKY_SMALL) LOCO[id] = { kind: 'birdhop', speed: 1.05 };
LOCO.hatchling = { kind: 'wobble', speed: 0.6, turn: 0.7 };   // wobbles in half an eggshell
LOCO.bat = { kind: 'bat', speed: 1.2 };                       // sleeps by day, flutters in loops at night
LOCO.swan = { kind: 'glide', speed: 0.55, turn: 0.5 };        // slow, smooth glide
LOCO.flamingo = { kind: 'stand', speed: 0.8 };                // stands on one leg when idle

/** Night for the bat: 18:00 - 06:00 local time (the same hours the yard lanterns use). */
export function isNightAt(ms) {
  const h = new Date(Number.isFinite(ms) ? ms : Date.now()).getHours();
  return h >= 18 || h < 6;
}

// ── Bug locomotion (CONTRACT_V11 §5) ──────────────────────────────────────────────────────────────────────
/** Flyers hover above the grass with fast wings (like the water bubble pets they never walk); the others each crawl in their own way. */
export const BUG_FLYERS = new Set(['bee', 'butterfly', 'fly', 'mosquito']);
export const HOVER_HEIGHT = { bee: 0.62, butterfly: 0.78, fly: 0.55, mosquito: 0.7 };
const HOVER_SPEED = { bee: 1.15, butterfly: 0.75, fly: 1.5, mosquito: 1.3 };
for (const id of BUG_FLYERS) LOCO[id] = { kind: 'hover', speed: HOVER_SPEED[id], turn: 0.9 };
LOCO.ladybug = { kind: 'crawl', speed: 0.8 };               // crawls, sometimes a short flight
LOCO.ant = { kind: 'march', speed: 1.1 };                   // steady march; two or more form a line
LOCO.caterpillar = { kind: 'inch', speed: 0.45, turn: 0.6 };   // body squash wave
LOCO.earthworm = { kind: 'wriggle', speed: 0.6, turn: 0.7 };   // wriggles, burrows down and pops up nearby
LOCO.snail = { kind: 'snail', speed: 0.3, turn: 0.4 };         // very slow, hides in its shell when tapped
LOCO.cricket = { kind: 'jump', speed: 1.25 };               // long hops, chirps at night
LOCO.spider = { kind: 'skitter', speed: 1.15 };             // sometimes hangs from a tree on a thread
LOCO.scorpion = { kind: 'scuttle', speed: 0.85 };           // curls its tail when idle

/** Gap (world units) between the ants of a line. */
export const ANT_GAP = 0.5;
/** Where follower `slot` (1, 2, ...) of an ant line stands: behind the leader (x, z), against its unit heading (hx, hz). */
export function antLineSpot(leader, hx, hz, slot) {
  return clampToYard(num(leader && leader.x) - num(hx) * ANT_GAP * slot, num(leader && leader.z) - num(hz) * ANT_GAP * slot);
}

/** Tree spots for a hanging spider: [{ id, anchor: {x, z}, y }]; the thread starts at the underside of the canopy (anchor), the spider hangs below. */
export const THREAD_ANCHOR_Y = 1.15;
export function dangleSpots(trees = YARD.trees) {
  const out = [];
  for (const tr of trees || []) {
    const base = Math.atan2(-tr.z, -tr.x);                 // the open side of the tree faces the yard centre
    [0, 0.9, -0.9].forEach((da, k) => {
      const a = base + da;
      const p = clampToYard(tr.x + Math.cos(a) * 0.66, tr.z + Math.sin(a) * 0.66);
      out.push({ id: `${tr.id}:${k}`, anchor: p, y: THREAD_ANCHOR_Y });
    });
  }
  return out;
}

/** What tapping a pet does besides the usual hop: the owl turns its head, the peacock fans its tail, the snail hides in its shell. Null for everyone else. */
export function tapReaction(speciesId) {
  if (speciesId === 'owl') return { type: 'headTurn', dur: DEFAULT_DUR.headTurn };
  if (speciesId === 'peacock') return { type: 'fan', dur: DEFAULT_DUR.fan };
  if (speciesId === 'snail') return { type: 'hide', dur: DEFAULT_DUR.hide };
  return null;
}

const FREE_TYPES = new Set(['wander', 'approach', 'idle', 'lookAtCamera', 'hop']);

/** Slows the walkers down per species; shells (oyster / conch) mostly stay put and just open and close. Pure. */
function applyLoco(pet, act, rng, nowMs, st = {}) {
  const lo = locomotionOf(pet && pet.speciesId);
  if (lo === WALK_LOCO || !act) return act;
  const walking = act.type === 'wander' || act.type === 'approach';
  const bug = bugLoco(pet, act, lo, walking, rng, nowMs, st || {});
  if (bug) return bug;
  if (lo.kind === 'shell' && walking && !act.reason && rng() < 0.85) return { type: 'idle', duration: 5 + rng() * 5, reason: 'shell' };
  if (lo.kind === 'play' && act.type === 'idle' && !act.reason && rng() < 0.3) return { type: 'hop', duration: 1.6, hops: 3 };
  if (lo.kind === 'bat' && FREE_TYPES.has(act.type) && !act.reason) {
    if (!isNightAt(nowMs)) return { type: 'sleep', nap: true, hang: true, duration: 10 + rng() * 6 };   // asleep by day, wings folded
    if ((act.type === 'wander' || act.type === 'idle') && rng() < 0.5) return { type: 'batLoop', duration: 5 + rng() * 3 };
  }
  if (lo.kind === 'stand' && act.type === 'idle' && !act.reason) act = { ...act, oneLeg: true, duration: (act.duration || 3) * 1.6 };
  if (lo.kind === 'birdhop' && walking && !act.reason && rng() < 0.22) act = { ...act, flutter: true };   // a short hop-flight with flapping wings
  if (Number.isFinite(act.speed) && lo.speed) return { ...act, speed: act.speed * lo.speed * (act.flutter ? 1.35 : 1) };
  return act;
}

/**
 * The bug species' own idles (CONTRACT_V11 §5). Returns a replacement action, or null to carry on with the usual
 * speed scaling.
 */
function bugLoco(pet, act, lo, walking, rng, nowMs, st) {
  const kind = lo.kind, id = pet && pet.speciesId;
  const free = (walking || act.type === 'idle') && !act.reason;
  if (!free) return null;
  const idle = act.type === 'idle';
  if (kind === 'hover') {
    if (id === 'bee' && YARD.flowers.length && rng() < 0.45) {   // the bee visits a bloom or a lily pad
      const f = YARD.flowers[Math.floor(rng() * YARD.flowers.length)];
      return { type: 'visit', target: clampToYard(f.x, f.z), speed: lo.speed, duration: 3 + rng() * 3, flower: true };
    }
    if (id === 'butterfly' && rng() < 0.35) return { type: 'flutterLoop', duration: 5 + rng() * 3 };   // drifts in loops
    return null;
  }
  if (kind === 'crawl' && walking && rng() < 0.2) return { ...act, flutter: true, speed: (act.speed || 1) * lo.speed * 1.9 };   // a short flight
  if (kind === 'march') {
    // two or more ants walk in a line behind the one with the lowest id hash
    const ax = num(st.x), az = num(st.z), mine = hashId(pet.id);
    const ants = (Array.isArray(st.others) ? st.others : []).filter(o => o && o.sp === 'ant' && Number.isFinite(o.x) && Number.isFinite(o.z));
    const ranked = ants.map(o => ({ o, h: hashId(o.id) })).sort((a, b) => a.h - b.h);
    if (ranked.length && ranked[0].h < mine && rng() < 0.8) {
      const lead = ranked[0].o, slot = ranked.filter(r => r.h < mine).length;
      let hx = Number.isFinite(lead.tx) ? lead.tx - lead.x : ax - lead.x, hz = Number.isFinite(lead.tz) ? lead.tz - lead.z : az - lead.z;
      const l = Math.hypot(hx, hz) || 1;
      hx /= l; hz /= l;
      return { type: 'antLine', leaderId: lead.id, slot, target: antLineSpot(lead, hx, hz, slot), speed: 1.2 * lo.speed, duration: 4 + rng() * 3 };
    }
    return null;
  }
  if (kind === 'wriggle' && rng() < 0.2) {
    const others = (Array.isArray(st.others) ? st.others : []).filter(o => o && Number.isFinite(o.x) && Number.isFinite(o.z));
    return { type: 'burrow', to: pickTarget(rng, num(st.x), num(st.z), others, false), duration: DEFAULT_DUR.burrow };
  }
  if (kind === 'snail' && idle && rng() < 0.12) return { type: 'hide', self: true, duration: DEFAULT_DUR.hide };
  if (kind === 'jump' && idle && isNightAt(nowMs) && rng() < 0.55) return { type: 'chirp', duration: DEFAULT_DUR.chirp + rng() * 2 };
  if (kind === 'skitter' && YARD.trees.length && rng() < 0.22) {
    const spots = dangleSpots();
    const sp = spots[Math.floor(rng() * spots.length)];
    return { type: 'dangle', spotId: sp.id, anchor: sp.anchor, target: sp.anchor, y: sp.y, speed: lo.speed, duration: 4.5 + rng() * 3 };
  }
  if (kind === 'scuttle' && idle && rng() < 0.5) return { type: 'tailCurl', duration: DEFAULT_DUR.tailCurl + rng() };
  return null;
}

// ── Rain (CONTRACT_V9 §4) ───────────────────────────────────────────────────────────────────────────────────
/** Puddle lovers: the waterLover trait, the water habitat, ducks and frogs. */
export function rainLover(pet) {
  const sp = pet && getSpecies(pet.speciesId);
  return !!sp && (sp.trait === 'waterLover' || sp.habitat === 'water' || sp.id === 'duck' || sp.id === 'frog');
}

/** Standing spots around a prop that gives cover (a tree or the gazebo). Ids are stable. */
export function shelterSpots(props) {
  const out = [];
  for (const p of props || []) {
    if (p.kind !== 'tree' && p.kind !== 'hill') continue;
    const r = p.kind === 'tree' ? 0.82 : p.r + 0.28;
    const n = p.kind === 'tree' ? 5 : 6;
    for (let i = 0; i < n; i++) {
      // face the yard centre: the spots on the open side of the prop come first
      const base = Math.atan2(-p.z, -p.x);
      const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI * 2 / (n + 1));
      const q = clampToYard(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);   // the gazebo sits near the rim: keep every spot walkable
      out.push({ id: `${p.id}:${i}`, x: q.x, z: q.z });
    }
  }
  return out;
}

/** Deterministic puddle spots (a few per yard) for a given rain hour; they avoid the props and the nest strip. */
export function puddleSpots(seed, n = 4) {
  const out = [];
  for (let k = 0; k < n * 6 && out.length < n; k++) {
    const h1 = hashId(`${seed}:pa${k}`), h2 = hashId(`${seed}:pb${k}`);
    const a = ((h1 % 3600) / 3600) * Math.PI * 2, r = 1.0 + ((h2 % 1000) / 1000) * Math.max(0.5, YARD.walkRadius - 2.0);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < YARD.backLimit + 0.5 || dist(x, z, YARD.bowl.x, YARD.bowl.z) < 1.3) continue;
    if (YARD.obstacles.some(o => dist(x, z, o.x, o.z) < o.r + 0.8)) continue;
    if (out.some(q => dist(x, z, q.x, q.z) < 1.6)) continue;
    out.push({ x, z });
  }
  return out;
}

/** Does the weather {kind} count as rain for pet behaviour? */
export const isRainKind = kind => kind === 'rain' || kind === 'lightRain' || kind === 'drizzle' || kind === 'shower';

// ── Birthday party (CONTRACT_V9 §5) ─────────────────────────────────────────────────────────────────────────
/** Spot i of n around the cake at (cx, cz); i = -1 is the birthday pet's own spot (right beside the cake). */
export function partySpot(i, n, cx, cz) {
  if (i < 0) return clampToYard(cx + 0.7, cz + 0.15);
  const a = -Math.PI * 0.15 + (i / Math.max(1, n)) * Math.PI * 1.75 + Math.PI * 0.5;
  const r = 1.35 + (i % 2) * 0.35;
  return clampToYard(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
}

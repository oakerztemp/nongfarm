// NongFarm 3D world engine (three.js r160, vendored). Cosmetic only: nothing here touches game state.
//
// ===================== HOW TO USE (for barn3d.js / critters.js / farm scenes) =====================
//
//   import { isWorldSupported, createWorld } from '../world3d/engine.js';   // import lazily (dynamic import) when
//   import * as fx from '../world3d/fx.js';                                  // the 3D view is actually shown: three.js is 650 KB
//
//   // import isWorldSupported from '../world3d/support.js' BEFORE loading engine.js (no 650 KB download when unsupported)
//   if (isWorldSupported()) {                       // WebGL available && !prefers-reduced-motion && hardware GPU
//     const world = createWorld(hostEl, {
//       onTap(actorId, info)   { ... },             // tap/click on an actor. info = { point: THREE.Vector3|null }
//       onTapGround(point)     { ... },             // tap on the ground; point = THREE.Vector3 (y = 0)
//     });                                           // throws if WebGL fails -> wrap in try/catch, fall back to the list
//     const { THREE } = world;                      // same module instance as the engine: build meshes with this
//     const unsub = world.onFrame((dt, t) => {...});// every rendered frame: dt seconds (<= 0.1), t seconds of run time
//     world.addActor('pet:abc', object3d, { radius: 0.5, height: 1 });  // object3d.position is the feet position (y = 0 ground)
//     world.getActor('pet:abc');                    // -> { id, object, radius, height, ... } | null
//     world.removeActor('pet:abc');                 // removes from scene + its blob shadow. Does NOT dispose geometry /
//                                                   // materials (models share cached ones): the creator disposes.
//     world.setActive(false);                       // pause rendering (hidden tab/view). Also auto-pauses on visibilitychange
//     world.dispose();                              // stop loop, remove listeners + canvas, free engine-owned GPU resources
//   }
//
// Host element: give it a height (e.g. CSS `height: 60vh`). Put it inside a `data-morph="skip"` wrapper so util.morph
// never touches it, and give that wrapper a data-key. Create the world ONCE per view; sync actors when state changes.
//
// Coordinates: y up, lawn disc centred at (0,0,0) (island radius world.islandRadius = 5.7 / 6.4 / 7.0 / 7.6 by yard tier). Pets should stay within
// world.walkRadius (see yard tiers below) and outside world.obstacles ([{ x, z, r }] circles, e.g. the barn prop). The barn prop is at
// the back (-z) with its door facing +z; the default camera looks from +z. Actors' positions are never saved.
//
// YARD TIERS + PROPS (CONTRACT_V6 §4; the yard grows with barnCapacity: S 3-5, M 6-9, L 10-14, XL 15-20):
//   yardTierForCapacity(cap) -> 'S'|'M'|'L'|'XL'      (pure; also createWorld(host, h, { yardTier: 'M' }))
//   world.setYardTier(tierOrCapacity, { animate })    rebuilds lawn/fence/tufts/flowers/barn spot for the tier and (animate:true,
//                                                     ~0.9 s) grows the fence ring from the old size with a small overshoot.
//                                                     The camera distance does NOT change with the tier (CONTRACT_V7 §2).
//                                                     Call with animate:false when mounting, true when the player upgrades
//                                                     (then fire fx.confetti / a "ลานกว้างขึ้น!" toast).
//   world.yardTier / walkRadius (4.3 / 5.0 / 5.6 / 6.2) / fenceRadius / islandRadius are live getters; world.yardInfo();
//   world.onYardChange(fn(info)) -> unsubscribe. world.obstacles is one array updated IN PLACE (barn + prop obstacles).
//   Static props (never actors, not pickable, freed on removeProp/dispose; geometry you pass stays yours unless noted):
//     world.addProp(id, object3d, { obstacle: {x,z,r} })            any object you built (use merged geometry!)
//     world.addMergedProp(id, [{ geometry, color, position:[x,y,z], rotation:[x,y,z], scale }], { obstacle, position })
//         -> merges many small parts into ONE vertex-coloured toon mesh = 1 draw call (pond, tree, gazebo, playground)
//     world.addInstancedProp(id, geometry, [{ position, rotation, scale, color }], opts)
//         -> ONE InstancedMesh for N copies (flower bed, lanterns, stones) = 1 draw call
//     world.removeProp(id) / hasProp(id) / clearProps(prefix)
//   Budget (contract): all props together <= +15 draw calls at XL. Props are static: no per-frame work.
//
// WILDERNESS + PAN + DECOR SPOTS (CONTRACT_V7 §2):
//   The fenced yard sits in a wide meadow (soft-edged ground disc, radius WILD.meadow) with instanced tall grass, bushes, trees,
//   rocks and a stream on the +x side: 6 draw calls in total, all engine-owned and static. Wild props that end up inside a
//   bigger yard sink away when setYardTier runs (same 0.9 s as the fence); `world.wildInfo()` -> { clearance, items, visible,
//   animating, meshes } and `wildClearance(tier)` (pure) tell barn3d where the wild starts (= island radius + 0.3).
//   Camera: one fixed distance for every tier (the fit of tier M); zoom 0.4..1.5 is relative to it. One-finger / left-mouse drag
//   PANS the camera target (clamped to the current island radius); a press that moves < 8 px is still a tap. Mouse: right button
//   (or shift/ctrl + left) drag orbits, wheel zooms; touch: two fingers pinch-zoom and twist to rotate. A double tap on empty
//   ground re-centres (never when the 2nd tap lands on an actor, so double-tapping a pet still reaches onTap twice).
//   world.recenter() / world.setPan(x, z) / world.getPan(); world.getView() also returns { pan:{x,z} }.
//   PET STROKES (CONTRACT_V8 §1): a press that STARTS on an actor and moves more than 8 px is a stroke, not a pan (when somebody
//   listens: world.onPetStroke(fn) -> unsubscribe). fn({ id, phase:'start'|'move'|'end', point:Vector3, region:'head'|'chin'|'back',
//   speed (screen px/s, smoothed), durationMs (since 'start'), x, y (client px) }). A tap (< 8 px) is still a tap; a drag that starts
//   on empty ground still pans; a 2nd finger / pointercancel / the actor being removed ends the stroke. region comes from the hit
//   point relative to the actor: addActor(id, obj, { height, radius, stroke: { headY, chinY, billboard } }) - headY / chinY are heights
//   above the feet (defaults 0.68 / 0.42 of height); a 3D model's chin is its lower FRONT (local +z), the rest is the back; billboard:true
//   uses a plain vertical split (no front/back). { stroke: false } opts an actor out (nests, cribs): a drag from it pans.
//   The canvas sets touch-action:none, so the page does not scroll while a finger is on the 3D view.
//   world.decorSpots -> [{ index, x, z }] : 2 / 4 / 6 / 8 spots (S / M / L / XL) on walkable ground away from the barn, nests,
//   pond and other yard props. Spot i keeps its position in every tier (a placed decor never moves); the array is replaced on
//   setYardTier and onYardChange info carries the count. `decorSpotsForTier(tierOrCapacity)` is the pure version.
//
// Interaction: see PAN above. Pinch / wheel zoom is clamped. A press that moves < 8 px and lasts < 500 ms is a tap. Taps pick actors by raycast first, then by screen proximity with a
// minimum 44 px radius, so small pets are easy to hit (set `userData.noPick = true` on a mesh to exclude it).
//
// Rendering: toon (MeshToonMaterial) look - use world.toonGradient as `gradientMap` for visual consistency. Lights:
// hemisphere + directional; actors get a blob shadow (pass { shadow:false } to skip). V20 (CONTRACT_V20): the lights, the CSS sky
// and a distance fog follow the local clock (js/world3d/daylight.js; world.setTimeMode('clock'|'theme'), world.setHour(h|null),
// world.daylight(), world.isNight()); clouds / stars / fireflies / cloud shadows live in js/world3d/skyfx.js; on the 'high' tier
// the sun casts ONE soft shadow map over the yard (opaque actor meshes and props cast, the ground receives). 30 fps cap while
// nothing is interacting; call world.boost(ms) for full rate during a special animation (e.g. hatch ceremony).
// world.worldToScreen(vec3) -> { x, y, visible } in CSS px relative to the host, for DOM overlays.
// world.pick(clientX, clientY) -> { id, point } uses the same picking as taps. world.getStats() -> debug numbers.
// Effects (hearts, bubbles, flying food, sparkles): see fx.js.
// ===================================================================================================

import * as THREE from '../../vendor/three.module.min.js';
import { getQualityPref } from '../prefs.js';
import { prefersReducedMotion as reducedMotion } from './support.js';
import { createRain, weatherTargets, weatherLight } from './rain.js';
import { skyAt, themeSky, hourOf, isNightHour } from './daylight.js';
import { createSkyFx } from './skyfx.js';

export { weatherTargets, weatherLight, puddleLayout } from './rain.js';

// ---------------------------------------------------------------- constants

export const TAP_MAX_MOVE_PX = 8;
export const TAP_MAX_MS = 500;
export const MIN_PICK_RADIUS_PX = 44;
export const IDLE_FPS = 30;
export const PITCH_MIN = 0.55;
export const PITCH_MAX = 1.15;
export const PITCH_DEFAULT = 0.9;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.5;
export const ZOOM_DEFAULT = 0.85;
export const CAMERA_FOV = 38;
/** Yard tiers (CONTRACT_V6 §4): walkable radius grows with barnCapacity; island = walk + 1.4, fence = walk + 0.7. */
export const YARD_TIERS = {
  S: { name: 'S', walk: 4.3, fence: 5.0, island: 5.7, barnZ: -3.6 },
  M: { name: 'M', walk: 5.0, fence: 5.7, island: 6.4, barnZ: -4.3 },
  L: { name: 'L', walk: 5.6, fence: 6.3, island: 7.0, barnZ: -4.9 },
  XL: { name: 'XL', walk: 6.2, fence: 6.9, island: 7.6, barnZ: -5.5 },
};
export const YARD_TIER_NAMES = ['S', 'M', 'L', 'XL'];
export const DEFAULT_YARD_TIER = 'L';
export const ISLAND_RADIUS = YARD_TIERS.L.island; // legacy constants = tier L
export const FENCE_RADIUS = YARD_TIERS.L.fence;
export const WALK_RADIUS = YARD_TIERS.L.walk;
export const YARD_GROW_MS = 900;
/** The camera distance is the fit of this tier for every tier, so pets keep one size on screen while the yard grows (CONTRACT_V7 §2). */
export const CAMERA_FIT_TIER = 'M';
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 36;
/** Wilderness: soft-edged meadow disc (radius `meadow`), props scattered in [rMin, rMax], a stream on the +x side. */
export const WILD = { meadow: 40, rMin: 6.0, rMax: 24, seed: 20261024, streamX: 12.5, streamAmp: 1.6, streamFreq: 0.22, streamHalf: 20 };
export const WILD_CLEARANCE_MARGIN = 0.3;
const MAX_DT = 0.1;
const FOG_NEAR = 24;      // V20 distance haze: the yard (~15 from the camera) stays clear, the far meadow / trees fade into the sky
const FOG_FAR = 64;
const MAX_SHADOWS = 128; // actors beyond this simply have no blob shadow
const YAW_PER_PX = 0.008;
const PITCH_PER_PX = 0.005;

export const QUALITY_TIERS = {
  high:   { name: 'high',   pixelRatioCap: 1.5,  antialias: true,  posts: 36, tufts: 80, flowers: 24, wild: 1 },
  medium: { name: 'medium', pixelRatioCap: 1.25, antialias: true,  posts: 28, tufts: 50, flowers: 14, wild: 0.7 },
  low:    { name: 'low',    pixelRatioCap: 1,    antialias: false, posts: 20, tufts: 24, flowers: 8, wild: 0.45 },
};
const TIER_ORDER = ['high', 'medium', 'low'];

// ---------------------------------------------------------------- pure helpers (unit-tested, no WebGL)

/** 'tap' when the press ended close to where it started and quickly; otherwise 'drag' (also long press). */
export function classifyPointer(down, up, { maxMovePx = TAP_MAX_MOVE_PX, maxMs = TAP_MAX_MS } = {}) {
  const moved = Math.hypot(up.x - down.x, up.y - down.y);
  const dur = up.t - down.t;
  return moved <= maxMovePx && dur <= maxMs ? 'tap' : 'drag';
}

/**
 * Picks the graphics tier. input: { pref:'auto'|'low', dpr, cores, memory(GB|null) }.
 * Returns a copy of QUALITY_TIERS[x] plus the concrete pixelRatio to use.
 */
export function pickQualityTier({ pref = 'auto', dpr = 1, cores = 4, memory = null } = {}) {
  let name;
  if (pref === 'low') name = 'low';
  else if ((memory != null && memory <= 2) || cores <= 2) name = 'low';
  else if (cores <= 4 || (memory != null && memory <= 4)) name = 'medium';
  else name = 'high';
  return tierWithRatio(name, dpr);
}

function tierWithRatio(name, dpr) {
  const t = QUALITY_TIERS[name];
  return { ...t, pixelRatio: Math.max(1, Math.min(Number(dpr) || 1, t.pixelRatioCap)) };
}

/** The next lower tier name ('high' -> 'medium' -> 'low'); null when already lowest. */
export function nextTierDown(name) {
  const i = TIER_ORDER.indexOf(name);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

/** Auto-downgrade rule: the average rendered-frame interval is > 1.5x the target interval over enough samples. */
export function shouldDowngrade(avgIntervalMs, targetFps = IDLE_FPS, samples = 0, minSamples = 60) {
  return samples >= minSamples && avgIntervalMs > (1000 / targetFps) * 1.5;
}

/**
 * Frame gate. Interactive (dragging, zooming, easing, boosted): render every rAF. Otherwise cap at idleFps.
 * The 4 ms slack keeps a 60 Hz display on every 2nd frame (33.3 ms) instead of every 3rd when rAF jitters.
 */
export function shouldRenderFrame(nowMs, lastRenderMs, interactive, idleFps = IDLE_FPS) {
  if (interactive) return true;
  return nowMs - lastRenderMs >= 1000 / idleFps - 4;
}

export const clampPitch = p => Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));
export const clampZoom = z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Camera position orbiting `target` ({x,y,z}) at yaw (around Y), pitch (elevation, radians) and distance. */
export function orbitPosition(yaw, pitch, dist, target = { x: 0, y: 0, z: 0 }) {
  const c = Math.cos(pitch);
  return {
    x: target.x + Math.sin(yaw) * c * dist,
    y: target.y + Math.sin(pitch) * dist,
    z: target.z + Math.cos(yaw) * c * dist,
  };
}

/** Camera distance used for every yard tier: the fit of CAMERA_FIT_TIER (M). */
export function fixedCameraDistance(aspect, fovDeg = CAMERA_FOV, pitch = PITCH_DEFAULT) {
  return fitDistance(aspect, fovDeg, pitch, YARD_TIERS[CAMERA_FIT_TIER].island);
}

/** Distance at which a disc of `radius` fits the view horizontally and (tilted by pitch) vertically. */
export function fitDistance(aspect, fovDeg, pitch, radius) {
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const halfW = radius * 0.95;
  const halfH = radius * Math.sin(pitch) + 1.2; // + room for the barn and fence height
  return Math.max(halfH / tanHalf, halfW / (tanHalf * Math.max(0.1, aspect)));
}

/** Screen pixels per world unit at a given camera distance. */
export function pixelsPerUnit(distance, fovDeg, viewportHeightPx) {
  return viewportHeightPx / (2 * Math.max(0.001, distance) * Math.tan((fovDeg * Math.PI) / 360));
}

/** Effective tap radius in px: the actor's projected radius but never below minPx. */
export function effectivePickRadiusPx(worldRadius, distance, fovDeg, viewportHeightPx, minPx = MIN_PICK_RADIUS_PX) {
  return Math.max(minPx, worldRadius * pixelsPerUnit(distance, fovDeg, viewportHeightPx));
}

/**
 * Screen-space picking. candidates: [{ id, sx, sy, r, depth }] (projected centre in px, effective radius in px).
 * Returns the id whose centre is closest to (px,py) relative to its radius, ties -> nearer to the camera; null if none.
 */
export function pickNearest(candidates, px, py) {
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.sx - px, c.sy - py);
    if (d > c.r) continue;
    const score = d / c.r + (c.depth || 0) * 1e-6;
    if (score < bestScore) { bestScore = score; best = c.id; }
  }
  return best;
}

/** Yard tier name for a barnCapacity: 3-5 S, 6-9 M, 10-14 L, 15+ XL (anything lower than 3 is S). */
export function yardTierForCapacity(capacity) {
  const c = Number(capacity) || 0;
  return c >= 15 ? 'XL' : c >= 10 ? 'L' : c >= 6 ? 'M' : 'S';
}
/** Where the wilderness starts for a tier: just outside its lawn. Wild props closer than this are sunk away. */
export function wildClearance(tierOrCapacity) {
  return yardTierConfig(tierOrCapacity).island + WILD_CLEARANCE_MARGIN;
}

/** Camera target kept inside a disc of `radius` around the origin. */
export function clampPan(x, z, radius) {
  const d = Math.hypot(x, z);
  if (!(d > radius)) return { x, z };
  const k = radius / d;
  return { x: x * k, z: z * k };
}

/**
 * Ground distance the camera target moves for a finger drag of (dxPx, dyPx), so the ground follows the finger.
 * yaw: camera yaw; vertical movement is stretched by 1/sin(pitch) because the ground is seen at an angle.
 */
export function panDelta(dxPx, dyPx, yaw, pitch, distance, fovDeg, viewportHeightPx) {
  const u = 1 / pixelsPerUnit(distance, fovDeg, viewportHeightPx);
  const right = -dxPx * u;                                  // finger right -> the camera target moves left
  const back = -dyPx * u / Math.max(0.2, Math.sin(pitch));  // finger up (dy < 0) -> the target moves towards the camera
  // camera right = (cos yaw, 0, -sin yaw); camera back (away from the view direction) = (sin yaw, 0, cos yaw)
  return {
    x: Math.cos(yaw) * right + Math.sin(yaw) * back,
    z: -Math.sin(yaw) * right + Math.cos(yaw) * back,
  };
}

/** Strokes: fast scrubbing above this (px/s) is "giggle" territory; B tunes its own thresholds, this is just a sane default. */
export const STROKE_FAST_PX_S = 700;
export const STROKE_MIN_SESSION_MS = 600;

/**
 * Region of a stroke point on a pet: 'head' | 'chin' | 'back'.
 * dy: height of the point above the feet; dz: offset along the pet's facing direction (local +z); dims: { height, radius, headY, chinY, billboard }.
 */
export function strokeRegion(dy, dz, dims) {
  const h = dims.height > 0 ? dims.height : 1;
  const headY = dims.headY > 0 ? dims.headY : h * 0.68;
  const chinY = dims.chinY > 0 ? dims.chinY : h * 0.42;
  if (dy >= headY) return 'head';
  if (dy >= chinY && (dims.billboard || dz >= (dims.radius || 0.5) * 0.15)) return 'chin';
  return 'back';
}

/** Second tap of a double tap? prev/cur: { x, y, t } (px, ms). */
export function isDoubleTap(prev, cur, maxMs = DOUBLE_TAP_MS, maxPx = DOUBLE_TAP_PX) {
  return !!prev && cur.t - prev.t <= maxMs && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= maxPx;
}

/**
 * Decor spots (CONTRACT_V7 §3): spot i is fixed in every tier. Chosen to stay >= 0.7 from every yard prop of every tier
 * (see petBehaviour.yardProps), clear of the barn, the nest rows and the food bowl, and inside the walk radius of the tier
 * that unlocks it (two per tier). A test keeps this list in sync with the props.
 */
export const DECOR_SPOTS = [
  { x: 0.0, z: 3.3 }, { x: 3.4, z: 1.2 },      // S
  { x: -2.6, z: 3.4 }, { x: -1.6, z: 0.4 },    // + M
  { x: 0.0, z: 5.1 }, { x: 1.9, z: -0.2 },     // + L
  { x: -5.3, z: 1.0 }, { x: 5.3, z: 0.6 },     // + XL
];
export const DECOR_SPOT_COUNT = { S: 2, M: 4, L: 6, XL: 8 };
/** [{ index, x, z }] for a tier name or barnCapacity (2 / 4 / 6 / 8 spots). */
export function decorSpotsForTier(tierOrCapacity) {
  const n = DECOR_SPOT_COUNT[yardTierConfig(tierOrCapacity).name];
  return DECOR_SPOTS.slice(0, n).map((p, index) => ({ index, x: p.x, z: p.z }));
}

/** Accepts a tier name ('S'..'XL', any case) or a capacity number; returns the tier config (default L). */
export function yardTierConfig(tierOrCapacity) {
  if (typeof tierOrCapacity === 'number') return YARD_TIERS[yardTierForCapacity(tierOrCapacity)];
  return YARD_TIERS[String(tierOrCapacity || '').toUpperCase()] || YARD_TIERS[DEFAULT_YARD_TIER];
}
/** Scale factor + easing used while the yard grows: starts at `from` (old/new radius) and settles at 1 with a little overshoot. */
export function yardGrowScale(from, u) {
  const x = Math.min(1, Math.max(0, u));
  const c1 = 1.2;
  const c3 = c1 + 1;
  const e = 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  return from + (1 - from) * e;
}

/**
 * Merges many small static parts into ONE BufferGeometry (1 draw call) with per-vertex colours.
 * parts: [{ geometry, color, position:[x,y,z], rotation:[x,y,z], scale: n | [x,y,z] }]. Source geometries are not modified.
 */
export function mergeStaticParts(THREE_, parts) {
  const pos = [];
  const nor = [];
  const col = [];
  const m = new THREE_.Matrix4();
  const q = new THREE_.Quaternion();
  const e = new THREE_.Euler();
  const nm = new THREE_.Matrix3();
  const c = new THREE_.Color();
  const v = new THREE_.Vector3();
  for (const part of parts) {
    const src = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    if (!src.attributes.normal) src.computeVertexNormals();
    const r = part.rotation || [0, 0, 0];
    const sc = Array.isArray(part.scale) ? part.scale : [part.scale ?? 1, part.scale ?? 1, part.scale ?? 1];
    const t = part.position || [0, 0, 0];
    q.setFromEuler(e.set(r[0], r[1], r[2]));
    m.compose(v.set(t[0], t[1], t[2]), q, new THREE_.Vector3(sc[0], sc[1], sc[2]));
    nm.getNormalMatrix(m);
    c.set(part.color ?? 0xffffff);
    const pa = src.attributes.position;
    const na = src.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    }
    src.dispose();
  }
  const geo = new THREE_.BufferGeometry();
  geo.setAttribute('position', new THREE_.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE_.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE_.Float32BufferAttribute(col, 3));
  return geo;
}

// ---------------------------------------------------------------- support detection (lives in support.js: no three.js import)

export { prefersReducedMotion, detectWebGL, isWorldSupported } from './support.js';

// ---------------------------------------------------------------- scene building (engine-owned resources)

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeToonGradient() {
  const data = new Uint8Array([
    120, 120, 120, 255,
    200, 200, 200, 255,
    255, 255, 255, 255,
  ]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * V22 wind (CONTRACT_V22 §1): grass / flowers sway in the vertex shader (no extra draw call). `wind` = { t: { value } } shared per
 * world (seconds) or null (low tier: no sway). base = the geometry's bottom y (local), k = sway strength. Instanced meshes get
 * their own phase from where they stand, plus a slow gust that rolls across the field.
 */
export function windify(mat, wind, base, k) {
  if (!wind) return mat;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWindT = wind.t;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 wp = vec2( 0.0 );
          #ifdef USE_INSTANCING
            wp = instanceMatrix[ 3 ].xz;
          #endif
          float h = max( transformed.y - ( ${base.toFixed(3)} ), 0.0 );
          float gust = 0.55 + 0.45 * sin( uWindT * 0.6 + wp.x * 0.18 - wp.y * 0.11 );
          float sw = sin( uWindT * 2.1 + wp.x * 0.9 + wp.y * 0.7 ) * gust;
          transformed.x += sw * h * h * ${k.toFixed(3)};
          transformed.z += cos( uWindT * 1.7 + wp.y * 0.8 ) * gust * h * h * ${(k * 0.5).toFixed(3)};
        }`);
  };
  mat.customProgramCacheKey = () => `nf-wind-${base}-${k}`;
  return mat;
}

/** Builds ground island, fence, grass tufts, flowers (group) and the barn prop (barn) for a yard tier. */
function buildEnvironment(tier, gradient, yard, wind = null) {
  const group = new THREE.Group();
  group.name = 'environment';
  const disposables = [];
  const own = o => { disposables.push(o); return o; };
  const toon = color => own(new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
  const rand = mulberry32(20261023);

  // lawn: a mown disc on the meadow (one draw call), green with a dirt-coloured edge
  const lawnGeo = own(new THREE.RingGeometry(0, yard.island, 48, 8));
  lawnGeo.rotateX(-Math.PI / 2);
  const lawnCol = [];
  const lawnPos = lawnGeo.attributes.position;
  const grassC = new THREE.Color(0x8ccf6a);
  const dirtC = new THREE.Color(0xd2b184);
  const mixC = new THREE.Color();
  for (let i = 0; i < lawnPos.count; i++) {
    const t = Math.min(1, Math.max(0, (Math.hypot(lawnPos.getX(i), lawnPos.getZ(i)) / yard.island - 0.86) / 0.14));
    mixC.copy(grassC).lerp(dirtC, t);
    lawnCol.push(mixC.r, mixC.g, mixC.b);
  }
  lawnGeo.setAttribute('color', new THREE.Float32BufferAttribute(lawnCol, 3));
  const lawnMat = own(new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap: gradient, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  const lawn = new THREE.Mesh(lawnGeo, lawnMat);
  lawn.position.y = 0.01;
  lawn.userData.noPick = true;
  group.add(lawn);

  // dirt path from the barn door to the middle
  const pathMat = own(new THREE.MeshToonMaterial({
    color: 0xe7cf9c, gradientMap: gradient, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const path = new THREE.Mesh(own(new THREE.PlaneGeometry(1.5, 4.2)), pathMat);
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, yard.barnZ + 3.2);
  path.userData.noPick = true;
  group.add(path);

  // fence (gap behind the barn)
  const posts = Math.max(12, Math.round(tier.posts * yard.fence / FENCE_RADIUS));
  const areaK = (yard.fence / FENCE_RADIUS) ** 2;
  const gapAngle = Math.PI;
  const inGap = a => Math.abs(((a - gapAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5;
  const woodMat = toon(0xc08a54);
  const keep = [];
  for (let i = 0; i < posts; i++) if (!inGap((i / posts) * Math.PI * 2)) keep.push(i);
  const postMesh = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.16, 0.7, 0.16)), woodMat, keep.length);
  const dummy = new THREE.Object3D();
  keep.forEach((i, n) => {
    const a = (i / posts) * Math.PI * 2;
    dummy.position.set(Math.sin(a) * yard.fence, 0.35, Math.cos(a) * yard.fence);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postMesh.setMatrixAt(n, dummy.matrix);
  });
  postMesh.userData.noPick = true;
  group.add(postMesh);

  const chord = 2 * yard.fence * Math.sin(Math.PI / posts);
  const railSegs = keep.filter(i => !inGap(((i + 1) / posts) * Math.PI * 2));
  const railMesh = new THREE.InstancedMesh(own(new THREE.BoxGeometry(1, 0.07, 0.06)), woodMat, railSegs.length * 2);
  let r = 0;
  for (const i of railSegs) {
    const a = ((i + 0.5) / posts) * Math.PI * 2;
    const radius = yard.fence * Math.cos(Math.PI / posts);
    for (const y of [0.28, 0.54]) {
      dummy.position.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
      dummy.rotation.set(0, a, 0);
      dummy.scale.set(chord, 1, 1);
      dummy.updateMatrix();
      railMesh.setMatrixAt(r++, dummy.matrix);
    }
  }
  railMesh.userData.noPick = true;
  group.add(railMesh);

  // grass tufts
  const tufts_n = Math.round(tier.tufts * areaK);
  const flowers_n = Math.round(tier.flowers * areaK);
  const tuftMat = windify(toon(0xffffff), wind, -0.15, 1.3);   // V22: the cone is centred on its origin
  const tufts = new THREE.InstancedMesh(own(new THREE.ConeGeometry(0.08, 0.3, 4)), tuftMat, tufts_n);
  const green = new THREE.Color();
  for (let i = 0; i < tufts_n; i++) {
    const a = rand() * Math.PI * 2;
    const rad = Math.sqrt(rand()) * (yard.fence - 0.4);
    dummy.position.set(Math.sin(a) * rad, 0.13, Math.cos(a) * rad);
    dummy.rotation.set(0, rand() * 3, (rand() - 0.5) * 0.3);
    const s = 0.7 + rand() * 0.8;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    tufts.setMatrixAt(i, dummy.matrix);
    green.setHSL(0.27 + rand() * 0.04, 0.45, 0.42 + rand() * 0.1);
    tufts.setColorAt(i, green);
  }
  tufts.userData.noPick = true;
  group.add(tufts);

  // flowers
  const flowerMat = windify(toon(0xffffff), wind, -0.3, 0.5);   // V22: a little nod (the head is a sphere on an unseen stem)
  const flowers = new THREE.InstancedMesh(own(new THREE.SphereGeometry(0.075, 6, 4)), flowerMat, flowers_n);
  const palette = [0xffd84a, 0xff8fb1, 0xffffff, 0xb9a0ff].map(c => new THREE.Color(c));
  for (let i = 0; i < flowers_n; i++) {
    const a = rand() * Math.PI * 2;
    const rad = 1.5 + Math.sqrt(rand()) * (yard.fence - 2);
    dummy.position.set(Math.sin(a) * rad, 0.1, Math.cos(a) * rad);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    flowers.setColorAt(i, palette[i % palette.length]);
  }
  flowers.userData.noPick = true;
  group.add(flowers);

  // barn prop (door faces +z)
  const barn = new THREE.Group();
  barn.name = 'barn';
  const W = 2.8, D = 2.3, WALL = 1.25, PEAK = 2.1;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, WALL);
  shape.lineTo(0, PEAK); shape.lineTo(-W / 2, WALL); shape.closePath();
  const bodyGeo = own(new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false }));
  bodyGeo.translate(0, 0, -D / 2);
  barn.add(new THREE.Mesh(bodyGeo, toon(0xd8574a)));
  const slopeLen = Math.hypot(W / 2, PEAK - WALL) + 0.25;
  const slopeAng = Math.atan2(PEAK - WALL, W / 2);
  const roofMat = toon(0x7b5b45);
  const roofGeo = own(new THREE.BoxGeometry(slopeLen, 0.1, D + 0.3));
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(side * (W / 4 + 0.02), (WALL + PEAK) / 2 + 0.07, 0);
    roof.rotation.z = -side * slopeAng;
    barn.add(roof);
  }
  const trimMat = toon(0xfff4e4);
  const door = new THREE.Mesh(own(new THREE.BoxGeometry(1.0, 0.95, 0.06)), trimMat);
  door.position.set(0, 0.475, D / 2 + 0.01);
  barn.add(door);
  const crossGeo = own(new THREE.BoxGeometry(1.15, 0.07, 0.04));
  const crossMat = toon(0xd8574a);
  for (const s of [-1, 1]) {
    const bar = new THREE.Mesh(crossGeo, crossMat);
    bar.position.set(0, 0.475, D / 2 + 0.05);
    bar.rotation.z = s * 0.7;
    bar.scale.x = 0.85;
    barn.add(bar);
  }
  const loft = new THREE.Mesh(own(new THREE.BoxGeometry(0.5, 0.4, 0.05)), trimMat);
  loft.position.set(0, 1.45, D / 2 + 0.01);
  barn.add(loft);
  barn.position.set(0, 0, yard.barnZ);
  barn.traverse(o => { o.userData.noPick = true; });
  const barnGroup = new THREE.Group();
  barnGroup.name = 'barn-holder';
  barnGroup.add(barn);

  return {
    group,
    barn: barnGroup,
    obstacles: [{ x: 0, z: yard.barnZ, r: 2.0 }],
    dispose() {
      for (const o of disposables) o.dispose();
      postMesh.dispose(); railMesh.dispose(); tufts.dispose(); flowers.dispose();
    },
  };
}

// ---------------------------------------------------------------- wilderness (CONTRACT_V7 §2)

const streamCenterX = z => WILD.streamX + WILD.streamAmp * Math.sin(z * WILD.streamFreq);

/**
 * Deterministic wild layout: { grass, bush, tree, rock }: [{ x, z, r, rot, s, color }] outside the stream, in [WILD.rMin, WILD.rMax].
 * `k` scales the counts (quality tier). Pure: no geometry, only THREE.Color for the tints.
 */
export function layoutWild(k = 1) {
  const rand = mulberry32(WILD.seed);
  const area = () => {
    const r = Math.sqrt(WILD.rMin ** 2 + rand() ** 1.5 * (WILD.rMax ** 2 - WILD.rMin ** 2)); // denser near the yard
    const a = rand() * Math.PI * 2;
    return { x: Math.sin(a) * r, z: Math.cos(a) * r, r };
  };
  const nearStream = (x, z, d) => Math.abs(x - streamCenterX(z)) < d && Math.abs(z) < WILD.streamHalf + 2;
  const c = new THREE.Color();
  const make = (n, minR, streamGap, tint, size, minGap = 0) => {
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 30; tries++) {
      const p = area();
      if (p.r < minR || nearStream(p.x, p.z, streamGap)) continue;
      if (minGap && out.some(o => Math.hypot(o.x - p.x, o.z - p.z) < minGap)) continue;
      c.setHSL(...tint(rand));
      out.push({ ...p, rot: rand() * Math.PI * 2, s: size(rand), color: c.getHex() });
    }
    return out;
  };
  // grass grows in patches: most clumps around a handful of centres, the rest anywhere
  const centres = Array.from({ length: 16 }, area);
  const grass = [];
  const gN = Math.round(560 * k);
  for (let tries = 0; grass.length < gN && tries < gN * 20; tries++) {
    let p = area();
    if (rand() < 0.8) {
      const q = centres[Math.floor(rand() * centres.length)];
      const a = rand() * Math.PI * 2, d = Math.abs(rand() + rand() - 1) * 3.2;
      const x = q.x + Math.sin(a) * d, z = q.z + Math.cos(a) * d;
      p = { x, z, r: Math.hypot(x, z) };
    }
    if (p.r < WILD.rMin || p.r > WILD.rMax || nearStream(p.x, p.z, 1.9)) continue;
    c.setHSL(0.25 + rand() * 0.06, 0.5, 0.36 + rand() * 0.14);
    grass.push({ ...p, rot: rand() * Math.PI * 2, s: 0.8 + rand() * 0.9, color: c.getHex() });
  }
  return {
    grass,
    bush: make(Math.round(80 * k), WILD.rMin, 2.4, r => [0.27 + r() * 0.08, 0.45, 0.3 + r() * 0.12], r => 0.7 + r() * 0.8, 1.2),
    tree: make(Math.round(48 * k), 7.0, 2.8, r => [0, 0, 0.78 + r() * 0.22], r => 0.85 + r() * 0.85, 2.4),
    rock: make(Math.round(44 * k), WILD.rMin, 1.6, r => [0.1, 0.06, 0.5 + r() * 0.15], r => 0.6 + r() * 0.9, 1.0),
  };
}

/**
 * The meadow ring beyond the fence: soft-edged ground disc + instanced grass / bushes / trees / rocks + a stream = 6 draw calls.
 * Props closer to the centre than `clearance` are hidden (scale 0); setClearance() sinks / grows them over YARD_GROW_MS.
 */
function buildWilderness(tier, gradient, clearance, wind = null) {
  const group = new THREE.Group();
  group.name = 'wilderness';
  const disposables = [];
  const own = o => { disposables.push(o); return o; };
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const layout = layoutWild(tier.wild ?? 1);

  // meadow: transparent rim so it melts into the sky behind the canvas (drawn before the blob shadows)
  const meadowGeo = own(new THREE.RingGeometry(0, WILD.meadow, 56, 10));
  meadowGeo.rotateX(-Math.PI / 2);
  const mp = meadowGeo.attributes.position;
  const mc = [];
  const near = new THREE.Color(0x76bb58), far = new THREE.Color(0x66a84e);
  for (let i = 0; i < mp.count; i++) {
    const t = Math.hypot(mp.getX(i), mp.getZ(i)) / WILD.meadow;
    col.copy(near).lerp(far, t);
    mc.push(col.r, col.g, col.b, 1 - Math.min(1, Math.max(0, (t - 0.55) / 0.45)));
  }
  meadowGeo.setAttribute('color', new THREE.Float32BufferAttribute(mc, 4));
  const meadow = new THREE.Mesh(meadowGeo, own(new THREE.MeshToonMaterial({ vertexColors: true, transparent: true, gradientMap: gradient })));
  meadow.renderOrder = -2;
  meadow.userData.noPick = true;
  group.add(meadow);

  // shared materials / geometry
  const plainMat = own(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient }));
  const vcMat = own(new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: gradient }));
  const grassMat = own(windify(new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: gradient }), wind, 0, 0.4));   // V22: trees keep vcMat (they do not sway)
  const geo = {
    grass: own(mergeStaticParts(THREE, [
      { geometry: new THREE.ConeGeometry(0.07, 0.55, 4), color: 0xffffff, position: [0, 0.27, 0] },
      { geometry: new THREE.ConeGeometry(0.06, 0.42, 4), color: 0xe6f2dc, position: [0.1, 0.2, 0.04], rotation: [0, 0, -0.35] },
      { geometry: new THREE.ConeGeometry(0.06, 0.38, 4), color: 0xe6f2dc, position: [-0.09, 0.18, -0.03], rotation: [0.2, 0, 0.4] },
    ])),
    bush: own(new THREE.IcosahedronGeometry(0.5, 1)),
    tree: own(mergeStaticParts(THREE, [
      { geometry: new THREE.CylinderGeometry(0.1, 0.16, 0.9, 6), color: 0x8d5a34, position: [0, 0.45, 0] },
      { geometry: new THREE.IcosahedronGeometry(0.72, 1), color: 0x4fae56, position: [0, 1.4, 0] },
      { geometry: new THREE.IcosahedronGeometry(0.5, 1), color: 0x66c46d, position: [0.28, 1.95, 0.08] },
    ])),
    rock: own(new THREE.IcosahedronGeometry(0.4, 0)),
  };
  const kinds = {
    grass: { y: 0, mat: grassMat, squash: 1 },
    bush: { y: 0.18, mat: plainMat, squash: 0.75 },
    tree: { y: 0, mat: vcMat, squash: 1 },
    rock: { y: 0.1, mat: plainMat, squash: 0.65 },
  };
  const meshes = [];
  const movable = []; // { kind, i, item, vis, from, to }: props that a bigger yard can swallow
  let totalItems = 0;
  for (const [kind, def] of Object.entries(kinds)) {
    const items = layout[kind];
    const mesh = new THREE.InstancedMesh(geo[kind], def.mat, Math.max(1, items.length));
    mesh.count = items.length;
    mesh.frustumCulled = false;
    mesh.userData.noPick = true;
    items.forEach((it, i) => {
      col.setHex(it.color);
      mesh.setColorAt(i, col);
      if (it.r < wildClearance('XL')) movable.push({ kind, i, item: it, vis: 1, from: 1, to: 1 });
    });
    totalItems += items.length;
    def.mesh = mesh;
    meshes.push(mesh);
    group.add(mesh);
  }
  const writeItem = (kind, i, vis) => {
    const it = layout[kind][i];
    const v = Math.max(0.001, vis);
    dummy.position.set(it.x, kinds[kind].y * it.s - (1 - v) * 0.5, it.z);
    dummy.rotation.set(0, it.rot, 0);
    dummy.scale.set(it.s * v, it.s * v * kinds[kind].squash, it.s * v);
    dummy.updateMatrix();
    kinds[kind].mesh.setMatrixAt(i, dummy.matrix);
  };
  for (const [kind, items] of Object.entries(layout)) items.forEach((_, i) => writeItem(kind, i, 1));

  // stream on the +x side: sandy bank + water with lighter edges, one merged vertex-coloured mesh, tapering at both ends
  {
    const pos = [], nor = [], colr = [], idx = [];
    const bankC = new THREE.Color(0xd9c48f), waterC = new THREE.Color(0x4fb6e4), foamC = new THREE.Color(0x9be3f5);
    const strip = (half, y, edgeC, midC) => {
      const base = pos.length / 3;
      const steps = WILD.streamHalf * 2;
      for (let j = 0; j <= steps; j++) {
        const z = -WILD.streamHalf + j;
        const slope = WILD.streamAmp * WILD.streamFreq * Math.cos(z * WILD.streamFreq);
        const len = Math.hypot(1, slope);
        const nx = 1 / len, nz = -slope / len;
        const w = half * Math.min(1, (WILD.streamHalf - Math.abs(z)) / 4);
        const cx = streamCenterX(z);
        for (const [f, c] of [[-1, edgeC], [0, midC], [1, edgeC]]) {
          pos.push(cx + nx * w * f, y, z + nz * w * f);
          nor.push(0, 1, 0);
          colr.push(c.r, c.g, c.b);
        }
        if (j < steps) {
          const a = base + j * 3;
          idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
        }
      }
    };
    strip(1.55, 0.012, bankC, bankC);
    strip(1.0, 0.02, foamC, waterC);
    const g = own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx);
    const mat = own(new THREE.MeshToonMaterial({
      vertexColors: true, gradientMap: gradient, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    if (wind) {   // V22: glints drifting down the stream on the blue water only (not the foam / banks)
      mat.onBeforeCompile = sh => {
        sh.uniforms.uWindT = wind.t;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWindT;\nvarying vec3 vWPos;')
          .replace('#include <opaque_fragment>', `#if defined( USE_COLOR )
            if ( vColor.b > vColor.r + 0.2 ) {
              float s = sin( vWPos.z * 2.3 + uWindT * 1.8 + sin( vWPos.x * 3.1 ) ) * sin( vWPos.z * 0.9 - uWindT * 1.1 + vWPos.x * 1.7 );
              outgoingLight += vec3( 0.55, 0.78, 0.9 ) * smoothstep( 0.55, 0.95, s ) * 0.55;
            }
          #endif
          #include <opaque_fragment>`);
      };
      mat.customProgramCacheKey = () => 'nf-stream';
    }
    const stream = new THREE.Mesh(g, mat);
    stream.name = 'stream';
    stream.userData.noPick = true;
    group.add(stream);
    meshes.push(stream);
  }

  let anim = null; // { age }
  let current = clearance;
  const applyVis = () => {
    for (const m of movable) writeItem(m.kind, m.i, m.vis);
    for (const def of Object.values(kinds)) def.mesh.instanceMatrix.needsUpdate = true;
  };
  function setClearance(r, animate) {
    current = r;
    for (const m of movable) {
      m.from = m.vis;
      m.to = m.item.r >= r ? 1 : 0;
    }
    if (animate && movable.some(m => m.from !== m.to)) anim = { age: 0 };
    else { anim = null; for (const m of movable) m.vis = m.from = m.to; applyVis(); }
  }
  setClearance(clearance, false);

  return {
    group,
    setClearance,
    get clearance() { return current; },
    get animating() { return !!anim; },
    info() {
      const hidden = movable.filter(m => m.to === 0).length;
      return { clearance: current, items: totalItems, visible: totalItems - hidden, animating: !!anim, meshes: meshes.length + 1 }; // + the meadow
    },
    update(dt) {
      if (!anim) return;
      anim.age += dt * 1000;
      const u = Math.min(1, anim.age / YARD_GROW_MS);
      const e = u * u * (3 - 2 * u);
      for (const m of movable) m.vis = m.from + (m.to - m.from) * e;
      applyVis();
      if (u >= 1) { anim = null; for (const m of movable) m.vis = m.from = m.to; applyVis(); }
    },
    dispose() {
      for (const o of disposables) o.dispose();
      for (const def of Object.values(kinds)) def.mesh.dispose();
    },
  };
}

// ---------------------------------------------------------------- the world

/**
 * Creates the 3D world inside hostEl. Throws if WebGL cannot be created.
 * handlers: { onTap(actorId, info), onTapGround(point) }; options: { quality:'auto'|'low', wheelZoom:true }.
 */
export function createWorld(hostEl, handlers = {}, options = {}) {
  const { onTap, onTapGround } = handlers;
  const pref = options.quality || getQualityPref();
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  let tier = pickQualityTier({
    pref, dpr: window.devicePixelRatio || 1, cores: nav.hardwareConcurrency || 4, memory: nav.deviceMemory ?? null,
  });

  const canvas = document.createElement('canvas');
  canvas.className = 'world3d-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'ฉากลาน 3 มิติ — ลากเพื่อเลื่อนมุมมอง บีบนิ้วเพื่อซูม แตะน้องเพื่อดูรายละเอียด แตะสองครั้งที่พื้นเพื่อกลับตรงกลาง');
  canvas.style.touchAction = 'none'; // one finger pans the view, so the page must not scroll under it
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.antialias, alpha: true, powerPreference: 'default' });
  } catch (e) {
    throw new Error(`WebGL unavailable: ${e && e.message ? e.message : e}`);
  }
  // Everything created from here on registers an undo step; if setup throws half way they all run (reverse order),
  // so a failed createWorld leaves no canvas, listeners, observers or GPU context behind.
  const undo = [() => {
    try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* already gone */ }
    canvas.remove();
    hostEl.classList.remove('world3d-host');
  }];
  try {
    renderer.setPixelRatio(tier.pixelRatio);
    renderer.setClearColor(0x000000, 0);
    hostEl.classList.add('world3d-host');
    hostEl.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 140);
    const toonGradient = makeToonGradient();
    const blobTexture = makeBlobTexture();
    const blobGeo = new THREE.PlaneGeometry(1, 1);
    blobGeo.rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({
      map: blobTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    // all actor shadows = ONE instanced mesh (1 draw call however many actors)
    const blobMesh = new THREE.InstancedMesh(blobGeo, blobMat, MAX_SHADOWS);
    blobMesh.count = 0;
    blobMesh.frustumCulled = false;
    blobMesh.renderOrder = -1;
    blobMesh.userData.noPick = true;
    const blobDummy = new THREE.Object3D();

    const hemi = new THREE.HemisphereLight(0xfff6e6, 0x86b86a, 1.9);
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.9);
    sun.position.set(-4, 9, 6);
    scene.add(hemi, sun, sun.target, blobMesh);
    const darkMq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    let lightScale = 1;            // fx.dimScene tweens this (1 = normal, lower = dimmer scene)
    const shakeOffset = { x: 0, y: 0, z: 0 }; // fx.shake jitters the camera by this much (world units)
    // weather (CONTRACT_V9 §4): cloud / rain ease towards the targets set by world.setWeather; lights and the CSS sky follow
    const weather = { kind: 'sunny', intensity: 1, cloud: 0, rain: 0, tCloud: 0, tRain: 0, skyKey: '' };
    // V20 time of day: colours from daylight.js, refreshed about once a second (they change over minutes)
    let timeMode = options.timeMode === 'theme' ? 'theme' : 'clock';
    let hourOverride = null;       // debug / previews: a fixed hour
    let look = skyAt(12);
    let lookAge = 0;
    let skyFx = null;              // created with the yard below
    const stormGrey = new THREE.Color(0xc4ccd6);
    const skyColor = new THREE.Color();
    const skyGrey = new THREE.Color();
    scene.fog = new THREE.Fog(0xcfe9e4, FOG_NEAR, FOG_FAR);
    const nightGrey = new THREE.Color(0x3b4653);
    const setGrey = () => skyGrey.set(0xb9c3cd).lerp(nightGrey, look.night);   // storm grey darkens smoothly into the night
    const applyMood = () => {
      const wl = weatherLight(weather.cloud, weather.rain);
      hemi.intensity = look.hemi.intensity * lightScale * wl.hemi;
      sun.intensity = look.sun.intensity * lightScale * wl.sun;
      hemi.color.set(look.hemi.sky).lerp(stormGrey, wl.grey);
      hemi.groundColor.set(look.hemi.ground).lerp(stormGrey, wl.grey * 0.4);
      sun.color.set(look.sun.color).lerp(stormGrey, wl.grey);
      const d = look.sun.dir;
      sun.position.set(d.x * 20, d.y * 20, d.z * 20);
      setGrey();
      scene.fog.color.set(look.fog).lerp(skyGrey, 0.5 * weather.cloud);
    };
    // The CSS sky gradient lives behind the (transparent) canvas: tint it through inline custom properties on the host.
    const applySky = () => {
      const key = `${look.skyTop}${look.skyBottom}${weather.cloud.toFixed(2)}`;
      if (key === weather.skyKey) return;
      weather.skyKey = key;
      setGrey();
      for (const [prop, c] of [['--world-sky-top', look.skyTop], ['--world-sky-bottom', look.skyBottom]]) {
        hostEl.style.setProperty(prop, `#${skyColor.set(c).lerp(skyGrey, 0.62 * weather.cloud).getHexString()}`);
      }
    };
    let syncShadowFlags = () => {};   // set once the yard exists (high tier only does anything)
    function refreshLook() {
      look = hourOverride != null ? skyAt(hourOverride)
        : timeMode === 'theme' ? themeSky(!!(darkMq && darkMq.matches)) : skyAt(hourOf(new Date()));
      lookAge = 0;
      applyMood();
      applySky();
      if (skyFx) skyFx.setLook(look, weather.cloud);
      syncShadowFlags();
    }
    const onScheme = () => { weather.skyKey = ''; refreshLook(); };
    refreshLook();
    if (darkMq && darkMq.addEventListener) darkMq.addEventListener('change', onScheme);
    undo.push(() => {
      if (darkMq && darkMq.removeEventListener) darkMq.removeEventListener('change', onScheme);
      hostEl.style.removeProperty('--world-sky-top'); hostEl.style.removeProperty('--world-sky-bottom');
    });

    undo.push(() => { blobGeo.dispose(); blobMat.dispose(); blobTexture.dispose(); toonGradient.dispose(); });
    // ---- yard (grows with barnCapacity), static props
    let yardCfg = yardTierConfig(options.yardTier || DEFAULT_YARD_TIER);
    const wind = tier.name === 'low' ? null : { t: { value: 0 } };   // V22: no sway on the low tier
    let env = buildEnvironment(tier, toonGradient, yardCfg, wind);
    undo.push(() => env.dispose());
    scene.add(env.group, env.barn);
    const wild = buildWilderness(tier, toonGradient, wildClearance(yardCfg.name), wind);
    undo.push(() => wild.dispose());
    scene.add(wild.group);
    let decorSpots = decorSpotsForTier(yardCfg.name);
    const obstacles = env.obstacles.map(o => ({ ...o })); // mutable list shared with scenes (world.obstacles)
    const rainFx = createRain(THREE, { quality: tier.name, reduced: reducedMotion() }); // 2 draw calls while it rains, 0 otherwise
    scene.add(rainFx.group);
    rainFx.setArea(yardCfg.walk, obstacles);
    undo.push(() => rainFx.dispose());
    skyFx = createSkyFx(THREE, { tier: tier.name, gradient: toonGradient, walkRadius: yardCfg.walk });
    scene.add(skyFx.group);
    skyFx.setLook(look, weather.cloud);
    undo.push(() => skyFx.dispose());
    let weatherBusy = false;
    function updateWeather(dt) {
      weatherBusy = Math.abs(weather.tCloud - weather.cloud) > 0.002 || Math.abs(weather.tRain - weather.rain) > 0.002;
      if (weatherBusy) {
        const k = 1 - Math.exp(-dt * 0.9);
        weather.cloud += (weather.tCloud - weather.cloud) * k;
        weather.rain += (weather.tRain - weather.rain) * k;
        if (Math.abs(weather.tCloud - weather.cloud) <= 0.002) weather.cloud = weather.tCloud;
        if (Math.abs(weather.tRain - weather.rain) <= 0.002) weather.rain = weather.tRain;
        applyMood();
        applySky();
        if (skyFx) skyFx.setLook(look, weather.cloud);
        rainFx.setRain(weather.rain);
      }
      rainFx.update(dt);
    }
    const props = new Map();   // id -> { object, obstacle, ownGeometry }
    const yardListeners = new Set();
    let yardAnim = null;       // { age, from, barnFrom, barnTo }
    const propMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient });
    const instMaterial = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient });
    undo.push(() => { propMaterial.dispose(); instMaterial.dispose(); });

    function syncObstacles() {
      obstacles.length = 0;
      for (const o of env.obstacles) obstacles.push({ ...o });
      for (const pr of props.values()) if (pr.obstacle) obstacles.push(pr.obstacle);
    }

    function removeProp(id) {
      const pr = props.get(id);
      if (!pr) return false;
      scene.remove(pr.object);
      if (pr.ownGeometry && pr.object.geometry) pr.object.geometry.dispose();
      if (pr.object.dispose && pr.object.isInstancedMesh) pr.object.dispose();
      props.delete(id);
      syncObstacles();
      return true;
    }

    function addProp(id, object, opts = {}) {
      if (!id || !object) throw new Error('addProp(id, object3d, opts)');
      removeProp(id);
      object.traverse(o => { o.userData.noPick = true; });
      scene.add(object);
      props.set(id, { object, obstacle: opts.obstacle ? { ...opts.obstacle } : null, ownGeometry: !!opts.ownGeometry });
      syncObstacles();
      return object;
    }

    /** Merges parts into one vertex-coloured toon mesh (1 draw call) and adds it as a prop. */
    function addMergedProp(id, parts, opts = {}) {
      const geo = mergeStaticParts(THREE, parts);
      const mesh = new THREE.Mesh(geo, propMaterial);
      if (opts.position) mesh.position.set(...opts.position);
      return addProp(id, mesh, { ...opts, ownGeometry: true });
    }

    /** One InstancedMesh (1 draw call) for many copies of a geometry. items: [{ position, rotation, scale, color }]. */
    function addInstancedProp(id, geometry, items, opts = {}) {
      const mesh = new THREE.InstancedMesh(geometry, opts.material || instMaterial, Math.max(1, items.length));
      const d = new THREE.Object3D();
      const col = new THREE.Color();
      items.forEach((it, i) => {
        const pz = it.position || [0, 0, 0];
        d.position.set(pz[0], pz[1], pz[2]);
        const r = it.rotation || [0, 0, 0];
        d.rotation.set(r[0], r[1], r[2]);
        const sc = Array.isArray(it.scale) ? it.scale : [it.scale ?? 1, it.scale ?? 1, it.scale ?? 1];
        d.scale.set(sc[0], sc[1], sc[2]);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        if (it.color != null) { col.set(it.color); mesh.setColorAt(i, col); }
      });
      mesh.count = items.length;
      mesh.frustumCulled = false;
      return addProp(id, mesh, { ...opts, ownGeometry: !!opts.ownGeometry });
    }

    // V20 sun shadows (high tier only): one 1024 soft shadow map fitted to the island. Flags are re-synced with the light
    // (~1 s), so actors, accessories and props added later cast too. Transparent / additive meshes (auras, glows) never cast.
    const opaque = m => (Array.isArray(m) ? m.every(opaque) : !!m && !m.transparent && m.blending !== THREE.AdditiveBlending && !m.isMeshBasicMaterial);
    syncShadowFlags = () => {
      const on = sun.castShadow;
      if (on) {
        const c = sun.shadow.camera, r = yardCfg.island + 1.5;
        if (c.right !== r) { c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.updateProjectionMatrix(); }
      }
      if (on === shadowFlagsOn && !on) return;
      shadowFlagsOn = on;
      env.group.traverse(o => { if (o.isMesh) o.receiveShadow = on; });
      env.barn.traverse(o => { if (o.isMesh) { o.castShadow = on; o.receiveShadow = on; } });
      wild.group.traverse(o => { if (o.isMesh) o.receiveShadow = on; });
      for (const pr of props.values()) pr.object.traverse(o => { if (o.isMesh) { const k = on && opaque(o.material); o.castShadow = k; o.receiveShadow = on; } });
      for (const a of actors.values()) a.object.traverse(o => { if (o.isMesh) { o.castShadow = on && opaque(o.material); o.receiveShadow = on; } });
    };
    let shadowFlagsOn = false;
    function setupShadows() {
      const on = tier.name === 'high';
      const was = renderer.shadowMap.enabled;
      renderer.shadowMap.enabled = on;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      sun.castShadow = on;
      if (on) {
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
        sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
      }
      blobMat.opacity = on ? 0.5 : 1;   // a faint blob still grounds the pet under its real shadow
      shadowFlagsOn = !on;              // force a full sync
      syncShadowFlags();
      if (was && !on && sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }   // three recompiles programs itself (lights hash)
    }

    function setYardTier(tierOrCapacity, { animate = true } = {}) {
      const next = yardTierConfig(tierOrCapacity);
      if (next.name === yardCfg.name) return next.name;
      const old = yardCfg;
      yardCfg = next;
      scene.remove(env.group, env.barn);
      env.dispose();
      env = buildEnvironment(tier, toonGradient, next, wind);
      scene.add(env.group, env.barn);
      syncObstacles();
      rainFx.setArea(next.walk, obstacles);
      skyFx.setArea(next.walk);
      shadowFlagsOn = !sun.castShadow;   // the new lawn / barn meshes need their flags
      syncShadowFlags();
      decorSpots = decorSpotsForTier(next.name);
      wild.setClearance(wildClearance(next.name), animate);
      const keep = clampPan(panT.x, panT.z, next.island);
      panT.x = keep.x; panT.z = keep.z;
      if (animate) {
        const from = Math.min(1, old.fence / next.fence);
        yardAnim = { age: 0, from, barnFrom: old.barnZ, barnTo: next.barnZ };
        env.group.scale.set(from, 1, from);
        env.barn.position.z = yardAnim.barnFrom - next.barnZ; // barn child sits at next.barnZ; shift back to the old spot
        boostUntil = Math.max(boostUntil, performance.now() + YARD_GROW_MS + 300);
      } else {
        yardAnim = null;
      }
      for (const fn of [...yardListeners]) { try { fn(yardInfo()); } catch (e) { console.error(e); } }
      return next.name;
    }

    const yardInfo = () => ({
      tier: yardCfg.name, walkRadius: yardCfg.walk, fenceRadius: yardCfg.fence, islandRadius: yardCfg.island,
      wildClearance: wild.clearance, decorSpots: decorSpots.length,
    });

    function updateYardAnim(dt) {
      if (!yardAnim) return;
      yardAnim.age += dt * 1000;
      const u = yardAnim.age / YARD_GROW_MS;
      const k = yardGrowScale(yardAnim.from, u);
      env.group.scale.set(k, 1, k);
      env.barn.position.z = (yardAnim.barnFrom - yardAnim.barnTo) * (1 - Math.min(1, u) * Math.min(1, u) * (3 - 2 * Math.min(1, u)));
      if (u >= 1) { env.group.scale.set(1, 1, 1); env.barn.position.z = 0; yardAnim = null; }
    }

    // ---- actors
    const actors = new Map(); // id -> actor record
    const objectToActor = new Map();

    function removeActor(id) {
      const actor = actors.get(id);
      if (!actor) return false;
      for (const q of pointers.values()) if (q.stroke && q.stroke.id === id) { endStroke(q, q.x, q.y); q.ignore = true; } // the stroke ends with its pet
      scene.remove(actor.object);
      actors.delete(id);
      objectToActor.delete(actor.object);
      return true;
    }

    function addActor(id, object, opts = {}) {
      if (!id || !object) throw new Error('addActor(id, object3d, opts)');
      if (actors.has(id)) removeActor(id);
      const radius = opts.radius > 0 ? opts.radius : 0.5;
      const height = opts.height > 0 ? opts.height : radius * 2;
      const actor = { id, object, radius, height, shadow: opts.shadow !== false, shadowScale: opts.shadowScale || 1, stroke: opts.stroke === false ? false : (opts.stroke || {}) };
      scene.add(object);
      actors.set(id, actor);
      objectToActor.set(object, actor);
      return actor;
    }

    const getActor = id => actors.get(id) || null;

    function updateBlobs() {
      let n = 0;
      for (const a of actors.values()) {
        if (!a.shadow || !a.object.visible || n >= MAX_SHADOWS) continue;
        const p = a.object.position;
        const lift = 1 / (1 + Math.max(0, p.y) * 0.8);
        const sz = a.radius * 2.4 * a.shadowScale * lift;
        blobDummy.position.set(p.x, 0.02, p.z);
        blobDummy.scale.set(sz, 1, sz);
        blobDummy.updateMatrix();
        blobMesh.setMatrixAt(n++, blobDummy.matrix);
      }
      blobMesh.count = n;
      blobMesh.instanceMatrix.needsUpdate = true;
    }

    // ---- camera state (current values ease toward targets)
    const target = { x: 0, y: 0.4, z: 0 };
    const pan = { x: 0, z: 0 };   // current camera target offset on the ground (eases toward panT)
    const panT = { x: 0, z: 0 };
    const view = {
      yaw: 0, yawT: 0, pitch: PITCH_DEFAULT, pitchT: PITCH_DEFAULT, zoom: ZOOM_DEFAULT, zoomT: ZOOM_DEFAULT,
    };
    let width = 0;
    let height = 0;
    let baseDist = 12;
    let baseDistT = 12;
    // V18 close-up (the play mode): a free camera pose outside the orbit limits, blended in and out by k (eased toward kT)
    const close = { k: 0, kT: 0, pos: { x: 0, y: 2, z: 4 }, look: { x: 0, y: 0.5, z: 0 } };

    function updateCamera() {
      target.x = pan.x; target.z = pan.z;
      const p = orbitPosition(view.yaw, view.pitch, baseDist * view.zoom, target);
      if (close.k > 0.0005) {
        const s = close.k * close.k * (3 - 2 * close.k);
        const L = (a, b) => a + (b - a) * s;
        camera.position.set(L(p.x, close.pos.x), L(p.y, close.pos.y), L(p.z, close.pos.z));
        camera.lookAt(L(target.x, close.look.x), L(target.y, close.look.y), L(target.z, close.look.z));
      } else {
        camera.position.set(p.x, p.y, p.z);
        camera.lookAt(target.x, target.y, target.z);
      }
      camera.position.x += shakeOffset.x; camera.position.y += shakeOffset.y; camera.position.z += shakeOffset.z;
      // V20 haze starts just behind the yard however far back the camera sits (portrait phones / zoomed out), less in the close-up
      const ck = close.k > 0.0005 ? close.k * close.k * (3 - 2 * close.k) : 0;
      const camDist = baseDist * view.zoom * (1 - ck) + 3 * ck;
      // V22 close-up: the haze starts just behind the pet, so the background goes soft and the pet stands out
      const closeNear = Math.max(5, close.fogNear || 0);   // just behind the played pet (big pets: the camera stands further back)
      scene.fog.near = (camDist + FOG_NEAR - 15) * (1 - ck) + closeNear * ck;
      scene.fog.far = scene.fog.near + (FOG_FAR - FOG_NEAR) * (1 - ck) + 22 * ck;
    }

    function resize() {
      const w = Math.max(1, Math.floor(hostEl.clientWidth));
      const h = Math.max(1, Math.floor(hostEl.clientHeight));
      width = w; height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      baseDistT = fixedCameraDistance(camera.aspect); // the same for every yard tier
      baseDist = baseDistT;
      camera.updateProjectionMatrix();
      updateCamera();
      lastRenderTs = -Infinity; // draw the resized frame right away
    }

    // ---- loop state
    let active = true;
    let hostVisible = true;
    let contextLost = false;
    let disposed = false;
    let rafId = 0;
    let lastRenderTs = -Infinity;
    let lastFrameTs = 0;
    let runTime = 0;
    let boostUntil = 0;
    const frameFns = new Set();
    const disposeFns = new Set();
    const intervalSamples = { sum: 0, n: 0 };
    const fpsCount = { frames: 0, since: 0, fps: 0 };

    const shouldRun = () => !disposed && active && !document.hidden && hostVisible && !contextLost;

    function applyRunState() {
      if (shouldRun()) {
        if (!rafId) {
          lastFrameTs = performance.now();
          rafId = requestAnimationFrame(frame);
        }
      } else if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    const pointers = new Map();
    let gestureMulti = false;
    let pinch = null;

    function isEasing() {
      return Math.abs(view.yaw - view.yawT) > 0.0005 || Math.abs(view.pitch - view.pitchT) > 0.0005 ||
        Math.abs(view.zoom - view.zoomT) > 0.0005 || Math.abs(baseDist - baseDistT) > 0.005 || !!yardAnim || wild.animating ||
        Math.abs(pan.x - panT.x) > 0.001 || Math.abs(pan.z - panT.z) > 0.001 || weatherBusy || Math.abs(close.k - close.kT) > 0.001;
    }

    function downgrade() {
      intervalSamples.sum = 0; intervalSamples.n = 0;
      const next = nextTierDown(tier.name);
      if (!next || pref === 'low') return;
      tier = tierWithRatio(next, window.devicePixelRatio || 1);
      setupShadows();   // V20: sun shadows are high-tier only
      renderer.setPixelRatio(tier.pixelRatio);
      renderer.setSize(width, height, false);
    }

    function frame(ts) {
      rafId = 0;
      if (!shouldRun()) return;
      rafId = requestAnimationFrame(frame);
      const interactive = pointers.size > 0 || isEasing() || ts < boostUntil;
      if (!shouldRenderFrame(ts, lastRenderTs, interactive, IDLE_FPS)) return;

      const dt = Math.min(MAX_DT, Math.max(0, (ts - lastFrameTs) / 1000));
      const interval = ts - lastRenderTs;
      lastFrameTs = ts;
      lastRenderTs = ts;
      runTime += dt;

      if (!interactive && interval < 250) {
        intervalSamples.sum += interval;
        intervalSamples.n += 1;
        if (intervalSamples.n >= 90) {
          if (shouldDowngrade(intervalSamples.sum / intervalSamples.n, IDLE_FPS, intervalSamples.n)) downgrade();
          intervalSamples.sum = 0; intervalSamples.n = 0;
        }
      }

      // ease the camera
      const k = 1 - Math.exp(-dt * 14);
      view.yaw += (view.yawT - view.yaw) * k;
      view.pitch += (view.pitchT - view.pitch) * k;
      view.zoom += (view.zoomT - view.zoom) * k;
      baseDist += (baseDistT - baseDist) * k;
      pan.x += (panT.x - pan.x) * k; pan.z += (panT.z - pan.z) * k;
      close.k += (close.kT - close.k) * (1 - Math.exp(-dt * 3.2));
      if (Math.abs(close.k - close.kT) <= 0.001) close.k = close.kT;
      if (!isEasing()) { view.yaw = view.yawT; view.pitch = view.pitchT; view.zoom = view.zoomT; baseDist = baseDistT; pan.x = panT.x; pan.z = panT.z; }
      updateYardAnim(dt);
      wild.update(dt);
      updateWeather(dt);
      lookAge += dt;
      if (lookAge >= 1) refreshLook();
      skyFx.update(dt, runTime);
      if (wind) wind.t.value = runTime;
      updateCamera();

      for (const fn of [...frameFns]) {
        try { fn(dt, runTime); } catch (e) {
          if (!fn.__failed) { fn.__failed = true; console.error('world.onFrame callback failed', e); }
        }
      }
      // A callback may have disposed the world (e.g. a scene's fatal fallback); stop before touching the renderer.
      if (disposed) return;
      updateBlobs();
      renderer.render(scene, camera);

      fpsCount.frames++;
      if (ts - fpsCount.since >= 1000) {
        fpsCount.fps = Math.round((fpsCount.frames * 1000) / (ts - fpsCount.since));
        fpsCount.frames = 0; fpsCount.since = ts;
      }
    }

    // ---- photo: one frame at an arbitrary size (CONTRACT_V9 §2)
    function snapshot({ width: sw = 960, height: sh = 540, hideUi = true, type = 'image/jpeg', quality = 0.88 } = {}) {
      return new Promise((resolve, reject) => {
        if (disposed || contextLost) { reject(new Error('world unavailable')); return; }
        const W = Math.min(2048, Math.max(16, Math.round(Number(sw) || 960)));
        const H = Math.min(2048, Math.max(16, Math.round(Number(sh) || 540)));
        const hiddenObjs = [];
        const prevBase = baseDist;
        const prevAspect = camera.aspect;
        const wasHost = hostEl.classList.contains('world3d-snapshot');
        try {
          if (hideUi) {
            hostEl.classList.add('world3d-snapshot'); // lets CSS hide DOM overlays (labels, bubbles) if a frame is ever composited
            scene.traverse(o => { if (o.visible && (o.userData.ui === true || (o.name && o.name.startsWith('ui-')))) { o.visible = false; hiddenObjs.push(o); } });
          }
          renderer.setPixelRatio(1);
          renderer.setSize(W, H, false);
          camera.aspect = W / H;
          baseDist = fixedCameraDistance(camera.aspect);
          camera.updateProjectionMatrix();
          updateCamera();
          updateBlobs();
          renderer.render(scene, camera);
          // the canvas is transparent (the sky is CSS behind it), so paint sky + dim + scene onto a 2D canvas
          const out = document.createElement('canvas');
          out.width = W; out.height = H;
          const ctx = out.getContext('2d');
          const cs = getComputedStyle(hostEl);
          const grad = ctx.createLinearGradient(0, 0, 0, H);
          grad.addColorStop(0, cs.getPropertyValue('--world-sky-top').trim() || '#bfe6ff');
          grad.addColorStop(1, cs.getPropertyValue('--world-sky-bottom').trim() || '#e9f7d8');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
          const dim = parseFloat(cs.getPropertyValue('--world-dim')) || 0;
          if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); }
          ctx.drawImage(canvas, 0, 0, W, H);
          resolve(out.toDataURL(type, quality));
        } catch (e) {
          reject(e);
        } finally {
          for (const o of hiddenObjs) o.visible = true;
          if (!wasHost) hostEl.classList.remove('world3d-snapshot');
          renderer.setPixelRatio(tier.pixelRatio);
          renderer.setSize(width, height, false);
          camera.aspect = prevAspect;
          baseDist = prevBase;
          camera.updateProjectionMatrix();
          updateCamera();
          lastRenderTs = -Infinity; // redraw the live frame at the real size
        }
      });
    }

    // ---- picking
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const tmp = new THREE.Vector3();

    function setRay(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      return { x, y, rect };
    }

    function groundPoint() {
      const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
      if (!hit) return null;
      return Math.hypot(hit.x, hit.z) <= yardCfg.island ? hit : null;
    }

    function pick(clientX, clientY) {
      const { x, y, rect } = setRay(clientX, clientY);
      const point = groundPoint();
      const visibleActors = [...actors.values()].filter(a => a.object.visible);

      // 1) precise raycast against the actors' meshes
      const hits = raycaster.intersectObjects(visibleActors.map(a => a.object), true);
      for (const h of hits) {
        if (h.object.userData.noPick) continue;
        let o = h.object;
        while (o && !objectToActor.has(o)) o = o.parent;
        if (o) return { id: objectToActor.get(o).id, point };
      }

      // 2) generous screen-space radius (>= 44 px) so tiny / moving pets are easy to hit
      const camPos = camera.position;
      const candidates = [];
      for (const a of visibleActors) {
        tmp.copy(a.object.position);
        tmp.y += a.height / 2;
        const dist = tmp.distanceTo(camPos);
        tmp.project(camera);
        if (tmp.z < -1 || tmp.z > 1) continue;
        candidates.push({
          id: a.id,
          sx: ((tmp.x + 1) / 2) * rect.width,
          sy: ((1 - tmp.y) / 2) * rect.height,
          r: effectivePickRadiusPx(a.radius, dist, CAMERA_FOV, rect.height),
          depth: dist,
        });
      }
      return { id: pickNearest(candidates, x, y), point };
    }

    function worldToScreen(vec) {
      camera.updateMatrixWorld();
      const v = tmp.copy(vec).project(camera);
      return {
        x: ((v.x + 1) / 2) * width,
        y: ((1 - v.y) / 2) * height,
        visible: v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05,
      };
    }

    // ---- input
    const onContextMenu = e => e.preventDefault();
    canvas.addEventListener('contextmenu', onContextMenu);

    const strokeFns = new Set();
    const strokeDir = new THREE.Vector3();

    /** World point under the finger on an actor: the mesh hit, else the screen ray against a plane through the pet's middle. */
    function strokePoint(actor, clientX, clientY) {
      setRay(clientX, clientY);
      for (const h of raycaster.intersectObject(actor.object, true)) if (!h.object.userData.noPick) return h.point.clone();
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(actor.object.position.y + actor.height * 0.5));
      return raycaster.ray.intersectPlane(plane, new THREE.Vector3()) || actor.object.position.clone();
    }

    function emitStroke(p, phase, clientX, clientY, now_) {
      const actor = actors.get(p.stroke.id);
      if (actor) { p.stroke.point = strokePoint(actor, clientX, clientY); p.stroke.actor = actor; }
      const a = p.stroke.actor;
      const pos = a.object.position;
      const yaw = a.object.rotation.y;
      strokeDir.set(p.stroke.point.x - pos.x, p.stroke.point.y - pos.y, p.stroke.point.z - pos.z);
      const dz = strokeDir.x * Math.sin(yaw) + strokeDir.z * Math.cos(yaw);
      const dims = { height: a.height, radius: a.radius, ...(a.stroke || {}) };
      const evt = {
        id: p.stroke.id, phase, point: p.stroke.point, region: strokeRegion(strokeDir.y, dz, dims),
        speed: p.stroke.speed, durationMs: Math.max(0, now_ - p.stroke.t0), x: clientX, y: clientY,
      };
      for (const fn of [...strokeFns]) { try { fn(evt); } catch (err) { console.error('onPetStroke handler failed', err); } }
    }

    let lastGroundTap = null; // { x, y, t } of the previous tap that hit no actor (double tap = re-centre)

    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      if (pointers.size === 0) gestureMulti = false;
      // mouse: right button (or shift / ctrl + left) orbits; everything else (touch, pen, plain left button) pans
      const orbit = e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey || e.ctrlKey);
      pointers.set(e.pointerId, {
        x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
        startT: performance.now(), moved: false, type: e.pointerType, orbit, button: e.button,
      });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* capture not available */ }
      if (pointers.size === 1 && !orbit && strokeFns.size) { // might become a stroke if it moves
        const hit = pick(e.clientX, e.clientY);
        const a = hit.id ? actors.get(hit.id) : null;
        if (a && a.stroke !== false) pointers.get(e.pointerId).strokeId = hit.id;
      }
      if (pointers.size === 2) {
        for (const q of pointers.values()) if (q.stroke) endStroke(q, q.x, q.y); // a 2nd finger turns it into pinch / twist
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom: view.zoomT, ang: Math.atan2(b.y - a.y, b.x - a.x), yaw: view.yawT };
        gestureMulti = true;
      }
      boostUntil = Math.max(boostUntil, performance.now() + 250);
    }

    function endStroke(p, x, y) {
      if (!p.stroke) return;
      emitStroke(p, 'end', x, y, performance.now());
      p.stroke = null;
      p.strokeId = null;
    }

    function onPointerMove(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const prevX = p.x, prevY = p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (p.ignore) return;
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        view.zoomT = clampZoom(pinch.zoom * (pinch.dist / d));
        if (pinch.ang != null) { // twist with two fingers = rotate the view
          let da = Math.atan2(b.y - a.y, b.x - a.x) - pinch.ang;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          view.yawT = pinch.yaw - da;
        }
        return;
      }
      if (!p.moved && Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_MAX_MOVE_PX) p.moved = true;
      if (!p.moved) return;
      // from the moment the 8 px threshold is crossed the view follows the finger (including the first 8 px)
      const mx = p.x - p.lastX, my = p.y - p.lastY;
      p.lastX = p.x; p.lastY = p.y;
      if (p.strokeId && !p.orbit) {
        const t = performance.now();
        if (!p.stroke) {
          if (!actors.has(p.strokeId)) { p.strokeId = null; } else {
            p.stroke = { id: p.strokeId, t0: t, tLast: t, speed: 0, point: null, actor: null };
            emitStroke(p, 'start', p.x, p.y, t);
            return;
          }
        } else {
          const dt = Math.max(8, t - p.stroke.tLast);
          p.stroke.speed = p.stroke.speed * 0.7 + (Math.hypot(p.x - prevX, p.y - prevY) / dt * 1000) * 0.3;
          p.stroke.tLast = t;
          emitStroke(p, 'move', p.x, p.y, t);
          return;
        }
      }
      if (p.orbit) {
        view.yawT -= mx * YAW_PER_PX;
        view.pitchT = clampPitch(view.pitchT + my * PITCH_PER_PX);
      } else {
        const d = panDelta(mx, my, view.yawT, view.pitchT, baseDist * view.zoomT, CAMERA_FOV, Math.max(1, height));
        const c = clampPan(panT.x + d.x, panT.z + d.z, yardCfg.island);
        panT.x = c.x; panT.z = c.z;
      }
    }

    function onPointerUp(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      boostUntil = Math.max(boostUntil, performance.now() + 250);
      if (p.ignore) return;
      if (p.stroke) { p.stroke.speed *= 0.5; endStroke(p, e.clientX, e.clientY); return; }
      if (e.type === 'pointercancel' || gestureMulti) return;
      if (p.button === 2) return; // right button only orbits
      const endT = performance.now();
      const kind = classifyPointer({ x: p.startX, y: p.startY, t: p.startT }, { x: e.clientX, y: e.clientY, t: endT });
      if (kind !== 'tap') return;
      const hit = pick(e.clientX, e.clientY);
      try {
        if (hit.id) {
          lastGroundTap = null;
          if (onTap) onTap(hit.id, { point: hit.point });
        } else {
          const tap = { x: e.clientX, y: e.clientY, t: endT };
          if (isDoubleTap(lastGroundTap, tap)) { lastGroundTap = null; recenter(); }
          else {
            lastGroundTap = tap;
            if (hit.point && onTapGround) onTapGround(hit.point);
          }
        }
      } catch (err) {
        console.error('world tap handler failed', err);
      }
    }

    function recenter() {
      panT.x = 0; panT.z = 0;
      boostUntil = Math.max(boostUntil, performance.now() + 600);
    }

    function onWheel(e) {
      if (options.wheelZoom === false) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      view.zoomT = clampZoom(view.zoomT * Math.exp(e.deltaY * unit * 0.0015));
      boostUntil = Math.max(boostUntil, performance.now() + 250);
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // ---- lifecycle wiring
    const onVisibility = () => applyRunState();
    document.addEventListener('visibilitychange', onVisibility);
    undo.push(() => document.removeEventListener('visibilitychange', onVisibility));
    const onContextLost = e => { e.preventDefault(); contextLost = true; applyRunState(); };
    const onContextRestored = () => { contextLost = false; lastRenderTs = -Infinity; applyRunState(); };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(hostEl);
    } else {
      window.addEventListener('resize', resize);
    }
    let intersectionObserver = null;
    if (typeof IntersectionObserver === 'function') {
      intersectionObserver = new IntersectionObserver(entries => {
        const last = entries[entries.length - 1];
        hostVisible = !!last && last.isIntersecting;
        applyRunState();
      });
      intersectionObserver.observe(hostEl);
    }

    undo.push(() => {
      window.removeEventListener('resize', resize);
      if (resizeObserver) resizeObserver.disconnect();
      if (intersectionObserver) intersectionObserver.disconnect();
    });
    if (options.__failForTest) throw new Error('forced failure (test)');
    setupShadows();
    resize();
    applyRunState();

    return {
      THREE, scene, camera, renderer, canvas, toonGradient,
      get islandRadius() { return yardCfg.island; },
      get walkRadius() { return yardCfg.walk; },
      get fenceRadius() { return yardCfg.fence; },
      /** Yard tier name 'S' | 'M' | 'L' | 'XL' (not the same as `tier`, which is graphics quality). */
      get yardTier() { return yardCfg.name; },
      /** Decor spots of the current tier: [{ index, x, z }] (2 / 4 / 6 / 8). Replaced (new array) when the tier changes. */
      get decorSpots() { return decorSpots; },
      /** Wilderness state: { clearance, items, visible, animating, meshes } (meshes = draw calls it costs). */
      wildInfo: () => wild.info(),
      /** The wilderness group (meadow + instanced props + stream), e.g. to hide it in a screenshot. */
      wildGroup: wild.group,
      /**
       * Weather (CONTRACT_V9 §4): kind 'sunny' | 'cloudy' | 'rain', intensity 0..1 (rain amount / cloud density). Eased over ~2.5 s.
       * Rain = ONE instanced streak mesh + ONE instanced puddle mesh (<= 2 draw calls, 0 when dry); lights and the CSS sky go greyer.
       */
      setWeather(kind = 'sunny', intensity = 1) {
        const k = kind === 'rain' || kind === 'cloudy' ? kind : 'sunny';
        const t = weatherTargets(k, intensity);
        weather.kind = k; weather.intensity = Math.min(1, Math.max(0, Number(intensity) || 0));
        weather.tCloud = t.cloud; weather.tRain = t.rain;
        weatherBusy = true;
        boostUntil = Math.max(boostUntil, performance.now() + 400);
      },
      getWeather: () => ({ kind: weather.kind, intensity: weather.intensity }),
      /** Weather as drawn right now: { kind, intensity, cloud, rain (0..1 eased), drops, puddles, meshes (draw calls spent) }. */
      weatherInfo: () => ({ kind: weather.kind, intensity: weather.intensity, cloud: weather.cloud, ...rainFx.info() }),
      /** Puddle decals of the yard: [{ x, z, r }]. Always the same places for a tier; they are only visible while raining (weatherInfo().puddles > 0). */
      get puddles() { return rainFx.puddles(); },
      /**
       * One frame at width x height (default 960 x 540, max 2048) as a dataURL (JPEG by default), using the current camera, sky and
       * weather. hideUi hides scene helpers named 'ui-*' / userData.ui and tags the host with .world3d-snapshot; DOM overlays are
       * never part of the canvas anyway. The live size / aspect / pixel ratio are restored. Rejects if the world is gone.
       */
      snapshot,
      /** Walkable obstacles [{x,z,r}] (barn + props with an obstacle). The array is updated in place on tier changes. */
      obstacles,
      /** Switch yard size by tier name or barnCapacity. Rebuilds ground/fence/flowers; { animate:true } grows the fence ring. Returns the tier. */
      setYardTier,
      onYardChange(fn) { yardListeners.add(fn); return () => yardListeners.delete(fn); },
      yardInfo,
      /** Pet strokes (CONTRACT_V8 §1): fn({ id, phase:'start'|'move'|'end', point, region:'head'|'chin'|'back', speed, durationMs, x, y }). Returns unsubscribe. */
      onPetStroke(fn) { strokeFns.add(fn); return () => strokeFns.delete(fn); },
      /** Static props: addProp(id, object3d, {obstacle}), addMergedProp(id, parts, opts), addInstancedProp(id, geometry, items, opts). */
      addProp, addMergedProp, addInstancedProp, removeProp,
      hasProp: id => props.has(id),
      clearProps(prefix = '') { for (const id of [...props.keys()]) if (id.startsWith(prefix)) removeProp(id); },
      /** Current quality tier: 'high' | 'medium' | 'low' (can drop at runtime). Scenes may choose cheaper content at 'low'. */
      get tier() { return tier.name; },
      addActor, removeActor, getActor,
      /** Calls fn(dt, t) before every rendered frame. Returns an unsubscribe function. */
      onFrame(fn) {
        frameFns.add(fn);
        return () => frameFns.delete(fn);
      },
      /** Runs fn() once when the world is disposed (fx.js uses this to free its own resources). */
      onDispose(fn) {
        disposeFns.add(fn);
        return () => disposeFns.delete(fn);
      },
      setActive(on) {
        active = !!on;
        if (active) lastRenderTs = -Infinity;
        applyRunState();
      },
      isActive: () => shouldRun(),
      /** Render at full rate (no 30 fps cap) for `ms` milliseconds, e.g. during a hatch ceremony. */
      boost(ms = 1000) { boostUntil = Math.max(boostUntil, performance.now() + ms); },
      /** Camera presets: { yaw, pitch, zoom, pan:{x,z} } (radians / 0.4..1.5 / ground units). Eased. */
      setView(v = {}) {
        if (v.yaw != null) view.yawT = v.yaw;
        if (v.pitch != null) view.pitchT = clampPitch(v.pitch);
        if (v.zoom != null) view.zoomT = clampZoom(v.zoom);
        if (v.pan) { const c = clampPan(Number(v.pan.x) || 0, Number(v.pan.z) || 0, yardCfg.island); panT.x = c.x; panT.z = c.z; }
      },
      getView: () => ({ yaw: view.yawT, pitch: view.pitchT, zoom: view.zoomT, pan: { x: panT.x, z: panT.z } }),
      /** V18 close-up: fly the camera to `pos` looking at `look` (world units; call every frame to follow a moving pet). */
      setCloseUp({ pos, look, fogNear } = {}) {
        if (pos) Object.assign(close.pos, pos);
        if (look) Object.assign(close.look, look);
        close.fogNear = Number.isFinite(fogNear) ? fogNear : 0;   // V22: where the close-up haze may start (0 = default)
        close.kT = 1;
      },
      /** V18: back to the normal orbit camera (eased). */
      clearCloseUp() { close.kT = 0; },
      /** 0 = normal camera .. 1 = fully in the close-up. */
      closeUpAmount: () => close.k,
      /** Camera target offset on the ground, clamped to the current island radius (eased). */
      setPan(x = 0, z = 0) { const c = clampPan(Number(x) || 0, Number(z) || 0, yardCfg.island); panT.x = c.x; panT.z = c.z; },
      getPan: () => ({ x: panT.x, z: panT.z }),
      /** Back to the middle of the yard (what a double tap on empty ground does). */
      recenter,
      /** Scene dimming for ceremonies: k 0 (normal) .. 1 (very dark). Dims both lights and the CSS sky behind the canvas. */
      setDim(k) {
        const d = Math.min(1, Math.max(0, Number(k) || 0));
        lightScale = 1 - 0.75 * d;
        applyMood();
        hostEl.style.setProperty('--world-dim', String(d * 0.6));
      },
      /** Camera jitter in world units (fx.shake drives this; 0,0,0 restores). */
      setShakeOffset(x = 0, y = 0, z = 0) { shakeOffset.x = x; shakeOffset.y = y; shakeOffset.z = z; },
      /** Lights, for fx that need to tint the scene. */
      lights: { hemi, sun },
      /** V20: 'clock' (lights follow the local time, default) or 'theme' (day, or a soft night with a dark device theme). */
      setTimeMode(mode) { timeMode = mode === 'theme' ? 'theme' : 'clock'; weather.skyKey = ''; refreshLook(); lastRenderTs = -Infinity; },
      /** V20: show a fixed hour (0..24, previews / debug); null = back to the mode. */
      setHour(h) { hourOverride = h == null || !Number.isFinite(Number(h)) ? null : Number(h); weather.skyKey = ''; refreshLook(); lastRenderTs = -Infinity; },
      /** V20: { mode, hour (null in theme mode), night 0..1, warm 0..1, sky: skyFx info, shadows } as drawn now. */
      daylight: () => ({ mode: timeMode, hour: hourOverride != null ? hourOverride : timeMode === 'theme' ? null : hourOf(new Date()), night: look.night, warm: look.warm,
        sky: skyFx.info(), shadows: !!sun.castShadow }),
      /** V20: lanterns / fireflies time (same rule everywhere): the fixed hour, the theme, or the clock. */
      isNight: () => (hourOverride != null ? isNightHour(hourOverride) : timeMode === 'theme' ? !!(darkMq && darkMq.matches) : isNightHour(hourOf(new Date()))),
      pick, worldToScreen,
      getStats() {
        return {
          tier: tier.name, pixelRatio: tier.pixelRatio, fps: fpsCount.fps, actors: actors.size,
          triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls, running: !!rafId, width, height,
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        applyRunState();
        for (const fn of [...disposeFns]) { try { fn(); } catch (e) { console.error(e); } }
        disposeFns.clear();
        frameFns.clear();
        document.removeEventListener('visibilitychange', onVisibility);
        if (darkMq && darkMq.removeEventListener) darkMq.removeEventListener('change', onScheme);
        window.removeEventListener('resize', resize);
        if (resizeObserver) resizeObserver.disconnect();
        if (intersectionObserver) intersectionObserver.disconnect();
        canvas.removeEventListener('contextmenu', onContextMenu);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
        // actors are only detached: their geometry / materials belong to whoever created them
        for (const id of [...actors.keys()]) removeActor(id);
        for (const id of [...props.keys()]) removeProp(id);
        propMaterial.dispose(); instMaterial.dispose();
        env.dispose();
        wild.dispose();
        rainFx.dispose();
        scene.remove(blobMesh); blobMesh.dispose(); blobGeo.dispose(); blobMat.dispose(); blobTexture.dispose(); toonGradient.dispose();
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch { /* already lost */ }
        canvas.remove();
        hostEl.classList.remove('world3d-host');
      },
    };
  } catch (e) {
    for (const u of undo.reverse()) { try { u(); } catch { /* best effort */ } }
    throw e;
  }
}

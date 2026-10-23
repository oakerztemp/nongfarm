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
// Coordinates: y up, ground disc centred at (0,0,0) (island radius world.islandRadius = 7). Pets should stay within
// world.walkRadius (5.6) and outside world.obstacles ([{ x, z, r }] circles, e.g. the barn prop). The barn prop is at
// the back (-z) with its door facing +z; the default camera looks from +z. Actors' positions are never saved.
//
// Interaction: horizontal drag orbits (yaw); with a mouse, vertical drag tilts within clamped pitch. Touch keeps
// `touch-action: pan-y`, so a vertical swipe scrolls the page instead. Pinch / wheel zoom is clamped. A press that
// moves < 8 px and lasts < 500 ms is a tap. Taps pick actors by raycast first, then by screen proximity with a
// minimum 44 px radius, so small pets are easy to hit (set `userData.noPick = true` on a mesh to exclude it).
//
// Rendering: toon (MeshToonMaterial) look - use world.toonGradient as `gradientMap` for visual consistency. Lights:
// hemisphere + directional, NO shadow maps; actors get a blob shadow (pass { shadow:false } to skip). 30 fps cap while
// nothing is interacting; call world.boost(ms) for full rate during a special animation (e.g. hatch ceremony).
// world.worldToScreen(vec3) -> { x, y, visible } in CSS px relative to the host, for DOM overlays.
// world.pick(clientX, clientY) -> { id, point } uses the same picking as taps. world.getStats() -> debug numbers.
// Effects (hearts, bubbles, flying food, sparkles): see fx.js.
// ===================================================================================================

import * as THREE from '../../vendor/three.module.min.js';
import { getQualityPref } from '../prefs.js';

// ---------------------------------------------------------------- constants

export const TAP_MAX_MOVE_PX = 8;
export const TAP_MAX_MS = 500;
export const MIN_PICK_RADIUS_PX = 44;
export const IDLE_FPS = 30;
export const PITCH_MIN = 0.55;
export const PITCH_MAX = 1.15;
export const PITCH_DEFAULT = 0.9;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.15;
export const ZOOM_DEFAULT = 0.85;
export const CAMERA_FOV = 38;
export const ISLAND_RADIUS = 7;
export const FENCE_RADIUS = 6.3;
export const WALK_RADIUS = 5.6;
const BARN_Z = -4.9;
const MAX_DT = 0.1;
const MAX_SHADOWS = 128; // actors beyond this simply have no blob shadow
const YAW_PER_PX = 0.008;
const PITCH_PER_PX = 0.005;

export const QUALITY_TIERS = {
  high:   { name: 'high',   pixelRatioCap: 1.5,  antialias: true,  posts: 36, tufts: 80, flowers: 24 },
  medium: { name: 'medium', pixelRatioCap: 1.25, antialias: true,  posts: 28, tufts: 50, flowers: 14 },
  low:    { name: 'low',    pixelRatioCap: 1,    antialias: false, posts: 20, tufts: 24, flowers: 8 },
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

/** Builds ground island, fence, grass tufts, flowers and the barn prop. Returns { group, dispose, obstacles }. */
function buildEnvironment(tier, gradient) {
  const group = new THREE.Group();
  group.name = 'environment';
  const disposables = [];
  const own = o => { disposables.push(o); return o; };
  const toon = color => own(new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
  const rand = mulberry32(20261023);

  // island: grass top + dirt rim
  const islandGeo = own(new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS - 0.5, 0.7, 48));
  const island = new THREE.Mesh(islandGeo, [toon(0xe0b084), toon(0x8ccf6a), toon(0x9b6b43)]);
  island.position.y = -0.35;
  island.userData.noPick = true;
  group.add(island);

  // dirt path from the barn door to the middle
  const pathMat = own(new THREE.MeshToonMaterial({
    color: 0xe7cf9c, gradientMap: gradient, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const path = new THREE.Mesh(own(new THREE.PlaneGeometry(1.5, 4.2)), pathMat);
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, BARN_Z + 3.2);
  path.userData.noPick = true;
  group.add(path);

  // fence (gap behind the barn)
  const posts = tier.posts;
  const gapAngle = Math.PI;
  const inGap = a => Math.abs(((a - gapAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5;
  const woodMat = toon(0xc08a54);
  const keep = [];
  for (let i = 0; i < posts; i++) if (!inGap((i / posts) * Math.PI * 2)) keep.push(i);
  const postMesh = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.16, 0.7, 0.16)), woodMat, keep.length);
  const dummy = new THREE.Object3D();
  keep.forEach((i, n) => {
    const a = (i / posts) * Math.PI * 2;
    dummy.position.set(Math.sin(a) * FENCE_RADIUS, 0.35, Math.cos(a) * FENCE_RADIUS);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postMesh.setMatrixAt(n, dummy.matrix);
  });
  postMesh.userData.noPick = true;
  group.add(postMesh);

  const chord = 2 * FENCE_RADIUS * Math.sin(Math.PI / posts);
  const railSegs = keep.filter(i => !inGap(((i + 1) / posts) * Math.PI * 2));
  const railMesh = new THREE.InstancedMesh(own(new THREE.BoxGeometry(1, 0.07, 0.06)), woodMat, railSegs.length * 2);
  let r = 0;
  for (const i of railSegs) {
    const a = ((i + 0.5) / posts) * Math.PI * 2;
    const radius = FENCE_RADIUS * Math.cos(Math.PI / posts);
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
  const tuftMat = toon(0xffffff);
  const tufts = new THREE.InstancedMesh(own(new THREE.ConeGeometry(0.08, 0.3, 4)), tuftMat, tier.tufts);
  const green = new THREE.Color();
  for (let i = 0; i < tier.tufts; i++) {
    const a = rand() * Math.PI * 2;
    const rad = Math.sqrt(rand()) * (FENCE_RADIUS - 0.4);
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
  const flowerMat = toon(0xffffff);
  const flowers = new THREE.InstancedMesh(own(new THREE.SphereGeometry(0.075, 6, 4)), flowerMat, tier.flowers);
  const palette = [0xffd84a, 0xff8fb1, 0xffffff, 0xb9a0ff].map(c => new THREE.Color(c));
  for (let i = 0; i < tier.flowers; i++) {
    const a = rand() * Math.PI * 2;
    const rad = 1.5 + Math.sqrt(rand()) * (FENCE_RADIUS - 2);
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
  barn.position.set(0, 0, BARN_Z);
  barn.traverse(o => { o.userData.noPick = true; });
  group.add(barn);

  return {
    group,
    obstacles: [{ x: 0, z: BARN_Z, r: 2.0 }],
    dispose() {
      for (const o of disposables) o.dispose();
      postMesh.dispose(); railMesh.dispose(); tufts.dispose(); flowers.dispose();
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
  canvas.setAttribute('aria-label', 'ฉากคอก 3 มิติ — ลากเพื่อหมุนมุมมอง แตะน้องเพื่อดูรายละเอียด');
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
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);
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
    scene.add(hemi, sun, blobMesh);
    const darkMq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    let lightScale = 1;            // fx.dimScene tweens this (1 = normal, lower = dimmer scene)
    const shakeOffset = { x: 0, y: 0, z: 0 }; // fx.shake jitters the camera by this much (world units)
    const applyMood = () => {
      const dark = !!(darkMq && darkMq.matches);
      hemi.intensity = (dark ? 1.35 : 1.9) * lightScale;
      sun.intensity = (dark ? 1.3 : 1.9) * lightScale;
    };
    applyMood();
    if (darkMq && darkMq.addEventListener) darkMq.addEventListener('change', applyMood);
    undo.push(() => { if (darkMq && darkMq.removeEventListener) darkMq.removeEventListener('change', applyMood); });

    undo.push(() => { blobGeo.dispose(); blobMat.dispose(); blobTexture.dispose(); toonGradient.dispose(); });
    const env = buildEnvironment(tier, toonGradient);
    undo.push(() => env.dispose());
    scene.add(env.group);

    // ---- actors
    const actors = new Map(); // id -> actor record
    const objectToActor = new Map();

    function removeActor(id) {
      const actor = actors.get(id);
      if (!actor) return false;
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
      const actor = { id, object, radius, height, shadow: opts.shadow !== false, shadowScale: opts.shadowScale || 1 };
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
    const view = {
      yaw: 0, yawT: 0, pitch: PITCH_DEFAULT, pitchT: PITCH_DEFAULT, zoom: ZOOM_DEFAULT, zoomT: ZOOM_DEFAULT,
    };
    let width = 0;
    let height = 0;
    let baseDist = 12;

    function updateCamera() {
      const p = orbitPosition(view.yaw, view.pitch, baseDist * view.zoom, target);
      camera.position.set(p.x, p.y, p.z);
      camera.lookAt(target.x, target.y, target.z);
      camera.position.x += shakeOffset.x; camera.position.y += shakeOffset.y; camera.position.z += shakeOffset.z;
    }

    function resize() {
      const w = Math.max(1, Math.floor(hostEl.clientWidth));
      const h = Math.max(1, Math.floor(hostEl.clientHeight));
      width = w; height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      baseDist = fitDistance(camera.aspect, CAMERA_FOV, PITCH_DEFAULT, ISLAND_RADIUS);
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
        Math.abs(view.zoom - view.zoomT) > 0.0005;
    }

    function downgrade() {
      intervalSamples.sum = 0; intervalSamples.n = 0;
      const next = nextTierDown(tier.name);
      if (!next || pref === 'low') return;
      tier = tierWithRatio(next, window.devicePixelRatio || 1);
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
      if (!isEasing()) { view.yaw = view.yawT; view.pitch = view.pitchT; view.zoom = view.zoomT; }
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
      return Math.hypot(hit.x, hit.z) <= ISLAND_RADIUS ? hit : null;
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

    function onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (pointers.size === 0) gestureMulti = false;
      pointers.set(e.pointerId, {
        x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, startT: performance.now(), moved: false, type: e.pointerType,
      });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* capture not available */ }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom: view.zoomT };
        gestureMulti = true;
      }
      boostUntil = Math.max(boostUntil, performance.now() + 250);
    }

    function onPointerMove(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        view.zoomT = clampZoom(pinch.zoom * (pinch.dist / d));
        return;
      }
      if (!p.moved && Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_MAX_MOVE_PX) p.moved = true;
      if (p.moved) {
        view.yawT -= dx * YAW_PER_PX;
        if (p.type === 'mouse') view.pitchT = clampPitch(view.pitchT + dy * PITCH_PER_PX);
      }
    }

    function onPointerUp(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      boostUntil = Math.max(boostUntil, performance.now() + 250);
      if (e.type === 'pointercancel' || gestureMulti) return;
      const kind = classifyPointer({ x: p.startX, y: p.startY, t: p.startT }, { x: e.clientX, y: e.clientY, t: performance.now() });
      if (kind !== 'tap') return;
      const hit = pick(e.clientX, e.clientY);
      try {
        if (hit.id) { if (onTap) onTap(hit.id, { point: hit.point }); }
        else if (hit.point && onTapGround) onTapGround(hit.point);
      } catch (err) {
        console.error('world tap handler failed', err);
      }
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
    resize();
    applyRunState();

    return {
      THREE, scene, camera, renderer, canvas, toonGradient,
      islandRadius: ISLAND_RADIUS, walkRadius: WALK_RADIUS, obstacles: env.obstacles,
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
      /** Camera presets: { yaw, pitch, zoom } (radians / 0.4..1.15). Eased. */
      setView(v = {}) {
        if (v.yaw != null) view.yawT = v.yaw;
        if (v.pitch != null) view.pitchT = clampPitch(v.pitch);
        if (v.zoom != null) view.zoomT = clampZoom(v.zoom);
      },
      getView: () => ({ yaw: view.yawT, pitch: view.pitchT, zoom: view.zoomT }),
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
        if (darkMq && darkMq.removeEventListener) darkMq.removeEventListener('change', applyMood);
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
        env.dispose();
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

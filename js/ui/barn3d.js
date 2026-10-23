// The 3D living barn (CONTRACT_V4 §3). Mounted by petsView.js inside <div class="b3" data-morph="skip">.
// Everything here is cosmetic: positions / animations are never saved. Game changes only go through pets.js
// actions (via ctx.run, which also shows the usual toasts).
//
//   mountBarn3d(host, ctx) -> { setActive(bool), dispose() }
//
// ctx (from petsView.js): { run, esc, petSheetHtml(pet, state, mode), foodTrayHtml(state, pet, selectedId),
//                           openDetails(petId), openEggPicker(), onFatal(err) }

import { getState, subscribe } from '../state.js';
import { morph, now, notify, formatDuration } from '../util.js';
import { getSpecies } from '../data/species.js';
import { getEgg } from '../data/eggs.js';
import { getItem } from '../data/items.js';
import {
  getPet, petName, patPet, feedPet, playWithPet, cleanPet, giveToy, healPet, toggleSleep, claimGift, pickPoop,
  hatchReady, foodEffect,
} from '../pets.js';
import { nextAction, bubbleFor, clampToYard, hashId, YARD, nestSpot, beginAction, advanceActor, angDiff } from '../petBehaviour.js';
import { createWorld } from '../world3d/engine.js';
import * as fx from '../world3d/fx.js';
import { buildPetModel } from '../world3d/critters.js';

const MAX_NESTS = 6;
const HOLD_AFTER_TAP = 8;    // seconds a patted pet stays put even without the sheet
const SELECT_HOLD = 1e9;     // while the bottom sheet is open
const INITIAL_ZOOM = 0.56;
const TAU = Math.PI * 2;

const ease = {
  outBack(u) { const x = Math.min(1, Math.max(0, u)); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; },
  outCubic(u) { return 1 - (1 - Math.min(1, Math.max(0, u))) ** 3; },
};
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const isBusyStatus = s => s === 'working' || s === 'expedition';

export function mountBarn3d(host, ctx) {
  host.innerHTML =
    '<div class="b3-stage"></div>' +
    '<div class="b3-top"><span class="b3-sign" hidden></span><button type="button" class="b3-egg-btn btn btn-sm" data-b3="put-egg" hidden>🥚 ใส่ไข่</button></div>' +
    '<div class="b3-labels" aria-hidden="true"></div>' +
    '<div class="b3-hint" hidden></div>' +
    '<div class="b3-tray" role="group" aria-label="ถาดอาหาร"></div>' +
    '<div class="b3-sheet" role="dialog" aria-label="ข้อมูลน้อง" hidden></div>';
  const stage = host.querySelector('.b3-stage');
  const signEl = host.querySelector('.b3-sign');
  const eggBtn = host.querySelector('.b3-egg-btn');
  const labelsEl = host.querySelector('.b3-labels');
  const hintEl = host.querySelector('.b3-hint');
  const trayEl = host.querySelector('.b3-tray');
  const sheetEl = host.querySelector('.b3-sheet');

  let world;
  try {
    world = createWorld(stage, { onTap: id => { if (tapFn) tapFn(id); }, onTapGround: () => { if (groundFn) groundFn(); } });
  } catch (err) {
    host.innerHTML = '';
    throw err;
  }
  const THREE = world.THREE;
  const camPos = world.camera.position;
  world.setView({ zoom: INITIAL_ZOOM });
  const owned = [];
  let tapFn = null;
  let groundFn = null;
  try { // from here on a failure must not leak the world
  tapFn = onTap; groundFn = onTapGround;

  // ── shared geometry / materials (disposed with the barn) ─────────────────
  const own = o => { owned.push(o); return o; };
  const matCache = new Map();
  const toon = color => {
    let m = matCache.get(color);
    if (!m) { m = own(new THREE.MeshToonMaterial({ color, gradientMap: world.toonGradient })); matCache.set(color, m); }
    return m;
  };
  const G = {
    bowl: own(new THREE.CylinderGeometry(0.42, 0.3, 0.22, 18)),
    food: own(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 18)),
    nestDish: own(new THREE.CylinderGeometry(0.58, 0.64, 0.1, 18)),
    nestRing: own(new THREE.TorusGeometry(0.52, 0.15, 8, 20)),
    egg: own(new THREE.SphereGeometry(0.3, 16, 12)),
    half: own(new THREE.SphereGeometry(0.3, 14, 8, 0, TAU, 0, Math.PI / 2)),
    poopA: own(new THREE.SphereGeometry(0.19, 10, 8)),
    poopB: own(new THREE.SphereGeometry(0.14, 10, 8)),
    poopC: own(new THREE.SphereGeometry(0.085, 8, 6)),
    ring: own(new THREE.RingGeometry(0.62, 0.78, 32)),
  };
  G.ring.rotateX(-Math.PI / 2);
  const ringMat = own(new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.85, depthWrite: false }));
  const eggMats = new Map();
  const eggMat = color => {
    let m = eggMats.get(color);
    if (!m) { m = own(new THREE.MeshToonMaterial({ color, gradientMap: world.toonGradient, side: THREE.DoubleSide })); eggMats.set(color, m); }
    return m;
  };

  // ── state ──────────────────────────────────────────────────────────────
  const actors = new Map();       // petId -> actor record
  const poopSpots = new Map();    // petId -> [{x,z}]
  const poopMeshes = new Map();   // actorId -> { group, born }
  const poopOwner = new Map();    // actorId -> petId
  let nests = [];                 // [{ i, id, group, egg, eggKey, ... }]
  let nestCount = 0;
  let selected = null;            // petId whose sheet is open
  let sheetMode = 'main';
  let armedFood = null;           // item id chosen in the tray
  let hatching = null;            // hatch ceremony in progress
  let revealId = null;            // newborn whose sheet shows the hatch info
  let prevFocus = null;           // element focused before the sheet opened
  let panPx = 0, panTarget = 0, panApplied = 0; // camera shift so the selected pet stays above the sheet
  let synced = false;
  let disposed = false;
  const tags = [];                // name tags following a pet { el, petId, until }
  const temps = [];               // temporary meshes { mesh, vx, vy, vz, spin, t, life, remove }
  const timers = new Set();
  const labelEls = new Map();     // nest id -> label element
  const htmlCache = new WeakMap();

  const later = (ms, fn) => {
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
    timers.add(id);
  };

  // ── static props ──────────────────────────────────────────────────────
  const bowl = new THREE.Group();
  {
    const b = new THREE.Mesh(G.bowl, toon(0xb86a3d)); b.position.y = 0.11;
    const f = new THREE.Mesh(G.food, toon(0xe9c46a)); f.position.y = 0.23;
    bowl.add(b, f);
    bowl.position.set(YARD.bowl.x, 0, YARD.bowl.z);
    world.addActor('bowl', bowl, { radius: 0.5, height: 0.35, shadowScale: 0.9 });
  }
  const ring = new THREE.Mesh(G.ring, ringMat);
  ring.visible = false;
  ring.userData.noPick = true;
  ring.position.y = 0.035;
  world.scene.add(ring);

  // ── pets ───────────────────────────────────────────────────────────────
  const modelSig = pet => `${pet.speciesId}|${pet.stage}|${pet.shiny ? 1 : 0}`;

  function buildModel(pet) {
    const sp = getSpecies(pet.speciesId);
    return buildPetModel(THREE, pet, sp || { id: pet.speciesId, emoji: '❓' });
  }

  function freeSpot(seed) {
    for (let k = 0; k < 10; k++) {
      const h1 = hashId(seed + ':a' + k), h2 = hashId(seed + ':b' + k);
      const ang = ((h1 % 3600) / 3600) * TAU;
      const r = 0.8 + ((h2 % 1000) / 1000) * (YARD.walkRadius - 1.4);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (z < YARD.backLimit + 0.2) continue;
      if (dist2(x, z, YARD.bowl.x, YARD.bowl.z) < 1.0) continue;
      let ok = true;
      for (const a of actors.values()) if (dist2(x, z, a.x, a.z) < 1.0) { ok = false; break; }
      if (ok) return { x, z };
    }
    return { x: ((hashId(seed) % 100) / 100 - 0.5) * 3, z: 0.5 };
  }

  function createActor(pet, opts = {}) {
    const model = buildModel(pet);
    const holder = new THREE.Group();
    holder.add(model.root);
    const at = opts.at || freeSpot(pet.id);
    const A = {
      id: pet.id, pet, sig: modelSig(pet), model, holder, x: at.x, z: at.z, y: 0,
      heading: opts.heading ?? (hashId(pet.id) % 628) / 100, act: { type: 'idle', t: 0, dur: 0.4 + Math.random() * 2 }, last: 'idle',
      hold: 0, curl: 0, phase: Math.random() * TAU, seed: (hashId(pet.id) % 1000) / 100, feeding: false,
      stage: pet.stage, poop: pet.poop || 0, bubble: null, bubbleEmoji: '', blinkAt: 1 + Math.random() * 4, blink: 0,
      spawn: null, pose: null, headBase: model.head ? model.head.rotation.clone() : null,
      tailBase: model.parts && model.parts.tail ? model.parts.tail.rotation.clone() : null, pinned: false,
    };
    if (opts.spawn) A.spawn = { t: 0, dur: opts.spawn.dur || 0.7, arc: opts.spawn.arc ?? 0.5, from: opts.spawn.from || null };
    world.addActor(pet.id, holder, { radius: Math.max(0.35, model.radius), height: Math.max(0.5, model.height) });
    actors.set(pet.id, A);
    return A;
  }

  function rebuildModel(A, pet) {
    const grew = pet.stage > A.stage;
    A.holder.remove(A.model.root);
    A.model = buildModel(pet);
    A.holder.add(A.model.root);
    A.headBase = A.model.head ? A.model.head.rotation.clone() : null;
    A.tailBase = A.model.parts && A.model.parts.tail ? A.model.parts.tail.rotation.clone() : null;
    A.sig = modelSig(pet);
    world.addActor(A.id, A.holder, { radius: Math.max(0.35, A.model.radius), height: Math.max(0.5, A.model.height) });
    if (A.bubble) { const e = A.bubbleEmoji; A.bubble = null; A.bubbleEmoji = ''; setBubble(A, e); }
    if (grew) {
      A.spawn = { t: 0, dur: 0.6, arc: 0.35, from: null };
      fx.sparkle(world, A.id);
      fx.confetti(world, headPos(A), 12);
      A.stage = pet.stage;
    }
    A.stage = pet.stage;
  }

  function removeActorRec(A) {
    fx.clearBubble(world, A.id);
    world.removeActor(A.id);
    actors.delete(A.id);
    for (let i = tags.length - 1; i >= 0; i--) if (tags[i].petId === A.id) { tags[i].el.remove(); tags.splice(i, 1); }
  }

  const headPos = A => ({ x: A.x, y: A.y + Math.max(0.5, A.model.height) * 0.85, z: A.z });

  function setBubble(A, emoji) {
    if (!emoji) { if (A.bubble) { A.bubble.remove(); A.bubble = null; A.bubbleEmoji = ''; } return; }
    if (A.bubble && A.bubbleEmoji === emoji) return;
    if (A.bubble) A.bubble.setEmoji(emoji); else A.bubble = fx.bubble(world, A.id, emoji);
    A.bubbleEmoji = emoji;
  }

  // ── behaviour ──────────────────────────────────────────────────────────
  /** True while the pet is still standing in the yard (it may have left for work / been released mid-animation). */
  const alive = id => actors.has(id) && !!getPet(getState(), id);
  const faceCam = A => Math.atan2(camPos.x - A.x, camPos.z - A.z);

  function begin(A, act) {
    A.act = beginAction(act);
    A.last = act.type === 'walkTo' ? 'wander' : act.type;
  }

  function decide(A) {
    if (A.hold > 0) { begin(A, { type: 'idle', dur: Math.min(1.5, A.hold), reason: 'hold' }); return; }
    const others = [];
    for (const o of actors.values()) if (o !== A) others.push({ id: o.id, x: o.x, z: o.z });
    const act = nextAction(A.pet, { x: A.x, z: A.z, others, last: A.last }, Math.random, now());
    if (act.type === 'approach') {
      const o = actors.get(act.otherId);
      if (o) act.target = clampToYard(o.x + (A.x - o.x) * 0.3, o.z + (A.z - o.z) * 0.3);
    }
    begin(A, act);
  }

  /** A short scripted reaction (play / bathe / eat / no / hop ...). */
  function react(A, type, extra = {}) {
    if (!A) return;
    begin(A, { type, ...extra });
  }

  /** Per-frame behaviour: returns the pose numbers for this frame (no allocation besides the reused object). */
  function step(A, dt, t) {
    const pet = A.pet;
    const P = A.pose || (A.pose = {});
    P.hop = 0; P.sy = 1; P.sx = 1; P.roll = 0; P.pitch = 0; P.yaw = 0; P.shake = 0;
    P.hPitch = 0; P.hYaw = 0; P.hRoll = 0; P.tail = 0; P.scale = 1;
    if (A.hold > 0 && A.hold < SELECT_HOLD / 2) A.hold = Math.max(0, A.hold - dt);

    // pop-in (hatching, returning from work, growing up)
    if (A.spawn) {
      const S = A.spawn;
      S.t += dt;
      const u = Math.min(1, S.t / S.dur);
      P.scale = Math.max(0.02, ease.outBack(u));
      P.hop = Math.sin(u * Math.PI) * S.arc;
      if (u >= 1) { A.spawn = null; if (A.onSpawned) { const f = A.onSpawned; A.onSpawned = null; f(A); } }
      A.curl = 0;
      return P;
    }

    const act = A.act;
    const sleeping = pet.status === 'sleeping';
    const held = A.hold > 0 && act.type !== 'eat' && act.type !== 'no' && act.type !== 'hop' && act.type !== 'play' && act.type !== 'bathe';
    if (held && (act.type === 'wander' || act.type === 'approach' || act.type === 'walkTo')) begin(A, { type: 'idle', dur: 1 });

    let curlTarget = sleeping || (A.act.type === 'sleep' && A.act.nap) ? 1 : 0;
    if (!sleeping && pet.sick) curlTarget = 0;
    // timers, walking and "action finished -> decide()" live in petBehaviour.advanceActor (unit-tested)
    const moving = advanceActor(A, dt, decide).moving;

    switch (A.act.type) {
      case 'wander': case 'approach': case 'walkTo': break;
      case 'idle': {
        const target = A.act.reason === 'hungry' ? Math.atan2(YARD.bowl.x - A.x, YARD.bowl.z - A.z) : A.heading;
        A.heading += angDiff(A.heading, target) * Math.min(1, dt * 4);
        const b = Math.sin(t * 1.9 + A.seed) * 0.018;
        P.sy += b; P.sx -= b * 0.5;
        P.hYaw = Math.sin(t * 0.55 + A.seed) * 0.35;
        if (A.act.reason === 'hungry') { P.hPitch = 0.28 + Math.sin(t * 2.5 + A.seed) * 0.08; P.hop = Math.max(0, Math.sin(t * 3.1 + A.seed)) ** 6 * 0.1; }
        break;
      }
      case 'sleep': {
        const b = Math.sin(t * 1.4 + A.seed) * 0.022;
        P.sy += b; P.sx -= b * 0.4;
        break;
      }
      case 'sick': {
        P.shake = Math.sin(t * 52) * 0.016;
        P.pitch = 0.1; P.sy = 0.95;
        P.hPitch = 0.3;
        break;
      }
      case 'lookAtCamera': {
        A.heading += angDiff(A.heading, faceCam(A)) * Math.min(1, dt * 6);
        P.hRoll = Math.sin(t * 2.2 + A.seed) * 0.18;
        P.hYaw = Math.sin(t * 1.1) * 0.12;
        break;
      }
      case 'hop': {
        const hops = A.act.hops || 2;
        const per = (A.act.dur || 1.6) / hops;
        const u = (A.act.t % per) / per;
        const h = Math.sin(u * Math.PI);
        P.hop = h * (A.act.height || 0.42);
        P.sy = 1 + 0.16 * h - (1 - h) ** 6 * 0.16; P.sx = 1 - 0.07 * h + (1 - h) ** 6 * 0.08;
        P.tail = Math.sin(t * 22) * 0.5;
        break;
      }
      case 'play': {
        // runs a small circle with bounces around the spot where it started
        const c = A.act.center || (A.act.center = { x: A.x - 0.5, z: A.z });
        const ang = A.act.t * 3.2;
        const nx = c.x + Math.cos(ang) * 0.5, nz = c.z + Math.sin(ang) * 0.5;
        A.heading += angDiff(A.heading, Math.atan2(nx - A.x, nz - A.z)) * Math.min(1, dt * 14);
        A.x = nx; A.z = nz;
        const h = Math.abs(Math.sin(A.act.t * 8));
        P.hop = h * 0.26; P.sy = 0.94 + 0.14 * h; P.tail = Math.sin(t * 25) * 0.6;
        break;
      }
      case 'eat': {
        A.heading += angDiff(A.heading, faceCam(A)) * Math.min(1, dt * 6);
        const c = Math.abs(Math.sin(A.act.t * 13));
        P.sy = 1 - 0.09 * c; P.sx = 1 + 0.05 * c;
        P.hPitch = 0.4 + Math.sin(A.act.t * 13) * 0.14;
        break;
      }
      case 'no': {
        const u = A.act.t / (A.act.dur || 0.7);
        P.hYaw = Math.sin(A.act.t * 20) * 0.5 * (1 - u);
        P.yaw = Math.sin(A.act.t * 20) * 0.12 * (1 - u);
        break;
      }
      case 'bathe': {
        const u = A.act.t / (A.act.dur || 2.2);
        P.roll = Math.sin(A.act.t * 34) * 0.14 * (1 - u * 0.5);
        P.hop = Math.max(0, Math.sin(A.act.t * 12)) * 0.07;
        P.sy = 1 + Math.sin(A.act.t * 34) * 0.03;
        if (A.act.t > 0.25 && !A.act.puffed) { A.act.puffed = 1; }
        break;
      }
      case 'poop': {
        const u = A.act.t / (A.act.dur || 1.1);
        P.sy = 1 - 0.18 * Math.sin(Math.min(1, u) * Math.PI);
        P.pitch = -0.1 * Math.sin(Math.min(1, u) * Math.PI);
        P.shake = Math.sin(A.act.t * 40) * 0.01;
        break;
      }
      default: break;
    }

    // blink (eyes are tiny groups; skip while sleeping)
    A.curl += (curlTarget - A.curl) * Math.min(1, dt * 3.2);
    if (moving) {
      const w = Math.abs(Math.sin(A.phase));
      P.hop = w * 0.11;
      P.sy = 0.93 + 0.13 * w; P.sx = 1.05 - 0.07 * w;
      P.roll = Math.sin(A.phase) * 0.07;
      P.tail = Math.sin(A.phase * 2) * 0.45;
    }
    const c = A.curl;
    if (c > 0.001) {
      P.sy *= 1 - 0.34 * c; P.sx *= 1 + 0.1 * c; P.hPitch += 0.55 * c; P.roll += 0.1 * c; P.hop *= 1 - c;
    }
    if (pet.sick) { P.sy *= 0.96; }
    return P;
  }

  function applyPose(A, t, dt) {
    const P = A.pose;
    if (!P) return;
    const m = A.model;
    A.y = P.hop;
    A.holder.position.set(A.x, A.y, A.z);
    A.holder.rotation.y = A.heading;
    const s = P.scale;
    m.body.scale.set(P.sx * s, P.sy * s, P.sx * s);
    m.body.rotation.set(P.pitch, P.yaw, P.roll);
    m.body.position.x = P.shake;
    if (m.head && A.headBase) m.head.rotation.set(A.headBase.x + P.hPitch, A.headBase.y + P.hYaw, A.headBase.z + P.hRoll);
    const tail = m.parts && m.parts.tail;
    if (tail && A.tailBase) tail.rotation.y = A.tailBase.y + P.tail;
    // blink / closed eyes
    const eyes = m.parts && m.parts.eyes;
    if (eyes && eyes.length) {
      A.blinkAt -= dt;
      if (A.blinkAt < 0) { A.blink = 0.13; A.blinkAt = 2.5 + Math.random() * 4; }
      if (A.blink > 0) A.blink -= dt;
      const closed = A.curl > 0.55 || A.blink > 0 ? 0.12 : 1;
      for (const e of eyes) e.scale.y = closed;
    }
  }

  function resolveCollisions(dt) {
    const list = [...actors.values()];
    const obstacles = world.obstacles || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const ra = a.model.radius * 0.8;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const min = (ra + b.model.radius * 0.8);
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        const push = (min - d);
        const aFixed = a.pinned || a.pet.status === 'sleeping' || a.hold > 0;
        const bFixed = b.pinned || b.pet.status === 'sleeping' || b.hold > 0;
        if (aFixed && bFixed) continue;
        const wa = aFixed ? 0 : bFixed ? 1 : 0.5, wb = bFixed ? 0 : aFixed ? 1 : 0.5;
        a.x -= nx * push * wa; a.z -= nz * push * wa;
        b.x += nx * push * wb; b.z += nz * push * wb;
      }
      for (const o of obstacles) {
        const d = dist2(a.x, a.z, o.x, o.z), min = o.r + ra * 0.3;
        if (d < min) { const k = d > 1e-4 ? (min - d) / d : 0; a.x += (a.x - o.x) * k; a.z += (a.z - o.z) * k; }
      }
      for (const n of nests) {
        const d = dist2(a.x, a.z, n.x, n.z), min = 0.55 + ra * 0.5;
        if (d < min) { const k = d > 1e-4 ? (min - d) / d : 0; a.x += (a.x - n.x) * k; a.z += (a.z - n.z) * k; }
      }
      const bd = dist2(a.x, a.z, YARD.bowl.x, YARD.bowl.z);
      if (bd < 0.55 && bd > 1e-4) { const k = (0.55 - bd) / bd; a.x += (a.x - YARD.bowl.x) * k; a.z += (a.z - YARD.bowl.z) * k; }
      const r = Math.hypot(a.x, a.z), maxR = YARD.walkRadius + 0.35;
      if (r > maxR) { a.x *= maxR / r; a.z *= maxR / r; }
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) { a.x = 0; a.z = 0.5; }
    }
  }

  // ── nests / eggs ───────────────────────────────────────────────────────
  function buildNests(count) {
    for (const n of nests) { world.removeActor(n.id); fx.clearBubble(world, n.id); }
    nests = [];
    for (const el of labelEls.values()) el.remove();
    labelEls.clear();
    nestCount = count;
    for (let i = 0; i < count; i++) {
      const pos = nestSpot(i, count);
      const g = new THREE.Group();
      const dish = new THREE.Mesh(G.nestDish, toon(0xa9733c)); dish.position.y = 0.05;
      const rim = new THREE.Mesh(G.nestRing, toon(0xdcae60)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.17;
      g.add(dish, rim);
      g.position.set(pos.x, 0, pos.z);
      const n = { i, id: `nest-${i}`, group: g, x: pos.x, z: pos.z, egg: null, eggKey: '', ready: false, seed: i * 1.7, wobbleAt: 2 + i };
      world.addActor(n.id, g, { radius: 0.75, height: 0.9, shadowScale: 0.85 });
      nests.push(n);
      const label = document.createElement('div');
      label.className = 'b3-label';
      label.hidden = true;
      labelsEl.appendChild(label);
      labelEls.set(n.id, label);
    }
  }

  function syncNests(state) {
    const want = Math.max(1, Math.min(MAX_NESTS, Number(state.incubatorCapacity) || 1));
    if (want !== nestCount) buildNests(want);
    const t = now();
    for (const n of nests) {
      const slot = state.incubator[n.i];
      const key = slot ? `${slot.eggId}` : '';
      if (key !== n.eggKey && !(hatching && hatching.nest === n.i && hatching.phase !== 'done')) {
        if (n.egg) { n.group.remove(n.egg); n.egg = null; }
        if (slot) {
          const eggDef = getEgg(slot.eggId);
          const egg = new THREE.Mesh(G.egg, eggMat(eggDef ? eggDef.color : '#f6e7b0'));
          egg.scale.set(0.85, 1.12, 0.85);
          egg.position.y = 0.45;
          n.group.add(egg);
          n.egg = egg;
        }
        n.eggKey = key;
      }
      n.ready = !!slot && t >= slot.readyAt;
      n.slot = slot || null;
      const wantBubble = n.ready && !(hatching && hatching.nest === n.i);
      if (wantBubble) fx.bubble(world, n.id, '🐣'); else fx.clearBubble(world, n.id);
    }
  }

  function updateNestLabels() {
    const t = now();
    for (const n of nests) {
      const el = labelEls.get(n.id);
      if (!el) continue;
      let text = '';
      if (hatching && hatching.nest === n.i && hatching.phase !== 'done') text = '';
      else if (n.slot) text = t >= n.slot.readyAt ? '' : `⏳ ${formatDuration(n.slot.readyAt - t)}`;
      else text = '➕';
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !text;
    }
  }

  function placeLabels() {
    for (const n of nests) {
      const el = labelEls.get(n.id);
      if (!el || el.hidden) continue;
      const p = world.worldToScreen({ x: n.x, y: 1.05, z: n.z });
      el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
      el.style.visibility = p.visible ? 'visible' : 'hidden';
    }
    for (let i = tags.length - 1; i >= 0; i--) {
      const tg = tags[i];
      const A = actors.get(tg.petId);
      if (!A || performance.now() > tg.until) { tg.el.remove(); tags.splice(i, 1); continue; }
      const p = world.worldToScreen({ x: A.x, y: A.y + A.model.height + 0.95, z: A.z });
      tg.el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
    }
  }

  function animateNests(t, dt) {
    for (const n of nests) {
      const egg = n.egg;
      if (!egg) continue;
      if (hatching && hatching.nest === n.i) continue; // the ceremony drives this egg
      if (n.ready) {
        const k = Math.sin(t * 9 + n.seed);
        egg.rotation.z = k * 0.22; egg.position.y = 0.45 + Math.max(0, Math.sin(t * 4.5 + n.seed)) * 0.07;
        n.wobbleAt -= dt;
        if (n.wobbleAt < 0) { n.wobbleAt = 3.2; fx.sparkle(world, n.id); }
      } else {
        n.wobbleAt -= dt;
        const w = n.wobbleAt < 0 && n.wobbleAt > -0.7 ? Math.sin(-n.wobbleAt * 22) * 0.12 : 0;
        if (n.wobbleAt < -0.7) n.wobbleAt = 4 + Math.random() * 5;
        egg.rotation.z = w; egg.position.y = 0.45;
      }
    }
  }

  // ── poop ───────────────────────────────────────────────────────────────
  function makePoopMesh() {
    const g = new THREE.Group();
    const m = toon(0x8a5a2f);
    const a = new THREE.Mesh(G.poopA, m); a.scale.y = 0.62; a.position.y = 0.1;
    const b = new THREE.Mesh(G.poopB, m); b.scale.y = 0.7; b.position.y = 0.23;
    const c = new THREE.Mesh(G.poopC, m); c.position.y = 0.33;
    g.add(a, b, c);
    return g;
  }

  function syncPoops(state) {
    const keep = new Set();
    for (const A of actors.values()) {
      const n = Math.min(3, Math.max(0, A.pet.poop | 0));
      let spots = poopSpots.get(A.id);
      if (n === 0) { poopSpots.delete(A.id); continue; }
      if (!spots) { spots = []; poopSpots.set(A.id, spots); }
      while (spots.length < n) {
        const fresh = synced ? { x: A.x - Math.sin(A.heading) * 0.5, z: A.z - Math.cos(A.heading) * 0.5 } : null;
        const base = fresh || { x: A.x + (hashId(A.id + spots.length) % 100 - 50) / 70, z: A.z + (hashId(A.id + 'z' + spots.length) % 100 - 50) / 70 };
        const c = clampToYard(base.x, base.z);
        spots.push({ x: c.x, z: Math.max(c.z, YARD.backLimit + 0.3) });
      }
      spots.length = n;
      for (let k = 0; k < n; k++) {
        const id = `poop-${A.id}-${k}`;
        keep.add(id);
        if (!poopMeshes.has(id)) {
          const g = makePoopMesh();
          g.position.set(spots[k].x, 0, spots[k].z);
          g.rotation.y = k * 2.1;
          world.addActor(id, g, { radius: 0.34, height: 0.4, shadowScale: 0.5 });
          poopMeshes.set(id, { group: g, born: synced ? 0 : 1 });
          poopOwner.set(id, A.id);
          if (!synced) g.scale.setScalar(1); else g.scale.setScalar(0.01);
        }
      }
    }
    for (const [id, rec] of [...poopMeshes]) {
      if (keep.has(id)) continue;
      const p = rec.group.position;
      if (synced) fx.emojiPop(world, { x: p.x, y: 0.3, z: p.z }, '✨');
      world.removeActor(id);
      poopMeshes.delete(id);
      poopOwner.delete(id);
    }
  }

  // ── sync with game state ───────────────────────────────────────────────
  function sync(state) {
    if (disposed) return;
    const pets = state.pets;
    let away = 0, onTrip = 0;
    const present = new Set();
    for (const pet of pets) {
      if (isBusyStatus(pet.status)) { if (pet.status === 'expedition') onTrip++; else away++; continue; }
      present.add(pet.id);
      let A = actors.get(pet.id);
      if (!A) {
        if (hatching && hatching.spawning && !hatching.petId) {
          hatching.petId = pet.id;
          const n = nests[hatching.nest];
          A = createActor(pet, { at: n ? { x: n.x, z: n.z + 0.5 } : null, spawn: { dur: 0.8, arc: 0.9 } });
          A.pinned = true;
          A.onSpawned = ceremonyWalk;
        } else {
          const edge = synced ? clampToYard(-2.6, 3.0) : null;
          A = createActor(pet, synced ? { at: edge, spawn: { dur: 0.5, arc: 0.3 } } : {});
        }
      } else if (A.sig !== modelSig(pet)) {
        A.pet = pet;
        rebuildModel(A, pet);
      }
      A.pet = pet;
      // a new poop while in the yard -> squat animation
      const np = pet.poop | 0;
      if (np > A.poop && synced && pet.status !== 'sleeping' && !A.spawn && A.hold <= 0 && !A.feeding) begin(A, { type: 'poop', dur: 1.1 });
      A.poop = np;
      // waking up / state flips re-decide soon
      const wantSleep = pet.status === 'sleeping';
      if (wantSleep && A.act.type !== 'sleep') begin(A, { type: 'sleep', dur: 12 });
      if (!wantSleep && A.act.type === 'sleep' && !A.act.nap) decide(A);
      if (pet.sick && A.act.type !== 'sick' && A.act.type !== 'eat' && A.act.type !== 'no') begin(A, { type: 'sick', dur: 5 });
      if (!pet.sick && A.act.type === 'sick') decide(A);
      // thought bubbles
      const b = bubbleFor(pet);
      const napping = A.act.type === 'sleep' && A.act.nap;
      setBubble(A, b ? b.emoji : napping ? '💤' : '');
    }
    for (const A of [...actors.values()]) {
      if (!present.has(A.id)) {
        if (selected === A.id) closeSheet();
        removeActorRec(A);
        poopSpots.delete(A.id);
      }
    }
    syncPoops(state);
    syncNests(state);
    updateNestLabels();

    // HUD
    const lines = [];
    if (away > 0) lines.push(`🧳 ไปทำงาน ${away} ตัว`);
    if (onTrip > 0) lines.push(`🧭 ออกสำรวจ ${onTrip} ตัว`);
    signEl.hidden = !lines.length;
    const signText = lines.join('\n');
    if (signEl.textContent !== signText) signEl.textContent = signText;
    const freeSlots = state.incubator.length < state.incubatorCapacity;
    eggBtn.hidden = !freeSlots;
    refreshUi(state);
    synced = true;
  }

  const setHtml = (el, html, useMorph) => {
    if (htmlCache.get(el) === html) return;
    htmlCache.set(el, html);
    if (useMorph) morph(el, html); else el.innerHTML = html;
  };

  function refreshUi(state = getState()) {
    // armed food that ran out
    if (armedFood && !(state.inventory[armedFood] > 0)) armedFood = null;
    if (selected && !getPet(state, selected)) selected = null;
    // sheet
    const pet = selected ? getPet(state, selected) : null;
    if (pet) {
      const opening = sheetEl.hidden;
      sheetEl.hidden = false;
      setHtml(sheetEl, ctx.petSheetHtml(pet, state, sheetMode, { reveal: revealId === pet.id }), true);
      if (opening) {
        prevFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
        sheetEl.tabIndex = -1;
        try { sheetEl.focus({ preventScroll: true }); } catch { /* not focusable */ }
      }
    } else {
      if (!sheetEl.hidden) {
        const inside = sheetEl.contains(document.activeElement) || document.activeElement === document.body;
        sheetEl.hidden = true;
        if (inside) {
          const back = prevFocus && document.contains(prevFocus) && !prevFocus.hidden ? prevFocus : host;
          try { back.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
        prevFocus = null;
      }
      htmlCache.delete(sheetEl);
    }
    // tray (hidden while the sheet is open)
    const hasFood = Object.entries(state.inventory).some(([id, n]) => n > 0 && (getItem(id) || {}).food && (getItem(id) || {}).type !== 'egg');
    trayEl.hidden = !!pet || (!state.pets.length) || !hasFood && !state.pets.length;
    if (!trayEl.hidden) setHtml(trayEl, ctx.foodTrayHtml(state, null, armedFood), false);
    // hint
    const eggsOwned = state.incubator.length > 0;
    let hint = '';
    if (armedFood) { const it = getItem(armedFood); hint = `${it ? it.emoji : '🍖'} แตะน้องที่อยากให้กิน`; }
    else if (!state.pets.length && !eggsOwned) hint = 'ยังไม่มีน้อง — ใส่ไข่ในรังเพื่อเริ่มฟักได้เลย 🥚';
    else if (!state.pets.length) hint = 'รอไข่ฟักก่อนนะ แล้วจะมีเพื่อนตัวแรกเดินมาหา 🐣';
    hintEl.hidden = !hint;
    if (hintEl.textContent !== hint) hintEl.textContent = hint;
    hintEl.classList.toggle('is-armed', !!armedFood);
  }

  // ── interactions ───────────────────────────────────────────────────────
  function onTapGround() {
    if (selected) closeSheet();
  }

  function onTap(id) {
    if (disposed) return;
    if (id === 'bowl') { notify('🍽️ ถาดอาหาร — เลือกอาหารจากถาดด้านล่าง แล้วแตะน้องที่อยากให้กิน', 'info'); return; }
    if (id.startsWith('nest-')) { onNestTap(Number(id.slice(5))); return; }
    if (id.startsWith('poop-')) { onPoopTap(id); return; }
    if (actors.has(id)) onPetTap(id);
  }

  function onPoopTap(id) {
    const petId = poopOwner.get(id);
    if (!petId || !alive(petId)) return;
    const rec = poopMeshes.get(id);
    const r = ctx.run(s => pickPoop(s, petId));
    if (r && r.ok && rec) fx.emojiPop(world, { x: rec.group.position.x, y: 0.4, z: rec.group.position.z }, '✨');
  }

  function onNestTap(i) {
    const state = getState();
    const slot = state.incubator[i];
    if (!slot) { ctx.openEggPicker(); return; }
    const egg = getEgg(slot.eggId);
    if (now() < slot.readyAt) {
      notify(`🥚 ${egg ? egg.nameTh : 'ไข่'} เหลืออีก ${formatDuration(slot.readyAt - now())}`, 'info');
      const n = nests[i];
      if (n) n.wobbleAt = 0;
      return;
    }
    startHatch(i);
  }

  function onPetTap(petId) {
    const state = getState();
    const pet = getPet(state, petId);
    const A = actors.get(petId);
    if (!pet || !A) return;
    if (armedFood) { feedWith(petId, armedFood); return; }
    const r = ctx.run(s => patPet(s, petId));
    if (r && r.ok) {
      fx.heart(world, headPos(A));
      if (pet.status !== 'sleeping' && !pet.sick) react(A, 'hop', { dur: 0.7, hops: 1, height: 0.3 });
      if (!r.rewarded) fx.emojiPop(world, headPos(A), '😌');
    }
    A.hold = SELECT_HOLD;
    selectPet(petId);
  }

  function selectPet(petId) {
    if (selected && selected !== petId) { const o = actors.get(selected); if (o) o.hold = HOLD_AFTER_TAP; }
    if (selected !== petId) revealId = revealId === petId ? petId : null;
    selected = petId;
    sheetMode = 'main';
    const A = actors.get(petId);
    if (A) A.hold = SELECT_HOLD;
    refreshUi();
  }

  function closeSheet() {
    if (selected) { const A = actors.get(selected); if (A) A.hold = 1.2; }
    selected = null;
    revealId = null;
    sheetMode = 'main';
    refreshUi();
  }

  function feedWith(petId, itemId) {
    const state = getState();
    const pet = getPet(state, petId);
    const A = actors.get(petId);
    const item = getItem(itemId);
    if (!pet || !A || !item || A.feeding) return;
    const blocked = pet.status === 'sleeping' || pet.stats.hunger >= 99.5 || !(state.inventory[itemId] > 0);
    if (blocked) {
      ctx.run(s => feedPet(s, petId, itemId)); // shows the proper "full / asleep" toast
      react(A, 'no');
      return;
    }
    const favorite = foodEffect(pet, item).favorite;
    A.feeding = true;
    A.hold = Math.max(A.hold, 4);
    A.heading = faceCam(A);
    const to = headPos(A);
    const from = { x: camPos.x * 0.45 + A.x * 0.55, y: 1.1, z: camPos.z * 0.45 + A.z * 0.55 };
    world.boost(1800);
    fx.flyEmoji(world, from, to, item.emoji, () => {
      A.feeding = false;
      if (disposed || !alive(petId)) return; // the pet left while the food was flying: no stray toast
      const r = ctx.run(s => feedPet(s, petId, itemId));
      if (r && r.ok) {
        react(A, 'eat', { dur: 1.7, then: AA => {
          fx.heart(world, headPos(AA));
          if (favorite) { fx.sparkle(world, AA.id); AA.hold = 0; react(AA, 'hop', { dur: 1.4, hops: 3 }); }
        } });
        if (!(getState().inventory[itemId] > 0)) armedFood = null;
      } else {
        react(A, 'no');
      }
      refreshUi();
    });
  }

  function careAction(kind, petId) {
    const A = actors.get(petId);
    const fns = { play: playWithPet, bath: cleanPet, toy: giveToy, heal: healPet, sleep: toggleSleep, gift: claimGift };
    const fn = fns[kind];
    if (!fn) return;
    if (!alive(petId)) { refreshUi(); return; } // gone mid-animation: cancel silently
    const before = getPet(getState(), petId);
    const wasSleeping = before && before.status === 'sleeping';
    const r = ctx.run(s => fn(s, petId));
    if (!A || !r) return;
    if (!r.ok) { if (kind !== 'sleep') react(A, 'no'); return; }
    A.hold = Math.max(A.hold, 4);
    const h = headPos(A);
    switch (kind) {
      case 'play': react(A, 'play', { dur: 3.2 }); fx.emojiPop(world, h, '🎾'); later(1600, () => fx.heart(world, headPos(A))); break;
      case 'bath':
        react(A, 'bathe', { dur: 2.2 });
        for (let k = 0; k < 5; k++) later(120 + k * 260, () => fx.emojiPop(world, { x: A.x + (Math.random() - 0.5) * 0.7, y: 0.3 + Math.random() * 0.6, z: A.z + (Math.random() - 0.5) * 0.7 }, k % 2 ? '🫧' : '🛁'));
        later(2200, () => fx.sparkle(world, A.id));
        break;
      case 'toy': react(A, 'hop', { dur: 2.4, hops: 4 }); fx.emojiPop(world, h, '🧸'); break;
      case 'heal': fx.sparkle(world, A.id); fx.emojiPop(world, h, '💊'); react(A, 'hop', { dur: 1.2, hops: 2 }); break;
      case 'sleep': fx.emojiPop(world, h, wasSleeping ? '☀️' : '💤'); if (wasSleeping) react(A, 'hop', { dur: 1, hops: 1 }); break;
      case 'gift': fx.emojiPop(world, h, '🎁'); fx.heart(world, h); break;
      default: break;
    }
    if (kind === 'sleep' && !wasSleeping) closeSheet();
  }

  // ── hatch ceremony ─────────────────────────────────────────────────────
  function startHatch(i) {
    if (hatching) return;
    const state = getState();
    const n = nests[i];
    if (!n || !n.egg) return;
    if (state.pets.length >= state.barnCapacity) { ctx.run(s => hatchReady(s, i)); return; } // shows "barn is full"
    if (selected) closeSheet();
    hatching = { nest: i, t: 0, phase: 'wobble', spawning: false, petId: null, halves: null };
    fx.clearBubble(world, n.id);
    world.boost(4500);
  }

  function crack() {
    const n = nests[hatching.nest];
    hatching.phase = 'burst';
    hatching.t = 0;
    hatching.spawning = true;
    const r = ctx.run(s => hatchReady(s, hatching.nest));
    hatching.spawning = false;
    if (!r || !r.ok || !r.pet) { // failed: put the egg back to rest
      hatching = null;
      return;
    }
    const base = { x: n.x, y: 0.5, z: n.z };
    // egg halves fly apart
    const eggColor = n.egg ? n.egg.material : eggMat('#f6e7b0');
    if (n.egg) { n.group.remove(n.egg); n.egg = null; n.eggKey = ''; }
    const top = new THREE.Mesh(G.half, eggColor);
    top.scale.set(0.85, 1.1, 0.85); top.position.set(n.x, 0.5, n.z);
    const bottom = new THREE.Mesh(G.half, eggColor);
    bottom.scale.set(0.85, -0.8, 0.85); bottom.position.set(n.x, 0.5, n.z);
    top.userData.noPick = bottom.userData.noPick = true;
    world.scene.add(top, bottom);
    temps.push({ mesh: top, vx: 0.5, vy: 3.2, vz: -0.4, spin: 5, t: 0, life: 1.4 });
    temps.push({ mesh: bottom, vx: -0.15, vy: 0.2, vz: 0.1, spin: 0, t: 0, life: 1.6 });
    fx.confetti(world, base, 28);
    fx.sparkleAt(world, base);
    if (r.pet.shiny) later(500, () => fx.sparkleAt(world, base));
  }

  function ceremonyWalk(A) {
    A.pinned = false;
    const pet = A.pet;
    const tx = Math.max(-1.6, Math.min(1.6, A.x * 0.5)), tz = 1.5;
    begin(A, {
      type: 'walkTo', target: { x: tx, z: tz }, speed: 1.1,
      onArrive: AA => {
        begin(AA, { type: 'hop', dur: 1.3, hops: 2 });
        AA.hold = 4.5;
        showNameTag(AA, `🐣 ${petName(pet)}`);
        fx.heart(world, headPos(AA));
        hatching = null;
        revealId = AA.id;     // same info as the list's reveal: rarity, personality, trait, shiny
        selectPet(AA.id);
      },
    });
    A.hold = 0;
  }

  function showNameTag(A, text) {
    const el = document.createElement('div');
    el.className = 'b3-nametag';
    el.textContent = text;
    labelsEl.appendChild(el);
    tags.push({ el, petId: A.id, until: performance.now() + 4500 });
  }

  function stepHatch(dt) {
    if (!hatching) return;
    const h = hatching;
    h.t += dt;
    const n = nests[h.nest];
    if (!n) { hatching = null; return; }
    if (h.phase === 'wobble') {
      const u = Math.min(1, h.t / 1.4);
      if (n.egg) {
        n.egg.rotation.z = Math.sin(h.t * (14 + u * 22)) * (0.15 + u * 0.35);
        n.egg.position.y = 0.45 + Math.abs(Math.sin(h.t * 10)) * 0.05 * u;
        const s = 1 + u * 0.12 + Math.sin(h.t * 30) * 0.02 * u;
        n.egg.scale.set(0.85 * s, 1.12 * s, 0.85 * s);
      }
      if (h.t > 0.5 && !h.pre) { h.pre = true; fx.emojiPop(world, { x: n.x, y: 0.9, z: n.z }, '❗'); }
      if (h.t >= 1.4) crack();
    } else if (h.phase === 'burst') {
      // safety net: the newborn was tapped / removed before its walk finished
      const baby = h.petId && actors.get(h.petId);
      if (h.t > 12 || (h.t > 1.5 && !baby)) { if (baby) baby.pinned = false; hatching = null; }
    }
  }

  function stepTemps(dt) {
    for (let i = temps.length - 1; i >= 0; i--) {
      const o = temps[i];
      o.t += dt;
      o.vy -= 9 * dt;
      o.mesh.position.x += o.vx * dt; o.mesh.position.z += o.vz * dt;
      o.mesh.position.y = Math.max(0.0, o.mesh.position.y + o.vy * dt);
      if (o.mesh.position.y <= 0.001) { o.vx *= 0.8; o.vz *= 0.8; o.vy = 0; }
      o.mesh.rotation.z += o.spin * dt;
      if (o.t > o.life) { world.scene.remove(o.mesh); temps.splice(i, 1); }
    }
  }

  // ── DOM events ─────────────────────────────────────────────────────────
  const handlers = {
    close: () => closeSheet(),
    back: () => { sheetMode = 'main'; refreshUi(); },
    feed: btn => { if (btn.dataset.petId) { sheetMode = 'feed'; refreshUi(); } },
    food: btn => {
      const petId = btn.dataset.petId;
      closeSheet();
      feedWith(petId, btn.dataset.itemId);
    },
    'tray-food': btn => {
      const id = btn.dataset.itemId;
      armedFood = armedFood === id ? null : id;
      refreshUi();
    },
    'put-egg': () => ctx.openEggPicker(),
    play: btn => careAction('play', btn.dataset.petId),
    bath: btn => careAction('bath', btn.dataset.petId),
    toy: btn => careAction('toy', btn.dataset.petId),
    heal: btn => careAction('heal', btn.dataset.petId),
    sleep: btn => careAction('sleep', btn.dataset.petId),
    gift: btn => careAction('gift', btn.dataset.petId),
    details: btn => ctx.openDetails(btn.dataset.petId),
  };
  const onClick = ev => {
    const btn = ev.target.closest('[data-b3]');
    if (!btn || !host.contains(btn) || btn.disabled) return;
    const fn = handlers[btn.dataset.b3];
    if (fn) fn(btn);
  };
  host.addEventListener('click', onClick);
  host.tabIndex = -1;
  const onKey = ev => {
    if (ev.key !== 'Escape' || !selected || document.body.classList.contains('modal-open')) return;
    ev.preventDefault();
    closeSheet();
  };
  document.addEventListener('keydown', onKey);

  // ── frame loop ─────────────────────────────────────────────────────────
  let uiTick = 0;
  let isOn = true;
  let frameFailed = false;
  const unFrame = world.onFrame((dt, t) => {
    if (frameFailed) return;
    try { frame(dt, t); } catch (err) {
      frameFailed = true;
      ctx.onFatal(err); // list view + console.error instead of a silently frozen scene
    }
  });

  function updateCameraPan(dt) {
    const sel = selected && actors.get(selected);
    const H = stage.clientHeight, W = stage.clientWidth;
    if (sel && !sheetEl.hidden && H > 0) {
      const sheetH = sheetEl.offsetHeight;
      const p = world.worldToScreen({ x: sel.x, y: sel.model.height * 0.55, z: sel.z });
      const unpanned = p.y + panPx;
      const wantY = Math.max(70, (H - sheetH) * 0.55);
      panTarget = Math.max(0, Math.min(H * 0.5, unpanned - wantY));
    } else panTarget = 0;
    if (Math.abs(panTarget - panPx) > 0.2) { panPx += (panTarget - panPx) * Math.min(1, dt * 9); world.boost(200); } else panPx = panTarget;
    if (Math.abs(panPx - panApplied) > 0.25) {
      panApplied = panPx;
      const cam = world.camera;
      if (panPx < 0.5) { panApplied = panPx = 0; cam.clearViewOffset(); } else cam.setViewOffset(W, H, 0, panPx, W, H);
      cam.updateProjectionMatrix();
    }
  }

  function frame(dt, t) {
    for (const A of actors.values()) {
      step(A, dt, t);
    }
    resolveCollisions(dt);
    for (const A of actors.values()) applyPose(A, t, dt);
    for (const [id, rec] of poopMeshes) {
      const s = rec.group.scale.x;
      if (s < 1) rec.group.scale.setScalar(Math.min(1, s + dt * 4));
    }
    animateNests(t, dt);
    stepHatch(dt);
    stepTemps(dt);
    // selection ring
    const sel = selected && actors.get(selected);
    if (sel) {
      ring.visible = true;
      ring.position.x = sel.x; ring.position.z = sel.z;
      const s = Math.max(0.7, sel.model.radius * 1.6) * (1 + Math.sin(t * 4) * 0.04);
      ring.scale.set(s, 1, s);
    } else ring.visible = false;
    updateCameraPan(dt);
    placeLabels();
    uiTick += dt;
    if (uiTick > 1) { uiTick = 0; updateNestLabels(); }
  }

  const unsub = subscribe(ev => {
    if (disposed || !isOn) return; // hidden: setActive(true) resyncs
    if (ev === 'change') sync(getState());
    else if (ev === 'tick') sync(getState()); // once a second: bubbles, nest readiness, stat bars
  });


  sync(getState());
  if (/[?&]debug=1/.test(location.search)) host.__b3debug = { world, actors: () => actors, tap: id => onTap(id) };

  return {
    setActive(on) {
      // Called from a MutationObserver in petsView (our own DOM updates trigger it): must be idempotent.
      if (disposed || on === isOn) return;
      isOn = !!on;
      world.setActive(isOn);
      if (isOn) sync(getState());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsub();
      unFrame();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      host.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      try { world.camera.clearViewOffset(); } catch { /* ignore */ }
      for (const tg of tags) tg.el.remove();
      try { world.dispose(); } catch (e) { console.error(e); }
      for (const o of owned) { try { o.dispose(); } catch { /* already disposed */ } }
      host.innerHTML = '';
    },
  };
  } catch (err) {
    try { world.dispose(); } catch { /* ignore */ }
    for (const o of owned) { try { o.dispose(); } catch { /* ignore */ } }
    host.innerHTML = '';
    throw err;
  }
}

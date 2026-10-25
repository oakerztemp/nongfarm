// The 3D living barn (CONTRACT_V4 §3). Mounted by petsView.js inside <div class="b3" data-morph="skip">.
// Everything here is cosmetic: positions / animations are never saved. Game changes only go through pets.js
// actions (via ctx.run, which also shows the usual toasts).
//
//   mountBarn3d(host, ctx) -> { setActive(bool), dispose() }
//
// ctx (from petsView.js): { run, esc, petSheetHtml(pet, state, mode), foodTrayHtml(state, pet, selectedId),
//                           openDetails(petId), openEggPicker(), onFatal(err),
//                           nurserySheetHtml(pet, state, opts), nurseryAdopt(id), nurserySwap(id), nurseryRehome(id),
//                           onHatchBlocked(), revealHatch(pet, toNursery), decor: { available(), openPicker(spot), ... } }

import { getState, subscribe, update } from '../state.js';
import { morph, now, notify, formatDuration } from '../util.js';
import { getSpecies } from '../data/species.js';
import { getEgg } from '../data/eggs.js';
import { getItem } from '../data/items.js';
import {
  getPet, petName, patPet, feedPet, playWithPet, cleanPet, giveToy, healPet, toggleSleep, claimGift, pickPoop,
  hatchReady, foodEffect, petGift, yardPreview, collectPetGift, collectYard, nurseryPets, NURSERY_SLOTS,
  strokePet, wearOf, wearAccessory, takeOffAccessory,
} from '../pets.js';
import { birthdayInfo, claimBirthday } from '../birthday.js';
import { journalEvent } from '../journal.js';
import { bindWeather } from '../weather.js';
import { savePhoto, downloadPhoto, sharePhoto as shareBlob, photoFilename } from '../album.js';
import { getAccessory } from '../data/accessories.js';
import { bestFriendMap, onBestFriend } from '../friends.js';
import { nextAction, bubbleFor, clampToYard, hashId, YARD, nestSpot, cribSpot, beginAction, advanceActor, angDiff,
  signatureFor, SIGNATURE_TYPES, ceremonyKind, partBases, applyPartPose, canStartCeremony,
  configureYard, yardProps, yardTierOf, DECOR_USE,
  favoriteSpot, createStroke, handStroke, tickStroke, strokeMelt, finishActorStroke, clearStrokeState, pickGiftLabels, GIFT_LABEL_MAX,
  pickFeedTarget, createFeedDrag, FEED_RANGE, greetingPlan, greetSpots,
  locomotionOf, shelterSpots, puddleSpots, isRainKind, partySpot } from '../petBehaviour.js';
import { createWorld, mergeStaticParts } from '../world3d/engine.js';
import * as fx from '../world3d/fx.js';
import { buildPetModel } from '../world3d/critters.js';

/** 🎂 today is the pet's N-month birthday: { isToday, months } (js/birthday.js). */
const bdayOf = pet => birthdayInfo(pet);
const birthdayToday = pet => { const i = bdayOf(pet); return i.isToday ? i.months : 0; };
const birthdayPending = pet => { const i = bdayOf(pet); return !!pet && i.isToday && pet.lastBirthdayGift !== i.months; };

const MAX_NESTS = 6;
const FLOAT_HOVER = 0.2;     // how high a bubble-floating water pet hovers
const HOLD_AFTER_TAP = 8;    // seconds a patted pet stays put even without the sheet
const SELECT_HOLD = 1e9;     // while the bottom sheet is open
const INITIAL_ZOOM = 0.85;
const TAU = Math.PI * 2;

// legendary aura colour per habitat (CONTRACT_V5)
const HABITAT_AURA = {
  mystic: '#b388ff', sky: '#ffd54f', water: '#4dd0e1', savanna: '#ffb300',
  forest: '#66bb6a', polar: '#b3e5fc', bug: '#2ecc71', farm: '#ffca28',
};
const FLY_TYPES = new Set(['flyCircle', 'soar']);
const RUN_TYPES = new Set(['gallop', 'sprint']);
const TRAIL_TYPES = new Set(['flyCircle', 'gallop']);
const smooth = u => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };
/** Optional fx primitive (aura, particles, trail, ...): a missing or failing one never breaks the barn. */
const fxo = (name, ...args) => {
  try { return typeof fx[name] === 'function' ? fx[name](...args) : null; } catch (err) { console.warn('fx.' + name + ' failed', err); return null; }
};

const ease = {
  outBack(u) { const x = Math.min(1, Math.max(0, u)); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; },
  outCubic(u) { return 1 - (1 - Math.min(1, Math.max(0, u))) ** 3; },
};
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const isBusyStatus = s => s === 'working' || s === 'expedition';

export function mountBarn3d(host, ctx) {
  host.innerHTML =
    '<div class="b3-stage"></div>' +
    '<div class="b3-top"><span class="b3-sign" hidden></span><div class="b3-top-r">' +
      '<button type="button" class="b3-chip b3-top-chip" data-b3="collect-all" hidden></button>' +
      '<button type="button" class="b3-photo-btn btn btn-sm" data-b3="photo" aria-label="ถ่ายรูป" title="ถ่ายรูปน้องๆ">📸</button>' +
      '<button type="button" class="b3-decor-btn btn btn-sm" data-b3="decor-mode" aria-pressed="false" hidden>🎀 ตกแต่ง</button>' +
      '<button type="button" class="b3-egg-btn btn btn-sm" data-b3="put-egg" hidden>🥚 ใส่ไข่</button></div></div>' +
    '<div class="b3-labels" aria-hidden="true"></div>' +
    '<div class="b3-hint" hidden></div>' +
    '<div class="b3-tray" role="group" aria-label="ถาดอาหาร"></div>' +
    '<div class="b3-sheet" role="dialog" aria-label="ข้อมูลน้อง" hidden></div>';
  const stage = host.querySelector('.b3-stage');
  const signEl = host.querySelector('.b3-sign');
  const eggBtn = host.querySelector('.b3-egg-btn');
  const chipEl = host.querySelector('.b3-chip');
  const decorBtn = host.querySelector('.b3-decor-btn');
  const labelsEl = host.querySelector('.b3-labels');
  const hintEl = host.querySelector('.b3-hint');
  const trayEl = host.querySelector('.b3-tray');
  const sheetEl = host.querySelector('.b3-sheet');

  let world;
  try {
    world = createWorld(stage, { onTap: id => { if (tapFn) tapFn(id); }, onTapGround: () => { if (groundFn) groundFn(); } },
      { yardTier: yardTierOf(getState().barnCapacity) });
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
  const giftEls = new Map();      // petId -> 🎁 label element (DOM: no draw calls)
  const cribs = new Map();        // nursery baby id -> crib record
  let selectedCrib = null;        // nursery baby whose sheet is open
  let decorMode = false;          // "🎀 ตกแต่ง": glowing spots are tappable
  const decorInst = new Map();    // placed decor id -> instance
  const spotActors = new Set();   // ids of the tappable spots
  const builtProps = new Set();   // yard prop ids already shown (only new ones pop in on an upgrade)
  const popQueue = [];            // props growing in after an upgrade

  const later = (ms, fn) => {
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
    timers.add(id);
  };

  // ── yard tiers: S / M / L / XL props, walk radius, "ลานกว้างขึ้น!" moment (CONTRACT_V6 §4) ──────────
  let yardTier = yardTierOf(getState().barnCapacity);
  let lanternMat = null;
  const hourIsNight = () => { const h = new Date().getHours(); return h >= 18 || h < 6; };

  /** Builds the static scenery of the current tier as a few merged / instanced props (<= +15 draw calls at XL). */
  function buildYardProps(tier, animate = false) {
    try { world.clearProps('yard-'); } catch { /* none yet */ }
    if (lanternMat) { lanternMat.dispose(); lanternMat = null; }
    const geos = [];
    const g = o => { geos.push(o); return o; };
    const cyl = (rt, rb, h, seg = 14) => g(new THREE.CylinderGeometry(rt, rb, h, seg));
    const sph = (r, ws = 10, hs = 8) => g(new THREE.SphereGeometry(r, ws, hs));
    const box = (w, h, d) => g(new THREE.BoxGeometry(w, h, d));
    const cone = (r, h, seg = 10) => g(new THREE.ConeGeometry(r, h, seg));
    const merged = (id, parts, pos, obstacle) => {
      const m = world.addMergedProp(`yard-${id}`, parts, { position: pos, obstacle });
      if (animate && m && !builtProps.has(id)) { // a prop the new tier adds: it pops up out of the grass
        m.scale.setScalar(0.001);
        popQueue.push({ mesh: m, t: -(0.5 + popQueue.length * 0.14), x: pos[0], z: pos[2], sparked: false });
      }
      builtProps.add(id);
      return m;
    };
    for (const pr of yardProps(tier)) {
      const pos = [pr.x, 0, pr.z];
      const obstacle = { x: pr.x, z: pr.z, r: pr.r };
      switch (pr.kind) {
        case 'pond':
          merged(pr.id, [
            { geometry: cyl(1.12, 1.18, 0.05, 20), color: '#b9a07a', position: [0, 0.025, 0] },
            { geometry: cyl(0.98, 0.98, 0.06, 20), color: '#5ec2ea', position: [0, 0.06, 0] },
            { geometry: cyl(0.2, 0.2, 0.02, 10), color: '#4caf50', position: [-0.35, 0.1, 0.25] },
            { geometry: cyl(0.15, 0.15, 0.02, 10), color: '#66bb6a', position: [0.3, 0.1, -0.3] },
            { geometry: sph(0.06), color: '#ff8fb1', position: [-0.35, 0.14, 0.25] },
          ], pos, obstacle);
          break;
        case 'tree':
          merged(pr.id, [
            { geometry: cyl(0.12, 0.17, 1.0, 8), color: '#8d5a34', position: [0, 0.5, 0] },
            { geometry: sph(0.75, 12, 8), color: '#4fae56', position: [0, 1.35, 0] },
            { geometry: sph(0.55, 12, 8), color: '#62c26a', position: [0.3, 1.85, 0.1] },
            { geometry: sph(0.4, 10, 8), color: '#7ad47f', position: [-0.25, 2.2, -0.1] },
          ], pos, obstacle);
          break;
        case 'flowerbed': {
          const parts = [{ geometry: cyl(0.85, 0.9, 0.1, 16), color: '#8a5d3b', position: [0, 0.05, 0] }];
          const cols = ['#ff6b8b', '#ffd84a', '#ffffff', '#b79bff', '#ff9f43'];
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * TAU, r = 0.25 + (i % 3) * 0.2;
            parts.push({ geometry: sph(0.1, 8, 6), color: cols[i % cols.length], position: [Math.cos(a) * r, 0.22, Math.sin(a) * r] });
            parts.push({ geometry: cyl(0.015, 0.015, 0.16, 5), color: '#3f9a45', position: [Math.cos(a) * r, 0.13, Math.sin(a) * r] });
          }
          merged(pr.id, parts, pos, obstacle);
          break;
        }
        case 'playground':
          merged(pr.id, [
            { geometry: cyl(0.95, 0.95, 0.06, 16), color: '#f0d9a0', position: [0, 0.03, 0] }, // sandy ground
            { geometry: box(0.1, 1.3, 0.1), color: '#d8574a', position: [-0.6, 0.65, -0.2], rotation: [0, 0, 0.12] },
            { geometry: box(0.1, 1.3, 0.1), color: '#d8574a', position: [-0.6, 0.65, 0.2], rotation: [0, 0, 0.12] },
            { geometry: box(0.1, 1.3, 0.1), color: '#d8574a', position: [0.6, 0.65, -0.2], rotation: [0, 0, -0.12] },
            { geometry: box(0.1, 1.3, 0.1), color: '#d8574a', position: [0.6, 0.65, 0.2], rotation: [0, 0, -0.12] },
            { geometry: box(1.4, 0.08, 0.08), color: '#8d5a34', position: [0, 1.3, 0] },
            { geometry: box(0.03, 0.9, 0.03), color: '#cfcfcf', position: [-0.2, 0.85, 0] },
            { geometry: box(0.03, 0.9, 0.03), color: '#cfcfcf', position: [0.2, 0.85, 0] },
            { geometry: box(0.5, 0.06, 0.2), color: '#4d96ff', position: [0, 0.4, 0] },
          ], pos, obstacle);
          break;
        case 'hill':
          merged(pr.id, [
            { geometry: sph(1.3, 18, 10), color: '#7fcf6b', position: [0, -0.7, 0], scale: [1, 0.55, 1] },
            { geometry: cyl(0.65, 0.65, 0.06, 12), color: '#f1e6cc', position: [0, 0.1, 0] },
            ...[0, 1, 2, 3, 4, 5].map(i => ({ geometry: cyl(0.05, 0.05, 0.85, 6), color: '#ffffff', position: [Math.cos((i / 6) * TAU) * 0.58, 0.55, Math.sin((i / 6) * TAU) * 0.58] })),
            { geometry: cone(0.82, 0.55, 6), color: '#d8574a', position: [0, 1.25, 0] },
            { geometry: sph(0.07), color: '#ffd84a', position: [0, 1.58, 0] },
          ], [pr.x, 0.55, pr.z], obstacle);
          break;
        case 'lantern': {
          // poles are merged below; the glowing tops are instanced (own material, see dayNight)
          break;
        }
        default: break;
      }
    }
    const lanterns = yardProps(tier).filter(p => p.kind === 'lantern');
    if (lanterns.length) {
      world.addMergedProp('yard-lantern-poles', lanterns.map(l => ({ geometry: cyl(0.04, 0.05, 1.1, 6), color: '#5a4636', position: [l.x, 0.55, l.z] })), {});
      lanternMat = new THREE.MeshBasicMaterial({ color: hourIsNight() ? 0xffd966 : 0xfff1c9 });
      world.addInstancedProp('yard-lantern-glow', new THREE.SphereGeometry(0.14, 8, 6),
        lanterns.map(l => ({ position: [l.x, 1.18, l.z] })), { material: lanternMat, ownGeometry: true });
    }
    // sources were cloned by mergeStaticParts: free them now
    for (const geo of geos) geo.dispose();
  }

  /** Switch the scenery / walk radius to the tier of the new capacity (animated when the player upgrades). */
  function applyYardTier(tier, animate) {
    const old = yardTier;
    yardTier = tier;
    configureYard(tier);
    world.setYardTier(tier, { animate });
    buildYardProps(tier, animate);
    if (nestCount) buildNests(nestCount); // the nest row follows the barn
    spotSig = '';                         // decor spots of the new tier
    if (!animate) return;
    world.boost(3200);
    const A0 = { x: 0, y: 1.2, z: 0 };
    fx.confetti(world, A0, 60);
    fx.sparkleAt(world, A0);
    // the fence moves outward into the wild: confetti along the new fence, the wild props sink away (engine)
    const fr = world.fenceRadius || 6;
    for (let k = 0; k < 6; k++) later(120 + k * 140, () => fx.confetti(world, { x: Math.cos(k / 6 * TAU + 0.5) * fr, y: 0.7, z: Math.sin(k / 6 * TAU + 0.5) * fr }, 14));
    showBanner(`🎉 ลานกว้างขึ้น! (${old} → ${tier})`);
  }

  function showBanner(text) {
    const el = document.createElement('div');
    el.className = 'b3-banner';
    el.textContent = text;
    host.appendChild(el);
    later(2600, () => el.remove());
  }

  configureYard(yardTier);

  // ── static props ──────────────────────────────────────────────────────
  const bowl = new THREE.Group();
  {
    const b = new THREE.Mesh(G.bowl, toon(0xb86a3d)); b.position.y = 0.11;
    const f = new THREE.Mesh(G.food, toon(0xe9c46a)); f.position.y = 0.23;
    bowl.add(b, f);
    bowl.position.set(YARD.bowl.x, 0, YARD.bowl.z);
    world.addActor('bowl', bowl, { radius: 0.5, height: 0.35, shadowScale: 0.9, stroke: false });
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

  /** Where the head / chin start on a model (heights above its feet): the engine uses them to tell head from chin from back. */
  function strokeDims(model, holder) {
    const h = Math.max(0.5, model.height);
    if (model.kind === 'billboard') return { billboard: true };
    try {
      if (model.head) {
        holder.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(model.head);
        if (Number.isFinite(bb.min.y) && Number.isFinite(bb.max.y) && bb.max.y > bb.min.y) {
          return { headY: bb.min.y + (bb.max.y - bb.min.y) * 0.12, chinY: Math.max(h * 0.18, bb.min.y * 0.45) };
        }
      }
    } catch { /* default split */ }
    return {};
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
      pinned: false,
      deco: [], trail: null, selTag: null, hidden: !!opts.hidden, scripted: false, partBase: null, puffAt: 8 + Math.random() * 8, waveAt: 5 + Math.random() * 6, sparkleAt: 4 + Math.random() * 8,
      gift: null, decorId: null,
      loco: locomotionOf(pet.speciesId), sideDir: hashId(pet.id + 'side') % 2 ? 1 : -1, speedMod: 1, wearObjs: [], wearSig: '', partyHat: false, bday: 0,
      squint: 0, stroke: null, strokeMelt: 0, strokeSide: hashId(pet.id) % 2 ? 1 : -1, strokePoint: null, strokeAt: 0, strokeEnd: null, popAt: 0.3, feedLook: null, greeting: false,
    };
    A.partBase = partBases(model.parts);
    applyWear(A);
    if (opts.spawn) A.spawn = { t: 0, dur: opts.spawn.dur || 0.7, arc: opts.spawn.arc ?? 0.5, drop: opts.spawn.drop || 0, from: opts.spawn.from || null };
    if (A.hidden) holder.visible = false;
    world.addActor(pet.id, holder, { radius: Math.max(0.35, model.radius), height: Math.max(0.5, model.height), stroke: strokeDims(model, holder) });
    actors.set(pet.id, A);
    if (!A.hidden) decorate(A);
    return A;
  }

  function rebuildModel(A, pet) {
    const grew = pet.stage > A.stage;
    A.holder.remove(A.model.root);
    A.model = buildModel(pet);
    A.holder.add(A.model.root);
    A.headBase = A.model.head ? A.model.head.rotation.clone() : null;
    A.sig = modelSig(pet);
    A.partBase = partBases(A.model.parts);
    applyWear(A);
    world.addActor(A.id, A.holder, { radius: Math.max(0.35, A.model.radius), height: Math.max(0.5, A.model.height), stroke: strokeDims(A.model, A.holder) });
    if (A.bubble) { const e = A.bubbleEmoji; A.bubble = null; A.bubbleEmoji = ''; setBubble(A, e); }
    if (!A.hidden) decorate(A);
    if (grew) {
      A.spawn = { t: 0, dur: 0.6, arc: 0.35, from: null };
      fx.sparkle(world, A.id);
      fx.confetti(world, headPos(A), 12);
      A.stage = pet.stage;
    }
    A.stage = pet.stage;
  }

  const lowTier = () => (world.tier || (world.getStats ? world.getStats().tier : '')) === 'low';
  /** Legendary aura + particles, shiny billboard halo + twinkle (no colour filters). Tier `low` keeps it calm. */
  function decorate(A) {
    undecorate(A);
    const sp = getSpecies(A.pet.speciesId);
    const rar = sp && sp.rarity;
    const low = lowTier();
    if (rar === 'legendary') {
      A.deco.push(fxo('aura', world, A.id, { color: HABITAT_AURA[sp.habitat] || '#ffd54f', intensity: 1 }));
      if (!low) A.deco.push(fxo('particles', world, A.id, { kind: A.pet.speciesId === 'dragon' ? 'embers' : 'motes', rate: 5 }));
    }
    const billboard = A.model.kind === 'billboard' || A.model.shinyStyle === 'halo';
    if (A.pet.shiny && billboard) {
      A.deco.push(fxo('glowHalo', world, A.id, { color: '#ffe27a' }));
      if (!low) A.deco.push(fxo('twinkle', world, A.id));
    }
  }

  function undecorate(A) {
    for (const h of A.deco) if (h && typeof h.remove === 'function') { try { h.remove(); } catch { /* gone */ } }
    A.deco.length = 0;
    stopTrail(A);
  }

  function stopTrail(A) {
    if (A.trail && typeof A.trail.remove === 'function') { try { A.trail.remove(); } catch { /* gone */ } }
    A.trail = null;
  }

  function removeActorRec(A) {
    clearStrokeState(A);
    releaseDecor(A);
    clearWear(A);
    const ge = giftEls.get(A.id);
    if (ge) { ge.remove(); giftEls.delete(A.id); }
    undecorate(A);
    dropTag(A.selTag); A.selTag = null;
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
    releaseDecor(A);
    A.act = beginAction(act);
    A.last = act.type === 'walkTo' ? 'wander' : (act.type === 'decor' || act.type === 'buddy') ? (act.nap ? 'sleep' : act.type) : act.type;
    if (act.type === 'decor') claimDecor(A, act);
  }

  function decide(A) {
    if (A.greeting) { begin(A, { type: 'lookAtCamera', dur: 2 }); return; }
    if (A.hold > 0) { begin(A, { type: 'idle', dur: Math.min(1.5, A.hold), reason: 'hold' }); return; }
    const others = [];
    let awake = 0, napping = 0, joiners = 0;
    for (const o of actors.values()) {
      if (o.hidden) continue;
      if (o.pet.status !== 'sleeping') { awake++; if (o !== A && o.act.nap) napping++; }
      if (o !== A && o.act.type === 'party' && !o.act.host) joiners++;
      if (o === A) continue;
      const tg = (o.act.type === 'wander' || o.act.type === 'approach' || o.act.type === 'walkTo') ? o.act.target : null;
      others.push({ id: o.id, x: o.x, z: o.z, tx: tg ? tg.x : undefined, tz: tg ? tg.z : undefined });
    }
    const napRatio = awake > 0 ? napping / awake : 0;
    const fr = friendOf(A);
    const act = nextAction(A.pet, { x: A.x, z: A.z, others, last: A.last, napRatio, decor: decorList(), size: A.model.radius, friend: fr, friendId: fr && fr.id,
      party: party && (A.id === party.petId || A.act.type === 'party' || joiners < 6) ? { x: party.x, z: party.z, hostId: party.petId } : null,
      rain: rainSt ? { puddles: rainSt.puddles, shelters: rainSt.shelters } : null }, Math.random, now());
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
    P.hPitch = 0; P.hYaw = 0; P.hRoll = 0; P.tail = 0; P.scale = 1; P.wing = 0; P.tailTip = 0; P.trunk = 0; P.mane = 0; P.shell = 0; P.fluke = 0; P.lift = 0;
    if (A.hold > 0 && A.hold < SELECT_HOLD / 2) A.hold = Math.max(0, A.hold - dt);
    if (A.hidden) { if (A.stroke || A.strokeMelt) clearStrokeState(A); return P; } // a newborn waiting for its hatch ceremony

    // pop-in (hatching, returning from work, growing up)
    if (A.spawn) {
      const S = A.spawn;
      S.t += dt;
      const u = Math.min(1, S.t / S.dur);
      P.scale = Math.max(0.02, ease.outBack(u));
      P.hop = S.drop ? S.drop * (1 - ease.outCubic(u)) : Math.sin(u * Math.PI) * S.arc;
      if (u >= 1) { A.spawn = null; if (A.onSpawned) { const f = A.onSpawned; A.onSpawned = null; f(A); } }
      A.curl = 0;
      return P;
    }

    if (A.stroke) tickStroke(A.stroke, dt);
    const stroking = !!A.stroke || A.strokeMelt > 0.001;
    const act = A.act;
    const sleeping = pet.status === 'sleeping';
    const held = A.hold > 0 && !A.greeting && act.type !== 'eat' && act.type !== 'no' && act.type !== 'hop' && act.type !== 'play' && act.type !== 'bathe';
    if (held && (act.type === 'wander' || act.type === 'approach' || act.type === 'walkTo' || FLY_TYPES.has(act.type) || RUN_TYPES.has(act.type) || act.type === 'decor' || act.type === 'party' || act.type === 'puddle' || act.type === 'shelter')) begin(A, { type: 'idle', dur: 1 });
    if (!TRAIL_TYPES.has(A.act.type) && A.trail) stopTrail(A);
    A.scripted = FLY_TYPES.has(A.act.type) || RUN_TYPES.has(A.act.type);

    let curlTarget = sleeping || (A.act.type === 'sleep' && A.act.nap) || (A.act.type === 'decor' && A.act.use === 'nap' && A.act.arrived) || (A.act.type === 'buddy' && A.act.mode === 'nap' && A.act.arrived) ? 1 : 0;
    if (!sleeping && pet.sick) curlTarget = 0;
    // timers, walking and "action finished -> decide()" live in petBehaviour.advanceActor (unit-tested)
    A.speedMod = A.loco.kind === 'hop' ? Math.max(0.08, 3 * Math.max(0, Math.sin(A.phase * 0.7))) : 1;   // a frog moves in hops
    const moving = stroking ? false : advanceActor(A, dt, decide).moving;

    if (stroking) strokePose(A, P, t, dt);
    else switch (A.act.type) {
      case 'wander': case 'approach': case 'walkTo': break;
      case 'buddy': buddyPose(A, P, t, dt); break;
      case 'flyCircle': case 'soar': flightPose(A, P, t); break;
      case 'gallop': case 'sprint': runPose(A, P, t, dt); break;
      case 'breach': breachPose(A, P); break;
      case 'roar': roarPose(A, P, t); break;
      case 'munch': munchPose(A, P, t); break;
      case 'snowPuff': snowPose(A, P, t); break;
      case 'shimmer': shimmerPose(A, P, t); break;
      case 'flourish': flourishPose(A, P); break;
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
      case 'wave': { // a pet whose gift is full waves at you
        A.heading += angDiff(A.heading, faceCam(A)) * Math.min(1, dt * 6);
        const u = A.act.t;
        P.roll = Math.sin(u * 12) * 0.2; P.hop = Math.max(0, Math.sin(u * 6)) * 0.2; P.wing = Math.sin(u * 16) * 0.5; P.tail = Math.sin(u * 20) * 0.6;
        break;
      }
      case 'decor': decorPose(A, P, t, dt); break;
      case 'party': partyPose(A, P, t, dt); break;
      case 'puddle': puddlePose(A, P, t, dt); break;
      case 'shelter': shelterPose(A, P, t, dt); break;
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

    if (A.feedLook && !stroking) feedLookPose(A, P, t, dt);
    // blink (eyes are tiny groups; skip while sleeping)
    A.curl += (curlTarget - A.curl) * Math.min(1, dt * 3.2);
    if (moving) {
      const w = Math.abs(Math.sin(A.phase));
      P.hop = w * 0.11;
      P.sy = 0.93 + 0.13 * w; P.sx = 1.05 - 0.07 * w;
      P.roll = Math.sin(A.phase) * 0.07;
      P.tail = Math.sin(A.phase * 2) * 0.45;
    }
    // water critters (CONTRACT_V9 §6): sideways scuttle, frog hops, slow turtle, bubble float, shells that open and close
    const lo = A.loco;
    if (lo.kind !== 'walk') {
      if (moving) {
        if (lo.kind === 'hop') { const s = Math.max(0, Math.sin(A.phase * 0.7)); P.hop = s * 0.3; P.sy = 0.9 + 0.22 * s; P.sx = 1.06 - 0.08 * s; P.roll = 0; }
        else if (lo.kind === 'side') { P.hop = Math.abs(Math.sin(A.phase * 2)) * 0.04; P.roll = Math.sin(A.phase * 2) * 0.05; P.sy = 1; P.sx = 1; }
        else if (lo.kind === 'slow') { P.hop = Math.abs(Math.sin(A.phase)) * 0.025; P.sy = 0.99; P.roll = Math.sin(A.phase) * 0.04; }
      }
      if (lo.kind === 'float') { // fully aquatic: hovers and bobs inside its bubble, never squashes or hops on the ground
        P.lift = FLOAT_HOVER + Math.sin(t * 1.7 + A.seed) * 0.07 + P.hop * 0.4; P.hop = 0;
        P.sy = 1 + (P.sy - 1) * 0.3; P.sx = 1 + (P.sx - 1) * 0.3;
        P.roll = Math.sin(t * 1.2 + A.seed) * 0.07 + P.roll * 0.3;
        P.pitch = (moving ? -0.12 : Math.sin(t * 0.8 + A.seed) * 0.05) + P.pitch * 0.4;
        P.tail = Math.sin(t * 3 + A.seed) * 0.35;
      } else if (lo.kind === 'shell') {
        P.shell = smooth(Math.sin(t * 0.45 + A.seed) * 1.7 + 0.4);
        if (!(A.model.parts && (A.model.parts.lid || A.model.parts.shell))) P.sy *= 0.97 + 0.04 * P.shell;
      }
    }
    // part flavour (only has an effect on models that own the part)
    P.tailTip = moving ? Math.sin(A.phase * 2.2) * 0.55 : Math.sin(t * 1.6 + A.seed) * 0.16;
    if (A.act.type === 'idle' || A.act.type === 'lookAtCamera') P.trunk = Math.sin(t * 0.9 + A.seed) * 0.12;
    const c = A.curl;
    if (c > 0.001) {
      P.sy *= 1 - 0.34 * c; P.sx *= 1 + 0.1 * c; P.hPitch += 0.55 * c; P.roll += 0.1 * c; P.hop *= 1 - c;
    }
    if (pet.sick) { P.sy *= 0.96; }
    return P;
  }

  // ── signature moves (legendary full size, epic `small`) ────────────────
  const at = (act, key, time) => { if (act.t >= time && !act[key]) { act[key] = 1; return true; } return false; };
  const popAt = (A, emoji, dx = 0, dy = 0) => fxo('emojiPop', world, { x: A.x + dx, y: A.y + A.model.height * 0.8 + dy, z: A.z }, emoji);

  /** Fire puff from the model's `breath` anchor (falls back to the head). Calm tiers skip it. */
  function breathPuff(A) {
    if (lowTier()) return;
    const anchor = A.model.parts && A.model.parts.breath;
    let pos = headPos(A);
    if (anchor && typeof anchor.getWorldPosition === 'function') {
      A.holder.updateMatrixWorld(true);
      const v = anchor.getWorldPosition(new THREE.Vector3());
      if (Number.isFinite(v.x + v.y + v.z)) pos = v;
    }
    fxo('emojiPop', world, pos, '🔥');
    fxo('sparkleAt', world, pos);
  }

  /** Water spout from the model's `spout` anchor (falls back to a splash above the head). */
  function spoutPuff(A) {
    const anchor = A.model.parts && A.model.parts.spout;
    if (anchor && typeof anchor.getWorldPosition === 'function') {
      A.holder.updateMatrixWorld(true);
      const v = anchor.getWorldPosition(new THREE.Vector3());
      if (Number.isFinite(v.x + v.y + v.z)) { fxo('emojiPop', world, v, '💦'); fxo('emojiPop', world, { x: v.x, y: v.y + 0.35, z: v.z }, '🌊'); return; }
    }
    popAt(A, '💦', 0.3, -0.2);
  }

  /** dragon / eagle: take off, fly a slow circle above the yard, land. */
  function flightPose(A, P, t) {
    const act = A.act, soar = act.type === 'soar', k = act.small ? 0.5 : 1;
    if (!act.init) {
      const a0 = Math.hypot(A.x, A.z - 0.2) > 0.6 ? Math.atan2(A.z - 0.2, A.x) : Math.random() * TAU;
      act.init = { x: A.x, z: A.z, a0, dir: Math.random() < 0.5 ? 1 : -1 };
      if (!soar && !act.small && !lowTier() && !A.trail) {
        A.trail = fxo('trail', world, A.id, { colors: ['#ff3d00', '#ff9100', '#ffd740'], width: 0.4, length: 26 });
      }
      if (!soar) breathPuff(A);
    }
    const I = act.init, up = 1.3, down = 1.5, T = act.dur;
    const R = (soar ? 2.7 : 2.3) * k + 0.3, om = soar ? 0.55 : 0.85, H = (soar ? 2.3 : 1.7) * k;
    const ang = I.a0 + I.dir * om * act.t;
    const cx = Math.cos(ang) * R, cz = 0.2 + Math.sin(ang) * R;
    const takeoff = smooth(act.t / up), land = smooth((T - act.t) / down), lift = Math.min(takeoff, land);
    A.x = I.x + (cx - I.x) * takeoff; A.z = I.z + (cz - I.z) * takeoff;
    const tx = -Math.sin(ang) * I.dir, tz = Math.cos(ang) * I.dir;
    A.heading += angDiff(A.heading, Math.atan2(tx, tz)) * Math.min(1, 0.2);
    P.hop = H * lift + Math.sin(t * 2.1) * 0.1 * lift;
    P.pitch = 0.2 * lift; P.roll = -I.dir * 0.32 * lift;
    P.wing = Math.sin(t * (soar ? 5 : 13)) * (soar ? 0.35 : 0.75) * lift;
    P.tail = Math.sin(t * 5) * 0.4 * lift;
  }

  /** unicorn gallop loop with a rainbow trail + rear up, racehorse sprint lap. */
  function runPose(A, P, t, dt) {
    const act = A.act, sprint = act.type === 'sprint', k = act.small ? 0.7 : 1;
    const R = sprint ? 2.5 : 2.0, speed = (sprint ? 5.4 : 3.6) * k, lead = 0.6;
    if (!act.init) {
      const a0 = Math.hypot(A.x, A.z - 0.3) > 0.6 ? Math.atan2(A.z - 0.3, A.x) : Math.random() * TAU;
      act.init = { x: A.x, z: A.z, a0, dir: Math.random() < 0.5 ? 1 : -1 };
      if (!sprint && !act.small && !lowTier() && !A.trail) {
        A.trail = fxo('trail', world, A.id, { colors: ['#ff5252', '#ffb74d', '#fff176', '#81c784', '#64b5f6', '#ba68c8'], width: 0.45, length: 30 });
      }
    }
    const I = act.init;
    const runT = Math.max(1, Math.min((sprint ? 1.05 : 1.1) * TAU * R / speed, act.dur - lead - 1.2));
    const tt = Math.min(act.t, lead + runT);
    const ang = I.a0 + I.dir * (speed / R) * Math.max(0, tt);
    const cx = Math.cos(ang) * R, cz = 0.3 + Math.sin(ang) * R;
    const blend = smooth(tt / lead);
    A.x = I.x + (cx - I.x) * blend; A.z = I.z + (cz - I.z) * blend;
    if (act.t < lead + runT) {
      A.heading += angDiff(A.heading, Math.atan2(-Math.sin(ang) * I.dir, Math.cos(ang) * I.dir)) * Math.min(1, dt * 10);
      const b = Math.abs(Math.sin(act.t * 9));
      P.hop = b * 0.15; P.sy = 0.95 + 0.1 * b; P.pitch = 0.1; P.roll = -I.dir * 0.08; P.tail = Math.sin(t * 20) * 0.5;
      if (sprint && act.t > lead && Math.floor(act.t * 3) !== act.puff) { act.puff = Math.floor(act.t * 3); popAt(A, '💨', 0, -0.3); }
    } else {
      const u = (act.t - lead - runT) / Math.max(0.1, act.dur - lead - runT);
      const rear = Math.sin(Math.min(1, u * 1.25) * Math.PI);
      if (!sprint) { P.pitch = -0.8 * rear; P.hop = 0.22 * rear; if (at(act, 'rearPop', lead + runT + 0.1)) { popAt(A, '🌈', 0, 0.2); fxo('sparkle', world, A.id); } }
      else { P.pitch = -0.15 * rear; P.sy = 1 - 0.05 * rear; if (at(act, 'stopPop', lead + runT + 0.05)) popAt(A, '💨', 0, -0.2); }
    }
  }

  /** humpback: breach with a splash. */
  function breachPose(A, P) {
    const act = A.act, k = act.small ? 0.5 : 1;
    const u = Math.min(1, Math.max(0, (act.t - 0.3) / 1.4));
    if (act.t < 0.3) { P.sy = 0.88; P.sx = 1.08; return; }
    P.hop = Math.sin(u * Math.PI) * 1.7 * k;
    P.pitch = -0.7 + 1.4 * u;
    P.sy = 1 + 0.12 * Math.sin(u * Math.PI);
    if (A.model.parts && A.model.parts.fluke) P.fluke = Math.sin(u * Math.PI * 2) * 0.7; // whale tail fluke swing
    if (at(act, 'splash1', 0.35)) popAt(A, '💦', 0, -0.2);
    if (at(act, 'splash2', 1.7)) { spoutPuff(A); popAt(A, '🌊', -0.3, -0.1); }
  }

  /** lion & co: head up, roar bubble, a tiny shake. */
  function roarPose(A, P, t) {
    const act = A.act, k = act.small ? 0.6 : 1;
    const r = smooth(act.t / 0.4) * smooth((act.dur - act.t) / 0.4);
    A.heading += angDiff(A.heading, Math.atan2(camPos.x - A.x, camPos.z - A.z)) * 0.1;
    P.hPitch = -0.55 * r * k; P.pitch = -0.12 * r * k; P.sy = 1 + 0.05 * r;
    P.shake = Math.sin(t * 46) * 0.02 * r * k;
    const pr = A.model.parts || {};
    if (pr.mane) P.mane = Math.sin(t * 38) * 0.14 * r;        // lion: mane shake
    if (pr.trunk) P.trunk = -0.75 * r;                         // mammoth: trunk raised
    if (at(act, 'bub', 0.45)) { popAt(A, pr.trunk ? '🎺' : '🗯️', 0, 0.3); if (!act.small) fxo('sparkle', world, A.id); }
  }

  /** panda: sits and munches bamboo. */
  function munchPose(A, P, t) {
    const act = A.act;
    const sit = smooth(act.t / 0.5) * smooth((act.dur - act.t) / 0.5);
    P.sy = 1 - 0.2 * sit; P.sx = 1 + 0.08 * sit; P.pitch = -0.2 * sit;
    P.hPitch = (0.25 + Math.sin(t * 12) * 0.1) * sit;
    if (at(act, 'b1', 0.3)) popAt(A, '🎋', 0.2, 0);
    if (at(act, 'b2', 2.6)) popAt(A, '🎋', -0.2, 0);
  }

  /** polar bear: shakes a puff of snow. */
  function snowPose(A, P, t) {
    const act = A.act;
    const s = smooth(act.t / 0.3) * smooth((act.dur - act.t) / 0.3);
    P.roll = Math.sin(t * 18) * 0.12 * s; P.hop = Math.max(0, Math.sin(t * 9)) * 0.08 * s;
    if (at(act, 's1', 0.3)) popAt(A, '🌨️', 0, 0.2);
    if (at(act, 's2', 1.0)) popAt(A, '❄️', 0.4, 0);
    if (at(act, 's3', 1.7)) popAt(A, '❄️', -0.4, 0.1);
  }

  /** beetle / peacock: shimmering wing flick. */
  function shimmerPose(A, P, t) {
    const act = A.act;
    const f = act.t > 0.3 && act.t < 1.7 ? 1 : 0;
    const open = smooth((act.t - 0.15) / 0.3) * smooth((act.dur - 0.2 - act.t) / 0.3); // shell halves swing open and shut
    P.wing = (0.55 * open + Math.sin(t * 30) * 0.35 * f) * (A.pet.speciesId === 'beetle' ? 1 : 0.6);
    P.sy = 1 + 0.06 * Math.sin(t * 20) * f; P.sx = 1 + 0.06 * Math.sin(t * 20) * f;
    if (at(act, 'sp1', 0.4)) fxo('sparkle', world, A.id);
    if (at(act, 'sp2', 1.2)) { fxo('sparkle', world, A.id); popAt(A, '✨', 0, 0.1); }
  }

  /** generic epic flourish: a couple of hops and a sparkle. */
  function flourishPose(A, P) {
    const act = A.act;
    const per = act.dur / 2, h = Math.sin(((act.t % per) / per) * Math.PI);
    P.hop = h * 0.3; P.sy = 1 + 0.1 * h;
    if (at(act, 'sp', 0.2)) fxo('sparkle', world, A.id);
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
    m.body.position.y = P.lift || 0;   // bubble swimmers float by lifting the body (root, shadow and picking stay on the ground)
    if (m.head && A.headBase) m.head.rotation.set(A.headBase.x + P.hPitch, A.headBase.y + P.hYaw, A.headBase.z + P.hRoll);
    applyPartPose(m.parts, A.partBase, P); // wings, tail, tailTip, trunk, mane (each optional)
    // blink / closed eyes
    const eyes = m.parts && m.parts.eyes;
    if (eyes && eyes.length) {
      A.blinkAt -= dt;
      if (A.blinkAt < 0) { A.blink = 0.13; A.blinkAt = 2.5 + Math.random() * 4; }
      if (A.blink > 0) A.blink -= dt;
      const closed = A.curl > 0.55 || A.blink > 0 ? 0.12 : A.squint > 0.5 ? 0.3 : 1;
      for (const e of eyes) e.scale.y = closed;
    }
  }

  function resolveCollisions(dt) {
    const list = [...actors.values()];
    const obstacles = world.obstacles || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.hidden) continue;
      const ra = a.model.radius * 0.8;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.hidden || a.scripted || b.scripted) continue; // flying / galloping pets pass over the crowd
        const hard = (ra + b.model.radius * 0.8);
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        // soft personal space (a gentle drift apart) on top of the hard minimum distance
        const soft = hard * 1.35 + 0.15;
        const min = d < hard ? hard : soft;
        if (d >= min) continue;
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        const push = d < hard ? (hard - d) : (soft - d) * Math.min(1, dt * 1.6);
        const aFixed = a.pinned || a.pet.status === 'sleeping' || a.hold > 0 || ((a.act.type === 'decor' || a.act.type === 'buddy' || a.act.type === 'shelter' || (a.act.type === 'party' && a.act.host)) && a.act.arrived);
        const bFixed = b.pinned || b.pet.status === 'sleeping' || b.hold > 0 || ((b.act.type === 'decor' || b.act.type === 'buddy' || b.act.type === 'shelter' || (b.act.type === 'party' && b.act.host)) && b.act.arrived);
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
      for (const n of cribs.values()) {
        const d = dist2(a.x, a.z, n.x, n.z), min = 0.7 + ra * 0.5;
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
      world.addActor(n.id, g, { radius: 0.75, height: 0.9, shadowScale: 0.85, stroke: false });
      nests.push(n);
      const label = document.createElement('div');
      label.className = 'b3-label';
      label.hidden = true;
      labelsEl.appendChild(label);
      labelEls.set(n.id, label);
    }
  }

  // The ceremony owns its nest's egg only until the egg bursts; after that the next egg
  // (shifted into this slot by hatchReady) must show up and be tappable right away.
  function ceremonyOwnsNest(i) {
    return !!hatching && hatching.nest === i && hatching.phase !== 'burst' && hatching.phase !== 'done';
  }

  function syncNests(state) {
    const want = Math.max(1, Math.min(MAX_NESTS, Number(state.incubatorCapacity) || 1));
    if (want !== nestCount) buildNests(want);
    const t = now();
    for (const n of nests) {
      const slot = state.incubator[n.i];
      const key = slot ? `${slot.eggId}` : '';
      if (key !== n.eggKey && !ceremonyOwnsNest(n.i)) {
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
      const wantBubble = !photo && n.ready && !ceremonyOwnsNest(n.i);
      if (wantBubble) fx.bubble(world, n.id, '🐣'); else fx.clearBubble(world, n.id);
    }
  }

  function updateNestLabels() {
    const t = now();
    for (const n of nests) {
      const el = labelEls.get(n.id);
      if (!el) continue;
      let text = '';
      if (ceremonyOwnsNest(n.i)) text = '';
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
    for (const [id, el] of giftEls) {
      const A = actors.get(id);
      if (!A) continue;
      const p = world.worldToScreen({ x: A.x, y: A.y + A.model.height + (A.bubble ? 1.0 : 0.6), z: A.z });
      el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
      el.style.visibility = p.visible ? 'visible' : 'hidden';
    }
    for (let i = tags.length - 1; i >= 0; i--) {
      const tg = tags[i];
      const A = actors.get(tg.petId);
      if (!A || performance.now() > tg.until) { tg.el.remove(); tags.splice(i, 1); if (A && A.selTag === tg) A.selTag = null; continue; }
      const p = world.worldToScreen({ x: A.x, y: A.y + A.model.height + 0.95, z: A.z });
      tg.el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -100%)`;
    }
  }

  function animateNests(t, dt) {
    for (const n of nests) {
      const egg = n.egg;
      if (!egg) continue;
      if (ceremonyOwnsNest(n.i)) continue; // the ceremony drives this egg
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
          world.addActor(id, g, { radius: 0.34, height: 0.4, shadowScale: 0.5, stroke: false });
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
          // the real hatchReady() result: the newborn exists now but stays hidden until the ceremony reveals it
          hatching.petId = pet.id;
          const n = nests[hatching.nest];
          A = createActor(pet, { at: n ? { x: n.x, z: n.z + 0.5 } : null, hidden: true });
          A.pinned = true;
        } else {
          const edge = synced ? clampToYard(-2.6, 3.0) : null;
          A = createActor(pet, synced ? { at: edge, spawn: { dur: 0.5, arc: 0.3 } } : {});
        }
      } else if (A.sig !== modelSig(pet)) {
        A.pet = pet;
        rebuildModel(A, pet);
      }
      A.pet = pet;
      if (A.hidden) continue;
      if (A.wearSig !== wearSigOf(A)) applyWear(A);
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
      const napping = !!A.act.nap && (A.act.type === 'sleep' || !!A.act.arrived);
      setBubble(A, photo ? '' : b ? b.emoji : napping ? '💤' : birthdayPending(pet) ? '🎂' : '');   // no thought bubbles in a photo
    }
    for (const A of [...actors.values()]) {
      if (!present.has(A.id)) {
        if (selected === A.id) closeSheet();
        removeActorRec(A);
        poopSpots.delete(A.id);
      }
    }
    const wantTier = yardTierOf(state.barnCapacity);
    if (wantTier !== yardTier) applyYardTier(wantTier, synced);
    if (lanternMat) lanternMat.color.set(hourIsNight() ? 0xffd966 : 0xfff1c9);
    syncFriends(state);
    syncBirthday(state);
    syncPoops(state);
    syncNests(state);
    syncCribs(state);
    syncGifts(state);
    syncDecor(state);
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
    let pet = selected ? getPet(state, selected) : null;
    const baby = !pet && selectedCrib ? nurseryPets(state).find(p => p.id === selectedCrib) : null;
    if (selectedCrib && !baby) selectedCrib = null;
    if (pet || baby) {
      pet = pet || baby;
      const opening = sheetEl.hidden;
      sheetEl.hidden = false;
      setHtml(sheetEl, baby ? ctx.nurserySheetHtml(baby, state, { reveal: revealId === baby.id }) : ctx.petSheetHtml(pet, state, sheetMode, { reveal: revealId === pet.id }), true);
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
    else if (decorMode) hint = '🎀 แตะจุดที่เรืองแสงเพื่อวางของตกแต่ง หรือแตะของที่วางไว้เพื่อเปลี่ยน/เก็บ';
    else if (!state.pets.length && !eggsOwned) hint = 'ยังไม่มีน้อง — ใส่ไข่ในรังเพื่อเริ่มฟักได้เลย 🥚';
    else if (!state.pets.length) hint = 'รอไข่ฟักก่อนนะ แล้วจะมีเพื่อนตัวแรกเดินมาหา 🐣';
    hintEl.hidden = !hint;
    if (hintEl.textContent !== hint) hintEl.textContent = hint;
    hintEl.classList.toggle('is-armed', !!armedFood);
  }

  // ── interactions ───────────────────────────────────────────────────────
  function onTapGround() {
    if (photo) return;
    if (selected || selectedCrib) closeSheet();
  }

  function onTap(id) {
    if (disposed || photo) return;
    if (id.startsWith('cake-')) { onPetTap(id.slice(5)); return; }
    if (id === 'bowl') { notify('🍽️ ถาดอาหาร — เลือกอาหารจากถาดด้านล่าง แล้วแตะน้องที่อยากให้กิน', 'info'); return; }
    if (id.startsWith('nest-')) { onNestTap(Number(id.slice(5))); return; }
    if (id.startsWith('poop-')) { onPoopTap(id); return; }
    if (id.startsWith('crib-')) { onCribTap(id.slice(5)); return; }
    if (id.startsWith('spot-')) { openDecorSpot(Number(id.slice(5))); return; }
    if (id.startsWith('decor-')) { onDecorTap(id.slice(6)); return; }
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
    if (hatching && hatching.petId === petId && hatching.phase === 'burst') { revealId = petId; hatching.revealShown = true; endHatch(); }
    if (!A.hidden && birthdayPending(pet)) celebrateBirthday(petId);   // the first tap of the day on a birthday pet
    // a pet holding a gift: the tap collects it (hop + coins fly to the counter); the sheet opens on the next tap
    if (!A.hidden && petGift(state, petId).has) {
      const g = ctx.run(s => collectPetGift(s, petId));
      if (g && g.ok) { giftCollected(petId, g.coins, g.items, 0); syncGifts(getState()); return; }
    }
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
    selectedCrib = null;
    if (selected && selected !== petId) { const o = actors.get(selected); if (o) { o.hold = HOLD_AFTER_TAP; dropTag(o.selTag); o.selTag = null; } }
    if (selected !== petId) revealId = revealId === petId ? petId : null;
    selected = petId;
    sheetMode = 'main';
    const A = actors.get(petId);
    if (A) {
      A.hold = SELECT_HOLD;
      const sp = getSpecies(A.pet.speciesId);
      if (sp && sp.rarity === 'legendary' && !A.selTag) A.selTag = addTag(A, `✦ ตำนาน ${petName(A.pet)}`, 'is-legend', Infinity);
    }
    refreshUi();
  }

  function closeSheet() {
    if (selected) {
      const A = actors.get(selected);
      if (A) { A.hold = 1.2; dropTag(A.selTag); A.selTag = null; }
    }
    selected = null;
    selectedCrib = null;
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
  /** Ends the ceremony (any path): releases the lock, frees the cloned glow material, unpins the newborn. */
  function endHatch() {
    const h = hatching;
    hatching = null;
    if (!h) return;
    if (h.glow) { try { h.glow.dispose(); } catch { /* already disposed */ } h.glow = null; }
    const baby = h.petId && actors.get(h.petId);
    if (baby) { baby.pinned = false; if (baby.hidden) { baby.hidden = false; baby.holder.visible = true; decorate(baby); } }
  }

  /** The "ฟักออกมาเป็น..." toast is held back for the reveal; this shows it exactly once, whenever we must stop early. */
  function announceHatch() {
    const h = hatching;
    if (!h || h.announced || !h.msg) return;
    h.announced = true;
    notify(h.msg, 'success');
  }

  function startHatch(i) {
    if (!canStartCeremony(hatching)) return;
    if (hatching) endHatch(); // the previous newborn is already out and walking: its ceremony is over
    const state = getState();
    const n = nests[i];
    if (!n || !n.egg) return;
    if (state.pets.length >= state.barnCapacity && nurseryPets(state).length >= NURSERY_SLOTS) { // yard AND nursery full
      ctx.run(s => hatchReady(s, i));   // shows "เปลเต็มแล้ว"
      if (ctx.onHatchBlocked) ctx.onHatchBlocked();
      return;
    }
    if (selected || selectedCrib) closeSheet();
    // The real hatchReady() result decides everything (legendary or not). The newborn is created hidden by sync().
    hatching = { nest: i, t: 0, phase: 'pending', spawning: true, petId: null, legendary: false, msg: '', pet: null, announced: false, revealShown: false };
    let started = false;
    try {
      let r = null;
      try { r = update(s => hatchReady(s, i)); } finally { hatching.spawning = false; }
      if (!r || !r.ok || !r.pet) {
        if (r) notify(r.reason || 'ฟักไม่สำเร็จ', 'warn');
        const ghost = hatching.petId && actors.get(hatching.petId);
        if (ghost) removeActorRec(ghost);
        return;
      }
      hatching.pet = r.pet;
      hatching.msg = r.msg || '';
      hatching.legendary = ceremonyKind(r.pet) === 'legendary';
      hatching.phase = hatching.legendary ? 'legend' : 'wobble';
      fx.clearBubble(world, n.id);
      world.boost(hatching.legendary ? 8000 : 4500);
      if (hatching.legendary) {
        fxo('dimScene', world, 0.55, 3600);
        // glowing copy of the egg material (the shared one stays untouched; endHatch() disposes the copy)
        const glow = n.egg.material.clone();
        glow.emissive = new THREE.Color(0xffd24a);
        glow.emissiveIntensity = 0;
        hatching.glow = glow;
        n.egg.material = glow;
      }
      started = true;
    } finally {
      if (!started) endHatch(); // whatever went wrong, the lock never stays behind
    }
  }

  /** The egg bursts: shells fly, confetti, and the (already existing) newborn appears. */
  function reveal() {
    const h = hatching;
    const n = nests[h.nest];
    const legend = h.legendary;
    h.phase = 'burst';
    h.t = 0;
    announceHatch();
    const base = { x: n.x, y: 0.5, z: n.z };
    const eggColor = n.egg ? n.egg.material : eggMat('#f6e7b0');
    if (n.egg) { n.group.remove(n.egg); n.egg = null; n.eggKey = ''; }
    const top = new THREE.Mesh(G.half, eggColor);
    top.scale.set(0.85, 1.1, 0.85); top.position.set(n.x, legend ? 1.8 : 0.5, n.z);
    const bottom = new THREE.Mesh(G.half, eggColor);
    bottom.scale.set(0.85, -0.8, 0.85); bottom.position.set(n.x, legend ? 1.8 : 0.5, n.z);
    top.userData.noPick = bottom.userData.noPick = true;
    world.scene.add(top, bottom);
    temps.push({ mesh: top, vx: 0.9, vy: 3.2, vz: -0.4, spin: 5, t: 0, life: 1.4 });
    temps.push({ mesh: bottom, vx: -0.4, vy: 1.2, vz: 0.3, spin: -3, t: 0, life: 1.6 });
    const burst = legend ? { x: n.x, y: 1.8, z: n.z } : base;
    fx.confetti(world, burst, legend ? 56 : 28);
    fx.sparkleAt(world, burst);
    if (legend) { later(250, () => fx.sparkleAt(world, burst)); later(550, () => fx.sparkleAt(world, base)); fxo('shake', world, 500, 0.35); }
    else if (h.pet.shiny) later(500, () => fx.sparkleAt(world, base));
    const crib = h.nurseryPetId && cribs.get(h.nurseryPetId);
    if (crib) { revealCrib(crib, legend); return; }  // the yard was full: the baby appears in its crib
    const A = h.petId && actors.get(h.petId);
    if (!A) { endHatch(); return; }
    A.hidden = false;
    A.holder.visible = true;
    A.spawn = legend ? { t: 0, dur: 1.8, arc: 0, drop: 2.4, from: null } : { t: 0, dur: 0.8, arc: 0.9, drop: 0, from: null };
    A.onSpawned = ceremonyWalk;
    decorate(A);
    setBubble(A, '');
  }

  function ceremonyWalk(A) {
    A.pinned = false;
    const pet = A.pet;
    const mine = hatching;
    const legend = !!(mine && mine.legendary);
    const tx = Math.max(-1.6, Math.min(1.6, A.x * 0.5)), tz = 1.5;
    begin(A, {
      type: 'walkTo', target: { x: tx, z: tz }, speed: 1.1,
      onArrive: AA => {
        begin(AA, { type: 'hop', dur: 1.3, hops: 2 });
        AA.hold = 4.5;
        if (!legend) addTag(AA, `🐣 ${petName(pet)}`, '', 4500); // legendary pets get the ✦ tag from selectPet()
        fx.heart(world, headPos(AA));
        if (legend) fxo('sparkle', world, AA.id);
        if (mine) mine.revealShown = true;
        if (hatching === mine) endHatch(); // (a newer ceremony may already own the lock)
        revealId = AA.id;     // same info as the list's reveal: rarity, personality, trait, shiny
        selectPet(AA.id);
      },
    });
    A.hold = 0;
  }

  function addTag(A, text, cls, ms) {
    const el = document.createElement('div');
    el.className = 'b3-nametag' + (cls ? ' ' + cls : '');
    el.textContent = text;
    labelsEl.appendChild(el);
    const tag = { el, petId: A.id, until: performance.now() + ms };
    tags.push(tag);
    return tag;
  }

  function dropTag(tag) {
    if (!tag) return;
    tag.el.remove();
    const i = tags.indexOf(tag);
    if (i >= 0) tags.splice(i, 1);
  }

  function stepHatch(dt) {
    if (!hatching) return;
    const h = hatching;
    h.t += dt;
    const n = nests[h.nest];
    if (!n) { endHatch(); return; }
    if (h.phase === 'wobble') {
      const u = Math.min(1, h.t / 1.4);
      if (n.egg) {
        n.egg.rotation.z = Math.sin(h.t * (14 + u * 22)) * (0.15 + u * 0.35);
        n.egg.position.y = 0.45 + Math.abs(Math.sin(h.t * 10)) * 0.05 * u;
        const s = 1 + u * 0.12 + Math.sin(h.t * 30) * 0.02 * u;
        n.egg.scale.set(0.85 * s, 1.12 * s, 0.85 * s);
      }
      if (h.t > 0.5 && !h.pre) { h.pre = true; fx.emojiPop(world, { x: n.x, y: 0.9, z: n.z }, '❗'); }
      if (h.t >= 1.4) reveal();
    } else if (h.phase === 'legend') {
      // dim the scene, the egg glows and rises, light beam + shake, then the burst
      const T = 2.6;
      const u = Math.min(1, h.t / T);
      if (n.egg) {
        const e = smooth(u);
        n.egg.position.y = 0.45 + 1.35 * e + Math.sin(h.t * 3) * 0.04;
        n.egg.rotation.z = Math.sin(h.t * (8 + u * 24)) * (0.1 + u * 0.3);
        n.egg.rotation.y = h.t * (1 + u * 6);
        const s = 1 + 0.25 * e + Math.sin(h.t * 26) * 0.03 * u;
        n.egg.scale.set(0.85 * s, 1.12 * s, 0.85 * s);
        if (h.glow) h.glow.emissiveIntensity = 0.2 + 1.3 * e;
      }
      if (h.t > 0.2 && !h.p1) { h.p1 = true; fx.emojiPop(world, { x: n.x, y: 1.1, z: n.z }, '✨'); }
      if (h.t > 1.5 && !h.p2) {
        h.p2 = true;
        fxo('lightBeam', world, { x: n.x, y: 0, z: n.z }, { color: '#fff0a0', duration: 1.8 });
        fxo('shake', world, 900, 0.5);
      }
      if (h.t >= T) reveal();
    } else if (h.phase === 'burst') {
      if (h.glow) { try { h.glow.dispose(); } catch { /* ignore */ } h.glow = null; }
      // safety net: the newborn was tapped / removed before its walk finished
      const baby = h.petId && actors.get(h.petId);
      if (h.t > 14 || (h.t > 1.5 && !baby)) endHatch();
    }
  }

  /** Props the new tier added grow in one after another (outBack), with a sparkle. */
  function stepPops(dt) {
    for (let i = popQueue.length - 1; i >= 0; i--) {
      const q = popQueue[i];
      q.t += dt;
      if (q.t < 0) continue;
      if (!q.sparked) { q.sparked = true; fxo('sparkleAt', world, { x: q.x, y: 0.7, z: q.z }); }
      const u = Math.min(1, q.t / 0.6);
      q.mesh.scale.setScalar(Math.max(0.001, ease.outBack(u)));
      if (u >= 1) { q.mesh.scale.setScalar(1); popQueue.splice(i, 1); }
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

  // ── ของขวัญอยู่ที่ตัวน้อง (CONTRACT_V7 §4): 🎁 above a pet, tap = collect, chip = collect all ─────────────
  const flyCoins = new Set();
  const calmMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Screen centre of the header coin counter (where coins fly to). */
  function coinTarget() {
    const hr = host.getBoundingClientRect();
    const el = document.getElementById('hdr-coins');
    const box = el && (el.parentElement || el).getBoundingClientRect();
    if (box && box.width > 0) return { x: box.left + box.width / 2, y: Math.max(12, box.top + box.height / 2) };
    return { x: hr.left + hr.width / 2, y: Math.max(12, hr.top) };
  }

  /** A few 🪙 fly from the pet to the coin counter. */
  function flyCoinsFrom(A, coins, delay = 0) {
    if (disposed || calmMotion() || typeof document.body.animate !== 'function') return;
    const p = world.worldToScreen(headPos(A));
    if (!p.visible) return;
    const hr = host.getBoundingClientRect();
    const sx = hr.left + p.x, sy = hr.top + p.y, to = coinTarget();
    const n = Math.max(1, Math.min(5, Math.ceil(coins / 25)));
    for (let k = 0; k < n; k++) {
      const el = document.createElement('span');
      el.className = 'b3-flycoin';
      el.textContent = '🪙';
      document.body.appendChild(el);
      flyCoins.add(el);
      const anim = el.animate([
        { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 1 },
        { transform: `translate(${(sx + to.x) / 2 + (k - n / 2) * 14}px, ${Math.min(sy, to.y) - 46}px) scale(1.15)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${to.x}px, ${to.y}px) scale(0.5)`, opacity: 0.2 },
      ], { duration: 720 + k * 60, delay: delay + k * 70, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'both' });
      anim.onfinish = () => { flyCoins.delete(el); el.remove(); };
    }
  }

  /** The pet hops, coins fly to the counter, items pop up. Called after a successful collect. */
  function giftCollected(petId, coins, items, order = 0) {
    const A = actors.get(petId);
    if (!A || A.hidden) return;
    A.hold = Math.max(A.hold, 2.2);
    react(A, 'hop', { dur: 0.9, hops: 2, height: 0.42 });
    fxo('sparkle', world, A.id);
    flyCoinsFrom(A, coins, order * 90);
    const ids = Object.keys(items || {}).slice(0, 2);
    ids.forEach((id, k) => { const it = getItem(id); if (it) later(220 + k * 200 + order * 90, () => alive(petId) && fxo('emojiPop', world, headPos(A), it.emoji)); });
    const g = giftEls.get(petId);
    if (g) { g.remove(); giftEls.delete(petId); }
    A.gift = null;
  }

  function collectAll() {
    const r = ctx.run(s => collectYard(s));
    if (r && r.ok) (r.gifts || []).slice(0, 12).forEach((gf, i) => giftCollected(gf.petId, gf.coins, gf.items, i));
    syncGifts(getState());
  }

  /** 🎁 / 🎁✨ labels above gifted pets (DOM, so a crowd costs no draw calls) + the corner chip. */
  let labelPick = new Set();     // pets that wear a 🎁 label right now (at most GIFT_LABEL_MAX)
  let labelPickAt = 0;
  function pickLabels(force) {
    const cands = [];
    const w = stage.clientWidth || 1, hgt = stage.clientHeight || 1;
    for (const A of actors.values()) {
      if (!A.gift || !A.gift.big) continue;
      let dist = 0;
      try { const p = world.worldToScreen({ x: A.x, y: A.model.height * 0.5, z: A.z }); dist = Math.hypot(p.x - w / 2, p.y - hgt / 2) + (p.visible ? 0 : 1e4); } catch { dist = 0; }
      cands.push({ id: A.id, full: !!A.gift.full, size: A.gift.coins + A.gift.itemCount * 25, dist });
    }
    const t = performance.now();
    const ids = new Set(cands.map(c => c.id));
    const stale = t - labelPickAt > 3000 || [...labelPick].some(id => !ids.has(id)) || (labelPick.size < Math.min(GIFT_LABEL_MAX, cands.length));
    if (force || stale) { labelPick = new Set(pickGiftLabels(cands, GIFT_LABEL_MAX)); labelPickAt = t; }
    return labelPick;
  }

  function syncGifts(state) {
    for (const A of actors.values()) {
      const g = A.hidden ? null : petGift(state, A.id);
      A.gift = g && g.has ? g : null;               // anything >= 1 coin: a tap collects it
    }
    const shown = pickLabels(false);                // only a few labels at a time: no clutter
    for (const A of actors.values()) {
      let el = giftEls.get(A.id);
      if (A.gift && A.gift.big && shown.has(A.id)) {
        if (!el) {
          el = document.createElement('div');
          el.className = 'b3-gift';
          el.innerHTML = '<span></span>';
          labelsEl.appendChild(el);
          giftEls.set(A.id, el);
        }
        const inner = el.firstChild, txt = A.gift.full ? '🎁✨' : '🎁';
        if (inner.textContent !== txt) inner.textContent = txt;
        el.classList.toggle('is-full', A.gift.full);
      } else if (el) { el.remove(); giftEls.delete(A.id); }
    }
    for (const [id, el] of [...giftEls]) if (!actors.has(id)) { el.remove(); giftEls.delete(id); }
    const pv = yardPreview(state);
    chipEl.hidden = !pv.pets;
    if (pv.pets) {
      const txt = `🎁 ${pv.pets}`;
      if (chipEl.textContent !== txt) chipEl.textContent = txt;
      chipEl.classList.toggle('is-full', pv.fullPets > 0);
      chipEl.title = `เก็บของขวัญจากน้องทุกตัว 🪙${pv.coins}`;
      chipEl.setAttribute('aria-label', `เก็บของขวัญจากน้อง ${pv.pets} ตัว`);
    }
  }

  // ── เปลอนุบาล: sleeping babies in cribs beside the nests (CONTRACT_V7 §5) ───────────────────────────
  const cribMat = own(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: world.toonGradient }));
  let cribGeo = null;
  function cribGeometry() {
    if (cribGeo) return cribGeo;
    const tmp = [];
    const box = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); tmp.push(g); return g; };
    const parts = [
      { geometry: box(1.0, 0.08, 0.7), color: '#a9733c', position: [0, 0.2, 0] },
      { geometry: box(0.9, 0.08, 0.6), color: '#fff2d6', position: [0, 0.28, 0] },
      { geometry: box(0.5, 0.06, 0.62), color: '#ffb3c7', position: [0.22, 0.33, 0] },
      { geometry: box(1.0, 0.3, 0.05), color: '#c58f52', position: [0, 0.42, 0.33] },
      { geometry: box(0.05, 0.42, 0.7), color: '#b27c43', position: [-0.5, 0.41, 0] },
      { geometry: box(0.05, 0.34, 0.7), color: '#b27c43', position: [0.5, 0.37, 0] },
    ];
    for (const [x, z] of [[-0.44, -0.3], [0.44, -0.3], [-0.44, 0.3], [0.44, 0.3]]) parts.push({ geometry: box(0.07, 0.2, 0.07), color: '#8d5a34', position: [x, 0.1, z] });
    cribGeo = own(mergeStaticParts(THREE, parts));
    for (const g of tmp) g.dispose();
    return cribGeo;
  }

  function createCrib(pet, spot) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(cribGeometry(), cribMat);
    const holder = new THREE.Group();
    holder.position.y = 0.3;
    const model = buildModel(pet);
    model.root.scale.multiplyScalar(0.78);
    model.body.scale.set(1.05, 0.72, 1.05);
    if (model.head) model.head.rotation.x += 0.5;
    const eyes = model.parts && model.parts.eyes;
    if (eyes) for (const e of eyes) e.scale.y = 0.12;
    holder.add(model.root);
    group.add(mesh, holder);
    group.position.set(spot.x, 0, spot.z);
    const c = { id: `crib-${pet.id}`, petId: pet.id, group, holder, model, x: spot.x, z: spot.z, hidden: false, spawn: null, seed: (hashId(pet.id) % 600) / 100 };
    world.addActor(c.id, group, { radius: 0.75, height: 0.9, shadowScale: 0.95, stroke: false });
    cribs.set(pet.id, c);
    return c;
  }

  function removeCrib(c) {
    fx.clearBubble(world, c.id);
    world.removeActor(c.id);
    cribs.delete(c.petId);
  }

  function syncCribs(state) {
    const babies = nurseryPets(state).slice(0, NURSERY_SLOTS);
    const have = new Set(babies.map(p => p.id));
    for (const c of [...cribs.values()]) if (!have.has(c.petId)) { if (selectedCrib === c.petId) selectedCrib = null; removeCrib(c); }
    babies.forEach((pet, i) => {
      const spot = cribSpot(i, nestCount || 1);
      let c = cribs.get(pet.id);
      if (!c) {
        c = createCrib(pet, spot);
        if (hatching && hatching.spawning && !hatching.petId && !hatching.nurseryPetId) { // the newborn of the running ceremony: hidden until the egg bursts
          hatching.nurseryPetId = pet.id;
          c.hidden = true;
          c.holder.visible = false;
        } else if (synced) { c.spawn = { t: 0, dur: 0.6 }; }
        if (!c.hidden) fx.bubble(world, c.id, '💤');
      }
      c.x = spot.x; c.z = spot.z;
      c.group.position.set(spot.x, 0, spot.z);
    });
  }

  function animateCribs(t, dt) {
    for (const c of cribs.values()) {
      const b = c.model.body;
      b.scale.y = 0.72 + Math.sin(t * 1.5 + c.seed) * 0.02;
      if (c.spawn) {
        c.spawn.t += dt;
        const u = Math.min(1, c.spawn.t / c.spawn.dur);
        c.holder.scale.setScalar(Math.max(0.02, ease.outBack(u)));
        c.holder.position.y = 0.3 + Math.sin(u * Math.PI) * 0.35;
        if (u >= 1) { c.spawn = null; c.holder.position.y = 0.3; c.holder.scale.setScalar(1); }
      }
    }
  }

  function revealCrib(c, legend) {
    c.hidden = false;
    c.holder.visible = true;
    c.spawn = { t: 0, dur: 0.9 };
    fx.bubble(world, c.id, '💤');
    const p = { x: c.x, y: 0.7, z: c.z };
    fx.confetti(world, p, legend ? 40 : 18);
    fx.sparkleAt(world, p);
    revealId = c.petId;
    selectCrib(c.petId);
    if (hatching) hatching.revealShown = true;
    endHatch();
  }

  function onCribTap(petId) {
    const c = cribs.get(petId);
    if (!c || c.hidden) return;
    fx.heart(world, { x: c.x, y: 0.9, z: c.z });
    selectCrib(petId);
  }

  function selectCrib(petId) {
    if (selected) { const o = actors.get(selected); if (o) { o.hold = HOLD_AFTER_TAP; dropTag(o.selTag); o.selTag = null; } selected = null; }
    selectedCrib = petId;
    sheetMode = 'main';
    refreshUi();
  }

  // ── ของตกแต่ง (CONTRACT_V7 §3): glowing spots, placed decor, pets that use it ──────────────────────
  const decorMat = own(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: world.toonGradient }));
  const decorGeos = new Map();
  const spotGeo = own(new THREE.RingGeometry(0.5, 0.7, 32));
  spotGeo.rotateX(-Math.PI / 2);
  const spotMat = own(new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  let spotSig = '';
  let clockT = 0;

  function decorGeometry(decorId) {
    let g = decorGeos.get(decorId);
    if (g) return g;
    const tmp = [];
    const keep = o => { tmp.push(o); return o; };
    const cyl = (rt, rb, h, seg = 16) => keep(new THREE.CylinderGeometry(rt, rb, h, seg));
    const sph = (r, ws = 12, hs = 8) => keep(new THREE.SphereGeometry(r, ws, hs));
    const box = (w, h, d) => keep(new THREE.BoxGeometry(w, h, d));
    const cone = (r, h, seg = 8) => keep(new THREE.ConeGeometry(r, h, seg));
    const rocker = (x) => ({ geometry: keep(new THREE.TorusGeometry(0.62, 0.05, 6, 20, Math.PI * 0.9)), color: '#8d5a34', position: [x, 0.62, 0], rotation: [0, Math.PI / 2, -Math.PI / 2 - Math.PI * 0.45] });
    let parts;
    switch (decorId) {
      case 'bed': parts = [
        { geometry: cyl(0.62, 0.66, 0.14), color: '#e58aa8', position: [0, 0.07, 0] },
        { geometry: cyl(0.5, 0.5, 0.16), color: '#fbd5e0', position: [0, 0.1, 0] },
        { geometry: sph(0.18), color: '#ffffff', position: [-0.28, 0.24, -0.08], scale: [1.4, 0.7, 1] },
      ]; break;
      case 'bowl': parts = [
        { geometry: cyl(0.36, 0.25, 0.2), color: '#4d96ff', position: [0, 0.1, 0] },
        { geometry: cyl(0.3, 0.3, 0.03), color: '#e9c46a', position: [0, 0.2, 0] },
        { geometry: sph(0.07), color: '#b86a3d', position: [0.1, 0.24, 0.05] },
        { geometry: sph(0.06), color: '#b86a3d', position: [-0.12, 0.23, -0.06] },
      ]; break;
      case 'ball': parts = [
        { geometry: sph(0.21, 14, 10), color: '#ffffff', position: [0, 0.21, 0] },
        { geometry: keep(new THREE.TorusGeometry(0.212, 0.035, 6, 20)), color: '#ff5252', position: [0, 0.21, 0] },
        { geometry: keep(new THREE.TorusGeometry(0.212, 0.035, 6, 20)), color: '#4d96ff', position: [0, 0.21, 0], rotation: [Math.PI / 2, 0, 0] },
      ]; break;
      case 'horse': parts = [
        rocker(-0.2), rocker(0.2),
        { geometry: sph(0.3), color: '#c08552', position: [0, 0.66, 0], scale: [0.75, 0.7, 1.3] },
        { geometry: box(0.3, 0.07, 0.34), color: '#d8574a', position: [0, 0.94, -0.02] },
        { geometry: cyl(0.06, 0.06, 0.5), color: '#c08552', position: [-0.14, 0.4, 0.2] },
        { geometry: cyl(0.06, 0.06, 0.5), color: '#c08552', position: [0.14, 0.4, 0.2] },
        { geometry: cyl(0.06, 0.06, 0.5), color: '#c08552', position: [-0.14, 0.4, -0.2] },
        { geometry: cyl(0.06, 0.06, 0.5), color: '#c08552', position: [0.14, 0.4, -0.2] },
        { geometry: sph(0.2), color: '#c08552', position: [0, 1.0, 0.42] },
        { geometry: box(0.16, 0.14, 0.18), color: '#e0b48a', position: [0, 0.94, 0.6] },
        { geometry: cone(0.06, 0.16), color: '#c08552', position: [-0.1, 1.2, 0.4] },
        { geometry: cone(0.06, 0.16), color: '#c08552', position: [0.1, 1.2, 0.4] },
        { geometry: box(0.06, 0.3, 0.14), color: '#5b3a29', position: [0, 1.06, 0.28] },
      ]; break;
      case 'leaves': parts = [
        { geometry: sph(0.55), color: '#d9822b', position: [0, 0.05, 0], scale: [1, 0.45, 1] },
        { geometry: sph(0.36), color: '#c0392b', position: [0.2, 0.14, 0.1], scale: [1, 0.55, 1] },
        { geometry: sph(0.32), color: '#e8b930', position: [-0.24, 0.12, -0.14], scale: [1, 0.55, 1] },
        { geometry: sph(0.22), color: '#8a5a2b', position: [0.0, 0.22, -0.2], scale: [1, 0.55, 1] },
        { geometry: cyl(0.12, 0.12, 0.012, 7), color: '#c0392b', position: [0.65, 0.01, 0.2] },
        { geometry: cyl(0.1, 0.1, 0.012, 7), color: '#e8b930', position: [-0.62, 0.01, -0.3] },
        { geometry: cyl(0.1, 0.1, 0.012, 7), color: '#d9822b', position: [0.3, 0.01, -0.62] },
      ]; break;
      default: parts = [ // sign: a post and a board (the farm name is a separate plane)
        { geometry: cyl(0.05, 0.06, 1.0, 8), color: '#8d5a34', position: [0, 0.5, 0] },
        { geometry: box(1.0, 0.44, 0.07), color: '#d9a35f', position: [0, 0.95, 0] },
        { geometry: box(1.06, 0.06, 0.09), color: '#8d5a34', position: [0, 1.19, 0] },
        { geometry: box(1.06, 0.06, 0.09), color: '#8d5a34', position: [0, 0.71, 0] },
      ];
    }
    g = own(mergeStaticParts(THREE, parts));
    for (const o of tmp) o.dispose();
    decorGeos.set(decorId, g);
    return g;
  }

  function signTexture(name) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 96;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#d9a35f'; c2.fillRect(0, 0, 256, 96);
    c2.fillStyle = '#4a2e14'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
    let size = 44;
    c2.font = `bold ${size}px sans-serif`;
    while (c2.measureText(name).width > 236 && size > 16) { size -= 3; c2.font = `bold ${size}px sans-serif`; }
    c2.fillText(name, 128, 50);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function spotPos(spot) {
    const list = Array.isArray(world.decorSpots) ? world.decorSpots : [];
    return list.find(s => s.index === spot) || null;
  }

  function createDecorInst(rec, pos) {
    const group = new THREE.Group();
    const body = new THREE.Group();
    body.add(new THREE.Mesh(decorGeometry(rec.decorId), decorMat));
    group.add(body);
    const inst = {
      id: rec.id, decorId: rec.decorId, spot: rec.spot, group, body, x: pos.x, z: pos.z, busy: null, pop: 0, pulse: 0, rock: 0,
      ball: rec.decorId === 'ball' ? { vx: 0, vz: 0, home: { x: pos.x, z: pos.z }, spin: 0, bounce: 0, lastMove: 0 } : null,
      sign: null, signName: '',
    };
    if (rec.decorId === 'sign') {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), mat);
      plane.position.set(0, 0.95, 0.045);
      plane.userData.noPick = true;
      body.add(plane);
      inst.sign = { plane, mat, geo: plane.geometry };
    }
    group.position.set(pos.x, 0, pos.z);
    group.scale.setScalar(0.01);
    world.addActor(`decor-${rec.id}`, group, { radius: 0.62, height: 0.7, shadowScale: rec.decorId === 'ball' ? 0.4 : 0.9, stroke: false });
    decorInst.set(rec.id, inst);
    return inst;
  }

  function removeDecorInst(inst) {
    for (const A of actors.values()) if (A.decorId === inst.id) { A.decorId = null; if (A.act.type === 'decor') begin(A, { type: 'idle', dur: 0.4 }); }
    world.removeActor(`decor-${inst.id}`);
    if (inst.sign) { if (inst.sign.mat.map) inst.sign.mat.map.dispose(); inst.sign.mat.dispose(); inst.sign.geo.dispose(); }
    decorInst.delete(inst.id);
  }

  /** Placed decor follows state.decor; glowing spots show while decorating (or while there is something built to place). */
  function syncDecor(state) {
    const canDecor = !!(ctx.decor && ctx.decor.available()) && Array.isArray(world.decorSpots) && world.decorSpots.length > 0;
    decorBtn.hidden = !canDecor;
    if (!canDecor && decorMode) { decorMode = false; decorBtn.classList.remove('is-on'); decorBtn.setAttribute('aria-pressed', 'false'); }
    const recs = canDecor || (state.decor || []).length ? (state.decor || []).filter(d => spotPos(d.spot)) : [];
    const want = new Set(recs.map(d => d.id));
    for (const inst of [...decorInst.values()]) if (!want.has(inst.id)) removeDecorInst(inst);
    const farm = (state.player && state.player.farmName) || 'ฟาร์ม';
    for (const rec of recs) {
      let inst = decorInst.get(rec.id);
      if (inst && (inst.decorId !== rec.decorId || inst.spot !== rec.spot)) { removeDecorInst(inst); inst = null; }
      if (!inst) {
        inst = createDecorInst(rec, spotPos(rec.spot));
        if (!synced) { inst.pop = 1; inst.group.scale.setScalar(1); }
        else fxo('sparkleAt', world, { x: inst.x, y: 0.5, z: inst.z });
      }
      if (inst.sign && inst.signName !== farm) {
        if (inst.sign.mat.map) inst.sign.mat.map.dispose();
        inst.sign.mat.map = signTexture(farm);
        inst.sign.mat.needsUpdate = true;
        inst.signName = farm;
      }
    }
    // glowing spots
    const hasBuilt = Object.values(state.inventoryDecor || {}).some(n => n > 0);
    const occupied = new Set((state.decor || []).map(d => d.spot));
    const show = canDecor && (decorMode || hasBuilt);
    const open = show ? world.decorSpots.filter(s => decorMode || !occupied.has(s.index)) : [];
    const sig = `${open.map(s => s.index).join(',')}|${decorMode ? 1 : 0}|${world.decorSpots ? world.decorSpots.length : 0}|${world.yardTier || ''}`;
    if (sig === spotSig) return;
    spotSig = sig;
    try { world.removeProp('decor-rings'); } catch { /* none yet */ }
    for (const id of [...spotActors]) { world.removeActor(id); spotActors.delete(id); }
    if (!open.length) return;
    world.addInstancedProp('decor-rings', spotGeo, open.map(s => ({ position: [s.x, 0.045, s.z] })), { material: spotMat });
    for (const s of open) {
      if (occupied.has(s.index)) continue; // a placed decor is tapped itself
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      const id = `spot-${s.index}`;
      world.addActor(id, g, { radius: 0.8, height: 0.5, shadow: false, stroke: false });
      spotActors.add(id);
    }
  }

  function openDecorSpot(spot) {
    if (ctx.decor && ctx.decor.available()) ctx.decor.openPicker(spot);
  }

  function onDecorTap(instId) {
    const inst = decorInst.get(instId);
    if (!inst) return;
    if (decorMode) { openDecorSpot(inst.spot); return; }
    inst.pulse = 1;
    if (inst.ball) kickBall(null, inst, 0.9);
    if (inst.decorId === 'sign') notify(`🪧 ${(getState().player || {}).farmName || 'ฟาร์มของฉัน'}`, 'info');
  }

  function decorList() {
    const out = [];
    for (const i of decorInst.values()) if (DECOR_USE[i.decorId] && i.pop >= 1) out.push({ id: i.id, decorId: i.decorId, x: i.x, z: i.z, busy: i.busy });
    return out;
  }
  function claimDecor(A, act) {
    const inst = decorInst.get(act.instId);
    if (inst && !inst.busy) inst.busy = A.id;   // a best friend may join a decor somebody uses
    A.decorId = act.instId;
  }
  function releaseDecor(A) {
    if (!A.decorId) return;
    const inst = decorInst.get(A.decorId);
    if (inst && inst.busy === A.id) inst.busy = null;
    A.decorId = null;
  }

  /** The ball rolls away from the pet (or the tapped spot), bending back toward the middle near the fence. */
  function kickBall(A, inst, strength = 1) {
    const b = inst.ball;
    if (!b) return;
    let dx = A ? inst.x - A.x : Math.random() - 0.5, dz = A ? inst.z - A.z : Math.random() - 0.5;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const ed = Math.hypot(inst.x, inst.z) || 1;
    const edge = Math.min(1, Math.max(0, (ed - (YARD.walkRadius - 2.4)) / 2.4));
    let vx = dx * (1 - edge) - (inst.x / ed) * edge + (Math.random() - 0.5) * 0.6;
    let vz = dz * (1 - edge) - (inst.z / ed) * edge + (Math.random() - 0.5) * 0.6;
    const l = Math.hypot(vx, vz) || 1;
    b.vx = (vx / l) * 3.6 * strength; b.vz = (vz / l) * 3.6 * strength;
    b.lastMove = clockT;
    if (A) popAt(A, '⚽', 0.3, -0.3);
  }

  /** Per-frame decor motion: pop-in, the rolling ball, the rocking horse, leaf-pile jiggle, pulsing glow. */
  function stepDecor(dt, t) {
    clockT = t;
    for (const inst of decorInst.values()) {
      if (inst.pop < 1) {
        inst.pop = Math.min(1, inst.pop + dt / 0.55);
        inst.group.scale.setScalar(Math.max(0.01, ease.outBack(inst.pop)));
      }
      if (inst.pulse > 0) inst.pulse = Math.max(0, inst.pulse - dt * 2.2);
      inst.body.scale.y = 1 + Math.sin(inst.pulse * Math.PI) * 0.18;
      const b = inst.ball;
      if (b) {
        const sp = Math.hypot(b.vx, b.vz);
        if (sp > 0.06) {
          inst.x += b.vx * dt; inst.z += b.vz * dt;
          const k = Math.exp(-1.5 * dt);
          b.vx *= k; b.vz *= k;
          const c = clampToYard(inst.x, inst.z, YARD.walkRadius - 0.25);
          if (c.x !== inst.x || c.z !== inst.z) { inst.x = c.x; inst.z = c.z; b.vx *= -0.4; b.vz *= -0.4; }
          b.spin += sp * dt / 0.21; b.bounce += sp * dt * 2.4; b.lastMove = t;
        } else {
          b.vx = b.vz = 0;
          const hx = b.home.x - inst.x, hz = b.home.z - inst.z, hd = Math.hypot(hx, hz);
          if (!inst.busy && t - b.lastMove > 8 && hd > 0.04) { // nobody plays with it: roll back to its spot
            const stp = Math.min(hd, 1.3 * dt);
            inst.x += (hx / hd) * stp; inst.z += (hz / hd) * stp; b.spin += stp / 0.21;
          }
        }
        inst.speed = sp;
        inst.group.position.set(inst.x, Math.abs(Math.sin(b.bounce)) * Math.min(0.28, sp * 0.08), inst.z);
        inst.body.rotation.x = b.spin;
      }
      if (inst.decorId === 'horse') {
        if (!inst.busy) inst.rock *= Math.exp(-3 * dt);
        inst.body.rotation.x = inst.rock;
      }
    }
    spotMat.opacity = 0.55 + 0.3 * Math.sin(t * 3.2);
  }

  /** Pose of a pet that walked to a decor and is now using it. */
  function decorPose(A, P, t, dt) {
    const act = A.act;
    const inst = decorInst.get(act.instId);
    if (!inst) { act.dur = 0; return; }
    if (!act.arrived) { return; }
    const face = (x, z, k = 6) => { A.heading += angDiff(A.heading, Math.atan2(x - A.x, z - A.z)) * Math.min(1, dt * k); };
    switch (act.use) {
      case 'nap':
        face(camPos.x, camPos.z, 3);
        P.hop = 0.1;
        break;
      case 'eat': {
        face(inst.x, inst.z);
        const c = Math.abs(Math.sin(act.t * 11));
        P.sy = 1 - 0.07 * c; P.hPitch = 0.55 + Math.sin(act.t * 11) * 0.14;
        if (at(act, 'e1', 0.5)) popAt(A, '😋', 0.2, 0);
        if (at(act, 'e2', 2.6)) fxo('emojiPop', world, headPos(A), '🥣');
        break;
      }
      case 'kick': {
        const b = inst.ball;
        if (!b) break;
        const dx = inst.x - A.x, dz = inst.z - A.z, d = Math.hypot(dx, dz);
        face(inst.x, inst.z, 9);
        if (d > 0.75 && inst.speed < 3) { // chase the rolling ball
          const stp = Math.min(d - 0.6, 2.3 * dt);
          A.x += (dx / d) * stp; A.z += (dz / d) * stp;
          A.phase += dt * 11;
          const w = Math.abs(Math.sin(A.phase));
          P.hop = w * 0.12; P.sy = 0.94 + 0.12 * w; P.tail = Math.sin(A.phase * 2) * 0.5;
        } else if (inst.speed < 0.3 && act.t >= (act.nextKick ?? 0.4)) {
          act.nextKick = act.t + 1.5;
          act.lunge = act.t;
          kickBall(A, inst);
        }
        if (act.lunge != null) {
          const u = Math.min(1, (act.t - act.lunge) / 0.4);
          P.pitch = -0.3 * Math.sin(u * Math.PI); P.hop = Math.max(P.hop, Math.sin(u * Math.PI) * 0.22);
        }
        break;
      }
      case 'rock': {
        const T = act.dur, on = smooth(act.t / 0.45), off = smooth((T - act.t) / 0.4), seat = Math.min(on, off);
        A.heading += angDiff(A.heading, 0) * Math.min(1, dt * 8);
        const swing = Math.sin(act.t * 3.4) * 0.2 * seat;
        inst.rock = swing;
        P.hop = 0.62 * seat + Math.sin(Math.min(1, act.t / 0.45) * Math.PI) * 0.25 * (act.t < 0.45 ? 1 : 0);
        P.pitch = swing * 0.9; P.sy = 1 + 0.03 * Math.sin(act.t * 6.8);
        if (at(act, 'r1', 0.8)) popAt(A, '🎵', 0.3, 0.1);
        break;
      }
      default: { // jump in the leaves
        face(camPos.x, camPos.z, 4);
        const per = 0.66, u = (act.t % per) / per, h = Math.sin(u * Math.PI);
        P.hop = h * 0.55; P.sy = 1 + 0.14 * h - (1 - h) ** 6 * 0.16; P.sx = 1 - 0.06 * h + (1 - h) ** 6 * 0.08;
        const n = Math.floor(act.t / per);
        if (n !== act.jumps && u < 0.2) { act.jumps = n; inst.pulse = 1; popAt(A, '🍂', (n % 2 ? 0.25 : -0.25), -0.15); }
        break;
      }
    }
  }

  // ── ลูบหัว / เกาคาง (CONTRACT_V8 §1): a stroke session = one pat ─────────────────────────────────────────
  /** Engine stroke events: start / move / end on a pet. The reward comes once, at the end (strokePet -> patPet once). */
  function onStroke(ev) {
    if (disposed || !isOn || photo) return;
    const A = actors.get(ev.id);
    if (!A) return;
    if (A.hidden || A.spawn) { // a stroke that ends on a pet that hid / is spawning must not stay behind (stuck melt pose)
      if (ev.phase === 'end') finishActorStroke(A, ev.durationMs, { canReward: false });
      return;
    }
    if (ev.phase === 'start') {
      if (A.stroke) return;
      armedFood = null;
      if (hatching && hatching.petId === A.id) return;
      A.stroke = createStroke(A.id, ev.region || 'head');
      A.strokeAt = performance.now();
      A.hold = Math.max(A.hold, 3);
      A.popAt = 0.3;
      if (A.act.type !== 'idle' && A.act.type !== 'sleep') begin(A, { type: 'idle', dur: 1 });
    }
    const S = A.stroke;
    if (!S) return;
    if (ev.region) S.region = ev.region;
    if (ev.point) {
      const nowMs = performance.now();
      handStroke(S, ev.point, Math.max(0.008, (nowMs - (A.strokeAt || nowMs)) / 1000));
      A.strokeAt = nowMs;
      A.strokePoint = ev.point;
    }
    A.hold = Math.max(A.hold, 2);
    if (ev.phase === 'end') finishStroke(A, ev.durationMs);
  }

  function finishStroke(A, durationMs) {
    if (!A.stroke) return;
    const melted = !!A.stroke.meltPop;
    const res = finishActorStroke(A, durationMs, { canReward: alive(A.id) });
    A.strokeEnd = { melt: A.strokeMelt };
    A.hold = Math.max(A.hold, 2);
    if (!res || !res.commit) return;
    const region = res.region;
    const r = ctx.run(s => strokePet(s, A.id, { durationMs: res.durationMs, region }));
    if (!r || !r.ok) return;
    const h = headPos(A);
    if (r.rewarded) fx.heart(world, h); else fxo('emojiPop', world, h, '😌');
    if (r.favorite) { fxo('sparkle', world, A.id); fxo('emojiPop', world, { x: h.x + 0.3, y: h.y + 0.1, z: h.z }, '💞'); }
    if (r.discovered) { fx.confetti(world, h, 18); fxo('sparkleAt', world, h); journal('favSpot', A.id, { spot: region }); }
    if (melted) journal('melt', A.id);
    syncGifts(getState());
  }

  /** Pose while the pet is being stroked (and while it recovers from melting). Models and billboards share it. */
  function strokePose(A, P, t, dt) {
    const S = A.stroke;
    const pet = A.pet;
    const sleeping = pet.status === 'sleeping';
    const billboard = A.model.kind === 'billboard';
    const target = S ? strokeMelt(S) : 0;
    if (S) A.strokeMelt += (target - A.strokeMelt) * Math.min(1, dt * 5);
    else A.strokeMelt = Math.max(0, A.strokeMelt - dt * 1.1);
    const m = A.strokeMelt;
    A.squint = S || m > 0.05 ? 1 : 0;
    if (!S) { // recovering: the roll eases back
      if (billboard) { P.roll = Math.sin(t * 9) * 0.14 * m; P.sy = 1 - 0.3 * m; P.sx = 1 + 0.15 * m; }
      else { P.roll = 1.25 * m * A.strokeSide; P.sy = 1 - 0.18 * m; P.hop = 0.12 * m; }
      return;
    }
    if (!sleeping) A.heading += angDiff(A.heading, faceCam(A)) * Math.min(1, dt * 4);
    const fav = S.region === favoriteSpot(A.id);
    const lean = sleeping ? 0.3 : 1;
    P.pitch = -0.14 * lean * (1 - m);
    P.hRoll = Math.sin(t * 2.1 + A.seed) * 0.2 * lean + (S.region === 'chin' ? 0.16 : 0);
    if (S.region === 'head') P.hPitch += 0.28 * lean;
    else if (S.region === 'chin') P.hPitch -= 0.35 * lean;
    else { P.sy *= 1.04; P.pitch += 0.06; P.tail = Math.sin(t * 14) * 0.7; }
    P.hYaw = Math.sin(t * 1.3 + A.seed) * 0.12;
    // 💕 / ♪ drift up now and then; the favourite spot adds sparkles and a happy wiggle
    A.popAt -= dt;
    if (A.popAt < 0 && !lowTier()) {
      A.popAt = (fav ? 0.4 : 0.6) + Math.random() * 0.3;
      S.n = (S.n || 0) + 1;
      popAt(A, sleeping ? '😊' : S.n % 3 === 0 ? '♪' : '💕', (Math.random() - 0.5) * 0.5, 0.05);
    }
    if (fav && !sleeping) {
      P.roll += Math.sin(t * 13) * 0.09; P.tail = Math.sin(t * 18) * 0.8;
      S.sparkAt = (S.sparkAt || 0) - dt;
      if (S.sparkAt <= 0) { S.sparkAt = 1; fxo('sparkle', world, A.id); }
    }
    if (S.giggle > 0.5 && !sleeping) { // fast scrubbing: giggle + hop
      P.hop = Math.max(P.hop, Math.abs(Math.sin(t * 15)) * 0.2 * S.giggle);
      P.sy += Math.sin(t * 30) * 0.03;
      S.gigAt = (S.gigAt || 0) - dt;
      if (S.gigAt <= 0) { S.gigAt = 1.3; popAt(A, '😆', 0.25, 0.15); }
    }
    if (m > 0.02 && !sleeping) { // after ~2 s: melts (a model rolls over, a billboard squashes and wiggles)
      if (billboard) { P.roll = Math.sin(t * 9) * 0.14 * m; P.sy = 1 - 0.3 * m; P.sx = 1 + 0.15 * m; }
      else { P.roll = 1.25 * m * A.strokeSide; P.sy = 1 - 0.18 * m; P.hop = Math.max(P.hop, 0.12 * m); P.pitch *= 1 - m; }
      if (m > 0.9 && !S.meltPop) { S.meltPop = true; popAt(A, '🥰', 0, 0.2); fxo('sparkle', world, A.id); }
    }
  }

  // ── ลากอาหารไปป้อน (CONTRACT_V8 §2): drag a tray item onto a pet ─────────────────────────────────────────
  let drag = null;               // { pointerId, btn, itemId, x0, y0, active, ghost, feed, targetId }
  let dragEndedAt = 0;
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.45);
  const dragRay = new THREE.Raycaster();
  const dragPt = new THREE.Vector3();

  /** The pet under the dragged food: pointer -> ground-ish world point -> nearest pet within FEED_RANGE. */
  function dragTargetAt(cx, cy) {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -(((cy - r.top) / r.height) * 2 - 1));
    world.camera.updateMatrixWorld();
    dragRay.setFromCamera(ndc, world.camera);
    if (!dragRay.ray.intersectPlane(dragPlane, dragPt)) return null;
    const cands = [];
    for (const A of actors.values()) if (!A.hidden && !A.spawn) cands.push({ id: A.id, x: A.x, z: A.z });
    return pickFeedTarget({ x: dragPt.x, z: dragPt.z }, cands, FEED_RANGE);
  }

  function ghostTo(g, x, y) { g.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`; }

  function endDrag(spring) {
    const d = drag;
    drag = null;
    dragEndedAt = performance.now();
    for (const A of actors.values()) A.feedLook = null;
    if (!d) return;
    try { d.btn.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    if (!d.ghost) return;
    const g = d.ghost;
    if (spring && typeof g.animate === 'function' && !calmMotion()) {
      const to = d.btn.getBoundingClientRect();
      const a = g.animate([{ transform: g.style.transform }, { transform: `translate(${to.left + to.width / 2}px, ${to.top + to.height / 2}px) translate(-50%, -50%)` }],
        { duration: 260, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      a.onfinish = () => g.remove();
      later(600, () => g.remove());
    } else g.remove();
  }

  function onTrayDown(ev) {
    if (drag || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const btn = ev.target.closest('.b3-food');
    if (!btn || !trayEl.contains(btn)) return;
    drag = { pointerId: ev.pointerId, btn, itemId: btn.dataset.itemId, x0: ev.clientX, y0: ev.clientY, active: false, ghost: null, feed: null, targetId: null };
  }

  function onDragMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
    if (!drag.active) {
      const moved = Math.hypot(dx, dy);
      // touch: a mostly-horizontal swipe scrolls the tray; mouse / upward pulls start the drag
      if (moved < 10 || (ev.pointerType !== 'mouse' && Math.abs(dx) > Math.abs(dy) * 1.3)) return;
      drag.active = true;
      drag.feed = createFeedDrag(drag.itemId);
      const it = getItem(drag.itemId);
      const g = document.createElement('div');
      g.className = 'b3-ghost';
      g.textContent = it ? it.emoji : '🍖';
      document.body.appendChild(g);
      drag.ghost = g;
      try { drag.btn.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
      armedFood = null;
      if (selected || selectedCrib) closeSheet();
    }
    ev.preventDefault();
    ghostTo(drag.ghost, ev.clientX, ev.clientY);
    drag.targetId = dragTargetAt(ev.clientX, ev.clientY);
    drag.feed.hover(drag.targetId);
    drag.px = ev.clientX; drag.py = ev.clientY;
    world.boost(250);
  }

  function onDragUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    if (!drag.active) { drag = null; return; }   // it was a click: the normal arm / disarm handler runs
    const drop = ev.type === 'pointercancel' ? null : drag.feed.drop();
    const id = drop && drop.petId, itemId = drop && drop.itemId;
    const g = drag.ghost;
    endDrag(!drop);
    if (drop && g) g.remove();
    if (drop) feedWith(id, itemId);
  }

  /** What a pet does while food hovers near it: looks at it, opens its mouth, leans in; sleeping / full pets turn away. */
  function feedLookPose(A, P, t, dt) {
    const L = A.feedLook;
    const pet = A.pet;
    const refuse = pet.status === 'sleeping' || pet.stats.hunger >= 99.5;
    const p = world.worldToScreen({ x: A.x, y: A.y + A.model.height * 0.6, z: A.z });
    const r = stage.getBoundingClientRect();
    const sx = drag && drag.px != null ? drag.px - r.left : p.x, sy = drag && drag.py != null ? drag.py - r.top : p.y;
    const dxn = Math.max(-1, Math.min(1, (sx - p.x) / 90)), dyn = Math.max(-1, Math.min(1, (sy - p.y) / 90));
    if (!refuse) A.heading += angDiff(A.heading, faceCam(A)) * Math.min(1, dt * 5);
    if (refuse) {
      P.hYaw = (dxn >= 0 ? -1 : 1) * 0.85;              // looks away from the food
      P.hPitch = 0.1;
      if (!L.noed) { L.noed = true; if (pet.status !== 'sleeping') react(A, 'no'); else popAt(A, '💤', 0.2, 0); }
    } else {
      P.hYaw = dxn * 0.6;
      P.hPitch = -0.3 + dyn * 0.25 - (Math.max(0, Math.sin(t * 9)) * 0.06);   // head up, mouth open, a little chomp
      P.pitch = -0.12; P.sx *= 1.03;
      if (!L.oh) { L.oh = true; popAt(A, '😮', 0.2, 0.1); }
      A.squint = 0;
    }
  }

  // ── น้องๆ มารับตอนเปิดเกม (CONTRACT_V8 §3): a few pets run to the camera, a speech bubble tells what happened ──────────
  let greet = null;             // { ids, lines, i, t, arrived }
  let greetDigest = undefined;  // undefined = not asked yet, null = nothing to tell, else the digest
  let greetWait = 0;
  const speechEl = document.createElement('div');
  speechEl.className = 'b3-speech';
  speechEl.hidden = true;
  speechEl.innerHTML = '<button type="button" class="b3-speech-body" data-b3="greet-next"><span class="b3-speech-t"></span><small></small></button><button type="button" class="b3-speech-skip" data-b3="greet-skip" aria-label="ข้าม">✕</button>';
  host.appendChild(speechEl);
  const speechT = speechEl.querySelector('.b3-speech-t');
  const speechHint = speechEl.querySelector('small');

  function greetBusy() { return !!photo || !!party || !!hatching || !!selectedCrib || !!selected || decorMode || !!revealId || !synced; }

  function maybeGreet(dt) {
    if (greet || greetDigest === null || disposed || !isOn) return;
    if (greetDigest === undefined) {
      greetDigest = ctx.takeGreeting ? (ctx.takeGreeting() || null) : null;   // once per app open (petsView keeps count)
      greetWait = 1.2;
      return;
    }
    greetWait -= dt;
    if (greetWait > 0) return;
    if (greetBusy()) { if (greetWait < -20) greetDigest = null; return; }     // never over a hatch / reveal; give up after a while
    const state = getState();
    const present = state.pets.filter(p => actors.has(p.id) && !actors.get(p.id).hidden && !actors.get(p.id).spawn);
    const plan = greetingPlan(greetDigest, present);
    greetDigest = null;
    if (!plan) return;
    const spots = greetSpots(plan.ids.length);
    greet = { ids: plan.ids, lines: plan.lines, i: 0, t: 0, arrived: 0 };
    plan.ids.forEach((id, k) => {
      const A = actors.get(id);
      A.greeting = true;
      A.hold = 0;
      A.stroke = null;
      begin(A, { type: 'walkTo', target: spots[k], speed: 1.9, onArrive: AA => {
        AA.hold = SELECT_HOLD;
        greet && greet.arrived++;
        begin(AA, { type: 'wave', dur: 2 });
        if (k % 2) later(300, () => alive(id) && react(AA, 'hop', { dur: 1, hops: 2 }));
      } });
    });
    world.boost(6000);
    showGreetLine();
  }

  function showGreetLine() {
    if (!greet) return;
    const line = greet.lines[greet.i];
    speechEl.hidden = false;
    speechT.textContent = `${line.emoji || '💬'} ${line.text}`;   // textContent: names are user text
    speechHint.textContent = greet.i < greet.lines.length - 1 ? `แตะเพื่ออ่านต่อ ▸ (${greet.i + 1}/${greet.lines.length})` : 'แตะเพื่อปิด';
    greet.t = 0;
  }

  function endGreet() {
    if (!greet) return;
    const g = greet;
    greet = null;
    speechEl.hidden = true;
    for (const id of g.ids) {
      const A = actors.get(id);
      if (!A) continue;
      A.greeting = false;
      A.hold = 1.2;
      if (A.act.type === 'walkTo') begin(A, { type: 'idle', dur: 0.5 });
    }
  }

  function advanceGreet() {
    if (!greet) return;
    if (greet.i >= greet.lines.length - 1) { endGreet(); return; }
    greet.i++;
    showGreetLine();
  }

  function stepGreet(dt) {
    if (!greet) return;
    if (hatching || decorMode) { endGreet(); return; }
    greet.t += dt;
    if (greet.t > 7 && greet.arrived >= greet.ids.length) advanceGreet();   // nobody tapped: move on by itself
    // the bubble floats over the pet the line is about (else over the middle of the row)
    const line = greet && greet.lines[greet.i];
    const A = actors.get((line && line.petId && greet.ids.includes(line.petId)) ? line.petId : greet.ids[Math.floor(greet.ids.length / 2)]);
    if (!A) return;
    const p = world.worldToScreen({ x: A.x, y: A.y + A.model.height + 0.9, z: A.z });
    const w = stage.clientWidth, half = Math.min(150, w * 0.42);
    const x = Math.max(half + 6, Math.min(w - half - 6, p.x));
    speechEl.style.transform = `translate(${x.toFixed(0)}px, ${Math.max(70, p.y).toFixed(0)}px) translate(-50%, -100%)`;
  }

  // ── เพื่อนซี้ (CONTRACT_V8 §4): friends wander, nap and play together; a heart arc when a pair forms ─────────────────
  let bfMap = new Map();        // petId -> best friend id (refreshed every sync)

  function friendOf(A) {
    const fid = bfMap.get(A.id);
    const F = fid && actors.get(fid);
    if (!F || F.hidden || F.spawn) return null;
    return { id: fid, x: F.x, z: F.z, napping: !!F.act.nap || F.pet.status === 'sleeping' };
  }

  function friendArc(A, B) {
    if (!A || !B || lowTier()) return;
    const a = headPos(A), b = headPos(B);
    for (let k = 0; k < 6; k++) {
      const u = k / 5;
      later(k * 140, () => fxo('emojiPop', world, { x: a.x + (b.x - a.x) * u, y: a.y + Math.sin(u * Math.PI) * 0.9 + 0.2, z: a.z + (b.z - a.z) * u }, k % 2 ? '💕' : '❤️'));
    }
    react(A, 'hop', { dur: 1.1, hops: 2 }); react(B, 'hop', { dur: 1.1, hops: 2 });
    A.hold = Math.max(A.hold, 2); B.hold = Math.max(B.hold, 2);
  }

  function syncFriends(state) { bfMap = bestFriendMap(state); }
  // the moment a pair becomes best friends: a heart arc between them (the toast is shown by petsView)
  const unFriend = onBestFriend(evt => { if (!evt.offline && synced && !disposed && isOn) friendArc(actors.get(evt.a), actors.get(evt.b)); });

  /** Pose of a pet that walked to its best friend: naps beside it, or nuzzles it. */
  function buddyPose(A, P, t, dt) {
    const act = A.act;
    const F = actors.get(act.friendId);
    if (!F) { act.dur = 0; return; }
    if (!act.arrived) { act.target = clampToYard(F.x + act.side, F.z + 0.15); return; } // follow the friend while walking over
    A.heading += angDiff(A.heading, Math.atan2(F.x - A.x, F.z - A.z)) * Math.min(1, dt * 6);
    if (act.mode === 'nap') { P.hop = 0; return; }
    // nuzzle: lean in, head bumps, hearts; the friend gives a little hop
    const u = act.t;
    P.pitch = -0.22 * Math.sin(Math.min(1, u / 0.5) * Math.PI);
    P.hRoll = Math.sin(u * 9) * 0.3; P.tail = Math.sin(u * 20) * 0.6;
    P.hop = Math.max(0, Math.sin(u * 6)) * 0.1;
    if (at(act, 'n1', 0.2)) { popAt(A, '💕', 0, 0.1); if (F.pet.status !== 'sleeping' && F.act.type === 'idle') react(F, 'hop', { dur: 0.7, hops: 1, height: 0.25 }); }
  }

  // ── แต่งตัวน้อง 👗 (CONTRACT_V9 §1): small merged meshes on the head / neck, emoji sprites on billboards ────────────────
  const accMat = own(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: world.toonGradient }));
  const accGeos = new Map();
  const accSprites = new Map();
  const PARTY_HAT = { id: 'party', slot: 'head', emoji: '🎉' };

  /** Parts of one accessory in "head radius = 1" units: the head centre is the origin, the top of the head is y ~ 1, +z is the face. */
  function accParts(id, keep) {
    const cyl = (rt, rb, h, seg = 14) => keep(new THREE.CylinderGeometry(rt, rb, h, seg));
    const sph = (r, ws = 10, hs = 8) => keep(new THREE.SphereGeometry(r, ws, hs));
    const box = (w, h, d) => keep(new THREE.BoxGeometry(w, h, d));
    const cone = (r, h, seg = 12) => keep(new THREE.ConeGeometry(r, h, seg));
    const tor = (R, t, ts = 6, rs = 22) => keep(new THREE.TorusGeometry(R, t, ts, rs));
    const flat = [Math.PI / 2, 0, 0];
    const ring = (n, R, y, size, cols) => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * TAU;
      return { geometry: sph(size, 8, 6), color: cols[i % cols.length], position: [Math.cos(a) * R, y, Math.sin(a) * R] };
    });
    switch (id) {
      case 'acc_bow': return [
        { geometry: sph(0.3), color: '#ff7eb3', position: [0.07, 0.99, 0.28], scale: [1.2, 0.8, 0.7], rotation: [0, 0, 0.4] },
        { geometry: sph(0.3), color: '#ff7eb3', position: [0.7, 0.86, 0.22], scale: [1.2, 0.8, 0.7], rotation: [0, 0, -0.4] },
        { geometry: sph(0.15), color: '#ff4f93', position: [0.38, 0.95, 0.27] },
      ];
      case 'acc_cap': return [
        { geometry: keep(new THREE.SphereGeometry(1.07, 14, 8, 0, TAU, 0, Math.PI * 0.4)), color: '#e8453c', position: [0, 0.02, 0] },
        { geometry: cyl(0.6, 0.6, 0.06, 14), color: '#c93a32', position: [0, 0.5, 0.85], scale: [1, 1, 0.8] },
        { geometry: sph(0.09), color: '#ffd84a', position: [0, 1.08, 0] },
      ];
      case 'acc_widehat': return [
        { geometry: cyl(1.55, 1.55, 0.06, 20), color: '#ecc977', position: [0, 0.85, 0] },
        { geometry: cyl(0.62, 0.7, 0.5, 14), color: '#ecc977', position: [0, 1.12, 0] },
        { geometry: cyl(0.71, 0.71, 0.12, 14), color: '#ff7a8a', position: [0, 0.97, 0] },
        { geometry: sph(0.13), color: '#ffffff', position: [0.5, 1.0, 0.5] },
      ];
      case 'acc_tophat': return [
        { geometry: cyl(0.95, 0.95, 0.07, 18), color: '#2b2b36', position: [0, 0.88, 0] },
        { geometry: cyl(0.62, 0.62, 0.95, 16), color: '#2b2b36', position: [0, 1.35, 0] },
        { geometry: cyl(0.64, 0.64, 0.17, 16), color: '#e0384f', position: [0, 1.02, 0] },
      ];
      case 'acc_crown': return [
        { geometry: tor(0.86, 0.05), color: '#4fae56', position: [0, 0.55, 0], rotation: flat },
        ...ring(9, 0.88, 0.58, 0.19, ['#ff6b8b', '#ffd84a', '#ffffff', '#b79bff']),
      ];
      case 'acc_grad': return [
        { geometry: cyl(0.6, 0.68, 0.3, 14), color: '#2b2b3a', position: [0, 0.93, 0] },
        { geometry: box(1.75, 0.07, 1.75), color: '#3a3a4c', position: [0, 1.13, 0], rotation: [0, 0.785, 0] },
        { geometry: sph(0.09), color: '#ffd84a', position: [0, 1.2, 0] },
        { geometry: cyl(0.02, 0.02, 0.62, 5), color: '#ffd84a', position: [0.55, 0.9, 0.05], rotation: [0, 0, 0.12] },
        { geometry: sph(0.1), color: '#ffd84a', position: [0.6, 0.55, 0.05], scale: [1, 1.5, 1] },
      ];
      case 'acc_bell': return [
        { geometry: tor(0.74, 0.07), color: '#e0384f', position: [0, -0.9, 0], rotation: flat },
        { geometry: sph(0.18), color: '#ffcf3d', position: [0, -1.06, 0.74] },
        { geometry: cyl(0.04, 0.04, 0.06, 6), color: '#8a6a10', position: [0, -1.16, 0.88] },
      ];
      case 'acc_scarf': return [
        { geometry: tor(0.78, 0.18, 7, 20), color: '#e0384f', position: [0, -0.88, 0], rotation: flat },
        { geometry: tor(0.78, 0.045, 5, 20), color: '#ffffff', position: [0, -0.8, 0], rotation: flat },
        { geometry: box(0.3, 0.8, 0.14), color: '#e0384f', position: [0.46, -1.32, 0.66], rotation: [0, 0, -0.18] },
        { geometry: box(0.3, 0.12, 0.15), color: '#ffffff', position: [0.43, -1.45, 0.67], rotation: [0, 0, -0.18] },
      ];
      case 'acc_lei': return [
        { geometry: tor(0.8, 0.02, 4, 22), color: '#4fae56', position: [0, -0.85, 0], rotation: flat },
        ...ring(11, 0.82, -0.85, 0.15, ['#ff8fb1', '#ffd84a', '#ffffff', '#ff8fb1']),
      ];
      case 'acc_butterfly': return [
        { geometry: sph(0.33), color: '#6ea8ff', position: [-0.44, -0.86, 0.76], scale: [1.1, 0.85, 0.25], rotation: [0, 0, 0.3] },
        { geometry: sph(0.33), color: '#6ea8ff', position: [0.44, -0.86, 0.76], scale: [1.1, 0.85, 0.25], rotation: [0, 0, -0.3] },
        { geometry: sph(0.22), color: '#a98bff', position: [-0.34, -1.1, 0.75], scale: [1, 0.9, 0.25] },
        { geometry: sph(0.22), color: '#a98bff', position: [0.34, -1.1, 0.75], scale: [1, 0.9, 0.25] },
        { geometry: sph(0.11), color: '#3b3b55', position: [0, -0.92, 0.82], scale: [0.8, 1.4, 0.8] },
      ];
      case 'party': return [
        { geometry: cone(0.54, 1.1), color: '#ff5fa2', position: [0, 1.5, 0] },
        { geometry: tor(0.4, 0.05), color: '#ffffff', position: [0, 1.3, 0], rotation: flat },
        { geometry: tor(0.2, 0.05), color: '#4d96ff', position: [0, 1.7, 0], rotation: flat },
        { geometry: sph(0.15), color: '#ffd84a', position: [0, 2.07, 0] },
      ];
      default: return null;
    }
  }

  function accGeometry(id) {
    if (accGeos.has(id)) return accGeos.get(id);
    const tmp = [];
    const parts = accParts(id, o => { tmp.push(o); return o; });
    const g = parts ? own(mergeStaticParts(THREE, parts)) : null;
    for (const o of tmp) o.dispose();
    accGeos.set(id, g);
    return g;
  }

  function accSpriteMat(emoji) {
    let m = accSprites.get(emoji);
    if (!m) { m = own(new THREE.SpriteMaterial({ map: fx.emojiTexture(world, emoji), transparent: true, depthWrite: false })); accSprites.set(emoji, m); }
    return m;
  }

  function clearWear(A) {
    for (const o of A.wearObjs) if (o.parent) o.parent.remove(o);
    A.wearObjs.length = 0;
    A.wearSig = '';
  }
  const wearSigOf = A => { const w = wearOf(A.pet); return `${w.head || ''}|${w.neck || ''}|${A.partyHat ? 1 : 0}|${A.model.stage}`; };

  /** One mesh (<= 1 draw call) per worn item on a model, one emoji sprite on a billboard. A party hat replaces the head item for the day. */
  function applyWear(A) {
    clearWear(A);
    const m = A.model, w = wearOf(A.pet);
    const items = [A.partyHat ? PARTY_HAT : getAccessory(w.head), getAccessory(w.neck)];
    for (const acc of items) {
      if (!acc) continue;
      let obj = null;
      if (m.kind === 'model' && m.head && m.anchor) {
        const geo = accGeometry(acc.id);
        if (!geo) continue;
        obj = new THREE.Mesh(geo, accMat);
        const r = Math.max(0.12, m.anchor.position.y / 1.02);
        obj.scale.setScalar(r);
        // a stage-3 pet already wears the 👑 sprite: head items sit on top of it
        if (acc.slot === 'head' && m.stage === 3) obj.position.y = 0.4 + (m.crownLift || 0);
        if (acc.id === 'party') obj.rotation.z = -0.14;
        m.head.add(obj);
      } else {
        obj = new THREE.Sprite(accSpriteMat(acc.emoji));
        obj.renderOrder = 6;
        if (acc.slot === 'head') { obj.center.set(0.5, 0); obj.scale.set(0.4, 0.4, 1); obj.position.set(0.06, m.stage === 3 ? m.baseHeight + 0.4 : m.baseHeight - 0.14, 0); }
        else { obj.center.set(0.5, 0.5); obj.scale.set(0.32, 0.32, 1); obj.position.set(0, 0.2, 0); }
        (m.kind === 'billboard' ? m.body : m.root).add(obj);
      }
      obj.userData.noPick = true;
      A.wearObjs.push(obj);
    }
    A.wearSig = wearSigOf(A);
  }

  /** Writes a diary line through A's js/journal.js (deduped per pet and day there); a failing call never breaks the barn. */
  function journal(kind, petId, ctx2 = {}) {
    try { update(s2 => { journalEvent(s2, kind, { petId, ...ctx2 }); }); } catch (err) { console.warn('journal failed', err); }
  }

  function wearPick(petId, accId) {
    if (!alive(petId)) return;
    const A = actors.get(petId);
    const r = ctx.run(s => wearAccessory(s, petId, accId));
    if (!r || !r.ok || !A) return;
    A.hold = Math.max(A.hold, 4);
    fxo('sparkle', world, A.id);
    popAt(A, r.acc.emoji, 0, 0.25);
    react(A, 'hop', { dur: 0.9, hops: 2, height: 0.34 });
    if (r.firstToday) later(500, () => alive(petId) && fx.heart(world, headPos(A)));
    journal('firstWear', petId, { acc: r.acc.nameTh });
  }

  function wearOff(petId, slot) {
    if (!alive(petId)) return;
    const A = actors.get(petId);
    const r = ctx.run(s => takeOffAccessory(s, petId, slot));
    if (r && r.ok && A) { A.hold = Math.max(A.hold, 3); popAt(A, '😌', 0, 0.2); }
  }

  // ── อากาศ 🌦️ (CONTRACT_V9 §4): puddle jumping, sheltering, the sun (and a rainbow) after the rain ──────────────────────
  let wxKind = 'sunny';           // sunny | cloudy | rain (A's weather.js; hourly, deterministic)
  let wxCheckAt = 0;
  let wxDebug = false;            // ?debug=1 hook: always show the rainbow
  let rainSt = null;              // while it rains: { puddles: [{x,z}], shelters: [{id,x,z,busy}] }
  let rainbow = null;             // { mesh, mat, geo, t }

  function startRain(w) {
    const eng = Array.isArray(world.puddles) && world.puddles.length ? world.puddles : null;   // the engine draws the decals
    const puddles = (eng || puddleSpots('rain:' + Math.floor(now() / 3600000), 4)).map(p => ({ x: p.x, z: p.z }));
    const spots = shelterSpots(yardProps(yardTier));
    rainSt = { puddles: puddles.slice(0, 6), shelters: spots, kind: w.kind };
  }

  function stopRain() {
    const had = rainSt;
    rainSt = null;
    for (const A of actors.values()) if (A.act.type === 'puddle' || A.act.type === 'shelter') begin(A, { type: 'hop', dur: 1.2, hops: 2, height: 0.3 });
    if (!had || !synced) return;
    // the sun comes out: sparkles over the yard, a few happy pets, and (about every other time) a rainbow
    world.boost(5000);
    for (let k = 0; k < 7; k++) later(150 + k * 260, () => fxo('sparkleAt', world, { x: Math.cos(k * 2.3) * 3.2, y: 0.5 + (k % 3) * 0.5, z: Math.sin(k * 2.3) * 2.6 }));
    const some = [...actors.values()].filter(A => !A.hidden && A.pet.status !== 'sleeping').slice(0, 3);
    some.forEach((A, k) => later(300 + k * 350, () => alive(A.id) && popAt(A, '☀️', 0, 0.1)));
    if (hashId('rainbow:' + Math.floor(now() / 3600000)) % 100 < 55 || wxDebug) later(1200, spawnRainbow);
  }

  function spawnRainbow() {
    if (rainbow || disposed) return;
    const cols = ['#ff5a5a', '#ff9f43', '#ffd84a', '#5bd36b', '#4d96ff', '#9b6bff'];
    const tmp = [];
    const parts = cols.map((c, i) => { const g = new THREE.TorusGeometry(4.6 - i * 0.2, 0.1, 5, 40, Math.PI); tmp.push(g); return { geometry: g, color: c }; });
    const geo = mergeStaticParts(THREE, parts);
    for (const g of tmp) g.dispose();
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.noPick = true;
    mesh.position.set(-5.4, -0.2, 0.6);   // the camera never sees the far sky: the arc stands over the open grass at the side of the yard
    mesh.rotation.y = Math.PI / 2;
    mesh.scale.setScalar(0.8);
    world.scene.add(mesh);
    rainbow = { mesh, mat, geo, t: 0 };
  }

  function stepRainbow(dt) {
    if (!rainbow) return;
    const R = rainbow;
    R.t += dt;
    R.mat.opacity = 0.75 * Math.min(1, R.t / 2.5) * Math.min(1, Math.max(0, (24 - R.t) / 4));
    if (R.t > 24) clearRainbow();
  }

  function clearRainbow() {
    if (!rainbow) return;
    world.scene.remove(rainbow.mesh); rainbow.geo.dispose(); rainbow.mat.dispose(); rainbow = null;
  }

  /** Called by bindWeather (js/weather.js) when the sky changes kind: rain starts / stops. */
  function onWeather(w) {
    const wasRain = isRainKind(wxKind);
    wxKind = w.kind;
    if (isRainKind(w.kind)) { if (!rainSt) startRain(w); } else if (wasRain) stopRain();
  }

  function stepWeather(dt) {
    wxCheckAt -= dt;
    if (wxCheckAt > 0 || !rainSt) return;
    wxCheckAt = 2;
    const taken = new Set(); // shelter spots a pet already stands on are taken
    for (const A of actors.values()) if (A.act.type === 'shelter' && A.act.shelterId) taken.add(A.act.shelterId);
    for (const sp of rainSt.shelters) sp.busy = taken.has(sp.id);
  }

  /** Pose of a pet jumping in a puddle (act.arrived) and of one waiting out the rain under cover. */
  function puddlePose(A, P, t, dt) {
    const act = A.act;
    if (!act.arrived) return;
    A.heading += angDiff(A.heading, faceCam(A)) * Math.min(1, dt * 3);
    const per = 0.62, u = (act.t % per) / per, h = Math.sin(u * Math.PI);
    P.hop = h * 0.4; P.sy = 1 + 0.15 * h - (1 - h) ** 6 * 0.17; P.sx = 1 - 0.06 * h + (1 - h) ** 6 * 0.1; P.tail = Math.sin(t * 20) * 0.5;
    const n = Math.floor(act.t / per);
    if (n !== act.jumps && u < 0.25) { act.jumps = n; fxo('emojiPop', world, { x: A.x + (n % 2 ? 0.28 : -0.28), y: 0.18, z: A.z + 0.1 }, '💦'); }
  }

  function shelterPose(A, P, t, dt) {
    const act = A.act;
    if (!act.arrived) return;
    A.heading += angDiff(A.heading, faceCam(A)) * Math.min(1, dt * 2.5);
    P.sy = 0.95 + Math.sin(t * 1.6 + A.seed) * 0.015; P.hPitch = 0.12; P.hRoll = Math.sin(t * 1.1 + A.seed) * 0.1;
    if (at(act, 'sh1', 0.6)) popAt(A, '☔', 0.15, 0.1);
    if (act.t > 5 && at(act, 'sh2', 5)) popAt(A, '😌', 0, 0.1);
  }

  // ── วันเกิดน้อง 🎂 (CONTRACT_V9 §5): party hat, a cake, the others gather and hop, confetti ─────────────────────────────
  const cakeMat = own(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: world.toonGradient }));
  let cakeGeo = null;
  let party = null;                  // { petId, months, x, z, group, born, confettiAt }
  function cakeGeometry() {
    if (cakeGeo) return cakeGeo;
    const tmp = [];
    const cyl = (rt, rb, h, seg = 18) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); tmp.push(g); return g; };
    const sph = r => { const g = new THREE.SphereGeometry(r, 8, 6); tmp.push(g); return g; };
    const parts = [
      { geometry: cyl(0.7, 0.72, 0.05), color: '#f4f0ea', position: [0, 0.025, 0] },
      { geometry: cyl(0.5, 0.5, 0.3), color: '#ffb3c7', position: [0, 0.2, 0] },
      { geometry: cyl(0.51, 0.51, 0.06), color: '#ffffff', position: [0, 0.33, 0] },
      { geometry: cyl(0.34, 0.34, 0.24), color: '#fff2d6', position: [0, 0.48, 0] },
      { geometry: cyl(0.35, 0.35, 0.05), color: '#ff8fb1', position: [0, 0.62, 0] },
      { geometry: cyl(0.03, 0.03, 0.22, 6), color: '#4d96ff', position: [0, 0.76, 0] },
      { geometry: sph(0.06), color: '#ffcf3d', position: [0, 0.91, 0], scale: [0.8, 1.4, 0.8] },
      ...[0, 1, 2, 3, 4].map(i => ({ geometry: sph(0.06), color: '#e0384f', position: [Math.cos((i / 5) * TAU) * 0.22, 0.67, Math.sin((i / 5) * TAU) * 0.22] })),
      ...[0, 1, 2, 3, 4, 5, 6].map(i => ({ geometry: sph(0.05), color: i % 2 ? '#ffd84a' : '#ffffff', position: [Math.cos((i / 7) * TAU) * 0.5, 0.31, Math.sin((i / 7) * TAU) * 0.5] })),
    ];
    cakeGeo = own(mergeStaticParts(THREE, parts));
    for (const g of tmp) g.dispose();
    return cakeGeo;
  }

  /** A free patch near the middle of the yard for the cake (clear of props, the bowl and the nest row). */
  function partySpotFor() {
    const cands = [[-0.7, 1.2], [0.9, 1.0], [-1.4, 0.2], [0.2, 2.0], [-2.0, 1.6], [1.6, -0.2]];
    for (const [x, z] of cands) {
      if (z < YARD.backLimit + 0.8 || dist2(x, z, YARD.bowl.x, YARD.bowl.z) < 1.4) continue;
      if (YARD.obstacles.some(o => dist2(x, z, o.x, o.z) < o.r + 1.2)) continue;
      return clampToYard(x, z);
    }
    return { x: -0.7, z: 1.2 };
  }

  function removeParty() {
    if (!party) return;
    world.removeActor(`cake-${party.petId}`);
    const A = actors.get(party.petId);
    if (A) { A.partyHat = false; A.bday = 0; if (A.wearSig !== wearSigOf(A)) applyWear(A); }
    for (const o of actors.values()) if (o.act.type === 'party') begin(o, { type: 'idle', dur: 0.6 });
    party = null;
  }

  function syncBirthday(state) {
    let host = null;
    for (const pet of state.pets) {
      const A = actors.get(pet.id);
      if (!A || A.hidden || isBusyStatus(pet.status) || !birthdayToday(pet)) continue;
      if (!host || (birthdayPending(pet) && !birthdayPending(host.pet))) host = A;
    }
    if (party && (!host || host.id !== party.petId)) removeParty();
    if (!host) return;
    host.bday = birthdayToday(host.pet);
    if (!party) {
      const at = partySpotFor();
      const group = new THREE.Group();
      group.add(new THREE.Mesh(cakeGeometry(), cakeMat));
      group.position.set(at.x, 0, at.z);
      group.scale.setScalar(synced ? 0.01 : 1);
      world.addActor(`cake-${host.id}`, group, { radius: 0.6, height: 0.9, shadowScale: 0.9, stroke: false });
      party = { petId: host.id, months: host.bday, x: at.x, z: at.z, group, born: synced ? 0 : 1, confettiAt: 3 };
      if (synced) { fx.confetti(world, { x: at.x, y: 0.9, z: at.z }, 30); fxo('sparkleAt', world, { x: at.x, y: 0.7, z: at.z }); world.boost(3000); }
    }
    host.partyHat = true;
    if (host.wearSig !== wearSigOf(host)) applyWear(host);
  }

  function stepParty(dt) {
    if (!party) return;
    if (party.born < 1) { party.born = Math.min(1, party.born + dt / 0.6); party.group.scale.setScalar(Math.max(0.01, ease.outBack(party.born))); }
    party.confettiAt -= dt;
    if (party.confettiAt < 0) {
      party.confettiAt = 7 + Math.random() * 3;
      if (!lowTier()) fx.confetti(world, { x: party.x, y: 1.1, z: party.z }, 14);
      fxo('emojiPop', world, { x: party.x, y: 1.25, z: party.z }, '🎶');
    }
  }

  /** Pose at the party: the birthday pet bounces beside its cake, the guests hop around it. */
  function partyPose(A, P, t, dt) {
    const act = A.act;
    if (!act.arrived || !party) return;
    const host = !!act.host;
    A.heading += angDiff(A.heading, host ? faceCam(A) : Math.atan2(party.x - A.x, party.z - A.z)) * Math.min(1, dt * 5);
    const per = host ? 0.7 : 0.9, u = ((act.t + A.seed) % per) / per, h = Math.sin(u * Math.PI);
    P.hop = h * (host ? 0.38 : 0.3); P.sy = 1 + 0.14 * h - (1 - h) ** 6 * 0.14; P.sx = 1 - 0.06 * h + (1 - h) ** 6 * 0.08;
    P.tail = Math.sin(t * 18) * 0.6; P.wing = Math.sin(t * 14) * 0.4;
    if (at(act, 'p1', 0.4 + (A.seed % 1) * 0.6)) popAt(A, host ? '🥳' : (hashId(A.id) % 2 ? '🎉' : '🎈'), 0.2, 0.1);
    if (host && act.t > 2.5 && at(act, 'p2', 2.5)) fx.confetti(world, headPos(A), 10);
  }

  /** The birthday gift: the first tap that day (CONTRACT_V9 §5). */
  function celebrateBirthday(petId) {
    const A = actors.get(petId);
    const r = ctx.run(s2 => claimBirthday(s2, petId));   // +1 bond via addBond, a diary line and the toast live in js/birthday.js
    if (!r || !r.ok || !A) return;
    const p = party ? { x: party.x, y: 1.0, z: party.z } : headPos(A);
    fx.confetti(world, p, 46);
    fxo('sparkleAt', world, p);
    fx.heart(world, headPos(A));
    world.boost(3500);
    for (const o of actors.values()) if (o.act.type === 'party' && o.act.arrived && o.id !== petId) react(o, 'hop', { dur: 1.1, hops: 2, height: 0.34 });
  }

  // ── โหมดถ่ายรูป 📸 (CONTRACT_V9 §2): hide the UI, free camera, shutter, then a frame + up to 3 stickers ────────────────────
  const PHOTO_FRAMES = [
    { id: 'polaroid', icon: '🖼️', name: 'โพลารอยด์' },
    { id: 'hearts', icon: '💗', name: 'หัวใจ' },
    { id: 'flowers', icon: '🌸', name: 'ดอกไม้' },
    { id: 'film', icon: '🎞️', name: 'ฟิล์ม' },
    { id: 'stars', icon: '⭐', name: 'ดาว' },
  ];
  const PHOTO_STICKERS = ['💖', '✨', '🌸', '⭐', '🎀', '🐾', '🌈', '😋'];
  const MAX_STICKERS = 3;
  const EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  let photo = null;                 // null | { phase: 'aim' | 'edit', frame, stickers: [{ e, x, y }], img, w, h, petIds }
  const photoEl = document.createElement('div');
  photoEl.className = 'b3-photo';
  photoEl.hidden = true;
  host.appendChild(photoEl);
  let photoRO = null;

  const farmNameNow = () => (getState().player && getState().player.farmName) || 'ฟาร์มของฉัน';
  const dateTextNow = () => { try { return new Date(now()).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return todayStr(); } };
  const todayStr = () => new Date(now()).toISOString().slice(0, 10);

  function enterPhoto() {
    if (photo || hatching) return;
    if (selected || selectedCrib) closeSheet();
    armedFood = null;
    decorMode = false;
    decorBtn.classList.remove('is-on');
    photo = { phase: 'aim', frame: 0, stickers: [], img: null, w: 0, h: 0, petIds: [] };
    host.classList.add('is-photo');
    hidePhotoBubbles();
    renderPhoto();
  }

  function leavePhoto() {
    if (!photo) return;
    photo = null;
    host.classList.remove('is-photo');
    photoEl.hidden = true;
    photoEl.innerHTML = '';
    if (photoRO) { photoRO.disconnect(); photoRO = null; }
    for (const c of cribs.values()) if (!c.hidden) fx.bubble(world, c.id, '💤');
    sync(getState());   // thought bubbles, nest bubbles and gift labels come back
    refreshUi();
  }

  /** Photos stay clean: need / nest / crib bubbles are 3D sprites, so they are removed while photo mode is open. */
  function hidePhotoBubbles() {
    for (const A of actors.values()) setBubble(A, '');
    for (const n of nests) fx.clearBubble(world, n.id);
    for (const c of cribs.values()) fx.clearBubble(world, c.id);
  }

  function renderPhoto() {
    if (!photo) return;
    photoEl.hidden = false;
    if (photo.phase === 'aim') {
      photoEl.className = 'b3-photo is-aim';
      photoEl.innerHTML = '<p class="b3-ph-tip">📸 ลากเพื่อหมุนมุมกล้อง · บีบหรือเลื่อนล้อเพื่อซูม</p>' +
        '<div class="b3-ph-bar"><button type="button" class="b3-ph-x" data-b3="photo-close" aria-label="ปิดโหมดถ่ายรูป">✕</button>' +
        '<button type="button" class="b3-ph-shutter" data-b3="photo-shot" aria-label="ถ่ายรูป"><span></span></button><span class="b3-ph-spacer"></span></div>';
      return;
    }
    photoEl.className = 'b3-photo is-edit';
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    photoEl.innerHTML =
      '<div class="b3-ph-stage"><div class="b3-ph-wrap"><canvas class="b3-ph-cv"></canvas><div class="b3-ph-stk"></div></div></div>' +
      '<div class="b3-ph-tools">' +
        `<div class="b3-ph-row" role="group" aria-label="กรอบรูป">${PHOTO_FRAMES.map((f, i) =>
          `<button type="button" class="b3-ph-chip${i === photo.frame ? ' is-on' : ''}" data-b3="ph-frame" data-i="${i}" aria-pressed="${i === photo.frame}"><span>${f.icon}</span><small>${f.name}</small></button>`).join('')}</div>` +
        `<div class="b3-ph-row b3-ph-stickers" role="group" aria-label="สติกเกอร์ (สูงสุด ${MAX_STICKERS})">${PHOTO_STICKERS.map(e => `<button type="button" class="b3-ph-stk-btn" data-b3="ph-sticker" data-e="${e}" aria-label="เพิ่มสติกเกอร์ ${e}">${e}</button>`).join('')}</div>` +
        '<p class="b3-ph-hint">ลากสติกเกอร์ไปวาง · แตะสติกเกอร์เพื่อเอาออก</p>' +
        '<div class="b3-ph-row b3-ph-acts">' +
          '<button type="button" class="btn btn-sm btn-primary" data-b3="ph-save">💾 เก็บลงอัลบั้ม</button>' +
          '<button type="button" class="btn btn-sm" data-b3="ph-download">⬇️ ดาวน์โหลด</button>' +
          (canShare ? '<button type="button" class="btn btn-sm" data-b3="ph-share">📤 แชร์</button>' : '') +
          '<button type="button" class="btn btn-sm btn-ghost" data-b3="ph-retake">🔁 ถ่ายใหม่</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-b3="photo-close" aria-label="ปิด">✕</button></div></div>';
    paintPhoto();
    fitPhoto();
    if (typeof ResizeObserver === 'function' && !photoRO) { photoRO = new ResizeObserver(() => fitPhoto()); photoRO.observe(photoEl); }
  }

  /** Sizes the preview to the room left above the tools (keeps the photo's aspect). */
  function fitPhoto() {
    if (!photo || photo.phase !== 'edit') return;
    const stageBox = photoEl.querySelector('.b3-ph-stage');
    const wrap = photoEl.querySelector('.b3-ph-wrap');
    if (!stageBox || !wrap || !photo.w) return;
    const bw = stageBox.clientWidth - 8, bh = stageBox.clientHeight - 8;
    if (bw <= 0 || bh <= 0) return;
    const k = Math.min(bw / photo.w, bh / photo.h);
    wrap.style.width = Math.floor(photo.w * k) + 'px';
    wrap.style.height = Math.floor(photo.h * k) + 'px';
    wrap.style.setProperty('--sw', Math.floor(Math.min(photo.w, photo.h) * k) + 'px');
  }

  function paintPhoto() {
    if (!photo || photo.phase !== 'edit') return;
    const cv = photoEl.querySelector('.b3-ph-cv');
    if (!cv) return;
    cv.width = photo.w; cv.height = photo.h;
    drawFrameOnto(cv.getContext('2d'), photo.img, photo.w, photo.h, photo.frame);
    const box = photoEl.querySelector('.b3-ph-stk');
    box.innerHTML = '';
    photo.stickers.forEach((s, i) => {
      const el = document.createElement('span');
      el.className = 'b3-sticker';
      el.textContent = s.e;
      el.dataset.i = String(i);
      el.style.left = (s.x * 100).toFixed(2) + '%';
      el.style.top = (s.y * 100).toFixed(2) + '%';
      box.appendChild(el);
    });
  }

  /** Paints photo + frame + farm name + date; stickers are drawn by the caller (they are DOM while editing). */
  function drawFrameOnto(c2, img, w, h, frameIdx) {
    c2.clearRect(0, 0, w, h);
    c2.drawImage(img, 0, 0, w, h);
    const u = Math.min(w, h) / 100;
    const f = PHOTO_FRAMES[frameIdx] || PHOTO_FRAMES[0];
    const name = farmNameNow(), date = dateTextNow();
    const emoji = (txt, x, y, size) => { c2.font = `${size}px ${EMOJI_FONT}`; c2.textAlign = 'center'; c2.textBaseline = 'middle'; c2.fillText(txt, x, y); };
    const text = (txt, x, y, size, color, weight = 'bold') => {
      c2.font = `${weight} ${size}px "Prompt","Segoe UI",sans-serif`; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillStyle = color; c2.fillText(txt, x, y);
    };
    const pill = (cx, cy, pw, ph, fill, stroke) => {
      c2.beginPath();
      const r = ph / 2;
      c2.moveTo(cx - pw / 2 + r, cy - ph / 2); c2.arcTo(cx + pw / 2, cy - ph / 2, cx + pw / 2, cy + ph / 2, r); c2.arcTo(cx + pw / 2, cy + ph / 2, cx - pw / 2, cy + ph / 2, r);
      c2.arcTo(cx - pw / 2, cy + ph / 2, cx - pw / 2, cy - ph / 2, r); c2.arcTo(cx - pw / 2, cy - ph / 2, cx + pw / 2, cy - ph / 2, r); c2.closePath();
      c2.fillStyle = fill; c2.fill();
      if (stroke) { c2.lineWidth = u * 0.5; c2.strokeStyle = stroke; c2.stroke(); }
    };
    const caption = (cy, fill, ink, stroke) => {
      c2.font = `bold ${u * 4.2}px "Prompt","Segoe UI",sans-serif`;
      const tw = Math.min(w * 0.9, Math.max(c2.measureText(name).width + u * 9, u * 30));
      pill(w / 2, cy, tw, u * 10.4, fill, stroke);
      let size = u * 4.2;
      c2.font = `bold ${size}px "Prompt","Segoe UI",sans-serif`;
      while (c2.measureText(name).width > tw - u * 6 && size > u * 2) { size -= u * 0.3; c2.font = `bold ${size}px "Prompt","Segoe UI",sans-serif`; }
      text(name, w / 2, cy - u * 1.5, size, ink);
      text(date, w / 2, cy + u * 2.8, u * 2.6, ink, 'normal');
    };
    c2.save();
    switch (f.id) {
      case 'polaroid': {
        const b = u * 4.2, bb = u * 15;
        c2.fillStyle = '#fffdf6';
        c2.fillRect(0, 0, w, b); c2.fillRect(0, 0, b, h); c2.fillRect(w - b, 0, b, h); c2.fillRect(0, h - bb, w, bb);
        c2.strokeStyle = 'rgba(90,70,54,.25)'; c2.lineWidth = u * 0.35; c2.strokeRect(b, b, w - 2 * b, h - b - bb);
        text(name, w / 2, h - bb * 0.62, Math.min(u * 5, (w - 2 * b) / Math.max(6, name.length) * 1.5), '#5a4636');
        text(`${date} 🐾`, w / 2, h - bb * 0.26, u * 3, '#8d7a66', 'normal');
        break;
      }
      case 'hearts': {
        const b = u * 5.5;
        c2.fillStyle = '#ffc7da';
        c2.fillRect(0, 0, w, b); c2.fillRect(0, h - b, w, b); c2.fillRect(0, 0, b, h); c2.fillRect(w - b, 0, b, h);
        c2.strokeStyle = '#ffffff'; c2.lineWidth = u * 0.8; c2.strokeRect(b, b, w - 2 * b, h - 2 * b);
        const step = u * 9;
        for (let x = step / 2; x < w; x += step) { emoji('💗', x, b / 2, u * 4); emoji('💗', x, h - b / 2, u * 4); }
        for (let y = step / 2 + b; y < h - b; y += step) { emoji('💗', b / 2, y, u * 4); emoji('💗', w - b / 2, y, u * 4); }
        caption(h - b - u * 8, '#fff6f9', '#c2476f', '#ff9fbd');
        break;
      }
      case 'flowers': {
        const b = u * 6;
        c2.fillStyle = '#dff3cf';
        c2.fillRect(0, 0, w, b); c2.fillRect(0, h - b, w, b); c2.fillRect(0, 0, b, h); c2.fillRect(w - b, 0, b, h);
        c2.strokeStyle = '#7bbf6a'; c2.lineWidth = u * 0.6; c2.strokeRect(b, b, w - 2 * b, h - 2 * b);
        const step = u * 8, fl = ['🌸', '🌼', '🌷'];
        let i = 0;
        for (let x = step / 2; x < w; x += step, i++) { emoji(fl[i % 3], x, b / 2, u * 4.6); emoji(fl[(i + 1) % 3], x, h - b / 2, u * 4.6); }
        for (let y = step / 2 + b, j = 0; y < h - b; y += step, j++) { emoji(fl[j % 3], b / 2, y, u * 4.6); emoji(fl[(j + 2) % 3], w - b / 2, y, u * 4.6); }
        caption(h - b - u * 8, '#fffef2', '#3f7d36', '#9ccf8a');
        break;
      }
      case 'film': {
        const bar = u * 9;
        c2.fillStyle = '#16161c';
        c2.fillRect(0, 0, w, bar); c2.fillRect(0, h - bar, w, bar);
        c2.fillRect(0, 0, u * 2.2, h); c2.fillRect(w - u * 2.2, 0, u * 2.2, h);
        c2.fillStyle = '#f0ead8';
        const step = u * 6.4;
        for (let x = step / 2; x < w - u * 3; x += step) {
          c2.fillRect(x - u * 1.2, u * 2.6, u * 2.4, u * 3.2);
          c2.fillRect(x - u * 1.2, h - bar + u * 3.2, u * 2.4, u * 3.2);
        }
        text(`${name} · ${date}`, w / 2, h - bar - u * 3.2, Math.min(u * 3.4, w / Math.max(10, name.length + date.length) * 1.6), '#fff3c4');
        break;
      }
      default: { // stars
        const g = c2.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#2c2f7a'); g.addColorStop(1, '#7a3fa3');
        const b = u * 5.5;
        c2.fillStyle = g;
        c2.fillRect(0, 0, w, b); c2.fillRect(0, h - b, w, b); c2.fillRect(0, 0, b, h); c2.fillRect(w - b, 0, b, h);
        c2.strokeStyle = '#ffd84a'; c2.lineWidth = u * 0.6; c2.strokeRect(b, b, w - 2 * b, h - 2 * b);
        const step = u * 10, st = ['✨', '⭐', '✨'];
        let i = 0;
        for (let x = step / 2; x < w; x += step, i++) { emoji(st[i % 3], x, b / 2, u * 3.8); emoji(st[(i + 1) % 3], x, h - b / 2, u * 3.8); }
        for (let y = step / 2 + b, j = 0; y < h - b; y += step, j++) { emoji(st[j % 3], b / 2, y, u * 3.8); emoji(st[(j + 1) % 3], w - b / 2, y, u * 3.8); }
        caption(h - b - u * 8, '#fff9d8', '#3b2f7a', '#ffd84a');
      }
    }
    c2.restore();
  }

  /** The finished picture: photo + frame + stickers at the snapshot's resolution. */
  function composePhoto() {
    const cv = document.createElement('canvas');
    cv.width = photo.w; cv.height = photo.h;
    const c2 = cv.getContext('2d');
    drawFrameOnto(c2, photo.img, photo.w, photo.h, photo.frame);
    const size = Math.min(photo.w, photo.h) * 0.2;
    c2.font = `${size}px ${EMOJI_FONT}`; c2.textAlign = 'center'; c2.textBaseline = 'middle';
    for (const s of photo.stickers) c2.fillText(s.e, s.x * photo.w, s.y * photo.h);
    return cv;
  }

  async function takeShot() {
    const W = stage.clientWidth || 360, H = stage.clientHeight || 480;
    const k = 960 / Math.max(W, H);
    const width = Math.max(240, Math.round(W * k)), height = Math.max(240, Math.round(H * k));
    if (typeof world.snapshot === 'function') return world.snapshot({ width, height, hideUi: true });
    world.renderer.render(world.scene, world.camera);          // fallback: the canvas as it is, right after a render
    return world.canvas.toDataURL('image/jpeg', 0.9);
  }

  const loadImage = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image failed')); im.src = src; });

  async function shutter() {
    if (!photo || photo.phase !== 'aim' || photo.busy) return;
    photo.busy = true;
    const flash = document.createElement('div');
    flash.className = 'b3-flash';
    host.appendChild(flash);
    later(420, () => flash.remove());
    try {
      const url = await takeShot();
      const img = await loadImage(url);
      if (!photo || disposed) return;
      photo.img = img; photo.w = img.naturalWidth || img.width; photo.h = img.naturalHeight || img.height;
      photo.petIds = [];
      for (const A of actors.values()) {
        if (A.hidden) continue;
        const p = world.worldToScreen({ x: A.x, y: A.model.height * 0.5, z: A.z });
        if (p.visible && p.x > 0 && p.y > 0 && p.x < stage.clientWidth && p.y < stage.clientHeight) photo.petIds.push(A.id);
      }
      photo.phase = 'edit';
      photo.busy = false;
      renderPhoto();
    } catch (err) {
      console.warn('photo failed', err);
      if (photo) photo.busy = false;
      notify('ถ่ายรูปไม่สำเร็จ ลองใหม่อีกครั้งนะ', 'warn');
    }
  }

  const photoFileName = () => photoFilename({ at: now() });

  async function savePhotoToAlbum() {
    if (!photo || photo.phase !== 'edit' || photo.saving) return;   // a double tap saves once
    photo.saving = true;
    const saveBtn = photoEl.querySelector('[data-b3="ph-save"]');
    if (saveBtn) saveBtn.disabled = true;
    const url = composePhoto().toDataURL('image/jpeg', 0.86);
    const ids = photo.petIds.slice(0, 12);
    const res = await savePhoto(url, { petIds: ids, frame: photo.frame });   // IndexedDB; falls back to a download by itself
    if (res && res.stored) notify('📸 เก็บรูปลงอัลบั้มแล้ว — ดูได้ที่ 🖼️ อัลบั้ม', 'success');
    else if (res && res.ok) notify('เก็บในอัลบั้มไม่ได้ เลยโหลดรูปเป็นไฟล์ให้แทนนะ 📥', 'info');
    else notify('เก็บรูปไม่สำเร็จ ลองใหม่อีกครั้งนะ', 'warn');
    if (res && res.ok) journal('photo', ids[0] || undefined);
    leavePhoto();
  }

  async function sharePhoto() {
    if (!photo || photo.phase !== 'edit' || typeof navigator.share !== 'function') return;
    const url = composePhoto().toDataURL('image/jpeg', 0.86);
    try {
      const blob = await (await fetch(url)).blob();
      const text = `${farmNameNow()} — รูปน้องๆ จาก NongFarm 🐾`;
      if (!(await shareBlob(blob, text))) await navigator.share({ title: farmNameNow(), text });
    } catch (err) { if (err && err.name !== 'AbortError') console.warn('share failed', err); }
  }

  // sticker dragging: pointer events on the sticker layer (tap without moving = remove)
  let stk = null;
  photoEl.addEventListener('pointerdown', ev => {
    const el = ev.target.closest && ev.target.closest('.b3-sticker');
    if (!el || !photo) return;
    const wrap = photoEl.querySelector('.b3-ph-wrap');
    if (!wrap) return;
    ev.preventDefault();
    try { el.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
    stk = { el, i: Number(el.dataset.i), id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, moved: false, wrap };
  });
  photoEl.addEventListener('pointermove', ev => {
    if (!stk || ev.pointerId !== stk.id || !photo) return;
    if (!stk.moved && Math.hypot(ev.clientX - stk.x0, ev.clientY - stk.y0) < 6) return;
    stk.moved = true;
    const r = stk.wrap.getBoundingClientRect();
    const s = photo.stickers[stk.i];
    if (!s || !r.width) return;
    s.x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    s.y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    stk.el.style.left = (s.x * 100).toFixed(2) + '%';
    stk.el.style.top = (s.y * 100).toFixed(2) + '%';
  });
  const stkEnd = ev => {
    if (!stk || ev.pointerId !== stk.id) return;
    const was = stk;
    stk = null;
    if (!was.moved && photo && ev.type === 'pointerup') { photo.stickers.splice(was.i, 1); paintPhoto(); }
  };
  photoEl.addEventListener('pointerup', stkEnd);
  photoEl.addEventListener('pointercancel', stkEnd);

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
    wear: btn => { if (btn.dataset.petId) { sheetMode = 'wear'; refreshUi(); } },
    'wear-pick': btn => wearPick(btn.dataset.petId, btn.dataset.accId),
    'wear-off': btn => wearOff(btn.dataset.petId, btn.dataset.slot),
    photo: () => enterPhoto(),
    'photo-close': () => leavePhoto(),
    'photo-shot': () => { shutter(); },
    'ph-frame': btn => { if (photo) { photo.frame = Number(btn.dataset.i) || 0; renderPhoto(); } },
    'ph-sticker': btn => {
      if (!photo) return;
      if (photo.stickers.length >= MAX_STICKERS) { notify(`ใส่สติกเกอร์ได้สูงสุด ${MAX_STICKERS} ชิ้นนะ`, 'info'); return; }
      const n = photo.stickers.length;
      photo.stickers.push({ e: btn.dataset.e, x: 0.3 + n * 0.2, y: 0.28 + (n % 2) * 0.14 });
      paintPhoto();
    },
    'ph-save': () => { savePhotoToAlbum(); },
    'ph-download': () => { if (photo && photo.phase === 'edit') downloadPhoto(composePhoto().toDataURL('image/jpeg', 0.9), photoFileName()); },
    'ph-share': () => { sharePhoto(); },
    'ph-retake': () => { if (photo) { photo.phase = 'aim'; photo.stickers = []; photo.img = null; renderPhoto(); } },
    'greet-next': () => advanceGreet(),
    'greet-skip': () => endGreet(),
    'tray-food': btn => {
      if (performance.now() - dragEndedAt < 350) return;   // the click that follows a drag-feed
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
    'collect-all': () => collectAll(),
    'nursery-adopt': btn => ctx.nurseryAdopt(btn.dataset.petId),
    'nursery-swap': btn => ctx.nurserySwap(btn.dataset.petId),
    'nursery-rehome': btn => ctx.nurseryRehome(btn.dataset.petId),
    'decor-mode': () => {
      decorMode = !decorMode;
      decorBtn.classList.toggle('is-on', decorMode);
      decorBtn.setAttribute('aria-pressed', String(decorMode));
      if (decorMode && (selected || selectedCrib)) closeSheet();
      syncDecor(getState());
      refreshUi();
    },
  };
  const onClick = ev => {
    const btn = ev.target.closest('[data-b3]');
    if (!btn || !host.contains(btn) || btn.disabled) return;
    const fn = handlers[btn.dataset.b3];
    if (fn) fn(btn);
  };
  host.addEventListener('click', onClick);
  trayEl.addEventListener('pointerdown', onTrayDown);
  document.addEventListener('pointermove', onDragMove, { passive: false });
  document.addEventListener('pointerup', onDragUp);
  document.addEventListener('pointercancel', onDragUp);
  const unStroke = typeof world.onPetStroke === 'function' ? world.onPetStroke(onStroke) : null;
  host.tabIndex = -1;
  const onKey = ev => {
    if (ev.key === 'Escape' && drag) { endDrag(true); return; }
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

  /** The selected pet or crib: { x, z, h (height), r (radius) } or null. */
  function selTarget() {
    const A = selected && actors.get(selected);
    if (A) return { x: A.x, z: A.z, h: A.model.height, r: A.model.radius };
    const c = selectedCrib && cribs.get(selectedCrib);
    return c ? { x: c.x, z: c.z, h: 0.7, r: 0.7 } : null;
  }

  function updateCameraPan(dt) {
    const sel = selTarget();
    const H = stage.clientHeight, W = stage.clientWidth;
    if (sel && !sheetEl.hidden && H > 0) {
      const sheetH = sheetEl.offsetHeight;
      const p = world.worldToScreen({ x: sel.x, y: sel.h * 0.55, z: sel.z });
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
    if (drag && drag.active) {
      for (const A of actors.values()) {
        if (A.id === drag.targetId) { A.feedLook = A.feedLook || {}; A.hold = Math.max(A.hold, 1.2); } else A.feedLook = null;
      }
    }
    maybeGreet(dt);
    stepGreet(dt);
    for (const A of actors.values()) {
      step(A, dt, t);
    }
    resolveCollisions(dt);
    for (const A of actors.values()) applyPose(A, t, dt);
    for (const [id, rec] of poopMeshes) {
      const s = rec.group.scale.x;
      if (s < 1) rec.group.scale.setScalar(Math.min(1, s + dt * 4));
    }
    for (const A of actors.values()) {
      if (A.hidden) continue;
      A.waveAt -= dt;
      if (A.waveAt < 0) { // a pet whose gift is full waves at you now and then
        A.waveAt = 7 + Math.random() * 6;
        if (A.gift && A.gift.full && !A.spawn && A.hold <= 0 && !A.pet.sick && A.pet.status !== 'sleeping' && (A.act.type === 'idle' || A.act.type === 'lookAtCamera')) begin(A, { type: 'wave', dur: 1.7 });
      }
      A.puffAt -= dt;
      if (A.puffAt < 0) {
        A.puffAt = 10 + Math.random() * 8;
        if ((A.pet.speciesId === 'dragon' || A.pet.speciesId === 'dragonhead') && A.act.type === 'idle' && !A.spawn) breathPuff(A);
      }
      A.sparkleAt -= dt;
      if (A.sparkleAt < 0) {
        A.sparkleAt = 7 + Math.random() * 9;
        const sp = getSpecies(A.pet.speciesId);
        const epic = sp && sp.rarity === 'epic';
        if ((A.pet.shiny || epic) && A.pet.status !== 'sleeping' && !lowTier()) fxo('sparkle', world, A.id);
      }
    }
    stepWeather(dt);
    stepRainbow(dt);
    stepParty(dt);
    animateNests(t, dt);
    animateCribs(t, dt);
    stepDecor(dt, t);
    stepPops(dt);
    stepHatch(dt);
    stepTemps(dt);
    // selection ring
    const sel = selTarget();
    if (sel) {
      ring.visible = true;
      ring.position.x = sel.x; ring.position.z = sel.z;
      const s = Math.max(0.7, sel.r * 1.6) * (1 + Math.sin(t * 4) * 0.04);
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


  buildYardProps(yardTier);
  sync(getState());
  const unWeather = bindWeather(world, { onChange: onWeather });   // real-hour weather (js/weather.js); ?weather=rain forces it
  if (/[?&]debug=1/.test(location.search)) host.__b3debug = { world, actors: () => actors, cribs: () => cribs, decor: () => decorInst, tap: id => onTap(id), stroke: (id, phase, region, point, ms) => onStroke({ id, phase, region, point: point || { x: 0, y: 0.5, z: 0 }, durationMs: ms }), greet: d => { greetDigest = d; greetWait = 0; }, kick: id => { const i = decorInst.get(id); if (i) kickBall(null, i); },
    weather: k => { wxDebug = true; world.setWeather(k, 1); onWeather({ kind: k, intensity: 1 }); }, photo: () => enterPhoto(), info: () => ({ party, rainSt, wxKind, photo, stats: world.getStats() }), applyWear: id => applyWear(actors.get(id)) };

  return {
    setActive(on) {
      // Called from a MutationObserver in petsView (our own DOM updates trigger it): must be idempotent.
      if (disposed || on === isOn) return;
      isOn = !!on;
      if (!isOn) announceHatch(); // the world pauses: do not keep the player waiting for the toast
      world.setActive(isOn);
      if (isOn) sync(getState());
    },
    dispose() {
      if (disposed) return;
      if (hatching) { // toggled to the list / left mid-ceremony: never lose the news
        announceHatch();
        if (hatching.pet && !hatching.revealShown && ctx.revealHatch) ctx.revealHatch(hatching.pet, !!hatching.nurseryPetId);
        endHatch();
      }
      disposed = true;
      unsub();
      unFrame();
      for (const id of timers) clearTimeout(id);
      timers.clear();
      host.removeEventListener('click', onClick);
      trayEl.removeEventListener('pointerdown', onTrayDown);
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragUp);
      document.removeEventListener('pointercancel', onDragUp);
      if (unStroke) unStroke();
      unFriend();
      endDrag(false);
      document.removeEventListener('keydown', onKey);
      try { world.camera.clearViewOffset(); } catch { /* ignore */ }
      for (const tg of tags) tg.el.remove();
      try { world.dispose(); } catch (e) { console.error(e); }
      for (const o of owned) { try { o.dispose(); } catch { /* already disposed */ } }
      if (lanternMat) lanternMat.dispose();
      unWeather();
      clearRainbow();
      if (photoRO) photoRO.disconnect();
      for (const el of flyCoins) el.remove();
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

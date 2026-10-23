// Procedural chibi critter kit for the 3D barn (CONTRACT_V4 §2).
// THREE is passed in (vendored r160) so this module has no import of it and stays testable.
//
//   hasModel(speciesId)                    -> bool
//   buildPetModel(THREE, pet, species)     -> { root, body, head, height, radius, kind, ... }
//   buildBillboard(THREE, emoji, opts?)    -> same shape, kind 'billboard'
//
// Conventions: model faces +Z, +Y is up, origin = feet on the ground. `body` is the squash/stretch
// target (origin at the feet); `head` is a child group pivoting at the head centre (look-at / nod).
// Stage scale lives on `root` (so B's body.scale squash never fights it). Everything built here
// shares geometries (unit shapes, scaled per mesh) and materials (keyed by colour) per THREE instance.

import { MODEL_SPECS } from '../data/models.js';

export const STAGE_SCALE = [0.7, 0.85, 1.0, 1.15];
export const LEGENDARY_SCALE = 1.25;
const EYE = '#2a2024';
const NOSE = '#3a2a2e';
const BLUSH = '#ff8fa3';

export function hasModel(speciesId) {
  return Object.prototype.hasOwnProperty.call(MODEL_SPECS, speciesId);
}

// ── per-THREE caches ────────────────────────────────────────────────────────
const kits = new WeakMap();
function kit(T) {
  let k = kits.get(T);
  if (!k) { k = { geo: new Map(), mat: new Map(), tex: new Map(), tpl: new Map(), grad: null, dummy: null }; kits.set(T, k); }
  return k;
}

// Unit shapes. Cones/cylinders have their base at y=0 and extend to y=1.
const GEO = {
  sph:   T => new T.SphereGeometry(1, 12, 9),
  sphM:  T => new T.SphereGeometry(1, 10, 7),
  sphL:  T => new T.SphereGeometry(1, 8, 5),
  sphP:  T => new T.SphereGeometry(1, 6, 4),
  cone:  T => new T.ConeGeometry(1, 1, 10, 1).translate(0, 0.5, 0),
  cyl:   T => new T.CylinderGeometry(1, 1, 1, 8, 1).translate(0, 0.5, 0),
  cylT:  T => new T.CylinderGeometry(1, 0.78, 1, 8, 1).translate(0, 0.5, 0),
  thin:  T => new T.CylinderGeometry(1, 1, 1, 4, 1).translate(0, 0.5, 0),
  disc:  T => new T.CircleGeometry(1, 10),
  discS: T => new T.CircleGeometry(1, 6),
  box:   T => new T.BoxGeometry(1, 1, 1),
  ring:  T => new T.TorusGeometry(1, 0.16, 5, 12),
  curl:  T => new T.TorusGeometry(1, 0.26, 6, 12, Math.PI * 1.75),
  hood:  T => new T.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.58),
};
function geo(T, name) {
  const k = kit(T);
  let g = k.geo.get(name);
  if (!g) { g = GEO[name](T); k.geo.set(name, g); }
  return g;
}

function gradient(T) {
  const k = kit(T);
  if (!k.grad) {
    const data = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
    const t = new T.DataTexture(data, 3, 1, T.RGBAFormat);
    t.minFilter = t.magFilter = T.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    k.grad = t;
  }
  return k.grad;
}
/** The ONE material every critter body/head/ear/tail/wing mesh uses: colours live in vertex colours. */
function critterMat(T, grad) {
  const k = kit(T);
  const g = grad || gradient(T);
  const key = 'critter|' + g.uuid;
  let m = k.mat.get(key);
  if (!m) { m = new T.MeshToonMaterial({ vertexColors: true, gradientMap: g }); k.mat.set(key, m); }
  return m;
}
/** Flat material for the merged eyes mesh (vertex coloured: dark dome + white highlights). */
function eyeMat(T) {
  const k = kit(T);
  let m = k.mat.get('eyes');
  if (!m) { m = new T.MeshBasicMaterial({ vertexColors: true }); k.mat.set('eyes', m); }
  return m;
}

/** Shared-resource counts (for tests / debugging). */
export function kitStats(T) {
  const k = kit(T);
  return { geometries: k.geo.size, materials: k.mat.size, textures: k.tex.size, templates: k.tpl.size };
}

// ── colour handling (shiny = curated per-species palette, else a gentle pastel shift) ──
function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/** curated: { '#from': '#to' } from the spec's shinyPalette. Unlisted colours stay as they are when a palette exists. */
function makePalette(T, shiny, seed, curated) {
  if (!shiny) return hex => hex;
  const cs = T.SRGBColorSpace;
  const deg = 28 + (hashStr(seed) % 28);                     // gentle fallback: 28..55 degrees, never more
  const cache = new Map();
  return hex => {
    const key = String(hex).toLowerCase();
    if (curated) return curated[key] || hex;
    let out = cache.get(key);
    if (!out) {
      const c = new T.Color(key);
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl, cs);
      hsl.h = (hsl.h + deg / 360) % 1;
      hsl.s = Math.max(hsl.s * 0.95, 0.28);
      hsl.l = hsl.l + (1 - hsl.l) * 0.16;                    // a touch lighter / sparklier
      c.setHSL(hsl.h, hsl.s, hsl.l, cs);
      out = '#' + c.getHexString(cs);
      cache.set(key, out);
    }
    return out;
  };
}

// ── emoji sprites / billboards ──────────────────────────────────────────────
function emojiTexture(T, emoji) {
  const k = kit(T);
  const key = emoji;
  let tex = k.tex.get(key);
  if (!tex) {
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.font = '96px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2 + 6);
    tex = new T.CanvasTexture(cv);
    if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    k.tex.set(key, tex);
  }
  return tex;
}
function spriteMat(T, emoji) {
  const k = kit(T);
  const key = 's' + emoji;
  let m = k.mat.get(key);
  if (!m) {
    m = new T.SpriteMaterial({ map: emojiTexture(T, emoji), transparent: true, depthWrite: false });
    k.mat.set(key, m);
  }
  return m;
}

function applyStage(T, m, stage) {
  const st = Math.max(0, Math.min(3, stage | 0));
  const stageScale = STAGE_SCALE[st];
  const s = stageScale * (m.legendary ? LEGENDARY_SCALE : 1);
  m.stage = st;
  m.stageScale = stageScale;
  m.scale = s;
  m.root.scale.setScalar(s);
  if (m.head && m.kind === 'model' && st === 0) m.head.scale.setScalar(1.1); // babies: bigger head
  if (st === 3) {
    const crown = new T.Sprite(spriteMat(T, '\u{1F451}'));
    crown.center.set(0.5, 0);
    crown.name = 'crown';
    if (m.head && m.anchor) {
      // rides on the head (follows nods / roars), just above the head-top anchor; compensate the head's own scale
      const hs = m.head.scale.y || 1;
      crown.scale.set(0.38 / hs, 0.38 / hs, 1);
      crown.position.set(0, (m.anchor.position.y + 0.02 + (m.crownLift || 0)) / hs, 0);
      m.head.add(crown);
    } else {
      crown.scale.set(0.38, 0.38, 1);
      crown.position.set(0, m.baseHeight + 0.02, 0);                // billboards: centred above the sprite
      m.root.add(crown);
    }
    m.parts.crown = crown;
  }
  m.height = (st === 3 ? Math.max(m.baseHeight, (m.crownY ?? m.baseHeight) + 0.4) : m.baseHeight) * s;
  m.radius = m.baseRadius * s;
  return m;
}

/**
 * Emoji on a camera-facing sprite; same return shape as buildPetModel. opts: { stage, shiny, rarity }.
 * Never applies a colour filter: shiny billboards just report shinyStyle 'halo' (the scene adds glowHalo + twinkle).
 */
export function buildBillboard(T, emoji, opts = {}) {
  const root = new T.Group();
  root.name = 'billboard';
  const body = new T.Group();
  body.name = 'body';
  root.add(body);
  const sprite = new T.Sprite(spriteMat(T, emoji || '❓'));
  sprite.center.set(0.5, 0.04);
  sprite.scale.set(0.95, 0.95, 1);
  body.add(sprite);
  const anchor = new T.Object3D();
  anchor.position.set(0, 0.95, 0);
  body.add(anchor);
  const m = {
    root, body, head: null, kind: 'billboard', shiny: !!opts.shiny, shinyStyle: opts.shiny ? 'halo' : null, anchor, parts: {},
    rarity: opts.rarity || 'common', legendary: opts.rarity === 'legendary',
    baseHeight: 0.95, baseRadius: 0.4, height: 0.95, radius: 0.4, stage: 2, stageScale: 1,
  };
  return applyStage(T, m, opts.stage ?? 2);
}

// ── the model builder ───────────────────────────────────────────────────────
/**
 * pet: { stage 0..3, shiny, speciesId }, species: entry from species.js (needs .id, .emoji).
 * Species without a MODEL_SPECS entry fall back to an emoji billboard.
 * opts.toonGradient: the world's shared gradient texture (else the kit's own 3-tone one). Nothing here is ever disposed.
 */
export function buildPetModel(T, pet, species, opts = {}) {
  const stage = pet && Number.isFinite(pet.stage) ? pet.stage : 2;
  const shiny = !!(pet && pet.shiny);
  const id = (species && species.id) || (pet && pet.speciesId);
  const spec = id && hasModel(id) ? MODEL_SPECS[id] : null;
  const rarity = (species && species.rarity) || 'common';
  if (!spec) return buildBillboard(T, (species && species.emoji) || '❓', { stage, shiny, rarity });
  const tpl = template(T, spec, shiny, id, opts.toonGradient || null);
  const root = tpl.root.clone(true); // Mesh.clone shares geometry + material: no new buffers
  const find = n => root.getObjectByName(n) || null;
  const eyes = find('eyes');
  const earL = find('earL'), earR = find('earR');
  const m = {
    root, body: find('body'), head: find('head'), kind: 'model', shiny, shinyStyle: shiny ? 'palette' : null, anchor: find('anchor'),
    rarity, legendary: rarity === 'legendary',
    parts: {
      eyes: eyes ? [eyes] : [], ears: [earL, earR].filter(Boolean), earL, earR,
      tail: find('tail'), tailTip: find('tailTip'), wingL: find('wingL'), wingR: find('wingR'),
      trunk: find('trunk'), mane: find('mane'), breath: find('breath'), crown: null,
    },
    crownY: tpl.crownY, crownLift: tpl.crownLift, baseHeight: tpl.baseHeight, baseRadius: tpl.baseRadius, height: tpl.baseHeight, radius: tpl.baseRadius,
    stage: 2, stageScale: 1,
  };
  return applyStage(T, m, stage);
}

/** Cached per (species, shiny, gradient): merged geometries are built once and shared by every pet. */
function template(T, spec, shiny, id, grad) {
  const k = kit(T);
  const key = id + '|' + (shiny ? 1 : 0) + '|' + (grad || gradient(T)).uuid;
  let t = k.tpl.get(key);
  if (!t) { t = assemble(T, spec, shiny, id, grad); k.tpl.set(key, t); }
  return t;
}

const TAU = Math.PI * 2;

function assemble(T, spec, shiny, seed, grad) {
  const pal = makePalette(T, shiny, seed, spec.shinyPalette);
  const tm = hex => ({ hex: pal(hex) });   // body-like colour (shifted when shiny); baked into vertex colours
  const fm = hex => ({ hex });             // fixed colour
  const bm = hex => ({ hex });
  const V3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const AX_Y = V3(0, 1, 0);
  const AX_Z = V3(0, 0, 1);

  const root = new T.Group();
  root.name = 'pet';
  const bodyG = new T.Group();
  bodyG.name = 'body';
  root.add(bodyG);

  /** Adds a (temporary) mesh of a shared unit geometry; its colour is baked into the merged geometry later. */
  const dummy = (kit(T).dummy ||= new T.MeshBasicMaterial());
  const put = (parent, g, col, sx, sy, sz, x = 0, y = 0, z = 0) => {
    const m = new T.Mesh(geo(T, g), dummy);
    m.userData.c = col.hex;
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  /** Point + outward normal on an ellipsoid surface. az 0 = front (+z), +az -> +x; el 0 = equator, +up. */
  const surf = (rx, ry, rz, az, el, push = 0) => {
    const x = rx * Math.cos(el) * Math.sin(az);
    const y = ry * Math.sin(el);
    const z = rz * Math.cos(el) * Math.cos(az);
    const n = V3(x / (rx * rx), y / (ry * ry), z / (rz * rz)).normalize();
    return { p: V3(x, y, z).addScaledVector(n, push), n };
  };
  const face = (obj, n) => { obj.quaternion.setFromUnitVectors(AX_Z, n); return obj; };
  const along = (obj, dir) => { obj.quaternion.setFromUnitVectors(AX_Y, dir.clone().normalize()); return obj; };

  // ---- body & legs ----
  const B = { w: 0.4, h: 0.32, d: 0.45, color: '#d9a066', ...spec.body };
  const L = { type: 'stub', h: 0.12, r: 0.08, ...spec.legs };
  const hasLegs = L.type !== 'none';
  const by = B.y ?? (hasLegs ? L.h * 0.6 + B.h * 0.95 : B.h * 0.98);
  put(bodyG, 'sph', tm(B.color), B.w, B.h, B.d, 0, by, 0);
  if (B.belly) {
    const bl = { s: 0.84, dz: 0.22, dy: -0.1, ...B.belly };
    put(bodyG, 'sphM', tm(bl.color), B.w * bl.s, B.h * bl.s * 1.05, B.d * bl.s, 0, by + B.h * bl.dy, B.d * bl.dz);
  }
  const legMat = tm(L.color || B.color);
  if (L.type === 'stub') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      put(bodyG, 'sphP', legMat, L.r, L.h * 0.62, L.r * 1.18, sx * B.w * (L.x ?? 0.55), L.h * 0.55, sz * B.d * (L.z ?? 0.5) + (L.fwd ?? 0.02));
    }
  } else if (L.type === 'long') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * B.w * (L.x ?? 0.55), z = sz * B.d * (L.z ?? 0.62);
      put(bodyG, 'cylT', legMat, L.r, L.h, L.r, x, 0, z);
      if (L.hoof) put(bodyG, 'cyl', fm(L.hoof), L.r * 1.08, L.h * 0.13, L.r * 1.08, x, 0, z);
    }
  } else if (L.type === 'bird' || L.type === 'webbed') {
    const web = L.type === 'webbed';
    for (const sx of [-1, 1]) {
      const x = sx * B.w * (L.x ?? 0.4);
      put(bodyG, 'cyl', legMat, L.r, L.h, L.r, x, 0, 0.02);
      put(bodyG, 'cyl', legMat, L.r * (web ? 4.2 : 3), L.h * 0.12, L.r * (web ? 5 : 4), x, 0, L.r * 2.2);
    }
  }

  // ---- head ----
  const H = { r: 0.3, w: 1, h: 1, d: 1, ...spec.head };
  const hr = H.r, hrx = hr * H.w, hry = hr * H.h, hrz = hr * H.d;
  const hy = H.y ?? by + B.h * 0.9 + hr * 0.35;
  const hz = H.z ?? B.d * 0.45;
  const headG = new T.Group();
  headG.name = 'head';
  headG.userData.anim = true;
  headG.position.set(0, hy, hz);
  bodyG.add(headG);
  const headColor = H.color || B.color;
  put(headG, 'sph', tm(headColor), hrx, hry, hrz);
  const hs = (az, el, push = 0) => surf(hrx, hry, hrz, az, el, push);

  if (spec.neck) {
    const N = { r: 0.12, ...spec.neck };
    const a = V3(0, by + B.h * 0.55, B.d * (N.z ?? 0.5));
    const b = V3(0, hy - hry * 0.3, hz - hrz * 0.2);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const neck = put(bodyG, 'cylT', tm(N.color || B.color), N.r, len * 1.04, N.r, a.x, a.y, a.z);
    along(neck, dir);
    neck.scale.set(N.r * (N.top ?? 1), len * 1.04, N.r * (N.top ?? 1));
  }

  // eyes
  const E = { s: 0.16, gap: 0.5, el: 0.1, ...spec.eyes };
  const er = hr * E.s;
  const eyeGroups = [];
  for (const side of [-1, 1]) {
    const { p, n } = hs(side * E.gap, E.el, -er * 0.3);
    const eg = new T.Group();
    eg.userData.anim = true; // merged into the single 'eyes' mesh below
    eg.position.copy(p);
    face(eg, n);
    put(eg, 'sphP', fm(EYE), er, er * (E.tall ?? 1.2), er * 0.6);
    put(eg, 'discS', bm('#ffffff'), er * 0.34, er * 0.34, 1, er * 0.32, er * 0.5, er * 0.62);
    put(eg, 'discS', bm('#ffffff'), er * 0.17, er * 0.17, 1, -er * 0.3, -er * 0.35, er * 0.6);
    headG.add(eg);
    eyeGroups.push(eg);
  }
  // blush
  if (spec.blush !== false) {
    const bc = spec.blush || BLUSH;
    for (const side of [-1, 1]) {
      const { p, n } = hs(side * (E.gap + 0.62), E.el - 0.3, -hr * 0.015);
      const b = put(headG, 'disc', { hex: mixHex(pal(headColor), bc, 0.6) }, hr * 0.17, hr * 0.11, 1, p.x, p.y, p.z);
      face(b, n);
    }
  }

  // ears
  if (spec.ears && spec.ears.type !== 'none') {
    const Ea = { s: 0.4, az: 0.75, el: 0.75, up: 0.4, inner: '#ffb3c1', ...spec.ears };
    const s = hr * Ea.s;
    for (const side of [1, -1]) {
      const { p, n } = hs(side * Ea.az, Ea.el, -s * 0.12);
      const outer = new T.Group();
      outer.position.copy(p);
      const pivot = new T.Group();
      outer.add(pivot);
      const mat = tm(Ea.color || headColor);
      const inn = Ea.inner ? tm(Ea.inner) : null;
      switch (Ea.type) {
        case 'round':
          along(outer, n.clone().lerp(AX_Y, Ea.up).normalize());
          put(pivot, 'sphL', mat, s * 0.62, s * 0.62, s * 0.3, 0, s * 0.15, 0);
          if (inn) put(pivot, 'disc', inn, s * 0.38, s * 0.38, 1, 0, s * 0.15, s * 0.3);
          break;
        case 'long':
          along(outer, n.clone().lerp(AX_Y, Ea.up).add(V3(side * (Ea.flare ?? 0.18), 0, 0)).normalize());
          put(pivot, 'sphM', mat, s * 0.27, s, s * 0.14, 0, s * 0.85, 0);
          if (inn) put(pivot, 'sphL', inn, s * 0.15, s * 0.78, s * 0.1, 0, s * 0.85, s * 0.07);
          break;
        case 'cat':
          along(outer, n.clone().lerp(AX_Y, Ea.up).add(V3(side * (Ea.flare ?? 0), 0, 0)).normalize());
          put(pivot, 'cone', mat, s * 0.6, s * 1.1, s * 0.34);
          if (inn) put(pivot, 'cone', inn, s * 0.36, s * 0.8, s * 0.2, 0, s * 0.02, s * 0.12);
          break;
        case 'floppy':
          outer.rotation.z = side * (Ea.flare ?? 0.28);
          put(pivot, 'sphL', mat, s * 0.42, s * 0.82, s * 0.2, side * s * 0.12, -s * 0.62, 0);
          break;
        case 'side':
          outer.rotation.z = -side * (Ea.flare ?? 0.22);
          put(pivot, 'sphL', mat, s * 0.82, s * 0.24, s * 0.3, side * s * 0.7, 0, 0);
          if (inn) put(pivot, 'sphL', inn, s * 0.6, s * 0.14, s * 0.2, side * s * 0.72, 0, s * 0.08);
          break;
        default: break;
      }
      headG.add(outer);
      if (!Ea.static) { // static ears fold into the head mesh (saves a draw call each)
        pivot.name = side > 0 ? 'earL' : 'earR';
        pivot.userData.anim = true;
      }
    }
  }

  // snout
  if (spec.snout && spec.snout.type !== 'none') {
    const Sn = { el: -0.25, ...spec.snout };
    const base = hs(0, Sn.el);
    const bp = base.p;
    switch (Sn.type) {
      case 'muzzle': {
        const w = hr * (Sn.w ?? 0.5), h = hr * (Sn.h ?? 0.38), d = hr * (Sn.d ?? 0.42);
        const cz = bp.z - d * 0.55;
        put(headG, Sn.lo ? 'sphL' : 'sphM', tm(Sn.color), w, h, d, 0, bp.y, cz);
        if (Sn.nose !== false) {
          const nc = Sn.nose || NOSE;
          put(headG, 'sphL', fm(nc), hr * (Sn.noseS ?? 0.13), hr * (Sn.noseS ?? 0.13) * 0.75, hr * 0.1, 0, bp.y + h * (Sn.noseY ?? 0.5), cz + d * 0.88);
        }
        if (Sn.nostrils) {
          for (const sx of [-1, 1]) put(headG, 'discS', fm(NOSE), w * 0.13, w * 0.19, 1, sx * w * 0.42, bp.y + h * 0.1, cz + d * 0.93);
        }
        break;
      }
      case 'nose': {
        const s = hr * (Sn.s ?? 0.1);
        put(headG, 'sphL', fm(Sn.color || NOSE), s * 1.25, s * 0.9, s * 0.8, 0, bp.y, bp.z - s * 0.2);
        break;
      }
      case 'pig': {
        const w = hr * (Sn.w ?? 0.34), len = hr * (Sn.d ?? 0.26), hh = hr * (Sn.h ?? 0.26);
        const m = put(headG, 'cyl', tm(Sn.color), w, len, hh, 0, bp.y, bp.z - len * 0.5);
        m.rotation.x = Math.PI / 2;
        for (const sx of [-1, 1]) put(headG, 'discS', fm('#8a4a5a'), w * 0.2, hh * 0.3, 1, sx * w * 0.42, bp.y, bp.z + len * 0.5 + 0.004);
        break;
      }
      case 'beak': {
        const w = hr * (Sn.w ?? 0.15), len = hr * (Sn.len ?? 0.32);
        const m = put(headG, 'cone', tm(Sn.color), w, len, w * 0.78, 0, bp.y, bp.z - len * 0.25);
        m.rotation.x = Math.PI / 2;
        break;
      }
      case 'flatbeak': {
        const w = hr * (Sn.w ?? 0.5), h = hr * (Sn.h ?? 0.15), d = hr * (Sn.d ?? 0.5);
        put(headG, 'sphM', tm(Sn.color), w, h, d, 0, bp.y, bp.z - d * 0.1);
        break;
      }
      case 'pointy': {
        const w = hr * (Sn.w ?? 0.3), h = hr * (Sn.h ?? 0.26), d = hr * (Sn.d ?? 0.6);
        put(headG, 'sphM', tm(Sn.color), w, h, d, 0, bp.y, bp.z - d * 0.35);
        put(headG, 'sphL', fm(Sn.nose || NOSE), hr * 0.1, hr * 0.085, hr * 0.085, 0, bp.y + h * 0.1, bp.z + d * 0.62);
        break;
      }
      default: break;
    }
  }

  // tail
  if (spec.tail && spec.tail.type !== 'none') {
    const Ta = { color: B.color, ...spec.tail };
    const tailG = new T.Group();
    tailG.position.set(0, by + B.h * (Ta.y ?? 0.15), -B.d * (Ta.z ?? 0.92));
    bodyG.add(tailG);
    tailG.name = 'tail';
    tailG.userData.anim = true;
    const mat = tm(Ta.color);
    switch (Ta.type) {
      case 'puff': {
        const s = Ta.s ?? 0.12;
        put(tailG, 'sphM', mat, s, s, s, 0, 0, -s * 0.6);
        break;
      }
      case 'long': {
        const n = Ta.n ?? 3, len = (Ta.len ?? 0.4) / n, r = Ta.r ?? 0.035;
        let parent = tailG;
        tailG.rotation.x = -Math.PI / 2 + (Ta.lift ?? 0.7);
        for (let i = 0; i < n; i++) {
          const g = new T.Group();
          if (i > 0) { g.position.y = len; g.rotation.x = Ta.curve ?? 0.35; }
          if (Ta.tip !== undefined && i === Ta.tip) { g.name = 'tailTip'; g.userData.anim = true; } // swings on its own
          parent.add(g);
          const rr = r * (1 - i * (Ta.taper ?? 0.12));
          const col = Ta.colors ? tm(Ta.colors[i % Ta.colors.length]) : mat;
          if (Ta.blob) put(g, 'sphL', col, rr * Ta.blob, len * 0.72, rr * Ta.blob * 0.8, 0, len * 0.5, 0);
          else put(g, 'cylT', col, rr, len * 1.05, rr);
          parent = g;
        }
        if (Ta.tuft) put(parent, 'sphL', tm(Ta.tuft), r * 2.4, r * 3.2, r * 2.4, 0, len, 0);
        if (Ta.flame) {
          put(parent, 'cone', tm('#ff7a1a'), r * 1.9, r * 4.4, r * 1.9, 0, len * 0.9, 0);
          put(parent, 'cone', tm('#ffd84a'), r * 1.1, r * 2.8, r * 1.1, 0, len * 0.9, 0);
        }
        break;
      }
      case 'fluffy': {
        tailG.rotation.x = Ta.rot ?? 0;
        put(tailG, 'sphL', mat, Ta.w ?? 0.1, Ta.h ?? 0.2, Ta.d ?? 0.1, 0, Ta.dy ?? 0.1, -(Ta.dz ?? 0.06));
        break;
      }
      case 'curly': {
        const s = Ta.s ?? 0.1;
        const m = put(tailG, 'curl', mat, s, s, s, 0, s * 0.4, -s * 0.5);
        m.rotation.y = Math.PI / 2;
        m.rotation.x = Ta.rot ?? 0.3;
        break;
      }
      default: break;
    }
  }

  // ---- extras ----
  const bodyPt = (az, el, push = 0) => { const r = surf(B.w, B.h, B.d, az, el, push); r.p.y += by; return r; };
  const EX = {
    comb(o) {
      const n = o.n ?? 3, s = hr * (o.s ?? 0.2), mat = tm(o.color || '#e8403a');
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const k = 1 - Math.abs(t - 0.5) * (o.taper ?? 0.7);
        const { p } = hs(0, (o.from ?? 0.95) + t * (o.span ?? 0.5), -s * 0.2);
        put(headG, 'sphL', mat, s * 0.62 * k, s * k, s * 0.7 * k, p.x, p.y + s * 0.2, p.z);
      }
    },
    wattle(o) {
      const s = hr * (o.s ?? 0.14);
      const { p } = hs(0, -0.65, -s * 0.2);
      put(headG, 'sphL', tm(o.color || '#e8403a'), s * 0.6, s * 1.15, s * 0.6, p.x, p.y - s * 0.3, p.z + s * 0.2);
    },
    horns(o) {
      const mat = tm(o.color || '#f4ead0');
      const s = hr * (o.s ?? 0.5), segs = o.segs ?? 2;
      for (const side of [-1, 1]) {
        const { p } = hs(side * (o.az ?? 0.65), o.el ?? 0.85, -s * 0.1);
        const g = new T.Group();
        g.position.copy(p);
        const d = o.dir || [0.45, 1, 0];
        along(g, V3(side * d[0], d[1], d[2]));
        headG.add(g);
        let parent = g;
        for (let i = 0; i < segs; i++) {
          const sg = new T.Group();
          if (i > 0) { sg.position.y = s / segs; sg.rotation[o.axis || 'z'] = o.sym ? -(o.bend ?? 0.4) : -side * (o.axis === 'x' ? -1 : 1) * (o.bend ?? 0.4); }
          parent.add(sg);
          const k = 1 - i / segs * 0.75;
          put(sg, 'cone', mat, s * 0.3 * k * (o.thick ?? 1), s / segs * 1.15, s * 0.3 * k * (o.thick ?? 1));
          parent = sg;
        }
      }
    },
    mane(o) {
      const n = o.n ?? 5, s = o.s ?? 0.1, mat = tm(o.color || '#6b4a2e');
      const band = i => (o.colors ? tm(o.colors[i % o.colors.length]) : mat);   // rainbow = colour bands
      const a = V3(0, hy + hry * 0.92, hz - hrz * 0.25), b = V3(0, by + B.h * 0.95, B.d * (o.endZ ?? -0.1));
      for (let i = 0; i < n; i++) {
        const p = a.clone().lerp(b, i / (n - 1));
        put(bodyG, o.lo ? 'sphP' : 'sphL', band(i), s * 0.7, s * 1.05, s * 0.8, 0, p.y, p.z);
      }
      if (o.fore !== false) { const { p } = hs(0, 1.15, -s * 0.2); put(headG, 'sphL', band(n), s * 0.7, s * 0.9, s * 0.75, 0, p.y + s * 0.2, p.z + s * 0.2); }
    },
    spots(o) {
      const mat = tm(o.color || '#3a3238');
      for (const sp of o.list) {
        const on = sp.on === 'head';
        const r = on ? hs(sp.az, sp.el, 0) : bodyPt(sp.az, sp.el, 0);
        const s = (on ? hr : B.h) * sp.s;
        const m = put(on ? headG : bodyG, 'sphP', mat, s * (sp.sx ?? 1), s * (sp.sy ?? 1), s * 0.3, r.p.x, r.p.y, r.p.z);
        face(m, r.n);
      }
    },
    wool(o) {
      const mat = tm(o.color || '#fff7ea'), n = o.n ?? 12, s = (o.s ?? 0.5) * Math.min(B.w, B.h);
      for (let i = 0; i < n; i++) {
        const y = 1 - (i + 0.5) / n * 1.15;         // from the top down to a little below the equator
        const el = Math.asin(Math.max(-1, Math.min(1, y)));
        const az = i * 2.39996;
        const { p } = bodyPt(az, el, s * 0.1);
        put(bodyG, 'sphP', mat, s, s, s, p.x, p.y, p.z);
      }
      for (const [x, y, z, k] of o.head || []) put(headG, 'sphP', mat, hr * k, hr * k, hr * k, x * hr, y * hr, z * hr);
    },
    whiskers(o) {
      const n = o.n ?? 3, len = hr * (o.len ?? 0.5), mat = bm(o.color || '#4a3f45');
      for (const side of [-1, 1]) {
        const { p } = hs(side * (o.az ?? 0.32), o.el ?? -0.2, -hr * 0.02);
        for (let i = 0; i < n; i++) {
          const ang = (i - (n - 1) / 2) * 0.28;
          const m = put(headG, 'thin', mat, hr * 0.014, len, hr * 0.014, p.x, p.y, p.z);
          along(m, V3(side * Math.cos(ang), Math.sin(ang) * 0.9 - 0.05, 0.25));
        }
      }
    },
    wings(o) {
      const s = o.s ?? 0.2, mat = tm(o.color || B.color);
      for (const side of [1, -1]) {
        const pivot = new T.Group();
        pivot.position.set(side * B.w * (o.x ?? 0.88), by + B.h * (o.y ?? 0.35), o.z ?? 0);
        pivot.rotation.z = side * (o.rest ?? 0.2);
        bodyG.add(pivot);
        put(pivot, 'sphL', mat, s * 0.2, s * 0.8, s * (o.d ?? 0.55), side * s * 0.1, -s * 0.55, -s * 0.1);
        bodyG.add(pivot);
        pivot.name = side > 0 ? 'wingL' : 'wingR';
        pivot.userData.anim = true;
      }
    },
    fan(o) {
      const n = o.n ?? 5, s = o.s ?? 0.4, cols = o.colors || ['#8a5a32'];
      const g = new T.Group();
      g.position.set(0, by + B.h * (o.y ?? 0.2), -B.d * (o.z ?? 0.8));
      g.rotation.x = -(o.lean ?? 0.5);
      bodyG.add(g);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) * 2 - 1;
        const pv = new T.Group();
        pv.rotation.z = t * (o.spread ?? 1.1);
        g.add(pv);
        put(pv, 'sphP', tm(cols[i % cols.length]), s * (o.wd ?? 0.16), s * (1 - Math.abs(t) * 0.12), s * 0.06, 0, s * 0.95, 0);
      }
    },
    beard(o) {
      const { p } = hs(0, -0.75, -hr * 0.05);
      const m = put(headG, 'cone', tm(o.color || '#f1ecdd'), hr * 0.11, hr * (o.len ?? 0.3), hr * 0.1, p.x, p.y + hr * 0.04, p.z);
      m.rotation.x = Math.PI;
    },
    cheeks(o) {
      const mat = tm(o.color || B.color), s = hr * (o.s ?? 0.4);
      for (const side of [-1, 1]) {
        const { p } = hs(side * 1.0, -0.3, -s * 0.7);
        put(headG, 'sphM', mat, s, s * 0.9, s, p.x, p.y, p.z);
      }
    },
    puffs(o) {
      const mat = tm(o.color || '#f4ead0');
      for (const [where, x, y, z, s] of o.list) {
        const par = where === 'head' ? headG : bodyG;
        put(par, 'sphL', mat, s, s, s, x, y, z);
      }
    },
    vest(o) {
      const mat = tm(o.color || '#f08a24');
      put(bodyG, 'hood', mat, B.w * 1.05, B.h * 1.04, B.d * (o.len ?? 0.78), 0, by, B.d * (o.dz ?? -0.05));
      if (o.patch !== false) {
        for (const side of [-1, 1]) {
          const { p, n } = bodyPt(side * Math.PI / 2, 0.3, 0.012);
          const m = put(bodyG, 'discS', bm('#fff7e0'), B.h * 0.28, B.h * 0.28, 1, p.x, p.y, p.z + B.d * 0.0);
          face(m, n);
        }
      }
    },
    udder(o) {
      put(bodyG, 'sphL', tm(o.color || '#ffb3c1'), B.w * 0.5, B.h * 0.36, B.d * 0.22, 0, by - B.h * 0.78, -B.d * 0.42);
    },
    collar(o) {
      const m = put(headG, 'ring', tm(o.color || '#d9453a'), hrx * 0.92, hrx * 0.92, hrx * 0.92, 0, -hry * 0.55, -hrz * 0.12);
      m.rotation.x = Math.PI / 2 + 0.25;
      put(headG, 'sphL', tm(o.bell || '#f5c542'), hr * 0.14, hr * 0.14, hr * 0.14, 0, -hry * 0.55 - hr * 0.1, hrz * 0.62);
    },
    bow(o) {
      const mat = tm(o.color || '#ff7aa8'), s = hr * (o.s ?? 0.22);
      const { p } = hs(o.az ?? 0.5, o.el ?? 1.1, 0);
      for (const side of [-1, 1]) {
        const c = put(headG, 'cone', mat, s * 0.75, s * 1.15, s * 0.3, p.x + side * s * 0.1, p.y, p.z);
        c.rotation.z = -side * (Math.PI / 2 - 0.1);
      }
      put(headG, 'sphL', mat, s * 0.38, s * 0.38, s * 0.38, p.x, p.y, p.z);
    },
    tuft(o) {
      const s = hr * (o.s ?? 0.3);
      const { p } = hs(0, 1.2, -s * 0.2);
      put(headG, 'sphL', tm(o.color || B.color), s * 0.6, s, s * 0.6, p.x, p.y + s * 0.3, p.z);
    },
    // ── legendary kit ──
    /** Spiral unicorn horn: stacked striped cones on the forehead. */
    horn(o) {
      const cols = o.colors || ['#fff1b8', '#ffd45a'];
      const n = o.n ?? 6, s = hr * (o.s ?? 1.1), w = hr * (o.w ?? 0.16);
      const { p, n: nn } = hs(0, o.el ?? 1.0, -hr * 0.05);
      const g = new T.Group();
      g.position.copy(p);
      along(g, nn.clone().lerp(AX_Y, 0.25).add(V3(0, 0, o.fwd ?? 0.55)).normalize());
      headG.add(g);
      let parent = g;
      for (let i = 0; i < n; i++) {
        const sg = new T.Group();
        if (i > 0) { sg.position.y = s / n * 0.92; sg.rotation.z = (i % 2 ? 1 : -1) * 0.05; }
        parent.add(sg);
        const k = 1 - i / n * 0.85;
        put(sg, 'cone', tm(cols[i % cols.length]), w * k, s / n * 1.25, w * k);
        parent = sg;
      }
    },
    /** Bat wings: arm bone + 3 membrane fingers; one pivot per wing (parts.wingL/wingR) rotates to flap. */
    batwings(o) {
      const s = o.s ?? 0.5, bone = tm(o.bone || o.color), memb = tm(o.color);
      for (const side of [1, -1]) {
        const pivot = new T.Group();
        pivot.position.set(side * B.w * (o.x ?? 0.7), by + B.h * (o.y ?? 0.62), B.d * (o.z ?? -0.05));
        pivot.rotation.z = side * (o.rest ?? 0.45);
        pivot.rotation.y = side * (o.sweep ?? 0.25);
        pivot.name = side > 0 ? 'wingL' : 'wingR';
        pivot.userData.anim = true;
        bodyG.add(pivot);
        const armDir = V3(side * 0.8, 0.5, -0.2).normalize();
        const arm = put(pivot, 'cyl', bone, s * 0.05, s * 0.55, s * 0.05);
        along(arm, armDir);
        const wrist = armDir.clone().multiplyScalar(s * 0.55);
        for (const [dx, dy, dz, len, wd] of [[0.95, 0.25, -0.25, 0.85, 0.3], [0.9, -0.15, -0.5, 0.8, 0.3], [0.6, -0.5, -0.65, 0.65, 0.26]]) {
          const f = put(pivot, 'cone', memb, s * 0.035, s * len, s * wd, wrist.x, wrist.y, wrist.z);
          along(f, V3(side * dx, dy, dz));
        }
      }
    },
    /** Trunk on a pivot (parts.trunk): rotate .x to swing. */
    trunk(o) {
      const n = o.n ?? 4, len = hr * (o.len ?? 1.5) / n, r0 = hr * (o.r ?? 0.24);
      const { p } = hs(0, o.el ?? -0.25, -hr * 0.05);
      const pivot = new T.Group();
      pivot.name = 'trunk';
      pivot.userData.anim = true;
      pivot.position.copy(p);
      pivot.rotation.x = Math.PI - (o.drop ?? 0.55);
      headG.add(pivot);
      let parent = pivot;
      const mat = tm(o.color || headColor);
      for (let i = 0; i < n; i++) {
        const g = new T.Group();
        if (i > 0) { g.position.y = len * 0.95; g.rotation.x = -(o.bend ?? 0.5); }
        parent.add(g);
        const r = r0 * (1 - i * 0.16);
        put(g, 'cylT', mat, r, len * 1.08, r);
        parent = g;
      }
      put(parent, 'sphL', mat, r0 * 0.6, r0 * 0.6, r0 * 0.6, 0, len * 0.98, 0);
    },
    /** Curved tusks (cream) from the muzzle sides. */
    tusks(o) {
      const s = hr * (o.s ?? 0.9), mat = tm(o.color || '#f7efd8'), segs = o.segs ?? 3;
      for (const side of [-1, 1]) {
        const { p } = hs(side * (o.az ?? 0.5), o.el ?? -0.3, -hr * 0.1);
        const g = new T.Group();
        g.position.copy(p);
        along(g, V3(side * (o.out ?? 0.55), o.up ?? 0.1, 1));
        headG.add(g);
        let parent = g;
        for (let i = 0; i < segs; i++) {
          const sg = new T.Group();
          if (i > 0) { sg.position.y = s / segs * 0.95; sg.rotation.x = -(o.bend ?? 0.5); }
          parent.add(sg);
          const k = 1 - i / segs * 0.7;
          put(sg, 'cone', mat, s * 0.17 * k, s / segs * 1.2, s * 0.17 * k);
          parent = sg;
        }
      }
    },
    /** Lion mane: rings of puffs behind the face on a pivot group (parts.mane). */
    lionMane(o) {
      const g = new T.Group();
      g.name = 'mane';
      g.userData.anim = true;
      g.position.set(0, hry * (o.dy ?? -0.02), -hrz * (o.dz ?? 0.28));
      headG.add(g);
      const cols = o.colors || ['#9a5a26', '#c27a34'];
      const rings = o.rings || [[10, 1.02, 0.5, 0], [8, 0.66, 0.46, -0.16]];
      rings.forEach(([n, rad, size, dz], ri) => {
        for (let i = 0; i < n; i++) {
          const a = (i + (ri % 2) * 0.5) / n * Math.PI * 2;
          put(g, 'sphP', tm(cols[ri % cols.length]), hr * size, hr * size, hr * size * 0.85, Math.cos(a) * hrx * rad, Math.sin(a) * hry * rad * 0.95, hrz * dz);
        }
      });
    },
    /** Spikes down the back / head crest. */
    spikes(o) {
      const n = o.n ?? 6, s = o.s ?? 0.1, cols = o.colors || [o.color || '#e8b04a'];
      for (let i = 0; i < n; i++) {
        const f = o.from + (o.to - o.from) * (n === 1 ? 0 : i / (n - 1));   // f in -1 (tail) .. 1 (head), as fraction of body length
        const z = f * B.d * 0.9, y = by + B.h * Math.sqrt(Math.max(0, 1 - (z / B.d) ** 2));
        const nn = V3(0, y - by, z / (B.d * B.d) * B.h * B.h).normalize();
        const k = 1 - Math.abs(f) * 0.25;
        const c = put(bodyG, 'cone', tm(cols[i % cols.length]), s * 0.55 * k, s * 1.4 * k, s * 0.4 * k, 0, y - s * 0.15, z);
        along(c, nn.add(V3(0, 0, -0.35)));
      }
    },
  };
  for (const ex of spec.extras || []) {
    const fn = EX[ex.t];
    if (fn) fn(ex);
  }

  // ---- finish: bounds, merge static parts, anchors ----
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(root);
  const size = box.getSize(V3());
  const S = spec.size ?? 1;

  // Bake colours into vertex colours and merge every static part into one mesh per animated group.
  const mat = critterMat(T, grad);
  const mergeInto = (group, meshes, material, name, offsetY = 0) => {
    if (!meshes.length) return null;
    const g = bakeGeometry(T, group, meshes);
    if (offsetY) g.translate(0, -offsetY, 0);
    for (const m of meshes) m.parent.remove(m);
    const mesh = new T.Mesh(g, material);
    mesh.name = name;
    mesh.userData.keep = true; // already merged: never fold it into another mesh
    if (offsetY) mesh.position.y = offsetY;
    group.add(mesh);
    return mesh;
  };
  const staticMeshes = group => {
    const out = [];
    (function walk(o) {
      for (const c of o.children) {
        if (c.isMesh) { if (!c.userData.keep) out.push(c); }
        else if (c.isGroup && !c.userData.anim) walk(c);
      }
    })(group);
    return out;
  };
  // eyes: one mesh whose origin sits on the eye line, so scale.y = blink squashes both eyes
  const eyeMeshes = eyeGroups.flatMap(g => g.children.filter(c => c.isMesh));
  const eyeY = eyeGroups.reduce((a, g) => a + g.position.y, 0) / eyeGroups.length;
  mergeInto(headG, eyeMeshes, eyeMat(T), 'eyes', eyeY);
  for (const g of eyeGroups) g.parent.remove(g);
  // ears, tail, wings keep their pivots; head and body get everything else
  const animGroups = [];
  root.traverse(o => { if (o.userData.anim && o !== headG && !eyeGroups.includes(o)) animGroups.push(o); });
  for (const g of animGroups) mergeInto(g, staticMeshes(g), mat, g.name + 'Mesh');
  mergeInto(headG, staticMeshes(headG), mat, 'headMesh');
  mergeInto(bodyG, staticMeshes(bodyG), mat, 'bodyMesh');
  (function prune(o) {
    for (const c of [...o.children]) {
      if (c.isGroup) { prune(c); if (!c.children.length && !c.userData.anim) o.remove(c); }
    }
  })(root);

  const breath = new T.Object3D();       // nostril / mouth point for flame + smoke puffs
  breath.name = 'breath';
  breath.position.set(0, hry * -0.2, hrz * (spec.snout && spec.snout.type === 'muzzle' ? 1.35 : 1.15));
  headG.add(breath);
  const anchor = new T.Object3D();
  anchor.name = 'anchor';
  anchor.position.set(0, hry * 1.02, 0);
  headG.add(anchor);
  if (S !== 1) {
    // Keep `body` free for B's squash: move the species scale onto an inner wrapper instead.
    const inner = new T.Group();
    inner.name = 'species-scale';
    inner.scale.setScalar(S);
    while (bodyG.children.length) inner.add(bodyG.children[0]);
    bodyG.add(inner);
  }
  return { root, baseHeight: size.y * S, baseRadius: Math.max(size.x, size.z) * 0.5 * S, crownY: (hy + hry * 1.02) * S + (spec.crownLift || 0), crownLift: spec.crownLift || 0 };
}

function mixHex(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Merges meshes (positioned inside `group`) into one BufferGeometry in group space with per-vertex colours. */
function bakeGeometry(T, group, meshes) {
  const inv = group.matrixWorld.clone().invert();
  let vc = 0, ic = 0;
  for (const m of meshes) { vc += m.geometry.attributes.position.count; ic += m.geometry.index.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  const mat4 = new T.Matrix4(), nm = new T.Matrix3(), v = new T.Vector3(), c = new T.Color();
  let vo = 0, io = 0;
  for (const m of meshes) {
    const g = m.geometry, gp = g.attributes.position, gn = g.attributes.normal;
    mat4.multiplyMatrices(inv, m.matrixWorld);
    nm.getNormalMatrix(mat4);
    c.set(m.userData.c);
    for (let i = 0; i < gp.count; i++) {
      v.fromBufferAttribute(gp, i).applyMatrix4(mat4);
      pos.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(gn, i).applyMatrix3(nm).normalize();
      nor.set([v.x, v.y, v.z], (vo + i) * 3);
      col.set([c.r, c.g, c.b], (vo + i) * 3);
    }
    for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    vo += gp.count;
    io += g.index.count;
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.setIndex(new T.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

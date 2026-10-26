// Procedural 3D model specs: the 21 farm-habitat species (CONTRACT_V4 §2), the legendaries (V5/V6) the forest friends (V8 §5) and the water friends (V9 §6) and the sky friends (V10 §4). Pure data, no imports.
// Interpreted by js/world3d/critters.js. Units are "metres-ish": an adult hamster is ~0.8 tall.
// Model faces +Z. Colours are CSS hex strings; they are hue-rotated for shiny pets.
// Fields (all optional except body):
//   body {w,h,d,y?,color,belly?:{color,s,dz,dy}}   legs {type:'stub'|'long'|'bird'|'webbed'|'none',h,r,x,z,color,hoof}
//   neck {r,top,color,z}   head {r,w,h,d,y,z,color}   eyes {s,gap,el,tall}   blush (hex | false)
//   ears {type:'round'|'long'|'cat'|'floppy'|'side',s,az,el,up,flare,color,inner}
//   snout {type:'muzzle'|'nose'|'pig'|'beak'|'flatbeak'|'pointy',color,...}   tail {type:'puff'|'long'|'fluffy'|'curly',...}
//   extras [{t:'comb'|'wattle'|'horns'|'mane'|'spots'|'wool'|'whiskers'|'wings'|'fan'|'beard'|'cheeks'|'puffs'|'vest'|'udder'|'collar'|'bow'|'tuft'}]

const SPOT_DARK = '#3a3238';
const MUZZLE_NOSE = '#3a2a2e';

export const MODEL_SPECS = {
  hamster: {
    body: { w: 0.4, h: 0.36, d: 0.4, color: '#eab56b', belly: { color: '#fff3df', s: 0.8, dz: 0.3 } },
    legs: { type: 'stub', h: 0.1, r: 0.075 },
    head: { r: 0.3, w: 1.2, h: 0.95, d: 1, y: 0.56, z: 0.2 },
    eyes: { s: 0.1, gap: 0.52, el: 0.12 },
    ears: { type: 'round', s: 0.36, az: 0.85, el: 0.6, up: 0.25, inner: '#ffb3c1' },
    snout: { type: 'nose', color: '#ff8fa3', s: 0.075, el: -0.12 },
    tail: { type: 'puff', s: 0.05, y: 0.1 },
    extras: [
      { t: 'cheeks', color: '#f6cf94', s: 0.34 },
      { t: 'whiskers', color: '#ffffff', len: 0.4, n: 2 },
      { t: 'spots', color: '#d08c42', list: [{ on: 'body', az: 3.1, el: 0.9, s: 0.55, sx: 1.2 }] },
    ],
  },

  chicken: {
    body: { w: 0.36, h: 0.34, d: 0.34, color: '#fffdf6', belly: { color: '#fff8e6', s: 0.8 } },
    legs: { type: 'bird', h: 0.17, r: 0.022, color: '#f0a030', x: 0.34 },
    head: { r: 0.24, h: 0.98, y: 0.78, z: 0.14 },
    eyes: { s: 0.12, gap: 0.62, el: 0.12 },
    snout: { type: 'beak', color: '#f5a623', w: 0.17, len: 0.3, el: -0.08 },
    extras: [
      { t: 'comb', color: '#e8403a', n: 3, s: 0.28 },
      { t: 'wattle', color: '#e8403a', s: 0.16 },
      { t: 'wings', color: '#f2e6cf', s: 0.22, x: 0.93, y: 0.34, d: 0.55, rest: 0.1 },
      { t: 'fan', colors: ['#f2e6cf', '#fffdf6'], n: 3, s: 0.2, spread: 0.55, lean: 0.35, y: 0.3, z: 0.85, wd: 0.22 },
    ],
  },

  rooster: {
    body: { w: 0.37, h: 0.36, d: 0.36, color: '#d9702b', belly: { color: '#f2b24f', s: 0.8 } },
    legs: { type: 'bird', h: 0.2, r: 0.025, color: '#f0b030', x: 0.36 },
    head: { r: 0.25, h: 0.98, y: 0.88, z: 0.13, color: '#d9702b' },
    eyes: { s: 0.12, gap: 0.62, el: 0.1 },
    blush: '#ff7a6a',
    snout: { type: 'beak', color: '#f5b52a', w: 0.17, len: 0.3, el: -0.08 },
    extras: [
      { t: 'comb', color: '#d92b2b', n: 5, s: 0.27, from: 0.8, span: 0.75, taper: 0.5 },
      { t: 'wattle', color: '#d92b2b', s: 0.2 },
      { t: 'wings', color: '#8a3d1e', s: 0.25, x: 0.93, y: 0.36, d: 0.5, rest: 0.1 },
      { t: 'fan', colors: ['#1f6b57', '#2f8f63', '#b8372b'], n: 5, s: 0.5, spread: 0.7, lean: 0.55, y: 0.35, z: 0.85, wd: 0.17 },
    ],
  },

  cow: {
    body: { w: 0.43, h: 0.37, d: 0.56, color: '#fffaf2' },
    legs: { type: 'stub', h: 0.14, r: 0.095 },
    head: { r: 0.33, w: 1.05, h: 0.95, d: 0.9, y: 0.7, z: 0.5 },
    eyes: { s: 0.12, gap: 0.55, el: 0.18 },
    ears: { type: 'side', s: 0.5, az: 1.25, el: 0.45, color: '#fffaf2', inner: '#ffb3c1' },
    snout: { type: 'muzzle', color: '#ffb7c2', w: 0.62, h: 0.42, d: 0.46, el: -0.32, nose: false, nostrils: true },
    tail: { type: 'long', len: 0.4, r: 0.03, lift: 0.1, curve: 0.1, tuft: SPOT_DARK, color: '#fffaf2', y: 0.5 },
    extras: [
      { t: 'horns', color: '#f1e3bd', s: 0.42, az: 0.55, el: 0.85, dir: [0.7, 1, 0], bend: 0.45 },
      { t: 'spots', color: SPOT_DARK, list: [
        { on: 'body', az: 1.2, el: 0.4, s: 0.6, sx: 1.2 },
        { on: 'body', az: 2.4, el: 0.7, s: 0.5 },
        { on: 'body', az: -0.4, el: 0.95, s: 0.55, sx: 1.1 },
        { on: 'body', az: -1.4, el: 0.2, s: 0.5 },
        { on: 'head', az: -0.8, el: 0.2, s: 0.4 },
      ] },
    ],
  },

  dairycow: {
    body: { w: 0.44, h: 0.38, d: 0.58, color: '#fff1de' },
    legs: { type: 'stub', h: 0.14, r: 0.095 },
    head: { r: 0.33, w: 1.05, h: 0.95, d: 0.9, y: 0.7, z: 0.52 },
    eyes: { s: 0.12, gap: 0.55, el: 0.18 },
    ears: { type: 'side', s: 0.5, az: 1.25, el: 0.45, color: '#b86f3c', inner: false },
    snout: { type: 'muzzle', color: '#ffb7c2', w: 0.62, h: 0.42, d: 0.46, el: -0.32, nose: false, nostrils: true },
    tail: { type: 'long', n: 2, len: 0.4, r: 0.03, lift: 0.1, curve: 0.1, tuft: '#b86f3c', color: '#fff1de', y: 0.5 },
    extras: [
      { t: 'horns', color: '#f1e3bd', s: 0.3, az: 0.55, el: 0.85, dir: [0.8, 1, 0], segs: 1 },
      { t: 'spots', color: '#b86f3c', list: [
        { on: 'body', az: 1.3, el: 0.4, s: 0.7, sx: 1.3 },
        { on: 'body', az: -0.3, el: 1.0, s: 0.6, sx: 1.2 },
        { on: 'head', az: 0.7, el: 0.5, s: 0.5 },
      ] },
      { t: 'collar', color: '#d9453a', bell: '#f5c542' },
    ],
  },

  pig: {
    body: { w: 0.44, h: 0.36, d: 0.46, color: '#ffb6c4', belly: { color: '#ffc9d3', s: 0.8 } },
    legs: { type: 'stub', h: 0.11, r: 0.095, color: '#ff9fb2' },
    head: { r: 0.34, w: 1.1, h: 0.95, d: 0.95, y: 0.62, z: 0.32 },
    eyes: { s: 0.115, gap: 0.62, el: 0.2 },
    blush: '#ff7a96',
    ears: { type: 'cat', s: 0.42, az: 0.8, el: 0.7, up: 0.2, flare: 0.7, color: '#ff9fb2', inner: '#ff8aa3' },
    snout: { type: 'pig', color: '#ff93a9', w: 0.36, h: 0.27, d: 0.26, el: -0.22 },
    tail: { type: 'curly', s: 0.11, color: '#ff93a9', y: 0.3, rot: 0.4 },
  },

  sheep: {
    body: { w: 0.4, h: 0.34, d: 0.42, color: '#fff6e6' },
    legs: { type: 'stub', h: 0.14, r: 0.055, color: '#5b4a50' },
    head: { r: 0.25, w: 1, h: 1, d: 1, y: 0.62, z: 0.3, color: '#ead6b4' },
    eyes: { s: 0.14, gap: 0.55, el: 0.1 },
    ears: { type: 'side', s: 0.62, az: 1.2, el: 0.35, color: '#5b4a50', inner: false, flare: 0.3 },
    snout: { type: 'nose', color: '#d98a98', s: 0.075, el: -0.25 },
    tail: { type: 'puff', s: 0.1, color: '#fff6e6', y: 0.2 },
    extras: [
      { t: 'wool', color: '#fff6e6', n: 12, s: 0.6, head: [[0, 0.95, 0.1, 0.4], [0.35, 0.88, 0.05, 0.3]] },
    ],
  },

  goat: {
    body: { w: 0.37, h: 0.31, d: 0.44, color: '#f6f0e2' },
    legs: { type: 'long', h: 0.19, r: 0.055, color: '#eadfc6', hoof: '#4a3f45' },
    head: { r: 0.3, w: 0.92, h: 1.0, d: 1.1, y: 0.64, z: 0.38 },
    eyes: { s: 0.12, gap: 0.55, el: 0.14 },
    ears: { type: 'side', s: 0.52, az: 1.3, el: 0.4, color: '#d8c7a6', inner: '#ffb3c1', flare: 0.35 },
    snout: { type: 'muzzle', color: '#f6f0e2', w: 0.36, h: 0.27, d: 0.3, el: -0.3, nose: '#e98a9a', noseS: 0.11, noseY: 0.55 },
    tail: { type: 'fluffy', w: 0.05, h: 0.1, d: 0.04, dy: 0.1, dz: 0.02, rot: 0.3, color: '#f6f0e2', y: 0.4 },
    extras: [
      { t: 'horns', color: '#d8cdb0', s: 0.65, az: 0.5, el: 0.85, dir: [0.35, 1, -0.55], segs: 3, bend: 0.4, thick: 1.0 },
      { t: 'beard', color: '#f6f0e2', len: 0.36 },
    ],
  },

  duck: {
    body: { w: 0.34, h: 0.3, d: 0.4, color: '#ffdc4a', belly: { color: '#fff0a6', s: 0.8 } },
    legs: { type: 'webbed', h: 0.08, r: 0.03, color: '#ff9a2e', x: 0.38 },
    head: { r: 0.27, y: 0.62, z: 0.2 },
    eyes: { s: 0.12, gap: 0.55, el: 0.18 },
    snout: { type: 'flatbeak', color: '#ff9a2e', w: 0.5, h: 0.14, d: 0.5, el: -0.22 },
    tail: { type: 'fluffy', w: 0.07, h: 0.06, d: 0.1, dy: 0.1, dz: 0.04, rot: 0.6, color: '#ffdc4a', y: 0.35 },
    extras: [{ t: 'wings', color: '#f5c42a', s: 0.24, x: 0.9, y: 0.35, d: 0.6 }, { t: 'tuft', color: '#ffdc4a', s: 0.2 }],
  },

  cat: {
    body: { w: 0.33, h: 0.3, d: 0.4, color: '#f5a850', belly: { color: '#fff0dc', s: 0.8 } },
    legs: { type: 'stub', h: 0.1, r: 0.07, color: '#f5a850' },
    head: { r: 0.3, w: 1.13, h: 0.95, d: 0.95, y: 0.6, z: 0.22 },
    eyes: { s: 0.125, gap: 0.55, el: 0.12 },
    ears: { type: 'cat', s: 0.55, az: 0.7, el: 0.72, up: 0.55, inner: '#ffb3c1' },
    snout: { type: 'muzzle', color: '#fff0dc', w: 0.3, h: 0.22, d: 0.22, el: -0.3, nose: '#ff8fa3', noseS: 0.1, noseY: 0.6 },
    tail: { type: 'long', len: 0.52, r: 0.045, lift: 0.5, curve: 0.5, n: 4, color: '#f5a850', y: 0.2 },
    extras: [
      { t: 'whiskers', color: '#ffffff', len: 0.5, az: 0.36, el: -0.25 },
      { t: 'spots', color: '#dd7f2c', list: [
        { on: 'body', az: 0, el: 1.1, s: 0.45, sx: 1.7, sy: 0.4 },
        { on: 'body', az: 0.3, el: 0.65, s: 0.45, sx: 1.7, sy: 0.4 },
        { on: 'body', az: -0.5, el: 0.9, s: 0.4, sx: 1.7, sy: 0.4 },
        { on: 'head', az: 0, el: 1.0, s: 0.3, sx: 0.5, sy: 1.5 },
      ] },
    ],
  },

  dog: {
    body: { w: 0.36, h: 0.3, d: 0.44, color: '#d9a05f', belly: { color: '#f8e6c6', s: 0.8 } },
    legs: { type: 'stub', h: 0.12, r: 0.075, color: '#d9a05f' },
    head: { r: 0.31, w: 1.06, h: 0.98, d: 1, y: 0.62, z: 0.3 },
    eyes: { s: 0.115, gap: 0.55, el: 0.17 },
    ears: { type: 'floppy', s: 0.58, az: 1.0, el: 0.7, color: '#8f5b2e', flare: 0.32, inner: false },
    snout: { type: 'muzzle', color: '#f8e6c6', w: 0.52, h: 0.38, d: 0.46, el: -0.3, nose: MUZZLE_NOSE, noseS: 0.15, noseY: 0.62 },
    tail: { type: 'long', len: 0.34, r: 0.075, lift: 0.95, curve: 0.25, n: 3, color: '#d9a05f', y: 0.35 },
    extras: [{ t: 'spots', color: '#8f5b2e', list: [{ on: 'body', az: 0.5, el: 0.95, s: 0.9, sx: 1.2 }, { on: 'head', az: 0.9, el: 0.2, s: 0.4 }] }],
  },

  servicedog: {
    body: { w: 0.36, h: 0.31, d: 0.46, color: '#c98a4a', belly: { color: '#e8c590', s: 0.8 } },
    legs: { type: 'stub', h: 0.14, r: 0.07, color: '#c98a4a' },
    head: { r: 0.3, w: 1.0, h: 1.0, d: 1.05, y: 0.67, z: 0.32 },
    eyes: { s: 0.115, gap: 0.52, el: 0.17 },
    ears: { type: 'cat', s: 0.75, az: 0.65, el: 0.7, up: 0.65, color: '#3d3336', inner: '#c98a4a' },
    snout: { type: 'muzzle', color: '#3d3336', w: 0.42, h: 0.32, d: 0.5, el: -0.3, nose: '#111', noseS: 0.14, noseY: 0.62 },
    tail: { type: 'long', len: 0.4, r: 0.06, lift: 0.4, curve: 0.25, n: 3, color: '#3d3336', y: 0.3 },
    extras: [{ t: 'vest', color: '#f08a24', len: 0.72, dz: -0.1 }],
  },

  poodle: {
    body: { w: 0.34, h: 0.3, d: 0.38, color: '#f4cda4' },
    legs: { type: 'stub', h: 0.14, r: 0.045, color: '#f4cda4' },
    head: { r: 0.26, w: 1, h: 1, d: 1, y: 0.65, z: 0.24 },
    eyes: { s: 0.13, gap: 0.5, el: 0.1 },
    ears: { type: 'floppy', s: 0.8, az: 1.0, el: 0.45, color: '#f4cda4', flare: 0.15, inner: false },
    snout: { type: 'muzzle', color: '#f8dcb8', w: 0.4, h: 0.3, d: 0.4, el: -0.3, nose: MUZZLE_NOSE, noseS: 0.12, noseY: 0.62 },
    tail: { type: 'puff', s: 0.1, color: '#f4cda4', y: 0.25 },
    extras: [
      { t: 'wool', color: '#f4cda4', n: 5, s: 0.55, head: [[0, 1.0, -0.05, 0.58], [0.5, 0.85, -0.05, 0.38], [-0.5, 0.85, -0.05, 0.38]] },
      { t: 'bow', color: '#ff7aa8', az: 0.55, el: 1.0, s: 0.2 },
    ],
  },

  mouse: {
    body: { w: 0.3, h: 0.28, d: 0.34, color: '#bcc0cb', belly: { color: '#f6f1f3', s: 0.8 } },
    legs: { type: 'stub', h: 0.08, r: 0.05 },
    head: { r: 0.26, w: 1, h: 0.95, d: 1.1, y: 0.5, z: 0.19 },
    eyes: { s: 0.11, gap: 0.5, el: 0.15 },
    ears: { type: 'round', s: 0.95, az: 0.85, el: 0.55, up: 0.15, inner: '#ffb3c1' },
    snout: { type: 'pointy', color: '#bcc0cb', w: 0.26, h: 0.22, d: 0.45, el: -0.12, nose: '#ff8fa3' },
    tail: { type: 'long', len: 0.55, r: 0.022, lift: 0.4, curve: 0.45, n: 4, color: '#f4a6b4', y: 0.1 },
    extras: [{ t: 'whiskers', color: '#ffffff', len: 0.55, n: 3, az: 0.3, el: -0.15 }],
  },

  rat: {
    body: { w: 0.32, h: 0.28, d: 0.46, color: '#8f7a6c', belly: { color: '#dcc9b6', s: 0.8 } },
    legs: { type: 'stub', h: 0.09, r: 0.055 },
    head: { r: 0.25, w: 0.95, h: 0.92, d: 1.15, y: 0.5, z: 0.3 },
    eyes: { s: 0.11, gap: 0.5, el: 0.15 },
    ears: { type: 'round', s: 0.55, az: 0.9, el: 0.55, up: 0.2, color: '#9a8576', inner: '#e8a4a8' },
    snout: { type: 'pointy', color: '#8f7a6c', w: 0.28, h: 0.24, d: 0.55, el: -0.12, nose: '#e88a96' },
    tail: { type: 'long', len: 0.6, r: 0.028, lift: 0.25, curve: 0.35, n: 4, color: '#d9a8a0', y: 0.1 },
    extras: [
      { t: 'whiskers', color: '#e8ddd0', len: 0.55, n: 3, az: 0.3, el: -0.15 },
      { t: 'spots', color: '#6e5a50', list: [{ on: 'body', az: 0.2, el: 1.0, s: 0.9, sx: 1.2, sy: 1.6 }] },
    ],
  },

  rabbit: {
    body: { w: 0.33, h: 0.31, d: 0.38, color: '#fffafb', belly: { color: '#fff0f3', s: 0.8 } },
    legs: { type: 'stub', h: 0.1, r: 0.07 },
    head: { r: 0.29, w: 1.06, h: 0.96, d: 0.95, y: 0.62, z: 0.2 },
    eyes: { s: 0.12, gap: 0.52, el: 0.12 },
    ears: { type: 'long', s: 1.1, az: 0.45, el: 0.95, up: 0.5, flare: 0.12, inner: '#ffb3c1' },
    snout: { type: 'nose', color: '#ff8fa3', s: 0.08, el: -0.1 },
    tail: { type: 'puff', s: 0.1, y: 0.2 },
    extras: [{ t: 'whiskers', color: '#d8cfd3', len: 0.5, n: 2, az: 0.28, el: -0.18 }],
  },

  horse: {
    body: { w: 0.36, h: 0.36, d: 0.58, color: '#b0703e', y: 0.46 },
    legs: { type: 'long', h: 0.26, r: 0.06, color: '#a2663a', hoof: '#3d2f2f', x: 0.6, z: 0.64 },
    neck: { r: 0.15, top: 0.85, z: 0.5 },
    head: { r: 0.25, w: 0.88, h: 1.0, d: 1.2, y: 0.98, z: 0.6 },
    eyes: { s: 0.13, gap: 0.62, el: 0.12 },
    ears: { type: 'cat', s: 0.5, az: 0.5, el: 0.8, up: 0.65, inner: '#ffb3c1' },
    snout: { type: 'muzzle', color: '#946034', w: 0.58, h: 0.5, d: 0.45, el: -0.4, nose: false, nostrils: true },
    tail: { type: 'fluffy', w: 0.08, h: 0.27, d: 0.09, dy: -0.2, dz: 0.03, rot: 0.15, color: '#3f2c24', y: 0.6 },
    extras: [{ t: 'mane', color: '#3f2c24', n: 5, s: 0.12, endZ: 0.0 }],
  },

  racehorse: {
    body: { w: 0.34, h: 0.34, d: 0.6, color: '#e6a93f', y: 0.5 },
    legs: { type: 'long', h: 0.3, r: 0.055, color: '#d99a30', hoof: '#fff4d6', x: 0.6, z: 0.66 },
    neck: { r: 0.14, top: 0.85, z: 0.5 },
    head: { r: 0.24, w: 0.88, h: 1.0, d: 1.25, y: 1.04, z: 0.64 },
    eyes: { s: 0.13, gap: 0.62, el: 0.12 },
    blush: false,
    ears: { type: 'cat', s: 0.5, az: 0.5, el: 0.8, up: 0.65, inner: false },
    snout: { type: 'muzzle', color: '#d99a30', w: 0.56, h: 0.48, d: 0.45, lo: true, el: -0.4, nose: false, nostrils: true },
    tail: { type: 'fluffy', w: 0.07, h: 0.3, d: 0.08, dy: -0.22, dz: 0.03, rot: 0.2, color: '#fff3c4', y: 0.55 },
    extras: [
      { t: 'mane', color: '#fff3c4', n: 4, s: 0.12, endZ: 0.0 },
      { t: 'spots', color: '#ffffff', list: [{ on: 'head', az: 0, el: 0.45, s: 0.22, sx: 0.5, sy: 2.2 }] },
      { t: 'vest', color: '#d9453a', len: 0.45, dz: 0.0, patch: false },
    ],
  },

  buffalo: {
    body: { w: 0.46, h: 0.4, d: 0.6, color: '#6f7683' },
    legs: { type: 'stub', h: 0.15, r: 0.105, color: '#5a606c' },
    head: { r: 0.34, w: 1.1, h: 0.9, d: 0.95, y: 0.62, z: 0.52 },
    eyes: { s: 0.115, gap: 0.62, el: 0.15 },
    ears: { type: 'floppy', s: 0.55, az: 1.25, el: 0.4, color: '#5a606c', flare: 0.6, inner: false },
    snout: { type: 'muzzle', color: '#c9b9b3', w: 0.62, h: 0.42, d: 0.48, el: -0.32, nose: false, nostrils: true },
    tail: { type: 'long', len: 0.4, r: 0.035, lift: 0.0, curve: 0.1, color: '#6f7683', tuft: '#3d4150', y: 0.5 },
    extras: [
      { t: 'horns', color: '#efe6d0', s: 1.25, az: 0.95, el: 0.5, dir: [1, 0.2, -0.45], segs: 3, bend: 0.5, thick: 1.1, axis: 'x' },
    ],
  },

  llama: {
    body: { w: 0.35, h: 0.34, d: 0.42, color: '#f3e7d1', y: 0.5 },
    legs: { type: 'long', h: 0.26, r: 0.05, color: '#ead9bb', hoof: '#6b5a4c', x: 0.6, z: 0.58 },
    neck: { r: 0.12, top: 0.85, z: 0.5, color: '#f7eedd' },
    head: { r: 0.2, w: 0.88, h: 1.0, d: 1.1, y: 1.05, z: 0.5, color: '#f7eedd' },
    eyes: { s: 0.14, gap: 0.55, el: 0.14 },
    ears: { type: 'cat', s: 0.62, az: 0.5, el: 0.95, up: 0.75, flare: 0.25, color: '#f3e7d1', inner: '#ffb3c1' },
    snout: { type: 'muzzle', color: '#f7eedd', w: 0.5, h: 0.36, d: 0.34, el: -0.28, nose: '#e98a9a', noseS: 0.11, noseY: 0.6 },
    tail: { type: 'puff', s: 0.1, y: 0.35 },
    extras: [
      { t: 'wool', color: '#f3e7d1', n: 5, s: 0.55, head: [[0, 0.98, 0.0, 0.5], [0.3, 0.9, 0.1, 0.3]] },
    ],
  },

  turkey: {
    body: { w: 0.38, h: 0.36, d: 0.38, color: '#8f5c33', belly: { color: '#c99660', s: 0.8 } },
    legs: { type: 'bird', h: 0.2, r: 0.028, color: '#e07a50', x: 0.36 },
    neck: { r: 0.06, top: 0.9, z: 0.5, color: '#e88a78' },
    head: { r: 0.17, y: 0.95, z: 0.26, color: '#e88a78' },
    eyes: { s: 0.15, gap: 0.62, el: 0.1 },
    blush: false,
    snout: { type: 'beak', color: '#f2b84a', w: 0.2, len: 0.34, el: -0.12 },
    extras: [
      { t: 'wattle', color: '#d92b2b', s: 0.3 },
      { t: 'wings', color: '#6a3f22', s: 0.3, x: 0.9, y: 0.4, d: 0.6 },
      { t: 'fan', colors: ['#6a3f22', '#c99660', '#a8683a', '#c99660'], n: 7, s: 0.55, spread: 0.75, lean: 0.3, y: 0.3, z: 0.7, wd: 0.17 },
    ],
  },

  // ───────── legendary / epic showcase (V5) ─────────
  // shinyPalette: curated { '#from': '#to' }; colours not listed stay unchanged when shiny.

  dragon: {
    body: { w: 0.4, h: 0.37, d: 0.54, color: '#4fbf6a', belly: { color: '#ffe08a', s: 0.82, dz: 0.24 } },
    legs: { type: 'stub', h: 0.12, r: 0.085, color: '#3fa85a' },
    head: { r: 0.3, w: 0.96, h: 0.92, d: 1.2, y: 0.88, z: 0.4 },
    eyes: { s: 0.15, gap: 0.55, el: 0.16 },
    snout: { type: 'pointy', color: '#74d68a', w: 0.32, h: 0.27, d: 1.05, el: -0.2, nose: '#2f7a46' },
    tail: { type: 'long', n: 5, len: 0.95, r: 0.085, lift: 0.1, curve: 0.08, taper: 0.12, flame: true, color: '#4fbf6a', y: 0.12 },
    crownLift: 0.08,
    extras: [
      { t: 'horns', color: '#fff1c4', s: 1.05, az: 0.42, el: 0.85, dir: [0.25, 1, -0.85], segs: 3, bend: 0.3, thick: 0.95 },
      { t: 'batwings', color: '#ffd98a', bone: '#3fa85a', s: 1.1, x: 0.65, y: 0.7, rest: 0.2, sweep: 0.35 },
      { t: 'spikes', color: '#ffe08a', n: 6, s: 0.13, from: 0.75, to: -0.85 },
    ],
    shinyPalette: {
      '#4fbf6a': '#3a7bff', '#3fa85a': '#2a5fd6', '#ffe08a': '#d8f0ff', '#74d68a': '#7ab4ff', '#ffd98a': '#b8a0ff',
      '#fff1c4': '#e8fbff', '#2f7a46': '#1e3fa0', '#ff7a1a': '#46c8ff', '#ffd84a': '#d8fbff',
    },
  },

  dragonhead: {
    body: { w: 0.34, h: 0.3, d: 0.4, color: '#5fd0a8', belly: { color: '#fff3c0', s: 0.8, dz: 0.24 } },
    legs: { type: 'stub', h: 0.1, r: 0.075, color: '#4fbf98' },
    head: { r: 0.36, w: 1.1, h: 0.96, d: 0.98, y: 0.7, z: 0.2 },
    eyes: { s: 0.17, gap: 0.55, el: 0.12 },
    ears: { type: 'cat', s: 0.45, az: 0.95, el: 0.5, up: 0.1, flare: 0.5, color: '#4fbf98', inner: '#ffd0e0', static: true },
    snout: { type: 'pointy', color: '#9be8c8', w: 0.3, h: 0.25, d: 0.5, el: -0.2, nose: '#e878a8' },
    tail: { type: 'long', n: 3, len: 0.42, r: 0.07, lift: 0.2, curve: 0.2, taper: 0.12, flame: true, color: '#5fd0a8', y: 0.1 },
    extras: [
      { t: 'horns', color: '#fff3c0', s: 0.42, az: 0.4, el: 0.9, dir: [0.2, 1, -0.5], segs: 2, bend: 0.3 },
      { t: 'batwings', color: '#ffb3d0', bone: '#4fbf98', s: 0.42, x: 0.65 },
      { t: 'spikes', color: '#ffd45a', n: 4, s: 0.08, from: 0.4, to: -0.8 },
    ],
    shinyPalette: {
      '#5fd0a8': '#ff9ad5', '#4fbf98': '#e878c0', '#fff3c0': '#fff0fa', '#9be8c8': '#ffc8ea', '#ffb3d0': '#9ad0ff',
      '#ffd45a': '#fff6a8', '#ffd0e0': '#d0e8ff', '#ff7a1a': '#c05cff', '#ffd84a': '#ffd0ff',
    },
  },

  mammoth: {
    body: { w: 0.5, h: 0.46, d: 0.6, color: '#9aa9c4' },
    legs: { type: 'stub', h: 0.14, r: 0.115, color: '#7e8eab' },
    head: { r: 0.36, w: 1.05, h: 0.95, d: 0.9, y: 0.82, z: 0.42 },
    eyes: { s: 0.12, gap: 0.6, el: 0.2 },
    ears: { type: 'round', s: 0.6, az: 1.1, el: 0.45, up: 0.1, color: '#8294b4', inner: '#d0dcf2', static: true },
    tail: { type: 'puff', s: 0.1, color: '#7e8eab', y: 0.2 },
    extras: [
      { t: 'wool', color: '#9aa9c4', n: 9, s: 0.55, head: [[0, 0.95, 0.15, 0.55], [0.4, 0.88, 0.1, 0.4], [-0.4, 0.88, 0.1, 0.4]] },
      { t: 'trunk', color: '#8294b4', len: 1.9, r: 0.24, el: -0.2, n: 4, bend: 0.5 },
      { t: 'tusks', color: '#f7efd8', s: 1.4, az: 0.55, el: -0.35, segs: 3, bend: 0.55 },
    ],
    shinyPalette: {
      '#9aa9c4': '#a8e6d4', '#7e8eab': '#6cc7b5', '#8294b4': '#7ed3c0', '#d0dcf2': '#e4fff6', '#f7efd8': '#ffe08a',
    },
  },

  lion: {
    body: { w: 0.38, h: 0.33, d: 0.5, color: '#e8a652', belly: { color: '#ffe3b0', s: 0.8, dz: 0.22 } },
    legs: { type: 'stub', h: 0.12, r: 0.09, color: '#e8a652' },
    head: { r: 0.29, w: 1.05, h: 0.96, d: 0.95, y: 0.7, z: 0.36 },
    eyes: { s: 0.13, gap: 0.5, el: 0.15 },
    ears: { type: 'round', s: 0.5, az: 0.75, el: 0.7, up: 0.3, color: '#e8a652', inner: '#ffb3c1', static: true },
    snout: { type: 'muzzle', color: '#ffe3b0', w: 0.46, h: 0.34, d: 0.38, el: -0.3, nose: '#d9788a', noseS: 0.13, noseY: 0.6, lo: true },
    tail: { type: 'long', n: 3, len: 0.5, r: 0.045, lift: 0.4, curve: 0.35, color: '#e8a652', tuft: '#a85d24', y: 0.2 },
    extras: [
      { t: 'lionMane', colors: ['#a85d24', '#c9772c'], rings: [[9, 1.08, 0.56, 0], [6, 0.7, 0.5, -0.18]] },
      { t: 'whiskers', color: '#ffffff', len: 0.45, n: 1, az: 0.3, el: -0.2 },
    ],
    shinyPalette: {
      '#e8a652': '#ffd34a', '#ffe3b0': '#fff3b8', '#a85d24': '#ff9d1a', '#c9772c': '#ffb82e', '#d9788a': '#ff9aa8',
    },
  },

  panda: {
    body: { w: 0.42, h: 0.38, d: 0.42, color: '#ffffff' },
    legs: { type: 'stub', h: 0.13, r: 0.1, color: '#2f2a30' },
    head: { r: 0.34, w: 1.08, h: 0.96, d: 0.95, y: 0.72, z: 0.18, color: '#ffffff' },
    eyes: { s: 0.1, gap: 0.5, el: 0.12 },
    ears: { type: 'round', s: 0.6, az: 0.85, el: 0.6, up: 0.25, color: '#2f2a30', inner: false, static: true },
    snout: { type: 'nose', color: '#2f2a30', s: 0.1, el: -0.12 },
    tail: { type: 'puff', s: 0.08, color: '#ffffff', y: 0.1 },
    extras: [
      { t: 'spots', color: '#2f2a30', list: [
        { on: 'head', az: 0.5, el: 0.1, s: 0.55, sx: 0.8, sy: 1.1 },
        { on: 'head', az: -0.5, el: 0.1, s: 0.55, sx: 0.8, sy: 1.1 },
        { on: 'body', az: 1.5, el: 0.1, s: 0.5, sx: 0.9, sy: 1.3 },
        { on: 'body', az: -1.5, el: 0.1, s: 0.5, sx: 0.9, sy: 1.3 },
      ] },
    ],
    shinyPalette: { '#2f2a30': '#d9a437', '#ffffff': '#fff6df' },
  },

  unicorn: {
    body: { w: 0.34, h: 0.34, d: 0.56, color: '#fff7fb', y: 0.58 },
    legs: { type: 'long', h: 0.36, r: 0.042, color: '#f3e8f8', hoof: '#e9b830', x: 0.6, z: 0.66 },
    neck: { r: 0.13, top: 0.8, z: 0.52 },
    head: { r: 0.24, w: 0.88, h: 1.0, d: 1.3, y: 1.2, z: 0.74 },
    eyes: { s: 0.15, gap: 0.62, el: 0.14 },
    ears: { type: 'cat', s: 0.62, az: 0.5, el: 0.85, up: 0.8, inner: '#ffc0d8', static: true },
    snout: { type: 'muzzle', color: '#ffe3ee', w: 0.56, h: 0.46, d: 0.52, el: -0.42, nose: false, nostrils: true, lo: true },
    tail: { type: 'long', n: 5, len: 0.85, r: 0.07, blob: 1.8, lift: -0.2, curve: 0.18, tip: 2, taper: 0.06, y: 0.45, color: '#fff7fb',
            colors: ['#ff7aa8', '#ffb35c', '#ffe66d', '#7be0a0', '#6ab7ff', '#b58cff'] },
    crownLift: 0.1,
    extras: [
      { t: 'horn', colors: ['#fff1b8', '#ffc83a'], n: 5, s: 2.0, w: 0.15, el: 1.0, fwd: 0.4 },
      { t: 'mane', colors: ['#ff7aa8', '#ffb35c', '#ffe66d', '#7be0a0', '#6ab7ff', '#b58cff'], n: 7, s: 0.13, endZ: 0.0, lo: true },
    ],
    shinyPalette: {
      '#fff7fb': '#cdbcff', '#f3e8f8': '#b9a8f0', '#e9b830': '#8ad8ff', '#ffe3ee': '#ead9ff', '#ffc0d8': '#a890ff',
      '#fff1b8': '#e8f7ff', '#ffc83a': '#8fd0ff',
      '#ff7aa8': '#7a5cff', '#ffb35c': '#c15cff', '#ffe66d': '#ff7ad9', '#7be0a0': '#4cc9f0', '#6ab7ff': '#3f6bff', '#b58cff': '#8a5cff',
    },
  },

  // ───────── V6: the four remaining legendaries ─────────

  humpback: {
    body: { w: 0.5, h: 0.46, d: 0.82, color: '#3f5f86', belly: { color: '#e8f1f8', s: 0.8, dz: 0.14, dy: -0.1 } },
    legs: { type: 'none' },
    head: { r: 0.4, w: 1.0, h: 0.9, d: 1.15, y: 0.5, z: 0.42 },
    eyes: { s: 0.1, gap: 0.9, el: -0.02 },
    snout: { type: 'flatbeak', color: '#e8f1f8', w: 0.78, h: 0.2, d: 0.62, el: -0.32 },
    tail: { type: 'fluke', name: 'fluke', s: 0.52, len: 0.5, rot: 0.25, color: '#3f5f86', lobe: '#2f4a70', y: 0.05, z: 0.92 },
    extras: [
      { t: 'flippers', color: '#e8f1f8', s: 0.5 },
      { t: 'spikes', color: '#2f4a70', n: 1, s: 0.2, from: -0.35, to: -0.35 },
      { t: 'spout', el: 1.12 },
    ],
    shinyPalette: { '#3f5f86': '#2fd0c8', '#e8f1f8': '#fff3d6', '#2f4a70': '#1f9e9a' },
  },

  eagle: {
    body: { w: 0.36, h: 0.4, d: 0.34, color: '#7a5230', belly: { color: '#c9a27a', s: 0.8, dz: 0.26 } },
    legs: { type: 'bird', h: 0.16, r: 0.036, color: '#f2c14a', x: 0.34 },
    head: { r: 0.27, h: 0.98, z: 0.1, color: '#fff8ea' },
    eyes: { s: 0.13, gap: 0.62, el: 0.12 },
    blush: '#ffb08a',
    snout: { type: 'beak', color: '#f2b84a', w: 0.22, len: 0.42, el: -0.1 },
    extras: [
      { t: 'batwings', color: '#7a5230', colors: ['#5a3b20', '#7a5230', '#5a3b20', '#7a5230', '#f5e6c8'], bone: '#5a3b20', s: 1.0, x: 0.85, y: 0.6, z: 0.0, rest: 0.3, sweep: 0.2, arm: 0.35, armDir: [1, 0.25, -0.1], thin: 0.03,
        fingers: [[1, 0.2, 0.15, 0.95, 0.36], [1, 0.1, -0.1, 1.0, 0.36], [0.95, 0.0, -0.35, 0.95, 0.36], [0.85, -0.1, -0.6, 0.82, 0.36], [0.7, -0.15, -0.85, 0.65, 0.34]] },
      { t: 'fan', colors: ['#fff8ea', '#ffffff'], n: 5, s: 0.38, spread: 0.55, lean: 0.55, y: 0.25, z: 0.85, wd: 0.2 },
    ],
    shinyPalette: {
      '#7a5230': '#3a5fd9', '#5a3b20': '#2a3fa0', '#c9a27a': '#8fb8ff', '#fff8ea': '#fff6d0', '#f5e6c8': '#ffe08a',
      '#f2c14a': '#ffd34a', '#f2b84a': '#ffb020', '#ffffff': '#fff6d0', '#ffb08a': '#ffd9a0',
    },
  },

  beetle: {
    body: { w: 0.4, h: 0.3, d: 0.5, color: '#22222f' },
    legs: { type: 'stub', h: 0.1, r: 0.05, color: '#22222f', x: 0.6, z: 0.5 },
    head: { r: 0.24, w: 1.0, h: 0.9, d: 0.95, y: 0.38, z: 0.5, color: '#1b6b62' },
    eyes: { s: 0.17, gap: 0.62, el: 0.1 },
    blush: '#ff9ab0',
    extras: [
      { t: 'shells', colors: ['#18b5a0', '#7a4fd1', '#e9b830'], y: 0.78, z: 0.42 },
      { t: 'horn', colors: ['#22222f', '#4a4a62'], n: 4, s: 2.3, w: 0.26, el: 0.75, fwd: 1.1 },
      { t: 'horns', color: '#22222f', s: 0.8, az: 0.3, el: 0.7, dir: [0.35, 1, 0.5], segs: 2, bend: 0.3, thick: 0.35 },
      { t: 'puffs', color: '#22222f', list: [['body', 0.25, 0.06, 0.0, 0.065], ['body', -0.25, 0.06, 0.0, 0.065]] },
    ],
    shinyPalette: {
      '#18b5a0': '#e9b830', '#7a4fd1': '#ff7ab8', '#e9b830': '#fff3a8', '#1b6b62': '#b8860b', '#22222f': '#3a2a18', '#4a4a62': '#6a4a28', '#ff9ab0': '#ffd9a0',
    },
  },

  polarbear: {
    body: { w: 0.46, h: 0.4, d: 0.5, color: '#f4f8fc' },
    legs: { type: 'stub', h: 0.13, r: 0.11, color: '#e9f1f8' },
    head: { r: 0.36, w: 1.05, h: 0.95, d: 1.0, y: 0.8, z: 0.3, color: '#fbfdff' },
    eyes: { s: 0.1, gap: 0.52, el: 0.12 },
    blush: '#bfdcff',
    ears: { type: 'round', s: 0.42, az: 0.85, el: 0.6, up: 0.25, color: '#f4f8fc', inner: '#c9def0', static: true },
    snout: { type: 'muzzle', color: '#ffffff', w: 0.42, h: 0.3, d: 0.36, el: -0.28, nose: '#2f2a30', noseS: 0.15, noseY: 0.6, lo: true },
    tail: { type: 'puff', s: 0.09, color: '#f4f8fc', y: 0.2 },
    extras: [{ t: 'collar', color: '#4a9bff', bell: '#bfe3ff' }],
    shinyPalette: { '#f4f8fc': '#ffe9b0', '#fbfdff': '#fff4d0', '#e9f1f8': '#f6d98a', '#c9def0': '#ffcf8a', '#4a9bff': '#ff7ab8', '#bfe3ff': '#fff1a8', '#bfdcff': '#ffd0a0' },
  },

  // ───────── V8 §5: forest (ป่าใหญ่) ─────────
  // Common/uncommon <= 1.2k tris and <= 6 draw calls; rare/epic <= 1.6k and <= 7. `lo` flags swap a 192-tri sphere for a 120-tri one.
  // Animated parts keep the standard names (tail, tailTip, earL/earR, head, anchor) so the shared behaviours and strokes drive them.

  squirrel: {
    body: { w: 0.27, h: 0.27, d: 0.28, color: '#c9783c', lo: true, belly: { color: '#fff0d8', s: 0.8, lo: true } },
    legs: { type: 'stub', h: 0.08, r: 0.055 },
    head: { r: 0.31, w: 1.1, h: 0.95, d: 0.98, y: 0.58, z: 0.16 },
    eyes: { s: 0.12, gap: 0.55, el: 0.1 },
    blush: false,
    ears: { type: 'cat', s: 0.5, az: 0.7, el: 0.78, up: 0.5, inner: false },
    snout: { type: 'nose', color: '#4a3034', s: 0.07, el: -0.1 },
    tail: { type: 'long', n: 5, len: 1.0, r: 0.085, blob: 2.2, taper: 0.07, lift: 1.4, curve: 0.34, y: 0.05, color: '#c9783c', colors: ['#c9783c', '#c9783c', '#d98a4c', '#e8a868', '#f4c892'] },
    extras: [{ t: 'cheeks', color: '#f4d3a6', s: 0.3, lo: true }],
    shinyPalette: { '#c9783c': '#eac860', '#d98a4c': '#f0d070', '#e8a868': '#f6dc88', '#f4c892': '#fff6d0', '#fff0d8': '#fffbe8', '#f4d3a6': '#fff0b8' },
  },

  deer: {
    body: { w: 0.3, h: 0.3, d: 0.42, color: '#b98450', lo: true },
    legs: { type: 'long', h: 0.2, r: 0.04, color: '#a8744a', x: 0.55, z: 0.6 },
    neck: { r: 0.1, top: 0.85, z: 0.5 },
    head: { r: 0.24, w: 0.95, h: 1.0, d: 1.05, y: 0.9, z: 0.4 },
    eyes: { s: 0.13, gap: 0.58, el: 0.1 },
    blush: false,
    ears: { type: 'cat', s: 0.62, az: 0.85, el: 0.5, up: 0.1, flare: 0.7, inner: false },
    snout: { type: 'nose', color: '#3a2a2e', s: 0.07, el: -0.3 },
    tail: { type: 'fluffy', w: 0.05, h: 0.07, d: 0.05, dy: 0.08, dz: 0.02, rot: 0.2, color: '#fff4de', y: 0.55 },
    extras: [
      { t: 'antlers', color: '#e0bd80', s: 1.6, segs: 3, bend: 0.5 },
      { t: 'spots', color: '#fff4de', list: [
        { on: 'body', az: 1.2, el: 0.55, s: 0.2 }, { on: 'body', az: -1.2, el: 0.6, s: 0.18 },
        { on: 'body', az: 0.5, el: 1.0, s: 0.17 }, { on: 'body', az: -0.6, el: 0.95, s: 0.18 }, { on: 'body', az: 2.2, el: 0.7, s: 0.16 },
      ] },
    ],
    shinyPalette: { '#b98450': '#a8d8b8', '#a8744a': '#88c0a0', '#e0bd80': '#fff0a0', '#fff4de': '#ffffff' },
  },

  boar: {
    body: { w: 0.4, h: 0.34, d: 0.46, color: '#7a5a44', lo: true },
    legs: { type: 'stub', h: 0.11, r: 0.08, color: '#4a3a30' },
    head: { r: 0.3, w: 1.1, h: 0.95, d: 1.0, y: 0.58, z: 0.3, lo: true },
    eyes: { s: 0.11, gap: 0.62, el: 0.2 },
    blush: false,
    ears: { type: 'cat', s: 0.45, az: 0.8, el: 0.72, up: 0.3, flare: 0.5, inner: false },
    snout: { type: 'pig', color: '#a8806a', w: 0.36, h: 0.27, d: 0.28, el: -0.22 },
    tail: { type: 'curly', s: 0.06, color: '#4a3a30', y: 0.3, rot: 0.4 },
    extras: [
      { t: 'tusks', color: '#f4ead0', s: 0.46, az: 0.5, el: -0.3, segs: 2, bend: 0.55, out: 0.5, up: 0.25 },
      { t: 'spikes', color: '#3a2a22', n: 7, s: 0.1, from: 0.7, to: -0.55 },
    ],
    shinyPalette: { '#7a5a44': '#e0c8a8', '#4a3a30': '#b89870', '#a8806a': '#f4d8c0', '#3a2a22': '#8a6a48', '#f4ead0': '#fff4a8' },
  },

  fox: {
    body: { w: 0.3, h: 0.28, d: 0.4, color: '#e8782e', lo: true, belly: { color: '#fff4e6', s: 0.8, lo: true } },
    legs: { type: 'stub', h: 0.11, r: 0.055, color: '#4a3430' },
    head: { r: 0.29, w: 1.12, h: 0.92, d: 0.95, y: 0.54, z: 0.22 },
    eyes: { s: 0.12, gap: 0.55, el: 0.14 },
    blush: false,
    ears: { type: 'cat', s: 0.85, az: 0.65, el: 0.72, up: 0.7, inner: false, color: '#e8782e' },
    snout: { type: 'pointy', color: '#fff4e6', w: 0.24, h: 0.19, d: 0.5, el: -0.15, nose: '#2e2226' },
    tail: { type: 'long', n: 3, len: 0.62, r: 0.06, blob: 2.4, taper: 0, lift: 0.5, curve: 0.12, y: 0.15, color: '#e8782e', colors: ['#e8782e', '#e8782e', '#fffaf0'] },
    extras: [{ t: 'cheeks', color: '#fff4e6', s: 0.3, lo: true }],
    shinyPalette: { '#e8782e': '#b8c4d8', '#fff4e6': '#ffffff', '#4a3430': '#6a7488', '#fffaf0': '#bfe4ff' },
  },

  hedgehog: {
    body: { w: 0.36, h: 0.3, d: 0.4, color: '#6a5040', lo: true },
    legs: { type: 'stub', h: 0.07, r: 0.05, color: '#f0d8b8' },
    head: { r: 0.24, w: 1.0, h: 0.9, d: 1.1, y: 0.38, z: 0.3, color: '#f0d8b8', lo: true },
    eyes: { s: 0.12, gap: 0.5, el: 0.12 },
    blush: false,
    ears: { type: 'cat', s: 0.4, az: 0.9, el: 0.55, up: 0.15, flare: 0.3, inner: false },
    snout: { type: 'pointy', color: '#f0d8b8', w: 0.2, h: 0.16, d: 0.42, el: -0.15, nose: '#2e2226' },
    tail: { type: 'puff', s: 0.04, lo: true, y: 0.1, color: '#6a5040' },
    extras: [{ t: 'spines', n: 34, s: 0.55, ymax: 1.0, ymin: -0.25, colors: ['#8a6a50', '#4a3628'] }],
    shinyPalette: { '#6a5040': '#9a7ab8', '#8a6a50': '#c8a8e0', '#4a3628': '#6a4a8a', '#f0d8b8': '#fff0e8' },
  },

  raccoon: {
    body: { w: 0.36, h: 0.3, d: 0.4, color: '#8c8c94', lo: true },
    legs: { type: 'stub', h: 0.1, r: 0.07, color: '#3a3640' },
    head: { r: 0.3, w: 1.15, h: 0.92, d: 0.95, y: 0.55, z: 0.2, color: '#a0a0a8' },
    eyes: { s: 0.12, gap: 0.55, el: 0.12, ring: '#ffffff' },
    blush: false,
    ears: { type: 'round', s: 0.45, az: 0.85, el: 0.6, up: 0.25, color: '#8c8c94', inner: false },
    snout: { type: 'muzzle', color: '#eeeef2', w: 0.34, h: 0.24, d: 0.26, el: -0.28, nose: '#2a262c', noseS: 0.1, noseY: 0.5, lo: true },
    tail: { type: 'long', n: 4, len: 0.58, r: 0.066, blob: 1.9, taper: 0.06, lift: 0.4, curve: 0.12, y: 0.15, color: '#9a9aa2', colors: ['#9a9aa2', '#2c282e'] },
    extras: [{ t: 'spots', color: '#3a3640', th: 0.03, list: [
      { on: 'head', az: 0.55, el: 0.1, s: 0.46, sx: 1.2, sy: 0.85 }, { on: 'head', az: -0.55, el: 0.1, s: 0.46, sx: 1.2, sy: 0.85 },
    ] }],
    shinyPalette: { '#8c8c94': '#c8b8e0', '#a0a0a8': '#d8c8ee', '#9a9aa2': '#c8b8e0', '#c9c9cf': '#f0e8ff', '#2c282e': '#5a4a78' },
  },

  bear: {
    body: { w: 0.44, h: 0.4, d: 0.44, color: '#7a4a2a', lo: true },
    legs: { type: 'stub', h: 0.12, r: 0.1, color: '#6a3e22' },
    head: { r: 0.34, w: 1.08, h: 0.95, d: 0.97, y: 0.7, z: 0.2 },
    eyes: { s: 0.1, gap: 0.52, el: 0.14 },
    blush: false,
    ears: { type: 'round', s: 0.5, az: 0.9, el: 0.58, up: 0.2, color: '#7a4a2a', inner: '#c28a5a' },
    snout: { type: 'muzzle', color: '#e8b96a', w: 0.46, h: 0.34, d: 0.36, el: -0.28, nose: '#2a1e1e', noseS: 0.13, noseY: 0.55, lo: true },
    tail: { type: 'puff', s: 0.08, lo: true, y: 0.15, color: '#6a3e22' },
    shinyPalette: { '#7a4a2a': '#b88a52', '#6a3e22': '#9a6e3a', '#e8b96a': '#fff0c0', '#c28a5a': '#ffd8a0' },
  },

  badger: {
    body: { w: 0.4, h: 0.3, d: 0.5, color: '#8a8a94', lo: true },
    legs: { type: 'stub', h: 0.09, r: 0.07, color: '#2e2a32' },
    head: { r: 0.27, w: 1.05, h: 0.9, d: 1.1, y: 0.46, z: 0.34, color: '#f4f2f2' },
    eyes: { s: 0.12, gap: 0.5, el: 0.12, ring: '#ffffff' },
    blush: false,
    ears: { type: 'round', s: 0.4, az: 0.85, el: 0.62, up: 0.2, color: '#2e2a32', inner: false },
    snout: { type: 'pointy', color: '#f4f2f2', w: 0.24, h: 0.2, d: 0.5, el: -0.15, nose: '#2a262c' },
    tail: { type: 'puff', s: 0.07, lo: true, y: 0.15 },
    extras: [{ t: 'spots', color: '#3a363e', th: 0.03, list: [
      { on: 'head', az: 0.5, el: 0.12, s: 0.5, sx: 0.5, sy: 1.5 }, { on: 'head', az: -0.5, el: 0.12, s: 0.5, sx: 0.5, sy: 1.5 },
    ] }],
    shinyPalette: { '#8a8a94': '#e8c8a0', '#2e2a32': '#7a5a48', '#f4f2f2': '#fffaf0' },
  },

  skunk: {
    body: { w: 0.34, h: 0.3, d: 0.42, color: '#3a3640', lo: true },
    legs: { type: 'stub', h: 0.1, r: 0.06, color: '#3a3640' },
    head: { r: 0.26, w: 1.05, h: 0.92, d: 1.0, y: 0.52, z: 0.22 },
    eyes: { s: 0.13, gap: 0.55, el: 0.12, ring: '#ffffff' },
    blush: false,
    ears: { type: 'round', s: 0.42, az: 0.85, el: 0.62, up: 0.2, inner: false },
    snout: { type: 'nose', color: '#ff9fb2', s: 0.07, el: -0.12 },
    tail: { type: 'long', n: 4, len: 0.62, r: 0.075, blob: 2.5, taper: 0.1, lift: 1.1, curve: 0.3, y: 0.1, color: '#3a3640', colors: ['#3a3640', '#fffaf0', '#3a3640', '#fffaf0'] },
    extras: [{ t: 'spots', color: '#fffaf0', th: 0.2, list: [
      { on: 'body', az: 0.32, el: 1.1, s: 0.38, sx: 0.8, sy: 2.5 }, { on: 'body', az: -0.32, el: 1.1, s: 0.38, sx: 0.8, sy: 2.5 },
      { on: 'head', az: 0, el: 1.0, s: 0.3, sx: 0.4, sy: 1.6 },
    ] }],
    shinyPalette: { '#3a3640': '#6a4a7a', '#fffaf0': '#ffe0f0' },
  },

  beaver: {
    body: { w: 0.38, h: 0.34, d: 0.46, color: '#8a5a36', lo: true },
    legs: { type: 'stub', h: 0.1, r: 0.075, color: '#6a4228' },
    head: { r: 0.3, w: 1.05, h: 0.95, d: 1.0, y: 0.6, z: 0.26 },
    eyes: { s: 0.11, gap: 0.55, el: 0.16 },
    blush: false,
    ears: { type: 'round', s: 0.35, az: 0.9, el: 0.55, up: 0.15, inner: false },
    snout: { type: 'muzzle', color: '#c9a074', w: 0.34, h: 0.25, d: 0.3, el: -0.3, nose: '#2a1e1e', noseS: 0.1, noseY: 0.55, lo: true },
    tail: { type: 'paddle', w: 0.2, d: 0.3, rot: 0.05, y: 0.12, color: '#6a4a34', edge: '#5a3e2a' },
    extras: [{ t: 'teeth', s: 0.07 }],
    shinyPalette: { '#8a5a36': '#7ac0b8', '#6a4228': '#4a9a92', '#c9a074': '#e8f4e0', '#6a4a34': '#3a7a76', '#5a3e2a': '#2e605c' },
  },

  sloth: {
    body: { w: 0.38, h: 0.34, d: 0.38, color: '#a8957a', lo: true, belly: { color: '#c9b99a', s: 0.75, lo: true } },
    legs: { type: 'stub', h: 0.08, r: 0.08, color: '#8a7660' },
    head: { r: 0.31, w: 1.1, h: 0.92, d: 0.95, y: 0.62, z: 0.24, color: '#e2d5ba' },
    eyes: { s: 0.1, gap: 0.5, el: 0.1, tall: 0.5, ring: '#fff6e4' },
    blush: false,
    ears: { type: 'round', s: 0.25, az: 0.9, el: 0.45, up: 0.1, color: '#a8957a', inner: false },
    snout: { type: 'nose', color: '#3a2a2e', s: 0.09, el: -0.15 },
    tail: { type: 'puff', s: 0.06, lo: true, y: 0.1 },
    extras: [
      { t: 'arms', color: '#8a7660', hand: '#6e5c48', r: 0.085, x: 0.98, y: 0.45, z: 0.1, hx: 1.12, hy: 0.14, hz: 0.3, claws: 3 },
      { t: 'spots', color: '#5a4636', th: 0.03, list: [
        { on: 'head', az: 0.52, el: 0.08, s: 0.52, sx: 0.75, sy: 1.3 }, { on: 'head', az: -0.52, el: 0.08, s: 0.52, sx: 0.75, sy: 1.3 },
      ] },
      { t: 'smile', color: '#3a2a2e', w: 0.14, el: -0.5, az: 0.16, tilt: 0.55 },
    ],
    shinyPalette: { '#a8957a': '#a8c8a0', '#c9b99a': '#d8ecd0', '#8a7660': '#6a9a62', '#6e5c48': '#4a7a4a', '#e2d5ba': '#f0f4dc', '#5a4636': '#4a6a50' },
  },

  monkey: {
    body: { w: 0.3, h: 0.3, d: 0.32, color: '#8a5a3a', lo: true },
    legs: { type: 'stub', h: 0.1, r: 0.06, color: '#7a4e30' },
    head: { r: 0.3, w: 1.08, h: 0.95, d: 0.95, y: 0.56, z: 0.2 },
    eyes: { s: 0.13, gap: 0.42, el: 0.1, ring: '#ffffff' },
    blush: false,
    ears: { type: 'round', s: 0.75, az: 1.0, el: 0.3, up: 0.1, inner: '#f2d2ae' },
    snout: { type: 'nose', color: '#4a3034', s: 0.06, el: -0.2 },
    tail: { type: 'long', n: 5, len: 0.85, r: 0.036, taper: 0.06, lift: 0.5, curve: 0.55, tip: 4, y: 0.1, color: '#7a4e30' },
    extras: [
      { t: 'arms', color: '#7a4e30', hand: '#f2d2ae', r: 0.05, x: 0.9, y: 0.3, z: 0.1, hx: 1.05, hy: 0.14, hz: 0.28 },
      { t: 'mask', color: '#f2d2ae', rx: 0.72, ry: 0.52, rz: 0.8, y: -0.28, z: 0.3 },
    ],
    shinyPalette: { '#8a5a3a': '#e8c070', '#7a4e30': '#c89a48', '#f2d2ae': '#fff4d8' },
  },

  orangutan: {
    body: { w: 0.42, h: 0.4, d: 0.4, color: '#d9702b', lo: true },
    legs: { type: 'stub', h: 0.1, r: 0.08, color: '#c9622a' },
    head: { r: 0.3, w: 1.08, h: 0.95, d: 0.95, y: 0.66, z: 0.2, color: '#d9702b' },
    eyes: { s: 0.12, gap: 0.42, el: 0.08, ring: '#fff3e0' },
    blush: false,
    ears: { type: 'cat', s: 0.3, az: 1.0, el: 0.2, up: 0.05, flare: 0.8, color: '#c9784a', inner: false },
    snout: { type: 'nose', color: '#4a3034', s: 0.07, el: -0.2 },
    tail: { type: 'puff', s: 0.05, lo: true, y: 0.1, color: '#c9622a' },
    extras: [
      { t: 'arms', color: '#d9702b', hand: '#c9784a', r: 0.085, x: 0.95, y: 0.4, z: 0.08, hx: 1.12, hy: 0.12, hz: 0.3 },
      { t: 'puffs', color: '#e8863a', list: [['body', 0.36, 0.7, -0.04, 0.2], ['body', -0.36, 0.7, -0.04, 0.2], ['body', 0, 0.74, -0.2, 0.22]] },
      { t: 'puffs', color: '#e8863a', list: [['head', 0, 0.26, -0.05, 0.19], ['head', 0.2, 0.2, -0.08, 0.14], ['head', -0.2, 0.2, -0.08, 0.14]] },
      { t: 'mask', color: '#d9a074', rx: 0.74, ry: 0.55, rz: 0.82, y: -0.3, z: 0.28 },
    ],
    shinyPalette: { '#d9702b': '#e8a8c8', '#c9622a': '#c888a8', '#e8863a': '#f4c0d8', '#c9784a': '#c898b0', '#d9a074': '#fff0e0' },
  },

  tiger: {
    body: { w: 0.4, h: 0.36, d: 0.55, color: '#f08a2a', lo: true },
    legs: { type: 'stub', h: 0.13, r: 0.095, color: '#f08a2a' },
    head: { r: 0.32, w: 1.1, h: 0.95, d: 0.97, y: 0.7, z: 0.34 },
    eyes: { s: 0.11, gap: 0.52, el: 0.14 },
    blush: false,
    ears: { type: 'round', s: 0.5, az: 0.85, el: 0.65, up: 0.3, color: '#f08a2a', inner: '#fff3e0' },
    snout: { type: 'muzzle', color: '#fff3e0', w: 0.46, h: 0.34, d: 0.38, el: -0.3, nose: '#d9788a', noseS: 0.12, noseY: 0.6, lo: true },
    tail: { type: 'long', n: 5, len: 0.7, r: 0.05, lift: 0.3, curve: 0.2, y: 0.2, color: '#f08a2a', colors: ['#f08a2a', '#3a2420'] },
    extras: [
      { t: 'stripes', at: [-0.62, -0.32, -0.02, 0.28, 0.56], color: '#3a2420' },
      { t: 'spots', color: '#3a2420', th: 0.03, list: [
        { on: 'head', az: 0, el: 0.7, s: 0.3, sx: 0.3, sy: 1.3 },
        { on: 'head', az: 0.95, el: 0.12, s: 0.32, sx: 0.4, sy: 1.2 }, { on: 'head', az: -0.95, el: 0.12, s: 0.32, sx: 0.4, sy: 1.2 },
      ] },
    ],
    shinyPalette: { '#f08a2a': '#f4f4fa', '#3a2420': '#5a7ac8', '#fff3e0': '#ffffff' },
  },

  gorilla: {
    body: { w: 0.5, h: 0.46, d: 0.46, color: '#4a4654', lo: true, belly: { color: '#62606e', s: 0.7, lo: true } },
    legs: { type: 'stub', h: 0.1, r: 0.11, color: '#3e3a48' },
    head: { r: 0.32, w: 1.0, h: 0.9, d: 0.9, y: 0.78, z: 0.26 },
    eyes: { s: 0.11, gap: 0.46, el: 0.1, ring: '#f4ece0' },
    blush: false,
    ears: { type: 'round', s: 0.32, az: 1.0, el: 0.2, up: 0.05, inner: false },
    snout: { type: 'muzzle', color: '#6a6672', w: 0.5, h: 0.34, d: 0.3, el: -0.28, nose: '#2a262c', noseS: 0.1, noseY: 0.4, lo: true },
    tail: { type: 'puff', s: 0.05, lo: true, y: 0.1 },
    extras: [
      { t: 'arms', color: '#4a4654', hand: '#38343f', r: 0.115, x: 0.98, y: 0.4, z: 0.1, hx: 1.12, hy: 0.14, hz: 0.5 },
      { t: 'puffs', color: '#4a4654', list: [['body', 0.25, 0.82, 0.04, 0.17], ['body', -0.25, 0.82, 0.04, 0.17]] },
      { t: 'puffs', color: '#3e3a48', list: [['head', 0, 0.26, -0.04, 0.13]] },
    ],
    shinyPalette: { '#4a4654': '#a8a8b8', '#3e3a48': '#8a8a9c', '#38343f': '#6a6a7c', '#62606e': '#c8c8d8', '#6a6672': '#d8d8e4' },
  },

  // ───────── V9 §6: water friends (แหล่งน้ำ) ─────────
  // Fully aquatic pets (fish, tropicalfish, blowfish, squid, octopus, dolphin, shark) float inside a translucent bubble (spec.bubble = { r, pitch? }, centre = r,
  // so the bubble rests on the ground; one shared geometry + material, parts.bubble). Walkers: crab (sideways), frog (hops), turtle, otter, shrimp, lobster.
  // Oyster / conch sit on a sand tuft with a `shell` pivot (rotate .x to open / tilt). Budgets as the forest: common/uncommon <= 1.2k tris + 6 calls, rare/epic <= 1.6k + 7 (+ the bubble).
  // Animated parts keep the standard names: tail (fin), earL/earR (pectoral fins, claws, feelers, tentacles), tailTip, head, anchor.

  fish: {
    body: { w: 0.2, h: 0.25, d: 0.31, y: 0.47, color: '#7ec8f0', lo: true, belly: { color: '#eaf8ff', s: 0.8, dz: 0.12, dy: -0.28, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.21, w: 0.95, h: 1.0, d: 0.95, y: 0.48, z: 0.22, lo: true },
    eyes: { s: 0.26, gap: 0.78, el: 0.14, ring: '#ffffff' },
    blush: '#ff9fb8',
    ears: { type: 'fin', s: 1.5, az: 1.35, el: -0.45, color: '#5db2e6', dir: [0.9, -0.35, -0.55] },
    snout: { type: 'nose', color: '#ff8fa3', s: 0.065, el: -0.15 },
    tail: { type: 'fin', s: 0.32, len: 0.08, y: -0.05, color: '#5db2e6', lobe: '#8fd3f5' },
    extras: [
      { t: 'blobs', color: '#5db2e6', list: [{ p: [0, 0.74, -0.03], s: [0.025, 0.11, 0.17], r: [-0.45, 0, 0] }, { p: [0, 0.3, -0.12], s: [0.02, 0.07, 0.1], r: [0.5, 0, 0] }] },
      { t: 'blobs', color: '#a9e0fa', list: [{ g: 'sphP', p: [0.14, 0.5, 0.02], s: 0.05, mirror: true }] },
    ],
    bubble: { r: 0.4 },
    shinyPalette: { '#7ec8f0': '#ffc873', '#5db2e6': '#ff9f5e', '#8fd3f5': '#ffd9a0', '#eaf8ff': '#fff6dc', '#a9e0fa': '#ffe6b0' },
  },

  tropicalfish: {
    body: { w: 0.17, h: 0.3, d: 0.3, y: 0.47, color: '#ff8f3f', lo: true, belly: { color: '#ffd2a8', s: 0.78, dz: 0.1, dy: -0.3, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.21, w: 0.85, h: 1.1, d: 0.9, y: 0.48, z: 0.2, lo: true },
    eyes: { s: 0.27, gap: 0.8, el: 0.12, ring: '#ffffff' },
    blush: '#ff6f6f',
    ears: { type: 'fin', s: 1.4, az: 1.35, el: -0.5, color: '#ff7a2a', dir: [0.9, -0.4, -0.45] },
    snout: { type: 'nose', color: '#ff6f6f', s: 0.06, el: -0.15 },
    tail: { type: 'fin', s: 0.32, len: 0.07, y: 0, color: '#ff7a2a', lobe: '#ffb270' },
    extras: [
      { t: 'stripes', color: '#fffdf6', at: [0.42, -0.2], th: 0.075, dy: 0, g: 'sphP' },
      { t: 'blobs', color: '#ff7a2a', list: [{ p: [0, 0.8, -0.02], s: [0.025, 0.15, 0.2], r: [-0.4, 0, 0] }, { p: [0, 0.19, -0.1], s: [0.02, 0.08, 0.11], r: [0.5, 0, 0] }] },
    ],
    bubble: { r: 0.4 },
    shinyPalette: { '#ff8f3f': '#ff9fc6', '#ff7a2a': '#ff7aa8', '#ffd2a8': '#ffe3ee', '#ffb270': '#ffc4d8', '#fffdf6': '#fff6ff' },
  },

  blowfish: {
    body: { w: 0.31, h: 0.3, d: 0.31, y: 0.5, color: '#ffd45e', lo: true, belly: { color: '#fff3c9', s: 0.82, dz: 0.18, dy: -0.28, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.22, w: 1.1, h: 0.95, d: 0.85, y: 0.5, z: 0.2, lo: true },
    eyes: { s: 0.25, gap: 0.6, el: 0.2, ring: '#ffffff' },
    blush: '#ff9f8a',
    ears: { type: 'fin', s: 0.8, az: 1.25, el: -0.35, color: '#f5b73e', dir: [1, -0.1, -0.2], wd: 0.5 },
    snout: { type: 'nose', color: '#ff9fa8', s: 0.1, el: -0.28 },
    tail: { type: 'fin', s: 0.3, len: 0.07, y: 0, color: '#f5b73e', lobe: '#ffe08f' },
    extras: [
      { t: 'spines', n: 20, s: 0.5, ymax: 0.95, ymin: -0.1, zmax: 0.45, colors: ['#f0a732', '#ffe08f'] },
    ],
    bubble: { r: 0.4 },
    shinyPalette: { '#ffd45e': '#9fe0d0', '#f5b73e': '#6fc4b4', '#f0a732': '#4fa89a', '#ffe08f': '#d8f5ec', '#fff3c9': '#f2fff8' },
  },

  squid: {
    body: { w: 0.2, h: 0.2, d: 0.38, y: 0.5, color: '#ff9fb4', lo: true, belly: { color: '#ffd9e2', s: 0.78, dz: 0.08, dy: -0.3, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.24, w: 1.05, h: 0.95, d: 0.9, y: 0.5, z: 0.3, lo: true },
    eyes: { s: 0.36, gap: 0.8, el: 0.05, ring: '#ffffff' },
    blush: '#ff7a96',
    ears: { type: 'arm', s: 0.5, az: 0.5, el: -0.7, color: '#ff9fb4', inner: '#ff7a96', club: 2.2, len: 1.25, r: 0.12, dir: [0.3, -0.35, 1] },
    tail: { type: 'fluke', s: 0.24, len: 0.1, rot: 0, y: 0, z: 0.92, color: '#ff9fb4', lobe: '#ffc2d0' },
    extras: [
      { t: 'blobs', color: '#ff9fb4', list: [
        { g: 'coneP', p: [0.07, 0.34, 0.5], s: [0.05, 0.2, 0.05], dir: [0.5, -0.5, 1], mirror: true },
        { g: 'coneP', p: [0.03, 0.31, 0.52], s: [0.05, 0.22, 0.05], dir: [0.2, -0.65, 1], mirror: true },
        { g: 'coneP', p: [0.11, 0.38, 0.45], s: [0.045, 0.17, 0.045], dir: [0.9, -0.3, 0.8], mirror: true },
      ] },
      { t: 'spots', color: '#ff7a96', list: [{ on: 'body', az: 0.2, el: 0.9, s: 0.4 }, { on: 'body', az: 2.6, el: 0.8, s: 0.35 }, { on: 'body', az: -1.2, el: 0.7, s: 0.3 }, { on: 'body', az: 1.4, el: 0.4, s: 0.3 }] },
    ],
    bubble: { r: 0.4, pitch: -0.6 },
    shinyPalette: { '#ff9fb4': '#b49cff', '#ffd9e2': '#e8e0ff', '#ff7a96': '#8a6cf0', '#ffc2d0': '#d6ccff' },
  },

  octopus: {
    body: { w: 0.24, h: 0.2, d: 0.24, y: 0.4, color: '#b98cf0', lo: true },
    legs: { type: 'none' },
    head: { r: 0.33, w: 1.05, h: 1.0, d: 1.0, y: 0.7, z: 0.02, color: '#b98cf0' },
    eyes: { s: 0.17, gap: 0.5, el: -0.12, ring: '#ffffff' },
    blush: '#ff8fb8',
    ears: { type: 'arm', s: 0.5, az: 0.95, el: -0.75, color: '#b98cf0', inner: '#e3c9ff', club: 0.6, len: 1.3, r: 0.2, dir: [0.9, -0.2, 0.9] },
    snout: { type: 'nose', color: '#8a5cc8', s: 0.05, el: -0.3 },
    extras: [
      { t: 'tentacles', n: 6, p: [0, 0.34, 0], ring: 0.14, r: 0.075, step: 0.11, segs: 3, out: 0.9, down: 0.7, curl: 0.38, from: 0.9, span: 4.5, closed: false, color: '#a97ce6', tip: '#e3c9ff' },
      { t: 'spots', color: '#e3c9ff', list: [{ on: 'head', az: 0.4, el: 1.0, s: 0.16 }, { on: 'head', az: -0.5, el: 0.85, s: 0.13 }] },
    ],
    bubble: { r: 0.4 },
    shinyPalette: { '#b98cf0': '#ff9fc2', '#a97ce6': '#f58ab0', '#e3c9ff': '#ffe0ec' },
  },

  oyster: {
    body: { w: 0.36, h: 0.11, d: 0.31, y: 0.1, color: '#a9a3c4', lo: true },
    legs: { type: 'none' },
    head: { r: 0.2, w: 1.15, h: 0.85, d: 0.85, y: 0.2, z: 0.03, color: '#ffd6de', lo: true },
    eyes: { s: 0.17, gap: 0.5, el: 0.22 },
    blush: '#ff8fa8',
    snout: { type: 'nose', color: '#fff8ff', s: 0.06, el: -0.45 },
    extras: [
      { t: 'blobs', color: '#f2dca0', list: [{ p: [0, 0.035, 0.02], s: [0.5, 0.05, 0.44] }, { g: 'sphP', p: [0.33, 0.07, 0.2], s: [0.12, 0.08, 0.1] }, { g: 'sphP', p: [-0.3, 0.06, -0.22], s: [0.1, 0.07, 0.09] }] },
      { t: 'blobs', color: '#8e87b0', list: [{ p: [0, 0.14, 0], s: [0.37, 0.025, 0.32] }, { g: 'sphP', p: [0.0, 0.1, 0.3], s: [0.09, 0.05, 0.04] }] },
      { t: 'group', name: 'shell', p: [0, 0.18, -0.27], r: [-0.42, 0, 0], list: [
        { g: 'sphM', c: '#bdb7d8', p: [0, 0.01, 0.27], s: [0.38, 0.1, 0.31] },
        { c: '#a39cc6', p: [0, 0.095, 0.27], s: [0.3, 0.035, 0.24] },
        { g: 'sphP', c: '#a39cc6', p: [0, 0.07, 0.07], s: [0.1, 0.05, 0.06] },
        { g: 'sphP', c: '#9a93c0', p: [0.14, 0.085, 0.2], s: [0.08, 0.045, 0.07], mirror: true },
      ] },
    ],
    shinyPalette: { '#a9a3c4': '#e8b4c8', '#bdb7d8': '#f5cadb', '#a39cc6': '#e2a6bd', '#8e87b0': '#cf93ab', '#ffd6de': '#fff0f0' },
  },

  conch: {
    body: { w: 0.21, h: 0.11, d: 0.34, y: 0.12, color: '#f7cdb0', lo: true },
    legs: { type: 'none' },
    head: { r: 0.17, w: 1.1, h: 0.95, d: 0.95, y: 0.2, z: 0.3, lo: true },
    eyes: { s: 0.2, gap: 0.5, el: 0.22 },
    blush: '#ff9a8a',
    ears: { type: 'long', s: 1.1, az: 0.5, el: 0.8, up: 0.55, flare: 0.25, color: '#f7cdb0', inner: false },
    snout: { type: 'nose', color: '#c97a6a', s: 0.06, el: -0.2 },
    extras: [
      { t: 'blobs', color: '#f2dca0', list: [{ p: [0, 0.03, 0.04], s: [0.44, 0.05, 0.5] }, { g: 'sphP', p: [0.3, 0.05, 0.3], s: [0.1, 0.07, 0.09] }] },
      { t: 'group', name: 'shell', p: [0, 0.22, -0.08], r: [0.18, 0, 0], list: [
        { g: 'sphM', c: '#ffe9d2', p: [0, 0.04, -0.02], s: [0.22, 0.2, 0.25] },
        { c: '#ffd8bf', p: [0, 0.2, -0.04], s: [0.17, 0.15, 0.19] },
        { c: '#f4a98c', p: [0, 0.34, -0.05], s: [0.12, 0.11, 0.13] },
        { g: 'cone', c: '#f4a98c', p: [0, 0.4, -0.06], s: [0.07, 0.16, 0.07] },
        { g: 'coneP', c: '#f4a98c', p: [0.16, 0.12, 0.0], s: [0.05, 0.14, 0.05], dir: [1, 0.6, 0], mirror: true },
        { g: 'coneP', c: '#f4a98c', p: [0.12, 0.1, 0.14], s: [0.045, 0.12, 0.045], dir: [0.7, 0.6, 0.8], mirror: true },
        { g: 'coneP', c: '#f4a98c', p: [0.12, 0.1, -0.16], s: [0.045, 0.12, 0.045], dir: [0.7, 0.6, -0.8], mirror: true },
        { g: 'coneP', c: '#f4a98c', p: [0.0, 0.1, -0.22], s: [0.045, 0.12, 0.045], dir: [0, 0.6, -1] },
      ] },
    ],
    shinyPalette: { '#f7cdb0': '#cdeacb', '#ffe9d2': '#f2fff0', '#ffd8bf': '#dff5d8', '#f4a98c': '#8fd3b2' },
  },

  shrimp: {
    body: { w: 0.15, h: 0.17, d: 0.28, y: 0.37, color: '#ff9c8a', lo: true, belly: { color: '#ffd9cf', s: 0.78, dz: 0.1, dy: -0.3, lo: true } },
    legs: { type: 'stub', h: 0.14, r: 0.035, color: '#ffb7a8', x: 0.5, z: 0.45 },
    head: { r: 0.18, w: 1.0, h: 0.95, d: 0.95, y: 0.41, z: 0.22, lo: true },
    eyes: { s: 0.22, gap: 0.62, el: 0.2, ring: '#ffffff' },
    blush: '#ff6f78',
    ears: { type: 'arm', s: 1.3, az: 0.55, el: 0.35, color: '#ff8478', len: 1.5, r: 0.045, dir: [0.35, 0.7, 1] },
    snout: { type: 'nose', color: '#ff6f78', s: 0.05, el: -0.3 },
    tail: { type: 'long', n: 3, len: 0.42, r: 0.085, blob: 1.55, taper: 0.1, lift: -0.15, curve: -0.6, y: 0.0, z: 0.85, color: '#ff9c8a', colors: ['#ff9c8a', '#ff8a78', '#ff9c8a'], fan: '#ffb7a8' },
    extras: [
      { t: 'stripes', color: '#ff8478', at: [0.3, -0.2], th: 0.07, dy: 0, g: 'sphP' },
      { t: 'blobs', on: 'head', color: '#ff8478', list: [{ g: 'coneP', p: [0, 0.14, 0.12], s: [0.04, 0.16, 0.04], dir: [0, 0.55, 1] }] },
    ],
    shinyPalette: { '#ff9c8a': '#ffe27a', '#ff8a78': '#f5c84a', '#ff8478': '#f0b830', '#ffb7a8': '#fff0b0', '#ffd9cf': '#fffbe0' },
  },

  lobster: {
    body: { w: 0.3, h: 0.23, d: 0.46, y: 0.3, color: '#ff6f5c', lo: true, belly: { color: '#ffc3b0', s: 0.78, dz: 0.1, dy: -0.35, lo: true } },
    legs: { type: 'crab', n: 3, r: 0.034, len: 0.26, x: 0.75, dy: 0.35, z: 0.5, color: '#ff8a76', down: 1.1, out: 0.7, fan: 0.4 },
    head: { r: 0.22, w: 1.0, h: 0.9, d: 0.95, y: 0.34, z: 0.38, lo: true },
    eyes: { s: 0.19, gap: 0.55, el: 0.3, ring: '#ffffff' },
    blush: '#ff9a8a',
    ears: { type: 'claw', s: 2.4, az: 1.15, el: -0.2, color: '#ff5f4d', inner: '#ffa28f', out: 0.55, lift: 0.1 },
    snout: { type: 'nose', color: '#c94a3a', s: 0.05, el: -0.35 },
    tail: { type: 'long', n: 4, len: 0.5, r: 0.115, blob: 1.5, taper: 0.1, lift: 0.15, curve: -0.25, y: 0.0, z: 0.85, color: '#ff6f5c', colors: ['#ff6f5c', '#f4584a', '#ff6f5c', '#f4584a'], fan: '#ff8a76' },
    extras: [
      { t: 'stripes', color: '#f4584a', at: [0.5, 0.15, -0.2, -0.5], th: 0.06, dy: 0, g: 'sphP' },
      { t: 'whiskers', color: '#ff9a86', len: 2.4, n: 1, az: 0.25, el: 0.5 },
    ],
    shinyPalette: { '#ff6f5c': '#7a9cff', '#f4584a': '#5a7ae8', '#ff5f4d': '#5a7ae8', '#ff8a76': '#a4bcff', '#ffa28f': '#c4d4ff', '#ffc3b0': '#e6edff' },
  },

  crab: {
    body: { w: 0.4, h: 0.2, d: 0.3, y: 0.24, color: '#ff7565', lo: true, belly: { color: '#ffc4b4', s: 0.8, dz: 0.1, dy: -0.35, lo: true } },
    legs: { type: 'crab', n: 4, r: 0.03, len: 0.27, x: 0.82, dy: 0.15, z: 0.55, color: '#ff8e7e', down: 0.95, out: 0.85, fan: 0.35 },
    head: { r: 0.17, w: 1.5, h: 0.8, d: 0.85, y: 0.34, z: 0.15, lo: true },
    eyes: { s: 0.22, gap: 0.42, el: 0.4, ring: '#ffffff' },
    blush: '#ffa09a',
    ears: { type: 'claw', s: 2.0, az: 1.25, el: -0.45, color: '#ff5f50', inner: '#ffb3a6', out: 0.45, lift: 0.15 },
    snout: { type: 'nose', color: '#c94a3a', s: 0.05, el: -0.45 },
    tail: { type: 'puff', s: 0.07, lo: true, y: -0.05, z: 0.95, color: '#ff8e7e' },
    extras: [
      { t: 'spots', color: '#ffa89b', th: 0.2, list: [{ on: 'body', az: 0.6, el: 1.0, s: 0.55, sx: 1.4 }, { on: 'body', az: -0.6, el: 1.0, s: 0.55, sx: 1.4 }, { on: 'body', az: 3.0, el: 0.9, s: 0.5, sx: 1.5 }] },
      { t: 'blobs', color: '#ff5f50', list: [{ g: 'ring', p: [0, 0.19, 0], s: [0.33, 0.26, 0.4], r: [Math.PI / 2, 0, 0] }] },
    ],
    shinyPalette: { '#ff7565': '#f5a8c8', '#ff5f50': '#e8789f', '#ff8e7e': '#f8c0d6', '#ffa89b': '#ffe0ec', '#ffb3a6': '#ffe8f0' },
  },

  frog: {
    body: { w: 0.33, h: 0.26, d: 0.34, y: 0.27, color: '#7edb7c', lo: true, belly: { color: '#effac8', s: 0.8, dz: 0.2, dy: -0.2, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.3, w: 1.25, h: 0.78, d: 0.9, y: 0.46, z: 0.18, lo: true },
    eyes: { s: 0.18, gap: 0.6, el: 0.45, ring: '#fffef0' },
    blush: '#ff9fa8',
    extras: [
      { t: 'puffs', color: '#7edb7c', list: [['head', 0.19, 0.13, 0.06, 0.12], ['head', -0.19, 0.13, 0.06, 0.12]] },
      { t: 'smile', color: '#3f7a52', w: 0.3, el: -0.3, az: 0.34, tilt: 0.28 },
      { t: 'blobs', color: '#6bc86a', list: [
        { p: [0.25, 0.16, -0.12], s: [0.1, 0.15, 0.2], mirror: true },
        { p: [0.3, 0.03, 0.04], s: [0.13, 0.035, 0.17], mirror: true },
        { p: [0.2, 0.05, 0.3], s: [0.07, 0.07, 0.1], mirror: true },
        { g: 'sphP', p: [0.22, 0.03, 0.4], s: [0.09, 0.03, 0.07], mirror: true },
      ] },
      { t: 'spots', color: '#5eb85e', th: 0.2, list: [{ on: 'body', az: 0.5, el: 1.0, s: 0.45 }, { on: 'body', az: -0.7, el: 0.9, s: 0.4 }] },
    ],
    shinyPalette: { '#7edb7c': '#7ad8e8', '#6bc86a': '#4fb8d0', '#5eb85e': '#3a9fba', '#effac8': '#f2fdff' },
  },

  turtle: {
    body: { w: 0.4, h: 0.3, d: 0.44, y: 0.3, color: '#6dbd72', lo: true },
    legs: { type: 'stub', h: 0.14, r: 0.09, color: '#b3dc86', x: 0.62, z: 0.52 },
    head: { r: 0.2, w: 1, h: 0.95, d: 1.05, y: 0.28, z: 0.52, color: '#b3dc86', lo: true },
    neck: { r: 0.11, color: '#b3dc86', z: 0.85 },
    eyes: { s: 0.17, gap: 0.5, el: 0.12 },
    blush: '#ff9fa8',
    snout: { type: 'nose', color: '#7a8a4a', s: 0.05, el: -0.3 },
    tail: { type: 'puff', s: 0.055, lo: true, y: -0.35, z: 1.0, color: '#b3dc86' },
    extras: [
      { t: 'spots', color: '#a2dd8e', th: 0.15, list: [
        { on: 'body', az: 0, el: 1.2, s: 0.55 }, { on: 'body', az: 0.9, el: 0.75, s: 0.5 }, { on: 'body', az: -0.9, el: 0.75, s: 0.5 },
        { on: 'body', az: 2.1, el: 0.75, s: 0.5 }, { on: 'body', az: -2.1, el: 0.75, s: 0.5 }, { on: 'body', az: 3.14, el: 1.0, s: 0.45 },
      ] },
      { t: 'blobs', color: '#f0e2a8', list: [{ g: 'ring', p: [0, 0.2, 0], s: [0.37, 0.4, 0.34], r: [Math.PI / 2, 0, 0] }] },
    ],
    shinyPalette: { '#6dbd72': '#59c4c0', '#a2dd8e': '#a8ece4', '#b3dc86': '#c2e8b8', '#f0e2a8': '#fff4cf' },
  },

  otter: {
    body: { w: 0.3, h: 0.25, d: 0.5, y: 0.3, color: '#a0724c', lo: true, belly: { color: '#f3dec3', s: 0.78, dz: 0.18, dy: -0.15, lo: true } },
    legs: { type: 'stub', h: 0.1, r: 0.07, color: '#8c6140', x: 0.6, z: 0.55 },
    head: { r: 0.26, w: 1.1, h: 0.95, d: 1.0, y: 0.5, z: 0.36 },
    eyes: { s: 0.11, gap: 0.5, el: 0.15 },
    blush: '#ff9a8a',
    ears: { type: 'round', s: 0.36, az: 0.95, el: 0.5, up: 0.15, color: '#8c6140', inner: false },
    snout: { type: 'muzzle', color: '#f3dec3', w: 0.52, h: 0.38, d: 0.4, el: -0.3, nose: '#3a2a2e', noseS: 0.13, noseY: 0.55, lo: true },
    tail: { type: 'long', n: 4, len: 0.8, r: 0.12, taper: 0.12, lift: 0.25, curve: 0.3, y: 0.0, z: 0.9, color: '#8c6140' },
    extras: [
      { t: 'whiskers', color: '#ffffff', len: 0.42, n: 2 },
      { t: 'blobs', color: '#ffd9e6', list: [{ g: 'sphP', p: [0, 0.3, 0.43], s: [0.07, 0.055, 0.06] }] },
      { t: 'blobs', color: '#8c6140', list: [{ g: 'sphP', p: [0.085, 0.29, 0.4], s: 0.06, mirror: true }] },
    ],
    shinyPalette: { '#a0724c': '#8ab8c8', '#8c6140': '#6a9aaa', '#f3dec3': '#f6fbff', '#ffd9e6': '#ffe9a8' },
  },

  dolphin: {
    body: { w: 0.3, h: 0.3, d: 0.36, y: 0.74, color: '#74abea', belly: { color: '#f2f9ff', s: 0.84, dz: 0.12, dy: -0.3, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.27, w: 1.0, h: 0.98, d: 1.0, y: 0.78, z: 0.36 },
    eyes: { s: 0.12, gap: 0.62, el: 0.08 },
    blush: '#ff9ab8',
    ears: { type: 'fin', s: 1.5, az: 1.45, el: -0.5, color: '#5b94d8', dir: [0.9, -0.45, -0.5], wd: 0.38 },
    snout: { type: 'pointy', color: '#8ab9f0', w: 0.26, h: 0.2, d: 0.55, el: -0.28, nose: '#3a4a6a' },
    tail: { type: 'fluke', s: 0.32, len: 0.2, rot: 0.55, y: 0.0, z: 0.9, color: '#74abea', lobe: '#5b94d8' },
    extras: [
      { t: 'smile', color: '#3a4a6a', w: 0.09, el: -0.5, az: 0.4, tilt: 0.45 },
      { t: 'blobs', color: '#5b94d8', list: [{ g: 'cone', p: [0, 0.98, -0.02], s: [0.04, 0.2, 0.17], dir: [0, 1, -0.7] }] },
    ],
    bubble: { r: 0.6, pitch: 0.25 },
    shinyPalette: { '#74abea': '#ffa8c8', '#5b94d8': '#f08aae', '#8ab9f0': '#ffc4d8', '#f2f9ff': '#fff6fb' },
  },

  shark: {
    body: { w: 0.3, h: 0.29, d: 0.4, y: 0.74, color: '#8aa8cc', belly: { color: '#f4f8fc', s: 0.84, dz: 0.12, dy: -0.32, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.29, w: 1.0, h: 0.95, d: 1.05, y: 0.76, z: 0.34 },
    eyes: { s: 0.1, gap: 0.62, el: 0.12 },
    blush: '#ff9ab0',
    ears: { type: 'fin', s: 1.6, az: 1.45, el: -0.5, color: '#7898be', dir: [1, -0.4, -0.55], wd: 0.4 },
    snout: { type: 'nose', color: '#5a6a88', s: 0.05, el: 0.1 },
    tail: { type: 'fin', s: 0.5, len: 0.16, up: 1.5, y: 0.1, z: 0.92, color: '#8aa8cc', lobe: '#7898be' },
    extras: [
      { t: 'smile', color: '#3a4a6a', w: 0.16, el: -0.4, az: 0.34, tilt: 0.3 },
      { t: 'blobs', on: 'head', color: '#ffffff', list: [
        { g: 'coneP', p: [0.045, -0.115, 0.27], s: [0.022, 0.05, 0.022], dir: [0, -1, 0], mirror: true },
        { g: 'coneP', p: [0.12, -0.12, 0.24], s: [0.022, 0.05, 0.022], dir: [0, -1, 0], mirror: true },
      ] },
      { t: 'blobs', color: '#7898be', list: [
        { g: 'cone', p: [0, 1.0, 0.0], s: [0.035, 0.3, 0.26], dir: [0, 1, -0.75] },
        { p: [0, 0.8, -0.35], s: [0.02, 0.07, 0.1], dir: [0, 1, -1], g: 'cone' },
      ] },
      { t: 'blobs', color: '#6a88ae', list: [
        { g: 'sphP', p: [0.275, 0.76, 0.12], s: [0.01, 0.07, 0.016], r: [0, 0, 0.1], mirror: true },
        { g: 'sphP', p: [0.28, 0.76, 0.17], s: [0.01, 0.07, 0.016], r: [0, 0, 0.1], mirror: true },
        { g: 'sphP', p: [0.28, 0.76, 0.22], s: [0.01, 0.07, 0.016], r: [0, 0, 0.1], mirror: true },
      ] },
    ],
    bubble: { r: 0.6, pitch: 0.25 },
    shinyPalette: { '#8aa8cc': '#c4a4e8', '#7898be': '#a888d8', '#6a88ae': '#8a6ac0', '#f4f8fc': '#fdf6ff' },
  },

  // ───────── V10 §4: sky friends (น้องฟ้า) ─────────
  // Chibi birds: wings are the wingL / wingR pivots (B flaps them), the tail is the `tail` pivot, head / anchor as always. Common/uncommon <= 1.2k tris + 6 calls, rare/epic <= 1.6k + 7.
  // The bat's membrane wings, the owl's head (turns on tap), the peacock's whole fan (the `tail` pivot: rotate .x upright + scale to open) and the flamingo's hip pivots legL / legR
  // (rotate .x > 0 to fold a foot back and up; the flamingo has no tail pivot, that keeps it at 7 calls) are the special moves B drives.

  sparrow: {
    size: 0.9,
    body: { w: 0.3, h: 0.27, d: 0.32, color: '#b98a5e', lo: true, belly: { color: '#f2e6d0', s: 0.82, dz: 0.24, lo: true } },
    legs: { type: 'bird', h: 0.11, r: 0.02, color: '#e0a878', x: 0.3 },
    head: { r: 0.25, w: 1.08, h: 0.98, y: 0.52, z: 0.1, color: '#b98a5e', lo: true },
    eyes: { s: 0.13, gap: 0.55, el: 0.12 },
    snout: { type: 'beak', color: '#e8a050', w: 0.24, len: 0.4, el: -0.1 },
    tail: { type: 'fluffy', w: 0.1, h: 0.035, d: 0.2, dz: 0.14, dy: 0.04, rot: 0.3, color: '#8a5a34', z: 0.9 },
    extras: [
      { t: 'cheeks', color: '#ece0c8', s: 0.36, lo: true },
      { t: 'blobs', on: 'head', color: '#4a3a34', list: [{ g: 'sphL', p: [0, -0.13, 0.2], s: [0.075, 0.05, 0.05] }] },
      { t: 'blobs', on: 'head', color: '#8a5a34', list: [{ g: 'sphL', p: [0, 0.2, 0.0], s: [0.2, 0.08, 0.2] }] },
      { t: 'wings', color: '#8a5a34', s: 0.3, x: 0.98, y: 0.4, d: 0.7, rest: 0.04, h: 0.62, back: 0.3 },
    ],
    shinyPalette: { '#b98a5e': '#7fb4e8', '#f2e6d0': '#fff4d8', '#8a5a34': '#4f7fc2', '#e0a878': '#ffc27a', '#ece0c8': '#fffaf0' },
  },

  dove: {
    size: 0.95,
    body: { w: 0.33, h: 0.3, d: 0.34, color: '#f0eef2', lo: true, belly: { color: '#fffefa', s: 0.84, dz: 0.24, lo: true } },
    legs: { type: 'bird', h: 0.1, r: 0.02, color: '#f08a8a', x: 0.3 },
    head: { r: 0.22, w: 1.05, h: 1, y: 0.54, z: 0.14, color: '#f0eef2', lo: true },
    eyes: { s: 0.13, gap: 0.56, el: 0.1 },
    snout: { type: 'beak', color: '#f3a8a8', w: 0.22, len: 0.36, el: -0.08 },
    tail: { type: 'fluffy', w: 0.16, h: 0.04, d: 0.26, dz: 0.18, dy: 0.04, rot: 0.22, color: '#d9d4e2', z: 0.9 },
    extras: [
      { t: 'blobs', color: '#c9c2d8', list: [{ g: 'sphL', p: [0, 0.38, 0.1], s: [0.22, 0.07, 0.17] }] },
      { t: 'puffs', color: '#fffefa', list: [['body', 0, 0.3, 0.28, 0.1], ['body', 0.09, 0.26, 0.27, 0.07], ['body', -0.09, 0.26, 0.27, 0.07]] },
      { t: 'wings', color: '#dcd7e6', s: 0.34, x: 0.98, y: 0.42, d: 0.72, rest: 0.04, h: 0.62, back: 0.3 },
    ],
    shinyPalette: { '#f0eef2': '#fff0c8', '#fffefa': '#fffdf2', '#d9d4e2': '#ffd36a', '#dcd7e6': '#ffe08a', '#c9c2d8': '#ffe9a8', '#f08a8a': '#ffb070' },
  },

  canary: {
    size: 0.9,
    body: { w: 0.3, h: 0.27, d: 0.3, color: '#ffd93a', lo: true, belly: { color: '#fff1a6', s: 0.82, dz: 0.24, lo: true } },
    legs: { type: 'bird', h: 0.1, r: 0.019, color: '#f0a860', x: 0.3 },
    head: { r: 0.25, w: 1.05, h: 1, y: 0.5, z: 0.1, color: '#ffd93a', lo: true },
    eyes: { s: 0.13, gap: 0.55, el: 0.12 },
    snout: { type: 'beak', color: '#f59a3a', w: 0.24, len: 0.4, el: -0.1 },
    tail: { type: 'fluffy', w: 0.1, h: 0.035, d: 0.22, dz: 0.15, dy: 0.04, rot: 0.3, color: '#f2b81c', z: 0.9 },
    extras: [
      { t: 'tuft', color: '#ffe46a', s: 0.4 },
      { t: 'cheeks', color: '#ffe46a', s: 0.34, lo: true },
      { t: 'wings', color: '#f2b81c', s: 0.3, x: 0.98, y: 0.4, d: 0.7, rest: 0.04, h: 0.62, back: 0.3 },
    ],
    shinyPalette: { '#ffd93a': '#ff9ec4', '#fff1a6': '#ffe2ee', '#f2b81c': '#f07aa8', '#ffe46a': '#ffc4dc', '#f59a3a': '#ffd23a' },
  },

  tit: {
    size: 0.85,
    body: { w: 0.28, h: 0.26, d: 0.3, color: '#6f9bd6', lo: true, belly: { color: '#ffe27a', s: 0.84, dz: 0.24, lo: true } },
    legs: { type: 'bird', h: 0.1, r: 0.018, color: '#8a98b8', x: 0.3 },
    head: { r: 0.26, w: 1.05, h: 0.98, y: 0.5, z: 0.1, color: '#fffdf4', lo: true },
    eyes: { s: 0.13, gap: 0.55, el: 0.08 },
    snout: { type: 'beak', color: '#3a3a44', w: 0.2, len: 0.32, el: -0.1 },
    tail: { type: 'fluffy', w: 0.08, h: 0.03, d: 0.2, dz: 0.14, dy: 0.04, rot: 0.3, color: '#5a86c8', z: 0.9 },
    extras: [
      { t: 'blobs', on: 'head', color: '#4f86d6', list: [{ g: 'hood', p: [0, 0.07, -0.02], s: [0.268, 0.2, 0.268] }] },
      { t: 'blobs', on: 'head', color: '#2f3448', list: [{ g: 'sphL', p: [0, -0.15, 0.2], s: [0.06, 0.045, 0.04] }] },
      { t: 'wings', color: '#5a86c8', s: 0.28, x: 0.98, y: 0.4, d: 0.7, rest: 0.04, h: 0.62, back: 0.3 },
    ],
    shinyPalette: { '#6f9bd6': '#ff9ec0', '#ffe27a': '#fff2b8', '#4f86d6': '#e0609a', '#5a86c8': '#d4508c', '#fffdf4': '#fff8fb' },
  },

  hatchling: {
    size: 0.9,
    body: { w: 0.27, h: 0.25, d: 0.27, y: 0.55, color: '#ffe26a', lo: true, belly: { color: '#fff4b0', s: 0.8, dz: 0.24, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.25, w: 1.05, h: 1, y: 0.8, z: 0.06, color: '#ffe26a', lo: true },
    eyes: { s: 0.15, gap: 0.55, el: 0.1 },
    snout: { type: 'beak', color: '#f5a23a', w: 0.22, len: 0.34, el: -0.1 },
    tail: { type: 'fluffy', w: 0.07, h: 0.07, d: 0.07, dz: 0.05, dy: 0.0, rot: 0, color: '#ffe26a', z: 0.8, y: 0.2 },
    extras: [
      { t: 'tuft', color: '#fff0a0', s: 0.4 },
      { t: 'wings', color: '#ffd24a', s: 0.2, x: 1.0, y: 0.5, d: 0.6, rest: 0.04, h: 0.62, back: 0.3 },
      // the lower half of the eggshell: a bowl with a zig-zag rim and pastel speckles
      { t: 'blobs', color: '#fff6e6', list: [{ g: 'hood', p: [0, 0.44, 0], s: [0.4, 0.44, 0.4], r: [Math.PI, 0, 0] }] },
      { t: 'blobs', color: '#fff6e6', list: Array.from({ length: 9 }, (_, i) => {
        const a = i / 9 * Math.PI * 2, h = i % 2 ? 0.1 : 0.17;
        return { g: 'coneP', p: [Math.sin(a) * 0.37, 0.52, Math.cos(a) * 0.37], s: [0.075, h, 0.05], dir: [Math.sin(a) * 0.25, 1, Math.cos(a) * 0.25] };
      }) },
      { t: 'blobs', color: '#bfe3f0', list: [{ g: 'sphP', p: [0.3, 0.3, 0.24], s: 0.05 }, { g: 'sphP', p: [-0.2, 0.22, 0.31], s: 0.045 }, { g: 'sphP', p: [0.05, 0.14, 0.37], s: 0.05 }, { g: 'sphP', p: [-0.33, 0.34, 0.1], s: 0.045 }] },
    ],
    shinyPalette: { '#ffe26a': '#9be8c8', '#fff4b0': '#e4fff2', '#ffd24a': '#6fd4b0', '#fff0a0': '#d0fae4', '#fff6e6': '#ffe0f2', '#bfe3f0': '#ffb0d8' },
  },

  parrot: {
    body: { w: 0.33, h: 0.32, d: 0.32, color: '#e23d3a', lo: true },
    legs: { type: 'bird', h: 0.12, r: 0.022, color: '#8a8a94', x: 0.3 },
    head: { r: 0.26, w: 1.04, h: 1, y: 0.6, z: 0.12, color: '#e23d3a', lo: true },
    eyes: { s: 0.14, gap: 0.55, el: 0.08, ring: '#fffef0' },
    snout: { type: 'none' },
    tail: { type: 'long', n: 3, len: 0.66, r: 0.055, blob: 1.7, taper: 0.06, lift: -0.2, curve: 0.1, y: 0.15, z: 1.0, colors: ['#e23d3a', '#2f7bd9', '#f2c230'] },
    extras: [
      { t: 'blobs', on: 'head', color: '#f5efe0', list: [{ g: 'sphM', p: [0, -0.07, 0.25], s: [0.1, 0.11, 0.1] }] },
      { t: 'blobs', on: 'head', color: '#3a3436', list: [{ g: 'sphL', p: [0, -0.14, 0.3], s: [0.05, 0.065, 0.05] }] },
      { t: 'wings', color: '#2f7bd9', s: 0.38, x: 0.98, y: 0.42, d: 0.7, rest: 0.04, h: 0.62, back: 0.3 },
      { t: 'tuft', color: '#ff6a58', s: 0.34 },
    ],
    shinyPalette: { '#e23d3a': '#38c8a0', '#f2654f': '#7fe6c0', '#2f7bd9': '#8a5ae0', '#f2c230': '#ffe66a', '#ff6a58': '#6fe0b8' },
  },

  bat: {
    body: { w: 0.28, h: 0.27, d: 0.3, color: '#6c5b93', lo: true, belly: { color: '#bdb0dc', s: 0.82, dz: 0.24, lo: true } },
    legs: { type: 'stub', h: 0.1, r: 0.055, color: '#54447a' },
    head: { r: 0.29, w: 1.1, h: 0.95, y: 0.58, z: 0.1, color: '#6c5b93', lo: true },
    eyes: { s: 0.17, gap: 0.5, el: 0.15 },
    blush: '#ff9ab8',
    ears: { type: 'cat', s: 0.85, az: 0.7, el: 0.7, up: 0.7, flare: 0.1, color: '#54447a', inner: '#ffb0cc', static: true },
    snout: { type: 'nose', color: '#ff8fa8', s: 0.07, el: -0.15 },
    tail: { type: 'puff', s: 0.05, y: 0.1, lo: true, color: '#54447a' },
    extras: [
      { t: 'blobs', on: 'head', color: '#ffffff', list: [{ g: 'coneP', p: [0.055, -0.14, 0.24], s: [0.018, 0.045, 0.018], dir: [0, -1, 0], mirror: true }] },
      { t: 'batwings', color: '#54447a', bone: '#3a2f55', s: 0.62, x: 0.7, y: 0.6, z: 0.0, rest: -0.1, sweep: 0.5, arm: 0.5, armDir: [1, 0.15, -0.1] },
    ],
    shinyPalette: { '#6c5b93': '#ff9ac8', '#bdb0dc': '#ffe0f0', '#54447a': '#d4609e', '#3a2f55': '#a83e7c', '#ffb0cc': '#fff0a8' },
  },

  swan: {
    body: { w: 0.4, h: 0.3, d: 0.54, color: '#fbfaff', belly: { color: '#fefefe', s: 0.84, dz: 0.2, lo: true } },
    legs: { type: 'webbed', h: 0.09, r: 0.022, color: '#f08a2a', x: 0.32 },
    head: { r: 0.2, w: 1.0, h: 1, y: 1.1, z: 0.46, color: '#fbfaff', lo: true },
    eyes: { s: 0.13, gap: 0.56, el: 0.1 },
    snout: { type: 'beak', color: '#f3892a', w: 0.42, len: 0.9, el: -0.12 },
    tail: { type: 'fluffy', w: 0.15, h: 0.07, d: 0.17, dz: 0.12, dy: 0.05, rot: 0.35, color: '#f4f4fa', z: 0.9, y: 0.4 },
    extras: [
      // S-curved neck: two tilted tapered cylinders + a ball joint, rising out of the chest
      { t: 'blobs', color: '#fbfaff', list: [
        { g: 'cylT', p: [0, 0.42, 0.3], s: [0.09, 0.33, 0.09], dir: [0, 0.29, 0.17] },
        { g: 'sphL', p: [0, 0.71, 0.47], s: 0.098 },
        { g: 'cylT', p: [0, 0.71, 0.47], s: [0.085, 0.27, 0.085], dir: [0, 0.25, -0.05] },
      ] },
      { t: 'blobs', on: 'head', color: '#2a2630', list: [{ g: 'sphL', p: [0, -0.01, 0.17], s: [0.08, 0.055, 0.05] }] },
      { t: 'wings', color: '#f2f2f8', s: 0.4, x: 0.98, y: 0.4, d: 1.0, rest: 0.02, h: 0.55, back: 0.3 },
    ],
    shinyPalette: { '#fbfaff': '#2a2a38', '#fefefe': '#4a4a62', '#f4f4fa': '#1c1c28', '#f2f2f8': '#3a3a52', '#f3892a': '#ff5a5a', '#f08a2a': '#ff5a5a', '#2a2630': '#ffd34a' },
  },

  owl: {
    body: { w: 0.38, h: 0.38, d: 0.34, color: '#9b7653', belly: { color: '#ead7b5', s: 0.82, dz: 0.26, lo: true } },
    legs: { type: 'bird', h: 0.12, r: 0.026, color: '#f0b030', x: 0.3 },
    head: { r: 0.31, w: 1.16, h: 0.92, y: 0.78, z: 0.08, color: '#9b7653', lo: true },
    eyes: { s: 0.2, gap: 0.5, el: 0.08, ring: '#fff3cc' },
    blush: '#ffb08a',
    ears: { type: 'cat', s: 0.62, az: 0.7, el: 0.85, up: 0.8, flare: 0.25, color: '#7d5b3d', inner: false, static: true },
    snout: { type: 'beak', color: '#f2b630', w: 0.26, len: 0.5, el: -0.12 },
    tail: { type: 'fluffy', w: 0.12, h: 0.04, d: 0.2, dz: 0.13, dy: 0.02, rot: 0.15, color: '#7d5b3d', z: 0.9, y: 0.1 },
    extras: [
      { t: 'mask', color: '#f1e1c0', rx: 0.8, ry: 0.5, rz: 0.55, y: 0.0, z: 0.36 },   // pale facial disc (one wide ellipsoid, the eyes sit on it)
      { t: 'spots', color: '#b58d62', th: 0.3, list: [
        { on: 'body', az: 0.0, el: 0.15, s: 0.16 }, { on: 'body', az: 0.34, el: 0.05, s: 0.16 }, { on: 'body', az: -0.34, el: 0.05, s: 0.16 },
        { on: 'body', az: 0.17, el: -0.28, s: 0.15 }, { on: 'body', az: -0.17, el: -0.28, s: 0.15 },
      ] },
      { t: 'wings', color: '#7d5b3d', s: 0.4, x: 0.98, y: 0.5, d: 0.75, rest: 0.04, h: 0.62, back: 0.3 },
    ],
    shinyPalette: { '#9b7653': '#7a9ad8', '#ead7b5': '#f4ecff', '#7d5b3d': '#4f66b8', '#f1e1c0': '#fff4d8', '#b58d62': '#a8b8f0', '#f0b030': '#ffd34a' },
  },

  flamingo: {
    size: 0.9,
    body: { w: 0.3, h: 0.27, d: 0.36, y: 0.66, color: '#ff8fb0', lo: true, belly: { color: '#ffb3c9', s: 0.82, dz: 0.22, lo: true } },
    legs: { type: 'none' },
    head: { r: 0.17, w: 1.05, h: 1, y: 1.5, z: 0.42, color: '#ff8fb0', lo: true },
    eyes: { s: 0.15, gap: 0.55, el: 0.14 },
    snout: { type: 'beak', color: '#f7c3b4', w: 0.5, len: 1.0, el: -0.16 },
    extras: [
      { t: 'pivotlegs', color: '#ff7f9f', foot: '#ff6f90', r: 0.024, x: 0.4, y: 0.5 },
      // S-curved neck (thin): out of the chest, forward-up, then back-up under the head
      { t: 'blobs', color: '#ff8fb0', list: [
        { g: 'cylT', p: [0, 0.74, 0.28], s: [0.058, 0.34, 0.058], dir: [0, 0.3, 0.14] },
        { g: 'sphL', p: [0, 1.04, 0.42], s: 0.066 },
        { g: 'cylT', p: [0, 1.04, 0.42], s: [0.055, 0.34, 0.055], dir: [0, 0.3, -0.08] },
      ] },
      { t: 'blobs', on: 'head', color: '#2a2630', list: [{ g: 'sphL', p: [0, -0.09, 0.22], s: [0.065, 0.05, 0.075] }] },
      { t: 'blobs', color: '#ff8fb0', list: [{ g: 'sphL', p: [0, 0.76, -0.3], s: [0.1, 0.09, 0.14] }] },   // static tail tuft
      { t: 'wings', color: '#ff7a9c', s: 0.4, x: 0.98, y: 0.4, d: 0.8, rest: 0.04, h: 0.62, back: 0.3 },
    ],
    shinyPalette: { '#ff8fb0': '#ffd24a', '#ffb3c9': '#fff0a8', '#ff7a9c': '#f0a820', '#ff7f9f': '#ffb838', '#ff6f90': '#e8a020', '#f7c3b4': '#ffe6b0' },
  },

  peacock: {
    body: { w: 0.34, h: 0.3, d: 0.4, color: '#2a8fb0', lo: true, belly: { color: '#4fc0c8', s: 0.82, dz: 0.26, lo: true } },
    legs: { type: 'bird', h: 0.14, r: 0.026, color: '#c9a05a', x: 0.32 },
    neck: { r: 0.09, top: 0.85, z: 0.55, color: '#2a74c8' },
    head: { r: 0.2, w: 1, h: 1, y: 0.88, z: 0.3, color: '#2a74c8', lo: true },
    eyes: { s: 0.14, gap: 0.56, el: 0.1 },
    blush: '#9ad8ff',
    snout: { type: 'beak', color: '#e8c070', w: 0.32, len: 0.6, el: -0.12 },
    extras: [
      { t: 'mask', color: '#fffdf4', rx: 0.42, ry: 0.28, rz: 0.4, y: 0.12, z: 0.5 },   // white cheek patch
      { t: 'blobs', on: 'head', color: '#2a74c8', list: [
        { g: 'thin', p: [0, 0.18, 0.0], s: [0.012, 0.16, 0.012], dir: [0, 1, -0.1] },
        { g: 'thin', p: [0.04, 0.18, 0.0], s: [0.012, 0.15, 0.012], dir: [0.3, 1, -0.1] },
        { g: 'thin', p: [-0.04, 0.18, 0.0], s: [0.012, 0.15, 0.012], dir: [-0.3, 1, -0.1] },
        { g: 'sphP', p: [0, 0.35, -0.02], s: 0.035 },
        { g: 'sphP', p: [0.09, 0.33, -0.04], s: 0.03 },
        { g: 'sphP', p: [-0.09, 0.33, -0.04], s: 0.03 },
      ] },
      { t: 'wings', color: '#3aa88a', s: 0.34, x: 0.98, y: 0.4, d: 0.75, rest: 0.04, h: 0.62, back: 0.3 },
      { t: 'fan', name: 'tail', colors: ['#2f9a78', '#3aa88a'], eye: ['#2a5fc9', '#e8b84a'], n: 9, s: 0.5, spread: 0.3, lean: 1.0, y: 0.15, z: 0.85, wd: 0.2, eyeY: 1.45 },
    ],
    shinyPalette: { '#2a8fb0': '#d4a42a', '#4fc0c8': '#ffe08a', '#2a74c8': '#e0802a', '#3aa88a': '#e8c050', '#2f9a78': '#c8902a', '#2a5fc9': '#a84ad8', '#e8b84a': '#fff4b0', '#9ad8ff': '#ffd9a0', '#c9a05a': '#a8683a' },
  },

  // ───────── V11 §5: bug friends (น้องแมลง) ─────────
  // Chibi insects, big eyes, pastel and friendly (the cockroach and mosquito are round and soft on purpose). Budgets: common/uncommon <= 1.0k tris + 6 calls, rare/epic <= 1.6k + 7.
  // ROTATION SIGNS for B (petBehaviour). Every pivot below keeps its rest pose in its own rotation, so ADD to it (rotation.z = rest + flap), never overwrite it. Left = +x, right = -x, the pet faces +z.
  //   wingL / wingR   bee, butterfly, fly, mosquito (flat wing blades pointing sideways, hinged at the shoulders) and ladybug, cockroach, cricket (shell halves hinged at the front of the back):
  //                   wingL.rotation.z += a together with wingR.rotation.z -= a (a > 0) RAISES the wing tips / opens the shells; a < 0 lowers them. Mirror signs, never the same sign on both.
  //                   Flap = rest + sin(t) * amp on L and -(rest + sin(t) * amp) on R (the ladybug / cockroach open to ~0.9 for a short flight; the cricket rubs its wings with a small +-0.12 shiver).
  //   tail            bee stinger, caterpillar + earthworm rear segments (the pivot sits at the rear, the tip points back): rotation.x = +v RAISES the tip, -v drops it;
  //                   rotation.y = +v swings the tip to the pet's RIGHT (-x), -v to its LEFT (+x). Wriggle = sin(t) * 0.35 on rotation.y.
  //                   scorpion tail (a segmented arch over the back): rotation.x += v curls it FURTHER FORWARD over the head (+0.4 = tighter coil), rotation.x -= v uncurls it back
  //                   (-0.5 lays it flat behind the body); rotation.y = +v swings the stinger to the pet's LEFT (+x). There is no tailTip on the bugs.
  //   earL / earR     ant, caterpillar, cockroach, mosquito antennae and the snail eyestalks: rotation.x = +v tips them FORWARD and down, -v back and up;
  //                   rotation.z = +v on earL (and -v on earR) pulls them INWARD together, -v on earL (+v on earR) spreads them apart.
  //                   scorpion claws: rotation.x = +v lowers the claw tip DOWN, -v LIFTS it up (raise / snap); rotation.z = +v on earL (-v on earR) swings the claw INWARD to the face.
  //   legL / legR     spider only (four bent legs per side on a hip pivot at the body centre): legL.rotation.z = +a together with legR.rotation.z = -a lifts the feet (a wave / a skitter);
  //                   rotation.x = +v swings that side's feet BACKWARD, -v forward.
  //   shell           snail spiral (rotation.x = +v tips the shell forward over the head (a hide); rotation.z wobbles it); the head, earL and earR can be scaled / pulled in by B to hide.
  //   head / body / eyes / anchor  as always (eyes.scale.y = blink, body.scale squash). Flyers (bee, butterfly, fly, mosquito) have tiny feet only so they stand at y = 0; B lifts root.y to hover.
  //   Static (no pivot, nothing to animate): the antennae of bee, butterfly, ladybug, cricket and fly (they ride the head), every leg except the spider's, the ant's thorax.
  // Colours are all body-like, so coats recolour the whole bug; shiny palettes are curated (gentle, never neon).

  bee: {
    body: { w: 0.3, h: 0.28, d: 0.34, y: 0.34, color: '#ffd23f', lo: 2 },
    legs: { type: 'crab', n: 3, r: 0.02, ground: true, x: 0.55, dy: 0.55, z: 0.5, color: '#5a3d2b', down: 1, out: 0.45, fan: 0.4 },
    head: { r: 0.27, w: 1.05, h: 0.98, d: 0.95, y: 0.55, z: 0.2, color: '#ffd23f', lo: true },
    eyes: { s: 0.17, gap: 0.52, el: 0.08 },
    blush: '#ff9ab0',
    extras: [
      { t: 'stripes', g: 'sphL', color: '#5a3d2b', at: [-0.45, 0.0], th: 0.12 },
      { t: 'smile', color: '#5a3d2a' },
      { t: 'blobs', on: 'head', color: '#5a3d2b', list: [
        { g: 'thin', p: [0.1, 0.2, 0.06], s: [0.014, 0.2, 0.014], dir: [0.45, 1, 0.7], mirror: true },
        { g: 'sphP', p: [0.165, 0.37, 0.17], s: 0.036, mirror: true },
      ] },
      { t: 'group', name: 'tail', p: [0, 0.34, -0.3], list: [{ g: 'coneP', c: '#5a3d2b', p: [0, -0.01, -0.02], s: [0.05, 0.15, 0.05], dir: [0, -0.15, -1] }] },
      { t: 'bugwings', color: '#e4f4ff', x: 0.25, y: 0.85, rest: 0.85, blades: [[0.34, -0.04, 0.34, 0.17, 0.3], [0.22, -0.22, 0.22, 0.11, 0.45, 0, -0.012]] },
    ],
    shinyPalette: { '#ffd23f': '#86dcff', '#5a3d2b': '#2b5fc9', '#e4f4ff': '#fff0fb' },
  },

  butterfly: {
    body: { w: 0.19, h: 0.24, d: 0.3, y: 0.36, color: '#a58ad8', lo: 2 },
    legs: { type: 'crab', n: 2, r: 0.016, ground: true, x: 0.6, dy: 0.5, z: 0.4, color: '#6f55a8', down: 1, out: 0.4, fan: 0.3 },
    head: { r: 0.25, w: 1.05, h: 0.98, d: 0.95, y: 0.55, z: 0.28, color: '#c0aaf0', lo: true },
    eyes: { s: 0.18, gap: 0.5, el: 0.06 },
    blush: '#ff9ab0',
    extras: [
      { t: 'smile', color: '#6f55a9' },
      { t: 'blobs', on: 'head', color: '#6f55a8', list: [
        { g: 'thin', p: [0.09, 0.2, 0.06], s: [0.012, 0.26, 0.012], dir: [0.35, 1, 0.55], mirror: true },
        { g: 'sphP', p: [0.17, 0.44, 0.2], s: 0.04, mirror: true },
      ] },
      { t: 'bugwings', colors: ['#ff9ad5', '#ffc4ea', '#fff2a8'], x: 0.3, y: 0.7, rest: 0.95, blades: [[0.46, 0.0, 0.46, 0.3, 0.12, 0], [0.32, -0.38, 0.3, 0.22, 0.35, 1, -0.012]],
        spots: [[0.6, -0.04, 0.08, 2], [0.38, -0.44, 0.065, 2]] },
    ],
    shinyPalette: { '#ff9ad5': '#7fc4ff', '#ffc4ea': '#bfe3ff', '#fff2a8': '#fff8d0', '#a58ad8': '#e89ac0', '#c0aaf0': '#f5b8d4' },
  },

  ladybug: {
    body: { w: 0.34, h: 0.2, d: 0.36, y: 0.2, color: '#2a2430', lo: 2 },
    legs: { type: 'crab', n: 3, r: 0.02, ground: true, x: 0.8, dy: 0.2, z: 0.6, color: '#2a2430', down: 1, out: 0.5, fan: 0.4 },
    head: { r: 0.24, w: 1.15, h: 0.92, d: 0.9, y: 0.34, z: 0.34, color: '#2a2430', lo: true },
    eyes: { s: 0.19, gap: 0.5, el: 0.1, ring: '#ffffff' },
    blush: '#ff8fa3',
    extras: [
      { t: 'blobs', on: 'head', color: '#2a2430', list: [
        { g: 'thin', p: [0.08, 0.18, 0.08], s: [0.012, 0.2, 0.012], dir: [0.4, 1, 0.8], mirror: true },
        { g: 'sphP', p: [0.15, 0.36, 0.22], s: 0.032, mirror: true },
      ] },
      { t: 'blobs', on: 'head', color: '#fffdf4', list: [{ g: 'sphL', p: [0, -0.1, 0.19], s: [0.13, 0.07, 0.07] }] },
      { t: 'elytra', color: '#f0453a', spot: '#2a2430', y: 0.95, z: 0.5, w: 0.62, h: 1.55, d: 1.05, dy: 0.2, dz: 0.55,
        spots: [[0.8, 0.45, 0.2], [1.6, 0.0, 0.17]] },
    ],
    shinyPalette: { '#fffdf4': '#fff2a8', '#f0453a': '#ffc23a', '#2a2430': '#7a4fd1' },
  },

  ant: {
    dz: -0.33,
    body: { w: 0.27, h: 0.27, d: 0.3, y: 0.3, color: '#c4523a', lo: true },
    legs: { type: 'crab', n: 3, r: 0.02, ground: true, x: 0.5, dy: 0.5, z: 1.0, color: '#7a3a2a', down: 1, out: 0.5, fan: 0.5 },
    head: { r: 0.27, w: 1.1, h: 0.95, d: 0.95, y: 0.42, z: 0.78, color: '#e8744f', lo: true },
    eyes: { s: 0.18, gap: 0.52, el: 0.08 },
    blush: '#ff9ab0',
    ears: { type: 'feeler', s: 1.0, az: 0.42, el: 0.85, color: '#7a3a2a', inner: '#7a3a2a', len: 1.3, dir: [0.3, 1, 0.45], bend: 0.9, r: 0.05, split: 0.5 },
    extras: [
      { t: 'smile', color: '#7a3a2b' },
      { t: 'blobs', color: '#e8744f', list: [{ g: 'sphL', p: [0, 0.34, 0.46], s: [0.12, 0.12, 0.14] }] },
      { t: 'blobs', on: 'head', color: '#fff0d8', list: [{ g: 'coneP', p: [0.05, -0.17, 0.2], s: [0.03, 0.09, 0.03], dir: [0.5, -0.4, 1], mirror: true }] },
    ],
    shinyPalette: { '#c4523a': '#6b8fe0', '#e8744f': '#9bb8f5', '#7a3a2a': '#2e3f8f', '#fff0d8': '#ffffff' },
  },

  caterpillar: {
    dz: -0.12,
    body: { w: 0.27, h: 0.26, d: 0.27, y: 0.3, color: '#8fdc5e', lo: true },
    legs: { type: 'none' },
    head: { r: 0.27, w: 1.05, h: 1, d: 0.95, y: 0.36, z: 0.4, color: '#c8f08a', lo: true },
    eyes: { s: 0.18, gap: 0.5, el: 0.06 },
    blush: '#ff9ab0',
    ears: { type: 'feeler', s: 1.0, az: 0.42, el: 0.95, color: '#ff8fa8', inner: '#ff8fa8', len: 1.0, dir: [0.3, 1, 0.3], bend: 0.7, r: 0.06, ball: 3 },
    extras: [
      { t: 'smile', color: '#5a8a3b' },
      { t: 'blobs', color: '#ff9ab0', list: [{ g: 'sphP', p: [0, 0.56, 0.0], s: 0.05 }, { g: 'sphP', p: [0, 0.5, -0.4], s: 0.045 }] },
      { t: 'group', name: 'tail', p: [0, 0.28, -0.26], list: [
        { g: 'sphM', c: '#c8f08a', p: [0, -0.01, -0.2], s: [0.25, 0.24, 0.22] },
        { g: 'sphL', c: '#8fdc5e', p: [0, -0.03, -0.43], s: [0.2, 0.19, 0.19] },
        { g: 'sphL', c: '#c8f08a', p: [0, -0.06, -0.6], s: [0.14, 0.14, 0.14] },
      ] },
    ],
    shinyPalette: { '#8fdc5e': '#ffb347', '#c8f08a': '#ffe0a0', '#ff8fa8': '#7ad8ff', '#ff9ab0': '#7ad8ff', '#5a8a3a': '#a85d24' },
  },

  earthworm: {
    dz: -0.08,
    body: { w: 0.18, h: 0.16, d: 0.22, y: 0.17, color: '#ffa8b8', lo: true },
    legs: { type: 'none' },
    head: { r: 0.24, w: 1, h: 1, d: 0.95, y: 0.3, z: 0.34, color: '#ffa8b8', lo: true },
    eyes: { s: 0.19, gap: 0.5, el: 0.1 },
    blush: '#ff7a9a',
    extras: [
      { t: 'smile', color: '#c85a79' },
      { t: 'blobs', color: '#ffc4cf', list: [{ g: 'sphL', p: [0, 0.18, 0.14], s: [0.2, 0.18, 0.1] }] },
      { t: 'group', name: 'tail', p: [0, 0.17, -0.2], list: [
        { g: 'sphM', c: '#ff95a8', p: [0.04, 0, -0.1], s: [0.17, 0.155, 0.14] },
        { g: 'sphL', c: '#ffa8b8', p: [0.1, 0, -0.27], s: [0.15, 0.14, 0.13] },
        { g: 'sphL', c: '#ff95a8', p: [0.15, 0, -0.43], s: [0.13, 0.12, 0.12] },
        { g: 'sphL', c: '#ffa8b8', p: [0.16, 0.0, -0.57], s: [0.1, 0.1, 0.1] },
        { g: 'sphP', c: '#ff95a8', p: [0.13, 0.03, -0.69], s: [0.07, 0.07, 0.08] },
      ] },
    ],
    shinyPalette: { '#ffa8b8': '#c8a8ff', '#ff95a8': '#b090f0', '#ffc4cf': '#e6d6ff', '#ff7a9a': '#ff9ad5', '#c85a78': '#7a56b8' },
  },

  snail: {
    body: { w: 0.2, h: 0.12, d: 0.46, y: 0.13, color: '#f3d6a0', lo: true },
    legs: { type: 'none' },
    head: { r: 0.22, w: 1.05, h: 1, d: 0.95, y: 0.32, z: 0.4, color: '#f3d6a0', lo: true },
    eyes: { s: 0.18, gap: 0.5, el: 0.06 },
    blush: '#ff9a8a',
    ears: { type: 'arm', s: 1.0, az: 0.4, el: 0.9, color: '#f3d6a0', inner: '#f3d6a0', dir: [0.3, 1, 0.3], r: 0.1, len: 1.2, club: 2.2 },
    extras: [
      { t: 'smile', color: '#b0703f' },
      { t: 'blobs', color: '#f3d6a0', list: [{ g: 'sphL', p: [0, 0.22, 0.28], s: [0.15, 0.14, 0.16] }] },
      { t: 'group', name: 'shell', p: [0, 0.3, -0.1], list: [
        { g: 'sphM', c: '#ffbd7a', p: [0, 0.06, 0], s: [0.26, 0.28, 0.29] },
        { g: 'disc', c: '#fff0c8', p: [0.152, 0.06, 0.0], s: 0.23, r: [0, Math.PI / 2, 0], mirror: true },
        { g: 'disc', c: '#ff9a5c', p: [0.208, 0.06, 0.012], s: 0.17, r: [0, Math.PI / 2, 0], mirror: true },
        { g: 'disc', c: '#fff0c8', p: [0.245, 0.06, 0.024], s: 0.11, r: [0, Math.PI / 2, 0], mirror: true },
        { g: 'disc', c: '#ff9a5c', p: [0.258, 0.06, 0.034], s: 0.05, r: [0, Math.PI / 2, 0], mirror: true },
      ] },
    ],
    shinyPalette: { '#f3d6a0': '#c8f0d0', '#ffbd7a': '#8ad8ff', '#fff0c8': '#f2fbff', '#ff9a5c': '#5aa8f0', '#b0703e': '#3f7fb8', '#ff9a8a': '#ffb0d8' },
  },

  cricket: {
    dz: -0.08,
    body: { w: 0.26, h: 0.25, d: 0.42, y: 0.4, color: '#a5d36b', lo: true },
    legs: { type: 'crab', n: 2, r: 0.024, ground: true, x: 0.55, dy: 0.5, z: 0.7, color: '#6f9a3f', down: 1, out: 0.5, fan: 0.4 },
    head: { r: 0.26, w: 1.0, h: 1.05, d: 0.95, y: 0.5, z: 0.4, color: '#b5df7a', lo: true },
    eyes: { s: 0.19, gap: 0.5, el: 0.1 },
    blush: '#ff9ab0',
    extras: [
      { t: 'smile', color: '#5a7a31' },
      { t: 'blobs', on: 'head', color: '#6f9a3f', list: [
        { g: 'thin', p: [0.08, 0.2, 0.05], s: [0.012, 0.3, 0.012], dir: [0.35, 1, 0.5], mirror: true },
        { g: 'thin', p: [0.169, 0.454, 0.177], s: [0.011, 0.3, 0.011], dir: [0.55, 0.2, -0.4], mirror: true },
      ] },
      { t: 'blobs', color: '#6f9a3f', list: [
        { g: 'sphL', p: [0.24, 0.43, -0.28], s: [0.075, 0.2, 0.09], dir: [0.1, 0.35, -0.9], mirror: true },
        { g: 'coneP', p: [0.3, 0.5, -0.5], s: [0.045, 0.52, 0.045], dir: [0.02, -1, 0.15], mirror: true },
      ] },
      { t: 'elytra', color: '#8cc356', y: 0.85, z: 0.38, w: 0.55, h: 0.6, d: 1.1, dy: 0.2, dz: 0.55, rest: 0.0 },
    ],
    shinyPalette: { '#a5d36b': '#ffd36a', '#b5df7a': '#ffe58a', '#6f9a3f': '#d49a2a', '#8cc356': '#f5b84a', '#5a7a30': '#a8681e' },
  },

  fly: {
    body: { w: 0.26, h: 0.25, d: 0.3, y: 0.34, color: '#b4d95a', lo: 2 },
    legs: { type: 'crab', n: 3, r: 0.018, ground: true, x: 0.55, dy: 0.5, z: 0.5, color: '#6f8a2a', down: 1, out: 0.4, fan: 0.4 },
    head: { r: 0.27, w: 1.1, h: 1, d: 0.9, y: 0.52, z: 0.2, color: '#ffe38a', lo: true },
    eyes: { s: 0.23, gap: 0.55, el: 0.08, ring: '#ff9aa0' },
    blush: '#ffb0a0',
    snout: { type: 'nose', color: '#c98a4a', s: 0.1, el: -0.5 },
    extras: [
      { t: 'stripes', g: 'sphL', color: '#7aa83a', at: [-0.4, 0.05], th: 0.1 },
      { t: 'bugwings', color: '#eef9ff', x: 0.25, y: 0.85, rest: 0.8, blades: [[0.36, -0.04, 0.37, 0.18, 0.35], [0.24, -0.22, 0.24, 0.11, 0.5, 0, -0.012]] },
    ],
    shinyPalette: { '#b4d95a': '#ff9ad0', '#ffe38a': '#fff0c0', '#7aa83a': '#d4609e', '#eef9ff': '#fff4fb' },
  },

  cockroach: {
    body: { w: 0.36, h: 0.27, d: 0.42, y: 0.32, color: '#e8b27c', lo: true },
    legs: { type: 'crab', n: 3, r: 0.03, ground: true, x: 0.8, dy: 0.35, z: 0.7, color: '#c98a58', down: 1, out: 0.6, fan: 0.4 },
    head: { r: 0.27, w: 1.1, h: 0.95, d: 0.92, y: 0.38, z: 0.42, color: '#f6dcbc', lo: true },
    eyes: { s: 0.2, gap: 0.5, el: 0.1, ring: '#fffaf0' },
    blush: '#ff9a8a',
    ears: { type: 'feeler', s: 1.0, az: 0.5, el: 0.75, color: '#b97e52', inner: '#b97e52', len: 2.0, dir: [0.55, 1, 0.45], bend: 0.5, r: 0.05, split: 0.5, ball: 2.0 },
    extras: [
      { t: 'smile', color: '#9a6039' },
      { t: 'blobs', color: '#f0c898', list: [{ g: 'sphM', p: [0, 0.42, 0.2], s: [0.28, 0.13, 0.14] }] },
      { t: 'elytra', color: '#d68f55', spot: '#f6dcbc', edge: '#f0c898', y: 0.9, z: 0.4, w: 0.62, h: 1.0, d: 1.0, dy: 0.25, dz: 0.5, spots: [[0.6, 0.75, 0.2], [1.0, 0.5, 0.12]], spotTh: 0.18 },
    ],
    shinyPalette: { '#e8b27c': '#b9e8c8', '#f6dcbc': '#f0fff4', '#c98a58': '#6fc4a0', '#b97e52': '#4fa886', '#d68f55': '#7fd4b0', '#f0c898': '#d4f5e0', '#9a6038': '#2f7a5e' },
  },

  mosquito: {
    body: { w: 0.27, h: 0.27, d: 0.31, y: 0.46, color: '#b7c6ff', lo: true },
    legs: { type: 'crab', n: 3, r: 0.015, ground: true, x: 0.5, dy: 0.5, z: 0.8, color: '#8e9ee0', down: 1, out: 0.6, fan: 0.4 },
    head: { r: 0.26, w: 1.05, h: 1, d: 0.95, y: 0.66, z: 0.22, color: '#c9d4ff', lo: true },
    eyes: { s: 0.21, gap: 0.52, el: 0.05, ring: '#ffffff' },
    blush: '#ff9ab8',
    snout: { type: 'beak', color: '#ffb3c8', w: 0.1, len: 0.6, el: -0.3 },
    ears: { type: 'feeler', s: 1.0, az: 0.45, el: 0.85, color: '#8e9ee0', inner: '#ffb3c8', len: 1.2, dir: [0.45, 1, 0.4], bend: 0.6, r: 0.05, ball: 2.8 },
    extras: [
      { t: 'smile', color: '#6f7fc9' },
      { t: 'stripes', g: 'sphL', color: '#fffaff', at: [-0.45, -0.05, 0.3], th: 0.1 },
      { t: 'bugwings', color: '#efe9ff', x: 0.25, y: 0.85, rest: 0.8, blades: [[0.36, -0.05, 0.38, 0.13, 0.25], [0.24, -0.2, 0.24, 0.09, 0.45, 0, -0.012]] },
    ],
    shinyPalette: { '#b7c6ff': '#ffc4dc', '#c9d4ff': '#ffe0ee', '#8e9ee0': '#e07aa8', '#ffb3c8': '#9ad8ff', '#fffaff': '#fff4a8', '#efe9ff': '#fff2f8', '#6f7fc8': '#a84a78' },
  },

  spider: {
    body: { w: 0.36, h: 0.34, d: 0.38, y: 0.42, color: '#8f6fd8', lo: true },
    legs: { type: 'none' },
    head: { r: 0.28, w: 1.1, h: 1, d: 0.95, y: 0.46, z: 0.4, color: '#a68be8', lo: true },
    eyes: { s: 0.2, gap: 0.45, el: 0.12, ring: '#ffffff' },
    blush: '#ff8fb8',
    extras: [
      { t: 'smile', color: '#4a3291' },
      { t: 'spots', color: '#ff8fb0', th: 0.25, list: [{ on: 'body', az: 3.14, el: 0.85, s: 0.55, sx: 0.8, sy: 1.1 }, { on: 'body', az: 2.7, el: 0.6, s: 0.25 }, { on: 'body', az: -2.7, el: 0.6, s: 0.25 }] },
      { t: 'blobs', on: 'head', color: '#fff0d8', list: [{ g: 'coneP', p: [0.05, -0.2, 0.22], s: [0.03, 0.08, 0.03], dir: [0.1, -1, 0.3], mirror: true }] },
      { t: 'spiderlegs', n: 4, r: 0.034, color: '#6f4fc0', x: 0.75, dy: 0.1, z: 0.55, up: 0.32, rise: 0.9, out: 1.0, fan: 0.75, out2: 0.5, fan2: 0.6 },
    ],
    shinyPalette: { '#8f6fd8': '#ff9ad5', '#a68be8': '#ffc0e6', '#6f4fc0': '#c0508f', '#ff8fb0': '#9ad8ff', '#4a3290': '#8a2a62', '#fff0d8': '#ffffff' },
  },

  scorpion: {
    dz: -0.05,
    body: { w: 0.3, h: 0.22, d: 0.42, y: 0.26, color: '#f0b878', lo: true },
    legs: { type: 'crab', n: 4, r: 0.03, ground: true, x: 0.8, dy: 0.3, z: 0.75, color: '#d9955a', down: 1, out: 0.9, fan: 0.35 },
    head: { r: 0.25, w: 1.1, h: 0.9, d: 0.95, y: 0.36, z: 0.4, color: '#f6c890', lo: true },
    eyes: { s: 0.2, gap: 0.5, el: 0.12 },
    blush: '#ff9a8a',
    ears: { type: 'claw', s: 1.7, az: 1.25, el: -0.25, color: '#ff9a6a', inner: '#ffc09a', out: 0.4, lift: 0.15 },
    tail: { type: 'long', n: 5, len: 0.85, r: 0.06, taper: 0.1, lift: 0.6, curve: 0.55, y: 0.35, z: 0.9, color: '#f0b878', sting: '#f6c890', gem: '#7ae8ff' },
    extras: [
      { t: 'smile', color: '#9a5a31' },
      { t: 'stripes', g: 'sphM', color: '#e0985a', at: [-0.55, -0.2, 0.15], th: 0.09 },
    ],
    shinyPalette: { '#f0b878': '#b9a0f0', '#f6c890': '#dcc8ff', '#d9955a': '#8a70d0', '#ff9a6a': '#ff8fc0', '#ffc09a': '#ffd0e6', '#e0985a': '#8a70d0', '#7ae8ff': '#ffe66a', '#9a5a30': '#4a3290' },
  },
};

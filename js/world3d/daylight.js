// V20 time of day (CONTRACT_V20 §1): pure colour / light keyframes for the 3D yard, by local hour. No three.js here (testable).
//
//   skyAt(hour) -> { skyTop, skyBottom, fog, cloud, sun: { color, intensity, dir: { x, y, z } }, hemi: { sky, ground, intensity },
//                    night 0..1, warm 0..1 }      colours are '#rrggbb'; dir points FROM the ground TO the light (unit length)
//   hourOf(date)   local hour as a float (13.5 = 13:30)
//   isNightHour(h) the lanterns / fireflies hours (shared with barn3d so every light switches together)
//   themeSky(dark) the pre-V20 look for the "follow the device theme" setting

// Keyframes on the 24 h circle (the list wraps: 23:59 blends into 00:00).
const KEYS = [
  { h: 0,    k: 'night' },
  { h: 4.8,  k: 'night' },
  { h: 6.0,  k: 'dawn' },
  { h: 7.4,  k: 'day' },
  { h: 15.8, k: 'day' },
  { h: 17.2, k: 'golden' },
  { h: 18.3, k: 'dusk' },
  { h: 19.2, k: 'night' },
];

// Intensities stay low enough that a lit pastel colour is not clipped to white: the shaded side and the sun shadows must show
// (the pre-V20 1.9 + 1.9 washed everything out, so a shadow could not darken anything).
const LOOKS = {
  day: {
    skyTop: '#8fd0ff', skyBottom: '#e6f6d6', fog: '#cfe9e4', cloud: '#ffffff',
    sun: { color: '#fff0d4', intensity: 1.55 }, hemi: { sky: '#fff6e6', ground: '#86b86a', intensity: 1.35 }, night: 0, warm: 0,
  },
  dawn: {
    skyTop: '#93a9e0', skyBottom: '#ffd2bc', fog: '#f1cfc4', cloud: '#ffe0d6',
    sun: { color: '#ffc49a', intensity: 1.15 }, hemi: { sky: '#ffe4d8', ground: '#7d9668', intensity: 0.95 }, night: 0.1, warm: 0.6,
  },
  golden: {
    skyTop: '#79a8dc', skyBottom: '#ffd08c', fog: '#f3d39e', cloud: '#ffe2b0',
    sun: { color: '#ffb868', intensity: 1.95 }, hemi: { sky: '#fff0d8', ground: '#94a862', intensity: 1.05 }, night: 0, warm: 1,
  },
  dusk: {
    skyTop: '#4a4f95', skyBottom: '#f29a86', fog: '#b98aa0', cloud: '#e7a5b0',
    sun: { color: '#ff8f72', intensity: 0.85 }, hemi: { sky: '#cbb0dc', ground: '#5d6c5e', intensity: 0.78 }, night: 0.55, warm: 0.8,
  },
  night: {
    skyTop: '#101c3e', skyBottom: '#2b3d66', fog: '#2a3a60', cloud: '#3b4a78',
    sun: { color: '#a9bcff', intensity: 0.55 }, hemi: { sky: '#8a9fd8', ground: '#33454a', intensity: 0.72 }, night: 1, warm: 0,
  },
};

// Sun path: rises in the east (+x) at 6, highest at 12.5, sets in the west (-x) at 19; the moon takes over at night from a fixed,
// fairly high angle so shadows stay short and pets stay readable. Never below MIN_ELEV (no flat-to-the-ground light).
const MIN_ELEV = 0.55;   // rad, ~31 deg
const MOON_DIR = norm({ x: -0.35, y: 0.82, z: 0.45 });

function norm(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = rgb => `#${rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
export function mixHex(a, b, u) {
  const A = hex(a), B = hex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * u));
}
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = u => u * u * (3 - 2 * u);

/** Normalises any number to [0, 24). */
export function wrapHour(h) {
  const x = Number(h);
  if (!Number.isFinite(x)) return 12;
  return ((x % 24) + 24) % 24;
}

export function hourOf(date = new Date()) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

export function isNightHour(h) {
  const x = wrapHour(h);
  return x >= 18.4 || x < 5.6;
}

function sunDir(h, night) {
  const day = Math.min(1, Math.max(0, (h - 6) / 13));   // 0 at 6:00 .. 1 at 19:00 (held at the horizon outside)
  const az = lerp(Math.PI * 0.45, -Math.PI * 0.45, day);         // east -> west
  const elev = MIN_ELEV + (0.98 - MIN_ELEV) * Math.sin(day * Math.PI);
  const c = Math.cos(elev);
  const s = norm({ x: Math.sin(az) * c - 0.3, y: Math.sin(elev), z: Math.cos(az) * c * 0.35 + 0.12 });   // from the side, a little in front: shadows fall sideways where the camera sees them
  // the moon takes over as the night colours come in: one continuous turn, no jump at dawn or dusk
  return norm({ x: lerp(s.x, MOON_DIR.x, night), y: lerp(s.y, MOON_DIR.y, night), z: lerp(s.z, MOON_DIR.z, night) });
}

function blendLook(a, b, u) {
  return {
    skyTop: mixHex(a.skyTop, b.skyTop, u), skyBottom: mixHex(a.skyBottom, b.skyBottom, u), fog: mixHex(a.fog, b.fog, u),
    cloud: mixHex(a.cloud, b.cloud, u),
    sun: { color: mixHex(a.sun.color, b.sun.color, u), intensity: lerp(a.sun.intensity, b.sun.intensity, u) },
    hemi: { sky: mixHex(a.hemi.sky, b.hemi.sky, u), ground: mixHex(a.hemi.ground, b.hemi.ground, u), intensity: lerp(a.hemi.intensity, b.hemi.intensity, u) },
    night: lerp(a.night, b.night, u), warm: lerp(a.warm, b.warm, u),
  };
}

export function skyAt(hour) {
  const h = wrapHour(hour);
  let i = KEYS.length - 1;
  for (let k = 0; k < KEYS.length; k++) if (KEYS[k].h <= h) i = k;
  const a = KEYS[i], b = KEYS[(i + 1) % KEYS.length];
  const span = ((b.h - a.h) + 24) % 24 || 24;
  const u = smooth(Math.min(1, (((h - a.h) + 24) % 24) / span));
  const look = blendLook(LOOKS[a.k], LOOKS[b.k], u);
  look.sun.dir = sunDir(h, look.night);
  return look;
}

/** Pre-V20 look: daylight with the theme decides; a dark device theme gives a soft night (not the full clock night). */
export function themeSky(dark) {
  if (!dark) return skyAt(12);
  const n = blendLook(LOOKS.day, LOOKS.night, 0.7);
  n.sun.dir = MOON_DIR;
  return n;
}

export const DAYLIGHT_LOOKS = Object.keys(LOOKS);

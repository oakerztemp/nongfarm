// V20 tests (CONTRACT_V20): time-of-day colours (continuous, right phases), the shared night rule, the sky preference, the engine API.
import { test, assert, assertEq } from './harness.js';
import { skyAt, isNightHour, wrapHour, hourOf, themeSky, mixHex } from '../js/world3d/daylight.js';
import { getSkyPref, setSkyPref, onPrefChange } from '../js/prefs.js';
import * as engine from '../js/world3d/engine.js';

const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const maxStep = (a, b) => Math.max(...rgb(a).map((v, i) => Math.abs(v - rgb(b)[i])));
const COLOR_KEYS = ['skyTop', 'skyBottom', 'fog', 'cloud'];

test('v20 daylight: every minute of the day blends smoothly (no jump anywhere, including midnight)', () => {
  let prev = skyAt(23 + 59 / 60);
  for (let m = 0; m <= 24 * 60; m++) {
    const cur = skyAt(m / 60);
    for (const k of COLOR_KEYS) assert(maxStep(prev[k], cur[k]) <= 6, `${k} jumps at minute ${m}: ${prev[k]} -> ${cur[k]}`);
    assert(maxStep(prev.sun.color, cur.sun.color) <= 6 && maxStep(prev.hemi.sky, cur.hemi.sky) <= 6, `light colour jumps at minute ${m}`);
    assert(Math.abs(prev.sun.intensity - cur.sun.intensity) < 0.05 && Math.abs(prev.hemi.intensity - cur.hemi.intensity) < 0.05, `intensity jumps at minute ${m}`);
    const d = cur.sun.dir, pd = prev.sun.dir;
    assert(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-6, 'unit light direction');
    assert(d.y > 0.45, `light never skims the ground (y ${d.y.toFixed(2)} at minute ${m})`);
    assert(Math.hypot(d.x - pd.x, d.y - pd.y, d.z - pd.z) < 0.03, `light direction jumps at minute ${m}`);
    prev = cur;
  }
});

test('v20 daylight: phases — noon is day, 17:15 is golden, 22:00 and 03:00 are night, 06:00 is dawn', () => {
  assertEq([skyAt(12).night, skyAt(12).warm], [0, 0], 'noon');
  assert(skyAt(17.2).warm > 0.95, 'golden hour is warm');
  assertEq([skyAt(22).night, skyAt(3).night], [1, 1], 'night');
  assert(skyAt(6).warm > 0.5 && skyAt(6).night < 0.2, 'dawn');
  assert(skyAt(18.5).night > 0.4 && skyAt(18.5).night < 1, 'dusk is in between');
  assertEq(skyAt(26).skyTop, skyAt(2).skyTop, 'hours wrap');
  assertEq(wrapHour(-1), 23, 'negative wraps');
  assertEq(wrapHour('x'), 12, 'junk = noon');
  assertEq(hourOf(new Date(2026, 9, 27, 13, 30, 0)), 13.5, 'hourOf');
  assertEq(mixHex('#000000', '#ffffff', 0.5), '#808080', 'mixHex');
});

test('v20 night rule: lanterns / fireflies from 18:24 to 05:36; theme look = day or a soft night', () => {
  assertEq([isNightHour(12), isNightHour(18.3), isNightHour(18.4), isNightHour(0), isNightHour(5.5), isNightHour(5.6)], [false, false, true, true, true, false]);
  assertEq(themeSky(false).night, 0, 'light theme = day');
  const n = themeSky(true);
  assert(n.night > 0.5 && n.night < 1, 'dark theme = a soft night');
});

test('v20 sky preference: clock by default, theme can be chosen, junk refused, listeners hear "sky"', () => {
  let old = null;
  try { old = localStorage.getItem('nongfarm_pref_sky'); localStorage.removeItem('nongfarm_pref_sky'); } catch { /* storage blocked */ }
  try {
    assertEq(getSkyPref(), 'clock', 'default');
    const heard = [];
    const off = onPrefChange((name, value) => heard.push([name, value]));
    assert(setSkyPref('theme'), 'theme accepted');
    assert(!setSkyPref('noon'), 'junk refused');
    off();
    assertEq(heard, [['sky', 'theme']], 'listener');
    try { if (localStorage.getItem('nongfarm_pref_sky') !== null) assertEq(getSkyPref(), 'theme', 'kept'); } catch { /* storage blocked */ }
  } finally {
    try { if (old === null) localStorage.removeItem('nongfarm_pref_sky'); else localStorage.setItem('nongfarm_pref_sky', old); } catch { /* storage blocked */ }
  }
});

test('v20 engine: setHour / setTimeMode drive the lights, the CSS sky and the night extras; shadows only on the high tier', async () => {
  if (!engine.detectWebGL({ allowSoftware: true })) { console.log('PASS note: no WebGL, skipped'); return; }
  const host = document.createElement('div');
  host.style.cssText = 'width:320px;height:240px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const world = engine.createWorld(host, {}, { quality: 'low' });
  try {
    world.setHour(12);
    const day = world.daylight();
    assertEq([day.night, day.hour, world.isNight()], [0, 12, false], 'noon');
    const skyNoon = host.style.getPropertyValue('--world-sky-top');
    const sunNoon = world.lights.sun.intensity;
    world.setHour(22);
    assertEq([world.daylight().night, world.isNight()], [1, true], 'night');
    assert(host.style.getPropertyValue('--world-sky-top') !== skyNoon, 'the CSS sky follows the hour');
    assert(world.lights.sun.intensity < sunNoon, 'moonlight is dimmer than the sun');
    assert(world.scene.fog && world.scene.fog.color.getHexString() === skyAt(22).fog.slice(1), 'fog colour follows the hour');
    assertEq(world.daylight().sky.fireflies, 0, 'no fireflies on the low tier');
    assert(world.daylight().sky.stars > 0, 'stars at night');
    assertEq(world.daylight().shadows, world.tier === 'high', 'sun shadows only on high');
    world.setHour(null);
    world.setTimeMode('theme');
    assertEq(world.daylight().mode, 'theme', 'theme mode');
    world.setTimeMode('nonsense');
    assertEq(world.daylight().mode, 'clock', 'anything else = clock');
  } finally {
    world.dispose();
    host.remove();
  }
});

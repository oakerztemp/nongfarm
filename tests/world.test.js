// 3D world tests (Coder A, CONTRACT_V4): util.morph skip, prefs, pure engine helpers, fx helpers, and a WebGL smoke test.
import { test, assert, assertEq } from './harness.js';
import { morph } from '../js/util.js';
import {
  getBarnViewPref, setBarnViewPref, getQualityPref, setQualityPref, onPrefChange,
} from '../js/prefs.js';
import * as engine from '../js/world3d/engine.js';
import * as fx from '../js/world3d/fx.js';
import { openSettings } from '../js/ui/settings.js';
import * as THREE from '../vendor/three.module.min.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const prefKeys = () => Object.keys(localStorage).filter(k => k.startsWith('nongfarm_pref_'));
const clearPrefs = () => { for (const k of prefKeys()) localStorage.removeItem(k); };

// ---------------------------------------------------------------- util.morph data-morph="skip"

function mount(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

test('morph skip: skip element and its children are kept untouched', () => {
  const root = mount('<div data-key="w" data-morph="skip"></div><p>a</p>');
  const host = root.firstElementChild;
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  host.classList.add('added-by-engine');
  morph(root, '<div data-key="w" data-morph="skip"><span>should not appear</span></div><p>b</p>');
  assert(root.firstElementChild === host, 'skip host node replaced');
  assert(host.firstElementChild === canvas && host.children.length === 1, 'skip children were changed');
  assert(host.classList.contains('added-by-engine'), 'skip attributes were changed');
  assertEq(root.querySelector('p').textContent, 'b', 'sibling outside the skip element must still update');
  root.remove();
});

test('morph skip: survives repeated renders and reordering around it', () => {
  const root = mount('<h2>t</h2><div data-key="w" data-morph="skip"></div><ul><li>1</li></ul>');
  const host = root.querySelector('[data-key="w"]');
  host.appendChild(document.createElement('canvas'));
  morph(root, '<div data-key="w" data-morph="skip"></div><h2>t2</h2><ul><li>1</li><li>2</li></ul>');
  morph(root, '<div class="banner">x</div><h2>t3</h2><div data-key="w" data-morph="skip"></div><ul></ul>');
  assert(root.querySelector('[data-key="w"]') === host, 'keyed skip host lost across reorders');
  assert(host.querySelector('canvas'), 'host content lost');
  assertEq(root.querySelector('h2').textContent, 't3');
  root.remove();
});

test('morph skip: removed from html -> element removed; non-skip never turns into a skip host', () => {
  const root = mount('<div data-key="w" data-morph="skip"><canvas></canvas></div><p>a</p>');
  const host = root.firstElementChild;
  morph(root, '<p>a</p>');
  assert(!root.contains(host), 'skip element should be removed when the new html no longer has it');
  // a plain div must not be morphed into the position of a skip host, nor a skip host into a plain div
  const plain = mount('<div class="x">plain</div>');
  const plainNode = plain.firstElementChild;
  morph(plain, '<div class="x" data-morph="skip"></div>');
  assert(plain.firstElementChild !== plainNode, 'plain div was reused as a skip host');
  root.remove();
  plain.remove();
});

test('morph without skip still diffs normally (regression)', () => {
  const root = mount('<p class="a">one</p>');
  const p = root.firstElementChild;
  morph(root, '<p class="b">two</p>');
  assert(root.firstElementChild === p, 'node should be reused');
  assertEq([p.className, p.textContent], ['b', 'two']);
  root.remove();
});

// ---------------------------------------------------------------- prefs

test('prefs: defaults, round trip, invalid values rejected, change events', () => {
  clearPrefs();
  assertEq(getBarnViewPref(), '3d');
  assertEq(getQualityPref(), 'auto');
  const seen = [];
  const off = onPrefChange((k, v) => seen.push(`${k}=${v}`));
  assert(setBarnViewPref('list'));
  assert(setQualityPref('low'));
  assertEq(getBarnViewPref(), 'list');
  assertEq(getQualityPref(), 'low');
  assert(!setBarnViewPref('hologram'), 'invalid view accepted');
  assertEq(getBarnViewPref(), 'list');
  localStorage.setItem('nongfarm_pref_quality', 'ultra');
  assertEq(getQualityPref(), 'auto', 'corrupt stored value must fall back to the default');
  off();
  assertEq(seen, ['barnView=list', 'quality=low']);
  clearPrefs();
});

test('prefs: unavailable storage falls back to defaults without throwing', () => {
  const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assertEq(getBarnViewPref(), '3d');
    assertEq(getQualityPref(), 'auto');
    setBarnViewPref('list'); // must not throw
  } finally {
    if (real) Object.defineProperty(window, 'localStorage', real);
  }
});

test('settings modal: view + quality choices are stored device-locally', () => {
  clearPrefs();
  openSettings();
  const click = (name, value) => document.querySelector(`.modal [data-pref="${name}"][data-value="${value}"]`).click();
  click('barnView', 'list');
  click('quality', 'low');
  assertEq([getBarnViewPref(), getQualityPref()], ['list', 'low']);
  const pressed = document.querySelector('.modal [data-pref="barnView"][data-value="list"]').getAttribute('aria-pressed');
  assertEq(pressed, 'true');
  document.querySelector('.modal .modal-close').click();
  assert(!document.querySelector('.modal'), 'settings modal did not close');
  clearPrefs();
});

// ---------------------------------------------------------------- pure engine helpers

test('engine: tap vs drag classification', () => {
  const down = { x: 100, y: 100, t: 0 };
  assertEq(engine.classifyPointer(down, { x: 103, y: 104, t: 120 }), 'tap');
  assertEq(engine.classifyPointer(down, { x: 100, y: 100, t: 120 }), 'tap');
  assertEq(engine.classifyPointer(down, { x: 130, y: 100, t: 120 }), 'drag', 'moved too far');
  assertEq(engine.classifyPointer(down, { x: 101, y: 100, t: 900 }), 'drag', 'held too long');
  assertEq(engine.classifyPointer(down, { x: 100 + engine.TAP_MAX_MOVE_PX, y: 100, t: 100 }), 'tap', 'threshold is inclusive');
  assertEq(engine.classifyPointer(down, { x: 100 + engine.TAP_MAX_MOVE_PX + 1, y: 100, t: 100 }), 'drag');
});

test('engine: quality tier picking', () => {
  const t = (o) => engine.pickQualityTier(o);
  assertEq(t({ pref: 'low', dpr: 3, cores: 16 }).name, 'low');
  assertEq(t({ dpr: 3, cores: 8, memory: 8 }).name, 'high');
  assertEq(t({ dpr: 3, cores: 8, memory: 8 }).pixelRatio, 1.5, 'pixel ratio capped for high');
  assertEq(t({ dpr: 2, cores: 4 }).name, 'medium');
  assertEq(t({ dpr: 2, cores: 4 }).pixelRatio, 1.25);
  assertEq(t({ dpr: 2, cores: 8, memory: 2 }).name, 'low', 'low memory device');
  assertEq(t({ dpr: 2, cores: 2 }).name, 'low');
  assertEq(t({ dpr: 1, cores: 8 }).pixelRatio, 1, 'never below 1');
  assertEq(t({}).name, 'medium', 'defaults are a mid device');
  assert(!t({ pref: 'low', dpr: 3 }).antialias, 'low tier has no antialiasing');
  assertEq(engine.nextTierDown('high'), 'medium');
  assertEq(engine.nextTierDown('medium'), 'low');
  assertEq(engine.nextTierDown('low'), null);
  assert(engine.shouldDowngrade(60, 30, 90), 'persistently slow frames downgrade');
  assert(!engine.shouldDowngrade(34, 30, 90), 'a steady 30 fps does not');
  assert(!engine.shouldDowngrade(80, 30, 10), 'too few samples');
});

test('engine: idle fps cap gate', () => {
  const gate = engine.shouldRenderFrame;
  // 60 Hz display: rAF every ~16.7 ms, idle -> every 2nd frame
  let last = -Infinity;
  let rendered = 0;
  for (let i = 0; i < 61; i++) {
    const ts = i * (1000 / 60);
    if (gate(ts, last, false)) { rendered++; last = ts; }
  }
  assert(rendered >= 29 && rendered <= 32, `expected ~30 fps in 1 s idle, got ${rendered}`);
  // interactive: everything renders
  last = -Infinity; rendered = 0;
  for (let i = 0; i < 61; i++) {
    const ts = i * (1000 / 60);
    if (gate(ts, last, true)) { rendered++; last = ts; }
  }
  assertEq(rendered, 61);
  assert(gate(100, -Infinity, false), 'first frame always renders');
  assert(!gate(10, 0, false) && gate(34, 0, false), 'gap needed between idle frames');
  // 120 Hz display still capped near 30
  last = -Infinity; rendered = 0;
  for (let i = 0; i < 121; i++) {
    const ts = i * (1000 / 120);
    if (gate(ts, last, false)) { rendered++; last = ts; }
  }
  assert(rendered <= 32, `120 Hz idle should still be ~30 fps, got ${rendered}`);
});

test('engine: camera clamps, orbit position and fit distance', () => {
  assertEq(engine.clampPitch(-1), engine.PITCH_MIN);
  assertEq(engine.clampPitch(9), engine.PITCH_MAX);
  assertEq(engine.clampPitch(0.8), 0.8);
  assertEq(engine.clampZoom(0), engine.ZOOM_MIN);
  assertEq(engine.clampZoom(5), engine.ZOOM_MAX);
  const p = engine.orbitPosition(0, 0, 10);
  assert(Math.abs(p.z - 10) < 1e-9 && Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9, 'yaw 0 / pitch 0 looks from +z');
  const q = engine.orbitPosition(Math.PI / 2, 0, 10, { x: 1, y: 2, z: 3 });
  assert(Math.abs(q.x - 11) < 1e-9 && Math.abs(q.y - 2) < 1e-9 && Math.abs(q.z - 3) < 1e-9);
  const up = engine.orbitPosition(0, Math.PI / 2, 5);
  assert(Math.abs(up.y - 5) < 1e-9, 'pitch 90deg looks straight down');
  const portrait = engine.fitDistance(0.5, 38, 0.9, 7);
  const landscape = engine.fitDistance(1.8, 38, 0.9, 7);
  assert(portrait > landscape, 'a narrow (phone) view has to be further away to fit the island');
  assert(Number.isFinite(engine.fitDistance(0, 38, 0.9, 7)), 'zero aspect must not blow up');
});

test('engine: effective pick radius is never below 44 px and picks the nearest actor', () => {
  const small = engine.effectivePickRadiusPx(0.2, 15, 38, 400);
  assertEq(small, 44, 'tiny / far pets still get a 44 px radius');
  const big = engine.effectivePickRadiusPx(3, 5, 38, 800);
  assert(big > 44, 'big close actors use their projected size');
  const c = [
    { id: 'a', sx: 100, sy: 100, r: 44, depth: 10 },
    { id: 'b', sx: 130, sy: 100, r: 44, depth: 10 },
    { id: 'far', sx: 300, sy: 300, r: 44, depth: 10 },
  ];
  assertEq(engine.pickNearest(c, 108, 100), 'a');
  assertEq(engine.pickNearest(c, 122, 100), 'b');
  assertEq(engine.pickNearest(c, 200, 200), null, 'nothing within radius');
  assertEq(engine.pickNearest([{ id: 'x', sx: 10, sy: 10, r: 44, depth: 20 }, { id: 'y', sx: 10, sy: 10, r: 44, depth: 5 }], 10, 10), 'y',
    'equal distance: the actor closer to the camera wins');
  assertEq(engine.pickNearest([], 0, 0), null);
});

test('engine: isWorldSupported is a boolean and honours reduced motion detection', () => {
  assertEq(typeof engine.isWorldSupported({ allowSoftware: true }), 'boolean');
  assertEq(typeof engine.prefersReducedMotion(), 'boolean');
});

test('fx: easing and arc helpers', () => {
  assertEq(fx.easeOutCubic(0), 0);
  assertEq(fx.easeOutCubic(1), 1);
  assert(Math.abs(fx.easeOutBack(0)) < 1e-9 && Math.abs(fx.easeOutBack(1) - 1) < 1e-9, 'pop starts at 0 and ends at 1');
  assert(Math.max(...[0.5, 0.6, 0.7, 0.8].map(fx.easeOutBack)) > 1, 'pop overshoots');
  assertEq(fx.clamp01(2), 1);
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 4, y: 2, z: 0 };
  assertEq(fx.arcPoint(a, b, 0, 1), a);
  const end = fx.arcPoint(a, b, 1, 1);
  assert(end.x === 4 && Math.abs(end.y - 2) < 1e-9 && end.z === 0, 'arc ends at the target');
  assert(fx.arcPoint(a, b, 0.5, 1).y > 1.9, 'arc rises above the straight line');
  assertEq(fx.fadeOut(0.3, 0.6), 1);
  assertEq(fx.fadeOut(1, 0.6), 0);
  assert(fx.flightDuration(a, b) > 0.5 && fx.flightDuration(a, { x: 500, y: 0, z: 0 }) <= 1.1, 'flight time bounded');
});

// ---------------------------------------------------------------- WebGL smoke test (skipped gracefully without WebGL)

test('world smoke: createWorld, actors, picking, fx, dispose (needs WebGL)', async () => {
  if (!engine.detectWebGL({ allowSoftware: true })) {
    console.log('PASS note: WebGL not available in this browser, world smoke test skipped');
    return;
  }
  const host = document.createElement('div');
  host.style.cssText = 'width:320px;height:240px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const taps = [];
  const ground = [];
  const world = engine.createWorld(host, { onTap: id => taps.push(id), onTapGround: p => ground.push(p) }, { quality: 'low' });
  try {
    assert(host.querySelector('canvas'), 'canvas not mounted');
    assert(host.classList.contains('world3d-host'));
    const { THREE } = world;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    mesh.position.set(0.5, 0, 1);
    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(0.5, 0, 1);
    mesh.position.set(0, 0.4, 0);
    world.addActor('pet:1', group, { radius: 0.4, height: 0.8 });
    assert(world.getActor('pet:1') && world.getActor('pet:1').object === group, 'getActor');
    assertEq(world.getActor('nope'), null);
    // picking: the screen position of the actor's centre must hit it; a far corner must not
    const s = world.worldToScreen(new THREE.Vector3(0.5, 0.4, 1));
    assert(s.visible, 'actor should be on screen');
    const rect = world.canvas.getBoundingClientRect();
    const hit = world.pick(rect.left + s.x, rect.top + s.y);
    assertEq(hit.id, 'pet:1', 'centre pick');
    const near = world.pick(rect.left + s.x + 35, rect.top + s.y + 10); // inside the 44 px generous radius, off the mesh
    assertEq(near.id, 'pet:1', 'generous radius pick');
    const miss = world.pick(rect.left + 2, rect.top + 2);
    assertEq(miss.id, null, 'corner pick');
    // frame loop: onFrame runs, fx effects are created and removed again
    let frames = 0;
    const off = world.onFrame(() => { frames++; });
    fx.heart(world, { x: 0, y: 1, z: 0 });
    fx.emojiPop(world, { x: 0, y: 1, z: 0 }, '🍖');
    fx.sparkle(world, 'pet:1');
    const b = fx.bubble(world, 'pet:1', '🍖');
    fx.bubble(world, 'pet:1', '🪰'); // swaps, still one bubble
    let landed = false;
    fx.flyEmoji(world, { x: 0, y: 2, z: 3 }, { x: 0, y: 0.5, z: 1 }, '🍎', () => { landed = true; });
    assert(fx.activeCount(world) > 0, 'effects should be active');
    world.boost(2000);
    for (let i = 0; i < 80 && (!landed || frames < 3); i++) await wait(50);
    off();
    if (!document.hidden) {
      assert(frames >= 3, `render loop did not run (frames=${frames})`);
      assert(landed, 'flyEmoji never called onDone');
      assert(world.getStats().triangles > 0, 'nothing rendered');
    }
    b.remove();
    assert(world.removeActor('pet:1'));
    assert(!world.removeActor('pet:1'));
    world.setActive(false);
    assert(!world.isActive());
    world.setActive(true);
    // removing an actor drops its bubble effects without errors
    fx.bubble(world, 'ghost', '💤'); // no such actor: removed on the next frame, never throws
    await wait(120);
  } finally {
    world.dispose();
  }
  assert(!host.querySelector('canvas'), 'canvas not removed on dispose');
  assert(!host.classList.contains('world3d-host'));
  world.dispose(); // idempotent
  host.remove();
});

// ---------------------------------------------------------------- review fixes (A-1..A-4)

test('support.js has no three.js import and engine re-exports it', async () => {
  const src = await (await fetch(new URL('../js/world3d/support.js', import.meta.url))).text();
  assert(!/three/i.test(src.replace(/\/\/.*$/gm, '')), 'support.js must not import three.js');
  const sup = await import('../js/world3d/support.js');
  assert(sup.isWorldSupported === engine.isWorldSupported && sup.detectWebGL === engine.detectWebGL, 'engine must re-export support.js');
});

test('createWorld: a failure half way through leaves nothing behind', () => {
  if (!engine.detectWebGL({ allowSoftware: true })) { console.log('PASS note: no WebGL, skipped'); return; }
  const host = document.createElement('div');
  host.style.cssText = 'width:200px;height:150px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  let threw = false;
  try {
    engine.createWorld(host, {}, { quality: 'low', __failForTest: true });
  } catch (e) {
    threw = /forced failure/.test(e.message);
  }
  assert(threw, 'createWorld should rethrow the setup error');
  assert(!host.querySelector('canvas'), 'canvas leaked');
  assert(!host.classList.contains('world3d-host'), 'host class leaked');
  host.remove();
});

test('world: shadows are one instanced draw call, tier + stats exposed', async () => {
  if (!engine.detectWebGL({ allowSoftware: true })) { console.log('PASS note: no WebGL, skipped'); return; }
  const host = document.createElement('div');
  host.style.cssText = 'width:320px;height:240px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const world = engine.createWorld(host, {}, { quality: 'low' });
  try {
    assertEq(world.tier, 'low');
    const { THREE } = world;
    const mat = new THREE.MeshBasicMaterial();
    const geo = new THREE.SphereGeometry(0.3, 6, 4);
    const draw = async () => {
      world.renderer.render(world.scene, world.camera);
      return world.renderer.info.render.calls;
    };
    world.renderer.info.autoReset = true;
    const before = await draw();
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(i * 0.3 - 1.5, 0, 1);
      world.addActor(`a${i}`, m, { radius: 0.3, shadow: i % 2 === 0 });
    }
    await wait(150); // let the loop run updateBlobs at least once
    const after = await draw();
    assert(after - before <= 12 + 1, `12 actors may add at most 12 calls (+0 for shadows), got ${after - before}`);
    assert(typeof world.getStats().drawCalls === 'number', 'getStats().drawCalls');
    world.removeActor('a0');
    assertEq(world.getStats().actors, 11);
    geo.dispose(); mat.dispose();
  } finally {
    world.dispose();
    host.remove();
  }
});

// ---------------------------------------------------------------- V5 fx primitives (aura, particles, trail, beam, dim, shake, halo)

test('fx v5: pure helpers (caps, policy, envelopes, ramps)', () => {
  assertEq([fx.particleCapForTier('high'), fx.particleCapForTier('medium'), fx.particleCapForTier('low')], [300, 180, 0]);
  assertEq([fx.particleRateScale('high'), fx.particleRateScale('low')], [1, 0]);
  const low = fx.fxPolicy('low', false);
  assert(!low.particles && !low.trails && !low.runeRing, 'low tier: no particles / trails / rune ring');
  const reduced = fx.fxPolicy('high', true);
  assert(!reduced.shake && !reduced.trails && !reduced.runeSpin && !reduced.pulse, 'reduced motion: calm');
  const high = fx.fxPolicy('high', false);
  assert(high.particles && high.trails && high.shake && high.runeRing, 'high tier: everything on');
  for (const kind of ['motes', 'embers', 'stars', 'petals']) {
    for (let u = 0; u <= 1.0001; u += 0.05) {
      const e = fx.particleEnvelope(kind, u);
      assert(e >= 0 && e <= 1.0001, `${kind} envelope out of range at ${u}: ${e}`);
    }
    assert(fx.particleEnvelope(kind, 1) < 1e-9, `${kind} fades out fully`);
  }
  assertEq(fx.colorRamp([[1, 0, 0], [0, 0, 1]], 0.5), [0.5, 0, 0.5]);
  assertEq(fx.colorRamp([[1, 0, 0], [0, 0, 1]], 5), [0, 0, 1]);
  assertEq(fx.colorRamp([[0.2, 0.2, 0.2]], 0.5), [0.2, 0.2, 0.2]);
  assertEq(fx.trailHalfWidth(0, 10, 1), 0.5);
  assertEq(fx.trailHalfWidth(9, 10, 1), 0, 'tail tapers to a point');
  assertEq(fx.dimEnvelope(0, 0.3, 1, 0.5), 0);
  assertEq(fx.dimEnvelope(0.8, 0.3, 1, 0.5), 1);
  const mid = fx.dimEnvelope(1.6, 0.3, 1, 0.5);
  assert(mid > 0 && mid < 1, 'easing out');
  assertEq(fx.dimEnvelope(5, 0.3, 1, 0.5), 0, 'restored at the end');
  assertEq(fx.shakeAmplitude(0, 1, 0.2), 0.2);
  assertEq(fx.shakeAmplitude(1, 1, 0.2), 0);
});

async function withWorld(opts, fn) {
  const host = document.createElement('div');
  host.style.cssText = 'width:360px;height:420px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const world = engine.createWorld(host, {}, opts);
  try { await fn(world, host); } finally { world.dispose(); host.remove(); fx.setReducedMotionOverride(null); }
}
function addPets(world, n, meshesEach = 6) {
  const { THREE } = world;
  const geo = new THREE.SphereGeometry(0.2, 6, 4);
  const mat = new THREE.MeshBasicMaterial({ color: 0x88aa88 });
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < meshesEach; k++) { const m = new THREE.Mesh(geo, mat); m.position.y = 0.2 + k * 0.05; g.add(m); }
    const a = (i / n) * Math.PI * 2;
    g.position.set(Math.sin(a) * 3, 0, Math.cos(a) * 3);
    world.addActor(`p${i}`, g, { radius: 0.4, height: 0.8 });
  }
  return () => { geo.dispose(); mat.dispose(); };
}
async function frames(world, n) {
  let c = 0;
  const off = world.onFrame(() => { c++; });
  world.boost(4000);
  for (let i = 0; i < 100 && c < n; i++) await wait(30);
  off();
  return c;
}
const hasGL = () => engine.detectWebGL({ allowSoftware: true });

test('fx v5: 20 pets with 9 legendary stay within the draw-call budget; auras cost 2 calls in total', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto' }, async world => {
    const free = addPets(world, 20);
    await frames(world, 3);
    world.renderer.render(world.scene, world.camera);
    const base = world.renderer.info.render.calls;
    for (let i = 0; i < 9; i++) {
      assert(fx.aura(world, `p${i}`, { color: 0x9b6bff }).active, 'aura handle');
      fx.particles(world, `p${i}`, { kind: i % 2 ? 'motes' : 'embers', rate: 30 });
    }
    for (let i = 0; i < 6; i++) fx.trail(world, `p${i}`);
    for (let i = 9; i < 12; i++) { fx.glowHalo(world, `p${i}`); fx.twinkle(world, `p${i}`); }
    await frames(world, 30);
    world.renderer.render(world.scene, world.camera);
    const withFx = world.renderer.info.render.calls;
    const st = fx.fxStats(world);
    assertEq([st.auras, st.halos], [9, 3]);
    assert(st.trails <= fx.MAX_TRAILS, `trails capped at ${fx.MAX_TRAILS}, got ${st.trails}`);
    assert(st.particles <= fx.particleCapForTier(world.tier), `particle pool over cap: ${st.particles}`);
    assert(withFx - base <= fx.fxDrawCalls(world) + 1, `fx cost ${withFx - base} calls but fxDrawCalls says ${fx.fxDrawCalls(world)}`);
    assert(fx.fxDrawCalls(world) <= 2 + 1 + fx.MAX_TRAILS + 3, 'auras must not scale draw calls');
    assert(withFx <= 200, `draw calls ${withFx} over the 200 budget`);
    free();
  });
});

test('fx v5: particle pool is capped, handles end with the actor, remove() stops emission', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto' }, async world => {
    const free = addPets(world, 12);
    const handles = [];
    for (let i = 0; i < 12; i++) handles.push(fx.particles(world, `p${i}`, { kind: 'motes', rate: 400 }));
    assertEq(fx.particles(world, 'p0', { kind: 'confetti' }).active, false, 'unknown kind -> noop handle');
    assertEq(fx.particles(world, 'ghost', { kind: 'motes' }).active, false, 'unknown actor -> noop handle');
    await frames(world, 20);
    const cap = fx.particleCapForTier(world.tier);
    assert(fx.fxStats(world).particles <= cap, `pool ${fx.fxStats(world).particles} > cap ${cap}`);
    if (cap > 0) assert(fx.fxStats(world).particles > 0, 'emitters should have produced particles');
    world.removeActor('p3');
    handles[5].remove();
    await frames(world, 3);
    assertEq(handles[3].active, false, 'emitter ends when its actor is removed');
    assertEq(handles[5].active, false);
    assertEq(fx.fxStats(world).emitters, 10);
    free();
  });
});

test('fx v5: low tier is calm (no particles, no trails, flat aura only)', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'low' }, async world => {
    assertEq(world.tier, 'low');
    const free = addPets(world, 4);
    fx.aura(world, 'p0');
    fx.particles(world, 'p0', { kind: 'embers', rate: 100 });
    assertEq(fx.trail(world, 'p0').active, false, 'no trails on low');
    await frames(world, 10);
    assertEq(fx.fxStats(world).particles, 0);
    assertEq(fx.fxStats(world).trails, 0);
    assertEq(fx.fxDrawCalls(world), 1, 'flat aura = 1 call');
    free();
  });
});

test('fx v5: reduced motion -> no trail, no shake; normal motion shakes then settles', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto' }, async world => {
    const free = addPets(world, 2);
    await frames(world, 3);
    const base = world.camera.position.clone();
    fx.setReducedMotionOverride(true);
    assertEq(fx.trail(world, 'p0').active, false);
    fx.shake(world, 300, 0.5);
    await frames(world, 5);
    assert(world.camera.position.distanceTo(base) < 1e-6, 'reduced motion must not shake the camera');
    fx.setReducedMotionOverride(false);
    fx.shake(world, 400, 0.5);
    let moved = false;
    const off = world.onFrame(() => { if (world.camera.position.distanceTo(base) > 0.01) moved = true; });
    await frames(world, 8);
    off();
    assert(moved, 'shake should move the camera');
    await wait(500);
    await frames(world, 3);
    assert(world.camera.position.distanceTo(base) < 1e-6, 'camera back to rest after the shake');
    free();
  });
});

test('fx v5: dimScene restores automatically; lightBeam and faded trail free their meshes', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto' }, async (world, host) => {
    const free = addPets(world, 2);
    const before = world.scene.children.length;
    const base = world.lights.hemi.intensity;
    fx.dimScene(world, 0.8, 100);
    fx.lightBeam(world, { x: 0, y: 0, z: 0 }, { duration: 0.4 });
    const tr = fx.trail(world, 'p0', { length: 6 });
    await frames(world, 6);
    assert(world.lights.hemi.intensity < base, 'scene should be dimmer');
    assert(host.style.getPropertyValue('--world-dim') !== '', 'css dim overlay set');
    assertEq(fx.fxStats(world).timed, 1, 'beam active');
    tr.remove();
    for (let i = 0; i < 60 && (fx.fxStats(world).timed || fx.fxStats(world).trails || world.lights.hemi.intensity < base - 1e-6); i++) await frames(world, 5);
    assertEq(fx.fxStats(world).timed, 0, 'beam freed');
    assertEq(fx.fxStats(world).trails, 0, 'faded trail freed');
    assert(Math.abs(world.lights.hemi.intensity - base) < 1e-6, 'light restored');
    assertEq(world.scene.children.length, before, 'beam + trail meshes removed from the scene');
    free();
  });
});

test('fx v5: dispose frees every effect mesh', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  const host = document.createElement('div');
  host.style.cssText = 'width:300px;height:300px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const world = engine.createWorld(host, {}, { quality: 'auto' });
  const free = addPets(world, 3);
  const before = world.scene.children.length;
  fx.aura(world, 'p0'); fx.particles(world, 'p0', { kind: 'stars' }); fx.trail(world, 'p0'); fx.glowHalo(world, 'p1');
  fx.lightBeam(world, { x: 0, y: 0, z: 0 }); fx.dimScene(world, 0.5, 5000); fx.shake(world, 5000, 0.1);
  await frames(world, 4);
  assert(world.scene.children.length > before, 'effects should add scene objects');
  const scene = world.scene;
  world.dispose();
  assertEq(fx.fxStats(world), { auras: 0, emitters: 0, particles: 0, trails: 0, halos: 0, timed: 0 });
  assert(scene.children.length <= before - 3, 'effect meshes and actors must leave the scene on dispose');
  free();
  host.remove();
});

test('fx: sprite effect caps and confetti scale with the tier; a legendary-hatch burst stays inside the call budget', async () => {
  assertEq([fx.effectCapForTier('high'), fx.effectCapForTier('medium'), fx.effectCapForTier('low')], [80, 48, 24]);
  assertEq(fx.confettiCountForTier('low', 56), 16);
  assertEq(fx.confettiCountForTier('medium', 56), 28);
  assertEq(fx.confettiCountForTier('high', 56), 40);
  assertEq(fx.confettiCountForTier('low'), 12);
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  for (const quality of ['low', 'auto']) {
    await withWorld({ quality }, async world => {
      const free = addPets(world, 23);
      await frames(world, 3);
      world.renderer.render(world.scene, world.camera);
      const base = world.renderer.info.render.calls;
      fx.confetti(world, { x: 0, y: 0, z: 0 }, 56);
      fx.sparkleAt(world, { x: 0, y: 1, z: 0 });
      fx.heart(world, { x: 0, y: 1, z: 0 });
      fx.emojiPop(world, { x: 0, y: 1, z: 0 }, '🥚');
      fx.flyEmoji(world, { x: 0, y: 3, z: 0 }, { x: 1, y: 1, z: 0 }, '✨');
      await frames(world, 2);
      world.renderer.render(world.scene, world.camera);
      const extra = world.renderer.info.render.calls - base;
      const cap = fx.effectCapForTier(world.tier);
      assert(fx.activeCount(world) <= cap, `${world.tier}: ${fx.activeCount(world)} effects over cap ${cap}`);
      assert(extra <= cap + 1, `${world.tier}: burst cost ${extra} draw calls, cap ${cap}`);
      free();
    });
  }
});

// ---------------------------------------------------------------- V6: yard tiers + static props

test('yard: capacity -> tier mapping and radii', () => {
  const t = engine.yardTierForCapacity;
  assertEq([t(3), t(5), t(6), t(9), t(10), t(14), t(15), t(20), t(0), t(99)], ['S', 'S', 'M', 'M', 'L', 'L', 'XL', 'XL', 'S', 'XL']);
  assertEq(engine.yardTierConfig('xl').name, 'XL');
  assertEq(engine.yardTierConfig(12).name, 'L');
  assertEq(engine.yardTierConfig('nonsense').name, engine.DEFAULT_YARD_TIER);
  const walk = engine.YARD_TIER_NAMES.map(n => engine.YARD_TIERS[n].walk);
  assertEq(walk, [4.3, 5.0, 5.6, 6.2]);
  for (const n of engine.YARD_TIER_NAMES) {
    const c = engine.YARD_TIERS[n];
    assert(c.walk < c.fence && c.fence < c.island, `${n}: walk < fence < island`);
    assert(Math.abs(c.barnZ) < c.walk, `${n}: the barn sits inside the walkable area`);
  }
  assertEq([engine.WALK_RADIUS, engine.ISLAND_RADIUS], [5.6, 7.0], 'legacy constants = tier L');
});

test('yard: grow animation scale starts small, overshoots a little and settles at 1', () => {
  assertEq(engine.yardGrowScale(0.8, 0), 0.8);
  assert(Math.abs(engine.yardGrowScale(0.8, 1) - 1) < 1e-9);
  const peak = Math.max(...[0.5, 0.6, 0.7, 0.8].map(u => engine.yardGrowScale(0.8, u)));
  assert(peak > 1 && peak < 1.12, `small overshoot expected, got ${peak}`);
});

test('mergeStaticParts: many parts -> one coloured geometry, sources untouched', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cone = new THREE.ConeGeometry(0.5, 1, 6);
  const before = box.attributes.position.array.slice();
  const merged = engine.mergeStaticParts(THREE, [
    { geometry: box, color: 0xff0000, position: [2, 0, 0] },
    { geometry: box, color: 0x00ff00, position: [-2, 0, 0], scale: 2 },
    { geometry: cone, color: 0x0000ff, rotation: [0, 1, 0] },
  ]);
  const verts = merged.attributes.position.count;
  assertEq(verts, 36 + 36 + cone.toNonIndexed().attributes.position.count, 'vertex count = sum of parts');
  assertEq([merged.attributes.color.count, merged.attributes.normal.count], [verts, verts]);
  assertEq(Array.from(box.attributes.position.array), Array.from(before), 'source geometry not modified');
  const x0 = merged.attributes.position.getX(0);
  assert(x0 > 1 && x0 < 3, `first part translated to x=2, got ${x0}`);
  let bad = 0;
  for (let i = 0; i < verts; i++) {
    const n = Math.hypot(merged.attributes.normal.getX(i), merged.attributes.normal.getY(i), merged.attributes.normal.getZ(i));
    if (!(Math.abs(n - 1) < 1e-4)) bad++;
  }
  assertEq(bad, 0, 'normals stay unit length');
  box.dispose(); cone.dispose(); merged.dispose();
});

test('yard world: setYardTier grows radii, camera and fence; props cost 1 call each; obstacles update in place', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto', yardTier: 'S' }, async world => {
    assertEq([world.yardTier, world.walkRadius, world.islandRadius], ['S', 4.3, 5.7]);
    const obstacles = world.obstacles;
    assertEq(obstacles[0].z, -3.6, 'barn obstacle for tier S');
    const changes = [];
    const off = world.onYardChange(i => changes.push(i.tier));
    const dist0 = world.camera.position.length();
    assertEq(world.setYardTier('XL', { animate: true }), 'XL');
    assertEq(world.setYardTier(18, { animate: true }), 'XL', 'same tier is a no-op');
    assertEq(changes, ['XL'], 'listener fired once');
    assertEq([world.yardTier, world.walkRadius, world.fenceRadius, world.islandRadius], ['XL', 6.2, 6.9, 7.6]);
    assert(world.obstacles === obstacles && obstacles[0].z === -5.5, 'obstacles array updated in place');
    await frames(world, 40);
    await wait(1200);
    await frames(world, 5);
    assert(Math.abs(world.camera.position.length() - dist0) < 1e-6, 'the camera distance is the same for every tier (CONTRACT_V7)');
    off();

    // props: merged = 1 draw call however many parts; instanced = 1 draw call for N copies
    world.renderer.render(world.scene, world.camera);
    const base = world.renderer.info.render.calls;
    const box = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const parts = [];
    for (let i = 0; i < 30; i++) parts.push({ geometry: box, color: 0x66aa66 + i * 1000, position: [i * 0.1 - 1.5, 0.15, 3] });
    world.addMergedProp('pond', parts, { obstacle: { x: 0, z: 3, r: 1.5 } });
    const items = [];
    for (let i = 0; i < 60; i++) items.push({ position: [Math.sin(i) * 4, 0.15, Math.cos(i) * 4], scale: 0.5 + (i % 3) * 0.2, color: 0xffcc44 });
    world.addInstancedProp('flowers', box, items);
    assert(world.hasProp('pond') && world.hasProp('flowers'));
    assert(obstacles.some(o => o.r === 1.5), 'prop obstacle registered');
    await frames(world, 3);
    world.renderer.render(world.scene, world.camera);
    assert(world.renderer.info.render.calls - base <= 2, `2 props must cost <= 2 draw calls, got ${world.renderer.info.render.calls - base}`);
    world.setYardTier('M', { animate: false });
    assert(obstacles.some(o => o.r === 1.5) && obstacles[0].z === -4.3, 'prop obstacles survive a tier change');
    assert(world.removeProp('pond') && !world.removeProp('pond'));
    assert(!obstacles.some(o => o.r === 1.5), 'obstacle removed with the prop');
    world.clearProps('flo');
    assert(!world.hasProp('flowers'));
    box.dispose();
  });
});

test('yard world: dispose removes props and leaves nothing behind', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  const host = document.createElement('div');
  host.style.cssText = 'width:300px;height:300px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const world = engine.createWorld(host, {}, { quality: 'low', yardTier: 'M' });
  const scene = world.scene;
  const box = new THREE.BoxGeometry(1, 1, 1);
  world.addMergedProp('a', [{ geometry: box, color: 0xffffff }]);
  world.addInstancedProp('b', box, [{ position: [0, 0, 0] }]);
  world.setYardTier('L', { animate: false });
  world.dispose();
  assert(!scene.children.some(o => o.isMesh || o.isInstancedMesh), 'no meshes left in the scene after dispose');
  box.dispose();
  host.remove();
});

// ---------------------------------------------------------------- V7: fixed camera, wilderness, pan, decor spots

test('v7 camera: one distance for every yard tier (the fit of tier M); zoom bounds widened', () => {
  const d = engine.fixedCameraDistance(0.6);
  assertEq(d, engine.fitDistance(0.6, engine.CAMERA_FOV, engine.PITCH_DEFAULT, engine.YARD_TIERS.M.island), 'tier M fit');
  assertEq(engine.CAMERA_FIT_TIER, 'M');
  assert(engine.fixedCameraDistance(0.5) > engine.fixedCameraDistance(1.8), 'a narrow phone view is further away');
  assertEq([engine.ZOOM_MIN, engine.ZOOM_MAX], [0.4, 1.5]);
  assertEq(engine.clampZoom(9), 1.5);
});

test('v7 pan helpers: clamp to the island, drag direction, double tap', () => {
  assertEq(engine.clampPan(3, 4, 10), { x: 3, z: 4 }, 'inside stays');
  const c = engine.clampPan(30, 40, 10);
  assert(Math.abs(c.x - 6) < 1e-9 && Math.abs(c.z - 8) < 1e-9, 'outside is projected on the circle');
  assertEq(engine.clampPan(0, 0, 0), { x: 0, z: 0 });
  // yaw 0: finger left -> target +x; finger up -> target +z (towards the camera); finger right/down the opposite
  const l = engine.panDelta(-100, 0, 0, 0.9, 12, 38, 500);
  assert(l.x > 0 && Math.abs(l.z) < 1e-9, `left: ${JSON.stringify(l)}`);
  const u = engine.panDelta(0, -100, 0, 0.9, 12, 38, 500);
  assert(u.z > 0 && Math.abs(u.x) < 1e-9, `up: ${JSON.stringify(u)}`);
  const r = engine.panDelta(100, 100, 0, 0.9, 12, 38, 500);
  assert(r.x < 0 && r.z < 0, 'right + down');
  const quarter = engine.panDelta(-100, 0, Math.PI / 2, 0.9, 12, 38, 500);
  assert(Math.abs(quarter.z) > 0 && Math.abs(quarter.x) < 1e-9, 'yaw 90deg turns the axes');
  const side = engine.panDelta(100, 0, 0, 0.9, 12, 38, 500);
  assert(Math.hypot(u.x, u.z) > Math.hypot(side.x, side.z), 'vertical drag is stretched by the ground tilt');
  assert(engine.pixelsPerUnit(12, 38, 500) > 0);
  const t = { x: 10, y: 10, t: 1000 };
  assert(engine.isDoubleTap(t, { x: 20, y: 14, t: 1250 }), 'close and quick');
  assert(!engine.isDoubleTap(t, { x: 20, y: 14, t: 1400 }), 'too slow');
  assert(!engine.isDoubleTap(t, { x: 90, y: 10, t: 1100 }), 'too far');
  assert(!engine.isDoubleTap(null, t));
});

test('v7 wild layout: deterministic, outside the lawn, off the stream, scaled by quality', () => {
  const a = engine.layoutWild(1);
  const b = engine.layoutWild(1);
  assertEq(a, b, 'same seed -> same meadow');
  const n = k => Object.values(engine.layoutWild(k)).reduce((s, x) => s + x.length, 0);
  assert(n(0.45) < n(0.7) && n(0.7) < n(1), 'quality scales the count');
  assert(n(1) <= 800, `instance count stays small, got ${n(1)}`);
  const W = engine.WILD;
  for (const [kind, items] of Object.entries(a)) {
    assert(items.length > 10, `${kind}: some of each`);
    for (const it of items) {
      assert(it.r >= W.rMin - 1e-9 && it.r <= W.rMax + 1e-9, `${kind} radius ${it.r}`);
      assert(Math.abs(Math.hypot(it.x, it.z) - it.r) < 1e-6, `${kind} r matches x,z`);
      const sx = W.streamX + W.streamAmp * Math.sin(it.z * W.streamFreq);
      assert(!(Math.abs(it.x - sx) < 1.5 && Math.abs(it.z) < W.streamHalf), `${kind} sits in the stream at ${it.x.toFixed(1)},${it.z.toFixed(1)}`);
      assert(Number.isFinite(it.s) && it.s > 0 && Number.isFinite(it.color), `${kind} sane`);
    }
  }
  assert(a.tree.every(t => t.r >= 7), 'trees keep a gap from the yard edge');
  const XL = engine.YARD_TIERS.XL;
  assert(W.rMin >= engine.YARD_TIERS.S.island, 'wild starts at the S lawn edge');
  assert(W.streamX - W.streamAmp - 1.55 > XL.island + 1.5, 'the stream stays clear of even the XL yard');
  assertEq(engine.wildClearance('S'), 6.0);
  assert(engine.wildClearance('M') > engine.wildClearance('S') && engine.wildClearance(20) === engine.wildClearance('XL'));
  assert(W.meadow >= XL.island + 4, 'meadow reaches at least 4 beyond the biggest island');
});

test('v7 decor spots: 2 / 4 / 6 / 8, stable per index, clear of every prop, nest and the barn in every tier', async () => {
  const pb = await import('../js/petBehaviour.js');
  const names = engine.YARD_TIER_NAMES;
  assertEq(names.map(n => engine.decorSpotsForTier(n).length), [2, 4, 6, 8]);
  assertEq(engine.decorSpotsForTier(3).length, 2);
  assertEq(engine.decorSpotsForTier(20).length, 8);
  const full = engine.decorSpotsForTier('XL');
  assertEq(full.map(s => s.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  for (const n of names) assertEq(engine.decorSpotsForTier(n), full.slice(0, engine.DECOR_SPOT_COUNT[n]), `${n}: a prefix of the XL list, so placed decor never moves`);
  try {
    for (const tier of names) {
      pb.configureYard(tier);
      const lay = engine.YARD_TIERS[tier];
      const props = pb.yardProps(tier);
      const nests = Array.from({ length: 6 }, (_, i) => pb.nestSpot(i, 6));
      for (const sp of engine.decorSpotsForTier(tier)) {
        const unlock = Math.floor(sp.index / 2);
        const where = `spot ${sp.index} at tier ${tier}`;
        assert(Math.hypot(sp.x, sp.z) <= engine.YARD_TIERS[names[unlock]].walk - 0.2, `${where}: inside the walk radius of the tier that unlocks it`);
        assert(sp.z >= pb.YARD.backLimit + 0.3, `${where}: pets can reach it (z ${sp.z} vs back limit ${pb.YARD.backLimit})`);
        for (const p of props) assert(Math.hypot(sp.x - p.x, sp.z - p.z) >= p.r + 0.7, `${where}: touches ${p.id}`);
        for (const nst of nests) assert(Math.hypot(sp.x - nst.x, sp.z - nst.z) >= 1.4, `${where}: too close to a nest`);
        assert(Math.hypot(sp.x, sp.z - lay.barnZ) >= 2.7, `${where}: inside the barn`);
        assert(Math.hypot(sp.x - pb.YARD.bowl.x, sp.z - pb.YARD.bowl.z) >= 1.4, `${where}: on the food bowl`);
      }
    }
    // spots never overlap each other, nor a prop of ANY tier (a spot unlocked at S must survive the XL hill and lanterns)
    for (const a of full) for (const b of full) if (a.index < b.index) assert(Math.hypot(a.x - b.x, a.z - b.z) >= 1.7, `spots ${a.index}/${b.index} overlap`);
    for (const p of pb.yardProps('XL')) for (const sp of full) assert(Math.hypot(sp.x - p.x, sp.z - p.z) >= p.r + 0.7, `spot ${sp.index} vs ${p.id}`);
  } finally {
    pb.configureYard('L');
  }
});

test('v7 world: camera distance is identical at every tier; wilderness costs <= 6 draw calls; decor spots follow the tier', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto', yardTier: 'S' }, async world => {
    assertEq(world.decorSpots.length, 2);
    world.setView({ zoom: 0.56, pan: { x: 0, z: 0 } });
    await frames(world, 60); // let the zoom ease settle first
    const distAt = async tier => {
      world.setYardTier(tier, { animate: false });
      await frames(world, 4);
      return world.camera.position.distanceTo(new THREE.Vector3(0, 0.4, 0));
    };
    const d = [];
    for (const t of engine.YARD_TIER_NAMES) d.push(await distAt(t));
    assert(d.every(x => Math.abs(x - d[0]) < 1e-6), `camera distance changed with the tier: ${d}`);
    const expected = engine.fixedCameraDistance(world.camera.aspect) * 0.56;
    assert(Math.abs(d[0] - expected) < 1e-3, `distance ${d[0]} should be M fit x zoom = ${expected}`);

    const info = world.wildInfo();
    assertEq(info.meshes, 6, 'meadow + grass + bushes + trees + rocks + stream');
    world.setYardTier('XL', { animate: false });
    assertEq(world.decorSpots.length, 8);
    assertEq(world.decorSpots, engine.decorSpotsForTier('XL'));
    world.renderer.render(world.scene, world.camera);
    const withWild = world.renderer.info.render.calls;
    world.wildGroup.visible = false;
    world.renderer.render(world.scene, world.camera);
    const without = world.renderer.info.render.calls;
    world.wildGroup.visible = true;
    assert(withWild - without === info.meshes && info.meshes <= 6, `wilderness cost ${withWild - without} calls`);
    assert(withWild <= 30, `an empty XL yard should be cheap, got ${withWild} calls`);
    world.setYardTier('S', { animate: false });
    world.renderer.render(world.scene, world.camera);
    assert(world.renderer.info.render.calls <= 30, 'an empty S yard is cheap too');
    assertEq(world.decorSpots.length, 2, 'spots shrink with the tier');
  });
});

test('v7 world: wild props inside a bigger yard sink away (animated), and onYardChange reports spots + clearance', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto', yardTier: 'S' }, async world => {
    const s0 = world.wildInfo();
    assertEq([s0.clearance, s0.visible === s0.items, s0.animating], [engine.wildClearance('S'), true, false]);
    const seen = [];
    world.onYardChange(i => seen.push(i));
    world.setYardTier('XL', { animate: true });
    assertEq([seen.length, seen[0].tier, seen[0].decorSpots, seen[0].wildClearance], [1, 'XL', 8, engine.wildClearance('XL')]);
    assert(world.wildInfo().animating, 'sink animation running');
    assert(world.wildInfo().visible < s0.visible, 'props inside the new fence are on their way out');
    await frames(world, 3);
    await wait(1300);
    await frames(world, 3);
    const s1 = world.wildInfo();
    assert(!s1.animating, 'animation finished');
    const hidden = s0.visible - s1.visible;
    assert(hidden >= 5 && hidden < s0.items * 0.4, `a handful of props sank, got ${hidden} of ${s0.items}`);
    // going back to a smaller yard grows them again; an instant switch has no animation
    world.setYardTier('S', { animate: false });
    assertEq(world.wildInfo().visible, s0.visible, 'back at S everything is there again');
    assert(!world.wildInfo().animating);
  });
});

test('v7 world: one finger pans (clamped), small moves stay taps, double tap re-centres, wheel zoom is bounded', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  const host = document.createElement('div');
  host.style.cssText = 'width:360px;height:420px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const taps = [], grounds = [];
  const world = engine.createWorld(host, { onTap: id => taps.push(id), onTapGround: p => grounds.push(p) }, { quality: 'low', yardTier: 'XL' });
  try {
    const { THREE: T } = world;
    const g = new T.Group();
    const body = new T.Mesh(new T.SphereGeometry(0.4, 8, 6), new T.MeshBasicMaterial({ color: 0xff8844 }));
    body.position.y = 0.4;
    g.add(body);
    g.position.set(1, 0, 1);
    world.addActor('pet:1', g, { radius: 0.5, height: 0.8 });
    assertEq(world.canvas.style.touchAction, 'none', 'one-finger gestures must not scroll the page');
    world.setView({ zoom: 0.56 });
    await frames(world, 4);
    const rect = world.canvas.getBoundingClientRect();
    const fire = (type, x, y, id = 1) => world.canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', clientX: rect.left + x, clientY: rect.top + y, bubbles: true, button: 0,
    }));
    const drag = (x0, y0, x1, y1, id = 1, steps = 10) => {
      fire('pointerdown', x0, y0, id);
      for (let i = 1; i <= steps; i++) fire('pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, id);
      fire('pointerup', x1, y1, id);
    };
    const settle = () => frames(world, 25);

    // a drag on empty ground pans: finger left/up -> the target moves +x / +z
    drag(250, 300, 150, 240);
    let pan = world.getPan();
    assert(pan.x > 0.5 && pan.z > 0.3, `dragging left/up should move the target +x/+z, got ${JSON.stringify(pan)}`);
    assertEq([taps.length, grounds.length], [0, 0], 'a drag is never a tap');
    assert(Math.abs(world.getView().pan.x - pan.x) < 1e-9, 'getView reports the pan');

    // a drag that STARTS on a pet still pans and does not tap it (the camera follows the pan, so project again)
    world.setPan(0, 0);
    await settle();
    const petScreen = world.worldToScreen(new T.Vector3(1, 0.4, 1));
    drag(petScreen.x, petScreen.y, petScreen.x - 60, petScreen.y, 2);
    assertEq(taps.length, 0, 'dragging from a pet is not a tap');
    assert(world.getPan().x > 0.3, 'pan moved');

    // threshold: a few px of finger travel stays a tap and does not pan
    world.setPan(0, 0);
    await settle();
    const ps = world.worldToScreen(new T.Vector3(1, 0.4, 1));
    fire('pointerdown', ps.x, ps.y, 3); fire('pointermove', ps.x + 5, ps.y + 4, 3); fire('pointerup', ps.x + 5, ps.y + 4, 3);
    assertEq(taps, ['pet:1'], 'a wobbly tap on a pet still taps it');
    assertEq(world.getPan(), { x: 0, z: 0 }, 'and does not pan');

    // pan is clamped to the island radius
    for (let k = 0; k < 4; k++) drag(340, 200, 5, 200, 4 + k, 30);
    pan = world.getPan();
    assert(Math.hypot(pan.x, pan.z) <= world.islandRadius + 1e-9, `pan ${Math.hypot(pan.x, pan.z)} beyond island ${world.islandRadius}`);
    assert(Math.hypot(pan.x, pan.z) > world.islandRadius - 0.01, 'and it does reach the edge');
    world.setYardTier('S', { animate: false });
    assert(Math.hypot(world.getPan().x, world.getPan().z) <= world.islandRadius + 1e-9, 'a smaller yard pulls the pan back inside');

    // double tap on empty ground re-centres, and only the first tap reaches onTapGround
    world.setYardTier('XL', { animate: false });
    world.setPan(3, 2);
    await settle();
    grounds.length = 0;
    fire('pointerdown', 40, 390, 10); fire('pointerup', 40, 390, 10);
    fire('pointerdown', 44, 388, 11); fire('pointerup', 44, 388, 11);
    assertEq(world.getPan(), { x: 0, z: 0 }, 'double tap re-centred');
    assert(grounds.length <= 1, 'second tap of a double tap is swallowed');
    // double tap ON a pet is two ordinary taps (the per-pet gift flow needs both)
    await settle();
    const pp = world.worldToScreen(new T.Vector3(1, 0.4, 1));
    taps.length = 0;
    fire('pointerdown', pp.x, pp.y, 12); fire('pointerup', pp.x, pp.y, 12);
    fire('pointerdown', pp.x, pp.y, 13); fire('pointerup', pp.x, pp.y, 13);
    assertEq(taps, ['pet:1', 'pet:1'], 'two taps on a pet stay two taps');

    // wheel zoom stays inside the bounds, both ways
    for (let i = 0; i < 40; i++) world.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
    assertEq(world.getView().zoom, engine.ZOOM_MAX);
    for (let i = 0; i < 80; i++) world.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
    assertEq(world.getView().zoom, engine.ZOOM_MIN);
  } finally {
    world.dispose();
    host.remove();
  }
});

test('v7 world: mouse right-drag and shift-drag still orbit, without panning', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'low', yardTier: 'M' }, async world => {
    await frames(world, 3);
    const rect = world.canvas.getBoundingClientRect();
    const fire = (type, x, y, extra = {}) => world.canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'mouse', clientX: rect.left + x, clientY: rect.top + y, bubbles: true, ...extra,
    }));
    const yaw0 = world.getView().yaw;
    fire('pointerdown', 100, 200, { button: 2 });
    for (let i = 1; i <= 8; i++) fire('pointermove', 100 + i * 10, 200, { button: 2 });
    fire('pointerup', 180, 200, { button: 2 });
    assert(Math.abs(world.getView().yaw - yaw0) > 0.3, 'yaw changed');
    assertEq(world.getPan(), { x: 0, z: 0 }, 'no pan');
    const yaw1 = world.getView().yaw;
    fire('pointerdown', 100, 200, { button: 0, shiftKey: true });
    for (let i = 1; i <= 8; i++) fire('pointermove', 100 - i * 10, 200, { button: 0, shiftKey: true });
    fire('pointerup', 20, 200, { button: 0, shiftKey: true });
    assert(world.getView().yaw > yaw1 + 0.3, 'shift-drag orbits');
    assertEq(world.getPan(), { x: 0, z: 0 });
  });
});

// ---------------------------------------------------------------- V8: pet strokes

test('v8 strokeRegion: head on top, chin on the lower front, back elsewhere; billboards split vertically', () => {
  const dims = { height: 1, radius: 0.5 };
  assertEq(engine.strokeRegion(0.9, 0, dims), 'head');
  assertEq(engine.strokeRegion(0.9, -0.3, dims), 'head', 'the top is the head from any side');
  assertEq(engine.strokeRegion(0.5, 0.3, dims), 'chin', 'lower front');
  assertEq(engine.strokeRegion(0.5, -0.3, dims), 'back', 'same height behind = back');
  assertEq(engine.strokeRegion(0.1, 0.4, dims), 'back', 'low = body');
  assertEq(engine.strokeRegion(0.5, -0.3, { ...dims, billboard: true }), 'chin', 'billboards have no front/back');
  assertEq(engine.strokeRegion(0.8, 0.3, { ...dims, headY: 0.9 }), 'chin', 'custom head anchor');
  assertEq(engine.strokeRegion(0.95, 0, { ...dims, headY: 0.9 }), 'head');
  assert(engine.STROKE_MIN_SESSION_MS === 600 && engine.STROKE_FAST_PX_S > 100);
});

test('v8 world: a press that starts on a pet and moves is a stroke (never a pan or a tap); ground drags still pan', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  const host = document.createElement('div');
  host.style.cssText = 'width:360px;height:420px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const taps = [], grounds = [];
  const world = engine.createWorld(host, { onTap: id => taps.push(id), onTapGround: p => grounds.push(p) }, { quality: 'low', yardTier: 'M' });
  try {
    const { THREE: T } = world;
    const mk = (id, x, z, opts) => {
      const g = new T.Group();
      const body = new T.Mesh(new T.SphereGeometry(0.5, 10, 8), new T.MeshBasicMaterial({ color: 0xff8844 }));
      body.position.y = 0.5;
      g.add(body);
      g.position.set(x, 0, z);
      world.addActor(id, g, { radius: 0.5, height: 1, ...opts });
      return g;
    };
    mk('pet:1', 1, 1);
    mk('nest-0', -2, 1, { stroke: false });
    world.setView({ zoom: 0.5 });
    await frames(world, 40);
    const rect = world.canvas.getBoundingClientRect();
    const fire = (type, x, y, id = 1, extra = {}) => world.canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', clientX: rect.left + x, clientY: rect.top + y, bubbles: true, button: 0, ...extra,
    }));
    const at = (x, y, z) => world.worldToScreen(new T.Vector3(x, y, z));
    const events = [];

    // nobody listens yet: the same drag from a pet pans (backwards compatible)
    let s = at(1, 0.5, 1);
    fire('pointerdown', s.x, s.y, 1);
    for (let i = 1; i <= 8; i++) fire('pointermove', s.x - i * 8, s.y, 1);
    fire('pointerup', s.x - 64, s.y, 1);
    assert(world.getPan().x > 0.3, 'no stroke listener -> pan');
    world.setPan(0, 0);
    await frames(world, 40);

    const off = world.onPetStroke(e => events.push(e));
    s = at(1, 0.5, 1);
    fire('pointerdown', s.x, s.y, 2);
    assertEq(events.length, 0, 'nothing before the finger moves');
    fire('pointermove', s.x + 3, s.y, 2);
    assertEq(events.length, 0, 'under 8 px is not a stroke yet');
    for (let i = 1; i <= 10; i++) { fire('pointermove', s.x + 3 + i * 4, s.y - i, 2); await wait(12); }
    fire('pointerup', s.x + 43, s.y - 10, 2);
    assertEq(events.map(e => e.phase).filter((p, i, a) => a.indexOf(p) === i), ['start', 'move', 'end']);
    assertEq(events[0].phase, 'start');
    assertEq(events.at(-1).phase, 'end');
    assert(events.every(e => e.id === 'pet:1' && ['head', 'chin', 'back'].includes(e.region) && e.point && e.point.isVector3), 'events carry id, region, point');
    assert(events.slice(1).every(e => e.speed > 0) && events.at(-1).durationMs > 50 && events[0].durationMs === 0, 'speed and duration');
    assertEq(world.getPan(), { x: 0, z: 0 }, 'a stroke never pans');
    assertEq([taps.length, grounds.length], [0, 0], 'and is never a tap');

    // a tap (< 8 px) on the pet is still a tap and emits no stroke
    events.length = 0;
    fire('pointerdown', s.x, s.y, 3); fire('pointermove', s.x + 4, s.y + 3, 3); fire('pointerup', s.x + 4, s.y + 3, 3);
    assertEq([taps, events.length], [['pet:1'], 0]);

    // a drag from empty ground still pans even with a listener
    world.setPan(0, 0);
    await frames(world, 40);
    fire('pointerdown', 300, 380, 4);
    for (let i = 1; i <= 8; i++) fire('pointermove', 300 - i * 10, 380, 4);
    fire('pointerup', 220, 380, 4);
    assert(world.getPan().x > 0.5 && events.length === 0, 'ground drag pans, no stroke');

    // an actor that opted out ({ stroke:false }) pans too
    world.setPan(0, 0);
    await frames(world, 40);
    const n = at(-2, 0.5, 1);
    fire('pointerdown', n.x, n.y, 5);
    for (let i = 1; i <= 8; i++) fire('pointermove', n.x - i * 6, n.y, 5);
    fire('pointerup', n.x - 48, n.y, 5);
    assert(world.getPan().x > 0.2 && events.length === 0, 'opted-out actor: pan');

    // regions: pressing the top of the pet is the head, the lower body the back
    world.setPan(0, 0);
    await frames(world, 40);
    const press = async (wy, wz = 1) => {
      const q = at(1, wy, wz);
      events.length = 0;
      fire('pointerdown', q.x, q.y, 6);
      for (let i = 1; i <= 3; i++) fire('pointermove', q.x + i * 4, q.y, 6);
      fire('pointerup', q.x + 12, q.y, 6);
      return events[0] && events[0].region;
    };
    assertEq(await press(0.95), 'head', 'top of the sphere');
    assertEq(await press(0.05, 1.45), 'chin', 'lower front while the pet faces the camera');
    world.getActor('pet:1').object.rotation.y = Math.PI; // turned away: the same spot is now its back
    assertEq(await press(0.05, 1.45), 'back', 'the same spot on a pet that faces away');
    world.getActor('pet:1').object.rotation.y = 0;

    // a second finger ends the stroke (pinch takes over); pointercancel ends it too
    events.length = 0;
    s = at(1, 0.5, 1);
    fire('pointerdown', s.x, s.y, 7);
    for (let i = 1; i <= 3; i++) fire('pointermove', s.x + i * 5, s.y, 7);
    fire('pointerdown', 30, 30, 8);
    assertEq(events.at(-1).phase, 'end', 'second finger ends the stroke');
    fire('pointerup', 30, 30, 8); fire('pointerup', s.x + 15, s.y, 7);
    const ended = events.filter(e => e.phase === 'end').length;
    assertEq(ended, 1, 'exactly one end per stroke');
    events.length = 0;
    world.setPan(0, 0);
    await frames(world, 40);
    s = at(1, 0.5, 1);
    fire('pointerdown', s.x, s.y, 9);
    for (let i = 1; i <= 3; i++) fire('pointermove', s.x + i * 5, s.y, 9);
    fire('pointercancel', s.x + 15, s.y, 9);
    assertEq(events[0].phase, 'start');
    assertEq(events.at(-1).phase, 'end');

    // removing the actor mid-stroke still ends cleanly; unsubscribing stops delivery
    events.length = 0;
    world.setPan(0, 0);
    await frames(world, 40);
    s = at(1, 0.5, 1);
    fire('pointerdown', s.x, s.y, 10);
    for (let i = 1; i <= 3; i++) fire('pointermove', s.x + i * 5, s.y, 10);
    world.removeActor('pet:1');
    fire('pointermove', s.x + 25, s.y, 10);
    fire('pointerup', s.x + 25, s.y, 10);
    assertEq(events.at(-1).phase, 'end');
    off();
    const n0 = events.length;
    s = at(-2, 0.5, 1);
    fire('pointerdown', s.x, s.y, 11); fire('pointermove', s.x + 30, s.y, 11); fire('pointerup', s.x + 30, s.y, 11);
    assertEq(events.length, n0, 'unsubscribed');
  } finally {
    world.dispose();
    host.remove();
  }
});

// ---------------------------------------------------------------- v9: weather + snapshot (CONTRACT_V9 §2, §4)

test('v9 weather maths: targets, light multipliers, puddle layout (deterministic, clear of obstacles, inside the yard)', () => {
  assertEq(engine.weatherTargets('sunny', 1), { cloud: 0, rain: 0 });
  const cl = engine.weatherTargets('cloudy', 0.5);
  assert(cl.rain === 0 && cl.cloud > 0.4 && cl.cloud < 1, 'cloudy has cloud, no rain');
  const rn = engine.weatherTargets('rain', 0.8);
  assertEq([rn.cloud, rn.rain], [1, 0.8]);
  assert(engine.weatherTargets('rain', 0).rain >= 0.15, 'rain never targets nothing');
  assertEq(engine.weatherTargets('rain', NaN).rain, 1, 'junk intensity -> full');
  const dry = engine.weatherLight(0, 0), wet = engine.weatherLight(1, 1);
  assertEq(dry, { hemi: 1, sun: 1, grey: 0 });
  assert(wet.hemi < 1 && wet.sun < wet.hemi && wet.hemi > 0.5 && wet.sun > 0.2 && wet.grey > 0, 'storm is dimmer, sun most');
  const obs = [{ x: 0, z: -4, r: 2 }, { x: 3, z: 0, r: 0.5 }];
  const a = engine.puddleLayout(5, obs), b = engine.puddleLayout(5, obs);
  assertEq(a, b, 'deterministic');
  assert(a.length >= 4 && a.length <= 6, `got ${a.length} puddles`);
  for (const p of a) {
    assert(Math.hypot(p.x, p.z) + p.r < 5, 'inside the yard');
    assert(obs.every(o => Math.hypot(o.x - p.x, o.z - p.z) > o.r + p.r), 'clear of obstacles');
  }
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) > a[i].r + a[j].r, 'puddles do not overlap');
});

test('v9 world: rain = one streak mesh + one puddle mesh (<= 2 draw calls), none when dry; sky and lights go grey and come back', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto', yardTier: 'XL' }, async (world, host) => {
    assertEq(world.getWeather(), { kind: 'sunny', intensity: 1 });
    world.setHour(12);   // V20: a fixed time of day, so only the weather changes the sky here
    const drySky = host.style.getPropertyValue('--world-sky-top');
    await frames(world, 3);
    world.renderer.render(world.scene, world.camera);
    const dryCalls = world.renderer.info.render.calls;
    const dryHemi = world.lights.hemi.intensity;
    assertEq([world.weatherInfo().meshes, world.weatherInfo().drops], [0, 0], 'dry costs nothing');
    assert(world.puddles.length >= 4, 'puddle places exist even when dry');
    world.setWeather('rain', 1);
    await wait(4500); // ease (~2.5 s time constant is 1/0.9 s) at idle fps
    await frames(world, 3);
    const info = world.weatherInfo();
    assert(info.rain > 0.9 && info.meshes === 2 && info.drops > 50 && info.puddles >= 4, `rain not in full swing: ${JSON.stringify(info)}`);
    world.renderer.render(world.scene, world.camera);
    assert(world.renderer.info.render.calls - dryCalls <= 2, `rain cost ${world.renderer.info.render.calls - dryCalls} draw calls`);
    assert(world.lights.hemi.intensity < dryHemi * 0.95, 'lights dimmer');
    assert(host.style.getPropertyValue('--world-sky-top') !== drySky, 'sky tinted grey through the host custom property');
    // puddles never overlap the barn or props
    for (const p of world.puddles) assert(world.obstacles.every(o => Math.hypot(o.x - p.x, o.z - p.z) > o.r + p.r), 'puddle clear of obstacles');
    world.setWeather('sunny');
    await wait(6000);
    await frames(world, 3);
    assertEq([world.weatherInfo().meshes, host.style.getPropertyValue('--world-sky-top')], [0, drySky], 'dry again, sky restored');
    assert(Math.abs(world.lights.hemi.intensity - dryHemi) < 0.05, 'lights back to normal');
    world.setYardTier('S', { animate: false });
    const small = world.puddles;
    assert(small.every(p => Math.hypot(p.x, p.z) < world.walkRadius), 'puddles follow the yard tier');
  });
});

test('v9 world: snapshot renders one frame at the requested size (JPEG), restores the live size and never throws on bad input', async () => {
  if (!hasGL()) { console.log('PASS note: no WebGL, skipped'); return; }
  await withWorld({ quality: 'auto' }, async (world, host) => {
    await frames(world, 3);
    const w0 = world.canvas.width, h0 = world.canvas.height, aspect0 = world.camera.aspect;
    const url = await world.snapshot({ width: 640, height: 360, hideUi: true });
    assert(url.startsWith('data:image/jpeg;base64,') && url.length > 2000, 'a real JPEG data url');
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    assertEq([img.naturalWidth, img.naturalHeight], [640, 360]);
    assertEq([world.canvas.width, world.canvas.height, world.camera.aspect], [w0, h0, aspect0], 'live size restored');
    assert(!host.classList.contains('world3d-snapshot'), 'host class removed');
    const png = await world.snapshot({ width: 100, height: 100, type: 'image/png' });
    assert(png.startsWith('data:image/png'), 'png on request');
    const odd = await world.snapshot({ width: 'x', height: -5 });
    assert(odd.startsWith('data:image/jpeg'), 'junk sizes fall back to a sane size');
    // a hidden UI helper is not part of the picture, and is visible again afterwards
    const helper = new world.THREE.Mesh(new world.THREE.BoxGeometry(1, 1, 1), new world.THREE.MeshBasicMaterial({ color: 0xff00ff }));
    helper.name = 'ui-marker'; helper.position.set(0, 1, 2);
    world.scene.add(helper);
    await world.snapshot({ width: 160, height: 90, hideUi: true });
    assert(helper.visible, 'ui helper visible again');
    world.scene.remove(helper);
  });
  const host = document.createElement('div');
  host.style.cssText = 'width:200px;height:200px;position:fixed;left:0;top:0;';
  document.body.appendChild(host);
  const w = engine.createWorld(host, {}, { quality: 'auto' });
  w.dispose();
  host.remove();
  let failed = false;
  await w.snapshot({ width: 100, height: 100 }).catch(() => { failed = true; });
  assert(failed, 'a disposed world rejects instead of hanging');
});

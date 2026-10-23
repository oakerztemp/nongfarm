// 3D world tests (Coder A, CONTRACT_V4): util.morph skip, prefs, pure engine helpers, fx helpers, and a WebGL smoke test.
import { test, assert, assertEq } from './harness.js';
import { morph } from '../js/util.js';
import {
  getBarnViewPref, setBarnViewPref, getQualityPref, setQualityPref, onPrefChange,
} from '../js/prefs.js';
import * as engine from '../js/world3d/engine.js';
import * as fx from '../js/world3d/fx.js';
import { openSettings } from '../js/ui/settings.js';

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

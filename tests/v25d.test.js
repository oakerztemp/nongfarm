// V25 coder D tests (CONTRACT_V25 s3): path border, path lights, sign board (draw calls, avoid circles, night glow, texture swap, dispose).
import { test, assert, assertEq } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { buildPathBorder, buildPathLights, buildSignBoard } from '../js/world3d/buildings.js';

const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();

const meshesOf = g => { const out = []; g.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
const PATHS = [
  { id: 'a', points: [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 0, z: 8 }], width: 0.9 },
  { id: 'b', points: [{ x: 0, z: 4 }, { x: 3, z: 5 }, { x: 6, z: 5 }], width: 0.8 },
];
const posOf = (im, i) => { const m = new THREE.Matrix4(); im.getMatrixAt(i, m); return new THREE.Vector3().setFromMatrixPosition(m); };
const countOf = g => meshesOf(g).reduce((s, m) => s + m.count, 0);

test('v25d border: <= 2 draw calls, flowers + pebbles on high, pebbles only on low, medium sparser', () => {
  const hi = buildPathBorder(THREE, PATHS, { gradient, tier: 'high', seed: 3 });
  const lo = buildPathBorder(THREE, PATHS, { gradient, tier: 'low', seed: 3 });
  const md = buildPathBorder(THREE, PATHS, { gradient, tier: 'medium', seed: 3 });
  try {
    const mh = meshesOf(hi), ml = meshesOf(lo);
    assertEq(mh.length, 2, 'high meshes');
    assertEq(ml.length, 1, 'low meshes');
    assertEq(ml[0].name, 'path-border-pebbles', 'low is pebbles');
    assert(mh.every(m => m.isInstancedMesh && m.count > 0), 'instanced, non-empty');
    assert(countOf(md) < countOf(hi) * 0.7, `medium is sparser (${countOf(md)} vs ${countOf(hi)})`);
  } finally { hi.dispose(); lo.dispose(); md.dispose(); }
});

test('v25d border: nothing inside avoid circles, near path ends or junction body', () => {
  const avoid = [{ x: 0.8, z: 2, r: 1.2 }, { x: -1, z: 6, r: 0.9 }];
  const g = buildPathBorder(THREE, PATHS, { gradient, tier: 'high', avoid, seed: 7 });
  const free = buildPathBorder(THREE, PATHS, { gradient, tier: 'high', seed: 7 });
  try {
    for (const im of meshesOf(g)) for (let i = 0; i < im.count; i++) {
      const p = posOf(im, i);
      for (const c of avoid) assert(Math.hypot(p.x - c.x, p.z - c.z) >= c.r - 1e-6, `inside avoid at ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
    }
    assert(countOf(g) > 0 && countOf(g) < countOf(free), `avoid removed items (${countOf(g)} < ${countOf(free)})`);
    for (const im of meshesOf(free)) for (let i = 0; i < im.count; i++) {
      const p = posOf(im, i);
      for (const e of [{ x: 0, z: 0 }, { x: 0, z: 8 }, { x: 6, z: 5 }]) assert(Math.hypot(p.x - e.x, p.z - e.z) >= 0.3, 'too near a path end');
      // path b joins path a at (0,4): nothing of a's border within 0.8 of b's centre line, and vice versa
      assert(!(Math.abs(p.x) < 0.5 && p.z > 3.7 && p.z < 4.3), 'junction blocked');
    }
  } finally { g.dispose(); free.dispose(); }
});

test('v25d border: deterministic for a seed, empty input is safe', () => {
  const a = buildPathBorder(THREE, PATHS, { gradient, seed: 5 }), b = buildPathBorder(THREE, PATHS, { gradient, seed: 5 });
  const e = buildPathBorder(THREE, [], { gradient });
  try {
    assertEq(JSON.stringify(a.userData.counts), JSON.stringify(b.userData.counts), 'same counts');
    assertEq(meshesOf(e).length, 0, 'no meshes for no paths');
  } finally { a.dispose(); b.dispose(); e.dispose(); }
});

test('v25d lights: 2 meshes (high) / 1 (low), glow hidden by day and visible at night', () => {
  const spots = [{ x: 1, z: 1 }, { x: -1, z: 2 }, { x: 2, z: -3 }];
  const hi = buildPathLights(THREE, spots, { gradient, tier: 'high' });
  const lo = buildPathLights(THREE, spots, { gradient, tier: 'low' });
  const none = buildPathLights(THREE, [], { gradient });
  try {
    assertEq(meshesOf(hi.group).length, 2, 'high meshes');
    assertEq(meshesOf(lo.group).length, 1, 'low meshes');
    const glow = hi.group.getObjectByName('path-light-glow');
    assert(glow && glow.count === 3, 'glow instanced per lamp');
    assert(glow.visible === false, 'hidden by day');
    hi.setNight(true);
    assert(glow.visible === true, 'visible at night');
    const before = Array.from(glow.instanceColor.array);
    hi.update(0.016, 1.3);
    assert(Array.from(glow.instanceColor.array).some((v, i) => v !== before[i]), 'flickers');
    for (const v of glow.instanceColor.array) assert(v > 0.5 && v <= 1.01, `flicker range ${v}`);
    hi.setNight(false);
    assert(glow.visible === false, 'hidden again');
    const posts = lo.group.getObjectByName('path-light-posts');
    const e0 = posts.material.emissiveIntensity;
    lo.setNight(true); lo.update(0.016, 1);
    assert(posts.material.emissiveIntensity > e0, 'low warms the lantern');
    assertEq(none.group.children.length, 0, 'no spots, no meshes');
  } finally { hi.dispose(); lo.dispose(); none.dispose(); }
});

test('v25d sign: <= 2 draw calls, setTexture swaps the map, face in front', () => {
  const s = buildSignBoard(THREE, { gradient });
  try {
    assertEq(meshesOf(s.group).length, 2, 'draw calls');
    assertEq(s.radius, 0.6, 'radius');
    assert(s.height > 1 && s.height < 2, `height ${s.height}`);
    const face = s.group.getObjectByName('signboard-face');
    assertEq(face.material.map, null, 'plain wood when no texture');
    const tex = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    s.setTexture(tex);
    assertEq(face.material.map, tex, 'map set');
    s.setTexture(null);
    assertEq(face.material.map, null, 'map cleared');
    assert(new THREE.Box3().setFromObject(face).min.z > 0.02, 'face in front of the board');
    const w = buildSignBoard(THREE, { gradient, tier: 'low', texture: tex });
    assertEq(w.group.getObjectByName('signboard-face').material.map, tex, 'initial texture');
    w.dispose();
  } finally { s.dispose(); }
});

test('v25d dispose: geometries and materials freed for border, lights and sign', () => {
  const lights = buildPathLights(THREE, [{ x: 0, z: 0 }, { x: 1, z: 1 }], { gradient });
  const sign = buildSignBoard(THREE, { gradient });
  const border = buildPathBorder(THREE, PATHS, { gradient });
  for (const [name, group, dispose] of [['border', border, () => border.dispose()], ['lights', lights.group, () => lights.dispose()], ['sign', sign.group, () => sign.dispose()]]) {
    const res = [];
    group.traverse(m => { if (m.isMesh) res.push(m.geometry, m.material); });
    assert(res.length > 0, `${name}: has resources`);
    let disposed = 0;
    for (const x of res) x.addEventListener('dispose', () => { disposed++; });
    dispose();
    assertEq(disposed, res.length, `${name}: all disposed`);
    assertEq(group.children.length, 0, `${name}: emptied`);
  }
});

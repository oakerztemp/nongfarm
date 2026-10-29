// V23 coder D tests (CONTRACT_V23 s5): the cottage kitchen (draw calls, footprint, smoke, dispose) and the dirt path ribbon.
import { test, assert, assertEq } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { buildKitchen, buildPathMesh } from '../js/world3d/buildings.js';

const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();

const visibleMeshes = g => { const out = []; g.traverse(o => { if (o.isMesh && o.visible) out.push(o); }); return out; };
const tris = m => { const g = m.geometry; return (g.index ? g.index.count : g.attributes.position.count) / 3; };

test('v23d kitchen: builds on every tier, <= 3 body draw calls + 1 smoke (low: no smoke), door faces +z', () => {
  for (const tier of ['high', 'medium', 'low']) {
    const k = buildKitchen(THREE, { gradient, tier });
    try {
      const vis = visibleMeshes(k.group);
      const smoke = vis.filter(m => m.isInstancedMesh);
      const body = vis.filter(m => !m.isInstancedMesh);
      assert(body.length <= 3, `${tier}: body draw calls ${body.length}`);
      assertEq(smoke.length, tier === 'low' ? 0 : 1, `${tier}: smoke meshes`);
      assert(vis.length <= 4, `${tier}: total ${vis.length}`);
      assertEq(k.radius, 1.1, 'radius');
      assert(k.height > 1 && k.doorLocal.z > 0.5 && k.chimneyLocal.y >= k.height - 0.2, 'door on +z, chimney on top');
      assertEq(k.info().hasSmoke, tier !== 'low', `${tier}: info`);
    } finally { k.dispose(); }
  }
});

test('v23d kitchen: footprint stays inside radius 1.1 in x / z', () => {
  const k = buildKitchen(THREE, { gradient, tier: 'high' });
  try {
    k.group.updateMatrixWorld(true);
    for (const m of visibleMeshes(k.group)) {
      if (m.isInstancedMesh) continue;
      const bb = new THREE.Box3().setFromObject(m);
      assert(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) <= 1.1 + 1e-6, `x ${bb.min.x}..${bb.max.x}`);
      assert(Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) <= 1.1 + 1e-6, `z ${bb.min.z}..${bb.max.z}`);
      assert(bb.min.y >= -0.001, 'sits on the ground');
    }
  } finally { k.dispose(); }
});

test('v23d kitchen smoke: setCooking gives more live puffs than idle; low tier never puffs', () => {
  const run = (tier, cook) => {
    const k = buildKitchen(THREE, { gradient, tier });
    try {
      if (cook) k.setCooking(4);
      let peak = 0;
      for (let i = 0; i < 100; i++) { k.update(0.05, i * 0.05); peak = Math.max(peak, k.info().puffs); }   // 5 s
      return peak;
    } finally { k.dispose(); }
  };
  const idle = run('high', false), cooking = run('high', true);
  assert(cooking >= 5 && cooking > idle, `cooking ${cooking} vs idle ${idle}`);
  assert(run('medium', true) > run('medium', false), 'medium too');
  assertEq(run('low', true), 0, 'low: no smoke at all');
  const k = buildKitchen(THREE, { gradient, tier: 'high' });
  k.setCooking(1);
  for (let i = 0; i < 400; i++) k.update(0.05, i * 0.05);                                                  // 20 s later everything has faded out or is an idle puff
  assert(k.info().puffs <= 3, `calm again (${k.info().puffs})`);
  k.dispose();
});

test('v23d kitchen night: the halo shows only at night; dispose frees geometries and materials', () => {
  const k = buildKitchen(THREE, { gradient, tier: 'high' });
  const n0 = visibleMeshes(k.group).length;
  k.setNight(true);
  assertEq(visibleMeshes(k.group).length, n0 + 1, 'halo at night');
  k.setNight(false);
  assertEq(visibleMeshes(k.group).length, n0, 'no halo by day');
  const geos = [], mats = [];
  k.group.traverse(o => { if (o.isMesh) { geos.push(o.geometry); mats.push(o.material); } });
  let disposed = 0;
  for (const x of [...geos, ...mats]) x.addEventListener('dispose', () => { disposed++; });
  k.dispose();
  assertEq(disposed, geos.length + mats.length, 'every geometry and material disposed');
  assertEq(k.group.children.length, 0, 'group emptied');
});

test('v23d path mesh: one Mesh, y near 0.015, width respected, rounded ends, noPick, no cast', () => {
  const line = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }];
  const m = buildPathMesh(THREE, [line, [{ x: -2, z: -2 }, { x: -2, z: 2 }]], { width: 0.9 });
  try {
    assert(m.isMesh && !m.isGroup, 'a single Mesh');
    assertEq(m.userData.noPick, true, 'noPick');
    assertEq(m.castShadow, false, 'does not cast');
    assertEq(m.receiveShadow, true, 'receives');
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) assert(Math.abs(p.getY(i) - 0.015) < 0.005, `y ${p.getY(i)}`);
    const bb = m.geometry.boundingBox;
    // second line (x = -2): total width 0.9 -> x in [-2.45, -1.55]; first line starts with a round cap behind x = 0
    assert(bb.min.x >= -2.45 - 1e-3 && bb.min.x < -2.4, `left edge ${bb.min.x}`);
    assert(bb.max.x > 4.4 && bb.max.x <= 4.45 + 1e-3, `right edge ${bb.max.x}`);
    assert(bb.min.z < -2.4 && bb.max.z > 3.4, 'caps extend past the ends');
    const a = m.geometry.attributes.color;
    assertEq(a.itemSize, 4, 'rgba vertex colours (soft edge)');
    let soft = 0, solid = 0;
    for (let i = 0; i < a.count; i++) { const al = a.getW(i); if (al === 0) soft++; else if (al === 1) solid++; }
    assert(soft > 0 && solid > 0, 'soft rim + solid centre');
    const idx = m.geometry.index;
    for (let i = 0; i < idx.count; i += 3) {                                                                  // every triangle faces up
      const A = idx.getX(i), B = idx.getX(i + 1), C = idx.getX(i + 2);
      const cy = (p.getZ(B) - p.getZ(A)) * (p.getX(C) - p.getX(A)) - (p.getX(B) - p.getX(A)) * (p.getZ(C) - p.getZ(A));
      assert(cy >= -1e-9, 'face up');
    }
  } finally { m.geometry.dispose(); m.material.dispose(); }
});

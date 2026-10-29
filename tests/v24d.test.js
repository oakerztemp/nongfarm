// V24 coder D tests (CONTRACT_V24 s2): mailbox / notice board / bench models (draw calls, footprint, dispose) and the mailbox flag.
import { test, assert, assertEq } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { buildMailbox, buildNoticeBoard, buildBench } from '../js/world3d/buildings.js';

const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();

const visibleMeshes = g => { const out = []; g.traverse(o => { if (o.isMesh && o.visible) out.push(o); }); return out; };
const MODELS = { mailbox: [buildMailbox, 0.35], noticeboard: [buildNoticeBoard, 0.6], bench: [buildBench, 0.7] };

test('v24d landmarks: build on every tier, <= 2 draw calls, radius as contracted, sane height', () => {
  for (const [name, [build, radius]] of Object.entries(MODELS)) {
    for (const tier of ['high', 'medium', 'low']) {
      const o = build(THREE, { gradient, tier });
      try {
        const n = visibleMeshes(o.group).length;
        assert(n >= 1 && n <= 2, `${name}/${tier}: draw calls ${n}`);
        assertEq(o.radius, radius, `${name} radius`);
        assert(o.height > 0.5 && o.height < 2, `${name} height ${o.height}`);
        assertEq(typeof o.dispose, 'function', 'dispose');
      } finally { o.dispose(); }
    }
  }
});

test('v24d landmarks: footprint stays within radius in x / z and sits on the ground', () => {
  for (const [name, [build, radius]] of Object.entries(MODELS)) {
    for (const tier of ['high', 'low']) {
      const o = build(THREE, { gradient, tier });
      try {
        o.group.updateMatrixWorld(true);
        for (const m of visibleMeshes(o.group)) {
          const bb = new THREE.Box3().setFromObject(m);
          assert(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) <= radius + 1e-6, `${name} x ${bb.min.x}..${bb.max.x}`);
          assert(Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) <= radius + 1e-6, `${name} z ${bb.min.z}..${bb.max.z}`);
          assert(bb.min.y >= -0.001, `${name} sits on the ground`);
          assert(bb.max.y <= o.height + 0.05, `${name} within declared height`);
        }
      } finally { o.dispose(); }
    }
  }
});

test('v24d landmarks: dispose frees every geometry and material and empties the group', () => {
  for (const [name, [build]] of Object.entries(MODELS)) {
    const o = build(THREE, { gradient, tier: 'high' });
    const res = [];
    o.group.traverse(m => { if (m.isMesh) res.push(m.geometry, m.material); });
    let disposed = 0;
    for (const x of res) x.addEventListener('dispose', () => { disposed++; });
    o.dispose();
    assertEq(disposed, res.length, `${name}: all disposed`);
    assertEq(o.group.children.length, 0, `${name}: group emptied`);
  }
});

test('v24d mailbox: flag rises after setFlag(true) and lowers after setFlag(false)', () => {
  const m = buildMailbox(THREE, { gradient, tier: 'high' });
  try {
    const flag = m.group.getObjectByName('mailbox-flag');
    assert(flag, 'flag mesh');
    const start = flag.rotation.x;
    assert(start < -0.5, `starts lowered (${start})`);
    m.setFlag(true);
    let prev = start;
    for (let i = 0; i < 6; i++) { m.update(0.05, i * 0.05); assert(flag.rotation.x >= prev, 'monotonic rise'); prev = flag.rotation.x; }
    assert(flag.rotation.x > start + 0.3, `moved toward up (${flag.rotation.x})`);
    for (let i = 0; i < 60; i++) m.update(0.05, i * 0.05);
    assert(Math.abs(flag.rotation.x) < 0.02, `fully up (${flag.rotation.x})`);
    m.setFlag(false);
    m.update(0.05, 0);
    assert(flag.rotation.x < -0.001, 'starts lowering');
    for (let i = 0; i < 80; i++) m.update(0.05, i * 0.05);
    assert(flag.rotation.x < -1.3, `back down (${flag.rotation.x})`);
  } finally { m.dispose(); }
});

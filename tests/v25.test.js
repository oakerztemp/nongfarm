// V25 tests (CONTRACT_V25 section 2): yard paths, fence gates and path lights.
import { test, assert, assertEq } from './harness.js';
import {
  pickTarget, makeRng, configureYard, YARD, YARD_TIER_LAYOUT, yardProps, kitchenSpot, nestSpot, cribSpot, landmarkSpots,
  yardPaths, fenceGates, pathLightSpots, PATH_LIGHT_MAX, PATH_LIGHT_R,
} from '../js/petBehaviour.js';
import * as engine from '../js/world3d/engine.js';

const TIERS = ['S', 'M', 'L', 'XL'];
const PERSONALITIES = ['hardworking', 'lazy', 'glutton', 'cheerful', 'shy', 'naughty'];

function withYard(fn) {
  const saved = JSON.stringify(YARD);
  try { return fn(); } finally { Object.assign(YARD, JSON.parse(saved)); }
}

const fenceAt = (cfg, x, z) => engine.fenceRadiusAt(cfg, Math.atan2(x, z));
const insideFence = (cfg, p, m = 0) => Math.hypot(p.x, p.z) + m <= fenceAt(cfg, p.x, p.z);
function segDist(q, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const u = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2));
  return Math.hypot(q.x - a.x - u * dx, q.z - a.z - u * dz);
}
const lineDist = (q, pts) => { let m = Infinity; for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(q, pts[i], pts[i + 1])); return m; };
const streamX = z => engine.WILD.streamX + engine.WILD.streamAmp * Math.sin(z * engine.WILD.streamFreq);
/** Index of the first point outside the fence (or points.length when the line never leaves it). */
const exitIndex = (cfg, pts) => { const i = pts.findIndex(p => !insideFence(cfg, p)); return i < 0 ? pts.length : i; };

test('v25 constants mirror the engine (fence radii, stream, decor spots)', () => {
  for (const t of TIERS) {
    // fenceGates / yardPaths were built with these radii: the gate must sit exactly on the engine fence
    const g = fenceGates(t);
    const cfg = engine.YARD_TIERS[t];
    for (const gate of g) {
      const x = Math.cos(gate.angle), z = Math.sin(gate.angle);
      // walk the ray out and find the fence radius along it
      let r = 0;
      while (r < 20 && r < fenceAt(cfg, x * r, z * r)) r += 0.001;
      const p = yardPaths(t).find(q => q.id === gate.id).points;
      const near = lineDist({ x: x * r, z: z * r }, p);
      assert(near < 0.05, `${t}/${gate.id} gate is not on the path/fence crossing (${near.toFixed(3)})`);
    }
  }
});

for (const t of TIERS) {
  test(`v25 paths ${t}: ids, finite, inside the fence except after a gate, width, ends`, () => withYard(() => {
    configureYard(t);
    const cfg = engine.YARD_TIERS[t], paths = yardPaths(t);
    const want = ['barn-bowl', 'kitchen', ...(t === 'S' ? [] : ['pond']), 'gate', 'bridge'];
    assertEq(paths.map(p => p.id), want, `${t} ids`);
    const gates = fenceGates(t);
    assertEq(gates.map(g => g.id).sort(), ['bridge', 'gate'], `${t} gates`);
    for (const p of paths) {
      assert(p.width > 0 && p.points.length >= 2, `${t}/${p.id} shape`);
      for (const q of p.points) assert(Number.isFinite(q.x) && Number.isFinite(q.z), `${t}/${p.id} finite`);
      const ex = exitIndex(cfg, p.points);
      if (p.id === 'gate' || p.id === 'bridge') {
        assert(ex > 0 && ex < p.points.length, `${t}/${p.id} must leave the fence`);
        // never comes back in
        for (let i = ex; i < p.points.length; i++) assert(!insideFence(cfg, p.points[i]), `${t}/${p.id} re-enters the fence`);
      } else {
        assertEq(ex, p.points.length, `${t}/${p.id} stays inside`);
        for (const q of p.points) assert(insideFence(cfg, q, 0.5), `${t}/${p.id} too close to the fence`);
      }
    }
    // the V23 shapes did not move
    const k = kitchenSpot(t), kp = paths.find(p => p.id === 'kitchen').points;
    assert(Math.hypot(kp[kp.length - 1].x - (k.x - 0.25), kp[kp.length - 1].z - (k.z + 0.95)) < 1e-9, `${t} kitchen door end`);
    const front = paths.find(p => p.id === 'gate').points;
    const end = front[front.length - 1], cross = front[exitIndex(cfg, front)];
    assert(end.z > 0 && Math.hypot(end.x - cross.x, end.z - cross.z) > 2.4 && Math.hypot(end.x - cross.x, end.z - cross.z) < 3.8, `${t} gate path ~3 outside`);
    // bridge ends on the +x side, ~1.2 short of the stream centre line
    const br = paths.find(p => p.id === 'bridge').points, be = br[br.length - 1];
    assert(be.x > 0, `${t} bridge on the +x side`);
    assert(Math.abs(streamX(be.z) - be.x - 1.2) < 0.05, `${t} bridge end ${be.x.toFixed(2)} vs stream ${streamX(be.z).toFixed(2)}`);
    assert(br.every(q => q.x <= be.x + 1e-9), `${t} bridge never passes the bank`);
  }));

  test(`v25 gates ${t}: match fence crossings, half width`, () => withYard(() => {
    const cfg = engine.YARD_TIERS[t];
    for (const g of fenceGates(t)) {
      assert(Number.isFinite(g.angle) && g.angle > -Math.PI - 1e-9 && g.angle <= Math.PI + 1e-9, `${t}/${g.id} angle`);
      const p = yardPaths(t).find(q => q.id === g.id);
      assert(Math.abs(g.halfWidth - (p.width / 2 + 0.25)) < 1e-9, `${t}/${g.id} half width`);
      const i = exitIndex(cfg, p.points);
      const a = p.points[i - 1], b = p.points[i];
      const lo = Math.min(Math.atan2(a.z, a.x), Math.atan2(b.z, b.x)) - 0.05, hi = Math.max(Math.atan2(a.z, a.x), Math.atan2(b.z, b.x)) + 0.05;
      assert(g.angle >= lo && g.angle <= hi, `${t}/${g.id} angle ${g.angle} not between the crossing segment ends`);
    }
    const front = fenceGates(t).find(g => g.id === 'gate'), east = fenceGates(t).find(g => g.id === 'bridge');
    assert(front.angle > 1.2 && front.angle < 1.9, `${t} front gate faces +z (${front.angle})`);
    assert(Math.abs(east.angle) < 0.7, `${t} bridge gate faces +x (${east.angle})`);
  }));

  test(`v25 paths ${t}: do not cross obstacles except at their own ends`, () => withYard(() => {
    configureYard(t);
    const k = kitchenSpot(t), lm = landmarkSpots(t);
    const solids = [
      ...yardProps(t).map(p => ({ id: p.id, x: p.x, z: p.z, r: p.r })),
      { id: 'kitchen', x: k.x, z: k.z, r: k.r },
      ...Object.entries(lm).map(([id, o]) => ({ id, x: o.x, z: o.z, r: o.r })),
      { id: 'bowl', x: YARD.bowl.x, z: YARD.bowl.z, r: 0.4 },
    ];
    for (const p of yardPaths(t)) {
      const end = p.points[p.points.length - 1];
      for (const o of solids) {
        // the pond / kitchen / bowl paths end at their own prop: the last stretch is allowed to touch it
        const ownEnd = Math.hypot(end.x - o.x, end.z - o.z) < o.r + 0.5;
        const pts = ownEnd ? p.points.slice(0, -2) : p.points;
        for (const q of pts) assert(Math.hypot(q.x - o.x, q.z - o.z) >= o.r + 0.2, `${t}/${p.id} runs into ${o.id} at (${q.x.toFixed(2)}, ${q.z.toFixed(2)})`);
      }
    }
  }));

  test(`v25 lights ${t}: count limits, inside the fence, clear (>= 0.4 edge to edge), obstacles + YARD.pathLights`, () => withYard(() => {
    configureYard(t);
    const cfg = engine.YARD_TIERS[t], lay = YARD_TIER_LAYOUT[t], L = pathLightSpots(t);
    assertEq(YARD.pathLights, L, `${t} YARD.pathLights`);
    assert(L.length === { S: 2, M: 3, L: 4, XL: 5 }[t] && L.length <= PATH_LIGHT_MAX[t], `${t} count ${L.length}`);   // V26: only the key spots
    const k = kitchenSpot(t);
    const solids = [
      ...yardProps(t).map(p => ({ id: p.id, x: p.x, z: p.z, r: p.r })),
      { id: 'kitchen', x: k.x, z: k.z, r: k.r },
      ...Object.entries(landmarkSpots(t)).map(([id, o]) => ({ id, x: o.x, z: o.z, r: o.r })),
      { id: 'bowl', x: YARD.bowl.x, z: YARD.bowl.z, r: 0.4 },
      ...engine.decorSpotsForTier(t).map(s => ({ id: `spot${s.index}`, x: s.x, z: s.z, r: 0 })),
      ...[0, 1, 2, 3, 4].map(i => ({ id: `nest${i}`, ...nestSpot(i, 5), r: 0.4 })),
      ...[0, 1, 2].map(i => ({ id: `crib${i}`, ...cribSpot(i, 5), r: 0.5 })),
    ];
    const paths = yardPaths(t);
    L.forEach((l, i) => {
      assert(Number.isFinite(l.x) && Number.isFinite(l.z), `${t} light ${i} finite`);
      assert(insideFence(cfg, l, 0.3), `${t} light ${i} at the fence`);
      for (const o of solids) assert(Math.hypot(l.x - o.x, l.z - o.z) - o.r - PATH_LIGHT_R >= 0.4 - 1e-9, `${t} light ${i} vs ${o.id}`);
      assert(l.z >= lay.barnZ + 3.0, `${t} light ${i} in the barn strip`);
      L.forEach((m, j) => { if (j > i) assert(Math.hypot(l.x - m.x, l.z - m.z) >= 3.5, `${t} lights ${i}/${j} too close`); });
      // it stands beside a path (or the front gate), not in the field
      const d = Math.min(...paths.map(p => lineDist(l, p.points)));
      assert(d >= 0.5 && d <= 1.4, `${t} light ${i} is ${d.toFixed(2)} from the nearest path`);
      assert(YARD.obstacles.some(o => o.x === l.x && o.z === l.z && o.r === PATH_LIGHT_R), `${t} light ${i} is an obstacle`);
    });
  }));

  test(`v25 lights ${t}: wander targets never land in a light`, () => withYard(() => {
    configureYard(t);
    const rng = makeRng(25 + t.length);
    for (const pers of PERSONALITIES) {
      let ax = 0.5, az = 0.5;
      for (let i = 0; i < 400; i++) {
        const c = pickTarget(rng, ax, az, [], pers === 'shy', pers);
        for (const l of YARD.pathLights) assert(Math.hypot(c.x - l.x, c.z - l.z) > PATH_LIGHT_R + 0.3, `${t}/${pers} target in a light`);
        ax = c.x; az = c.z;
      }
    }
  }));
}

test('v25 light counts per tier grow with the yard and are deterministic', () => {
  const counts = TIERS.map(t => pathLightSpots(t).length);
  assert(counts[0] <= 2 && counts[3] <= 5, `counts ${counts}`);
  assert(counts[3] >= counts[0], `XL has at least as many lights as S (${counts})`);
  for (const t of TIERS) assertEq(pathLightSpots(t), pathLightSpots(t), `${t} deterministic`);
  assertEq(fenceGates('XL'), fenceGates('XL'), 'gates deterministic');
});

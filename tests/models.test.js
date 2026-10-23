// 3D critter kit tests: every farm species builds, budgets, sharing, stages, shiny, billboard fallback.
import { test, assert, assertEq } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { buildPetModel, buildBillboard, hasModel, kitStats, STAGE_SCALE } from '../js/world3d/critters.js';
import { MODEL_SPECS } from '../js/data/models.js';
import { SPECIES, getSpecies } from '../js/data/species.js';

const FARM = SPECIES.filter(s => s.habitat === 'farm');
const TRI_BUDGET = 1500;

function tris(obj) {
  let t = 0;
  obj.traverse(o => { if (o.isMesh) { const g = o.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return t;
}
function materials(obj, set = new Set()) {
  obj.traverse(o => { if (o.material) set.add(o.material); });
  return set;
}
/** Set of distinct vertex colours (as "r,g,b" 3-decimals) baked into the toon meshes (or the eye mesh). */
function vertexColors(m, eyes = false) {
  const cols = new Set();
  m.root.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.color) return;
    if (o.material.isMeshToonMaterial === eyes) return;
    const a = o.geometry.attributes.color;
    for (let i = 0; i < a.count; i++) cols.add([a.getX(i), a.getY(i), a.getZ(i)].map(v => v.toFixed(3)).join(','));
  });
  return cols;
}
const drawCalls = m => { let n = 0; m.root.traverse(o => { if (o.isMesh || o.isSprite) n++; }); return n; };
const build = (id, over = {}) => buildPetModel(THREE, { speciesId: id, stage: 2, shiny: false, ...over }, getSpecies(id));

test('models: every farm-habitat species has a spec, and every spec is a farm species', () => {
  assertEq(FARM.length, 21, 'farm species count');
  for (const sp of FARM) assert(hasModel(sp.id), 'no model for ' + sp.id);
  for (const id of Object.keys(MODEL_SPECS)) assert(FARM.some(s => s.id === id), 'spec for non-farm species ' + id);
});

test('models: all 21 specs build; no NaN; finite size; head + body groups; under triangle budget', () => {
  const over = [];
  for (const sp of FARM) {
    const m = build(sp.id);
    assertEq(m.kind, 'model', sp.id + ' kind');
    assert(m.root.isGroup && m.body.isGroup && m.head && m.head.isGroup, sp.id + ' groups');
    assert(m.body.parent === m.root, sp.id + ' body is a child of root');
    assert(Number.isFinite(m.height) && m.height > 0.3 && m.height < 3, `${sp.id} height ${m.height}`);
    assert(Number.isFinite(m.radius) && m.radius > 0.1 && m.radius < 2, `${sp.id} radius ${m.radius}`);
    m.root.updateMatrixWorld(true);
    let bad = 0;
    m.root.traverse(o => {
      for (const v of [o.position, o.scale, o.quaternion]) for (const k of ['x', 'y', 'z']) if (!Number.isFinite(v[k])) bad++;
      if (o.isMesh) for (const x of o.matrixWorld.elements) if (!Number.isFinite(x)) bad++;
    });
    assertEq(bad, 0, sp.id + ' NaN transforms');
    over.push(...(tris(m.root) > TRI_BUDGET ? [`${sp.id}=${tris(m.root)}`] : []));
    // standing on the ground: lowest point of the model is ~0
    const box = new THREE.Box3().setFromObject(m.root);
    assert(Math.abs(box.min.y) < 0.05, `${sp.id} feet at y=${box.min.y}`);
  }
  assertEq(over, [], `triangles over ${TRI_BUDGET}`);
});

test('models: geometries and materials are shared across builds', () => {
  const all = new Set();
  for (const sp of FARM) materials(build(sp.id).root, all);
  assert(all.size <= 3, 'too many distinct materials for 21 species: ' + all.size);
  const before = kitStats(THREE);
  const tplBefore = before.templates;
  const a = build('cow'), b = build('cow');
  const ma = materials(a.root), mb = materials(b.root);
  assertEq([...ma].every(m => mb.has(m)), true, 'same species shares every material');
  const after = kitStats(THREE);
  assertEq(after.materials, before.materials, 'no new materials for a repeat build');
  assertEq(after.templates, tplBefore, 'no new template for a repeat build');
  assertEq(after.geometries, before.geometries, 'no new geometries for a repeat build');
  assert(after.geometries <= 20, 'unit geometry count ' + after.geometries);
  const ga = new Set(), gb = new Set();
  a.root.traverse(o => o.geometry && ga.add(o.geometry));
  b.root.traverse(o => o.geometry && gb.add(o.geometry));
  assertEq([...ga].every(g => gb.has(g)), true, 'geometries shared');
});

test('models: a custom toon gradient from the world is used by every toon material', () => {
  const grad = new THREE.DataTexture(new Uint8Array([100, 100, 100, 255, 255, 255, 255, 255]), 2, 1);
  const m = buildPetModel(THREE, { stage: 2 }, getSpecies('pig'), { toonGradient: grad });
  let toon = 0;
  m.root.traverse(o => { if (o.isMesh && o.material.isMeshToonMaterial) { toon++; assert(o.material.gradientMap === grad, 'gradient not applied'); } });
  assert(toon >= 3, 'toon meshes ' + toon);
});

test('models: stage scale 0.7 / 0.85 / 1.0 / 1.15, crown only for master', () => {
  let prev = 0;
  for (let st = 0; st < 4; st++) {
    const m = build('hamster', { stage: st });
    assertEq(m.root.scale.x, STAGE_SCALE[st], 'scale at stage ' + st);
    assertEq(m.stage, st, 'stage field');
    assert(m.height > prev, 'height grows with stage');
    prev = m.height;
    assertEq(!!m.parts.crown, st === 3, 'crown at stage ' + st);
  }
  assertEq(STAGE_SCALE.join(), '0.7,0.85,1,1.15', 'scale table');
  // body keeps scale 1 so B can squash it freely
  assertEq(build('cow', { stage: 0 }).body.scale.x, 1, 'body scale is untouched by stage');
});

test('models: shiny shifts the palette and exposes an anchor for sparkles', () => {
  for (const id of ['cow', 'hamster', 'duck']) {
    const a = build(id), b = build(id, { shiny: true });
    assertEq(b.shiny, true, 'shiny flag');
    const ca = vertexColors(a), cb = vertexColors(b);
    assert([...cb].some(c => !ca.has(c)), id + ': shiny colours are new');
    assert(a.body.children.some(c => c.geometry && c.geometry !== b.body.children.find(d => d.name === c.name)?.geometry), id + ': shiny has its own buffers');
    assert(b.anchor && b.anchor.isObject3D && b.anchor.parent === b.head, 'sparkle anchor on head');
    const ea = vertexColors(a, true), eb = vertexColors(b, true);
    assertEq([...eb].sort().join('|'), [...ea].sort().join('|'), id + ': eye colours are not shifted');
  }
  assertEq(tris(build('cow', { shiny: true }).root), tris(build('cow').root), 'shiny does not change geometry');
});

test('models: billboard fallback for species without a spec; billboard shape matches', () => {
  const dolphin = getSpecies('dolphin');
  assertEq(hasModel('dolphin'), false, 'dolphin has no model');
  const m = buildPetModel(THREE, { speciesId: 'dolphin', stage: 2 }, dolphin);
  assertEq(m.kind, 'billboard', 'kind');
  assert(m.root.isGroup && m.body.isGroup, 'root/body groups');
  assert(m.height > 0 && m.radius > 0, 'size');
  let sprites = 0;
  m.root.traverse(o => { if (o.isSprite) sprites++; });
  assertEq(sprites, 1, 'one sprite');
  const m2 = buildPetModel(THREE, { speciesId: 'dolphin', stage: 3, shiny: true }, dolphin);
  assertEq(m2.root.scale.x, 1.15, 'billboard stage scale');
  assert(!!m2.parts.crown, 'billboard crown');
  const t1 = kitStats(THREE).textures;
  buildBillboard(THREE, dolphin.emoji);
  buildBillboard(THREE, dolphin.emoji);
  assertEq(kitStats(THREE).textures, t1 + 0, 'emoji textures cached');
});

test('models: triangle counts are deterministic (same on every build, stage and shiny)', () => {
  for (const sp of FARM) {
    const t = tris(build(sp.id).root);
    assertEq(tris(build(sp.id).root), t, sp.id + ' repeat');
    assertEq(tris(build(sp.id, { stage: 0 }).root), t, sp.id + ' stage');
    assertEq(tris(build(sp.id, { shiny: true }).root), t, sp.id + ' shiny');
  }
});

test('models: draw calls per pet <= 6, one shared critter material + one eye material', () => {
  const mats = new Set();
  for (const sp of FARM) {
    for (const stage of [0, 3]) {
      const m = build(sp.id, { stage });
      const calls = drawCalls(m) - (stage === 3 ? 1 : 0); // the crown sprite is a 7th only for masters
      assert(calls <= 6, `${sp.id} uses ${calls} draw calls`);
      materials(m.root, mats);
    }
  }
  const toon = [...mats].filter(x => x.isMeshToonMaterial);
  assertEq(toon.length, 1, 'one shared toon material');
  assertEq(toon[0].vertexColors, true, 'vertex coloured');
});

test('models: merged geometry is cached per species/shiny and shared by every pet', () => {
  const a = build('cow'), b = build('cow', { stage: 0 }), c = build('cow', { stage: 3 });
  for (const n of ['bodyMesh', 'headMesh']) {
    const ga = a.root.getObjectByName(n).geometry;
    assert(ga === b.root.getObjectByName(n).geometry && ga === c.root.getObjectByName(n).geometry, n + ' not shared');
  }
  const s1 = build('cow', { shiny: true });
  assert(s1.root.getObjectByName('bodyMesh').geometry !== a.root.getObjectByName('bodyMesh').geometry, 'shiny has own buffers');
  assert(s1.root.getObjectByName('bodyMesh').geometry === build('cow', { shiny: true }).root.getObjectByName('bodyMesh').geometry, 'shiny cached');
  assert(a.root !== b.root && a.body !== b.body, 'but each pet has its own groups');
});

test('models: animated parts still exist and can be driven', () => {
  const cow = build('cow'), chicken = build('chicken'), duck = build('duck');
  for (const m of [cow, chicken, duck]) {
    assertEq(m.parts.eyes.length, 1, 'merged eyes mesh');
    assert(m.parts.eyes[0].isMesh && m.parts.eyes[0].parent === m.head, 'eyes on head');
    m.parts.eyes[0].scale.y = 0.1; // blink
    assert(m.head.isGroup && m.body.isGroup, 'head/body');
  }
  assert(cow.parts.earL && cow.parts.earR && cow.parts.ears.length === 2, 'cow ears');
  assert(cow.parts.tail && cow.parts.tail.isGroup, 'cow tail');
  assert(chicken.parts.wingL && chicken.parts.wingR, 'chicken wings');
  assert(duck.parts.wingL && duck.parts.tail, 'duck wings + tail');
  for (const g of [cow.parts.earL, cow.parts.tail, chicken.parts.wingL]) {
    assert(g.children.some(c => c.isMesh), 'animated group has geometry');
    g.rotation.z = 0.3; // wag / flap / twitch
  }
  // each pet owns its own animated groups (clone), not the cached template's
  assert(build('cow').parts.tail !== cow.parts.tail, 'tail is per pet');
  assert(cow.anchor && cow.anchor.parent === cow.head, 'anchor');
});

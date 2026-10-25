// 3D critter kit tests: every farm species builds, budgets, sharing, stages, shiny, billboard fallback.
import { test, assert, assertEq } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { buildPetModel, buildBillboard, hasModel, kitStats, STAGE_SCALE, LEGENDARY_SCALE } from '../js/world3d/critters.js';
import { MODEL_SPECS } from '../js/data/models.js';
import { SPECIES, getSpecies } from '../js/data/species.js';

const FARM = SPECIES.filter(s => s.habitat === 'farm');
const TRI_BUDGET = 1500;
const LEGEND_IDS = ['dragon', 'unicorn', 'dragonhead', 'mammoth', 'lion', 'panda', 'humpback', 'eagle', 'beetle', 'polarbear'];
const LEGEND_TRI_BUDGET = 1800;

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

test('models: every farm-habitat species has a spec; the only non-farm specs are the legendaries and the 15 forest friends', () => {
  assertEq(FARM.length, 21, 'farm species count');
  for (const sp of FARM) assert(hasModel(sp.id), 'no model for ' + sp.id);
  for (const id of Object.keys(MODEL_SPECS)) assert(FARM.some(s => s.id === id) || LEGEND_IDS.includes(id) || getSpecies(id).habitat === 'forest', 'unexpected spec for ' + id);
  for (const id of LEGEND_IDS) assert(hasModel(id), 'no model for ' + id);
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

const buildL = (id, over = {}) => buildPetModel(THREE, { speciesId: id, stage: 2, shiny: false, ...over }, getSpecies(id));

test('models V5: legendary six build, <= 1800 tris, <= 7 draw calls, finite, standing on the ground', () => {
  for (const id of LEGEND_IDS) {
    const m = buildL(id);
    assertEq(m.kind, 'model', id);
    const t = tris(m.root);
    assert(t <= LEGEND_TRI_BUDGET, `${id} has ${t} triangles`);
    assert(drawCalls(m) <= 7, `${id} uses ${drawCalls(m)} draw calls`);
    assert(Number.isFinite(m.height) && m.height > 0.5 && m.height < 3.5, `${id} height ${m.height}`);
    assert(Number.isFinite(m.radius) && m.radius > 0.2, `${id} radius`);
    m.root.updateMatrixWorld(true);
    let bad = 0;
    m.root.traverse(o => { if (o.isMesh) for (const x of o.matrixWorld.elements) if (!Number.isFinite(x)) bad++; });
    assertEq(bad, 0, id + ' NaN');
    const box = new THREE.Box3().setFromObject(m.root);
    assert(Math.abs(box.min.y) < 0.08, `${id} feet at y=${box.min.y}`);
  }
});

test('models V5: rarity + legendary flag; legendary root scale is x1.25 on top of the stage scale', () => {
  for (const id of ['dragon', 'unicorn', 'lion', 'panda', 'humpback', 'eagle', 'beetle', 'polarbear']) {
    for (let st = 0; st < 4; st++) {
      const m = buildL(id, { stage: st });
      assertEq(m.legendary, true, id + ' legendary');
      assertEq(m.rarity, 'legendary', id + ' rarity');
      assertEq(m.stageScale, STAGE_SCALE[st], id + ' stageScale');
      assertEq(+m.root.scale.x.toFixed(6), +(STAGE_SCALE[st] * LEGENDARY_SCALE).toFixed(6), `${id} root scale at stage ${st}`);
    }
  }
  for (const id of ['mammoth', 'dragonhead']) {
    const m = buildL(id);
    assertEq(m.legendary, false, id + ' is epic, not legendary');
    assertEq(m.rarity, 'epic', id + ' rarity');
    assertEq(m.root.scale.x, 1, id + ' scale');
  }
  const cow = build('cow');
  assertEq([cow.legendary, cow.rarity], [false, 'common'], 'farm pets are not legendary');
  assert(buildL('dragon').height > buildL('dragonhead').height, 'dragon is bigger than the chibi dragon');
});

test('models V5: new animated parts are exposed and drivable (wings, tail tip, trunk, mane, breath anchor)', () => {
  const dragon = buildL('dragon'), uni = buildL('unicorn'), mam = buildL('mammoth'), lion = buildL('lion'), dh = buildL('dragonhead');
  for (const m of [dragon, dh]) {
    assert(m.parts.wingL && m.parts.wingR && m.parts.wingL !== m.parts.wingR, 'bat wings');
    assert(m.parts.wingL.children.some(c => c.isMesh), 'wing has geometry');
    assert(m.parts.tail && m.parts.breath && m.parts.breath.parent === m.head, 'tail + breath anchor');
    m.parts.wingL.rotation.z = 1; m.parts.wingR.rotation.z = -1; // flap
  }
  assert(dragon.parts.tail && dragon.parts.tail.children.some(c => c.isMesh), 'dragon tail pivot (no tip pivot: keeps it at <= 7 draw calls as a master)');
  assert(uni.parts.tailTip, 'unicorn tail tip pivot');
  assert(mam.parts.trunk && mam.parts.trunk.children.some(c => c.isMesh), 'mammoth trunk pivot');
  mam.parts.trunk.rotation.x += 0.3; // swing
  assert(lion.parts.mane && lion.parts.mane.children.some(c => c.isMesh), 'lion mane pivot');
  const panda = buildL('panda');
  assert(panda.parts.mane === null && panda.parts.trunk === null, 'other species do not have them');
  for (const m of [dragon, uni, mam, lion, dh, panda]) assertEq(m.parts.eyes.length, 1, 'eyes');
});

test('models V5: curated shiny palettes (sapphire dragon, golden lion, white-gold panda); farm fallback stays gentle', () => {
  const has = (m, hex, eyes = false) => {
    const c = new THREE.Color(hex);
    return vertexColors(m, eyes).has([c.r, c.g, c.b].map(v => v.toFixed(3)).join(','));
  };
  assert(has(buildL('dragon', { shiny: true }), '#3a7bff'), 'sapphire dragon body');
  assert(!has(buildL('dragon'), '#3a7bff'), 'normal dragon is gold');
  assert(has(buildL('lion', { shiny: true }), '#ffd34a'), 'golden lion');
  assert(has(buildL('panda', { shiny: true }), '#d9a437'), 'gold panda patches');
  assert(has(buildL('unicorn', { shiny: true }), '#cdbcff'), 'galaxy unicorn');
  for (const id of LEGEND_IDS) assert(MODEL_SPECS[id].shinyPalette, id + ' has a curated shinyPalette');
  assertEq([...vertexColors(buildL('dragon', { shiny: true }), true)].join('|'), [...vertexColors(buildL('dragon'), true)].join('|'), 'eyes keep their colour');
  // farm fallback: hue shift is at most 60 degrees
  const firstHue = m => {
    const arr = m.root.getObjectByName('bodyMesh').geometry.attributes.color;
    const c = new THREE.Color(arr.getX(0), arr.getY(0), arr.getZ(0)), o = {};
    c.getHSL(o, THREE.SRGBColorSpace);
    return o.h * 360;
  };
  let d = Math.abs(firstHue(build('hamster')) - firstHue(build('hamster', { shiny: true })));
  d = Math.min(d, 360 - d);
  assert(d <= 60.5 && d > 5, 'fallback hue shift ' + d);
});

test('models V5: billboards never apply a colour filter; shiny just sets shinyStyle halo (same texture)', () => {
  // every legendary now has a model, so a made-up legendary species without a spec exercises the billboard path
  const eagle = { id: 'test_legend', emoji: '\u{1F985}', rarity: 'legendary' };
  const plain = buildPetModel(THREE, { stage: 2 }, eagle);
  const t0 = kitStats(THREE).textures;
  const shiny = buildPetModel(THREE, { stage: 2, shiny: true }, eagle);
  assertEq(kitStats(THREE).textures, t0, 'no extra (filtered) texture for shiny');
  const sprite = m => { let s = null; m.body.traverse(o => { if (o.isSprite) s = o; }); return s; };
  assert(sprite(plain).material === sprite(shiny).material, 'identical sprite material');
  assertEq([plain.shinyStyle, shiny.shinyStyle, shiny.shiny], [null, 'halo', true], 'shinyStyle');
  assertEq([shiny.legendary, shiny.rarity], [true, 'legendary'], 'legendary billboard');
  assertEq(+shiny.root.scale.x.toFixed(6), 1.25, 'legendary billboard scale');
  const epic = buildPetModel(THREE, { stage: 2 }, getSpecies('dolphin'));
  assertEq([epic.legendary, epic.rarity], [false, 'epic'], 'epic billboard');
  assertEq(build('cow', { shiny: true }).shinyStyle, 'palette', 'model shinyStyle');
});

test('models: the stage-3 crown rides on the head, just above the head-top anchor (every spec x stage, legendary or not)', () => {
  const W = o => { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); };
  for (const id of Object.keys(MODEL_SPECS)) {
    for (let st = 0; st < 4; st++) {
      const m = buildL(id, { stage: st });
      if (st < 3) { assertEq(m.parts.crown, null, `${id} crown only for master`); continue; }
      const crown = m.parts.crown;
      assert(crown.parent === m.head, id + ' crown is a child of the head');
      const a = W(m.anchor), c = W(crown), k = m.root.scale.x;
      assert(Math.hypot(c.x - a.x, c.z - a.z) / k < 0.3, `${id} crown is off the head horizontally`);
      const dy = (c.y - a.y) / k;
      assert(dy > -0.01 && dy <= 0.25, `${id} crown is ${dy.toFixed(2)} above the head top`);
      assert(m.height > c.y, id + ' height includes the crown');
      // follows head pivots
      m.head.rotation.x = 0.6; m.head.rotation.y = 0.5;
      const a2 = W(m.anchor), c2 = W(crown);
      assert(c2.distanceTo(c) > 0.001 || a2.distanceTo(a) < 0.001, id + ' crown moves with the head');
      assert(Math.hypot(c2.x - a2.x, c2.z - a2.z) / k < 0.3, `${id} crown stays on the rotated head`);
    }
  }
  for (const sid of ['shark', 'dolphin', 'deer']) {   // billboards: centred above the sprite
    const m = buildPetModel(THREE, { stage: 3 }, getSpecies(sid));
    assertEq([m.parts.crown.position.x, m.parts.crown.position.z], [0, 0], sid + ' billboard crown centred');
    const dy = m.parts.crown.position.y - m.anchor.position.y;
    assert(dy > -0.03 && dy < 0.1, `${sid} billboard crown offset ${dy}`);
  }
  for (const id of LEGEND_IDS) assert(drawCalls(buildL(id, { stage: 3 })) <= 8, id + ' master draw calls');
  assert(drawCalls(buildL('dragon')) <= 7 && drawCalls(buildL('dragon', { stage: 3 })) <= 7, 'dragon <= 7 draw calls even as a master');
});

test('models V6: humpback / eagle / beetle / polarbear: budgets, flags and the exact part names B animates', () => {
  const whale = buildL('humpback'), eagle = buildL('eagle'), beetle = buildL('beetle'), bear = buildL('polarbear');
  for (const m of [whale, eagle, beetle, bear]) {
    assertEq([m.legendary, m.rarity, m.kind], [true, 'legendary', 'model']);
    assert(tris(m.root) <= LEGEND_TRI_BUDGET && drawCalls(m) <= 7, `budget: ${tris(m.root)} tris / ${drawCalls(m)} calls`);
    assertEq(+m.root.scale.x.toFixed(6), 1.25, 'legendary x1.25');
    assert(MODEL_SPECS[m.root.name] === undefined && true, 'root');
  }
  assert(whale.parts.fluke && whale.parts.fluke.isGroup && whale.parts.fluke.children.some(c => c.isMesh), 'fluke pivot with geometry');
  whale.parts.fluke.rotation.x += 0.4; // slap
  assert(whale.parts.spout && whale.parts.spout.isObject3D && !whale.parts.spout.isMesh && whale.parts.spout.parent === whale.head, 'spout anchor on the head');
  assert(whale.parts.spout.position.y > 0.2 && whale.parts.tail === null, 'blowhole is on top; the whale tail is called fluke');
  for (const m of [eagle, beetle]) {
    assert(m.parts.wingL && m.parts.wingR && m.parts.wingL !== m.parts.wingR, 'wing pivots');
    assert(m.parts.wingL.children.some(c => c.isMesh) && m.parts.wingR.children.some(c => c.isMesh), 'wings have geometry');
    m.parts.wingL.rotation.z = 0.8; m.parts.wingR.rotation.z = -0.8;
  }
  // beetle shells hinge at the front-top: the pivot sits in front of the shell's centre
  assert(beetle.parts.wingL.position.z > 0 && beetle.parts.wingL.position.y > 0.3, 'beetle hinge at the front-top');
  assert(eagle.parts.wingL.position.x > 0.2 && eagle.parts.wingR.position.x < -0.2, 'eagle wings at the shoulders');
  assert(bear.parts.wingL === null && bear.parts.fluke === null, 'bear has nothing extra');
  // curated shiny palettes
  for (const id of ['humpback', 'eagle', 'beetle', 'polarbear']) assert(MODEL_SPECS[id].shinyPalette, id + ' palette');
  assert(vertexColors(buildL('beetle', { shiny: true })).size > 0 && [...vertexColors(buildL('humpback', { shiny: true }))].join() !== [...vertexColors(whale)].join(), 'shiny changes colours');
});

// ── V8 §5: the 15 forest friends ────────────────────────────────────────────
const FOREST = {
  squirrel: 'common', deer: 'common', boar: 'common', fox: 'common', hedgehog: 'common', raccoon: 'common',
  bear: 'uncommon', badger: 'uncommon', skunk: 'uncommon', beaver: 'uncommon',
  sloth: 'rare', monkey: 'rare', orangutan: 'rare', tiger: 'epic', gorilla: 'epic',
};
const FOREST_IDS = Object.keys(FOREST);
const forestBudget = id => (FOREST[id] === 'common' || FOREST[id] === 'uncommon' ? { tris: 1200, calls: 6 } : { tris: 1600, calls: 7 });
const hexKey = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b].map(v => v.toFixed(3)).join(','); };
const geoOf = (m, name) => m.root.getObjectByName(name).geometry;
const bboxOf = (m, name) => { const g = geoOf(m, name); g.computeBoundingBox(); return g.boundingBox; };

test('forest: every habitat-forest species has a spec, the rarity table matches species.js, and nothing else is forest', () => {
  const forest = SPECIES.filter(s => s.habitat === 'forest' && s.id !== 'panda');
  assertEq(forest.map(s => s.id).sort(), FOREST_IDS.slice().sort(), 'the 15 forest friends');
  for (const id of FOREST_IDS) {
    assert(hasModel(id), 'no model for ' + id);
    assertEq(getSpecies(id).rarity, FOREST[id], id + ' rarity');
  }
  assert(hasModel('panda'), 'panda was already there');
});

test('forest: 15 models build; budgets (common/uncommon <= 1.2k tris + 6 calls, rare/epic <= 1.6k + 7), finite, standing on the ground', () => {
  const rows = [];
  for (const id of FOREST_IDS) {
    for (const stage of [0, 2, 3]) {
      const m = buildL(id, { stage });
      assertEq(m.kind, 'model', id);
      assert(m.root.isGroup && m.body.isGroup && m.head && m.head.isGroup && m.body.parent === m.root, id + ' groups');
      const t = tris(m.root), calls = drawCalls(m) - (stage === 3 ? 1 : 0);   // the crown sprite is an extra call for masters only
      const b = forestBudget(id);
      assert(t <= b.tris, `${id} has ${t} triangles (budget ${b.tris})`);
      assert(calls <= b.calls, `${id} uses ${calls} draw calls (budget ${b.calls})`);
      assert(Number.isFinite(m.height) && m.height > 0.4 && m.height < 2.2, `${id} height ${m.height}`);
      assert(Number.isFinite(m.radius) && m.radius > 0.15 && m.radius < 1.3, `${id} radius ${m.radius}`);
      m.root.updateMatrixWorld(true);
      let bad = 0;
      m.root.traverse(o => {
        for (const v of [o.position, o.scale, o.quaternion]) for (const k of ['x', 'y', 'z']) if (!Number.isFinite(v[k])) bad++;
        if (o.isMesh) for (const x of o.matrixWorld.elements) if (!Number.isFinite(x)) bad++;
      });
      assertEq(bad, 0, id + ' NaN transforms');
      const box = new THREE.Box3().setFromObject(m.root);
      assert(Math.abs(box.min.y) < 0.05, `${id} stage ${stage}: feet at y=${box.min.y}`);
      if (stage === 2) rows.push(`${id} ${t}t/${calls}c`);
    }
    assertEq(buildL(id).legendary, false, id + ' is not legendary');
  }
  console.log('[models] forest: ' + rows.join(', '));
});

test('forest: the shared toon material + one eye material only; merged geometry cached per species and shiny', () => {
  const mats = new Set();
  for (const id of FOREST_IDS) {
    materials(buildL(id).root, mats);
    const a = buildL(id), b = buildL(id, { stage: 0 });
    for (const n of ['bodyMesh', 'headMesh']) assert(geoOf(a, n) === geoOf(b, n), `${id} ${n} not shared`);
    assert(geoOf(buildL(id, { shiny: true }), 'bodyMesh') !== geoOf(a, 'bodyMesh'), id + ' shiny has its own buffers');
    assertEq(tris(buildL(id).root), tris(buildL(id, { shiny: true }).root), id + ' shiny keeps the geometry');
  }
  const toon = [...mats].filter(x => x.isMeshToonMaterial);
  assertEq(toon.length, 1, 'one shared toon material for all 15');
  assertEq(toon[0].vertexColors, true, 'vertex coloured');
  assertEq([...mats].filter(x => !x.isMeshToonMaterial).length, 1, 'plus the eye material');
});

test('forest: standard animated parts (tail, earL/earR, eyes, head, anchor) exist on every model and can be driven', () => {
  for (const id of FOREST_IDS) {
    const m = buildL(id);
    assert(m.parts.tail && m.parts.tail.isGroup && m.parts.tail.children.some(c => c.isMesh), id + ' tail pivot with geometry');
    assert(m.parts.earL && m.parts.earR && m.parts.earL !== m.parts.earR && m.parts.ears.length === 2, id + ' ears');
    assert(m.parts.earL.children.some(c => c.isMesh) && m.parts.earR.children.some(c => c.isMesh), id + ' ear geometry');
    assertEq(m.parts.eyes.length, 1, id + ' merged eyes');
    assert(m.parts.eyes[0].parent === m.head, id + ' eyes on head');
    assert(m.anchor && m.anchor.parent === m.head && m.parts.breath && m.parts.breath.parent === m.head, id + ' anchors on head');
    assertEq(m.anchor.name, 'anchor');
    assert(m.anchor.position.y > 0.15, id + ' head-top anchor above the head centre');
    assert(build(id).parts.tail !== m.parts.tail, id + ' tail is per pet (clone)');
    m.parts.tail.rotation.z = 0.4; m.parts.earL.rotation.z = 0.3; m.parts.earR.rotation.z = -0.3; m.head.rotation.y = 0.5; m.parts.eyes[0].scale.y = 0.1;   // wag / twitch / look / blink
    m.root.updateMatrixWorld(true);
    assert(Number.isFinite(new THREE.Box3().setFromObject(m.root).max.y), id + ' still finite when driven');
    assertEq(m.parts.wingL, null, id + ' has no wings');
  }
  const monkey = buildL('monkey');
  assert(monkey.parts.tailTip && monkey.parts.tailTip.isGroup && monkey.parts.tailTip.children.some(c => c.isMesh), 'monkey: the curly tail has its own tip pivot');
  assert(monkey.parts.tailTip !== monkey.parts.tail, 'tip is a separate pivot');
  monkey.parts.tailTip.rotation.x += 0.5;
  for (const id of FOREST_IDS.filter(i => i !== 'monkey')) assertEq(buildL(id).parts.tailTip, null, id + ' has no tail tip pivot (keeps it at 6 calls)');
});

test('forest: signature parts are really there (antlers, tusks, ring tails, paddle, spines, stripes, long arms, ...)', () => {
  const has = (m, mesh, hex) => { const want = hexKey(hex); const a = geoOf(m, mesh).attributes.color; for (let i = 0; i < a.count; i++) if ([a.getX(i), a.getY(i), a.getZ(i)].map(v => v.toFixed(3)).join(',') === want) return true; return false; };
  const sp = id => MODEL_SPECS[id];
  const deer = buildL('deer'), boar = buildL('boar'), fox = buildL('fox'), hog = buildL('hedgehog'), rac = buildL('raccoon'), bear = buildL('bear');
  const badger = buildL('badger'), skunk = buildL('skunk'), beaver = buildL('beaver'), sloth = buildL('sloth'), monkey = buildL('monkey');
  const orang = buildL('orangutan'), tiger = buildL('tiger'), gorilla = buildL('gorilla'), squirrel = buildL('squirrel');
  // squirrel: tail is big, curls up over the back, and has cheek pouches
  assert(bboxOf(squirrel, 'tailMesh').getSize(new THREE.Vector3()).y > 0.25, 'squirrel tail is a tall curl');
  assert(squirrel.height > 0.85 && has(squirrel, 'headMesh', sp('squirrel').extras[0].color), 'squirrel curl rises above the back + cheek pouches');
  // deer: antlers poke above the head; white spots
  const dh = bboxOf(deer, 'headMesh');
  assert(dh.max.y > sp('deer').head.r * 1.6, 'deer antlers rise well above the head sphere: ' + dh.max.y);
  assert(has(deer, 'headMesh', sp('deer').extras[0].color) && has(deer, 'bodyMesh', '#fff4de'), 'deer: antler colour on the head, white spots on the body');
  // boar: tusks (cream) near the snout + bristle ridge (dark cones) on the back
  assert(has(boar, 'headMesh', '#f4ead0'), 'boar tusks');
  assert(has(boar, 'bodyMesh', '#3a2a22'), 'boar bristle ridge');
  // fox: brush tail with a white tip, pointy ears
  assert(has(fox, 'tailMesh', '#fffaf0') && has(fox, 'tailMesh', '#e8782e'), 'fox: orange brush with a white tip');
  assert(sp('fox').ears.type === 'cat' && sp('fox').ears.s >= 0.8, 'fox: big pointy ears');
  // hedgehog: spike shell = lots of cones on the body, two tones
  assert(tris(hog.root) - tris({ traverse: f => f(hog.root.getObjectByName('headMesh')) }) > 500 && geoOf(hog, 'bodyMesh').attributes.position.count > 400, 'hedgehog spine shell');
  assert(has(hog, 'bodyMesh', '#8a6a50') && has(hog, 'bodyMesh', '#4a3628'), 'hedgehog spines in two tones');
  // raccoon: eye mask + ringed tail
  assert(has(rac, 'headMesh', '#3a3640'), 'raccoon eye mask');
  assert(has(rac, 'tailMesh', '#9a9aa2') && has(rac, 'tailMesh', '#2c282e'), 'raccoon ringed tail');
  // bear: honey muzzle; round ears
  assert(has(bear, 'headMesh', '#e8b96a') && sp('bear').ears.type === 'round', 'bear honey muzzle + round ears');
  // badger: head stripes (dark) on a white head
  assert(has(badger, 'headMesh', '#3a363e') && has(badger, 'headMesh', '#f4f2f2'), 'badger head stripes');
  // skunk: big striped tail + white back stripes
  assert(has(skunk, 'tailMesh', '#3a3640') && has(skunk, 'tailMesh', '#fffaf0'), 'skunk striped tail');
  assert(bboxOf(skunk, 'tailMesh').getSize(new THREE.Vector3()).y > 0.2, 'skunk tail is big');
  assert(has(skunk, 'bodyMesh', '#fffaf0'), 'skunk back stripe');
  // beaver: a flat paddle (wide, thin) + front teeth
  const pb = bboxOf(beaver, 'tailMesh').getSize(new THREE.Vector3());
  assert(pb.x > 0.3 && pb.y < pb.x * 0.35, `beaver paddle tail is flat: ${pb.x.toFixed(2)} x ${pb.y.toFixed(2)}`);
  assert(has(beaver, 'headMesh', '#fff6dc'), 'beaver teeth');
  // sloth: long arms reaching the ground (+ claws), sleepy eye patches
  for (const [m, id] of [[sloth, 'sloth'], [orang, 'orangutan'], [gorilla, 'gorilla']]) {
    const b = bboxOf(m, 'bodyMesh'), sb = sp(id).body;
    assert(b.max.x > sb.w * 1.05 && b.min.y < 0.2, `${id}: arms reach out past the body and down to the ground (x ${b.max.x.toFixed(2)}, y ${b.min.y.toFixed(2)})`);
  }
  assert(has(sloth, 'bodyMesh', '#f1ecdd'), 'sloth claws');
  assert(has(sloth, 'headMesh', '#5a4636') && sp('sloth').eyes.tall < 1, 'sloth sleepy eye patches + droopy eyes');
  // monkey: long curly tail (taller than the body) + big ears
  assert(sp('monkey').tail.len >= 0.8 && sp('monkey').ears.s >= 0.7 && monkey.height > 0.9, 'monkey: long curly tail + big ears');
  // orangutan: shaggy orange
  assert(has(orang, 'bodyMesh', '#e8863a') && has(orang, 'headMesh', '#e8863a'), 'orangutan shaggy hair');
  // tiger: stripes baked as vertex colours on the body (+ ringed tail + face stripes)
  assert(has(tiger, 'bodyMesh', '#3a2420') && has(tiger, 'headMesh', '#3a2420') && has(tiger, 'tailMesh', '#3a2420'), 'tiger stripes (vertex colours)');
  assert(bboxOf(tiger, 'bodyMesh').getSize(new THREE.Vector3()).z > 0.9, 'tiger is long');
  // gorilla: broad shoulders (wider than tall at the shoulders) + knuckle stance (fists out front on the ground)
  const gb = bboxOf(gorilla, 'bodyMesh');
  assert(gb.getSize(new THREE.Vector3()).x > 1.1 && gb.max.z > 0.4, `gorilla is broad, fists out in front: ${gb.getSize(new THREE.Vector3()).x.toFixed(2)} wide, z ${gb.max.z.toFixed(2)}`);
  assert(gorilla.height > buildL('bear').height, 'gorilla is the tallest of the forest bulk');
});

test('forest: shiny = gentle curated palettes (each palette really hits the model; eyes never shift; no hue-rotated fallback)', () => {
  for (const id of FOREST_IDS) {
    const spec = MODEL_SPECS[id], pal = spec.shinyPalette;
    assert(pal && Object.keys(pal).length >= 2, id + ' has a curated palette');
    for (const k of Object.keys(pal)) assert(k === k.toLowerCase() && /^#[0-9a-f]{6}$/.test(k) && /^#[0-9a-f]{6}$/.test(pal[k]), `${id}: palette key ${k}`);
    const normal = buildL(id), shiny = buildL(id, { shiny: true });
    assertEq([shiny.shiny, shiny.shinyStyle], [true, 'palette'], id + ' flag');
    const cn = vertexColors(normal), cs = vertexColors(shiny);
    const hit = Object.keys(pal).filter(k => cn.has(hexKey(k)));
    assert(hit.length >= 2, `${id}: only ${hit.length} palette colours are used by the model (${hit.join(',')})`);
    for (const k of hit) assert(cs.has(hexKey(pal[k])) && !cs.has(hexKey(k)), `${id}: ${k} -> ${pal[k]} not applied`);
    assertEq([...vertexColors(shiny, true)].sort().join('|'), [...vertexColors(normal, true)].sort().join('|'), id + ' eyes keep their colour');
    // colours that are not in the palette stay exactly as they were (no stray hue shift)
    const unlisted = [...cn].filter(c => !Object.keys(pal).some(k => hexKey(k) === c));
    for (const c of unlisted) assert(cs.has(c), `${id}: unlisted colour ${c} changed when shiny`);
  }
});

test('forest: stage scale + crown still work (master crown rides the head); masters stay inside the call budget + 1', () => {
  for (const id of FOREST_IDS) {
    for (let st = 0; st < 4; st++) {
      const m = buildL(id, { stage: st });
      assertEq(m.root.scale.x, STAGE_SCALE[st], `${id} scale at stage ${st}`);
      assertEq(!!m.parts.crown, st === 3, `${id} crown at stage ${st}`);
    }
    const master = buildL(id, { stage: 3 });
    assert(master.parts.crown.parent === master.head, id + ' crown on the head');
    assert(drawCalls(master) <= forestBudget(id).calls + 1, `${id} master calls ${drawCalls(master)}`);
    assert(master.height > buildL(id, { stage: 2 }).height, id + ' master is bigger');
  }
});

test('forest: 20 forest pets in one yard stay inside the scene budget (<= 14 calls per pet is far more than needed: sum <= 20 x 7)', () => {
  let calls = 0;
  for (let i = 0; i < 20; i++) calls += drawCalls(buildL(FOREST_IDS[i % FOREST_IDS.length]));
  assert(calls <= 20 * 7, 'forest yard of 20 pets: ' + calls + ' calls');
  console.log('[models] 20 forest pets = ' + calls + ' model draw calls');
});

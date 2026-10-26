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

test('models: every farm-habitat species has a spec; the only non-farm specs are the legendaries, the 15 forest friends, the 15 water friends, the 11 sky friends, the 13 bug friends, the 12 savanna friends and the 9 polar friends', () => {
  assertEq(FARM.length, 21, 'farm species count');
  for (const sp of FARM) assert(hasModel(sp.id), 'no model for ' + sp.id);
  for (const id of Object.keys(MODEL_SPECS)) assert(FARM.some(s => s.id === id) || LEGEND_IDS.includes(id) || getSpecies(id).habitat === 'forest' || getSpecies(id).habitat === 'water' || getSpecies(id).habitat === 'sky' || getSpecies(id).habitat === 'bug' || getSpecies(id).habitat === 'savanna' || getSpecies(id).habitat === 'polar', 'unexpected spec for ' + id);
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
  const penguin = getSpecies('dodo');   // a mystic species: the polar friends all have models since V16
  assertEq(hasModel('dodo'), false, 'dodo has no model');
  const m = buildPetModel(THREE, { speciesId: 'dodo', stage: 2 }, penguin);
  assertEq(m.kind, 'billboard', 'kind');
  assert(m.root.isGroup && m.body.isGroup, 'root/body groups');
  assert(m.height > 0 && m.radius > 0, 'size');
  let sprites = 0;
  m.root.traverse(o => { if (o.isSprite) sprites++; });
  assertEq(sprites, 1, 'one sprite');
  const m2 = buildPetModel(THREE, { speciesId: 'dodo', stage: 3, shiny: true }, penguin);
  assertEq(m2.root.scale.x, 1.15, 'billboard stage scale');
  assert(!!m2.parts.crown, 'billboard crown');
  const t1 = kitStats(THREE).textures;
  buildBillboard(THREE, penguin.emoji);
  buildBillboard(THREE, penguin.emoji);
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
  assert(has(buildL('unicorn', { shiny: true }), '#e9e0ff'), 'lavender unicorn (V13 chibi model)');
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
  const epic = buildPetModel(THREE, { stage: 2 }, { id: 'test_epic', emoji: '\u{1F9A9}', rarity: 'epic' });   // every epic has a model now: a made-up one exercises the billboard path
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
  for (const sid of ['trex', 'dodo', 'lizard']) {   // billboards: centred above the sprite
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

// ── V9 §6: the 15 water friends ─────────────────────────────────────────────
const WATER = {
  fish: 'common', tropicalfish: 'common', frog: 'common', turtle: 'common', crab: 'common', shrimp: 'common', conch: 'common',
  blowfish: 'uncommon', squid: 'uncommon', otter: 'uncommon', oyster: 'uncommon',
  octopus: 'rare', lobster: 'rare', dolphin: 'epic', shark: 'epic',
};
const WATER_IDS = Object.keys(WATER);
const AQUATIC = ['fish', 'tropicalfish', 'blowfish', 'squid', 'octopus', 'dolphin', 'shark'];   // live inside a floating bubble
const waterBudget = id => (WATER[id] === 'common' || WATER[id] === 'uncommon' ? { tris: 1200, calls: 6 } : { tris: 1600, calls: 7 });
const bubbleOf = m => m.root.getObjectByName('bubble') || null;

test('water: every habitat-water species except the humpback has a spec; the rarity table matches species.js', () => {
  const water = SPECIES.filter(s => s.habitat === 'water' && s.id !== 'humpback');
  assertEq(water.map(s => s.id).sort(), WATER_IDS.slice().sort(), 'the 15 water friends');
  for (const id of WATER_IDS) {
    assert(hasModel(id), 'no model for ' + id);
    assertEq(getSpecies(id).rarity, WATER[id], id + ' rarity');
  }
  assert(hasModel('humpback'), 'humpback was already there');
});

test('water: 15 models build; budgets incl. the bubble (common/uncommon <= 1.2k tris + 6 calls, rare/epic <= 1.6k + 7; the bubble is the only extra call), finite, resting on the ground', () => {
  const rows = [];
  for (const id of WATER_IDS) {
    const aq = AQUATIC.includes(id);
    for (const stage of [0, 2, 3]) {
      const m = buildL(id, { stage });
      assertEq(m.kind, 'model', id);
      assert(m.root.isGroup && m.body.isGroup && m.head && m.head.isGroup && m.body.parent === m.root, id + ' groups');
      const t = tris(m.root), total = drawCalls(m) - (stage === 3 ? 1 : 0);   // the crown sprite is an extra call for masters only
      const calls = total - (aq ? 1 : 0), b = waterBudget(id);
      assert(t <= b.tris, `${id} has ${t} triangles incl. the bubble (budget ${b.tris})`);
      assert(calls <= b.calls, `${id} uses ${calls} draw calls (+ bubble) (budget ${b.calls})`);
      assert(Number.isFinite(m.height) && m.height > 0.25 && m.height < 2.4, `${id} height ${m.height}`);
      assert(Number.isFinite(m.radius) && m.radius > 0.15 && m.radius < 1.3, `${id} radius ${m.radius}`);
      m.root.updateMatrixWorld(true);
      let bad = 0;
      m.root.traverse(o => {
        for (const v of [o.position, o.scale, o.quaternion]) for (const k of ['x', 'y', 'z']) if (!Number.isFinite(v[k])) bad++;
        if (o.isMesh) for (const x of o.matrixWorld.elements) if (!Number.isFinite(x)) bad++;
      });
      assertEq(bad, 0, id + ' NaN transforms');
      const box = new THREE.Box3().setFromObject(m.root);
      assert(Math.abs(box.min.y) < 0.05, `${id} stage ${stage}: feet / bubble bottom at y=${box.min.y}`);
      if (stage === 2) rows.push(`${id} ${t}t/${total}c`);
    }
    assertEq(buildL(id).legendary, false, id + ' is not legendary');
  }
  console.log('[models] water: ' + rows.join(', '));
});

test('water: the shared toon material + one eye material (+ ONE shared bubble material / geometry for the 7 swimmers); merged geometry cached per species and shiny', () => {
  const mats = new Set();
  for (const id of WATER_IDS) {
    materials(buildL(id).root, mats);
    const a = buildL(id), b = buildL(id, { stage: 0 });
    for (const n of ['bodyMesh', 'headMesh']) assert(geoOf(a, n) === geoOf(b, n), `${id} ${n} not shared`);
    assert(geoOf(buildL(id, { shiny: true }), 'bodyMesh') !== geoOf(a, 'bodyMesh'), id + ' shiny has its own buffers');
    assertEq(tris(buildL(id).root), tris(buildL(id, { shiny: true }).root), id + ' shiny keeps the geometry');
  }
  const toon = [...mats].filter(x => x.isMeshToonMaterial);
  assertEq(toon.length, 1, 'one shared toon material for all 15');
  assertEq(toon[0].vertexColors, true, 'vertex coloured');
  assertEq([...mats].filter(x => !x.isMeshToonMaterial).length, 2, 'the eye material + the bubble material');
  const bubbles = AQUATIC.map(id => bubbleOf(buildL(id)));
  assert(bubbles.every(b => b && b.material === bubbles[0].material), 'one shared bubble material');
  assert(bubbles.every(b => b.geometry === bubbles[0].geometry), 'one shared (unit) bubble geometry');
  assert(bubbles[0].material.transparent && !bubbles[0].material.depthWrite, 'translucent, no depth write');
  for (const id of WATER_IDS.filter(i => !AQUATIC.includes(i))) assertEq(bubbleOf(buildL(id)), null, id + ' walks / sits: no bubble');
});

test('water: swimmers float in a bubble that rests on the ground, is centred under the root and contains the whole pet', () => {
  for (const id of AQUATIC) {
    for (const stage of [0, 2, 3]) {
      const m = buildL(id, { stage });
      assert(m.parts.bubble && m.parts.bubble === bubbleOf(m) && m.parts.bubble.parent === m.body, id + ' parts.bubble is a child of the body');
      m.root.updateMatrixWorld(true);
      const b = m.parts.bubble, c = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
      const k = m.root.scale.x, r = b.scale.x * k;
      assert(Math.abs(c.y - r) < 0.01 && Math.abs(c.x) < 0.01 && Math.abs(c.z) < 0.01, `${id}: bubble centre (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) vs radius ${r.toFixed(2)}`);
      let far = 0;
      const p = new THREE.Vector3();
      m.root.traverse(o => {
        if (!o.isMesh || o === b) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) far = Math.max(far, p.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld).distanceTo(c));
      });
      assert(far <= r + 1e-3, `${id} stage ${stage}: the pet pokes ${(far - r).toFixed(3)} out of its bubble`);
      assert(far > r * 0.8, `${id}: the bubble is not much bigger than the pet (${far.toFixed(2)} of ${r.toFixed(2)})`);
      assert(m.height >= 2 * r - 0.02, `${id}: height covers the bubble`);
    }
  }
  // squash / float must not break it: the bubble moves with the body
  const f = buildL('fish');
  f.body.scale.set(1.1, 0.9, 1.1); f.body.position.y = 0.2;
  f.root.updateMatrixWorld(true);
  assert(new THREE.Box3().setFromObject(f.root).min.y > 0.1, 'floating the body lifts the bubble too');
});

test('water: standard animated parts (head, eyes, anchor, tail fin, pectoral fins / claws / feelers as earL/earR, shell pivots) can be driven', () => {
  const NO_TAIL = ['oyster', 'conch', 'frog', 'octopus'], NO_EARS = ['oyster', 'frog', 'turtle'];
  for (const id of WATER_IDS) {
    const m = buildL(id);
    assertEq(m.parts.eyes.length, 1, id + ' merged eyes');
    assert(m.parts.eyes[0].parent === m.head, id + ' eyes on head');
    assert(m.anchor && m.anchor.parent === m.head && m.parts.breath && m.parts.breath.parent === m.head, id + ' anchors on head');
    assert(m.anchor.position.y > 0.1, id + ' head-top anchor above the head centre');
    if (!NO_TAIL.includes(id)) {
      assert(m.parts.tail && m.parts.tail.isGroup && m.parts.tail.children.some(c => c.isMesh), id + ' tail pivot with geometry');
      assert(build(id).parts.tail !== m.parts.tail, id + ' tail is per pet (clone)');
      m.parts.tail.rotation.y = 0.5; m.parts.tail.rotation.z = 0.3;
    } else assertEq(m.parts.tail, null, id + ' has no tail pivot');
    if (!NO_EARS.includes(id)) {
      assert(m.parts.earL && m.parts.earR && m.parts.earL !== m.parts.earR && m.parts.ears.length === 2, id + ' ears (fins / claws / feelers)');
      assert(m.parts.earL.children.some(c => c.isMesh) && m.parts.earR.children.some(c => c.isMesh), id + ' ear geometry');
      m.parts.earL.rotation.z = 0.4; m.parts.earR.rotation.z = -0.4;
    }
    m.head.rotation.y = 0.5; m.parts.eyes[0].scale.y = 0.1;
    m.root.updateMatrixWorld(true);
    assert(Number.isFinite(new THREE.Box3().setFromObject(m.root).max.y), id + ' still finite when driven');
    assertEq(m.parts.wingL, null, id + ' has no wings');
  }
  // oyster + conch: a `shell` pivot (the oyster's upper half / the conch's spiral) that opens / tilts; nobody else has one
  for (const id of ['oyster', 'conch']) {
    const m = buildL(id);
    assert(m.parts.shell && m.parts.shell.isGroup && m.parts.shell.children.some(c => c.isMesh), id + ' shell pivot with geometry');
    assert(build(id).parts.shell !== m.parts.shell, id + ' shell is per pet');
    m.parts.shell.rotation.x = -1.0;
    m.root.updateMatrixWorld(true);
    assert(Number.isFinite(new THREE.Box3().setFromObject(m.root).max.y), id + ' shell rotates');
  }
  for (const id of WATER_IDS.filter(i => i !== 'oyster' && i !== 'conch')) assertEq(buildL(id).parts.shell, null, id + ' has no shell pivot');
});

test('water: signature parts are really there (fins, claws, tentacles, shell + sand, hop legs, teeth, spikes, fan tail)', () => {
  const has = (m, mesh, hex) => { const want = hexKey(hex); const a = geoOf(m, mesh).attributes.color; for (let i = 0; i < a.count; i++) if ([a.getX(i), a.getY(i), a.getZ(i)].map(v => v.toFixed(3)).join(',') === want) return true; return false; };
  const sp = id => MODEL_SPECS[id];
  const size = (m, n) => bboxOf(m, n).getSize(new THREE.Vector3());
  for (const id of ['fish', 'tropicalfish', 'blowfish', 'dolphin', 'shark']) assertEq(sp(id).ears.type, 'fin', id + ' pectoral fins');
  for (const id of ['fish', 'tropicalfish', 'blowfish', 'shark']) {
    const tb = size(buildL(id), 'tailMesh');
    assert(tb.y > tb.x * 3, `${id}: the tail fin is a thin vertical fan (${tb.x.toFixed(2)} x ${tb.y.toFixed(2)})`);
  }
  const dt = size(buildL('dolphin'), 'tailMesh');
  assert(dt.x > dt.y * 2, 'dolphin: a horizontal fluke');
  assert(has(buildL('tropicalfish'), 'bodyMesh', '#fffdf6'), 'clownfish white stripes');
  assert(geoOf(buildL('blowfish'), 'bodyMesh').attributes.position.count > 300 && has(buildL('blowfish'), 'bodyMesh', '#f0a732'), 'blowfish spikes');
  const oct = buildL('octopus');
  assert(geoOf(oct, 'bodyMesh').attributes.position.count > 500, 'octopus: tentacle chains in the body mesh');
  assert(sp('octopus').ears.type === 'arm' && sp('squid').ears.type === 'arm' && oct.parts.earL && buildL('squid').parts.earR, 'octopus / squid: two waving arms as earL/earR');
  assert(has(buildL('squid'), 'bodyMesh', '#ff7a96'), 'squid spots');
  for (const id of ['oyster', 'conch']) {
    const m = buildL(id);
    assert(has(m, 'bodyMesh', '#f2dca0'), id + ' sand tuft');
    assert(size(m, 'bodyMesh').x > 0.4, id + ' sand tuft is wider than the animal');
  }
  assert(buildL('conch').height > 0.7, 'conch spiral tower is tall');
  assertEq(sp('crab').legs.type, 'crab', 'crab splayed legs');
  assert(size(buildL('crab'), 'bodyMesh').x > 0.9, 'crab: wide stance (8 legs)');
  for (const id of ['crab', 'lobster']) assertEq(sp(id).ears.type, 'claw', id + ' claws are the ear pivots');
  assert(size(buildL('lobster'), 'earLMesh').length() > 0.35, 'lobster claws are big');
  assert(sp('lobster').tail.fan && sp('lobster').tail.n >= 4 && sp('shrimp').tail.fan, 'lobster / shrimp: segmented tail with a fan');
  assert(size(buildL('frog'), 'bodyMesh').x > 0.65, 'frog: folded hind legs stick out at the sides');
  assert(buildL('frog').head.position.y > 0.4 && sp('frog').eyes.el > 0.3, 'frog: big eyes high on a wide head');
  assert(has(buildL('turtle'), 'bodyMesh', '#a2dd8e') && has(buildL('turtle'), 'bodyMesh', '#f0e2a8'), 'turtle: shell plates + cream rim');
  assert(has(buildL('otter'), 'headMesh', '#f3dec3') && size(buildL('otter'), 'tailMesh').length() > 0.5, 'otter: cream muzzle + thick long tail');
  const shark = buildL('shark');
  assert(has(shark, 'headMesh', '#ffffff'), 'shark teeth (white on the head)');
  assert(size(shark, 'bodyMesh').y > 0.6, 'shark: tall dorsal fin');
  assert(shark.height > buildL('dolphin').height * 0.9 && buildL('dolphin').height > buildL('fish').height, 'epics are bigger than the commons');
});

test('water: shiny = gentle curated palettes (each palette really hits the model; eyes + bubble never shift; no hue-rotated fallback)', () => {
  for (const id of WATER_IDS) {
    const spec = MODEL_SPECS[id], pal = spec.shinyPalette;
    assert(pal && Object.keys(pal).length >= 3, id + ' has a curated palette');
    for (const k of Object.keys(pal)) assert(k === k.toLowerCase() && /^#[0-9a-f]{6}$/.test(k) && /^#[0-9a-f]{6}$/.test(pal[k]), `${id}: palette key ${k}`);
    const normal = buildL(id), shiny = buildL(id, { shiny: true });
    assertEq([shiny.shiny, shiny.shinyStyle], [true, 'palette'], id + ' flag');
    const cn = vertexColors(normal), cs = vertexColors(shiny);
    const hit = Object.keys(pal).filter(k => cn.has(hexKey(k)));
    assert(hit.length >= 3, `${id}: only ${hit.length} palette colours are used by the model (${hit.join(',')})`);
    for (const k of hit) assert(cs.has(hexKey(pal[k])) && !cs.has(hexKey(k)), `${id}: ${k} -> ${pal[k]} not applied`);
    assertEq([...vertexColors(shiny, true)].sort().join('|'), [...vertexColors(normal, true)].sort().join('|'), id + ' eyes keep their colour');
    // the cheek blush is a 60 % blend of the (shifted) head colour with pink, so it follows the head: the one colour allowed to move without being listed
    const mix = (a, b) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * 0.4 + parseInt(b.slice(i, i + 2), 16) * 0.6).toString(16).padStart(2, '0')).join('');
    const blush = hexKey(mix(spec.head.color || spec.body.color, spec.blush));
    const unlisted = [...cn].filter(c => !Object.keys(pal).some(k => hexKey(k) === c) && c !== blush);
    for (const c of unlisted) assert(cs.has(c), `${id}: unlisted colour ${c} changed when shiny`);
    if (AQUATIC.includes(id)) assert(bubbleOf(shiny).material === bubbleOf(normal).material && bubbleOf(shiny).geometry === bubbleOf(normal).geometry, id + ' bubble is not recoloured');
  }
});

test('water: stage scale + crown still work (master crown rides the head); masters stay inside the call budget + 1 (+ bubble)', () => {
  for (const id of WATER_IDS) {
    const aq = AQUATIC.includes(id) ? 1 : 0;
    for (let st = 0; st < 4; st++) {
      const m = buildL(id, { stage: st });
      assertEq(m.root.scale.x, STAGE_SCALE[st], `${id} scale at stage ${st}`);
      assertEq(!!m.parts.crown, st === 3, `${id} crown at stage ${st}`);
    }
    const master = buildL(id, { stage: 3 });
    assert(master.parts.crown.parent === master.head, id + ' crown on the head');
    assert(drawCalls(master) <= waterBudget(id).calls + 1 + aq, `${id} master calls ${drawCalls(master)}`);
    assert(master.height > buildL(id, { stage: 2 }).height, id + ' master is bigger');
  }
});

test('water: 20 water pets in one yard stay inside the scene budget (counting the bubbles): sum <= 20 x 8', () => {
  let calls = 0, trisSum = 0;
  for (let i = 0; i < 20; i++) { const m = buildL(WATER_IDS[i % WATER_IDS.length]); calls += drawCalls(m); trisSum += tris(m.root); }
  assert(calls <= 20 * 8, 'water yard of 20 pets: ' + calls + ' calls');
  const xl = Array.from({ length: 20 }, (_, i) => drawCalls(buildL(AQUATIC[i % AQUATIC.length], { stage: 3 }))).reduce((a, b) => a + b, 0);
  assert(xl <= 20 * 9, 'worst case: 20 master swimmers = ' + xl + ' calls');
  console.log(`[models] 20 water pets = ${calls} model draw calls, ${trisSum} tris (20 master swimmers: ${xl} calls)`);
});

// ── V10 §4: the 11 sky friends ──────────────────────────────────────────────
const SKY = {
  sparrow: 'common', dove: 'common', canary: 'common', tit: 'common', hatchling: 'common', parrot: 'uncommon', bat: 'uncommon',
  swan: 'rare', owl: 'rare', flamingo: 'epic', peacock: 'epic',
};
const SKY_IDS = Object.keys(SKY);
const skyBudget = id => (SKY[id] === 'common' || SKY[id] === 'uncommon' ? { tris: 1200, calls: 6 } : { tris: 1600, calls: 7 });
const hasColor = (m, mesh, hex) => { const want = hexKey(hex); const a = geoOf(m, mesh).attributes.color; for (let i = 0; i < a.count; i++) if ([a.getX(i), a.getY(i), a.getZ(i)].map(v => v.toFixed(3)).join(',') === want) return true; return false; };

test('sky: every habitat-sky species except the eagle has a spec; the rarity table matches species.js', () => {
  const sky = SPECIES.filter(s => s.habitat === 'sky' && s.id !== 'eagle');
  assertEq(sky.map(s => s.id).sort(), SKY_IDS.slice().sort(), 'the 11 sky friends');
  for (const id of SKY_IDS) {
    assert(hasModel(id), 'no model for ' + id);
    assertEq(getSpecies(id).rarity, SKY[id], id + ' rarity');
  }
  assert(hasModel('eagle'), 'the eagle was already there');
});

test('sky: 11 models build; budgets (common/uncommon <= 1.2k tris + 6 calls, rare/epic <= 1.6k + 7), finite, standing on the ground', () => {
  const rows = [];
  for (const id of SKY_IDS) {
    for (const stage of [0, 2, 3]) {
      const m = buildL(id, { stage });
      assertEq(m.kind, 'model', id);
      assert(m.root.isGroup && m.body.isGroup && m.head && m.head.isGroup && m.body.parent === m.root, id + ' groups');
      const t = tris(m.root), calls = drawCalls(m) - (stage === 3 ? 1 : 0);   // the crown sprite is an extra call for masters only
      const b = skyBudget(id);
      assert(t <= b.tris, `${id} has ${t} triangles (budget ${b.tris})`);
      assert(calls <= b.calls, `${id} uses ${calls} draw calls (budget ${b.calls})`);
      assert(Number.isFinite(m.height) && m.height > 0.3 && m.height < 2.4, `${id} height ${m.height}`);
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
  console.log('[models] sky: ' + rows.join(', '));
});

test('sky: the shared toon material + one eye material only; merged geometry cached per species and shiny', () => {
  const mats = new Set();
  for (const id of SKY_IDS) {
    materials(buildL(id).root, mats);
    const a = buildL(id), b = buildL(id, { stage: 0 });
    for (const n of ['bodyMesh', 'headMesh']) assert(geoOf(a, n) === geoOf(b, n), `${id} ${n} not shared`);
    assert(geoOf(buildL(id, { shiny: true }), 'bodyMesh') !== geoOf(a, 'bodyMesh'), id + ' shiny has its own buffers');
    assertEq(tris(buildL(id).root), tris(buildL(id, { shiny: true }).root), id + ' shiny keeps the geometry');
  }
  const toon = [...mats].filter(x => x.isMeshToonMaterial);
  assertEq(toon.length, 1, 'one shared toon material for all 11');
  assertEq([...mats].filter(x => !x.isMeshToonMaterial).length, 1, 'plus the eye material');
});

test('sky: standard animated parts (head, eyes, anchor, wingL/wingR, tail) exist and can be driven; the specials have their own pivots', () => {
  for (const id of SKY_IDS) {
    const m = buildL(id);
    assertEq(m.parts.eyes.length, 1, id + ' merged eyes');
    assert(m.parts.eyes[0].parent === m.head, id + ' eyes on head');
    assert(m.anchor && m.anchor.parent === m.head && m.parts.breath && m.parts.breath.parent === m.head, id + ' anchors on head');
    assert(m.anchor.position.y > 0.1, id + ' head-top anchor above the head centre');
    assert(m.parts.wingL && m.parts.wingR && m.parts.wingL !== m.parts.wingR, id + ' wing pivots');
    assert(m.parts.wingL.children.some(c => c.isMesh) && m.parts.wingR.children.some(c => c.isMesh), id + ' wings have geometry');
    assert(m.parts.wingL.position.x > 0.1 && m.parts.wingR.position.x < -0.1, id + ' wings at the shoulders (L is +x, R is -x)');
    assert(build(id).parts.wingL !== m.parts.wingL, id + ' wings are per pet (clone)');
    m.parts.wingL.rotation.z = 0.9; m.parts.wingR.rotation.z = -0.9;   // flap
    if (id !== 'flamingo') {
      assert(m.parts.tail && m.parts.tail.isGroup && m.parts.tail.children.some(c => c.isMesh), id + ' tail pivot with geometry');
      assert(build(id).parts.tail !== m.parts.tail, id + ' tail is per pet (clone)');
      m.parts.tail.rotation.x += 0.3;
    } else assertEq(m.parts.tail, null, id + ' has no tail pivot (that keeps it at 7 calls)');
    m.head.rotation.y = 0.5; m.parts.eyes[0].scale.y = 0.1;
    m.root.updateMatrixWorld(true);
    assert(Number.isFinite(new THREE.Box3().setFromObject(m.root).max.y), id + ' still finite when driven');
    assertEq([m.parts.fluke, m.parts.shell, m.parts.bubble, m.parts.trunk], [null, null, null, null], id + ' has no water / mammoth parts');
  }
  // the flamingo has hip pivots so B can pose a one-legged stand; nobody else does
  const fl = buildL('flamingo');
  assert(fl.parts.legL && fl.parts.legR && fl.parts.legL !== fl.parts.legR && fl.parts.legL.children.some(c => c.isMesh) && fl.parts.legR.children.some(c => c.isMesh), 'flamingo leg pivots with geometry');
  assert(fl.parts.legL.position.x > 0.05 && fl.parts.legR.position.x < -0.05 && fl.parts.legL.position.y > 0.3, 'flamingo hips: one each side, high above the ground');
  const box0 = new THREE.Box3().setFromObject(fl.root);
  fl.parts.legL.rotation.x = 2.0;   // fold the foot back and up
  fl.root.updateMatrixWorld(true);
  const box1 = new THREE.Box3().setFromObject(fl.root);
  assert(box1.max.y <= box0.max.y + 1e-6 && Number.isFinite(box1.min.z), 'folding a leg keeps the model finite and inside its height');
  assert(new THREE.Box3().setFromObject(fl.parts.legL).min.y > 0.1, 'a folded flamingo leg leaves the ground');
  assert(new THREE.Box3().setFromObject(fl.parts.legR).min.y < 0.05, 'the other leg still stands');
  for (const id of SKY_IDS.filter(i => i !== 'flamingo')) assertEq([buildL(id).parts.legL, buildL(id).parts.legR], [null, null], id + ' has no leg pivots');
  // the peacock's whole fan is the `tail` pivot (B lifts / scales it open): a big, wide fan of feathers
  const pea = buildL('peacock');
  const fan = new THREE.Box3().setFromObject(pea.parts.tail).getSize(new THREE.Vector3());
  assert(fan.length() > 0.7, 'peacock fan is big: ' + fan.length().toFixed(2));
  assert(geoOf(pea, 'tailMesh').attributes.position.count > 300, 'peacock fan: nine feathers with eye spots in one merged mesh');
  pea.parts.tail.scale.set(2, 1.5, 1); pea.parts.tail.rotation.x = -0.2;   // open
  pea.root.updateMatrixWorld(true);
  const open = new THREE.Box3().setFromObject(pea.parts.tail).getSize(new THREE.Vector3());
  assert(open.x > fan.x * 1.5 && open.y > fan.y * 1.5, `an opened fan is wider and taller (${open.x.toFixed(2)} x ${open.y.toFixed(2)} vs ${fan.x.toFixed(2)} x ${fan.y.toFixed(2)})`);
});

test('sky: signature parts are really there (hatchling shell, parrot tail, bat membrane wings + ears, swan neck, owl eyes, flamingo legs, peacock eyes on the fan)', () => {
  const size = (m, n) => bboxOf(m, n).getSize(new THREE.Vector3());
  // hatchling: a pale shell bowl wider than the chick, with a zig-zag rim, sitting on the ground
  const hat = buildL('hatchling');
  assert(hasColor(hat, 'bodyMesh', '#fff6e6') && size(hat, 'bodyMesh').x > 0.6, 'hatchling: eggshell bowl wider than the chick');
  assert(hat.height > 0.8 && bboxOf(hat, 'bodyMesh').min.y < 0.02, 'hatchling: the shell sits on the ground');
  // parrot: long colourful tail (red -> blue -> yellow), hooked dark beak tip, white eye rings
  const par = buildL('parrot');
  assert(['#e23d3a', '#2f7bd9', '#f2c230'].every(c => hasColor(par, 'tailMesh', c)), 'parrot: three-colour tail');
  assert(size(par, 'tailMesh').length() > 0.5 && hasColor(par, 'headMesh', '#3a3436'), 'parrot: long tail + dark beak hook');
  assert(MODEL_SPECS.parrot.eyes.ring, 'parrot: white eye rings');
  // bat: membrane wings with finger bones (a wide wing span), big pointy ears folded into the head
  const bat = buildL('bat');
  assert(MODEL_SPECS.bat.extras.some(e => e.t === 'batwings') && size(bat, 'wingLMesh').length() > 0.35, 'bat: wings are bone + membrane fingers');
  assert(bat.parts.earL === null && bboxOf(bat, 'headMesh').max.y > MODEL_SPECS.bat.head.r * 1.4, 'bat: big ears are static (merged into the head, no extra calls)');
  assert(hasColor(bat, 'headMesh', '#ffffff'), 'bat: tiny fangs');
  // swan: a long S-curved neck, white all over, black face mask, orange beak
  const swan = buildL('swan');
  assert(swan.height > 1.2 && swan.head.position.y > 0.9, 'swan: head high on a long neck');
  assert(hasColor(swan, 'headMesh', '#2a2630') && hasColor(swan, 'headMesh', '#f3892a'), 'swan: black mask + orange beak');
  assert(size(swan, 'bodyMesh').y > 0.85, 'swan: the neck is part of the body mesh');
  // owl: ear tufts rise above the head, big ringed eyes, speckled belly
  const owl = buildL('owl');
  assert(bboxOf(owl, 'headMesh').max.y > MODEL_SPECS.owl.head.r * 1.2 && MODEL_SPECS.owl.eyes.s >= 0.2 && MODEL_SPECS.owl.eyes.ring, 'owl: ear tufts + big ringed eyes');
  assert(hasColor(owl, 'bodyMesh', '#b58d62'), 'owl: speckled belly');
  // flamingo: long thin legs (the model is mostly leg), pink all over, black beak tip
  const fla = buildL('flamingo');
  assert(fla.height > 1.1 && bboxOf(fla, 'bodyMesh').min.y > 0.3, 'flamingo: the body floats on long legs');
  assert(size(fla, 'legLMesh').y > 0.4 && hasColor(fla, 'legLMesh', '#ff7f9f'), 'flamingo: leg pivots are long');
  assert(hasColor(fla, 'headMesh', '#2a2630'), 'flamingo: black beak tip');
  // peacock: crest, white cheek patch, eye spots (two colours) on the fan
  const pea = buildL('peacock');
  assert(hasColor(pea, 'tailMesh', '#2a5fc9') && hasColor(pea, 'tailMesh', '#e8b84a'), 'peacock: gold-ringed blue eye spots on the fan');
  assert(hasColor(pea, 'headMesh', '#fffdf4'), 'peacock: white cheek patch');
  assert(bboxOf(pea, 'headMesh').max.y > MODEL_SPECS.peacock.head.r * 1.5, 'peacock: crest above the head');
  assert(hasColor(buildL('tit'), 'headMesh', '#4f86d6') && hasColor(buildL('canary'), 'headMesh', '#ffe46a') && hasColor(buildL('sparrow'), 'headMesh', '#4a3a34'), 'tit blue cap, canary tuft, sparrow bib');
});

test('sky: shiny = curated palettes (each palette really hits the model; eyes never shift; no hue-rotated fallback)', () => {
  for (const id of SKY_IDS) {
    const spec = MODEL_SPECS[id], pal = spec.shinyPalette;
    assert(pal && Object.keys(pal).length >= 3, id + ' has a curated palette');
    for (const k of Object.keys(pal)) assert(k === k.toLowerCase() && /^#[0-9a-f]{6}$/.test(k) && /^#[0-9a-f]{6}$/.test(pal[k]), `${id}: palette key ${k}`);
    const normal = buildL(id), shiny = buildL(id, { shiny: true });
    assertEq([shiny.shiny, shiny.shinyStyle], [true, 'palette'], id + ' flag');
    const cn = vertexColors(normal), cs = vertexColors(shiny);
    const hit = Object.keys(pal).filter(k => cn.has(hexKey(k)));
    assert(hit.length >= 3, `${id}: only ${hit.length} palette colours are used by the model (${hit.join(',')})`);
    for (const k of hit) assert(cs.has(hexKey(pal[k])) && !cs.has(hexKey(k)), `${id}: ${k} -> ${pal[k]} not applied (has target ${cs.has(hexKey(pal[k]))}, still has source ${cs.has(hexKey(k))}; meshes ${(() => { const r = []; shiny.root.traverse(o => { if (o.isMesh) r.push(o.name + ':' + o.material.type + ':' + o.geometry.attributes.position.count); }); return r.join(','); })()})`);
    assertEq([...vertexColors(shiny, true)].sort().join('|'), [...vertexColors(normal, true)].sort().join('|'), id + ' eyes keep their colour');
    // the cheek blush is a 60 % blend of the (shifted) head colour with pink: the one colour allowed to move without being listed
    const mix = (a, b) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * 0.4 + parseInt(b.slice(i, i + 2), 16) * 0.6).toString(16).padStart(2, '0')).join('');
    const blush = hexKey(mix(spec.head.color || spec.body.color, spec.blush || '#ff8fa3'));
    const unlisted = [...cn].filter(c => !Object.keys(pal).some(k => hexKey(k) === c) && c !== blush);
    for (const c of unlisted) assert(cs.has(c), `${id}: unlisted colour ${c} changed when shiny`);
  }
});

test('sky: stage scale + crown still work (master crown rides the head); masters stay inside the call budget + 1', () => {
  for (const id of SKY_IDS) {
    for (let st = 0; st < 4; st++) {
      const m = buildL(id, { stage: st });
      assertEq(m.root.scale.x, STAGE_SCALE[st], `${id} scale at stage ${st}`);
      assertEq(!!m.parts.crown, st === 3, `${id} crown at stage ${st}`);
    }
    const master = buildL(id, { stage: 3 });
    assert(master.parts.crown.parent === master.head, id + ' crown on the head');
    assert(drawCalls(master) <= skyBudget(id).calls + 1, `${id} master calls ${drawCalls(master)}`);
    assert(master.height > buildL(id, { stage: 2 }).height, id + ' master is bigger');
  }
});

test('sky: 20 sky pets in one yard stay inside the scene budget (sum <= 20 x 7)', () => {
  let calls = 0, trisSum = 0;
  for (let i = 0; i < 20; i++) { const m = buildL(SKY_IDS[i % SKY_IDS.length]); calls += drawCalls(m); trisSum += tris(m.root); }
  assert(calls <= 20 * 7, 'sky yard of 20 pets: ' + calls + ' calls');
  console.log(`[models] 20 sky pets = ${calls} model draw calls, ${trisSum} tris`);
});

// ── V11 §5: the 13 bug friends ──────────────────────────────────────────────
const BUG = {
  bee: 'common', butterfly: 'common', ladybug: 'common', ant: 'common', caterpillar: 'common', earthworm: 'common', snail: 'common',
  cricket: 'uncommon', fly: 'uncommon', cockroach: 'rare', mosquito: 'rare', spider: 'epic', scorpion: 'epic',
};
const BUG_IDS = Object.keys(BUG);
const bugBudget = id => (BUG[id] === 'common' || BUG[id] === 'uncommon' ? { tris: 1000, calls: 6 } : { tris: 1600, calls: 7 });
const centre = o => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); };
/** World-space shift of a pivot's bounding-box centre when its rotation[axis] += v (the sign claims B relies on). */
const shift = (id, part, axis, v) => { const m = buildL(id); const p = m.parts[part]; const a = centre(p); p.rotation[axis] += v; return centre(p).sub(a); };

test('bugs: every habitat-bug species except the beetle has a spec; the rarity table matches species.js', () => {
  const bug = SPECIES.filter(s => s.habitat === 'bug' && s.id !== 'beetle');
  assertEq(bug.map(s => s.id).sort(), BUG_IDS.slice().sort(), 'the 13 bug friends');
  for (const id of BUG_IDS) { assert(hasModel(id), 'no model for ' + id); assertEq(getSpecies(id).rarity, BUG[id], id + ' rarity'); }
  assert(hasModel('beetle'), 'the beetle was already there');
});

test('bugs: 13 models build; budgets (common/uncommon <= 1.0k tris + 6 calls, rare/epic <= 1.6k + 7), finite, standing on the ground', () => {
  const rows = [];
  for (const id of BUG_IDS) {
    for (const stage of [0, 2, 3]) {
      const m = buildL(id, { stage });
      assertEq(m.kind, 'model', id);
      assert(m.root.isGroup && m.body.isGroup && m.head && m.head.isGroup && m.body.parent === m.root, id + ' groups');
      const t = tris(m.root), calls = drawCalls(m) - (stage === 3 ? 1 : 0);
      const b = bugBudget(id);
      assert(t <= b.tris, `${id} has ${t} triangles (budget ${b.tris})`);
      assert(calls <= b.calls, `${id} uses ${calls} draw calls (budget ${b.calls})`);
      assert(Number.isFinite(m.height) && m.height > 0.3 && m.height < 2.4, `${id} height ${m.height}`);
      assert(Number.isFinite(m.radius) && m.radius > 0.2 && m.radius < 1.4, `${id} radius ${m.radius}`);
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
  console.log('[models] bug: ' + rows.join(', '));
});

test('bugs: the shared toon material + one eye material only; merged geometry cached per species and shiny', () => {
  const mats = new Set();
  for (const id of BUG_IDS) {
    materials(buildL(id).root, mats);
    const a = buildL(id), b = buildL(id, { stage: 0 });
    for (const n of ['bodyMesh', 'headMesh']) assert(geoOf(a, n) === geoOf(b, n), `${id} ${n} not shared`);
    assert(geoOf(buildL(id, { shiny: true }), 'bodyMesh') !== geoOf(a, 'bodyMesh'), id + ' shiny has its own buffers');
    assertEq(tris(buildL(id).root), tris(buildL(id, { shiny: true }).root), id + ' shiny keeps the geometry');
  }
  assertEq([...mats].filter(x => x.isMeshToonMaterial).length, 1, 'one shared toon material for all 13');
  assertEq([...mats].filter(x => !x.isMeshToonMaterial).length, 1, 'plus the eye material');
});

test('bugs: standard parts exist per pet and can be driven (eyes, head, anchor; wings / shells, tail, antennae, claws, spider legs, snail shell as documented)', () => {
  const WINGS = ['bee', 'butterfly', 'ladybug', 'cricket', 'fly', 'cockroach', 'mosquito'];
  const TAIL = ['bee', 'caterpillar', 'earthworm', 'scorpion'];
  const EARS = ['ant', 'caterpillar', 'snail', 'cockroach', 'mosquito', 'scorpion'];
  for (const id of BUG_IDS) {
    const m = buildL(id);
    assertEq(m.parts.eyes.length, 1, id + ' merged eyes');
    assert(m.parts.eyes[0].parent === m.head && m.anchor && m.anchor.parent === m.head && m.anchor.position.y > 0.1, id + ' eyes + anchor on the head');
    assertEq(!!m.parts.wingL && !!m.parts.wingR, WINGS.includes(id), id + ' wing pivots');
    assertEq(!!m.parts.tail, TAIL.includes(id), id + ' tail pivot');
    assertEq(!!m.parts.earL && !!m.parts.earR, EARS.includes(id), id + ' earL / earR pivots');
    assertEq(!!m.parts.shell, id === 'snail', id + ' shell pivot');
    assertEq(!!m.parts.legL && !!m.parts.legR, id === 'spider', id + ' leg pivots');
    for (const k of ['wingL', 'wingR', 'tail', 'earL', 'earR', 'shell', 'legL', 'legR']) {
      const p = m.parts[k];
      if (!p) continue;
      assert(p.children.some(c => c.isMesh), `${id}.${k} has geometry`);
      assert(buildL(id).parts[k] !== p, `${id}.${k} is per pet (clone)`);
    }
    if (m.parts.wingL) assert(m.parts.wingL.position.x > 0 && m.parts.wingR.position.x < 0, id + ' wings: L is +x, R is -x');
    m.head.rotation.y = 0.5; m.parts.eyes[0].scale.y = 0.1;
    for (const k of ['wingL', 'tail', 'earL', 'shell', 'legL']) if (m.parts[k]) m.parts[k].rotation.x += 0.3;
    m.root.updateMatrixWorld(true);
    assert(Number.isFinite(new THREE.Box3().setFromObject(m.root).max.y), id + ' finite when driven');
    assertEq([m.parts.fluke, m.parts.bubble, m.parts.trunk, m.parts.tailTip], [null, null, null, null], id + ' has no water / mammoth parts');
  }
});

test('bugs: the rotation signs written in the models.js comment are true (wings, shells, tail, antennae, claws, spider legs, snail shell)', () => {
  for (const id of ['bee', 'butterfly', 'ladybug', 'cricket', 'fly', 'cockroach', 'mosquito']) {
    const l = shift(id, 'wingL', 'z', 0.4), r = shift(id, 'wingR', 'z', -0.4);
    assert(l.y > 0.01 && r.y > 0.01, `${id}: wingL.z += a and wingR.z -= a raise the tips (${l.y.toFixed(3)}, ${r.y.toFixed(3)})`);
    assert(shift(id, 'wingL', 'z', -0.4).y < 0.005, id + ': the opposite sign lowers the wing');
  }
  assert(shift('bee', 'tail', 'x', 0.4).y > 0.01, 'bee tail.x += raises the stinger');
  assert(shift('bee', 'tail', 'y', 0.4).x < -0.01, 'bee tail.y += swings the tip to the right (-x)');
  assert(shift('caterpillar', 'tail', 'y', 0.4).x < -0.01 && shift('earthworm', 'tail', 'y', 0.4).x < -0.01, 'worm tails: +y swings to -x');
  assert(shift('scorpion', 'tail', 'x', 0.4).z > 0.05, 'scorpion tail.x += curls it forward');
  assert(shift('scorpion', 'tail', 'y', 0.4).x > 0.05, 'scorpion tail.y += swings the stinger to +x');
  for (const id of ['ant', 'caterpillar', 'cockroach', 'mosquito', 'snail']) {
    const f = shift(id, 'earL', 'x', 0.4);
    assert(f.z > 0.01 && f.y < 0, `${id}: earL.x += tips the antenna forward and down`);
    assert(shift(id, 'earL', 'z', 0.4).x < -0.01 && shift(id, 'earR', 'z', -0.4).x > 0.01, `${id}: earL.z += / earR.z -= pull the antennae together`);
  }
  assert(shift('scorpion', 'earL', 'x', 0.4).y < -0.05 && shift('scorpion', 'earL', 'x', -0.4).y > 0.05, 'scorpion claw: x += lowers, x -= lifts');
  assert(shift('scorpion', 'earL', 'z', 0.4).x < -0.05, 'scorpion claw: earL.z += swings inward');
  assert(shift('spider', 'legL', 'z', 0.3).y > 0.05 && shift('spider', 'legR', 'z', -0.3).y > 0.05, 'spider legs: legL.z += / legR.z -= lift the feet');
  assert(shift('spider', 'legL', 'x', 0.5).z < 0, 'spider legs: x += swings the feet backward');
  assert(shift('snail', 'shell', 'x', 0.3).z > 0, 'snail shell: x += tips it forward');
});

test('bugs: signature parts are really there (stripes, spotted shells, ant antennae, snail swirl, spider legs, scorpion claws + gem, friendly cockroach / mosquito)', () => {
  const size = (m, n) => bboxOf(m, n).getSize(new THREE.Vector3());
  assert(hasColor(buildL('bee'), 'bodyMesh', '#5a3d2b') && hasColor(buildL('bee'), 'wingLMesh', '#e4f4ff'), 'bee: dark stripes + pale wings');
  assert(['#ff9ad5', '#ffc4ea', '#fff2a8'].every(c => hasColor(buildL('butterfly'), 'wingLMesh', c)) && size(buildL('butterfly'), 'wingLMesh').x > 0.4, 'butterfly: big spotted wings');
  assert(hasColor(buildL('ladybug'), 'wingLMesh', '#f0453a') && hasColor(buildL('ladybug'), 'wingLMesh', '#2a2430'), 'ladybug: red shell with black spots');
  assert(size(buildL('ant'), 'earLMesh').length() > 0.2, 'ant: long elbowed antennae');
  assert(['#ffbd7a', '#fff0c8', '#ff9a5c'].every(c => hasColor(buildL('snail'), 'shellMesh', c)), 'snail: swirled shell');
  assert(size(buildL('spider'), 'legLMesh').x > 0.3 && geoOf(buildL('spider'), 'legLMesh').attributes.position.count > 100, 'spider: four legs per side');
  assert(hasColor(buildL('scorpion'), 'tailMesh', '#7ae8ff') && size(buildL('scorpion'), 'tailMesh').y > 0.4, 'scorpion: a tall tail with a diamond');
  for (const id of ['cockroach', 'mosquito']) {
    const spec = MODEL_SPECS[id];
    assert(spec.blush !== false && spec.eyes.s >= 0.2 && spec.extras.some(e => e.t === 'smile'), id + ': big eyes, blush and a smile');
    const o = { h: 0, s: 0, l: 0 };
    new THREE.Color(spec.body.color).getHSL(o, THREE.SRGBColorSpace);
    assert(o.l > 0.6, `${id}: pastel body (lightness ${o.l.toFixed(2)})`);
  }
});

test('bugs: shiny = curated palettes (each palette really hits the model; eyes never shift; no hue-rotated fallback)', () => {
  for (const id of BUG_IDS) {
    const spec = MODEL_SPECS[id], pal = spec.shinyPalette;
    assert(pal && Object.keys(pal).length >= 3, id + ' has a curated palette');
    for (const k of Object.keys(pal)) assert(k === k.toLowerCase() && /^#[0-9a-f]{6}$/.test(k) && /^#[0-9a-f]{6}$/.test(pal[k]), `${id}: palette key ${k}`);
    const normal = buildL(id), shiny = buildL(id, { shiny: true });
    assertEq([shiny.shiny, shiny.shinyStyle], [true, 'palette'], id + ' flag');
    const cn = vertexColors(normal), cs = vertexColors(shiny);
    const hit = Object.keys(pal).filter(k => cn.has(hexKey(k)));
    assert(hit.length >= 3, `${id}: only ${hit.length} palette colours are used by the model (${hit.join(',')})`);
    for (const k of hit) assert(cs.has(hexKey(pal[k])) && !cs.has(hexKey(k)), `${id}: ${k} -> ${pal[k]} not applied`);
    assertEq([...vertexColors(shiny, true)].sort().join('|'), [...vertexColors(normal, true)].sort().join('|'), id + ' eyes keep their colour');
    const mix = (a, b) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * 0.4 + parseInt(b.slice(i, i + 2), 16) * 0.6).toString(16).padStart(2, '0')).join('');
    const blush = hexKey(mix(spec.head.color || spec.body.color, spec.blush || '#ff8fa3'));
    const unlisted = [...cn].filter(c => !Object.keys(pal).some(k => hexKey(k) === c) && c !== blush);
    for (const c of unlisted) assert(cs.has(c), `${id}: unlisted colour ${c} changed when shiny`);
  }
});

test('bugs: coats recolour every bug through the shared palette (no extra calls, geometry or materials)', () => {
  for (const id of BUG_IDS) {
    const base = buildL(id), baseCols = vertexColors(base);
    for (const coat of ['mint', 'midnight']) {
      const m = buildL(id, { coat });
      assert([...vertexColors(m)].filter(c => !baseCols.has(c)).length >= 3, `${id} ${coat}: body colours changed`);
      assertEq(tris(m.root), tris(base.root), `${id} ${coat}: same geometry`);
      assertEq(drawCalls(m), drawCalls(base), `${id} ${coat}: same draw calls`);
      assert(sameSet(vertexColors(m, true), vertexColors(base, true)), `${id} ${coat}: eye colours must not change`);
    }
  }
});

test('bugs: stage scale + crown still work (master crown rides the head); masters stay inside the call budget + 1', () => {
  for (const id of BUG_IDS) {
    for (let st = 0; st < 4; st++) {
      const m = buildL(id, { stage: st });
      assertEq(m.root.scale.x, STAGE_SCALE[st], `${id} scale at stage ${st}`);
      assertEq(!!m.parts.crown, st === 3, `${id} crown at stage ${st}`);
    }
    const master = buildL(id, { stage: 3 });
    assert(master.parts.crown.parent === master.head, id + ' crown on the head');
    assert(drawCalls(master) <= bugBudget(id).calls + 1, `${id} master calls ${drawCalls(master)}`);
  }
});

test('bugs: 20 mixed pets at XL stay inside the scene budget (<= 240 calls)', () => {
  const MIX = [...BUG_IDS, 'hamster', 'cow', 'sparrow', 'owl', 'fox', 'turtle', 'dragon'];
  let calls = 0, trisSum = 0, bugCalls = 0;
  for (let i = 0; i < 20; i++) { const m = buildL(MIX[i % MIX.length], { stage: 3 }); calls += drawCalls(m); trisSum += tris(m.root); }
  for (let i = 0; i < 20; i++) bugCalls += drawCalls(buildL(BUG_IDS[i % BUG_IDS.length], { stage: 3 }));
  assert(calls <= 240, '20 mixed XL pets: ' + calls + ' calls');
  assert(bugCalls <= 20 * 8, '20 bug masters: ' + bugCalls + ' calls');
  console.log(`[models] 20 mixed XL pets = ${calls} model draw calls, ${trisSum} tris; 20 XL bugs = ${bugCalls} calls`);
});

// ── V10 §2: coats (3D) ──────────────────────────────────────────────────────
const COAT_IDS_3D = ['cream', 'cocoa', 'mint', 'rose', 'midnight'];
const sameSet = (a, b) => [...a].sort().join('|') === [...b].sort().join('|');

test('coats: a coat recolours the body-like vertex colours of a model but never the eyes; base = no coat = identical', () => {
  for (const id of ['cow', 'hamster', 'dove', 'owl', 'turtle', 'dragon']) {
    const base = buildL(id), baseCols = vertexColors(base);
    assert(sameSet(vertexColors(buildL(id, { coat: 'base' })), baseCols), id + ': coat base = no coat');
    assert(geoOf(buildL(id, { coat: 'base' }), 'bodyMesh') === geoOf(base, 'bodyMesh'), id + ': base coat shares the plain template');
    assert(sameSet(vertexColors(buildL(id, { coat: 'nonsense' })), baseCols), id + ': an unknown coat is base');
    for (const coat of COAT_IDS_3D) {
      const m = buildL(id, { coat }), cols = vertexColors(m);
      assert([...cols].filter(c => !baseCols.has(c)).length >= 3, `${id} ${coat}: body colours changed`);
      assert(sameSet(vertexColors(m, true), vertexColors(base, true)), `${id} ${coat}: eye colours must not change`);
      assertEq(tris(m.root), tris(base.root), `${id} ${coat}: same geometry`);
      assert(!m.shiny && m.shinyStyle === null, `${id} ${coat}: a coat is not shiny`);
    }
  }
  // the coats look different from each other
  const bodyHash = coat => [...vertexColors(buildL('hamster', { coat }))].sort().join('|');
  assertEq(new Set(['base', ...COAT_IDS_3D].map(bodyHash)).size, 6, 'six distinct looks');
});

test('coats: mint turns a white cow green, midnight and cocoa are darker, every coat stays readable (not black, not white)', () => {
  const avg = (m, mesh = 'bodyMesh') => {
    const a = geoOf(m, mesh).attributes.color, c = new THREE.Color(), o = { h: 0, s: 0, l: 0 };
    let h = 0, s = 0, l = 0;
    for (let i = 0; i < a.count; i++) { c.setRGB(a.getX(i), a.getY(i), a.getZ(i)); c.getHSL(o); h += o.h; s += o.s; l += o.l; }
    return { h: h / a.count * 360, s: s / a.count, l: l / a.count };
  };
  const base = avg(buildL('hamster')), midnight = avg(buildL('hamster', { coat: 'midnight' })), cocoa = avg(buildL('hamster', { coat: 'cocoa' })), mint = avg(buildL('cow', { coat: 'mint' }));
  assert(midnight.l < base.l * 0.75, `midnight is dark (${midnight.l.toFixed(2)} vs ${base.l.toFixed(2)})`);
  assert(cocoa.l < base.l, 'cocoa is darker');
  assert(mint.h > 80 && mint.h < 200 && mint.s > 0.1, `a mint cow reads green (hue ${mint.h.toFixed(0)}, sat ${mint.s.toFixed(2)})`);
  for (const coat of COAT_IDS_3D) for (const id of ['cow', 'hamster', 'sheep']) {
    const v = avg(buildL(id, { coat }));
    assert(v.l > 0.12 && v.l < 0.97, `${id} ${coat}: lightness ${v.l.toFixed(2)} stays readable`);
  }
});

test('coats: shiny wins over the coat; templates are shared per coat; no extra draw calls or materials', () => {
  for (const id of ['cow', 'sparrow', 'dragon']) {
    const plainShiny = buildL(id, { shiny: true });
    for (const coat of COAT_IDS_3D) {
      const m = buildL(id, { shiny: true, coat });
      assert(geoOf(m, 'bodyMesh') === geoOf(plainShiny, 'bodyMesh'), `${id}: shiny ${coat} shares the shiny template (the coat is ignored)`);
      assert(sameSet(vertexColors(m), vertexColors(plainShiny)), `${id}: shiny ${coat} has the shiny colours`);
      assertEq(m.shinyStyle, 'palette', id + ' shinyStyle');
    }
  }
  const before = kitStats(THREE);
  const a = buildL('goat', { coat: 'mint' }), b = buildL('goat', { coat: 'mint', stage: 0 }), c = buildL('goat', { coat: 'rose' }), d = buildL('goat');
  assert(geoOf(a, 'bodyMesh') === geoOf(b, 'bodyMesh') && geoOf(a, 'headMesh') === geoOf(b, 'headMesh'), 'same coat: shared merged geometry');
  assert(geoOf(a, 'bodyMesh') !== geoOf(c, 'bodyMesh') && geoOf(a, 'bodyMesh') !== geoOf(d, 'bodyMesh') && geoOf(c, 'bodyMesh') !== geoOf(d, 'bodyMesh'), 'different coats have their own templates');
  assert(kitStats(THREE).templates - before.templates <= 3, 'at most one template per coat (mint, rose, plain goat)');
  const after = kitStats(THREE);
  buildL('goat', { coat: 'mint' }); buildL('goat', { coat: 'rose' });
  assertEq(kitStats(THREE).templates, after.templates, 'repeat builds make no new templates');
  assertEq(kitStats(THREE).materials, after.materials, 'no new materials');
  for (const coat of COAT_IDS_3D) {
    const m = buildL('goat', { coat }), p = buildL('goat');
    assertEq(drawCalls(m), drawCalls(p), coat + ': same draw calls');
    assert([...materials(m.root)].every(x => materials(p.root).has(x)), coat + ': same shared materials');
  }
  // billboards (species without a spec) never tint: just the emoji
  const bb = buildPetModel(THREE, { speciesId: 'dodo', stage: 2, coat: 'mint' }, getSpecies('dodo'));
  assertEq(bb.kind, 'billboard', 'a coated billboard is just the emoji');
});

// ── V15 §4: the 12 savanna friends ──────────────────────────────────────────
const SAVANNA = {
  lizard: 'common', camel: 'common', bactrian: 'common', zebra: 'uncommon', kangaroo: 'uncommon', bison: 'uncommon', crocodile: 'uncommon',
  elephant: 'rare', giraffe: 'rare', hippo: 'rare', rhino: 'epic', leopard: 'epic',
};
const SAVANNA_IDS = Object.keys(SAVANNA);
const SAVANNA_BUDGET = { tris: 1500, calls: 7 };

test('savanna: every habitat-savanna species except the golden lion has a spec (the lion keeps its V13 model); rarity table matches species.js', () => {
  const sav = SPECIES.filter(s => s.habitat === 'savanna' && s.id !== 'lion');
  assertEq(sav.map(s => s.id).sort(), SAVANNA_IDS.slice().sort(), 'the 12 savanna friends');
  for (const id of SAVANNA_IDS) {
    assert(hasModel(id), 'no model for ' + id);
    assertEq(getSpecies(id).rarity, SAVANNA[id], id + ' rarity');
  }
  assert(hasModel('lion'), 'the golden lion was already there');
});

test('savanna: 12 models build; budgets (<= 1500 tris + 7 draw calls), finite, standing on the ground', () => {
  const rows = [];
  for (const id of SAVANNA_IDS) {
    for (const stage of [0, 2, 3]) {
      const m = buildL(id, { stage });
      assertEq(m.kind, 'model', id);
      assert(m.root.isGroup && m.body.isGroup && m.head && m.head.isGroup && m.body.parent === m.root, id + ' groups');
      const t = tris(m.root), calls = drawCalls(m) - (stage === 3 ? 1 : 0);   // the crown sprite is an extra call for masters only
      assert(t <= SAVANNA_BUDGET.tris, `${id} has ${t} triangles (budget ${SAVANNA_BUDGET.tris})`);
      assert(calls <= SAVANNA_BUDGET.calls, `${id} uses ${calls} draw calls (budget ${SAVANNA_BUDGET.calls})`);
      assert(Number.isFinite(m.height) && m.height > 0.4 && m.height < 2.6, `${id} height ${m.height}`);
      assert(Number.isFinite(m.radius) && m.radius > 0.15 && m.radius < 1.5, `${id} radius ${m.radius}`);
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
  console.log('[models] savanna: ' + rows.join(', '));
});

test('savanna: the shared toon material + one eye material only; merged geometry cached per species and shiny; hand-tuned chibi eyes + blush', () => {
  const mats = new Set();
  for (const id of SAVANNA_IDS) {
    materials(buildL(id).root, mats);
    const a = buildL(id), b = buildL(id, { stage: 0 });
    for (const n of ['bodyMesh', 'headMesh']) assert(geoOf(a, n) === geoOf(b, n), `${id} ${n} not shared`);
    assert(geoOf(buildL(id, { shiny: true }), 'bodyMesh') !== geoOf(a, 'bodyMesh'), id + ' shiny has its own buffers');
    assertEq(tris(buildL(id).root), tris(buildL(id, { shiny: true }).root), id + ' shiny keeps the geometry');
    // CHIBI_TUNED: the V14 chibify pass must skip them, so the spec's own eyes are what is built (it would otherwise multiply s and clamp to 0.21)
    const e = MODEL_SPECS[id].eyes;
    assert(e.s >= 0.17 && e.s <= 0.21 && e.tall >= 1.3, `${id}: sparkly chibi eyes (s ${e.s}, tall ${e.tall})`);
    assert(MODEL_SPECS[id].blush !== false, id + ' has a blush');
  }
  const toon = [...mats].filter(x => x.isMeshToonMaterial);
  assertEq(toon.length, 1, 'one shared toon material for all 12');
  assertEq([...mats].filter(x => !x.isMeshToonMaterial).length, 1, 'plus the eye material');
});

test('savanna: standard animated parts (head, eyes, anchor, tail) exist; the elephant trunk is a pivot', () => {
  for (const id of SAVANNA_IDS) {
    const m = buildL(id);
    assert(m.head && m.parts.eyes.length === 1 && m.anchor && m.anchor.parent === m.head, id + ' head / eyes / anchor');
    assert(m.parts.tail && m.parts.tail.isGroup, id + ' tail pivot');
    if (id !== 'elephant') assertEq(m.parts.trunk, null, id + ' has no trunk pivot');
  }
  const el = buildL('elephant');
  assert(el.parts.trunk && el.parts.trunk.parent === el.head, 'elephant trunk pivot on the head');
  el.parts.trunk.rotation.x += 0.4;
  el.root.updateMatrixWorld(true);
  assert(new THREE.Box3().setFromObject(el.root).min.toArray().every(Number.isFinite), 'trunk can swing');
});

test('savanna: signature parts are really there (giraffe neck + patches, elephant trunk + ears + tusks, zebra stripes, kangaroo pouch + tail, camel humps, crocodile snout + crest, hippo muzzle, rhino horns, leopard spots, bison hump + mane, lizard tail)', () => {
  const size = (m, n) => bboxOf(m, n).getSize(new THREE.Vector3());
  const sp = id => MODEL_SPECS[id];
  // giraffe: a very long neck (tallest of the savanna), patches on body + neck, ossicones + tuft tail
  const gir = buildL('giraffe');
  for (const id of SAVANNA_IDS.filter(i => i !== 'giraffe')) assert(gir.height > buildL(id).height + 0.2, 'giraffe is taller than ' + id);
  assert(gir.height > 1.5 && sp('giraffe').head.y > 1.3 && sp('giraffe').neck, 'giraffe: head high on a long neck');
  assert(hasColor(gir, 'bodyMesh', '#e0a15c') && hasColor(gir, 'tailMesh', '#9a6a44') && hasColor(gir, 'headMesh', '#c99a6c'), 'giraffe: patches, tail tuft, ossicones');
  // elephant: a long trunk pivot, huge ears (wider than the head), cream tusks
  const ele = buildL('elephant');
  assert(size(ele, 'trunkMesh').length() > 0.35 && ele.parts.trunk.position.y < 0, 'elephant: long trunk hanging from the face');
  assert(size(ele, 'headMesh').x > sp('elephant').head.r * 2 * 1.3, 'elephant: big ears stick out far past the head: ' + size(ele, 'headMesh').x);
  assert(hasColor(ele, 'headMesh', '#fbf3dc') && hasColor(ele, 'headMesh', '#ffd6e4'), 'elephant: tusks + pink inner ears');
  // zebra: dark stripes baked on the body and the head, striped mane + tail tuft
  const zeb = buildL('zebra');
  assert(hasColor(zeb, 'bodyMesh', '#3a3238') && hasColor(zeb, 'headMesh', '#3a3238') && hasColor(zeb, 'tailMesh', '#3a3238'), 'zebra: stripes on body, head, tail');
  assert(sp('zebra').extras.find(e => e.t === 'stripes').at.length >= 4, 'zebra: at least 4 body stripes');
  // kangaroo: pale belly pouch, a thick long tail on the ground, tall upright ears, big hind feet
  const kan = buildL('kangaroo');
  assert(hasColor(kan, 'bodyMesh', '#f2cda3') && hasColor(kan, 'bodyMesh', '#d4906a'), 'kangaroo: belly pouch with a seam');
  assert(size(kan, 'tailMesh').length() > 0.45 && size(kan, 'tailMesh').x > 0.15, 'kangaroo: thick long tail: ' + size(kan, 'tailMesh').toArray());
  assert(bboxOf(kan, 'headMesh').max.y > sp('kangaroo').head.r * 1.4, 'kangaroo: tall ears above the head');
  assert(bboxOf(kan, 'bodyMesh').max.z > 0.38, 'kangaroo: big hind feet reach out in front of the body');
  // camel: one hump, bactrian: two humps (dome blobs taller than the back)
  const humps = id => sp(id).extras.filter(e => e.t === 'blobs').flatMap(e => e.list).filter(b => b.s[1] >= 0.2);
  assertEq(humps('camel').length, 1, 'camel: one hump');
  assertEq(humps('bactrian').length, 2, 'bactrian: two humps');
  for (const id of ['camel', 'bactrian']) {
    const b = sp(id).body, back = b.y + b.h;
    assert(bboxOf(buildL(id), 'bodyMesh').max.y > back + 0.1, `${id}: the hump(s) rise above the back`);
  }
  assert(hasColor(buildL('bactrian'), 'bodyMesh', '#a8795a') && hasColor(buildL('bactrian'), 'headMesh', '#a8795a'), 'bactrian: shaggy dark fur on the chest / head');
  assert(buildL('camel').height > buildL('crocodile').height + 0.4, 'camel stands tall on long legs');
  // crocodile: long low body, a long (but cute) snout, back crest, long tail
  const cro = buildL('crocodile');
  assert(size(cro, 'bodyMesh').z > 0.9 && cro.height < 0.8, 'crocodile: long and low');
  assert(bboxOf(cro, 'headMesh').max.z > sp('crocodile').head.r * 1.5, 'crocodile: long snout: ' + bboxOf(cro, 'headMesh').max.z);
  assert(hasColor(cro, 'bodyMesh', '#6cbf82') && size(cro, 'tailMesh').length() > 0.6, 'crocodile: crest + long tail');
  // hippo: very wide muzzle with nostrils + two little teeth
  const hip = buildL('hippo');
  assert(sp('hippo').snout.w >= 0.9 && hasColor(hip, 'headMesh', '#e9dcf5') && hasColor(hip, 'headMesh', '#ffffff'), 'hippo: wide muzzle + teeth');
  assert(size(hip, 'headMesh').x > size(buildL('rhino'), 'headMesh').x * 0.95, 'hippo: the widest face');
  // rhino: cream horns on the nose
  const rhi = buildL('rhino');
  assert(hasColor(rhi, 'headMesh', '#fbeed2') && hasColor(rhi, 'headMesh', '#f0d9a8'), 'rhino: horn colours');
  assert(sp('rhino').extras.filter(e => e.t === 'horn').length === 2 && bboxOf(rhi, 'headMesh').max.z > sp('rhino').head.r * 1.4, 'rhino: two horns, the big one points forward');
  // leopard: rosette spots on the body, head and tail
  const leo = buildL('leopard');
  assert(hasColor(leo, 'bodyMesh', '#6e4a3a') && hasColor(leo, 'headMesh', '#6e4a3a') && hasColor(leo, 'tailMesh', '#6e4a3a'), 'leopard: spots on body, head, tail');
  assert(sp('leopard').extras.find(e => e.t === 'spots').list.length >= 14, 'leopard: lots of spots');
  // bison: shoulder hump + a shaggy dark mane / beard and short horns
  const bis = buildL('bison');
  assert(bboxOf(bis, 'bodyMesh').max.y > sp('bison').body.h * 2 + 0.1, 'bison: shoulder hump');
  assert(hasColor(bis, 'headMesh', '#6b4a38') && hasColor(bis, 'headMesh', '#f4e8cc'), 'bison: shaggy mane + horns');
  // lizard: a long tail (longer than the body), a back crest, tiny and low
  const liz = buildL('lizard');
  assert(size(liz, 'tailMesh').length() > 0.7 && hasColor(liz, 'bodyMesh', '#ffd77a') && liz.height < 0.8, 'lizard: long tail + crest, low');
});

test('savanna: shiny = curated palettes (each palette really hits the model; eyes never shift; no hue-rotated fallback)', () => {
  for (const id of SAVANNA_IDS) {
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
    // the cheek blush is a 60 % blend of the (shifted) head colour with pink: the one colour allowed to move without being listed
    const mix = (a, b) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * 0.4 + parseInt(b.slice(i, i + 2), 16) * 0.6).toString(16).padStart(2, '0')).join('');
    const blush = hexKey(mix(spec.head.color || spec.body.color, spec.blush || '#ff8fa3'));
    const unlisted = [...cn].filter(c => !Object.keys(pal).some(k => hexKey(k) === c) && c !== blush);
    for (const c of unlisted) assert(cs.has(c), `${id}: unlisted colour ${c} changed when shiny`);
  }
});

test('savanna: stage scale + crown still work (master crown rides the head); masters stay inside the call budget + 1', () => {
  for (const id of SAVANNA_IDS) {
    for (let st = 0; st < 4; st++) {
      const m = buildL(id, { stage: st });
      assertEq(m.root.scale.x, STAGE_SCALE[st], `${id} scale at stage ${st}`);
      assertEq(!!m.parts.crown, st === 3, `${id} crown at stage ${st}`);
    }
    const master = buildL(id, { stage: 3 });
    assert(master.parts.crown.parent === master.head, id + ' crown on the head');
    assert(drawCalls(master) <= SAVANNA_BUDGET.calls + 1, `${id} master calls ${drawCalls(master)}`);
    assert(master.height > buildL(id, { stage: 2 }).height, id + ' master is bigger');
  }
});

test('savanna: 20 savanna pets in one yard stay inside the scene budget (sum <= 20 x 7)', () => {
  let calls = 0, trisSum = 0;
  for (let i = 0; i < 20; i++) { const m = buildL(SAVANNA_IDS[i % SAVANNA_IDS.length]); calls += drawCalls(m); trisSum += tris(m.root); }
  assert(calls <= 20 * 7, 'savanna yard of 20 pets: ' + calls + ' calls');
  console.log(`[models] 20 savanna pets = ${calls} model draw calls, ${trisSum} tris`);
});

// ── V16 §4: the 9 polar friends ─────────────────────────────────────────────
const POLAR = { penguin: 'common', seal: 'common', snowhare: 'common', husky: 'uncommon', siberiancat: 'uncommon', snowram: 'uncommon', beluga: 'rare', yak: 'epic', arcticwolf: 'epic' };
const POLAR_IDS = Object.keys(POLAR);
const POLAR_BUDGET = { tris: 1500, calls: 7 };

test('polar: every habitat-polar species except the polar bear has a spec (the bear keeps its V13 model + stays legendary); rarity table matches species.js', () => {
  const pol = SPECIES.filter(s => s.habitat === 'polar' && s.id !== 'polarbear');
  assertEq(pol.map(s => s.id).sort(), POLAR_IDS.slice().sort(), 'the 9 polar friends');
  for (const id of POLAR_IDS) {
    assert(hasModel(id), 'no model for ' + id);
    assertEq(getSpecies(id).rarity, POLAR[id], id + ' rarity');
    assert(!LEGEND_IDS.includes(id), id + ' is not a legendary');
  }
  assert(hasModel('polarbear') && LEGEND_IDS.includes('polarbear'), 'the polar bear was already there and stays legendary');
});

test('polar: 9 models build; budgets (<= 1500 tris + 7 draw calls), finite, standing on the ground', () => {
  const rows = [];
  for (const id of POLAR_IDS) {
    for (const stage of [0, 2, 3]) {
      const m = buildL(id, { stage });
      assertEq(m.kind, 'model', id);
      assert(m.root.isGroup && m.body.isGroup && m.head && m.head.isGroup && m.body.parent === m.root, id + ' groups');
      const t = tris(m.root), calls = drawCalls(m) - (stage === 3 ? 1 : 0);   // the crown sprite is an extra call for masters only
      assert(t <= POLAR_BUDGET.tris, `${id} has ${t} triangles (budget ${POLAR_BUDGET.tris})`);
      assert(calls <= POLAR_BUDGET.calls, `${id} uses ${calls} draw calls (budget ${POLAR_BUDGET.calls})`);
      assert(Number.isFinite(m.height) && m.height > 0.4 && m.height < 2.6, `${id} height ${m.height}`);
      assert(Number.isFinite(m.radius) && m.radius > 0.15 && m.radius < 1.5, `${id} radius ${m.radius}`);
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
  console.log('[models] polar: ' + rows.join(', '));
});

test('polar: the shared toon material + one eye material only (the beluga adds the shared water bubble); merged geometry cached per species and shiny; hand-tuned chibi eyes + blush', () => {
  const mats = new Set();
  for (const id of POLAR_IDS) {
    if (id !== 'beluga') materials(buildL(id).root, mats);
    const a = buildL(id), b = buildL(id, { stage: 0 });
    for (const n of ['bodyMesh', 'headMesh']) assert(geoOf(a, n) === geoOf(b, n), `${id} ${n} not shared`);
    assert(geoOf(buildL(id, { shiny: true }), 'bodyMesh') !== geoOf(a, 'bodyMesh'), id + ' shiny has its own buffers');
    assertEq(tris(buildL(id).root), tris(buildL(id, { shiny: true }).root), id + ' shiny keeps the geometry');
    // CHIBI_TUNED: the V14 chibify pass must skip them, so the spec's own eyes are what is built
    const e = MODEL_SPECS[id].eyes;
    assert(e.s >= 0.17 && e.s <= 0.21 && e.tall >= 1.3, `${id}: sparkly chibi eyes (s ${e.s}, tall ${e.tall})`);
    assert(MODEL_SPECS[id].blush !== false, id + ' has a blush');
  }
  const toon = [...mats].filter(x => x.isMeshToonMaterial);
  assertEq(toon.length, 1, 'one shared toon material for all 8 land friends');
  assertEq([...mats].filter(x => !x.isMeshToonMaterial).length, 1, 'plus the eye material');
  const bel = buildL('beluga');
  assertEq([...materials(bel.root)].filter(x => x.isMeshToonMaterial).length, 1, 'beluga: the same toon material');
  assertEq([...materials(bel.root)].filter(x => !x.isMeshToonMaterial).length, 2, 'beluga: eye material + the bubble');
  assert(bel.parts.bubble && bel.parts.bubble.name === 'bubble', 'beluga floats in a water bubble');
  for (const id of POLAR_IDS.filter(i => i !== 'beluga')) assert(!buildL(id).parts.bubble, id + ' has no bubble');
});

test('polar: standard animated parts (head, eyes, anchor, tail) exist; wings only on the penguin', () => {
  for (const id of POLAR_IDS) {
    const m = buildL(id);
    assert(m.head && m.parts.eyes.length === 1 && m.anchor && m.anchor.parent === m.head, id + ' head / eyes / anchor');
    assert(m.parts.tail && m.parts.tail.isGroup, id + ' tail pivot');
    assertEq(m.parts.trunk, null, id + ' has no trunk pivot');
  }
  const pen = buildL('penguin');
  assert(pen.parts.wingL && pen.parts.wingR && pen.parts.wingL.parent === pen.body, 'penguin flippers are wing pivots');
  pen.parts.wingL.rotation.z += 0.5;
  pen.root.updateMatrixWorld(true);
  assert(new THREE.Box3().setFromObject(pen.root).min.toArray().every(Number.isFinite), 'penguin flippers can flap');
});

test('polar: signature parts are really there (penguin flippers + white belly + orange feet, seal flippers + whiskers + no legs, snow hare ears, husky mask + curled tail, siberian cat fluff, snow ram curled horns + wool, beluga melon, yak horns + fur skirt, arctic wolf ears + ruff)', () => {
  const size = (m, n) => bboxOf(m, n).getSize(new THREE.Vector3());
  const sp = id => MODEL_SPECS[id];
  // penguin: white belly + face patch, orange beak and feet, dark flipper wings
  const pen = buildL('penguin');
  assert(hasColor(pen, 'bodyMesh', '#fcfeff') && hasColor(pen, 'headMesh', '#fcfeff'), 'penguin: white belly + face');
  assert(hasColor(pen, 'headMesh', '#ffb347') && hasColor(pen, 'bodyMesh', '#ffb347'), 'penguin: orange beak + feet');
  assert(sp('penguin').legs.type === 'webbed' && sp('penguin').extras.some(e => e.t === 'wings'), 'penguin: webbed feet + flippers');
  assert(pen.height > buildL('seal').height, 'penguin stands upright, taller than the seal');
  // seal: no legs, long low body, flippers + tail flippers, white whiskers
  const sea = buildL('seal');
  assertEq(sp('seal').legs.type, 'none', 'seal: no legs');
  assert(sp('seal').extras.some(e => e.t === 'flippers') && sp('seal').extras.some(e => e.t === 'whiskers' && e.n >= 3), 'seal: flippers + whiskers');
  assert(hasColor(sea, 'bodyMesh', '#8fa3be') && hasColor(sea, 'tailMesh', '#8fa3be') && size(sea, 'bodyMesh').z > 0.9, 'seal: flippers + tail flippers, long body');
  assert(sea.height < 0.8, 'seal lies low: ' + sea.height);
  // snow hare: long ears (taller than the head), pink inner ears, big hind feet
  const har = buildL('snowhare');
  har.root.updateMatrixWorld(true);
  const earTop = new THREE.Box3().setFromObject(har.parts.earL).max.y;   // the ears are animated pivots, not part of the merged head mesh
  assert(earTop > sp('snowhare').head.y + sp('snowhare').head.r * 2 && sp('snowhare').ears.s >= 1, 'snow hare: long ears far above the head: ' + earTop);
  assert(sp('snowhare').ears.inner === '#ffc2d0' && sp('snowhare').ears.type === 'long', 'snow hare: pink inner ears');
  // husky: white face mask on a grey head, upright ears, a bushy tail curled up over the back with a pale tip
  const hus = buildL('husky');
  assert(hasColor(hus, 'headMesh', '#f6f9fc') && hasColor(hus, 'headMesh', '#8f9db3'), 'husky: white mask on a grey head');
  assert(hasColor(hus, 'tailMesh', '#8f9db3') && hasColor(hus, 'tailMesh', '#f6f9fc') && sp('husky').tail.lift > 1, 'husky: curled tail with a white tip');
  assert(sp('husky').ears.type === 'cat' && sp('husky').ears.up >= 0.6, 'husky: upright ears');
  // siberian cat: fluffy - cheek tufts, neck ruff and a big plume tail, tabby stripes
  const sib = buildL('siberiancat');
  assert(size(sib, 'tailMesh').length() > 0.4 && sp('siberiancat').tail.blob >= 1.2, 'siberian cat: plume tail: ' + size(sib, 'tailMesh').toArray());
  assert(sp('siberiancat').extras.some(e => e.t === 'cheeks') && sp('siberiancat').extras.some(e => e.t === 'wool'), 'siberian cat: cheek tufts + neck ruff');
  assert(hasColor(sib, 'bodyMesh', '#b8a58a'), 'siberian cat: tabby stripes');
  // snow ram: big curled horns on the head, thick white wool on the body
  const ram = buildL('snowram');
  assert(hasColor(ram, 'headMesh', '#d9c9a6') && sp('snowram').extras.some(e => e.t === 'blobs' && e.list.some(b => b.g === 'curl')), 'snow ram: curled horns');
  assert(size(ram, 'headMesh').x > sp('snowram').head.r * 2 * 1.2, 'snow ram: horns stick out past the head: ' + size(ram, 'headMesh').x);
  assert(hasColor(ram, 'bodyMesh', '#fbfcfe') && sp('snowram').extras.find(e => e.t === 'wool').n >= 8, 'snow ram: woolly body');
  // beluga: white whale with a melon forehead, flippers + fluke, in a bubble
  const bel = buildL('beluga');
  assertEq(sp('beluga').legs.type, 'none', 'beluga: no legs');
  assert(hasColor(bel, 'bodyMesh', '#eaf3fa') && hasColor(bel, 'headMesh', '#f7fbff') && hasColor(bel, 'bodyMesh', '#d3e4f2'), 'beluga: white + pale blue flippers');
  assert(sp('beluga').extras.some(e => e.t === 'blobs' && e.on === 'head') && sp('beluga').extras.some(e => e.t === 'smile'), 'beluga: melon + smile');
  assert(bel.parts.tail && size(bel, 'tailMesh').x > 0.3, 'beluga: tail fluke');
  // yak: wide cream horns, a fur skirt hanging off the flanks, a hump, cream socks
  const yak = buildL('yak');
  assert(hasColor(yak, 'headMesh', '#f4e8cc') && sp('yak').extras.some(e => e.t === 'horns' && e.s >= 1), 'yak: big pale horns');
  assert(hasColor(yak, 'bodyMesh', '#6e5044') && hasColor(yak, 'bodyMesh', '#efe2cc'), 'yak: fur skirt + cream socks');
  assert(hasColor(yak, 'headMesh', '#5e4538') && hasColor(yak, 'tailMesh', '#5e4538'), 'yak: shaggy forelock + tail tuft');
  assert(yak.radius >= buildL('snowhare').radius, 'yak is sturdier than the hare');
  // arctic wolf: tall pointy ears, cheek + neck ruff, plume tail
  const wol = buildL('arcticwolf');
  assert(sp('arcticwolf').ears.type === 'cat' && sp('arcticwolf').ears.up >= 0.8 && sp('arcticwolf').ears.s >= 0.7, 'arctic wolf: tall pointy ears');
  assert(bboxOf(wol, 'headMesh').max.y > sp('arcticwolf').head.r * 1.4, 'arctic wolf: ears above the head');
  assert(size(wol, 'tailMesh').length() > 0.4 && sp('arcticwolf').extras.some(e => e.t === 'cheeks') && sp('arcticwolf').extras.some(e => e.t === 'wool'), 'arctic wolf: plume tail + ruff');
  assert(hasColor(wol, 'headMesh', '#f8fbff') && hasColor(wol, 'bodyMesh', '#f1f6fb'), 'arctic wolf: white coat');
});

test('polar: shiny = curated palettes (each palette really hits the model; eyes never shift; no hue-rotated fallback)', () => {
  for (const id of POLAR_IDS) {
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
    // the cheek blush is a 60 % blend of the (shifted) head colour with pink: the one colour allowed to move without being listed
    const mix = (a, b) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * 0.4 + parseInt(b.slice(i, i + 2), 16) * 0.6).toString(16).padStart(2, '0')).join('');
    const blush = hexKey(mix(spec.head.color || spec.body.color, spec.blush || '#ff8fa3'));
    const unlisted = [...cn].filter(c => !Object.keys(pal).some(k => hexKey(k) === c) && c !== blush);
    for (const c of unlisted) assert(cs.has(c), `${id}: unlisted colour ${c} changed when shiny`);
  }
});

test('polar: stage scale + crown still work (master crown rides the head); masters stay inside the call budget + 1', () => {
  for (const id of POLAR_IDS) {
    for (let st = 0; st < 4; st++) {
      const m = buildL(id, { stage: st });
      assertEq(m.root.scale.x, STAGE_SCALE[st], `${id} scale at stage ${st}`);
      assertEq(!!m.parts.crown, st === 3, `${id} crown at stage ${st}`);
    }
    const master = buildL(id, { stage: 3 });
    assert(master.parts.crown.parent === master.head, id + ' crown on the head');
    assert(drawCalls(master) <= POLAR_BUDGET.calls + 1, `${id} master calls ${drawCalls(master)}`);
    assert(master.height > buildL(id, { stage: 2 }).height, id + ' master is bigger');
  }
});

test('polar: 20 polar pets in one yard stay inside the scene budget (sum <= 20 x 7)', () => {
  let calls = 0, trisSum = 0;
  for (let i = 0; i < 20; i++) { const m = buildL(POLAR_IDS[i % POLAR_IDS.length]); calls += drawCalls(m); trisSum += tris(m.root); }
  assert(calls <= 20 * 7, 'polar yard of 20 pets: ' + calls + ' calls');
  console.log(`[models] 20 polar pets = ${calls} model draw calls, ${trisSum} tris`);
});

// V21 tests (CONTRACT_V21): mouth shapes + happy eyes inside the eyes mesh, per-pet eyes material, beaks without a mouth, ear twitch.
import { test, assert, assertEq } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { buildPetModel, MOUTHS } from '../js/world3d/critters.js';
import { MODEL_SPECS } from '../js/data/models.js';
import { getSpecies } from '../js/data/species.js';
import { partBases, applyPartPose, earTwitch } from '../js/petBehaviour.js';

const build = (id, over = {}) => buildPetModel(THREE, { speciesId: id, stage: 2, shiny: false, ...over }, getSpecies(id));
const eyesOf = m => m.parts.eyes[0];
function tagTris(m) {   // triangles per mouth tag in the eyes mesh
  const g = eyesOf(m).geometry, a = g.attributes.mouth, out = {};
  for (let i = 0; i < g.index.count; i += 3) { const k = a.getX(g.index.getX(i)); out[k] = (out[k] || 0) + 1; }
  return out;
}

test('v21 mouth: a cat has the 4 mouth shapes + happy eyes + normal eyes in ONE eyes mesh; the mouth stays small (<= 60 tris)', () => {
  const m = build('cat');
  assert(m.hasMouth, 'cat has a mouth');
  const t = tagTris(m);
  for (const k of [1, 2, 3, 4, 5, 9]) assert(t[k] > 0, `tag ${k} present`);
  assert(t[1] + t[2] + t[3] + t[4] <= 60, `mouth tris ${t[1] + t[2] + t[3] + t[4]}`);
  let meshes = 0;
  m.head.traverse(o => { if (o.isMesh && o.material === eyesOf(m).material) meshes++; });
  assertEq(meshes, 1, 'one eyes mesh (no extra draw call)');
});

test('v21 mouth: beaked species have no mouth; species with the old smile extra get exactly one mouth', () => {
  const beaks = Object.keys(MODEL_SPECS).filter(id => MODEL_SPECS[id].snout && (MODEL_SPECS[id].snout.type === 'beak' || MODEL_SPECS[id].snout.type === 'flatbeak'));
  assert(beaks.length > 0, 'some beaks exist');
  for (const id of beaks) {
    const m = build(id);
    if (MODEL_SPECS[id].extras && MODEL_SPECS[id].extras.some(e => e.t === 'smile')) continue;   // a smile extra puts a mouth back
    assert(!m.hasMouth, id + ' has no mouth');
  }
  const smiley = Object.keys(MODEL_SPECS).filter(id => (MODEL_SPECS[id].extras || []).some(e => e.t === 'smile'));
  assert(smiley.length >= 10, 'smile-extra species');
  for (const id of smiley) {
    const m = build(id);
    assert(m.hasMouth, id + ' has the expression mouth');
    const t = tagTris(m);
    assert(t[1] > 0 && t[1] <= 30, id + ': one smile shape');
  }
});

test('v21 faces: setFace / setEyes drive this pet only; every pet has its own eyes material with one shared shader', () => {
  const a = build('cat'), b = build('cat');
  assert(eyesOf(a).material !== eyesOf(b).material, 'own materials');
  assertEq(eyesOf(a).material.customProgramCacheKey(), eyesOf(b).material.customProgramCacheKey(), 'one program');
  assert(eyesOf(a).geometry === eyesOf(b).geometry, 'shared geometry');
  a.setFace('open');
  assertEq([a.face(), b.face()], [MOUTHS.open, MOUTHS.smile], 'face per pet');
  a.setFace(MOUTHS.frown);
  assertEq(a.face(), MOUTHS.frown, 'numeric face');
  a.setFace('nonsense');
  assertEq(a.face(), MOUTHS.smile, 'unknown -> smile');
  a.setEyes('happy');
  assertEq([eyesOf(a).material.userData.u.uEyeMode.value, eyesOf(b).material.userData.u.uEyeMode.value], [1, 0], 'happy eyes per pet');
  a.setEyes(null);
  assertEq(eyesOf(a).material.userData.u.uEyeMode.value, 0, 'normal eyes');
  // a blink squashes the mesh; the shader gets the scale to keep the mouth still
  eyesOf(a).scale.y = 0.12;
  eyesOf(a).onBeforeRender();
  assertEq(eyesOf(a).material.userData.u.uEyeS.value, 0.12, 'blink scale reaches the shader');
  a.dispose();
});

test('v21 ear twitch: a quick flick that settles back to rest within 0.5 s; ears reset when it ends', () => {
  assertEq([earTwitch(0), earTwitch(0.5), earTwitch(2), earTwitch(-1), earTwitch(NaN)], [0, 0, 0, 0, 0]);
  assert(earTwitch(0.12) < -0.2, 'flicks');
  const m = build('cat');
  const base = partBases(m.parts);
  assert(base.earL && base.earR, 'ears remembered');
  const x0 = m.parts.earL.rotation.x;
  applyPartPose(m.parts, base, { earL: -0.4 });
  assert(Math.abs(m.parts.earL.rotation.x - (x0 - 0.4)) < 1e-9, 'left ear flicked');
  applyPartPose(m.parts, base, { earL: 0 });
  assert(Math.abs(m.parts.earL.rotation.x - x0) < 1e-9, 'back to rest');
  assert(m.parts.earL.userData.twitch, 'cat ears twitch');
  const finned = Object.keys(MODEL_SPECS).find(id => MODEL_SPECS[id].ears && MODEL_SPECS[id].ears.type === 'fin');
  if (finned) assert(!build(finned).parts.earL.userData.twitch, finned + ': fins do not twitch');
});

test('v21 review: ring-eyed species keep the light ring under the happy ^ (tag 0, never hidden)', () => {
  const ringed = Object.keys(MODEL_SPECS).find(id => MODEL_SPECS[id].eyes && MODEL_SPECS[id].eyes.ring);
  assert(ringed, 'a ring-eyed species exists');
  const t = tagTris(build(ringed));
  assert(t[0] > 0 && t[5] > 0 && t[9] > 0, `${ringed}: ring (0), happy (5) and open eyes (9) all present`);
});

// V22 tests (CONTRACT_V22): wind on the grass materials, petals by day only, 3D portraits with the emoji fallback.
import { test, assert, assertEq } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { windify } from '../js/world3d/engine.js';
import { createSkyFx } from '../js/world3d/skyfx.js';
import { skyAt } from '../js/world3d/daylight.js';
import { portraitSig, portraitOf, avatarHtml, patchPortraits, onPortrait, setPortraitOptions, portraitStats } from '../js/ui/portraits.js';
import { detectWebGL } from '../js/world3d/support.js';

test('v22 wind: no wind object = the material is untouched (low tier); with wind it gets its own sway shader key', () => {
  const plain = new THREE.MeshToonMaterial();
  assert(windify(plain, null, 0, 1) === plain && !plain.customProgramCacheKey().startsWith('nf-wind'), 'low tier: no sway');
  const m = windify(new THREE.MeshToonMaterial(), { t: { value: 0 } }, -0.15, 1.3);
  assert(m.customProgramCacheKey().startsWith('nf-wind'), 'sway key');
  const sh = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '' };
  m.onBeforeCompile(sh);
  assert(sh.uniforms.uWindT && sh.vertexShader.includes('uWindT') && sh.vertexShader.includes('transformed.x +='), 'vertex sway injected');
});

test('v22 petals: by day on high (24) / medium (12), none on low, none at night or in the rain', () => {
  const day = skyAt(12), night = skyAt(22);
  const hi = createSkyFx(THREE, { tier: 'high' }), med = createSkyFx(THREE, { tier: 'medium' }), lo = createSkyFx(THREE, { tier: 'low' });
  try {
    hi.setLook(day, 0); med.setLook(day, 0); lo.setLook(day, 0);
    assertEq([hi.info().petals, med.info().petals, lo.info().petals], [24, 12, 0], 'by tier');
    hi.update(0.1, 1);
    hi.setLook(night, 0);
    assertEq(hi.info().petals, 0, 'night');
    hi.setLook(day, 1);
    assertEq(hi.info().petals, 0, 'rain');
  } finally { hi.dispose(); med.dispose(); lo.dispose(); }
});

test('v22 portraits: the key follows what the picture shows; not ready = the emoji span (marked for a later swap)', () => {
  const a = { id: 'x', speciesId: 'cat', stage: 2, shiny: false, coat: 'base' };
  assertEq(portraitSig(a), portraitSig({ ...a, id: 'y', nickname: 'อื่น' }), 'name / id do not matter');
  assert(portraitSig(a) !== portraitSig({ ...a, coat: 'rose' }) && portraitSig(a) !== portraitSig({ ...a, shiny: true }) && portraitSig(a) !== portraitSig({ ...a, stage: 1 }), 'coat / shiny / stage matter');
  const html = avatarHtml({ ...a, speciesId: 'nope_species' }, 'pet-emoji', '❓');
  assert(html.startsWith('<span class="pet-emoji"') && html.includes('data-portrait=') && html.includes('❓'), 'unknown species: emoji');
  assertEq(portraitOf(null), null, 'no pet');
});

test('v22 portraits: rendered once from the 3D model (when WebGL works), then cards get an <img> and old spans are swapped', async () => {
  if (!detectWebGL({ allowSoftware: true })) { console.log('PASS note: no WebGL, skipped'); return; }
  setPortraitOptions({ allowSoftware: true });
  try {
    const pet = { id: 'p', speciesId: 'rabbit', stage: 2, shiny: false, coat: 'rose' };
    const host = document.createElement('div');
    host.innerHTML = avatarHtml(pet, 'pet-emoji', '🐰');
    document.body.appendChild(host);
    let ready = portraitOf(pet);
    if (!ready) ready = await new Promise((res, rej) => { const off = onPortrait((sig, url) => { off(); res(url); }); setTimeout(() => rej(new Error('no portrait in 8 s: ' + JSON.stringify(portraitStats()))), 8000); });
    assert(String(ready).startsWith('blob:'), 'a short blob: URL (not a big data URL in every card)');
    assert(avatarHtml(pet, 'pet-emoji', '🐰').startsWith('<img class="pet-emoji pet-portrait"'), 'an <img> once ready');
    patchPortraits(host);
    assert(host.querySelector('img.pet-portrait') && !host.querySelector('[data-portrait]'), 'the waiting span was swapped');
    host.remove();
    await new Promise(r => setTimeout(r, 600));
    assertEq(portraitStats().queued, 0, 'queue drained (the offscreen GL context is released when idle)');
  } finally { setPortraitOptions({ allowSoftware: false }); }
});

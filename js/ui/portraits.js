// V22 pet portraits (CONTRACT_V22 §5): small pictures rendered from each pet's real 3D model, used by the cards instead of the emoji,
// so every device shows the same pet the yard shows (species, stage, coat, shiny, Limited palette).
//
//   portraitOf(pet)        -> blob: URL | null (null = not ready yet / not available: show the emoji; the render is queued)
//   onPortrait(fn)         -> unsubscribe; fn(sig, url) after a portrait is ready
//   portraitSig(pet)       the cache key (what the picture depends on)
//   avatarHtml(pet, cls, emojiHtml)   <img> when ready, else the emoji span (with data-portrait so a later patch can swap it)
//   patchPortraits(root)   swaps ready pictures into [data-portrait] spans under root (no re-render needed)
//
// One small offscreen renderer, created on the first request and reused; one picture per idle moment. Nothing is saved.
// Not used when WebGL is missing (or software-only), with the "low" graphics setting, or for species without a model.

import { detectWebGL } from '../world3d/support.js';
import { getQualityPref } from '../prefs.js';
import { getSpecies } from '../data/species.js';

export const PORTRAIT_PX = 160;
const cache = new Map();          // sig -> data URL
const queued = new Map();         // sig -> pet snapshot
const failedSig = new Set();      // species without a 3D model: stay emoji, never queued again
const listeners = new Set();
let kit = null;                   // { THREE, renderer, scene, camera, buildPetModel, hasModel }
let kitLoading = null;
let failed = false;
let busy = false;
let opts = { allowSoftware: false };

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function portraitSig(pet) {
  return pet ? `${pet.speciesId}|${pet.stage | 0}|${pet.shiny ? 1 : 0}|${pet.coat || 'base'}|${pet.limited || ''}` : '';
}

/** Tests / debug: { allowSoftware } lets a software WebGL render portraits. */
export function setPortraitOptions(o = {}) { opts = { ...opts, ...o }; }

export function portraitsEnabled() {
  if (failed) return false;
  try { if (getQualityPref() === 'low') return false; } catch { /* storage blocked: default quality */ }
  return detectWebGL({ allowSoftware: !!opts.allowSoftware });
}

export function onPortrait(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function portraitOf(pet) {
  if (!pet || !getSpecies(pet.speciesId)) return null;
  const sig = portraitSig(pet);
  if (failedSig.has(sig) || !portraitsEnabled()) return null;   // "low" graphics (or no WebGL): emoji, even if a picture is cached
  const hit = cache.get(sig);
  if (hit) return hit;
  if (!queued.has(sig)) {
    queued.set(sig, { speciesId: pet.speciesId, stage: pet.stage | 0, shiny: !!pet.shiny, coat: pet.coat || 'base', limited: pet.limited });
    schedule();
  }
  return null;
}

export function avatarHtml(pet, cls, emojiHtml) {
  const url = portraitOf(pet);
  if (url) return `<img class="${cls} pet-portrait" src="${url}" alt="" draggable="false">`;
  return `<span class="${cls}" data-portrait="${esc(portraitSig(pet))}">${emojiHtml}</span>`;
}

export function patchPortraits(root) {
  if (!root || !root.querySelectorAll) return;
  for (const el of root.querySelectorAll('[data-portrait]')) {
    const url = cache.get(el.dataset.portrait);
    if (!url || el.closest('.pg-stage')) continue;   // a running play window keeps its element (the game animates it)
    const img = document.createElement('img');
    img.className = `${el.className} pet-portrait`;
    img.src = url;
    img.alt = '';
    img.draggable = false;
    el.replaceWith(img);
  }
}

const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 60));

function schedule() {
  if (busy) return;
  if (!queued.size) { releaseKit(); return; }
  busy = true;
  idle(() => { renderNext().catch(e => { console.warn('portrait failed', e); failed = true; }).finally(() => { busy = false; schedule(); }); });
}

/** Drops the offscreen renderer and its GL context (rebuilt cheaply on the next request): never hold a second context idle. */
function releaseKit() {
  const k = kit;
  kit = null;
  kitLoading = null;
  if (!k) return;
  try { k.renderer.dispose(); k.renderer.forceContextLoss(); } catch { /* already gone */ }
}

async function loadKit() {
  if (kit) return kit;
  if (!kitLoading) {
    kitLoading = (async () => {
      const THREE = await import('../../vendor/three.module.min.js');
      const { buildPetModel, hasModel } = await import('../world3d/critters.js');
      const canvas = document.createElement('canvas');
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      canvas.addEventListener('webglcontextlost', () => { if (kit && kit.renderer === renderer) { kit = null; kitLoading = null; } });
      renderer.setPixelRatio(1);
      renderer.setSize(PORTRAIT_PX, PORTRAIT_PX, false);
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      // the V20 noon light (js/world3d/daylight.js), so a card looks like the pet in the yard by day
      scene.add(new THREE.HemisphereLight(0xfff6e6, 0x86b86a, 1.35));
      const sun = new THREE.DirectionalLight(0xfff0d4, 1.55);
      sun.position.set(-3, 6, 7);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
      kit = { THREE, renderer, scene, camera, buildPetModel, hasModel };
      return kit;
    })();
  }
  return kitLoading;
}

async function renderNext() {
  const [sig, pet] = queued.entries().next().value;
  queued.delete(sig);
  if (cache.has(sig)) return;
  const k = await loadKit();
  if (!k.hasModel(pet.speciesId)) { failedSig.add(sig); return; }
  const lost = () => { try { return k.renderer.getContext().isContextLost(); } catch { return true; } };
  if (lost()) { queued.set(sig, pet); releaseKit(); return; }   // try again with a fresh context
  const m = k.buildPetModel(k.THREE, pet, getSpecies(pet.speciesId));
  try {
    if (m.setFace) m.setFace('smile');
    const root = m.root;
    root.rotation.y = -0.45;   // a three-quarter view: face and body both read
    k.scene.add(root);
    const box = new k.THREE.Box3().setFromObject(root);
    const size = box.getSize(new k.THREE.Vector3()), c = box.getCenter(new k.THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.5;   // fill the picture (a little room for the ears)
    const dist = r / Math.tan((k.camera.fov * Math.PI) / 360) + 0.1;
    k.camera.position.set(c.x, c.y + size.y * 0.12, c.z + dist);
    k.camera.lookAt(c.x, c.y, c.z);
    k.renderer.render(k.scene, k.camera);
    if (lost()) { queued.set(sig, pet); releaseKit(); return; }
    const blob = await new Promise(res => k.renderer.domElement.toBlob(res, 'image/png'));
    if (!blob) { queued.set(sig, pet); releaseKit(); return; }
    const url = URL.createObjectURL(blob);   // kept for the session (the cache only holds the combinations seen)
    cache.set(sig, url);
    for (const fn of [...listeners]) { try { fn(sig, url); } catch (e) { console.error(e); } }
  } finally {
    k.scene.remove(m.root);
    if (m.dispose) m.dispose();
  }
}
/** Debug / tests: what is cached and waiting. */
export function portraitStats() { return { cached: cache.size, queued: queued.size, failed, noModel: failedSig.size }; }

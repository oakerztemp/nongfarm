// Tiny support check with NO three.js import: ask this BEFORE lazy-loading engine.js so devices without WebGL
// (or with reduced motion) never download the 650 KB engine just to find out they get the list view.
//   import { isWorldSupported } from '../world3d/support.js';
//   if (isWorldSupported()) { const { createWorld } = await import('../world3d/engine.js'); ... }
// engine.js re-exports everything here for compatibility.

const probeCache = new Map();

export function prefersReducedMotion() {
  try { return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Whether a WebGL context can be created. allowSoftware=false rejects software renderers (too slow for the barn). */
export function detectWebGL({ allowSoftware = false } = {}) {
  const key = allowSoftware ? 'soft' : 'hard';
  if (probeCache.has(key)) return probeCache.get(key);
  let ok = false;
  try {
    const canvas = document.createElement('canvas');
    const opts = { failIfMajorPerformanceCaveat: !allowSoftware };
    const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
    ok = !!gl;
    if (gl) {
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext(); // do not hold one of the few contexts a page may have
    }
  } catch { ok = false; }
  probeCache.set(key, ok);
  return ok;
}

/** True when the 3D world should be offered: WebGL works and the user has not asked for reduced motion. */
export function isWorldSupported({ allowSoftware } = {}) {
  let soft = allowSoftware;
  if (soft === undefined) {
    try { soft = new URLSearchParams(location.search).get('soft3d') === '1'; } catch { soft = false; }
  }
  return !prefersReducedMotion() && detectWebGL({ allowSoftware: !!soft });
}

// Device-local preferences (localStorage only, never saved to the cloud save). Every access is try/catch'd:
// private windows and blocked storage just fall back to the defaults.

const KEY_BARN_VIEW = 'nongfarm_pref_barnview'; // '3d' | 'list'
const KEY_QUALITY = 'nongfarm_pref_quality';    // 'auto' | 'low'

const BARN_VIEWS = ['3d', 'list'];
const QUALITIES = ['auto', 'low'];

function read(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key, allowed, value) {
  if (!allowed.includes(value)) return false;
  try {
    localStorage.setItem(key, value);
  } catch { /* storage unavailable: the choice only lasts until reload */ }
  for (const fn of [...listeners]) {
    try { fn(key === KEY_BARN_VIEW ? 'barnView' : 'quality', value); } catch (e) { console.error(e); }
  }
  return true;
}

const listeners = new Set();

/** fn(name: 'barnView'|'quality', value) after a preference changed in this tab. Returns unsubscribe. */
export function onPrefChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** '3d' (default) or 'list'. B uses this to decide between the 3D barn and the card grid. */
export function getBarnViewPref() {
  return read(KEY_BARN_VIEW, BARN_VIEWS, '3d');
}

export function setBarnViewPref(value) {
  return write(KEY_BARN_VIEW, BARN_VIEWS, value);
}

/** 'auto' (default: engine picks a tier from the device) or 'low' (force the lowest tier). */
export function getQualityPref() {
  return read(KEY_QUALITY, QUALITIES, 'auto');
}

export function setQualityPref(value) {
  return write(KEY_QUALITY, QUALITIES, value);
}

// Time advance shared by the game loop and the tests: normal ticks and offline catch-up. DOM-free.
import { tickPets } from './pets.js';
import { tickFarm } from './farm.js';

export const MAX_OFFLINE_MS = 72 * 3600 * 1000;
export const STEP_MS = 60 * 1000;
export const GAP_AS_OFFLINE_MS = 2 * 60 * 1000; // a gap this long (sleep / background tab) is replayed as offline time

/** Runs a tick function; a bug in one module must not freeze the loop. */
function guarded(fn) {
  try { fn(); } catch (e) { console.error(e); }
}

/** Replays [state.lastTick, toMs] (at most MAX_OFFLINE_MS) in 60 s steps with offline decay. */
export function catchUp(state, toMs) {
  let t = Math.max(state.lastTick, toMs - MAX_OFFLINE_MS);
  while (t < toMs) {
    const step = Math.min(STEP_MS, toMs - t);
    t += step;
    guarded(() => tickPets(state, step, { offline: true }));
    guarded(() => tickFarm(state, t));
  }
}

/** Advances the game to toMs and sets state.lastTick. Returns the gap in ms and whether it was replayed offline. */
export function advance(state, toMs) {
  const gap = toMs - state.lastTick;
  const replayed = gap > GAP_AS_OFFLINE_MS;
  if (replayed) {
    catchUp(state, toMs);
  } else if (gap > 0) {
    guarded(() => tickPets(state, gap, { offline: false }));
    guarded(() => tickFarm(state, toMs));
  }
  state.lastTick = toMs;
  return { gap, replayed };
}

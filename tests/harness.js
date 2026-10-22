// Tiny browser test harness: test(name, fn), assert, assertEq, withFakeNow, freshState, runAll.
import { setClock } from '../js/util.js';
import { createNewState, replaceState, getState } from '../js/state.js';

const registry = [];

/** Registers a test; fn may be async. */
export function test(name, fn) {
  registry.push({ name, fn });
}

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

/** Deep equality via JSON (fine for plain game data). */
export function assertEq(actual, expected, msg = 'assertEq') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

/**
 * Runs fn(clock) with a fake clock starting at `ms`. clock.set(ms) / clock.advance(ms) move time.
 * The real clock is restored afterwards (also on errors), including for async fn.
 */
export async function withFakeNow(ms, fn) {
  let t = ms;
  const clock = { set: v => { t = v; }, advance: d => { t += d; }, get: () => t };
  setClock(() => t);
  try {
    return await fn(clock);
  } finally {
    setClock();
  }
}

/** Clears saved games and installs a brand-new game state; returns it. */
export function freshState() {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('nongfarm_')) localStorage.removeItem(k);
  }
  replaceState(createNewState());
  return getState();
}

/** Runs every registered test in order. Returns [{ name, ok, error?, ms }]. */
export async function runAll() {
  const results = [];
  for (const t of registry) {
    const started = performance.now();
    let error = null;
    try {
      await t.fn();
    } catch (e) {
      error = e && e.stack ? `${e.message}\n${e.stack.split('\n').slice(1, 3).join('\n')}` : String(e);
    }
    setClock(); // never leak a fake clock into the next test
    results.push({ name: t.name, ok: !error, error, ms: Math.round(performance.now() - started) });
    await new Promise(r => setTimeout(r, 0)); // let the page breathe between tests
  }
  return results;
}

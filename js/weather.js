// Real-hour weather (CONTRACT_V9 §4): a hash of the UTC hour picks sunny / cloudy / light rain, so every device shows the same
// sky for the same hour. About 15 % of hours rain, 25 % are cloudy, the rest sunny. No state, no economy effect. DOM-free except
// bindWeather (which only touches the world object it is given).
import { now } from './util.js';

export const HOUR_MS = 3600 * 1000;
export const RAIN_SHARE = 0.15;
export const CLOUDY_SHARE = 0.25;
export const WEATHER_KINDS = ['sunny', 'cloudy', 'rain'];

/** Small stable integer hash (murmur-style finaliser) -> uint32. */
function hash32(n) {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Index of the real (UTC) hour containing `ms`. */
export const weatherHour = ms => Math.floor(ms / HOUR_MS);

/**
 * Weather at a moment (default: now): { kind: 'sunny'|'cloudy'|'rain', intensity: 0..1 }.
 * intensity = rain amount for rain (0.35..1, mostly light), cloud density for cloudy (0.3..1), 0 for sunny. Pure and deterministic.
 */
export function weatherAt(ms = now()) {
  const hour = weatherHour(Number.isFinite(ms) ? ms : now());
  const h = hash32(hour);
  const roll = (h % 10000) / 10000;
  const amount = (hash32(hour ^ 0x5bd1e995) % 1000) / 1000;
  if (roll < RAIN_SHARE) return { kind: 'rain', intensity: +(0.35 + 0.65 * amount * amount).toFixed(2) };
  if (roll < RAIN_SHARE + CLOUDY_SHARE) return { kind: 'cloudy', intensity: +(0.3 + 0.7 * amount).toFixed(2) };
  return { kind: 'sunny', intensity: 0 };
}

/** Whole-sentence Thai label for UI / the journal. */
export function weatherLabel(w) {
  const kind = w && w.kind;
  return kind === 'rain' ? '🌧️ ฝนตกพรำๆ' : kind === 'cloudy' ? '⛅ ท้องฟ้าครึ้มๆ' : '☀️ แดดดี';
}

/** Hour index of the next weather change after `ms` (ms of the top of the next hour whose weather differs, at most 24 h ahead). */
export function nextWeatherChange(ms = now()) {
  const cur = weatherAt(ms).kind;
  const h0 = weatherHour(ms);
  for (let i = 1; i <= 24; i++) if (weatherAt((h0 + i) * HOUR_MS).kind !== cur) return (h0 + i) * HOUR_MS;
  return (h0 + 24) * HOUR_MS;
}

/** Test / showcase override: ?weather=rain|cloudy|sunny in the URL, only (never stored). null = real weather. */
export function weatherOverride() {
  let v = null;
  try { v = new URLSearchParams(location.search).get('weather'); } catch { /* no location */ }
  return WEATHER_KINDS.includes(v) ? { kind: v, intensity: v === 'rain' ? 0.8 : v === 'cloudy' ? 0.8 : 0 } : null;
}

/**
 * Keeps a world's sky in step with the real weather: applies it now and re-checks every minute (cheap), unbinds itself when the
 * world is disposed. `onChange(w)` (optional) fires whenever the kind changes, e.g. for pet behaviours. Returns an unbind function.
 *   const stop = bindWeather(world, { onChange: w => ... });
 */
export function bindWeather(world, { onChange, clock = now } = {}) {
  let last = '';
  const apply = () => {
    const w = weatherOverride() || weatherAt(clock());
    const key = `${w.kind}:${w.intensity}`;
    if (key === last) return;
    const kindChanged = !last || last.split(':')[0] !== w.kind;
    last = key;
    try { world.setWeather(w.kind, w.intensity); } catch (e) { console.error('setWeather failed', e); }
    if (kindChanged && typeof onChange === 'function') { try { onChange(w); } catch (e) { console.error(e); } }
  };
  apply();
  const timer = setInterval(apply, 60 * 1000);
  let off = null;
  const stop = () => { clearInterval(timer); if (off) off(); };
  off = typeof world.onDispose === 'function' ? world.onDispose(stop) : null;
  return stop;
}

// เทศกาล 🏮 (CONTRACT_V11): a weekly festival per habitat, ลอยกระทง in late November, small tasks, festival lanterns, a festival shop.
// DOM-free. Actions mutate the state passed in and return { ok, msg } / { ok:false, reason } like pets.js. Festivals give no coins and no
// stardust: lanterns only buy cosmetics, and krathongs are the one thing that costs materials.
//
//   activeFestival(nowMs?, { search? })  -> { id, kind: 'weekly'|'special', habitat|null, nameTh, emoji, key, from, to, peakDay? }   [from, to) in ms, local time
//   ensureFestival(state)                -> state.festival, with the tasks rolled when the festival (key) changed; lanterns / owned / krathongs kept
//   festivalEvent(state, kind, data?)    -> true when a task moved. kind: 'hatch'|'expedition'|'feed'|'order'|'pat'|'harvest'; data: { speciesId | petId | habitat, n? }
//   claimTask(state, taskId), loginLantern(state), buyFestivalItem(state, itemId), craftKrathong(state), floatKrathong(state, petId)
//   festivalView(state)                  -> everything the sheet shows (see below); pendingFestival(state), festivalPostcardTemplates()
import { now, todayKey } from './util.js';
import { countItem, removeItem } from './state.js';
import { getPet, petName } from './pets.js';
import { addToWardrobe } from './farm.js';
import { addJournal, journalName } from './journal.js';
import { getSpecies, HABITATS } from './data/species.js';
import { EGGS } from './data/eggs.js';
import { getItem } from './data/items.js';
import { getAccessory } from './data/accessories.js';
import { getDecor } from './data/decor.js';
import {
  WEEKLY_ORDER, WEEKLY_FESTIVALS, SPECIALS, FESTIVAL_IDS, TASK_POOL, TASK_KINDS, TASKS_PER_FESTIVAL, TASK_REWARD, LOGIN_MAX, LANTERN_MAX,
  KRATHONG_MAX, FLOAT_DAILY_CAP, FLOAT_PEAK_CAP, PEAK_FROM_HOUR, KRATHONG_RECIPE, FLOAT_HAPPY, WISH_TEMPLATES, KRATHONG_POSTCARDS,
  LEDGER_MAX, SEEN_DAYS_MAX, FLOAT_DAYS_MAX, getFestivalDef, getTaskDef,
} from './data/festivals.js';

export {
  WEEKLY_ORDER, SPECIALS, TASK_POOL, TASK_REWARD, TASKS_PER_FESTIVAL, LOGIN_MAX, LANTERN_MAX, KRATHONG_MAX, FLOAT_DAILY_CAP, FLOAT_PEAK_CAP,
  PEAK_FROM_HOUR, KRATHONG_RECIPE, FLOAT_HAPPY, WISH_TEMPLATES, KRATHONG_POSTCARDS,
};
export const LOY_ID = 'fest_loykrathong';

const DAY_MS = 24 * 3600 * 1000;
const fail = reason => ({ ok: false, reason });
const ok = (msg, extra = {}) => ({ ok: true, msg, ...extra });
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const pad = n => String(n).padStart(2, '0');
const dayKeyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDay = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };   // local 00:00 of 'YYYY-MM-DD'

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function seeded(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Calendar ────────────────────────────────────────────────────────────────

/** ISO week { year, week } of a local date (the week of its Thursday). */
export function isoWeekOf(ms) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const year = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((t - jan4) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

const isLocalHost = h => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || /\.localhost$/.test(h);

/** ?debug=1&fest=<id> -> the forced festival id, else null. Only honoured on localhost / 127.0.0.1 / *.localhost; reads `location` when there is one. */
function forcedId(opts) {
  try {
    const host = opts && typeof opts.host === 'string' ? opts.host : typeof location !== 'undefined' ? location.hostname : '';
    if (!isLocalHost(host)) return null;
    const search = opts && typeof opts.search === 'string' ? opts.search : typeof location !== 'undefined' ? location.search : '';
    const q = new URLSearchParams(search);
    const id = q.get('fest');
    return q.get('debug') === '1' && FESTIVAL_IDS.includes(id) ? id : null;
  } catch (e) {
    return null;
  }
}

function weekWindow(ms) {
  const d = new Date(ms);
  const dow = (d.getDay() + 6) % 7;   // Monday = 0
  return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow).getTime(), to: new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow + 7).getTime() };
}

const shape = (def, extra) => ({ id: def.id, kind: def.kind, habitat: def.habitat, nameTh: def.nameTh, emoji: def.emoji, ...extra });

/**
 * The festival on at `nowMs`. Pure and deterministic. A special (SPECIALS) replaces the weekly festival; the weekly one is
 * WEEKLY_ORDER[weekIndex % 8] (see weekIndex) for Monday 00:00 .. Sunday 24:00 local time. [from, to) in ms. `key` changes whenever the tasks must reroll.
 * With ?debug=1&fest=<id> that festival is forced (the window then covers `nowMs`); without debug the parameter is ignored.
 */
export function activeFestival(nowMs = now(), opts = {}) {
  const forced = forcedId(opts);
  if (forced) {
    const def = getFestivalDef(forced);
    if (def.kind === 'weekly') return shape(def, { key: `debug:${forced}`, ...weekWindow(nowMs) });
    const row = SPECIALS.find(s => s.id === forced);
    const start = new Date(nowMs); start.setHours(0, 0, 0, 0);
    return shape(def, { key: `debug:${forced}`, from: start.getTime(), to: start.getTime() + 14 * DAY_MS, peakDay: row ? row.peakDay : dayKeyOf(start) });
  }
  const day = dayKeyOf(new Date(nowMs));
  const sp = SPECIALS.find(s => day >= s.from && day <= s.to);
  const spDef = sp && getFestivalDef(sp.id);
  if (spDef) {
    const last = localDay(sp.to);
    return shape(spDef, { key: `${sp.id}@${sp.from}`, from: localDay(sp.from).getTime(), to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1).getTime(), peakDay: sp.peakDay });
  }
  return weeklyFestival(nowMs);
}

const EPOCH_MONDAY = Date.UTC(2024, 0, 1);   // a Monday: weeks are counted from here, so the 8-habitat rotation never skips (53-week years, specials)

/** Weeks since the epoch Monday of the local week containing `ms`. */
export function weekIndex(ms) {
  const d = new Date(ms);
  const dow = (d.getDay() + 6) % 7;
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() - dow) - EPOCH_MONDAY) / (7 * DAY_MS));
}

/** The weekly festival of the week containing `nowMs` (ignores specials). */
export function weeklyFestival(nowMs = now()) {
  const { year, week } = isoWeekOf(nowMs);
  const n = WEEKLY_ORDER.length;
  const habitat = WEEKLY_ORDER[((weekIndex(nowMs) % n) + n) % n];
  const def = WEEKLY_FESTIVALS.find(f => f.habitat === habitat);
  return shape(def, { key: `${year}-W${pad(week)}`, ...weekWindow(nowMs) });
}

/** Whole days left including today (1 on the last day). */
export function festivalDaysLeft(fest, nowMs = now()) {
  const start = new Date(nowMs); start.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((fest.to - start.getTime()) / DAY_MS));
}

/** True on the night of loy: the special's peak day from PEAK_FROM_HOUR on. */
export function isPeakNight(fest, nowMs = now()) {
  const d = new Date(nowMs);
  return !!(fest && fest.peakDay) && dayKeyOf(d) === fest.peakDay && d.getHours() >= PEAK_FROM_HOUR;
}

/** Floats allowed today: FLOAT_DAILY_CAP, FLOAT_PEAK_CAP on the night of loy. */
export function floatCap(fest = activeFestival(), nowMs = now()) {
  return isPeakNight(fest, nowMs) ? FLOAT_PEAK_CAP : FLOAT_DAILY_CAP;
}

// ── State + tasks ───────────────────────────────────────────────────────────

function habitatUnlocked(habitat, level) {
  const egg = EGGS.find(e => e.habitat === habitat);
  return !!egg && level >= egg.unlockLevel;
}

/** The 3 tasks of a festival, picked from its key (same on every device); H tasks are swapped out until the habitat's egg is unlocked. */
export function rollTasks(fest, level = 1) {
  const rng = seeded(hash(`tasks:${fest.key}`));
  const order = TASK_POOL.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const hOk = !!fest.habitat && habitatUnlocked(fest.habitat, level);
  const spare = order.slice(TASKS_PER_FESTIVAL).filter(t => !t.h);
  return order.slice(0, TASKS_PER_FESTIVAL).map(t => (!t.h || hOk ? t : spare.shift() || t))
    .map(t => ({ id: t.id, kind: t.kind, target: t.target, progress: 0, claimed: false }));
}

function fillFestival(state) {
  if (!isObj(state.festival)) state.festival = {};
  const f = state.festival;
  if (typeof f.id !== 'string') f.id = '';
  if (typeof f.key !== 'string') f.key = '';
  if (!Array.isArray(f.tasks)) f.tasks = [];
  if (!Array.isArray(f.loginDays)) f.loginDays = [];
  if (!Array.isArray(f.seenDays)) f.seenDays = [];
  if (!isObj(f.ledger)) f.ledger = {};
  if (!isObj(f.floatDays)) f.floatDays = {};
  if (!(f.lanterns >= 0)) f.lanterns = 0;
  if (!(f.krathongs >= 0)) f.krathongs = 0;
  if (!isObj(f.owned)) f.owned = {};
  if (!isObj(f.krathong)) f.krathong = { day: '', n: 0 };
  return f;
}

// Debug-forced festivals (?debug=1&fest=, localhost only) keep their tasks / login days here, never in the save.
const transient = new Map();
let debugSource = null;
/** Test hook: the options (search / host) activeFestival gets from sync; null = read `location`. Clears the debug-only task store. */
export function setFestivalDebugSource(opts) { debugSource = opts || null; transient.clear(); }

const levelOf = state => Math.max(1, Math.floor(Number(state.player && state.player.level) || 1));

/**
 * Brings state.festival to the festival that is on now. Leaving a key files its tasks + login days in the ledger (last LEDGER_MAX keys) and
 * coming back restores them, so flipping the key (clock, debug) never rerolls or repays. st = where tasks / loginDays live: the save, or for a
 * debug-forced festival a session-only object.
 */
function sync(state, nowMs = now()) {
  const fest = activeFestival(nowMs, debugSource || {});
  const f = fillFestival(state);
  if (fest.key.startsWith('debug:')) {
    let st = transient.get(fest.key);
    if (!st) { st = { tasks: rollTasks(fest, levelOf(state)), loginDays: [] }; transient.set(fest.key, st); }
    return { f, fest, st };
  }
  if (f.key !== fest.key || f.id !== fest.id || !f.tasks.length) {
    if (f.key && f.tasks.length === TASKS_PER_FESTIVAL) f.ledger[f.key] = { tasks: f.tasks, loginDays: f.loginDays };
    const back = f.ledger[fest.key];
    delete f.ledger[fest.key];
    const keys = Object.keys(f.ledger);
    for (const k of keys.slice(0, Math.max(0, keys.length - LEDGER_MAX))) delete f.ledger[k];
    f.id = fest.id;
    f.key = fest.key;
    if (back && Array.isArray(back.tasks) && back.tasks.length === TASKS_PER_FESTIVAL) {
      f.tasks = back.tasks;
      f.loginDays = Array.isArray(back.loginDays) ? back.loginDays : [];
    } else {
      f.tasks = rollTasks(fest, levelOf(state));
      f.loginDays = [];
    }
  }
  return { f, fest, st: f };
}

/** state.festival for the festival that is on now. A new key rerolls the tasks and the login days; lanterns, owned items and krathongs stay. */
export function ensureFestival(state) {
  return sync(state).f;
}

const addLanterns = (f, n) => { f.lanterns = Math.min(LANTERN_MAX, f.lanterns + n); };

/** The festival that began since the player last opened one (to say "เทศกาล X เริ่มแล้ว!" in the away digest), else null. Does not change the state. */
export function pendingFestival(state) {
  const f = isObj(state && state.festival) ? state.festival : null;
  const fest = activeFestival(now());
  return f && f.key && f.key !== fest.key ? fest : null;
}

/** Postcard templates to use while ลอยกระทง is on (else []). */
export function festivalPostcardTemplates(nowMs = now()) {
  return activeFestival(nowMs).id === LOY_ID ? KRATHONG_POSTCARDS : [];
}

// ── Events (hooks) ──────────────────────────────────────────────────────────

function eventHabitat(state, data) {
  if (data.habitat) return data.habitat;
  if (data.speciesId) { const sp = getSpecies(data.speciesId); return sp ? sp.habitat : null; }
  if (data.petId) { const pet = getPet(state, data.petId); const sp = pet && getSpecies(pet.speciesId); return sp ? sp.habitat : null; }
  return null;
}

/**
 * Something happened that a festival task may count. Cheap, never throws. Only the tasks of the festival that is on now count
 * (a new festival rerolls first); an H task counts only for the featured habitat (data.speciesId / petId / habitat). Returns true when a task moved.
 */
export function festivalEvent(state, kind, data = {}) {
  try {
    if (!isObj(state) || !TASK_KINDS.includes(kind)) return false;
    const { fest, st } = sync(state);
    const habitat = eventHabitat(state, isObj(data) ? data : {});
    const n = Math.max(1, Math.floor(Number(data && data.n) || 1));
    let hit = false;
    for (const t of st.tasks) {
      if (!isObj(t) || t.claimed || t.kind !== kind || t.progress >= t.target) continue;
      const def = getTaskDef(t.id);
      if (def && def.h && (!fest.habitat || habitat !== fest.habitat)) continue;
      t.progress = Math.min(t.target, t.progress + n);
      hit = true;
    }
    return hit;
  } catch (e) {
    console.error('festivalEvent failed', e);
    return false;
  }
}

// ── Tasks, login, shop ──────────────────────────────────────────────────────

export function claimTask(state, taskId) {
  const { f, st } = sync(state);
  const t = st.tasks.find(x => x && x.id === taskId);
  if (!t) return fail('ไม่พบงานนี้');
  if (t.claimed) return fail('รับรางวัลงานนี้ไปแล้ว');
  if (t.progress < t.target) return fail(`ยังไม่ครบ (${t.progress}/${t.target})`);
  t.claimed = true;
  addLanterns(f, TASK_REWARD);
  return ok(`🏮 ได้โคมไฟเทศกาล +${TASK_REWARD}`, { gained: TASK_REWARD });
}

/** The first open each day during a festival: +1 🏮, at most LOGIN_MAX per festival. */
export function loginLantern(state) {
  const { f, st } = sync(state);
  const day = todayKey();
  if (f.seenDays.includes(day) || st.loginDays.includes(day)) return fail('วันนี้รับโคมไฟแล้ว พรุ่งนี้มาใหม่นะ');
  if (st.loginDays.length >= LOGIN_MAX) return fail(`ครบ ${LOGIN_MAX} วันของเทศกาลนี้แล้ว`);
  st.loginDays.push(day);
  f.seenDays.push(day);   // a day pays once, whatever the festival key says
  if (f.seenDays.length > SEEN_DAYS_MAX) f.seenDays.splice(0, f.seenDays.length - SEEN_DAYS_MAX);
  addLanterns(f, 1);
  return ok('🏮 แวะมาเที่ยวเทศกาลวันนี้ ได้โคมไฟ +1', { gained: 1 });
}

/** Buys one of THIS festival's items with lanterns, one copy per player. Accessories go to the wardrobe, decor to inventoryDecor. */
export function buyFestivalItem(state, itemId) {
  const { f, fest } = sync(state);
  const def = getFestivalDef(fest.id);
  const item = def && def.items.find(it => it.id === itemId);
  if (!item) return fail('ของชิ้นนี้ไม่ได้ขายในเทศกาลนี้');
  if (f.owned[itemId]) return fail(`มี ${item.emoji} ${item.nameTh} แล้ว`);
  const data = item.type === 'acc' ? getAccessory(itemId) : getDecor(itemId);
  if (!data) return fail('ของชิ้นนี้ยังไม่พร้อมจำหน่าย');
  if (f.lanterns < item.price) return fail(`โคมไฟไม่พอ (ต้องใช้ ${item.price} 🏮)`);
  f.lanterns -= item.price;
  f.owned[itemId] = true;
  if (item.type === 'acc') {
    addToWardrobe(state, itemId, 1);
  } else {
    if (!isObj(state.inventoryDecor)) state.inventoryDecor = {};
    state.inventoryDecor[itemId] = (Number(state.inventoryDecor[itemId]) || 0) + 1;
  }
  const where = item.type === 'acc' ? 'ไปแต่งตัวให้น้องที่หน้าน้องได้เลย' : 'ไปวางที่ลานได้เลย';
  return ok(`ได้ ${item.emoji} ${item.nameTh} แล้ว! (-${item.price} 🏮) ${where}`, { item });
}

// ── ลอยกระทง ────────────────────────────────────────────────────────────────

function missingText(missing) {
  return Object.entries(missing).map(([id, n]) => { const it = getItem(id); return `${it ? it.emoji : ''} ${it ? it.nameTh : id} x${n}`; }).join(', ');
}

/** What the recipe still lacks: { itemId: n } (empty when the bag has it all). */
export function krathongMissing(state) {
  const out = {};
  for (const [id, n] of Object.entries(KRATHONG_RECIPE)) if (countItem(state, id) < n) out[id] = n - countItem(state, id);
  return out;
}

/** 3 🌿 + 1 🪵 make one krathong (stock <= KRATHONG_MAX). Only while ลอยกระทง is on. */
export function craftKrathong(state) {
  const { f, fest } = sync(state);
  if (fest.id !== LOY_ID) return fail('ทำกระทงได้เฉพาะช่วงเทศกาลลอยกระทงนะ');
  if (f.krathongs >= KRATHONG_MAX) return fail(`มีกระทงเต็มแล้ว (${KRATHONG_MAX} ใบ) ไปลอยก่อนนะ`);
  const missing = krathongMissing(state);
  if (Object.keys(missing).length) return fail(`ยังขาดวัสดุ: ${missingText(missing)}`);
  for (const [id, n] of Object.entries(KRATHONG_RECIPE)) removeItem(state, id, n);
  f.krathongs += 1;
  return ok(`🪷 ทำกระทงเสร็จแล้ว! (มี ${f.krathongs}/${KRATHONG_MAX} ใบ)`, { stock: f.krathongs });
}

function floatsToday(f) {
  return Math.max(Number(f.floatDays[todayKey()]) || 0, f.krathong.day === todayKey() ? f.krathong.n : 0);
}

/**
 * A yard pet (idle, not sick, not asleep) floats a krathong: +1 🏮, +FLOAT_HAPPY happy, a diary line with a wish. At most FLOAT_DAILY_CAP a
 * day, FLOAT_PEAK_CAP on the night of loy. No bond, no coins.
 */
export function floatKrathong(state, petId) {
  const { f, fest } = sync(state);
  if (fest.id !== LOY_ID) return fail('ลอยกระทงได้เฉพาะช่วงเทศกาลลอยกระทงนะ');
  if (f.krathongs < 1) return fail('ยังไม่มีกระทง ทำกระทงก่อนนะ');
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  const who = `น้อง${petName(pet)}`;
  if (pet.status === 'sleeping') return fail(`${who}กำลังหลับอยู่ ปลุกก่อนนะ`);
  if (pet.status === 'expedition') return fail(`${who}ออกสำรวจอยู่`);
  if (pet.status !== 'idle') return fail(`${who}กำลังทำงานอยู่`);
  if (pet.sick) return fail(`${who}ไม่สบายอยู่ ให้หายก่อนนะ`);
  const cap = floatCap(fest);
  const used = floatsToday(f);
  if (used >= cap) return fail(`วันนี้ลอยกระทงครบ ${cap} ใบแล้ว พรุ่งนี้มาลอยใหม่นะ`);
  f.krathongs -= 1;
  const day = todayKey();
  f.floatDays[day] = used + 1;   // counted per day: moving the clock back and forth never resets a day
  for (const d of Object.keys(f.floatDays).sort().slice(0, -FLOAT_DAYS_MAX)) delete f.floatDays[d];
  f.krathong = { day, n: used + 1 };
  addLanterns(f, 1);
  pet.stats.happy = Math.min(100, (Number(pet.stats.happy) || 0) + FLOAT_HAPPY);
  const wish = WISH_TEMPLATES[hash(`${pet.id}|${todayKey()}|${f.krathong.n}`) % WISH_TEMPLATES.length];
  addJournal(state, { kind: `krathong:${f.krathong.n}`, petId: pet.id, emoji: '🪷', text: `${journalName(pet)} ลอยกระทง ขอให้${wish}` });
  return ok(`🪷 ${who}ลอยกระทง ขอให้${wish} (+1 🏮)`, { gained: 1, wish, left: cap - f.krathong.n, stock: f.krathongs });
}

// ── View ────────────────────────────────────────────────────────────────────

const taskName = (def, habitat) => def.nameTh.replace('{h}', habitat && HABITATS[habitat] ? HABITATS[habitat].nameTh : '');

/**
 * Everything the festival sheet shows (rolls the tasks first). Plain data, a fresh object each call:
 * { festival: { id, kind, habitat, nameTh, emoji, key, from, to, peakDay?, daysLeft, peak },
 *   lanterns, tasks: [{ id, kind, nameTh, emoji, target, progress, claimed, claimable, reward }],
 *   login: { days, max, today (already got today's), done },
 *   shop: [{ id, type: 'acc'|'decor', slot, emoji, nameTh, price, owned, affordable }],
 *   krathong: null | { stock, max, recipe: { itemId: n }, missing, canCraft, floatsToday, cap, left, peak } }   (krathong only during ลอยกระทง)
 */
export function festivalView(state) {
  const { f, fest, st } = sync(state);
  const def = getFestivalDef(fest.id);
  const t = now();
  const tasks = st.tasks.map(x => {
    const d = getTaskDef(x.id) || {};
    return {
      id: x.id, kind: x.kind, nameTh: taskName(d, fest.habitat), emoji: d.emoji || '🏮', target: x.target, progress: x.progress,
      claimed: x.claimed, claimable: !x.claimed && x.progress >= x.target, reward: TASK_REWARD,
    };
  });
  const shop = (def ? def.items : []).map(it => ({
    id: it.id, type: it.type, slot: it.slot, emoji: it.emoji, nameTh: it.nameTh, price: it.price,
    owned: !!f.owned[it.id], affordable: f.lanterns >= it.price,
  }));
  let krathong = null;
  if (fest.id === LOY_ID) {
    const missing = krathongMissing(state);
    const cap = floatCap(fest, t);
    const used = floatsToday(f);
    krathong = {
      stock: f.krathongs, max: KRATHONG_MAX, recipe: { ...KRATHONG_RECIPE }, missing,
      canCraft: f.krathongs < KRATHONG_MAX && !Object.keys(missing).length,
      floatsToday: used, cap, left: Math.max(0, cap - used), peak: isPeakNight(fest, t),
    };
  }
  return {
    festival: { ...fest, daysLeft: festivalDaysLeft(fest, t), peak: isPeakNight(fest, t) },
    lanterns: f.lanterns, tasks,
    login: { days: st.loginDays.length, max: LOGIN_MAX, today: f.seenDays.includes(todayKey()), done: st.loginDays.length >= LOGIN_MAX },
    shop, krathong,
  };
}

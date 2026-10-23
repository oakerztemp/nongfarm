// Single source of truth for game state + small economy helpers. DOM-free.
import { now, notify } from './util.js';
import { fastForwardQuests } from './quests.js'; // circular on purpose: only called at migration time
import { getCrop } from './data/crops.js';

export const STATE_VERSION = 3;
export const DEFAULT_FARM_NAME = 'ฟาร์มของฉัน';
const PLOT_COUNT = 4;

const STAT_KEYS = [
  'hatched', 'fed', 'played', 'cleaned', 'released',
  'planted', 'harvested', 'helped',
  'expeditionsStarted', 'expeditionsClaimed',
  'ordersDone', 'sold', 'bought',
];
const newStats = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]));

function newPlot(index) {
  return { index, cropId: null, plantedAt: 0, progress: 0, watered: false, petIds: [] };
}

export function createNewState() {
  const t = now();
  return {
    version: STATE_VERSION,
    updatedAt: 0,
    lastTick: t,
    player: {
      farmName: DEFAULT_FARM_NAME,
      level: 1,
      xp: 0,
      coins: 100,
      createdAt: t,
      lastDailyClaim: null,
    },
    pets: [],
    barnCapacity: 3,
    incubator: [],
    incubatorCapacity: 1,
    inventory: { egg_farm: 1, seed_carrot: 3, food_kibble: 2 },
    plots: Array.from({ length: PLOT_COUNT }, (_, i) => newPlot(i)),
    expeditions: [],
    collection: {},
    log: [],
    stats: newStats(),
    quests: { step: 0, done: false },
    orders: { day: null, list: [], week: null, weekly: null },
    stardust: 0,
    claimedGoals: [],
    settings: { notify: false },
  };
}

// ---- migration / sanitising ----

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Keys whose contents are player data, not structure: never back-fill their entries.
const DATA_MAPS = new Set(['inventory', 'collection']);

function fill(raw, def, key) {
  if (Array.isArray(def)) return Array.isArray(raw) ? raw : def;
  if (isObj(def)) {
    const src = isObj(raw) ? raw : {};
    if (DATA_MAPS.has(key)) return isObj(raw) ? raw : {};
    const out = { ...src };
    for (const k of Object.keys(def)) out[k] = fill(src[k], def[k], k);
    return out;
  }
  if (def === null) return raw === undefined ? null : raw;
  if (typeof def === 'number') return Number.isFinite(raw) ? raw : def;
  return typeof raw === typeof def ? raw : def;
}

function petDefaults(t) {
  return {
    id: '', speciesId: '', nickname: '', shiny: false, personality: 'cheerful',
    stage: 0, xp: 0,
    stats: { hunger: 100, happy: 100, energy: 100, clean: 100 },
    poop: 0, sick: false, zeroSince: null, lastFedAt: 0,
    status: 'idle', task: null, bornAt: t,
    bond: 0, bondDay: null, bondToday: 0, giftDay: null,
  };
}

/**
 * One step per version: MIGRATIONS[n] upgrades a version-n save to n+1 (shallow-copied input, may mutate it).
 * Input can be any junk, so every step must guard its reads.
 */
export const MIGRATIONS = {
  1(s) {
    const pets = Array.isArray(s.pets) ? s.pets.filter(isObj) : [];
    const plots = Array.isArray(s.plots) ? s.plots.filter(isObj) : [];
    const player = isObj(s.player) ? s.player : {};
    const collection = isObj(s.collection) ? s.collection : {};
    const owned = Object.values(collection).reduce((a, c) => a + (isObj(c) && c.owned > 0 ? c.owned : 0), 0);

    // v1 had no counters: estimate from what the save already shows, so veterans skip the
    // starter chain steps they clearly did, without receiving the rewards.
    const stats = { ...newStats(), ...(isObj(s.stats) ? s.stats : {}) };
    stats.hatched = Math.max(stats.hatched, owned, pets.length);
    if (pets.some(p => p.lastFedAt > 0)) stats.fed = Math.max(stats.fed, 1);
    if (player.level > 1 || plots.some(p => p.cropId)) {
      stats.planted = Math.max(stats.planted, 1);
      stats.harvested = Math.max(stats.harvested, player.level > 1 ? 1 : 0);
    }
    if (plots.some(p => p.petId) || pets.some(p => p.status === 'working' || p.status === 'expedition')) {
      stats.helped = Math.max(stats.helped, 1);
    }
    if (Array.isArray(s.expeditions) && s.expeditions.length) {
      stats.expeditionsStarted = Math.max(stats.expeditionsStarted, 1);
    }
    s.stats = stats;

    if (!isObj(s.quests)) s.quests = fastForwardQuests({ stats });
    s.orders = isObj(s.orders) ? s.orders : { day: null, list: [], week: null, weekly: null };
    s.stardust = Number.isFinite(s.stardust) ? s.stardust : 0;
    s.claimedGoals = Array.isArray(s.claimedGoals) ? s.claimedGoals : [];
    s.version = 2;
    return s;
  },

  // v2 -> v3: plots hold a list of helper slots (petIds), pets remember which slot, bond + settings fields.
  2(s) {
    const plots = (Array.isArray(s.plots) ? s.plots : []).map(p => {
      if (!isObj(p)) return p;
      const plot = { ...p };
      const slots = plot.cropId ? slotCount(plot.cropId) : 0;
      const ids = Array.isArray(plot.petIds) ? plot.petIds.slice() : plot.petId ? [plot.petId] : [];
      while (ids.length < slots) ids.push(null);
      plot.petIds = ids.slice(0, Math.max(slots, 0)).map(id => (typeof id === 'string' && id ? id : null));
      delete plot.petId;
      if (!Array.isArray(plot.helperPetIds)) plot.helperPetIds = plot.helperPetId ? [plot.helperPetId] : [];
      delete plot.helperPetId;
      return plot;
    });
    s.plots = plots;

    // Keep every pet <-> plot link consistent in both directions.
    const pets = Array.isArray(s.pets) ? s.pets : [];
    const linked = new Set();
    for (const pet of pets) {
      if (!isObj(pet)) continue;
      const task = isObj(pet.task) ? pet.task : null;
      if (task && task.type === 'plot') {
        const plot = plots[task.plotIndex];
        const slot = isObj(plot) && Array.isArray(plot.petIds) ? plot.petIds.indexOf(pet.id) : -1;
        if (slot >= 0) {
          pet.task = { ...task, slot };
          linked.add(`${task.plotIndex}:${slot}`);
        } else {
          pet.task = null;
          if (pet.status === 'working') pet.status = 'idle';
        }
      }
    }
    plots.forEach((plot, i) => {
      if (!isObj(plot)) return;
      plot.petIds = plot.petIds.map((id, slot) => (id && linked.has(`${i}:${slot}`) ? id : null));
    });

    s.settings = isObj(s.settings) ? s.settings : { notify: false };
    s.version = 3;
    return s;
  },
};

/** Helper slots of a crop (mirrors the rule in crops.js: <30 min 1, <2 h 2, else 3). */
function slotCount(cropId) {
  const crop = getCrop(cropId);
  if (!crop) return 1;
  if (Number.isInteger(crop.slots) && crop.slots >= 1) return crop.slots;
  return crop.growMs < 30 * 60 * 1000 ? 1 : crop.growMs < 2 * 3600 * 1000 ? 2 : 3;
}

let warnedNewer = false;

/** True for a save written by a newer client than this one understands (must never be uploaded). */
export const isNewerSave = s => Number(s && s.version) > STATE_VERSION;

/**
 * Upgrades any save to the current schema: runs MIGRATIONS in order, then deep-fills missing fields,
 * drops corrupt entries and never overwrites valid data or drops unknown fields. Never throws.
 */
export function migrate(raw) {
  try {
    return migrateUnsafe(raw);
  } catch (e) {
    console.error('migrate failed, starting a fresh state', e);
    return createNewState();
  }
}

function migrateUnsafe(raw) {
  const base = createNewState();
  let input = isObj(raw) ? { ...raw } : {};
  let version = Number.isInteger(input.version) && input.version >= 1 ? input.version : 1;

  if (version > STATE_VERSION) {
    if (!warnedNewer) {
      warnedNewer = true;
      notify('เซฟนี้มาจากเกมเวอร์ชันใหม่กว่า — เปิดอ่านได้ แต่จะไม่บันทึกทับขึ้นคลาวด์ กรุณารีเฟรชเพื่ออัปเดตเกม', 'warn');
    }
  } else {
    for (; version < STATE_VERSION; version++) {
      const step = MIGRATIONS[version];
      input = step ? step(input) : input;
      input.version = version + 1;
    }
  }

  const s = fill(input, base, '');

  s.pets = s.pets.filter(p => isObj(p) && p.id && p.speciesId).map(p => fill(p, petDefaults(base.lastTick), 'pet'));
  s.incubator = s.incubator.filter(isObj);
  s.expeditions = s.expeditions.filter(isObj);
  s.log = s.log.filter(isObj).slice(0, 50);
  s.plots = s.plots.filter(isObj).map((p, i) => fill(p, newPlot(i), 'plot'));
  if (!s.plots.length) s.plots = base.plots;

  for (const [id, n] of Object.entries(s.inventory)) {
    if (!Number.isFinite(n) || n <= 0) delete s.inventory[id];
  }
  s.player.level = Math.max(1, Math.floor(s.player.level));
  s.player.xp = Math.max(0, s.player.xp);
  s.player.coins = Math.max(0, s.player.coins);
  s.version = version;
  return s;
}

/**
 * True while the player has not really played yet (no pets, planting, XP...).
 * Coins/inventory are ignored on purpose so the daily reward alone never makes a
 * brand-new guest save look "newer" than a real cloud save.
 */
export function isPristine(s) {
  // Compare what the player did, not the exact shape: migrations add empty fields
  // (e.g. plot.helperPetIds) that must not turn an untouched farm into "real progress".
  const fresh = createNewState();
  const plots = Array.isArray(s.plots) ? s.plots : [];
  const empty = x => !Array.isArray(x) || x.length === 0;
  return s.player.level === fresh.player.level && s.player.xp === fresh.player.xp
    && empty(s.pets) && empty(s.incubator) && empty(s.expeditions)
    && Object.keys(s.collection || {}).length === 0
    && plots.length === fresh.plots.length && plots.every(p => !p || !p.cropId);
}

// ---- store ----

let state = createNewState();
const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** eventName: 'change' | 'tick' */
export function emit(eventName) {
  for (const fn of [...listeners]) {
    try { fn(eventName); } catch (e) { console.error(e); }
  }
}

/** Increments a lifetime counter (creates it if missing; ignores n <= 0). */
export function bumpStat(state, key, n = 1) {
  if (!(n > 0)) return;
  if (!isObj(state.stats)) state.stats = {};
  state.stats[key] = (state.stats[key] || 0) + n;
}

export function replaceState(s) {
  state = migrate(s);
  emit('change');
}

/** Runs mutator(state), stamps updatedAt and emits 'change' (even if the mutator throws). */
export function update(mutator) {
  try {
    return mutator(state);
  } finally {
    state.updatedAt = now();
    emit('change');
  }
}

// ---- inventory / economy ----

export function addItem(state, itemId, n = 1) {
  if (!(n > 0)) return;
  state.inventory[itemId] = (state.inventory[itemId] || 0) + n;
}

export function removeItem(state, itemId, n = 1) {
  const have = state.inventory[itemId] || 0;
  if (have < n) return false;
  if (have === n) delete state.inventory[itemId];
  else state.inventory[itemId] = have - n;
  return true;
}

export function countItem(state, itemId) {
  return state.inventory[itemId] || 0;
}

export function addCoins(state, n) {
  state.player.coins = Math.max(0, state.player.coins + n);
}

export function spendCoins(state, n) {
  if (state.player.coins < n) return false;
  state.player.coins -= n;
  return true;
}

export function xpForLevel(level) {
  return Math.round(50 * level ** 1.5);
}

export function addPlayerXp(state, n) {
  const p = state.player;
  p.xp += n;
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level += 1;
    notify(`เลเวลอัพ! Lv.${p.level}`, 'success');
  }
}

// Single source of truth for game state + small economy helpers. DOM-free.
import { now, notify } from './util.js';
import { fastForwardQuests } from './quests.js'; // circular on purpose: only called at migration time
import { getCrop } from './data/crops.js';
import { getSpecies, HABITATS } from './data/species.js';
import { COAT_IDS } from './data/coats.js';

// v7: accessory ids are validated against js/data/accessories.js (owned by the data author). It is loaded with a tolerant
// top-level await so a missing/renamed file never breaks the game: without it only the id's shape is checked.
//   Understood exports: getAccessory(id) -> { slot } | undefined, or ACCESSORIES (array of { id, slot } or object keyed by id).
const accMod = await import('./data/accessories.js').catch(() => null);
function accessoryOf(id) {
  if (!accMod) return typeof id === 'string' && /^[a-z0-9_]{1,40}$/i.test(id) ? { slot: null } : null;
  if (typeof accMod.getAccessory === 'function') return accMod.getAccessory(id) || null;
  const all = accMod.ACCESSORIES;
  if (Array.isArray(all)) return all.find(a => a && a.id === id) || null;
  if (all && typeof all === 'object') return all[id] ? { slot: all[id].slot } : null;
  return typeof id === 'string' && /^[a-z0-9_]{1,40}$/i.test(id) ? { slot: null } : null;
}

// v5 constants other modules rely on (CONTRACT_V7 §1):
//   NURSERY_SLOTS  max babies waiting in state.nursery        POSTCARDS_MAX  postcards kept (oldest dropped)
//   YARD_CAP_MS    pets.js owns the live 6 h gift cap; the migration only clamps credited ms to the same value
export const STATE_VERSION = 8;
export const NURSERY_SLOTS = 3;
export const POSTCARDS_MAX = 30;
export const FRIEND_PAIRS_PER_PET = 4;  // v6: every pet keeps its 4 strongest pairs (plus its best-friend pair)...
export const FRIEND_PAIRS_MAX = 120;    // ...so friends stays near 20 x 4 pairs; this is the hard ceiling on load
export const FRIEND_BEST_POINTS = 72;   // a pair needs this many points to be best friends
export const FRIENDS_MET_MAX = 40;      // pairKeys already announced as best friends (no second toast)
/** Key of a friend pair in state.friends: the two pet ids sorted and joined by '|'. */
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const JOURNAL_DAYS_MAX = 14;     // v7: days of diary kept (oldest dropped)
export const JOURNAL_LINES_MAX = 6;     // v7: lines per day (oldest of that day dropped)
export const WEAR_SLOTS = ['head', 'neck'];
export const FAMILY_EGG_MAX = 2;       // v8: family eggs waiting in state.familyEggs (breeding refuses when full)
const BREED_COOLDOWN_CAP_MS = 72 * 3600 * 1000;   // = breeding.js BREED_COOLDOWN_MS (no import: breeding.js imports pets.js -> state.js)
const V4_YARD_CAP_MS = 6 * 3600 * 1000;
export const DEFAULT_FARM_NAME = 'ฟาร์มของฉัน';
const PLOT_COUNT = 4;

const STAT_KEYS = [
  'hatched', 'fed', 'played', 'cleaned', 'released',
  'planted', 'harvested', 'helped',
  'expeditionsStarted', 'expeditionsClaimed',
  'ordersDone', 'sold', 'bought', 'yardCollected', 'bred',
];
const newStats = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]));

function newPlot(index) {
  return { index, cropId: null, plantedAt: 0, progress: 0, watered: false, petIds: [], stations: [null, null, null] };
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
    // v5: gifts live on each pet: byPet[petId] = { c: coins (float), ms: credited ms <= cap, prog: fractional items, items: {id: n} }
    yard: { lastAt: t, byPet: {} },
    nursery: [],          // [{ pet, hatchedAt }] <= NURSERY_SLOTS, pet.status === 'nursery'
    decor: [],            // [{ id, decorId, spot }] placed decorations
    inventoryDecor: {},   // decorId -> count built but not placed
    postcards: [],        // [{ id, petName, speciesId, text, at, read }] <= POSTCARDS_MAX
    friends: {},          // v6: pairKey(a, b) -> points (fractional); each pet keeps its top FRIEND_PAIRS_PER_PET pairs; js/friends.js owns the rules
    friendsMet: [],       // v6: pairKeys already announced as best friends, <= FRIENDS_MET_MAX (newest last)
    lastGreetAt: 0,       // v6: ms of the last "pets greet you" scene (barn3d), so it plays once per away spell
    wardrobe: {},         // v7: accessoryId -> copies owned (worn copies included; a copy is worn by one pet at a time)
    familyEggs: [],       // v8: laid family eggs not yet in the incubator, <= FAMILY_EGG_MAX: [{ id, laidAt, habitatA, habitatB, a: parent, b: parent }] (js/breeding.js)
    coatsSeen: { base: true }, // v8: coatId -> true for every coat the player has had (the coats_all book goal)
    journal: [],          // v7: [{ day: 'YYYY-MM-DD', lines: [{ emoji, text, petId? }] }] oldest day first, <= JOURNAL_DAYS_MAX x JOURNAL_LINES_MAX (js/journal.js)
  };
}

// ---- migration / sanitising ----

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Keys whose contents are player data, not structure: never back-fill their entries.
const DATA_MAPS = new Set(['inventory', 'collection', 'byPet', 'inventoryDecor', 'wardrobe']);

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
    station: null,
    favKnown: false,   // v6: the player has discovered this pet's favourite stroking spot
    wear: { head: null, neck: null },  // v7: accessory ids worn (must be in state.wardrobe)
    lastBirthdayGift: null,            // v7: months number of the last birthday gift taken (js/birthday.js), null = never
    coat: 'base',                      // v8: coat id (js/data/coats.js); a missing one is base
    family: null,                      // v8: bred pets only: { gen, a: { name, speciesId }, b: { name, speciesId } }
    breedReadyAt: 0,                   // v8: ms; this pet can breed again once now() >= breedReadyAt
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

  // v3 -> v4: stations (pets pinned to a plot slot) + the yard gift accumulator.
  // Friendly default: every pet that is working a plot slot right now becomes stationed on that slot.
  3(s) {
    const plots = (Array.isArray(s.plots) ? s.plots : []).map(p => (isObj(p) ? { ...p, stations: [null, null, null] } : p));
    s.plots = plots;
    const pets = Array.isArray(s.pets) ? s.pets : [];
    for (const pet of pets) {
      if (!isObj(pet)) continue;
      pet.station = null;
      const task = isObj(pet.task) ? pet.task : null;
      if (!task || task.type !== 'plot') continue;
      const plot = plots[task.plotIndex];
      const slot = Number.isInteger(task.slot) ? task.slot : 0;
      if (isObj(plot) && slot >= 0 && slot < 3 && Array.isArray(plot.petIds) && plot.petIds[slot] === pet.id) {
        plot.stations[slot] = pet.id;
        pet.station = { plotIndex: task.plotIndex, slot };
      }
    }
    const old = isObj(s.yard) ? s.yard : {};
    s.yard = {
      pending: Number.isFinite(old.pending) && old.pending > 0 ? old.pending : 0,
      items: isObj(old.items) ? old.items : {},
      lastAt: now(),
    };
    s.version = 4;
    return s;
  },

  // v4 -> v5: yard gifts move onto the pets (yard.byPet), plus nursery / decor / postcards fields.
  // The old accumulator is split across the pets at home (everything if nobody is home); the integer part goes evenly
  // with the remainder (and the coin fraction) to the first pet, so no whole coin or item is lost. With no pets at all
  // the coins and items go straight to the player instead.
  4(s) {
    const old = isObj(s.yard) ? s.yard : {};
    const pos = v => (Number.isFinite(v) && v > 0 ? v : 0);
    const pets = (Array.isArray(s.pets) ? s.pets : []).filter(p => isObj(p) && typeof p.id === 'string' && p.id && p.speciesId);
    const home = pets.filter(p => p.status !== 'working' && p.status !== 'expedition');
    const heirs = [...new Set((home.length ? home : pets).map(p => p.id))];
    const split = (whole, k) => Array.from({ length: k }, (_, i) => Math.floor(whole / k) + (i === 0 ? whole % k : 0));

    const coins = pos(old.pending);
    const items = isObj(old.items) ? Object.entries(old.items).map(([id, n]) => [id, Math.floor(pos(n))]).filter(([, n]) => n > 0) : [];
    const byPet = {};
    if (heirs.length) {
      const ms = Math.min(pos(old.accMs), V4_YARD_CAP_MS);
      for (const id of heirs) byPet[id] = { c: 0, ms, prog: 0, items: {} };
      split(Math.floor(coins), heirs.length).forEach((c, i) => { byPet[heirs[i]].c = c; });
      byPet[heirs[0]].c += coins - Math.floor(coins);
      for (const [itemId, n] of items) split(n, heirs.length).forEach((k, i) => { if (k > 0) byPet[heirs[i]].items[itemId] = k; });
      // Fractional item progress is per habitat; hand each habitat's share to its own pets (home first, then any).
      for (const [hab, v] of Object.entries(isObj(old.prog) ? old.prog : {})) {
        const sp = id => { const p = pets.find(q => q.id === id); const d = p && getSpecies(p.speciesId); return d && d.habitat; };
        let owners = heirs.filter(id => sp(id) === hab);
        if (!owners.length) owners = [...new Set(pets.map(p => p.id))].filter(id => sp(id) === hab);
        for (const id of owners) {
          if (!byPet[id]) byPet[id] = { c: 0, ms, prog: 0, items: {} };
          byPet[id].prog += pos(v) / owners.length;
        }
      }
    } else {
      if (Math.floor(coins) > 0) {
        if (!isObj(s.player)) s.player = { coins: 100 };
        s.player.coins = (Number.isFinite(s.player.coins) ? s.player.coins : 100) + Math.floor(coins);
      }
      if (items.length) {
        if (!isObj(s.inventory)) s.inventory = {};
        for (const [id, n] of items) s.inventory[id] = (Number.isFinite(s.inventory[id]) ? s.inventory[id] : 0) + n;
      }
    }
    for (const [id, e] of Object.entries(byPet)) { // nothing to give -> no entry
      if (!(e.c > 0 || e.prog > 0 || Object.keys(e.items).length)) delete byPet[id];
    }
    s.yard = { lastAt: Number.isFinite(old.lastAt) ? old.lastAt : now(), byPet };
    if (!Array.isArray(s.nursery)) s.nursery = [];
    if (!Array.isArray(s.decor)) s.decor = [];
    if (!isObj(s.inventoryDecor)) s.inventoryDecor = {};
    if (!Array.isArray(s.postcards)) s.postcards = [];
    s.version = 5;
    return s;
  },

  // v5 -> v6: friend points between pets, favourite-spot discovery, greeting stamp. Pairs are built by tickFriends.
  5(s) {
    if (!isObj(s.friends)) s.friends = {};
    if (!Array.isArray(s.friendsMet)) s.friendsMet = [];
    if (!Number.isFinite(s.lastGreetAt)) s.lastGreetAt = 0;
    for (const p of Array.isArray(s.pets) ? s.pets : []) if (isObj(p) && typeof p.favKnown !== 'boolean') p.favKnown = false;
    for (const e of Array.isArray(s.nursery) ? s.nursery : []) if (isObj(e) && isObj(e.pet) && typeof e.pet.favKnown !== 'boolean') e.pet.favKnown = false;
    s.version = 6;
    return s;
  },

  // v6 -> v7: wardrobe, pet.wear, journal, pet.lastBirthdayGift (photos live in IndexedDB, never in the save).
  6(s) {
    if (!isObj(s.wardrobe)) s.wardrobe = {};
    if (!Array.isArray(s.journal)) s.journal = [];
    const fix = p => {
      if (!isObj(p)) return;
      if (!isObj(p.wear)) p.wear = { head: null, neck: null };
      if (p.lastBirthdayGift === undefined) p.lastBirthdayGift = null;
    };
    for (const p of Array.isArray(s.pets) ? s.pets : []) fix(p);
    for (const e of Array.isArray(s.nursery) ? s.nursery : []) if (isObj(e)) fix(e.pet);
    s.version = 7;
    return s;
  },

  // v7 -> v8: family eggs, coats seen, pet.coat / family / breedReadyAt (filled by the deep fill), incubator slot.family.
  7(s) {
    if (!Array.isArray(s.familyEggs)) s.familyEggs = [];
    if (!isObj(s.coatsSeen)) s.coatsSeen = { base: true };
    s.version = 8;
    return s;
  },
};

/**
 * Makes plot.stations <-> pet.station consistent in both directions: a station pointing at a missing pet/plot (or
 * a pet whose own station does not list it) is cleared, a pet holds at most one station, plots get exactly 3 entries.
 * Idempotent; runs at the end of every migrate() and is exported for the farm logic's tests.
 */
export function repairStations(s) {
  const plots = Array.isArray(s.plots) ? s.plots : [];
  const pets = Array.isArray(s.pets) ? s.pets : [];
  const byId = new Map(pets.filter(p => isObj(p)).map(p => [p.id, p]));
  const claimed = new Set();
  plots.forEach((plot, i) => {
    if (!isObj(plot)) return;
    const src = Array.isArray(plot.stations) ? plot.stations : [];
    plot.stations = [0, 1, 2].map(slot => {
      const id = src[slot];
      const pet = typeof id === 'string' && id ? byId.get(id) : null;
      if (!pet || claimed.has(id)) return null;
      const st = isObj(pet.station) ? pet.station : null;
      if (st && (st.plotIndex !== i || st.slot !== slot)) return null; // the pet is stationed somewhere else
      claimed.add(id);
      pet.station = { plotIndex: i, slot };
      return id;
    });
  });
  for (const pet of byId.values()) {
    const st = isObj(pet.station) ? pet.station : null;
    if (!st) { pet.station = null; continue; }
    const plot = plots[st.plotIndex];
    if (!isObj(plot) || !Array.isArray(plot.stations) || plot.stations[st.slot] !== pet.id) pet.station = null;
  }
  return s;
}

/** Helper slots of a crop (mirrors the rule in crops.js: <30 min 1, <2 h 2, else 3). */
function slotCount(cropId) {
  const crop = getCrop(cropId);
  if (!crop) return 1;
  if (Number.isInteger(crop.slots) && crop.slots >= 1) return crop.slots;
  return crop.growMs < 30 * 60 * 1000 ? 1 : crop.growMs < 2 * 3600 * 1000 ? 2 : 3;
}

const goodNum = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** v5 fields: yard.byPet only for pets that exist, nursery / decor / postcards / inventoryDecor cleaned and capped. Idempotent. */
function sanitiseV5(s) {
  const ids = new Set(s.pets.map(p => p.id));
  const byPet = {};
  for (const [id, e] of Object.entries(s.yard.byPet)) {
    if (!ids.has(id) || !isObj(e)) continue; // dangling key (pet released / never existed)
    const items = isObj(e.items) ? Object.fromEntries(Object.entries(e.items).filter(([, n]) => Number.isFinite(n) && n > 0)) : {};
    byPet[id] = { ...e, c: goodNum(e.c) ? e.c : 0, ms: goodNum(e.ms) ? e.ms : 0, prog: goodNum(e.prog) ? e.prog : 0, items };
  }
  s.yard.byPet = byPet;

  const t = s.lastTick;
  const seen = new Set(ids);
  s.nursery = s.nursery.filter(e => isObj(e) && isObj(e.pet) && typeof e.pet.id === 'string' && e.pet.id && e.pet.speciesId && !seen.has(e.pet.id) && seen.add(e.pet.id))
    .slice(0, NURSERY_SLOTS)
    .map(e => {
      const pet = fill(e.pet, petDefaults(t), 'pet');
      Object.assign(pet, { status: 'nursery', task: null, station: null });
      return { ...e, pet, hatchedAt: Number.isFinite(e.hatchedAt) ? e.hatchedAt : t };
    });

  const usedId = new Set(), usedSpot = new Set();
  s.decor = s.decor.filter(d => isObj(d) && typeof d.id === 'string' && d.id && typeof d.decorId === 'string' && d.decorId
    && Number.isInteger(d.spot) && d.spot >= 0 && !usedId.has(d.id) && !usedSpot.has(d.spot) && usedId.add(d.id) && usedSpot.add(d.spot));
  s.inventoryDecor = Object.fromEntries(Object.entries(s.inventoryDecor).filter(([, n]) => Number.isFinite(n) && n > 0));

  const cards = s.postcards.filter(c => isObj(c) && typeof c.text === 'string' && c.text)
    .map((c, i) => ({ ...c, id: typeof c.id === 'string' && c.id ? c.id : `pc${i}`, petName: typeof c.petName === 'string' ? c.petName : '',
      speciesId: typeof c.speciesId === 'string' ? c.speciesId : '', at: Number.isFinite(c.at) ? c.at : 0, read: c.read === true }));
  if (cards.length > POSTCARDS_MAX) { // keep the newest by time (array order kept), drop the oldest
    const cut = [...cards].sort((a, b) => b.at - a.at).slice(0, POSTCARDS_MAX);
    s.postcards = cards.filter(c => cut.includes(c));
  } else {
    s.postcards = cards;
  }
}

/**
 * Best friends = a greedy matching over the pairs with >= FRIEND_BEST_POINTS: strongest pair first, a pet joins at most one pair
 * (ties by key). Returns Map petId -> partnerId (both directions). Pure; friends.js, away.js and the pet logic all use it.
 */
export function friendMatching(friends) {
  const out = new Map();
  if (!isObj(friends)) return out;
  const list = Object.entries(friends).filter(([, v]) => v >= FRIEND_BEST_POINTS);
  list.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  for (const [key] of list) {
    const [a, b] = key.split('|');
    if (!a || !b || out.has(a) || out.has(b)) continue;
    out.set(a, b);
    out.set(b, a);
  }
  return out;
}

/** New friends object keeping every pet's FRIEND_PAIRS_PER_PET strongest pairs plus the best-friend pairs (<= FRIEND_PAIRS_MAX). Pure. */
export function pruneFriendPairs(friends) {
  const entries = Object.entries(friends).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  const count = new Map();
  const keep = new Set();
  const matched = friendMatching(friends);
  for (const [key] of entries) {
    const [a, b] = key.split('|');
    if (matched.get(a) === b) { keep.add(key); continue; }
    if ((count.get(a) || 0) < FRIEND_PAIRS_PER_PET || (count.get(b) || 0) < FRIEND_PAIRS_PER_PET) keep.add(key);
    if (keep.has(key)) { count.set(a, (count.get(a) || 0) + 1); count.set(b, (count.get(b) || 0) + 1); }
  }
  return Object.fromEntries(entries.filter(([k]) => keep.has(k)).slice(0, FRIEND_PAIRS_MAX));
}

/** v6: friends keeps only valid pairs of yard pets (rehomed / nursery pets drop out), pruned per pet; friendsMet cleaned. Idempotent. */
function sanitiseV6(s) {
  const ids = new Set(s.pets.map(p => p.id));
  const good = {};
  for (const [key, v] of Object.entries(s.friends)) {
    const [a, b, ...rest] = key.split('|');
    if (rest.length || !a || !b || a === b || key !== pairKey(a, b) || !ids.has(a) || !ids.has(b)) continue;
    if (Number.isFinite(v) && v > 0) good[key] = v;
  }
  s.friends = pruneFriendPairs(good);
  const met = [];
  for (const k of s.friendsMet) {
    const [a, b, ...rest] = typeof k === 'string' ? k.split('|') : [];
    if (!rest.length && a && b && a !== b && k === pairKey(a, b) && !met.includes(k)) met.push(k);
  }
  s.friendsMet = met.slice(-FRIENDS_MET_MAX);
}

/** One diary day -> { day, lines } or null. Pure; shared with journal.js. */
export function cleanJournalDay(d) {
  if (!isObj(d) || typeof d.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.day) || !Array.isArray(d.lines)) return null;
  const lines = d.lines.filter(l => isObj(l) && typeof l.text === 'string' && l.text.trim()).map(l => {
    const out = { emoji: typeof l.emoji === 'string' ? l.emoji.slice(0, 8) : '', text: l.text.slice(0, 120) };
    if (typeof l.petId === 'string' && l.petId) out.petId = l.petId.slice(0, 40);
    if (typeof l.kind === 'string' && l.kind) out.kind = l.kind.slice(0, 40);
    return out;
  });
  return lines.length ? { day: d.day, lines } : null;
}

/** v7: wardrobe counts valid, wear only references owned accessories in the right slot (one worn copy per owned copy), journal cleaned and capped. Idempotent. */
function sanitiseV7(s) {
  const wardrobe = {};
  for (const [id, n] of Object.entries(s.wardrobe)) {
    if (Number.isFinite(n) && n >= 1 && accessoryOf(id)) wardrobe[id] = Math.min(Math.floor(n), 99);
  }
  s.wardrobe = wardrobe;

  const used = {};
  const pets = [...s.pets, ...s.nursery.map(e => e.pet)];
  const nurseryPets = new Set(s.nursery.map(e => e.pet));
  for (const p of pets) {
    const src = isObj(p.wear) ? p.wear : {};
    const wear = { head: null, neck: null };
    if (!nurseryPets.has(p)) {
      for (const slot of WEAR_SLOTS) {
        const id = src[slot];
        const acc = typeof id === 'string' ? accessoryOf(id) : null;
        if (!acc || !wardrobe[id] || (acc.slot && acc.slot !== slot) || (used[id] || 0) >= wardrobe[id]) continue;
        used[id] = (used[id] || 0) + 1;
        wear[slot] = id;
      }
    }
    p.wear = wear;
    p.lastBirthdayGift = Number.isInteger(p.lastBirthdayGift) && p.lastBirthdayGift >= 1 ? p.lastBirthdayGift : null;
  }

  const byDay = new Map();
  for (const d of s.journal) {
    const c = cleanJournalDay(d);
    if (!c) continue;
    if (byDay.has(c.day)) byDay.get(c.day).lines.push(...c.lines); else byDay.set(c.day, c);
  }
  s.journal = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .slice(-JOURNAL_DAYS_MAX).map(d => ({ ...d, lines: d.lines.slice(-JOURNAL_LINES_MAX) }));
}

const GEN_MAX = 99;
const isHabitat = h => typeof h === 'string' && Object.prototype.hasOwnProperty.call(HABITATS, h);
const cleanName = v => (typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, 16).join('') : '');

/** One parent snapshot of a family egg -> a clean copy, or null when it is malformed. */
function cleanParent(p) {
  if (!isObj(p) || typeof p.petId !== 'string' || !p.petId || typeof p.speciesId !== 'string' || !getSpecies(p.speciesId)) return null;
  return {
    petId: p.petId.slice(0, 40), name: cleanName(p.name), speciesId: p.speciesId,
    personality: typeof p.personality === 'string' && p.personality ? p.personality.slice(0, 20) : 'cheerful',
    shiny: p.shiny === true, coat: COAT_IDS.includes(p.coat) ? p.coat : 'base',
    gen: Number.isInteger(p.gen) && p.gen >= 0 ? Math.min(p.gen, GEN_MAX) : 0,
  };
}

/** A family egg -> a clean copy, or null when it is malformed (a hatch could not roll from it). Pure; shared with the incubator slot check. */
export function cleanFamilyEgg(e) {
  if (!isObj(e) || typeof e.id !== 'string' || !e.id || !Number.isFinite(e.laidAt)) return null;
  if (!isHabitat(e.habitatA) || !isHabitat(e.habitatB)) return null;
  const a = cleanParent(e.a), b = cleanParent(e.b);
  return a && b ? { id: e.id.slice(0, 40), laidAt: e.laidAt, habitatA: e.habitatA, habitatB: e.habitatB, a, b } : null;
}

/** A pet's family field -> { gen, a: { name, speciesId }, b } or null. */
function cleanFamily(f) {
  if (!isObj(f) || !isObj(f.a) || !isObj(f.b)) return null;
  const side = x => (typeof x.speciesId === 'string' && getSpecies(x.speciesId) ? { name: cleanName(x.name), speciesId: x.speciesId } : null);
  const a = side(f.a), b = side(f.b);
  return a && b ? { gen: Number.isInteger(f.gen) && f.gen >= 1 ? Math.min(f.gen, GEN_MAX) : 1, a, b } : null;
}

/**
 * v8: familyEggs cleaned and capped, incubator slot.family kept only when well-formed (a family slot without a good egg is
 * dropped: it could never hatch), pet.coat / family / breedReadyAt valid, coatsSeen = known coats (+ the ones pets wear now). Idempotent.
 */
function sanitiseV8(s) {
  const seenId = new Set();
  s.familyEggs = (Array.isArray(s.familyEggs) ? s.familyEggs : []).map(cleanFamilyEgg).filter(e => e && !seenId.has(e.id) && seenId.add(e.id)).slice(0, FAMILY_EGG_MAX);

  s.incubator = s.incubator.filter(slot => {
    if (slot.family === undefined && slot.eggId !== 'egg_family') return true;
    const fam = cleanFamilyEgg(slot.family);
    if (!fam || slot.eggId !== 'egg_family') {
      if (slot.eggId === 'egg_family') return false;
      delete slot.family; // a normal egg with a stray family field
      return true;
    }
    slot.family = fam;
    return true;
  });

  const seen = { base: true };
  for (const [id, v] of Object.entries(isObj(s.coatsSeen) ? s.coatsSeen : {})) if (v === true && COAT_IDS.includes(id)) seen[id] = true;
  for (const p of [...s.pets, ...s.nursery.map(e => e.pet)]) {
    p.coat = COAT_IDS.includes(p.coat) ? p.coat : 'base';
    p.family = cleanFamily(p.family);
    // capped at one cooldown from now: a pet that bred while the device clock ran ahead is not stuck for longer
  p.breedReadyAt = goodNum(p.breedReadyAt) ? Math.min(p.breedReadyAt, now() + BREED_COOLDOWN_CAP_MS) : 0;
    seen[p.coat] = true;
  }
  s.coatsSeen = seen;
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
  repairStations(s);
  sanitiseV5(s);
  sanitiseV6(s);
  sanitiseV7(s);
  sanitiseV8(s);

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

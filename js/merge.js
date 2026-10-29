// V26 3-way save merge (CONTRACT_V26 section 1). Pure and DOM-free: mergeSaves(base, local, remote) -> { state, conflicts }.
//   base   = the last save both sides agreed on (the one that last went up to / came down from the cloud)
//   local  = this device's save, remote = the other device's save (both already through migrate(), same version)
// Inputs are deep-cloned and never mutated; the result goes through migrate() once more (sanitise).
// Idea: for every field, "what did each side change relative to base?" -- a change on one side wins, counters add
// both deltas, ids are unioned, and only a real clash on the same non-counter value falls back to "newer updatedAt wins".
import { migrate, xpForLevel } from './state.js';

/** How each top-level field of the save is merged, and why. Documentation only (the code below is the truth). */
export const MERGE_RULES = {
  version: { rule: 'local', why: 'both sides must have the same version (mergeSaves throws otherwise)' },
  updatedAt: { rule: 'max', why: 'the merged save is at least as new as both' },
  lastTick: { rule: 'max', why: 'time already simulated; the later one avoids replaying time twice' },
  player: {
    rule: 'counter + newer-wins',
    why: 'coins = counter; level+xp = total XP (same formula as xpForLevel) with both deltas added, then converted back; createdAt = earliest; lastDailyClaim = latest day; farmName = 3-way (newer wins on a clash)',
  },
  pets: {
    rule: 'keyed-by-id, field-level',
    why: 'union by pet id (add/remove follows the side that changed; remove vs edit keeps the edit). Same pet edited on both: xp and bond are counters; lastFedAt/playedAt/breedReadyAt/lastBirthdayGift = max; favKnown/favDishKnown/favToyKnown = OR; status+task+station and bondDay+bondToday travel as a group; stats/poop/sick/wear/treat/... = per field, newer side on a clash. Stage = max of both (addPetXp re-levels on the next gain)',
  },
  barnCapacity: { rule: 'max', why: 'upgrades only grow; the coins spent are counted by the coins counter' },
  incubatorCapacity: { rule: 'max', why: 'same as barnCapacity' },
  incubator: { rule: 'keyed (eggId@startAt)', why: 'slots have no id; an egg put in on one device stays, a slot hatched/removed on one device is removed unless the other changed it; ready = OR' },
  inventory: { rule: 'counter', why: 'every item count is base + both deltas, never below 0 (clamp is reported in conflicts)' },
  plots: {
    rule: 'per index',
    why: 'one side changed a plot -> that plot; both changed it: same planting (cropId+plantedAt) -> per-field 3-way (newer wins), a different planting -> the whole plot from the newer side (a half-mixed plot would be inconsistent). Plots added on one side are kept (list = longer one)',
  },
  expeditions: { rule: 'keyed-by-id', why: 'union by id; done/rewards from whichever side finished it. Claimed (removed) on one side and untouched on the other = removed' },
  collection: { rule: 'counter + OR', why: 'per species: owned = counter (each hatch is a real pet), shiny = OR' },
  log: { rule: 'union', why: 'entries keyed by time+text, newest first, capped to 50 by migrate' },
  stats: { rule: 'counter', why: 'lifetime counters add both deltas' },
  quests: { rule: 'max step / OR done', why: 'the chain only moves forward; preDone = union. Claiming the same step on both devices pays twice (accepted)' },
  orders: { rule: 'keyed-by-id, done OR', why: 'same day -> boards merged by order id with done = OR; different day -> the newer side; weekly the same way' },
  stardust: { rule: 'counter', why: 'currency' },
  claimedGoals: { rule: 'union', why: 'once claimed always claimed' },
  settings: { rule: 'generic 3-way', why: 'per key: the side that changed it; newer on a clash' },
  yard: { rule: 'lastAt max; byPet keyed', why: 'accruals (c, ms, prog) are time-driven so adding them would double count: per field the changed side, newer on a clash; items inside are counters' },
  nursery: { rule: 'keyed by pet.id', why: 'union; a baby that moved to the yard on one side leaves the nursery' },
  decor: { rule: 'keyed-by-id', why: 'union by placed id; a spot clash (two devices placed on the same spot) keeps the first and returns the other to inventoryDecor' },
  inventoryDecor: { rule: 'counter', why: 'built-but-unplaced counts' },
  postcards: { rule: 'keyed-by-id', why: 'union; read = OR; migrate caps to 30' },
  friends: { rule: 'per pair key, max', why: 'friend points grow with time on both devices -> the larger value; pairs of missing pets are dropped by migrate' },
  friendsMet: { rule: 'union', why: 'announced best-friend pairs' },
  lastGreetAt: { rule: 'max', why: 'a timestamp' },
  wardrobe: { rule: 'counter', why: 'copies owned' },
  familyEggs: { rule: 'keyed-by-id', why: 'union; an egg moved into the incubator on one side is removed' },
  coatsSeen: { rule: 'union', why: 'coat ids seen' },
  coatBook: { rule: 'union', why: 'species -> coats seen' },
  festival: {
    rule: 'custom',
    why: 'lanterns/krathongs = counters, owned = union; same festival key: tasks merged by id (progress max, claimed OR), loginDays/seenDays union, floatDays max; a different key (festival changed) -> structure from the newer side',
  },
  journal: { rule: 'keyed by day, lines unioned', why: 'diary lines keyed by content; migrate caps days/lines' },
  mail: { rule: 'keyed-by-id', why: 'read/claimed = OR (claiming the same mail on both pays twice, accepted); newest first' },
  mailSent: { rule: 'union', why: 'system mails already delivered' },
  '*': { rule: 'generic 3-way', why: 'unknown / future fields: changed side wins, objects recurse per key, a clash -> newer updatedAt (a deletion never beats a change)' },
};

// ---------------------------------------------------------------- helpers

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const num = v => (Number.isFinite(v) ? v : 0);

function eq(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && eq(a[k], b[k]));
}

// Fields whose clashes are expected every time (both devices tick them), so they are not worth a conflicts line.
const QUIET_ROOTS = new Set(['pets', 'plots', 'yard', 'nursery', 'friends', 'incubator', 'expeditions']);

function newer(l, r, ctx, path) {
  if (!QUIET_ROOTS.has(String(path).split('.')[0])) ctx.conflicts.push(`${path}: both sides changed, kept the ${ctx.newerLocal ? 'local' : 'remote'} (newer) value`);
  return ctx.newerLocal ? l : r;
}

/** Generic 3-way merge of any JSON value. */
function generic(b, l, r, ctx, path) {
  if (eq(l, r)) return l;
  if (eq(l, b)) return r;
  if (eq(r, b)) return l;
  if (l === undefined) return r;   // deleted on one side, changed on the other: keep the change
  if (r === undefined) return l;
  if (isObj(l) && isObj(r)) {
    const bo = isObj(b) ? b : {};
    const out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const v = generic(bo[k], l[k], r[k], ctx, `${path}.${k}`);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return newer(l, r, ctx, path);
}

/** base + (local - base) + (remote - base), never below 0. A missing number counts as 0. */
function counter(b, l, r, ctx, path) {
  const bv = num(b);
  let v = bv + (num(l) - bv) + (num(r) - bv);
  if (v < 0) { ctx.conflicts.push(`${path}: counter would be negative (${v}), clamped to 0`); v = 0; }
  return Math.round(v * 1e9) / 1e9;
}

/** A map of counters ({ id: n }). Entries that end at 0 are dropped unless keepZero. */
function counterMap(b, l, r, ctx, path, keepZero = false) {
  const bo = isObj(b) ? b : {}, lo = isObj(l) ? l : {}, ro = isObj(r) ? r : {};
  const out = {};
  for (const k of new Set([...Object.keys(bo), ...Object.keys(lo), ...Object.keys(ro)])) {
    const v = counter(bo[k], lo[k], ro[k], ctx, `${path}.${k}`);
    if (v > 0 || keepZero) out[k] = v;
  }
  return out;
}

/** 3-way merge of a list of keyed items. Order: local order first, then items only the remote has. */
function keyed(b, l, r, keyOf, mergeItem, ctx, path) {
  const index = arr => {
    const m = new Map(), seen = new Map();
    for (const it of Array.isArray(arr) ? arr : []) {
      let k = String(keyOf(it));
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      if (n > 1) k += `#${n}`;
      m.set(k, it);
    }
    return m;
  };
  const B = index(b), L = index(l), R = index(r);
  const out = [];
  for (const k of [...L.keys(), ...[...R.keys()].filter(x => !L.has(x))]) {
    const bi = B.get(k), li = L.get(k), ri = R.get(k);
    if (li !== undefined && ri !== undefined) out.push(eq(li, ri) ? li : mergeItem(bi, li, ri, ctx, `${path}[${k}]`));
    else if (bi === undefined) out.push(li !== undefined ? li : ri);                      // added on one side
    else {
      const kept = li !== undefined ? li : ri;                                            // removed on the other side
      if (!eq(kept, bi)) out.push(kept);                                                   // ...but edited here: keep the edit
    }
  }
  return out;
}

const union = (...lists) => [...new Set(lists.flatMap(a => (Array.isArray(a) ? a : [])))];
const maxOf = (...v) => Math.max(...v.map(num));
const orOf = (...v) => v.some(x => x === true);
const maxStr = (a, b) => (typeof a === 'string' && typeof b === 'string' ? (a >= b ? a : b) : typeof a === 'string' ? a : typeof b === 'string' ? b : null);

// ---------------------------------------------------------------- player XP

/** (level, xp) -> total XP earned, using the same curve as xpForLevel/addPlayerXp. */
function totalXp(level, xp) {
  let t = num(xp);
  for (let k = 1; k < Math.max(1, Math.floor(num(level)) || 1); k++) t += xpForLevel(k);
  return t;
}
function fromTotalXp(total) {
  let level = 1, xp = Math.max(0, total);
  while (xp >= xpForLevel(level)) { xp -= xpForLevel(level); level += 1; }
  return { level, xp };
}

function mergePlayer(b, l, r, ctx) {
  b = isObj(b) ? b : {};
  const own = ['coins', 'level', 'xp', 'createdAt', 'lastDailyClaim'];
  const out = generic(omit(b, own), omit(l, own), omit(r, own), ctx, 'player');   // farmName, anything unknown
  out.coins = counter(b.coins, l.coins, r.coins, ctx, 'player.coins');
  const tb = totalXp(b.level, b.xp);
  const t = Math.max(0, tb + (totalXp(l.level, l.xp) - tb) + (totalXp(r.level, r.xp) - tb));
  Object.assign(out, fromTotalXp(t));
  const created = [l.createdAt, r.createdAt].filter(x => Number.isFinite(x) && x > 0);
  if (created.length) out.createdAt = Math.min(...created);
  out.lastDailyClaim = maxStr(l.lastDailyClaim, r.lastDailyClaim);
  return out;
}

// ---------------------------------------------------------------- pets

const PET_ACTIVITY = ['status', 'task', 'station'];
const PET_BONDDAY = ['bondDay', 'bondToday'];
const PET_MAX = ['lastFedAt', 'playedAt', 'breedReadyAt', 'lastBirthdayGift'];
const PET_OR = ['favKnown', 'favDishKnown', 'favToyKnown'];

/** A group of fields that must stay together: the side that changed any of them, the newer side if both did. */
function pickGroup(fields, b, l, r, ctx) {
  const changed = o => fields.some(f => !eq(o[f], b[f]));
  const cl = changed(l), cr = changed(r);
  if (cl && cr) return ctx.newerLocal ? l : r;
  return cr ? r : l;
}

function mergePet(b, l, r, ctx, path) {
  if (!isObj(b)) return generic(undefined, l, r, ctx, path);
  const grouped = new Set([...PET_ACTIVITY, ...PET_BONDDAY, ...PET_MAX, ...PET_OR, 'xp', 'bond', 'stage']);
  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (grouped.has(k)) continue;
    const v = generic(b[k], l[k], r[k], ctx, `${path}.${k}`);
    if (v !== undefined) out[k] = v;
  }
  out.xp = counter(b.xp, l.xp, r.xp, ctx, `${path}.xp`);
  out.bond = counter(b.bond, l.bond, r.bond, ctx, `${path}.bond`);
  out.stage = maxOf(l.stage, r.stage);
  for (const k of PET_MAX) if (k in l || k in r) out[k] = l[k] == null && r[k] == null ? (l[k] ?? r[k] ?? null) : maxOf(l[k], r[k]);
  for (const k of PET_OR) if (k in l || k in r) out[k] = orOf(l[k], r[k]);
  const act = pickGroup(PET_ACTIVITY, b, l, r, ctx);
  for (const k of PET_ACTIVITY) if (k in act) out[k] = clone(act[k]);
  const bd = pickGroup(PET_BONDDAY, b, l, r, ctx);
  for (const k of PET_BONDDAY) if (k in bd) out[k] = clone(bd[k]);
  return out;
}

// ---------------------------------------------------------------- small item merges

const orFlag = (field, ...rest) => (b, l, r, ctx, path) => {
  const out = generic(b, l, r, ctx, path);
  if (!isObj(out)) return out;
  for (const f of [field, ...rest]) if (f in l || f in r) out[f] = orOf(l[f], r[f]);
  return out;
};
const mergeMailItem = (b, l, r, ctx, path) => {
  const out = orFlag('read', 'claimed')(b, l, r, ctx, path);
  if (isObj(out)) out.at = Math.min(num(l.at), num(r.at)) || maxOf(l.at, r.at);
  return out;
};
const mergeExpedition = (b, l, r, ctx, path) => (l.done || r.done ? clone(l.done ? l : r) : generic(b, l, r, ctx, path));

function mergeCollection(b, l, r, ctx) {
  const bo = isObj(b) ? b : {}, lo = isObj(l) ? l : {}, ro = isObj(r) ? r : {};
  const out = {};
  for (const sp of new Set([...Object.keys(lo), ...Object.keys(ro)])) {
    const be = isObj(bo[sp]) ? bo[sp] : {}, le = isObj(lo[sp]) ? lo[sp] : {}, re = isObj(ro[sp]) ? ro[sp] : {};
    const own = ['owned', 'shiny'];
    const e = generic(omit(be, own), omit(le, own), omit(re, own), ctx, `collection.${sp}`);
    out[sp] = { ...(isObj(e) ? e : {}), owned: counter(be.owned, le.owned, re.owned, ctx, `collection.${sp}.owned`), shiny: orOf(le.shiny, re.shiny) };
  }
  return out;
}

function mergeOrders(b, l, r, ctx) {
  if (!isObj(l) || !isObj(r)) return generic(b, l, r, ctx, 'orders');
  b = isObj(b) ? b : {};
  const out = { ...generic(b, { ...l, list: 0, weekly: 0 }, { ...r, list: 0, weekly: 0 }, ctx, 'orders') };
  const sameDay = l.day === r.day;
  out.list = sameDay
    ? keyed(b.day === l.day ? b.list : [], l.list, r.list, o => o && o.id, orFlag('done'), ctx, 'orders.list')
    : clone(ctx.newerLocal ? l.list : r.list);
  const lw = l.weekly, rw = r.weekly;
  if (isObj(lw) && isObj(rw) && lw.id === rw.id) out.weekly = orFlag('done')(isObj(b.weekly) && b.weekly.id === lw.id ? b.weekly : undefined, lw, rw, ctx, 'orders.weekly');
  else out.weekly = clone(eq(lw, b.weekly) ? rw : eq(rw, b.weekly) ? lw : ctx.newerLocal ? lw : rw);
  return out;
}

function mergeQuests(b, l, r, ctx) {
  const own = ['step', 'done', 'preDone'];
  const out = generic(omit(isObj(b) ? b : {}, own), omit(l, own), omit(r, own), ctx, 'quests');
  out.step = maxOf(l.step, r.step);
  out.done = orOf(l.done, r.done);
  if (Array.isArray(l.preDone) || Array.isArray(r.preDone)) out.preDone = union(l.preDone, r.preDone);
  return out;
}

function mergeYard(b, l, r, ctx) {
  b = isObj(b) ? b : {};
  const out = generic(b, { ...l, byPet: 0 }, { ...r, byPet: 0 }, ctx, 'yard');
  out.lastAt = maxOf(l.lastAt, r.lastAt);
  const bb = isObj(b.byPet) ? b.byPet : {}, lb = isObj(l.byPet) ? l.byPet : {}, rb = isObj(r.byPet) ? r.byPet : {};
  out.byPet = {};
  for (const id of new Set([...Object.keys(lb), ...Object.keys(rb)])) {
    const be = bb[id], le = lb[id], re = rb[id];
    if (!isObj(le) || !isObj(re)) {   // only one side has the pet's gifts: keep them unless the other side removed them and this side did not touch them
      const only = isObj(le) ? le : re;
      if (!(isObj(be) && eq(only, be))) out.byPet[id] = clone(only);
      continue;
    }
    const e = generic(be, { ...le, items: 0 }, { ...re, items: 0 }, ctx, `yard.byPet.${id}`);
    e.items = counterMap(isObj(be) ? be.items : {}, le.items, re.items, ctx, `yard.byPet.${id}.items`);
    out.byPet[id] = e;
  }
  return out;
}

function mergePlots(b, l, r, ctx) {
  const bp = Array.isArray(b) ? b : [], lp = Array.isArray(l) ? l : [], rp = Array.isArray(r) ? r : [];
  const out = [];
  for (let i = 0; i < Math.max(lp.length, rp.length); i++) {
    const B = bp[i], L = lp[i], R = rp[i];
    if (L === undefined || R === undefined) out.push(clone(L === undefined ? R : L));
    else if (eq(L, R)) out.push(clone(L));
    else if (eq(L, B)) out.push(clone(R));
    else if (eq(R, B)) out.push(clone(L));
    else if (isObj(L) && isObj(R) && L.cropId === R.cropId && L.plantedAt === R.plantedAt) out.push(generic(B, L, R, ctx, `plots.${i}`));   // same planting: per field
    else {
      ctx.conflicts.push(`plots.${i}: both sides changed the plot, kept the ${ctx.newerLocal ? 'local' : 'remote'} (newer) one`);
      out.push(clone(ctx.newerLocal ? L : R));
    }
  }
  return out;
}

function mergeFestival(b, l, r, ctx) {
  if (!isObj(l) || !isObj(r)) return generic(b, l, r, ctx, 'festival');
  b = isObj(b) ? b : {};
  const sameKey = l.id === r.id && l.key === r.key;
  const own = ['lanterns', 'krathongs', 'owned', 'seenDays', 'floatDays', 'loginDays', 'tasks', 'krathong'];
  const out = clone(sameKey ? generic(omit(b, own), omit(l, own), omit(r, own), ctx, 'festival') : (ctx.newerLocal ? l : r));
  out.lanterns = counter(b.lanterns, l.lanterns, r.lanterns, ctx, 'festival.lanterns');
  out.krathongs = counter(b.krathongs, l.krathongs, r.krathongs, ctx, 'festival.krathongs');
  out.owned = { ...(isObj(l.owned) ? l.owned : {}), ...(isObj(r.owned) ? r.owned : {}) };
  out.seenDays = union(l.seenDays, r.seenDays).sort();
  const fd = {};
  for (const src of [l.floatDays, r.floatDays]) for (const [d, n] of Object.entries(isObj(src) ? src : {})) fd[d] = Math.max(fd[d] || 0, num(n));
  out.floatDays = fd;
  if (sameKey) {
    out.loginDays = union(l.loginDays, r.loginDays).sort();
    const lt = Array.isArray(l.tasks) ? l.tasks : [], rt = Array.isArray(r.tasks) ? r.tasks : [];
    out.tasks = clone(ctx.newerLocal ? lt : rt).map(t => {
      const o = (ctx.newerLocal ? rt : lt).find(x => x && t && x.id === t.id);
      return o ? { ...t, progress: maxOf(t.progress, o.progress), claimed: orOf(t.claimed, o.claimed) } : t;
    });
    const lk = isObj(l.krathong) ? l.krathong : {}, rk = isObj(r.krathong) ? r.krathong : {};
    out.krathong = lk.day === rk.day ? { day: lk.day || '', n: maxOf(lk.n, rk.n) } : clone(String(lk.day) > String(rk.day) ? lk : rk);
  }
  return out;
}

function mergeJournal(b, l, r, ctx) {
  const mergeDay = (bd, ld, rd) => ({
    ...ld,
    lines: keyed(bd && bd.lines, ld.lines, rd.lines, x => JSON.stringify(x), (_b, x) => x, ctx, 'journal.lines'),
  });
  const out = keyed(b, l, r, d => d && d.day, mergeDay, ctx, 'journal');
  return out.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0));
}

// ---------------------------------------------------------------- consistency pass

/** Fixes links that two independently-edited halves can break. Runs on the merged (not yet migrated) object. */
function repairLinks(s) {
  const pets = Array.isArray(s.pets) ? s.pets : [];
  const ids = new Set(pets.map(p => p && p.id));
  s.nursery = (Array.isArray(s.nursery) ? s.nursery : []).filter(e => !(isObj(e) && isObj(e.pet) && ids.has(e.pet.id)));   // grew up on one side
  const plots = Array.isArray(s.plots) ? s.plots : [];
  const exIds = new Set((Array.isArray(s.expeditions) ? s.expeditions : []).map(e => e && e.id));
  const slotOwner = new Set();
  for (const p of pets) {
    if (!isObj(p) || !isObj(p.task)) continue;
    const t = p.task;
    let ok = true;
    if (t.type === 'plot') {
      const plot = plots[t.plotIndex];
      ok = isObj(plot) && Array.isArray(plot.petIds) && plot.petIds[t.slot] === p.id;
      if (ok) slotOwner.add(`${t.plotIndex}:${t.slot}`);
    } else if (t.type === 'expedition') {
      ok = exIds.has(t.expeditionId);
    }
    if (!ok) { p.task = null; if (p.status === 'working' || p.status === 'expedition') p.status = 'idle'; }
  }
  plots.forEach((plot, i) => {
    if (isObj(plot) && Array.isArray(plot.petIds)) plot.petIds = plot.petIds.map((id, slot) => (id && slotOwner.has(`${i}:${slot}`) ? id : null));
  });
  // two placed decors on one spot: keep the first, the other goes back into the bag
  const spots = new Set();
  s.inventoryDecor = isObj(s.inventoryDecor) ? s.inventoryDecor : {};
  s.decor = (Array.isArray(s.decor) ? s.decor : []).filter(d => {
    if (!isObj(d)) return false;
    if (!spots.has(d.spot)) { spots.add(d.spot); return true; }
    s.inventoryDecor[d.decorId] = (s.inventoryDecor[d.decorId] || 0) + 1;
    return false;
  });
}

// ---------------------------------------------------------------- entry point

const SKIP_KEYS = new Set(['version']);

/**
 * 3-way merge. Returns { state, conflicts }: state is a fresh object that already went through migrate(); conflicts are
 * human-readable lines for the things that could not be merged cleanly (clamped counters, plots changed on both sides, ...).
 * Throws when an input is not a save object or the versions differ (the caller falls back to "newer wins + backup").
 */
export function mergeSaves(base, local, remote) {
  if (!isObj(base) || !isObj(local) || !isObj(remote)) throw new Error('mergeSaves: base, local and remote must be save objects');
  if (base.version !== local.version || local.version !== remote.version) throw new Error('mergeSaves: versions differ');
  const b = clone(base), l = clone(local), r = clone(remote);
  const ctx = { conflicts: [], newerLocal: num(l.updatedAt) >= num(r.updatedAt) };

  if (eq(l, r)) return { state: migrate(l), conflicts: [] };
  if (eq(l, b)) return { state: migrate(r), conflicts: [] };
  if (eq(r, b)) return { state: migrate(l), conflicts: [] };

  const out = {};
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    if (SKIP_KEYS.has(k)) continue;
    const B = b[k], L = l[k], R = r[k];
    switch (k) {
      case 'updatedAt': case 'lastTick': case 'lastGreetAt': out[k] = maxOf(L, R); break;
      case 'barnCapacity': case 'incubatorCapacity': out[k] = maxOf(L, R); break;
      case 'stardust': out[k] = counter(B, L, R, ctx, k); break;
      case 'player': out[k] = isObj(L) && isObj(R) ? mergePlayer(B, L, R, ctx) : generic(B, L, R, ctx, k); break;
      case 'pets': out[k] = keyed(B, L, R, p => p && p.id, mergePet, ctx, k); break;
      case 'inventory': case 'inventoryDecor': case 'wardrobe': out[k] = counterMap(B, L, R, ctx, k); break;
      case 'stats': out[k] = counterMap(B, L, R, ctx, k, true); break;
      case 'plots': out[k] = mergePlots(B, L, R, ctx); break;
      case 'incubator': out[k] = keyed(B, L, R, s => s && `${s.eggId}@${s.startAt}`, orFlag('ready'), ctx, k); break;
      case 'expeditions': out[k] = keyed(B, L, R, e => e && e.id, mergeExpedition, ctx, k); break;
      case 'collection': out[k] = mergeCollection(B, L, R, ctx); break;
      case 'log': out[k] = keyed(B, L, R, e => e && `${e.t}|${e.msg}`, (_b, x) => x, ctx, k).sort((x, y) => num(y.t) - num(x.t)); break;
      case 'quests': out[k] = isObj(L) && isObj(R) ? mergeQuests(B, L, R, ctx) : generic(B, L, R, ctx, k); break;
      case 'orders': out[k] = mergeOrders(B, L, R, ctx); break;
      case 'claimedGoals': case 'friendsMet': case 'mailSent': out[k] = union(L, R); break;
      case 'yard': out[k] = isObj(L) && isObj(R) ? mergeYard(B, L, R, ctx) : generic(B, L, R, ctx, k); break;
      case 'nursery': out[k] = keyed(B, L, R, e => e && e.pet && e.pet.id, (b2, x, y, c, p) => ({ ...generic(b2, x, y, c, p), pet: mergePet(b2 && b2.pet, x.pet, y.pet, c, `${p}.pet`) }), ctx, k); break;
      case 'decor': out[k] = keyed(B, L, R, d => d && d.id, generic, ctx, k); break;
      case 'postcards': out[k] = keyed(B, L, R, c => c && c.id, orFlag('read'), ctx, k); break;
      case 'friends': {
        const lo = isObj(L) ? L : {}, ro = isObj(R) ? R : {};
        out[k] = {};
        for (const p of new Set([...Object.keys(lo), ...Object.keys(ro)])) out[k][p] = maxOf(lo[p], ro[p]);
        break;
      }
      case 'familyEggs': out[k] = keyed(B, L, R, e => e && e.id, generic, ctx, k); break;
      case 'coatsSeen': case 'coatBook': out[k] = generic(B, L, R, ctx, k); break;
      case 'festival': out[k] = mergeFestival(B, L, R, ctx); break;
      case 'journal': out[k] = mergeJournal(B, L, R, ctx); break;
      case 'mail': out[k] = keyed(B, L, R, m => m && m.id, mergeMailItem, ctx, k).sort((x, y) => num(y.at) - num(x.at)); break;
      default: out[k] = generic(B, L, R, ctx, k);
    }
    if (out[k] === undefined) delete out[k];
  }
  out.version = l.version;
  out.updatedAt = maxOf(l.updatedAt, r.updatedAt);
  repairLinks(out);
  return { state: migrate(out), conflicts: ctx.conflicts };
}

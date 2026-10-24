// Farm logic: plots, working pets, expeditions, shop actions, upgrades.
// DOM-free. Every action takes the state object, mutates it, and returns { ok, msg } or { ok:false, reason }.
// Extra (optional) plot fields, initialised lazily when missing:
//   plot.lastGrowAt  - ms timestamp growth was last applied (missing => plantedAt)
//   plot.petIds      - one pet id (or null) per team slot of the planted crop (replaces pre-v3 plot.petId)
//   plot.xpCarryMs   - per-slot leftover working time (<60s) not yet converted to pet XP
//   plot.fertilized  - true once fertilizer was used for this planting (max one per crop)
//   plot.helperBonus / plot.helperPetIds - yield bonus + helpers snapshotted when the crop became ready
//   plot.lastCropId  - crop last planted here (kept after harvest) for the one-tap replant button
//   plot.stations    - petId pinned (pin) per slot index 0..2, kept across crops (V6); pet.station = { plotIndex, slot }
import { now, randInt, pickWeighted, uid, addLog, notify, formatDuration, todayKey } from './util.js';
import { addItem, removeItem, countItem, addCoins, spendCoins, addPlayerXp, bumpStat, repairStations as repairStationLinks } from './state.js';
import { canWork, getWorkPower, traitEffect, addBond, addPetXp, getPet, petEmoji, petName } from './pets.js';
import { CROPS, getCrop } from './data/crops.js';
import { EGGS } from './data/eggs.js';
import { getItem } from './data/items.js';

const MIN = 60 * 1000;
export const MAX_PLOTS = 16;
export const MAX_BARN = 20;
const START_PLOTS = 4;
const START_BARN = 3;
const READY_EPS = 1e-9;
const FERTILIZER_BOOST = 0.25;
const FERTILIZER_CAP = 0.95; // fertilizer can never finish a crop on its own
const MAX_GAP_MS = 72 * 60 * MIN; // matches main.js offline cap
const PET_STEP_CAP_MS = 5 * MIN; // max slice of one tick credited to a working pet
const WATER_BOOST = 0.2;
const PET_BOOST = 0.3;

const fail = reason => ({ ok: false, reason });
const done = msg => ({ ok: true, msg });

// ---------------------------------------------------------------- zones

export const ZONES = [
  {
    id: 'forest', emoji: '🌲', nameTh: 'ป่าใหญ่', job: 'forage', durationMs: 5 * MIN, unlockLevel: 1,
    baseRolls: 1, xp: 2, petXp: 3, eggChance: 0.03, eggs: ['egg_forest'], desc: 'เก็บเห็ด เบอร์รี และสมุนไพรในป่า',
    loot: [
      { itemId: 'forage_mushroom', weight: 300, min: 1, max: 2 },
      { itemId: 'forage_berry',    weight: 280, min: 1, max: 3 },
      { itemId: 'forage_herb',     weight: 200, min: 1, max: 2 },
      { itemId: 'forage_wood',     weight: 160, min: 1, max: 2 },
      { itemId: 'forage_bone',     weight: 50,  min: 1, max: 1 },
      { itemId: 'forage_honey',    weight: 50,  min: 1, max: 1 },
      { itemId: 'forage_feather',  weight: 30,  min: 1, max: 1 },
      { itemId: 'forage_star',     weight: 3,   min: 1, max: 1 },
    ],
  },
  {
    id: 'pond', emoji: '🏞️', nameTh: 'บึงใหญ่', job: 'fish', durationMs: 15 * MIN, unlockLevel: 3,
    baseRolls: 1, xp: 3, petXp: 8, eggChance: 0.035, eggs: ['egg_water'], desc: 'จับปลา กุ้ง และเก็บเปลือกหอย',
    loot: [
      { itemId: 'forage_fish',   weight: 340, min: 1, max: 3 },
      { itemId: 'forage_shrimp', weight: 260, min: 1, max: 2 },
      { itemId: 'forage_shell',  weight: 220, min: 1, max: 2 },
      { itemId: 'forage_herb',   weight: 80,  min: 1, max: 2 },
      { itemId: 'forage_stone',  weight: 60,  min: 1, max: 2 },
      { itemId: 'forage_gem',    weight: 15,  min: 1, max: 1 },
      { itemId: 'forage_star',   weight: 2,   min: 1, max: 1 },
    ],
  },
  {
    id: 'mountain', emoji: '⛰️', nameTh: 'ภูเขา', job: 'dig', durationMs: 30 * MIN, unlockLevel: 5,
    baseRolls: 3, xp: 5, petXp: 15, eggChance: 0.04, eggs: ['egg_savanna', 'egg_polar'], desc: 'ขุดหิน กระดูก และอัญมณีใต้ดิน',
    loot: [
      { itemId: 'forage_stone',    weight: 340, min: 2, max: 4 },
      { itemId: 'forage_bone',     weight: 200, min: 1, max: 2 },
      { itemId: 'forage_mushroom', weight: 140, min: 1, max: 2 },
      { itemId: 'forage_wood',     weight: 120, min: 1, max: 2 },
      { itemId: 'forage_honey',    weight: 50,  min: 1, max: 1 },
      { itemId: 'forage_gem',      weight: 30,  min: 1, max: 1 },
      { itemId: 'forage_star',     weight: 5,   min: 1, max: 1 },
    ],
  },
  {
    id: 'cloud', emoji: '☁️', nameTh: 'ปุยเมฆ', job: 'fly', durationMs: 60 * MIN, unlockLevel: 8,
    baseRolls: 6, xp: 7, petXp: 30, eggChance: 0.05, eggs: ['egg_sky'], desc: 'บินขึ้นฟ้าไปเก็บขนนก น้ำผึ้ง และเศษดาว',
    loot: [
      { itemId: 'forage_feather', weight: 320, min: 1, max: 3 },
      { itemId: 'forage_berry',   weight: 160, min: 2, max: 4 },
      { itemId: 'forage_honey',   weight: 140, min: 1, max: 2 },
      { itemId: 'forage_herb',    weight: 100, min: 1, max: 2 },
      { itemId: 'forage_shell',   weight: 80,  min: 1, max: 2 },
      { itemId: 'forage_gem',     weight: 30,  min: 1, max: 1 },
      { itemId: 'forage_star',    weight: 10,  min: 1, max: 1 },
    ],
  },
];

export function getZone(id) {
  return ZONES.find(z => z.id === id) || null;
}

// ---------------------------------------------------------------- helpers

function getPlot(state, index) {
  if (!state || !Array.isArray(state.plots) || !Number.isInteger(index)) return null;
  return state.plots[index] || null;
}

// Diminishing returns: full value up to power 2, 40% of it above. Pet crop speed is
// 0.3 x effectivePower = 0.3*min(p,2) + 0.12*max(0,p-2); yield and loot bonuses use it too.
export function effectivePower(p) {
  const x = Number(p);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(x, 2) + 0.4 * Math.max(0, x - 2);
}

const hourOf = ms => new Date(ms).getHours();

// ---- team plots: a crop has 1-3 slots; slot i is tied to crop.jobs[i] (1-slot crops use their best job)
export const TEAM_COMBO = 1.25; // speed multiplier on the pet part when every slot of a 2-3 slot plot is filled

const slotCount = crop => Math.max(1, Number(crop && crop.slots) || 1);

// Jobs that count for the pet standing in `slot`.
export function slotJobs(crop, slot) {
  if (!crop) return [];
  return slotCount(crop) < 2 ? crop.jobs : [crop.jobs[slot] || crop.jobs[0]];
}

// Effective (diminished) power of `pet` in `slot` of `crop`, trait + bond included (via ctx).
function slotPower(pet, crop, slot, teamSize, ms) {
  if (!pet || !crop) return 0;
  const jobs = slotJobs(crop, slot);
  return effectivePower(getWorkPower(pet, jobs, { kind: 'plot', jobs, teamSize, hour: hourOf(ms) }));
}

// Normalises plot.petIds to exactly one entry per slot (also upgrades a pre-v3 plot.petId).
function ensureSlots(plot, crop) {
  const n = slotCount(crop);
  if (!Array.isArray(plot.petIds)) plot.petIds = plot.petId ? [plot.petId] : [];
  while (plot.petIds.length < n) plot.petIds.push(null);
  if (plot.petIds.length > n) plot.petIds.length = n;
  return plot.petIds;
}

// Per-slot leftover working time (<60 s) not yet converted to pet XP.
function carryArr(plot, n) {
  if (!Array.isArray(plot.xpCarryMs)) plot.xpCarryMs = [Number(plot.xpCarryMs) || 0];
  while (plot.xpCarryMs.length < n) plot.xpCarryMs.push(0);
  return plot.xpCarryMs;
}

function isReady(plot) {
  return !!plot.cropId && Number(plot.progress) >= 1 - READY_EPS;
}

// `stations` survive harvests and replanting (a pinned pet stays pinned to the plot), so callers pass the old ones.
function newPlot(index, stations = null) {
  return {
    index, cropId: null, plantedAt: 0, progress: 0, watered: false, petIds: [], lastGrowAt: 0, xpCarryMs: [],
    fertilized: false, helperBonus: 0, helperPetIds: [], lastCropId: null, workMs: {}, growElapsedMs: 0,
    stations: Array.isArray(stations) ? stations.slice(0, 3).concat([null, null, null]).slice(0, 3) : [null, null, null],
  };
}

function resetPlot(plot, index) {
  const last = plot.lastCropId || null;
  const fresh = newPlot(index, plot.stations);
  delete plot.petId; // pre-v3 field
  delete plot.helperPetId;
  Object.assign(plot, fresh, { lastCropId: last });
}

// Pets validly working this plot: [{ slot, pet }] (dangling ids / pets with another task are skipped).
function teamOf(state, plot, index) {
  const out = [];
  const ids = plot && Array.isArray(plot.petIds) ? plot.petIds : [];
  for (let slot = 0; slot < ids.length; slot++) {
    const pet = ids[slot] ? getPet(state, ids[slot]) : null;
    const t = pet && pet.task;
    if (t && t.type === 'plot' && t.plotIndex === index && (t.slot || 0) === slot) out.push({ slot, pet });
  }
  return out;
}

// Send the pet in one slot home (idle) and free the slot. Safe with dangling ids.
function releaseSlot(state, plot, index, slot) {
  const id = Array.isArray(plot.petIds) ? plot.petIds[slot] : null;
  const pet = id ? getPet(state, id) : null;
  if (pet && pet.task && pet.task.type === 'plot' && pet.task.plotIndex === index && (pet.task.slot || 0) === slot) {
    pet.status = 'idle';
    pet.task = null;
  }
  if (Array.isArray(plot.petIds) && slot < plot.petIds.length) plot.petIds[slot] = null;
  if (Array.isArray(plot.xpCarryMs)) plot.xpCarryMs[slot] = 0;
  return pet;
}

function releaseAll(state, plot, index) {
  const pets = [];
  const n = Array.isArray(plot.petIds) ? plot.petIds.length : 0;
  for (let slot = 0; slot < n; slot++) {
    const p = releaseSlot(state, plot, index, slot);
    if (p) pets.push(p);
  }
  plot.petIds = Array.isArray(plot.petIds) ? plot.petIds.map(() => null) : [];
  return pets;
}

// ---------------------------------------------------------------- stations (V6)
// A stationed pet is pinned to a plot slot: tickFarm sends it to work whenever the plot is growing and it
// can work, sends it home to rest when tired / hungry / sick (the station is kept) and brings it back by itself.

export const MAX_STATIONS = 3;
const TIRED_BELOW = 20;   // same thresholds as canWork()
const HUNGRY_BELOW = 15;

function stationsOf(plot) {
  if (!Array.isArray(plot.stations)) plot.stations = [];
  while (plot.stations.length < MAX_STATIONS) plot.stations.push(null);
  if (plot.stations.length > MAX_STATIONS) plot.stations.length = MAX_STATIONS;
  return plot.stations;
}

const isStationedAt = (pet, index, slot) => !!(pet && pet.station && pet.station.plotIndex === index && (pet.station.slot || 0) === slot);

/** Puts `pet` to work in `slot` (no stat bump: used by the automatic dispatch). */
function placePet(plot, index, crop, slot, pet) {
  ensureSlots(plot, crop);
  carryArr(plot, slotCount(crop))[slot] = 0;
  plot.petIds[slot] = pet.id;
  pet.status = 'working';
  pet.task = { type: 'plot', plotIndex: index, slot };
}

function clearStation(plot, slot, pet) {
  if (plot && Array.isArray(plot.stations) && slot < plot.stations.length) plot.stations[slot] = null;
  if (pet && pet.station) pet.station = null;
}

/** Pin `petId` to `slot` of plot `plotIndex` (persists across crops). */
export function stationPet(state, plotIndex, slot, petId) {
  const plot = getPlot(state, plotIndex);
  if (!plot) return fail('ไม่พบแปลงนี้');
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_STATIONS) return fail('ไม่มีช่องนี้ในแปลง');
  const crop = getCrop(plot.cropId);
  if (crop && slot >= slotCount(crop)) return fail('พืชนี้ไม่มีช่องที่ ' + (slot + 1));
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  if (pet.status === 'expedition') return fail('น้องออกสำรวจอยู่ ประจำแปลงไม่ได้');
  if (pet.station && !(pet.station.plotIndex === plotIndex && (pet.station.slot || 0) === slot)) {
    const other = getPlot(state, pet.station.plotIndex);
    if (other && stationsOf(other)[pet.station.slot || 0] === pet.id) {
      return fail(`${petEmoji(pet)} ${petName(pet)} ประจำแปลง #${pet.station.plotIndex + 1} อยู่แล้ว`);
    }
  }
  const st = stationsOf(plot);
  const holder = st[slot] ? getPet(state, st[slot]) : null;
  if (holder && holder.id !== pet.id) return fail('ช่องนี้มีน้องประจำอยู่แล้ว');
  st[slot] = pet.id;
  pet.station = { plotIndex, slot };
  return done(`📌 ${petEmoji(pet)} ${petName(pet)} ประจำแปลง #${plotIndex + 1} แล้ว จะกลับมาช่วยเองทุกรอบ`);
}

/** Remove the pin from a slot. A pet currently working that slot keeps working until the crop is ready. */
export function unstationPet(state, plotIndex, slot) {
  const plot = getPlot(state, plotIndex);
  if (!plot) return fail('ไม่พบแปลงนี้');
  const st = stationsOf(plot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_STATIONS || !st[slot]) return fail('ช่องนี้ไม่มีน้องประจำ');
  const pet = getPet(state, st[slot]);
  clearStation(plot, slot, pet);
  return done(pet ? `📌 เลิกให้ ${petEmoji(pet)} ${petName(pet)} ประจำแปลงแล้ว` : 'เลิกประจำแปลงแล้ว');
}

/** What the plot card shows for a slot: the stationed pet and why it is (not) working. */
export function stationInfo(state, plotIndex, slot) {
  const plot = getPlot(state, plotIndex);
  const id = plot && Array.isArray(plot.stations) ? plot.stations[slot] : null;
  const pet = id ? getPet(state, id) : null;
  if (!pet) return null;
  const crop = plot && getCrop(plot.cropId);
  let kind = 'wait', emoji = '🏡', text = 'รอที่ลาน';
  const working = pet.status === 'working' && pet.task && pet.task.type === 'plot' && pet.task.plotIndex === plotIndex && (pet.task.slot || 0) === slot;
  const growing = !!(crop && !isReady(plot) && slot < slotCount(crop));
  if (working) { kind = 'work'; emoji = '🛠️'; text = 'กำลังช่วย'; }
  else if (pet.status === 'expedition') { kind = 'away'; emoji = '🧭'; text = 'ออกสำรวจ'; }
  else if (pet.sick) { kind = 'sick'; emoji = '🤒'; text = 'ป่วย'; }
  else if (pet.status === 'sleeping' || (pet.stats && pet.stats.energy < TIRED_BELOW)) { kind = 'rest'; emoji = '💤'; text = 'พัก'; }
  else if (pet.stats && pet.stats.hunger < HUNGRY_BELOW) { kind = 'hungry'; emoji = '😋'; text = 'หิว'; }
  else if (growing) { kind = 'ready'; emoji = '⏳'; text = 'กำลังไป'; }
  return { pet, state: kind, emoji, text, working };
}

/** "ประจำแปลง #N" for a pet (yard sheet / pet card), or ''. */
export function stationLabel(pet) {
  return pet && pet.station ? `ประจำแปลง #${(Number(pet.station.plotIndex) || 0) + 1}` : '';
}

/** Re-syncs plot.stations <-> pet.station (state.js does the linking); pets away on an expedition lose their pin. */
function repairStations(state) {
  for (const pet of Array.isArray(state.pets) ? state.pets : []) {
    if (pet && pet.station && pet.status === 'expedition') {
      const plot = getPlot(state, pet.station.plotIndex);
      clearStation(plot, pet.station.slot || 0, pet);
    }
  }
  repairStationLinks(state);
}

/** Auto-dispatch: stationed idle pets that can work go to their growing plot; tired ones nap at home. */
function tickStations(state) {
  repairStations(state);
  state.plots.forEach((plot, index) => {
    if (!plot || !Array.isArray(plot.stations)) return;
    const crop = getCrop(plot.cropId);
    const growing = !!(crop && !isReady(plot));
    for (let slot = 0; slot < MAX_STATIONS; slot++) {
      const pet = plot.stations[slot] ? getPet(state, plot.stations[slot]) : null;
      if (!pet || pet.status === 'working' || pet.status === 'expedition') continue;
      if (growing && slot < slotCount(crop) && !(Array.isArray(plot.petIds) && plot.petIds[slot]) && canWork(pet).ok) {
        placePet(plot, index, crop, slot, pet);
      } else if (pet.status === 'idle' && !pet.sick && pet.stats && pet.stats.energy < TIRED_BELOW) {
        pet.status = 'sleeping';                              // tired: rest at home, wakes at 100 (pets.js)
        pet.task = null;
      }
    }
  });
}

// Sum of the pets' speed contributions (with the full-team combo) for a validated team.
function teamBoost(team, crop, ms) {
  const n = team.length;
  let sum = 0;
  for (const { slot, pet } of team) sum += PET_BOOST * slotPower(pet, crop, slot, n, ms);
  const full = slotCount(crop) >= 2 && n === slotCount(crop);
  return { boost: sum * (full ? TEAM_COMBO : 1), full };
}

// A helper must have worked this share of the grow time to earn harvest XP and bond.
export const HELPER_MIN_SHARE = 0.25;

// Per-helper yield bonus: floor(power/2) + harvester-type trait bonus, scaled by the share of the
// grow time that pet actually worked (rounded down per pet). shareOf(pet) -> 0..1.
function helperDetail(team, crop, ms, shareOf = () => 1) {
  return team.map(({ slot, pet }) => {
    const jobs = slotJobs(crop, slot);
    const te = traitEffect(pet, { kind: 'plot', jobs, teamSize: team.length, hour: hourOf(ms) });
    const trait = te && Number.isFinite(te.yieldBonus) ? Math.max(0, Math.floor(te.yieldBonus)) : 0;
    const base = Math.floor(slotPower(pet, crop, slot, team.length, ms) / 2) + trait;
    const raw = Number(shareOf(pet));
    const share = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    return { slot, pet, base, share, bonus: Math.floor(share * base + 1e-9) };
  });
}

// Share of the plot's grow time (so far) that `pet` has worked.
function workShare(plot, pet) {
  const total = Number(plot.growElapsedMs) || 0;
  const w = plot.workMs && Number(plot.workMs[pet.id]) || 0;
  return total > 0 ? w / total : 0;
}

// Yield bonus the current team would bring if the crop were harvested after finishing at the current
// speed (shares projected to the end). For the "น้องช่วย +N" preview on growing plots.
export function plotBonusPreview(state, plot) {
  const crop = plot && getCrop(plot.cropId);
  if (!crop || isReady(plot)) return 0;
  const team = teamOf(state, plot, plot.index);
  if (!team.length) return 0;
  const eta = plotEtaMs(state, plot);
  const total = Number(plot.growElapsedMs) || 0;
  const det = helperDetail(team, crop, now(), pet => {
    const w = plot.workMs && Number(plot.workMs[pet.id]) || 0;
    return total + eta > 0 ? (w + eta) / (total + eta) : 0;
  });
  return det.reduce((t, d) => t + d.bonus, 0);
}

// Current growth speed multiplier of a plot (used by the UI for ETA / badges).
export function plotSpeed(state, plot) {
  const crop = plot && getCrop(plot.cropId);
  if (!crop) return 1;
  const { boost } = teamBoost(teamOf(state, plot, plot.index), crop, now());
  return 1 + (plot.watered ? WATER_BOOST : 0) + boost;
}

// Everything the plot card needs: one entry per slot with its job, pet and that pet's power right now.
export function plotTeam(state, plot) {
  const crop = plot && getCrop(plot.cropId);
  if (!crop) return null;
  const ms = now();
  const team = teamOf(state, plot, plot.index);
  const { boost, full } = teamBoost(team, crop, ms);
  const slots = [];
  for (let slot = 0; slot < slotCount(crop); slot++) {
    const found = team.find(t => t.slot === slot);
    slots.push({
      slot,
      job: slotCount(crop) >= 2 ? crop.jobs[slot] : null,
      jobs: slotJobs(crop, slot),
      pet: found ? found.pet : null,
      power: found ? slotPower(found.pet, crop, slot, team.length, ms) : 0,
      station: stationInfo(state, plot.index, slot),
    });
  }
  return { crop, slots, full, boost, speed: 1 + (plot.watered ? WATER_BOOST : 0) + boost };
}

// Power a pet WOULD have if assigned to `slot` now (teamSize counts the pet itself). For pickers.
export function slotPowerPreview(state, plotIndex, slot, pet) {
  const plot = getPlot(state, plotIndex);
  const crop = plot && getCrop(plot.cropId);
  if (!crop || !pet) return { raw: 0, eff: 0, jobs: [] };
  const jobs = slotJobs(crop, slot);
  const team = teamOf(state, plot, plotIndex);
  const size = team.length + (team.some(t => t.pet.id === pet.id) ? 0 : 1);
  const raw = Number(getWorkPower(pet, jobs, { kind: 'plot', jobs, teamSize: size, hour: hourOf(now()) })) || 0;
  return { raw, eff: effectivePower(raw), jobs };
}

// Estimated ms until the plot is ready at its current speed (0 if ready/empty).
export function plotEtaMs(state, plot) {
  const crop = plot && getCrop(plot.cropId);
  if (!crop || isReady(plot)) return 0;
  const left = 1 - (Number(plot.progress) || 0);
  return Math.max(0, left * crop.growMs / plotSpeed(state, plot));
}

export function formatRewards(rewards) {
  const parts = [];
  for (const [id, n] of Object.entries(rewards || {})) {
    const it = getItem(id);
    if (it && n > 0) parts.push(`${it.emoji} ${it.nameTh} x${n}`);
  }
  return parts.join(', ') || 'ไม่มีอะไรเลย';
}

// ---------------------------------------------------------------- tick

export function tickFarm(state, nowMs) {
  if (!state || !Array.isArray(state.plots)) return;
  if (!Number.isFinite(nowMs)) nowMs = now();
  for (let i = 0; i < state.plots.length; i++) tickPlot(state, state.plots[i], i, nowMs);
  tickExpeditions(state, nowMs);
  repairPetTasks(state);
  tickStations(state);
  ensureOrders(state, todayKey());
}

function tickPlot(state, plot, index, nowMs) {
  if (!plot) return;
  plot.index = index;

  if (!plot.cropId) {
    if (Array.isArray(plot.petIds) && plot.petIds.some(Boolean)) releaseAll(state, plot, index);
    plot.petIds = [];
    return;
  }
  const crop = getCrop(plot.cropId);
  if (!crop) { // unknown crop id (bad save): clear the plot
    releaseAll(state, plot, index);
    resetPlot(plot, index);
    return;
  }
  const n = slotCount(crop);
  ensureSlots(plot, crop);
  const carry = carryArr(plot, n);

  if (!Number.isFinite(plot.progress)) plot.progress = 0;
  if (!Number.isFinite(plot.lastGrowAt) || plot.lastGrowAt <= 0) {
    plot.lastGrowAt = plot.progress === 0 && plot.plantedAt > 0 ? Math.min(plot.plantedAt, nowMs) : nowMs;
  }
  // Never credit more than the offline cap in one call (also bounds pet XP).
  if (plot.lastGrowAt < nowMs - MAX_GAP_MS) plot.lastGrowAt = nowMs - MAX_GAP_MS;
  if (plot.lastGrowAt > nowMs) return; // clock moved backwards: wait it out
  const dt = nowMs - plot.lastGrowAt;
  plot.lastGrowAt = nowMs;

  // Validate every slot; send a pet home if gone, replaced, sick or exhausted.
  for (let slot = 0; slot < n; slot++) {
    const id = plot.petIds[slot];
    if (!id) continue;
    const pet = getPet(state, id);
    const t = pet && pet.task;
    if (!t || t.type !== 'plot' || t.plotIndex !== index || (t.slot || 0) !== slot) {
      plot.petIds[slot] = null; // dangling id (pet released / task changed)
      carry[slot] = 0;
    } else if (isStationedAt(pet, index, slot) && (pet.sick || !pet.stats || pet.stats.energy < TIRED_BELOW || pet.stats.hunger < HUNGRY_BELOW)) {
      releaseSlot(state, plot, index, slot);   // 📌 goes home to rest; tickStations brings it back when it can work
    } else if (pet.sick || !pet.stats || !(pet.stats.energy > 0)) {
      notify(`${petEmoji(pet)} ${petName(pet)} ${pet.sick ? 'ป่วย' : 'หมดแรง'} เลยกลับลานแล้ว`, 'warn');
      releaseSlot(state, plot, index, slot);
    }
  }
  const team = teamOf(state, plot, index);

  if (plot.progress < 1 - READY_EPS) {
    // Pet help only counts for a bounded slice of dt (energy is unknown over long gaps).
    const petDt = team.length ? Math.min(dt, PET_STEP_CAP_MS) : 0;
    const petPart = team.length ? teamBoost(team, crop, nowMs).boost : 0;
    const gain = (dt * (1 + (plot.watered ? WATER_BOOST : 0)) + petDt * petPart) / crop.growMs;
    const need = 1 - plot.progress;
    plot.progress = Math.min(1, plot.progress + gain);

    // Only the time before the crop finished counts (for pet XP and for the helpers' work share).
    const frac = gain > need ? need / gain : 1;
    plot.growElapsedMs = (Number(plot.growElapsedMs) || 0) + dt * frac;
    if (petDt > 0) {
      const worked = petDt * frac;
      if (!plot.workMs || typeof plot.workMs !== 'object') plot.workMs = {};
      for (const { slot, pet } of team) {
        plot.workMs[pet.id] = (Number(plot.workMs[pet.id]) || 0) + worked;
        carry[slot] = (Number(carry[slot]) || 0) + worked;
        const mins = Math.floor(carry[slot] / MIN);
        if (mins > 0) {
          carry[slot] -= mins * MIN;
          addPetXp(state, pet.id, mins);
        }
      }
    }
    if (plot.progress < 1 - READY_EPS) return;
    plot.progress = 1;
    if (!team.length) notify(`${crop.emoji} ${crop.nameTh} พร้อมเก็บเกี่ยวแล้ว!`, 'success');
  } else {
    plot.progress = 1;
  }

  // Ready: snapshot the team's bonus onto the plot and send every helper home to rest.
  if (team.length) {
    const det = helperDetail(team, crop, nowMs, pet => workShare(plot, pet));
    plot.helperBonus = det.reduce((t, d) => t + d.bonus, 0);
    plot.helperPetIds = det.filter(d => d.share >= HELPER_MIN_SHARE).map(d => d.pet.id);
    const names = team.map(t => petName(t.pet)).join(', ');
    notify(`🌱 ${crop.nameTh} พร้อมเก็บแล้ว น้อง ${names} กลับลานพักผ่อน`, 'success');
    releaseAll(state, plot, index);
  }
}

// Expedition loot. Pet power and traits come in through getWorkPower / traitEffect (ctx kind 'expedition').
function rollLoot(zone, pet, ms) {
  const ctx = { kind: 'expedition', jobs: [zone.job], zoneId: zone.id, hour: hourOf(ms) };
  const power = pet ? effectivePower(getWorkPower(pet, [zone.job], ctx)) : 0.5;
  const te = pet ? traitEffect(pet, ctx) : null;
  const extra = te && Number.isFinite(te.extraRolls) ? Math.max(0, Math.floor(te.extraRolls)) : 0;
  const eggMult = te && te.eggChanceMult > 0 ? te.eggChanceMult : 1;
  const rolls = zone.baseRolls + Math.floor(power * 0.75 + Math.random()) + extra;
  const out = {};
  for (let i = 0; i < rolls; i++) {
    const entry = pickWeighted(zone.loot, l => l.weight);
    if (!entry) continue;
    out[entry.itemId] = (out[entry.itemId] || 0) + randInt(entry.min, entry.max);
  }
  // Rare egg drop (3-7% per expedition, slightly better with a stronger pet; lucky pets double it).
  const chance = (zone.eggChance + 0.005 * Math.min(power, 4)) * eggMult;
  if (zone.eggs && zone.eggs.length && Math.random() < chance) {
    const egg = zone.eggs[Math.floor(Math.random() * zone.eggs.length)];
    out[egg] = (out[egg] || 0) + 1;
  }
  return out;
}

function tickExpeditions(state, nowMs) {
  if (!Array.isArray(state.expeditions)) return;
  for (const ex of state.expeditions) {
    if (!ex || ex.done || !(nowMs >= ex.endAt)) continue;
    const zone = getZone(ex.zoneId);
    const pet = getPet(state, ex.petId);
    ex.rewards = zone ? rollLoot(zone, pet, Number.isFinite(ex.startAt) ? ex.startAt : nowMs) : {};
    ex.done = true;
    if (pet && pet.task && pet.task.type === 'expedition' && pet.task.expeditionId === ex.id) {
      pet.status = 'idle';
      pet.task = null;
    }
    const who = pet ? `${petEmoji(pet)} ${petName(pet)}` : 'น้อง';
    const where = zone ? `${zone.emoji} ${zone.nameTh}` : 'การสำรวจ';
    notify(`${who} กลับจาก${where}แล้ว! ไปรับของที่แท็บสำรวจ`, 'success');
    addLog(state, `${who} สำรวจ${where}เสร็จแล้ว`);
  }
}

// Clear pets whose task points to a plot slot / expedition that no longer holds them.
function repairPetTasks(state) {
  if (!Array.isArray(state.pets)) return;
  for (const pet of state.pets) {
    if (!pet) continue;
    if (pet.status === 'working') {
      const t = pet.task;
      const plot = t && t.type === 'plot' ? getPlot(state, t.plotIndex) : null;
      const holds = plot && Array.isArray(plot.petIds) && plot.petIds[t.slot || 0] === pet.id;
      if (!holds) { pet.status = 'idle'; pet.task = null; }
    } else if (pet.status === 'expedition') {
      const t = pet.task;
      const ex = t && t.type === 'expedition' && Array.isArray(state.expeditions)
        ? state.expeditions.find(e => e && e.id === t.expeditionId && !e.done) : null;
      if (!ex) { pet.status = 'idle'; pet.task = null; }
    }
  }
}

// ---------------------------------------------------------------- plots

export function plantSeed(state, plotIndex, cropId) {
  const plot = getPlot(state, plotIndex);
  if (!plot) return fail('ไม่พบแปลงนี้');
  if (plot.cropId) return fail('แปลงนี้มีพืชอยู่แล้ว');
  const crop = getCrop(cropId);
  if (!crop) return fail('ไม่รู้จักพืชชนิดนี้');
  if (state.player.level < crop.unlockLevel) return fail(`ปลูก${crop.nameTh}ได้ที่เลเวล ${crop.unlockLevel}`);
  if (!removeItem(state, 'seed_' + crop.id, 1)) return fail(`ไม่มีเมล็ด${crop.nameTh} ซื้อได้ที่ร้านค้า`);
  const t = now();
  Object.assign(plot, newPlot(plotIndex, plot.stations), { cropId: crop.id, plantedAt: t, lastGrowAt: t, lastCropId: crop.id, petIds: Array(slotCount(crop)).fill(null), xpCarryMs: Array(slotCount(crop)).fill(0) });
  delete plot.petId;
  bumpStat(state, 'planted');
  return done(`ปลูก ${crop.emoji} ${crop.nameTh} แล้ว`);
}

export function waterPlot(state, plotIndex) {
  const plot = getPlot(state, plotIndex);
  if (!plot || !plot.cropId) return fail('แปลงนี้ยังไม่ได้ปลูกอะไร');
  if (isReady(plot)) return fail('พืชโตเต็มที่แล้ว เก็บเกี่ยวได้เลย');
  if (plot.watered) return fail('แปลงนี้รดน้ำแล้ว');
  plot.watered = true;
  return done('💧 รดน้ำแล้ว พืชโตไวขึ้น 20%');
}

export function fertilize(state, plotIndex) {
  const plot = getPlot(state, plotIndex);
  if (!plot || !plot.cropId) return fail('แปลงนี้ยังไม่ได้ปลูกอะไร');
  if (isReady(plot)) return fail('พืชโตเต็มที่แล้ว ไม่ต้องใส่ปุ๋ย');
  if (plot.fertilized) return fail('แปลงนี้ใส่ปุ๋ยไปแล้ว (ใส่ได้ครั้งเดียวต่อการปลูก)');
  const cur = Number(plot.progress) || 0;
  if (cur >= FERTILIZER_CAP) return fail('พืชใกล้โตเต็มที่แล้ว ปุ๋ยไม่ช่วยอะไร');
  if (countItem(state, 'care_fertilizer') < 1) return fail('ไม่มีปุ๋ย ซื้อได้ที่ร้านค้า');
  removeItem(state, 'care_fertilizer', 1);
  plot.fertilized = true;
  plot.progress = Math.min(cur + FERTILIZER_BOOST, FERTILIZER_CAP);
  return done('🧪 ใส่ปุ๋ยแล้ว พืชโตขึ้นอีกนิด');
}

// Put a pet in a slot of a growing plot. `slot` omitted/null = the first free slot.
export function assignPet(state, plotIndex, petId, slot = null) {
  const plot = getPlot(state, plotIndex);
  if (!plot || !plot.cropId) return fail('ต้องปลูกพืชก่อนถึงจะส่งน้องมาช่วยได้');
  const crop = getCrop(plot.cropId);
  if (!crop) return fail('ไม่รู้จักพืชชนิดนี้');
  if (isReady(plot)) return fail('พืชโตเต็มที่แล้ว เก็บเกี่ยวได้เลย');
  plot.index = plotIndex;
  ensureSlots(plot, crop);
  const taken = new Set(teamOf(state, plot, plotIndex).map(t => t.slot));
  let s = slot;
  if (s == null) {
    s = -1;
    for (let i = 0; i < slotCount(crop); i++) if (!taken.has(i)) { s = i; break; }
    if (s < 0) return fail('แปลงนี้มีน้องประจำครบทุกช่องแล้ว');
  } else if (!Number.isInteger(s) || s < 0 || s >= slotCount(crop)) {
    return fail('ไม่มีช่องนี้ในแปลง');
  } else if (taken.has(s)) {
    return fail('ช่องนี้มีน้องประจำอยู่แล้ว');
  }
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  const can = canWork(pet);
  if (!can.ok) return fail(can.reason || 'น้องยังทำงานไม่ได้');
  const carry = carryArr(plot, slotCount(crop));
  plot.petIds[s] = pet.id;
  carry[s] = 0;
  pet.status = 'working';
  pet.task = { type: 'plot', plotIndex, slot: s };
  bumpStat(state, 'helped');
  const team = teamOf(state, plot, plotIndex);
  const { full } = teamBoost(team, crop, now());
  const boost = Math.round(PET_BOOST * slotPower(pet, crop, s, team.length, now()) * (full ? TEAM_COMBO : 1) * 100);
  return done(`${petEmoji(pet)} ${petName(pet)} มาช่วยดูแล${crop.nameTh} โตไวขึ้น +${boost}%${full ? ' 🤝 คอมโบ!' : ''}`);
}

// Send the pet in `slot` home; slot omitted/null = every pet on the plot.
export function unassignPet(state, plotIndex, slot = null) {
  const plot = getPlot(state, plotIndex);
  if (!plot) return fail('ไม่พบแปลงนี้');
  const ids = Array.isArray(plot.petIds) ? plot.petIds : [];
  if (!ids.some(Boolean)) return fail('แปลงนี้ไม่มีน้องประจำอยู่');
  if (slot == null) {
    const pets = releaseAll(state, plot, plotIndex);
    for (const p of pets) if (p.station && p.station.plotIndex === plotIndex) clearStation(plot, p.station.slot || 0, p); // recalling = no longer pinned
    return done(pets.length ? `${pets.map(p => `${petEmoji(p)} ${petName(p)}`).join(', ')} กลับลานแล้ว` : 'เรียกน้องกลับแล้ว');
  }
  if (!Number.isInteger(slot) || slot < 0 || slot >= ids.length || !ids[slot]) return fail('ช่องนี้ไม่มีน้องประจำอยู่');
  const pet = releaseSlot(state, plot, plotIndex, slot);
  if (pet && isStationedAt(pet, plotIndex, slot)) clearStation(plot, slot, pet);  // ✕ on a 📌 chip = remove the pin too
  return done(pet ? `${petEmoji(pet)} ${petName(pet)} กลับลานแล้ว` : 'เรียกน้องกลับแล้ว');
}

export function harvestPlot(state, plotIndex) {
  const plot = getPlot(state, plotIndex);
  if (!plot || !plot.cropId) return fail('แปลงนี้ยังไม่ได้ปลูกอะไร');
  const crop = getCrop(plot.cropId);
  if (!crop) return fail('ไม่รู้จักพืชชนิดนี้');
  if (!isReady(plot)) return fail('พืชยังโตไม่เต็มที่');

  // The team's bonus was snapshotted when the crop became ready (the pets may already be elsewhere).
  const live = teamOf(state, plot, plotIndex); // legacy: pets still assigned on a ready plot
  const snap = Math.floor(Number(plot.helperBonus));
  const bonus = Number.isFinite(snap) && snap > 0 ? snap
    : (live.length ? helperDetail(live, crop, now()).reduce((t, d) => t + d.bonus, 0) : 0);
  const ids = new Set(Array.isArray(plot.helperPetIds) ? plot.helperPetIds : []);
  for (const t of live) ids.add(t.pet.id);
  const amount = randInt(crop.yield[0], crop.yield[1]) + bonus;
  addItem(state, 'crop_' + crop.id, amount);
  addPlayerXp(state, crop.xp);
  bumpStat(state, 'harvested');
  for (const id of ids) {
    if (!getPet(state, id)) continue;
    addPetXp(state, id, Math.max(2, Math.ceil(crop.xp / 2)));
    addBond(state, id, 1);
  }
  releaseAll(state, plot, plotIndex);
  resetPlot(plot, plotIndex);
  const extra = bonus > 0 ? ` (น้องช่วย +${bonus})` : '';
  return done(`เก็บเกี่ยว ${crop.emoji} ${crop.nameTh} x${amount}${extra} +${crop.xp} XP`);
}

// One-tap replant: uses the last crop planted on this plot, buying a seed when none is left.
export function replantPlot(state, plotIndex) {
  const plot = getPlot(state, plotIndex);
  if (!plot) return fail('ไม่พบแปลงนี้');
  if (plot.cropId) return fail('แปลงนี้มีพืชอยู่แล้ว');
  const crop = getCrop(plot.lastCropId);
  if (!crop) return fail('แปลงนี้ยังไม่เคยปลูกอะไร');
  let note = '';
  if (countItem(state, 'seed_' + crop.id) < 1) {
    const bought = buyItem(state, 'seed_' + crop.id, 1);
    if (!bought.ok) return fail(bought.reason);
    note = ` (ซื้อเมล็ด -${crop.seedPrice} 🪙)`;
  }
  const r = plantSeed(state, plotIndex, crop.id);
  return r.ok ? done(r.msg + note) : r;
}

// Harvest every ready plot; with replant=true each emptied plot is planted again.
export function harvestAll(state, replant = false) {
  let n = 0;
  let again = 0;
  (state.plots || []).forEach((p, i) => {
    if (!p || !p.cropId || !harvestPlot(state, i).ok) return;
    n++;
    if (replant && replantPlot(state, i).ok) again++;
  });
  if (!n) return fail('ยังไม่มีแปลงที่พร้อมเก็บเกี่ยว');
  return done(`🧺 เก็บเกี่ยวแล้ว ${n} แปลง${again ? ` · ปลูกซ้ำ ${again} แปลง 🔁` : ''}`);
}

// ---------------------------------------------------------------- orders
// Daily (3) + weekly (1) orders. Generated from a seeded RNG (day/week key + level), so the same
// day always yields the same board and reloads never reroll. Stored in state.orders.

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function seededRng(seedStr) { // mulberry32
  let a = hashStr(seedStr);
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ISO week key 'YYYY-Www' for a local 'YYYY-MM-DD' day key.
export function isoWeekKey(dayKey) {
  const m = DAY_RE.exec(dayKey || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // Thursday of this ISO week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Ms timestamp of the next local midnight after `ms` (for the "resets in" countdown).
export function nextMidnight(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

// Target sell value of one daily order = ORDER_BASE + ORDER_PER_LEVEL * level (weekly: x3.5).
const ORDER_BASE = 110;
const ORDER_PER_LEVEL = 30;
// Order sizing assumptions (see orderLineCap): an average pet (power 2), the 4 starting plots,
// and a player who checks in about every 3 hours.
export const ORDER_AVG_POWER = 2;
export const ORDER_MIN_DROPS = 0.5;   // forage dropping less than this per trip is never ordered
export const ORDER_DAILY_TRIPS = 3;   // a daily forage line needs at most ~3 trips
export const ORDER_WEEKLY_TRIPS = 8;
export const ORDER_PLOTS = 4;
const ORDER_CHECKIN_MS = 3 * 60 * MIN;
const ORDER_CROP_SHARE = 0.5;         // one line may use at most half of what the plots produce

// Expected drops per trip of each forage item (best unlocked zone for it, average pet).
export function forageDropsPerTrip(level) {
  const best = {};
  for (const z of ZONES) {
    if (z.unlockLevel > level) continue;
    const tw = z.loot.reduce((t, l) => t + l.weight, 0);
    const rolls = z.baseRolls + 0.75 * effectivePower(ORDER_AVG_POWER);
    for (const l of z.loot) {
      const per = (rolls * l.weight / tw) * ((l.min + l.max) / 2);
      if (per > (best[l.itemId] || 0)) best[l.itemId] = per;
    }
  }
  return best;
}

// How many crops a player's plots make in one day / three days if they check in every ~3 h.
export function cropProducedPerDay(crop) {
  const cycle = Math.ceil(crop.growMs / ORDER_CHECKIN_MS) * ORDER_CHECKIN_MS;
  return ORDER_PLOTS * Math.floor(24 * 60 * MIN / cycle) * ((crop.yield[0] + crop.yield[1]) / 2);
}

// Max quantity one order line may ask for (0 = item may not be ordered at this level).
export function orderLineCap(itemId, level, weekly) {
  if (itemId.startsWith('crop_')) {
    const crop = getCrop(itemId.slice(5));
    if (!crop || crop.unlockLevel > level) return 0;
    const made = cropProducedPerDay(crop) * (weekly ? 3 : 1) * ORDER_CROP_SHARE;
    return Math.max(1, Math.min(crop.growMs >= 60 * MIN ? 6 : 12, Math.floor(made)));
  }
  const per = forageDropsPerTrip(level)[itemId] || 0;
  if (per < ORDER_MIN_DROPS) return 0;
  return Math.max(1, Math.floor(per * (weekly ? ORDER_WEEKLY_TRIPS : ORDER_DAILY_TRIPS)));
}

function orderPool(level) {
  const crops = CROPS.filter(c => c.unlockLevel <= level).slice(-6); // recent unlocks stay relevant
  const drops = forageDropsPerTrip(level);
  const forage = Object.keys(drops).filter(id => drops[id] >= ORDER_MIN_DROPS);
  return { crops: crops.map(c => 'crop_' + c.id), forage };
}

const sellOf = id => { const it = getItem(id); return it && it.sell ? it.sell : 0; };

// Total sell value of an order's requested items.
export function orderValue(order) {
  let v = 0;
  for (const [id, n] of Object.entries((order && order.items) || {})) v += sellOf(id) * n;
  return v;
}

function pickLine(rng, pool, used, target, level, weekly) {
  const list = pool.filter(id => !used.has(id));
  const src = list.length ? list : pool;
  const id = src[Math.floor(rng() * src.length)];
  used.add(id);
  const sell = Math.max(1, sellOf(id));
  const cap = Math.max(1, orderLineCap(id, level, weekly));
  return [id, Math.min(cap, Math.max(1, Math.round(target / sell)))];
}

function buildOrder(id, lines, mult, xpBase, xpDiv, extraItems) {
  const items = {};
  for (const [itemId, n] of lines) items[itemId] = (items[itemId] || 0) + n;
  const order = { id, items, reward: { coins: 0, xp: 0 }, done: false };
  const value = orderValue(order);
  order.reward.coins = Math.max(Math.ceil(value * 1.6), Math.round(value * mult));
  order.reward.xp = xpBase + Math.round(value / xpDiv);
  if (extraItems) order.reward.items = extraItems;
  return order;
}

export function generateDailyOrders(level, dayKey) {
  const rng = seededRng(`day|${dayKey}|${level}`);
  const pool = orderPool(level);
  const base = ORDER_BASE + ORDER_PER_LEVEL * level;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const total = base * (0.85 + 0.3 * rng());
    const used = new Set();
    const kinds = i === 0 ? ['c'] : i === 1 ? ['c', 'c'] : [pool.forage.length ? 'f' : 'c', 'c'];
    const lines = kinds.map(k => pickLine(rng, k === 'f' ? pool.forage : pool.crops, used, total / kinds.length, level, false));
    out.push(buildOrder(`${dayKey}-${i + 1}`, lines, 1.6 + 0.4 * rng(), 4, 10));
  }
  return out;
}

export function generateWeeklyOrder(level, weekKey) {
  const rng = seededRng(`week|${weekKey}|${level}`);
  const pool = orderPool(level);
  const total = (ORDER_BASE + ORDER_PER_LEVEL * level) * 3.5;
  const used = new Set();
  const lines = [
    pickLine(rng, pool.crops, used, total / 3, level, true),
    pickLine(rng, pool.crops, used, total / 3, level, true),
    pickLine(rng, pool.forage.length ? pool.forage : pool.crops, used, total / 3, level, true),
  ];
  // Special egg: mystic once unlocked, otherwise the best egg the player can already buy.
  let egg = level >= 10 ? EGGS.find(e => e.id === 'egg_mystic') : null;
  if (!egg) {
    const open = EGGS.filter(e => (e.unlockLevel || 1) <= level);
    egg = open.reduce((best, e) => (!best || e.price > best.price ? e : best), null) || EGGS[0];
  }
  return buildOrder(`${weekKey}-w`, lines, 3, 20, 12, egg ? { [egg.id]: 1 } : undefined);
}

// Makes sure state.orders matches dayKey ('YYYY-MM-DD'); regenerates the daily/weekly boards on change.
export function ensureOrders(state, dayKey) {
  if (!state || !DAY_RE.test(dayKey || '')) return null;
  const o = state.orders;
  if (!o || typeof o !== 'object' || Array.isArray(o)) state.orders = { day: null, list: [], week: null, weekly: null };
  const ord = state.orders;
  if (!Array.isArray(ord.list)) ord.list = [];
  const level = Math.max(1, Number(state.player && state.player.level) || 1);
  if (ord.day !== dayKey) {
    ord.day = dayKey;
    ord.list = generateDailyOrders(level, dayKey);
  }
  const wk = isoWeekKey(dayKey);
  if (ord.week !== wk || !ord.weekly) {
    ord.week = wk;
    ord.weekly = generateWeeklyOrder(level, wk);
  }
  return ord;
}

function findOrder(state, orderId) {
  const o = state.orders;
  if (!o) return null;
  return (Array.isArray(o.list) ? o.list : []).find(x => x && x.id === orderId)
    || (o.weekly && o.weekly.id === orderId ? o.weekly : null);
}

export function completeOrder(state, orderId) {
  const order = findOrder(state, orderId);
  if (!order) return fail('ไม่พบออเดอร์นี้');
  if (order.done) return fail('ส่งออเดอร์นี้ไปแล้ว');
  for (const [id, n] of Object.entries(order.items || {})) {
    if (countItem(state, id) < n) {
      const it = getItem(id);
      return fail(`ของยังไม่ครบ: ${it ? it.nameTh : id} ต้องการ ${n}`);
    }
  }
  for (const [id, n] of Object.entries(order.items || {})) removeItem(state, id, n);
  const r = order.reward || {};
  if (r.coins > 0) addCoins(state, r.coins);
  if (r.xp > 0) addPlayerXp(state, r.xp);
  const gifts = [];
  for (const [id, n] of Object.entries(r.items || {})) {
    const it = getItem(id);
    if (it && n > 0) { addItem(state, id, n); gifts.push(`${it.emoji} ${it.nameTh} x${n}`); }
  }
  order.done = true;
  bumpStat(state, 'ordersDone');
  return done(`📋 ส่งออเดอร์สำเร็จ! +${r.coins || 0} 🪙 +${r.xp || 0} XP${gifts.length ? ' · ' + gifts.join(', ') : ''}`);
}

// ---------------------------------------------------------------- expeditions

export function startExpedition(state, petId, zoneId) {
  const zone = getZone(zoneId);
  if (!zone) return fail('ไม่พบโซนสำรวจ');
  if (state.player.level < zone.unlockLevel) return fail(`${zone.nameTh}ปลดล็อกที่เลเวล ${zone.unlockLevel}`);
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  if (!(pet.stage >= 1)) return fail('น้องยังเป็นเบบี้ ต้องโตเป็นเด็กก่อนถึงจะออกสำรวจได้');
  const can = canWork(pet);
  if (!can.ok) return fail(can.reason || 'น้องยังไปสำรวจไม่ได้');
  if (!Array.isArray(state.expeditions)) state.expeditions = [];
  const t = now();
  const ex = { id: uid(), petId: pet.id, zoneId: zone.id, startAt: t, endAt: t + zone.durationMs, done: false, rewards: null };
  state.expeditions.push(ex);
  if (pet.station) clearStation(getPlot(state, pet.station.plotIndex), pet.station.slot || 0, pet); // leaving on a trip drops the pin
  pet.status = 'expedition';
  pet.task = { type: 'expedition', expeditionId: ex.id };
  bumpStat(state, 'expeditionsStarted');
  return done(`${petEmoji(pet)} ${petName(pet)} ออกสำรวจ${zone.emoji} ${zone.nameTh} กลับใน ${formatDuration(zone.durationMs)}`);
}

export function claimExpedition(state, expeditionId) {
  if (!Array.isArray(state.expeditions)) return fail('ไม่พบการสำรวจนี้');
  const idx = state.expeditions.findIndex(e => e && e.id === expeditionId);
  if (idx < 0) return fail('ไม่พบการสำรวจนี้');
  const ex = state.expeditions[idx];
  if (!ex.done) return fail('ยังสำรวจไม่เสร็จ');
  const zone = getZone(ex.zoneId);
  const rewards = ex.rewards || {};
  for (const [id, n] of Object.entries(rewards)) {
    if (getItem(id) && n > 0) addItem(state, id, n);
  }
  if (zone) addPlayerXp(state, zone.xp);
  if (zone && getPet(state, ex.petId)) addPetXp(state, ex.petId, zone.petXp);
  state.expeditions.splice(idx, 1);
  bumpStat(state, 'expeditionsClaimed');
  return done(`รับของจากการสำรวจ: ${formatRewards(rewards)}${zone ? ` (+${zone.xp} XP)` : ''}`);
}

// ---------------------------------------------------------------- shop

function cleanQty(qty) {
  const n = Math.floor(Number(qty));
  return Number.isFinite(n) && n >= 1 && n <= 9999 ? n : 0;
}

export function buyItem(state, itemId, qty = 1) {
  const n = cleanQty(qty);
  if (!n) return fail('จำนวนไม่ถูกต้อง');
  const item = getItem(itemId);
  if (!item || item.buy == null) return fail('สินค้านี้ไม่มีขายในร้าน');
  if (state.player.level < item.unlockLevel) return fail(`${item.nameTh}ปลดล็อกที่เลเวล ${item.unlockLevel}`);
  const cost = item.buy * n;
  if (!spendCoins(state, cost)) return fail(`เหรียญไม่พอ (ต้องใช้ ${cost} 🪙)`);
  addItem(state, itemId, n);
  bumpStat(state, 'bought', n);
  return done(`ซื้อ ${item.emoji} ${item.nameTh} x${n} (-${cost} 🪙)`);
}

export function sellItem(state, itemId, qty = 1) {
  const n = cleanQty(qty);
  if (!n) return fail('จำนวนไม่ถูกต้อง');
  const item = getItem(itemId);
  if (!item) return fail('ไม่รู้จักไอเทมนี้');
  if (item.sell == null) return fail(`${item.nameTh}ขายไม่ได้`);
  if (countItem(state, itemId) < n) return fail(`มี ${item.nameTh} ไม่พอ`);
  if (!removeItem(state, itemId, n)) return fail(`มี ${item.nameTh} ไม่พอ`);
  const gain = item.sell * n;
  addCoins(state, gain);
  bumpStat(state, 'sold', n);
  return done(`ขาย ${item.emoji} ${item.nameTh} x${n} ได้ ${gain} 🪙`);
}

// ---------------------------------------------------------------- upgrades

// Price curves grow geometrically (cheap early, steep late) so the late game is not a coin flood.
const PLOT_BASE = 250;
const PLOT_GROWTH = 1.8;
const BARN_BASE = 300;
const BARN_GROWTH = 1.4;
const tidy = x => (x < 1000 ? Math.round(x / 5) * 5 : Math.round(x / 50) * 50);

// Cost of the next plot, or null when MAX_PLOTS reached.
export function plotPrice(state) {
  const have = Array.isArray(state.plots) ? state.plots.length : START_PLOTS;
  if (have >= MAX_PLOTS) return null;
  const k = Math.max(0, have - START_PLOTS);
  return tidy(PLOT_BASE * PLOT_GROWTH ** k);
}

export function buyPlot(state) {
  const price = plotPrice(state);
  if (price == null) return fail(`มีแปลงครบ ${MAX_PLOTS} แปลงแล้ว`);
  if (!spendCoins(state, price)) return fail(`เหรียญไม่พอ (ต้องใช้ ${price} 🪙)`);
  state.plots.push(newPlot(state.plots.length));
  return done(`ซื้อแปลงใหม่แล้ว! ตอนนี้มี ${state.plots.length} แปลง (-${price} 🪙)`);
}

// Cost of the next barn slot, or null when MAX_BARN reached.
export function barnUpgradePrice(state) {
  const have = Number(state.barnCapacity) || START_BARN;
  if (have >= MAX_BARN) return null;
  const k = Math.max(0, have - START_BARN);
  return tidy(BARN_BASE * BARN_GROWTH ** k);
}

// Yard tiers (V6 §4): what the next upgrade adds, for the shop preview.
export const YARD_TIERS = [
  { id: 'S', nameTh: 'ทุ่งหญ้าเล็ก', from: 3, to: 5, adds: 'ทุ่งหญ้าเล็กๆ ล้อมรั้ว' },
  { id: 'M', nameTh: 'ลานบ่อน้ำ', from: 6, to: 9, adds: '💧 บ่อน้ำ + 🌳 ต้นไม้ใหญ่' },
  { id: 'L', nameTh: 'ลานสวน', from: 10, to: 14, adds: '🌷 แปลงดอกไม้ + 🛝 สนามเด็กเล่นเล็กๆ' },
  { id: 'XL', nameTh: 'ลานเนินเขา', from: 15, to: 20, adds: '⛰️ เนินเขามีศาลา + 🏮 โคมไฟที่ส่องสว่างตอนกลางคืน' },
];
export const yardTierOf = cap => YARD_TIERS.find(t => cap >= t.from && cap <= t.to) || YARD_TIERS[YARD_TIERS.length - 1];

/** One-line preview for the shop card: what the next slot / the next tier gives. */
export function yardUpgradePreview(state) {
  const cap = Number(state.barnCapacity) || START_BARN;
  if (cap >= MAX_BARN) return 'ลานใหญ่สุดแล้ว';
  const cur = yardTierOf(cap);
  const next = yardTierOf(cap + 1);
  if (next.id !== cur.id) return `ขยายแล้วลานเลื่อนเป็น "${next.nameTh}" ได้ ${next.adds} · ลานกว้างขึ้น`;
  const left = cur.to - cap;
  const after = YARD_TIERS[YARD_TIERS.indexOf(cur) + 1];
  return `เพิ่มช่องเลี้ยงอีก 1${after ? ` · อีก ${left} ช่องลานจะเป็น "${after.nameTh}": ${after.adds}` : ''}`;
}

export function upgradeBarn(state) {
  const price = barnUpgradePrice(state);
  if (price == null) return fail(`ลานใหญ่สุดแล้ว (${MAX_BARN} ช่อง)`);
  if (!spendCoins(state, price)) return fail(`เหรียญไม่พอ (ต้องใช้ ${price} 🪙)`);
  state.barnCapacity = (Number(state.barnCapacity) || START_BARN) + 1;
  return done(`ขยายลานแล้ว! จุได้ ${state.barnCapacity} ตัว (-${price} 🪙)`);
}

// Incubator slots: 1 -> 3. Price is null when maxed.
export const MAX_INCUBATOR = 3;
const INCUBATOR_PRICES = [1000, 3500]; // price of the 2nd and 3rd slot

export function incubatorUpgradePrice(state) {
  const have = Number(state.incubatorCapacity) || 1;
  if (have >= MAX_INCUBATOR) return null;
  return INCUBATOR_PRICES[Math.max(0, have - 1)];
}

export function upgradeIncubator(state) {
  const price = incubatorUpgradePrice(state);
  if (price == null) return fail(`ตู้ฟักมีครบ ${MAX_INCUBATOR} ช่องแล้ว`);
  if (!spendCoins(state, price)) return fail(`เหรียญไม่พอ (ต้องใช้ ${price} 🪙)`);
  state.incubatorCapacity = (Number(state.incubatorCapacity) || 1) + 1;
  return done(`ขยายตู้ฟักแล้ว! ฟักได้พร้อมกัน ${state.incubatorCapacity} ฟอง (-${price} 🪙)`);
}

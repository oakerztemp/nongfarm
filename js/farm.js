// Farm logic: plots, working pets, expeditions, shop actions, upgrades.
// DOM-free. Every action takes the state object, mutates it, and returns { ok, msg } or { ok:false, reason }.
// Extra (optional) plot fields, initialised lazily when missing:
//   plot.lastGrowAt  - ms timestamp growth was last applied (missing => plantedAt)
//   plot.xpCarryMs   - leftover working time (<60s) not yet converted to pet XP
//   plot.fertilized  - true once fertilizer was used for this planting (max one per crop)
//   plot.helperBonus / plot.helperPetId - yield bonus + pet snapshotted when the crop became ready
//   plot.lastCropId  - crop last planted here (kept after harvest) for the one-tap replant button
import { now, randInt, pickWeighted, uid, addLog, notify, formatDuration, todayKey } from './util.js';
import { addItem, removeItem, countItem, addCoins, spendCoins, addPlayerXp, bumpStat } from './state.js';
import { canWork, getWorkPower, addPetXp, getPet, petEmoji, petName } from './pets.js';
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

// Effective (diminished) work power of a pet for the given jobs; 0 for a missing pet.
function safePower(pet, jobs) {
  if (!pet) return 0;
  return effectivePower(getWorkPower(pet, jobs));
}

function isReady(plot) {
  return !!plot.cropId && Number(plot.progress) >= 1 - READY_EPS;
}

function newPlot(index) {
  return { index, cropId: null, plantedAt: 0, progress: 0, watered: false, petId: null, lastGrowAt: 0, xpCarryMs: 0, fertilized: false, helperBonus: 0, helperPetId: null, lastCropId: null };
}

function resetPlot(plot, index) {
  const last = plot.lastCropId || null;
  Object.assign(plot, newPlot(index), { lastCropId: last });
}

// The pet currently working this plot (validated), or null for empty/dangling assignments.
function plotPet(state, plot, index) {
  if (!plot || !plot.petId) return null;
  const pet = getPet(state, plot.petId);
  if (!pet || !pet.task || pet.task.type !== 'plot' || pet.task.plotIndex !== index) return null;
  return pet;
}

// Send the plot's pet home (idle) and clear the assignment. Safe with dangling ids.
function releasePlotPet(state, plot, index) {
  const pet = plot.petId ? getPet(state, plot.petId) : null;
  if (pet && pet.task && pet.task.type === 'plot' && pet.task.plotIndex === index) {
    pet.status = 'idle';
    pet.task = null;
  }
  plot.petId = null;
  plot.xpCarryMs = 0;
  return pet;
}

function speedFor(plot, pet, crop) {
  return 1 + (plot.watered ? WATER_BOOST : 0) + PET_BOOST * safePower(pet, crop.jobs);
}

// Current growth speed multiplier of a plot (used by the UI for ETA / badges).
export function plotSpeed(state, plot) {
  const crop = plot && getCrop(plot.cropId);
  if (!crop) return 1;
  return speedFor(plot, plotPet(state, plot, plot.index), crop);
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
  ensureOrders(state, todayKey());
}

function tickPlot(state, plot, index, nowMs) {
  if (!plot) return;
  plot.index = index;

  if (!plot.cropId) {
    if (plot.petId) releasePlotPet(state, plot, index);
    return;
  }
  const crop = getCrop(plot.cropId);
  if (!crop) { // unknown crop id (bad save): clear the plot
    releasePlotPet(state, plot, index);
    resetPlot(plot, index);
    return;
  }

  if (!Number.isFinite(plot.progress)) plot.progress = 0;
  if (!Number.isFinite(plot.lastGrowAt) || plot.lastGrowAt <= 0) {
    plot.lastGrowAt = plot.progress === 0 && plot.plantedAt > 0 ? Math.min(plot.plantedAt, nowMs) : nowMs;
  }
  // Never credit more than the offline cap in one call (also bounds pet XP).
  if (plot.lastGrowAt < nowMs - MAX_GAP_MS) plot.lastGrowAt = nowMs - MAX_GAP_MS;
  if (plot.lastGrowAt > nowMs) return; // clock moved backwards: wait it out
  const dt = nowMs - plot.lastGrowAt;
  plot.lastGrowAt = nowMs;

  // Validate the assigned pet; send it home if gone, replaced, sick or exhausted.
  let pet = null;
  if (plot.petId) {
    pet = plotPet(state, plot, index);
    if (!pet) {
      plot.petId = null; // dangling id (pet released / task changed)
      plot.xpCarryMs = 0;
    } else if (pet.sick || !pet.stats || !(pet.stats.energy > 0)) {
      notify(`${petEmoji(pet)} ${petName(pet)} ${pet.sick ? 'ป่วย' : 'หมดแรง'} เลยกลับคอกแล้ว`, 'warn');
      releasePlotPet(state, plot, index);
      pet = null;
    }
  }

  if (plot.progress < 1 - READY_EPS) {
    // Pet help only counts for a bounded slice of dt (energy is unknown over long gaps).
    const petDt = pet ? Math.min(dt, PET_STEP_CAP_MS) : 0;
    const petPart = pet ? PET_BOOST * safePower(pet, crop.jobs) : 0;
    const gain = (dt * (1 + (plot.watered ? WATER_BOOST : 0)) + petDt * petPart) / crop.growMs;
    const need = 1 - plot.progress;
    plot.progress = Math.min(1, plot.progress + gain);

    if (pet && petDt > 0) {
      // XP only for the part of the time before the crop finished.
      const worked = gain > need ? petDt * (need / gain) : petDt;
      plot.xpCarryMs = (Number(plot.xpCarryMs) || 0) + worked;
      const mins = Math.floor(plot.xpCarryMs / MIN);
      if (mins > 0) {
        plot.xpCarryMs -= mins * MIN;
        addPetXp(state, pet.id, mins);
      }
    }
    if (plot.progress < 1 - READY_EPS) return;
    plot.progress = 1;
    if (!pet) notify(`${crop.emoji} ${crop.nameTh} พร้อมเก็บเกี่ยวแล้ว!`, 'success');
  } else {
    plot.progress = 1;
  }

  // Ready: snapshot the helper's bonus onto the plot and send the pet home to rest.
  if (pet) {
    plot.helperBonus = Math.floor(safePower(pet, crop.jobs) / 2);
    plot.helperPetId = pet.id;
    notify(`🌱 ${crop.nameTh} พร้อมเก็บแล้ว น้อง ${petName(pet)} กลับคอกพักผ่อน`, 'success');
    releasePlotPet(state, plot, index);
  }
}

function rollLoot(zone, power) {
  const rolls = zone.baseRolls + Math.floor(power * 0.75 + Math.random());
  const out = {};
  for (let i = 0; i < rolls; i++) {
    const entry = pickWeighted(zone.loot, l => l.weight);
    if (!entry) continue;
    out[entry.itemId] = (out[entry.itemId] || 0) + randInt(entry.min, entry.max);
  }
  // Rare egg drop (3-7% per expedition, slightly better with a stronger pet).
  if (zone.eggs && zone.eggs.length && Math.random() < zone.eggChance + 0.005 * Math.min(power, 4)) {
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
    ex.rewards = zone ? rollLoot(zone, pet ? safePower(pet, [zone.job]) : 0.5) : {};
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

// Clear pets whose task points to a plot/expedition that no longer holds them.
function repairPetTasks(state) {
  if (!Array.isArray(state.pets)) return;
  for (const pet of state.pets) {
    if (!pet) continue;
    if (pet.status === 'working') {
      const t = pet.task;
      const plot = t && t.type === 'plot' ? getPlot(state, t.plotIndex) : null;
      if (!plot || plot.petId !== pet.id) { pet.status = 'idle'; pet.task = null; }
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
  Object.assign(plot, newPlot(plotIndex), { cropId: crop.id, plantedAt: t, lastGrowAt: t, lastCropId: crop.id });
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

export function assignPet(state, plotIndex, petId) {
  const plot = getPlot(state, plotIndex);
  if (!plot || !plot.cropId) return fail('ต้องปลูกพืชก่อนถึงจะส่งน้องมาช่วยได้');
  const crop = getCrop(plot.cropId);
  if (!crop) return fail('ไม่รู้จักพืชชนิดนี้');
  if (isReady(plot)) return fail('พืชโตเต็มที่แล้ว เก็บเกี่ยวได้เลย');
  if (plotPet(state, plot, plotIndex)) return fail('แปลงนี้มีน้องประจำอยู่แล้ว');
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  const can = canWork(pet);
  if (!can.ok) return fail(can.reason || 'น้องยังทำงานไม่ได้');
  plot.petId = pet.id;
  plot.xpCarryMs = 0;
  plot.index = plotIndex;
  pet.status = 'working';
  pet.task = { type: 'plot', plotIndex };
  bumpStat(state, 'helped');
  const boost = Math.round(PET_BOOST * safePower(pet, crop.jobs) * 100);
  return done(`${petEmoji(pet)} ${petName(pet)} มาช่วยดูแล${crop.nameTh} โตไวขึ้น +${boost}%`);
}

export function unassignPet(state, plotIndex) {
  const plot = getPlot(state, plotIndex);
  if (!plot) return fail('ไม่พบแปลงนี้');
  if (!plot.petId) return fail('แปลงนี้ไม่มีน้องประจำอยู่');
  const pet = releasePlotPet(state, plot, plotIndex);
  return done(pet ? `${petEmoji(pet)} ${petName(pet)} กลับคอกแล้ว` : 'เรียกน้องกลับแล้ว');
}

export function harvestPlot(state, plotIndex) {
  const plot = getPlot(state, plotIndex);
  if (!plot || !plot.cropId) return fail('แปลงนี้ยังไม่ได้ปลูกอะไร');
  const crop = getCrop(plot.cropId);
  if (!crop) return fail('ไม่รู้จักพืชชนิดนี้');
  if (!isReady(plot)) return fail('พืชยังโตไม่เต็มที่');

  // Helper bonus was snapshotted when the crop became ready (pet may already be elsewhere).
  const live = plotPet(state, plot, plotIndex); // legacy: pet still assigned on a ready plot
  const snap = Math.floor(Number(plot.helperBonus));
  const bonus = Number.isFinite(snap) && snap > 0 ? snap : Math.floor(safePower(live, crop.jobs) / 2);
  const helper = (plot.helperPetId && getPet(state, plot.helperPetId)) || live;
  const amount = randInt(crop.yield[0], crop.yield[1]) + bonus;
  addItem(state, 'crop_' + crop.id, amount);
  addPlayerXp(state, crop.xp);
  bumpStat(state, 'harvested');
  if (helper) addPetXp(state, helper.id, Math.max(2, Math.ceil(crop.xp / 2)));
  releasePlotPet(state, plot, plotIndex);
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

export function upgradeBarn(state) {
  const price = barnUpgradePrice(state);
  if (price == null) return fail(`คอกใหญ่สุดแล้ว (${MAX_BARN} ช่อง)`);
  if (!spendCoins(state, price)) return fail(`เหรียญไม่พอ (ต้องใช้ ${price} 🪙)`);
  state.barnCapacity = (Number(state.barnCapacity) || START_BARN) + 1;
  return done(`ขยายคอกแล้ว! จุได้ ${state.barnCapacity} ตัว (-${price} 🪙)`);
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

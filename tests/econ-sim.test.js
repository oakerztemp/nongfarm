// Economy simulator: a scripted player lives 14 virtual days with the REAL game logic and a fake clock.
// Three profiles: "3h" (checks in every 3 hours), "realistic" (every 10 minutes during a 3-hour
// evening window, every 3 hours otherwise) and "clicker24" (every 10 minutes, all day; report-only).
// Time between sessions is replayed exactly like main.js does it: 60 s catch-up steps (offline decay).
// The report (coins/hour + level by day) goes to console.log and window.__econReport.
import { test, assert, withFakeNow } from './harness.js';
import { createNewState, addItem, countItem } from '../js/state.js';
import { todayKey, now, randInt } from '../js/util.js';
import {
  tickPets, hatchReady, putEggInIncubator, feedPet, cleanPet, playWithPet, healPet, toggleSleep,
  canWork, getWorkPower,
} from '../js/pets.js';
import { CROPS, getCrop } from '../js/data/crops.js';
import { EGGS } from '../js/data/eggs.js';
import { ITEMS, getItem } from '../js/data/items.js';
import {
  tickFarm, plantSeed, waterPlot, assignPet, harvestAll, startExpedition, claimExpedition, buyItem, sellItem,
  buyPlot, plotPrice, upgradeBarn, barnUpgradePrice, upgradeIncubator, incubatorUpgradePrice,
  completeOrder, ensureOrders, nextMidnight, fertilize, harvestPlot, replantPlot, ZONES, effectivePower,
} from '../js/farm.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const START = new Date(2026, 2, 2, 8, 0, 0).getTime();
const DAYS = 14;

// ── seeded Math.random so the sim is repeatable ─────────────────────────────
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── time advance (same stepping as main.js catchUp) ─────────────────────────
function catchUp(s, from, to) {
  let t = Math.max(from, to - 72 * HOUR);
  while (t < to) {
    const step = Math.min(MIN, to - t);
    t += step;
    tickPets(s, step, { offline: true });
    tickFarm(s, t);
  }
  s.lastTick = to;
}

// ── bot helpers ─────────────────────────────────────────────────────────────
const avgYield = c => (c.yield[0] + c.yield[1]) / 2;
const profitOf = c => avgYield(c) * c.sellPrice - c.seedPrice;
const unlockedCrops = s => CROPS.filter(c => c.unlockLevel <= s.player.level);
const cycleOf = (c, cadence) => Math.max(cadence, Math.ceil(c.growMs / cadence) * cadence);
const isReady = p => p.cropId && p.progress >= 1 - 1e-9;

function zoneEv(zone, power) {
  const tw = zone.loot.reduce((a, l) => a + l.weight, 0);
  const per = zone.loot.reduce((a, l) => a + (l.weight / tw) * ((l.min + l.max) / 2) * (getItem(l.itemId).sell || 0), 0);
  return per * (zone.baseRolls + 0.75 * power);
}

function openOrders(s) {
  const o = s.orders || { list: [], weekly: null };
  return [...(o.list || []), o.weekly].filter(x => x && !x.done);
}

// What the player still needs for open orders: { itemId: count }
function orderNeeds(s) {
  const need = {};
  for (const o of openOrders(s)) {
    for (const [id, n] of Object.entries(o.items)) need[id] = (need[id] || 0) + n;
  }
  return need;
}

// Crop ids worth planting for orders that can still be finished before they expire.
function orderCropDeficits(s, cadence) {
  const t = now();
  const dayEnd = nextMidnight(t);
  const weekEnd = dayEnd + (6 - ((new Date(t).getDay() + 6) % 7)) * DAY;
  const growing = {};
  for (const p of s.plots) if (p.cropId) growing[p.cropId] = (growing[p.cropId] || 0) + avgYield(getCrop(p.cropId));
  const def = {};
  const o = s.orders || {};
  const list = [...(o.list || []).map(x => [x, dayEnd]), ...(o.weekly ? [[o.weekly, weekEnd]] : [])];
  for (const [order, deadline] of list) {
    if (!order || order.done) continue;
    let feasible = true;
    const lines = [];
    for (const [id, n] of Object.entries(order.items)) {
      const have = countItem(s, id);
      if (id.startsWith('crop_')) {
        const c = getCrop(id.slice(5));
        if (!c || c.unlockLevel > s.player.level) { feasible = false; break; }
        if (have < n && now() + cycleOf(c, cadence) > deadline) { feasible = false; break; }
        lines.push([c.id, n - have - (growing[c.id] || 0)]);
      } else if (have < n) {
        feasible = false; // forage cannot be planned; only counts if already in the bag
      }
    }
    if (!feasible) continue;
    for (const [cid, d] of lines) if (d > 0) def[cid] = (def[cid] || 0) + d;
  }
  return def;
}

function session(s, bot, cadence) {
  const startCoins = () => s.player.coins;

  // 1. collect trips + hatch
  for (const ex of [...s.expeditions]) if (ex.done) claimExpedition(s, ex.id);
  for (let i = s.incubator.length - 1; i >= 0; i--) hatchReady(s, i);

  // 2. harvest everything ready, then deliver orders we can
  harvestAll(s, false);
  for (const o of openOrders(s)) {
    const r = completeOrder(s, o.id);
    if (r.ok) { bot.earned += o.reward.coins; bot.by.orders += o.reward.coins; }
  }

  // 3. sell the rest of crops/forage (keep what open orders still need)
  const keep = orderNeeds(s);
  for (const [id, n] of Object.entries({ ...s.inventory })) {
    const it = getItem(id);
    if (!it || (it.type !== 'crop' && it.type !== 'forage') || it.sell == null) continue;
    const qty = n - (keep[id] || 0);
    if (qty > 0) {
      const before = s.player.coins;
      if (sellItem(s, id, qty).ok) {
        bot.earned += s.player.coins - before;
        bot.by[it.type] += s.player.coins - before;
      }
    }
  }

  // 4. plant empties: order deficits first, then best profit/hour for this cadence
  const deficits = orderCropDeficits(s, cadence);
  for (const p of s.plots) {
    if (p.cropId) continue;
    let choice = null;
    const wanted = Object.entries(deficits).filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1])[0];
    if (wanted) {
      choice = getCrop(wanted[0]);
      deficits[wanted[0]] -= avgYield(choice);
    }
    if (!choice) {
      choice = unlockedCrops(s)
        .filter(c => s.player.coins >= c.seedPrice || countItem(s, 'seed_' + c.id) > 0)
        .sort((a, b) => profitOf(b) / cycleOf(b, cadence) - profitOf(a) / cycleOf(a, cadence))[0];
    }
    if (!choice) continue;
    if (countItem(s, 'seed_' + choice.id) < 1 && !buyItem(s, 'seed_' + choice.id, 1).ok) continue;
    plantSeed(s, p.index, choice.id);
  }
  for (const p of s.plots) if (p.cropId && !p.watered && !isReady(p)) waterPlot(s, p.index);

  // 5. pet care
  for (const pet of s.pets) {
    if (pet.sick) {
      if (countItem(s, 'care_medicine') < 1 && s.player.coins >= 120) buyItem(s, 'care_medicine', 1);
      healPet(s, pet.id);
    }
    if (pet.status === 'sleeping' && pet.stats.energy >= 70) toggleSleep(s, pet.id);
    for (let k = 0; k < 2 && pet.stats.hunger < 60; k++) {
      if (countItem(s, 'food_kibble') < 1 && s.player.coins >= 40) buyItem(s, 'food_kibble', 1);
      if (!feedPet(s, pet.id, 'food_kibble').ok) break;
    }
    if (pet.poop > 0 || pet.stats.clean < 40) cleanPet(s, pet.id);
    if (pet.stats.happy < 50 && pet.stats.energy > 30 && pet.status === 'idle') playWithPet(s, pet.id);
    if (pet.status === 'idle' && pet.stats.energy < 30) toggleSleep(s, pet.id);
  }

  // 6. put idle pets to work: expedition or helper on a growing plot, whichever pays more per hour
  const zones = ZONES.filter(z => z.unlockLevel <= s.player.level);
  for (const pet of s.pets) {
    if (!canWork(pet).ok) continue;
    let best = { value: 0 };
    if (pet.stage >= 1) {
      for (const z of zones) {
        const cycle = Math.max(cadence, Math.ceil(z.durationMs / cadence) * cadence);
        const v = zoneEv(z, effectivePower(getWorkPower(pet, [z.job]))) / (cycle / HOUR);
        if (v > best.value) best = { value: v, zone: z };
      }
    }
    for (const p of s.plots) {
      if (!p.cropId || p.petId || isReady(p)) continue;
      const c = getCrop(p.cropId);
      const v = 0.3 * effectivePower(getWorkPower(pet, c.jobs)) * (profitOf(c) / (c.growMs / HOUR)) * (1 - p.progress);
      if (v > best.value) best = { value: v, plot: p };
    }
    if (best.zone) startExpedition(s, pet.id, best.zone.id);
    else if (best.plot) assignPet(s, best.plot.index, pet.id);
  }

  // 7. invest what is left
  for (const e of EGGS) {
    while (countItem(s, e.id) > 0 && s.incubator.length < s.incubatorCapacity) {
      if (!putEggInIncubator(s, e.id).ok) break;
    }
  }
  const reserve = 100;
  for (let guard = 0; guard < 12; guard++) {
    const spare = startCoins() - reserve;
    const pp = plotPrice(s);
    const ip = incubatorUpgradePrice(s);
    const bp = barnUpgradePrice(s);
    const petsTotal = s.pets.length + s.incubator.length;
    if (pp != null && spare >= pp && s.plots.length < 6 + s.pets.length * 2) { buyPlot(s); continue; }
    if (petsTotal < s.barnCapacity && s.incubator.length < s.incubatorCapacity) {
      const egg = EGGS.filter(e => e.unlockLevel <= s.player.level && e.price <= spare * 0.6)
        .sort((a, b) => b.price - a.price)[0];
      if (egg && buyItem(s, egg.id, 1).ok) { putEggInIncubator(s, egg.id); continue; }
    }
    if (ip != null && spare >= ip * 1.2 && s.pets.length >= 2) { upgradeIncubator(s); continue; }
    if (bp != null && petsTotal >= s.barnCapacity && spare >= bp * 1.3) { upgradeBarn(s); continue; }
    break;
  }
}

function claimDaily(s) {
  const today = todayKey();
  if (s.player.lastDailyClaim === today) return;
  s.player.lastDailyClaim = today;
  s.player.coins += 50;
  const unlocked = unlockedCrops(s);
  for (let i = 0; i < 3; i++) addItem(s, 'seed_' + unlocked[randInt(0, unlocked.length - 1)].id, 1);
}

// ── schedules ───────────────────────────────────────────────────────────────
const WINDOW_START_H = 18; // the "realistic" player plays actively 18:00-21:00
function nextRealistic(t) {
  const d = new Date(t);
  const winStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), WINDOW_START_H).getTime();
  if (t >= winStart && t < winStart + 3 * HOUR) return t + 10 * MIN;
  const nextWin = t < winStart ? winStart : winStart + DAY;
  return Math.min(t + 3 * HOUR, nextWin);
}
const PROFILES = {
  '3h': t => t + 3 * HOUR,
  realistic: nextRealistic,
  clicker24: t => t + 10 * MIN,
};

// ── one full run ────────────────────────────────────────────────────────────
function runSim(profile, seed) {
  const next = PROFILES[profile];
  return withFakeNow(START, clock => {
    const realRandom = Math.random;
    Math.random = mulberry32(seed);
    try {
      const s = createNewState();
      const bot = { earned: 0, by: { crop: 0, forage: 0, orders: 0 } };
      const rows = [];
      let last = START;
      let lastRowAt = START;
      let lastEarned = 0;
      const t0 = Date.now();
      for (let t = START; t <= START + DAYS * DAY; t = next(t)) {
        clock.set(t);
        if (t > START) catchUp(s, last, t);
        last = t;
        claimDaily(s);
        session(s, bot, Math.max(10 * MIN, next(t) - t));
        if (t >= START + (rows.length + 1) * DAY) {
          rows.push({
            day: rows.length + 1, level: s.player.level, coins: Math.floor(s.player.coins),
            perHour: (bot.earned - lastEarned) / ((t - lastRowAt) / HOUR), plots: s.plots.length, pets: s.pets.length,
            inc: s.incubatorCapacity, barn: s.barnCapacity, orders: s.stats.ordersDone || 0,
          });
          lastEarned = bot.earned;
          lastRowAt = t;
        }
      }
      return { rows, by: bot.by, earned: bot.earned, perHour: bot.earned / (DAYS * 24), ms: Date.now() - t0, state: s };
    } finally {
      Math.random = realRandom;
    }
  });
}

const results = {};
async function result(name) {
  if (!results[name]) results[name] = await runSim(name, 20260302);
  return results[name];
}

function table(name, r) {
  const share = k => Math.round((100 * r.by[k]) / Math.max(1, r.earned));
  const lines = [`[econ-sim] ${name}: ${Math.round(r.perHour)} coins/h earned on average (${r.ms} ms); income mix crops ${share('crop')}% / forage ${share('forage')}% / orders ${share('orders')}%`,
    'day  lvl  plots pets inc barn orders  coins/h(day)   coins'];
  for (const x of r.rows) {
    lines.push(`${String(x.day).padStart(3)}  ${String(x.level).padStart(3)}  ${String(x.plots).padStart(5)} ${String(x.pets).padStart(4)} ${String(x.inc).padStart(3)} ${String(x.barn).padStart(4)} ${String(x.orders).padStart(6)}  ${String(Math.round(x.perHour)).padStart(12)}  ${String(x.coins).padStart(7)}`);
  }
  return lines.join('\n');
}

function report(...names) {
  const text = names.map(n => table(n, results[n])).join('\n\n');
  globalThis.__econReport = text;
  console.log(text);
  return text;
}

const dayKeyOf = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── static economy rules ────────────────────────────────────────────────────
test('econ: nothing can be bought and sold back for profit', () => {
  for (const it of Object.values(ITEMS)) {
    if (it.buy != null && it.sell != null) assert(it.sell < it.buy, `${it.id}: sell ${it.sell} >= buy ${it.buy}`);
  }
  // crops: raising a crop can never be cheaper than its sale (seed -> crop) per unit of seed
  for (const c of CROPS) {
    assert(c.sellPrice * c.yield[0] > c.seedPrice, `${c.id}: farming should be profitable even on a bad roll`);
    assert(getItem('seed_' + c.id).sell < c.seedPrice, 'seed resale below price');
  }
});

test('econ: order rewards are never below the sell value of the requested items', () => withFakeNow(START, () => {
  for (let lvl = 1; lvl <= 25; lvl++) {
    for (let d = 0; d < 21; d++) {
      const s = createNewState();
      s.player.level = lvl;
      ensureOrders(s, dayKeyOf(START + d * DAY));
      for (const o of [...s.orders.list, s.orders.weekly]) {
        let value = 0;
        for (const [id, n] of Object.entries(o.items)) value += getItem(id).sell * n;
        assert(o.reward.coins >= value, `lvl ${lvl} order ${o.id}: reward ${o.reward.coins} < value ${value}`);
      }
    }
  }
}));

test('econ: fertilizer / replant loops give no instant profit', () => withFakeNow(START, () => {
  const s = createNewState();
  s.player.level = 12;
  s.player.coins = 1e6;
  const fert = getItem('care_fertilizer');
  assert(fert.buy > 0 && fert.sell < fert.buy, 'fertilizer priced above resale');
  const start = s.player.coins;
  for (let loop = 0; loop < 20; loop++) {
    for (const c of CROPS) {
      s.plots[0].cropId = null;
      assert(buyItem(s, 'seed_' + c.id, 1).ok && buyItem(s, 'care_fertilizer', 1).ok, 'buy');
      assert(plantSeed(s, 0, c.id).ok, 'plant');
      assert(fertilize(s, 0).ok, 'fertilize');
      assert(!harvestPlot(s, 0).ok, c.id + ': instant harvest after fertilizing');
      assert(s.plots[0].progress < 1, 'not ready');
    }
  }
  assert(s.player.coins < start, 'looping plant+fertilize only costs coins');
  // replant button does not skip growing time either
  s.plots[0].cropId = null;
  s.plots[0].lastCropId = 'carrot';
  assert(replantPlot(s, 0).ok && !harvestPlot(s, 0).ok, 'replant needs real time');
}));

// ── simulations ─────────────────────────────────────────────────────────────
const avgRate = (r, from) => {
  const rows = r.rows.filter(x => x.day >= from);
  return rows.reduce((t, x) => t + x.perHour, 0) / rows.length;
};

test('econ: 3h player stays inside the pacing band (no day-6 saturation)', async () => {
  const r = await result('3h');
  const text = report('3h');
  const at = d => r.rows.find(x => x.day === d);
  assert(r.rows.length === DAYS, 'rows ' + r.rows.length);
  assert(at(3).level >= 5, `level at day 3 is ${at(3).level} (< 5)\n${text}`);
  const full = r.rows.find(x => x.plots >= 16);
  assert(!full || full.day >= 10, `all 16 plots owned on day ${full && full.day} (< 10)\n${text}`);
  assert(at(14).coins < 300000, `coins on day 14: ${at(14).coins} (>= 300k)\n${text}`);
  assert(at(14).perHour <= 4500, `coins/h on day 14: ${Math.round(at(14).perHour)} (> ~4k)\n${text}`);
  assert(at(14).level >= 14 && at(14).level <= 20, `level on day 14 is ${at(14).level} (outside 14-20)\n${text}`);
  assert(Number.isFinite(r.perHour) && r.perHour > 0, 'earned something\n' + text);
  assert(r.ms < 15000, `sim too slow: ${r.ms} ms`);
});

test('econ: realistic player (10-min window each day) earns <= 2.5x the 3h player per hour', async () => {
  const a = await result('3h');
  const b = await result('realistic');
  const c = await result('clicker24'); // report-only
  const text = report('3h', 'realistic', 'clicker24');
  // Day 1 is report-only: the very first session is naturally active (plots, eggs and crops all unlock).
  const fromDay2 = avgRate(b, 2) / avgRate(a, 2);
  const whole = b.perHour / a.perHour;
  globalThis.__econRatio = { realisticDay2to14: fromDay2, realisticWhole: whole, clicker24Whole: c.perHour / a.perHour };
  console.log(`[econ-sim] realistic/3h per hour: days 2-14 = ${fromDay2.toFixed(2)}, whole run = ${whole.toFixed(2)}; clicker24/3h whole run = ${(c.perHour / a.perHour).toFixed(2)} (report only)`);
  assert(fromDay2 <= 2.5, `realistic/3h earning ratio (days 2-14) ${fromDay2.toFixed(2)} > 2.5\n${text}`);
  assert(whole <= 3.5, `realistic/3h earning ratio (whole run) ${whole.toFixed(2)} > 3.5\n${text}`);
  assert(b.ms < 15000 && c.ms < 15000, `sims too slow: ${b.ms} / ${c.ms} ms`);
});

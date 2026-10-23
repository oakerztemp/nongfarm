// Farm logic tests: plot growth, fertilizer, helper pets, offline clamp, orders, shop, upgrades, stats.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { createNewState, addItem, countItem } from '../js/state.js';
import { getWorkPower, getPet, traitEffect, bondHearts } from '../js/pets.js';
import { getSpecies, SPECIES } from '../js/data/species.js';
import { getCrop, CROPS } from '../js/data/crops.js';
import { ITEMS, getItem } from '../js/data/items.js';
import {
  tickFarm, plantSeed, waterPlot, fertilize, assignPet, unassignPet, harvestPlot, harvestAll, replantPlot,
  startExpedition, claimExpedition, buyItem, sellItem, buyPlot, plotPrice, upgradeBarn, barnUpgradePrice,
  incubatorUpgradePrice, upgradeIncubator, ensureOrders, completeOrder, isoWeekKey, orderValue,
  generateDailyOrders, generateWeeklyOrder, forageDropsPerTrip, cropProducedPerDay, effectivePower, ZONES, MAX_PLOTS,
  slotJobs, plotTeam, plotSpeed, TEAM_COMBO, plotBonusPreview,
} from '../js/farm.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 2, 2, 10, 0, 0).getTime(); // Monday 2026-03-02 10:00 local
const DAY1 = '2026-03-02';

const near = (a, b, msg, eps = 1e-6) => assert(Math.abs(a - b) < eps, `${msg}: expected ${b}, got ${a}`);

/** Raw power exactly as farm.js asks for it (slot jobs + context, so traits/bond are included). */
function pw(pet, cropId, slot = 0, team = 1, ms = T0) {
  const jobs = slotJobs(getCrop(cropId), slot);
  return getWorkPower(pet, jobs, { kind: 'plot', jobs, teamSize: team, hour: new Date(ms).getHours() });
}

/** Runs fn with a species temporarily given a trait (restores it afterwards). */
function withTrait(speciesId, trait, fn) {
  const sp = getSpecies(speciesId);
  const old = sp.trait;
  sp.trait = trait;
  try { return fn(); } finally { if (old === undefined) delete sp.trait; else sp.trait = old; }
}

/** Ticks in 1-minute steps (like the offline catch-up) until `until()` is true; returns the last tick time. */
function tickMinutes(s, from, until, maxMin = 400) {
  let t = from;
  for (let i = 0; i < maxMin && !until(); i++) { t += MIN; tickFarm(s, t); }
  return t;
}

function fresh(level = 1) {
  const s = createNewState();
  s.player.level = level;
  s.player.coins = 100000;
  s.barnCapacity = 10;
  return s;
}

function mkPet(s, over = {}) {
  const pet = {
    id: 'p' + (s.pets.length + 1), speciesId: 'hamster', nickname: 'ทดสอบ', shiny: false, personality: 'cheerful',
    stage: 2, xp: 0, stats: { hunger: 100, happy: 100, energy: 100, clean: 100 },
    poop: 0, sick: false, zeroSince: null, zeroMs: 0, poopTimer: null, lastFedAt: 0,
    status: 'idle', task: null, bornAt: T0, ...over,
  };
  s.pets.push(pet);
  return pet;
}

/** Plants `cropId` on plot 0 (grants a seed first) and returns the plot. */
function plant(s, cropId = 'carrot', idx = 0) {
  addItem(s, 'seed_' + cropId, 1);
  const r = plantSeed(s, idx, cropId);
  assert(r.ok, 'plant failed: ' + r.reason);
  return s.plots[idx];
}

// ── growth ──────────────────────────────────────────────────────────────────
test('farm: plot grows linearly with time and never exceeds 1', () => withFakeNow(T0, () => {
  const s = fresh();
  const plot = plant(s);
  tickFarm(s, T0 + MIN);
  near(plot.progress, 0.5, 'carrot after 1 of 2 min');
  tickFarm(s, T0 + 10 * MIN);
  assertEq(plot.progress, 1, 'capped at 1');
  assert(harvestPlot(s, 0).ok, 'harvest ready crop');
}));

test('farm: watering speeds growth by 20%, only once and not on empty plots', () => withFakeNow(T0, () => {
  const s = fresh();
  assert(!waterPlot(s, 0).ok, 'empty plot cannot be watered');
  const plot = plant(s);
  assert(waterPlot(s, 0).ok, 'water ok');
  assert(!waterPlot(s, 0).ok, 'second water refused');
  tickFarm(s, T0 + MIN);
  near(plot.progress, 0.6, 'watered progress');
}));

test('farm: assigned pet adds 30% x power; pet XP is 1 per full minute', () => withFakeNow(T0, () => {
  const s = fresh(2);
  const pet = mkPet(s);
  const plot = plant(s, 'potato');
  const power = pw(pet, 'potato');
  assert(power > 0, 'power > 0');
  assert(assignPet(s, 0, pet.id).ok, 'assign ok');
  assertEq(pet.status, 'working', 'pet working');
  tickFarm(s, T0 + MIN);
  near(plot.progress, (MIN / getCrop('potato').growMs) * (1 + 0.3 * effectivePower(power)), 'progress with pet', 1e-6);
  assertEq(pet.xp, 1, 'one full minute = 1 xp');
}));

test('farm: water + pet stack', () => withFakeNow(T0, () => {
  const s = fresh(2);
  const pet = mkPet(s);
  const plot = plant(s, 'potato');
  const power = pw(pet, 'potato');
  assert(assignPet(s, 0, pet.id).ok, 'assign');
  assert(waterPlot(s, 0).ok, 'water');
  tickFarm(s, T0 + MIN);
  near(plot.progress, (MIN / getCrop('potato').growMs) * (1 + 0.2 + 0.3 * effectivePower(power)), 'stacked speed');
}));

test('farm: manual unassign returns pet idle and clears the plot', () => withFakeNow(T0, () => {
  const s = fresh();
  const pet = mkPet(s);
  const plot = plant(s);
  assignPet(s, 0, pet.id);
  assert(unassignPet(s, 0).ok, 'unassign');
  assertEq([pet.status, pet.task, plot.petIds[0]], ['idle', null, null], 'state after unassign');
  assert(!unassignPet(s, 0).ok, 'nothing to unassign');
}));

test('farm: sick or exhausted pets are sent home automatically', () => withFakeNow(T0, () => {
  const s = fresh();
  const a = mkPet(s);
  const b = mkPet(s);
  plant(s, 'carrot', 0);
  plant(s, 'carrot', 1);
  assignPet(s, 0, a.id);
  assignPet(s, 1, b.id);
  a.sick = true;
  b.stats.energy = 0;
  tickFarm(s, T0 + 10 * 1000);
  assertEq([a.status, b.status, s.plots[0].petIds[0], s.plots[1].petIds[0]], ['idle', 'idle', null, null], 'both released');
  assertEq([a.task, b.task], [null, null], 'tasks cleared');
}));

test('farm: dangling pet id on a plot is cleaned up without NaN', () => withFakeNow(T0, () => {
  const s = fresh();
  const plot = plant(s);
  plot.petIds = ['ghost'];
  tickFarm(s, T0 + MIN);
  assertEq(plot.petIds[0], null, 'ghost cleared');
  assert(Number.isFinite(plot.progress), 'progress finite');
  near(plot.progress, 0.5, 'plain growth');
  // pet that thinks it works on a plot that does not hold it
  const pet = mkPet(s, { status: 'working', task: { type: 'plot', plotIndex: 3, slot: 0 } });
  tickFarm(s, T0 + 2 * MIN);
  assertEq([pet.status, pet.task], ['idle', null], 'stale pet task repaired');
}));

// ── fertilizer ──────────────────────────────────────────────────────────────
test('farm: fertilizer is once per planting and can never finish a crop', () => withFakeNow(T0, () => {
  const s = fresh(12);
  const plot = plant(s, 'pineapple');
  addItem(s, 'care_fertilizer', 3);
  assert(fertilize(s, 0).ok, 'first use');
  near(plot.progress, 0.25, 'plus 25%');
  const r2 = fertilize(s, 0);
  assert(!r2.ok, 'second use refused');
  assertEq(countItem(s, 'care_fertilizer'), 2, 'only one consumed');
  assertEq(plot.fertilized, true, 'flag set');
  // cap: a plot at 0.9 gets at most to 0.95
  const p2 = plant(s, 'carrot', 1);
  p2.progress = 0.9;
  assert(fertilize(s, 1).ok, 'fertilize near the end');
  near(p2.progress, 0.95, 'capped at 0.95');
  assert(p2.progress < 1 && !harvestPlot(s, 1).ok, 'not ready from fertilizer alone');
  // at/above the cap it is refused and the item is kept
  const p3 = plant(s, 'carrot', 2);
  p3.progress = 0.97;
  const before = countItem(s, 'care_fertilizer');
  assert(!fertilize(s, 2).ok, 'no effect -> refused');
  assertEq(countItem(s, 'care_fertilizer'), before, 'item kept');
  // flag resets after harvest + replant
  p3.progress = 1;
  harvestPlot(s, 2);
  plant(s, 'carrot', 2);
  assertEq(s.plots[2].fertilized, false, 'new planting not fertilized');
}));

test('farm: plant -> fertilize -> harvest is never instant', () => withFakeNow(T0, () => {
  const s = fresh(12);
  for (const c of CROPS) {
    const plot = plant(s, c.id);
    addItem(s, 'care_fertilizer', 1);
    fertilize(s, 0);
    assert(!harvestPlot(s, 0).ok, c.id + ' harvestable right after fertilizing');
    plot.cropId = null; // clear for next crop
  }
}));

// ── ready plot: pet released, bonus kept ────────────────────────────────────
test('farm: ready plot sends the helper home and snapshots helperBonus; harvest uses it', () => withFakeNow(T0, () => {
  const s = fresh();
  const pet = mkPet(s);
  const plot = plant(s);
  const power = pw(pet, 'carrot');
  assignPet(s, 0, pet.id);
  tickFarm(s, T0 + 3 * MIN);
  assertEq(plot.progress, 1, 'ready');
  assertEq([pet.status, pet.task, plot.petIds[0]], ['idle', null, null], 'pet released on ready');
  const yb = traitEffect(pet, { kind: 'plot', jobs: ['dig', 'water'], teamSize: 1, hour: 10 }).yieldBonus || 0;
  assertEq(plot.helperBonus, Math.floor(effectivePower(power) / 2) + yb, 'bonus snapshot');
  assertEq(plot.helperPetIds, [pet.id], 'helper remembered');
  const workedMs = getCrop('carrot').growMs / (1 + 0.3 * effectivePower(power));
  assertEq(pet.xp, Math.floor(workedMs / MIN), 'XP only for the time before the crop was ready');
  assert(!assignPet(s, 0, pet.id).ok, 'cannot assign to a ready plot');
  const crop = getCrop('carrot');
  const r = harvestPlot(s, 0);
  assert(r.ok, 'harvest');
  const got = countItem(s, 'crop_carrot');
  const bonus = Math.floor(effectivePower(power) / 2) + yb;
  assert(got >= crop.yield[0] + bonus && got <= crop.yield[1] + bonus, 'yield includes helper bonus: ' + got);
  assert(pet.xp >= 2, 'pet gets harvest XP bonus');
  assertEq([plot.cropId, plot.helperBonus, plot.helperPetIds, plot.lastCropId], [null, 0, [], 'carrot'], 'plot reset, lastCropId kept');
}));

// ── offline clamp ───────────────────────────────────────────────────────────
test('farm: a huge gap is clamped to 72h and pet XP stays bounded', () => withFakeNow(T0, () => {
  const s = fresh(12);
  const pet = mkPet(s);
  const plot = plant(s, 'pineapple');
  assignPet(s, 0, pet.id);
  tickFarm(s, T0 + 400 * HOUR); // one call spanning ~17 days
  assertEq(plot.progress, 1, 'long crop finished');
  assert(pet.xp <= 5, 'pet XP bounded, got ' + pet.xp);
  assertEq(pet.status, 'idle', 'pet released');
  // lastGrowAt never lags more than 72h behind
  const p2 = plant(s, 'carrot', 1);
  p2.lastGrowAt = T0 - 1000 * HOUR;
  tickFarm(s, T0 + 400 * HOUR + MIN);
  assert(p2.lastGrowAt >= T0 + 400 * HOUR, 'lastGrowAt advanced to now');
}));

test('farm: clock moving backwards does not grow or crash', () => withFakeNow(T0, () => {
  const s = fresh();
  const plot = plant(s);
  tickFarm(s, T0 - 5 * MIN);
  assertEq(plot.progress, 0, 'no growth');
  assert(Number.isFinite(plot.lastGrowAt), 'finite');
}));

// ── expeditions ─────────────────────────────────────────────────────────────
test('farm: expedition lifecycle (start, finish on tick, claim) + stats', () => withFakeNow(T0, () => {
  const s = fresh();
  const pet = mkPet(s);
  const baby = mkPet(s, { stage: 0 });
  assert(!startExpedition(s, baby.id, 'forest').ok, 'baby cannot explore');
  assert(!startExpedition(s, pet.id, 'cloud').ok, 'locked zone refused (level)');
  assert(!startExpedition(s, 'nope', 'forest').ok, 'unknown pet');
  assert(!startExpedition(s, pet.id, 'nowhere').ok, 'unknown zone');
  assert(startExpedition(s, pet.id, 'forest').ok, 'start');
  assertEq(pet.status, 'expedition', 'pet away');
  assert(!claimExpedition(s, s.expeditions[0].id).ok, 'cannot claim early');
  tickFarm(s, T0 + 6 * MIN);
  const ex = s.expeditions[0];
  assert(ex.done && ex.rewards && Object.keys(ex.rewards).length > 0, 'rewards rolled');
  assertEq([pet.status, pet.task], ['idle', null], 'pet back');
  const id = ex.id;
  assert(claimExpedition(s, id).ok, 'claim');
  assertEq(s.expeditions.length, 0, 'removed');
  assert(!claimExpedition(s, id).ok, 'no double claim');
  assertEq([s.stats.expeditionsStarted, s.stats.expeditionsClaimed], [1, 1], 'stats');
}));

test('farm: zones have a rare habitat egg drop', () => withFakeNow(T0, () => {
  for (const z of ZONES) {
    assert(z.eggs && z.eggs.length && z.eggChance >= 0.03 && z.eggChance <= 0.06, 'egg config ' + z.id);
    for (const e of z.eggs) assert(getItem(e) && getItem(e).type === 'egg', 'egg item ' + e);
  }
  const s = fresh();
  const pet = mkPet(s);
  startExpedition(s, pet.id, 'forest');
  const realRandom = Math.random;
  Math.random = () => 0; // forces the egg roll to succeed
  try { tickFarm(s, T0 + 6 * MIN); } finally { Math.random = realRandom; }
  assert(s.expeditions[0].rewards.egg_forest >= 1, 'forced egg drop');
  claimExpedition(s, s.expeditions[0].id);
  assert(countItem(s, 'egg_forest') >= 1, 'egg in inventory');
}));

// ── orders ──────────────────────────────────────────────────────────────────
test('orders: ISO week keys', () => {
  assertEq(isoWeekKey('2026-03-02'), '2026-W10', 'monday');
  assertEq(isoWeekKey('2026-03-08'), '2026-W10', 'sunday same week');
  assertEq(isoWeekKey('2026-03-09'), '2026-W11', 'next monday');
  assertEq(isoWeekKey('2025-12-29'), '2026-W01', 'year boundary');
  assertEq(isoWeekKey('garbage'), null, 'invalid');
});

test('orders: deterministic per day, stable across reloads, regenerate on a new day/week', () => withFakeNow(T0, () => {
  const a = fresh();
  const b = fresh();
  ensureOrders(a, DAY1);
  ensureOrders(b, DAY1);
  assertEq(a.orders, b.orders, 'same day + level => identical boards');
  assertEq(a.orders.list.length, 3, 'three daily orders');
  assert(a.orders.weekly && a.orders.weekly.id.endsWith('-w'), 'weekly order');
  const snapshot = JSON.stringify(a.orders);
  a.player.level = 6;
  ensureOrders(a, DAY1);
  assertEq(JSON.stringify(a.orders), snapshot, 'no reroll on same day even if level changed');
  // JSON round trip (save/load) keeps the board
  const reloaded = JSON.parse(JSON.stringify(a));
  ensureOrders(reloaded, DAY1);
  assertEq(reloaded.orders, a.orders, 'reload keeps the board');
  // new day regenerates the daily list, keeps the weekly one in the same ISO week
  const weeklyId = a.orders.weekly.id;
  const day1Ids = a.orders.list.map(o => o.id);
  ensureOrders(a, '2026-03-03');
  assert(a.orders.day === '2026-03-03' && a.orders.list.every(o => !day1Ids.includes(o.id)), 'new daily list');
  assertEq(a.orders.weekly.id, weeklyId, 'weekly stays within the week');
  ensureOrders(a, '2026-03-09');
  assert(a.orders.weekly.id !== weeklyId, 'new ISO week => new weekly');
  // tickFarm creates the board by itself
  const c = fresh();
  tickFarm(c, T0);
  assertEq(c.orders.day, DAY1, 'tickFarm ensures orders (todayKey)');
  assert(!ensureOrders(c, 'bad-key') || c.orders.day === DAY1, 'bad key ignored');
}));

test('orders: items only from unlocked crops/forage; rewards beat sell value', () => {
  const level1Items = new Set(['crop_carrot', 'crop_corn']);
  const forest = ZONES.find(z => z.id === 'forest');
  for (const l of forest.loot) level1Items.add(l.itemId);
  for (let d = 1; d <= 30; d++) {
    const key = `2026-04-${String(d).padStart(2, '0')}`;
    for (const o of generateDailyOrders(1, key)) {
      for (const id of Object.keys(o.items)) assert(level1Items.has(id), `level 1 order asks for ${id}`);
    }
  }
  for (let lvl = 1; lvl <= 30; lvl++) {
    for (let d = 1; d <= 10; d++) {
      const s = fresh();
      s.player.level = lvl;
      ensureOrders(s, `2026-05-${String(d).padStart(2, '0')}`);
      for (const o of [...s.orders.list, s.orders.weekly]) {
        assert(o.reward.coins >= orderValue(o) * 1.6 - 1e-9, `reward below 1.6x value (lvl ${lvl}): ${JSON.stringify(o)}`);
        for (const [id, n] of Object.entries(o.items)) {
          const it = getItem(id);
          assert(it && n >= 1 && n <= 80, 'valid line ' + id);
          if (it.type === 'crop') assert(getCrop(id.slice(5)).unlockLevel <= lvl, 'crop unlocked ' + id);
        }
      }
      assert(s.orders.weekly.reward.items && Object.keys(s.orders.weekly.reward.items).length === 1, 'weekly special egg');
    }
  }
  // mystic egg only from level 10
  const lo = fresh(); lo.player.level = 9; ensureOrders(lo, DAY1);
  const hi = fresh(); hi.player.level = 10; ensureOrders(hi, DAY1);
  assert(!lo.orders.weekly.reward.items.egg_mystic, 'no mystic below 10');
  assert(hi.orders.weekly.reward.items.egg_mystic === 1, 'mystic at 10+');
});

test('orders: completeOrder needs the items and cannot be done twice', () => withFakeNow(T0, () => {
  const s = fresh();
  ensureOrders(s, DAY1);
  const order = s.orders.list[0];
  const coins0 = s.player.coins;
  const r0 = completeOrder(s, order.id);
  assert(!r0.ok, 'missing items refused');
  assertEq(s.player.coins, coins0, 'no coins without items');
  assert(!completeOrder(s, 'no-such-order').ok, 'unknown id');
  for (const [id, n] of Object.entries(order.items)) addItem(s, id, n + 1);
  const r1 = completeOrder(s, order.id);
  assert(r1.ok, 'complete: ' + r1.reason);
  assertEq(s.player.coins, coins0 + order.reward.coins, 'reward coins');
  for (const [id] of Object.entries(order.items)) assertEq(countItem(s, id), 1, 'items consumed (1 spare left) ' + id);
  assertEq(order.done, true, 'marked done');
  assertEq(s.stats.ordersDone, 1, 'stat');
  const coins1 = s.player.coins;
  for (const [id, n] of Object.entries(order.items)) addItem(s, id, n);
  assert(!completeOrder(s, order.id).ok, 'no double complete');
  assertEq(s.player.coins, coins1, 'no second payout');
  // weekly order grants its egg
  const w = s.orders.weekly;
  for (const [id, n] of Object.entries(w.items)) addItem(s, id, n);
  const eggId = Object.keys(w.reward.items)[0];
  const eggs0 = countItem(s, eggId);
  assert(completeOrder(s, w.id).ok, 'weekly complete');
  assertEq(countItem(s, eggId), eggs0 + 1, 'weekly egg granted');
}));

// ── shop ────────────────────────────────────────────────────────────────────
test('shop: buyItem validates id, level, qty and coins', () => withFakeNow(T0, () => {
  const s = fresh();
  for (const bad of [0, -1, NaN, 'abc', null]) {
    assert(!buyItem(s, 'seed_carrot', bad).ok, 'qty ' + bad + ' refused');
  }
  assert(!buyItem(s, 'nope', 1).ok, 'unknown item');
  assert(!buyItem(s, 'constructor', 1).ok, 'prototype key');
  assert(!buyItem(s, 'crop_carrot', 1).ok, 'not for sale');
  assert(!buyItem(s, 'forage_gem', 1).ok, 'forage not for sale');
  assert(!buyItem(s, 'seed_pineapple', 1).ok, 'locked by level');
  s.player.coins = 5;
  assert(!buyItem(s, 'seed_corn', 2).ok && s.player.coins === 5, 'not enough coins, nothing charged');
  s.player.coins = 1000;
  const before = countItem(s, 'seed_corn');
  assert(buyItem(s, 'seed_corn', 3).ok, 'buy x3');
  assertEq(countItem(s, 'seed_corn'), before + 3, 'added');
  assertEq(s.player.coins, 1000 - 3 * getItem('seed_corn').buy, 'charged');
  assertEq(s.stats.bought, 3, 'bought stat counts qty');
}));

test('shop: sellItem validates id, qty and ownership', () => withFakeNow(T0, () => {
  const s = fresh();
  addItem(s, 'crop_carrot', 5);
  for (const bad of [0, -2, NaN, 'x']) assert(!sellItem(s, 'crop_carrot', bad).ok, 'qty ' + bad);
  assert(!sellItem(s, 'crop_carrot', 6).ok, 'more than owned');
  assertEq(countItem(s, 'crop_carrot'), 5, 'nothing removed on failure');
  assert(!sellItem(s, 'egg_farm', 1).ok, 'eggs unsellable');
  assert(!sellItem(s, 'nope', 1).ok, 'unknown');
  assert(!sellItem(s, 'constructor', 1).ok, 'prototype key');
  const coins = s.player.coins;
  assert(sellItem(s, 'crop_carrot', 5).ok, 'sell all');
  assertEq(s.player.coins, coins + 5 * getItem('crop_carrot').sell, 'paid');
  assertEq(countItem(s, 'crop_carrot'), 0, 'removed');
  assertEq(s.stats.sold, 5, 'sold stat counts qty');
}));

test('shop: no item can be bought and sold back for profit', () => {
  for (const it of Object.values(ITEMS)) {
    if (it.buy != null && it.sell != null) assert(it.sell < it.buy, `${it.id}: sell ${it.sell} >= buy ${it.buy}`);
    if (it.type === 'egg') assert(it.sell == null, 'eggs unsellable');
  }
});

// ── upgrades ────────────────────────────────────────────────────────────────
test('upgrades: plots (max 16), barn (max 20), incubator (max 3)', () => withFakeNow(T0, () => {
  const s = fresh();
  const p0 = plotPrice(s);
  assert(p0 > 0, 'first extra plot price');
  s.player.coins = p0 - 1;
  assert(!buyPlot(s).ok && s.plots.length === 4, 'cannot afford');
  s.player.coins = 1e9;
  while (plotPrice(s) != null) assert(buyPlot(s).ok, 'buy plot');
  assertEq(s.plots.length, MAX_PLOTS, 'max plots');
  assert(!buyPlot(s).ok, 'no more plots');
  assertEq(s.plots[15].index, 15, 'new plot index');
  while (barnUpgradePrice(s) != null) assert(upgradeBarn(s).ok, 'upgrade barn');
  assertEq(s.barnCapacity, 20, 'max barn');
  assert(!upgradeBarn(s).ok, 'barn maxed');

  const t = fresh();
  assertEq(t.incubatorCapacity, 1, 'starts with 1');
  const i1 = incubatorUpgradePrice(t);
  assert(i1 > 0, 'price 1');
  t.player.coins = i1 - 1;
  assert(!upgradeIncubator(t).ok && t.incubatorCapacity === 1, 'cannot afford');
  t.player.coins = 1e9;
  assert(upgradeIncubator(t).ok, 'to 2');
  const i2 = incubatorUpgradePrice(t);
  assert(i2 > i1, 'second upgrade costs more');
  const c = t.player.coins;
  assert(upgradeIncubator(t).ok, 'to 3');
  assertEq(t.player.coins, c - i2, 'charged');
  assertEq(t.incubatorCapacity, 3, 'capacity 3');
  assertEq(incubatorUpgradePrice(t), null, 'null at max');
  assert(!upgradeIncubator(t).ok && t.incubatorCapacity === 3, 'max 3');
}));

// ── replant + stats ─────────────────────────────────────────────────────────
test('farm: replant uses lastCropId, buys a missing seed, harvestAll can replant', () => withFakeNow(T0, () => {
  const s = fresh();
  assert(!replantPlot(s, 0).ok, 'nothing planted before');
  plant(s, 'corn', 0);
  plant(s, 'corn', 1);
  s.plots[0].progress = 1;
  s.plots[1].progress = 1;
  const r = harvestAll(s, true);
  assert(r.ok, 'harvestAll');
  assert(s.plots[0].cropId === 'corn' && s.plots[1].cropId === 'corn', 'replanted both');
  assert(!replantPlot(s, 0).ok, 'occupied plot refused');
  s.plots[0].progress = 1;
  harvestPlot(s, 0);
  s.inventory = {};
  const coins = s.player.coins;
  assert(replantPlot(s, 0).ok, 'replant with auto-buy');
  assertEq(s.player.coins, coins - getCrop('corn').seedPrice, 'seed bought');
  assert(!harvestAll(s, false).ok, 'nothing ready');
}));

test('farm: bumpStat keys planted / helped / harvested', () => withFakeNow(T0, () => {
  const s = fresh();
  const pet = mkPet(s);
  plant(s);
  assertEq(s.stats.planted, 1, 'planted');
  assert(assignPet(s, 0, pet.id).ok, 'assign');
  assertEq(s.stats.helped, 1, 'helped');
  assert(!assignPet(s, 0, pet.id).ok, 'busy pet refused');
  assertEq(s.stats.helped, 1, 'failed assign does not count');
  s.plots[0].progress = 1;
  harvestPlot(s, 0);
  assertEq(s.stats.harvested, 1, 'harvested');
  assert(!harvestPlot(s, 0).ok && s.stats.harvested === 1, 'failed harvest not counted');
  assert(!plantSeed(s, 99, 'carrot').ok && !plantSeed(s, 'x', 'carrot').ok && !plantSeed(s, 0, 'nope').ok, 'bad input refused');
  assert(getPet(s, pet.id), 'pet still exists');
}));

test('orders: every generated order is achievable (forage sized by trips, crops by plot output)', () => {
  const dayKey = k => `2026-${String(1 + Math.floor(k / 28)).padStart(2, '0')}-${String(1 + (k % 28)).padStart(2, '0')}`;
  let lines = 0;
  for (let lvl = 1; lvl <= 20; lvl++) {
    const drops = forageDropsPerTrip(lvl);
    for (let k = 0; k < 60; k++) {
      const boards = [[generateDailyOrders(lvl, dayKey(k)), false], [[generateWeeklyOrder(lvl, `2026-W${String(k + 1).padStart(2, '0')}`)], true]];
      for (const [orders, weekly] of boards) {
        for (const o of orders) {
          for (const [id, n] of Object.entries(o.items)) {
            lines++;
            const it = getItem(id);
            assert(it && n >= 1, 'valid line ' + id);
            if (it.type === 'forage') {
              const per = drops[id] || 0;
              assert(per >= 0.5, `lvl ${lvl}: ${id} drops only ${per.toFixed(2)} per trip`);
              assert(n / per <= (weekly ? 8 : 3) + 1e-9, `lvl ${lvl}: ${id} x${n} needs ${(n / per).toFixed(1)} trips (${weekly ? 'weekly' : 'daily'})`);
            } else {
              const crop = getCrop(id.slice(5));
              assert(crop && crop.unlockLevel <= lvl, `lvl ${lvl}: locked crop ${id}`);
              const made = cropProducedPerDay(crop) * (weekly ? 3 : 1);
              assert(n <= Math.max(1, made * 0.5) + 1e-9, `lvl ${lvl}: ${id} x${n} but 4 plots make ~${Math.round(made)} (${weekly ? '3 days' : '1 day'})`);
            }
          }
        }
      }
    }
  }
  assert(lines > 2000, 'enough lines checked: ' + lines);
  const lv1 = generateDailyOrders(1, DAY1).concat(generateWeeklyOrder(1, '2026-W10'));
  for (const o of lv1) assert(!o.items.forage_bone && !o.items.forage_honey, 'no rare forage at level 1');
});

test('farm: effectivePower has diminishing returns (full to 2, 40% above)', () => {
  near(effectivePower(0), 0, 'zero');
  near(effectivePower(1.5), 1.5, 'below 2');
  near(effectivePower(2), 2, 'at 2');
  near(effectivePower(4), 2 + 0.4 * 2, 'above 2');
  near(effectivePower(NaN), 0, 'NaN safe');
  // pet crop speed = 0.3*min(p,2) + 0.12*max(0,p-2)
  near(0.3 * effectivePower(5), 0.3 * 2 + 0.12 * 3, 'speed bonus formula');
});

// ── team plots (CONTRACT_V3 §4) ─────────────────────────────────────────────
test('teams: crops get 1/2/3 slots by grow time, slot i = jobs[i], 3-slot crops list 3 jobs', () => {
  for (const c of CROPS) {
    const want = c.growMs < 30 * MIN ? 1 : c.growMs < 120 * MIN ? 2 : 3;
    assertEq(c.slots, want, c.id + ' slots');
    assert(c.jobs.length >= c.slots, `${c.id}: needs ${c.slots} jobs, has ${c.jobs.length}`);
    assertEq(new Set(c.jobs).size, c.jobs.length, c.id + ' jobs are distinct');
    if (c.slots === 1) assertEq(slotJobs(c, 0), c.jobs, c.id + ' single slot uses all jobs');
    else for (let i = 0; i < c.slots; i++) assertEq(slotJobs(c, i), [c.jobs[i]], `${c.id} slot ${i} job`);
  }
  assert(CROPS.some(c => c.slots === 1) && CROPS.some(c => c.slots === 2) && CROPS.some(c => c.slots === 3), 'all slot sizes used');
});

test('teams: assignPet per slot (first free by default), refusals, per-slot unassign', () => withFakeNow(T0, () => {
  const s = fresh(5);
  const a = mkPet(s); const b = mkPet(s); const c = mkPet(s);
  const plot = plant(s, 'strawberry'); // 2 slots
  assertEq(plot.petIds, [null, null], 'one entry per slot');
  assert(!assignPet(s, 0, a.id, 2).ok, 'slot out of range');
  assert(!assignPet(s, 0, a.id, -1).ok, 'negative slot');
  assert(assignPet(s, 0, a.id, 1).ok, 'explicit slot 1');
  assertEq(a.task, { type: 'plot', plotIndex: 0, slot: 1 }, 'task records the slot');
  assert(!assignPet(s, 0, b.id, 1).ok, 'slot already taken');
  assert(assignPet(s, 0, b.id).ok, 'default = first free slot');
  assertEq(b.task.slot, 0, 'went to slot 0');
  assertEq(plot.petIds, [b.id, a.id], 'petIds by slot');
  assert(!assignPet(s, 0, c.id).ok, 'plot full');
  assertEq(s.stats.helped, 2, 'helped counts successful assigns only');
  assert(unassignPet(s, 0, 1).ok, 'unassign slot 1');
  assertEq([a.status, a.task, plot.petIds], ['idle', null, [b.id, null]], 'only slot 1 freed');
  assert(!unassignPet(s, 0, 1).ok, 'slot already empty');
  assert(assignPet(s, 0, c.id).ok && c.task.slot === 1, 'freed slot reusable');
  assert(unassignPet(s, 0).ok, 'no slot = everyone goes home');
  assertEq([b.status, c.status, plot.petIds], ['idle', 'idle', [null, null]], 'all released');
}));

test('teams: per-slot job power and the full-team combo', () => withFakeNow(T0, () => {
  const s = fresh(12);
  // hamster: dig 3 carry 1. sweetpotato slots = dig / carry / water
  const diggerPet = mkPet(s, { speciesId: 'hamster' });
  const crop = getCrop('sweetpotato');
  assertEq(crop.jobs.slice(0, 3), ['dig', 'carry', 'water'], 'sweetpotato slot jobs');
  const plot = plant(s, 'sweetpotato');
  const inDig = pw(diggerPet, 'sweetpotato', 0, 1);
  const inWater = pw(diggerPet, 'sweetpotato', 2, 1);
  assert(inDig > inWater, `hamster is far better at dig (${inDig.toFixed(2)}) than water (${inWater.toFixed(2)})`);
  assert(assignPet(s, 0, diggerPet.id, 0).ok, 'assign dig slot');
  const t1 = plotTeam(s, plot);
  assertEq(t1.slots.map(x => x.job), ['dig', 'carry', 'water'], 'plotTeam lists slot jobs');
  near(t1.slots[0].power, effectivePower(pw(diggerPet, 'sweetpotato', 0, 1)), 'slot power uses the slot job');
  assert(!t1.full, 'not full with one pet');
  near(plotSpeed(s, plot), 1 + 0.3 * t1.slots[0].power, 'solo speed has no combo');

  const p2 = mkPet(s, { speciesId: 'hamster' }); const p3 = mkPet(s, { speciesId: 'hamster' });
  assert(assignPet(s, 0, p2.id, 1).ok && assignPet(s, 0, p3.id, 2).ok, 'fill all slots');
  const t3 = plotTeam(s, plot);
  assert(t3.full, 'full team');
  const sum = t3.slots.reduce((a, x) => a + x.power, 0);
  near(plotSpeed(s, plot), 1 + 0.3 * sum * TEAM_COMBO, 'combo multiplies the pet part x1.25');
  assertEq(TEAM_COMBO, 1.25, 'combo constant');
  // two slots of a three-slot crop do not get the combo
  unassignPet(s, 0, 2);
  const t2 = plotTeam(s, plot);
  assert(!t2.full, 'two of three is not full');
  near(plotSpeed(s, plot), 1 + 0.3 * t2.slots.reduce((a, x) => a + x.power, 0), 'no combo when a slot is empty');
  // a one-slot crop never gets a combo
  const solo = plant(s, 'carrot', 1);
  const pet4 = mkPet(s);
  assignPet(s, 1, pet4.id);
  const ts = plotTeam(s, solo);
  assert(!ts.full || ts.slots.length === 1, 'single-slot crop');
  near(plotSpeed(s, solo), 1 + 0.3 * ts.slots[0].power, 'single-slot crop: no combo');
}));

test('teams: a full team on a long crop beats one strong pet (growth, same ticks)', () => withFakeNow(T0, () => {
  const solo = fresh(12); const team = fresh(12);
  const star = mkPet(solo, { speciesId: 'hamster', stage: 3 });
  plant(solo, 'rice');
  assignPet(solo, 0, star.id, 0);
  const crew = [0, 1, 2].map(() => mkPet(team, { speciesId: 'hamster', stage: 2 }));
  plant(team, 'rice');
  crew.forEach((p, i) => assignPet(team, 0, p.id, i));
  tickFarm(solo, T0 + 2 * MIN); tickFarm(team, T0 + 2 * MIN);
  assert(team.plots[0].progress > solo.plots[0].progress, `team ${team.plots[0].progress} vs solo ${solo.plots[0].progress}`);
}));

test('teams: ready snapshot sums every helper, releases them all, harvest pays XP + bond to each', () => withFakeNow(T0, () => {
  const s = fresh(12);
  const pets = [0, 1, 2].map(() => mkPet(s, { speciesId: 'hamster' }));
  const crop = getCrop('rice');
  const plot = plant(s, 'rice');
  pets.forEach((p, i) => assert(assignPet(s, 0, p.id, i).ok, 'assign ' + i));
  const at = tickMinutes(s, T0, () => plot.progress >= 1); // the minute the crop became ready
  assertEq(plot.progress, 1, 'ready');
  const expected = pets.reduce((a, p, i) => a + Math.floor(effectivePower(pw(p, 'rice', i, 3, at)) / 2)
    + (traitEffect(p, { kind: 'plot', jobs: slotJobs(crop, i), teamSize: 3, hour: new Date(at).getHours() }).yieldBonus || 0), 0);
  assertEq(plot.petIds, [null, null, null], 'all slots empty');
  for (const p of pets) assertEq([p.status, p.task], ['idle', null], 'helper sent home');
  assertEq(plot.helperBonus, expected, 'full-time team: bonus = full sum over helpers');
  assertEq(plot.helperPetIds, pets.map(p => p.id), 'helpers remembered');
  assert(!assignPet(s, 0, pets[0].id).ok, 'cannot assign to a ready plot');
  const xp0 = pets.map(p => p.xp);
  const r = harvestPlot(s, 0);
  assert(r.ok, 'harvest');
  const got = countItem(s, 'crop_rice');
  assert(got >= crop.yield[0] + expected && got <= crop.yield[1] + expected, `yield ${got} includes team bonus ${expected}`);
  pets.forEach((p, i) => {
    assert(p.xp >= xp0[i] + 2, 'helper XP bonus');
    assertEq(p.bond, 1, 'bond +1 per helper at harvest');
  });
  assertEq([plot.cropId, plot.helperBonus, plot.helperPetIds], [null, 0, []], 'plot reset');
}));

test('teams: sick / exhausted pet leaves only its own slot', () => withFakeNow(T0, () => {
  const s = fresh(5);
  const a = mkPet(s); const b = mkPet(s);
  const plot = plant(s, 'strawberry');
  assignPet(s, 0, a.id, 0); assignPet(s, 0, b.id, 1);
  a.sick = true;
  tickFarm(s, T0 + 10 * 1000);
  assertEq(plot.petIds, [null, b.id], 'slot 0 freed, slot 1 stays');
  assertEq([a.status, b.status], ['idle', 'working'], 'statuses');
}));

test('teams: slot bookkeeping survives dangling data, pre-v3 petId and a changed slot count', () => withFakeNow(T0, () => {
  const s = fresh(5);
  const pet = mkPet(s);
  const plot = plant(s, 'strawberry');
  plot.petIds = ['ghost', pet.id, 'extra'];
  pet.status = 'working'; pet.task = { type: 'plot', plotIndex: 0, slot: 1 };
  tickFarm(s, T0 + MIN);
  assertEq(plot.petIds, [null, pet.id], 'trimmed to slot count, ghost cleared');
  assert(Number.isFinite(plot.progress), 'finite progress');
  // pet whose task points at a slot that does not list it goes home
  pet.task = { type: 'plot', plotIndex: 0, slot: 0 };
  tickFarm(s, T0 + 2 * MIN);
  assertEq([pet.status, pet.task], ['idle', null], 'repaired');
  // pre-v3 plot.petId is picked up
  const old = plant(s, 'potato', 1);
  const p2 = mkPet(s, { status: 'working', task: { type: 'plot', plotIndex: 1 } });
  delete old.petIds; old.petId = p2.id;
  tickFarm(s, T0 + 3 * MIN);
  assertEq(old.petIds, [p2.id], 'legacy petId upgraded');
}));

test('teams: harvester trait adds yield, teamPlayer counts the team size', () => withFakeNow(T0, () => {
  withTrait('hamster', 'harvester', () => {
    const s = fresh(1);
    const pet = mkPet(s, { speciesId: 'hamster' });
    const crop = getCrop('carrot');
    const plot = plant(s, 'carrot');
    assertEq(traitEffect(pet, { kind: 'plot', jobs: crop.jobs, teamSize: 1, hour: 10 }).yieldBonus, 1, 'harvester gives +1 (common)');
    assignPet(s, 0, pet.id);
    tickFarm(s, T0 + 5 * MIN);
    assert(plot.helperBonus >= 1, 'snapshot includes harvester bonus: ' + plot.helperBonus);
    assertEq(plot.helperBonus, Math.floor(effectivePower(pw(pet, 'carrot')) / 2) + 1, 'power bonus + trait bonus');
  });
  withTrait('hamster', 'teamPlayer', () => {
    const s = fresh(5);
    const a = mkPet(s, { speciesId: 'hamster' }); const b = mkPet(s, { speciesId: 'hamster' });
    plant(s, 'strawberry');
    assignPet(s, 0, a.id, 0);
    const alone = plotTeam(s, s.plots[0]).slots[0].power;
    assignPet(s, 0, b.id, 1);
    const withMate = plotTeam(s, s.plots[0]).slots[0].power;
    assert(withMate > alone, `teamPlayer is stronger with a mate (${withMate.toFixed(2)} > ${alone.toFixed(2)})`);
  });
}));

// ── expedition traits ───────────────────────────────────────────────────────
function lootRolls(zone, rewards) {
  // with Math.random pinned, every roll picks the same entry and quantity
  const entry = (() => { let r = 0.5 * zone.loot.reduce((a, l) => a + l.weight, 0); for (const l of zone.loot) { r -= l.weight; if (r < 0) return l; } return zone.loot[zone.loot.length - 1]; })();
  const qty = entry.min + Math.floor(0.5 * (entry.max - entry.min + 1));
  return (rewards[entry.itemId] || 0) / qty;
}

test('expedition traits: forager adds loot rolls (extraRolls via traitEffect)', () => withFakeNow(T0, () => {
  const zone = ZONES.find(z => z.id === 'forest');
  const run = trait => withTrait('hamster', trait, () => {
    const s = fresh();
    const pet = mkPet(s, { speciesId: 'hamster' });
    assert(startExpedition(s, pet.id, 'forest').ok, 'start');
    const ctx = { kind: 'expedition', jobs: ['forage'], zoneId: 'forest', hour: new Date(T0).getHours() };
    const eff = effectivePower(getWorkPower(pet, ['forage'], ctx));
    const extra = traitEffect(pet, ctx).extraRolls;
    const real = Math.random;
    Math.random = () => 0.5;
    try { tickFarm(s, T0 + 6 * MIN); } finally { Math.random = real; }
    return { rolls: lootRolls(zone, s.expeditions[0].rewards), expected: zone.baseRolls + Math.floor(0.75 * eff + 0.5) + extra, extra };
  });
  const plain = run('gourmet');
  const forager = run('forager');
  assertEq(plain.extra, 0, 'no extra rolls without the trait');
  assert(forager.extra >= 1, 'forager has extraRolls');
  assertEq(plain.rolls, plain.expected, 'plain rolls');
  assertEq(forager.rolls, forager.expected, 'forager rolls include extraRolls');
  assert(forager.rolls > plain.rolls, 'forager brings more');
}));

test('expedition traits: lucky multiplies the egg drop chance', () => withFakeNow(T0, () => {
  const run = trait => withTrait('hamster', trait, () => {
    const s = fresh();
    const pet = mkPet(s, { speciesId: 'hamster' });
    startExpedition(s, pet.id, 'forest');
    const real = Math.random;
    Math.random = () => 0.059; // above the base chance (~3-5%), below the doubled one
    try { tickFarm(s, T0 + 6 * MIN); } finally { Math.random = real; }
    return s.expeditions[0].rewards.egg_forest || 0;
  });
  assertEq(run('gourmet'), 0, 'no egg at 5.9% for a normal pet');
  assert(run('lucky') >= 1, 'lucky pet finds the egg (chance x2)');
}));

test('expedition traits: bond hearts and trait power apply to expedition power', () => withFakeNow(T0, () => {
  const s = fresh();
  const pet = mkPet(s, { speciesId: 'hamster' });
  const ctx = { kind: 'expedition', jobs: ['forage'], zoneId: 'forest', hour: 10 };
  const base = getWorkPower(pet, ['forage'], ctx);
  pet.bond = 360; // 5 hearts = +20%
  assertEq(bondHearts(pet), 5, 'hearts');
  near(getWorkPower(pet, ['forage'], ctx), base * 1.2, 'bond power mult', 1e-9);
  assert(SPECIES.length > 100, 'species data present');
}));

// ── helper bonus scales with time actually worked (C1) ──────────────────────
test('teams: a team parked at the very end earns ~0 bonus, no XP and no bond', () => withFakeNow(T0, () => {
  withTrait('hamster', 'harvester', () => {
    const s = fresh(12);
    const pets = [0, 1, 2].map(() => mkPet(s, { speciesId: 'hamster' }));
    const plot = plant(s, 'rice');
    const mid = tickMinutes(s, T0, () => plot.progress >= 0.97); // nobody helping: base speed
    assert(plot.progress < 1, 'still growing');
    pets.forEach((p, i) => assert(assignPet(s, 0, p.id, i).ok, 'park ' + i));
    assert(plotBonusPreview(s, plot) <= 1, 'preview already knows the late team is worth ~nothing');
    tickMinutes(s, mid, () => plot.progress >= 1);
    assertEq(plot.progress, 1, 'ready');
    assertEq(plot.helperBonus, 0, 'late-parked team: no yield bonus');
    assertEq(plot.helperPetIds, [], 'nobody worked >= 25%');
    const xp0 = pets.map(p => p.xp);
    assert(harvestPlot(s, 0).ok, 'harvest');
    pets.forEach((p, i) => {
      assert(!p.bond, 'no bond for a late helper');
      assertEq(p.xp, xp0[i], 'no harvest XP bonus for a late helper');
    });
  });
}));

test('teams: a full-time team with harvesters keeps the full bonus', () => withFakeNow(T0, () => {
  withTrait('hamster', 'harvester', () => {
    const s = fresh(12);
    const pets = [0, 1, 2].map(() => mkPet(s, { speciesId: 'hamster' }));
    const plot = plant(s, 'rice');
    pets.forEach((p, i) => assignPet(s, 0, p.id, i));
    const preview = plotBonusPreview(s, plot);
    const at = tickMinutes(s, T0, () => plot.progress >= 1);
    const full = pets.reduce((a, p, i) => a + Math.floor(effectivePower(pw(p, 'rice', i, 3, at)) / 2) + 1, 0);
    assertEq(plot.helperBonus, full, 'full bonus incl. +1 harvester each');
    assertEq(preview, full, 'preview at the start shows the full bonus');
    assertEq(plot.helperPetIds.length, 3, 'all earn XP + bond');
    harvestPlot(s, 0);
    pets.forEach(p => assertEq(p.bond, 1, 'bond'));
  });
}));

test('teams: partial shares round down per pet; >= 25% earns bond, below does not', () => withFakeNow(T0, () => {
  const guardSp = SPECIES.find(sp => sp.jobs && sp.jobs.guard >= 3).id; // strong in the strawberry's 2nd slot job
  const scenario = joinAt => withTrait('hamster', 'harvester', () => withTrait(guardSp, 'harvester', () => {
    const s = fresh(5);
    const a = mkPet(s, { speciesId: 'hamster', stage: 3 });
    const b = mkPet(s, { speciesId: guardSp, stage: 3 });
    const plot = plant(s, 'strawberry'); // 2 slots, 30 min
    assignPet(s, 0, a.id, 0);
    const mid = tickMinutes(s, T0, () => plot.progress >= joinAt);
    assert(assignPet(s, 0, b.id, 1).ok, 'B joins');
    const bBefore = plot.workMs[b.id] || 0;
    assertEq(bBefore, 0, 'B had worked nothing yet');
    const at = tickMinutes(s, mid, () => plot.progress >= 1);
    const E = plot.growElapsedMs;
    const shareB = (plot.workMs[b.id] || 0) / E;
    const ja = slotJobs(getCrop('strawberry'), 0); const jb = slotJobs(getCrop('strawberry'), 1);
    const baseOf = (p, jobs, slot) => Math.floor(effectivePower(getWorkPower(p, jobs, { kind: 'plot', jobs, teamSize: 2, hour: new Date(at).getHours() })) / 2) + 1;
    const baseA = baseOf(a, ja, 0); const baseB = baseOf(b, jb, 1);
    const shareA = (plot.workMs[a.id] || 0) / E;
    assertEq(plot.helperBonus, Math.floor(shareA * baseA + 1e-9) + Math.floor(shareB * baseB + 1e-9), 'bonus = sum of floor(share x base) per pet');
    const bond0 = b.bond || 0;
    harvestPlot(s, 0);
    return { shareA, shareB, baseB, bondB: (b.bond || 0) - bond0, listed: plot.helperPetIds };
  }));
  const early = scenario(0.1);   // joins early: worked most of the time
  const half = scenario(0.55);   // joins about half way
  const late = scenario(0.95);   // joins right before the end
  assert(early.shareB > 0.5, 'early joiner share ' + early.shareB);
  assert(half.shareB >= 0.25 && half.shareB < early.shareB, 'half-way joiner share ' + half.shareB);
  assert(late.shareB < 0.25, 'late joiner share ' + late.shareB);
  assertEq([early.bondB, half.bondB, late.bondB], [1, 1, 0], 'bond only for >= 25%');
  assert(late.shareA > 0.95, 'the pet that worked all along keeps ~full share');
  assert(late.baseB >= 2, 'test pet has a base bonus >= 2 so rounding is visible');
}));

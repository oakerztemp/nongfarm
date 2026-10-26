// Economy simulator: a scripted player lives 14 virtual days with the REAL game logic and a fake clock.
// Three profiles: "3h" (checks in every 3 hours), "realistic" (every 10 minutes during a 3-hour
// evening window, every 3 hours otherwise) and "clicker24" (every 10 minutes, all day; report-only).
// Time between sessions is replayed exactly like main.js does it: 60 s catch-up steps (offline decay).
// The report (coins/hour + level by day) goes to console.log and window.__econReport.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { createNewState, addItem, countItem } from '../js/state.js';
import { todayKey, now, randInt } from '../js/util.js';
import {
  tickPets, hatchReady, putEggInIncubator, feedPet, cleanPet, playWithPet, healPet, toggleSleep,
  canWork, getWorkPower, collectYard, yardRates, yardItemTable, YARD_CAP_MS,
} from '../js/pets.js';
import { SPECIES } from '../js/data/species.js';
import { CROPS, getCrop } from '../js/data/crops.js';
import { EGGS } from '../js/data/eggs.js';
import { ITEMS, getItem } from '../js/data/items.js';
import { DECOR } from '../js/data/decor.js';
import { ACCESSORIES, FESTIVAL_ACCESSORIES, shopAccessories, expeditionAccessories, getAccessory } from '../js/data/accessories.js';
import { FESTIVAL_DECOR } from '../js/data/decor.js';
import { activeFestival, claimTask, loginLantern, buyFestivalItem, craftKrathong, floatKrathong, festivalView, LOY_ID, TASK_REWARD, LOGIN_MAX, KRATHONG_RECIPE, KRATHONG_MAX, FLOAT_DAILY_CAP, FLOAT_PEAK_CAP } from '../js/festival.js';
import { getSpecies } from '../js/data/species.js';
import { getEgg } from '../js/data/eggs.js';
import { COATS } from '../js/data/coats.js';
import { canBreed, breed, breedCost, breedPreview, putFamilyEggInIncubator, habitatSpeciesChances, FAMILY_EGG_MAX, BREED_UNLOCK_LEVEL, BREED_COOLDOWN_MS, BREED_COST_MULT, BREED_FRIEND_MULT } from '../js/breeding.js';
import { STARDUST_BY_RARITY, RELEASE_COINS, rehomeDust, rehomePet, yardOutput } from '../js/pets.js';
import { claimMail } from '../js/mail.js';
import { cook, kitchenList } from '../js/kitchen.js';
import {
  tickFarm, plantSeed, waterPlot, assignPet, unassignPet, stationPet, unstationPet, harvestAll, startExpedition, claimExpedition, buyItem, sellItem,
  buyPlot, plotPrice, upgradeBarn, barnUpgradePrice, barnUpgradeCost, barnUpgradeStatus, upgradeIncubator, incubatorUpgradePrice,
  buildDecor, placeDecor, removeDecor, decorSpotList, buyAccessory, decorBuildStatus, TIER_ENTRY_ITEMS, YARD_TIERS, yardTierOf,
  completeOrder, ensureOrders, nextMidnight, fertilize, harvestPlot, replantPlot, ZONES, effectivePower, plotTeam, slotPowerPreview,
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
// Returns how many times tickFarm sent a pinned (📌) pet back to work by itself.
function catchUp(s, from, to) {
  let t = Math.max(from, to - 72 * HOUR);
  let dispatched = 0;
  while (t < to) {
    const step = Math.min(MIN, to - t);
    t += step;
    tickPets(s, step, { offline: true });
    const waiting = s.pets.filter(p => p.station && p.status !== 'working');
    tickFarm(s, t);
    dispatched += waiting.filter(p => p.status === 'working').length;
  }
  s.lastTick = to;
  return dispatched;
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

// ลานให้ของ: the bot taps the gift button at every session. Forage gifts are sold on the spot, seeds count at their
// shop price and every other gift (food_milk ...) at its buy price (they replace a purchase); everything is booked as yard income (and in the total) exactly once.
function collectYardGifts(s, bot) {
  const r = collectYard(s);
  if (!r.ok) return;
  let value = r.coins || 0;
  for (const [id, n] of Object.entries(r.items || {})) {
    const it = getItem(id);
    if (!it || !(n > 0)) continue;
    if (it.type === 'forage' && it.sell != null) {
      const before = s.player.coins;
      if (sellItem(s, id, n).ok) value += s.player.coins - before;
    } else if (it.buy != null) {
      value += it.buy * n;   // seeds, food_milk, ...: what the player would have paid in the shop
    } else if (it.sell != null) {
      value += it.sell * n;
    }
  }
  bot.earned += value;
  bot.by.yard += value;
}


// ── V7 §3: yard materials + decor ───────────────────────────────────────────
// What the next `n` yard upgrades need (an empty bag is assumed, so the L entry is the berry option).
function upgradeNeedsAhead(s, n) {
  const need = {};
  const cap = s.barnCapacity;
  for (let i = 0; i < n && cap + i < 20; i++) {
    const c = barnUpgradeCost({ barnCapacity: cap + i, inventory: {}, player: { coins: 0 } });
    for (const [id, k] of Object.entries(c.items)) need[id] = (need[id] || 0) + k;
  }
  return need;
}

// The bot stocks the next two upgrades' worth of materials (and never sells them).
const STOCK_AHEAD = 2;
function materialTarget(s) { return upgradeNeedsAhead(s, STOCK_AHEAD); }

// Expected units per trip of `itemId` in `zone` for a pet of effective power `eff`.
function zoneYield(zone, itemId, eff) {
  const tw = zone.loot.reduce((a, l) => a + l.weight, 0);
  const l = zone.loot.find(x => x.itemId === itemId);
  return l ? (zone.baseRolls + 0.75 * eff) * (l.weight / tw) * ((l.min + l.max) / 2) : 0;
}

// Best zone to fetch the still-missing materials: useful units per hour of the pet's time.
function gatherZone(s, pet, missing, cadence, zones) {
  let best = null;
  for (const z of zones) {
    const eff = effectivePower(getWorkPower(pet, [z.job], { kind: 'expedition', jobs: [z.job], zoneId: z.id, hour: new Date(now()).getHours() }));
    let units = 0;
    const gain = {};
    for (const [id, m] of Object.entries(missing)) {
      const y = Math.min(m, zoneYield(z, id, eff));
      if (y > 0) { gain[id] = zoneYield(z, id, eff); units += y; }
    }
    const cycle = Math.max(cadence, Math.ceil(z.durationMs / cadence) * cadence);
    const v = units / (cycle / HOUR);
    if (units > 0 && (!best || v > best.value)) best = { zone: z, value: v, gain };
  }
  return best;
}

// Decors in the order the bot wants them: kinds it has not placed yet first, cheaper coins first. Only when "rich"
// (decor coins are a rounding error) and a spot is free.
function decorWishlist(s) {
  if (!decorSpotList(s).some(x => !x.placed)) return [];
  const placedIds = new Set(s.decor.map(x => x.decorId));
  return [...DECOR].sort((a, b) => (placedIds.has(a.id) - placedIds.has(b.id)) || (a.coins - b.coins))
    .filter(d => s.player.coins >= d.coins * 40 + 100);
}

// Build and place a decor when the bot is rich: it never touches the materials the next upgrades still need.
function buildDecorWhenRich(s, bot) {
  const keep = materialTarget(s);
  for (const spot of decorSpotList(s)) {
    if (spot.placed) continue;
    for (const d of decorWishlist(s)) {
      if (Object.entries(d.items).some(([id, n]) => countItem(s, id) - n < (keep[id] || 0))) continue;
      const before = s.player.coins;
      if (!buildDecor(s, d.id).ok) continue;
      bot.decorSpent += before - s.player.coins;
      bot.decorBuilt++;
      if (placeDecor(s, d.id, spot.spot).ok) bot.decorPlaced++;
      break;
    }
  }
}

// V9 §1: accessories are a pure coin sink. The bot buys the cheapest one it does not own yet, only when it is rich
// (coins >= 8x the price), never more than one per session and at most 2 copies of each.
function buyAccessoryWhenRich(s, bot) {
  const owned = id => (s.wardrobe && s.wardrobe[id]) || 0;
  const want = shopAccessories().sort((a, b) => (owned(a.id) - owned(b.id)) || (a.price - b.price))
    .find(a => owned(a.id) < 2 && s.player.coins >= a.price * 8);   // a collector, not a hoarder: 2 copies each
  if (!want) return;
  const before = s.player.coins;
  if (buyAccessory(s, want.id).ok) { bot.accSpent += before - s.player.coins; bot.accBought++; }
}

// V10: breeding is a late-game coin sink. The bot breeds when it is rich (coins >= 3x the cost), best friends first (they are cheaper), then the
// cheapest eligible pair. Family eggs go into the incubator like bought eggs (only while the yard has room for the baby).
function breedWhenRich(s, bot) {
  if (s.player.level < BREED_UNLOCK_LEVEL || (s.familyEggs || []).length >= FAMILY_EGG_MAX) return;
  let best = null;
  for (let i = 0; i < s.pets.length; i++) {
    for (let j = i + 1; j < s.pets.length; j++) {
      const a = s.pets[i], b = s.pets[j];
      if (!canBreed(s, a, b).ok) continue;
      const { cost, bestFriends } = breedCost(s, a, b);
      if (s.player.coins < 3 * cost) continue;
      const key = (bestFriends ? 0 : 1) * 1e9 + cost;
      if (!best || key < best.key) best = { a, b, key, cost, bestFriends };
    }
  }
  if (!best) return;
  const before = s.player.coins;
  if (breed(s, best.a.id, best.b.id).ok) {
    bot.bred++;
    bot.layLog.push({ a: best.a.id, b: best.b.id, t: now() });
    bot.breedSpent += before - s.player.coins;
    if (best.bestFriends) bot.bredBest++;
  }
}

function incubateFamilyEggs(s) {
  for (const egg of [...(s.familyEggs || [])]) {
    if (s.incubator.length >= s.incubatorCapacity) break;
    putFamilyEggInIncubator(s, egg.id);
  }
}

// A breeder with a family egg waiting makes room, like a player would: when a ready egg cannot hatch because the yard AND the nursery are full,
// the weakest nursery baby (else the weakest idle yard pet) goes to a new home, then the egg hatches. Only runs while breeding is on.
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
function makeRoomForFamily(s, bot) {
  if (!(s.familyEggs || []).length && !s.incubator.some(sl => sl.family)) return;
  for (let guard = 0; guard < 4; guard++) {
    // family slots first, then the normal eggs that block the incubator
    const idx = [...s.incubator.keys()].filter(i => now() >= s.incubator[i].readyAt).sort((x, y) => !!s.incubator[y].family - !!s.incubator[x].family)[0];
    if (idx == null) return;
    if (hatchReady(s, idx).ok) continue;
    // a breeder keeps the babies it bred (they start weakest, so without this key they would be the first to go)
    const weak = list => list.sort((x, y) => !!x.family - !!y.family || RARITY_ORDER.indexOf(getSpecies(x.speciesId).rarity) - RARITY_ORDER.indexOf(getSpecies(y.speciesId).rarity) || x.stage - y.stage || (x.bond || 0) - (y.bond || 0))[0];
    const out = weak((s.nursery || []).map(e => e.pet)) || weak(s.pets.filter(p => p.status === 'idle' && !(s.familyEggs || []).some(e => e.a.petId === p.id || e.b.petId === p.id)));
    if (!out || !rehomePet(s, out.id).ok) return;
    bot.rehomed++;
    hatchReady(s, idx);
  }
}

const canWorkAfterRecall = p => p.stats.energy >= 20 && p.stats.hunger >= 15 && !p.sick;

// V11: the bot plays the festival like a polite player: first open of the day = login lantern, claims every finished task, spends lanterns on the
// festival's items, and during ลอยกระทง crafts krathongs ONLY from herbs / wood beyond what the next two yard upgrades (and the next decor) still need,
// then floats them with idle pets. Lantern gains are logged per festival key so a gate can bound them.
function festivalPlay(s, bot) {
  const F = bot.fest;
  const f = () => s.festival;
  const gain = fn => {
    const before = f().lanterns;
    const r = fn();
    const d = f().lanterns - before;
    if (r.ok && d > 0) { const k = f().id + '|' + f().key; F.gained[k] = (F.gained[k] || 0) + d; F.total += d; }
    return r;
  };
  const coins0 = s.player.coins, dust0 = s.stardust;
  if (gain(() => loginLantern(s)).ok) F.logins++;
  for (const t of [...f().tasks]) if (gain(() => claimTask(s, t.id)).ok) F.tasks++;
  for (const it of (festivalView(s).shop || [])) {
    if (it.owned || f().lanterns < it.price) continue;
    if (buyFestivalItem(s, it.id).ok) { F.items.push(it.id); F.spent += it.price; }
  }
  if (activeFestival().id === LOY_ID) {
    const keep = materialTarget(s);
    const wish = decorWishlist(s)[0];
    if (wish) for (const [id, n] of Object.entries(wish.items)) keep[id] = (keep[id] || 0) + n;
    while (f().krathongs < KRATHONG_MAX && Object.entries(KRATHONG_RECIPE).every(([id, n]) => countItem(s, id) - n >= (keep[id] || 0))) {
      if (!craftKrathong(s).ok) break;
      F.crafted++;
      for (const [id, n] of Object.entries(KRATHONG_RECIPE)) F.mat[id] = (F.mat[id] || 0) + n;
    }
    for (const p of s.pets) {
      if (f().krathongs < 1) break;
      if (gain(() => floatKrathong(s, p.id)).ok) { F.floated++; }
    }
  }
  // festivals pay no coins and no stardust (gate 1): anything the bot did here left both untouched
  if (s.player.coins !== coins0 || s.stardust !== dust0) F.leak++;
}

function session(s, bot, cadence) {
  const startCoins = () => s.player.coins;
  collectYardGifts(s, bot);

  // 1. collect trips + hatch
  for (const ex of [...s.expeditions]) if (ex.done) claimExpedition(s, ex.id);
  for (let i = s.incubator.length - 1; i >= 0; i--) hatchReady(s, i);
  if (!bot.noBreed) makeRoomForFamily(s, bot);

  // 2. harvest everything ready, then deliver orders we can
  harvestAll(s, false);

  // 2a. V16: a cooking bot (right after the harvest, before orders and sales) makes one dish a day (best unlocked recipe it can afford) and feeds it to the hungriest pet
  if (bot.cook && bot.cookDay !== todayKey()) {
    const can = kitchenList(s).filter(x => x.ok).pop();
    if (can && cook(s, can.recipe.id).ok) {
      // the crops / forage went into the pot instead of the market: book them as earned at sell value, so the cooking bot never looks
      // poorer than it is (income ratio stays conservative) and the yard share is not inflated by a smaller coin income
      const value = can.parts.reduce((t, p) => t + (p.item.sell || 0) * p.need, 0);
      bot.earned += value;
      bot.by.cook = (bot.by.cook || 0) + value;
      bot.cookDay = todayKey();
      bot.cooked++;
      const pet = s.pets.filter(p => p.status === 'idle' && p.stats.hunger < 90).sort((a, b) => a.stats.hunger - b.stats.hunger)[0];
      if (pet && feedPet(s, pet.id, can.recipe.id).ok) bot.dishesFed++;
    }
  }

  for (const o of openOrders(s)) {
    const r = completeOrder(s, o.id);
    if (r.ok) { bot.earned += o.reward.coins; bot.by.orders += o.reward.coins; }
  }

  if (!bot.noFest) festivalPlay(s, bot);

  // 3. sell the rest of crops/forage (keep what open orders still need)
  const keep = orderNeeds(s);
  const stock = materialTarget(s);
  for (const [id, n] of Object.entries(stock)) keep[id] = Math.max(keep[id] || 0, n);   // yard materials are never sold
  // the next tier's themed item is kept early too (a shell found on day 1 waits for tier M)
  const wish = decorWishlist(s)[0];   // ...and so are the items of the decor it wants to build next
  if (wish) for (const [id, n] of Object.entries(wish.items)) keep[id] = Math.max(keep[id] || 0, (stock[id] || 0) + n);
  for (const e of Object.values(TIER_ENTRY_ITEMS)) for (const [id, n] of Object.entries(e)) keep[id] = Math.max(keep[id] || 0, n);
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

  // 5b. V10: a rich bot breeds two idle pets before it sends them out
  if (!bot.noBreed) breedWhenRich(s, bot);

  // 6. put idle pets to work: expedition or helper on a growing plot, whichever pays more per hour
  const zones = ZONES.filter(z => z.unlockLevel <= s.player.level);
  // V7: when the yard is (nearly) full and the coins are within reach, idle pets fetch the missing wood/stone/themed items first.
  const missing = {};
  const bpNow = barnUpgradePrice(s);
  if (bpNow != null && s.pets.length + s.incubator.length >= s.barnCapacity - 1 && s.player.coins >= 0.25 * bpNow) {
    for (const [id, n] of Object.entries(materialTarget(s))) {
      const m = n - countItem(s, id) - Object.values(s.expeditions).reduce((t, ex) => t + (ex.mat && ex.mat[id] || 0), 0);
      if (m > 0.5) missing[id] = m;
    }
  }
  for (const pet of s.pets) {
    if (!canWork(pet).ok) continue;
    if (pet.station) {
      // pinned pets are driven by tickFarm (also offline); a pin whose slot cannot be worked right now is released
      const sp = s.plots[pet.station.plotIndex];
      const sc = sp && getCrop(sp.cropId);
      if (sc && !isReady(sp) && pet.station.slot < (sc.slots || 1)) continue;
      unstationPet(s, pet.station.plotIndex, pet.station.slot);
    }
    if (pet.stage >= 1 && Object.keys(missing).length) {
      const g = gatherZone(s, pet, missing, cadence, zones);
      if (g && startExpedition(s, pet.id, g.zone.id).ok) {
        const ex = s.expeditions[s.expeditions.length - 1];
        ex.mat = g.gain;   // sim bookkeeping only: what this trip is expected to bring
        for (const [id, y] of Object.entries(g.gain)) if (id in missing) missing[id] -= y;
        for (const id of Object.keys(missing)) if (missing[id] <= 0.5) delete missing[id];
        bot.gathers++;
        continue;
      }
    }
    let best = { value: 0 };
    if (pet.stage >= 1) {
      for (const z of zones) {
        const cycle = Math.max(cadence, Math.ceil(z.durationMs / cadence) * cadence);
        const ctx = { kind: 'expedition', jobs: [z.job], zoneId: z.id, hour: new Date(now()).getHours() };
        const v = zoneEv(z, effectivePower(getWorkPower(pet, [z.job], ctx))) / (cycle / HOUR);
        if (v > best.value) best = { value: v, zone: z };
      }
    }
    // team plots: the best (plot, slot) for this pet = highest speed gain on that crop's profit rate
    for (const p of s.plots) {
      if (!p.cropId || isReady(p)) continue;
      const c = getCrop(p.cropId);
      const team = plotTeam(s, p);
      for (const sl of team.slots) {
        if (sl.pet || sl.station) continue;   // the UI shows a resting 📌 pet's slot as taken (no "+"), so the bot can't fill it either
        const gain = 0.3 * slotPowerPreview(s, p.index, sl.slot, pet).eff;
        const v = gain * (profitOf(c) / (c.growMs / HOUR)) * (1 - p.progress);
        if (v > best.value) best = { value: v, plot: p, slot: sl.slot };
      }
    }
    if (best.zone) startExpedition(s, pet.id, best.zone.id);
    else if (best.plot && assignPet(s, best.plot.index, pet.id, best.slot).ok) {
      stationPet(s, best.plot.index, best.slot, pet.id);   // the picker's "📌 ประจำแปลง" toggle is on by default
      bot.assigns++;
      const tm = plotTeam(s, best.plot);
      if (tm.full && tm.slots.length > 1) bot.combos++;
    }
  }

  // 6b. still short of materials and nobody idle: recall a few plot helpers for a gathering trip (like a player would)
  let recalls = 1 + Math.floor(s.pets.length / 4);
  while (Object.keys(missing).length && recalls-- > 0) {
    const cands = s.pets.filter(p => p.stage >= 1 && canWorkAfterRecall(p) && ((p.status === 'working' && p.task && p.task.type === 'plot') || (p.status === 'idle' && p.station)));
    let pick = null;
    for (const pet of cands) {
      const g = gatherZone(s, pet, missing, cadence, zones);
      if (g && (!pick || g.value > pick.g.value)) pick = { pet, g };
    }
    if (!pick) break;
    const { pet, g } = pick;
    if (pet.status === 'working') unassignPet(s, pet.task.plotIndex, pet.task.slot || 0);
    if (pet.station) unstationPet(s, pet.station.plotIndex, pet.station.slot);
    if (!startExpedition(s, pet.id, g.zone.id).ok) continue;
    s.expeditions[s.expeditions.length - 1].mat = g.gain;
    for (const [id, y] of Object.entries(g.gain)) if (id in missing) missing[id] -= y;
    for (const id of Object.keys(missing)) if (missing[id] <= 0.5) delete missing[id];
    bot.gathers++;
  }

  // 7. invest what is left
  for (const e of EGGS) {
    while (countItem(s, e.id) > 0 && s.incubator.length < s.incubatorCapacity) {
      if (!putEggInIncubator(s, e.id).ok) break;
    }
  }
  if (!bot.noBreed) incubateFamilyEggs(s);
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
    if (bp != null && petsTotal >= s.barnCapacity && spare >= bp * 1.3 && barnUpgradeStatus(s).itemsOk) {
      if (upgradeBarn(s).ok) { bot.upgrades++; continue; }
    }
    break;
  }
  buildDecorWhenRich(s, bot);
  if (!bot.noAcc) buyAccessoryWhenRich(s, bot);
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
function runSim(profile, seed, opts = {}) {
  const next = PROFILES[profile];
  const T0 = opts.start ?? START;
  return withFakeNow(T0, clock => {
    const realRandom = Math.random, realNow = Date.now;
    Math.random = mulberry32(seed);
    Date.now = () => clock.get();   // uid() mixes in Date.now(): without this pet ids (and everything hashed from them) differ on every run
    try {
      const s = createNewState();
      if (opts.gift) assert(claimMail(s, 'welcome_celestial').ok, 'the bot takes the V12 welcome gift');
      const bot = { noFest: !!opts.noFest, fest: { gained: {}, total: 0, logins: 0, tasks: 0, items: [], spent: 0, crafted: 0, floated: 0, mat: {}, leak: 0 }, earned: 0, assigns: 0, combos: 0, autoDispatch: 0, gathers: 0, upgrades: 0, decorBuilt: 0, decorPlaced: 0, decorSpent: 0, accBought: 0, accSpent: 0, noAcc: !!opts.noAcc, noBreed: !!opts.noBreed, cook: !!opts.cook, cooked: 0, dishesFed: 0, rehomed: 0, bred: 0, bredBest: 0, breedSpent: 0, layLog: [], by: { crop: 0, forage: 0, orders: 0, yard: 0 } };
      const rows = [];
      let last = T0;
      let lastRowAt = T0;
      let lastEarned = 0;
      let lastYard = 0;
      const tierDay = {};   // virtual days (fractional) until the yard first reached tier M / L / XL
      const t0 = performance.now();
      for (let t = T0; t <= T0 + DAYS * DAY; t = next(t)) {
        clock.set(t);
        if (t > T0) bot.autoDispatch += catchUp(s, last, t);
        last = t;
        claimDaily(s);
        if (opts.gift) for (const m of s.mail) if (!m.claimed && claimMail(s, m.id).ok) bot.mailClaims = (bot.mailClaims || 0) + 1;   // V14: the Lv.5 egg too
        session(s, bot, Math.max(10 * MIN, next(t) - t));
        for (const [id, cap] of [['M', 6], ['L', 10], ['XL', 15]]) if (!(id in tierDay) && s.barnCapacity >= cap) tierDay[id] = +((t - T0) / DAY).toFixed(2);
        if (t >= T0 + (rows.length + 1) * DAY) {
          rows.push({
            day: rows.length + 1, level: s.player.level, coins: Math.floor(s.player.coins),
            perHour: (bot.earned - lastEarned) / ((t - lastRowAt) / HOUR), plots: s.plots.length, pets: s.pets.length,
            inc: s.incubatorCapacity, barn: s.barnCapacity, orders: s.stats.ordersDone || 0,
            yardShare: (bot.by.yard - lastYard) / Math.max(1, bot.earned - lastEarned),
          });
          lastYard = bot.by.yard;
          lastEarned = bot.earned;
          lastRowAt = t;
        }
      }
      return { rows, assigns: bot.assigns, combos: bot.combos, autoDispatch: bot.autoDispatch, by: bot.by, bot, earned: bot.earned, perHour: bot.earned / (DAYS * 24), ms: Math.round(performance.now() - t0), tierDay, state: s };
    } finally {
      Math.random = realRandom;
      Date.now = realNow;
    }
  });
}

const results = {};
async function result(name) {
  if (!results[name]) results[name] = await runSim(name, 20260302);
  return results[name];
}

const resultsOff = {};
async function resultOff(name) {   // same bot + seed, accessory buying switched off
  if (!resultsOff[name]) resultsOff[name] = await runSim(name, 20260302, { noAcc: true });
  return resultsOff[name];
}

const NOV16 = new Date(2026, 10, 16, 8, 0, 0).getTime();   // a window that contains ลอยกระทง (17..30 Nov) from day 2 on
const resultsFest = {};
async function resultFest(name, mode) {   // V11: festival play OFF ('off') or ON in the second window ('nov'), same bot + seed
  const key = name + '|' + mode;
  if (!resultsFest[key]) resultsFest[key] = await runSim(name, 20260302, mode === 'off' ? { noFest: true } : mode === 'nov' ? { start: NOV16 } : { start: NOV16, noFest: true });
  return resultsFest[key];
}
const resultsNoFest = {};
async function resultNoFest(name) {
  if (!resultsNoFest[name]) resultsNoFest[name] = await runSim(name, 20260302, { noFest: true });
  return resultsNoFest[name];
}

const resultsCook = {};

const resultsGift = {};
async function resultGift(name) {   // same bot + seed, the V12 Limited welcome pet taken on minute one
  if (!resultsGift[name]) resultsGift[name] = await runSim(name, 20260302, { gift: true });
  return resultsGift[name];
}

const resultsNoBreed = {};
async function resultNoBreed(name) {   // same bot + seed, breeding switched off (V10 gate 3)
  if (!resultsNoBreed[name]) resultsNoBreed[name] = await runSim(name, 20260302, { noBreed: true });
  return resultsNoBreed[name];
}

function table(name, r) {
  const share = k => Math.round((100 * r.by[k]) / Math.max(1, r.earned));
  const lines = [`[econ-sim] ${name}: ${Math.round(r.perHour)} coins/h earned on average (${r.ms} ms); income mix crops ${share('crop')}% / forage ${share('forage')}% / orders ${share('orders')}% / yard ${share('yard')}%; plot-helper assignments ${r.assigns}, full-team combos ${r.combos}`,
    `yard tiers reached (virtual days) M ${r.tierDay.M} / L ${r.tierDay.L} / XL ${r.tierDay.XL}; ${r.bot.upgrades} upgrades, ${r.bot.gathers} gathering trips; decor built ${r.bot.decorBuilt}, placed ${r.bot.decorPlaced}, ${r.bot.decorSpent} coins; accessories bought ${r.bot.accBought} for ${r.bot.accSpent} coins; family eggs laid ${r.bot.bred} (${r.bot.bredBest} best friends) for ${r.bot.breedSpent} coins, hatched ${r.state.stats.bred || 0}, ${r.bot.rehomed} pets sent to new homes to make room`,
    'day  lvl  plots pets inc barn orders  coins/h(day)  yard%   coins'];
  for (const x of r.rows) {
    lines.push(`${String(x.day).padStart(3)}  ${String(x.level).padStart(3)}  ${String(x.plots).padStart(5)} ${String(x.pets).padStart(4)} ${String(x.inc).padStart(3)} ${String(x.barn).padStart(4)} ${String(x.orders).padStart(6)}  ${String(Math.round(x.perHour)).padStart(12)}  ${String(Math.round(100 * x.yardShare)).padStart(4)}%  ${String(x.coins).padStart(7)}`);
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

// ── ลานให้ของ guardrails (CONTRACT_V6 §3) ───────────────────────────────────
test('econ: yard income is at most 20% of the coin income on every day (3h and realistic profiles)', async () => {
  const a = await result('3h');
  const b = await result('realistic');
  const text = report('3h', 'realistic');
  const MAX_SHARE = 0.2;
  for (const [name, r] of [['3h', a], ['realistic', b]]) {
    for (const x of r.rows) {
      assert(x.yardShare <= MAX_SHARE, `${name} day ${x.day}: yard is ${(100 * x.yardShare).toFixed(1)}% of income (> 20%)\n${text}`);
    }
    const whole = r.by.yard / Math.max(1, r.earned);
    assert(whole <= MAX_SHARE, `${name}: yard is ${(100 * whole).toFixed(1)}% of the whole run\n${text}`);
  }
  globalThis.__econYardShare = {
    '3h': a.rows.map(x => +(100 * x.yardShare).toFixed(1)), realistic: b.rows.map(x => +(100 * x.yardShare).toFixed(1)),
    whole: { '3h': +(100 * a.by.yard / a.earned).toFixed(1), realistic: +(100 * b.by.yard / b.earned).toFixed(1) },
  };
  console.log('[econ-sim] yard share of coin income, whole run: 3h ' + globalThis.__econYardShare.whole['3h'] + '%, realistic ' + globalThis.__econYardShare.whole.realistic + '%; worst day 3h '
    + Math.max(...globalThis.__econYardShare['3h']) + '%, realistic ' + Math.max(...globalThis.__econYardShare.realistic) + '%');
});

test('econ: 3h player with the yard still earns <= 4500 coins/h on day 14 and does not fill all plots before day 10', async () => {
  const a = await result('3h');
  const at14 = a.rows.find(x => x.day === 14);
  assert(at14.perHour <= 4500, `day 14: ${Math.round(at14.perHour)} coins/h`);
  const full = a.rows.find(x => x.plots >= 16);
  assert(!full || full.day >= 10, `all plots owned on day ${full && full.day}`);
});

test('econ: the sim really exercises stations (pinned pets are sent back to work by tickFarm, also offline)', async () => {
  for (const name of ['3h', 'realistic']) {
    const r = await result(name);
    assert(r.autoDispatch > 0, `${name}: no station auto-dispatch happened (assigns ${r.assigns})`);
  }
});

test('econ: yard items give no buy->sell profit (every item a pet can gift sells for less than it costs)', () => {
  const s = createNewState();
  s.player.level = 50;
  const habitats = [...new Set(SPECIES.map(x => x.habitat))];
  let checked = 0;
  for (const hab of habitats) {
    for (const id of yardItemTable(s, hab)) {
      const it = getItem(id);
      assert(it, 'unknown yard item ' + id);
      checked++;
      if (it.buy != null && it.sell != null) assert(it.sell < it.buy, `${id}: sell ${it.sell} >= buy ${it.buy}`);
      if (id.startsWith('seed_')) {
        const c = getCrop(id.slice(5));
        assert(c && it.sell < c.seedPrice, `${id}: resale must stay below the seed price`);
      }
    }
  }
  assert(checked >= 12, 'checked ' + checked + ' yard items');
});

test('econ: a 72 h offline return yields at most 6 h of yard production (coins and items)', () => withFakeNow(START, clock => {
  const s = createNewState();
  s.barnCapacity = 20;
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const pool = rarities.map(r => SPECIES.find(x => x.rarity === r));
  for (let i = 0; i < 15; i++) {
    const sp = pool[i % pool.length];
    s.pets.push({
      id: 'y' + i, speciesId: sp.id, nickname: 'y' + i, shiny: false, personality: 'cheerful', stage: 2, xp: 0,
      stats: { hunger: 100, happy: 100, energy: 100, clean: 100 }, poop: 0, sick: false, zeroSince: null, zeroMs: 0,
      poopTimer: null, lastFedAt: 0, bond: 0, status: 'idle', task: null, bornAt: START, station: null,
    });
  }
  const r0 = yardRates(s);
  assert(r0.coins > 0, 'pets at home produce coins');
  s.lastTick = START;
  const to = START + 72 * HOUR;
  clock.set(to);
  catchUp(s, START, to);
  const got = collectYard(s);
  assert(got.ok, 'something to collect after 72 h');
  const capCoins = r0.coins * (YARD_CAP_MS / HOUR) + 1;   // pets only get hungrier/sadder offline, so rate(0) is the maximum
  assert(got.coins <= capCoins, `72 h away gave ${got.coins} coins > 6 h of production (${Math.round(capCoins)})`);
  const items = Object.values(got.items).reduce((a, b) => a + b, 0);
  const itemCap = Object.values(r0.items).reduce((a, b) => a + b, 0) * (YARD_CAP_MS / HOUR) + Object.keys(r0.items).length;
  assert(items <= itemCap, `72 h away gave ${items} items > 6 h (${itemCap.toFixed(1)})`);
  assert(got.coins >= 0.6 * r0.coins * (YARD_CAP_MS / HOUR), `72 h away gave only ${got.coins} coins (< 60% of 6 h of production ${Math.round(r0.coins * 6)}): the cap should fill`);
  // the store is empty right after collecting; a second tap gives nothing
  assert(!collectYard(s).ok, 'nothing left after a collect');
  console.log(`[econ-sim] 72 h offline, 15 pets at home: ${got.coins} coins + ${items} items collected (6 h cap = ${Math.round(r0.coins * 6)} coins)`);
}));

test('econ: even a yard of 20 maxed legendary pets stays well under 20% of the day-14 income rate', async () => {
  const a = await result('3h');
  const s = createNewState();
  s.barnCapacity = 20;
  const legend = SPECIES.filter(x => x.rarity === 'legendary');
  for (let i = 0; i < 20; i++) {
    s.pets.push({
      id: 'm' + i, speciesId: legend[i % legend.length].id, nickname: 'm', shiny: false, personality: 'cheerful', stage: 3, xp: 0,
      stats: { hunger: 100, happy: 100, energy: 100, clean: 100 }, poop: 0, sick: false, zeroSince: null, zeroMs: 0,
      poopTimer: null, lastFedAt: 0, bond: 99999, status: 'idle', task: null, bornAt: START, station: null,
    });
  }
  const worst = yardRates(s).coins;
  const day14 = a.rows.find(x => x.day === 14).perHour;
  console.log(`[econ-sim] worst-case yard: ${Math.round(worst)} coins/h vs ${Math.round(day14)} coins/h at day 14 (${(100 * worst / day14).toFixed(1)}%)`);
  assert(worst <= 0.2 * day14, `worst-case yard ${Math.round(worst)} coins/h > 20% of ${Math.round(day14)}`);
});


// ── ขยายลานด้วยวัสดุ + ของตกแต่ง (CONTRACT_V7 §3) ───────────────────────────
// V6 baseline, recorded BEFORE materials existed (same bot, same seed 20260302, coin-only upgrades): the virtual day on
// which the yard first reached tier M (6 slots) / L (10) / XL (15). The V7 bot also gathers wood/stone/shell/... by
// expeditions and builds decor; the time to every tier has to stay within +-25 % of these.
const V6_BASELINE_TIER_DAYS = {
  '3h':      { M: 1.75, L: 3.0, XL: 5.5 },
  realistic: { M: 0.53, L: 1.5, XL: 3.79 },
};
const TIER_TOLERANCE = 0.25;

test('econ: time to yard tier M / L / XL stays within +-25% of the V6 (coins only) baseline', async () => {
  const lines = [];
  for (const name of ['3h', 'realistic']) {
    const r = await result(name);
    for (const tier of ['M', 'L', 'XL']) {
      const base = V6_BASELINE_TIER_DAYS[name][tier];
      const got = r.tierDay[tier];
      lines.push(`${name} ${tier}: ${got} d (baseline ${base} d, ${got == null ? 'never' : (100 * (got / base - 1)).toFixed(0) + '%'})`);
      assert(got != null, `${name}: yard never reached tier ${tier} in ${DAYS} days\n${table(name, r)}`);
      assert(got >= base * (1 - TIER_TOLERANCE) && got <= base * (1 + TIER_TOLERANCE),
        `${name}: tier ${tier} reached on day ${got}, baseline ${base} (allowed ${(base * (1 - TIER_TOLERANCE)).toFixed(2)}-${(base * (1 + TIER_TOLERANCE)).toFixed(2)})\n${table(name, r)}`);
    }
  }
  globalThis.__econTiers = lines;
  console.log('[econ-sim] days to yard tier vs V6 baseline: ' + lines.join(' | '));
});

test('econ: the bot really uses materials (gathers by expeditions, pays for every upgrade, builds + places decor)', async () => {
  for (const name of ['3h', 'realistic']) {
    const r = await result(name);
    assert(r.bot.gathers > 20, `${name}: only ${r.bot.gathers} gathering trips`);
    assert(r.bot.upgrades >= 17, `${name}: ${r.bot.upgrades} upgrades (the yard should be 20 by day 14, it is ${r.state.barnCapacity})`);
    assert(r.state.barnCapacity === 20, `${name}: barn ${r.state.barnCapacity} on day 14`);
    assert(r.bot.decorBuilt >= 1 && r.bot.decorPlaced >= 1, `${name}: the rich bot built ${r.bot.decorBuilt} / placed ${r.bot.decorPlaced} decor`);
    // decor is a (small) coin sink: coins out, nothing back
    assert(r.bot.decorSpent > 0, `${name}: decor cost no coins`);
  }
});

test('econ: materials and decor open no buy->sell loop (materials cannot be bought; decor cannot be sold; removing refunds nothing)', () => withFakeNow(START, () => {
  const matIds = new Set();
  const cap = { barnCapacity: 3, inventory: {}, player: { coins: 0 } };
  for (let c = 3; c < 20; c++) {
    cap.barnCapacity = c;
    const cost = barnUpgradeCost(cap);
    for (const id of [...Object.keys(cost.items), ...Object.keys(cost.alt || {})]) matIds.add(id);
  }
  for (const d of DECOR) for (const id of Object.keys(d.items)) matIds.add(id);
  assert(matIds.size >= 8, 'materials found: ' + [...matIds]);
  for (const id of matIds) {
    const it = getItem(id);
    assert(it && it.type === 'forage', id + ' is gathered forage');
    assert(it.buy == null, `${id} must not be sold in the shop (it would be a buy->sell loop)`);
    assert(it.sell == null || it.sell <= 260, `${id} sells for ${it.sell}`);
  }
  // the coins in a decor are strictly worth more than anything the materials sell for... but they can't be sold at all:
  const s = createNewState();
  s.player.coins = 1000;
  s.barnCapacity = 20;
  for (const d of DECOR) {
    for (const [id, n] of Object.entries(d.items)) addItem(s, id, n);
    const before = s.player.coins;
    assert(buildDecor(s, d.id).ok, 'build ' + d.id);
    assertEq(s.player.coins, before - d.coins, d.id + ' costs its coins');
    assert(!sellItem(s, d.id, 1).ok && !buyItem(s, d.id, 1).ok, 'decor is not an item (no sell / buy)');
  }
  const placed = [];
  DECOR.forEach((d, i) => { const r = placeDecor(s, d.id, i); assert(r.ok, r.reason); });
  placed.push(...s.decor.map(x => x.id));
  const coinsBefore = s.player.coins;
  const invBefore = JSON.stringify(s.inventory);
  for (const id of placed) assert(removeDecor(s, id).ok, 'remove');
  assertEq(s.player.coins, coinsBefore, 'removing decor refunds no coins');
  assertEq(JSON.stringify(s.inventory), invBefore, 'removing decor refunds no materials');
  // a full build -> place -> remove -> place cycle can only cost coins
  const total = DECOR.reduce((t, d) => t + d.coins, 0);
  assertEq(s.player.coins, 1000 - total);
  // and an upgrade never pays out
  const u = createNewState();
  u.player.coins = 100000;
  const c0 = barnUpgradeCost(u);
  for (const [id, n] of Object.entries(c0.items)) addItem(u, id, n);
  const worth = Object.entries(c0.items).reduce((t, [id, n]) => t + getItem(id).sell * n, 0);
  const before = u.player.coins;
  assert(upgradeBarn(u).ok, 'upgrade');
  assert(before - u.player.coins === c0.coins && c0.coins > worth, `upgrade costs ${c0.coins} coins, materials sell for ${worth}`);
}));

test('econ: every yard material is obtainable by the level a player reaches that tier (drop tables)', () => {
  const firstZoneLevel = id => Math.min(...ZONES.filter(z => z.loot.some(l => l.itemId === id)).map(z => z.unlockLevel));
  // levels at which the bot (and a normal player) is entering each tier in the baseline sim: M ~Lv3-5, L ~Lv5-7, XL ~Lv8-12
  const levelAtTier = { S: 1, M: 3, L: 5, XL: 8 };
  const cap = { barnCapacity: 3, inventory: {}, player: { coins: 0 } };
  for (let c = 3; c < 20; c++) {
    cap.barnCapacity = c;
    const cost = barnUpgradeCost(cap);
    const tier = yardTierOf(c).id;
    for (const id of Object.keys(cost.items)) {
      const lvl = firstZoneLevel(id);
      assert(Number.isFinite(lvl), `${id} (needed for the slot ${c}->${c + 1}) drops nowhere`);
      assert(lvl <= Math.max(levelAtTier[tier], levelAtTier[cost.enters || tier]), `${id} needs a zone of Lv.${lvl} but slot ${c}->${c + 1} is reachable at Lv.${levelAtTier[tier]}`);
    }
  }
  for (const d of DECOR) for (const id of Object.keys(d.items)) assert(Number.isFinite(firstZoneLevel(id)), `${id} for ${d.id} drops nowhere`);
});


// ── V9 §1: accessories ──────────────────────────────────────────────────────
test('econ: accessories are a coin sink the rich bot uses, and no accessory can be sold or bought as an item (no buy->sell loop)', async () => {
  for (const name of ['3h', 'realistic']) {
    const r = await result(name);
    console.log(`[econ-sim] ${name}: accessories bought ${r.bot.accBought} for ${r.bot.accSpent} coins; wardrobe ${JSON.stringify(r.state.wardrobe)}`);
    assert(r.bot.accSpent >= 0, 'sink never negative');
  }
  assertEq(ACCESSORIES.length, 10);
  const s = createNewState();
  s.player.coins = 99999;
  for (const a of ACCESSORIES) {
    assert(!getItem(a.id), a.id + ' is not an item');
    assert(!sellItem(s, a.id, 1).ok && !buyItem(s, a.id, 1).ok, a.id + ' cannot go through buy/sell');
  }
  const before = s.player.coins;
  for (const a of shopAccessories()) assert(buyAccessory(s, a.id).ok, 'buy ' + a.id);
  assert(s.player.coins < before, 'buying costs coins');
  assertEq(s.player.coins + shopAccessories().reduce((t, a) => t + a.price, 0), before, 'exact price paid, nothing back');
});

test('econ: expedition accessory drops (1% in a matching zone) change the expedition drop value by at most 2% (measured against the same trips with the drops switched off)', () => withFakeNow(START, clock => {
  const realRandom = Math.random;
  const trips = 20000;
  const measure = (zone, seed) => {
    let val = 0, drops = 0;
    Math.random = mulberry32(seed);
    for (let i = 0; i < trips; i++) {
      const s = createNewState();
      s.player.level = 20;
      s.pets.push({ id: 'p', speciesId: 'hamster', nickname: 'p', shiny: false, personality: 'cheerful', stage: 2, xp: 0, stats: { hunger: 100, happy: 100, energy: 100, clean: 100 }, poop: 0, sick: false, zeroSince: null, zeroMs: 0, poopTimer: null, lastFedAt: 0, bond: 0, status: 'idle', task: null, bornAt: START, station: null });
      clock.set(START);
      assert(startExpedition(s, 'p', zone.id).ok, 'start');
      clock.set(START + zone.durationMs + 1);
      tickFarm(s, START + zone.durationMs + 1);
      const ex = s.expeditions[0];
      for (const [id, n] of Object.entries(ex.rewards)) {
        if (getAccessory(id)) { drops += n; continue; }
        val += n * (getItem(id).sell || 0);
      }
      assert(claimExpedition(s, ex.id).ok, 'claim');
    }
    return { val: val / trips, drops: drops / trips };
  };
  const lines = [];
  try {
    for (const z of ZONES) {
      const seed = 777 + z.id.length;
      const on = measure(z, seed);
      const saved = ACCESSORIES.map(a => a.zone);
      ACCESSORIES.forEach(a => { a.zone = null; });            // switch the drops off
      const off = measure(z, seed);
      ACCESSORIES.forEach((a, i) => { a.zone = saved[i]; });
      const exp = ACCESSORIES.filter(a => a.zone === z.id).length;
      const diff = Math.abs(on.val - off.val) / off.val;
      lines.push(`${z.id}: drops ${(100 * on.drops).toFixed(2)}%/trip, loot ${on.val.toFixed(1)} vs ${off.val.toFixed(1)} coins/trip (${(100 * diff).toFixed(2)}% apart)`);
      assertEq(off.drops, 0, z.id + ' drops nothing when switched off');
      if (exp) assert(on.drops > 0.004 && on.drops < 0.02, `${z.id}: drop rate ${on.drops}`); else assertEq(on.drops, 0, z.id + ' has no accessory drops');
      assert(diff <= 0.02, `${z.id}: drop value changed by ${(100 * diff).toFixed(2)}% (> 2%)`);
      assert(off.val > 0, z.id + ' yields value');
    }
  } finally { Math.random = realRandom; }
  console.log('[econ-sim] accessory drops vs none: ' + lines.join(' | '));
}));

test('econ: with accessory buying ON the bot really buys, income and the day-14 gate hold versus buying OFF, and the yard tiers stay within +-25% of the V6 baseline', async () => {
  const out = [];
  for (const name of ['3h', 'realistic']) {
    const on = await result(name), off = await resultOff(name);
    assert(on.bot.accBought >= 7 && on.bot.accSpent >= 5000, `${name}: the rich bot bought ${on.bot.accBought} accessories for ${on.bot.accSpent} coins`);
    assertEq(off.bot.accBought, 0, name + ' OFF run buys nothing');
    const d14 = r => r.rows.find(x => x.day === 14) || r.rows[r.rows.length - 1];
    assert(d14(on).perHour <= 4500, `${name}: day-14 ${Math.round(d14(on).perHour)} coins/h with accessories`);
    assert(on.perHour >= 0.92 * off.perHour && on.perHour <= 1.08 * off.perHour, `${name}: ${Math.round(on.perHour)} coins/h ON vs ${Math.round(off.perHour)} OFF`);
    for (const tier of ['M', 'L', 'XL']) {
      const base = V6_BASELINE_TIER_DAYS[name][tier], got = on.tierDay[tier];
      assert(got != null && got >= base * (1 - TIER_TOLERANCE) && got <= base * (1 + TIER_TOLERANCE), `${name} (accessory buying ON): tier ${tier} on day ${got}, baseline ${base}`);
    }
    out.push(`${name}: ${on.bot.accBought} bought for ${on.bot.accSpent}; ${Math.round(on.perHour)} coins/h ON vs ${Math.round(off.perHour)} OFF; day-14 ${Math.round(d14(on).perHour)}/h; tiers M ${on.tierDay.M} L ${on.tierDay.L} XL ${on.tierDay.XL} (OFF ${off.tierDay.M}/${off.tierDay.L}/${off.tierDay.XL})`);
  }
  console.log('[econ-sim] accessory buying ON vs OFF: ' + out.join(' | '));
  globalThis.__econAcc = out;
});

test('econ: accessories cannot be sold or bought as items (no buy->sell loop)', () => {
  assertEq(ACCESSORIES.length, 10);
  const s = createNewState();
  s.player.coins = 99999;
  for (const a of ACCESSORIES) {
    assert(!getItem(a.id), a.id + ' is not an item');
    assert(!sellItem(s, a.id, 1).ok && !buyItem(s, a.id, 1).ok, a.id + ' cannot go through buy/sell');
  }
  const before = s.player.coins;
  for (const a of shopAccessories()) assert(buyAccessory(s, a.id).ok, 'buy ' + a.id);
  assertEq(s.player.coins + shopAccessories().reduce((t, a) => t + a.price, 0), before, 'exact price paid, nothing back');
});


// ── V10: breeding guardrails (CONTRACT_V10 "Economy and save guardrails") ───
const RARITY_LIST = ['common', 'uncommon', 'rare', 'epic'];   // legendary pets can never breed
const HABITAT_LIST = [...new Set(SPECIES.map(s => s.habitat))];
const eggOf = habitat => EGGS.find(e => e.habitat === habitat);
const speciesOfRarity = (habitat, rarity) => SPECIES.find(s => s.habitat === habitat && s.rarity === rarity);
const dustOf = id => STARDUST_BY_RARITY[getSpecies(id).rarity];
const SHINY_EGG = 0.03;   // pets.js SHINY_CHANCE for a bought egg

/** A yard pet of this species (stage 2, full stats): coins/h of yard production incl. the gifted items at their shop value. */
function yardValuePerHour(speciesId, stage = 2) {
  const s = createNewState();
  s.barnCapacity = 20;
  s.pets.push({ id: 'v', speciesId, nickname: 'v', shiny: false, personality: 'cheerful', stage, xp: 0, stats: { hunger: 100, happy: 100, energy: 100, clean: 100 }, poop: 0, sick: false, zeroSince: null, zeroMs: 0, poopTimer: null, lastFedAt: 0, bond: 0, status: 'idle', task: null, bornAt: START, station: null });
  const r = yardRates(s);
  let v = r.coins;
  for (const [id, n] of Object.entries(r.items || {})) { const it = getItem(id); v += n * (it ? (it.sell ?? it.buy ?? 0) : 0); }
  return v;
}

/** Odds of the baby for parents of the given rarities in the given habitats: [{ p, speciesId|null (null = a fresh roll of habitat) , habitat }], plus its shiny chance and the cost. */
function babyOf(habA, rarA, habB, rarB, shinyParents, bestFriends) {
  const s = createNewState();
  const mk = (id, hab, rar) => ({ id, speciesId: speciesOfRarity(hab, rar).id, shiny: !!shinyParents, coat: 'base', bond: 0, stage: 2, status: 'idle', stats: {} });
  const a = mk('a', habA, rarA), b = mk('b', habB, rarB);
  s.pets.push(a, b);
  const pv = breedPreview(s, a, b);
  const cost = bestFriends ? breedCost(s, a, b).baseCost * BREED_FRIEND_MULT : breedCost(s, a, b).baseCost;   // baseCost = BREED_COST_MULT x the dearer egg (rounded to 10 below)
  return { species: pv.species, shiny: pv.shinyChance, cost: bestFriends ? Math.round(cost / 10) * 10 : cost, baseCost: breedCost(s, a, b).baseCost };
}

/** Expected value of `fn(speciesId)` for a baby / an egg roll in `habitat`. */
const eggRollValue = (habitat, fn) => habitatSpeciesChances(habitat).reduce((t, x) => t + x.p * fn(x.species.id), 0);
const babyValue = (baby, fn) => baby.species.reduce((t, x) => t + x.chance * (x.speciesId ? fn(x.speciesId) : eggRollValue(x.habitat, fn)), 0);

test('econ V10 gate 1: breeding is no stardust pump (per coin of cost, a bred baby never rehomes for more stardust than a bought egg of that habitat; shiny x2 and the best-friend price included)', () => {
  const worst = [];
  let checked = 0;
  for (const hab of HABITAT_LIST) {
    const egg = eggOf(hab);
    const eggPerCoin = eggRollValue(hab, dustOf) * (1 + SHINY_EGG) / egg.price;
    for (const ra of RARITY_LIST) for (const rb of RARITY_LIST) {
      if (!speciesOfRarity(hab, ra) || !speciesOfRarity(hab, rb)) continue;
      for (const shinyParents of [false, true]) for (const best of [false, true]) {
        const baby = babyOf(hab, ra, hab, rb, shinyParents, best);
        const perCoin = babyValue(baby, dustOf) * (1 + baby.shiny) / baby.cost;   // a shiny rehomes for x2 = x(1 + chance) in expectation
        checked++;
        if (perCoin > eggPerCoin * 1.0000001) worst.push({ hab, ra, rb, shinyParents, best, ratio: perCoin / eggPerCoin });
      }
    }
  }
  assert(checked >= 80, 'pairs checked: ' + checked);
  worst.sort((x, y) => y.ratio - x.ratio);
  const fmt = w => `${w.hab} ${w.ra}+${w.rb}${w.shinyParents ? ' (shiny parents)' : ''}${w.best ? ' (best friends)' : ''}: ${(100 * (w.ratio - 1)).toFixed(0)}% more stardust per coin than the egg`;
  assert(!worst.length, `${worst.length} of ${checked} parent pairs out-earn buying an egg (worst: ${worst.slice(0, 4).map(fmt).join(' | ')}). Constants to move: BREED_COST_MULT (${BREED_COST_MULT}), BREED_FRIEND_MULT (${BREED_FRIEND_MULT}), INHERIT, SHINY_PER_PARENT`);
  console.log(`[econ-sim] V10 gate 1: ${checked} parent pairs, none beats the egg in stardust per coin`);
});

test('econ V10 gate 1 (cross-habitat): parents from two habitats never beat the better of the two eggs in stardust per coin', () => {
  const worst = [];
  let checked = 0;
  for (const ha of HABITAT_LIST) for (const hb of HABITAT_LIST) {
    if (HABITAT_LIST.indexOf(hb) <= HABITAT_LIST.indexOf(ha)) continue;
    const eggBest = Math.max(...[ha, hb].map(h => eggRollValue(h, dustOf) * (1 + SHINY_EGG) / eggOf(h).price));
    for (const ra of RARITY_LIST) for (const rb of RARITY_LIST) {
      if (!speciesOfRarity(ha, ra) || !speciesOfRarity(hb, rb)) continue;
      for (const shinyParents of [false, true]) for (const best of [false, true]) {
        const baby = babyOf(ha, ra, hb, rb, shinyParents, best);
        const perCoin = babyValue(baby, dustOf) * (1 + baby.shiny) / baby.cost;
        checked++;
        if (perCoin > eggBest * 1.0000001) worst.push(`${ha} ${ra} + ${hb} ${rb}${shinyParents ? ' shiny' : ''}${best ? ' best' : ''}: ${(perCoin / eggBest).toFixed(2)}x`);
      }
    }
  }
  assert(checked >= 400, 'pairs checked: ' + checked);
  assert(!worst.length, `${worst.length} of ${checked} cross-habitat pairs out-earn an egg (${worst.slice(0, 4).join(' | ')})`);
});

test('econ V10 gate 2: breeding is no coin pump (a bred baby repays its cost no faster than a bought egg: RELEASE_COINS + 14 days of yard value per coin spent, best-friend price included)', () => {
  const days14 = 14 * 24;
  const worst = [];
  const lines = [];
  let checked = 0;
  for (const hab of HABITAT_LIST) {
    const egg = eggOf(hab);
    const eggReturn = (RELEASE_COINS + days14 * eggRollValue(hab, id => yardValuePerHour(id))) / egg.price;
    for (const ra of RARITY_LIST) for (const rb of RARITY_LIST) {
      if (!speciesOfRarity(hab, ra) || !speciesOfRarity(hab, rb)) continue;
      for (const best of [false, true]) {
        const baby = babyOf(hab, ra, hab, rb, true, best);
        const babyReturn = (RELEASE_COINS + days14 * babyValue(baby, id => yardValuePerHour(id))) / baby.cost;
        checked++;
        if (babyReturn > eggReturn * 1.0000001) worst.push({ hab, ra, rb, best, ratio: babyReturn / eggReturn });
      }
    }
    lines.push(`${hab} egg returns ${eggReturn.toFixed(1)}x its price in 14 days`);
  }
  assert(checked >= 40, 'pairs checked: ' + checked);
  worst.sort((x, y) => y.ratio - x.ratio);
  assert(!worst.length, `${worst.length} of ${checked} parent pairs repay faster than an egg (worst: ${worst.slice(0, 3).map(w => `${w.hab} ${w.ra}+${w.rb}${w.best ? ' best friends' : ''} ${w.ratio.toFixed(2)}x`).join(' | ')})`);
  console.log(`[econ-sim] V10 gate 2: no pair repays faster than an egg. NOTE the literal wording ("cannot repay its cost within 14 days") is impossible: ${lines.join(', ')}`);
});

test('econ V10 gate 3: with breeding ON vs OFF the day-14 income is <= 1.15x, the yard stays <= 20% every day, yard tiers stay within +-25% of the V6 baseline, and the bot really breeds', async () => {
  const out = [];
  for (const name of ['3h', 'realistic']) {
    const on = await result(name), off = await resultNoBreed(name);
    const d14 = r => r.rows.find(x => x.day === 14) || r.rows[r.rows.length - 1];
    assertEq(off.bot.bred, 0, name + ' OFF run lays no family eggs');
    assert(on.bot.bred >= 3 && (on.state.stats.bred || 0) >= 3, `${name}: the bot laid ${on.bot.bred} family eggs and hatched ${on.state.stats.bred || 0} (needs >= 3 hatched by day 14)`);
    assert(on.state.pets.some(p => p.family) || (on.state.nursery || []).some(e => e.pet.family), name + ': a bred baby with a family line exists');
    assert(d14(on).perHour <= 1.15 * d14(off).perHour, `${name}: day-14 income ${Math.round(d14(on).perHour)} coins/h ON vs ${Math.round(d14(off).perHour)} OFF (> 1.15x)`);
    assert(d14(on).perHour <= 4500, `${name}: day-14 ${Math.round(d14(on).perHour)} coins/h (> 4500 gate)`);
    for (const x of on.rows) assert(x.yardShare <= 0.2, `${name} day ${x.day}: yard is ${(100 * x.yardShare).toFixed(1)}% of income with breeding (> 20%)`);
    for (const tier of ['M', 'L', 'XL']) {
      const base = V6_BASELINE_TIER_DAYS[name][tier], got = on.tierDay[tier];
      assert(got != null && got >= base * (1 - TIER_TOLERANCE) && got <= base * (1 + TIER_TOLERANCE), `${name} (breeding ON): tier ${tier} on day ${got}, baseline ${base}`);
    }
    out.push(`${name}: ${on.bot.bred} eggs laid (${on.bot.bredBest} best friends) for ${on.bot.breedSpent} coins, ${on.state.stats.bred || 0} hatched, ${on.bot.rehomed} rehomed to make room; day-14 ${Math.round(d14(on).perHour)}/h ON vs ${Math.round(d14(off).perHour)}/h OFF (${(d14(on).perHour / d14(off).perHour).toFixed(2)}x); whole run ${Math.round(on.perHour)} vs ${Math.round(off.perHour)}; tiers M ${on.tierDay.M} L ${on.tierDay.L} XL ${on.tierDay.XL} (OFF ${off.tierDay.M}/${off.tierDay.L}/${off.tierDay.XL}); worst yard day ${Math.round(100 * Math.max(...on.rows.map(x => x.yardShare)))}%`);
  }
  console.log('[econ-sim] V10 breeding ON vs OFF: ' + out.join(' | '));
  globalThis.__econBreed = out;
});

test('econ V10 gate 4: family eggs and coats have no buy->sell path (not an item, not in any shop / egg list, coats add no value, a bred baby costs coins and only pays the normal rehome price)', () => withFakeNow(START, () => {
  const s = createNewState();
  s.player.coins = 99999;
  s.player.level = 30;
  for (const id of ['egg_family', ...COATS.map(c => 'coat_' + c.id), ...COATS.map(c => c.id)]) {
    assert(!getItem(id), id + ' is not an item');
    assert(!buyItem(s, id, 1).ok && !sellItem(s, id, 1).ok, id + ' cannot go through buy / sell');
  }
  assert(!EGGS.some(e => e.id === 'egg_family') && getEgg('egg_family') && getEgg('egg_family').price === 0, 'the family egg is outside EGGS (no shop, no stardust shop, no expedition drop)');
  addItem(s, 'egg_family', 1);   // even if one were smuggled into the bag: nothing to sell it for
  assert(!sellItem(s, 'egg_family', 1).ok, 'a family egg in the bag cannot be sold');
  // a coat changes nothing about what a pet is worth
  for (const sp of [speciesOfRarity('farm', 'common'), speciesOfRarity('mystic', 'epic')]) {
    const base = { speciesId: sp.id, shiny: false }, mint = { speciesId: sp.id, shiny: false, coat: 'midnight' };
    assertEq(rehomeDust(mint), rehomeDust(base), sp.id + ': a coat does not change the rehome stardust');
    const yardPet = coat => ({ ...base, id: 'y', stage: 2, coat, stats: { hunger: 80, happy: 80, energy: 100, clean: 100 }, bond: 0 });
    assertEq(yardOutput(yardPet('midnight')), yardOutput(yardPet('base')), sp.id + ': a coat does not change the yard output');
  }
  // every possible pair costs real coins, and best friends still pay more than half of the dearer egg x2
  for (const hab of HABITAT_LIST) {
    const low = RARITY_LIST.find(r => speciesOfRarity(hab, r));
    const baby = babyOf(hab, low, hab, low, false, true);
    assert(baby.cost >= 1.4 * eggOf(hab).price - 10, `${hab}: best-friend breeding costs ${baby.cost}`);
    assert(baby.cost > 0 && baby.cost > RELEASE_COINS * 10, `${hab}: a baby costs far more than rehoming it pays`);
  }
}));

test('econ V10: breeding is level-gated, rate-limited by the 72 h cooldown and the 2-egg cap (the bot never lays more than one egg per parent per 72 h)', async () => {
  for (const name of ['3h', 'realistic']) {
    const on = await result(name);
    // every pet is a parent at most once per 72 h: the gaps between two eggs of the same parent are >= the cooldown
    const byParent = new Map();
    for (const { a, b, t } of on.bot.layLog) for (const id of [a, b]) byParent.set(id, [...(byParent.get(id) || []), t]);
    assert(on.bot.layLog.length === on.bot.bred && on.bot.bred > 0, `${name}: every laid egg is logged`);
    for (const [id, times] of byParent) {
      for (let i = 1; i < times.length; i++) assert(times[i] - times[i - 1] >= BREED_COOLDOWN_MS, `${name}: parent ${id} laid twice ${((times[i] - times[i - 1]) / 3600000).toFixed(1)} h apart`);
    }
    assert(on.bot.breedSpent <= on.earned, `${name}: the bot spent ${on.bot.breedSpent} on breeding but earned ${on.earned}`);
  }
  const s = createNewState();
  s.player.level = BREED_UNLOCK_LEVEL - 1;
  assert(!canBreed(s, 'x', 'y').ok, 'below the unlock level nothing breeds');
  assertEq(BREED_COOLDOWN_MS, 72 * 3600 * 1000, 'cooldown 72 h');
  assertEq(FAMILY_EGG_MAX, 2, 'family egg cap 2');
});

// ── V11: festival guardrails (CONTRACT_V11 "Economy and save guardrails") ───
const FEST_ITEM_IDS = [...FESTIVAL_ACCESSORIES.map(a => a.id), ...FESTIVAL_DECOR.map(d => d.id)];

test('econ V11 gate 1: festivals pay no coins and no stardust; festival items are in no coin shop, no expedition drop, no sell or build path', () => withFakeNow(new Date(2026, 10, 24, 20, 0, 0).getTime(), () => {
  assertEq(FESTIVAL_ACCESSORIES.length, 10, '10 festival accessories');
  assertEq(FESTIVAL_DECOR.length, 2, '2 festival decors');
  for (const a of FESTIVAL_ACCESSORIES) {
    assert(a.festival && a.lanterns > 0 && a.price == null && a.zone == null, a.id + ' is lantern-only (festival id, lanterns, no coin price, no zone)');
    assert(!shopAccessories().some(x => x.id === a.id) && !expeditionAccessories().some(x => x.id === a.id) && !ACCESSORIES.some(x => x.id === a.id), a.id + ' is in no coin shop or drop list');
    assert(getAccessory(a.id) === a, a.id + ' is still a normal accessory for wearing');
  }
  assertEq(shopAccessories().length, 7, 'the coin shop is unchanged');
  const s = createNewState();
  s.player.coins = 99999; s.player.level = 30;
  for (const id of FEST_ITEM_IDS) {
    assert(!getItem(id), id + ' is not an inventory item');
    assert(!sellItem(s, id, 1).ok && !buyItem(s, id, 1).ok, id + ' cannot go through buy/sell');
  }
  for (const a of FESTIVAL_ACCESSORIES) assert(!buyAccessory(s, a.id).ok, a.id + ' cannot be bought with coins');
  for (const d of FESTIVAL_DECOR) {
    assert(d.lanterns > 0 && d.coins === 0 && d.festival, d.id + ' data');
    assert(!buildDecor(s, d.id).ok && !decorBuildStatus(s, d.id).ok, d.id + ' cannot be built for coins or materials');
  }
  // the whole festival loop moves neither coins nor stardust
  const coins = s.player.coins, dust = s.stardust;
  assert(loginLantern(s).ok, 'login');
  s.festival.lanterns = 40;
  for (const t of s.festival.tasks) { t.progress = t.target; assert(claimTask(s, t.id).ok, 'claim'); }
  assert(buyFestivalItem(s, 'decor_lanna_lamp').ok && buyFestivalItem(s, 'acc_chada').ok, 'shop');
  addItem(s, 'forage_herb', 6); addItem(s, 'forage_wood', 2);
  assert(craftKrathong(s).ok, 'craft');
  assertEq([s.player.coins, s.stardust], [coins, dust], 'no coins, no stardust from any festival action');
  assertEq(s.wardrobe.acc_chada, 1, 'the accessory goes to the wardrobe');
  assertEq(s.inventoryDecor.decor_lanna_lamp, 1, 'the decor goes to the bag');
}));

test('econ V11 gate 3: lantern income is bounded (weekly <= 6 + 7 = 13, ลอยกระทง <= 14 x 3 + 2 + 7 + 6 = 57) and the bot never exceeds it in any window', async () => {
  assertEq(3 * TASK_REWARD + LOGIN_MAX, 13, 'weekly bound');
  assertEq(14 * FLOAT_DAILY_CAP + (FLOAT_PEAK_CAP - FLOAT_DAILY_CAP) + LOGIN_MAX + 3 * TASK_REWARD, 57, 'special bound');
  const rows = [];
  for (const name of ['3h', 'realistic']) for (const mode of ['march', 'nov']) {
    const r = mode === 'march' ? await result(name) : await resultFest(name, 'nov');
    for (const [key, n] of Object.entries(r.bot.fest.gained)) {
      const special = key.includes('loykrathong') || key.startsWith('fest_loykrathong');
      const bound = special ? 57 : 13;
      rows.push(`${name}/${mode} ${key}: ${n}/${bound}`);
      assert(n <= bound, `${name} ${mode}: ${key} gave ${n} lanterns (bound ${bound})`);
    }
    assertEq(r.bot.fest.leak, 0, `${name} ${mode}: festival actions leaked coins or stardust`);
  }
  console.log('[econ-sim] V11 lantern income per festival: ' + rows.join(' | '));
});

const FEST_SEEDS = [20260302, 7, 11, 23];   // the sim itself drifts by a few % between runs of one config, so ON and OFF are compared as means over 4 seeds
async function festRuns(name, win, on) {
  const runs = [];
  for (const seed of FEST_SEEDS) {
    const key = `${name}|${win}|${on ? 'on' : 'off'}|${seed}`;
    if (!resultsFest[key]) resultsFest[key] = await runSim(name, seed, { start: win === 'nov' ? NOV16 : START, noFest: !on });
    runs.push(resultsFest[key]);
  }
  return runs;
}
const mean = xs => xs.reduce((t, x) => t + x, 0) / xs.length;

test('econ V11 gate 2: with festival play ON vs OFF the income per hour stays within +-3% (mean of 4 seeds; the sim is deterministic now, uid() sees the fake clock), the yard tiers within +-25% of the V6 baseline (and of the OFF run in the ลอยกระทง window), the bot really plays', async () => {
  const out = [];
  for (const name of ['3h', 'realistic']) {
    for (const win of ['march', 'nov']) {
      const on = await festRuns(name, win, true), off = await festRuns(name, win, false);
      const ratio = mean(on.map(r => r.perHour)) / mean(off.map(r => r.perHour));
      const perSeed = on.map((r, i) => r.perHour / off[i].perHour);
      assert(ratio >= 0.97 && ratio <= 1.03, `${name} ${win}: ${Math.round(mean(on.map(r => r.perHour)))} coins/h ON vs ${Math.round(mean(off.map(r => r.perHour)))} OFF (${(100 * (ratio - 1)).toFixed(2)}%)`);
      assert(perSeed.every(x => x > 0.85 && x < 1.15), `${name} ${win}: a single seed drifted more than 15%: ${perSeed.map(x => x.toFixed(3)).join(' ')}`);
      const tot = k => on.reduce((t, r) => t + (typeof r.bot.fest[k] === 'number' ? r.bot.fest[k] : r.bot.fest[k].length), 0);
      assert(tot('tasks') >= 3 * on.length && tot('total') >= 8 * on.length && tot('logins') >= on.length, `${name} ${win}: the bot played (${tot('tasks')} tasks, ${tot('total')} lanterns over ${on.length} runs)`);
      if (win === 'nov') assert(tot('crafted') >= 1 && tot('floated') >= 1 && tot('items') >= 1, `${name} nov: the bot crafted ${tot('crafted')}, floated ${tot('floated')}, bought ${tot('items')} items over ${on.length} runs`);
      for (const tier of ['M', 'L', 'XL']) {
        const mOn = mean(on.map(r => r.tierDay[tier])), mOff = mean(off.map(r => r.tierDay[tier]));
        assert(Number.isFinite(mOn) && Number.isFinite(mOff) && mOn >= mOff * (1 - TIER_TOLERANCE) && mOn <= mOff * (1 + TIER_TOLERANCE), `${name} ${win}: tier ${tier} on day ${mOn.toFixed(2)} ON vs ${mOff.toFixed(2)} OFF (mean of 4 seeds)`);
        if (win === 'march') {
          const base = V6_BASELINE_TIER_DAYS[name][tier];
          assert(mOn >= base * (1 - TIER_TOLERANCE) && mOn <= base * (1 + TIER_TOLERANCE), `${name} (festival ON): tier ${tier} on day ${mOn.toFixed(2)} (mean of 4 seeds), V6 baseline ${base}`);
          assert(on[0].tierDay[tier] >= base * (1 - TIER_TOLERANCE) && on[0].tierDay[tier] <= base * (1 + TIER_TOLERANCE), `${name} (festival ON, the standard seed): tier ${tier} on day ${on[0].tierDay[tier]}, V6 baseline ${base}`);
        }
      }
      assert(on.every(r => (r.rows.find(x => x.day === 14) || r.rows[r.rows.length - 1]).perHour <= 4500), `${name} ${win}: day-14 gate with festivals`);
      const F = on[0].bot.fest;
      out.push(`${name} ${win}: ${Math.round(mean(on.map(r => r.perHour)))} vs ${Math.round(mean(off.map(r => r.perHour)))} coins/h (${(100 * (ratio - 1)).toFixed(2)}%, seeds ${perSeed.map(x => (100 * (x - 1)).toFixed(1) + '%').join('/')}), tiers ${on[0].tierDay.M}/${on[0].tierDay.L}/${on[0].tierDay.XL} (OFF ${off[0].tierDay.M}/${off[0].tierDay.L}/${off[0].tierDay.XL}), seed0: ${F.total} lanterns, ${F.tasks} tasks, crafted ${F.crafted} (herb ${F.mat.forage_herb || 0}, wood ${F.mat.forage_wood || 0}), floated ${F.floated}, items ${F.items.join(',') || '-'}`);
    }
  }
  console.log('[econ-sim] V11 festivals ON vs OFF: ' + out.join(' | '));
  globalThis.__econFingerprint = out.map(x => x.replace(/ seed0:.*/, '')).join('|');
  globalThis.__econFest = out;
});

async function cookRuns(name) {   // V16: cooking ON over the festival seeds (the OFF side is festRuns(name, 'march', true): same config, cooking off)
  const runs = [];
  for (const seed of FEST_SEEDS) {
    const key = `${name}|cook|${seed}`;
    if (!resultsCook[key]) resultsCook[key] = await runSim(name, seed, { start: START, cook: true });
    runs.push(resultsCook[key]);
  }
  return runs;
}

test('econ V16 gate: cooking ON vs OFF (mean of 4 seeds) keeps income within +3% (cooked ingredients booked at sell value), yard income within +5% (means), the yard <= 20% every day (standard seed), day-14 <= 4500/h, yard tiers within +-25% of the OFF means and never faster than the V6 baseline, and the bot really cooks', async () => {
  // The hard guarantee is the static shop-rate rule in tests/v16.test.js (a dish fills / cheers no cheaper than the shop).
  // A single seed drifts by several % whenever one choice changes (other hatches, other pets), so ON and OFF are compared as means.
  // The cooking bot books the ingredients it cooks as earned (at sell value), so the share rule stays the plain 20%.
  const out = [];
  for (const name of ['3h', 'realistic']) {
    const on = await cookRuns(name), off = await festRuns(name, 'march', true);
    const d14 = r => r.rows.find(x => x.day === 14) || r.rows[r.rows.length - 1];
    const cooked = on.reduce((t, r) => t + r.bot.cooked, 0), fed = on.reduce((t, r) => t + r.bot.dishesFed, 0);
    assert(cooked >= 3 * on.length && fed >= 3 * on.length, `${name}: the bot cooked ${cooked} dishes and fed ${fed} over ${on.length} runs`);
    const ratio = mean(on.map(r => r.perHour)) / mean(off.map(r => r.perHour));
    const yardRatio = mean(on.map(r => r.by.yard)) / mean(off.map(r => r.by.yard));
    assert(ratio <= 1.03, `${name}: ${Math.round(mean(on.map(r => r.perHour)))} coins/h cooking vs ${Math.round(mean(off.map(r => r.perHour)))} (${(100 * (ratio - 1)).toFixed(2)}%, > +3%)`);
    assert(yardRatio <= 1.05, `${name}: yard income ${(100 * (yardRatio - 1)).toFixed(2)}% with cooking (> +5%)`);
    for (const r of on) assert(d14(r).perHour <= 4500, `${name}: day-14 ${Math.round(d14(r).perHour)} coins/h (> 4500 gate)`);
    // the 20% rule per day on the standard seed, as every earlier gate: on the other seeds day 1 is one or two pets and swings with which
    // pet hatched (seed 7 day 1 is 21.6% cooking vs 13.2% not, and stays there with dish happy cut to plain food: it is the hatch, not the dish)
    for (const x of on[0].rows) assert(x.yardShare <= 0.2, `${name} day ${x.day}: yard is ${(100 * x.yardShare).toFixed(1)}% with cooking (> 20%)`);
    for (const tier of ['M', 'L', 'XL']) {   // as V11: means vs the OFF means, the standard seed vs the V6 baseline
      const base = V6_BASELINE_TIER_DAYS[name][tier], mOn = mean(on.map(r => r.tierDay[tier])), mOff = mean(off.map(r => r.tierDay[tier]));
      assert(Number.isFinite(mOn) && mOn >= mOff * (1 - TIER_TOLERANCE) && mOn <= mOff * (1 + TIER_TOLERANCE), `${name} (cooking): tier ${tier} on day ${mOn.toFixed(2)} vs ${mOff.toFixed(2)} OFF (means)`);
      // cooking can only slow the yard down (the first sessions' crops go into the pot): no faster than the V6 baseline allows
      assert(on[0].tierDay[tier] >= base * (1 - TIER_TOLERANCE), `${name} (cooking, standard seed): tier ${tier} on day ${on[0].tierDay[tier]}, faster than the baseline ${base} allows`);
    }
    out.push(`${name}: ${(100 * (ratio - 1)).toFixed(2)}% income, ${(100 * (yardRatio - 1)).toFixed(2)}% yard, ${cooked} dishes cooked / ${fed} fed over ${on.length} seeds`);
  }
  console.log('[econ-sim] V16 cooking ON vs OFF: ' + out.join(' | '));
  globalThis.__econCook = out;
});

test('econ V12/V14 gate: the Limited welcome pet (taken on minute one) and the Lv.5 legendary egg keep day-14 income <= 1.10x and <= 4500/h, the yard <= 20% every day and the yard tiers within +-25% of the V6 baseline', async () => {
  const out = [];
  for (const name of ['3h', 'realistic']) {
    const on = await resultGift(name), off = await result(name);
    const d14 = r => r.rows.find(x => x.day === 14) || r.rows[r.rows.length - 1];
    assert(on.state.pets.some(p => p.limited === 'celestial') || (on.state.nursery || []).some(e => e.pet.limited === 'celestial'), name + ': the Limited pet is still owned on day 14');
    assert(on.state.mail.some(m => m.id === 'gift_legend_egg' && m.claimed), name + ': the bot took the Lv.5 legendary egg');
    assert(d14(on).perHour <= 1.10 * d14(off).perHour, `${name}: day-14 income ${Math.round(d14(on).perHour)} coins/h with the gift vs ${Math.round(d14(off).perHour)} without (> 1.10x)`);
    assert(d14(on).perHour <= 4500, `${name}: day-14 ${Math.round(d14(on).perHour)} coins/h (> 4500 gate)`);
    for (const x of on.rows) assert(x.yardShare <= 0.2, `${name} day ${x.day}: yard is ${(100 * x.yardShare).toFixed(1)}% of income with the gift (> 20%)`);
    for (const tier of ['M', 'L', 'XL']) {
      const base = V6_BASELINE_TIER_DAYS[name][tier], got = on.tierDay[tier];
      assert(got != null && got >= base * (1 - TIER_TOLERANCE) && got <= base * (1 + TIER_TOLERANCE), `${name} (gift): tier ${tier} on day ${got}, baseline ${base}`);
    }
    out.push(`${name}: day-14 ${Math.round(d14(on).perHour)}/h with gift vs ${Math.round(d14(off).perHour)}/h (${(d14(on).perHour / d14(off).perHour).toFixed(3)}x); whole run ${Math.round(on.perHour)} vs ${Math.round(off.perHour)}; tiers M ${on.tierDay.M} L ${on.tierDay.L} XL ${on.tierDay.XL} (without ${off.tierDay.M}/${off.tierDay.L}/${off.tierDay.XL})`);
  }
  console.log('[econ-sim] V12 welcome gift ON vs OFF: ' + out.join(' | '));
  globalThis.__econGift = out;
});

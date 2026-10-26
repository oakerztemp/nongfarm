// Festival tests (CONTRACT_V11): calendar (ISO weeks, the ลอยกระทง window), deterministic tasks, hooks, login cap, krathong craft + float caps,
// the festival shop, lantern bounds, state v9 migration + sanitiser.
import { test, assert, assertEq, withFakeNow, freshState } from './harness.js';
import { createNewState, migrate, STATE_VERSION, addItem, countItem } from '../js/state.js';
import { SPECIES } from '../js/data/species.js';
import { EGGS } from '../js/data/eggs.js';
import { ITEMS } from '../js/data/items.js';
import { getAccessory } from '../js/data/accessories.js';
import { getDecor } from '../js/data/decor.js';
import {
  WEEKLY_ORDER, WEEKLY_FESTIVALS, SPECIALS, SHOP_ITEMS, TASK_POOL, WISH_TEMPLATES, KRATHONG_POSTCARDS, FESTIVAL_DEFS, LEDGER_MAX,
} from '../js/data/festivals.js';
import {
  activeFestival, isoWeekOf, rollTasks, ensureFestival, festivalEvent, claimTask, loginLantern, buyFestivalItem, craftKrathong,
  floatKrathong, festivalView, festivalPostcardTemplates, pendingFestival, floatCap, LOY_ID, weekIndex, weeklyFestival, setFestivalDebugSource,
} from '../js/festival.js';
import { feedPet, patPet, strokePet, hatchReady, foodEffect, rehomePet, POSTCARD_TEMPLATES } from '../js/pets.js';
import { plantSeed, tickFarm, harvestPlot, harvestAll, startExpedition, ensureOrders, completeOrder } from '../js/farm.js';
import { journalDays } from '../js/journal.js';

const at = (y, m, d, h = 10, min = 0, sec = 0) => new Date(y, m - 1, d, h, min, sec).getTime();
const DAY = 24 * 3600 * 1000;
const TW = at(2026, 10, 7);          // Wed 2026-10-07, ISO week 41 = week index 144 -> farm festival
const TL = at(2026, 11, 18);         // inside ลอยกระทง

async function loadFixture(name) {
  const res = await fetch(new URL(`./fixtures/${name}.json`, import.meta.url));
  assert(res.ok, `cannot load fixture ${name}`);
  return res.json();
}

function mkPet(s, over = {}) {
  const pet = {
    id: 'p' + (s.pets.length + 1), speciesId: 'hamster', nickname: 'มีมี่', shiny: false, personality: 'cheerful',
    stage: 2, xp: 0, stats: { hunger: 50, happy: 50, energy: 100, clean: 100 }, poop: 0, sick: false, zeroSince: null, zeroMs: 0, poopTimer: null,
    lastFedAt: 0, status: 'idle', task: null, bornAt: TW - 1e9, bond: 0, bondDay: null, bondToday: 0, giftDay: null, station: null, ...over,
  };
  s.pets.push(pet);
  return pet;
}

function game(level = 20) {
  const s = freshState();
  s.player.level = level;
  s.player.coins = 100000;
  s.barnCapacity = 10;
  return s;
}

/** Replaces the rolled tasks by chosen pool ids (in memory only). */
function giveTasks(s, ids) {
  const f = ensureFestival(s);
  f.tasks = ids.map(id => { const d = TASK_POOL.find(t => t.id === id); return { id, kind: d.kind, target: d.target, progress: 0, claimed: false }; });
  return f;
}
const prog = (s, id) => s.festival.tasks.find(t => t.id === id).progress;

// ---- calendar ----

test('festival: ISO week numbers at the year edges (53-week 2020, 2021 W01, Monday 2024-12-30 is 2025 W01)', () => {
  const w = (y, m, d, h = 12) => { const r = isoWeekOf(at(y, m, d, h)); return `${r.year}-W${String(r.week).padStart(2, '0')}`; };
  assertEq(w(2020, 12, 31), '2020-W53');
  assertEq(w(2021, 1, 1), '2020-W53');
  assertEq(w(2021, 1, 3), '2020-W53');
  assertEq(w(2021, 1, 4, 0), '2021-W01');
  assertEq(w(2024, 12, 29), '2024-W52');
  assertEq(w(2024, 12, 30, 0), '2025-W01');
  assertEq(w(2026, 10, 26, 0), '2026-W44');
  assertEq(w(2026, 11, 1, 23), '2026-W44');
  assertEq(w(2026, 12, 31), '2026-W53');
  assertEq(w(2027, 1, 3), '2026-W53');
  assertEq(w(2027, 1, 4, 0), '2027-W01');
});

test('festival: the weekly festival is WEEKLY_ORDER[weekIndex % 8] (weeks from Monday 2024-01-01), Monday 00:00 .. Sunday 24:00 local, same all week', () => {
  assertEq(WEEKLY_ORDER, ['farm', 'forest', 'bug', 'water', 'sky', 'savanna', 'polar', 'mystic']);
  assertEq(WEEKLY_FESTIVALS.map(f => f.id), ['fest_farm', 'fest_forest', 'fest_bug', 'fest_water', 'fest_sky', 'fest_savanna', 'fest_polar', 'fest_mystic']);
  const mon = at(2026, 10, 26, 0), nextMon = at(2026, 11, 2, 0);
  const a = activeFestival(mon);
  assertEq([a.id, a.kind, a.habitat, a.key, a.from, a.to], ['fest_water', 'weekly', 'water', '2026-W44', mon, nextMon], 'week 147 % 8 = 3 = water');
  for (const t of [mon, at(2026, 10, 28, 15), at(2026, 11, 1, 23, 59, 59)]) assertEq(activeFestival(t).key, '2026-W44', 'all week');
  const b = activeFestival(nextMon);
  assertEq([b.id, b.habitat, b.key], ['fest_sky', 'sky', '2026-W45'], 'Monday 00:00 starts the next one');
  assertEq(weekIndex(mon), 147);
  assertEq(weekIndex(at(2024, 1, 1, 0)), 0);
  assertEq(weekIndex(at(2023, 12, 31, 23)), -1);
  // eight consecutive weeks visit every habitat once
  const seen = new Set();
  for (let i = 0; i < 8; i++) seen.add(activeFestival(at(2026, 6, 1, 12) + i * 7 * DAY).habitat);
  assertEq(seen.size, 8);
  for (const f of FESTIVAL_DEFS) assert(f.nameTh && f.emoji && f.items.length, f.id);
  assertEq(activeFestival(TW).habitat, 'farm', 'the fixture week used below');
});

test('festival: every habitat returns exactly every 8 weeks, across 53-week years and the special takeover', () => {
  let monday = at(2020, 1, 6, 12);
  const list = [];
  for (let i = 0; i < 52 * 11; i++) { list.push(weeklyFestival(monday).habitat); monday += 7 * DAY; }   // 2020 .. 2030 (DST-safe: noon)
  for (let i = 0; i < list.length; i++) {
    if (i >= 8) assertEq(list[i], list[i - 8], `week ${i} returns after 8`);
    if (i >= 7) assertEq(new Set(list.slice(i - 7, i + 1)).size, 8, `8 different habitats ending at week ${i}`);
  }
  // across the 2026 -> 2027 boundary (ISO week 53) and the ลอยกระทง weeks: the weekly one underneath keeps its rhythm
  const w = ms => weeklyFestival(ms).habitat;
  assertEq(w(at(2026, 12, 28, 12)), w(at(2026, 12, 28, 12) - 56 * DAY), 'W53 2026 vs 8 weeks before');
  assertEq(w(at(2027, 1, 4, 12)), w(at(2026, 12, 28, 12) - 49 * DAY), 'W01 2027 vs 8 weeks before');
  assertEq(w(at(2026, 11, 17, 12)), w(at(2026, 11, 17, 12) + 56 * DAY), 'the week the special starts returns in 8 weeks');
  assertEq(activeFestival(at(2026, 11, 17, 12)).id, LOY_ID, 'while the weekly one is covered');
  assertEq(activeFestival(at(2027, 1, 12, 12)).habitat, w(at(2026, 11, 17, 12)), 'and it is really back');
});

test('festival: ลอยกระทง 2026-11-17 .. 2026-11-30 replaces the weekly one; boundaries to the millisecond; peak day 2026-11-24', () => {
  assertEq(SPECIALS, [{ id: 'fest_loykrathong', from: '2026-11-17', to: '2026-11-30', peakDay: '2026-11-24' }]);
  const before = activeFestival(at(2026, 11, 16, 23, 59, 59) + 999);
  assertEq([before.kind, before.key, before.id], ['weekly', '2026-W47', 'fest_polar']);
  const first = activeFestival(at(2026, 11, 17, 0));
  assertEq([first.id, first.kind, first.habitat, first.peakDay, first.nameTh, first.emoji], ['fest_loykrathong', 'special', null, '2026-11-24', 'ลอยกระทง', '🏮']);
  assertEq([first.from, first.to], [at(2026, 11, 17, 0), at(2026, 12, 1, 0)]);
  assertEq(activeFestival(at(2026, 11, 24, 12)).key, first.key, 'same key all special');
  assertEq(activeFestival(at(2026, 11, 30, 23, 59, 59) + 999).id, 'fest_loykrathong', 'last millisecond');
  const after = activeFestival(at(2026, 12, 1, 0));
  assertEq([after.kind, after.key], ['weekly', '2026-W49']);
  assertEq(after.id, 'fest_farm', 'week 152 % 8 = 0');
});

test('festival: ?debug=1&fest=<id> forces a festival only with debug, and only for a known id', () => {
  const t = TW;
  assertEq(activeFestival(t, { search: '?debug=1&fest=fest_polar' }).id, 'fest_polar');
  assertEq(activeFestival(t, { search: '?fest=fest_polar' }).id, 'fest_farm', 'ignored without debug');
  assertEq(activeFestival(t, { search: '?debug=0&fest=fest_polar' }).id, 'fest_farm');
  assertEq(activeFestival(t, { search: '?debug=1&fest=nope' }).id, 'fest_farm', 'unknown id ignored');
  const loy = activeFestival(t, { search: '?debug=1&fest=fest_loykrathong' });
  assertEq([loy.id, loy.kind], ['fest_loykrathong', 'special']);
  assert(loy.from <= t && t < loy.to, 'the forced window covers now');
  assertEq(activeFestival(t, { search: '' }).id, 'fest_farm');
  assertEq(activeFestival(t).id, 'fest_farm', 'no location search in the test page');
});

// ---- tasks ----

test('festival: tasks are picked from the week key (deterministic), 3 distinct from the pool, reward 2 🏮 each', () => {
  const fest = activeFestival(TW);
  const a = rollTasks(fest, 20), b = rollTasks(fest, 20);
  assertEq(a, b, 'same key, same tasks');
  assertEq(a.length, 3);
  assertEq(new Set(a.map(t => t.id)).size, 3, 'distinct');
  assert(a.every(t => { const d = TASK_POOL.find(p => p.id === t.id); return d && t.kind === d.kind && t.target === d.target && t.progress === 0 && t.claimed === false; }), 'shape');
  const sets = new Set();
  for (let w = 1; w <= 20; w++) sets.add(rollTasks({ key: `2027-W${w}`, habitat: 'forest' }, 20).map(t => t.id).sort().join());
  assert(sets.size > 4, 'the weeks differ: ' + sets.size);
  assertEq(TASK_POOL.map(t => [t.id, t.target]), [['hatch_h', 1], ['trip_h', 2], ['feed_fav', 5], ['order', 3], ['pat', 10], ['harvest', 8]]);
});

test('festival: H tasks are swapped for others below the habitat egg unlock level, and the special has none', () => {
  const mysticLevel = EGGS.find(e => e.habitat === 'mystic').unlockLevel;
  let sawH = false;
  for (let w = 1; w <= 40; w++) {
    const fest = { key: `2027-W${w}`, habitat: 'mystic' };
    const high = rollTasks(fest, mysticLevel), low = rollTasks(fest, 1);
    if (high.some(t => TASK_POOL.find(p => p.id === t.id).h)) sawH = true;
    assert(low.every(t => !TASK_POOL.find(p => p.id === t.id).h), `week ${w}: no H task below level ${mysticLevel}`);
    assertEq(new Set(low.map(t => t.id)).size, 3, 'still 3 distinct');
    assertEq(rollTasks(fest, 1), low, 'deterministic');
    assert(rollTasks({ key: `x${w}`, habitat: null }, 99).every(t => !TASK_POOL.find(p => p.id === t.id).h), 'special: none');
  }
  assert(sawH, 'unlocked players do get H tasks');
});

test('festival: ensureFestival rolls on a new key, keeps lanterns / owned / krathongs, and is stable inside a week', () => withFakeNow(TW, clock => {
  const s = game();
  const f = ensureFestival(s);
  assertEq([f.id, f.key, f.tasks.length], ['fest_farm', '2026-W41', 3]);
  f.lanterns = 7; f.owned.acc_strawhat = true; f.krathongs = 2; f.loginDays = ['2026-10-07']; f.tasks[0].progress = 1;
  const tasks = JSON.stringify(f.tasks);
  clock.advance(2 * DAY);
  assertEq(JSON.stringify(ensureFestival(s).tasks), tasks, 'same week: untouched');
  clock.set(at(2026, 10, 12, 9));
  const g = ensureFestival(s);
  assertEq([g.id, g.key], ['fest_forest', '2026-W42']);
  assertEq([g.lanterns, g.owned, g.krathongs], [7, { acc_strawhat: true }, 2], 'kept');
  assertEq([g.loginDays, g.tasks.every(t => t.progress === 0 && !t.claimed)], [[], true], 'reset');
}));

// ---- hooks ----

test('festivalEvent: counts the matching kind, capped at the target, claim pays 2 🏮 once', () => withFakeNow(TW, () => {
  const s = game();
  giveTasks(s, ['order', 'pat', 'harvest']);
  assert(festivalEvent(s, 'order'));
  assert(!festivalEvent(s, 'feed'), 'no task of that kind');
  assert(!festivalEvent(s, 'nope') && !festivalEvent(null, 'order'), 'unknown kind / null state: false, no throw');
  assert(!claimTask(s, 'order').ok, 'not done yet');
  festivalEvent(s, 'order'); festivalEvent(s, 'order');
  assertEq(prog(s, 'order'), 3);
  assert(!festivalEvent(s, 'order'), 'full: nothing moves');
  assertEq(prog(s, 'order'), 3, 'capped');
  const r = claimTask(s, 'order');
  assert(r.ok && r.gained === 2, 'claim');
  assertEq(s.festival.lanterns, 2);
  assert(!claimTask(s, 'order').ok, 'once');
  assert(!claimTask(s, 'nope').ok);
  assertEq(s.player.coins, 100000, 'no coins');
  assertEq(s.stardust, 0, 'no stardust');
}));

test('festivalEvent: H tasks count only the featured habitat (species or pet), other tasks count any', () => withFakeNow(TW, () => {
  const s = game();
  const farmPet = mkPet(s, { speciesId: 'hamster' });
  const other = SPECIES.find(x => x.habitat === 'polar').id;
  const polarPet = mkPet(s, { speciesId: other });
  giveTasks(s, ['hatch_h', 'trip_h', 'feed_fav']);
  assert(!festivalEvent(s, 'hatch', { speciesId: other }), 'wrong habitat');
  assert(festivalEvent(s, 'hatch', { speciesId: 'hamster' }), 'featured habitat');
  assert(!festivalEvent(s, 'expedition', { petId: polarPet.id }));
  assert(festivalEvent(s, 'expedition', { petId: farmPet.id }));
  assert(festivalEvent(s, 'feed', { petId: polarPet.id }), 'feed counts any pet');
  assertEq([prog(s, 'hatch_h'), prog(s, 'trip_h'), prog(s, 'feed_fav')], [1, 1, 1]);
}));

test('festival hooks: the real actions (hatch, expedition, favourite feed, order, pat/stroke, harvest) move the tasks', () => withFakeNow(TW, clock => {
  const s = game();
  giveTasks(s, ['hatch_h', 'trip_h', 'feed_fav', 'order', 'pat', 'harvest']);
  // hatch (a farm egg, so the H task counts)
  s.incubator = [{ eggId: 'egg_farm', startAt: TW - 1000, readyAt: TW - 1 }];
  assert(hatchReady(s, 0).ok);
  assertEq(prog(s, 'hatch_h'), 1, 'hatch');
  const pet = s.pets[0];
  pet.speciesId = 'hamster';   // the hatched species is random; the favourite below is the hamster's corn
  // pat + stroke (a long stroke is one pat)
  pet.stats.energy = 100; pet.stage = 2;
  assert(patPet(s, pet.id).ok);
  assertEq(prog(s, 'pat'), 1, 'pat');
  assert(strokePet(s, pet.id, { durationMs: 99999, region: 'head' }).ok);
  assertEq(prog(s, 'pat'), 2, 'long stroke = one more pat');
  strokePet(s, pet.id, { durationMs: 10, region: 'head' });
  assertEq(prog(s, 'pat'), 2, 'short stroke: nothing');
  for (let i = 0; i < 10; i++) patPet(s, pet.id);
  assertEq(prog(s, 'pat'), 5, 'only the 5 rewarded pats of a pet a day count');
  // favourite feed vs. an ordinary food
  addItem(s, 'crop_corn', 2); addItem(s, 'food_kibble', 2);
  pet.stats.hunger = 10;
  assert(feedPet(s, pet.id, 'food_kibble').ok);
  assertEq(prog(s, 'feed_fav'), 0, 'not the favourite');
  assert(feedPet(s, pet.id, 'crop_corn').ok);
  assertEq(prog(s, 'feed_fav'), 1, 'favourite');
  // expedition start
  assert(startExpedition(s, pet.id, 'forest').ok);
  assertEq(prog(s, 'trip_h'), 1, 'expedition start');
  // harvest
  s.plots[0].cropId = null;
  addItem(s, 'seed_carrot', 2);
  assert(plantSeed(s, 0, 'carrot').ok && plantSeed(s, 1, 'carrot').ok);
  tickFarm(s, TW + 10 * 60000);
  assert(harvestAll(s).ok);
  assertEq(prog(s, 'harvest'), 2, 'one per plot');
  // order
  ensureOrders(s, '2026-10-07');
  const o = s.orders.list[0];
  for (const [id, n] of Object.entries(o.items)) addItem(s, id, n);
  assert(completeOrder(s, o.id).ok);
  assertEq(prog(s, 'order'), 1, 'order');
  // failed actions count nothing
  const before = JSON.stringify(s.festival.tasks);
  assert(!completeOrder(s, o.id).ok && !feedPet(s, pet.id, 'crop_nothing').ok);
  assertEq(JSON.stringify(s.festival.tasks), before);
}));

test('festivalEvent: only the festival that is on counts; a new week starts from zero (no old progress, no leaked claims)', () => withFakeNow(TW, clock => {
  const s = game();
  giveTasks(s, ['order', 'pat', 'harvest']);
  for (let i = 0; i < 3; i++) festivalEvent(s, 'order');
  assertEq(prog(s, 'order'), 3);
  clock.set(at(2026, 10, 12, 10));   // next week
  festivalEvent(s, 'nothing');
  festivalEvent(s, 'order');
  const f = s.festival;
  assertEq(f.key, '2026-W42');
  const ord = f.tasks.find(t => t.id === 'order');
  assert(!ord || (ord.progress <= 1 && !ord.claimed), 'a fresh task, one event at most');
  assert(f.tasks.every(t => t.progress <= t.target && !t.claimed));
  // a pre-festival day still belongs to the weekly festival, not to ลอยกระทง
  clock.set(at(2026, 11, 16, 23, 59, 59));
  assertEq(ensureFestival(s).id, 'fest_polar');
  clock.set(at(2026, 11, 17, 0, 0, 1));
  assertEq(ensureFestival(s).id, LOY_ID);
  assert(s.festival.tasks.every(t => !TASK_POOL.find(p => p.id === t.id).h), 'special tasks have no H');
}));

// ---- login ----

test('festival: login lantern is +1 once a day and at most 7 per festival (14-day ลอยกระทง stops at 7)', () => withFakeNow(at(2026, 11, 17, 9), clock => {
  const s = game();
  let got = 0;
  const w = loginLantern(s);
  assert(w.ok && w.gained === 1);
  assert(!loginLantern(s).ok, 'same day twice');
  got = 1;
  for (let d = 1; d < 14; d++) {
    clock.set(at(2026, 11, 17 + d, 9));
    if (loginLantern(s).ok) got++;
  }
  assertEq(got, 7);
  assertEq(s.festival.lanterns, 7);
  assertEq(s.festival.loginDays.length, 7);
  assert(!loginLantern(s).ok, 'capped');
  const v = festivalView(s);
  assertEq([v.login.days, v.login.max, v.login.done], [7, 7, true]);
  // the next festival has its own 7
  clock.set(at(2026, 12, 2, 9));
  assert(loginLantern(s).ok);
  assertEq(s.festival.lanterns, 8, 'lanterns carried over');
}));

// ---- shop ----

test('festival shop: every festival item has its data entry (accessory / decor, authored by C)', () => {
  for (const it of SHOP_ITEMS) {
    const data = it.type === 'acc' ? getAccessory(it.id) : getDecor(it.id);
    assert(data, `${it.id} is missing in ${it.type === 'acc' ? 'accessories.js' : 'decor.js'}`);
    if (it.type === 'acc') assertEq(data.slot, it.slot, `${it.id} slot`);
  }
  assertEq(SHOP_ITEMS.length, 12);
  assertEq(SHOP_ITEMS.filter(i => i.festival !== LOY_ID).every(i => i.price === 6 && i.type === 'acc'), true);
  assertEq(SHOP_ITEMS.filter(i => i.festival === LOY_ID).map(i => [i.id, i.price]), [['acc_chada', 6], ['acc_sabai', 6], ['decor_lanna_lamp', 10], ['decor_big_krathong', 10]]);
});

test('festival shop: only this festival\'s items, once each, for lanterns (no coins, no stardust)', () => withFakeNow(TW, clock => {
  const s = game();
  const f = ensureFestival(s);
  const item = SHOP_ITEMS.find(i => i.id === 'acc_strawhat');
  if (!getAccessory(item.id)) return;   // data not authored yet: the presence test above reports it
  assert(!buyFestivalItem(s, 'acc_leafcrown').ok, 'another festival\'s item');
  assert(!buyFestivalItem(s, 'nope').ok);
  const poor = buyFestivalItem(s, 'acc_strawhat');
  assert(!poor.ok && poor.reason.includes('6'), 'not enough lanterns: ' + poor.reason);
  f.lanterns = 8;
  const r = buyFestivalItem(s, 'acc_strawhat');
  assert(r.ok, r.reason);
  assertEq([s.festival.lanterns, s.festival.owned, s.wardrobe.acc_strawhat], [2, { acc_strawhat: true }, 1]);
  f.lanterns = 20;
  const again = buyFestivalItem(s, 'acc_strawhat');
  assert(!again.ok && again.reason.includes('แล้ว'), 'one copy only');
  assertEq([s.festival.lanterns, s.wardrobe.acc_strawhat], [20, 1], 'nothing spent the second time');
  assertEq([s.player.coins, s.stardust], [100000, 0]);
  const v = festivalView(s);
  assertEq(v.shop.map(x => [x.id, x.owned]), [['acc_strawhat', true]]);
  // the item returns with its festival: a new week's shop is its own
  clock.set(at(2026, 10, 12, 10));
  assertEq(festivalView(s).shop.map(x => x.id), ['acc_leafcrown']);
  const survive = migrate(JSON.parse(JSON.stringify(s)));
  assertEq(survive.wardrobe.acc_strawhat, 1, 'wardrobe survives the sanitiser');
}));

test('festival shop: ลอยกระทง sells 2 accessories (6 🏮) and 2 decors (10 🏮, into inventoryDecor)', () => withFakeNow(TL, () => {
  const s = game();
  const f = ensureFestival(s);
  f.lanterns = 40;
  assertEq(festivalView(s).shop.map(x => [x.id, x.price]), [['acc_chada', 6], ['acc_sabai', 6], ['decor_lanna_lamp', 10], ['decor_big_krathong', 10]]);
  assert(!buyFestivalItem(s, 'acc_strawhat').ok, 'a weekly item is not sold now');
  if (!getAccessory('acc_chada') || !getDecor('decor_lanna_lamp')) return;
  assert(buyFestivalItem(s, 'acc_chada').ok && buyFestivalItem(s, 'acc_sabai').ok);
  assert(buyFestivalItem(s, 'decor_lanna_lamp').ok && buyFestivalItem(s, 'decor_big_krathong').ok);
  assertEq(f.lanterns, 40 - 6 - 6 - 10 - 10);
  assertEq([s.wardrobe.acc_chada, s.wardrobe.acc_sabai, s.inventoryDecor.decor_lanna_lamp, s.inventoryDecor.decor_big_krathong], [1, 1, 1, 1]);
  assert(!buyFestivalItem(s, 'decor_lanna_lamp').ok, 'once');
  assertEq(f.lanterns, 8);
  const back = migrate(JSON.parse(JSON.stringify(s)));
  assertEq([back.inventoryDecor.decor_big_krathong, back.festival.owned.decor_big_krathong], [1, true]);
}));

// ---- krathong ----

test('krathong craft: 3 🌿 + 1 🪵 each, stock at most 5, only during ลอยกระทง', () => {
  withFakeNow(TW, () => {
    const s = game();
    addItem(s, 'forage_herb', 9); addItem(s, 'forage_wood', 9);
    assert(!craftKrathong(s).ok, 'not during a weekly festival');
    assertEq([countItem(s, 'forage_herb'), countItem(s, 'forage_wood')], [9, 9], 'nothing taken');
  });
  withFakeNow(TL, () => {
    const s = game();
    const poor = craftKrathong(s);
    assert(!poor.ok && poor.reason.includes('ขาด'), 'no materials: ' + poor.reason);
    addItem(s, 'forage_herb', 2); addItem(s, 'forage_wood', 5);
    assert(!craftKrathong(s).ok, '2 herbs are not enough');
    assertEq(countItem(s, 'forage_herb'), 2);
    addItem(s, 'forage_herb', 20);
    const r = craftKrathong(s);
    assert(r.ok, r.reason);
    assertEq([s.festival.krathongs, countItem(s, 'forage_herb'), countItem(s, 'forage_wood')], [1, 19, 4], '3 herb + 1 wood');
    for (let i = 0; i < 4; i++) assert(craftKrathong(s).ok);
    assertEq(s.festival.krathongs, 5);
    const full = craftKrathong(s);
    assert(!full.ok && full.reason.includes('5'), 'cap: ' + full.reason);
    assertEq([countItem(s, 'forage_herb'), countItem(s, 'forage_wood')], [22 - 15, 5 - 5], 'the 6th took nothing');
    const v = festivalView(s).krathong;
    assertEq([v.stock, v.max, v.recipe, v.canCraft], [5, 5, { forage_herb: 3, forage_wood: 1 }, false]);
  });
});

function loySetup(t = TL) {
  const s = game();
  const f = ensureFestival(s);
  f.krathongs = 5;
  return { s, f, pet: mkPet(s) };
}

test('krathong float: +1 🏮, +2 happy, a diary line with a wish, uses one krathong; refuses sick / asleep / busy / unknown pets and wrong times', () => {
  withFakeNow(TW, () => {
    const s = game(); s.festival.krathongs = 2;
    const p = mkPet(s);
    assert(!floatKrathong(s, p.id).ok, 'not during a weekly festival');
  });
  withFakeNow(TL, () => {
    const { s, f, pet } = loySetup();
    const r = floatKrathong(s, pet.id);
    assert(r.ok, r.reason);
    assertEq([f.lanterns, f.krathongs, pet.stats.happy, pet.bond, s.player.coins], [1, 4, 52, 0, 100000], 'lantern, stock, happy, no bond, no coins');
    assertEq(f.krathong, { day: '2026-11-18', n: 1 });
    const line = journalDays(s)[0].lines.find(l => l.text.includes('ลอยกระทง'));
    assert(line && line.emoji === '🪷' && line.text.includes('มีมี่') && line.text.includes('ขอให้') && line.petId === pet.id, JSON.stringify(line));
    assert(WISH_TEMPLATES.some(w => line.text.includes(w)), 'one of the wishes');
    assert(r.wish && r.msg.includes(r.wish));
    assert(!floatKrathong(s, 'ghost').ok, 'unknown pet');
    const sick = mkPet(s, { sick: true }), asleep = mkPet(s, { status: 'sleeping' }), busy = mkPet(s, { status: 'working' }), away = mkPet(s, { status: 'expedition' });
    for (const p of [sick, asleep, busy, away]) assert(!floatKrathong(s, p.id).ok, `${p.id} cannot`);
    assertEq([f.lanterns, f.krathongs], [1, 4], 'refusals cost nothing');
    f.krathongs = 0;
    assert(!floatKrathong(s, pet.id).ok, 'needs a krathong');
  });
  assertEq(WISH_TEMPLATES.length, 12);
  assertEq(new Set(WISH_TEMPLATES).size, 12);
});

test('krathong float: at most 3 a day; the next day allows 3 again', () => withFakeNow(TL, clock => {
  const { s, f, pet } = loySetup();
  const other = mkPet(s);
  assert(floatKrathong(s, pet.id).ok && floatKrathong(s, other.id).ok && floatKrathong(s, pet.id).ok);
  const r = floatKrathong(s, other.id);
  assert(!r.ok && r.reason.includes('3'), 'daily cap: ' + r.reason);
  assertEq([f.lanterns, f.krathongs, f.krathong.n], [3, 2, 3]);
  f.krathongs = 5;
  clock.set(at(2026, 11, 19, 8));
  for (let i = 0; i < 3; i++) assert(floatKrathong(s, pet.id).ok);
  assert(!floatKrathong(s, pet.id).ok);
  assertEq([f.lanterns, f.krathong], [6, { day: '2026-11-19', n: 3 }]);
}));

test('krathong float: on the night of loy (2026-11-24 from 18:00) the cap is 5', () => withFakeNow(at(2026, 11, 24, 11), clock => {
  const { s, f, pet } = loySetup();
  const fest = activeFestival(clock.get());
  assertEq([floatCap(fest, at(2026, 11, 24, 17, 59)), floatCap(fest, at(2026, 11, 24, 18, 0)), floatCap(fest, at(2026, 11, 23, 20)), floatCap(fest, at(2026, 11, 25, 20))], [3, 5, 3, 3]);
  for (let i = 0; i < 3; i++) assert(floatKrathong(s, pet.id).ok);
  assert(!floatKrathong(s, pet.id).ok, '11:00: only 3');
  assertEq(festivalView(s).krathong.peak, false);
  clock.set(at(2026, 11, 24, 18, 0));
  f.krathongs = 5;
  assert(festivalView(s).krathong.peak);
  assert(floatKrathong(s, pet.id).ok && floatKrathong(s, pet.id).ok, '18:00 on: two more');
  const r = floatKrathong(s, pet.id);
  assert(!r.ok && r.reason.includes('5'), 'then 5 in all: ' + r.reason);
  assertEq([f.krathong, f.lanterns], [{ day: '2026-11-24', n: 5 }, 5]);
  clock.set(at(2026, 11, 25, 20));
  assert(floatKrathong(s, pet.id).ok, 'the next evening is an ordinary day');
}));

// ---- lantern bounds ----

/** A day-by-day perfect player: logs in, does every task, claims, floats as much as allowed. Returns lanterns earned. */
function playFestival(startMs, days, special) {
  return withFakeNow(startMs, clock => {
    const s = game();
    const pet = mkPet(s);
    let t = startMs;
    for (let d = 0; d < days; d++) {
      clock.set(t + 9 * 3600e3);
      const fest = activeFestival(clock.get());
      const f = ensureFestival(s);
      loginLantern(s);
      for (const task of f.tasks) for (let i = 0; i < task.target + 2; i++) festivalEvent(s, task.kind, { habitat: fest.habitat });
      for (const task of f.tasks) claimTask(s, task.id);
      if (special) {
        for (const h of [10, 20]) {
          clock.set(t + h * 3600e3);
          for (let i = 0; i < 8; i++) { f.krathongs = 5; floatKrathong(s, pet.id); }
        }
      }
      t += DAY;
    }
    return s.festival.lanterns;
  });
}

test('lantern bounds: one weekly festival gives at most 6 + 7 = 13 🏮, ลอยกระทง at most 14 x 3 + 2 + 7 + 6 = 57 🏮 (and a perfect player reaches both)', async () => {
  assertEq(await playFestival(at(2026, 10, 26, 0), 7, false), 13, 'weekly');
  assertEq(await playFestival(at(2026, 9, 28, 0), 7, false), 13, 'another weekly');
  assertEq(await playFestival(at(2026, 11, 17, 0), 14, true), 57, 'ลอยกระทง');
});

// ---- view, postcards, away ----

test('festivalView: tasks with names, claimable flags, days left, login and shop for the sheet', () => withFakeNow(at(2026, 10, 26, 10), clock => {
  const s = game();
  giveTasks(s, ['hatch_h', 'order', 'pat']);
  for (let i = 0; i < 3; i++) festivalEvent(s, 'order');
  const v = festivalView(s);
  assertEq([v.festival.id, v.festival.daysLeft, v.festival.peak, v.krathong], ['fest_water', 7, false, null]);
  assertEq(v.tasks.map(t => t.nameTh), ['ฟักน้องถิ่นแหล่งน้ำ', 'ส่งออเดอร์', 'ลูบหัวน้อง']);
  assertEq(v.tasks.map(t => t.claimable), [false, true, false]);
  assertEq(v.tasks.map(t => [t.progress, t.target]), [[0, 1], [3, 3], [0, 10]]);
  assertEq([v.lanterns, v.login.today, v.shop.length], [0, false, 1]);
  clock.set(at(2026, 11, 1, 20));
  assertEq(festivalView(s).festival.daysLeft, 1, 'last day');
  clock.set(at(2026, 11, 17, 0));
  const w = festivalView(s);
  assertEq([w.festival.daysLeft, w.krathong.stock, w.krathong.cap], [14, 0, 3]);
  clock.set(at(2026, 11, 30, 23, 59));
  assertEq(festivalView(s).festival.daysLeft, 1);
  assert(JSON.stringify(festivalView(s)) !== undefined, 'plain data');
}));

test('postcards: three krathong templates while ลอยกระทง is on; rehoming then writes one of them; otherwise the normal ones', () => {
  assertEq(KRATHONG_POSTCARDS.length, 3);
  assert(KRATHONG_POSTCARDS.every(t => /\{name\}/.test(t) && t.length < 120 && !POSTCARD_TEMPLATES.includes(t)));
  assertEq(festivalPostcardTemplates(TW), []);
  assertEq(festivalPostcardTemplates(at(2026, 11, 16, 23, 59)), []);
  assertEq(festivalPostcardTemplates(TL), KRATHONG_POSTCARDS);
  withFakeNow(TL, () => {
    const s = game();
    for (let i = 0; i < 6; i++) mkPet(s, { id: `r${i}`, nickname: `น้อง${i}` });
    for (let i = 0; i < 6; i++) assert(rehomePet(s, `r${i}`).ok);
    assertEq(s.postcards.length, 6);
    assert(s.postcards.every(c => /กระทง|โคมลอย/.test(c.text) && !c.text.includes('{')), JSON.stringify(s.postcards.map(c => c.text)));
  });
  withFakeNow(TW, () => {
    const s = game();
    mkPet(s, { id: 'r0' });
    rehomePet(s, 'r0');
    assert(!/กระทง|โคมลอย/.test(s.postcards[0].text), 'a normal card');
  });
});

test('pendingFestival: tells which festival began since the sheet was last used', () => withFakeNow(TW, clock => {
  const s = game();
  assertEq(pendingFestival(s), null, 'nothing known yet');
  ensureFestival(s);
  assertEq(pendingFestival(s), null, 'same festival');
  clock.set(at(2026, 10, 12, 9));
  const p = pendingFestival(s);
  assertEq([p.id, s.festival.id], ['fest_forest', 'fest_farm'], 'reported without changing the state');
}));

// ---- state v9 ----

test('state v9: new states carry the festival defaults', () => {
  assertEq(STATE_VERSION, 9);
  const s = createNewState();
  assertEq(s.festival, { id: '', key: '', tasks: [], loginDays: [], seenDays: [], ledger: {}, lanterns: 0, krathongs: 0, owned: {}, krathong: { day: '', n: 0 }, floatDays: {} });
  assertEq(s.version, 9);
});

test('migrate v8 -> v9: the fixture keeps everything and gains the festival defaults; idempotent; a v1 save climbs all the way', async () => {
  const raw = await loadFixture('save_v8_midgame');
  assertEq(raw.version, 8);
  const s = await withFakeNow(1790100000000, () => migrate(raw));
  assertEq([s.version, STATE_VERSION], [9, 9]);
  assertEq(s.festival, createNewState().festival);
  assertEq([s.player.coins, s.pets.length, s.nursery.length, s.wardrobe, s.coatsSeen], [raw.player.coins, raw.pets.length, raw.nursery.length, raw.wardrobe, raw.coatsSeen], 'v8 data kept');
  assertEq(s.pets[1].coat, 'cream');
  assertEq(migrate(JSON.parse(JSON.stringify(s))), s, 'idempotent');
  const old = await withFakeNow(1790100000000, async () => migrate(await loadFixture('save_v1_midgame')));
  assertEq([old.version, old.festival.lanterns, old.festival.tasks], [9, 0, []]);
});

test('v9 sanitiser: junk festival data repaired, lanterns <= 999, krathongs <= 5, unknown ids dropped, tasks keep a valid shape', () => {
  const day = i => `2026-11-${String(17 + i).padStart(2, '0')}`;
  const s = migrate({
    version: 8,
    festival: {
      id: 'fest_loykrathong', key: 'fest_loykrathong@2026-11-17', lanterns: 5000.9, krathongs: 17,
      owned: { acc_chada: true, ghost_item: true, acc_sabai: 'yes', decor_lanna_lamp: true, acc_strawhat: false },
      loginDays: [day(0), day(0), 'bad', 7, ...Array.from({ length: 12 }, (_, i) => day(i + 1))],
      krathong: { day: 'x', n: -3 },
      tasks: [
        { id: 'order', kind: 'order', target: 3, progress: 99, claimed: 1 },
        { id: 'order', kind: 'order', target: 3, progress: 1, claimed: false },
        { id: 'nope', kind: 'order', target: 3, progress: 1, claimed: false },
        'junk', null,
        { id: 'pat', kind: 'zzz', target: 'x', progress: -4, claimed: true },
        { id: 'harvest', target: 8, progress: 2.9 }, { id: 'feed_fav', target: 5, progress: 1 },
      ],
    },
  });
  const f = s.festival;
  assertEq([f.lanterns, f.krathongs], [999, 5]);
  assertEq(Object.keys(f.owned).sort(), ['acc_chada', 'decor_lanna_lamp']);
  assertEq(f.loginDays.length, 7);
  assertEq(new Set(f.loginDays).size, 7);
  assertEq(f.krathong, { day: '', n: 0 });
  assertEq(f.tasks.length, 3);
  assertEq(f.tasks[0], { id: 'order', kind: 'order', target: 3, progress: 3, claimed: false }, 'progress capped at the target, claimed must be true');
  assertEq(f.tasks[1], { id: 'pat', kind: 'pat', target: 10, progress: 0, claimed: true }, 'kind from the pool, target repaired');
  assertEq(f.tasks[2], { id: 'harvest', kind: 'harvest', target: 8, progress: 2, claimed: false });
  assertEq(migrate(JSON.parse(JSON.stringify(s))).festival, f, 'idempotent');
  // unknown festival id: everything tied to it goes, lanterns stay
  const u = migrate({ version: 8, festival: { id: 'fest_gone', key: 'k', tasks: [{ id: 'order', target: 3, progress: 1 }], loginDays: [day(0)], lanterns: 4 } }).festival;
  assertEq([u.id, u.key, u.tasks, u.loginDays, u.lanterns], ['', '', [], [], 4]);
  for (const junk of ['x', 7, null, [], { tasks: 'x', owned: [], loginDays: 5, krathong: 'k' }]) {
    const t = migrate({ version: 8, festival: junk }).festival;
    assertEq(t, createNewState().festival, `junk ${JSON.stringify(junk)}`);
  }
  assertEq(migrate({ version: 9, festival: { lanterns: -5, krathongs: NaN } }).festival.lanterns, 0);
});

test('v9 sanitiser: a rolled live festival state survives a save + load unchanged', () => withFakeNow(TL, () => {
  const s = game();
  const f = ensureFestival(s);
  f.lanterns = 11; f.krathongs = 3; f.loginDays = ['2026-11-17', '2026-11-18']; f.tasks[0].progress = 1; f.krathong = { day: '2026-11-18', n: 2 };
  const back = migrate(JSON.parse(JSON.stringify(s)));
  assertEq(back.festival, f);
}));

test('festival data: ids and tables match the contract (8 weekly + ลอยกระทง, 12 shop items, 6 tasks)', () => {
  assertEq(ITEMS.forage_herb !== undefined && ITEMS.forage_wood !== undefined, true, 'recipe items exist');
  assertEq(FESTIVAL_DEFS.length, 9);
  assertEq(WEEKLY_FESTIVALS.map(f => f.items[0].id), ['acc_strawhat', 'acc_leafcrown', 'acc_antenna', 'acc_floatie', 'acc_kitescarf', 'acc_beads', 'acc_beanie', 'acc_wizardhat']);
  assertEq(WEEKLY_FESTIVALS.map(f => f.items[0].slot), ['head', 'head', 'head', 'neck', 'neck', 'neck', 'head', 'head']);
  assertEq(WEEKLY_FESTIVALS.map(f => f.emoji), ['🌾', '🌲', '✨', '🌊', '🪁', '🥁', '❄️', '🔮']);
  assertEq(new Set(SHOP_ITEMS.map(i => i.id)).size, 12);
});

// ---- exploits: flipping the festival key or the clock must never pay twice ----

/** Does every task of the festival that is on (events + claims) and logs in. Returns lanterns gained. */
function playOut(s) {
  const before = s.festival.lanterns;
  const v = festivalView(s);
  loginLantern(s);
  for (const t of v.tasks) for (let i = 0; i < t.target + 1; i++) festivalEvent(s, t.kind, { habitat: v.festival.habitat });
  for (const t of festivalView(s).tasks) claimTask(s, t.id);
  return s.festival.lanterns - before;
}

test('exploit: flipping the festival key A -> B -> A (clock) restores each festival; tasks, claims and login never pay twice', () => withFakeNow(TW, clock => {
  const s = game();
  const A = TW, B = at(2026, 10, 14, 10);
  assertEq(playOut(s), 7, '6 for tasks + 1 login');
  clock.set(B);
  assertEq(playOut(s), 7, 'B pays once');
  const total = s.festival.lanterns;
  for (let i = 0; i < 6; i++) {
    clock.set(i % 2 ? B : A);
    assertEq(playOut(s), 0, `round ${i}: nothing again`);
    assert(festivalView(s).tasks.every(t => t.claimed), 'claims restored, not rerolled');
  }
  assertEq(s.festival.lanterns, total, 'lanterns unchanged');
  assertEq(Object.keys(s.festival.ledger).length, 1, 'the other key is filed in the ledger');
  // the same through a save + load
  const back = migrate(JSON.parse(JSON.stringify(s)));
  clock.set(A);
  assertEq(playOut(back), 0, 'after reload too');
  clock.set(B);
  assertEq(playOut(back), 0);
}));

test('exploit: the login lantern pays a calendar day once, whatever the key says (even when the festival data was wiped)', () => withFakeNow(TW, clock => {
  const s = game();
  assert(loginLantern(s).ok);
  const f = s.festival;
  f.key = 'something-else'; f.loginDays = []; f.tasks = [];          // as if a key flip had wiped them
  assert(!loginLantern(s).ok, 'seenDays remembers the day');
  assertEq(s.festival.lanterns, 1);
  clock.advance(DAY);
  assert(loginLantern(s).ok);
  clock.advance(-DAY);
  assert(!loginLantern(s).ok, 'going back a day pays nothing');
  assertEq(s.festival.lanterns, 2);
  for (let i = 2; i < 40; i++) { clock.set(TW + i * DAY); loginLantern(s); }
  assert(s.festival.seenDays.length <= 30, 'seenDays capped');
}));

test('exploit: going back and forth between two days never resets the float count (3 a day, 5 on the peak night)', () => withFakeNow(at(2026, 11, 18, 10), clock => {
  const { s, f, pet } = loySetup();
  const floats = () => { let n = 0; for (let i = 0; i < 8; i++) { f.krathongs = 5; if (floatKrathong(s, pet.id).ok) n++; } return n; };
  const D18 = at(2026, 11, 18, 10), D19 = at(2026, 11, 19, 10);
  const got = [];
  for (const t of [D18, D19, D18, D19, D18, D19]) { clock.set(t); got.push(floats()); }
  assertEq(got, [3, 3, 0, 0, 0, 0]);
  assertEq(f.lanterns, 6);
  const m = at(2026, 11, 24, 10), e = at(2026, 11, 24, 20);
  const peak = [];
  for (const t of [m, e, m, e, at(2026, 11, 23, 10), e]) { clock.set(t); peak.push(floats()); }
  assertEq(peak, [3, 2, 0, 0, 3, 0]);
  assert(Object.keys(f.floatDays).length <= 10);
  const back = migrate(JSON.parse(JSON.stringify(s)));
  assertEq(Object.entries(back.festival.floatDays).sort(), Object.entries(f.floatDays).sort(), 'floatDays survive a save');
}));

test('exploit: a clock that jumps through many weeks keeps the ledger small and still restores recent keys', () => withFakeNow(TW, clock => {
  const s = game();
  const weeks = Array.from({ length: LEDGER_MAX + 4 }, (_, i) => at(2026, 7, 6 + 7 * i, 10));
  for (const t of weeks) { clock.set(t); ensureFestival(s); }
  assert(Object.keys(s.festival.ledger).length <= LEDGER_MAX, 'ledger capped: ' + Object.keys(s.festival.ledger).length);
  clock.set(weeks[weeks.length - 2]);
  ensureFestival(s);
  assertEq(s.festival.key, activeFestival(weeks[weeks.length - 2]).key);
}));

test('debug override: honoured only on localhost / 127.0.0.1 / *.localhost, never elsewhere', () => {
  const q = '?debug=1&fest=fest_polar';
  for (const host of ['localhost', '127.0.0.1', 'dev.localhost', '[::1]']) assertEq(activeFestival(TW, { search: q, host }).id, 'fest_polar', host);
  for (const host of ['example.com', 'oak.github.io', 'localhost.evil.com', 'evil-localhost.com', '127.0.0.1.evil.com', '']) assertEq(activeFestival(TW, { search: q, host }).id, 'fest_farm', `ignored on "${host}"`);
});

test('debug override: a forced festival lives for the session only; the save never gets a debug key', () => {
  withFakeNow(TW, () => {
    const s = game();
    ensureFestival(s);
    const realKey = s.festival.key, realTasks = JSON.stringify(s.festival.tasks);
    setFestivalDebugSource({ search: '?debug=1&fest=fest_loykrathong', host: 'localhost' });
    try {
      const v = festivalView(s);
      assertEq([v.festival.id, v.festival.kind], [LOY_ID, 'special']);
      assert(v.krathong, 'the krathong panel is there to look at');
      festivalEvent(s, 'order'); festivalEvent(s, 'pat');
      s.festival.krathongs = 2;
      assert(floatKrathong(s, mkPet(s).id).ok, 'floating works in debug');
      assertEq(s.festival.key, realKey, 'the saved key is the real one');
      assertEq(JSON.stringify(s.festival.tasks), realTasks, 'real tasks untouched');
      assert(!JSON.stringify(s).includes('debug:'), 'no debug key anywhere in the save');
      setFestivalDebugSource(null);
      assertEq(festivalView(s).festival.id, 'fest_farm');
      assertEq(s.festival.key, realKey);
    } finally {
      setFestivalDebugSource(null);
    }
  });
});

test('v9 sanitiser: ledger / day lists capped, incomplete task lists clear the key, debug keys and unknown fields never survive', () => {
  const task = id => { const d = TASK_POOL.find(t => t.id === id); return { id, kind: d.kind, target: d.target, progress: 1, claimed: false }; };
  const three = [task('order'), task('pat'), task('harvest')];
  const ledger = {};
  for (let i = 0; i < 15; i++) ledger[`2026-W${10 + i}`] = { tasks: three, loginDays: ['2026-03-01'] };
  ledger['debug:fest_polar'] = { tasks: three, loginDays: [] };
  ledger.bad = { tasks: [task('order')], loginDays: [] };
  ledger.junk = 5;
  const days = n => Array.from({ length: n }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  const s = migrate({
    version: 9,
    festival: {
      id: 'fest_farm', key: '2026-W41', tasks: three, ledger, evil: { x: 1 }, seenDays: [...days(31), 'junk'],
      floatDays: { '2026-11-01': 2, '2026-11-02': 'x', '2026-11-03': 500, bad: 1, ...Object.fromEntries(days(12).map((d, i) => [d, 1 + (i % 3)])) },
    },
  });
  const f = s.festival;
  assert(!('evil' in f), 'unknown field dropped');
  assertEq(Object.keys(f).sort(), Object.keys(createNewState().festival).sort());
  assertEq(Object.keys(f.ledger).length, 10);
  assert(!('debug:fest_polar' in f.ledger) && !('bad' in f.ledger) && !('junk' in f.ledger));
  assertEq(f.seenDays.length, 30);
  assertEq(f.seenDays[29], days(31)[30], 'newest kept');
  assertEq(Object.keys(f.floatDays).length, 10);
  assertEq(f.floatDays['2026-11-03'], 99, 'count capped');
  assert(!('2026-11-02' in f.floatDays) && !('bad' in f.floatDays));
  assertEq(migrate(JSON.parse(JSON.stringify(s))).festival, f, 'idempotent');
  const short = migrate({ version: 9, festival: { id: 'fest_farm', key: '2026-W41', tasks: [task('order')], lanterns: 5 } }).festival;
  assertEq([short.key, short.tasks, short.lanterns], ['', [], 5]);
  assertEq(migrate({ version: 9, festival: { id: 'fest_farm', key: 'debug:fest_farm', tasks: three } }).festival.key, '', 'debug key cleared');
  withFakeNow(TW, () => {
    const t = migrate({ version: 9, festival: { id: 'fest_farm', key: '2026-W41', tasks: [task('order')] } });
    assertEq(ensureFestival(t).tasks.length, 3, 'rerolled to a full list');
  });
});

// Pets logic tests: decay, sickness, feeding, growth, release, stardust, book goals, stats.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { createNewState, addItem, countItem } from '../js/state.js';
import { now } from '../js/util.js';
import { SPECIES, HABITATS, getSpecies } from '../js/data/species.js';
import { EGGS } from '../js/data/eggs.js';
import { getItem } from '../js/data/items.js';
import { TRAITS } from '../js/data/traits.js';
import {
  STAGES, tickPets, putEggInIncubator, hatchReady, feedPet, foodEffect, playWithPet, cleanPet, pickPoop,
  giveToy, healPet, toggleSleep, renamePet, releasePet, addPetXp, canWork, getWorkPower,
  makeShiny, buyHabitatEgg, BOOK_GOALS, claimGoal,
  getTrait, traitEffect, bondHearts, bondPowerMult, addBond, claimGift, bondProgress,
} from '../js/pets.js';

const HOUR = 3600 * 1000;
const MIN = 60 * 1000;

const near = (a, b, msg, eps = 1e-6) => assert(Math.abs(a - b) < eps, `${msg}: expected ${b}, got ${a}`);

/** Fresh state with one hand-built pet (personality 'hardworking' = neutral multipliers). */
function setup(speciesId = 'hamster', over = {}) {
  const s = createNewState();
  s.barnCapacity = 10;
  const pet = {
    id: 'p1', speciesId, nickname: 'ทดสอบ', shiny: false, personality: 'hardworking',
    stage: 0, xp: 0, stats: { hunger: 100, happy: 100, energy: 100, clean: 100 },
    poop: 0, sick: false, zeroSince: null, zeroMs: 0, poopTimer: null, lastFedAt: 0,
    bond: 0, bondDay: null, bondToday: 0, giftDay: null,
    status: 'idle', task: null, bornAt: now(), ...over,
  };
  if (over.stats) pet.stats = { hunger: 100, happy: 100, energy: 100, clean: 100, ...over.stats };
  s.pets.push(pet);
  return { s, pet };
}

// ── data sanity ─────────────────────────────────────────────────────────────
test('species: >=110, unique ids, every habitat >=8, every favorite is edible', () => {
  assert(SPECIES.length >= 110, 'species count ' + SPECIES.length);
  assertEq(new Set(SPECIES.map(x => x.id)).size, SPECIES.length, 'unique ids');
  for (const h of Object.keys(HABITATS)) {
    assert(SPECIES.filter(x => x.habitat === h).length >= 8, 'habitat ' + h);
  }
  for (const sp of SPECIES) {
    const fav = getItem(sp.favorite);
    assert(fav && fav.food, `${sp.id} favorite ${sp.favorite} must be edible`);
    assert(Object.values(sp.jobs).some(v => v >= 1), `${sp.id} has a job`);
  }
  assertEq(EGGS.length, 8, 'eggs');
});

// ── decay ───────────────────────────────────────────────────────────────────
test('decay per hour: hunger 6, happy 4, clean 3, idle energy +3', () => {
  const { s, pet } = setup('hamster', { stats: { energy: 50 } });
  tickPets(s, HOUR, { offline: false });
  near(pet.stats.hunger, 94, 'hunger');
  near(pet.stats.happy, 96, 'happy');
  near(pet.stats.clean, 97, 'clean');
  near(pet.stats.energy, 53, 'energy');
});

test('offline halves decay but not regen', () => {
  const { s, pet } = setup('hamster', { stats: { energy: 50 } });
  tickPets(s, HOUR, { offline: true });
  near(pet.stats.hunger, 97, 'hunger');
  near(pet.stats.happy, 98, 'happy');
  near(pet.stats.clean, 98.5, 'clean');
  near(pet.stats.energy, 53, 'energy regen is not halved');
});

test('sleeping: energy +20/h, other decays halved', () => {
  const { s, pet } = setup('hamster', { status: 'sleeping', stats: { energy: 40 } });
  tickPets(s, HOUR, { offline: false });
  near(pet.stats.energy, 60, 'energy');
  near(pet.stats.hunger, 97, 'hunger');
  near(pet.stats.happy, 98, 'happy');
});

test('sleeping pet wakes at full energy', () => {
  const { s, pet } = setup('hamster', { status: 'sleeping', stats: { energy: 95 } });
  tickPets(s, HOUR, { offline: true });
  assertEq(pet.status, 'idle', 'woke up');
});

test('working/expedition drains energy 12/h (offline halves it)', () => {
  const a = setup('hamster', { status: 'working', task: { type: 'plot', plotIndex: 0 } });
  tickPets(a.s, HOUR, { offline: false });
  near(a.pet.stats.energy, 88, 'working');
  const b = setup('hamster', { status: 'expedition' });
  tickPets(b.s, HOUR, { offline: true });
  near(b.pet.stats.energy, 94, 'expedition offline');
});

test('personalities change decay and work power', () => {
  const g = setup('hamster', { personality: 'glutton' });
  tickPets(g.s, HOUR, { offline: false });
  near(g.pet.stats.hunger, 100 - 6 * 1.4, 'glutton hunger');
  const c = setup('hamster', { personality: 'cheerful' });
  tickPets(c.s, HOUR, { offline: false });
  near(c.pet.stats.happy, 100 - 4 * 0.6, 'cheerful happy');
  const l = setup('hamster', { personality: 'lazy', status: 'working', task: { type: 'plot', plotIndex: 0 } });
  tickPets(l.s, HOUR, { offline: false });
  near(l.pet.stats.energy, 100 - 12 * 0.7, 'lazy energy drain');
  const jobs = ['dig'];
  const base = getWorkPower(setup('hamster', { personality: 'cheerful' }).pet, jobs);
  near(getWorkPower(setup('hamster', { personality: 'hardworking' }).pet, jobs), base * 1.2, 'hardworking x1.2');
  near(getWorkPower(setup('hamster', { personality: 'lazy' }).pet, jobs), base * 0.85, 'lazy x0.85');
});

test('poop appears ~2h after eating, max 3, each poop adds +3/h clean decay', () => {
  const { s, pet } = setup('hamster', { stats: { hunger: 20 } });
  addItem(s, 'food_kibble', 1);
  assert(feedPet(s, pet.id, 'food_kibble').ok, 'fed');
  for (let i = 0; i < 119; i++) tickPets(s, MIN, { offline: false });
  assertEq(pet.poop, 0, 'no poop before 2h');
  tickPets(s, 2 * MIN, { offline: false });
  assertEq(pet.poop, 1, 'poop after 2h');
  const cleanBefore = pet.stats.clean = 100;
  pet.poop = 2;
  tickPets(s, HOUR, { offline: false });
  near(pet.stats.clean, cleanBefore - (3 + 3 * 2), 'clean decay with 2 poops');
  pet.poop = 3; pet.poopTimer = 0;
  tickPets(s, 3 * HOUR, { offline: false });
  assertEq(pet.poop, 3, 'poop is capped at 3');
});

// ── sickness ────────────────────────────────────────────────────────────────
test('sick after 2h at 0 hunger (not before); sick doubles happy decay', () => {
  const { s, pet } = setup('hamster', { stats: { hunger: 0 } });
  for (let i = 0; i < 119; i++) tickPets(s, MIN, { offline: false });
  assertEq(pet.sick, false, 'not sick at 1h59');
  for (let i = 0; i < 2; i++) tickPets(s, MIN, { offline: false });
  assertEq(pet.sick, true, 'sick at 2h');
  pet.stats.happy = 100;
  tickPets(s, HOUR, { offline: false });
  near(pet.stats.happy, 100 - 8, 'happy decays x2 when sick');
});

test('sickness also triggers from clean at 0, and resets when fixed in time', () => {
  const a = setup('hamster', { stats: { clean: 0 } });
  tickPets(a.s, 2 * HOUR, { offline: false });
  assertEq(a.pet.sick, true, 'sick from clean = 0');
  const b = setup('hamster', { stats: { hunger: 0 } });
  tickPets(b.s, 90 * MIN, { offline: false });
  b.pet.stats.hunger = 50;
  tickPets(b.s, MIN, { offline: false });
  assertEq(b.pet.zeroMs, 0, 'timer reset');
  b.pet.stats.hunger = 0;
  tickPets(b.s, 90 * MIN, { offline: false });
  assertEq(b.pet.sick, false, 'two separate 90 min spells do not add up');
});

test('healPet needs medicine and a sick pet', () => {
  const { s, pet } = setup();
  assertEq(healPet(s, pet.id).ok, false, 'not sick');
  pet.sick = true;
  assertEq(healPet(s, pet.id).ok, false, 'no medicine');
  addItem(s, 'care_medicine', 1);
  assert(healPet(s, pet.id).ok, 'healed');
  assertEq(pet.sick, false, 'sick cleared');
  assertEq(countItem(s, 'care_medicine'), 0, 'medicine consumed');
});

// ── feeding ─────────────────────────────────────────────────────────────────
test('foodEffect: diet match full, mismatch half, favorite happy x2, glutton x1.5', () => {
  const corn = getItem('crop_corn');       // hamster favorite (grain)
  const milk = getItem('food_milk');       // hamster does not eat milk
  const kibble = getItem('food_kibble');   // grain tag: match, not favorite
  const { pet } = setup('hamster');
  let fx = foodEffect(pet, corn);
  assert(fx.favorite && fx.match, 'favorite');
  near(fx.hunger, corn.food.hunger, 'fav hunger');
  near(fx.happy, corn.food.happy * 2, 'fav happy x2');
  fx = foodEffect(pet, kibble);
  assert(!fx.favorite && fx.match, 'match only');
  near(fx.happy, kibble.food.happy, 'match happy');
  fx = foodEffect(pet, milk);
  assert(!fx.match, 'no match');
  near(fx.hunger, milk.food.hunger * 0.5, 'half hunger');
  near(fx.happy, milk.food.happy * 0.5, 'half happy');
  const glutton = setup('hamster', { personality: 'glutton' }).pet;
  near(foodEffect(glutton, corn).happy, corn.food.happy * 2 * 1.5, 'glutton favorite');
  near(foodEffect(glutton, milk).happy, milk.food.happy * 0.5 * 1.5, 'glutton mismatch');
});

test('feedPet applies foodEffect, consumes item, bumps stat and gives xp', () => {
  const { s, pet } = setup('hamster', { stats: { hunger: 20, happy: 10 } });
  addItem(s, 'crop_corn', 2);
  const fx = foodEffect(pet, getItem('crop_corn'));
  const r = feedPet(s, pet.id, 'crop_corn');
  assert(r.ok, 'ok');
  near(pet.stats.hunger, Math.min(100, 20 + fx.hunger), 'hunger');
  near(pet.stats.happy, Math.min(100, 10 + fx.happy), 'happy');
  assertEq(countItem(s, 'crop_corn'), 1, 'consumed one');
  assertEq(s.stats.fed, 1, 'stats.fed');
  assertEq(pet.xp, 2, 'xp +2');
});

test('feedPet refusals: no item, inedible, full, sleeping', () => {
  const { s, pet } = setup('hamster', { stats: { hunger: 50 } });
  s.inventory = {};
  assertEq(feedPet(s, pet.id, 'food_kibble').ok, false, 'no item');
  addItem(s, 'care_toy', 1);
  assertEq(feedPet(s, pet.id, 'care_toy').ok, false, 'inedible');
  addItem(s, 'food_kibble', 1);
  pet.stats.hunger = 100;
  assertEq(feedPet(s, pet.id, 'food_kibble').ok, false, 'full');
  pet.stats.hunger = 50; pet.status = 'sleeping';
  assertEq(feedPet(s, pet.id, 'food_kibble').ok, false, 'sleeping');
  assertEq(countItem(s, 'food_kibble'), 1, 'nothing consumed on failures');
});

// ── growth ──────────────────────────────────────────────────────────────────
test('stage thresholds 0 / 25 / 200 / 600', () => {
  assertEq(STAGES.map(x => x.xp).join(','), '0,25,200,600', 'table');
  const { s, pet } = setup();
  addPetXp(s, pet.id, 24); assertEq(pet.stage, 0, '24 xp');
  addPetXp(s, pet.id, 1); assertEq(pet.stage, 1, '25 xp');
  addPetXp(s, pet.id, 174); assertEq(pet.stage, 1, '199 xp');
  addPetXp(s, pet.id, 1); assertEq(pet.stage, 2, '200 xp');
  addPetXp(s, pet.id, 399); assertEq(pet.stage, 2, '599 xp');
  addPetXp(s, pet.id, 1); assertEq(pet.stage, 3, '600 xp');
  const big = setup();
  addPetXp(big.s, big.pet.id, 1000); assertEq(big.pet.stage, 3, 'jumps several stages at once');
});

test('canWork and mood multiplier', () => {
  const { pet } = setup();
  assert(canWork(pet).ok, 'healthy idle pet can work');
  assertEq(canWork({ ...pet, sick: true }).ok, false, 'sick');
  assertEq(canWork({ ...pet, status: 'sleeping' }).ok, false, 'sleeping');
  assertEq(canWork({ ...pet, stats: { ...pet.stats, energy: 19 } }).ok, false, 'tired');
  assertEq(canWork({ ...pet, stats: { ...pet.stats, hunger: 14 } }).ok, false, 'hungry');
  const power = happy => getWorkPower({ ...pet, stage: 2, stats: { ...pet.stats, happy } }, ['dig']);
  near(power(70) / power(69.9), 1.2, 'happy >= 70 -> x1.2');
  near(power(30) / power(29.9), 1 / 0.7, 'happy >= 30 -> x1.0 vs x0.7');
});

// ── hatching & incubator ────────────────────────────────────────────────────
test('incubator holds several slots; hatch creates a pet, collection entry, stat', () => {
  const s = createNewState();
  s.incubatorCapacity = 3;
  addItem(s, 'egg_farm', 3);
  for (let i = 0; i < 3; i++) assert(putEggInIncubator(s, 'egg_farm').ok, 'put ' + i);
  assertEq(putEggInIncubator(s, 'egg_farm').ok, false, 'full');
  assertEq(hatchReady(s, 0).ok, false, 'not ready yet');
  s.incubator.forEach(slot => { slot.readyAt = now() - 1; });
  const r = hatchReady(s, 1);
  assert(r.ok && r.pet, 'hatched');
  assertEq(s.incubator.length, 2, 'slot removed');
  assertEq(getSpecies(r.pet.speciesId).habitat, 'farm', 'farm egg -> farm species');
  assertEq(s.collection[r.pet.speciesId].owned, 1, 'collection');
  assertEq(s.stats.hatched, 1, 'stats.hatched');
  s.barnCapacity = 1;
  assertEq(hatchReady(s, 0).ok, false, 'barn full');
});

// ── release & stardust ──────────────────────────────────────────────────────
test('release gives 10 coins + stardust by rarity (shiny x2) and bumps stat', () => {
  const cases = [['hamster', 1], ['rabbit', 2], ['llama', 5], ['turkey', 10], ['racehorse', 25]];
  for (const [sid, dust] of cases) {
    const { s, pet } = setup(sid);
    const coins = s.player.coins;
    const r = releasePet(s, pet.id);
    assert(r.ok, sid + ' released');
    assertEq(s.player.coins, coins + 10, sid + ' coins');
    assertEq(s.stardust, dust, sid + ' stardust');
    assertEq(s.pets.length, 0, 'pet removed');
  }
  const sh = setup('racehorse', { shiny: true });
  releasePet(sh.s, sh.pet.id);
  assertEq(sh.s.stardust, 50, 'shiny x2');
  assertEq(sh.s.stats.released, 1, 'stats.released');
  const busy = setup('hamster', { status: 'working' });
  assertEq(releasePet(busy.s, busy.pet.id).ok, false, 'working pet cannot be released');
  assertEq(busy.s.pets.length, 1, 'still there');
});

test('makeShiny: costs 100 stardust, checks balance and double use', () => {
  const { s, pet } = setup('hamster');
  s.collection.hamster = { owned: 1, shiny: false };
  s.stardust = 99;
  assertEq(makeShiny(s, pet.id).ok, false, 'not enough');
  assertEq(s.stardust, 99, 'unchanged');
  assertEq(pet.shiny, false, 'not shiny');
  s.stardust = 130;
  assert(makeShiny(s, pet.id).ok, 'made shiny');
  assertEq(s.stardust, 30, 'cost 100');
  assertEq(pet.shiny, true, 'shiny');
  assertEq(s.collection.hamster.shiny, true, 'collection shiny flag');
  s.stardust = 500;
  assertEq(makeShiny(s, pet.id).ok, false, 'already shiny');
  assertEq(s.stardust, 500, 'no charge for already shiny');
  assertEq(makeShiny(s, 'nope').ok, false, 'unknown pet');
});

test('buyHabitatEgg: costs 40, needs stardust and the egg unlock level', () => {
  const s = createNewState();
  s.stardust = 39;
  assertEq(buyHabitatEgg(s, 'farm').ok, false, 'not enough stardust');
  s.stardust = 200;
  const before = countItem(s, 'egg_farm');
  assert(buyHabitatEgg(s, 'farm').ok, 'farm egg at level 1');
  assertEq(s.stardust, 160, 'cost 40');
  assertEq(countItem(s, 'egg_farm'), before + 1, 'egg added');
  s.player.level = 1;
  assertEq(buyHabitatEgg(s, 'mystic').ok, false, 'mystic locked at level 1');
  assertEq(s.stardust, 160, 'no charge when locked');
  s.player.level = 10;
  assert(buyHabitatEgg(s, 'mystic').ok, 'mystic at level 10');
  assertEq(countItem(s, 'egg_mystic'), 1, 'mystic egg');
  assertEq(buyHabitatEgg(s, 'nowhere').ok, false, 'unknown habitat');
});

// ── book goals ──────────────────────────────────────────────────────────────
test('BOOK_GOALS shape: unique ids, per habitat 3/6/all, global 25/50/all + shiny', () => {
  assertEq(new Set(BOOK_GOALS.map(g => g.id)).size, BOOK_GOALS.length, 'unique ids');
  for (const h of Object.keys(HABITATS)) {
    for (const k of ['3', '6', 'all']) assert(BOOK_GOALS.some(g => g.id === `${h}_${k}`), `${h}_${k}`);
  }
  for (const id of ['species_25', 'species_50', 'species_all', 'shiny_first']) {
    assert(BOOK_GOALS.some(g => g.id === id), id);
  }
  for (const g of BOOK_GOALS) {
    assert(typeof g.check === 'function' && g.titleTh && g.reward, g.id + ' shape');
  }
});

test('claimGoal: not before the check passes, only once, grants reward', () => {
  const s = createNewState();
  const coins = s.player.coins;
  assertEq(claimGoal(s, 'farm_3').ok, false, 'before check');
  assertEq(s.claimedGoals.length, 0, 'nothing recorded');
  const farm = SPECIES.filter(x => x.habitat === 'farm');
  for (const sp of farm.slice(0, 3)) s.collection[sp.id] = { owned: 1, shiny: false };
  const r = claimGoal(s, 'farm_3');
  assert(r.ok, 'claim ok');
  assertEq(s.player.coins, coins + 100, 'coins reward');
  assertEq(s.stardust, 10, 'stardust reward');
  assertEq(claimGoal(s, 'farm_3').ok, false, 'second claim refused');
  assertEq(s.player.coins, coins + 100, 'no double coins');
  assertEq(s.stardust, 10, 'no double stardust');
  assertEq(s.claimedGoals.filter(x => x === 'farm_3').length, 1, 'recorded once');
  assertEq(claimGoal(s, 'farm_6').ok, false, 'next tier still locked');
  assertEq(claimGoal(s, 'does_not_exist').ok, false, 'unknown goal');
});

test('claimGoal: habitat-all gives its egg + 50 stardust; shiny goal follows collection', () => {
  const s = createNewState();
  for (const sp of SPECIES.filter(x => x.habitat === 'polar')) s.collection[sp.id] = { owned: 1, shiny: false };
  const eggs = countItem(s, 'egg_polar');
  assert(claimGoal(s, 'polar_all').ok, 'polar all');
  assertEq(countItem(s, 'egg_polar'), eggs + 1, 'egg reward');
  assertEq(s.stardust, 50, 'stardust');
  assertEq(claimGoal(s, 'shiny_first').ok, false, 'no shiny yet');
  s.collection.penguin.shiny = true;
  assert(claimGoal(s, 'shiny_first').ok, 'shiny claimed');
});

test('claimGoal works on a save without claimedGoals (pre-migration)', () => {
  const s = createNewState();
  delete s.claimedGoals;
  for (const sp of SPECIES.filter(x => x.habitat === 'farm').slice(0, 3)) s.collection[sp.id] = { owned: 1, shiny: false };
  assert(claimGoal(s, 'farm_3').ok, 'claimed');
  assertEq(claimGoal(s, 'farm_3').ok, false, 'not twice');
});

// ── lifetime stats ──────────────────────────────────────────────────────────
test('bumpStat keys: fed, played, cleaned, released (+ toy counts as played)', () => {
  const { s, pet } = setup('hamster', { stats: { hunger: 50, happy: 50, clean: 50 }, poop: 1 });
  addItem(s, 'food_kibble', 1); addItem(s, 'care_toy', 1);
  feedPet(s, pet.id, 'food_kibble');
  assertEq(s.stats.fed, 1, 'fed');
  playWithPet(s, pet.id);
  assertEq(s.stats.played, 1, 'played');
  giveToy(s, pet.id);
  assertEq(s.stats.played, 2, 'toy counts as played');
  pickPoop(s, pet.id);
  assertEq(s.stats.cleaned, 1, 'pickPoop -> cleaned');
  cleanPet(s, pet.id);
  assertEq(s.stats.cleaned, 2, 'cleanPet -> cleaned');
  releasePet(s, pet.id);
  assertEq(s.stats.released, 1, 'released');
});

test('failed actions do not bump stats', () => {
  const { s, pet } = setup('hamster', { stats: { hunger: 50 } });
  s.inventory = {};
  feedPet(s, pet.id, 'food_kibble');          // none in bag
  playWithPet(s, pet.id);                      // happy already full
  giveToy(s, pet.id);                          // no toy
  cleanPet(s, pet.id);                         // already clean
  pickPoop(s, pet.id);                         // no poop
  const st = s.stats || {};
  for (const k of ['fed', 'played', 'cleaned', 'released']) assertEq(st[k] || 0, 0, k);
});

// ── misc actions ────────────────────────────────────────────────────────────
test('rename trims, caps at 16 chars, rejects empty; sleep toggles', () => {
  const { s, pet } = setup();
  assert(renamePet(s, pet.id, '  ข้าวต้ม  ').ok, 'rename');
  assertEq(pet.nickname, 'ข้าวต้ม', 'trimmed');
  renamePet(s, pet.id, 'x'.repeat(40));
  assertEq(Array.from(pet.nickname).length, 16, 'max 16');
  assertEq(renamePet(s, pet.id, '   ').ok, false, 'empty rejected');
  pet.stats.energy = 50;
  assert(toggleSleep(s, pet.id).ok && pet.status === 'sleeping', 'sleep');
  assert(toggleSleep(s, pet.id).ok && pet.status === 'idle', 'wake');
  pet.status = 'working';
  assertEq(toggleSleep(s, pet.id).ok, false, 'cannot sleep while working');
});

// ── traits (CONTRACT_V3 §2) ─────────────────────────────────────────────────
const petOf = sid => setup(sid).pet;
const fx = (sid, ctx) => traitEffect(petOf(sid), ctx);

test('traits: 12 defined, every species has a valid one, each used by >= 4 species', () => {
  assertEq(Object.keys(TRAITS).length, 12, 'trait count');
  const used = {};
  for (const sp of SPECIES) {
    assert(TRAITS[sp.trait], `${sp.id} has valid trait (${sp.trait})`);
    used[sp.trait] = (used[sp.trait] || 0) + 1;
  }
  for (const id of Object.keys(TRAITS)) assert((used[id] || 0) >= 4, `${id} used by ${used[id] || 0}`);
  for (const def of Object.values(TRAITS)) assert(def.nameTh && def.emoji && def.descTh, 'trait text');
});

test('getTrait: scale follows rarity', () => {
  const scale = sid => getTrait(petOf(sid)).scale;
  assertEq(scale('fox'), 1, 'common');
  assertEq(scale('skunk'), 1.1, 'uncommon');
  assertEq(scale('owl'), 1.25, 'rare');
  assertEq(scale('leopard'), 1.5, 'epic');
  assertEq(scale('panda'), 2, 'legendary');
  assertEq(getTrait({ speciesId: 'nope' }), null, 'unknown species');
});

test('trait nightOwl: +30% 19:00-06:00, scaled by rarity', () => {
  const k = h => ({ kind: 'plot', jobs: ['dig'], hour: h });
  near(fx('fox', k(22)).power, 1.3, 'common at night');
  near(fx('fox', k(5)).power, 1.3, '05:00 still night');
  near(fx('fox', k(6)).power, 1, '06:00 day');
  near(fx('fox', k(18)).power, 1, '18:00 day');
  near(fx('fox', k(19)).power, 1.3, '19:00 night');
  near(fx('owl', k(0)).power, 1 + 0.3 * 1.25, 'rare owl');
  near(fx('leopard', k(0)).power, 1 + 0.3 * 1.5, 'epic');
});

test('trait earlyBird / sunLover windows', () => {
  const k = h => ({ kind: 'plot', jobs: ['dig'], hour: h });
  near(fx('chicken', k(5)).power, 1.3, 'earlyBird 05');
  near(fx('chicken', k(10)).power, 1.3, 'earlyBird 10');
  near(fx('chicken', k(11)).power, 1, 'earlyBird 11');
  near(fx('chicken', k(4)).power, 1, 'earlyBird 04');
  near(fx('lizard', k(11)).power, 1.25, 'sunLover 11');
  near(fx('lizard', k(16)).power, 1.25, 'sunLover 16');
  near(fx('lizard', k(17)).power, 1, 'sunLover 17');
  near(fx('lion', k(12)).power, 1 + 0.25 * 2, 'legendary sunLover');
});

test('trait waterLover / digger depend on the crop jobs or the zone', () => {
  near(fx('duck', { kind: 'plot', jobs: ['water'], hour: 12 }).power, 1.25, 'water crop');
  near(fx('duck', { kind: 'plot', jobs: ['dig'], hour: 12 }).power, 1, 'dig crop');
  near(fx('duck', { kind: 'expedition', jobs: ['fish'], zoneId: 'pond', hour: 12 }).power, 1.25, 'pond');
  near(fx('duck', { kind: 'expedition', jobs: ['forage'], zoneId: 'forest', hour: 12 }).power, 1, 'forest');
  near(fx('hamster', { kind: 'plot', jobs: ['dig'], hour: 12 }).power, 1.25, 'dig crop');
  near(fx('hamster', { kind: 'plot', jobs: ['water'], hour: 12 }).power, 1, 'water crop');
  near(fx('hamster', { kind: 'expedition', jobs: ['dig'], zoneId: 'mountain', hour: 12 }).power, 1.25, 'mountain');
  near(fx('hamster', { kind: 'expedition', jobs: ['dig'], zoneId: 'pond', hour: 12 }).power, 1, 'pond');
  near(fx('humpback', { kind: 'plot', jobs: ['water'], hour: 12 }).power, 1.5, 'legendary water lover (x2 bonus)');
});

test('trait teamPlayer / loner depend on team size', () => {
  const k = n => ({ kind: 'plot', jobs: ['dig'], teamSize: n, hour: 12 });
  near(fx('sheep', k(1)).power, 1, 'alone');
  near(fx('sheep', k(2)).power, 1.1, 'one partner');
  near(fx('sheep', k(3)).power, 1.2, 'two partners');
  near(fx('cat', k(1)).power, 1.3, 'loner alone');
  near(fx('cat', k(2)).power, 1, 'loner in a team');
  near(fx('cat', { kind: 'expedition', jobs: ['forage'], hour: 12 }).power, 1, 'loner bonus is plot-only');
});

test('trait harvester / forager / lucky give integer and chance bonuses', () => {
  const plot = { kind: 'plot', jobs: ['dig'], hour: 12 };
  const trip = { kind: 'expedition', jobs: ['forage'], zoneId: 'forest', hour: 12 };
  assertEq(fx('llama', plot).yieldBonus, 1, 'rare harvester +1');
  assertEq(fx('turkey', plot).yieldBonus, 2, 'epic harvester +2');
  assertEq(fx('unicorn', plot).yieldBonus, 2, 'legendary harvester +2');
  assertEq(fx('llama', trip).yieldBonus, 0, 'no harvest bonus on expeditions');
  assertEq(fx('goat', trip).extraRolls, 1, 'forager +1 roll');
  assertEq(fx('goat', plot).extraRolls, 0, 'forager only on expeditions');
  near(fx('ladybug', trip).eggChanceMult, 2, 'lucky x2 (common)');
  near(fx('rabbit', trip).eggChanceMult, 2.1, 'lucky uncommon');
  near(fx('dragon', trip).eggChanceMult, 3, 'legendary lucky');
  near(fx('ladybug', plot).eggChanceMult, 1, 'lucky only on expeditions');
  near(fx('hamster', trip).eggChanceMult, 1, 'others are neutral');
});

test('trait tireless slows work energy drain; gourmet boosts food happy', () => {
  const drain = sid => {
    const { s, pet } = setup(sid, { status: 'working', task: { type: 'plot', plotIndex: 0, slot: 0 } });
    tickPets(s, HOUR, { offline: false });
    return 100 - pet.stats.energy;
  };
  near(drain('cow'), 12 * 0.7, 'tireless common');
  near(drain('racehorse'), 12 * 0.4, 'tireless legendary');
  near(drain('hamster'), 12, 'no trait');
  const potato = getItem('crop_potato');   // pig favorite
  near(foodEffect(petOf('pig'), potato).happy, potato.food.happy * 2 * 1.5, 'gourmet common x1.5');
  const leaf = getItem('food_leaf');       // panda favorite
  near(foodEffect(petOf('panda'), leaf).happy, leaf.food.happy * 2 * 2, 'gourmet legendary x2');
});

test('getWorkPower: ctx adds trait + bond, no ctx stays the plain formula', () => {
  const pet = petOf('hamster');
  const plain = getWorkPower(pet, ['dig']);
  near(getWorkPower(pet, ['dig'], undefined), plain, 'undefined ctx');
  near(getWorkPower(pet, ['dig'], { kind: 'plot', jobs: ['dig'], hour: 12 }), plain * 1.25, 'digger on a dig crop');
  near(getWorkPower(pet, ['water'], { kind: 'plot', jobs: ['water'], hour: 12 }), getWorkPower(pet, ['water']), 'no trait match, no bond');
  pet.bond = 360;
  near(getWorkPower(pet, ['dig']), plain, 'bond ignored without ctx');
  near(getWorkPower(pet, ['dig'], { kind: 'plot', jobs: ['dig'], hour: 12 }), plain * 1.25 * 1.2, 'trait x bond');
});

// ── bond hearts (CONTRACT_V3 §3) ────────────────────────────────────────────
test('bond hearts thresholds 0/20/60/120/220/360 and power multiplier', () => {
  const h = b => bondHearts({ bond: b });
  const table = [[0, 0], [19, 0], [20, 1], [59, 1], [60, 2], [119, 2], [120, 3], [219, 3], [220, 4], [359, 4], [360, 5], [5000, 5]];
  for (const [b, hearts] of table) assertEq(h(b), hearts, `bond ${b}`);
  near(bondPowerMult({ bond: 0 }), 1, '0 hearts');
  near(bondPowerMult({ bond: 120 }), 1.12, '3 hearts');
  near(bondPowerMult({ bond: 360 }), 1.2, '5 hearts max +20%');
  const p = bondProgress({ bond: 30, bondDay: null });
  assertEq([p.hearts, p.cur, p.need], [1, 10, 40], 'progress inside a heart');
});

test('addBond: 30 points per pet per day, resets next day', async () => {
  const day1 = new Date(2026, 2, 10, 12, 0, 0).getTime();
  await withFakeNow(day1, async clock => {
    const { s, pet } = setup();
    assertEq(addBond(s, pet.id, 20), 20, 'first 20');
    assertEq(addBond(s, pet.id, 20), 10, 'capped at 30');
    assertEq(addBond(s, pet.id, 5), 0, 'nothing left today');
    assertEq(pet.bond, 30, 'total');
    assertEq(addBond(s, pet.id, 0), 0, 'zero ignored');
    assertEq(addBond(s, pet.id, -3), 0, 'negative ignored');
    assertEq(addBond(s, 'nobody', 5), 0, 'unknown pet');
    clock.advance(24 * HOUR);
    assertEq(addBond(s, pet.id, 25), 25, 'new day, fresh cap');
    assertEq(pet.bond, 55, 'total after day 2');
    const other = setup('cat');
    assertEq(addBond(other.s, other.pet.id, 30), 30, 'cap is per pet');
  });
});

test('bond gains: feed +2 (favorite +5), play +3, toy +4, clean +1, pickPoop +1', () => {
  const a = setup('hamster', { stats: { hunger: 50, happy: 50, clean: 50 }, poop: 1 });
  addItem(a.s, 'food_milk', 1); addItem(a.s, 'care_toy', 1);
  feedPet(a.s, a.pet.id, 'food_milk');          assertEq(a.pet.bond, 2, 'feed');
  playWithPet(a.s, a.pet.id);                    assertEq(a.pet.bond, 5, 'play');
  giveToy(a.s, a.pet.id);                        assertEq(a.pet.bond, 9, 'toy');
  pickPoop(a.s, a.pet.id);                       assertEq(a.pet.bond, 10, 'pickPoop');
  cleanPet(a.s, a.pet.id);                       assertEq(a.pet.bond, 11, 'clean');
  const b = setup('hamster', { stats: { hunger: 50 } });
  addItem(b.s, 'crop_corn', 1);
  feedPet(b.s, b.pet.id, 'crop_corn');
  assertEq(b.pet.bond, 5, 'favorite food +5');
});

test('bond cap also limits action gains and failed actions give nothing', () => {
  const { s, pet } = setup('hamster', { stats: { hunger: 50 } });
  s.inventory = {};
  feedPet(s, pet.id, 'food_kibble');
  assertEq(pet.bond, 0, 'failed feed');
  addBond(s, pet.id, 30);
  addItem(s, 'food_kibble', 1);
  feedPet(s, pet.id, 'food_kibble');
  assertEq(pet.bond, 30, 'cap reached, feed adds no bond');
});

test('claimGift: needs 3 hearts, once a day, gives 1-2 liked items', async () => {
  const day1 = new Date(2026, 2, 10, 9, 0, 0).getTime();
  await withFakeNow(day1, async clock => {
    const { s, pet } = setup('hamster');
    s.inventory = {};
    pet.bond = 100;
    assertEq(claimGift(s, pet.id).ok, false, '2 hearts is not enough');
    pet.bond = 120;
    const sp = getSpecies('hamster');
    const r = claimGift(s, pet.id);
    assert(r.ok, 'gift ok');
    const total = Object.values(r.items).reduce((a, b) => a + b, 0);
    assert(total >= 1 && total <= 2, 'gift size ' + total);
    for (const id of Object.keys(r.items)) {
      const it = getItem(id);
      assert(it && it.food, id + ' is edible');
      assert(id === sp.favorite || it.food.tags.some(tg => sp.diet.includes(tg)), id + ' matches diet');
      assertEq(countItem(s, id), r.items[id], id + ' in inventory');
    }
    assertEq(claimGift(s, pet.id).ok, false, 'second claim same day');
    clock.advance(24 * HOUR);
    assert(claimGift(s, pet.id).ok, 'next day works again');
  });
});

test('claimGift always draws from the diet (every species)', () => {
  for (const sp of SPECIES) {
    const { s, pet } = setup(sp.id, { bond: 360 });
    const r = claimGift(s, pet.id);
    assert(r.ok, sp.id + ' gift');
    for (const id of Object.keys(r.items)) {
      const it = getItem(id);
      assert(id === sp.favorite || it.food.tags.some(tg => sp.diet.includes(tg)), `${sp.id} got ${id}`);
    }
  }
});

test('hatched pets start with empty bond fields', () => {
  const s = createNewState();
  s.incubator.push({ eggId: 'egg_farm', startAt: 0, readyAt: 0 });
  const pet = hatchReady(s, 0).pet;
  assertEq([pet.bond, pet.bondDay, pet.bondToday, pet.giftDay], [0, null, 0, null], 'bond fields');
});

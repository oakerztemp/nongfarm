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
  patPet, patsLeftToday, PAT_DAILY_MAX,
} from '../js/pets.js';
import { nextAction, bubbleFor, bowlSpot, makeRng, clampToYard, paceOf, YARD, beginAction, advanceActor,
  signatureFor, NAP_CAP, pickTarget, ceremonyKind, partBases, applyPartPose, canStartCeremony } from '../js/petBehaviour.js';

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

// ── patPet (CONTRACT_V4 §3) ─────────────────────────────────────────────────
test('patPet: +1 bond +3 happy, max 5 rewarded pats a day, resets next day', async () => {
  const day1 = new Date(2026, 5, 10, 9, 0, 0).getTime();
  await withFakeNow(day1, async clock => {
    const { s, pet } = setup('hamster', { stats: { happy: 50 } });
    for (let i = 1; i <= PAT_DAILY_MAX; i++) {
      const r = patPet(s, pet.id);
      assert(r.ok && r.rewarded, 'pat ' + i);
      assertEq(r.left, PAT_DAILY_MAX - i, 'left after ' + i);
    }
    near(pet.stats.happy, 50 + 3 * PAT_DAILY_MAX, 'happy');
    assertEq(pet.bond, 5, 'bond');
    const extra = patPet(s, pet.id);
    assert(extra.ok && !extra.rewarded && extra.bond === 0, 'sixth pat gives nothing');
    near(pet.stats.happy, 65, 'happy unchanged by the 6th');
    assertEq(pet.bond, 5, 'bond unchanged by the 6th');
    assertEq(patsLeftToday(pet), 0, 'none left');
    clock.advance(24 * HOUR);
    assertEq(patsLeftToday(pet), PAT_DAILY_MAX, 'fresh next day');
    assert(patPet(s, pet.id).rewarded, 'rewarded again next day');
    assertEq(pet.bond, 6, 'bond next day');
  });
});

test('patPet: respects the daily bond cap, happy clamps at 100, caps are per pet', () => {
  const { s, pet } = setup('hamster', { stats: { happy: 99 } });
  addBond(s, pet.id, 30); // bond cap already reached today
  const r = patPet(s, pet.id);
  assert(r.ok && r.rewarded && r.bond === 0, 'pat counted but no bond left');
  assertEq(pet.bond, 30, 'bond stays at the cap');
  assertEq(pet.stats.happy, 100, 'happy clamped');
  assertEq(patsLeftToday(pet), PAT_DAILY_MAX - 1, 'pat still counted');
  const o = setup('cat');
  assertEq(patsLeftToday(o.pet), PAT_DAILY_MAX, 'other pet untouched');
});

test('patPet: sleeping pets can be patted, expedition pets and unknown ids cannot', () => {
  const a = setup('hamster', { status: 'sleeping' });
  assert(patPet(a.s, a.pet.id).ok, 'sleeping ok');
  assertEq(a.pet.status, 'sleeping', 'does not wake');
  const b = setup('hamster', { status: 'expedition' });
  assertEq(patPet(b.s, b.pet.id).ok, false, 'expedition blocked');
  assertEq(patPet(b.s, 'nobody').ok, false, 'unknown pet');
});

// ── petBehaviour (DOM-free idle brain) ──────────────────────────────────────
const bpet = (over = {}) => ({
  id: 'bp1', speciesId: 'hamster', personality: 'hardworking', status: 'idle', sick: false, poop: 0,
  stats: { hunger: 80, happy: 60, energy: 80, clean: 80 }, ...over,
});
const inYard = p => Number.isFinite(p.x) && Number.isFinite(p.z) && Math.hypot(p.x, p.z) <= YARD.walkRadius + 1e-6;
const decide = (pet, actor, seed) => nextAction(pet, actor, makeRng(seed), 0);
const tally = (pet, actor, n = 600) => {
  const t = {};
  for (let i = 0; i < n; i++) { const a = decide(pet, actor, i + 1); t[a.type] = (t[a.type] || 0) + 1; }
  return t;
};

test('petBehaviour: sleeping pets sleep, sick pets shiver', () => {
  for (let i = 1; i < 30; i++) {
    assertEq(decide(bpet({ status: 'sleeping' }), { x: 1, z: 1 }, i).type, 'sleep', 'sleeping');
    assertEq(decide(bpet({ sick: true }), { x: 1, z: 1 }, i).type, 'sick', 'sick');
  }
});

test('petBehaviour: hungry pets walk to their spot at the food bowl, then wait there', () => {
  const pet = bpet({ stats: { hunger: 10, happy: 60, energy: 80, clean: 80 } });
  const spot = bowlSpot(pet.id);
  assert(Math.hypot(spot.x - YARD.bowl.x, spot.z - YARD.bowl.z) < 1.4, 'spot is next to the bowl');
  for (let i = 1; i < 30; i++) {
    const far = decide(pet, { x: -3, z: -1 }, i);
    assertEq([far.type, far.reason], ['wander', 'hungry'], 'walks to bowl');
    assertEq([far.target.x, far.target.z], [spot.x, spot.z], 'target is the bowl spot');
    const there = decide(pet, { x: spot.x, z: spot.z }, i);
    assertEq([there.type, there.reason], ['idle', 'hungry'], 'waits at bowl');
  }
});

test('petBehaviour: bubbles - sick > sleep > favorite food > flies > sad', () => {
  const hungry = { hunger: 10, happy: 10, energy: 80, clean: 10 };
  assertEq(bubbleFor(bpet({ sick: true, stats: hungry })).kind, 'sick', 'sick first');
  assertEq(bubbleFor(bpet({ status: 'sleeping', stats: hungry })).kind, 'sleep', 'sleep next');
  const food = bubbleFor(bpet({ stats: hungry }));
  assertEq(food.kind, 'food', 'hungry');
  assertEq(food.emoji, getItem(getSpecies('hamster').favorite).emoji, 'favorite food emoji');
  assertEq(bubbleFor(bpet({ stats: { hunger: 80, happy: 80, energy: 80, clean: 10 } })).emoji, '🪰', 'dirty');
  assertEq(bubbleFor(bpet({ poop: 2 })).emoji, '🪰', 'two poops');
  assertEq(bubbleFor(bpet({ stats: { hunger: 80, happy: 10, energy: 80, clean: 80 } })).kind, 'sad', 'sad');
  assertEq(bubbleFor(bpet()), null, 'content pets show nothing');
});

test('petBehaviour: personalities bias the choices', () => {
  const actor = { x: 0, z: 0, others: [{ id: 'o', x: 2, z: 1 }], last: 'idle' };
  const lazy = tally(bpet({ personality: 'lazy', stats: { hunger: 80, happy: 60, energy: 60, clean: 80 } }), actor);
  const cheer = tally(bpet({ personality: 'cheerful', stats: { hunger: 80, happy: 90, energy: 90, clean: 80 } }), actor);
  const work = tally(bpet({ personality: 'hardworking', stats: { hunger: 80, happy: 60, energy: 90, clean: 80 } }), actor);
  const shy = tally(bpet({ personality: 'shy' }), actor);
  assert((lazy.sleep || 0) > (work.sleep || 0) * 4, 'lazy naps far more: ' + JSON.stringify([lazy, work]));
  assert((cheer.hop || 0) > (work.hop || 0) * 2, 'cheerful hops more: ' + JSON.stringify([cheer, work]));
  assertEq(shy.approach || 0, 0, 'shy never approaches');
  assert((cheer.approach || 0) > 0, 'cheerful approaches sometimes');
  assert((work.wander || 0) > (lazy.wander || 0) * 1.5, 'hardworking wanders more');
  assert(paceOf(bpet({ personality: 'naughty' })) > paceOf(bpet({ personality: 'lazy' })) * 2, 'naughty runs, lazy plods');
});

test('petBehaviour: shy pets walk away from a neighbour', () => {
  const shy = bpet({ personality: 'shy' });
  let fled = 0;
  for (let i = 1; i <= 100; i++) {
    const a = decide(shy, { x: 0, z: 0, others: [{ id: 'o', x: 0.8, z: 0.5 }], last: 'idle' }, i);
    if (a.reason === 'shy') { fled++; assertEq(a.type, 'wander', 'flee is a walk'); }
  }
  assert(fled > 60, 'most of the time it flees: ' + fled);
});

test('petBehaviour: every target is finite and inside the yard, whatever the state', () => {
  const personalities = ['hardworking', 'lazy', 'glutton', 'cheerful', 'shy', 'naughty'];
  const levels = [0, 10, 24, 50, 100];
  const actors = [
    { x: 0, z: 0, others: [] }, { x: 3.5, z: 1, others: [{ id: 'a', x: 1, z: 1 }, { id: 'b', x: -2, z: 2 }] },
    { x: NaN, z: undefined }, { x: 99, z: -99, others: [{ id: 'n', x: NaN, z: 1 }] }, {},
  ];
  const types = new Set(['wander', 'idle', 'sleep', 'eat', 'poop', 'sick', 'lookAtCamera', 'hop', 'approach']);
  let n = 0;
  for (const personality of personalities) for (const h of levels) for (const hp of levels) for (const actor of actors) {
    for (let seed = 1; seed <= 6; seed++) {
      const pet = bpet({ personality, sick: seed === 6, status: seed === 5 ? 'sleeping' : 'idle', poop: seed % 4,
        stats: { hunger: h, happy: hp, energy: 100 - h, clean: 100 - hp } });
      const last = ['idle', 'wander', 'hop', 'sleep', 'sick'][seed % 5];
      const a = nextAction(pet, { ...actor, last }, makeRng(seed * 7919 + n++), 123);
      assert(types.has(a.type), 'known type ' + a.type);
      assert(Number.isFinite(a.duration) && a.duration >= 0, 'finite duration for ' + a.type);
      if (a.target) assert(inYard(a.target), `target in yard (${a.type}): ${JSON.stringify(a.target)}`);
      if (a.speed != null) assert(Number.isFinite(a.speed) && a.speed > 0, 'speed');
    }
  }
  assert(n > 1000, 'covered many cases');
  assert(inYard(clampToYard(50, -50)), 'clampToYard');
});

test('petBehaviour: calm - after a walk, pauses dominate and last several seconds', () => {
  const pet = bpet({ personality: 'hardworking' });
  const t = tally(pet, { x: 1, z: 1, others: [], last: 'wander' }, 500);
  assert((t.idle || 0) > (t.wander || 0), 'idle beats wander right after a walk: ' + JSON.stringify(t));
  let min = Infinity;
  for (let i = 1; i < 200; i++) {
    const a = decide(pet, { x: 1, z: 1, last: 'wander' }, i);
    if (a.type === 'idle') min = Math.min(min, a.duration);
  }
  assert(min >= 2, 'idle pauses are long: ' + min);
});

// ── action loop (what barn3d.js runs every frame) ───────────────────────────
test('beginAction: nextAction() says `duration`, the loop reads `dur` (regression: idle used to end after one frame)', () => {
  const idle = beginAction({ type: 'idle', duration: 5 });
  assertEq([idle.dur, idle.t], [5, 0], 'duration mapped to dur');
  assertEq(beginAction({ type: 'hop', dur: 0.7 }).dur, 0.7, 'explicit dur wins');
  assertEq(beginAction({ type: 'idle' }).dur, 3, 'default per type');
  assertEq(beginAction({ type: 'wander', duration: 0 }).dur, 0, 'walks have no timer');
});

/** Runs advanceActor at 30 fps for `seconds` and reports how many times decide() ran. */
function runLoop(pet, seconds, { seed = 5, start = { x: 0, z: 0 } } = {}) {
  const rng = makeRng(seed);
  const A = { x: start.x, z: start.z, heading: 0, phase: 0, last: 'idle', act: null };
  const log = [];
  const decide = a => {
    const act = nextAction(pet, { x: a.x, z: a.z, others: [], last: a.last }, rng, 0);
    a.act = beginAction(act);
    a.last = act.type === 'walkTo' ? 'wander' : act.type;
    log.push({ at: frames * dt, type: act.type, dur: a.act.dur });
  };
  const dt = 1 / 30;
  let frames = 0;
  decide(A);
  for (; frames < seconds * 30; frames++) {
    advanceActor(A, dt, decide);
    assert(Number.isFinite(A.x) && Number.isFinite(A.z), 'finite position');
  }
  return { log, A };
}

test('action loop: idle lasts its full duration, decide() is not called every frame', () => {
  const act = { x: 0, z: 0, heading: 0, phase: 0, act: beginAction({ type: 'idle', duration: 4 }) };
  let calls = 0;
  const decide = a => { calls++; a.act = beginAction({ type: 'idle', duration: 4 }); };
  for (let f = 0; f < 119; f++) advanceActor(act, 1 / 30, decide); // 3.97 s
  assertEq(calls, 0, 'still idling after 3.97s');
  for (let f = 0; f < 3; f++) advanceActor(act, 1 / 30, decide);
  assertEq(calls, 1, 'decided exactly once after 4s');
  for (const type of ['sleep', 'lookAtCamera', 'sick']) {
    const a = { x: 0, z: 0, heading: 0, phase: 0, act: beginAction({ type, duration: 2 }) };
    let n = 0;
    for (let f = 0; f < 59; f++) advanceActor(a, 1 / 30, () => { n++; });
    assertEq(n, 0, type + ' lasts its duration');
  }
});

test('action loop: a sleeping pet re-decides about every 12 s, an awake one rarely more than once a second', () => {
  const sleepy = runLoop(bpet({ status: 'sleeping' }), 120);
  assert(sleepy.log.length <= 12, 'sleeping decisions in 2 min: ' + sleepy.log.length);
  assert(sleepy.log.every(e => e.type === 'sleep'), 'all sleep');
  for (const personality of ['hardworking', 'lazy', 'cheerful', 'shy', 'naughty', 'glutton']) {
    const r = runLoop(bpet({ personality }), 180, { seed: 11 });
    assert(r.log.length < 180 * 0.9, `${personality}: ${r.log.length} decisions in 3 min (decide every frame would be 5400)`);
    const idles = r.log.filter(e => e.type === 'idle');
    assert(idles.length > 0 && idles.every(e => e.dur >= 1.4), personality + ': idle pauses last seconds');
  }
});

test('action loop: walking reaches the target, calls onArrive once, and callbacks may start the next action', () => {
  let arrived = 0, decided = 0;
  const A = { x: 0, z: 0, heading: 0, phase: 0, act: beginAction({ type: 'walkTo', target: { x: 2, z: 1 }, speed: 1,
    onArrive: a => { arrived++; a.act = beginAction({ type: 'hop', duration: 1 }); } }) };
  for (let f = 0; f < 30 * 6 && A.act.type === 'walkTo'; f++) advanceActor(A, 1 / 30, () => { decided++; });
  assertEq(arrived, 1, 'arrived once');
  assertEq(decided, 0, 'decide skipped because onArrive began a new action');
  assertEq(A.act.type, 'hop', 'hop started by the callback');
  assert(Math.hypot(A.x - 2, A.z - 1) < 0.2, 'stands at the target');
});

// ── CONTRACT_V5: legendary presence, nap cap, crowd spreading, ceremony choice ──
const SIGNATURE_STARTS = new Set(['flyCircle', 'gallop', 'soar', 'breach', 'roar', 'munch', 'snowPuff', 'shimmer', 'sprint', 'flourish']);
const countTypes = (pet, actor, n = 800) => {
  const t = {};
  for (let i = 0; i < n; i++) { const a = nextAction(pet, actor, makeRng(i * 31 + 7), 0); t[a.type] = (t[a.type] || 0) + 1; }
  return t;
};

test('signature moves: one per legendary species, none for common pets, a smaller one for epic', () => {
  const expected = { dragon: 'flyCircle', unicorn: 'gallop', eagle: 'soar', humpback: 'breach', lion: 'roar',
    panda: 'munch', polarbear: 'snowPuff', beetle: 'shimmer', racehorse: 'sprint' };
  for (const [id, type] of Object.entries(expected)) {
    assertEq(signatureFor(id), { type, tier: 'legendary' }, id);
  }
  assertEq(SPECIES.filter(sp => sp.rarity === 'legendary').length, 9, 'nine legendary species');
  for (const sp of SPECIES) {
    const sig = signatureFor(sp.id);
    if (sp.rarity === 'legendary') assertEq(sig.tier, 'legendary', sp.id);
    else if (sp.rarity === 'epic') assertEq(sig.tier, 'epic', sp.id);
    else assertEq(sig, null, sp.id + ' has no signature move');
  }
  const actor = { x: 0, z: 0, others: [], last: 'idle' };
  for (const sp of SPECIES.filter(x => x.rarity !== 'legendary' && x.rarity !== 'epic').slice(0, 40)) {
    const t = countTypes(bpet({ speciesId: sp.id }), actor, 150);
    for (const k of Object.keys(t)) assert(!SIGNATURE_STARTS.has(k), `${sp.id} (common) must never start ${k}`);
  }
  const dragon = countTypes(bpet({ speciesId: 'dragon' }), actor);
  assert((dragon.flyCircle || 0) > 20, 'the dragon flies sometimes: ' + JSON.stringify(dragon));
  assert((dragon.flyCircle || 0) < 400, 'but only occasionally');
  const epic = countTypes(bpet({ speciesId: 'dragonhead' }), actor);
  const small = nextAction(bpet({ speciesId: 'dragonhead' }), actor, (() => { const r = makeRng(3); return () => r(); })(), 0);
  assert((epic.flyCircle || 0) > 0 && (epic.flyCircle || 0) < (dragon.flyCircle || 0), 'epic does it less often: ' + JSON.stringify([epic, dragon]));
  void small;
  // sleeping / sick / hungry pets are never interrupted by a show-off move
  for (const over of [{ status: 'sleeping' }, { sick: true }, { stats: { hunger: 10, happy: 80, energy: 80, clean: 80 } }]) {
    const t = countTypes(bpet({ speciesId: 'dragon', ...over }), actor, 200);
    for (const k of Object.keys(t)) assert(!SIGNATURE_STARTS.has(k), `dragon ${JSON.stringify(over)} must not start ${k}`);
  }
  // signature actions last their full duration and carry the epic flag
  const a = nextAction(bpet({ speciesId: 'dragonhead' }), actor, () => 0.999, 0);
  if (SIGNATURE_STARTS.has(a.type)) assertEq(a.small, true, 'epic version is small');
});

test('nap cap: nobody starts a nap while 25% of the awake pets already nap; lazy pets still nap more', () => {
  const lazy = bpet({ personality: 'lazy', stats: { hunger: 80, happy: 60, energy: 60, clean: 80 } });
  const other = bpet({ personality: 'hardworking', stats: { hunger: 80, happy: 60, energy: 60, clean: 80 } });
  const base = { x: 0, z: 0, others: [], last: 'idle' };
  assertEq(countTypes(lazy, { ...base, napRatio: 0.25 }).sleep || 0, 0, 'capped (lazy)');
  assertEq(countTypes(lazy, { ...base, napRatio: 0.6 }).sleep || 0, 0, 'capped (lazy, more)');
  assertEq(countTypes(other, { ...base, napRatio: 0.3 }).sleep || 0, 0, 'capped (other)');
  const lz = countTypes(lazy, { ...base, napRatio: 0.1 }).sleep || 0, ot = countTypes(other, { ...base, napRatio: 0.1 }).sleep || 0;
  assert(lz > 0 && lz > ot * 3, `below the cap lazy still naps far more: ${lz} vs ${ot}`);
  assertEq(NAP_CAP, 0.25, 'cap constant');
});

test('crowd: wander targets avoid other pets and where they are heading (no clumping)', () => {
  const others = [];
  const rp = makeRng(1234);
  for (let i = 0; i < 14; i++) {
    const a = rp() * Math.PI * 2, r = Math.sqrt(rp()) * 3.2;
    others.push({ id: 'o' + i, x: Math.cos(a) * r, z: Math.sin(a) * r, tx: Math.cos(a + 1) * r * 0.8, tz: Math.sin(a + 1) * r * 0.8 });
  }
  const rng = makeRng(99);
  let sum = 0, close = 0, n = 0;
  const dists = (x, z) => Math.min(...others.map(o => Math.min(Math.hypot(x - o.x, z - o.z), Math.hypot(x - o.tx, z - o.tz))));
  for (let i = 0; i < 400; i++) {
    const t = pickTarget(rng, 0, 0, others, false);
    assert(inYard(t), 'inside the yard');
    const d = dists(t.x, t.z);
    sum += d; n++; if (d < 0.5) close++;
  }
  // baseline: uniformly random yard points
  const rb = makeRng(5);
  let base = 0;
  for (let i = 0; i < 400; i++) { const a = rb() * Math.PI * 2, r = Math.sqrt(rb()) * YARD.walkRadius; base += dists(Math.cos(a) * r, Math.sin(a) * r); }
  assert(sum / n > (base / 400) * 1.25, `targets are farther from the crowd than random ones: ${(sum / n).toFixed(2)} vs ${(base / 400).toFixed(2)}`);
  assert(close / n < 0.05, 'fewer than 5% of the targets land within 0.5 of a pet or its target: ' + close);
});

test('hatch ceremony is chosen from the real hatchReady result', () => {
  const s = createNewState();
  s.barnCapacity = 10;
  s.incubator.push({ eggId: 'egg_mystic', startAt: 0, readyAt: 0 }, { eggId: 'egg_farm', startAt: 0, readyAt: 0 });
  const realRandom = Math.random;
  let legend;
  try { Math.random = () => 0.9999; legend = hatchReady(s, 0); } finally { Math.random = realRandom; }
  assert(legend.ok, 'hatched');
  assertEq(getSpecies(legend.pet.speciesId).rarity, 'legendary', 'forced a legendary result');
  assertEq(ceremonyKind(legend.pet), 'legendary', 'legendary ceremony');
  let common;
  try { Math.random = () => 0; common = hatchReady(s, 0); } finally { Math.random = realRandom; }
  assert(common.ok, 'hatched common');
  assertEq(ceremonyKind(common.pet), 'common', 'normal ceremony for a common result');
  assertEq(ceremonyKind({ speciesId: 'hamster' }), 'common', 'plain pet');
  assertEq(ceremonyKind(null), 'common', 'no pet');
});

test('part animator: moves wings/tailTip/trunk/mane when present and tolerates missing parts', () => {
  const part = (x = 0, y = 0, z = 0) => ({ rotation: { x, y, z } });
  const P = { wing: 0.5, tail: 0.2, tailTip: 0.3, trunk: -0.4, mane: 0.1 };
  const full = { wingL: part(0, 0, 0.2), wingR: part(0, 0, -0.2), tail: part(0, 0.1, 0), tailTip: part(), trunk: part(0.3, 0, 0), mane: part() };
  const base = partBases(full);
  applyPartPose(full, base, P);
  assertEq([full.wingL.rotation.z, full.wingR.rotation.z], [0.7, -0.7], 'wings flap symmetrically around their rest pose');
  assertEq([full.tailTip.rotation.y, full.mane.rotation.z], [0.3, 0.1], 'tailTip + mane');
  assert(Math.abs(full.trunk.rotation.x - (-0.1)) < 1e-9 && Math.abs(full.tail.rotation.y - 0.3) < 1e-9, 'trunk + tail');
  applyPartPose(full, base, P); // idempotent: offsets, not accumulation
  assertEq(full.wingL.rotation.z, 0.7, 'no drift');
  // billboards / species without those parts
  for (const parts of [undefined, null, {}, { eyes: [part()] }, { wingL: part() }, { trunk: {} }]) {
    const b = partBases(parts);
    applyPartPose(parts, b, P);
  }
  applyPartPose({ wingL: part() }, undefined, P);
  applyPartPose({ wingL: part() }, {}, undefined);
  const half = { wingL: part() };
  applyPartPose(half, partBases(half), { wing: NaN });
  assertEq(half.wingL.rotation.z, 0, 'NaN pose values are ignored');
});

test('hatch ceremony lock: only an unfinished ceremony blocks the next hatch', () => {
  assertEq(canStartCeremony(null), true, 'idle');
  for (const phase of ['pending', 'wobble', 'legend']) assertEq(canStartCeremony({ phase }), false, phase + ' blocks');
  assertEq(canStartCeremony({ phase: 'burst' }), true, 'after the burst another egg may hatch (newborn still walking)');
});

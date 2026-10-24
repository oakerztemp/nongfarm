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
  yardOutput, tickYard, collectYard, yardPreview, yardItemTable, stationStatus, YARD_BASE_COINS,
  getPet, ensureYard, petGift, collectPetGift, NURSERY_SLOTS, adoptFromNursery, swapWithNursery, rehomePet, rehomeDust,
  POSTCARD_TEMPLATES, POSTCARD_MAX, arrivedPostcards, unreadPostcardCount, markPostcardRead, compareCandidates,
} from '../js/pets.js';
const C = YARD_BASE_COINS.common, L = YARD_BASE_COINS.legendary; // yard coins/h of a hamster / racehorse
import { nextAction, bubbleFor, bowlSpot, makeRng, clampToYard, paceOf, YARD, beginAction, advanceActor,
  signatureFor, NAP_CAP, pickTarget, ceremonyKind, partBases, applyPartPose, canStartCeremony,
  yardTierOf, yardProps, configureYard, YARD_TIER_LAYOUT, nestSpot } from '../js/petBehaviour.js';

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
  s.nursery = [];
  const nr = hatchReady(s, 0);
  assert(nr.ok && nr.nursery, 'yard full: the baby goes to the nursery (CONTRACT_V7 §5)');
  assertEq(s.nursery.length, 1, 'nursery has it');
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

// ── ลานให้ของ (CONTRACT_V6 §3, per pet since CONTRACT_V7 §4) ─────────────────
const yardSetup = (speciesId = 'hamster', over = {}) => {
  const r = setup(speciesId, over);
  r.s.yard = { byPet: {}, lastAt: 0 };
  return r;
};
const addPet = (s, id, speciesId = 'hamster', over = {}) => {
  const pet = { ...s.pets[0], id, speciesId, nickname: id, stats: { hunger: 100, happy: 100, energy: 100, clean: 100 }, ...over };
  s.pets.push(pet);
  return pet;
};

test('yard rates: base x (1 + 0.1/heart) x mood x sleep, sick and working pets earn nothing', () => {
  const rate = pet => yardOutput(pet).coins;
  const mk = (speciesId, over = {}) => setup(speciesId, over).pet;
  near(rate(mk('hamster')), C, 'common');
  near(rate(mk('rabbit')), YARD_BASE_COINS.uncommon, 'uncommon');
  near(rate(mk('llama')), YARD_BASE_COINS.rare, 'rare');
  near(rate(mk('turkey')), YARD_BASE_COINS.epic, 'epic');
  near(rate(mk('racehorse')), L, 'legendary');
  near(rate(mk('hamster', { bond: 360 })), C * 1.5, '5 hearts = +50%');
  near(rate(mk('hamster', { bond: 60 })), C * 1.2, '2 hearts');
  near(rate(mk('hamster', { stats: { happy: 70 } })), C, 'happy 70 = full');
  near(rate(mk('hamster', { stats: { happy: 69 } })), C * 0.6, 'happy < 70');
  near(rate(mk('hamster', { stats: { happy: 30 } })), C * 0.6, 'happy 30');
  near(rate(mk('hamster', { stats: { happy: 29 } })), C * 0.2, 'happy < 30');
  near(rate(mk('hamster', { status: 'sleeping' })), C * 0.5, 'sleeping x0.5');
  assertEq(rate(mk('hamster', { sick: true })), 0, 'sick');
  assertEq(rate(mk('hamster', { status: 'working' })), 0, 'working');
  assertEq(rate(mk('hamster', { status: 'expedition' })), 0, 'expedition');
  assertEq(rate(mk('hamster', { status: 'nursery' })), 0, 'nursery babies are frozen');
  near(yardOutput(mk('hamster')).items, 0.03, 'item chance common 3%');
  near(yardOutput(mk('llama')).items, 0.05, 'rare 5%');
  near(yardOutput(mk('turkey')).items, 0.08, 'epic 8%');
  near(yardOutput(mk('racehorse')).items, 0.12, 'legendary 12%');
});

test('tickYard: each pet fills its own gift, 6 h cap per pet, collecting one pet resets only that pet', () => {
  const { s, pet } = yardSetup('hamster');
  tickYard(s, HOUR);
  near(s.yard.byPet[pet.id].c, C, '1 h of one common pet');
  assertEq(petGift(s, pet.id).has, true, 'a gift (>= 1 coin) is ready');
  tickYard(s, 10 * HOUR);
  near(s.yard.byPet[pet.id].c, C * 6, 'capped at 6 h of production');
  near(s.yard.byPet[pet.id].ms, 6 * HOUR, 'cap bookkeeping');
  tickYard(s, 5 * HOUR);
  near(s.yard.byPet[pet.id].c, C * 6, 'stops filling beyond the cap');
  assertEq(petGift(s, pet.id).full, true, 'full -> the 3D pet shows 🎁✨');
  near(yardPreview(s).fill, 1, 'bar full');
  const coins = s.player.coins;
  const r = collectPetGift(s, pet.id);
  assert(r.ok && r.coins === C * 6, `collected ${C * 6} coins`);
  assertEq(s.player.coins, coins + C * 6, 'coins landed in the wallet');
  assertEq(s.stats.yardCollected, 1, 'stats.yardCollected');
  assertEq(petGift(s, pet.id).has, false, 'nothing left');
  assertEq(petGift(s, pet.id).fill, 0, 'bar empty again');
  tickYard(s, HOUR);
  near(s.yard.byPet[pet.id].c, C, 'fills again after a collect');
});

test('tickYard: pets are independent (own cap, own start), working pets and the sick pay nothing', () => {
  const { s, pet } = yardSetup('hamster');
  tickYard(s, 6 * HOUR);                         // hamster is full
  const horse = addPet(s, 'p2', 'racehorse');    // joins later
  tickYard(s, 2 * HOUR);
  near(s.yard.byPet[pet.id].c, C * 6, 'the full pet stays at its own cap');
  near(s.yard.byPet.p2.c, L * 2, 'the newcomer earns its own 2 h');
  near(petGift(s, 'p2').fill, 2 / 6, 'fill follows the pet\'s own hours');
  horse.status = 'working';
  tickYard(s, HOUR);
  near(s.yard.byPet.p2.c, L * 2, 'a working pet adds nothing');
  near(s.yard.byPet.p2.ms, 2 * HOUR, 'and does not burn its cap while away');
  horse.status = 'idle'; horse.sick = true;
  tickYard(s, HOUR);
  near(s.yard.byPet.p2.c, L * 2, 'sick pets pay nothing either');
  assertEq(Object.keys(s.yard.byPet).sort(), [pet.id, 'p2'].sort(), 'one record per pet');
});

test('collectYard collects every pet at once; collectPetGift only the tapped one', () => {
  const { s, pet } = yardSetup('hamster');
  addPet(s, 'p2', 'racehorse');
  addPet(s, 'p3', 'dragon', { status: 'working' });   // away: nothing to collect
  tickYard(s, 2 * HOUR);
  const one = collectPetGift(s, 'p2');
  assert(one.ok && one.coins === L * 2, 'racehorse gift only');
  near(s.yard.byPet[pet.id].c, C * 2, 'hamster untouched');
  assertEq(collectPetGift(s, 'p2').ok, false, 'second tap: empty, politely refused');
  assertEq(collectPetGift(s, 'nope').ok, false, 'unknown pet');
  const coins = s.player.coins;
  const all = collectYard(s);
  assert(all.ok && all.coins === C * 2 && all.pets === 1, 'the rest in one go: ' + JSON.stringify([all.coins, all.pets]));
  assertEq(s.player.coins, coins + C * 2, 'wallet');
  assertEq(collectYard(s).ok, false, 'nothing left');
  // the aggregate preview adds the pets up
  tickYard(s, HOUR);
  const pv = yardPreview(s);
  assertEq([pv.coins, pv.pets], [C + L, 2], 'preview = sum of the pets with a gift');
  near(pv.perHour, C + L, 'aggregate rate');
});

test('yard items: deterministic (no RNG), rotate through the habitat table per pet, fractions carry over collects', () => {
  const realRandom = Math.random;
  Math.random = () => { throw new Error('yard must not use randomness'); };
  try {
    const run = () => {
      const { s, pet } = yardSetup('dragon'); // legendary, mystic: 12%/h
      let items = 0;
      const seen = new Set(), order = [];
      for (let i = 0; i < 100; i++) { // 600 h in 6 h sessions
        tickYard(s, 6 * HOUR);
        const r = collectPetGift(s, pet.id);
        if (r.ok) for (const [id, c] of Object.entries(r.items)) { items += c; seen.add(id); order.push(id + c); }
      }
      assertEq(items, Math.floor(0.12 * 600 + 1e-6), 'expected value only: 72 items in 600 h');
      assertEq([...seen].sort(), ['forage_gem', 'forage_star'], 'mystic table');
      assert((countItem(s, 'forage_star') + countItem(s, 'forage_gem')) === items, 'items landed in the inventory');
      return order.join(',');
    };
    assertEq(run(), run(), 'same pet, same sequence every time');
  } finally { Math.random = realRandom; }
  // held items wait on the pet until it is tapped
  const { s, pet } = yardSetup('dragon');
  tickYard(s, 6 * HOUR);
  const g = petGift(s, pet.id);
  assertEq(g.itemCount, 0, '0.72 items so far: nothing whole yet');
  tickYard(s, HOUR);   // cap reached, nothing more is credited
  assertEq(petGift(s, pet.id).itemCount, 0, 'capped: still none');
  const g2 = yardSetup('dragon'); g2.s.yard.byPet[g2.pet.id] = { c: 0, ms: 0, prog: 0.9, items: {} };
  tickYard(g2.s, HOUR);
  assertEq(petGift(g2.s, g2.pet.id).itemCount, 1, '0.9 + 0.12 -> one held item');
  // each habitat only gifts its own things; farm gifts only seeds of unlocked crops (+ milk)
  const farm = yardSetup('hamster');
  farm.s.player.level = 1;
  for (const id of yardItemTable(farm.s, 'farm')) assert(id === 'food_milk' || /^seed_/.test(id), 'farm item ' + id);
  assert(yardItemTable(farm.s, 'farm').length >= 2, 'milk + at least one seed');
  for (const hab of Object.keys(HABITATS)) for (const id of yardItemTable(farm.s, hab)) assert(getItem(id), hab + ': ' + id + ' exists');
});

test('collecting a gift: nothing to collect fails politely; bond daily cap is untouched', () => {
  const { s, pet } = yardSetup('hamster');
  assertEq(collectPetGift(s, pet.id).ok, false, 'empty gift');
  assertEq(collectYard(s).ok, false, 'empty yard');
  tickYard(s, HOUR);
  addBond(s, pet.id, 30); // the daily bond cap is used up
  const bondBefore = pet.bond;
  assert(collectPetGift(s, pet.id).ok, 'still collectable');
  assertEq(pet.bond, bondBefore, 'collecting gives no bond');
});

test('yard via tickPets / offline catch-up: 72 h away yields at most 6 h of production per pet', async () => {
  const { advance } = await import('../js/tick.js');
  await withFakeNow(Date.UTC(2026, 5, 1, 0, 0, 0), async clock => {
    const { s, pet } = yardSetup('hamster', { stats: { hunger: 100, happy: 100, energy: 100, clean: 100 } });
    s.lastTick = clock.get();
    const perHourAtStart = yardOutput(pet).coins;
    clock.advance(72 * HOUR);
    advance(s, clock.get());
    const g = s.yard.byPet[pet.id];
    assert(g.ms <= 6 * HOUR + 1, 'credited time capped: ' + g.ms);
    assert(g.c <= perHourAtStart * 6 + 1e-6, 'gift <= 6 h of production: ' + g.c);
    assert(g.c > 0, 'and something was produced');
  });
});

test('old global gift store (v4 shape) is split across the pets at home, nothing lost', () => {
  const { s, pet } = setup('hamster');
  addPet(s, 'p2', 'rabbit');
  addPet(s, 'p3', 'cat', { status: 'working' });
  s.yard = { pending: 100.5, items: { food_milk: 3 }, prog: { farm: 0.5 }, accMs: 2 * HOUR, n: 1, lastAt: 7 };
  const y = ensureYard(s);
  assertEq(['pending', 'items', 'prog', 'accMs', 'n'].filter(k => k in y), [], 'legacy fields removed');
  near(y.byPet[pet.id].c + y.byPet.p2.c, 100.5, 'every coin is somewhere');
  assertEq(y.byPet.p3, undefined, 'the working pet got no share');
  assertEq(countItems_(y), 3, 'items kept');
  near(y.byPet[pet.id].ms, 2 * HOUR, 'cap progress carried');
  assertEq(ensureYard(s).byPet[pet.id].c, y.byPet[pet.id].c, 'idempotent');
});
const countItems_ = y => Object.values(y.byPet).reduce((n, g) => n + Object.values(g.items).reduce((a, b) => a + b, 0), 0);

test('tickYard heals a corrupt yard: negative ms, NaN progress, string coins, gifts of vanished pets', () => {
  const { s, pet } = yardSetup('hamster');
  s.yard = { byPet: {
    [pet.id]: { c: '12', ms: -5 * HOUR, prog: NaN, items: { food_milk: -3, forage_gem: 2, junk: NaN }, n: -4 },
    ghost: { c: 500, ms: HOUR, prog: 0, items: {} },
    bad: 'x',
  }, lastAt: 0 };
  tickYard(s, HOUR);
  const g = s.yard.byPet[pet.id];
  near(g.ms, HOUR, 'negative ms did not buy extra credit');
  near(g.c, C, 'string coins reset, then 1 h of one hamster');
  assert(Number.isFinite(g.prog) && g.prog >= 0, 'NaN progress repaired');
  assertEq(g.items, { forage_gem: 2 }, 'bad item counts dropped');
  assertEq(g.n, 0, 'rotation counter repaired');
  assertEq(Object.keys(s.yard.byPet), [pet.id], 'gifts of pets that are gone are dropped');
  s.yard.byPet[pet.id].ms = 99 * HOUR;
  tickYard(s, HOUR);
  assert(s.yard.byPet[pet.id].ms <= 6 * HOUR, 'oversized ms clamped');
  for (let i = 0; i < 40; i++) tickYard(s, 6 * HOUR), collectPetGift(s, pet.id);
  assert(Number.isFinite(s.yard.byPet[pet.id].prog) && s.yard.byPet[pet.id].prog >= 0, 'progress is a normal number');
});

// ── เปลอนุบาล (CONTRACT_V7 §5) ───────────────────────────────────────────────
/** A state with a full yard (capacity 2, both pets home) and `eggs` ready eggs. */
function fullYard(eggs = 1) {
  const { s } = setup('hamster');
  s.barnCapacity = 2;
  addPet(s, 'p2', 'rabbit');
  s.incubatorCapacity = 4;
  for (let i = 0; i < eggs; i++) s.incubator.push({ eggId: 'egg_farm', startAt: 0, readyAt: 0 });
  return s;
}

test('nursery: a full yard hatches into the nursery; both full blocks it', () => {
  const s = fullYard(5);
  s.nursery = [];
  const r = hatchReady(s, 0);
  assert(r.ok && r.nursery === true, 'hatched into the nursery');
  assertEq(s.pets.length, 2, 'the yard is untouched');
  assertEq(s.nursery.length, 1, 'baby in the nursery');
  assertEq(s.nursery[0].pet.id, r.pet.id, 'same pet object');
  assertEq(r.pet.status, 'nursery', 'status nursery');
  assertEq(s.collection[r.pet.speciesId].owned, 1, 'the collection still counts it');
  assertEq(s.stats.hatched, 1, 'stats.hatched');
  assert(hatchReady(s, 0).ok && hatchReady(s, 0).ok, 'three slots');
  assertEq(s.nursery.length, NURSERY_SLOTS, 'nursery full');
  const blocked = hatchReady(s, 0);
  assertEq(blocked.ok, false, 'yard and nursery both full');
  assert(/เปลเต็ม/.test(blocked.reason), 'says the nursery is full: ' + blocked.reason);
  assertEq(s.incubator.length, 2, 'the egg stays in the incubator');
  // with room in the yard the baby goes to the yard as before
  const t = fullYard(1);
  t.barnCapacity = 3;
  const r2 = hatchReady(t, 0);
  assert(r2.ok && !r2.nursery && t.pets.some(p => p.id === r2.pet.id) && r2.pet.status === 'idle', 'normal hatch');
});

test('nursery babies are frozen: no decay, no work, no yard gifts, no sickness', () => {
  const s = fullYard(1);
  const baby = hatchReady(s, 0).pet;
  const before = JSON.stringify(baby);
  for (let i = 0; i < 50; i++) tickPets(s, 10 * HOUR, { offline: true });
  assertEq(JSON.stringify(baby), before, 'the baby did not change at all');
  assertEq(s.yard.byPet[baby.id], undefined, 'no gift record');
  assertEq(getPet(s, baby.id), null, 'not a yard pet (farm and explore never see it)');
  assertEq(yardOutput(baby).coins, 0, 'no production');
  assertEq(canWork(baby).ok, false, 'cannot work');
});

test('adoptFromNursery needs a free yard slot', () => {
  const s = fullYard(1);
  const baby = hatchReady(s, 0).pet;
  const no = adoptFromNursery(s, baby.id);
  assertEq(no.ok, false, 'yard full');
  assertEq(s.nursery.length, 1, 'still in the crib');
  s.barnCapacity = 3;
  const yes = adoptFromNursery(s, baby.id);
  assert(yes.ok, 'adopted');
  assertEq(s.nursery.length, 0, 'crib empty');
  assertEq(getPet(s, baby.id).status, 'idle', 'awake again');
  assertEq(adoptFromNursery(s, baby.id).ok, false, 'no longer in the nursery');
});

test('swapWithNursery: baby enters the yard, the chosen pet takes the crib (gift collected, station dropped)', () => {
  const s = fullYard(1);
  const baby = hatchReady(s, 0).pet;
  const out = s.pets[1];
  s.plots[0].stations = [out.id, null, null];
  out.station = { plotIndex: 0, slot: 0 };
  tickYard(s, 2 * HOUR);
  const coins = s.player.coins;
  const r = swapWithNursery(s, baby.id, out.id);
  assert(r.ok, 'swapped');
  assert(s.player.coins > coins, 'the gift it held was collected first');
  assertEq(s.pets.map(p => p.id).sort(), ['p1', baby.id].sort(), 'baby in, rabbit out');
  assertEq(s.nursery.length, 1, 'still one crib in use');
  assertEq(s.nursery[0].pet.id, out.id, 'the rabbit sleeps in the crib');
  assertEq(out.status, 'nursery', 'frozen');
  assertEq(out.station, null, 'pin dropped');
  assertEq(s.plots[0].stations[0], null, 'plot station cleared too');
  assertEq(s.yard.byPet[out.id], undefined, 'its gift record is gone');
  assertEq(getPet(s, baby.id).status, 'idle', 'baby awake');
  // busy pets cannot swap out
  const s2 = fullYard(1);
  const b2 = hatchReady(s2, 0).pet;
  s2.pets[1].status = 'working';
  assertEq(swapWithNursery(s2, b2.id, s2.pets[1].id).ok, false, 'working pet stays');
  assertEq(s2.nursery.length, 1, 'nothing moved');
  assertEq(swapWithNursery(s2, 'nope', s2.pets[0].id).ok, false, 'unknown baby');
  assertEq(swapWithNursery(s2, b2.id, 'nope').ok, false, 'unknown yard pet');
});

test('rehomePet (ส่งไปบ้านใหม่): same reward as release, collects held gifts first, works for nursery babies', () => {
  const { s, pet } = yardSetup('racehorse');
  tickYard(s, 3 * HOUR);
  const coins = s.player.coins;
  const r = rehomePet(s, pet.id);
  assert(r.ok, 'rehomed');
  assertEq(s.player.coins, coins + 10 + L * 3, '10 coins + the gift it still held');
  assertEq(s.stardust, 25, 'stardust by rarity');
  assertEq(s.pets.length, 0, 'gone from the yard');
  assertEq(s.yard.byPet[pet.id], undefined, 'gift record gone');
  assert(/บ้านใหม่/.test(r.msg) && !/ปล่อย/.test(r.msg), 'new wording: ' + r.msg);
  assertEq(s.stats.released, 1, 'stats.released');
  // a nursery baby can go too
  const t = fullYard(1);
  const baby = hatchReady(t, 0).pet;
  const dust = rehomeDust(baby);
  assert(rehomePet(t, baby.id).ok, 'baby rehomed');
  assertEq(t.nursery.length, 0, 'crib empty');
  assertEq(t.stardust, dust, 'baby stardust');
  assertEq(rehomePet(t, baby.id).ok, false, 'only once');
  // a stationed pet frees its plot slot
  const u = setup('hamster');
  u.s.plots[1].stations = [u.pet.id, null, null];
  u.pet.station = { plotIndex: 1, slot: 0 };
  assert(rehomePet(u.s, u.pet.id).ok, 'stationed pet rehomed');
  assertEq(u.s.plots[1].stations[0], null, 'station cleared');
  // busy pets cannot be rehomed
  const busy = setup('hamster', { status: 'expedition' });
  assertEq(rehomePet(busy.s, busy.pet.id).ok, false, 'expedition pet stays');
  const old = setup('hamster');
  assert(releasePet(old.s, old.pet.id).ok, 'the old name still works');
});

test('postcards: 12-36 h after rehoming, deterministic text from >= 20 templates, badge counts unread', async () => {
  assert(POSTCARD_TEMPLATES.length >= 20, 'templates: ' + POSTCARD_TEMPLATES.length);
  assertEq(new Set(POSTCARD_TEMPLATES).size, POSTCARD_TEMPLATES.length, 'all different');
  for (const t of POSTCARD_TEMPLATES) assert(/\{name\}|\{species\}/.test(t) && t.length < 120, 'uses the pet: ' + t);
  await withFakeNow(Date.UTC(2026, 5, 1, 12, 0, 0), async clock => {
    const delays = new Set();
    for (let i = 0; i < 30; i++) {
      const { s, pet } = setup('hamster', { id: 'rh' + i, nickname: 'น้อง' + i });
      rehomePet(s, pet.id);
      const c = s.postcards[0];
      const delay = c.at - clock.get();
      assert(delay >= 12 * HOUR && delay <= 36 * HOUR, 'delay 12-36 h: ' + delay / HOUR);
      delays.add(Math.floor(delay / HOUR));
      assert(c.text.includes('น้อง' + i) || c.text.includes('แฮมสเตอร์'), 'text names the pet or its species: ' + c.text);
      assert(!/[{}]/.test(c.text), 'no placeholder left');
      assertEq([c.petName, c.speciesId, c.read], ['น้อง' + i, 'hamster', false], 'fields');
    }
    assert(delays.size >= 8, 'delays are spread out: ' + delays.size);
    // same pet id -> same card and delay (deterministic)
    const mk = () => { const { s, pet } = setup('hamster', { id: 'same', nickname: 'โมจิ' }); rehomePet(s, pet.id); return s.postcards[0]; };
    const a = mk(), b = mk();
    assertEq([a.text, a.at], [b.text, b.at], 'deterministic');
    // the card arrives only after its time
    const { s, pet } = setup('hamster', { id: 'late', nickname: 'ข้าวปั้น' });
    rehomePet(s, pet.id);
    const at = s.postcards[0].at;
    assertEq(arrivedPostcards(s).length, 0, 'not yet');
    assertEq(unreadPostcardCount(s), 0, 'no badge yet');
    clock.set(at - 1);
    assertEq(arrivedPostcards(s).length, 0, 'one ms early');
    clock.set(at);
    assertEq(unreadPostcardCount(s), 1, 'badge');
    tickPets(s, 1000, { offline: false });
    assertEq(s.postcards[0].notified, true, 'toast sent once');
    assert(markPostcardRead(s, s.postcards[0].id), 'mark read');
    assertEq(unreadPostcardCount(s), 0, 'badge gone');
    assertEq(arrivedPostcards(s).length, 1, 'still in the mailbox');
    // max 30, oldest dropped
    for (let i = 0; i < 40; i++) { const x = setup('hamster', { id: 'q' + i }); x.s.postcards = s.postcards; rehomePet(x.s, x.pet.id); s.postcards = x.s.postcards; clock.advance(HOUR); }
    assertEq(s.postcards.length, POSTCARD_MAX, 'capped at 30');
    assert(s.postcards.every((c, i, arr) => i === 0 || arr[i - 1].at <= c.at), 'kept in time order');
  });
});

test('compare helper: duplicates first, then lowest power / hearts, not shiny, not stationed; "ซ้ำ ×N" counts the baby', () => {
  const { s } = setup('hamster', { id: 'h1', nickname: 'แฮม1', stage: 0 });
  s.barnCapacity = 8;
  addPet(s, 'h2', 'hamster', { stage: 2, bond: 120 });                    // duplicate, strong, 3 hearts
  addPet(s, 'h3', 'hamster', { stage: 0, shiny: true });                 // duplicate, weak but shiny
  addPet(s, 'c1', 'cat', { stage: 0 });                                  // unique, weak
  addPet(s, 'd1', 'dragon', { stage: 3, bond: 360 });                    // unique legendary
  addPet(s, 'w1', 'hamster', { stage: 0, status: 'working' });           // busy
  s.incubator.push({ eggId: 'egg_farm', startAt: 0, readyAt: 0 });
  s.barnCapacity = s.pets.length;
  const baby = hatchReady(s, 0).pet;                                      // lands in the nursery
  s.nursery[0].pet.speciesId = 'cat';                                     // make the baby a cat so "cat" is duplicated
  const rows = compareCandidates(s, { scope: 'yard' });
  const ids = rows.map(r => r.id);
  assertEq(ids.includes(baby.id), false, 'scope yard: the baby is not a candidate');
  const by = id => rows.find(r => r.id === id);
  assertEq(by('h1').dup, 4, 'four hamsters in the yard');
  assertEq(by('c1').dup, 2, 'cat + the cat baby in the nursery');
  assertEq(by('d1').dup, 1, 'dragon unique');
  // order: eligible duplicates by power first ...
  const dupIdx = ids.filter(i => by(i).eligible && by(i).dup > 1);
  assertEq(ids.slice(0, dupIdx.length), dupIdx, 'duplicates come first');
  assertEq(dupIdx[0] === 'h1' || dupIdx[0] === 'c1', true, 'weakest duplicate leads');
  assert(ids.indexOf('h1') < ids.indexOf('h2'), 'weak hamster before the strong one');
  assert(ids.indexOf('h1') < ids.indexOf('h3') || by('h1').power <= by('h3').power, 'non-shiny first on equal power');
  assert(ids.indexOf('c1') < ids.indexOf('d1'), 'unique weak before the legendary');
  assertEq(ids[ids.length - 1], 'w1', 'busy pets sink to the end');
  assertEq(by('w1').eligible, false, 'not eligible');
  assert(by('w1').reason.length > 0, 'with a reason');
  assertEq(by('h1').suggest, true, 'duplicate non-shiny is suggested');
  assertEq(by('h3').suggest, false, 'shiny duplicate is not suggested');
  assertEq(by('d1').suggest, false, 'unique is not suggested');
  assertEq(by('d1').hearts, 5, 'hearts');
  assert(by('d1').power > by('h2').power, 'power grows with stage / rarity-free aptitude');
  // scope all adds the nursery
  const all = compareCandidates(s, { scope: 'all' });
  assert(all.some(r => r.id === baby.id && r.where === 'nursery'), 'baby listed under scope all');
  assertEq(compareCandidates(s, { scope: 'all', excludeId: baby.id }).some(r => r.id === baby.id), false, 'excludeId');
  // never auto-selects: the helper only returns rows
  assert(rows.every(r => !('selected' in r)), 'no preselection');
});

test('compare helper marks stationed pets and breaks ties by hearts, then shiny, then station', () => {
  const { s } = setup('hamster', { id: 'a', bond: 0 });
  s.barnCapacity = 5;
  addPet(s, 'b', 'hamster', { bond: 60 });
  addPet(s, 'c', 'hamster', { bond: 0, station: { plotIndex: 2, slot: 1 } });
  const rows = compareCandidates(s, { scope: 'yard' });
  assertEq(rows.map(r => r.id), ['a', 'c', 'b'], 'same power: fewer hearts first, then not-stationed first');
  assertEq(rows.find(r => r.id === 'c').station, 'ประจำแปลง #3', 'station label');
});

test('stationStatus: "ประจำแปลง #N" and what the resting pet is doing', () => {
  const { s, pet } = setup('hamster', { station: { plotIndex: 2, slot: 0 } });
  s.plots[2].cropId = 'carrot'; s.plots[2].progress = 0.3;
  assertEq(stationStatus(s, pet).label, 'ประจำแปลง #3', 'label');
  assert(/พร้อมกลับไปทำงาน/.test(stationStatus(s, pet).text), 'ready to go back');
  pet.status = 'sleeping'; assertEq(stationStatus(s, pet).emoji, '💤', 'sleeping');
  pet.status = 'idle'; pet.stats.hunger = 5; assertEq(stationStatus(s, pet).emoji, '😋', 'hungry');
  pet.stats.hunger = 80; pet.sick = true; assertEq(stationStatus(s, pet).emoji, '🤒', 'sick');
  pet.sick = false; pet.status = 'working'; assertEq(stationStatus(s, pet).emoji, '🌾', 'working');
  pet.status = 'idle'; s.plots[2].cropId = null; assert(/รอที่ลาน/.test(stationStatus(s, pet).text), 'empty plot: waits at home');
  assertEq(stationStatus(s, setup('cat').pet), null, 'not stationed');
});

// ── yard tiers S / M / L / XL (CONTRACT_V6 §4) ───────────────────────────────
test('yard tiers: capacity -> tier, same rule and numbers as the engine', async () => {
  for (const [cap, tier] of [[0, 'S'], [3, 'S'], [5, 'S'], [6, 'M'], [9, 'M'], [10, 'L'], [14, 'L'], [15, 'XL'], [20, 'XL'], [40, 'XL']]) {
    assertEq(yardTierOf(cap), tier, 'capacity ' + cap);
  }
  const eng = await import('../js/world3d/engine.js');
  for (const t of ['S', 'M', 'L', 'XL']) {
    assertEq([YARD_TIER_LAYOUT[t].walk, YARD_TIER_LAYOUT[t].barnZ], [eng.YARD_TIERS[t].walk, eng.YARD_TIERS[t].barnZ], 'layout mirrors engine ' + t);
    assertEq(eng.yardTierForCapacity(t === 'S' ? 4 : t === 'M' ? 7 : t === 'L' ? 12 : 18), t, 'engine tier rule ' + t);
  }
  assert(YARD_TIER_LAYOUT.S.walk < YARD_TIER_LAYOUT.M.walk && YARD_TIER_LAYOUT.M.walk < YARD_TIER_LAYOUT.L.walk && YARD_TIER_LAYOUT.L.walk < YARD_TIER_LAYOUT.XL.walk, 'walk radius grows');
});

test('yard props: cumulative per tier, clear of the bowl, the nest row and each other, inside the island', () => {
  const kinds = t => yardProps(t).map(p => p.kind);
  assertEq(kinds('S'), [], 'S: plain meadow');
  assertEq(kinds('M'), ['pond', 'tree'], 'M');
  assertEq(kinds('L'), ['pond', 'tree', 'flowerbed', 'playground'], 'L');
  assertEq(kinds('XL').slice(0, 6), ['pond', 'tree', 'flowerbed', 'playground', 'hill', 'lantern'], 'XL');
  assertEq(kinds('XL').filter(k => k === 'lantern').length, 4, 'four lanterns');
  const saved = JSON.stringify(YARD);
  try {
    for (const t of ['S', 'M', 'L', 'XL']) {
      configureYard(t);
      const lay = YARD_TIER_LAYOUT[t];
      const props = yardProps(t);
      for (const p of props) {
        assert(Math.hypot(p.x, p.z) + p.r <= lay.walk + 1.4, `${t}/${p.id} inside the island`);
        assert(Math.hypot(p.x - YARD.bowl.x, p.z - YARD.bowl.z) > p.r + 0.9, `${t}/${p.id} keeps clear of the food bowl`);
        for (let i = 0; i < 6; i++) {
          const n = nestSpot(i, 6);
          assert(Math.hypot(p.x - n.x, p.z - n.z) > p.r + 0.7, `${t}/${p.id} keeps clear of nest ${i}`);
        }
        for (const q of props) if (q !== p) assert(Math.hypot(p.x - q.x, p.z - q.z) > p.r + q.r + 0.2 || p.kind === 'lantern' && q.kind === 'lantern', `${t}: ${p.id} vs ${q.id}`);
      }
      assertEq(YARD.nestZ, lay.barnZ + 2.35, t + ' nest row follows the barn');
      assert(YARD.walkRadius < lay.walk, 'pets stay inside the engine walk radius');
      // wander targets respect the new radius and avoid the props
      const rng = makeRng(77);
      for (let i = 0; i < 300; i++) {
        const tg = pickTarget(rng, 0, 0.5, [], false);
        assert(Math.hypot(tg.x, tg.z) <= YARD.walkRadius + 1e-6, t + ': target inside the yard');
        for (const p of props) if (p.kind !== 'lantern') assert(Math.hypot(tg.x - p.x, tg.z - p.z) >= p.r + 0.6 - 1e-6 || Math.hypot(tg.x, tg.z) < 0.01, `${t}: target clear of ${p.id}`);
      }
    }
  } finally { Object.assign(YARD, JSON.parse(saved)); }
});

test('part animator also drives a whale fluke (rotation.x) and ignores models without one', () => {
  const fluke = { rotation: { x: 0.1, y: 0, z: 0 } };
  const parts = { fluke };
  applyPartPose(parts, partBases(parts), { fluke: 0.5 });
  assert(Math.abs(fluke.rotation.x - 0.6) < 1e-9, 'fluke swings around its rest pose');
  applyPartPose({}, partBases({}), { fluke: 0.5 });
});

// ── nursery cribs, decor behaviour (CONTRACT_V7 §2 / §5) ─────────────────────
import { cribSpot, decorOptions, decorStand, DECOR_USE, DECOR_USE_TYPES } from '../js/petBehaviour.js';
import { DECOR } from '../js/data/decor.js';
import { compareRowHtml } from '../js/ui/petsView.js';

test('cribSpot: three distinct cribs left of the nests, behind the wander limit, inside the fence, clear of the nests', () => {
  const saved = JSON.stringify(YARD);
  try {
    for (const t of ['S', 'M', 'L', 'XL']) {
      configureYard(t);
      const lay = YARD_TIER_LAYOUT[t];
      for (const n of [1, 2, 3]) {
        const spots = [0, 1, 2].map(i => cribSpot(i, n));
        for (const [i, c] of spots.entries()) {
          assert(c.z < YARD.backLimit, `${t}/${n}/${i}: behind the wander limit`);
          assert(Math.hypot(c.x, c.z) < lay.walk + 0.7, `${t}/${n}/${i}: inside the fence`);
          for (let k = 0; k < n; k++) { const ns = nestSpot(k, n); assert(Math.hypot(c.x - ns.x, c.z - ns.z) > 1.1, `${t}/${n}/${i}: clear of nest ${k}`); }
          for (const [j, d] of spots.entries()) if (j > i) assert(Math.hypot(c.x - d.x, c.z - d.z) > 0.9, `${t}/${n}: cribs ${i} and ${j} do not overlap`);
        }
      }
    }
  } finally { Object.assign(YARD, JSON.parse(saved)); }
});

test('decor uses: every usable decor of data/decor.js has a behaviour, the sign none', () => {
  for (const d of DECOR) {
    if (d.id === 'sign') { assertEq(DECOR_USE[d.id], undefined, 'sign has no pet behaviour'); continue; }
    assert(DECOR_USE_TYPES.has(DECOR_USE[d.id]), d.id + ' maps to a behaviour');
    assertEq(DECOR_USE[d.id], d.use, d.id + ' same key as the data file');
  }
});

test('pets with placed decor: nap on the bed, eat at the bowl, kick the ball, rock on the horse, jump in the leaves', () => {
  configureYard('XL');
  const at = (decorId, x, z, busy = null) => ({ id: 'd_' + decorId, decorId, x, z, busy });
  const all = [at('bed', 2, 3), at('bowl', -2, 3), at('ball', 0, 4), at('horse', 3, 1), at('leaves', -3, 1)];
  const pet = over => ({ id: 'q', speciesId: 'hamster', personality: 'cheerful', status: 'idle', sick: false, stats: { hunger: 80, happy: 90, energy: 90, clean: 90 }, ...over });
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const a = nextAction(pet(), { x: 0, z: 1, others: [], last: 'idle', decor: all, size: 0.5 }, makeRng(seed), 0);
    if (a.type === 'decor') {
      seen.add(a.use);
      assert(Number.isFinite(a.target.x) && Math.hypot(a.target.x, a.target.z) <= YARD.walkRadius + 1e-6, 'stand point inside the yard');
      assertEq(a.decorId, all.find(d => d.id === a.instId).decorId, 'instance matches');
      assertEq(a.nap, a.use === 'nap', 'only the bed counts as a nap');
      assert(a.duration > 2 && a.duration < 20, 'visit length ' + a.duration);
    }
  }
  assertEq([...seen].sort(), ['eat', 'jump', 'kick', 'nap', 'rock'], 'all five uses happen');
  // busy decor is skipped, hungry (<25) pets go to the real food bowl, big pets skip the horse, nobody uses the sign
  assertEq(decorOptions(pet(), { decor: [at('bed', 2, 3, 'someone')] }).length, 0, 'busy bed');
  assertEq(decorOptions(pet(), { decor: [{ id: 's', decorId: 'sign', x: 1, z: 1 }] }).length, 0, 'sign has no use');
  assertEq(decorOptions(pet(), { decor: [at('horse', 1, 1)], size: 1.3 }).length, 0, 'too big for the horse');
  assertEq(decorOptions(pet({ stats: { happy: 10 } }), { decor: [at('ball', 1, 1), at('leaves', 2, 1)] }).length, 0, 'sad pets do not play');
  assertEq(decorOptions(pet(), { decor: [at('bed', 1, 1)], napRatio: NAP_CAP }).length, 0, 'the nap cap also covers the bed');
  for (let seed = 1; seed <= 100; seed++) {
    const a = nextAction(pet({ stats: { hunger: 10, happy: 90, energy: 90, clean: 90 } }), { x: 0, z: 1, others: [], last: 'idle', decor: all }, makeRng(seed), 0);
    assert(a.type !== 'decor', 'a starving pet goes to the food bowl, not to play');
  }
  // sleeping / sick pets ignore decor
  assertEq(nextAction(pet({ status: 'sleeping' }), { decor: all }, makeRng(3), 0).type, 'sleep', 'sleeping stays');
  assertEq(nextAction(pet({ sick: true }), { decor: all }, makeRng(3), 0).type === 'decor', false, 'sick stays');
  // a lazy pet prefers the bed, a glutton the bowl
  const count = (p, id) => { let n = 0; for (let s = 1; s <= 300; s++) { const a = nextAction(p, { x: 0, z: 1, others: [], last: 'idle', decor: all }, makeRng(s), 0); if (a.type === 'decor' && a.decorId === id) n++; } return n; };
  assert(count(pet({ personality: 'lazy', stats: { hunger: 80, happy: 90, energy: 40, clean: 90 } }), 'bed') > count(pet({ personality: 'cheerful' }), 'bed'), 'lazy naps on the bed more');
  assert(count(pet({ personality: 'glutton' }), 'bowl') > count(pet({ personality: 'cheerful' }), 'bowl'), 'glutton eats at the bowl more');
  assertEq(decorStand('eat', 0, 0).z > 0, true, 'eats from the front');
  assertEq(decorStand('nap', 1, 2), { x: 1, z: 2 }, 'sleeps on the bed');
});

test('advanceActor: a decor visit walks first, then uses the decor for its duration from arrival', () => {
  const A = { x: 0, z: 0, heading: 0, phase: 0, act: beginAction({ type: 'decor', use: 'nap', target: { x: 2, z: 0 }, speed: 1, duration: 3 }) };
  let decided = 0, arrivedAt = null, t = 0;
  const decide = () => { decided++; };
  while (t < 20 && !decided) {
    const r = advanceActor(A, 0.1, decide);
    t += 0.1;
    if (A.act.arrived && arrivedAt === null) arrivedAt = t;
    if (!A.act.arrived && !decided) assertEq(r.moving, true, 'walking');
  }
  assert(arrivedAt !== null && arrivedAt > 1.2 && arrivedAt < 3, 'arrived after walking 2 units: ' + arrivedAt);
  assertEq(decided, 1, 'decided once');
  assert(t - arrivedAt >= 2.8 && t - arrivedAt < 3.4, 'stayed ~3 s after arriving: ' + (t - arrivedAt));
  assertEq(Math.round(A.x * 10) / 10, 2, 'ended at the stand point');
});

test('compare row html: emoji, name, stage, power, hearts, shiny, station, rarity, "ซ้ำ ×N" and the soft hint', () => {
  const { s } = setup('hamster', { id: 'h1', nickname: 'มะลิ', shiny: true, station: { plotIndex: 0, slot: 0 }, bond: 120 });
  addPet(s, 'h2', 'hamster', { shiny: false, station: null, bond: 0 });
  const rows = compareCandidates(s, { scope: 'yard' });
  const html = compareRowHtml(rows.find(r => r.id === 'h1'));
  for (const bit of ['🐹', 'มะลิ', '💪', '❤️ 3', '✨', '📌 ประจำแปลง #1', 'ซ้ำ ×2']) assert(html.includes(bit), 'row shows ' + bit);
  assert(!html.includes('ตัวซ้ำ แนะนำ'), 'a shiny duplicate gets no suggestion');
  assert(compareRowHtml(rows.find(r => r.id === 'h2')).includes('ตัวซ้ำ แนะนำ'), 'the plain duplicate does');
  const busy = compareRowHtml({ ...rows[0], eligible: false, reason: 'กำลังทำงานอยู่', suggest: false });
  assert(/disabled/.test(busy) && busy.includes('กำลังทำงานอยู่'), 'busy rows are disabled with the reason');
  assert(!/selected|checked/.test(html), 'never pre-selected');
});

test('yard: migrated progress >= 1 becomes held items even when the pet is capped', () => {
  const { s, pet } = yardSetup('hamster');
  s.yard.byPet[pet.id] = { c: 5, ms: 6 * HOUR, prog: 2.4, items: {} };
  tickYard(s, 0);
  assertEq(petGift(s, pet.id).itemCount, 2, 'floor(prog) items');
  near(s.yard.byPet[pet.id].prog, 0.4, 'fraction stays');
});

test('yard: a record frozen at the cap (v4 pending 1.2 + accMs 6 h split to every heir) starts earning again', async () => {
  const { migrate } = await import('../js/state.js');
  const res = await fetch(new URL('./fixtures/save_v4_midgame.json', import.meta.url));
  const raw = await res.json();
  raw.yard = { pending: 1.2, items: {}, prog: {}, accMs: 6 * HOUR, n: 0, lastAt: 0 };
  const s = migrate(raw);
  const home = () => s.pets.filter(p => p.status !== 'working' && p.status !== 'expedition' && !p.sick);
  assert(home().length > 0, 'the fixture has pets at home');
  for (let i = 0; i < 180; i++) tickPets(s, 60 * 1000, { offline: true });   // 3 h
  for (const p of home()) assertEq(petGift(s, p.id).has, true, `${p.id} has a gift again (${JSON.stringify(s.yard.byPet[p.id])})`);
  // the same for a record that was NaN-reset at the cap
  const { s: t, pet } = yardSetup('hamster');
  t.yard.byPet[pet.id] = { c: NaN, ms: 6 * HOUR, prog: 0, items: {} };
  tickYard(t, 2 * HOUR);
  assertEq(petGift(t, pet.id).has, true, 'NaN coins at the cap recover');
});

test('yard: a stale v4 tab writing pending/items into a v5 save is kept on the first home pet', () => {
  const { s, pet } = yardSetup('hamster');
  addPet(s, 'p2', 'rabbit');
  s.yard.byPet[pet.id] = { c: 2, ms: HOUR, prog: 0, items: {} };
  s.yard.pending = 20; s.yard.items = { food_milk: 2 };
  ensureYard(s);
  assertEq(['pending', 'items'].filter(k => k in s.yard), [], 'legacy fields cleared');
  near(s.yard.byPet[pet.id].c, 22, 'coins added, not dropped');
  assertEq(s.yard.byPet[pet.id].items, { food_milk: 2 }, 'items kept');
});

test('3D gift label needs 1 h of production or an item; any gift of 1+ coin is still collectable', () => {
  const { s, pet } = yardSetup('hamster');
  tickYard(s, 0.5 * HOUR);
  const small = petGift(s, pet.id);
  assertEq([small.has, small.big], [true, false], 'half an hour: collectable, no label');
  tickYard(s, 0.5 * HOUR);
  assertEq(petGift(s, pet.id).big, true, 'an hour: label');
  assert(collectPetGift(s, pet.id).ok, 'tap collects');
  s.yard.byPet[pet.id] = { c: 1, ms: 1000, prog: 0, items: { food_milk: 1 } };
  assertEq(petGift(s, pet.id).big, true, 'a held item earns the label too');
});

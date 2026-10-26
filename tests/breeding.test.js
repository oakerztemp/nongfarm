// Breeding tests (CONTRACT_V10): eligibility, cost, cooldown, family eggs, hatch genes vs. preview odds, coats, v7 -> v8 migration, sanitiser.
import { test, assert, assertEq, withFakeNow, freshState } from './harness.js';
import { createNewState, migrate, STATE_VERSION, FAMILY_EGG_MAX as STATE_EGG_MAX, pairKey } from '../js/state.js';
import { SPECIES, getSpecies } from '../js/data/species.js';
import { EGGS, getEgg, FAMILY_EGG } from '../js/data/eggs.js';
import { ITEMS } from '../js/data/items.js';
import { COATS, getCoat, coatOf, MUTATION_COATS } from '../js/data/coats.js';
import { hatchReady, rehomePet, getPet, BOOK_GOALS, claimGoal, isGoalClaimed, tickIncubator } from '../js/pets.js';
import { journalDays } from '../js/journal.js';
import {
  BREED_COOLDOWN_MS, FAMILY_EGG_MAX, INHERIT, BREED_UNLOCK_LEVEL, canBreed, breedCost, breedPreview, breed,
  putFamilyEggInIncubator, familyEggHatchMs, rollFamilyGenes,
} from '../js/breeding.js';

const HOUR = 3600 * 1000;
const T0 = 1790200000000;

async function loadFixture(name) {
  const res = await fetch(new URL(`./fixtures/${name}.json`, import.meta.url));
  assert(res.ok, `cannot load fixture ${name}`);
  return res.json();
}

/** Deterministic rng (mulberry32), so the 20k-roll tests never flake. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const firstOf = (rarity, habitat) => SPECIES.find(s => s.rarity === rarity && s.habitat === habitat).id;

function mkPet(id, speciesId, extra = {}) {
  return {
    id, speciesId, nickname: id, shiny: false, personality: 'cheerful', stage: 2, xp: 300,
    stats: { hunger: 80, happy: 80, energy: 80, clean: 80 }, poop: 0, sick: false, zeroSince: null, lastFedAt: 0,
    status: 'idle', task: null, bornAt: T0 - 1e9, bond: 120, bondDay: null, bondToday: 0, giftDay: null, station: null,
    coat: 'base', family: null, breedReadyAt: 0, ...extra,
  };
}

/** A level-6 farm with two ready pets (hamster farm / owl-ish sky common) and plenty of coins. */
function setup(a = {}, b = {}) {
  const s = freshState();
  s.player.level = BREED_UNLOCK_LEVEL;
  s.player.coins = 100000;
  s.barnCapacity = 8;
  s.incubatorCapacity = 3;
  s.pets = [mkPet('pa', 'hamster', a), mkPet('pb', firstOf('common', 'forest'), b)];
  return s;
}

test('breeding: getEgg knows the family egg but EGGS, the shop and the sell list never do', () => {
  assertEq(getEgg('egg_family').id, 'egg_family');
  assert(getEgg('egg_family') === FAMILY_EGG && !EGGS.includes(FAMILY_EGG) && !EGGS.some(e => e.id === 'egg_family'), 'not in EGGS');
  assert(!ITEMS.egg_family && !Object.values(ITEMS).some(i => i.id === 'egg_family'), 'not an item (no buy / sell / gift)');
  assertEq(STATE_EGG_MAX, FAMILY_EGG_MAX);
  assertEq(FAMILY_EGG_MAX, 2);
});

test('coats: the six coats, weights 30/30/20/15/5, getCoat and coatOf (missing = base)', () => {
  assertEq(COATS.map(c => c.id), ['base', 'cream', 'cocoa', 'mint', 'rose', 'midnight']);
  assertEq(MUTATION_COATS.map(c => c.weight), [30, 30, 20, 15, 5]);
  assert(COATS.every(c => c.nameTh && c.emoji && Number.isFinite(c.hue) && Number.isFinite(c.sat) && Number.isFinite(c.light)), 'fields');
  assertEq(getCoat('mint').nameTh, 'สีมิ้นต์');
  assertEq(getCoat('nope'), null);
  assertEq([coatOf({}), coatOf({ coat: 'rose' }), coatOf({ coat: 'zzz' }), coatOf(null)], ['base', 'rose', 'base', 'base']);
});

test('canBreed: level, stage, hearts, sick / sleeping / working / expedition, cooldown, same pet, nursery, missing', async () => {
  await withFakeNow(T0, () => {
    const s = setup();
    assert(canBreed(s, 'pa', 'pb').ok, 'ready pair');
    assert(canBreed(s, s.pets[0], s.pets[1]).ok, 'pet objects work too');
    const bad = (mut, word, who = 'pa') => {
      const t = setup();
      mut(getPet(t, who), t);
      const r = canBreed(t, 'pa', 'pb');
      assert(!r.ok && typeof r.reason === 'string' && r.reason.includes(word), `${word}: ${JSON.stringify(r)}`);
    };
    bad((p, t) => { t.player.level = BREED_UNLOCK_LEVEL - 1; }, 'เลเวล');
    bad(p => { p.stage = 1; }, 'โตเต็มวัย');
    bad(p => { p.stage = 1; }, 'โตเต็มวัย', 'pb');
    bad(p => { p.bond = 59; }, 'หัวใจ');
    bad(p => { p.sick = true; }, 'ไม่สบาย');
    bad(p => { p.status = 'sleeping'; }, 'หลับ');
    bad(p => { p.status = 'working'; }, 'ทำงาน');
    bad(p => { p.status = 'expedition'; }, 'สำรวจ', 'pb');
    bad(p => { p.breedReadyAt = T0 + 2 * HOUR; }, 'อีก 2ชม.');
    bad((p, t) => { t.pets.splice(1, 1); t.nursery.push({ pet: { ...p, id: 'pb', status: 'nursery' }, hatchedAt: T0 }); }, 'เปล', 'pb');
    bad((p, t) => { t.player.coins = 10; }, 'เหรียญ');
    assert(canBreed(s, 'pa', 'pa').reason.includes('ต่างกัน'), 'same pet');
    assert(!canBreed(s, 'pa', 'ghost').ok, 'unknown pet');
    assertEq(canBreed(setup(), 'pa', 'pb').reason, '');
  });
});

test('canBreed: a legendary can never breed (kind message), any other pair of species may, across habitats', async () => {
  await withFakeNow(T0, () => {
    const s = setup({}, { speciesId: 'racehorse' });
    const r = canBreed(s, 'pa', 'pb');
    assert(!r.ok && r.reason.includes('ตำนาน'), r.reason);
    assert(!canBreed(setup({ speciesId: 'panda' }), 'pa', 'pb').ok, 'either side');
    for (const rarity of ['common', 'uncommon', 'rare', 'epic']) {
      const sp = SPECIES.find(x => x.rarity === rarity && x.habitat === 'savanna') || SPECIES.find(x => x.rarity === rarity);
      assert(canBreed(setup({}, { speciesId: sp.id }), 'pa', 'pb').ok, `${rarity} may breed`);
    }
  });
});

test('breedCost: 3 x the dearer habitat egg; best friends pay x0.8 rounded to 10', () => {
  const s = setup({}, { speciesId: firstOf('common', 'sky') });   // farm 100, sky 600
  assertEq(breedCost(s, 'pa', 'pb'), { cost: 1800, baseCost: 1800, friendDiscount: 0, bestFriends: false });
  s.friends[pairKey('pa', 'pb')] = 100;                            // best friends
  assertEq(breedCost(s, 'pa', 'pb'), { cost: 1440, baseCost: 1800, friendDiscount: 360, bestFriends: true });
  const f = setup({}, { speciesId: 'cow' });                       // farm + farm = 300 -> 240
  f.friends[pairKey('pa', 'pb')] = 90;
  assertEq([breedCost(f, 'pa', 'pb').cost, breedCost(f, 'pb', 'pa').cost], [240, 240]);
  const m = setup({ speciesId: SPECIES.find(x => x.habitat === 'mystic').id }, { speciesId: SPECIES.find(x => x.habitat === 'polar').id });
  assertEq(breedCost(m, 'pa', 'pb').cost, 6000, 'mystic egg 2000 x 3');
  m.friends[pairKey('pa', 'pb')] = 90;
  assertEq(breedCost(m, 'pa', 'pb').cost, 4800);
});

test('breed: pays, lays a snapshot egg, starts the 72 h cooldown on both, journals; refuses when full or poor; ready again after 72 h', async () => {
  await withFakeNow(T0, async clock => {
    const s = setup({ shiny: true, coat: 'mint', family: { gen: 2, a: { name: 'x', speciesId: 'cow' }, b: { name: 'y', speciesId: 'pig' } } });
    s.player.coins = 1000;
    const r = breed(s, 'pa', 'pb');
    assert(r.ok && r.egg, JSON.stringify(r));
    assertEq(s.player.coins, 1000 - 250 * 3, 'farm 100 / forest 250 -> 750');
    assertEq(s.familyEggs.length, 1);
    const egg = s.familyEggs[0];
    assertEq([egg.habitatA, egg.habitatB, egg.laidAt], ['farm', 'forest', T0]);
    assertEq(egg.a, { petId: 'pa', name: 'pa', speciesId: 'hamster', personality: 'cheerful', shiny: true, coat: 'mint', gen: 2 });
    assertEq([egg.b.coat, egg.b.gen, egg.b.shiny], ['base', 0, false]);
    assertEq([getPet(s, 'pa').breedReadyAt, getPet(s, 'pb').breedReadyAt], [T0 + BREED_COOLDOWN_MS, T0 + BREED_COOLDOWN_MS]);
    assertEq(BREED_COOLDOWN_MS, 72 * HOUR);
    const lines = journalDays(s).flatMap(d => d.lines);
    assert(lines.some(l => l.emoji === '💞' && l.text.includes('pa') && l.text.includes('pb') && l.text.includes('มีไข่ครอบครัวแล้ว')), 'laid line');

    assert(!breed(s, 'pa', 'pb').ok && canBreed(s, 'pa', 'pb').reason.includes('อีก'), 'cooldown');
    clock.advance(BREED_COOLDOWN_MS - 1);
    assert(!canBreed(s, 'pa', 'pb').ok, 'one ms short');
    s.player.coins = 5000;
    clock.advance(1);
    assert(canBreed(s, 'pa', 'pb').ok, 'ready after 72 h');
    assert(breed(s, 'pa', 'pb').ok, 'second egg');
    assertEq(s.familyEggs.length, 2);
    clock.advance(BREED_COOLDOWN_MS);
    const full = breed(s, 'pa', 'pb');
    assert(!full.ok && full.reason.includes('เต็ม'), `cap: ${full.reason}`);
    assertEq(s.familyEggs.length, FAMILY_EGG_MAX);
  });
  await withFakeNow(T0, () => {
    const s = setup();
    s.player.coins = 749;
    const r = breed(s, 'pa', 'pb');
    assert(!r.ok && r.reason.includes('เหรียญ') && s.familyEggs.length === 0 && s.player.coins === 749, 'poor: nothing changes');
  });
});

test('breed: best friends get the discount in the actual payment', async () => {
  await withFakeNow(T0, () => {
    const s = setup();
    s.friends[pairKey('pa', 'pb')] = 100;
    s.player.coins = 1000;
    assert(breed(s, 'pa', 'pb').ok);
    assertEq(s.player.coins, 1000 - 600, '750 x 0.8');
  });
});

test('family egg -> incubator: hatch time is 2 x the longer habitat egg, capacity respected, the egg leaves familyEggs', async () => {
  await withFakeNow(T0, () => {
    const s = setup();
    breed(s, 'pa', 'pb');
    const id = s.familyEggs[0].id;
    assertEq(familyEggHatchMs(s.familyEggs[0]), 2 * 2 * 60 * 1000, 'farm 30 s vs forest 2 min -> 4 min');
    s.incubatorCapacity = 1;
    s.incubator.push({ eggId: 'egg_farm', startAt: T0, readyAt: T0 + 1 });
    assert(!putFamilyEggInIncubator(s, id).ok, 'incubator full');
    assertEq(s.familyEggs.length, 1, 'egg stays');
    s.incubator.length = 0;
    assert(!putFamilyEggInIncubator(s, 'nope').ok);
    const r = putFamilyEggInIncubator(s, id);
    assert(r.ok, JSON.stringify(r));
    assertEq(s.familyEggs.length, 0);
    const slot = s.incubator[0];
    assertEq([slot.eggId, slot.startAt, slot.readyAt, slot.family.id], ['egg_family', T0, T0 + 4 * 60 * 1000, id]);
    const sky = { habitatA: 'sky', habitatB: 'mystic' };
    assertEq(familyEggHatchMs(sky), 2 * 15 * 60 * 1000);
  });
});

test('hatch: a family egg gives a baby with coat, family line, gen, shiny / personality from the parents; stats, collection, journal', async () => {
  await withFakeNow(T0, async clock => {
    const s = setup({ personality: 'lazy', coat: 'cream' }, { personality: 'lazy', coat: 'cream' });
    s.friends = {};
    breed(s, 'pa', 'pb');
    putFamilyEggInIncubator(s, s.familyEggs[0].id);
    assert(!hatchReady(s, 0).ok, 'not ready yet');
    clock.advance(5 * 60 * 1000);
    tickIncubator(s, T0 + 5 * 60 * 1000);
    const before = s.stats.hatched || 0;
    const r = hatchReady(s, 0);
    assert(r.ok, JSON.stringify(r));
    const pet = r.pet;
    assert(getSpecies(pet.speciesId), 'real species');
    assert(['hamster', ...SPECIES.filter(x => x.habitat === 'farm' || x.habitat === 'forest').map(x => x.id)].includes(pet.speciesId), 'a parent species or one of the parent habitats');
    assert(['lazy', ...['hardworking', 'glutton', 'cheerful', 'shy', 'naughty']].includes(pet.personality));
    assertEq(pet.family.gen, 1);
    assertEq([pet.family.a.name, pet.family.b.name, pet.family.a.speciesId], ['pa', 'pb', 'hamster']);
    assert(['base', 'cream', 'cocoa', 'mint', 'rose', 'midnight'].includes(pet.coat) && pet.breedReadyAt === 0 && pet.stage === 0);
    assertEq([s.stats.hatched, s.stats.bred], [before + 1, 1]);
    assert(s.coatsSeen[pet.coat] === true && s.coatsSeen.base === true);
    assertEq(s.incubator.length, 0);
    assert(s.collection[pet.speciesId].owned >= 1, 'collection');
    assert(s.pets.includes(pet), 'in the yard');
    assert(r.msg.includes('pa') && r.msg.includes('pb'), 'message names the parents');
    const lines = journalDays(s).flatMap(d => d.lines);
    assert(lines.some(l => l.emoji === '🐣' && l.text === 'ลูกของ pa กับ pb ฟักออกมาแล้ว'), 'hatched line');
  });
});

test('hatch: full yard -> nursery (the baby keeps its genes); a normal egg still has no family fields', async () => {
  await withFakeNow(T0, clock => {
    const s = setup();
    breed(s, 'pa', 'pb');
    putFamilyEggInIncubator(s, s.familyEggs[0].id);
    s.barnCapacity = 2;
    clock.advance(10 * 60 * 1000);
    const r = hatchReady(s, 0);
    assert(r.ok && r.nursery && s.nursery.length === 1, 'nursery');
    assertEq(s.nursery[0].pet.family.gen, 1);
    assertEq(s.nursery[0].pet.status, 'nursery');
    const n = setup();
    n.barnCapacity = 5;
    n.incubator.push({ eggId: 'egg_farm', startAt: T0, readyAt: T0 });
    const h = hatchReady(n, 0);
    assert(h.ok && h.pet.family === undefined && h.pet.coat === undefined && !('bred' in n.stats && n.stats.bred > 0), 'normal egg unchanged');
    assertEq(coatOf(h.pet), 'base');
  });
});

test('hatch: a rehomed parent changes nothing (the egg is a snapshot); gen = max(parent gen) + 1', async () => {
  await withFakeNow(T0, clock => {
    const fam = { gen: 3, a: { name: 'x', speciesId: 'cow' }, b: { name: 'y', speciesId: 'pig' } };
    const s = setup({ family: fam }, {});
    breed(s, 'pa', 'pb');
    putFamilyEggInIncubator(s, s.familyEggs[0].id);
    assert(rehomePet(s, 'pa').ok && rehomePet(s, 'pb').ok, 'both parents moved to a new home');
    assertEq(s.pets.length, 0);
    clock.advance(10 * 60 * 1000);
    const r = hatchReady(s, 0);
    assert(r.ok, JSON.stringify(r));
    assertEq(r.pet.family.gen, 4, 'gen 3 + 1');
    assertEq([r.pet.family.a.name, r.pet.family.b.name], ['pa', 'pb']);
    const e = { habitatA: 'farm', habitatB: 'farm', a: { speciesId: 'cow', name: 'a', personality: 'shy', shiny: false, coat: 'base', gen: 0 }, b: { speciesId: 'cow', name: 'b', personality: 'shy', shiny: false, coat: 'base', gen: 5 } };
    assertEq(rollFamilyGenes(e, seeded(1)).gen, 6);
    e.b.gen = 0;
    assertEq(rollFamilyGenes(e, seeded(1)).gen, 1);
  });
});

const near = (got, want, tol, what) => assert(Math.abs(got - want) <= tol, `${what}: got ${(got * 100).toFixed(2)} %, expected ${(want * 100).toFixed(2)} %`);

test('breedPreview: odds sum to 1 (species, coats) and match 20k rolls within 1.5 %', async () => {
  await withFakeNow(T0, () => {
    const pairs = [
      [{ speciesId: 'hamster', coat: 'mint', shiny: true }, { speciesId: firstOf('rare', 'water'), coat: 'rose' }],
      [{ speciesId: firstOf('uncommon', 'bug'), coat: 'base' }, { speciesId: firstOf('epic', 'sky'), coat: 'base', shiny: true }],
      [{ speciesId: 'cow', coat: 'cocoa' }, { speciesId: 'cow', coat: 'cocoa' }],
    ];
    let seed = 11;
    for (const [a, b] of pairs) {
      const s = setup(a, b);
      const p = breedPreview(s, 'pa', 'pb');
      assert(p.ok, p.reason);
      near(p.species.reduce((n, x) => n + x.chance, 0), 1, 1e-9, 'species sum');
      near(p.coats.reduce((n, x) => n + x.chance, 0), 1, 1e-9, 'coat sum');
      assert(p.species.every(x => x.chance > 0 && (x.speciesId === null || getSpecies(x.speciesId)) && x.habitat), 'species rows');
      assertEq([p.cost, p.friendDiscount], [breedCost(s, 'pa', 'pb').cost, 0]);

      const egg = breed(s, 'pa', 'pb').egg;
      const rng = seeded(seed++);
      const N = 20000;
      const sp = {}, coat = {};
      let shiny = 0;
      for (let i = 0; i < N; i++) {
        const g = rollFamilyGenes(egg, rng);
        const key = g.inherited ? g.speciesId : `~${g.habitat}`;
        sp[key] = (sp[key] || 0) + 1;
        coat[g.coat] = (coat[g.coat] || 0) + 1;
        if (g.shiny) shiny++;
      }
      for (const row of p.species) near((sp[row.speciesId || `~${row.habitat}`] || 0) / N, row.chance, 0.015, `species ${row.speciesId || row.habitat}`);
      for (const row of p.coats) near((coat[row.coat] || 0) / N, row.chance, 0.015, `coat ${row.coat}`);
      near(shiny / N, p.shinyChance, 0.015, 'shiny');
    }
  });
});

test('breedPreview: INHERIT table, shiny 3 % + 7 % per shiny parent (max 17 %), coat rules, odds even when the pair cannot breed', async () => {
  await withFakeNow(T0, () => {
    assertEq(INHERIT, { common: 1, uncommon: 0.85, rare: 0.6, epic: 0.3 });
    const cc = firstOf('common', 'farm');
    const s = setup({ speciesId: cc }, { speciesId: firstOf('common', 'forest') });
    const p = breedPreview(s, 'pa', 'pb');
    assertEq(p.species.map(x => [x.speciesId, x.chance]).sort(), [[cc, 0.5], [firstOf('common', 'forest'), 0.5]].sort(), 'commons always inherit');
    near(p.shinyChance, 0.03, 1e-12, 'no shiny parent');
    getPet(s, 'pa').shiny = true;
    near(breedPreview(s, 'pa', 'pb').shinyChance, 0.10, 1e-12, 'one shiny parent');
    getPet(s, 'pb').shiny = true;
    near(breedPreview(s, 'pa', 'pb').shinyChance, 0.17, 1e-12, 'two shiny parents');
    // coats: different coats 45/45 + 10 % mutation spread by weight; the same coat 80 % + 20 %
    const c = Object.fromEntries(breedPreview(setup({ coat: 'cream' }, { coat: 'mint' }), 'pa', 'pb').coats.map(x => [x.coat, x.chance]));
    near(c.cream, 0.45 + 0.1 * 0.3, 1e-9, 'cream');
    near(c.mint, 0.45 + 0.1 * 0.2, 1e-9, 'mint');
    near(c.midnight, 0.1 * 0.05, 1e-9, 'midnight');
    assert(!('base' in c), 'base is never a mutation');
    const same = Object.fromEntries(breedPreview(setup({ coat: 'rose' }, { coat: 'rose' }), 'pa', 'pb').coats.map(x => [x.coat, x.chance]));
    near(same.rose, 0.8 + 0.2 * 0.15, 1e-9, 'same coat');
    const base = Object.fromEntries(breedPreview(setup(), 'pa', 'pb').coats.map(x => [x.coat, x.chance]));
    near(base.base, 0.8, 1e-9, 'base x base');
    // not ready (young) -> ok false with a reason, but still the cost and odds; unknown pets -> empty
    getPet(s, 'pa').stage = 0;
    const young = breedPreview(s, 'pa', 'pb');
    assert(!young.ok && young.reason && young.cost > 0 && young.species.length && young.coats.length, 'odds shown anyway');
    const none = breedPreview(s, 'pa', 'ghost');
    assert(!none.ok && none.species.length === 0 && none.cost === 0);
  });
});

test('rollFamilyGenes: personality is 40 / 40 / 20 and shiny parents lift the shiny rate', () => {
  const mk = (pers, shiny) => ({ speciesId: 'cow', name: 'n', personality: pers, shiny, coat: 'base', gen: 0 });
  const egg = { habitatA: 'farm', habitatB: 'farm', a: mk('shy', false), b: mk('lazy', false) };
  const rng = seeded(5);
  const N = 20000, c = {};
  for (let i = 0; i < N; i++) { const g = rollFamilyGenes(egg, rng); c[g.personality] = (c[g.personality] || 0) + 1; }
  near(c.shy / N, 0.4 + 0.2 / 6, 0.015, 'shy');
  near(c.lazy / N, 0.4 + 0.2 / 6, 0.015, 'lazy');
  near(c.glutton / N, 0.2 / 6, 0.015, 'random one');
  const sh = { ...egg, a: mk('shy', true), b: mk('lazy', true) };
  let n = 0;
  for (let i = 0; i < N; i++) if (rollFamilyGenes(sh, rng).shiny) n++;
  near(n / N, 0.17, 0.015, 'shiny with two shiny parents');
});

test('coats_all goal: counts coatsSeen (6 coats) and pays 50 stardust', () => {
  const g = BOOK_GOALS.find(x => x.id === 'coats_all');
  assert(g && g.titleTh.includes('6') && g.reward.stardust === 50, 'goal exists');
  const s = freshState();
  s.coatsSeen = { base: true, cream: true, bogus: true, mint: false };
  assertEq([g.progress(s), g.check(s)], [2, false], 'only real coats count');
  assert(!claimGoal(s, 'coats_all').ok);
  s.coatsSeen = Object.fromEntries(COATS.map(c => [c.id, true]));
  assert(g.check(s));
  const dust = s.stardust || 0;
  assert(claimGoal(s, 'coats_all').ok && isGoalClaimed(s, 'coats_all'));
  assertEq(s.stardust, dust + 50);
});

// ---- state v8: migration + sanitiser ----

test('migrate v7 -> v8: fixture kept, familyEggs / coatsSeen / pet fields default (nursery pets too)', async () => {
  const raw = await loadFixture('save_v7_midgame');
  assertEq(raw.version, 7);
  const s = await withFakeNow(1790100000000, () => migrate(raw));
  assertEq([s.version, STATE_VERSION], [8, 8]);
  assertEq([s.familyEggs, s.coatsSeen], [[], { base: true }]);
  assert(s.pets.length === raw.pets.length && s.pets.every(p => p.coat === 'base' && p.family === null && p.breedReadyAt === 0), 'pets');
  assert(s.nursery.length && s.nursery.every(e => e.pet.coat === 'base' && e.pet.family === null), 'nursery pets');
  assertEq(s.pets[0].wear.head, 'acc_bow', 'v7 data kept');
  assertEq(s.wardrobe, { acc_bow: 1, acc_bell: 1 });
  assertEq(s.journal.length, 1);
  assertEq(s.stats.bred, 0);
  assertEq(s.incubator.length, raw.incubator.length);
  assert(s.incubator.every(x => x.family === undefined), 'normal egg slots untouched');
  assertEq(migrate(JSON.parse(JSON.stringify(s))), s, 'idempotent');
  // a v6 save climbs all the way
  const old = await withFakeNow(1790100000000, async () => migrate(await loadFixture('save_v6_midgame')));
  assertEq([old.version, old.familyEggs, old.coatsSeen], [8, [], { base: true }]);
});

const goodParent = (id, sp = 'cow') => ({ petId: id, name: 'พ่อ', speciesId: sp, personality: 'shy', shiny: true, coat: 'rose', gen: 2 });
const goodEgg = (id = 'e1') => ({ id, laidAt: T0, habitatA: 'farm', habitatB: 'forest', a: goodParent('p1'), b: goodParent('p2', 'hamster') });

test('v8 sanitiser: incubator slot.family kept when well-formed, malformed ones dropped', () => {
  const slot = (family, eggId = 'egg_family') => ({ eggId, family, startAt: T0, readyAt: T0 + 1000 });
  const s = migrate({
    version: 7,
    incubatorCapacity: 6,
    incubator: [
      slot(goodEgg('a')),
      slot({ ...goodEgg('b'), habitatA: 'moon' }),        // unknown habitat -> the family slot is dropped
      slot({ ...goodEgg('c'), a: { ...goodParent('p1'), speciesId: 'nope' } }),
      slot(null),
      slot(undefined),
      slot('junk'),
      slot({ ...goodEgg('d'), laidAt: 'x' }),
      slot(goodEgg('e'), 'egg_farm'),                    // a normal egg with a stray family: egg kept, the family field removed
      slot({ id: 'f' }, 'egg_farm'),                     // normal egg with junk family: kept, family removed
      { eggId: 'egg_forest', startAt: T0, readyAt: T0 + 1 },
    ],
  });
  assertEq(s.incubator.map(x => x.eggId), ['egg_family', 'egg_farm', 'egg_farm', 'egg_forest']);
  assertEq(s.incubator[0].family, goodEgg('a'), 'good family kept intact');
  assert(s.incubator.slice(1).every(x => x.eggId !== 'egg_family'), 'no broken family slot survives');
  assertEq(s.incubator[2].family, undefined, 'junk family removed from a normal egg');
  assertEq(migrate(JSON.parse(JSON.stringify(s))).incubator, s.incubator, 'idempotent');
});

test('v8 sanitiser: familyEggs cleaned, deduped, capped at 2; coatsSeen keeps real coats and the coats pets wear; pet fields validated', () => {
  const s = migrate({
    version: 7,
    familyEggs: [goodEgg('a'), goodEgg('a'), { id: 'junk' }, 'x', null, goodEgg('b'), goodEgg('c'), { ...goodEgg('d'), b: null }],
    coatsSeen: { cream: true, bogus: true, mint: 'yes', rose: false },
    pets: [
      { id: 'p1', speciesId: 'cow', coat: 'midnight', breedReadyAt: 123, family: { gen: 2, a: { name: 'a', speciesId: 'cow' }, b: { name: 'b', speciesId: 'pig' } } },
      { id: 'p2', speciesId: 'cow', coat: 'purple', breedReadyAt: 'x', family: { gen: 'z', a: {}, b: 5 } },
      { id: 'p3', speciesId: 'cow', coat: 7, breedReadyAt: -5, family: { gen: 0, a: { name: 'a', speciesId: 'cow' }, b: { name: 'b', speciesId: 'ghost' } } },
    ],
    nursery: [{ pet: { id: 'n1', speciesId: 'cow', coat: 'mint', status: 'nursery' }, hatchedAt: T0 }],
  });
  assertEq(s.familyEggs.map(e => e.id), ['a', 'b'], 'cleaned, deduped, capped');
  assertEq(s.familyEggs[0], goodEgg('a'));
  assertEq(s.coatsSeen, { base: true, cream: true, midnight: true, mint: true }, 'real coats + worn coats; bogus / false / non-true dropped');
  assertEq([s.pets[0].coat, s.pets[0].breedReadyAt, s.pets[0].family.gen], ['midnight', 123, 2]);
  assertEq([s.pets[1].coat, s.pets[1].breedReadyAt, s.pets[1].family], ['base', 0, null], 'junk repaired');
  assertEq([s.pets[2].coat, s.pets[2].breedReadyAt, s.pets[2].family], ['base', 0, null]);
  assertEq(s.nursery[0].pet.coat, 'mint');
  assertEq(migrate(JSON.parse(JSON.stringify(s))), s, 'idempotent');
  assertEq(migrate({ version: 7, familyEggs: 'x', coatsSeen: [] }).coatsSeen, { base: true }, 'junk fields repaired');
  assertEq(migrate({ version: 7, familyEggs: 'x' }).familyEggs, []);
  assertEq(createNewState().familyEggs, []);
});

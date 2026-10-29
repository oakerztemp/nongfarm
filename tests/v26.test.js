// V26 tests (CONTRACT_V26 section 1): 3-way save merge (js/merge.js), built with real game actions on copies of a base save.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { createNewState, migrate, addItem, xpForLevel, addPlayerXp } from '../js/state.js';
import { mergeSaves, MERGE_RULES } from '../js/merge.js';
import { cook } from '../js/kitchen.js';
import { plantSeed, harvestPlot, sellItem, buyItem, buildDecor, placeDecor, removeDecor, completeOrder, ensureOrders } from '../js/farm.js';
import { putEggInIncubator, hatchReady, feedPet, playWithPet } from '../js/pets.js';

const T0 = Date.UTC(2026, 9, 29, 8, 0, 0);
const MIN = 60 * 1000;
const copy = s => JSON.parse(JSON.stringify(s));

/** A mid-game base: level 5, two grown pets, food, crops, seeds, eggs. Built through the real actions. */
async function makeBase(clock) {
  const s = createNewState();
  s.player.level = 5; s.player.coins = 500; s.barnCapacity = 6; s.incubatorCapacity = 2;
  Object.assign(s.inventory, { egg_farm: 4, food_kibble: 6, crop_carrot: 6, crop_corn: 3, seed_carrot: 4, forage_wood: 12, forage_herb: 8, forage_feather: 4 });
  for (let i = 0; i < 2; i++) {
    assert(putEggInIncubator(s, 'egg_farm').ok, 'egg in');
    clock.advance(MIN);
    assert(hatchReady(s, 0).ok, 'hatch');
  }
  s.pets.forEach(p => { p.stats.hunger = 40; });
  s.updatedAt = clock.get();
  return migrate(copy(s));
}

/** One device: a deep copy of base, `fn` plays on it, stamped updatedAt. */
function device(base, clock, fn) {
  const s = copy(base);
  fn(s);
  s.updatedAt = clock.get();
  return migrate(copy(s));
}
const ids = arr => arr.map(p => p.id);
const noDup = arr => new Set(arr).size === arr.length;

test('v26 MERGE_RULES documents every top-level field of a new save', () => {
  const s = createNewState();
  for (const k of Object.keys(s)) assert(MERGE_RULES[k] && MERGE_RULES[k].rule && MERGE_RULES[k].why, `rule for ${k}`);
  assert(MERGE_RULES['*'], 'fallback rule');
});

test('v26 cook on A + harvest on B -> both outcomes present', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    base.plots[0] = { ...base.plots[0] };
    const prep = copy(base);
    assert(plantSeed(prep, 0, 'carrot').ok, 'plant');
    prep.plots[0].progress = 1;
    prep.updatedAt = clock.get();
    const b0 = migrate(prep);
    clock.advance(5 * MIN);
    const A = device(b0, clock, s => assert(cook(s, 'dish_salad').ok, 'cook'));
    clock.advance(MIN);
    const B = device(b0, clock, s => assert(harvestPlot(s, 0).ok, 'harvest'));
    const { state: m } = mergeSaves(b0, A, B);
    assertEq(m.inventory.dish_salad, 1, 'dish from A');
    assertEq(m.stats.cooked, 1);
    assertEq(m.stats.harvested, b0.stats.harvested + 1, 'harvest from B');
    assertEq(m.plots[0].cropId, null, 'plot emptied by B');
    assert(m.inventory.crop_carrot >= B.inventory.crop_carrot - 2, 'harvest crops kept (minus the 2 cooked)');
    assertEq(m.inventory.crop_carrot, b0.inventory.crop_carrot - 2 + (B.inventory.crop_carrot - b0.inventory.crop_carrot), 'carrot = base - cooked + harvested');
    assert(m.player.level > b0.player.level || m.player.xp > b0.player.xp, 'harvest xp kept');
  });
});

test('v26 hatch different eggs on both devices -> every pet present, ids unique', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    const A = device(base, clock, s => { assert(putEggInIncubator(s, 'egg_farm').ok); clock.advance(MIN); assert(hatchReady(s, 0).ok); });
    clock.advance(MIN);
    const B = device(base, clock, s => { assert(putEggInIncubator(s, 'egg_farm').ok); clock.advance(MIN); assert(hatchReady(s, 0).ok); });
    const { state: m } = mergeSaves(base, A, B);
    assertEq(m.pets.length, base.pets.length + 2, 'two new pets');
    assert(noDup(ids(m.pets)), 'unique ids');
    for (const p of [...A.pets, ...B.pets]) assert(ids(m.pets).includes(p.id), `pet ${p.id} kept`);
    assertEq(m.stats.hatched, base.stats.hatched + 2);
    assertEq(m.inventory.egg_farm || 0, base.inventory.egg_farm - 2, 'both eggs used');
    const owned = Object.values(m.collection).reduce((a, c) => a + c.owned, 0);
    const ownedBase = Object.values(base.collection).reduce((a, c) => a + c.owned, 0);
    assertEq(owned, ownedBase + 2, 'book counts both hatches');
  });
});

test('v26 feed the same pet on both devices -> xp/bond/stat counters add, food spent twice', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    const id = base.pets[0].id;
    const A = device(base, clock, s => assert(feedPet(s, id, 'food_kibble').ok));
    clock.advance(MIN);
    const B = device(base, clock, s => { assert(feedPet(s, id, 'food_kibble').ok); assert(feedPet(s, id, 'food_kibble').ok); });
    const { state: m } = mergeSaves(base, A, B);
    const pm = m.pets.find(p => p.id === id), pb = base.pets.find(p => p.id === id);
    const pa = A.pets.find(p => p.id === id), pbb = B.pets.find(p => p.id === id);
    assertEq(pm.xp, pb.xp + (pa.xp - pb.xp) + (pbb.xp - pb.xp), 'pet xp');
    assertEq(pm.bond, pb.bond + (pa.bond - pb.bond) + (pbb.bond - pb.bond), 'bond');
    assertEq(m.inventory.food_kibble, base.inventory.food_kibble - 3, 'three kibbles eaten');
    assertEq(m.stats.fed, base.stats.fed + 3);
    assertEq(pm.stats.hunger, pbb.stats.hunger, 'status values follow the newer device');
    assert(pm.lastFedAt >= pa.lastFedAt, 'lastFedAt = max');
    assertEq(m.pets.length, base.pets.length);
  });
});

test('v26 one device removes a decor, the other leaves it -> removed; a decor placed elsewhere is kept', async () => {
  await withFakeNow(T0, async clock => {
    const prep = copy(await makeBase(clock));
    assert(buildDecor(prep, 'bed').ok && buildDecor(prep, 'ball').ok, 'build');
    assert(placeDecor(prep, 'bed', 0).ok, 'place bed');
    prep.updatedAt = clock.get();
    const base = migrate(prep);
    const bedId = base.decor[0].id;
    const A = device(base, clock, s => assert(removeDecor(s, bedId).ok));
    clock.advance(MIN);
    const B = device(base, clock, s => assert(placeDecor(s, 'ball', 1).ok));
    const { state: m } = mergeSaves(base, A, B);
    assert(!m.decor.some(d => d.id === bedId), 'bed removed');
    assertEq(m.decor.map(d => d.decorId), ['ball'], 'ball placed by B');
    assertEq(m.inventoryDecor.bed, 1, 'bed back in the bag');
    assert(!m.inventoryDecor.ball, 'ball was placed, not in the bag');
  });
});

test('v26 both devices place a decor on the same spot -> neither is lost (loser returns to the bag)', async () => {
  await withFakeNow(T0, async clock => {
    const prep = copy(await makeBase(clock));
    assert(buildDecor(prep, 'bed').ok && buildDecor(prep, 'ball').ok, 'build');
    prep.updatedAt = clock.get();
    const base = migrate(prep);
    const A = device(base, clock, s => assert(placeDecor(s, 'bed', 0).ok));
    clock.advance(MIN);
    const B = device(base, clock, s => assert(placeDecor(s, 'ball', 0).ok));
    const { state: m } = mergeSaves(base, A, B);
    assertEq(m.decor.length, 1, 'one spot, one decor');
    const bag = Object.values(m.inventoryDecor).reduce((a, n) => a + n, 0);
    assertEq(bag, 1, 'the other one is in the bag');
  });
});

test('v26 level-up on both devices -> total XP adds, no double or lost level', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    base.player.xp = 10;
    const total = (lv, xp) => { let t = xp; for (let k = 1; k < lv; k++) t += xpForLevel(k); return t; };
    const A = device(base, clock, s => addPlayerXp(s, xpForLevel(s.player.level) + 20));          // one level + a bit
    clock.advance(MIN);
    const B = device(base, clock, s => addPlayerXp(s, xpForLevel(s.player.level) + xpForLevel(s.player.level + 1)));   // two levels
    assert(A.player.level === base.player.level + 1 && B.player.level === base.player.level + 2, 'setup levels');
    const { state: m } = mergeSaves(base, A, B);
    const expect = total(base.player.level, base.player.xp) + (total(A.player.level, A.player.xp) - total(base.player.level, base.player.xp))
      + (total(B.player.level, B.player.xp) - total(base.player.level, base.player.xp));
    assertEq(total(m.player.level, m.player.xp), expect, 'total xp = base + both deltas');
    assert(m.player.xp >= 0 && m.player.xp < xpForLevel(m.player.level), 'xp inside the level');
    assert(m.player.level >= B.player.level, 'level not lost');
  });
});

test('v26 sell the same items on both devices -> inventory never below 0, conflict reported, coins from both', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    base.inventory.crop_corn = 2;
    const A = device(base, clock, s => assert(sellItem(s, 'crop_corn', 2).ok));
    clock.advance(MIN);
    const B = device(base, clock, s => assert(sellItem(s, 'crop_corn', 2).ok));
    const { state: m, conflicts } = mergeSaves(base, A, B);
    assertEq(m.inventory.crop_corn || 0, 0, 'corn 0, not -2');
    assert(conflicts.some(c => c.includes('inventory.crop_corn')), 'clamp reported');
    assertEq(m.player.coins, base.player.coins + (A.player.coins - base.player.coins) + (B.player.coins - base.player.coins), 'coins from both sales (accepted limitation)');
    for (const n of Object.values(m.inventory)) assert(n > 0, 'no zero/negative entries');
  });
});

test('v26 buy on A + sell on B -> coins and items add up independently', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    const A = device(base, clock, s => assert(buyItem(s, 'food_kibble', 3).ok));
    clock.advance(MIN);
    const B = device(base, clock, s => assert(sellItem(s, 'crop_carrot', 2).ok));
    const { state: m } = mergeSaves(base, A, B);
    assertEq(m.inventory.food_kibble, base.inventory.food_kibble + 3);
    assertEq(m.inventory.crop_carrot, base.inventory.crop_carrot - 2);
    assertEq(m.player.coins, base.player.coins + (A.player.coins - base.player.coins) + (B.player.coins - base.player.coins));
    assertEq(m.stats.bought, base.stats.bought + 3);
    assertEq(m.stats.sold, base.stats.sold + 2);
  });
});

test('v26 orders: delivering different orders on both devices keeps both done', async () => {
  await withFakeNow(T0, async clock => {
    const prep = copy(await makeBase(clock));
    const ord = ensureOrders(prep, '2026-10-29');
    assert(ord && ord.list.length >= 2, 'orders');
    for (const o of ord.list.slice(0, 2)) for (const [id, n] of Object.entries(o.items || {})) addItem(prep, id, n);
    prep.updatedAt = clock.get();
    const base = migrate(prep);
    const [o1, o2] = base.orders.list;
    const A = device(base, clock, s => assert(completeOrder(s, o1.id).ok));
    clock.advance(MIN);
    const B = device(base, clock, s => assert(completeOrder(s, o2.id).ok));
    const { state: m } = mergeSaves(base, A, B);
    assert(m.orders.list.find(o => o.id === o1.id).done && m.orders.list.find(o => o.id === o2.id).done, 'both done');
    assertEq(m.stats.ordersDone, base.stats.ordersDone + 2);
  });
});

test('v26 merge(base, base, remote) deep-equals migrate(remote); merge(base, local, base) = local', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    clock.advance(MIN);
    const remote = device(base, clock, s => { assert(cook(s, 'dish_salad').ok); assert(feedPet(s, s.pets[0].id, 'food_kibble').ok); });
    assertEq(mergeSaves(base, base, remote).state, migrate(copy(remote)), 'base === local -> remote');
    assertEq(mergeSaves(base, remote, base).state, migrate(copy(remote)), 'base === remote -> local');
  });
});

test('v26 idempotent: merge(base, x, x) equals x', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    clock.advance(MIN);
    const x = device(base, clock, s => { assert(cook(s, 'dish_salad').ok); assert(buyItem(s, 'food_kibble', 2).ok); });
    assertEq(mergeSaves(base, x, x).state, migrate(copy(x)));
    // and merging the result again with either side does not change it (no double counting)
    const A = device(base, clock, s => assert(sellItem(s, 'crop_carrot', 1).ok));
    clock.advance(MIN);
    const B = device(base, clock, s => assert(buyItem(s, 'food_kibble', 1).ok));
    const m = mergeSaves(base, A, B).state;
    assertEq(mergeSaves(base, m, m).state, m, 'merge(b, m, m) = m');
    assertEq(mergeSaves(m, m, m).state, m, 'merge(m, m, m) = m');
  });
});

test('v26 inputs are never mutated; result shares no object with the inputs', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    const A = device(base, clock, s => assert(cook(s, 'dish_salad').ok));
    clock.advance(MIN);
    const B = device(base, clock, s => assert(feedPet(s, s.pets[0].id, 'food_kibble').ok));
    const snap = [copy(base), copy(A), copy(B)];
    const { state: m } = mergeSaves(base, A, B);
    assertEq([base, A, B], snap, 'inputs untouched');
    m.pets[0].xp += 999; m.inventory.crop_carrot = -5; m.plots[0].cropId = 'x';
    assertEq([base, A, B], snap, 'mutating the result does not touch the inputs');
  });
});

test('v26 pet removed on one device (rehomed), edited on the other -> the edit keeps the pet; untouched -> removed', async () => {
  await withFakeNow(T0, async clock => {
    const base = await makeBase(clock);
    const [p0, p1] = base.pets.map(p => p.id);
    const A = device(base, clock, s => { s.pets = s.pets.filter(p => p.id !== p0 && p.id !== p1); });
    clock.advance(MIN);
    const B = device(base, clock, s => assert(feedPet(s, p0, 'food_kibble').ok));
    const { state: m } = mergeSaves(base, A, B);
    assert(ids(m.pets).includes(p0), 'edited pet kept');
    assert(!ids(m.pets).includes(p1), 'untouched pet removed');
  });
});

test('v26 versions differ or non-object input -> throws (caller falls back to newer-wins)', () => {
  const s = createNewState();
  let threw = 0;
  try { mergeSaves(s, s, { ...copy(s), version: s.version + 1 }); } catch { threw++; }
  try { mergeSaves(null, s, s); } catch { threw++; }
  assertEq(threw, 2);
});

// ---- fuzz-ish: random action sequences on two copies, merged state must stay sane ----

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function randomActions(s, rand, clock, n) {
  const pick = a => a[Math.floor(rand() * a.length)];
  for (let i = 0; i < n; i++) {
    clock.advance(30 * 1000);
    const kind = pick(['cook', 'feed', 'play', 'sell', 'buy', 'hatch', 'plant', 'harvest', 'xp', 'build', 'remove']);
    try {
      if (kind === 'cook') cook(s, 'dish_salad');
      else if (kind === 'feed' && s.pets.length) feedPet(s, pick(s.pets).id, 'food_kibble');
      else if (kind === 'play' && s.pets.length) playWithPet(s, pick(s.pets).id);
      else if (kind === 'sell') sellItem(s, pick(['crop_carrot', 'crop_corn', 'food_kibble']), 1 + Math.floor(rand() * 3));
      else if (kind === 'buy') buyItem(s, 'food_kibble', 1 + Math.floor(rand() * 2));
      else if (kind === 'hatch') {
        if (putEggInIncubator(s, 'egg_farm').ok) { clock.advance(MIN); hatchReady(s, s.incubator.length - 1); }
      } else if (kind === 'plant') { const i = Math.floor(rand() * s.plots.length); plantSeed(s, i, 'carrot'); if (s.plots[i].cropId && rand() < 0.7) s.plots[i].progress = 1; }
      else if (kind === 'harvest') harvestPlot(s, Math.floor(rand() * s.plots.length));
      else if (kind === 'xp') addPlayerXp(s, Math.floor(rand() * 200));
      else if (kind === 'build') { addItem(s, 'forage_wood', 6); addItem(s, 'forage_herb', 6); addItem(s, 'forage_feather', 3); const r = buildDecor(s, pick(['bed', 'ball'])); if (r.ok) placeDecor(s, s.inventoryDecor.bed ? 'bed' : 'ball', Math.floor(rand() * 4)); }
      else if (kind === 'remove' && s.decor.length) removeDecor(s, pick(s.decor).id);
    } catch (e) { /* an action refusing is fine; a throw from the game code is not this test's business */ }
  }
}

function findBad(o, path = 'state') {
  if (typeof o === 'number') return Number.isFinite(o) ? null : path;
  if (o === undefined) return path;
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { const b = findBad(v, `${path}.${k}`); if (b) return b; }
  return null;
}

test('v26 fuzz: random action sequences on two devices merge into a sane save (seeded)', async () => {
  for (const seed of [1, 7, 42, 1234, 99999, 2026]) {
    await withFakeNow(T0, async clock => {
      const rand = rng(seed);
      const base = await makeBase(clock);
      clock.advance(MIN);
      const A = copy(base); randomActions(A, rand, clock, 25); A.updatedAt = clock.get();
      clock.advance(MIN);
      const B = copy(base); randomActions(B, rand, clock, 25); B.updatedAt = clock.get();
      const a = migrate(copy(A)), b = migrate(copy(B));
      const { state: m } = mergeSaves(base, a, b);
      const tag = `seed ${seed}`;
      assertEq(findBad(m), null, `${tag}: no NaN/undefined`);
      assert(noDup(ids(m.pets)), `${tag}: pet ids unique`);
      assert(noDup(m.nursery.map(e => e.pet.id)) && !m.nursery.some(e => ids(m.pets).includes(e.pet.id)), `${tag}: nursery ids unique and not in the yard`);
      assert(m.player.coins >= 0 && m.player.xp >= 0 && m.player.level >= 1, `${tag}: player`);
      for (const [k, n] of Object.entries(m.inventory)) assert(n > 0, `${tag}: inventory ${k}`);
      for (const [k, n] of Object.entries(m.stats)) assert(n >= 0, `${tag}: stat ${k}`);
      assert(noDup(m.decor.map(d => d.spot)) && noDup(m.decor.map(d => d.id)), `${tag}: decor spots/ids unique`);
      assert(m.stats.hatched >= Math.max(a.stats.hatched, b.stats.hatched), `${tag}: hatch counter`);
      // every pet either device had (and the other did not delete) is still there
      for (const p of [...a.pets, ...b.pets]) assert(ids(m.pets).includes(p.id) || m.nursery.some(e => e.pet.id === p.id), `${tag}: pet ${p.id} kept`);
      // the result is stable: migrating it again changes nothing, and merging it with itself is a no-op
      assertEq(migrate(copy(m)), m, `${tag}: migrate(m) = m`);
      assertEq(mergeSaves(base, m, m).state, m, `${tag}: idempotent`);
    });
  }
});

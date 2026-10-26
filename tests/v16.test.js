// V16 tests (CONTRACT_V16): kitchen recipes, cooking, dish feeding (treat look + favourite dish), sanitising, economy rules.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { createNewState, migrate, addItem, countItem } from '../js/state.js';
import { RECIPES, getRecipe, favoriteDish, TREAT_MS } from '../js/data/recipes.js';
import { getItem, ITEMS } from '../js/data/items.js';
import { SPECIES, getSpecies } from '../js/data/species.js';
import { cook, recipeStatus, kitchenList } from '../js/kitchen.js';
import { feedPet, bondProgress } from '../js/pets.js';
import { limitedPet } from '../js/mail.js';
import { buyItem, sellItem } from '../js/farm.js';

const T0 = new Date(2026, 9, 26, 10, 0, 0).getTime();
const HOUR = 3600 * 1000;

function withPet(s, speciesId) {
  const p = limitedPet('celestial', T0);
  Object.assign(p, { id: 'p_' + speciesId, speciesId, stage: 2, xp: 200, nickname: 'น้อง' + speciesId });
  delete p.limited;
  p.stats.hunger = 20;
  s.pets.push(p);
  return p;
}

test('v16 recipes: 9 dishes, every ingredient and dish is a real item, dishes are type dish and can be neither bought nor sold', () => {
  assertEq(RECIPES.length, 9, 'count');
  for (const r of RECIPES) {
    const it = getItem(r.id);
    assert(it && it.type === 'dish' && it.buy === null && it.sell === null && it.food, r.id + ' item');
    for (const id of Object.keys(r.ingredients)) assert(getItem(id), `${r.id}: unknown ingredient ${id}`);
    assert(r.food.hunger > 0 && r.food.happy > 0 && r.food.tags.length, r.id + ' food');
  }
});

test('v16 econ rule: a dish never fills a pet cheaper than the shop (hunger <= 2 x the ingredients\' sell value), no dish in any shop list', () => {
  for (const r of RECIPES) {
    const value = Object.entries(r.ingredients).reduce((sum, [id, n]) => sum + (getItem(id).sell || 0) * n, 0);
    assert(r.food.hunger <= 2 * value, `${r.id}: hunger ${r.food.hunger} > 2 x ${value}`);
    assert(r.food.happy <= getItem('food_milk').food.happy, `${r.id}: happy ${r.food.happy} > plain food (happy >= 70 pays full-rate yard gifts)`);
  }
  assert(!Object.values(ITEMS).some(it => it.type === 'dish' && it.buy != null), 'not buyable');
  withFakeNow(T0, () => {
    const s = createNewState();
    addItem(s, 'dish_salad', 1);
    assert(!sellItem(s, 'dish_salad', 1).ok, 'cannot sell');
    assert(!buyItem(s, 'dish_salad', 1).ok, 'cannot buy');
  });
});

test('v16 cook: level gate, missing ingredients refused (nothing taken), success takes exactly the ingredients and gives one dish', () => withFakeNow(T0, () => {
  const s = createNewState();
  s.inventory = {};
  assert(!cook(s, 'dish_salad').ok, 'no ingredients');
  addItem(s, 'crop_carrot', 2);
  const r0 = cook(s, 'dish_salad');
  assert(!r0.ok && countItem(s, 'crop_carrot') === 2, 'partial set refused, nothing taken');
  addItem(s, 'crop_corn', 1);
  assert(recipeStatus(s, getRecipe('dish_salad')).ok, 'status ok');
  const r = cook(s, 'dish_salad');
  assert(r.ok, r.reason);
  assertEq([countItem(s, 'crop_carrot'), countItem(s, 'crop_corn'), countItem(s, 'dish_salad')], [0, 0, 1], 'inventory');
  assertEq(s.stats.cooked, 1, 'stat');
  addItem(s, 'crop_pumpkin', 1); addItem(s, 'food_milk', 1);
  assert(!cook(s, 'dish_pie').ok, 'Lv.6 recipe locked at Lv.1');
  assert(kitchenList(s).find(x => x.recipe.id === 'dish_pie').locked, 'list shows it locked');
  assert(!cook(s, 'nope').ok, 'unknown recipe');
}));

test('v16 feed a dish: same bond as normal food, the 😋 treat lasts TREAT_MS, favourite dish discovered once with a diary line', () => withFakeNow(T0, () => {
  const s = createNewState();
  const dog = withPet(s, 'dog');
  const fav = favoriteDish(getSpecies('dog'));
  assert(fav, 'dog has a favourite dish');
  const other = RECIPES.find(r => r.id !== fav.id);
  addItem(s, other.id, 1);
  const b0 = dog.bond;
  const r1 = feedPet(s, dog.id, other.id);
  assert(r1.ok && r1.dish === other.id && !r1.favDish, r1.reason);
  assertEq(dog.bond - b0, 2, 'bond like any food');
  assertEq(dog.treat, { id: other.id, until: T0 + TREAT_MS }, 'treat');
  assert(!dog.favDishKnown, 'not the favourite');
  dog.stats.hunger = 10;
  addItem(s, fav.id, 2);
  const r2 = feedPet(s, dog.id, fav.id);
  assert(r2.ok && r2.favDish, 'favourite');
  assert(dog.favDishKnown, 'discovered');
  const lines = s.journal.flatMap(d => d.lines).filter(l => l.text.includes(fav.nameTh));
  assertEq(lines.length, 1, 'one diary line');
  dog.stats.hunger = 10;
  feedPet(s, dog.id, fav.id);
  assertEq(s.journal.flatMap(d => d.lines).filter(l => l.text.includes(fav.nameTh)).length, 1, 'no second diary line');
}));

test('v16 favourite dish: every species with a diet gets one, deterministic', () => {
  for (const sp of SPECIES) {
    const a = favoriteDish(sp), b = favoriteDish(sp);
    assert(a && a === b, sp.id + ' favourite dish');
    assert(a.food.tags.some(t => sp.diet.includes(t)), `${sp.id}: ${a.id} matches its diet`);
  }
});

test('v16 sanitise: unknown dish / bad until dropped, until capped to one treat from now, favDishKnown boolean; normal food sets no treat', () => withFakeNow(T0, () => {
  const raw = JSON.parse(JSON.stringify(createNewState()));
  raw.pets = [
    { id: 'a', speciesId: 'cat', treat: { id: 'dish_salad', until: T0 + 99 * HOUR }, favDishKnown: 'yes' },
    { id: 'b', speciesId: 'cat', treat: { id: 'nope', until: T0 } },
    { id: 'c', speciesId: 'cat', treat: { id: 'dish_salad', until: 'x' } },
    { id: 'd', speciesId: 'cat' },
  ];
  const s = migrate(raw);
  assertEq(s.pets[0].treat, { id: 'dish_salad', until: T0 + TREAT_MS }, 'capped');
  assertEq(s.pets[0].favDishKnown, false, 'boolean');
  assertEq([s.pets[1].treat, s.pets[2].treat, s.pets[3].treat], [null, null, null], 'dropped / default');
  const t = createNewState();
  const cat = withPet(t, 'cat');
  addItem(t, 'food_kibble', 1);
  feedPet(t, cat.id, 'food_kibble');
  assert(!cat.treat, 'normal food: no treat');
}));

test('v16 review fix: a pet\'s daily gift never contains a dish (dishes only come from the kitchen)', async () => {
  const { claimGift, BOND_THRESHOLDS } = await import('../js/pets.js');
  await withFakeNow(T0, clock => {
    for (const id of ['dog', 'rabbit', 'bear', 'unicorn', 'cat']) {
      if (!getSpecies(id)) continue;
      for (let day = 0; day < 15; day++) {
        const s = createNewState();
        s.inventory = {};
        const p = withPet(s, id);
        p.bond = BOND_THRESHOLDS[4];
        clock.set(T0 + day * 24 * HOUR);
        const r = claimGift(s, p.id);
        assert(r.ok, r.reason);
        assert(!Object.keys(s.inventory).some(k => getItem(k).type === 'dish'), `${id} day ${day}: gifted a dish`);
      }
    }
  });
});

// V24 tests (CONTRACT_V24): landmark spots (mailbox / board / bench) and the bowl feeding plan.
import { test, assert, assertEq, freshState } from './harness.js';
import {
  pickTarget, makeRng, configureYard, YARD, YARD_TIER_LAYOUT, yardProps, kitchenSpot, nestSpot, cribSpot, landmarkSpots,
  greetSpots, puddleSpots, shelterSpots, partySpot,
} from '../js/petBehaviour.js';
import * as engine from '../js/world3d/engine.js';
import { feedPet, bowlFeedPlan } from '../js/pets.js';
import { addItem, countItem } from '../js/state.js';
import { ITEMS } from '../js/data/items.js';

const TIERS = ['S', 'M', 'L', 'XL'];
const PERSONALITIES = ['hardworking', 'lazy', 'glutton', 'cheerful', 'shy', 'naughty'];
const NAMES = ['mailbox', 'board', 'bench'];

function withYard(fn) {
  const saved = JSON.stringify(YARD);
  try { return fn(); } finally { Object.assign(YARD, JSON.parse(saved)); }
}

const BARN = { hw: 1.4, hd: 1.15 };
const barnGap = (barnZ, c) => Math.hypot(Math.max(0, Math.abs(c.x) - BARN.hw), Math.max(0, Math.abs(c.z - barnZ) - BARN.hd)) - c.r;
const minFence = (cfg, x, z, r) => {
  const th = Math.atan2(x, z), span = Math.min(1.2, r / Math.max(1, Math.hypot(x, z)) + 0.15);
  let m = Infinity;
  for (let i = -6; i <= 6; i++) m = Math.min(m, engine.fenceRadiusAt(cfg, th + (i / 6) * span));
  return m;
};
const edge = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r;

// ---------------------------------------------------------------- landmarks

for (const t of TIERS) {
  test(`v24 landmarks ${t}: inside walk + fence, off the central lawn, clear of props / kitchen / decor / bowl / nests / cribs / barn / each other`, () => withYard(() => {
    configureYard(t);
    const lm = landmarkSpots(t), cfg = engine.YARD_TIERS[t], lay = YARD_TIER_LAYOUT[t];
    assertEq(Object.keys(lm).sort(), [...NAMES].sort());
    const props = yardProps(t).map(p => ({ id: p.id, x: p.x, z: p.z, r: p.r, lantern: p.kind === 'lantern' }));
    const k = kitchenSpot(t);
    const solids = [...props, { id: 'kitchen', x: k.x, z: k.z, r: k.r }];
    const spots = engine.decorSpotsForTier(t).map(s => ({ id: `spot${s.index}`, x: s.x, z: s.z, r: 0 }));
    const others = [
      ...[0, 1, 2].map(i => ({ id: `nest${i}`, ...nestSpot(i, 3), r: 0.4 })),
      ...[0, 1, 2].map(i => ({ id: `crib${i}`, ...cribSpot(i, 3), r: 0.5 })),
      { id: 'bowl', x: YARD.bowl.x, z: YARD.bowl.z, r: 0.4 },
    ];
    for (const n of NAMES) {
      const l = { id: n, ...lm[n] };
      assert(l.r > 0 && Number.isFinite(l.x) && Number.isFinite(l.z), `${t}/${n} numbers`);
      assert(Math.abs(l.x) <= 3.6 && l.z <= 4.6, `${t}/${n} outside the default view box (${l.x}, ${l.z})`);
      assert(Math.hypot(l.x, l.z) <= lay.walk, `${t}/${n} outside walk`);
      assert(Math.hypot(l.x, l.z) + l.r <= minFence(cfg, l.x, l.z, l.r) - 0.1, `${t}/${n} sticks out of the fence`);
      assert(Math.hypot(l.x, l.z) - l.r >= 0.4 * lay.walk, `${t}/${n} in the central lawn`);
      for (const o of solids) assert(edge(l, o) >= (o.lantern ? 0.4 : 0.7), `${t}/${n} vs ${o.id} (${edge(l, o).toFixed(2)})`);
      for (const o of others) assert(edge(l, o) >= 0.6, `${t}/${n} vs ${o.id} (${edge(l, o).toFixed(2)})`);
      assert(barnGap(lay.barnZ, l) >= 0.4, `${t}/${n} touches the barn`);
      for (const s of spots) assert(Math.hypot(l.x - s.x, l.z - s.z) - l.r >= 0.7 - 1e-9, `${t}/${n} vs ${s.id}`);
      for (const m of NAMES) if (m !== n) assert(edge(l, { id: m, ...lm[m] }) >= 0.7, `${t}/${n} vs ${m}`);
      assert(YARD.obstacles.some(o => o.x === l.x && o.z === l.z && o.r === l.r), `${t}/${n} is an obstacle`);
    }
    assertEq(YARD.landmarks, lm, `${t} YARD.landmarks`);
  }));
}

test('v24 landmarks: pure copies (mutating the result changes nothing)', () => {
  const a = landmarkSpots('XL'); a.bench.x = 99;
  assert(landmarkSpots('XL').bench.x !== 99);
});

test('v24 wander targets and special spots never fall inside a landmark', () => withYard(() => {
  for (const t of TIERS) {
    configureYard(t);
    const lm = Object.values(landmarkSpots(t));
    const rng = makeRng(31337);
    for (let i = 0; i < 1500; i++) {
      const tg = pickTarget(rng, 0, 0.5, [], i % 5 === 0, PERSONALITIES[i % 6]);
      for (const l of lm) assert(Math.hypot(tg.x - l.x, tg.z - l.z) >= l.r + 0.6 - 1e-6, `${t}: wander target on a landmark`);
    }
    const spots = [];
    for (const n of [2, 4, 6]) spots.push(...greetSpots(n));
    for (const seed of ['a', 'b', 'c', 'rain:1', 'rain:2']) spots.push(...puddleSpots(seed, 4));
    spots.push(...shelterSpots(yardProps(t)));
    for (let i = -1; i < 8; i++) spots.push(partySpot(i, 8, 0, 3.0));
    for (const p of spots) for (const l of lm) assert(Math.hypot(p.x - l.x, p.z - l.z) >= l.r, `${t}: special spot (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) inside a landmark`);
  }
}));

// ---------------------------------------------------------------- bowlFeedPlan

const FOOD = Object.values(ITEMS).find(i => i.food && i.type !== 'dish') || Object.values(ITEMS).find(i => i.food);
const pet = (id, hunger, extra = {}) => ({ id, speciesId: 'hamster', nickname: id, personality: 'cheerful', status: 'idle', stats: { hunger, happy: 50, energy: 80, clean: 80 }, level: 1, xp: 0, bond: 0, ...extra });

function setup(pets, n = 10) {
  const s = freshState();
  s.player.level = 99;
  s.pets.length = 0;
  s.pets.push(...pets);
  addItem(s, FOOD.id, n);
  return s;
}

test('v24 bowlFeedPlan: hungriest first, hunger < 70 only, default cap 4', () => {
  const s = setup([pet('a', 50), pet('b', 10), pet('c', 69), pet('d', 70), pet('e', 30), pet('f', 20), pet('g', 90)]);
  assertEq(bowlFeedPlan(s, FOOD.id), ['b', 'f', 'e', 'a']);
  assertEq(bowlFeedPlan(s, FOOD.id, 2), ['b', 'f']);
  assertEq(bowlFeedPlan(s, FOOD.id, 10), ['b', 'f', 'e', 'a', 'c']);
  assertEq(bowlFeedPlan(s, FOOD.id, 0), []);
});

test('v24 bowlFeedPlan: skips sleeping, nursery, away and full pets', () => {
  const s = setup([pet('a', 5, { status: 'sleeping' }), pet('b', 6, { status: 'expedition' }), pet('c', 7, { status: 'working' }), pet('d', 80), pet('e', 40)]);
  s.nursery = [{ pet: pet('n', 1, { status: 'nursery' }), hatchedAt: 0 }];
  assertEq(bowlFeedPlan(s, FOOD.id), ['e']);
});

test('v24 bowlFeedPlan: capped by the item count; none, unknown or non-food item -> []', () => {
  const s = setup([pet('a', 10), pet('b', 20), pet('c', 30)], 2);
  assertEq(bowlFeedPlan(s, FOOD.id), ['a', 'b']);
  assertEq(bowlFeedPlan(s, 'no_such_item'), []);
  const nonFood = Object.values(ITEMS).find(i => !i.food);
  if (nonFood) { addItem(s, nonFood.id, 3); assertEq(bowlFeedPlan(s, nonFood.id), []); }
  const empty = freshState(); empty.pets.push(pet('a', 10));
  assertEq(bowlFeedPlan(empty, FOOD.id), []);
});

test('v24 bowlFeedPlan: feeding the plan with feedPet uses exactly plan.length items', () => {
  const s = setup([pet('a', 10), pet('b', 20), pet('c', 30), pet('d', 40), pet('e', 50)], 3);
  const before = countItem(s, FOOD.id);
  const plan = bowlFeedPlan(s, FOOD.id);
  assertEq(plan.length, 3);
  for (const id of plan) assert(feedPet(s, id, FOOD.id).ok, `feed ${id}`);
  assertEq(before - countItem(s, FOOD.id), plan.length);
  assertEq(bowlFeedPlan(s, FOOD.id), []);
});

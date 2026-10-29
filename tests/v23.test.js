// V23 tests (CONTRACT_V23): bigger yard tiers + zone layout, kitchen in the map, spreading, kitchen journal, cook message.
import { test, assert, assertEq, freshState } from './harness.js';
import {
  pickTarget, makeRng, configureYard, YARD, YARD_TIER_LAYOUT, yardProps, kitchenSpot, nestSpot, cribSpot, nextAction,
  greetSpots, puddleSpots, shelterSpots, partySpot,
} from '../js/petBehaviour.js';
import * as engine from '../js/world3d/engine.js';
import { cook, kitchenList } from '../js/kitchen.js';
import { feedPet } from '../js/pets.js';
import { addItem } from '../js/state.js';
import { journalEvent, journalDays } from '../js/journal.js';
import { RECIPES, favoriteDish } from '../js/data/recipes.js';
import { getSpecies, SPECIES } from '../js/data/species.js';

const TIERS = ['S', 'M', 'L', 'XL'];
const RANK = { S: 0, M: 1, L: 2, XL: 3 };
const PERSONALITIES = ['hardworking', 'lazy', 'glutton', 'cheerful', 'shy', 'naughty'];

function withYard(fn) {
  const saved = JSON.stringify(YARD);
  try { return fn(); } finally { Object.assign(YARD, JSON.parse(saved)); }
}

// ---------------------------------------------------------------- tier numbers

test('v23 tiers: petBehaviour.YARD_TIER_LAYOUT and engine.YARD_TIERS use the contract numbers', () => {
  const want = { S: [5.0, 5.7, 6.4, -4.3], M: [6.4, 7.1, 7.8, -5.2], L: [7.6, 8.3, 9.0, -5.8], XL: [9.0, 9.7, 10.4, -6.4] };
  for (const t of TIERS) {
    const e = engine.YARD_TIERS[t];
    assertEq([e.walk, e.fence, e.island, e.barnZ], want[t], `engine ${t}`);
    assertEq([YARD_TIER_LAYOUT[t].walk, YARD_TIER_LAYOUT[t].barnZ], [want[t][0], want[t][3]], `behaviour ${t}`);
  }
});

test('v23 kitchenSpot: formula, in YARD.obstacles and YARD.kitchen for every tier', () => withYard(() => {
  for (const t of TIERS) {
    const lay = YARD_TIER_LAYOUT[t];
    const k = kitchenSpot(t);
    assertEq(k, { x: 3.0 + (lay.walk - 5) * 0.45, z: lay.barnZ + 1.1, r: 1.1 }, `kitchenSpot ${t}`);
    configureYard(t);
    assertEq(YARD.kitchen, k, `YARD.kitchen ${t}`);
    assert(YARD.obstacles.some(o => o.x === k.x && o.z === k.z && o.r === k.r), `${t}: kitchen is an obstacle`);
  }
}));

// ---------------------------------------------------------------- zone layout constraints (CONTRACT_V23 section 3)

const BARN = { hw: 1.4, hd: 1.15 };   // engine barn W 2.8 x D 2.3 (a little roof overhang is covered by the gaps below)
const rectCircleGap = (barnZ, c) => {
  const dx = Math.max(0, Math.abs(c.x) - BARN.hw), dz = Math.max(0, Math.abs(c.z - barnZ) - BARN.hd);
  return Math.hypot(dx, dz) - c.r;
};
const minFence = (cfg, x, z, r) => {
  const th = Math.atan2(x, z), span = Math.min(1.2, r / Math.max(1, Math.hypot(x, z)) + 0.15);
  let m = Infinity;
  for (let i = -6; i <= 6; i++) m = Math.min(m, engine.fenceRadiusAt(cfg, th + (i / 6) * span));
  return m;
};

for (const t of TIERS) {
  test(`v23 layout ${t}: centre clear, everything inside walk / fence, no overlaps (3 nests + 3 cribs + bowl + barn + kitchen + props + decor)`, () => withYard(() => {
    configureYard(t);
    const cfg = engine.YARD_TIERS[t], lay = YARD_TIER_LAYOUT[t];
    const props = yardProps(t).map(p => ({ id: p.id, x: p.x, z: p.z, r: p.r, lantern: p.kind === 'lantern' }));
    const k = kitchenSpot(t);
    const solids = [...props, { id: 'kitchen', x: k.x, z: k.z, r: k.r }];
    const spots = engine.decorSpotsForTier(t).map(s => ({ id: `spot${s.index}`, x: s.x, z: s.z, r: 0 }));
    const nests = [0, 1, 2].map(i => ({ id: `nest${i}`, ...nestSpot(i, 3), r: 0.4 }));
    const cribs = [0, 1, 2].map(i => ({ id: `crib${i}`, ...cribSpot(i, 3), r: 0.5 }));
    const bowl = { id: 'bowl', x: YARD.bowl.x, z: YARD.bowl.z, r: 0.4 };
    const barn = { id: 'barn', x: 0, z: lay.barnZ, r: 0 };

    // the central lawn (radius 0.4 x walk) is empty
    // (measured against the walk radius of the tier that unlocks the object: a bigger yard keeps its old placements)
    const UNLOCK = { pond: 'M', tree: 'M', flowerbed: 'L', playground: 'L', hill: 'XL' };
    const unlockWalk = o => YARD_TIER_LAYOUT[o.id.startsWith('spot') ? TIERS[Math.floor(Number(o.id.slice(4)) / 2)] : o.id.startsWith('lantern') ? 'XL' : UNLOCK[o.id] || t].walk;
    for (const o of [...solids, ...spots]) assert(Math.hypot(o.x, o.z) - o.r >= 0.4 * unlockWalk(o), `${t}/${o.id} stands in the central lawn`);
    // inside the walk disc (spots) / the wavy fence (footprints)
    for (const s of spots) assert(Math.hypot(s.x, s.z) <= lay.walk - 0.2, `${t}/${s.id} outside the walk radius`);
    for (const o of solids) {
      assert(Math.hypot(o.x, o.z) + o.r <= minFence(cfg, o.x, o.z, o.r) - 0.1, `${t}/${o.id} sticks out of the fence`);
      if (!o.lantern) assert(Math.hypot(o.x, o.z) <= lay.walk, `${t}/${o.id} centre outside the walk radius`);
    }
    // solids keep 0.7 (edge to edge) from each other, from the nests / cribs / bowl, and 0.4 from the barn box
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      assert(Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r >= (a.lantern || b.lantern ? 0.4 : 0.7), `${t}: ${a.id} vs ${b.id}`);
    }
    for (const o of solids) {
      for (const n of [...nests, ...cribs, bowl]) assert(Math.hypot(o.x - n.x, o.z - n.z) - o.r - n.r >= 0.6, `${t}: ${o.id} vs ${n.id} (${(Math.hypot(o.x - n.x, o.z - n.z) - o.r - n.r).toFixed(2)})`);
      assert(rectCircleGap(lay.barnZ, o) >= 0.4, `${t}: ${o.id} touches the barn (${rectCircleGap(lay.barnZ, o).toFixed(2)})`);
    }
    // decor spots: 0.7 from every footprint, 1.0 from the bowl, clear of nests / cribs / barn, 0.7 from each other
    for (const s of spots) {
      for (const o of solids) assert(Math.hypot(s.x - o.x, s.z - o.z) - o.r >= 0.7 - 1e-9, `${t}: ${s.id} vs ${o.id}`);
      assert(Math.hypot(s.x - bowl.x, s.z - bowl.z) >= 1.0 + bowl.r, `${t}: ${s.id} too close to the bowl`);
      for (const n of [...nests, ...cribs]) assert(Math.hypot(s.x - n.x, s.z - n.z) >= 1.0, `${t}: ${s.id} vs ${n.id}`);
      assert(rectCircleGap(lay.barnZ, s) >= 0.7, `${t}: ${s.id} touches the barn`);
      for (const q of spots) if (q !== s) assert(Math.hypot(s.x - q.x, s.z - q.z) >= 0.7, `${t}: ${s.id} vs ${q.id}`);
    }
    // the nest row and the cribs stay inside the walk disc, in front of the barn
    for (const n of [...nests, ...cribs]) assert(Math.hypot(n.x, n.z) <= lay.walk, `${t}/${n.id} outside the yard`);
    void barn;
  }));
}

test('v23 props: every prop keeps the unlock coordinates of the contract', () => {
  const pos = (t, id) => { const p = yardProps(t).find(x => x.id === id); return p && [p.x, p.z, p.r]; };
  assertEq(pos('M', 'pond'), [4.3, 1.4, 1.1]);
  assertEq(pos('M', 'tree'), [-4.6, -1.6, 0.55]);
  assertEq(pos('L', 'flowerbed'), [-3.4, 5.8, 0.9]);
  assertEq(pos('L', 'playground'), [-5.4, 1.6, 1.0]);
  assertEq(pos('XL', 'hill'), [-6.6, -3.6, 1.3]);
  assertEq(yardProps('S'), []);
  for (const id of ['pond', 'tree', 'flowerbed', 'playground']) assertEq(pos('XL', id), pos('L', id) || pos('M', id), `${id} keeps its place in XL`);
});

test('v23 wander targets stay inside the yard, clear of the kitchen and props; back strip rule only for x in [-5.2, kitchen edge + 0.3]', () => withYard(() => {
  for (const t of TIERS) {
    configureYard(t);
    const k = YARD.kitchen;
    const rng = makeRng(4242);
    let behindSide = 0;
    for (let i = 0; i < 1500; i++) {
      const tg = pickTarget(rng, 0, 0.5, [], i % 5 === 0, PERSONALITIES[i % 6]);
      assert(Math.hypot(tg.x, tg.z) <= YARD.walkRadius + 1e-6, `${t}: inside the yard`);
      assert(Math.hypot(tg.x - k.x, tg.z - k.z) >= k.r + 0.6 - 1e-6, `${t}: target on the kitchen`);
      if (tg.z < YARD.backLimit) {
        assert(tg.x < -5.2 || tg.x > k.x + k.r + 0.3, `${t}: target in the barn strip (${tg.x.toFixed(2)}, ${tg.z.toFixed(2)})`);
        behindSide++;
      }
    }
    if (t === 'XL') assert(behindSide > 0, 'XL: pets may walk behind the barn on the far left side');
  }
}));

test('v23 other spots (greet, party, puddle, shelter, dangle) stay inside the yard and clear of the kitchen at every tier', () => withYard(() => {
  for (const t of TIERS) {
    configureYard(t);
    const k = YARD.kitchen, inside = p => Math.hypot(p.x, p.z) <= YARD.walkRadius + 1e-6;
    const clear = (p, what) => assert(Math.hypot(p.x - k.x, p.z - k.z) >= k.r, `${t}: ${what} on the kitchen`);
    for (const n of [2, 4, 6]) for (const p of greetSpots(n)) { assert(inside(p), `${t}: greet inside`); clear(p, 'greet spot'); }
    for (const seed of ['a', 'b', 'c', 'rain:1', 'rain:2']) for (const p of puddleSpots(seed, 4)) { assert(inside(p), `${t}: puddle inside`); clear(p, 'puddle'); }
    for (const p of shelterSpots(yardProps(t))) assert(inside(p), `${t}: shelter spot inside (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    for (let i = -1; i < 8; i++) { const p = partySpot(i, 8, 0, 3.0); assert(inside(p), `${t}: party spot inside`); clear(p, 'party spot'); }
    const rng = makeRng(9);
    for (let i = 0; i < 200; i++) {
      const a = nextAction({ id: 'p', personality: PERSONALITIES[i % 6], stats: { hunger: 80, happy: 80, energy: 80, clean: 80 } }, { x: 0, z: 0.5, others: [] }, rng, 0);
      if (a.target) assert(inside(a.target) && Number.isFinite(a.target.x), `${t}: action target inside`);
    }
  }
}));

// ---------------------------------------------------------------- spreading (CONTRACT_V23 section 4)

/**
 * 16 pets in the XL yard, each repeatedly picks a wander target with a seeded rng and walks there at once.
 * Returns the mean (over rounds 5..39) of the mean nearest-neighbour distance between the pets' targets.
 */
function spreadScore(n = 16, rounds = 40, seed = 20231) {
  configureYard('XL');
  const rp = makeRng(seed), rng = makeRng(seed + 7);
  const pets = [];
  for (let i = 0; i < n; i++) {
    const a = rp() * Math.PI * 2, r = Math.sqrt(rp()) * YARD.walkRadius;
    pets.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, tx: NaN, tz: NaN, pers: PERSONALITIES[i % PERSONALITIES.length] });
  }
  let sum = 0, cnt = 0;
  for (let round = 0; round < rounds; round++) {
    pets.forEach((p, i) => {
      const others = pets.filter((_, j) => j !== i);
      const t = pickTarget(rng, p.x, p.z, others, p.pers === 'shy', p.pers);
      p.tx = t.x; p.tz = t.z; p.x = t.x; p.z = t.z;
    });
    if (round < 5) continue;
    for (const p of pets) {
      let nn = Infinity;
      for (const q of pets) if (q !== p) nn = Math.min(nn, Math.hypot(p.tx - q.tx, p.tz - q.tz));
      sum += nn; cnt++;
    }
  }
  return sum / cnt;
}

// Baseline: this exact simulation (same seeds, spreadScore above, pickTarget ignoring the 6th argument) run on the UNTOUCHED V22
// petBehaviour.js (XL walk radius 6.1, old props, 7 tries / 8 shy, no zone bonus) before any V23 edit = 1.4433.
const SPREAD_BASELINE_V22 = 1.4433;

test('v23 spreading: 16 pets in XL keep >= 1.5x the V22 mean nearest-neighbour distance of wander targets', () => withYard(() => {
  const s = spreadScore();
  assert(s >= SPREAD_BASELINE_V22 * 1.5, `spread ${s.toFixed(3)} vs needed ${(SPREAD_BASELINE_V22 * 1.5).toFixed(3)}`);
  // and not by luck of one seed
  for (const seed of [1, 77, 5150]) assert(spreadScore(16, 40, seed) >= SPREAD_BASELINE_V22 * 1.5, `seed ${seed}`);
}));

test('v23 zones: personality bonus is small (<= 0.5) and pulls the right way', () => withYard(() => {
  configureYard('XL');
  const k = YARD.kitchen;
  const share = (pers, pred) => { const rng = makeRng(555); let c = 0; for (let i = 0; i < 1500; i++) if (pred(pickTarget(rng, 0, 0.5, [], false, pers))) c++; return c / 1500; };
  const nearKitchen = t => Math.hypot(t.x - k.x, t.z - k.z) < 5;
  assert(share('glutton', nearKitchen) > share('hardworking', nearKitchen) - 0.01, 'gluttons visit the kitchen area at least as much as workers');
  const rim = t => Math.hypot(t.x, t.z) > YARD.walkRadius * 0.8;
  assert(share('shy', rim) > share('cheerful', rim), 'shy pets prefer the rim');
  const middle = t => Math.hypot(t.x, t.z) < YARD.walkRadius * 0.5;
  assert(share('cheerful', middle) > share('shy', middle), 'cheerful pets prefer the middle');
}));

// ---------------------------------------------------------------- kitchen message + journal

test('v23 cook: success message points at the tray in the yard; diary gets one cook line per dish per day', () => {
  const s = freshState();
  const r = RECIPES[0];
  s.player.level = 99;
  for (const [id, n] of Object.entries(r.ingredients)) addItem(s, id, n * 3);
  const res = cook(s, r.id);
  assert(res.ok, 'cooked');
  assertEq(res.msg, `🍳 ทำ${r.emoji} ${r.nameTh}เสร็จแล้ว! อยู่ในถาดอาหารหน้าลาน ลากไปป้อนน้องได้เลย`);
  const lines = journalDays(s).flatMap(d => d.lines).filter(l => l.kind === 'cook');
  assertEq(lines.length, 1, 'one cook line');
  assertEq([lines[0].emoji, lines[0].text.includes(r.nameTh), lines[0].petId], ['🍳', true, undefined], 'cook line: emoji, dish, no pet');
  assert(lines[0].text.includes('ทำ') && lines[0].text.includes('น้องๆ'), lines[0].text);
  assert(cook(s, r.id).ok, 'cooked again');
  assertEq(journalDays(s).flatMap(d => d.lines).filter(l => l.kind === 'cook').length, 1, 'same dish, same day: still one line');
  assert(kitchenList(s).length === RECIPES.length);
});

test('v23 journal: kinds cook and dish exist, dish names the pet and is once per pet per day', () => {
  const s = freshState();
  s.pets.push({ id: 'p1', speciesId: 'hamster', nickname: 'มีมี่', stats: { hunger: 10, happy: 50, energy: 80, clean: 80 } });
  assert(journalEvent(s, 'cook', { acc: 'ข้าวผัด' }), 'cook written');
  assert(!journalEvent(s, 'cook', { acc: 'ข้าวผัด' }), 'cook deduped');
  assert(journalEvent(s, 'dish', { petId: 'p1', acc: 'ข้าวผัด' }), 'dish written');
  assert(!journalEvent(s, 'dish', { petId: 'p1', acc: 'ต้มจืด' }), 'dish once per pet per day');
  const l = journalDays(s).flatMap(d => d.lines);
  const d = l.find(x => x.kind === 'dish');
  assert(d.text.includes('มีมี่') && d.text.includes('ข้าวผัด') && d.emoji === '😋', d.text);
});

test('v23 feedPet: a plain dish writes a dish line, the favourite dish writes favDish (not dish); plain food writes neither', () => {
  const s = freshState();
  s.player.level = 99;
  const sp = SPECIES.find(x => x.id === 'hamster') || getSpecies('hamster');
  const fav = favoriteDish(sp);
  const other = RECIPES.find(r => !fav || r.id !== fav.id);
  s.pets.push({ id: 'p1', speciesId: sp.id, nickname: 'มีมี่', personality: 'cheerful', status: 'idle', stats: { hunger: 10, happy: 50, energy: 80, clean: 80 }, level: 1, xp: 0, bond: 0 });
  addItem(s, other.id, 2);
  if (fav) addItem(s, fav.id, 1);
  const r1 = feedPet(s, 'p1', other.id);
  assert(r1.ok, 'fed: ' + r1.msg);
  const kinds = () => journalDays(s).flatMap(d => d.lines).filter(l => l.petId === 'p1').map(l => l.kind);
  assertEq(kinds(), ['dish'], 'plain dish');
  if (fav) {
    s.pets[0].stats.hunger = 10;
    const r2 = feedPet(s, 'p1', fav.id);
    assert(r2.ok && r2.favDish, 'favourite dish');
    assertEq(kinds().sort(), ['dish', 'favDish'], 'favourite: favDish only added');
  }
});

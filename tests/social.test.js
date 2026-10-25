// Social tests (CONTRACT_V8): friends.js (points, best friends, events, pruning) and away.js (the welcome-back digest).
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { migrate, createNewState, pairKey, FRIEND_PAIRS_MAX } from '../js/state.js';
import * as F from '../js/friends.js';
import {
  AWAY_MIN_MS, AWAY_MAX_LINES, snapshotForAway, buildAwayDigest, setAwayDigest, takeAwayDigest, peekAwayDigest,
} from '../js/away.js';
import { advance } from '../js/tick.js';
import { tickPets } from '../js/pets.js';

const HOUR = 3600 * 1000;
const wait = ms => new Promise(r => setTimeout(r, ms));

function game(petDefs = [], extra = {}) {
  const pets = petDefs.map(d => ({
    id: d.id, speciesId: d.species || 'hamster', nickname: d.name ?? d.id, bornAt: 0, status: d.status || 'idle', task: d.task || null,
    stats: { hunger: 100, happy: 100, energy: 100, clean: 100 }, ...(d.extra || {}),
  }));
  return migrate({ version: 6, pets, lastTick: 1790000000000, ...extra });
}
const pet = (s, id) => s.pets.find(p => p.id === id);

// ---------------------------------------------------------------- friends: points

const aff = (s, a, b) => F.pairAffinity(pet(s, a), pet(s, b));

test('friends: pair rates (awake together 1, same plot 2, nap together 1, otherwise 0)', () => {
  const s = game([
    { id: 'a' }, { id: 'b' },
    { id: 'w1', status: 'working', task: { type: 'plot', plotIndex: 0, slot: 0 } },
    { id: 'w2', status: 'working', task: { type: 'plot', plotIndex: 0, slot: 1 } },
    { id: 'w3', status: 'working', task: { type: 'plot', plotIndex: 1, slot: 0 } },
    { id: 'z1', status: 'sleeping' }, { id: 'z2', status: 'sleeping' }, { id: 'x', status: 'expedition' },
  ]);
  const r = (a, b) => F.pairRate(pet(s, a), pet(s, b));
  assertEq([r('a', 'b'), r('w1', 'w2'), r('w1', 'w3'), r('z1', 'z2')], [1, 2, 0, 1]);
  assertEq([r('a', 'z1'), r('a', 'w1'), r('x', 'a'), r('x', 'x'), r('a', 'a')], [0, 0, 0, 0, 0], 'mixed states earn nothing');
  assertEq(F.pairRate(null, pet(s, 'a')), 0);
  assertEq([F.FRIEND_RATE, F.BEST_FRIEND_POINTS, F.FRIEND_DECAY_MULT], [{ awake: 1, work: 2, nap: 1 }, 72, 0.8]);
});

test('friends: affinity is deterministic, 0.7..1.3, order-free, varies per pair and rewards the same personality', () => {
  const s = game(Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` })));
  const vals = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const v = aff(s, `p${i}`, `p${j}`);
    assert(v >= 0.7 && v <= 1.3, `affinity ${v}`);
    assertEq(v, F.pairAffinity(pet(s, `p${j}`), pet(s, `p${i}`)), 'order-free');
    vals.push(v);
  }
  assert(new Set(vals.map(v => v.toFixed(6))).size > vals.length * 0.9, 'pairs differ, ties are rare');
  const x = game([{ id: 'u', extra: { personality: 'lazy' } }, { id: 'v', extra: { personality: 'lazy' } }, { id: 'w', extra: { personality: 'shy' } }]);
  const a = F.pairAffinity(pet(x, 'u'), pet(x, 'v'));
  const base = F.pairAffinity({ ...pet(x, 'u'), personality: 'x' }, { ...pet(x, 'v'), personality: 'y' });
  assert(a >= base && (a - base < 0.151), 'same personality adds at most 0.15 (capped at 1.3)');
});

test('friends: tickFriends credits fractional, deterministic points x affinity, in 10-minute windows', () => {
  const mk = () => game([{ id: 'a' }, { id: 'b' }, { id: 'c', status: 'sleeping' }]);
  const s = mk();
  const k = aff(s, 'a', 'b');
  F.tickFriends(s, HOUR / 2);
  assert(Math.abs(s.friends['a|b'] - 0.5 * k) < 1e-12 && Object.keys(s.friends).length === 1, JSON.stringify(s.friends));
  for (let i = 0; i < 9; i++) F.tickFriends(s, 60 * 1000);
  assert(Math.abs(s.friends['a|b'] - 0.5 * k) < 1e-12, 'under 10 minutes piles up without crediting');
  F.tickFriends(s, 60 * 1000);
  assert(Math.abs(s.friends['a|b'] - (0.5 + 10 / 60) * k) < 1e-12, 'the pile is credited at 10 minutes');
  const t = mk();
  F.tickFriends(t, HOUR / 2);
  for (let i = 0; i < 10; i++) F.tickFriends(t, 60 * 1000);
  assertEq(t.friends, s.friends, 'same inputs, same points');
  const before = s.friends['a|b'];
  F.tickFriends(s, 0); F.tickFriends(s, -5); F.tickFriends(s, NaN);
  assertEq(s.friends['a|b'], before, 'zero / negative / NaN dt change nothing');
  const w = game([{ id: 'p', status: 'working', task: { type: 'plot', plotIndex: 2, slot: 0 } }, { id: 'q', status: 'working', task: { type: 'plot', plotIndex: 2, slot: 1 } }]);
  F.tickFriends(w, 2 * HOUR);
  assert(Math.abs(w.friends['p|q'] - 4 * aff(w, 'p', 'q')) < 1e-9, 'same plot: +2/h');
  const n = game([{ id: 'p', status: 'sleeping' }, { id: 'q', status: 'sleeping' }]);
  F.tickFriends(n, 3 * HOUR);
  assert(Math.abs(n.friends['p|q'] - 3 * aff(n, 'p', 'q')) < 1e-9, 'nap together: +1/h');
  assertEq(F.friendPoints(n, 'q', 'p'), n.friends['p|q'], 'friendPoints ignores the order');
});

test('friends: newcomers (born < 5 days ago by the sim clock) earn x2; old pets do not', () => {
  const T = 1790000000000;
  const old = game([{ id: 'a' }, { id: 'b' }]);
  const young = game([{ id: 'a' }, { id: 'b', extra: { bornAt: T - HOUR } }]);
  const stale = game([{ id: 'a' }, { id: 'b', extra: { bornAt: T - 6 * 24 * HOUR } }]);
  for (const s of [old, young, stale]) F.tickFriends(s, HOUR);
  assert(Math.abs(young.friends['a|b'] / old.friends['a|b'] - 2) < 1e-9, 'x2 for a newcomer');
  assert(Math.abs(stale.friends['a|b'] / old.friends['a|b'] - 1) < 1e-9, 'not after 5 days');
  // the sim clock moves with the ticks: a pet 4.9 days old stops being a newcomer during a long catch-up
  const s = game([{ id: 'a' }, { id: 'b', extra: { bornAt: T - 4.9 * 24 * HOUR } }]);
  F.tickFriends(s, 2 * HOUR);   // 4.9 d -> 4.98 d: still young, 2h x2
  const first = s.friends['a|b'];
  F.tickFriends(s, 12 * HOUR);  // ends at 5.48 d: plain
  F.tickFriends(s, HOUR);       // now 5.5 d: plain
  const k = aff(s, 'a', 'b');
  assert(Math.abs(first - 4 * k) < 1e-9, 'first window doubled');
  assert(Math.abs(s.friends['a|b'] - first - 13 * k) < 1e-9, `a window that ends after day 5 is plain: ${s.friends['a|b']}`);
});

test('friends: pairs of pets that left the yard vanish (rehome / nursery); removePetFriends is explicit', () => {
  const s = game([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  F.tickFriends(s, HOUR);
  assertEq(Object.keys(s.friends).length, 3);
  s.pets = s.pets.filter(p => p.id !== 'c'); // c was rehomed / moved to the nursery
  F.tickFriends(s, 0);
  assertEq(Object.keys(s.friends), ['a|b'], 'pairs with c removed on the next call, even without a dt');
  const t = game([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  F.tickFriends(t, HOUR);
  assertEq(F.removePetFriends(t, 'b'), 2);
  assertEq(Object.keys(t.friends), ['a|c']);
  assertEq(F.removePetFriends(t, 'nobody'), 0);
  const junk = game([{ id: 'a' }, { id: 'b' }]);
  junk.friends = [1, 2];
  F.tickFriends(junk, HOUR);
  assertEq(Object.keys(junk.friends), ['a|b'], 'a broken friends field is repaired');
});

// ---------------------------------------------------------------- friends: best friends + events

test('friends: best friends are a greedy matching over pairs >= 72 (strongest first, one each, ties by key)', () => {
  const s = game([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
  s.friends = { 'a|b': 71.9, 'c|d': 90 };
  assertEq([F.bestFriendOf(s, 'a'), F.bestFriendOf(s, 'c'), F.bestFriendOf(s, 'd')], [null, 'd', 'c'], 'below 72 is not a best friend');
  s.friends['a|b'] = 72;
  assertEq([F.bestFriendOf(s, 'a'), F.bestFriendOf(s, 'b')], ['b', 'a'], 'exactly 72 counts');
  // a|b is the strongest: it matches first; c then pairs with d (their pair is >= 72 and both are free)
  s.friends = { 'a|b': 100, 'a|c': 80, 'c|d': 75 };
  assertEq([F.bestFriendOf(s, 'a'), F.bestFriendOf(s, 'b'), F.bestFriendOf(s, 'c'), F.bestFriendOf(s, 'd')], ['b', 'a', 'd', 'c'], 'a pet that lost its favourite pairs with the next free one');
  s.friends = { 'a|b': 100, 'a|c': 80, 'b|c': 79 };
  assertEq([F.bestFriendOf(s, 'a'), F.bestFriendOf(s, 'b'), F.bestFriendOf(s, 'c')], ['b', 'a', null], 'three pets: one is left out, never two friends');
  s.friends = { 'a|b': 80, 'a|c': 80, 'b|c': 10 };
  assertEq(F.bestFriendOf(s, 'a'), 'b', 'tie -> the smaller key');
  const m = F.bestFriendMap(s);
  assertEq([m instanceof Map, m.get('b'), m.get('c')], [true, 'a', undefined]);
  assertEq(F.bestFriendOf(game([]), 'x'), null);
  assertEq(F.bestFriendOf({}, 'x'), null, 'a state without friends');
});

test('friends: a new best-friend pair raises exactly one event; old friendships are not re-announced; offline is flagged', () => {
  const s = game([{ id: 'a', name: 'มะลิ' }, { id: 'b', name: 'โมจิ' }, { id: 'c' }]);
  F.takeFriendEvents();
  const seen = [];
  const off = F.onBestFriend(e => seen.push(e));
  s.friends = { 'a|b': 71 };
  F.tickFriends(s, 0);                // first look: nothing announced
  F.tickFriends(s, 0.1 * HOUR);
  assertEq(seen.length, 0);
  F.tickFriends(s, 2 * HOUR);         // crosses 72
  assertEq(seen.length, 1);
  assertEq([seen[0].a, seen[0].b, seen[0].aName, seen[0].bName, seen[0].offline], ['a', 'b', 'มะลิ', 'โมจิ', false]);
  assert(seen[0].points >= 72);
  assertEq(F.friendEventMessage(seen[0]), '🤝 มะลิ กับ โมจิ เป็นเพื่อนซี้กันแล้ว!');
  F.tickFriends(s, 5 * HOUR);
  assertEq(seen.length, 1, 'announced once');
  assertEq(F.takeFriendEvents().length, 1, 'queue has it');
  assertEq(F.takeFriendEvents().length, 0, 'and is emptied by the call');
  assert(s.friendsMet.includes('a|b'), 'remembered in the save');
  // loading a save that already has the friendship is silent
  const loaded = game([{ id: 'a' }, { id: 'b' }]);
  loaded.friends = { 'a|b': 500 };
  F.tickFriends(loaded, HOUR);
  assertEq(seen.length, 1);
  assertEq(loaded.friendsMet, ['a|b']);
  // offline catch-up flags the event
  const o = game([{ id: 'a' }, { id: 'b' }]);
  o.friends = { 'a|b': 71.5 };
  F.tickFriends(o, 0);
  F.tickFriends(o, 2 * HOUR, { offline: true });
  assertEq([seen.length, seen[1].offline], [2, true]);
  off();
});

test('friends: a pair that stops being best friends and later becomes best friends again is not announced twice', () => {
  const s = game([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  F.takeFriendEvents();
  s.friends = { 'a|b': 70 };
  F.tickFriends(s, 0);
  F.tickFriends(s, 3 * HOUR);
  assertEq(F.takeFriendEvents().length, 1, 'first time');
  s.friends['a|c'] = s.friends['a|b'] + 20; // a drifts to c: a|b is no longer a best pair
  F.tickFriends(s, HOUR);
  assertEq([F.bestFriendOf(s, 'a'), F.bestFriendOf(s, 'b')], ['c', null]);
  assertEq(F.takeFriendEvents().length, 1, 'a|c is new');
  s.friends['a|b'] = s.friends['a|c'] + 30; // and back again
  F.tickFriends(s, HOUR);
  assertEq(F.bestFriendOf(s, 'a'), 'b');
  assertEq(F.takeFriendEvents().length, 0, 'a|b was already announced once');
  assertEq(s.friendsMet, ['a|b', 'a|c']);
  // the list is capped
  for (let i = 0; i < 60; i++) s.friendsMet.push(`x${i}|y${i}`);
  s.friends = { 'a|b': 99 };
  F.tickFriends(s, HOUR);
  assert(s.friendsMet.length <= 40, `friendsMet capped, got ${s.friendsMet.length}`);
});

test('friends: the happiness effect helper is x0.8 only while the best friend is home too', () => {
  const s = game([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  s.friends = { 'a|b': 80 };
  assertEq(F.friendDecayMult(s, pet(s, 'a')), 0.8);
  assertEq(F.friendDecayMult(s, pet(s, 'c')), 1, 'no best friend');
  pet(s, 'b').status = 'working';
  assertEq(F.friendDecayMult(s, pet(s, 'a')), 1, 'friend is away');
  pet(s, 'b').status = 'sleeping';
  assertEq(F.friendDecayMult(s, pet(s, 'a')), 0.8, 'sleeping at home counts');
});

// 20 idle pets for 72 h, then a newcomer: the yard ends up with several best-friend pairs and the newcomer finds one within 5 days
function twentyIdle() {
  const s = game(Array.from({ length: 20 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, extra: { personality: ['lazy', 'shy', 'cheerful', 'glutton'][i % 4] } })));
  return s;
}
const run = (s, hours, stepMin = 10) => {
  let max = 0;
  for (let t = 0; t < hours * 60; t += stepMin) {
    F.tickFriends(s, stepMin * 60000);
    max = Math.max(max, Object.keys(s.friends).length);
  }
  return max;
};

test('friends: 20 idle pets for 72 h -> several best-friend pairs, a bounded save; a newcomer finds a best friend within 5 days', () => {
  const s = twentyIdle();
  F.takeFriendEvents();
  const max = run(s, 72);
  const pairs = F.bestFriendMap(s).size / 2;
  assert(pairs >= 4, `several best-friend pairs after 72 h, got ${pairs}`);
  assert(Object.keys(s.friends).length <= FRIEND_PAIRS_MAX, `bounded: ${Object.keys(s.friends).length}`);
  assert(max <= 190, 'never more than all pairs');
  assertEq(F.takeFriendEvents().length, pairs, 'one event per pair');
  // a baby hatches: bornAt = the sim clock
  const clock = s.lastTick + 72 * HOUR;
  s.pets.push({ ...JSON.parse(JSON.stringify(s.pets[0])), id: 'zz-new', nickname: 'ใหม่', personality: 'cheerful', bornAt: clock });
  s.lastTick = clock;
  let found = -1;
  for (let t = 0; t < 120 * 6 && found < 0; t++) {
    F.tickFriends(s, 10 * 60000);
    if (F.bestFriendOf(s, 'zz-new')) found = (t + 1) / 6;
  }
  assert(found > 0 && found <= 120, `the newcomer should have a best friend within 5 days, got ${found}`);
  assert(F.bestFriendMap(s).size / 2 >= 4, 'the older pairs mostly stayed');
  assert(Object.keys(s.friends).length <= 21 * 20 / 2, 'never more than all pairs');
  F.pruneFriends(s);
  assert(Object.keys(s.friends).length <= FRIEND_PAIRS_MAX, 'bounded after a prune');
  assert(F.bestFriendMap(s).get(F.bestFriendOf(s, 'zz-new')) === 'zz-new', 'mutual');
});

test('friends: every pet keeps its 4 strongest pairs (plus its best-friend pair); strongest survive, deterministic', () => {
  const defs = Array.from({ length: 20 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}` }));
  const mk = () => {
    const s = game(defs);
    s.pets[0].status = s.pets[1].status = 'working';
    s.pets[0].task = { type: 'plot', plotIndex: 0, slot: 0 };
    s.pets[1].task = { type: 'plot', plotIndex: 0, slot: 1 };
    return s;
  };
  const s = mk();
  for (let h = 0; h < F.FRIEND_PRUNE_EVERY_H; h++) F.tickFriends(s, HOUR);
  const n = Object.keys(s.friends).length;
  assert(n < 190 && n <= FRIEND_PAIRS_MAX && n >= 20 * 4 / 2, `pairs after the first prune: ${n}`);
  const perPet = {};
  for (const k of Object.keys(s.friends)) for (const id of k.split('|')) perPet[id] = (perPet[id] || 0) + 1;
  assert(Object.keys(perPet).length === 20 && Math.min(...Object.values(perPet)) >= 1, 'every pet still has pairs');
  assert(s.friends['p00|p01'] > 6, 'the plot pair earned double and survived');
  const again = mk();
  for (let h = 0; h < F.FRIEND_PRUNE_EVERY_H; h++) F.tickFriends(again, HOUR);
  assertEq(again.friends, s.friends, 'deterministic');
  const keep = { ...s.friends };
  F.pruneFriends(again);
  assertEq(again.friends, keep, 'pruning is idempotent');
});

test('friends: a 72 h offline catch-up with 20 pets is cheap (<= 150 ms; ~60 ms on a dev PC) and a no-op call is O(1)', () => {
  const s = twentyIdle();
  const t0 = performance.now();
  for (let i = 0; i < 72 * 60; i++) F.tickFriends(s, 60 * 1000, { offline: true }); // the 60 s steps catchUp uses
  const ms = performance.now() - t0;
  console.log(`PASS note: tickFriends 72 h x 20 pets = ${ms.toFixed(1)} ms`);
  assert(ms <= 150, `tickFriends took ${ms.toFixed(1)} ms for a 72 h catch-up`);
  assert(Object.keys(s.friends).length > 0);
});

test('friends: tickPets feeds tickFriends (idle pets at home become friends over time)', async () => {
  await import('../js/friends.js');
  await wait(30); // pets.js loads friends.js lazily
  const s = game([{ id: 'a' }, { id: 'b' }]);
  await withFakeNow(s.lastTick, async () => {
    tickPets(s, HOUR / 2, { offline: false });
    tickPets(s, HOUR / 2, { offline: false });
  });
  assert((s.friends['a|b'] || 0) > 0.6, `friends should grow through tickPets, got ${JSON.stringify(s.friends)}`);
});

// ---------------------------------------------------------------- away digest

const DAY = 24 * HOUR;
const trio = () => game([{ id: 'a', name: 'มะลิ' }, { id: 'b', name: 'โมจิ' }, { id: 'c', name: 'ถั่วแดง' }]);

test('away: nothing happened -> one warm line and up to 3 highlighted pets; deterministic', () => {
  const s = trio();
  const d = buildAwayDigest(snapshotForAway(s), s, 2 * HOUR);
  assertEq(d.lines.length, 1);
  assert(d.lines[0].text.length > 5 && d.lines[0].emoji, 'line has text + emoji');
  assertEq(d.highlights.length, 3);
  assertEq(buildAwayDigest(snapshotForAway(s), s, 2 * HOUR), d, 'same input, same digest');
  const long = buildAwayDigest(s, s, 8 * HOUR);
  assert(long.lines[0].text.includes('8'), 'a long absence says how long');
  assertEq(buildAwayDigest(game([]), game([]), AWAY_MIN_MS), { lines: [{ emoji: '💛', text: 'กลับมาแล้วเหรอ! น้องๆ คิดถึงนะ' }], highlights: [] }, 'no pets at all');
});

test('away: line sources (sleep / wake / hungry / sick / gift / work / trip / crop / postcard / nursery)', () => {
  const before = game(
    [{ id: 'a', name: 'มะลิ', status: 'sleeping' }, { id: 'b', name: 'โมจิ' }, { id: 'c', name: 'ถั่วแดง', status: 'working', task: { type: 'plot', plotIndex: 0, slot: 0 } },
      { id: 'd', name: 'ข้าวปั้น', status: 'expedition' }, { id: 'e', name: 'ส้มโอ' }, { id: 'f', name: 'น้ำตาล' }, { id: 'g', name: 'ฟ้า' }],
    { plots: [{ index: 0, cropId: 'carrot', progress: 0.5 }], postcards: [{ id: 'pc0', text: 'x', at: 1 }] },
  );
  const snap = snapshotForAway(before);
  const after = game(
    [{ id: 'a', name: 'มะลิ', status: 'idle' }, { id: 'b', name: 'โมจิ', status: 'sleeping' }, { id: 'c', name: 'ถั่วแดง', status: 'idle' },
      { id: 'd', name: 'ข้าวปั้น', status: 'idle' }, { id: 'e', name: 'ส้มโอ' }, { id: 'f', name: 'น้ำตาล' }, { id: 'g', name: 'ฟ้า' }],
    {
      plots: [{ index: 0, cropId: 'carrot', progress: 1 }], postcards: [{ id: 'pc0', text: 'x', at: 1 }, { id: 'pc1', text: 'y', at: 2 }, { id: 'pc2', text: 'z', at: 3 }],
      nursery: [{ pet: { id: 'n1', speciesId: 'cat', nickname: 'ลูกแมว', status: 'nursery' }, hatchedAt: 1 }],
    },
  );
  pet(after, 'e').stats.hunger = 5;
  pet(after, 'f').sick = true;
  after.yard.byPet.g = { c: 3, ms: 6 * HOUR, prog: 0, items: {} };
  const d = buildAwayDigest(snap, after, 6 * HOUR);
  assertEq(d.lines.length, AWAY_MAX_LINES, 'capped at 5');
  const text = d.lines.map(l => l.text).join('\n');
  assert(text.includes('น้ำตาล'), 'a sick pet always makes the cut (priority)');
  assert(text.includes('ลูกแมว'), 'nursery baby is named');
  assert(text.includes('ข้าวปั้น'), 'expedition return');
  assert(d.lines.every(l => l.emoji && l.text && !/^[\p{Extended_Pictographic}]/u.test(l.text)), 'emoji lives in its own field');
  assert(d.highlights.length >= 2 && d.highlights.length <= 4, `2-4 highlights, got ${d.highlights.length}`);
  assert(d.highlights.every(id => after.pets.some(p => p.id === id)), 'highlights are real pets');
  assertEq(new Set(d.lines.filter(l => l.petId).map(l => l.petId)).size, d.lines.filter(l => l.petId).length, 'one line per pet');
  // the rest, one at a time
  const only = (mutate, needle) => {
    const x = trio();
    const s0 = snapshotForAway(x);
    mutate(x);
    const dd = buildAwayDigest(s0, x, AWAY_MIN_MS);
    assert(dd.lines.some(l => l.text.includes(needle)), `${needle}: ${JSON.stringify(dd.lines)}`);
    return dd;
  };
  only(x => { pet(x, 'a').status = 'sleeping'; }, 'มะลิ');
  const g = only(x => { x.yard.byPet.b = { c: 1, ms: 6 * HOUR, prog: 0, items: {} }; }, 'โมจิ');
  assert(g.lines.some(l => l.petId === 'b' && l.emoji === '🎁'), 'full gift line for the pet');
  assert(g.lines.some(l => !l.petId && l.emoji === '🎁' && l.text.includes('1')), 'and the waiting-gifts summary');
  const c = only(x => { x.plots[0].cropId = 'carrot'; x.plots[0].progress = 1; x.plots[1].cropId = 'carrot'; x.plots[1].progress = 1; }, '2');
  assertEq(c.lines[0].petId, undefined, 'crop line has no pet');
  const w = trio();
  pet(w, 'a').status = 'working'; pet(w, 'a').task = { type: 'plot', plotIndex: 0, slot: 0 };
  const w0 = snapshotForAway(w);
  pet(w, 'a').status = 'idle';
  assert(buildAwayDigest(w0, w, HOUR).lines.some(l => l.text.includes('มะลิ') && l.emoji === '💪'), 'finished work');
});

test('away: a new best friend pair is told, with both pets highlighted; an old one is not', () => {
  const s = trio();
  s.friends = { 'a|b': 30 };
  const snap = snapshotForAway(s);
  s.friends['a|b'] = 80;
  const d = buildAwayDigest(snap, s, 5 * HOUR);
  assertEq(d.lines[0].emoji, '🤝');
  assert(d.lines[0].text.includes('มะลิ') && d.lines[0].text.includes('โมจิ'), d.lines[0].text);
  assertEq(d.highlights.slice(0, 2).sort(), ['a', 'b']);
  assertEq(d.lines.length, 1, 'friends were already awake: just the one line');
  const old = trio();
  old.friends = { 'a|b': 80 };
  const d2 = buildAwayDigest(snapshotForAway(old), old, 5 * HOUR);
  assert(!d2.lines.some(l => l.emoji === '🤝'), 'already friends before: no line');
});

test('away: template choice is stable per pet and day, and varies between pets', () => {
  const texts = new Set();
  for (let i = 0; i < 24; i++) {
    const s = game([{ id: `pet${i}`, name: 'น้อง' }]);
    const s0 = snapshotForAway(s);
    pet(s, `pet${i}`).sick = true;
    const a = buildAwayDigest(s0, s, HOUR);
    assertEq(buildAwayDigest(s0, s, HOUR), a, 'stable');
    texts.add(a.lines[0].text);
  }
  assert(texts.size >= 2, 'more than one variant is in use');
  const s = game([{ id: 'petX', name: 'น้อง' }]);
  const s0 = snapshotForAway(s);
  pet(s, 'petX').sick = true;
  const day1 = buildAwayDigest(s0, s, HOUR);
  s0.day += 1;
  const sNext = JSON.parse(JSON.stringify(s));
  sNext.lastTick += DAY;
  const day2 = buildAwayDigest(s0, sNext, HOUR);
  assertEq(day2.lines.length, 1);
  void day1;
});

test('away: a snapshot taken before the catch-up diffs against the real offline replay (hungry pets, finished naps)', async () => {
  const T = 1790000000000;
  await withFakeNow(T, async () => {
    const s = game([{ id: 'a', name: 'มะลิ' }, { id: 'b', name: 'โมจิ', status: 'sleeping' }], { lastTick: T - 6 * HOUR });
    pet(s, 'b').stats.energy = 40;
    const before = snapshotForAway(s);
    advance(s, T);
    const d = buildAwayDigest(before, s, 6 * HOUR);
    assert(d.lines.length >= 1 && d.lines.length <= AWAY_MAX_LINES);
    assert(d.lines.some(l => l.text.includes('มะลิ') || l.text.includes('โมจิ')), JSON.stringify(d.lines));
    assertEq(buildAwayDigest(before, s, 6 * HOUR), d, 'deterministic');
  });
});

test('away: the pending digest is handed over once; empty digests are dropped', () => {
  takeAwayDigest();
  assertEq(peekAwayDigest(), null);
  setAwayDigest({ lines: [], highlights: [] }, HOUR);
  assertEq(takeAwayDigest(), null, 'empty -> nothing pending');
  setAwayDigest({ lines: [{ emoji: '💛', text: 'x' }], highlights: ['a'] }, 2 * HOUR, 123);
  assertEq(peekAwayDigest().awayMs, 2 * HOUR);
  const d = takeAwayDigest();
  assertEq([d.lines.length, d.highlights, d.awayMs, d.at], [1, ['a'], 2 * HOUR, 123]);
  assertEq(takeAwayDigest(), null, 'consumed once');
  assertEq(AWAY_MIN_MS, 30 * 60 * 1000);
  assert(createNewState().friends && typeof createNewState().friends === 'object');
});

test('away: concrete lines after a normal absence (gifts waiting with counts, hungriest pet, napper, crops, expedition, postcards)', () => {
  const s = trio();
  pet(s, 'a').stats.energy = 20;
  const snap = snapshotForAway(s);
  pet(s, 'a').stats.energy = 100;      // napped
  pet(s, 'b').stats.hunger = 35;       // the hungriest, not yet "hungry"
  s.yard.byPet.a = { c: 40.5, ms: 2 * HOUR, prog: 0, items: { food_milk: 2 } };
  s.yard.byPet.c = { c: 12, ms: 2 * HOUR, prog: 0, items: {} };
  s.plots[0].cropId = 'carrot'; s.plots[0].progress = 1;
  s.expeditions = [{ id: 'e1', petId: 'c', zoneId: 'z', startAt: 0, endAt: 1, done: true, rewards: {} }];
  s.postcards = [{ id: 'q1', petName: 'x', speciesId: 'cat', text: 'hi', at: 1, read: false }];
  const d = buildAwayDigest(snap, s, 2 * HOUR);
  const text = d.lines.map(l => l.text).join(' | ');
  assertEq(d.lines.length, AWAY_MAX_LINES);
  assert(/ของขวัญ/.test(text) && /4 ชิ้น/.test(text) && text.includes('52'), `gifts with counts: ${text}`);
  assert(text.includes('โมจิ') || text.includes('มะลิ'), 'names appear');
  assert(!/คิดถึงนะ/.test(text), 'no generic line when something happened');
  const more = buildAwayDigest(snap, s, 2 * HOUR);
  assertEq(more, d, 'deterministic');
  // lower priorities when there are fewer events
  const small = trio();
  const snap2 = snapshotForAway(small);
  small.stats = small.stats;
  pet(small, 'b').stats.hunger = 35;
  const d2 = buildAwayDigest(snap2, small, 2 * HOUR);
  assertEq(d2.lines.length, 1);
  assertEq(d2.lines[0].petId, 'b');
  assertEq(d2.highlights, ['b']);
  const nap = trio();
  const snap3 = snapshotForAway(Object.assign(nap, {}));
  pet(nap, 'a').stats.energy = 10;
  const snap4 = snapshotForAway(nap);
  pet(nap, 'a').stats.energy = 100;
  assert(buildAwayDigest(snap4, nap, HOUR).lines.some(l => l.emoji === '💤' && l.text.includes('มะลิ')), 'napper');
  void snap3;
});

test('away: never throws on partial or junk input (missing fields, nulls, wrong types)', () => {
  const junk = [undefined, null, 0, 'x', [], {}, { pets: null }, { pets: {} }, { pets: { a: null, b: 5, c: { status: 1 } } },
    { pets: [1, null], yard: 'no', plots: 'x', expeditions: [null, 3], postcards: [{}, null], nursery: [null, { pet: null }, { pet: { id: 'n' } }], friends: 7, lastTick: 'x' },
    { pets: { a: { id: 'a', hunger: 'x', energy: NaN } }, nursery: [1, 2], postcards: 'x', friends: [] }];
  for (const b of junk) for (const a of junk) {
    const d = buildAwayDigest(b, a, NaN);
    assert(Array.isArray(d.lines) && Array.isArray(d.highlights), `shape for ${JSON.stringify(b)} / ${JSON.stringify(a)}`);
    assert(d.lines.length <= AWAY_MAX_LINES && d.highlights.length <= 4);
  }
  assert(Array.isArray(snapshotForAway(null).nursery));
  assertEq(snapshotForAway({ pets: 'x', yard: { byPet: 5 } }).pets, {});
});

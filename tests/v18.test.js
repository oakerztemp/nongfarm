// V18 tests (CONTRACT_V18): คิดถึง / น้อยใจ levels, faster sickness and ป่วยใจ, play sessions, toys instead of play, save defaults.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { createNewState, migrate, addItem } from '../js/state.js';
import { lonelyLevel, playSession, playBlocker, giveToy, tickPets, adoptFromNursery, MISS_AFTER_MS, SULK_AFTER_MS, PLAY_SCORE_MAX } from '../js/pets.js';
import { limitedPet } from '../js/mail.js';

const T0 = new Date(2026, 9, 27, 9, 0, 0).getTime();
const HOUR = 3600 * 1000;

function pet(s, over = {}) {
  const p = limitedPet('celestial', T0);
  Object.assign(p, { id: 'p1', speciesId: 'cat', nickname: 'เหมียว', shiny: false, stage: 2, xp: 200, playedAt: T0 }, over);
  delete p.limited;
  s.pets.push(p);
  return p;
}

/** Ticks the state in 1-minute online steps from the current fake time (the clock moves along). */
function run(s, clock, ms) {
  for (let t = 0; t < ms; t += 60000) { clock.advance(60000); tickPets(s, 60000); }
}

test('v18 levels: 0 under 24 h, 1 คิดถึง from 24 h, 2 น้อยใจ from 48 h; nursery babies and a missing playedAt are 0', () => {
  const p = { playedAt: T0, status: 'idle' };
  assertEq(lonelyLevel(p, T0 + MISS_AFTER_MS - 1), 0, 'just under 24 h');
  assertEq(lonelyLevel(p, T0 + MISS_AFTER_MS), 1, '24 h');
  assertEq(lonelyLevel(p, T0 + SULK_AFTER_MS), 2, '48 h');
  assertEq(lonelyLevel({ ...p, status: 'nursery' }, T0 + 9 * SULK_AFTER_MS), 0, 'nursery');
  assertEq(lonelyLevel({ status: 'idle' }, T0), 0, 'no playedAt');
});

test('v18 play session: resets the clock, happy +20 +2/point (capped), bond +3 (+1 per 5 points, max +2), works at full happy; blockers', () => withFakeNow(T0 + 50 * HOUR, () => {
  const s = createNewState();
  const p = pet(s, { stats: { hunger: 80, happy: 30, energy: 80, clean: 80 } });
  assertEq(lonelyLevel(p), 2, 'sulking before');
  const r = playSession(s, p.id, 99);
  assert(r.ok && r.score === PLAY_SCORE_MAX, r.reason);
  assertEq(p.playedAt, T0 + 50 * HOUR, 'clock reset');
  assertEq(lonelyLevel(p), 0, 'no longer lonely');
  assertEq(p.bond, 5, 'bond 3 + 2');
  assert(p.stats.happy >= 30 + 40 - 0.01, 'happy +40 for a full score (cheerful)');
  p.stats.happy = 100;
  assert(playSession(s, p.id, 0).ok, 'full happy is fine for a real session');
  p.sick = true;
  assert(playBlocker(s, p.id) && !playSession(s, p.id, 5).ok, 'sick: blocked');
  p.sick = false; p.stats.energy = 5;
  assert(!playSession(s, p.id, 5).ok, 'tired: blocked');
  p.stats.energy = 80; p.status = 'sleeping';
  assert(!playSession(s, p.id, 5).ok, 'asleep: blocked');
}));

test('v18 toy instead of play: resets the clock, works even at full happy when the pet misses you', () => withFakeNow(T0 + 30 * HOUR, () => {
  const s = createNewState();
  const p = pet(s, { stats: { hunger: 80, happy: 100, energy: 80, clean: 80 } });
  addItem(s, 'care_toy', 1);
  assertEq(lonelyLevel(p), 1, 'misses you');
  assert(giveToy(s, p.id).ok, 'toy accepted');
  assertEq(lonelyLevel(p), 0, 'clock reset');
}));

test('v18 effects: sulking drains happy 1.5x, falls ill from hunger in 1 h instead of 2, and ป่วยใจ after 3 h at happy <= 10', () => withFakeNow(T0, clock => {
  const s = createNewState();
  const fine = pet(s, { id: 'fine', stats: { hunger: 100, happy: 100, energy: 100, clean: 100 } });
  const sulky = pet(s, { id: 'sulky', playedAt: T0 - SULK_AFTER_MS, stats: { hunger: 100, happy: 100, energy: 100, clean: 100 } });
  run(s, clock, 2 * HOUR);
  const dFine = 100 - fine.stats.happy, dSulky = 100 - sulky.stats.happy;
  assert(Math.abs(dSulky / dFine - 1.5) < 0.05, `happy decay x${(dSulky / dFine).toFixed(2)}`);

  const t = createNewState();
  const a = pet(t, { id: 'a', stats: { hunger: 0, happy: 80, energy: 100, clean: 100 } });
  const b = pet(t, { id: 'b', playedAt: T0 - SULK_AFTER_MS, stats: { hunger: 0, happy: 80, energy: 100, clean: 100 } });
  run(t, clock, 65 * 60000);
  assert(b.sick && !a.sick, 'the sulking pet fell ill after 1 h of hunger, the other did not');

  const u = createNewState();
  const c = pet(u, { id: 'c', playedAt: now0(clock) - SULK_AFTER_MS, stats: { hunger: 100, happy: 5, energy: 100, clean: 100 } });
  run(u, clock, 2 * HOUR);
  assert(!c.sick, 'not yet after 2 h');
  c.stats.hunger = 100; c.stats.clean = 100;
  run(u, clock, 70 * 60000);
  assert(c.sick, 'ป่วยใจ after 3 h at happy <= 10');
}));
const now0 = clock => clock.get();

test('v18 saves: an old pet without playedAt starts counting at load (nobody sulks after the update); a future one is clamped; adopting from the crib resets', () => withFakeNow(T0, () => {
  const raw = JSON.parse(JSON.stringify(createNewState()));
  raw.pets = [{ id: 'old', speciesId: 'cat' }, { id: 'fut', speciesId: 'cat', playedAt: T0 + 99 * HOUR }, { id: 'bad', speciesId: 'cat', playedAt: 'x', heartsickMs: -5 }];
  const s = migrate(raw);
  assertEq(s.pets.map(p => p.playedAt), [T0, T0, T0], 'playedAt');
  assertEq(s.pets[2].heartsickMs, 0, 'heartsickMs');
  const baby = limitedPet('celestial', T0 - 99 * HOUR);
  Object.assign(baby, { id: 'baby', speciesId: 'cat', status: 'nursery', playedAt: T0 - 99 * HOUR });
  delete baby.limited;
  s.pets.length = 0;   // room in the yard
  s.nursery.push({ pet: baby, hatchedAt: T0 });
  assert(adoptFromNursery(s, 'baby').ok, 'adopted');
  assertEq(lonelyLevel(s.pets.find(p => p.id === 'baby')), 0, 'fresh start in the yard');
}));

test('v18 busy pets: time at work or on an expedition does not count toward คิดถึง', () => withFakeNow(T0, clock => {
  const s = createNewState();
  const w = pet(s, { id: 'w', status: 'working', stats: { hunger: 100, happy: 100, energy: 100, clean: 100 } });
  run(s, clock, 30 * HOUR);
  assertEq(lonelyLevel(w), 0, 'a worker does not miss you while working');
  w.status = 'idle';
  run(s, clock, 25 * HOUR);
  assertEq(lonelyLevel(w), 1, 'back home, the clock runs again');
}));

test('v18 catch-up: an absence is replayed with the loneliness of each replayed moment (not the level on return)', async () => {
  const { advance } = await import('../js/tick.js');
  await withFakeNow(T0, clock => {
    const mk = playedAt => { const s = createNewState(); s.lastTick = T0; return { s, p: pet(s, { playedAt, stats: { hunger: 100, happy: 100, energy: 100, clean: 100 } }) }; };
    const a = mk(T0), ref = mk(T0 + 99 * 24 * HOUR);   // ref never gets lonely
    clock.set(T0 + 26 * HOUR);
    advance(a.s, T0 + 26 * HOUR);
    advance(ref.s, T0 + 26 * HOUR);
    const ratio = (100 - a.p.stats.happy) / (100 - ref.p.stats.happy);
    assert(ref.p.stats.happy > 1, 'the reference has not hit 0');
    // 24 h at x1 + 2 h at x1.25 -> 26.5 / 26 = 1.019; the old bug replayed all 26 h at x1.25
    assert(ratio > 1.005 && ratio < 1.05, `happy loss ratio ${ratio.toFixed(3)} (expected ~1.02)`);
  });
});

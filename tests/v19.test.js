// V19 tests (CONTRACT_V19): pick-a-quantity selling, favourite toys, the "what does the pet want" play game.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { createNewState, migrate, addItem } from '../js/state.js';
import { sellItem } from '../js/farm.js';
import { playSession, favToyOf, PLAY_TOYS } from '../js/pets.js';
import { limitedPet } from '../js/mail.js';
import { startPlayGame } from '../js/ui/playGame.js';

const T0 = new Date(2026, 9, 27, 18, 0, 0).getTime();

function pet(s, over = {}) {
  const p = limitedPet('celestial', T0);
  Object.assign(p, { id: 'p1', speciesId: 'cat', nickname: 'เหมียว', shiny: false, stage: 2, xp: 200, playedAt: T0,
    stats: { hunger: 80, happy: 50, energy: 80, clean: 80 } }, over);
  delete p.limited;
  s.pets.push(p);
  return p;
}

test('v19 sell: any quantity from 1 to what you have; more than that or 0 is refused', () => withFakeNow(T0, () => {
  const s = createNewState();
  addItem(s, 'crop_carrot', 10);
  const coins = s.player.coins;
  assert(sellItem(s, 'crop_carrot', 7).ok, 'sell 7');
  assertEq(s.inventory.crop_carrot, 3, 'left');
  assert(s.player.coins > coins, 'paid');
  assert(!sellItem(s, 'crop_carrot', 4).ok, 'not enough');
  assert(!sellItem(s, 'crop_carrot', 0).ok, 'zero');
  assertEq(s.inventory.crop_carrot, 3, 'unchanged');
}));

test('v19 favourite toy: fixed per pet, always one of the play toys, and spread over all of them', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const f = favToyOf({ id: `pet-${i}` });
    assert(PLAY_TOYS.includes(f), 'a play toy');
    assertEq(favToyOf({ id: `pet-${i}` }).id, f.id, 'stable');
    seen.add(f.id);
  }
  assertEq(seen.size, PLAY_TOYS.length, 'every toy is somebody\'s favourite');
});

test('v19 play session: favFound marks the favourite toy once (diary line once), a normal session does not', () => withFakeNow(T0, () => {
  const s = createNewState();
  const p = pet(s);
  const r0 = playSession(s, p.id, 5);
  assert(r0.ok && !r0.favNew && !p.favToyKnown, 'not found yet');
  const r1 = playSession(s, p.id, 5, { favFound: true });
  assert(r1.ok && r1.favNew && p.favToyKnown, 'found');
  const lines = JSON.stringify(s.journal || {});
  assert(lines.includes(favToyOf(p).nameTh), 'diary names the toy');
  const r2 = playSession(s, p.id, 5, { favFound: true });
  assert(r2.ok && !r2.favNew, 'only the first time is news');
}));

test('v19 saves: favToyKnown is a boolean, missing = false', () => withFakeNow(T0, () => {
  const raw = JSON.parse(JSON.stringify(createNewState()));
  raw.pets = [{ id: 'a', speciesId: 'cat' }, { id: 'b', speciesId: 'cat', favToyKnown: 'yes' }, { id: 'c', speciesId: 'cat', favToyKnown: true }];
  assertEq(migrate(raw).pets.map(p => p.favToyKnown), [false, false, true], 'favToyKnown');
}));

const wait = ms => new Promise(r => setTimeout(r, ms));

test('v19 play game: the wished toy scores, a wrong toy costs a point and calls onWrong; quitting early is not counted', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:400px;';
  document.body.appendChild(host);
  const log = { wishes: [], hits: [], wrong: 0, end: null };
  const g = startPlayGame({
    host, favToy: null,
    onWish: w => log.wishes.push(w),
    onHit: (n, el, combo, extra) => log.hits.push([n, combo, extra.fav]),
    onWrong: () => { log.wrong++; },
    onEnd: (score, counted, extra) => { log.end = { score, counted, extra }; },
  });
  try {
    assertEq(log.wishes.length, 1, 'a wish right away');
    assert(host.querySelector('.pg-wish').textContent.includes(g.wish), 'the wish is shown');
    const toy = pred => [...host.querySelectorAll('.pg-toy')].find(b => !b.dataset.gone && pred(b.textContent));
    const tap = b => b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    let right = null;
    for (let i = 0; i < 40 && !right; i++) { await wait(100); right = toy(t => t === g.wish); }
    assert(right, 'the wished toy pops up');
    tap(right);
    assertEq(g.score, 1, 'right toy +1');
    assertEq(log.hits[0][1], 1, 'combo 1');
    let wrong = null;
    for (let i = 0; i < 60 && !wrong; i++) { await wait(100); wrong = toy(t => t !== g.wish); }
    assert(wrong, 'another toy pops up');
    const before = g.score;
    tap(wrong);
    assertEq(g.score, Math.max(0, before - 1), 'wrong toy -1');
    assertEq(log.wrong, 1, 'onWrong');
    g.stop();
    assert(log.end && !log.end.counted, 'quit after ~1-6 s: not counted');
    assert(!host.querySelector('.pg'), 'cleaned up');
  } finally {
    g.stop();
    host.remove();
  }
});

test('v19 play game: the favourite toy is worth 2 and reports favFound', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:400px;';
  document.body.appendChild(host);
  let end = null, fav = false;
  // a low roll while the game starts makes the first wish the favourite (FAV_WISH); the rest of the round is random again
  const rnd = Math.random;
  Math.random = () => 0;
  let g;
  try { g = startPlayGame({ host, favToy: '🎾', onHit: (n, el, c, x) => { fav = fav || x.fav; }, onEnd: (score, counted, x) => { end = x; } }); }
  finally { Math.random = rnd; }
  try {
    assertEq(g.wish, '🎾', 'first wish = favourite');
    let hit = false;
    for (let i = 0; i < 30 && !hit; i++) {
      await wait(100);
      if (g.wish !== '🎾') continue;
      const b = [...host.querySelectorAll('.pg-toy')].find(t => !t.dataset.gone && t.textContent === '🎾');
      if (b) { const s0 = g.score; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); assertEq(g.score, s0 + 2, 'favourite +2'); hit = true; }
    }
    assert(hit, 'the favourite popped up for its wish');
    g.stop();
    assert(fav && end && end.favFound, 'favFound reported');
  } finally {
    g.stop();
    host.remove();
  }
});

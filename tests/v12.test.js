// V12 tests (CONTRACT_V12): mailbox + Limited welcome pet, water-all, Limited / shiny 3D palette.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import * as THREE from '../vendor/three.module.min.js';
import { createNewState, migrate, ensureMail, addItem, NURSERY_SLOTS } from '../js/state.js';
import { mailList, mailBadgeCount, readMail, claimMail, limitedPet } from '../js/mail.js';
import { SYSTEM_MAILS, MAIL_MAX } from '../js/data/mail.js';
import { LIMITED_PETS, limitedOf } from '../js/data/limited.js';
import { rehomePet, STAGES } from '../js/pets.js';
import { plantSeed, waterAll, waterablePlots, tickFarm } from '../js/farm.js';
import { buildPetModel } from '../js/world3d/critters.js';
import { MODEL_SPECS } from '../js/data/models.js';
import { getSpecies } from '../js/data/species.js';

const T0 = new Date(2026, 9, 26, 10, 0, 0).getTime();
const WELCOME = 'welcome_celestial';
const isoState = () => JSON.parse(JSON.stringify(createNewState()));

async function loadFixture(name) {
  const res = await fetch(new URL(`./fixtures/${name}.json`, import.meta.url));
  assert(res.ok, `cannot load fixture ${name}`);
  return res.json();
}

test('v12 mail: a new save has the welcome mail once, unread, with its gift (badge 1)', () => withFakeNow(T0, () => {
  const s = createNewState();
  assertEq(s.mail.length, SYSTEM_MAILS.filter(m => !m.minLevel || m.minLevel <= 1).length, 'one mail per system mail of level 1');
  assertEq(s.mail[0].id, WELCOME, 'welcome mail');
  assert(!s.mail[0].read && !s.mail[0].claimed, 'unread, not claimed');
  assert(s.mailSent.includes(WELCOME), 'marked as sent');
  assertEq(mailBadgeCount(s), 1, 'badge');
  ensureMail(s); ensureMail(s);
  assertEq(s.mail.length, 1, 'ensureMail never duplicates');
  readMail(s, WELCOME);
  assertEq(mailBadgeCount(s), 1, 'read but gift not taken still counts');
}));

test('v12 mail: an old save (v8 fixture) gets the welcome mail on load; a claimed / deleted one never comes back', async () => {
  const s = migrate(await loadFixture('save_v8_midgame'));
  assert(s.mail.some(m => m.id === WELCOME && !m.claimed), 'old save receives the mail');
  s.mail = [];                                   // even if the entry is lost, mailSent keeps it from being re-sent
  const again = migrate(JSON.parse(JSON.stringify(s)));
  assertEq(again.mail.length, 0, 'not re-sent');
});

test('v12 mail: sanitise drops unknown / duplicate mail, coerces flags, drops an unknown pet.limited', () => withFakeNow(T0, () => {
  const raw = isoState();
  raw.mail = [{ id: 'nope' }, { id: WELCOME, read: 'yes', claimed: 1, at: 'x' }, { id: WELCOME, read: true }, 5, null];
  raw.mailSent = [WELCOME, WELCOME, 7];
  raw.pets = [{ id: 'p1', speciesId: 'cat', limited: 'fake' }, { id: 'p2', speciesId: 'unicorn', limited: 'celestial' }];
  const s = migrate(raw);
  assertEq(s.mail.length, 1, 'one valid mail');
  assertEq(JSON.stringify(s.mail[0]), JSON.stringify({ id: WELCOME, at: 0, read: false, claimed: false }), 'flags coerced');
  assertEq(JSON.stringify(s.mailSent), JSON.stringify([WELCOME]), 'mailSent unique strings');
  assert(!('limited' in s.pets[0]), 'unknown limited dropped');
  assertEq(s.pets[1].limited, 'celestial', 'known limited kept');
  const big = isoState();
  big.mail = Array.from({ length: MAIL_MAX + 5 }, () => ({ id: WELCOME }));
  assert(migrate(big).mail.length <= MAIL_MAX, 'capped');
}));

test('v12 claim: empty yard -> Limited pet in the yard (shiny, teen, named, collection), claim twice refused', () => withFakeNow(T0, () => {
  const s = createNewState();
  const r = claimMail(s, WELCOME);
  assert(r.ok, r.reason);
  const p = s.pets[0];
  const L = LIMITED_PETS.celestial;
  assertEq(p.speciesId, L.speciesId, 'species');
  assert(p.shiny && p.limited === 'celestial' && limitedOf(p) === L, 'shiny + limited');
  assertEq(p.stage, L.stage, 'stage'); assertEq(p.xp, STAGES[L.stage].xp, 'xp at the stage threshold');
  assertEq(p.nickname, L.nickname, 'name');
  assert(s.collection.unicorn && s.collection.unicorn.owned === 1 && s.collection.unicorn.shiny, 'book entry');
  assertEq(mailBadgeCount(s), 0, 'badge cleared');
  assert(!claimMail(s, WELCOME).ok, 'second claim refused');
  assertEq(s.pets.length, 1, 'still one pet');
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assertEq(m.pets[0].limited, 'celestial', 'survives a save round trip');
}));

test('v12 claim: full yard -> nursery; yard + nursery full -> refused and the mail stays claimable', () => withFakeNow(T0, () => {
  const s = createNewState();
  for (let i = 0; i < s.barnCapacity; i++) s.pets.push({ ...limitedPet('celestial'), id: 'y' + i, limited: undefined, speciesId: 'cat' });
  const r = claimMail(s, WELCOME);
  assert(r.ok && r.nursery, 'goes to the nursery');
  assertEq(s.nursery[0].pet.status, 'nursery', 'nursery status');
  const t = createNewState();
  for (let i = 0; i < t.barnCapacity; i++) t.pets.push({ id: 'y' + i, speciesId: 'cat' });
  for (let i = 0; i < NURSERY_SLOTS; i++) t.nursery.push({ pet: { id: 'n' + i, speciesId: 'cat', status: 'nursery' }, hatchedAt: T0 });
  assert(!claimMail(t, WELCOME).ok, 'refused when everything is full');
  assert(!t.mail[0].claimed, 'still claimable later');
}));

test('v12 claim: a Limited pet cannot be rehomed (no stardust pump, no accidental loss)', () => withFakeNow(T0, () => {
  const s = createNewState();
  claimMail(s, WELCOME);
  const dust = s.stardust;
  const r = rehomePet(s, s.pets[0].id);
  assert(!r.ok, 'refused');
  assertEq(s.pets.length, 1, 'kept');
  assertEq(s.stardust, dust, 'no stardust');
}));

test('v12 waterAll: waters every growing unwatered plot, skips empty / watered / ready ones', () => withFakeNow(T0, clock => {
  const s = createNewState();
  addItem(s, 'seed_carrot', 3);
  plantSeed(s, 0, 'carrot'); plantSeed(s, 1, 'carrot'); plantSeed(s, 2, 'carrot');
  s.plots[1].watered = true;
  s.plots[2].progress = 1;                       // ready
  assertEq(waterablePlots(s).length, 1, 'one waterable');
  const r = waterAll(s);
  assert(r.ok, r.reason);
  assert(s.plots[0].watered && !s.plots[3].watered && !s.plots[3].cropId, 'plot 0 watered, empty plot untouched');
  assert(!waterAll(s).ok, 'nothing left to water');
}));

test('v12 3D: the Limited pet gets its own palette (differs from the plain shiny unicorn); the plain shiny is unchanged', () => {
  const sp = getSpecies('unicorn');
  const colours = m => { const c = new Set(); m.root.traverse(o => { const a = o.isMesh && o.geometry.attributes.color; if (a) for (let i = 0; i < a.count; i += 7) c.add([a.getX(i), a.getY(i), a.getZ(i)].map(v => v.toFixed(2)).join()); }); return [...c].sort().join('|'); };
  const shiny = buildPetModel(THREE, { speciesId: 'unicorn', stage: 2, shiny: true }, sp);
  const ltd = buildPetModel(THREE, { speciesId: 'unicorn', stage: 2, shiny: true, limited: 'celestial' }, sp);
  const wrong = buildPetModel(THREE, { speciesId: 'unicorn', stage: 2, shiny: true, limited: 'nope' }, sp);
  assert(colours(ltd) !== colours(shiny), 'limited palette differs');
  assertEq(colours(wrong), colours(shiny), 'unknown limited = normal shiny');
  assert(ltd.shiny && ltd.kind === 'model', 'still a shiny model');
  for (const from of Object.keys(LIMITED_PETS.celestial.palette)) assert(from in MODEL_SPECS.unicorn.shinyPalette, 'palette key is a unicorn colour: ' + from);
});

test('v12 review fixes: a guest who only took the gift stays pristine; the rehome picker marks the Limited pet ineligible (swap picker does not)', async () => {
  const { isPristine } = await import('../js/state.js');
  const { compareCandidates } = await import('../js/pets.js');
  await withFakeNow(T0, () => {
    const s = createNewState();
    claimMail(s, WELCOME);
    assert(isPristine(s), 'gift alone is not progress');
    const row = compareCandidates(s, { scope: 'all' })[0];
    assert(!row.eligible && row.reason, 'rehome picker: ineligible with a reason');
    assert(compareCandidates(s, { scope: 'yard' })[0].eligible, 'swap picker: still eligible');
    s.pets.push({ ...limitedPet('celestial'), id: 'x', limited: undefined, speciesId: 'cat' });
    assert(!isPristine(s), 'a real pet is progress');
  });
});

test('v14 legendary egg: the mail arrives on reaching Lv.5 (not before), goes into the incubator, refuses a full one, hatches a legendary', async () => {
  const { addPlayerXp, xpForLevel } = await import('../js/state.js');
  const { hatchReady } = await import('../js/pets.js');
  const { SPECIES } = await import('../js/data/species.js');
  await withFakeNow(T0, clock => {
    const s = createNewState();
    assert(!s.mail.some(m => m.id === 'gift_legend_egg'), 'not at Lv.1');
    while (s.player.level < 4) addPlayerXp(s, xpForLevel(s.player.level));
    assert(!s.mail.some(m => m.id === 'gift_legend_egg'), 'not at Lv.4');
    addPlayerXp(s, xpForLevel(s.player.level));
    assertEq(s.player.level, 5, 'Lv.5');
    assert(s.mail.some(m => m.id === 'gift_legend_egg' && !m.claimed), 'arrives at Lv.5');
    s.incubator.push({ eggId: 'egg_farm', startAt: T0, readyAt: T0 });
    assert(!claimMail(s, 'gift_legend_egg').ok, 'full incubator refused');
    assert(!s.mail.find(m => m.id === 'gift_legend_egg').claimed, 'still claimable');
    s.incubator.length = 0;
    const r = claimMail(s, 'gift_legend_egg');
    assert(r.ok, r.reason);
    assertEq(s.incubator[0].eggId, 'egg_legend', 'in the incubator');
    assert(!claimMail(s, 'gift_legend_egg').ok, 'second claim refused');
    clock.advance(11 * 60 * 1000);
    const h = hatchReady(s, 0);
    assert(h.ok, h.reason);
    assertEq(SPECIES.find(sp => sp.id === h.pet.speciesId).rarity, 'legendary', 'a legendary hatched');
    assertEq(countItemSafe(s, 'egg_legend'), 0, 'never an inventory item');
    const m = migrate(JSON.parse(JSON.stringify(s)));
    assertEq(m.mail.filter(x => x.id === 'gift_legend_egg').length, 1, 'not re-sent after a reload');
  });
});

const countItemSafe = (s, id) => (s.inventory && s.inventory[id]) || 0;

// V17 tests (CONTRACT_V17): family tree (parent ids, legacy name matching, gone parents, generations) and the per-species coat book.
import { test, assert, assertEq, withFakeNow } from './harness.js';
import { createNewState, migrate } from '../js/state.js';
import { familyTree, hasFamily, rollFamilyGenes } from '../js/breeding.js';
import { markCoatBook } from '../js/pets.js';
import { limitedPet } from '../js/mail.js';

const T0 = new Date(2026, 9, 26, 10, 0, 0).getTime();

function mk(s, id, speciesId, nickname, family = null, coat = 'base') {
  const p = limitedPet('celestial', T0);
  Object.assign(p, { id, speciesId, nickname, stage: 2, xp: 200, shiny: false, coat, family });
  delete p.limited;
  s.pets.push(p);
  return p;
}
const side = (p, withId = true) => (withId ? { petId: p.id, name: p.nickname, speciesId: p.speciesId } : { name: p.nickname, speciesId: p.speciesId });

test('v17 genes: a bred baby\'s family keeps both parents\' ids, and migrate keeps them (unknown junk dropped)', () => withFakeNow(T0, () => {
  const parent = (petId, name, speciesId) => ({ petId, name, speciesId, personality: 'cheerful', shiny: false, coat: 'base', gen: 0 });
  const g = rollFamilyGenes({ a: parent('pa', 'แม่', 'cat'), b: parent('pb', 'พ่อ', 'dog'), habitatA: 'farm', habitatB: 'farm' }, () => 0.1);
  assertEq([g.family.a.petId, g.family.b.petId], ['pa', 'pb'], 'ids');
  const s = createNewState();
  mk(s, 'kid', g.speciesId, 'ลูก', g.family);
  const raw = JSON.parse(JSON.stringify(s));
  raw.pets[0].family.a.petId = 42;
  const m = migrate(raw);
  assertEq(m.pets[0].family.b.petId, 'pb', 'kept');
  assert(!('petId' in m.pets[0].family.a), 'a non-string id is dropped');
}));

test('v17 tree: parents by id, siblings, children, grandparents; a parent who moved away stays as a name; no family = first generation', () => withFakeNow(T0, () => {
  const s = createNewState();
  const gma = mk(s, 'gma', 'cat', 'ยาย'), gpa = mk(s, 'gpa', 'cat', 'ตา');
  const mom = mk(s, 'mom', 'cat', 'แม่', { gen: 1, a: side(gma), b: side(gpa) });
  const dad = { id: 'dad', nickname: 'พ่อ', speciesId: 'dog' };   // rehomed: not in the save any more
  const kid = mk(s, 'kid', 'cat', 'ลูก', { gen: 2, a: side(mom), b: side(dad) });
  const sis = mk(s, 'sis', 'dog', 'น้องสาว', { gen: 2, a: side(dad), b: side(mom) });   // same parents, other order
  const t = familyTree(s, kid.id);
  assertEq(t.gen, 2, 'gen');
  assertEq(t.parents.map(p => [p.name, p.pet && p.pet.id]), [['แม่', 'mom'], ['พ่อ', null]], 'parents (dad gone)');
  assertEq(t.grand[0].map(g => g.pet.id), ['gma', 'gpa'], 'mom\'s parents');
  assertEq(t.grand[1], [], 'dad is gone: no grandparents on his side');
  assertEq(t.siblings.map(p => p.id), ['sis'], 'sibling');
  assertEq(familyTree(s, mom.id).children.map(p => p.id).sort(), ['kid', 'sis'], 'mom\'s children');
  assertEq(familyTree(s, gma.id).children.map(p => p.id), ['mom'], 'grandma\'s child');
  assert(hasFamily(s, gma.id) && hasFamily(s, kid.id), 'has family');
  const loner = mk(s, 'solo', 'pig', 'โสด');
  assert(!hasFamily(s, loner.id), 'no family');
  assertEq(familyTree(s, loner.id).parents, [], 'first generation');
  assertEq(familyTree(s, 'nope'), null, 'unknown id');
}));

test('v17 tree: babies bred before V17 (no ids) still find parents and children by name + species; nursery babies count', () => withFakeNow(T0, () => {
  const s = createNewState();
  const mom = mk(s, 'mom', 'rabbit', 'มะลิ');
  const dad = mk(s, 'dad', 'rabbit', 'โมจิ');
  const baby = limitedPet('celestial', T0);
  Object.assign(baby, { id: 'baby', speciesId: 'rabbit', nickname: 'ถั่ว', status: 'nursery', family: { gen: 1, a: side(mom, false), b: side(dad, false) } });
  delete baby.limited;
  s.nursery.push({ pet: baby, hatchedAt: T0 });
  assertEq(familyTree(s, 'baby').parents.map(p => p.pet && p.pet.id), ['mom', 'dad'], 'legacy parents');
  assertEq(familyTree(s, 'mom').children.map(p => p.id), ['baby'], 'legacy child in the nursery');
}));

test('v17 coat book: hatch marks base, family coats are marked, load backfills from owned pets + collection, junk dropped', () => withFakeNow(T0, () => {
  const s = createNewState();
  markCoatBook(s, 'cat', 'rose');
  mk(s, 'c1', 'dog', 'ด่าง', null, 'mint');
  s.collection.cow = { owned: 1, shiny: false };
  const raw = JSON.parse(JSON.stringify(s));
  raw.coatBook.nope = { base: true };
  raw.coatBook.cat.purple = true;
  raw.coatBook.cat.cream = 'yes';
  const m = migrate(raw);
  assertEq(m.coatBook.cat, { rose: true }, 'cat: known coat only');
  assertEq(m.coatBook.dog, { mint: true }, 'owned pet backfilled');
  assertEq(m.coatBook.cow, { base: true }, 'collection backfilled');
  assert(!('nope' in m.coatBook), 'unknown species dropped');
  assertEq(createNewState().coatBook, {}, 'new save: empty');
}));

test('v17 review fixes: the Limited mail gift marks the coat book; bad data never makes a pet its own parent or child', async () => {
  const { claimMail } = await import('../js/mail.js');
  await withFakeNow(T0, () => {
    const s = createNewState();
    assert(claimMail(s, 'welcome_celestial').ok, 'claimed');
    assertEq(s.coatBook.unicorn, { base: true }, 'coat book');
    const self = mk(s, 'loop', 'cat', 'วน');
    self.family = { gen: 1, a: { petId: 'loop', name: 'วน', speciesId: 'cat' }, b: { petId: 'x', name: 'ไม่มี', speciesId: 'dog' } };
    const t = familyTree(s, 'loop');
    assertEq(t.parents[0].pet, null, 'not its own parent');
    assertEq(t.children, [], 'not its own child');
  });
});

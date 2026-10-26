// ครอบครัวน้อง 💞 (CONTRACT_V10 §1): two pets who love each other lay a family egg; the baby takes after its parents.
// DOM-free. Actions mutate the state passed in and return { ok, msg } / { ok:false, reason } like pets.js.
//
//   canBreed(state, a, b)        -> { ok, reason, poor? }   a / b = pet ids or pet objects (yard pets only)
//   breedCost(state, a, b)       -> { cost, baseCost, friendDiscount, bestFriends }   friendDiscount = coins saved (0 when not best friends)
//   breedPreview(state, aId, bId)-> { ok, reason, cost, friendDiscount, species, shinyChance, coats }   the UI's single source of odds
//   breed(state, aId, bId)       -> { ok, msg, egg }
//   putFamilyEggInIncubator(state, eggId), familyEggHatchMs(egg)
//   rollFamilyGenes(egg, rng?)   -> the baby's genes (pets.js hatchReady calls this when slot.family exists)
import { now, uid, formatDuration } from './util.js';
import { spendCoins, FAMILY_EGG_MAX } from './state.js';
import { EGGS } from './data/eggs.js';
import { SPECIES, RARITIES, getSpecies } from './data/species.js';
import { MUTATION_COATS, COAT_IDS } from './data/coats.js';
import { findPet, petName, bondHearts } from './pets.js';
import { bestFriendOf } from './friends.js';
import { journalEvent } from './journal.js';

export { FAMILY_EGG_MAX };
export const BREED_COOLDOWN_MS = 72 * 3600 * 1000;
export const BREED_UNLOCK_LEVEL = 6;
export const BREED_MIN_STAGE = 2;
export const BREED_MIN_HEARTS = 3;
export const BREED_COST_MULT = 3;    // x the dearer habitat egg (econ gate 1: no stardust pump)
export const BREED_FRIEND_MULT = 0.8;
/** Chance the baby is its parent's own species (otherwise a normal egg roll of that parent's habitat). */
export const INHERIT = { common: 1, uncommon: 0.85, rare: 0.6, epic: 0.3 };
export const SHINY_BASE = 0.03;
export const SHINY_PER_PARENT = 0.07;
export const SHINY_MAX = 0.17;
const SAME_COAT_KEEP = 0.8;     // both parents share a coat: 80 % that coat, 20 % mutation
const DIFF_COAT_EACH = 0.45;    // else 45 % / 45 %, 10 % mutation
const PERSONALITY_PARENT = 0.4; // 40 % A, 40 % B, 20 % random
const PERSONALITY_IDS = ['hardworking', 'lazy', 'glutton', 'cheerful', 'shy', 'naughty'];

const fail = reason => ({ ok: false, reason });
const nong = pet => `น้อง${petName(pet)}`;
const isObj = v => v !== null && typeof v === 'object';
// pet id or pet object -> the pet (a nursery baby too, so canBreed can say why it can't)
const resolve = (state, x) => (typeof x === 'string' ? (findPet(state, x) || {}).pet || null : isObj(x) ? x : null);
const habitatOf = pet => { const sp = getSpecies(pet.speciesId); return sp ? sp.habitat : null; };
const eggOfHabitat = h => EGGS.find(e => e.habitat === h) || null;

// ── Rules ───────────────────────────────────────────────────────────────────

/** Why this one pet cannot breed right now (a friendly Thai string), or '' when it can. */
function petBlocker(state, pet) {
  const sp = getSpecies(pet.speciesId);
  const who = nong(pet);
  if (!sp) return `${who}ไม่มีข้อมูลสายพันธุ์`;
  if (sp.rarity === 'legendary') return `${who}เป็นตำนาน มีได้แค่ตัวเดียวในโลก จึงมีลูกไม่ได้นะ`;
  if (pet.status === 'nursery' || !state.pets.includes(pet)) return `${who}ยังนอนอยู่ในเปล ต้องรับเข้าลานก่อนนะ`;
  if (pet.stage < BREED_MIN_STAGE) return `${who}ยังเด็กอยู่ ต้องโตเต็มวัยก่อนนะ`;
  if (bondHearts(pet) < BREED_MIN_HEARTS) return `${who}ต้องสนิทกับคุณถึง ${BREED_MIN_HEARTS} หัวใจก่อนนะ`;
  if (pet.sick) return `${who}ไม่สบายอยู่ ให้หายก่อนนะ`;
  if (pet.status === 'sleeping') return `${who}กำลังหลับอยู่ ปลุกก่อนนะ`;
  if (pet.status === 'working') return `${who}กำลังทำงานอยู่`;
  if (pet.status === 'expedition') return `${who}ออกสำรวจอยู่`;
  const wait = (Number(pet.breedReadyAt) || 0) - now();
  if (wait > 0) return `${who}ยังพักหลังมีลูก อีก ${formatDuration(wait)}`;
  return '';
}

/** Rules only: level, two different yard pets that are both ready, room for another family egg, and the coins. */
export function canBreed(state, a, b) {
  const pa = resolve(state, a), pb = resolve(state, b);
  if ((state.player.level || 1) < BREED_UNLOCK_LEVEL) return fail(`ต้องถึงเลเวล ${BREED_UNLOCK_LEVEL} ก่อนถึงจะมีลูกได้`);
  if (!pa || !pb) return fail('ไม่พบน้องตัวนี้');
  if (pa === pb || pa.id === pb.id) return fail('ต้องเลือกน้องสองตัวที่ต่างกันนะ');
  const why = petBlocker(state, pa) || petBlocker(state, pb);
  if (why) return fail(why);
  if ((state.familyEggs || []).length >= FAMILY_EGG_MAX) return fail(`ไข่ครอบครัวเต็มแล้ว (${FAMILY_EGG_MAX} ใบ) — ใส่ตู้ฟักก่อนนะ`);
  const { cost } = breedCost(state, pa, pb);
  if (!(cost > 0)) return fail('น้องคู่นี้ยังมีลูกไม่ได้นะ');   // a habitat without an egg price would make breeding free
  if ((state.player.coins || 0) < cost) return { ok: false, reason: `เหรียญไม่พอ (ต้องใช้ ${cost} 🪙)`, poor: true };
  return { ok: true, reason: '' };
}

/** BREED_COST_MULT x the dearer habitat egg of the two pets; best friends pay x BREED_FRIEND_MULT rounded to 10. */
export function breedCost(state, a, b) {
  const pa = resolve(state, a), pb = resolve(state, b);
  const price = pet => { const e = pet && eggOfHabitat(habitatOf(pet)); return e ? e.price : 0; };
  const baseCost = BREED_COST_MULT * Math.max(price(pa), price(pb));
  const best = !!(pa && pb && bestFriendOf(state, pa.id) === pb.id);
  const cost = best ? Math.round((baseCost * BREED_FRIEND_MULT) / 10) * 10 : baseCost;
  return { cost, baseCost, friendDiscount: baseCost - cost, bestFriends: best };
}

// ── Odds (preview and roll share these numbers) ─────────────────────────────

/** [{ species, p }] of a normal egg roll in a habitat: rarity weight split over the species of that rarity (same as pets.js). */
export function habitatSpeciesChances(habitat) {
  const list = SPECIES.filter(s => s.habitat === habitat);
  const perRarity = {};
  for (const s of list) perRarity[s.rarity] = (perRarity[s.rarity] || 0) + 1;
  const w = list.map(s => RARITIES[s.rarity].weight / perRarity[s.rarity]);
  const total = w.reduce((x, y) => x + y, 0) || 1;
  return list.map((species, i) => ({ species, p: w[i] / total }));
}

export const shinyChanceOf = (a, b) => Math.min(SHINY_MAX, SHINY_BASE + SHINY_PER_PARENT * ((a && a.shiny ? 1 : 0) + (b && b.shiny ? 1 : 0)));

const mutationTotal = MUTATION_COATS.reduce((n, c) => n + c.weight, 0);

/** [{ coat, chance }] for two parent coats (summing to 1, highest first). */
export function coatChances(coatA, coatB) {
  const m = new Map();
  const add = (coat, p) => m.set(coat, (m.get(coat) || 0) + p);
  const same = coatA === coatB;
  const mutate = same ? 1 - SAME_COAT_KEEP : 1 - 2 * DIFF_COAT_EACH;
  if (same) add(coatA, SAME_COAT_KEEP); else { add(coatA, DIFF_COAT_EACH); add(coatB, DIFF_COAT_EACH); }
  for (const c of MUTATION_COATS) add(c.id, (mutate * c.weight) / mutationTotal);
  return [...m].map(([coat, chance]) => ({ coat, chance })).sort((x, y) => y.chance - x.chance || COAT_IDS.indexOf(x.coat) - COAT_IDS.indexOf(y.coat));
}

const inheritOf = species => INHERIT[species.rarity] ?? 0;   // legendary (not in INHERIT) never passes on its species

/** Species odds of two parents: [{ speciesId (null = a fresh roll of the habitat), habitat, chance }] summing to 1. */
function speciesOdds(parents) {
  const out = new Map();
  const add = (speciesId, habitat, chance) => {
    const key = speciesId || `~${habitat}`;
    const e = out.get(key) || { speciesId, habitat, chance: 0 };
    e.chance += chance;
    out.set(key, e);
  };
  for (const p of parents) {
    const sp = getSpecies(p.speciesId);
    const inh = sp ? inheritOf(sp) : 0;
    if (inh > 0) add(p.speciesId, p.habitat, 0.5 * inh);
    if (inh < 1) add(null, p.habitat, 0.5 * (1 - inh));
  }
  return [...out.values()].sort((x, y) => y.chance - x.chance);
}

/**
 * Everything the partner picker shows for a pair: canBreed's verdict, the cost, and the odds of the baby.
 * The odds are given even when the pair cannot breed yet (as long as both pets exist and differ).
 */
export function breedPreview(state, aId, bId) {
  const pa = resolve(state, aId), pb = resolve(state, bId);
  const verdict = canBreed(state, pa || aId, pb || bId);
  const out = { ok: verdict.ok, reason: verdict.reason || '', cost: 0, friendDiscount: 0, bestFriends: false, species: [], shinyChance: 0, coats: [] };
  if (!pa || !pb || pa === pb) return out;
  Object.assign(out, breedCost(state, pa, pb));
  const snap = [snapshotParent(pa), snapshotParent(pb)];
  out.species = speciesOdds([{ speciesId: pa.speciesId, habitat: habitatOf(pa) }, { speciesId: pb.speciesId, habitat: habitatOf(pb) }]);
  out.shinyChance = shinyChanceOf(snap[0], snap[1]);
  out.coats = coatChances(snap[0].coat, snap[1].coat);
  return out;
}

// ── Laying ──────────────────────────────────────────────────────────────────

function snapshotParent(pet) {
  return {
    petId: pet.id, name: petName(pet), speciesId: pet.speciesId, personality: pet.personality, shiny: !!pet.shiny,
    coat: COAT_IDS.includes(pet.coat) ? pet.coat : 'base', gen: Number.isInteger(pet.family && pet.family.gen) ? pet.family.gen : 0,
  };
}

/** Lays a family egg: pays the cost, starts both parents' cooldown, journals it. */
export function breed(state, aId, bId) {
  const pa = resolve(state, aId), pb = resolve(state, bId);
  const can = canBreed(state, pa || aId, pb || bId);
  if (!can.ok) return fail(can.reason);
  const { cost, bestFriends } = breedCost(state, pa, pb);
  if (!spendCoins(state, cost)) return fail(`เหรียญไม่พอ (ต้องใช้ ${cost} 🪙)`);
  const t = now();
  const egg = { id: uid(), laidAt: t, habitatA: habitatOf(pa), habitatB: habitatOf(pb), a: snapshotParent(pa), b: snapshotParent(pb) };
  if (!Array.isArray(state.familyEggs)) state.familyEggs = [];
  state.familyEggs.push(egg);
  pa.breedReadyAt = pb.breedReadyAt = t + BREED_COOLDOWN_MS;
  journalEvent(state, 'familyEgg', { petId: pa.id, name: egg.a.name, other: egg.b.name });
  const msg = `💞 ${nong(pa)}กับ${nong(pb)}มีไข่ครอบครัวแล้ว! (${cost} 🪙${bestFriends ? ' · เพื่อนซี้ลดราคา' : ''})`;
  return { ok: true, msg, egg };
}

/** Hatch time of a family egg: 2 x the longer of the two habitat eggs. */
export function familyEggHatchMs(egg) {
  const ms = h => { const e = eggOfHabitat(h); return e ? e.hatchMs : 0; };
  return 2 * Math.max(ms(egg && egg.habitatA), ms(egg && egg.habitatB), 15 * 1000);
}

/** Moves a laid family egg into the incubator (normal capacity). */
export function putFamilyEggInIncubator(state, eggId) {
  const i = (state.familyEggs || []).findIndex(e => e && e.id === eggId);
  if (i < 0) return fail('ไม่พบไข่ครอบครัวใบนี้');
  if (state.incubator.length >= state.incubatorCapacity) return fail('ตู้ฟักเต็มแล้ว');
  const [egg] = state.familyEggs.splice(i, 1);
  const t = now();
  state.incubator.push({ eggId: 'egg_family', family: egg, startAt: t, readyAt: t + familyEggHatchMs(egg) });
  return { ok: true, msg: `🥚💞 ใส่ไข่ครอบครัวของ${egg.a.name}กับ${egg.b.name}ในตู้ฟักแล้ว รอสักครู่นะ`, egg };
}

// ── Hatching ────────────────────────────────────────────────────────────────

function pickIndex(weights, r) {
  const total = weights.reduce((x, y) => x + y, 0);
  let t = r * total;
  for (let i = 0; i < weights.length; i++) { t -= weights[i]; if (t < 0) return i; }
  return weights.length - 1;
}

/**
 * Rolls the baby's genes from a family egg snapshot (every random draw goes through rng, default Math.random):
 * { speciesId, inherited (true = the parent's own species), habitat (the parent habitat rolled), personality, shiny, coat, gen, family }.
 */
export function rollFamilyGenes(egg, rng = Math.random) {
  const [pa, pb] = [egg.a, egg.b];
  const fromA = rng() < 0.5;
  const parent = fromA ? pa : pb;
  const habitat = fromA ? egg.habitatA : egg.habitatB;
  const psp = getSpecies(parent.speciesId);
  let speciesId = parent.speciesId, inherited = true;
  if (!(psp && rng() < inheritOf(psp))) {
    inherited = false;
    const list = habitatSpeciesChances(habitat);
    speciesId = list.length ? list[pickIndex(list.map(x => x.p), rng())].species.id : parent.speciesId;
  }
  const rp = rng();
  const personality = rp < PERSONALITY_PARENT ? pa.personality : rp < 2 * PERSONALITY_PARENT ? pb.personality : PERSONALITY_IDS[Math.floor(rng() * PERSONALITY_IDS.length)];
  const shiny = rng() < shinyChanceOf(pa, pb);
  const rc = rng();
  const same = pa.coat === pb.coat;
  let coat;
  if (same ? rc < SAME_COAT_KEEP : rc < DIFF_COAT_EACH) coat = pa.coat;
  else if (!same && rc < 2 * DIFF_COAT_EACH) coat = pb.coat;
  else coat = MUTATION_COATS[pickIndex(MUTATION_COATS.map(c => c.weight), rng())].id;
  const gen = Math.max(pa.gen || 0, pb.gen || 0) + 1;
  return {
    speciesId, inherited, habitat, personality, shiny, coat, gen,
    family: { gen, a: { name: pa.name, speciesId: pa.speciesId }, b: { name: pb.name, speciesId: pb.speciesId } },
  };
}

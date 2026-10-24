// Pet logic: stats decay, care actions, incubator, growth.
// DOM-free. Mutates the state passed in; actions return { ok, msg } or { ok:false, reason }.

import { now, clamp, uid, randInt, pickWeighted, notify, addLog, todayKey } from './util.js';
import { addItem, removeItem, countItem, addCoins, addPlayerXp, bumpStat } from './state.js';
import { getItem, ITEMS } from './data/items.js';
import { EGGS, getEgg } from './data/eggs.js';
import { SPECIES, HABITATS, RARITIES, getSpecies } from './data/species.js';
import { getTraitDef, TRAIT_SCALE } from './data/traits.js';
import { CROPS } from './data/crops.js';

const HOUR = 3600 * 1000;

// ── Tunables (GAME_DESIGN §3) ───────────────────────────────────────────────
const RATE = {
  hunger: 6,        // per hour
  happy: 4,
  clean: 3,
  cleanPerPoop: 3,  // extra clean decay per poop
  energyIdle: 3,
  energySleep: 20,
  energyWork: 12,
};
const OFFLINE_DECAY = 0.5;        // decays only, regen is not halved
const SLEEP_DECAY = 0.5;          // other decays while sleeping
const POOP_EVERY_MS = 2 * HOUR;   // after eating
const MAX_POOP = 3;
const SICK_AFTER_MS = 2 * HOUR;   // hunger or clean stuck at 0
const SHINY_CHANCE = 0.03;
const RELEASE_COINS = 10;
const SHINY_COST = 100;           // stardust
const HABITAT_EGG_COST = 40;      // stardust
export const STARDUST_BY_RARITY = { common: 1, uncommon: 2, rare: 5, epic: 10, legendary: 25 };
const MAX_NAME_LEN = 16;

export const STAGES = [
  { nameTh: 'เบบี้',     icon: '🍼', xp: 0,   mult: 0.5 },
  { nameTh: 'วัยรุ่น',   icon: '🌱', xp: 25,  mult: 0.8 },
  { nameTh: 'โตเต็มวัย', icon: '🌳', xp: 200, mult: 1.0 },
  { nameTh: 'มาสเตอร์',  icon: '👑', xp: 600, mult: 1.3 },
];

// work: work power multiplier, hungerDecay/happyDecay/energyDrain: decay multipliers,
// poopSpeed: >1 = poops sooner, foodHappy/playHappy: bonus on happy gains.
export const PERSONALITIES = {
  hardworking: { nameTh: 'ขยัน',     emoji: '💪', desc: 'ทำงานได้ดีขึ้น 20%',                 work: 1.2,  hungerDecay: 1,   happyDecay: 1,   energyDrain: 1,   poopSpeed: 1,   foodHappy: 1,   playHappy: 1 },
  lazy:        { nameTh: 'ขี้เกียจ',  emoji: '😴', desc: 'ทำงานช้าลงนิดหน่อย แต่พลังงานหมดช้า', work: 0.85, hungerDecay: 1,   happyDecay: 1,   energyDrain: 0.7, poopSpeed: 1,   foodHappy: 1,   playHappy: 1 },
  glutton:     { nameTh: 'ตะกละ',    emoji: '🤤', desc: 'หิวเร็ว แต่กินแล้วมีความสุขมาก',      work: 1,    hungerDecay: 1.4, happyDecay: 1,   energyDrain: 1,   poopSpeed: 1,   foodHappy: 1.5, playHappy: 1 },
  cheerful:    { nameTh: 'ร่าเริง',   emoji: '😄', desc: 'ความสุขลดช้ากว่าใคร',               work: 1,    hungerDecay: 1,   happyDecay: 0.6, energyDrain: 1,   poopSpeed: 1,   foodHappy: 1,   playHappy: 1 },
  shy:         { nameTh: 'ขี้อาย',    emoji: '🙈', desc: 'ทำงานช้าลงนิดหน่อย แต่ชอบให้เล่นด้วย', work: 0.95, hungerDecay: 1,   happyDecay: 1,   energyDrain: 1,   poopSpeed: 1,   foodHappy: 1,   playHappy: 1.3 },
  naughty:     { nameTh: 'ซน',       emoji: '😈', desc: 'อึบ่อย แต่เล่นด้วยแล้วสนุกมาก',       work: 1,    hungerDecay: 1,   happyDecay: 1,   energyDrain: 1,   poopSpeed: 1.4, foodHappy: 1,   playHappy: 1.5 },
};
const PERSONALITY_IDS = Object.keys(PERSONALITIES);

const NICKNAMES = [
  'โมจิ', 'มะลิ', 'ข้าวปั้น', 'ถั่วแดง', 'ส้มโอ', 'บัว', 'ทองหยิบ', 'น้ำตาล', 'ปุยฝ้าย', 'มะนาว',
  'กะทิ', 'ลูกชิ้น', 'ไข่ตุ๋น', 'นมเย็น', 'ชาเขียว', 'ซาลาเปา', 'ฟักทอง', 'เฉาก๊วย', 'พุดซ้อน', 'หมึกแดง',
  'ขนมครก', 'มะม่วง', 'ลำไย', 'เจ้าตูบ', 'ป๊อปคอร์น', 'บราวนี่', 'ชานม', 'ข้าวโพด', 'ตังเม', 'แพนเค้ก',
];

// ── Small getters ───────────────────────────────────────────────────────────
export function getPet(state, petId) {
  return state.pets.find(p => p.id === petId) || null;
}

export function petEmoji(pet) {
  const sp = pet && getSpecies(pet.speciesId);
  return sp ? sp.emoji : '❓';
}

export function petName(pet) {
  if (!pet) return '';
  const sp = getSpecies(pet.speciesId);
  return pet.nickname || (sp ? sp.nameTh : 'น้องไร้ชื่อ');
}

const fail = reason => ({ ok: false, reason });
const ok = msg => ({ ok: true, msg });
const nong = pet => `น้อง${petName(pet)}`;

/** Emoji + label describing the pet's current mood (pure, for UI). */
export function petMood(pet) {
  const s = pet.stats;
  if (pet.sick) return { emoji: '🤒', text: 'ไม่สบาย' };
  if (pet.status === 'sleeping') return { emoji: '💤', text: 'กำลังหลับ' };
  if (s.hunger < 25) return { emoji: '😋', text: 'หิวจัง' };
  if (s.clean < 25 || pet.poop >= 2) return { emoji: '💢', text: 'ตัวเหม็นแล้ว' };
  if (s.happy < 25) return { emoji: '😢', text: 'เหงาจัง' };
  if (s.energy < 20) return { emoji: '🥱', text: 'เพลียมาก' };
  if (s.happy >= 80 && s.hunger >= 50) return { emoji: '💖', text: 'มีความสุข' };
  return { emoji: '🙂', text: 'สบายดี' };
}

// ── Growth ──────────────────────────────────────────────────────────────────
export function addPetXp(state, petId, n) {
  const pet = getPet(state, petId);
  if (!pet || !(n > 0)) return pet ? pet.stage : null;
  pet.xp += n;
  while (pet.stage < STAGES.length - 1 && pet.xp >= STAGES[pet.stage + 1].xp) {
    pet.stage += 1;
    const msg = `🎉 ${nong(pet)} โตเป็น${STAGES[pet.stage].nameTh}แล้ว!`;
    notify(msg, 'success');
    addLog(state, msg);
  }
  return pet.stage;
}

// ── Work helpers (used by farm.js) ──────────────────────────────────────────
export function canWork(pet) {
  if (!pet) return { ok: false, reason: 'ไม่พบน้องตัวนี้' };
  if (pet.status === 'sleeping') return { ok: false, reason: 'น้องกำลังนอนหลับอยู่' };
  if (pet.status === 'working') return { ok: false, reason: 'น้องกำลังทำงานอยู่แล้ว' };
  if (pet.status === 'expedition') return { ok: false, reason: 'น้องออกสำรวจอยู่' };
  if (pet.sick) return { ok: false, reason: 'น้องไม่สบาย ต้องรักษาก่อน' };
  if (pet.stats.energy < 20) return { ok: false, reason: 'น้องเหนื่อยเกินไป (พลังงานต่ำ)' };
  if (pet.stats.hunger < 15) return { ok: false, reason: 'น้องหิวเกินไป ให้อาหารก่อนนะ' };
  return { ok: true, reason: '' };
}

export function getWorkPower(pet, jobs, ctx) {
  const sp = getSpecies(pet.speciesId);
  let apt = 0;
  if (sp) for (const j of jobs || []) apt = Math.max(apt, sp.jobs[j] || 0);
  const stageMult = (STAGES[pet.stage] || STAGES[0]).mult;
  const happy = pet.stats.happy;
  const moodMult = happy >= 70 ? 1.2 : happy >= 30 ? 1.0 : 0.7;
  const persMult = (PERSONALITIES[pet.personality] || PERSONALITIES.cheerful).work;
  let power = (0.5 + apt) * stageMult * moodMult * persMult * (pet.shiny ? 1.1 : 1);
  // With a context (CONTRACT_V3) the species trait and bond hearts apply too.
  if (ctx) power *= traitEffect(pet, { jobs, ...ctx }).power * bondPowerMult(pet);
  return power;
}

// ── Traits (CONTRACT_V3 §2) ─────────────────────────────────────────────────
/** The pet's species trait with its rarity scale, or null. */
export function getTrait(pet) {
  const sp = pet && getSpecies(pet.speciesId);
  const def = sp && sp.trait ? getTraitDef(sp.trait) : null;
  return def ? { id: sp.trait, ...def, scale: TRAIT_SCALE[sp.rarity] || 1 } : null;
}

/**
 * Effect of the trait in a context { kind:'plot'|'expedition', jobs, zoneId, teamSize, hour }.
 * Rarity scales only the bonus part. Integer bonuses are +1, or +2 for epic/legendary.
 */
export function traitEffect(pet, ctx = {}) {
  const out = { power: 1, yieldBonus: 0, extraRolls: 0, eggChanceMult: 1 };
  const tr = getTrait(pet);
  if (!tr) return out;
  const hour = Number.isFinite(ctx.hour) ? ctx.hour : new Date(now()).getHours();
  const jobs = ctx.jobs || [];
  const plot = ctx.kind === 'plot';
  const trip = ctx.kind === 'expedition';
  const s = tr.scale;
  const whole = s >= 1.5 ? 2 : 1;
  switch (tr.id) {
    case 'nightOwl': if (hour >= 19 || hour < 6) out.power += 0.30 * s; break;
    case 'earlyBird': if (hour >= 5 && hour < 11) out.power += 0.30 * s; break;
    case 'sunLover': if (hour >= 11 && hour < 17) out.power += 0.25 * s; break;
    case 'waterLover': if ((plot && jobs.includes('water')) || (trip && ctx.zoneId === 'pond')) out.power += 0.25 * s; break;
    case 'digger': if ((plot && jobs.includes('dig')) || (trip && ctx.zoneId === 'mountain')) out.power += 0.25 * s; break;
    case 'teamPlayer': if (plot && (ctx.teamSize || 1) > 1) out.power += 0.10 * (ctx.teamSize - 1) * s; break;
    case 'loner': if (plot && (ctx.teamSize || 1) <= 1) out.power += 0.30 * s; break;
    case 'harvester': if (!trip) out.yieldBonus = whole; break;
    case 'forager': if (trip) out.extraRolls = whole; break;
    case 'lucky': if (trip) out.eggChanceMult = 1 + s; break;
    default: break; // tireless / gourmet act in tickPets / foodEffect
  }
  return out;
}

// ── Bond hearts (CONTRACT_V3 §3) ────────────────────────────────────────────
export const BOND_THRESHOLDS = [0, 20, 60, 120, 220, 360];
export const BOND_DAILY_CAP = 30;
export const GIFT_MIN_HEARTS = 3;

export function bondHearts(pet) {
  const b = (pet && pet.bond) || 0;
  let h = 0;
  for (let i = 0; i < BOND_THRESHOLDS.length; i++) if (b >= BOND_THRESHOLDS[i]) h = i;
  return h;
}

export function bondPowerMult(pet) {
  return 1 + 0.04 * bondHearts(pet);
}

/** Bond points that can still be earned today. */
export function bondRemainingToday(pet) {
  return pet.bondDay === todayKey() ? Math.max(0, BOND_DAILY_CAP - (pet.bondToday || 0)) : BOND_DAILY_CAP;
}

/** For the UI: hearts, points into the current heart, points needed for the next one. */
export function bondProgress(pet) {
  const hearts = bondHearts(pet);
  const points = pet.bond || 0;
  const remainingToday = bondRemainingToday(pet);
  if (hearts >= BOND_THRESHOLDS.length - 1) return { hearts, points, cur: 1, need: 1, pct: 100, max: true, remainingToday };
  const lo = BOND_THRESHOLDS[hearts];
  const need = BOND_THRESHOLDS[hearts + 1] - lo;
  const cur = points - lo;
  return { hearts, points, cur, need, pct: clamp((cur / need) * 100, 0, 100), max: false, remainingToday };
}

/** Adds bond points (daily cap 30 per pet). Returns the points actually gained. */
export function addBond(state, petId, n) {
  const pet = getPet(state, petId);
  if (!pet || !(n > 0)) return 0;
  const day = todayKey();
  if (pet.bondDay !== day) { pet.bondDay = day; pet.bondToday = 0; }
  const gain = Math.min(Math.floor(n), BOND_DAILY_CAP - (pet.bondToday || 0));
  if (gain <= 0) return 0;
  const before = bondHearts(pet);
  pet.bond = (pet.bond || 0) + gain;
  pet.bondToday = (pet.bondToday || 0) + gain;
  const after = bondHearts(pet);
  if (after > before) {
    const msg = `❤️ ${nong(pet)} สนิทกับคุณมากขึ้น (${after} หัวใจ)`;
    notify(msg, 'success');
    addLog(state, msg);
  }
  return gain;
}

export function giftAvailable(pet) {
  return bondHearts(pet) >= GIFT_MIN_HEARTS && pet.giftDay !== todayKey();
}

/** Once a day, a pet with 3+ hearts gives 1-2 items it likes (diet match, favorite more likely). */
export function claimGift(state, petId) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  if (bondHearts(pet) < GIFT_MIN_HEARTS) return fail(`ต้องสนิทถึง ${GIFT_MIN_HEARTS} หัวใจก่อนถึงจะมีของขวัญ`);
  if (pet.giftDay === todayKey()) return fail('วันนี้รับของขวัญจากน้องไปแล้ว พรุ่งนี้มาใหม่นะ');
  const sp = getSpecies(pet.speciesId);
  if (!sp) return fail('ไม่พบข้อมูลสายพันธุ์');
  const pool = Object.values(ITEMS).filter(it => it.food && it.type !== 'egg' &&
    (it.id === sp.favorite || ((it.sell || 0) <= 60 && (it.food.tags || []).some(t => sp.diet.includes(t)))));
  if (!pool.length) return fail('น้องยังไม่มีของขวัญให้');
  const got = {};
  const n = randInt(1, 2);
  for (let i = 0; i < n; i++) {
    const it = pickWeighted(pool, x => (x.id === sp.favorite ? 6 : 1));
    got[it.id] = (got[it.id] || 0) + 1;
  }
  for (const [id, c] of Object.entries(got)) addItem(state, id, c);
  pet.giftDay = todayKey();
  const text = Object.entries(got).map(([id, c]) => `${getItem(id).emoji} ${getItem(id).nameTh}${c > 1 ? ` ×${c}` : ''}`).join(', ');
  const msg = `🎁 ${nong(pet)} ให้ของขวัญ: ${text}`;
  addLog(state, msg);
  return { ok: true, msg, items: got };
}

// ── ลานให้ของ (CONTRACT_V6 §3) ──────────────────────────────────────────────
// Pets at home slowly produce coins and habitat items into state.yard; one tap collects them.
// Deterministic expected-value accumulation (no RNG, so reloading cannot farm luck), capped at 6 h of production.
export const YARD_BASE_COINS = { common: 3, uncommon: 4, rare: 6, epic: 9, legendary: 14 }; // coins / hour
export const YARD_ITEM_CHANCE = { rare: 0.05, epic: 0.08, legendary: 0.12 };                 // items / hour (others 0.03)
export const YARD_ITEM_CHANCE_DEFAULT = 0.03;
export const YARD_CAP_MS = 6 * HOUR;

const YARD_ITEMS = {
  farm: ['food_milk'], // + the seed of every unlocked crop (see yardItemTable)
  forest: ['forage_mushroom', 'forage_berry'],
  water: ['forage_shell', 'forage_fish'],
  sky: ['forage_feather'],
  bug: ['forage_honey'],
  savanna: ['forage_bone'],
  polar: ['forage_fish'],
  mystic: ['forage_star', 'forage_gem'],
};

/** state.yard with defaults in code (migration only has to provide { pending, items, lastAt }). */
export function ensureYard(state) {
  const y = state.yard && typeof state.yard === 'object' ? state.yard : (state.yard = { pending: 0, items: {}, lastAt: 0 });
  const good = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!good(y.pending)) y.pending = 0;
  if (!y.items || typeof y.items !== 'object' || Array.isArray(y.items)) y.items = {};
  for (const k of Object.keys(y.items)) if (!good(y.items[k])) delete y.items[k];
  if (!y.prog || typeof y.prog !== 'object' || Array.isArray(y.prog)) y.prog = {};   // habitat -> fractional expected items
  for (const k of Object.keys(y.prog)) if (!good(y.prog[k])) delete y.prog[k];       // NaN / negative would freeze that habitat
  y.accMs = good(y.accMs) ? Math.min(y.accMs, YARD_CAP_MS) : 0; // production time credited since the last collect (0..cap)
  y.n = good(y.n) ? Math.floor(y.n) : 0;                        // rotation counter through a habitat's item table
  return y;
}

/** Items a habitat can gift right now (farm also gifts seeds of the crops the player has unlocked). */
export function yardItemTable(state, habitat) {
  const base = (YARD_ITEMS[habitat] || []).filter(id => getItem(id));
  if (habitat !== 'farm') return base;
  const level = (state.player && state.player.level) || 1;
  const seeds = CROPS.filter(c => c.unlockLevel <= level).map(c => `seed_${c.id}`).filter(id => getItem(id));
  return base.concat(seeds);
}

/** Does this pet produce gifts right now? Returns coins/h and items/h (0 when it does not). */
export function yardOutput(pet) {
  const none = { coins: 0, items: 0, habitat: null };
  if (!pet || pet.sick || pet.status === 'working' || pet.status === 'expedition') return none;
  const sp = getSpecies(pet.speciesId);
  if (!sp) return none;
  const happy = (pet.stats && pet.stats.happy) || 0;
  const mood = happy >= 70 ? 1 : happy >= 30 ? 0.6 : 0.2;
  const sleepMult = pet.status === 'sleeping' ? 0.5 : 1;
  const coins = (YARD_BASE_COINS[sp.rarity] || 3) * (1 + 0.1 * bondHearts(pet)) * mood * sleepMult;
  const items = (YARD_ITEM_CHANCE[sp.rarity] ?? YARD_ITEM_CHANCE_DEFAULT) * mood * sleepMult;
  return { coins, items, habitat: sp.habitat };
}

/** Total yard production per hour: { coins, items:{habitat: n} }. */
export function yardRates(state) {
  const out = { coins: 0, items: {} };
  for (const pet of state.pets) {
    const o = yardOutput(pet);
    if (o.coins <= 0) continue;
    out.coins += o.coins;
    out.items[o.habitat] = (out.items[o.habitat] || 0) + o.items;
  }
  return out;
}

/** Called from tickPets (also during offline catch-up). Credits at most 6 h of production between collects. */
export function tickYard(state, dtMs) {
  const y = ensureYard(state);
  const dt = Math.max(0, Number(dtMs) || 0);
  const credit = Math.min(dt, Math.max(0, YARD_CAP_MS - y.accMs));
  y.lastAt = now();
  if (credit <= 0) return;
  const h = credit / HOUR;
  const r = yardRates(state);
  y.pending += r.coins * h;
  for (const [hab, perHour] of Object.entries(r.items)) y.prog[hab] = (y.prog[hab] || 0) + perHour * h;
  y.accMs += credit;
}

/** What a collect would give right now (pure): { coins, items:{id:n}, fill:0..1, perHour }. */
export function yardPreview(state) {
  const y = ensureYard(state);
  const items = {};
  let n = y.n;
  for (const [hab, v] of Object.entries(y.prog)) {
    const table = yardItemTable(state, hab);
    for (let k = Math.floor(v + 1e-9); k > 0 && table.length; k--) { const id = table[n++ % table.length]; items[id] = (items[id] || 0) + 1; }
  }
  return { coins: Math.floor(y.pending + 1e-9), items, fill: clamp(y.accMs / YARD_CAP_MS, 0, 1), perHour: yardRates(state).coins };
}

/** Collects everything the yard has stored. Not limited by the bond daily cap. */
export function collectYard(state) {
  const y = ensureYard(state);
  const pv = yardPreview(state);
  const itemCount = Object.values(pv.items).reduce((a, b) => a + b, 0);
  if (pv.coins <= 0 && itemCount <= 0) return fail('ยังไม่มีของขวัญจากลาน รอสักครู่นะ');
  // materialise the items (same rotation as the preview) and keep the fractional remainders
  const got = {};
  for (const [hab, v] of Object.entries(y.prog)) {
    const table = yardItemTable(state, hab);
    const whole = Math.floor(v + 1e-9);
    if (!table.length) continue;
    for (let k = 0; k < whole; k++) { const id = table[y.n++ % table.length]; got[id] = (got[id] || 0) + 1; }
    y.prog[hab] = Math.max(0, v - whole);
  }
  if (pv.coins > 0) { addCoins(state, pv.coins); y.pending = Math.max(0, y.pending - pv.coins); }
  for (const [id, c] of Object.entries(got)) addItem(state, id, c);
  y.accMs = 0;
  bumpStat(state, 'yardCollected');
  const parts = [];
  if (pv.coins > 0) parts.push(`🪙 ${pv.coins}`);
  for (const [id, c] of Object.entries(got)) { const it = getItem(id); parts.push(`${it.emoji} ${it.nameTh}${c > 1 ? ` ×${c}` : ''}`); }
  const msg = `🎁 ของขวัญจากลาน: ${parts.join(', ')}`;
  addLog(state, msg);
  return { ok: true, msg, coins: pv.coins, items: got };
}

/** "ประจำแปลง #N" + what the stationed pet is doing right now (for the yard sheet). null when not stationed. */
export function stationStatus(state, pet) {
  const st = pet && pet.station;
  if (!st || !Number.isFinite(st.plotIndex)) return null;
  const label = `ประจำแปลง #${st.plotIndex + 1}`;
  const plot = state.plots && state.plots[st.plotIndex];
  let emoji = '🏡', text = 'รอที่ลาน';
  if (pet.status === 'working') { emoji = '🌾'; text = 'กำลังทำงาน'; }
  else if (pet.status === 'expedition') { emoji = '🧭'; text = 'ออกสำรวจ'; }
  else if (pet.sick) { emoji = '🤒'; text = 'พักรักษาตัว'; }
  else if (pet.status === 'sleeping') { emoji = '💤'; text = 'พักผ่อน'; }
  else if (pet.stats.hunger < 15) { emoji = '😋'; text = 'หิว รอกินข้าว'; }
  else if (pet.stats.energy < 20) { emoji = '🥱'; text = 'เหนื่อย พักก่อน'; }
  else if (!plot || !plot.cropId || plot.progress >= 1) { emoji = '🏡'; text = 'รอที่ลาน (แปลงว่าง/พร้อมเก็บ)'; }
  else { emoji = '⏳'; text = 'พร้อมกลับไปทำงาน'; }
  return { label, emoji, text, plotIndex: st.plotIndex };
}

// ── Tick ────────────────────────────────────────────────────────────────────
export function tickPets(state, dtMs, { offline = false } = {}) {
  const dt = Math.max(0, dtMs || 0);
  if (dt > 0) for (const pet of state.pets) tickOnePet(pet, dt, offline);
  if (dt > 0) tickYard(state, dt);
  tickIncubator(state, now());
}

function tirelessFactor(pet) {
  const tr = getTrait(pet);
  return tr && tr.id === 'tireless' ? Math.max(0.3, 1 - 0.3 * tr.scale) : 1;
}

function tickOnePet(pet, dt, offline) {
  const h = dt / HOUR;
  const decay = offline ? OFFLINE_DECAY : 1;
  const p = PERSONALITIES[pet.personality] || PERSONALITIES.cheerful;
  const sleeping = pet.status === 'sleeping';
  const calm = sleeping ? SLEEP_DECAY : 1;
  const st = pet.stats;

  st.hunger -= RATE.hunger * h * decay * calm * p.hungerDecay;
  st.happy -= RATE.happy * h * decay * calm * p.happyDecay * (pet.sick ? 2 : 1);
  st.clean -= (RATE.clean + RATE.cleanPerPoop * pet.poop) * h * decay * calm;

  if (pet.status === 'working' || pet.status === 'expedition') {
    st.energy -= RATE.energyWork * h * decay * p.energyDrain * tirelessFactor(pet);
  } else if (sleeping) {
    st.energy += RATE.energySleep * h;
  } else {
    st.energy += RATE.energyIdle * h;
  }
  for (const k of ['hunger', 'happy', 'energy', 'clean']) st[k] = clamp(st[k], 0, 100);

  // Poop: a meal starts a timer (poopTimer, virtual ms so offline catch-up works).
  if (typeof pet.poopTimer === 'number') {
    pet.poopTimer += dt * p.poopSpeed;
    if (pet.poopTimer >= POOP_EVERY_MS) {
      if (pet.poop < MAX_POOP) pet.poop += 1;
      pet.poopTimer = null;
    }
  }

  // Sickness: hunger or clean at 0 for 2h in a row (zeroMs = virtual accumulated time).
  if (st.hunger <= 0 || st.clean <= 0) {
    if (pet.zeroSince == null) pet.zeroSince = now();
    pet.zeroMs = (pet.zeroMs || 0) + dt;
    if (!pet.sick && pet.zeroMs >= SICK_AFTER_MS) {
      pet.sick = true;
      if (sleeping) pet.status = 'idle';
      const msg = `🤒 ${nong(pet)} ไม่สบายแล้ว ต้องรักษาด้วยยา`;
      if (!offline) notify(msg, 'warn');
    }
  } else {
    pet.zeroSince = null;
    pet.zeroMs = 0;
  }

  // Fully rested pets wake up by themselves.
  if (pet.status === 'sleeping' && st.energy >= 100) {
    pet.status = 'idle';
    if (!offline) notify(`☀️ ${nong(pet)} ตื่นนอนแล้ว`, 'info');
  }
}

export function tickIncubator(state, nowMs) {
  for (const slot of state.incubator) {
    if (!slot.ready && nowMs >= slot.readyAt) {
      slot.ready = true;
      const egg = getEgg(slot.eggId);
      notify(`🥚 ${egg ? egg.nameTh : 'ไข่'} พร้อมฟักแล้ว!`, 'success');
    }
  }
}

// ── Incubator actions ───────────────────────────────────────────────────────
export function putEggInIncubator(state, eggId) {
  const egg = getEgg(eggId);
  if (!egg) return fail('ไม่รู้จักไข่ชนิดนี้');
  if (state.incubator.length >= state.incubatorCapacity) return fail('ตู้ฟักเต็มแล้ว');
  if (countItem(state, eggId) < 1) return fail('ไม่มีไข่ชนิดนี้ในกระเป๋า');
  if (!removeItem(state, eggId, 1)) return fail('ไม่มีไข่ชนิดนี้ในกระเป๋า');
  const t = now();
  state.incubator.push({ eggId, startAt: t, readyAt: t + egg.hatchMs });
  return ok(`🥚 ใส่${egg.nameTh}ในตู้ฟักแล้ว รอสักครู่นะ`);
}

function pickSpeciesForHabitat(habitat) {
  const list = SPECIES.filter(s => s.habitat === habitat);
  const perRarity = {};
  for (const s of list) perRarity[s.rarity] = (perRarity[s.rarity] || 0) + 1;
  // Rarity weight is split across the species sharing that rarity in the habitat.
  return pickWeighted(list, s => RARITIES[s.rarity].weight / perRarity[s.rarity]);
}

export function hatchReady(state, slotIndex) {
  const slot = state.incubator[slotIndex];
  if (!slot) return fail('ไม่พบไข่ในช่องนี้');
  if (now() < slot.readyAt) return fail('ไข่ยังไม่พร้อมฟัก');
  if (state.pets.length >= state.barnCapacity) return fail('ลานเต็มแล้ว! ขยายลานหรือปล่อยน้องบางตัวก่อน');
  const egg = getEgg(slot.eggId);
  const species = egg && pickSpeciesForHabitat(egg.habitat);
  if (!species) return fail('ไข่ใบนี้ฟักไม่ได้');

  const t = now();
  const pet = {
    id: uid(),
    speciesId: species.id,
    nickname: NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)],
    shiny: Math.random() < SHINY_CHANCE,
    personality: PERSONALITY_IDS[Math.floor(Math.random() * PERSONALITY_IDS.length)],
    stage: 0,
    xp: 0,
    stats: { hunger: 80, happy: 80, energy: 100, clean: 100 },
    poop: 0,
    sick: false,
    zeroSince: null,
    zeroMs: 0,
    poopTimer: null,
    lastFedAt: 0,
    bond: 0,
    bondDay: null,
    bondToday: 0,
    giftDay: null,
    status: 'idle',
    task: null,
    bornAt: t,
  };
  state.pets.push(pet);
  state.incubator.splice(slotIndex, 1);

  const entry = state.collection[species.id] || { owned: 0, shiny: false };
  entry.owned += 1;
  entry.shiny = entry.shiny || pet.shiny;
  state.collection[species.id] = entry;

  addPlayerXp(state, 10);
  bumpStat(state, 'hatched');
  const rar = RARITIES[species.rarity];
  const msg = `${pet.shiny ? '✨' : '🐣'} ฟักออกมาเป็น ${species.emoji} ${species.nameTh}` +
    `${pet.shiny ? ' ร่างไชนี่!' : ''} (${rar.nameTh}) ชื่อ "${pet.nickname}"`;
  addLog(state, msg);
  return { ok: true, msg, pet };
}

// ── Care actions ────────────────────────────────────────────────────────────
// Returns a reason string if the pet cannot be cared for right now, else null.
function careBlocker(pet, { allowWorking = true, allowSleeping = false } = {}) {
  if (!pet) return 'ไม่พบน้องตัวนี้';
  if (pet.status === 'expedition') return 'น้องออกสำรวจอยู่ ไม่อยู่ที่ลาน';
  if (pet.status === 'working' && !allowWorking) return 'น้องกำลังทำงานอยู่';
  if (pet.status === 'sleeping' && !allowSleeping) return 'น้องกำลังหลับอยู่ ปลุกก่อนนะ';
  return null;
}

/**
 * What feeding `item` would do to `pet` (single source of truth, also used for the UI preview).
 * Diet match = full effect, otherwise half; favorite = happy x2; glutton etc. via personality.
 */
function gourmetFactor(pet) {
  const tr = getTrait(pet);
  return tr && tr.id === 'gourmet' ? 1 + 0.5 * tr.scale : 1;
}

export function foodEffect(pet, item) {
  const sp = getSpecies(pet.speciesId);
  const p = PERSONALITIES[pet.personality] || PERSONALITIES.cheerful;
  const food = (item && item.food) || { hunger: 0, happy: 0, tags: [] };
  const tags = food.tags || [];
  const favorite = !!sp && !!item && sp.favorite === item.id;
  const match = favorite || (!!sp && sp.diet.some(t => tags.includes(t)));
  const mult = match ? 1 : 0.5;
  return {
    favorite,
    match,
    hunger: (food.hunger || 0) * mult,
    happy: (food.happy || 0) * mult * p.foodHappy * (favorite ? 2 : 1) * gourmetFactor(pet),
  };
}

export function feedPet(state, petId, itemId) {
  const pet = getPet(state, petId);
  const blocked = careBlocker(pet);
  if (blocked) return fail(blocked);
  const item = getItem(itemId);
  if (!item || !item.food) return fail('ของชิ้นนี้กินไม่ได้');
  if (countItem(state, itemId) < 1) return fail('ไม่มีของชิ้นนี้ในกระเป๋า');
  if (pet.stats.hunger >= 99.5) return fail('น้องอิ่มแล้ว กินไม่ไหวแล้ว');

  const { hunger, happy, favorite, match } = foodEffect(pet, item);
  if (!removeItem(state, itemId, 1)) return fail('ไม่มีของชิ้นนี้ในกระเป๋า');
  pet.stats.hunger = clamp(pet.stats.hunger + hunger, 0, 100);
  pet.stats.happy = clamp(pet.stats.happy + happy, 0, 100);
  pet.lastFedAt = now();
  if (typeof pet.poopTimer !== 'number') pet.poopTimer = 0;
  addPetXp(state, petId, 2);
  bumpStat(state, 'fed');
  addBond(state, petId, favorite ? 5 : 2);

  const note = favorite ? ' ของโปรดเลย! ⭐' : match ? ' ถูกปากมาก' : ' กินพอได้ (ไม่ใช่อาหารถนัด)';
  return ok(`${item.emoji} ${nong(pet)} กิน${item.nameTh}${note}`);
}

export function playWithPet(state, petId) {
  const pet = getPet(state, petId);
  const blocked = careBlocker(pet, { allowWorking: false });
  if (blocked) return fail(blocked);
  if (pet.sick) return fail('น้องไม่สบาย ไปรักษาก่อนนะ');
  if (pet.stats.energy < 10) return fail('น้องเหนื่อยเกินไป ให้พักก่อนนะ');
  if (pet.stats.happy >= 99.5) return fail('น้องมีความสุขเต็มแล้ว');
  const p = PERSONALITIES[pet.personality] || PERSONALITIES.cheerful;
  pet.stats.happy = clamp(pet.stats.happy + 20 * p.playHappy, 0, 100);
  pet.stats.energy = clamp(pet.stats.energy - 8, 0, 100);
  addPetXp(state, petId, 2);
  bumpStat(state, 'played');
  addBond(state, petId, 3);
  return ok(`🎾 ${nong(pet)} เล่นสนุกมาก! สุขเพิ่มขึ้น`);
}

export function cleanPet(state, petId) {
  const pet = getPet(state, petId);
  const blocked = careBlocker(pet);
  if (blocked) return fail(blocked);
  if (pet.poop === 0 && pet.stats.clean >= 99.5) return fail('น้องสะอาดเอี่ยมอยู่แล้ว');
  const hadPoop = pet.poop > 0;
  pet.poop = 0;
  let msg;
  // Soap is only spent when it actually helps (clean is noticeably low).
  if (pet.stats.clean < 90 && countItem(state, 'care_soap') > 0 && removeItem(state, 'care_soap', 1)) {
    pet.stats.clean = 100;
    msg = `🧼 อาบน้ำด้วยสบู่ ${nong(pet)} หอมสะอาดเอี่ยม!`;
  } else {
    pet.stats.clean = clamp(pet.stats.clean + 40, 0, 100);
    msg = `🚿 ${nong(pet)} ${hadPoop ? 'เก็บอึและ' : ''}อาบน้ำเรียบร้อย`;
  }
  addPetXp(state, petId, 1);
  bumpStat(state, 'cleaned');
  addBond(state, petId, 1);
  return ok(msg);
}

/** Clear poop only (no bath), a little clean back. */
export function pickPoop(state, petId) {
  const pet = getPet(state, petId);
  const blocked = careBlocker(pet, { allowSleeping: true });
  if (blocked) return fail(blocked);
  if (pet.poop <= 0) return fail('ไม่มีอึให้เก็บ');
  const n = pet.poop;
  pet.poop = 0;
  pet.stats.clean = clamp(pet.stats.clean + 5 * n, 0, 100);
  bumpStat(state, 'cleaned');
  addBond(state, petId, 1);
  return ok(`💩 เก็บอึของ${nong(pet)}แล้ว ${n} ก้อน`);
}

/** Pats left today for this pet (pat bookkeeping is optional: lastPatDay/patToday default to "none yet"). */
export const PAT_DAILY_MAX = 5;
export function patsLeftToday(pet) {
  return pet && pet.lastPatDay === todayKey() ? Math.max(0, PAT_DAILY_MAX - (pet.patToday || 0)) : PAT_DAILY_MAX;
}

/**
 * Stroke the pet's head (barn 3D tap). Max 5 rewarded pats per pet per day: +1 bond (through addBond, so the
 * 30/day bond cap still applies) and +3 happy. Extra pats are harmless but give nothing (rewarded:false).
 * The result has an empty msg on purpose: the heart effect is the feedback, not a toast.
 */
export function patPet(state, petId) {
  const pet = getPet(state, petId);
  const blocked = careBlocker(pet, { allowSleeping: true });
  if (blocked) return fail(blocked);
  if (patsLeftToday(pet) <= 0) return { ok: true, msg: '', rewarded: false, bond: 0, left: 0 };
  const day = todayKey();
  if (pet.lastPatDay !== day) { pet.lastPatDay = day; pet.patToday = 0; }
  pet.patToday = (pet.patToday || 0) + 1;
  pet.stats.happy = clamp(pet.stats.happy + 3, 0, 100);
  const bond = addBond(state, petId, 1);
  return { ok: true, msg: '', rewarded: true, bond, left: PAT_DAILY_MAX - pet.patToday };
}

export function giveToy(state, petId) {
  const pet = getPet(state, petId);
  const blocked = careBlocker(pet, { allowWorking: false });
  if (blocked) return fail(blocked);
  if (pet.sick) return fail('น้องไม่สบาย ไปรักษาก่อนนะ');
  if (pet.stats.happy >= 99.5) return fail('น้องมีความสุขเต็มแล้ว');
  if (!removeItem(state, 'care_toy', 1)) return fail('ไม่มีของเล่นในกระเป๋า (ซื้อได้ที่ร้านค้า)');
  const p = PERSONALITIES[pet.personality] || PERSONALITIES.cheerful;
  pet.stats.happy = clamp(pet.stats.happy + 40 * p.playHappy, 0, 100);
  addPetXp(state, petId, 2);
  bumpStat(state, 'played');
  addBond(state, petId, 4);
  return ok(`🧸 ${nong(pet)} ได้ของเล่นใหม่ ดีใจสุดๆ!`);
}

export function healPet(state, petId) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  if (!pet.sick) return fail('น้องไม่ได้ป่วย');
  if (!removeItem(state, 'care_medicine', 1)) return fail('ไม่มียาในกระเป๋า (ซื้อได้ที่ร้านค้า)');
  pet.sick = false;
  pet.zeroSince = null;
  pet.zeroMs = 0;
  // Make sure the cause is not still at 0, or the pet would relapse right away.
  pet.stats.hunger = Math.max(pet.stats.hunger, 10);
  pet.stats.clean = Math.max(pet.stats.clean, 10);
  return ok(`💊 ${nong(pet)} หายป่วยแล้ว!`);
}

export function toggleSleep(state, petId) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  if (pet.status === 'working') return fail('น้องกำลังทำงานอยู่ นอนไม่ได้');
  if (pet.status === 'expedition') return fail('น้องออกสำรวจอยู่ นอนไม่ได้');
  if (pet.status === 'sleeping') {
    pet.status = 'idle';
    return ok(`☀️ ปลุก${nong(pet)}แล้ว`);
  }
  if (pet.stats.energy >= 99.5) return fail(`${nong(pet)}ยังไม่ง่วง (พลังงานเต็ม)`);
  pet.status = 'sleeping';
  pet.task = null;
  return ok(`💤 ${nong(pet)} หลับฝันดีแล้ว`);
}

export function renamePet(state, petId, name) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  const clean = Array.from(String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .slice(0, MAX_NAME_LEN).join('').trim();
  if (!clean) return fail('ชื่อต้องไม่ว่างนะ');
  pet.nickname = clean;
  return ok(`✏️ ตั้งชื่อใหม่เป็น "${clean}" แล้ว`);
}

export function releasePet(state, petId) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  if (pet.status === 'working' || pet.status === 'expedition') return fail('น้องกำลังทำงานอยู่ ปล่อยไม่ได้');
  const sp = getSpecies(pet.speciesId);
  const dust = ((sp && STARDUST_BY_RARITY[sp.rarity]) || 1) * (pet.shiny ? 2 : 1);
  const label = nong(pet);
  state.pets.splice(state.pets.indexOf(pet), 1);
  addCoins(state, RELEASE_COINS);
  addStardust(state, dust);
  bumpStat(state, 'released');
  return ok(`👋 ปล่อย${label}กลับสู่ธรรมชาติแล้ว (ได้รับ ${RELEASE_COINS} 🪙 และผงดาว ${dust} ✨)`);
}

// ── Stardust ────────────────────────────────────────────────────────────────
export function addStardust(state, n) {
  if (!(n > 0)) return;
  state.stardust = (state.stardust || 0) + n;
}

/** Turn a pet into its shiny form for stardust. */
export function makeShiny(state, petId) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  if (pet.shiny) return fail('น้องเป็นร่างไชนี่อยู่แล้ว');
  if ((state.stardust || 0) < SHINY_COST) return fail(`ผงดาวไม่พอ (ต้องใช้ ${SHINY_COST} ✨)`);
  state.stardust -= SHINY_COST;
  pet.shiny = true;
  const entry = state.collection[pet.speciesId] || { owned: 1, shiny: false };
  entry.shiny = true;
  state.collection[pet.speciesId] = entry;
  const msg = `✨ ${nong(pet)} กลายเป็นร่างไชนี่แล้ว!`;
  addLog(state, msg);
  return ok(msg);
}

/** Buy an egg of a habitat with stardust (only if the egg is unlocked at the player's level). */
export function buyHabitatEgg(state, habitat) {
  const egg = EGGS.find(e => e.habitat === habitat);
  if (!egg) return fail('ไม่มีไข่ของถิ่นนี้');
  if ((state.player.level || 1) < egg.unlockLevel) return fail(`ต้องถึงเลเวล ${egg.unlockLevel} ก่อนถึงจะซื้อ${egg.nameTh}ได้`);
  if ((state.stardust || 0) < HABITAT_EGG_COST) return fail(`ผงดาวไม่พอ (ต้องใช้ ${HABITAT_EGG_COST} ✨)`);
  state.stardust -= HABITAT_EGG_COST;
  addItem(state, egg.id, 1);
  return ok(`🥚 แลก${egg.nameTh}ด้วยผงดาว ${HABITAT_EGG_COST} ✨ แล้ว`);
}

// ── Book milestones ─────────────────────────────────────────────────────────
const ownedIn = (state, list) => list.filter(sp => (state.collection[sp.id] || {}).owned > 0).length;

function makeGoals() {
  const goals = [];
  const add = (id, titleTh, need, count, reward) =>
    goals.push({ id, titleTh, need, reward, progress: s => Math.min(need, count(s)), check: s => count(s) >= need });

  for (const hid of Object.keys(HABITATS)) {
    const list = SPECIES.filter(sp => sp.habitat === hid);
    const h = HABITATS[hid];
    const egg = EGGS.find(e => e.habitat === hid);
    const count = s => ownedIn(s, list);
    add(`${hid}_3`, `${h.emoji} ${h.nameTh}: สะสมครบ 3 ชนิด`, 3, count, { coins: 100, stardust: 10 });
    add(`${hid}_6`, `${h.emoji} ${h.nameTh}: สะสมครบ 6 ชนิด`, 6, count, { coins: 250, stardust: 25 });
    add(`${hid}_all`, `${h.emoji} ${h.nameTh}: สะสมครบทุกชนิด (${list.length})`, list.length, count,
      { stardust: 50, items: egg ? { [egg.id]: 1 } : undefined });
  }
  const total = SPECIES.length;
  const all = s => ownedIn(s, SPECIES);
  add('species_25', '📖 สะสมครบ 25 ชนิด', 25, all, { coins: 300, stardust: 30 });
  add('species_50', '📖 สะสมครบ 50 ชนิด', 50, all, { coins: 800, stardust: 60, items: { egg_savanna: 1 } });
  add('species_all', `📖 สะสมครบทุกชนิด (${total})`, total, all, { coins: 5000, stardust: 300, items: { egg_mystic: 2 } });
  const shinyN = s => SPECIES.filter(sp => (s.collection[sp.id] || {}).shiny).length;
  add('shiny_first', '✨ ได้ร่างไชนี่ตัวแรก', 1, shinyN, { coins: 200, stardust: 20 });
  return goals;
}

export const BOOK_GOALS = makeGoals();

export function getGoal(goalId) {
  return BOOK_GOALS.find(g => g.id === goalId) || null;
}

export function isGoalClaimed(state, goalId) {
  return (state.claimedGoals || []).includes(goalId);
}

export function claimGoal(state, goalId) {
  const goal = getGoal(goalId);
  if (!goal) return fail('ไม่พบเป้าหมายนี้');
  if (isGoalClaimed(state, goalId)) return fail('รับรางวัลข้อนี้ไปแล้ว');
  if (!goal.check(state)) return fail('ยังไม่ถึงเกณฑ์ของเป้าหมายนี้');
  const r = goal.reward;
  if (r.coins) addCoins(state, r.coins);
  if (r.stardust) addStardust(state, r.stardust);
  for (const [id, n] of Object.entries(r.items || {})) addItem(state, id, n);
  if (!Array.isArray(state.claimedGoals)) state.claimedGoals = [];
  state.claimedGoals.push(goalId);
  const msg = `🎁 รับรางวัล "${goal.titleTh}" แล้ว!`;
  addLog(state, msg);
  return ok(msg);
}

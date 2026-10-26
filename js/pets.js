// Pet logic: stats decay, care actions, incubator, growth.
// DOM-free. Mutates the state passed in; actions return { ok, msg } or { ok:false, reason }.

import { now, clamp, uid, randInt, pickWeighted, notify, addLog, todayKey } from './util.js';
import { addItem, removeItem, countItem, addCoins, addPlayerXp, bumpStat, NURSERY_SLOTS, POSTCARDS_MAX } from './state.js';
import { getItem, ITEMS } from './data/items.js';
import { EGGS, getEgg } from './data/eggs.js';
import { SPECIES, HABITATS, RARITIES, getSpecies } from './data/species.js';
import { getTraitDef, TRAIT_SCALE } from './data/traits.js';
import { CROPS } from './data/crops.js';
import { hashId, favoriteSpot, FAV_LABEL, STROKE_MIN_MS } from './petBehaviour.js';
import { getAccessory } from './data/accessories.js';
import { COAT_IDS } from './data/coats.js';
import { limitedOf } from './data/limited.js';
import { TREAT_MS, favoriteDish } from './data/recipes.js';
import { rollFamilyGenes } from './breeding.js';
import { journalEvent } from './journal.js';
import { festivalEvent, festivalPostcardTemplates } from './festival.js';

import { tickFriends, bestFriendMap, bestFriendOf as bestFriendId, friendDecayMult, removePetFriends } from './friends.js';

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
// V18 คิดถึง / น้อยใจ (CONTRACT_V18 §1): hours since the last real play (or a toy)
export const MISS_AFTER_MS = 24 * HOUR;       // level 1 🥺 คิดถึง
export const SULK_AFTER_MS = 48 * HOUR;       // level 2 😢 น้อยใจ
const LONELY_HAPPY_DECAY = [1, 1.25, 1.5];
const HEARTSICK_AFTER_MS = 3 * HOUR;          // level 2 and happy <= 10 this long -> sick
export const PLAY_SCORE_MAX = 10;             // play-session points that still add happy (+2 each)
const SHINY_CHANCE = 0.03;
export const RELEASE_COINS = 10;
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
  if (pet.status === 'nursery') return { ok: false, reason: 'น้องยังนอนอยู่ในเปลอนุบาล' };
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
  // V16: dishes only come from the kitchen (a gifted dish would skip its ingredient cost and level)
  const pool = Object.values(ITEMS).filter(it => it.food && it.type !== 'egg' && it.type !== 'dish' &&
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

// ── ลานให้ของ (CONTRACT_V6 §3, per-pet since CONTRACT_V7 §4) ────────────────
// Every pet at home slowly produces coins and habitat items into its OWN gift (state.yard.byPet[petId]); tapping the
// pet collects it. Deterministic expected-value accumulation (no RNG, so reloading cannot farm luck), capped at 6 h
// of that pet's own production.
// coins / hour. Raised after V6 launch: common x2.7 .. legendary x1.3 (a yard of 20 maxed legendaries must stay < 20% of day-14 income).
export const YARD_BASE_COINS = { common: 8, uncommon: 10, rare: 12, epic: 15, legendary: 18 };
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

const goodNum = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isHome = pet => pet.status !== 'working' && pet.status !== 'expedition';

/** One pet's gift record, repaired in place: { c: coins (float), ms: credited ms <= cap, prog: item progress, items: {id:n}, n: rotation counter }. */
function fixGift(g) {
  if (!goodNum(g.c)) g.c = 0;
  g.ms = goodNum(g.ms) ? Math.min(g.ms, YARD_CAP_MS) : 0;
  if (!goodNum(g.prog)) g.prog = 0;
  if (!isPlain(g.items)) g.items = {};
  for (const k of Object.keys(g.items)) if (!goodNum(g.items[k]) || g.items[k] <= 0) delete g.items[k];
  g.n = goodNum(g.n) ? Math.floor(g.n) : 0;
  // A record sitting at the 6 h cap with nothing to collect would never be credited again (migration split / NaN reset):
  // a real capped record always holds at least a coin, so this one is stuck. Start its clock again.
  if (g.ms >= YARD_CAP_MS - 1 && g.c < 1 && !Object.keys(g.items).length) g.ms = 0;
  return g;
}

/** v4 -> v5 safety net (the real migration lives in state.js): splits an old global gift store across the pets at home. */
function absorbLegacyYard(state, y) {
  const legacy = ['pending', 'items', 'prog', 'accMs', 'n'].some(k => k in y);
  if (!legacy) return;
  const pets = state.pets.filter(isHome);
  const list = pets.length ? pets : state.pets;
  if (list.length && Object.keys(y.byPet).length) {
    // a stale v4 tab wrote into a v5 save: keep what it carried on the first pet at home
    const pending = goodNum(y.pending) ? y.pending : 0;
    const progSum = isPlain(y.prog) ? Object.values(y.prog).filter(goodNum).reduce((a, b) => a + b, 0) : 0;
    const g = y.byPet[list[0].id] || (y.byPet[list[0].id] = fixGift({}));
    fixGift(g);
    g.c += pending; g.prog += progSum;
    if (isPlain(y.items)) for (const [id, c] of Object.entries(y.items)) if (goodNum(c) && c > 0) g.items[id] = (g.items[id] || 0) + Math.floor(c);
  } else if (list.length) {
    const pending = goodNum(y.pending) ? y.pending : 0;
    const progSum = isPlain(y.prog) ? Object.values(y.prog).filter(goodNum).reduce((a, b) => a + b, 0) : 0;
    const share = pending / list.length, progShare = progSum / list.length;
    list.forEach((pet, i) => {
      y.byPet[pet.id] = fixGift({ c: i === 0 ? pending - share * (list.length - 1) : share, ms: goodNum(y.accMs) ? y.accMs : 0, prog: progShare, items: {} });
    });
    if (isPlain(y.items)) {
      let i = 0;
      for (const [id, c] of Object.entries(y.items)) {
        for (let k = Math.floor(goodNum(c) ? c : 0); k > 0; k--) {
          const g = y.byPet[list[i++ % list.length].id];
          g.items[id] = (g.items[id] || 0) + 1;
        }
      }
    }
  }
  for (const k of ['pending', 'items', 'prog', 'accMs', 'n']) delete y[k];
}

/** state.yard with defaults in code (migration only has to provide { byPet, lastAt }); drops gifts of pets that are gone. */
export function ensureYard(state) {
  const y = isPlain(state.yard) ? state.yard : (state.yard = { byPet: {}, lastAt: 0 });
  if (!isPlain(y.byPet)) y.byPet = {};
  if (!goodNum(y.lastAt)) y.lastAt = 0;
  absorbLegacyYard(state, y);
  const ids = new Set(state.pets.map(p => p.id));
  for (const k of Object.keys(y.byPet)) {
    if (!ids.has(k) || !isPlain(y.byPet[k])) delete y.byPet[k]; else fixGift(y.byPet[k]);
  }
  return y;
}

const giftEntry = (y, petId) => y.byPet[petId] || (y.byPet[petId] = fixGift({}));

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
  // V12: a Limited gift pet gives no yard gifts (an extra legendary from minute one pushed the yard over 20% of day-1 income)
  if (!pet || limitedOf(pet) || pet.sick || pet.status === 'working' || pet.status === 'expedition' || pet.status === 'nursery') return none;
  const sp = getSpecies(pet.speciesId);
  if (!sp) return none;
  const happy = (pet.stats && pet.stats.happy) || 0;
  const mood = happy >= 70 ? 1 : happy >= 30 ? 0.6 : 0.2;
  const sleepMult = pet.status === 'sleeping' ? 0.5 : 1;
  const coins = (YARD_BASE_COINS[sp.rarity] || YARD_BASE_COINS.common) * (1 + 0.1 * bondHearts(pet)) * mood * sleepMult;
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

/** Whole item progress becomes held items right away, rotating through the habitat's table from a per-pet start. */
function materialiseItems(state, pet, g) {
  const sp = getSpecies(pet.speciesId);
  const table = sp ? yardItemTable(state, sp.habitat) : [];
  if (!table.length) { g.prog = 0; return; }
  const start = hashId(pet.id) % table.length;
  while (g.prog >= 1 - 1e-9) {
    const id = table[(start + g.n++) % table.length];
    g.items[id] = (g.items[id] || 0) + 1;
    g.prog -= 1;
  }
  if (g.prog < 0) g.prog = 0;
}

/** Called from tickPets (also during offline catch-up). Each pet credits at most 6 h of its own production between collects. */
export function tickYard(state, dtMs) {
  const y = ensureYard(state);
  const dt = Math.max(0, Number(dtMs) || 0);
  y.lastAt = now();
  for (const pet of state.pets) {   // (a migrated save can arrive with progress >= 1: turn it into held items first)
    const held = y.byPet[pet.id];
    if (held && held.prog >= 1 - 1e-9) materialiseItems(state, pet, held);
  }
  if (dt <= 0) return;
  for (const pet of state.pets) {
    const o = yardOutput(pet);
    if (o.coins <= 0) continue;
    const g = giftEntry(y, pet.id);
    const credit = Math.min(dt, Math.max(0, YARD_CAP_MS - g.ms));
    if (credit <= 0) continue;
    const h = credit / HOUR;
    g.c += o.coins * h;
    g.prog += o.items * h;
    g.ms += credit;
    materialiseItems(state, pet, g);
  }
}

const countItems = items => Object.values(items).reduce((a, b) => a + b, 0);

/** What tapping this pet would give right now (pure read): { coins, items, itemCount, fill:0..1, full, has }. */
export function petGift(state, petId) {
  const g = state.yard && state.yard.byPet && state.yard.byPet[petId];
  if (!isPlain(g)) return { coins: 0, items: {}, itemCount: 0, fill: 0, full: false, has: false };
  const coins = goodNum(g.c) ? Math.floor(g.c + 1e-9) : 0;
  const items = {};
  if (isPlain(g.items)) for (const [id, c] of Object.entries(g.items)) if (goodNum(c) && c > 0) items[id] = c;
  const itemCount = countItems(items);
  const ms = goodNum(g.ms) ? Math.min(g.ms, YARD_CAP_MS) : 0;
  return {
    coins, items, itemCount, fill: clamp(ms / YARD_CAP_MS, 0, 1), full: ms >= YARD_CAP_MS - 1, has: coins >= 1 || itemCount > 0,
    big: itemCount > 0 || (coins >= 1 && ms >= HOUR),   // worth a 🎁 over the pet in 3D: an item, or 1 h+ of its own production
  };
}

/** Aggregate of every pet's gift (pure): { coins, items:{id:n}, fill (fullest pet), perHour, pets (with a gift), fullPets }. */
export function yardPreview(state) {
  const items = {};
  let coins = 0, fill = 0, pets = 0, fullPets = 0;
  for (const pet of state.pets) {
    const g = petGift(state, pet.id);
    if (!g.has) continue;
    pets++;
    if (g.full) fullPets++;
    coins += g.coins;
    fill = Math.max(fill, g.fill);
    for (const [id, c] of Object.entries(g.items)) items[id] = (items[id] || 0) + c;
  }
  return { coins, items, fill, perHour: yardRates(state).coins, pets, fullPets };
}

/** Moves one pet's stored gift into the player's wallet / bag. Returns { coins, items } (nothing when empty). */
function takeGift(state, y, petId) {
  const g = giftEntry(y, petId);
  const coins = Math.floor(g.c + 1e-9);
  const items = { ...g.items };
  if (coins <= 0 && !countItems(items)) return { coins: 0, items: {} };
  if (coins > 0) { addCoins(state, coins); g.c = Math.max(0, g.c - coins); }
  for (const [id, c] of Object.entries(items)) addItem(state, id, c);
  g.items = {};
  g.ms = 0;
  return { coins, items };
}

const giftParts = (coins, items) => {
  const parts = [];
  if (coins > 0) parts.push(`🪙 ${coins}`);
  for (const [id, c] of Object.entries(items)) { const it = getItem(id); if (it) parts.push(`${it.emoji} ${it.nameTh}${c > 1 ? ` ×${c}` : ''}`); }
  return parts.join(', ');
};

/** Collects ONE pet's gift (tap on the pet). Not limited by the bond daily cap. */
export function collectPetGift(state, petId) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  const y = ensureYard(state);
  const { coins, items } = takeGift(state, y, petId);
  if (coins <= 0 && !countItems(items)) return fail(`${nong(pet)}ยังไม่มีของขวัญ รอสักครู่นะ`);
  bumpStat(state, 'yardCollected');
  return { ok: true, msg: `🎁 ${nong(pet)} ให้ของขวัญ: ${giftParts(coins, items)}`, petId, coins, items };
}

/** Collects every pet's gift at once (the "🎁 N" chip). */
export function collectYard(state) {
  const y = ensureYard(state);
  const got = {};
  let coins = 0, pets = 0;
  const gifts = [];
  for (const pet of state.pets) {
    if (!petGift(state, pet.id).has) continue;
    const r = takeGift(state, y, pet.id);
    if (r.coins <= 0 && !countItems(r.items)) continue;
    pets++;
    coins += r.coins;
    gifts.push({ petId: pet.id, coins: r.coins, items: r.items });
    for (const [id, c] of Object.entries(r.items)) got[id] = (got[id] || 0) + c;
  }
  if (!pets) return fail('ยังไม่มีของขวัญจากน้องๆ รอสักครู่นะ');
  bumpStat(state, 'yardCollected');
  const msg = `🎁 ของขวัญจากน้อง ${pets} ตัว: ${giftParts(coins, got)}`;
  addLog(state, msg);
  return { ok: true, msg, coins, items: got, pets, gifts };
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
export function tickPets(state, dtMs, { offline = false, t = now() } = {}) {   // t: the time this step ends (catch-up replays past steps)
  const dt = Math.max(0, dtMs || 0);
  if (dt > 0) {
    const bf = bestFriendMap(state);   // happiness decays x0.8 while the best friend is home too (friends.js owns the rule)
    for (const pet of state.pets) tickOnePet(pet, dt, offline, friendDecayMult(state, pet, bf), t);
    try { tickFriends(state, dt, { offline }); } catch (e) { console.error('tickFriends failed', e); }
  }
  if (dt > 0) tickYard(state, dt);
  tickIncubator(state, now());
  tickPostcards(state, offline);
}

function tirelessFactor(pet) {
  const tr = getTrait(pet);
  return tr && tr.id === 'tireless' ? Math.max(0.3, 1 - 0.3 * tr.scale) : 1;
}

function tickOnePet(pet, dt, offline, happyMult = 1, t = now()) {
  const h = dt / HOUR;
  const decay = offline ? OFFLINE_DECAY : 1;
  const p = PERSONALITIES[pet.personality] || PERSONALITIES.cheerful;
  const sleeping = pet.status === 'sleeping';
  const calm = sleeping ? SLEEP_DECAY : 1;
  const st = pet.stats;

  st.hunger -= RATE.hunger * h * decay * calm * p.hungerDecay;
  const lonely = lonelyLevel(pet, t);
  st.happy -= RATE.happy * h * decay * calm * p.happyDecay * (pet.sick ? 2 : 1) * happyMult * LONELY_HAPPY_DECAY[lonely];
  st.clean -= (RATE.clean + RATE.cleanPerPoop * pet.poop) * h * decay * calm;

  if (pet.status === 'working' || pet.status === 'expedition') {
    // V18: busy pets don't count the time without play (a stationed worker can't come to play); only time at home does
    if (Number.isFinite(pet.playedAt)) pet.playedAt = Math.min(t, pet.playedAt + dt);
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
    if (!pet.sick && pet.zeroMs >= SICK_AFTER_MS / (lonely === 2 ? 2 : 1)) {   // V18: a sulking pet falls ill twice as fast
      pet.sick = true;
      if (sleeping) pet.status = 'idle';
      const msg = `🤒 ${nong(pet)} ไม่สบายแล้ว ต้องรักษาด้วยยา`;
      if (!offline) notify(msg, 'warn');
    }
  } else {
    pet.zeroSince = null;
    pet.zeroMs = 0;
  }

  // V18 ป่วยใจ: sulking (level 2) with happy <= 10 for 3 h in a row
  if (lonely === 2 && st.happy <= 10 && !pet.sick) {
    pet.heartsickMs = (pet.heartsickMs || 0) + dt;
    if (pet.heartsickMs >= HEARTSICK_AFTER_MS) {
      pet.sick = true;
      pet.heartsickMs = 0;
      if (sleeping) pet.status = 'idle';
      if (!offline) notify(`🤒 ${nong(pet)} น้อยใจจนไม่สบาย 😢 รักษาแล้วเล่นด้วยกันนะ`, 'warn');
    }
  } else if (lonely < 2 || st.happy > 10) {
    pet.heartsickMs = 0;
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

/** V17 สมุดสีขน: remember that this species has been seen in this coat. */
export function markCoatBook(state, speciesId, coat) {
  if (!state.coatBook || typeof state.coatBook !== 'object') state.coatBook = {};
  (state.coatBook[speciesId] || (state.coatBook[speciesId] = {}))[coat] = true;
}

export function hatchReady(state, slotIndex) {
  const slot = state.incubator[slotIndex];
  if (!slot) return fail('ไม่พบไข่ในช่องนี้');
  if (now() < slot.readyAt) return fail('ไข่ยังไม่พร้อมฟัก');
  // A full yard hatches into the nursery (CONTRACT_V7 §5); only "yard AND nursery full" blocks it.
  const toNursery = state.pets.length >= state.barnCapacity;
  if (toNursery && ensureNursery(state).length >= NURSERY_SLOTS) return fail('เปลเต็มแล้ว! ลานก็เต็มด้วย — ขยายลาน หรือส่งน้องบางตัวไปบ้านใหม่ก่อนนะ');
  const egg = getEgg(slot.eggId);
  // A family egg (CONTRACT_V10) rolls its genes now from the parents' snapshot; a normal egg picks a species of its habitat.
  const genes = slot.family ? rollFamilyGenes(slot.family) : null;
  const species = genes ? getSpecies(genes.speciesId) : egg && egg.legend ? pickWeighted(SPECIES.filter(s => s.rarity === 'legendary'), () => 1) : egg && pickSpeciesForHabitat(egg.habitat);
  if (!species) return fail('ไข่ใบนี้ฟักไม่ได้');

  const t = now();
  const pet = {
    id: uid(),
    speciesId: species.id,
    nickname: NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)],
    shiny: genes ? genes.shiny : Math.random() < SHINY_CHANCE,
    personality: genes ? genes.personality : PERSONALITY_IDS[Math.floor(Math.random() * PERSONALITY_IDS.length)],
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
    status: toNursery ? 'nursery' : 'idle',
    task: null,
    station: null,
    bornAt: t,
    playedAt: t,
  };
  if (genes) Object.assign(pet, { coat: genes.coat, family: genes.family, breedReadyAt: 0 });
  if (toNursery) state.nursery.push({ pet, hatchedAt: t }); else state.pets.push(pet);
  state.incubator.splice(slotIndex, 1);

  const entry = state.collection[species.id] || { owned: 0, shiny: false };
  entry.owned += 1;
  entry.shiny = entry.shiny || pet.shiny;
  state.collection[species.id] = entry;
  markCoatBook(state, species.id, 'base');

  addPlayerXp(state, 10);
  bumpStat(state, 'hatched');
  festivalEvent(state, 'hatch', { speciesId: species.id });
  if (genes) {
    bumpStat(state, 'bred');
    if (!state.coatsSeen || typeof state.coatsSeen !== 'object') state.coatsSeen = { base: true };
    state.coatsSeen[genes.coat] = true;
    markCoatBook(state, species.id, genes.coat);
    journalEvent(state, 'familyHatch', { petId: pet.id, name: genes.family.a.name, other: genes.family.b.name });
  }
  const rar = RARITIES[species.rarity];
  const msg = `${pet.shiny ? '✨' : '🐣'} ฟักออกมาเป็น ${species.emoji} ${species.nameTh}` +
    `${pet.shiny ? ' ร่างไชนี่!' : ''} (${rar.nameTh}) ชื่อ "${pet.nickname}"` +
    `${genes ? ` ลูกของ ${genes.family.a.name} กับ ${genes.family.b.name} 💞` : ''}` +
    `${toNursery ? ' — ลานเต็ม เลยพักในเปลอนุบาล 👶' : ''}`;
  addLog(state, msg);
  return { ok: true, msg, pet, nursery: toNursery };
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
  if (favorite) festivalEvent(state, 'feed', { petId });

  // V16 dish: a look only (😋 treat glow) + the species' favourite dish discovery; bond stays as for any food (CONTRACT_V16 §1)
  let favDish = false;
  if (item.type === 'dish') {
    pet.treat = { id: item.id, until: now() + TREAT_MS };
    const fav = favoriteDish(getSpecies(pet.speciesId));
    favDish = !!fav && fav.id === item.id;
    if (favDish && !pet.favDishKnown) {
      pet.favDishKnown = true;
      journalEvent(state, 'favDish', { petId, acc: item.nameTh });
    }
  }

  const note = favDish ? ' เมนูโปรดเลย! 💕' : favorite ? ' ของโปรดเลย! ⭐' : match ? ' ถูกปากมาก' : ' กินพอได้ (ไม่ใช่อาหารถนัด)';
  const r = ok(`${item.emoji} ${nong(pet)} กิน${item.nameTh}${note}${item.type === 'dish' ? ' 😋' : ''}`);
  if (item.type === 'dish') Object.assign(r, { dish: item.id, favDish });
  return r;
}

/** V18: why this pet can't start a play session right now (a Thai sentence), or null. Checked before the play mode opens. */
export function playBlocker(state, petId) {
  const pet = getPet(state, petId);
  const blocked = careBlocker(pet, { allowWorking: false });
  if (blocked) return blocked;
  if (pet.sick) return 'น้องไม่สบาย ไปรักษาก่อนนะ';
  if (pet.stats.energy < 10) return 'น้องเหนื่อยเกินไป ให้พักก่อนนะ';
  return null;
}

/** V18: 0 fine, 1 🥺 คิดถึง (24 h without play or a toy), 2 😢 น้อยใจ (48 h). Nursery babies sleep through it. */
export function lonelyLevel(pet, t = now()) {
  if (!pet || pet.status === 'nursery') return 0;
  const since = t - (Number.isFinite(pet.playedAt) ? pet.playedAt : t);
  return since >= SULK_AFTER_MS ? 2 : since >= MISS_AFTER_MS ? 1 : 0;
}

/**
 * V18 a real play session (the zoomed-in play mode, js/ui/playGame.js): resets คิดถึง, happy +20 (+2 per point, at most
 * PLAY_SCORE_MAX points), bond +3 (+1 per 5 points, at most +2; the daily bond cap still applies). Allowed with full happy.
 */
export function playSession(state, petId, score = 0) {
  const pet = getPet(state, petId);
  const blocked = playBlocker(state, petId);
  if (blocked) return fail(blocked);
  const pts = Math.max(0, Math.min(PLAY_SCORE_MAX, Math.floor(Number(score) || 0)));
  const p = PERSONALITIES[pet.personality] || PERSONALITIES.cheerful;
  const wasLonely = lonelyLevel(pet);
  pet.stats.happy = clamp(pet.stats.happy + (20 + 2 * pts) * p.playHappy, 0, 100);
  pet.stats.energy = clamp(pet.stats.energy - 8, 0, 100);
  pet.playedAt = now();
  pet.heartsickMs = 0;
  addPetXp(state, petId, 2 + Math.floor(pts / 3));
  bumpStat(state, 'played');
  addBond(state, petId, 3 + Math.min(2, Math.floor(pts / 5)));
  const mood = wasLonely === 2 ? ' หายน้อยใจแล้ว 💞' : wasLonely === 1 ? ' หายคิดถึงแล้ว 💕' : '';
  return { ok: true, msg: `🎾 เล่นกับ${nong(pet)}สนุกมาก! ได้ ${pts} แต้ม${mood}`, score: pts };
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
  pet.playedAt = now();
  pet.heartsickMs = 0;
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
  festivalEvent(state, 'pat', { petId });
  return { ok: true, msg: '', rewarded: true, bond, left: PAT_DAILY_MAX - pet.patToday };
}

/**
 * One stroke session on a pet (CONTRACT_V8 §1): rewards exactly like ONE pat (patPet: 5 a day, +1 bond through the
 * 30/day cap), and only when the stroke lasted STROKE_MIN_MS. `region` is the spot stroked ('head' | 'chin' | 'back'):
 * the pet's favourite one gives the discovery (pet.favKnown, saved) the first time. Never wakes a sleeping pet.
 */
export function strokePet(state, petId, { durationMs = 0, region = null } = {}) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  const long = Number(durationMs) >= STROKE_MIN_MS;
  const r = long ? patPet(state, petId) : { ok: true, msg: '', rewarded: false, bond: 0, left: patsLeftToday(pet) };
  if (!r.ok) return r;
  const out = { ...r, committed: long, favorite: false, discovered: false, region };
  if (long && region && region === favoriteSpot(pet.id)) {
    out.favorite = true;
    if (!pet.favKnown) {
      pet.favKnown = true;
      out.discovered = true;
      out.msg = `ค้นพบแล้ว! ${petName(pet)} ชอบให้${FAV_LABEL[region]} 💕`;
    }
  }
  return out;
}

// ── แต่งตัวน้อง 👗 (CONTRACT_V9 §1) ─────────────────────────────────────────────────────────────────────────
// state.wardrobe { accId: count } = copies OWNED (worn ones included, state v7); pet.wear = { head, neck } names the worn ids and
// each owned copy is worn by one pet at a time. A pet that leaves (rehome) simply stops wearing: its copies are free again.
// Purely cosmetic; the only effect is a tiny happy bump the first time a pet is dressed each day (normal happy stat, no bond).
export const WEAR_HAPPY = 5;
export const WEAR_SLOTS = ['head', 'neck'];

export function wearOf(pet) {
  return (pet && pet.wear && typeof pet.wear === 'object') ? pet.wear : {};
}

/** Copies of an accessory worn right now by yard pets and nursery babies. */
export function wornCount(state, accId) {
  let n = 0;
  const all = [...(state.pets || []), ...((state.nursery || []).map(e => e && e.pet))];
  for (const p of all) for (const slot of WEAR_SLOTS) if (wearOf(p)[slot] === accId) n++;
  return n;
}

/** Copies owned and free (not worn by anybody). */
export function wardrobeCount(state, accId) {
  const owned = Math.max(0, Math.floor(Number(state && state.wardrobe && state.wardrobe[accId]) || 0));
  return Math.max(0, owned - wornCount(state, accId));
}

/** [{ acc, n }] of every accessory with a free copy, head items first. */
export function wardrobeList(state) {
  const out = [];
  for (const id of Object.keys((state && state.wardrobe) || {})) {
    const acc = getAccessory(id), n = wardrobeCount(state, id);
    if (acc && n > 0) out.push({ acc, n });
  }
  return out.sort((a, b) => (a.acc.slot === b.acc.slot ? 0 : a.acc.slot === 'head' ? -1 : 1) || a.acc.nameTh.localeCompare(b.acc.nameTh, 'th'));
}

/** A pet that leaves for a new home hands its accessories back (they were never removed from the wardrobe, so this only clears the pet). */
export function returnWear(state, pet) {
  if (pet) pet.wear = { head: null, neck: null };
}

/** Dresses a pet. A worn item of the same slot goes back to the wardrobe. { ok, msg, acc, firstToday } */
export function wearAccessory(state, petId, accId) {
  const pet = getPet(state, petId);
  const acc = getAccessory(accId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  if (!acc) return fail('ไม่รู้จักของชิ้นนี้');
  if (wearOf(pet)[acc.slot] === accId) return fail(`${nong(pet)}ใส่${acc.nameTh}อยู่แล้ว`);
  if (wardrobeCount(state, accId) <= 0) return fail(`ไม่มี${acc.nameTh}ว่างในตู้เสื้อผ้า`);
  pet.wear = { head: null, neck: null, ...wearOf(pet), [acc.slot]: accId };
  const day = todayKey();
  const firstToday = pet.wearHappyDay !== day;
  if (firstToday) { pet.wearHappyDay = day; pet.stats.happy = clamp(pet.stats.happy + WEAR_HAPPY, 0, 100); }
  return { ok: true, msg: `${acc.emoji} ${nong(pet)}ใส่${acc.nameTh}แล้ว น่ารักจัง!`, acc, firstToday };
}

/** Takes the item of one slot off (back to the wardrobe). */
export function takeOffAccessory(state, petId, slot) {
  const pet = getPet(state, petId);
  if (!pet) return fail('ไม่พบน้องตัวนี้');
  const accId = wearOf(pet)[slot];
  if (!accId) return fail('ไม่ได้ใส่อะไรอยู่');
  pet.wear = { head: null, neck: null, ...wearOf(pet), [slot]: null };
  const acc = getAccessory(accId);
  return { ok: true, msg: acc ? `${acc.emoji} ถอด${acc.nameTh}ของ${nong(pet)}แล้ว` : '', acc };
}

/** "ชอบ: เกาคาง" for the pet sheet once the favourite spot has been discovered, else ''. */
export function favoriteLine(pet) {
  return pet && pet.favKnown ? `ชอบ: ${FAV_LABEL[favoriteSpot(pet.id)]}` : '';
}

// ── เพื่อนซี้ (CONTRACT_V8 §4): points + best-friend rules live in js/friends.js; this is only the sheet line ──
/** "เพื่อนซี้: 🐱 มะลิ" for the pet sheet, or ''. */
export function friendLine(state, pet) {
  const id = pet && bestFriendId(state, pet.id);
  const f = id && getPet(state, id);
  return f ? `เพื่อนซี้: ${petEmoji(f)} ${petName(f)}` : '';
}

export function giveToy(state, petId) {
  const pet = getPet(state, petId);
  const blocked = careBlocker(pet, { allowWorking: false });
  if (blocked) return fail(blocked);
  if (pet.sick) return fail('น้องไม่สบาย ไปรักษาก่อนนะ');
  if (pet.stats.happy >= 99.5 && !lonelyLevel(pet)) return fail('น้องมีความสุขเต็มแล้ว');   // V18: a pet that misses you still wants the toy
  if (!removeItem(state, 'care_toy', 1)) return fail('ไม่มีของเล่นในกระเป๋า (ซื้อได้ที่ร้านค้า)');
  const p = PERSONALITIES[pet.personality] || PERSONALITIES.cheerful;
  pet.stats.happy = clamp(pet.stats.happy + 40 * p.playHappy, 0, 100);
  addPetXp(state, petId, 2);
  bumpStat(state, 'played');
  addBond(state, petId, 4);
  pet.playedAt = now();   // V18: a toy keeps คิดถึง away when there is no time to play
  pet.heartsickMs = 0;
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

// ── เปลอนุบาล + ส่งไปบ้านใหม่ + โปสการ์ด + ตัวช่วยเปรียบเทียบ (CONTRACT_V7 §5) ──────────────────
export { NURSERY_SLOTS };
export const POSTCARD_MAX = POSTCARDS_MAX;
export const POSTCARD_MIN_MS = 12 * HOUR;
export const POSTCARD_SPAN_MS = 24 * HOUR;   // a postcard arrives 12 .. 36 h after the pet left

/** state.nursery with defaults in code: [{ pet, hatchedAt }], broken entries dropped. */
export function ensureNursery(state) {
  if (!Array.isArray(state.nursery)) state.nursery = [];
  const n = state.nursery;
  for (let i = n.length - 1; i >= 0; i--) {
    if (!isPlain(n[i]) || !isPlain(n[i].pet) || !n[i].pet.id) n.splice(i, 1);
    else n[i].pet.status = 'nursery';
  }
  return n;
}

/** The babies in the nursery (read only, never mutates). */
export function nurseryPets(state) {
  return (Array.isArray(state.nursery) ? state.nursery : []).map(e => e && e.pet).filter(p => isPlain(p) && p.id);
}

export function getNurseryPet(state, petId) {
  return nurseryPets(state).find(p => p.id === petId) || null;
}

/** A pet wherever it lives: { pet, where: 'yard' | 'nursery' } or null. */
export function findPet(state, petId) {
  const pet = getPet(state, petId);
  if (pet) return { pet, where: 'yard' };
  const baby = getNurseryPet(state, petId);
  return baby ? { pet: baby, where: 'nursery' } : null;
}

/** How many pets of a species the player owns (yard + nursery). */
export function speciesCount(state, speciesId) {
  return state.pets.filter(p => p.speciesId === speciesId).length + nurseryPets(state).filter(p => p.speciesId === speciesId).length;
}

/** Drops a pet's station pin (plot.stations <-> pet.station) when it leaves the yard. */
function clearStationOf(state, pet) {
  const st = pet.station;
  if (st && Number.isFinite(st.plotIndex)) {
    const plot = state.plots && state.plots[st.plotIndex];
    const slot = Number(st.slot) || 0;
    if (plot && Array.isArray(plot.stations) && plot.stations[slot] === pet.id) plot.stations[slot] = null;
  }
  pet.station = null;
}

const isBusy = pet => pet.status === 'working' || pet.status === 'expedition';

/** "รับเข้าลาน": a nursery baby moves into the yard (needs a free yard slot). */
export function adoptFromNursery(state, petId) {
  const n = ensureNursery(state);
  const i = n.findIndex(e => e.pet.id === petId);
  if (i < 0) return fail('ไม่พบน้องในเปลอนุบาล');
  if (state.pets.length >= state.barnCapacity) return fail('ลานเต็มแล้ว — สลับกับน้องในลาน หรือขยายลานก่อนนะ');
  const pet = n[i].pet;
  n.splice(i, 1);
  pet.status = 'idle';
  pet.playedAt = now();   // V18: babies slept in the crib, คิดถึง starts counting in the yard
  pet.task = null;
  pet.station = null;
  state.pets.push(pet);
  return { ok: true, msg: `🏡 รับ${nong(pet)}เข้าลานแล้ว ยินดีต้อนรับ!`, pet };
}

/** "สลับกับน้องในลาน…": the baby goes into the yard, the chosen yard pet takes its crib (its gifts are collected first). */
export function swapWithNursery(state, nurseryPetId, yardPetId) {
  const n = ensureNursery(state);
  const i = n.findIndex(e => e.pet.id === nurseryPetId);
  if (i < 0) return fail('ไม่พบน้องในเปลอนุบาล');
  const out = getPet(state, yardPetId);
  if (!out) return fail('ไม่พบน้องในลาน');
  if (isBusy(out)) return fail('น้องกำลังทำงานอยู่ สลับไม่ได้');
  const baby = n[i].pet;
  const y = ensureYard(state);
  const gift = takeGift(state, y, out.id);
  delete y.byPet[out.id];
  removePetFriends(state, out.id);
  clearStationOf(state, out);
  state.pets.splice(state.pets.indexOf(out), 1);
  returnWear(state, out);                        // a sleeping baby wears nothing: its accessories are free again
  out.status = 'nursery';
  out.task = null;
  n[i] = { pet: out, hatchedAt: now() };
  baby.status = 'idle';
  baby.task = null;
  baby.playedAt = now();
  baby.station = null;
  state.pets.push(baby);
  const got = giftParts(gift.coins, gift.items);
  return { ok: true, msg: `🔄 ${nong(baby)} เข้าลานแล้ว ส่วน${nong(out)} ไปนอนเปลแทน${got ? ` (เก็บของขวัญไว้ให้แล้ว ${got})` : ''}`, pet: baby, swapped: out };
}

/** Stardust a pet is worth when it moves to a new home. */
export function rehomeDust(pet) {
  const sp = getSpecies(pet.speciesId);
  return ((sp && STARDUST_BY_RARITY[sp.rarity]) || 1) * (pet.shiny ? 2 : 1);
}

/**
 * "ส่งไปบ้านใหม่ 🏡💌" (was: release). Yard pets and nursery babies; working / expedition pets cannot go.
 * Gifts the pet still holds are collected first. Reward = RELEASE_COINS + stardust (shiny x2). A postcard follows 12-36 h later.
 */
export function rehomePet(state, petId) {
  const found = findPet(state, petId);
  if (!found) return fail('ไม่พบน้องตัวนี้');
  const { pet, where } = found;
  if (isBusy(pet)) return fail('น้องกำลังทำงานอยู่ ส่งไปบ้านใหม่ไม่ได้');
  if (limitedOf(pet)) return fail('น้อง Limited เป็นของขวัญพิเศษ ส่งไปบ้านใหม่ไม่ได้นะ');
  const dust = rehomeDust(pet);
  const label = nong(pet);
  returnWear(state, pet);                       // dressed-up accessories go back to the wardrobe (CONTRACT_V9 §1)
  let gift = { coins: 0, items: {} };
  if (where === 'yard') {
    const y = ensureYard(state);
    gift = takeGift(state, y, pet.id);
    delete y.byPet[pet.id];
    clearStationOf(state, pet);
    state.pets.splice(state.pets.indexOf(pet), 1);
  } else {
    const n = ensureNursery(state);
    n.splice(n.findIndex(e => e.pet.id === pet.id), 1);
  }
  addCoins(state, RELEASE_COINS);
  addStardust(state, dust);
  bumpStat(state, 'released');
  removePetFriends(state, pet.id);
  schedulePostcard(state, pet);
  const got = giftParts(gift.coins, gift.items);
  return { ok: true, msg: `💌 ส่ง${label}ไปบ้านใหม่แล้ว 🏡 (ได้รับ ${RELEASE_COINS} 🪙 และผงดาว ${dust} ✨${got ? ` + ของขวัญที่ค้างอยู่ ${got}` : ''}) เดี๋ยวน้องอาจส่งโปสการ์ดมานะ`, dust, gift };
}

/** Old name, kept for callers that have not been renamed yet. */
export function releasePet(state, petId) {
  return rehomePet(state, petId);
}

// ── Postcards ───────────────────────────────────────────────────────────────
// {name} = the pet's name, {species} = its species. No reward, only warmth.
export const POSTCARD_TEMPLATES = [
  'สวัสดีจ้า! {name} อยู่บ้านใหม่สบายดี มีทุ่งหญ้ากว้างๆ ให้วิ่งเล่นด้วย 🌿',
  '{name} คิดถึงลานของคุณนิดนึง แต่ที่นี่มีขนมอร่อยเยอะมาก ขอบคุณที่ดูแลนะ 💕',
  'วันนี้ {name} ได้เพื่อนใหม่เป็น{species}อีกตัว เล่นกันสนุกสุดๆ 🐾',
  'บ้านใหม่ของ {name} มีแดดอุ่นๆ ทุกเช้า หลับสบายทุกคืนเลย 😴',
  'ฝากบอกทุกคนที่ลานว่า {name} สบายดี อ้วนขึ้นนิดหน่อยด้วยล่ะ 😋',
  '{name} เจอสระน้ำเล็กๆ ข้างบ้านใหม่ ดีใจมากกก 💦',
  'ที่นี่มีคนใจดีเอาอาหารมาให้ {name} ทุกวัน อิ่มจนพุงกางเลย 🍽️',
  '{name} นอนฝันถึงคุณด้วยนะ ตื่นมาก็ยังยิ้มอยู่เลย 🌙',
  'ขอบคุณที่ให้ {name} ได้เริ่มต้นใหม่ในที่ที่ใช่ 🏡',
  '{name} ฝึกท่าเด็ดมาใหม่ ถ้าได้เจอกันจะโชว์ให้ดูนะ ✨',
  'วันนี้ฝนตก {name} นั่งดูหยดน้ำที่หน้าต่างอย่างมีความสุข 🌧️',
  '{name} ({species}) ส่งกอดมาให้ยกใหญ่ 🤗',
  'เพื่อนบ้านใหม่ของ {name} ใจดีมาก ชวนเล่นซ่อนแอบทุกเย็น 🙈',
  '{name} ได้ที่นอนนุ่มนิ่มตัวใหม่ อยากให้คุณได้นอนด้วยจัง 🛏️',
  'ตอนนี้ {name} เป็นดาวเด่นของหมู่บ้านไปแล้ว ใครๆ ก็เอ็นดู 🌟',
  'มีผีเสื้อสีสวยมาเกาะบนหัว {name} ด้วยล่ะ 🦋',
  '{name} เก็บดอกไม้ป่าไว้ให้คุณหนึ่งดอก (ฝากลมพัดไปให้แล้วนะ) 🌼',
  '{species}อย่าง {name} มีความสุขมาก ไม่ต้องห่วงนะ 💖',
  'วันนี้ {name} วิ่งเร็วกว่าเมื่อวานนิดนึง! ภูมิใจสุดๆ 🏃',
  '{name} คิดถึงเสียงทักทายตอนเช้า ขอส่งยิ้มกลับไปให้ 😊',
  'ที่บ้านใหม่มีต้นไม้ใหญ่ให้นอนเล่น {name} ชอบที่สุดเลย 🌳',
  'ฟ้าใสมากเลย {name} เลยอยากเขียนมาบอกว่าสบายดี ☁️',
  '{name} เก็บขนมไว้ให้คุณด้วย ถ้ามาเที่ยวบ้านนี้ก็แวะมานะ 🍪',
  'ขอบคุณสำหรับความทรงจำดีๆ ที่ลานนะ จาก {name} 💌',
  'ที่นี่ดาวเต็มฟ้าเลย {name} นับได้ถึงสิบดวงแล้ว ⭐',
];

/** Queues the postcard of a pet that moved to a new home. `at` is in the future: it only counts once now() >= at. */
function schedulePostcard(state, pet) {
  const sp = getSpecies(pet.speciesId);
  const name = petName(pet);
  const extra = festivalPostcardTemplates();   // during ลอยกระทง the cards are krathong-themed (CONTRACT_V11 §3)
  const pool = extra.length ? extra : POSTCARD_TEMPLATES;
  const tpl = pool[hashId(`${pet.id}:card`) % pool.length];
  const delay = POSTCARD_MIN_MS + (hashId(`${pet.id}:delay`) % (POSTCARD_SPAN_MS + 1));
  if (!Array.isArray(state.postcards)) state.postcards = [];
  state.postcards.push({
    id: uid(), petName: name, speciesId: pet.speciesId,
    text: tpl.split('{name}').join(name).split('{species}').join(sp ? sp.nameTh : 'น้อง'),
    at: now() + delay, read: false, notified: false,
  });
  state.postcards.sort((a, b) => a.at - b.at);
  while (state.postcards.length > POSTCARD_MAX) state.postcards.shift();
}

/** Postcards that have arrived, newest first. */
export function arrivedPostcards(state, t = now()) {
  return (Array.isArray(state.postcards) ? state.postcards : []).filter(c => isPlain(c) && c.at <= t).sort((a, b) => b.at - a.at);
}

export function unreadPostcardCount(state, t = now()) {
  return arrivedPostcards(state, t).filter(c => !c.read).length;
}

export function markPostcardRead(state, id) {
  const c = (state.postcards || []).find(x => x && x.id === id);
  if (c) c.read = true;
  return !!c;
}

/** A toast the first time a postcard has arrived (silent during offline catch-up; the 💌 badge still shows). */
function tickPostcards(state, offline) {
  const list = state.postcards;
  if (!Array.isArray(list) || !list.length) return;
  const t = now();
  for (const c of list) {
    if (!isPlain(c) || c.notified || c.at > t) continue;
    c.notified = true;
    if (!offline) notify(`💌 ได้รับโปสการ์ดจาก${c.petName}!`, 'success');
  }
}

// ── Compare helper (swap + rehome pickers) ──────────────────────────────────
/** One number for "how useful is this pet": best-job work power x10 (stage, mood, personality, shiny; no trait). */
export function petPower(pet) {
  const sp = getSpecies(pet.speciesId);
  return Math.round(getWorkPower(pet, sp ? Object.keys(sp.jobs) : []) * 10);
}

const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

/**
 * Candidates for "who should move on / swap": every pet (or only the yard's when scope = 'yard'), each with what a
 * player weighs: emoji, name, stage, power, hearts, shiny, station, rarity and `dup` = how many of its species are owned
 * (yard + nursery, the baby included). Sorted so the likely choices come first: duplicates, lowest power, fewest hearts,
 * not shiny, not stationed. Pets that cannot go (working / expedition) sink to the end with a reason. Never auto-selects.
 */
export function compareCandidates(state, { scope = 'all', excludeId = null } = {}) {
  const pool = [...state.pets.map(pet => ({ pet, where: 'yard' }))];
  if (scope !== 'yard') pool.push(...nurseryPets(state).map(pet => ({ pet, where: 'nursery' })));
  const rows = pool.filter(r => r.pet.id !== excludeId).map(({ pet, where }) => {
    const sp = getSpecies(pet.speciesId);
    const dup = speciesCount(state, pet.speciesId);
    const busy = isBusy(pet);
    const ltd = scope === 'all' && !!limitedOf(pet);   // the rehome picker: a Limited pet cannot go (swapping into a crib is fine)
    const st = pet.station && Number.isFinite(pet.station.plotIndex) ? `ประจำแปลง #${pet.station.plotIndex + 1}` : null;
    return {
      id: pet.id, pet, where, emoji: petEmoji(pet), name: petName(pet), stage: pet.stage,
      stageName: (STAGES[pet.stage] || STAGES[0]).nameTh, power: petPower(pet), hearts: bondHearts(pet),
      shiny: !!pet.shiny, station: st, rarity: sp ? sp.rarity : 'common', rarityName: sp ? RARITIES[sp.rarity].nameTh : '',
      dup, suggest: dup > 1 && !pet.shiny && !busy, eligible: !busy && !ltd,
      reason: busy ? (pet.status === 'expedition' ? 'ออกสำรวจอยู่' : 'กำลังทำงานอยู่') : ltd ? 'น้อง Limited ส่งไปบ้านใหม่ไม่ได้' : '',
    };
  });
  const key = r => [r.eligible ? 0 : 1, r.dup > 1 ? 0 : 1, r.power, r.hearts, r.shiny ? 1 : 0, r.station ? 1 : 0, RARITY_RANK[r.rarity] || 0];
  rows.sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return rows;
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
  const coatsN = s => COAT_IDS.filter(id => s.coatsSeen && s.coatsSeen[id] === true).length;
  add('coats_all', `🎨 สะสมสีขนครบทุกสี (${COAT_IDS.length})`, COAT_IDS.length, coatsN, { stardust: 50 });
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

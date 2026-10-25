// "น้องๆ มารับตอนเปิดเกม" (CONTRACT_V8 §3): what happened while the player was away, as up to 5 cute Thai lines.
// Pure and deterministic: a snapshot is taken before the offline catch-up, the digest diffs it against the state after.
// main.js stores the result with setAwayDigest() when the player was away >= AWAY_MIN_MS (and was last greeted that long ago);
// the yard view takes it once with takeAwayDigest() (main.js getAwayDigest also stamps state.lastGreetAt).
// Never throws: any partial or broken input just gives fewer lines.
import { getSpecies } from './data/species.js';
import { YARD_CAP_MS } from './pets.js';
import { HUNGER_LOW } from './notify.js';
import { friendMatching } from './state.js';
import { birthdayInfo } from './birthday.js';

export const AWAY_MIN_MS = 30 * 60 * 1000;
export const AWAY_MAX_LINES = 5;
export const AWAY_MAX_HIGHLIGHTS = 4;
const DAY_MS = 24 * 3600 * 1000;

const isObj = v => v !== null && typeof v === 'object';
const arr = v => (Array.isArray(v) ? v : []);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const nameOf = p => p.nickname || (getSpecies(p.speciesId) || {}).nameTh || 'น้อง';

/** Small stable string hash (FNV-1a) -> uint32. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Compact picture of everything the digest looks at. Take it BEFORE the offline catch-up. Tolerates any partial state. */
export function snapshotForAway(state) {
  const st = isObj(state) ? state : {};
  const pets = {};
  const byPet = isObj(st.yard) && isObj(st.yard.byPet) ? st.yard.byPet : {};
  let giftItems = 0, giftCoins = 0, giftPets = 0;
  for (const p of arr(st.pets)) {
    if (!isObj(p) || !p.id) continue;
    const g = isObj(byPet[p.id]) ? byPet[p.id] : null;
    const coins = g ? Math.floor(num(g.c)) : 0;
    const items = g && isObj(g.items) ? Object.values(g.items).reduce((n, v) => n + Math.floor(num(v)), 0) : 0;
    giftCoins += coins; giftItems += items; if (coins > 0 || items > 0) giftPets++;
    pets[p.id] = {
      id: p.id, name: nameOf(p), status: p.status,
      hunger: num(p.stats && p.stats.hunger, 100), energy: num(p.stats && p.stats.energy, 100),
      hungry: num(p.stats && p.stats.hunger, 100) < HUNGER_LOW, sick: !!p.sick,
      giftFull: !!(g && num(g.ms) >= YARD_CAP_MS - 1000),
      months: p.bornAt > 0 ? birthdayInfo(p, num(st.lastTick, Date.now())).months : 0, // v9: completed 30-day blocks
    };
  }
  const bf = {};
  try { for (const [a, b] of friendMatching(st.friends)) bf[a] = b; } catch { /* no friends */ }
  return {
    pets,
    giftPieces: giftItems + giftPets, giftCoins, giftPets,
    cropsReady: arr(st.plots).filter(p => isObj(p) && p.cropId && p.progress >= 1).length,
    tripsDone: arr(st.expeditions).filter(e => isObj(e) && e.done).length,
    postcards: arr(st.postcards).filter(c => isObj(c) && c.id).map(c => c.id),
    nursery: arr(st.nursery).filter(e => isObj(e) && isObj(e.pet) && e.pet.id).map(e => ({ id: e.pet.id, name: nameOf(e.pet) })),
    friends: bf,
    day: Math.floor(num(st.lastTick) / DAY_MS),
  };
}

/** A snapshot or a state (or junk) -> a complete snapshot. */
function asSnap(x) {
  const full = isObj(x) && isObj(x.pets) && !Array.isArray(x.pets) ? x : snapshotForAway(x);
  return {
    pets: isObj(full.pets) ? full.pets : {},
    giftPieces: num(full.giftPieces), giftCoins: num(full.giftCoins), giftPets: num(full.giftPets),
    cropsReady: num(full.cropsReady), tripsDone: num(full.tripsDone),
    postcards: arr(full.postcards), nursery: arr(full.nursery).filter(n => isObj(n) && n.id),
    friends: isObj(full.friends) ? full.friends : {}, day: num(full.day),
  };
}

// kind -> [priority, icon, templates]; {n} is the pet's name, {m} the friend's name, {k} a count, {c} coins. Three variants each.
const T = {
  birthday: [0.5, '🎂', ['{n} ครบ {k} เดือนแล้ว สุขสันต์วันเกิด!', 'ระหว่างที่เธอไม่อยู่ {n} ครบ {k} เดือนพอดี', 'วันเกิด {n} ครบ {k} เดือน! น้องๆ รอฉลองกับเธอ']],
  friend: [0, '🤝', ['{n} กับ {m} เป็นเพื่อนซี้กันแล้ว!', '{n} กับ {m} สนิทกันมาก เป็นเพื่อนซี้แล้ว', 'ระหว่างที่เธอไม่อยู่ {n} กับ {m} ตัวติดกันเลย']],
  sick: [1, '🤒', ['{n} ไม่ค่อยสบาย อยากให้เธอดูแลหน่อย', '{n} ตัวร้อนนิดหน่อย คิดถึงเธอด้วย', '{n} ซึมๆ ไป ช่วยดูหน่อยนะ']],
  nursery: [2, '👶', ['มีน้องใหม่ในเปล: {n}!', '{n} ฟักแล้ว นอนหลับปุ๋ยในเปล', 'ต้อนรับ {n} น้องใหม่ในเปลอนุบาล']],
  trip: [3, '🧭', ['{n} กลับจากสำรวจแล้ว มีของมาฝาก!', '{n} เดินทางกลับมาถึงบ้านแล้ว', '{n} สำรวจเสร็จ เหนื่อยแต่ยิ้มกว้าง']],
  tripwait: [3.5, '🧭', ['สำรวจเสร็จแล้ว {k} ทริป รอเธอไปรับของ', 'มี {k} ทริปสำรวจกลับมาแล้ว', 'ของจากการสำรวจ {k} ทริปรอรับอยู่']],
  postcard: [4, '💌', ['มีโปสการ์ดจากบ้านใหม่มาถึง {k} ใบ', 'ไปรษณีย์มาส่งโปสการ์ด {k} ใบ', 'น้องๆ ที่บ้านใหม่ส่งข่าวมา {k} ใบ']],
  gifts: [5, '🎁', ['น้องๆ เตรียมของขวัญไว้ให้ {k} ชิ้น (🪙 {c})', 'มีของขวัญรอเธออยู่ {k} ชิ้น มี 🪙 {c} ด้วยนะ', 'น้องๆ เก็บของขวัญไว้ {k} ชิ้น แตะที่ตัวน้องเพื่อรับ']],
  giftfull: [6, '🎁', ['ของขวัญของ {n} เต็มแล้ว!', '{n} เก็บของขวัญไว้ให้เธอเต็มมือ', '{n} ถือของขวัญรอเธออยู่']],
  hungry: [7, '😋', ['{n} ท้องร้องแล้ว หิวจัง', '{n} มองชามอาหารตาละห้อย', '{n} หิวแล้วนะ ขออะไรกินหน่อย']],
  hungriest: [8, '🍽️', ['{n} เริ่มหิวแล้ว หิวที่สุดในลานเลย', '{n} ท้องเริ่มกลิ้งแล้ว ใครจะให้ข้าวนะ', '{n} เหลือบมองชามข้าวบ่อยๆ']],
  crop: [9, '🌾', ['ผลผลิตพร้อมเก็บแล้ว {k} แปลง', 'แปลงผัก {k} แปลงโตเต็มที่แล้ว', 'มี {k} แปลงรอเธอไปเก็บเกี่ยว']],
  work: [10, '💪', ['{n} ทำงานในแปลงเสร็จแล้ว', '{n} เสร็จงานแล้ว ภูมิใจมาก', '{n} ช่วยงานฟาร์มจนเสร็จเรียบร้อย']],
  napped: [11, '💤', ['{n} งีบไปพักใหญ่ ตื่นมาสดชื่น', '{n} หลับสบายระหว่างที่เธอไม่อยู่', '{n} นอนเอาแรงมาเต็มเปี่ยม']],
  wake: [12, '🌞', ['{n} ตื่นแล้ว บิดขี้เกียจ', '{n} ตื่นนอนมายืดเส้นยืดสาย', '{n} งัวเงียตื่นมารอเธอ']],
  sleep: [13, '😴', ['{n} หลับไปแล้ว ฝันดีนะ', '{n} ม้วนตัวหลับปุ๋ย', '{n} งีบไปเงียบๆ']],
};
const MAX_PER_KIND = { birthday: 2, friend: 2, sick: 2, nursery: 2, trip: 2, tripwait: 1, postcard: 1, gifts: 1, giftfull: 1, hungry: 2, hungriest: 1, crop: 1, work: 2, napped: 1, wake: 1, sleep: 1 };

const fillT = (tpl, vars) => tpl.replace(/\{(\w)\}/g, (_, k) => (vars[k] ?? ''));

/**
 * before: a snapshot (snapshotForAway) or a state; after: the state (or a snapshot); awayMs only goes into the greeting.
 * Returns { lines: [{ petId?, emoji, text }] (<= 5), highlights: [petId] (<= 4) }. Same input -> same output. Never throws.
 */
export function buildAwayDigest(before, after, awayMs = 0) {
  try {
    return buildUnsafe(before, after, awayMs);
  } catch (e) {
    console.error('buildAwayDigest failed', e);
    return { lines: [], highlights: [] };
  }
}

function buildUnsafe(before, after, awayMs) {
  const b = asSnap(before);
  const a = asSnap(after);
  const cand = []; // { kind, petIds:[...], vars, key }
  const add = (kind, petIds, vars = {}) => cand.push({ kind, petIds, vars, key: petIds.join(',') || kind });

  let hungriest = null;
  for (const id of Object.keys(a.pets).sort()) {
    const now_ = a.pets[id];
    const was = b.pets[id];
    if (!isObj(now_)) continue;
    if (now_.status !== 'sleeping' && !now_.hungry && (!hungriest || now_.hunger < hungriest.hunger)) hungriest = now_;
    if (!isObj(was)) continue;
    if (now_.months > was.months && was.months >= 0) add('birthday', [id], { n: now_.name, k: now_.months });
    if (now_.sick && !was.sick) add('sick', [id], { n: now_.name });
    if (was.status === 'expedition' && now_.status !== 'expedition') add('trip', [id], { n: now_.name });
    if (now_.hungry && !was.hungry) add('hungry', [id], { n: now_.name });
    if (now_.giftFull && !was.giftFull) add('giftfull', [id], { n: now_.name });
    if (was.status === 'working' && now_.status !== 'working' && now_.status !== 'expedition') add('work', [id], { n: now_.name });
    if (was.status === 'sleeping' && now_.status !== 'sleeping') add('wake', [id], { n: now_.name });
    else if (was.status !== 'sleeping' && now_.status === 'sleeping') add('sleep', [id], { n: now_.name });
    else if (now_.energy - was.energy >= 25 && was.status !== 'working' && was.status !== 'expedition') add('napped', [id], { n: now_.name });
  }
  if (hungriest && hungriest.hunger < 60) add('hungriest', [hungriest.id], { n: hungriest.name });
  for (const [x, y] of Object.entries(a.friends).sort()) {
    if (x < y && b.friends[x] !== y && a.pets[x] && a.pets[y]) add('friend', [x, y], { n: a.pets[x].name, m: a.pets[y].name });
  }
  const seenNursery = new Set(b.nursery.map(n => n.id));
  for (const n of a.nursery) if (!seenNursery.has(n.id)) add('nursery', [], { n: n.name });
  const oldCards = new Set(b.postcards);
  const newCards = a.postcards.filter(id => !oldCards.has(id)).length;
  if (newCards > 0) add('postcard', [], { k: newCards });
  if (a.cropsReady > 0) add('crop', [], { k: a.cropsReady });
  if (a.tripsDone > 0 && !cand.some(c => c.kind === 'trip')) add('tripwait', [], { k: a.tripsDone });
  if (a.giftPieces > 0 || a.giftCoins > 0) add('gifts', [], { k: Math.max(1, a.giftPieces), c: a.giftCoins });

  cand.sort((p, q) => T[p.kind][0] - T[q.kind][0] || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));

  const lines = [];
  const lineIds = [];
  const used = new Set();
  const perKind = {};
  for (const c of cand) {
    if (lines.length >= AWAY_MAX_LINES) break;
    if ((perKind[c.kind] || 0) >= MAX_PER_KIND[c.kind]) continue;
    if (c.petIds.some(id => used.has(id))) continue; // one line per pet: the most important thing wins
    const variants = T[c.kind][2];
    const text = fillT(variants[hash(`${c.key}:${a.day}:${c.kind}`) % variants.length], c.vars);
    const first = c.petIds[0];
    lines.push({ ...(first ? { petId: first } : {}), emoji: T[c.kind][1], text });
    lineIds.push(c.petIds);
    perKind[c.kind] = (perKind[c.kind] || 0) + 1;
    for (const id of c.petIds) used.add(id);
  }
  let highlights = [...new Set(lineIds.flat())];
  if (!lines.length) {
    // truly nothing happened: a plain "we missed you" with up to 3 pets that are home (stable order by hash)
    const home = Object.values(a.pets).filter(p => isObj(p) && (p.status === 'idle' || p.status === 'sleeping'))
      .sort((p, q) => hash(p.id + a.day) - hash(q.id + a.day) || (p.id < q.id ? -1 : 1));
    const hours = Math.max(1, Math.round((Number(awayMs) || AWAY_MIN_MS) / 3600000));
    const who = home[0];
    lines.push({ ...(who ? { petId: who.id } : {}), emoji: '💛', text: awayMs >= 3 * 3600000 ? `ผ่านไป ${hours} ชั่วโมงแล้ว น้องๆ คิดถึงเธอมาก!` : 'กลับมาแล้วเหรอ! น้องๆ คิดถึงนะ' });
    highlights = home.slice(0, 3).map(p => p.id);
  }
  return { lines, highlights: highlights.slice(0, AWAY_MAX_HIGHLIGHTS) };
}

// ---- hand-over to the yard view: set by main.js after an offline catch-up, taken once by barn3d ----
let pending = null;

/** Stores a digest for the yard view (main.js). Ignores an empty digest. */
export function setAwayDigest(digest, awayMs = 0, at = Date.now()) {
  pending = digest && digest.lines && digest.lines.length ? { ...digest, awayMs, at } : null;
}
/** Looks at the pending digest without consuming it. */
export const peekAwayDigest = () => pending;
/** Returns the pending digest once ({ lines, highlights, awayMs, at }) and forgets it, or null. */
export function takeAwayDigest() {
  const d = pending;
  pending = null;
  return d;
}

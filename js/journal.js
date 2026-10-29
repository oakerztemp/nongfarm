// บันทึกน้อง 📔 (CONTRACT_V9 §3): a short diary of what the pets did. DOM-free, never throws.
//   state.journal = [{ day: 'YYYY-MM-DD', lines: [{ emoji, text, petId?, kind? }] }]   oldest day first, <= 14 days x 6 lines
// Each kind of event for one pet is written at most once per day (a diary, not a log). Other modules call journalEvent();
// main.js also runs syncJournal() on every state change for the events nobody "calls" (hatch, postcard arrived).
//
//   journalEvent(state, 'hatch'|'bestFriend'|'favSpot'|'birthday'|'firstWear'|'photo'|'postcard'|'melt'|'away'|'familyEgg'|'familyHatch'|'cook'|'dish', ctx)
//   addJournal(state, { kind, petId, emoji, text, day? })    low level: returns true when a line was written
//   journalDays(state)                                        newest day first (what the sheet shows)
//   journalAway(state, digest)                                the away-digest lines as diary lines
import { now, todayKey } from './util.js';
import { cleanJournalDay, JOURNAL_DAYS_MAX, JOURNAL_LINES_MAX } from './state.js';
import { getSpecies } from './data/species.js';

export { JOURNAL_DAYS_MAX, JOURNAL_LINES_MAX };

const isObj = v => v !== null && typeof v === 'object';
const LINE_MAX_CHARS = 120;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Finds a pet in the yard, the nursery or (by id) nowhere. */
function findPet(state, petId) {
  if (!petId || !isObj(state)) return null;
  const p = (Array.isArray(state.pets) ? state.pets : []).find(x => isObj(x) && x.id === petId);
  if (p) return p;
  const n = (Array.isArray(state.nursery) ? state.nursery : []).find(e => isObj(e) && isObj(e.pet) && e.pet.id === petId);
  return n ? n.pet : null;
}

/** 'น้องมีมี่'-style name used in the diary: nickname, else the species name. */
export function journalName(pet) {
  if (!pet) return 'น้อง';
  return pet.nickname || (getSpecies(pet.speciesId) || {}).nameTh || 'น้อง';
}

// kind -> [emoji, templates]. {n} the pet, {m} its friend, {s} a spot ('ที่หัว'), {a} an accessory, {k} months. Cute + short.
const T = {
  hatch: ['🐣', ['{n} ฟักออกมาแล้ว ตัวเล็กนิดเดียวเลย!', 'วันนี้ {n} ลืมตาดูโลกเป็นครั้งแรก', 'ไข่แตกแล้ว! {n} มาเป็นครอบครัวเรา']],
  bestFriend: ['🤝', ['{n} กับ {m} เป็นเพื่อนซี้กันแล้ว', 'ตอนนี้ {n} ไปไหนก็มี {m} ไปด้วยเสมอ', '{n} กับ {m} นอนข้างกันทุกวันเลย']],
  favSpot: ['💕', ['เจอแล้ว! {n} ชอบให้เกา{s}', 'รู้แล้วว่า {n} ชอบให้ลูบ{s} ยิ้มกว้างเชียว', 'ความลับของ {n}: ชอบให้เกา{s}']],
  birthday: ['🎂', ['วันเกิด {n} ครบ {k} เดือนแล้ว!', '{n} เป่าเค้กวันเกิด ครบ {k} เดือน', 'สุขสันต์วันเกิด {n} โตอีกนิดแล้วนะ ({k} เดือน)']],
  firstWear: ['🎀', ['{n} ลองใส่ {a} วันนี้ น่ารักที่สุด!', '{n} ใส่ {a} แล้วดูภูมิใจมาก', 'วันนี้ {n} แต่งตัวด้วย {a}']],
  photo: ['📸', ['วันนี้ถ่ายรูปกับ {n} เก็บไว้ในอัลบั้ม', 'ถ่ายรูป {n} ไว้แล้ว ยิ้มสวยเลย', 'ได้รูปน่ารักของ {n} มาหนึ่งใบ']],
  postcard: ['💌', ['มีโปสการ์ดจาก {n} ส่งมาจากบ้านใหม่', '{n} ส่งข่าวมาจากบ้านใหม่ สบายดีนะ', 'ไปรษณีย์มาส่งโปสการ์ดของ {n}']],
  melt: ['🥰', ['{n} ละลายเลย เพราะโดนลูบนานๆ', 'ลูบ {n} จน {n} นอนแผ่ ใจละลายทั้งคู่', '{n} หลับตาพริ้ม ชอบมากเลย']],
  familyEgg: ['💞', ['{n} กับ {m} มีไข่ครอบครัวแล้ว']],
  familyHatch: ['🐣', ['ลูกของ {n} กับ {m} ฟักออกมาแล้ว']],
  away: ['🏡', ['{text}']],
  favDish: ['🍽️', ['{n} ได้กิน{a} เมนูโปรดแล้ว ยิ้มหน้าบานเลย!', 'ค้นพบแล้ว! เมนูโปรดของ {n} คือ{a}', '{n} กิน{a}เกลี้ยงจาน แล้วขอเพิ่มอีก']],
  cook: ['🍳', ['วันนี้ทำ{a}ให้น้องๆ', 'วันนี้เข้าครัวทำ{a}ให้น้องๆ กินกัน', 'ทำ{a}เสร็จแล้ว น้องๆ ต้องชอบแน่']],
  dish: ['😋', ['{n} กิน{a}หมดจาน', '{n} กิน{a}เกลี้ยงเลย ชอบมาก', '{n} ได้กิน{a} อิ่มหนำสำราญ']],
  favToy: ['🧸', ['ค้นพบแล้ว! ของเล่นโปรดของ {n} คือ {a}', '{n} ได้เล่น {a} ของเล่นชิ้นโปรด ดีใจสุดๆ', 'รู้แล้วว่า {n} ชอบ {a} ที่สุด']],
};
export const JOURNAL_KINDS = Object.keys(T);

/** The diary sentence for an event (deterministic for the same pet and day). ctx = { name, other, spot, acc, months, text, seed }. */
export function journalText(kind, ctx = {}) {
  const t = T[kind];
  if (!t) return '';
  const variants = t[1];
  const pick = variants[hash(`${ctx.seed || ctx.name || ''}${kind}${ctx.day || ''}`) % variants.length];
  return pick
    .replace(/\{n\}/g, ctx.name || 'น้อง').replace(/\{m\}/g, ctx.other || 'เพื่อน')
    .replace(/\{s\}/g, ctx.spot || '').replace(/\{a\}/g, ctx.acc || 'ของใหม่')
    .replace(/\{k\}/g, String(ctx.months ?? '')).replace(/\{text\}/g, ctx.text || '')
    .slice(0, LINE_MAX_CHARS);
}

const SPOT_TH = { head: 'หัว', chin: 'คาง', back: 'หลัง' };

/** Journal days newest first, each { day, lines } with lines in the order they happened. A copy; safe to render. */
export function journalDays(state) {
  const list = isObj(state) && Array.isArray(state.journal) ? state.journal : [];
  return list.map(cleanJournalDay).filter(Boolean).reverse();
}

/**
 * Writes one diary line for today. { kind, petId?, emoji?, text, day? }.
 * Deduped: the same kind for the same pet (or the same text, when there is no pet) is written once per day.
 * The newest 14 days and 6 lines a day are kept. Returns true when a line was added.
 */
export function addJournal(state, { kind = 'note', petId, emoji, text, day } = {}) {
  try {
    if (!isObj(state) || typeof text !== 'string' || !text.trim()) return false;
    if (!Array.isArray(state.journal)) state.journal = [];
    const key = day || todayKey();
    let bucket = state.journal.find(d => isObj(d) && d.day === key);
    if (!bucket) {
      bucket = { day: key, lines: [] };
      const i = state.journal.findIndex(d => isObj(d) && d.day > key);
      if (i < 0) state.journal.push(bucket); else state.journal.splice(i, 0, bucket);
    }
    if (!Array.isArray(bucket.lines)) bucket.lines = [];
    const pid = typeof petId === 'string' && petId ? petId : undefined;
    const same = l => isObj(l) && l.kind === kind && ((pid && kind !== 'away') ? l.petId === pid : l.text === text.slice(0, LINE_MAX_CHARS));
    if (bucket.lines.some(same)) return false;
    const line = { emoji: typeof emoji === 'string' ? emoji.slice(0, 8) : '', text: text.slice(0, LINE_MAX_CHARS) };
    if (pid) line.petId = pid;
    line.kind = String(kind).slice(0, 40);
    bucket.lines.push(line);
    if (bucket.lines.length > JOURNAL_LINES_MAX) bucket.lines.splice(0, bucket.lines.length - JOURNAL_LINES_MAX);
    if (state.journal.length > JOURNAL_DAYS_MAX) state.journal.splice(0, state.journal.length - JOURNAL_DAYS_MAX);
    return true;
  } catch (e) {
    console.error('addJournal failed', e);
    return false;
  }
}

/**
 * Writes the diary line for a known kind of event. ctx: { petId, name?, other?, otherId?, spot? ('head'|'chin'|'back'),
 * acc? (accessory name), months?, sub? (extra dedupe key, e.g. a postcard id) }. The pet's name comes from the state when not given.
 * Returns true when a line was written.
 */
export function journalEvent(state, kind, ctx = {}) {
  try {
    const t = T[kind];
    if (!t) return false;
    const pet = findPet(state, ctx.petId);
    const name = ctx.name || journalName(pet);
    const other = ctx.other || (ctx.otherId ? journalName(findPet(state, ctx.otherId)) : '');
    const day = ctx.day || todayKey();
    const text = journalText(kind, {
      name, other, spot: SPOT_TH[ctx.spot] ? SPOT_TH[ctx.spot] : ctx.spot, acc: ctx.acc, months: ctx.months, text: ctx.text, seed: ctx.petId || name, day,
    });
    return addJournal(state, { kind: ctx.sub ? `${kind}:${ctx.sub}` : kind, petId: ctx.petId, emoji: ctx.emoji || t[0], text, day });
  } catch (e) {
    console.error('journalEvent failed', e);
    return false;
  }
}

/** Away digest (CONTRACT_V8 §3) -> diary lines. Each digest line is kept at most once a day. Returns how many were written. */
export function journalAway(state, digest) {
  let n = 0;
  for (const l of isObj(digest) && Array.isArray(digest.lines) ? digest.lines : []) {
    if (!isObj(l) || typeof l.text !== 'string') continue;
    if (addJournal(state, { kind: 'away', petId: l.petId, emoji: l.emoji || '🏡', text: l.text })) n++;
  }
  return n;
}

const DAY_MS = 24 * 3600 * 1000;
const syncedToday = new Set(); // 'day|key' of sync events already handled this session (outside the capped lines)

/**
 * Diary lines for events that happen in the state without anybody calling the journal: pets hatched today and postcards that
 * arrived today. Each event is written at most once per day (remembered here, not in the capped lines), and a full day is
 * never overwritten: sync lines are skipped rather than evicting other lines. Cheap and idempotent; returns lines written.
 */
export function syncJournal(state) {
  if (!isObj(state)) return 0;
  const today = todayKey();
  const t = now();
  let n = 0;
  for (const k of [...syncedToday]) if (!k.startsWith(today)) syncedToday.delete(k);
  const startOfToday = new Date(t); startOfToday.setHours(0, 0, 0, 0);
  const since = startOfToday.getTime();
  const full = () => {
    const b = Array.isArray(state.journal) ? state.journal.find(d => isObj(d) && d.day === today) : null;
    return !!b && Array.isArray(b.lines) && b.lines.length >= JOURNAL_LINES_MAX;
  };
  const once = (key, write) => {
    const id = `${today}|${key}`;
    if (syncedToday.has(id) || full()) return;
    syncedToday.add(id);
    if (write()) n++;
  };
  const born = [...(Array.isArray(state.pets) ? state.pets : []), ...(Array.isArray(state.nursery) ? state.nursery.map(e => e && e.pet) : [])];
  for (const p of born) {
    if (isObj(p) && p.id && p.bornAt >= since && p.bornAt <= t + DAY_MS) once(`hatch:${p.id}`, () => journalEvent(state, 'hatch', { petId: p.id, day: today }));
  }
  for (const c of Array.isArray(state.postcards) ? state.postcards : []) {
    if (isObj(c) && c.id && c.at >= since) once(`postcard:${c.id}`, () => journalEvent(state, 'postcard', { name: c.petName || 'น้อง', sub: c.id, day: today }));
  }
  return n;
}

// วันเกิดน้อง 🎂 (CONTRACT_V9 §5): every 30 calendar days since hatch (pet.bornAt, local days) is a "ครบเดือน" birthday, celebrated on that
// real day. The first tap on the birthday pet that day (claimBirthday) gives +1 bond through addBond (so the 30-a-day cap still
// applies), a diary line and a toast. Missing the day means no backfill gift; the away digest mentions it (js/away.js).
//   birthdayInfo(pet, nowMs?)   -> { isToday, months }     months = completed months (30-day blocks) at nowMs
//   birthdayPets(state, nowMs?) -> [{ petId, months, claimed }]  yard pets whose birthday is today (for the party scene)
//   claimBirthday(state, petId) -> { ok, months, gained, name } | { ok:false, reason }
import { now, notify, addLog } from './util.js';
import { addBond, getPet, petName } from './pets.js';
import { journalEvent } from './journal.js';

export const BIRTHDAY_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

/** Local calendar day number of a timestamp (DST-proof: counts days, not 24 h blocks). */
export function dayIndex(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Whole local days since the pet hatched (0 on the day it hatched, never negative). */
export function daysSinceHatch(pet, nowMs = now()) {
  if (!pet || !Number.isFinite(pet.bornAt) || pet.bornAt <= 0) return 0;
  return Math.max(0, dayIndex(nowMs) - dayIndex(pet.bornAt));
}

/** { isToday, months }: today is a birthday when the pet is a positive multiple of 30 days old; months = completed 30-day blocks. */
export function birthdayInfo(pet, nowMs = now()) {
  const days = daysSinceHatch(pet, nowMs);
  return { isToday: days > 0 && days % BIRTHDAY_DAYS === 0, months: Math.floor(days / BIRTHDAY_DAYS) };
}

/** Yard pets (not working away or in the nursery) celebrating today: [{ petId, months, claimed }] in yard order. */
export function birthdayPets(state, nowMs = now()) {
  const out = [];
  for (const p of state && Array.isArray(state.pets) ? state.pets : []) {
    if (!p || !p.id || p.status === 'nursery' || p.status === 'working' || p.status === 'expedition') continue;
    const info = birthdayInfo(p, nowMs);
    if (info.isToday) out.push({ petId: p.id, months: info.months, claimed: p.lastBirthdayGift === info.months });
  }
  return out;
}

/**
 * Takes the birthday gift: only on the birthday itself and once per birthday (pet.lastBirthdayGift = months). +1 bond via addBond
 * (gained can be 0 when the pet already hit today's cap; the gift still counts as taken), diary line, toast.
 */
export function claimBirthday(state, petId) {
  const pet = state && Array.isArray(state.pets) ? getPet(state, petId) : null;
  if (!pet) return { ok: false, reason: 'nopet' };
  const info = birthdayInfo(pet);
  if (!info.isToday) return { ok: false, reason: 'notToday' };
  if (pet.lastBirthdayGift === info.months) return { ok: false, reason: 'claimed' };
  pet.lastBirthdayGift = info.months;
  const gained = addBond(state, petId, 1);
  const name = petName(pet);
  journalEvent(state, 'birthday', { petId, name, months: info.months });
  const msg = `🎂 วันนี้วันเกิด${name} ครบ ${info.months} เดือน!`;
  notify(msg, 'success');
  addLog(state, msg);
  return { ok: true, months: info.months, gained, name };
}

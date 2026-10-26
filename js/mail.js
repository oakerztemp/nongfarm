// V12 mailbox (CONTRACT_V12 §2): read / claim system mail. DOM-free.
// state.mail: [{ id, at, read, claimed }] (newest first) · state.mailSent: system mail ids already delivered (state.ensureMail).
import { addLog, now, uid } from './util.js';
import { NURSERY_SLOTS } from './state.js';
import { getMailDef } from './data/mail.js';
import { LIMITED_PETS } from './data/limited.js';
import { getSpecies } from './data/species.js';
import { ensureNursery, STAGES, markCoatBook } from './pets.js';
import { getEgg } from './data/eggs.js';

const fail = reason => ({ ok: false, reason });

/** Mail with its text: [{ id, at, read, claimed, def }] newest first. */
export function mailList(state) {
  return (Array.isArray(state.mail) ? state.mail : []).map(m => ({ ...m, def: getMailDef(m.id) })).filter(m => m.def);
}

/** Unread mail + gifts not yet taken (the 📬 badge). */
export function mailBadgeCount(state) {
  return mailList(state).filter(m => !m.read || (m.def.gift && !m.claimed)).length;
}

export function readMail(state, id) {
  const m = (state.mail || []).find(x => x.id === id);
  if (!m) return fail('ไม่พบจดหมายนี้');
  m.read = true;
  return { ok: true };
}

/** A fresh pet for a Limited gift (shiny, fixed name / personality / stage). */
export function limitedPet(limitedId, t = now()) {
  const L = LIMITED_PETS[limitedId];
  if (!L) return null;
  return {
    id: uid(), speciesId: L.speciesId, nickname: L.nickname, shiny: true, personality: L.personality, limited: L.id,
    stage: L.stage, xp: STAGES[L.stage].xp,
    stats: { hunger: 100, happy: 100, energy: 100, clean: 100 },
    poop: 0, sick: false, zeroSince: null, zeroMs: 0, poopTimer: null, lastFedAt: 0,
    bond: 0, bondDay: null, bondToday: 0, giftDay: null,
    status: 'idle', task: null, station: null, bornAt: t, playedAt: t,
  };
}

/** V14: an egg gift goes straight into a free incubator slot. */
function claimEgg(state, m, eggId) {
  const egg = getEgg(eggId);
  if (!egg) return fail('ของขวัญนี้รับไม่ได้');
  if (state.incubator.length >= state.incubatorCapacity) return fail('ตู้ฟักเต็มอยู่ — ฟักไข่ใบเดิมให้เสร็จก่อน แล้วค่อยมารับนะ');
  const t = now();
  state.incubator.push({ eggId: egg.id, startAt: t, readyAt: t + egg.hatchMs });
  m.claimed = true;
  m.read = true;
  const msg = `🥚✨ ใส่${egg.nameTh}ในตู้ฟักแล้ว ลุ้นเลยว่าจะได้น้องตำนานตัวไหน!`;
  addLog(state, msg);
  return { ok: true, msg };
}

/** Takes a mail's gift: an egg goes to the incubator; a Limited pet goes to the yard, or the nursery when the yard is full. */
export function claimMail(state, id) {
  const m = (state.mail || []).find(x => x.id === id);
  const def = m && getMailDef(m.id);
  if (!def) return fail('ไม่พบจดหมายนี้');
  if (!def.gift) return fail('จดหมายนี้ไม่มีของขวัญ');
  if (m.claimed) return fail('รับของขวัญไปแล้ว');
  if (def.gift.egg) return claimEgg(state, m, def.gift.egg);
  const pet = limitedPet(def.gift.limited);
  const species = pet && getSpecies(pet.speciesId);
  if (!species) return fail('ของขวัญนี้รับไม่ได้');
  const toNursery = state.pets.length >= state.barnCapacity;
  if (toNursery && ensureNursery(state).length >= NURSERY_SLOTS) return fail('ลานกับเปลอนุบาลเต็มหมดแล้ว — ขยายลาน หรือย้ายน้องออกก่อนแล้วค่อยมารับนะ');
  if (toNursery) { pet.status = 'nursery'; state.nursery.push({ pet, hatchedAt: pet.bornAt }); } else state.pets.push(pet);
  m.claimed = true;
  m.read = true;
  const entry = state.collection[species.id] || { owned: 0, shiny: false };
  entry.owned += 1;
  entry.shiny = true;
  state.collection[species.id] = entry;
  markCoatBook(state, species.id, 'base');
  // no XP: a guest who only took the gift stays isPristine (no "which farm?" prompt at sign-in)
  const msg = `🌌 ได้รับ ${species.emoji} ${LIMITED_PETS[pet.limited].nameTh} "${pet.nickname}" แล้ว!` +
    (toNursery ? ' — ลานเต็ม เลยพักในเปลอนุบาล 👶' : '');
  addLog(state, msg);
  return { ok: true, msg, pet, nursery: toNursery };
}

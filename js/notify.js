// Decides WHEN to show local notifications (egg ready, crop ready, expedition done, pet hungry). DOM-free.
// The game loop calls pollNotifications() every tick; showing them is pwa.js's job.
import { getSpecies } from './data/species.js';

export const CATEGORIES = ['egg', 'crop', 'trip', 'hungry'];
export const THROTTLE_MS = 10 * 60 * 1000; // at most one notification per category per 10 minutes
export const HUNGER_LOW = 20; // a pet below this is "hungry"
export const HUNGER_REARM = 30; // ...and is announced again only after it was fed past this

/** Per-session memory: what was already announced and when each category last notified. */
export function createNotifyMemory() {
  return { notified: new Set(), lastShown: {} };
}

const petLabel = pet => pet.nickname || (getSpecies(pet.speciesId) || {}).nameTh || 'น้อง';

/** Everything that is ready right now, by category: { category: [{ key, label? }] }. */
function readyNow(state, nowMs) {
  const ready = { egg: [], crop: [], trip: [], hungry: [] };
  for (const slot of state.incubator || []) {
    if (slot && slot.readyAt <= nowMs) ready.egg.push({ key: `egg:${slot.eggId}:${slot.readyAt}` });
  }
  for (const plot of state.plots || []) {
    if (plot && plot.cropId && plot.progress >= 1) ready.crop.push({ key: `crop:${plot.index}:${plot.plantedAt}` });
  }
  for (const trip of state.expeditions || []) {
    if (trip && (trip.done || trip.endAt <= nowMs)) ready.trip.push({ key: `trip:${trip.id}` });
  }
  for (const pet of state.pets || []) {
    if (pet && pet.stats && pet.stats.hunger < HUNGER_LOW) ready.hungry.push({ key: `hungry:${pet.id}`, label: petLabel(pet) });
  }
  return ready;
}

function describe(category, items) {
  const n = items.length;
  switch (category) {
    case 'egg':
      return { category, tab: 'barn', title: '🥚 ไข่ฟักแล้ว!', body: n > 1 ? `ไข่ ${n} ใบพร้อมฟักเป็นน้องใหม่แล้ว` : 'ไข่ของคุณพร้อมฟักเป็นน้องใหม่แล้ว' };
    case 'crop':
      return { category, tab: 'farm', title: '🌾 พืชพร้อมเก็บเกี่ยว', body: n > 1 ? `${n} แปลงโตเต็มที่แล้ว มาเก็บเกี่ยวกัน` : 'แปลงของคุณโตเต็มที่แล้ว มาเก็บเกี่ยวกัน' };
    case 'trip':
      return { category, tab: 'explore', title: '🧭 สำรวจเสร็จแล้ว', body: n > 1 ? `น้องๆ ${n} ทริปกลับมาแล้ว มารับของกัน` : 'น้องกลับจากการสำรวจแล้ว มารับของกัน' };
    default: {
      const names = items.slice(0, 3).map(i => i.label).join(', ');
      const more = n > 3 ? ` และอีก ${n - 3} ตัว` : '';
      return { category, tab: 'barn', title: '🍖 น้องหิวแล้ว', body: `${names}${more} หิวแล้ว มาให้อาหารกัน` };
    }
  }
}

/**
 * Returns the notifications to show now ([{ category, tab, title, body, tag }]) and updates `memory`.
 *  - Nothing is shown while the player is looking at the game (`active`) or has notifications off; things that
 *    become ready in that time are marked as seen so they are not announced later.
 *  - A category that notified less than THROTTLE_MS ago keeps its news pending (merged into the next one).
 */
export function pollNotifications(state, nowMs, memory, { active = false } = {}) {
  const silent = active || !(state.settings && state.settings.notify);
  const ready = readyNow(state, nowMs);

  // Hungry pets are announced again only after being fed; other keys vanish once the thing is collected.
  const petIds = new Set((state.pets || []).map(p => p.id));
  for (const pet of state.pets || []) {
    if (pet && pet.stats && pet.stats.hunger >= HUNGER_REARM) memory.notified.delete(`hungry:${pet.id}`);
  }
  const live = new Set([...ready.egg, ...ready.crop, ...ready.trip].map(x => x.key));
  for (const key of [...memory.notified]) {
    const gone = key.startsWith('hungry:') ? !petIds.has(key.slice('hungry:'.length)) : !live.has(key);
    if (gone) memory.notified.delete(key);
  }

  const notices = [];
  for (const category of CATEGORIES) {
    const fresh = ready[category].filter(x => !memory.notified.has(x.key));
    if (!fresh.length) continue;
    if (silent) {
      for (const x of fresh) memory.notified.add(x.key);
      continue;
    }
    const last = memory.lastShown[category];
    if (last !== undefined && nowMs - last < THROTTLE_MS) continue; // stays pending
    for (const x of fresh) memory.notified.add(x.key);
    memory.lastShown[category] = nowMs;
    notices.push({ ...describe(category, fresh), tag: `nongfarm-${category}` });
  }
  return notices;
}

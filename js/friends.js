// เพื่อนซี้ (CONTRACT_V8 §4): friend points between pets, best friends, the "new best friend" event. DOM-free.
// state.friends = { [pairKey(a, b)]: points } (sorted ids joined by '|'); every pet keeps its 4 strongest pairs (state.js).
// tickPets calls tickFriends(state, dtMs, { offline }) every tick (offline catch-up included); points are credited in
// 10-game-minute windows so a 72 h catch-up stays cheap. Fractional and deterministic (no RNG). Cosmetic + a small mood
// effect only: no coins or bond.
//
// How the numbers work:
//  - base rate per hour: +1 both idle at home, +2 same plot, +1 napping together (pairRate);
//  - x affinity 0.7..1.3 per pair (hash of the two ids, +0.15 for the same personality), so pairs bond at different speeds;
//  - x2 for 5 days while either pet is a newcomer (born < 5 days ago): the yard wants to meet it, so late arrivals find friends;
//  - best friends = greedy matching over pairs >= 72 points (state.js friendMatching): strongest pair first, a pet joins one pair.
import { now } from './util.js';
import { journalEvent } from './journal.js';
import {
  pairKey, FRIEND_PAIRS_MAX, FRIEND_PAIRS_PER_PET, FRIEND_BEST_POINTS, FRIENDS_MET_MAX, friendMatching, pruneFriendPairs,
} from './state.js';

export { pairKey, FRIEND_PAIRS_MAX, FRIEND_PAIRS_PER_PET, friendMatching };

const HOUR = 3600 * 1000;
/** Points per hour a pair earns while both are at home and awake / work the same plot / nap at the same time. */
export const FRIEND_RATE = { awake: 1, work: 2, nap: 1 };
/** A pair with at least this many points can be best friends (about 3 days at home together). */
export const BEST_FRIEND_POINTS = FRIEND_BEST_POINTS;
/** While a pet's best friend is also at home, its happiness decays x this (B applies it in tickPets). */
export const FRIEND_DECAY_MULT = 0.8;
/** Points are credited (and pruned / announced) once this much game time has piled up. */
export const FRIEND_WINDOW_MS = 10 * 60 * 1000;
/** Pairs are pruned to each pet's top 4 once per this many game hours. */
export const FRIEND_PRUNE_EVERY_H = 6;
/** A pet younger than this makes every pair it is in earn FRIEND_NEWCOMER_MULT times faster. */
export const FRIEND_NEWCOMER_MS = 5 * 24 * HOUR;
export const FRIEND_NEWCOMER_MULT = 2;

const isHome = pet => pet.status !== 'working' && pet.status !== 'expedition';

// per state object: pile of unprocessed ms, hours since the last prune, sim clock, announced pairs, affinity cache
const memo = new WeakMap();
const memoOf = state => {
  let m = memo.get(state);
  if (!m) { m = { acc: 0, hours: 0, known: null, clock: 0, seenTick: NaN, aff: new Map() }; memo.set(state, m); }
  return m;
};

/** Points per hour two pets earn together right now, before affinity (0 when they are not sharing anything). */
export function pairRate(a, b) {
  if (!a || !b || a.id === b.id) return 0;
  const ta = a.task, tb = b.task;
  if (a.status === 'working' && b.status === 'working' && ta && tb && ta.type === 'plot' && tb.type === 'plot' && ta.plotIndex === tb.plotIndex) return FRIEND_RATE.work;
  if (a.status === 'sleeping' && b.status === 'sleeping') return FRIEND_RATE.nap;
  if (a.status === 'idle' && b.status === 'idle') return FRIEND_RATE.awake;
  return 0;
}

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Deterministic affinity of a pair, 0.7..1.3: hash of the two ids, +0.15 when they share a personality. */
export function pairAffinity(a, b) {
  const u = hash01(pairKey(a.id, b.id));
  return Math.min(1.3, 0.7 + 0.45 * u + (a.personality && a.personality === b.personality ? 0.15 : 0));
}

/** Map petId -> partnerId of every best-friend pair (greedy matching, see header). Pure. */
export function bestFriendMap(state) {
  return friendMatching(state && state.friends);
}

/** The pet's best friend id, or null. */
export function bestFriendOf(state, petId) {
  return bestFriendMap(state).get(petId) || null;
}

/** Friend points between two pets (0 when unknown). */
export function friendPoints(state, a, b) {
  return (state.friends && state.friends[pairKey(a, b)]) || 0;
}

/** 0.8 while the pet's best friend is a pet of this yard that is also at home, else 1. B multiplies the happiness decay by it. */
export function friendDecayMult(state, pet, map = bestFriendMap(state)) {
  const fid = map.get(pet.id);
  if (!fid) return 1;
  const f = state.pets.find(p => p.id === fid);
  return f && isHome(f) && isHome(pet) ? FRIEND_DECAY_MULT : 1;
}

/** Drops every pair that includes this pet (rehome, nursery). Returns how many pairs went. */
export function removePetFriends(state, petId) {
  let n = 0;
  for (const key of Object.keys(state.friends || {})) {
    if (key.split('|').includes(petId)) { delete state.friends[key]; n++; }
  }
  return n;
}

/** Keeps every pet's 4 strongest pairs plus the best-friend pairs. */
export function pruneFriends(state) {
  state.friends = pruneFriendPairs(state.friends);
}

// ---- "new best friend" events ----
const queue = [];
const listeners = new Set();
const QUEUE_MAX = 20;

/** Toast text for an event. */
export const friendEventMessage = evt => `🤝 ${evt.aName} กับ ${evt.bName} เป็นเพื่อนซี้กันแล้ว!`;

/** Subscribe to new best-friend pairs: fn({ a, b, aName, bName, points, at, offline }). Returns unsubscribe. */
export function onBestFriend(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Pending events (oldest first), cleared by the call. For a UI that polls instead of subscribing. */
export function takeFriendEvents() {
  return queue.splice(0, queue.length);
}

/** Records a pair as announced (state.friendsMet, newest last, capped). Returns true when it was new. */
function markMet(state, key) {
  if (!Array.isArray(state.friendsMet)) state.friendsMet = [];
  if (state.friendsMet.includes(key)) return false;
  state.friendsMet.push(key);
  if (state.friendsMet.length > FRIENDS_MET_MAX) state.friendsMet.splice(0, state.friendsMet.length - FRIENDS_MET_MAX);
  return true;
}

function announce(state, a, b, offline) {
  const pa = state.pets.find(p => p.id === a), pb = state.pets.find(p => p.id === b);
  if (!pa || !pb) return;
  const name = p => p.nickname || p.speciesId;
  const evt = { a, b, aName: name(pa), bName: name(pb), points: friendPoints(state, a, b), at: now(), offline: !!offline };
  queue.push(evt);
  journalEvent(state, 'bestFriend', { petId: a, otherId: b, name: evt.aName, other: evt.bName }); // v9 diary line (deduped per day)
  if (queue.length > QUEUE_MAX) queue.shift();
  for (const fn of [...listeners]) { try { fn(evt); } catch (e) { console.error(e); } }
}

const pairsOf = map => { const s = new Set(); for (const [a, b] of map) s.add(pairKey(a, b)); return s; };

/**
 * Credits dtMs of friendship (see the header for the rules). Calls are cheap: time piles up until FRIEND_WINDOW_MS, then one
 * pass credits every pair, drops pairs of pets that left the yard, prunes (every 6 game hours) and announces new best-friend
 * pairs (onBestFriend / takeFriendEvents; a pair is announced once ever: state.friendsMet; no toast here, the UI shows
 * friendEventMessage). A call with dt <= 0 only cleans up and announces.
 */
export function tickFriends(state, dtMs, opts = {}) {
  if (!state || !Array.isArray(state.pets)) return;
  if (!state.friends || typeof state.friends !== 'object' || Array.isArray(state.friends)) state.friends = {};
  const dt = Number(dtMs) > 0 ? Number(dtMs) : 0;
  const m = memoOf(state);
  if (state.lastTick !== m.seenTick) { m.seenTick = state.lastTick; m.clock = Number(state.lastTick) || 0; } // sim clock follows catch-up steps
  m.clock += dt;
  if (!m.known) {
    m.known = pairsOf(bestFriendMap(state));
    for (const k of m.known) markMet(state, k); // friendships that already exist are never announced
  }
  m.acc += dt;
  if (dt > 0 && m.acc < FRIEND_WINDOW_MS) return;

  const h = m.acc / HOUR;
  m.acc = 0;
  const pets = state.pets;
  const ids = new Set(pets.map(p => p.id));
  for (const key of Object.keys(state.friends)) {
    const [a, b] = key.split('|');
    if (!ids.has(a) || !ids.has(b) || !(state.friends[key] > 0)) delete state.friends[key];
  }
  if (h > 0) {
    const young = pets.map(p => (p.bornAt > 0 && m.clock - p.bornAt < FRIEND_NEWCOMER_MS ? FRIEND_NEWCOMER_MULT : 1));
    for (let i = 0; i < pets.length; i++) {
      const pi = pets[i];
      for (let j = i + 1; j < pets.length; j++) {
        const pj = pets[j];
        const rate = pairRate(pi, pj);
        if (rate <= 0) continue;
        const key = pairKey(pi.id, pj.id);
        let aff = m.aff.get(key);
        if (aff === undefined) { aff = pairAffinity(pi, pj); m.aff.set(key, aff); }
        state.friends[key] = (state.friends[key] || 0) + rate * aff * Math.max(young[i], young[j]) * h;
      }
    }
    m.hours += h;
    if (m.hours >= FRIEND_PRUNE_EVERY_H) { m.hours = 0; pruneFriends(state); if (m.aff.size > 600) m.aff.clear(); }
  }

  if (Array.isArray(state.friendsMet) && state.friendsMet.length > FRIENDS_MET_MAX) state.friendsMet.splice(0, state.friendsMet.length - FRIENDS_MET_MAX);
  const now_ = pairsOf(bestFriendMap(state));
  for (const key of now_) {
    if (m.known.has(key) || !markMet(state, key)) continue;
    const [a, b] = key.split('|');
    announce(state, a, b, opts.offline);
  }
  m.known = now_;
}

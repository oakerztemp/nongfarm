// V26 B: two-device save merge in js/storage.js (base snapshot, merge on reconcile / rejected write / sign-in).
// The module-level storage situation of one device is saved/restored as a localStorage snapshot; one fake cloud
// (mirrors firestore.rules) is shared by the "phone" and the "computer".
import { test, assert, assertEq, freshState, withFakeNow } from './harness.js';
import { STATE_VERSION, createNewState, replaceState, getState } from '../js/state.js';
import { onNotify } from '../js/util.js';
import * as storage from '../js/storage.js';

const MERGED_TOAST = '🔄 รวมความคืบหน้าจาก 2 เครื่องแล้ว';
const apply = s => replaceState(s);
const noAsk = async () => { throw new Error('askWhichFarm must not be called'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
const ours = k => k.startsWith('nongfarm_') || k.startsWith('nongfarm3_');

function fakeCloud() {
  const docs = {};
  const cloud = { docs, writes: 0, denied: 0 };
  cloud.rulesAllow = (existing, data) => !existing
    || (data.rev === (existing.rev ?? 0) + 1 && (data.version ?? 1) >= (existing.version ?? 1));
  cloud.setDoc = async (id, data) => {
    if (!cloud.rulesAllow(docs[id], data)) {
      cloud.denied += 1;
      throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    }
    cloud.writes += 1;
    docs[id] = data;
  };
  cloud.provider = async () => ({
    db: {},
    doc: (_db, _col, id) => id,
    getDoc: async id => ({ exists: () => id in docs, data: () => docs[id] }),
    setDoc: (id, data) => cloud.setDoc(id, data),
  });
  return cloud;
}

/** The farm both devices start from: synced with the cloud. */
function baseFarm() {
  const s = createNewState();
  s.player.farmName = 'TWO_DEVICES';
  s.player.coins = 100;
  s.inventory = { seed_carrot: 3, food_kibble: 2 };
  s.updatedAt = 1000;
  return JSON.parse(JSON.stringify(s));
}

const putCloud = (cloud, uid, state, rev) => {
  cloud.docs[uid] = { state: JSON.stringify(state), updatedAt: state.updatedAt, version: STATE_VERSION, rev };
};
const cloudState = (cloud, uid) => JSON.parse(cloud.docs[uid].state);
const backups = uid => Object.keys(localStorage).filter(k => k.startsWith(`nongfarm_${uid}_backup_`));
const keyOf = uid => `nongfarm3_${uid}`;

const snapshot = () => Object.fromEntries(Object.keys(localStorage).filter(ours).map(k => [k, localStorage.getItem(k)]));
function restore(snap) {
  for (const k of Object.keys(localStorage).filter(ours)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(snap)) localStorage.setItem(k, v);
}

/** A player action on the running device: changes the state and stamps it. */
function act(fn, stamp) {
  const s = getState();
  fn(s);
  s.updatedAt = stamp;
  replaceState(s);
  storage.saveLocal(keyOf(currentUid), getState()); // what the 2s local autosave would have done
}
let currentUid = null;

async function until(cond, ms = 3000) {
  for (let t = 0; t < ms && !cond(); t += 20) await delay(20);
  assert(cond(), 'condition not reached in time');
}

const harvest = s => { s.inventory.crop_carrot = (s.inventory.crop_carrot || 0) + 3; s.player.coins += 5; };
const cook = s => { s.inventory.dish_salad = (s.inventory.dish_salad || 0) + 1; s.player.coins += 20; };

/** Runs fn(cloud, toasts) with a clean slate and a fake cloud; restores everything afterwards. */
async function withDevices(uid, fn) {
  const cloud = fakeCloud();
  const toasts = [];
  const off = onNotify(msg => toasts.push(msg));
  freshState();
  currentUid = uid;
  storage.setDbProvider(cloud.provider);
  try {
    await withFakeNow(5_000_000, () => fn(cloud, toasts));
  } finally {
    off();
    storage.disconnectUser(apply);
    storage.setDbProvider();
    freshState();
  }
}

/**
 * Phone starts synced, then harvests (unsent) and is closed; computer (also starting from the synced farm) cooks and
 * uploads. Returns the phone's localStorage snapshot and leaves the module disconnected.
 */
async function phoneThenComputer(cloud, uid) {
  putCloud(cloud, uid, baseFarm(), 1);
  await storage.connectUser(uid, apply, noAsk); // phone
  const synced = snapshot();
  act(harvest, 2000); // never uploaded
  const phone = snapshot();
  storage.disconnectUser(apply);
  restore(synced); // computer
  await storage.connectUser(uid, apply, noAsk);
  act(cook, 3000);
  await storage.flushSave();
  assertEq(cloud.docs[uid].rev, 2, 'computer uploaded rev 2');
  storage.disconnectUser(apply);
  return phone;
}

test('v26b: sync stores the base snapshot of the cloud copy (signed-in only)', () => withDevices('m0', async cloud => {
  putCloud(cloud, 'm0', baseFarm(), 1);
  await storage.connectUser('m0', apply, noAsk);
  assertEq(JSON.parse(localStorage.getItem(`${keyOf('m0')}_base`)).updatedAt, 1000, 'base after cloud load');
  act(cook, 3000);
  await storage.flushSave();
  const base = JSON.parse(localStorage.getItem(`${keyOf('m0')}_base`));
  assertEq([base.updatedAt, base.inventory.dish_salad], [3000, 1], 'base after cloud write = the payload written');
  assertEq(localStorage.getItem(`${keyOf('m0')}_base`), cloud.docs.m0.state, 'identical to the cloud payload');
  storage.disconnectUser(apply);
  assertEq(localStorage.getItem('nongfarm3_guest_base'), null, 'guest has no base');
}));

test('v26b: stale phone meets cloud with a dish -> merged copy has the dish AND the harvest, uploaded once', () => withDevices('m1', async (cloud, toasts) => {
  const phone = await phoneThenComputer(cloud, 'm1');
  restore(phone);
  const res = await storage.connectUser('m1', apply, noAsk);
  assertEq(res.source, 'merged', 'merged source');
  const s = getState();
  assertEq([s.inventory.crop_carrot, s.inventory.dish_salad], [3, 1], 'harvest and dish both present');
  assertEq(s.player.coins, 125, 'base 100 + phone 5 + computer 20');
  assert(s.updatedAt > 3000, 'merged copy is newer than the cloud copy');
  assert(toasts.includes(MERGED_TOAST), 'merge toast shown');
  assert(backups('m1').length >= 1, 'unsent phone copy backed up before merging');
  await until(() => cloud.docs.m1.rev === 3); // connectUser starts the upload itself
  await delay(300);
  assertEq(cloud.docs.m1.rev, 3, 'cloud rev advanced exactly once');
  assertEq(cloud.denied, 0, 'nothing denied');
  const up = cloudState(cloud, 'm1');
  assertEq([up.inventory.crop_carrot, up.inventory.dish_salad, up.player.coins], [3, 1, 125], 'cloud holds both');
  assertEq(localStorage.getItem(`${keyOf('m1')}_base`), cloud.docs.m1.state, 'base = uploaded payload');
}));

test('v26b: without a base the newer copy still wins and the other is backed up (old behaviour)', () => withDevices('m2', async (cloud, toasts) => {
  const phone = await phoneThenComputer(cloud, 'm2');
  delete phone[`${keyOf('m2')}_base`];
  restore(phone);
  const res = await storage.connectUser('m2', apply, noAsk);
  assertEq(res.source, 'cloud', 'cloud (newer) wins');
  await delay(300);
  const s = getState();
  assertEq([s.inventory.crop_carrot, s.inventory.dish_salad], [undefined, 1], 'phone harvest not merged');
  assert(!toasts.includes(MERGED_TOAST), 'no merge toast');
  assert(backups('m2').length >= 1, 'phone copy backed up');
  assertEq(cloud.docs.m2.rev, 2, 'nothing uploaded');
}));

test('v26b: a base of another state version is ignored (old behaviour)', () => withDevices('m2b', async cloud => {
  const phone = await phoneThenComputer(cloud, 'm2b');
  const k = `${keyOf('m2b')}_base`;
  phone[k] = JSON.stringify({ ...JSON.parse(phone[k]), version: STATE_VERSION - 1 });
  restore(phone);
  const res = await storage.connectUser('m2b', apply, noAsk);
  assertEq(res.source, 'cloud', 'no merge with a foreign-version base');
}));

test('v26b: rejected write -> fetch the cloud copy, merge, upload at the next rev', () => withDevices('m3', async (cloud, toasts) => {
  putCloud(cloud, 'm3', baseFarm(), 1);
  await storage.connectUser('m3', apply, noAsk);
  act(harvest, 2000);
  // another device uploads first
  const other = baseFarm();
  cook(other);
  other.updatedAt = 3000;
  putCloud(cloud, 'm3', other, 2);
  await storage.flushSave();
  await until(() => cloud.docs.m3.rev === 3);
  await delay(200);
  assertEq(cloud.docs.m3.rev, 3, 'one upload only');
  assertEq(cloud.denied, 1, 'exactly one rejected write');
  const s = getState();
  assertEq([s.inventory.crop_carrot, s.inventory.dish_salad, s.player.coins], [3, 1, 125], 'merged in memory');
  const up = cloudState(cloud, 'm3');
  assertEq([up.inventory.crop_carrot, up.inventory.dish_salad], [3, 1], 'merged copy uploaded');
  assert(toasts.includes(MERGED_TOAST), 'merge toast shown');
  assert(backups('m3').length >= 1, 'unsent copy backed up before merging');
  assertEq(localStorage.getItem(`${keyOf('m3')}_base`), cloud.docs.m3.state, 'base = uploaded payload');
}));

test('v26b: rejected write without a base -> cloud adopted, local copy backed up (old behaviour)', () => withDevices('m4', async (cloud, toasts) => {
  putCloud(cloud, 'm4', baseFarm(), 1);
  await storage.connectUser('m4', apply, noAsk);
  localStorage.removeItem(`${keyOf('m4')}_base`);
  act(harvest, 2000);
  const other = baseFarm();
  cook(other);
  other.updatedAt = 3000;
  putCloud(cloud, 'm4', other, 2);
  await storage.flushSave();
  assertEq(cloud.denied, 1, 'one rejected write, no loop');
  assertEq([getState().inventory.crop_carrot, getState().inventory.dish_salad], [undefined, 1], 'cloud adopted');
  assert(!toasts.includes(MERGED_TOAST), 'no merge toast');
  assert(backups('m4').length >= 1, 'local copy backed up');
  assertEq(cloud.docs.m4.rev, 2, 'cloud untouched');
}));

test('v26b: a cloud that keeps moving ends the merge loop (3 merges, then the cloud copy is adopted)', () => withDevices('m5', async cloud => {
  putCloud(cloud, 'm5', baseFarm(), 1);
  await storage.connectUser('m5', apply, noAsk);
  act(harvest, 2000);
  let stamp = 3000;
  const inner = cloud.setDoc;
  cloud.setDoc = async (id, data) => { // someone else writes just before every upload
    const cur = JSON.parse(cloud.docs[id].state);
    cur.player.coins += 1;
    cur.updatedAt = stamp;
    stamp += 1000;
    putCloud(cloud, id, cur, cloud.docs[id].rev + 1);
    return inner(id, data);
  };
  await storage.flushSave();
  await delay(300);
  assertEq(cloud.denied, 4, 'three merged attempts + one final rejection, then it stops');
  assertEq(getState().player.coins, cloudState(cloud, 'm5').player.coins, 'ended on the cloud copy');
  assert(backups('m5').length >= 1, 'local copies backed up');
}));

test('v26b: our own late-landing write is never counted twice and the later cook is kept', () => withDevices('m6', async cloud => {
  putCloud(cloud, 'm6', baseFarm(), 1);
  await storage.connectUser('m6', apply, noAsk);
  act(harvest, 2000);
  // the first upload "times out" for the client although the server applied it; then the connection is down
  const inner = cloud.setDoc;
  let calls = 0;
  cloud.setDoc = async (id, data) => {
    calls += 1;
    if (calls === 1) await inner(id, data);
    throw new Error('timeout');
  };
  await storage.flushSave();
  cloud.setDoc = inner;
  assertEq(cloud.docs.m6.rev, 2, 'the server did apply the harvest upload');
  act(cook, 3000);
  await storage.flushSave(); // rev 2 again with a different payload -> denied -> handleRejectedWrite
  assertEq(cloud.denied, 1, 'one rejection');
  assertEq(getState().player.coins, 125, 'harvest once (+5) + cook (+20); 130 would count the harvest twice, 105 would drop the cook');
  assertEq(getState().inventory.dish_salad, 1, 'the cook made after the late-landing write is kept (merged from our own write as the base)');
  assert(backups('m6').length >= 1, 'the unsent copy is still backed up first');
}));

test('v26b: tab reconcile (claim) with unsent memory and a moved cloud merges both', () => withDevices('m7', async (cloud, toasts) => {
  putCloud(cloud, 'm7', baseFarm(), 1);
  await storage.connectUser('m7', apply, noAsk);
  await delay(300); // first claim settles
  act(harvest, 2000);
  const other = baseFarm();
  cook(other);
  other.updatedAt = 3000;
  putCloud(cloud, 'm7', other, 2);
  const ch = new BroadcastChannel(storage.WRITER_CHANNEL);
  try {
    ch.postMessage({ type: 'claim', scope: 'uid:m7', tab: 'test-other-tab' }); // another tab takes over -> we yield
    await delay(100);
    storage.claimWriter(); // we come back to the front: compare memory / cache / cloud
    await until(() => !storage.isSyncing() && cloud.docs.m7.rev === 3, 4000);
  } finally {
    ch.close();
  }
  const s = getState();
  assertEq([s.inventory.crop_carrot, s.inventory.dish_salad, s.player.coins], [3, 1, 125], 'both sides present');
  assert(toasts.includes(MERGED_TOAST), 'merge toast shown');
  assertEq(cloud.denied, 0, 'uploaded at the right rev first time');
}));

test('v26b: only the latest 6 backups are kept', () => withDevices('m8', async () => {
  for (let i = 0; i < 9; i++) {
    const s = baseFarm();
    s.player.farmName = `OLD${i}`;
    s.pets = [{ id: `p${i}`, speciesId: 'hamster' }];
    s.updatedAt = 100 + i;
    storage.saveLocal(storage.GUEST_KEY, s);
    replaceState(s);
    await storage.connectUser('m8', apply, async () => 'guest');
    await storage.flushSave();
    storage.disconnectUser(apply);
  }
  const n = backups('m8').length;
  assert(n <= 6 && n >= 4, `between 4 and 6 backups, got ${n}`);
}));

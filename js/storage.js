// Persistence: localStorage (guest + per-user cache) and Firestore (users/{uid}).
// Autosave: local every <=2s when dirty, cloud every 30s when dirty, plus on tab hide / page close.
// Cloud writes use optimistic concurrency: doc = { state, updatedAt, version, rev }, every write sends
// rev = lastKnownRev + 1 (firestore.rules enforces it), so a stale tab/device can never overwrite newer data.
// Only the most recently focused tab of an account (or of the guest save) saves: BroadcastChannel single-writer.
// A tab that loses the writer role writes the shared local cache first; the next writer adopts the newest of
// {its memory, local cache, cloud}.
import {
  getState, subscribe, migrate, createNewState, isPristine, isNewerSave, DEFAULT_FARM_NAME, STATE_VERSION,
} from './state.js';
import { getDb } from './auth.js';
import { notify, now, uid as newId } from './util.js';

// v3 uses its own local keys and channel, so a still-open v2 tab (old code) can neither overwrite our shared
// cache nor take the writer role from us. The old keys are read once and left untouched.
export const GUEST_KEY = 'nongfarm3_guest';
const userKey = uid => `nongfarm3_${uid}`;
const LEGACY_GUEST_KEY = 'nongfarm_guest';
const legacyUserKey = uid => `nongfarm_${uid}`;
export const WRITER_CHANNEL = 'nongfarm3-writer';

const LOCAL_INTERVAL_MS = 2000;
const CLOUD_INTERVAL_MS = 30000;
const TICK_UPLOAD_MS = 5 * 60 * 1000; // upload tick-only drift (no player action) at most this often
const CLOUD_TIMEOUT_MS = 10000;
const MAX_BACKUPS = 3;
const ACK_WAIT_MS = 150; // how long a new writer waits to learn whether another tab is currently writing
const YIELD_WAIT_MS = 1500; // ...and then for that tab to announce its final save

let target = { key: GUEST_KEY, uid: null };
let cloudReady = false; // false until the cloud copy was reconciled; blocks uploads (never overwrite blindly)
let localDirty = false;
let cloudDirty = false;
let tickDirty = false;
let lastCloudAt = 0;
let inflight = null;
let status = 'saved'; // 'saved' | 'saving' | 'offline' | 'othertab' | 'syncing'
let lastBackupTs = 0;
let cloudRev = 0; // rev of the cloud doc as of our last successful load/save (missing doc or no field = 0)
let syncedStamp = 0; // state.updatedAt at the last successful load/save: differs => unsent player actions exist
let lastSent = null; // { rev, payload } of the latest write attempt
let applyFn = null; // installs a state into the game (main.loadState); set by startAutosave / connectUser
// Writer role is only ever obtained through claimWriter(): a tab that starts in the background never writes.
let isWriter = false;
let syncing = false; // true while a freshly claimed writer compares itself with the other tab / cloud
let freshLoad = true; // true until the first claim after (re)connecting
let claimedAt = 0; // performance.now() of the latest claim
let lastYieldedAt = 0; // performance.now() of the latest 'yielded' message from another tab
let aloneOk = false; // fresh load happened in the foreground, so with no other tab there is nothing to compare
let baseStatus = 'saved';
let epoch = 0; // bumped on every connect/disconnect so stale async reconciles abort
let channel = null;
const messageListeners = new Set();
const tabId = newId();
let warnedLocal = false;
let lastCloudWarn = 0;
const statusListeners = new Set();

export const getSaveStatus = () => status;
export const isCloudActive = () => target.uid !== null;
export const isSyncing = () => syncing;

export function onSaveStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Sets the base status ('saved' | 'saving' | 'offline') and publishes the effective one (othertab / syncing win). */
function setStatus(next) {
  if (next) baseStatus = next;
  const effective = !isWriter ? 'othertab' : syncing ? 'syncing' : baseStatus;
  if (effective === status) return;
  status = effective;
  for (const fn of [...statusListeners]) fn(status);
}

let dbProvider = getDb;

/** Test seam: replaces the Firestore accessor (see auth.getDb). Call with no argument to restore it. */
export function setDbProvider(fn) {
  dbProvider = fn || getDb;
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---- local ----

/** Returns a migrated state, or null if missing/corrupt (corrupt raw data is kept under `<key>_corrupt`). */
export function loadLocal(key) {
  let raw;
  try { raw = localStorage.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isObj(parsed)) throw new Error('not an object');
    return migrate(parsed);
  } catch (e) {
    console.error(`Corrupt save in ${key}`, e);
    try { localStorage.setItem(`${key}_corrupt`, raw); } catch { /* nothing more we can do */ }
    return null;
  }
}

export function saveLocal(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('Local save failed', e);
    return false;
  }
}

/**
 * Local save under the current key. The first time a key is used, the save of the previous (v2) key is read,
 * migrated and copied over (the old key stays untouched); a marker makes this happen only once per key.
 */
function loadWithLegacy(key, legacyKey) {
  const own = loadLocal(key);
  if (own) return own;
  const marker = `${key}_legacy_checked`;
  try {
    if (localStorage.getItem(marker)) return null;
    localStorage.setItem(marker, '1');
  } catch {
    return null;
  }
  const old = loadLocal(legacyKey); // migrate() upgrades the v2 shape
  if (old) saveLocal(key, old);
  return old;
}

/** Guest save from localStorage, or a brand-new game. */
export function loadGuest() {
  const saved = loadWithLegacy(GUEST_KEY, LEGACY_GUEST_KEY);
  return saved ? { state: saved, isNew: false } : { state: createNewState(), isNew: true };
}

// ---- cloud ----

/**
 * Fetches the cloud doc: { state (migrated), rev, payload (raw state string if stored as one) } or null if the
 * user has no save yet. Throws on any error (never treat errors as "missing").
 */
async function fetchCloud(uid) {
  const api = await dbProvider();
  if (!api) throw new Error('Firebase is not configured');
  const snap = await withTimeout(api.getDoc(api.doc(api.db, 'users', uid)), CLOUD_TIMEOUT_MS);
  if (!snap.exists()) return null;
  const data = snap.data();
  const raw = typeof data.state === 'string' ? JSON.parse(data.state) : data.state;
  if (!isObj(raw)) throw new Error('Cloud save is corrupt');
  return {
    state: migrate(raw),
    rev: Number.isFinite(data.rev) ? data.rev : 0,
    payload: typeof data.state === 'string' ? data.state : null,
  };
}

/** Migrated cloud state, or null if the user has no save yet. Throws on any error. */
export async function loadCloud(uid) {
  const fetched = await fetchCloud(uid);
  return fetched ? fetched.state : null;
}

/** 'ok' | 'stale' (write rejected: someone else wrote first) | 'error'. Advances cloudRev on success. */
async function writeCloud(uid, state) {
  const payload = JSON.stringify(state); // snapshot before the first await
  const rev = cloudRev + 1;
  const stamp = state.updatedAt;
  lastSent = { rev, payload };
  try {
    const api = await dbProvider();
    if (!api) return 'error';
    await withTimeout(
      api.setDoc(api.doc(api.db, 'users', uid), { state: payload, updatedAt: stamp, version: STATE_VERSION, rev }),
      CLOUD_TIMEOUT_MS,
    );
    cloudRev = rev;
    syncedStamp = stamp;
    return 'ok';
  } catch (e) {
    console.error('Cloud save failed', e);
    return e && e.code === 'permission-denied' ? 'stale' : 'error';
  }
}

/** Resolves true on success, false on any failure. */
export async function saveCloud(uid, state) {
  return (await writeCloud(uid, state)) === 'ok';
}

// ---- autosave ----

function flushLocal() {
  if (!localDirty) return;
  if (!isWriter || syncing) return; // another tab owns this save / we have not compared with it yet
  localDirty = false;
  if (saveLocal(target.key, getState())) {
    if (!target.uid) setStatus('saved');
  } else {
    if (!target.uid) setStatus('offline');
    if (!warnedLocal) {
      warnedLocal = true;
      notify('บันทึกในเครื่องไม่ได้ (พื้นที่เต็มหรือปิดการเก็บข้อมูล)', 'warn');
    }
  }
}

function flushCloud() {
  if (inflight) return inflight;
  if (!target.uid || !cloudReady || !cloudDirty || !isWriter || syncing) return Promise.resolve();
  if (isNewerSave(getState())) { // written by a newer client: never overwrite the cloud copy with it
    cloudDirty = false;
    return Promise.resolve();
  }
  cloudDirty = false;
  tickDirty = false;
  setStatus('saving');
  const uid = target.uid;
  inflight = writeCloud(uid, getState()).then(async result => {
    inflight = null;
    lastCloudAt = now();
    if (result === 'ok') {
      setStatus('saved');
      return;
    }
    if (result === 'stale') {
      await handleRejectedWrite(uid);
      return;
    }
    cloudDirty = true;
    setStatus('offline');
    if (now() - lastCloudWarn > 60000) {
      lastCloudWarn = now();
      notify('บันทึกขึ้นคลาวด์ไม่ได้ — เล่นต่อในเครื่อง จะลองใหม่อัตโนมัติ', 'warn');
    }
  });
  return inflight;
}

const ADOPT_MSG = 'ฟาร์มถูกอัปเดตจากอีกแท็บ/อุปกรณ์ — โหลดเวอร์ชันล่าสุดแล้ว';

/** Key shared by all tabs that write the same save (so they elect one writer per save). */
const scopeId = () => (target.uid ? `uid:${target.uid}` : 'guest');

/**
 * Backs up every candidate copy that lost and differs from the winner. Copies identical to the winner or to our
 * last synced version (an older snapshot of our own timeline) are not worth a backup slot.
 */
function backupLosers(candidates, best) {
  for (const c of candidates) {
    const stamp = c.state.updatedAt;
    if (c === best || stamp === best.state.updatedAt || stamp === syncedStamp || isUntouchedDefault(c.state)) continue;
    backupSave(target.uid || 'guest', c.state);
  }
}

/** Backs up unsent local actions (never an untouched default farm). */
function backupUnsent() {
  const s = getState();
  if (s.updatedAt !== syncedStamp && !isUntouchedDefault(s)) backupSave(target.uid || 'guest', s);
}

/** Installs `state` as the game state through the app's apply path and refreshes the save bookkeeping. */
function installState(state, { fromCloud, uploadNeeded }) {
  if (applyFn) applyFn(state);
  syncedStamp = fromCloud ? getState().updatedAt : -1; // -1: this copy is not in the cloud yet
  saveLocal(target.key, getState());
  localDirty = false;
  cloudDirty = uploadNeeded;
  tickDirty = false;
  setStatus('saved');
}

/** Installs the cloud copy as the game state, backing up local actions that were never uploaded. */
function adoptCloud(fetched) {
  backupUnsent();
  cloudRev = fetched.rev;
  cloudReady = true;
  installState(fetched.state, { fromCloud: true, uploadNeeded: false });
  notify(ADOPT_MSG, 'warn');
}

/**
 * A cloud write was rejected. Stop uploading (no retry loop), look at the cloud doc and decide:
 * our own late write -> carry on; cloud ahead of us -> adopt it (local unsent copy backed up);
 * cloud rev BEHIND ours (doc overwritten by an old client) -> reset the rev and keep the newer of the two.
 */
async function handleRejectedWrite(uid) {
  cloudReady = false;
  cloudDirty = false;
  let fetched;
  try {
    fetched = await fetchCloud(uid);
  } catch (e) {
    console.error('Cloud reload after rejected write failed', e);
    setStatus('offline');
    notify('บันทึกขึ้นคลาวด์ไม่ได้ — เล่นต่อในเครื่อง รีเฟรชหน้าเพื่อลองใหม่', 'warn');
    return;
  }
  if (target.uid !== uid || !isWriter) return; // signed out / stepped back meanwhile
  if (!fetched) { // doc vanished: recreate it from the local copy
    cloudRev = 0;
    cloudReady = true;
    cloudDirty = true;
    return;
  }
  if (lastSent && fetched.rev === lastSent.rev && fetched.payload === lastSent.payload) {
    // Our own earlier write (queued while offline) landed late; the duplicate was refused. Nothing is lost.
    cloudRev = fetched.rev;
    cloudReady = true;
    cloudDirty = true;
    setStatus('saved');
    return;
  }
  if (fetched.rev > cloudRev) {
    adoptCloud(fetched);
  } else if (fetched.rev < cloudRev) {
    // Rev went backwards: the doc was replaced by a client that does not know about revs. Start counting from
    // the doc's rev and keep whichever copy is newer, backing up the other one.
    cloudRev = fetched.rev;
    cloudReady = true;
    if (fetched.state.updatedAt > getState().updatedAt) {
      adoptCloud(fetched);
    } else {
      if (!isUntouchedDefault(fetched.state)) backupSave(uid, fetched.state);
      cloudDirty = true;
    }
  } else { // same rev but refused: rules / permissions problem; keep playing locally
    setStatus('offline');
    notify('บันทึกขึ้นคลาวด์ถูกปฏิเสธ — เล่นต่อในเครื่อง', 'warn');
  }
}

// ---- single writer per save (BroadcastChannel) ----

function ensureChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(WRITER_CHANNEL);
  channel.onmessage = e => {
    const m = e.data;
    if (!m || m.tab === tabId || m.scope !== scopeId()) return;
    if (m.type === 'claim') {
      channel.postMessage({ type: 'ack', scope: m.scope, tab: tabId, writer: isWriter });
      yieldWriter();
    } else {
      if (m.type === 'yielded') lastYieldedAt = performance.now();
      for (const listener of [...messageListeners]) listener(m);
    }
  };
}

/** Resolves with the first message of `type` (passing `accept`), or null after `ms`. */
function waitForMessage(type, ms, accept = () => true) {
  return new Promise(resolve => {
    const done = msg => {
      clearTimeout(timer);
      messageListeners.delete(listener);
      resolve(msg);
    };
    const listener = m => { if (m.type === type && accept(m)) done(m); };
    const timer = setTimeout(() => done(null), ms);
    messageListeners.add(listener);
  });
}

/** Another tab claimed this save: write the shared local cache NOW, finish any upload, announce it, step back. */
function yieldWriter() {
  if (!isWriter) return;
  const scope = scopeId();
  localDirty = true;
  flushLocal();
  cloudDirty = cloudDirty || tickDirty;
  const upload = flushCloud();
  isWriter = false;
  syncing = false;
  setStatus();
  notify('อีกแท็บกำลังเล่นอยู่ — แท็บนี้หยุดบันทึก (กด "เล่นที่นี่" เพื่อกลับมาเล่นต่อ)', 'info');
  void upload.finally(() => {
    if (channel) channel.postMessage({ type: 'yielded', scope, tab: tabId, rev: cloudRev, updatedAt: getState().updatedAt });
  });
}

/**
 * After becoming the writer: find out whether another tab was writing (ack), wait briefly for its final save
 * (yielded), then continue from the newest of {this tab's memory, the shared local cache, the cloud doc} by
 * updatedAt (cloud rev becomes lastKnownRev). Every losing copy that differs is backed up. The UI stays inert
 * (status 'syncing') meanwhile. `alone`: right after a fresh load with no other tab there is nothing to compare.
 */
async function reconcileAfterClaim(alone) {
  const myEpoch = epoch;
  const key = target.key;
  const uid = target.uid;
  const stillMine = () => epoch === myEpoch && isWriter && target.key === key;
  syncing = true;
  setStatus();
  try {
    const ack = await waitForMessage('ack', ACK_WAIT_MS, m => m.writer);
    // (a 'yielded' that already arrived after our claim counts: messages can overtake each other)
    if (ack && lastYieldedAt < claimedAt) await waitForMessage('yielded', YIELD_WAIT_MS);
    else if (alone) return;
    if (!stillMine()) return;

    const candidates = [{ source: 'memory', state: getState() }];
    const cache = loadLocal(key);
    if (cache) candidates.push({ source: 'local', state: cache });
    let fetched = null;
    if (uid && cloudReady) {
      try {
        fetched = await fetchCloud(uid);
      } catch {
        fetched = null; // offline: the rev check still protects the next write
      }
      if (!stillMine()) return;
      if (fetched) {
        candidates.push({ source: 'cloud', state: fetched.state });
        if (fetched.rev > cloudRev) cloudRev = fetched.rev;
      }
    }
    const best = candidates.reduce((b, c) => (c.state.updatedAt > b.state.updatedAt ? c : b));
    if (best.source === 'memory') {
      backupLosers(candidates, best);
      if (fetched && fetched.state.updatedAt < best.state.updatedAt) cloudDirty = true; // cloud is behind: upload ours
      return;
    }
    if (!applyFn) return; // nothing can install the state yet
    backupLosers(candidates, best);
    if (best.source === 'cloud') {
      installState(best.state, { fromCloud: true, uploadNeeded: false });
      notify(ADOPT_MSG, 'warn');
    } else {
      installState(best.state, { fromCloud: false, uploadNeeded: !!uid });
      notify('ซิงก์ข้อมูลล่าสุดจากอีกแท็บแล้ว', 'info');
    }
  } finally {
    if (epoch === myEpoch) {
      syncing = false;
      setStatus();
      if (isWriter) void flushCloud();
    }
  }
}

/** Makes this tab the saving one (call when it gains focus or the player taps "เล่นที่นี่"). */
export function claimWriter() {
  ensureChannel();
  const wasWriter = isWriter;
  isWriter = true;
  claimedAt = performance.now();
  if (channel) channel.postMessage({ type: 'claim', scope: scopeId(), tab: tabId });
  if (!wasWriter || freshLoad) {
    const alone = freshLoad && aloneOk;
    freshLoad = false;
    void reconcileAfterClaim(alone);
  } else {
    setStatus();
  }
}

/** Fresh load / account switch: this tab only becomes the writer if it is actually in front. */
function acquireWriterIfVisible() {
  isWriter = false;
  syncing = false;
  freshLoad = true;
  aloneOk = document.visibilityState === 'visible';
  epoch += 1;
  ensureChannel();
  if (document.visibilityState === 'visible') claimWriter();
  else setStatus();
}

function markAllDirty() {
  localDirty = true;
  if (cloudDirty || tickDirty) cloudDirty = true;
}

/** Saves everything now (local immediately, cloud awaited). Used on logout. */
export async function flushSave() {
  for (let i = 0; syncing && i < 40; i++) await new Promise(r => setTimeout(r, 50));
  localDirty = true;
  cloudDirty = true;
  flushLocal();
  await flushCloud();
  await flushCloud();
}

function flushOnLeave() {
  markAllDirty();
  flushLocal();
  void flushCloud();
}

/** apply(state) installs a state into the game; it is used when another tab / the cloud holds newer data. */
export function startAutosave(apply) {
  if (apply) applyFn = apply;
  syncedStamp = getState().updatedAt; // the boot state was just loaded from the local save
  subscribe(ev => {
    localDirty = true;
    if (ev === 'change') cloudDirty = true;
    else tickDirty = true;
  });
  setInterval(flushLocal, LOCAL_INTERVAL_MS);
  setInterval(() => {
    if (!cloudDirty && tickDirty && now() - lastCloudAt >= TICK_UPLOAD_MS) cloudDirty = true;
    void flushCloud();
  }, CLOUD_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnLeave();
    else claimWriter();
  });
  window.addEventListener('focus', () => { if (document.visibilityState === 'visible') claimWriter(); });
  window.addEventListener('pagehide', flushOnLeave);
  acquireWriterIfVisible();
  window.addEventListener('offline', () => { if (target.uid && cloudReady) setStatus('offline'); });
  window.addEventListener('online', () => {
    if (target.uid && cloudReady) {
      cloudDirty = true;
      void flushCloud();
    }
  });
}

// ---- guest <-> account switching ----

/** Newest non-pristine save wins; pristine saves only win when nothing else exists. Ties keep list order. */
function pickNewest(candidates) {
  const rank = c => (isPristine(c.state) ? -1 : c.state.updatedAt);
  return candidates.reduce((best, c) => (rank(c) > rank(best) ? c : best));
}

const FRESH = createNewState();
const START_KIT = JSON.stringify([FRESH.player.coins, FRESH.inventory]);

/** A brand-new save nobody played or spent anything on: not worth backing up. */
const isUntouchedDefault = s => isPristine(s) && JSON.stringify([s.player.coins, s.inventory]) === START_KIT;

function removeGuestSave() {
  try { localStorage.removeItem(GUEST_KEY); } catch { /* storage unavailable */ }
}

/** Keeps a copy of a save that is about to be overwritten: `nongfarm_<uid>_backup_<ts>`, latest 3 kept. */
function backupSave(uid, state) {
  const prefix = `nongfarm_${uid}_backup_`;
  lastBackupTs = Math.max(now(), lastBackupTs + 1);
  try {
    localStorage.setItem(`${prefix}${lastBackupTs}`, JSON.stringify(state));
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
    for (const k of keys.slice(0, -MAX_BACKUPS)) localStorage.removeItem(k);
  } catch (e) {
    console.error('Backup failed', e);
  }
}

const describeFarm = s => ({
  farmName: s.player.farmName, level: s.player.level, coins: Math.floor(s.player.coins), pets: s.pets.length,
});

/**
 * Called after sign-in. Decides which save to play, switches the save target to the account and hands the
 * winner to apply(state) (which must replace the game state). Returns { source, cloudFailed, switched }.
 *  - cloud vs per-account local cache: newer updatedAt wins.
 *  - The guest save is only a migration candidate: it is used outright when the account has no save yet;
 *    otherwise, if it holds real progress, askWhichFarm(accountSummary, guestSummary) -> Promise<'cloud'|'guest'>
 *    lets the player choose (anything but 'guest' keeps the account farm).
 *  - Every save that gets overwritten is first copied to a backup key (latest 3 kept).
 */
export async function connectUser(uid, apply, askWhichFarm) {
  let cloud = null;
  let fetchedRev = 0;
  let cloudFailed = false;
  try {
    const fetched = await fetchCloud(uid);
    cloud = fetched ? fetched.state : null;
    fetchedRev = fetched ? fetched.rev : 0;
  } catch (e) {
    console.error('Cloud load failed', e);
    cloudFailed = true;
  }

  // Keep the guest save current before the target changes.
  localDirty = true;
  flushLocal();

  const key = userKey(uid);
  const cached = loadWithLegacy(key, legacyUserKey(uid));

  if (cloudFailed) {
    notify('ต่อคลาวด์ไม่ได้ — เล่นต่อในเครื่อง รีเฟรชหน้าเพื่อลองใหม่', 'warn');
    setStatus('offline');
    if (!cached) return { source: 'guest', cloudFailed, switched: false }; // keep playing the guest save untouched
    target = { key, uid };
    applyFn = apply;
    cloudReady = false; // never upload before the cloud copy has been reconciled
    cloudDirty = false;
    tickDirty = false;
    acquireWriterIfVisible();
    apply(cached);
    if (isWriter) saveLocal(key, getState());
    localDirty = false;
    return { source: 'cache', cloudFailed, switched: true };
  }

  const own = [];
  if (cloud) own.push({ source: 'cloud', state: cloud });
  if (cached) own.push({ source: 'cache', state: cached });
  // A cloud save from a newer client always wins: this client cannot judge or safely merge it.
  const newerCloud = own.find(o => o.source === 'cloud' && isNewerSave(o.state));
  let chosen = newerCloud || (own.length ? pickNewest(own) : null);
  let guest = target.uid === null && !newerCloud ? getState() : null;

  if (guest && chosen && guest.updatedAt === chosen.state.updatedAt) {
    removeGuestSave(); // same farm as the account's: already migrated earlier
    guest = null;
  }
  if (!chosen) {
    chosen = { source: 'guest', state: guest || createNewState() };
  } else if (guest && !isPristine(guest)) {
    const pick = await askWhichFarm(describeFarm(chosen.state), describeFarm(guest));
    guest = getState(); // the guest farm keeps running while the dialog is open
    if (pick === 'guest') {
      chosen = { source: 'guest', state: guest };
    } else {
      backupSave(uid, guest);
      removeGuestSave();
    }
  }

  // Back up every account save that is about to be overwritten (same updatedAt = same save, nothing lost).
  for (const o of own) {
    if (o !== chosen && !isUntouchedDefault(o.state) && o.state.updatedAt !== chosen.state.updatedAt) {
      backupSave(uid, o.state);
    }
  }

  target = { key, uid };
  cloudReady = true;
  cloudRev = fetchedRev;
  applyFn = apply;
  acquireWriterIfVisible();
  apply(chosen.state);
  syncedStamp = chosen.source === 'cloud' ? getState().updatedAt : -1; // -1: local copy not uploaded yet
  // A background tab must not touch the shared cache: the active tab owns it.
  const saved = isWriter ? saveLocal(key, getState()) : false;
  localDirty = false;
  tickDirty = false;

  if (chosen.source === 'guest' && saved) {
    // The guest farm now lives in the account cache: retire the guest slot whatever the upload does.
    if (!isUntouchedDefault(chosen.state)) backupSave(uid, chosen.state);
    removeGuestSave();
  }

  if (chosen.source === 'cloud') {
    cloudDirty = false; // we just downloaded this; nothing to upload yet
    setStatus('saved');
  } else {
    cloudDirty = true; // account had no (or an older) save: upload the winning local copy (retried by autosave)
    void flushCloud();
  }
  return { source: chosen.source, cloudFailed, switched: true };
}

/**
 * Called after sign-out: switches back to the guest save and hands it to apply(state).
 * Returns { isNew }: true when the guest farm is brand new (no save, or an untouched default farm), so the
 * caller should ask for a farm name.
 */
export function disconnectUser(apply) {
  localDirty = true;
  flushLocal(); // skipped when another tab owns the account: never clobber its save with a stale copy
  localDirty = false;
  target = { key: GUEST_KEY, uid: null };
  cloudReady = false;
  cloudDirty = false;
  tickDirty = false;
  cloudRev = 0;
  applyFn = apply;
  acquireWriterIfVisible();
  const { state, isNew } = loadGuest();
  apply(state);
  syncedStamp = getState().updatedAt; // just loaded from the guest save
  setStatus('saved');
  return { isNew: isNew || (isPristine(state) && state.player.farmName === DEFAULT_FARM_NAME) };
}

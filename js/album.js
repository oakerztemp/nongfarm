// Photo album (CONTRACT_V9 §2): photos live in IndexedDB on this device only. They are NEVER part of the save, so cloud saves stay small.
//   up to ALBUM_MAX (30) photos, each a JPEG scaled so its long side is <= ALBUM_SIZE (960 px), with { id, at, petIds, frame, w, h, bytes }.
//   Two object stores ('meta' and 'blobs') so listing the album never loads the pictures.
//
//   albumAvailable()                              -> boolean (IndexedDB present)
//   savePhoto(dataUrl, { petIds, frame, filename })-> Promise<{ ok, stored, id?, meta?, fallback?: 'download', error? }>
//   listPhotos()                                  -> Promise<meta[]> newest first
//   getPhotoBlob(id) / getPhotoUrl(id)            -> Promise<Blob|null> / Promise<objectURL|null> (revoke with URL.revokeObjectURL)
//   deletePhoto(id), clearAlbum(), photoCount()
//   downloadPhoto(blobOrDataUrl, filename)        -> triggers a browser download (also the fallback when IndexedDB is missing)
//   sharePhoto(blob, text)                        -> Web Share API when it can share files, else false
// Every function resolves, none throws: a failure becomes { ok:false, error } or an empty result.
import { now, uid } from './util.js';

export const ALBUM_MAX = 30;
export const ALBUM_SIZE = 960;
export const ALBUM_QUALITY = 0.86;
const DB_NAME = 'nongfarm_album';
const DB_VERSION = 1;

let override; // undefined = real indexedDB, null = pretend it is missing, object = a test double
let dbPromise = null;

/** Tests: replace the IndexedDB factory (an IDBFactory) or pass null to simulate "no IndexedDB"; no argument restores the real one. */
export function setAlbumBackend(factory) {
  override = factory;
  if (dbPromise) { dbPromise.then(db => { try { db.close(); } catch { /* closed */ } }, () => {}); }
  dbPromise = null;
}

function factory() {
  if (override !== undefined) return override;
  try { return typeof indexedDB !== 'undefined' ? indexedDB : null; } catch { return null; }
}

export const albumAvailable = () => !!factory();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const f = factory();
    if (!f) { reject(new Error('no IndexedDB')); return; }
    let req;
    try { req = f.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' }).createIndex('at', 'at');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch { /* closed */ } dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const reqP = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const txDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

// ---- image helpers ----

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

/** dataURL (or blob URL) -> JPEG Blob whose long side is <= maxSide. Smaller pictures are not enlarged. */
export async function toAlbumBlob(src, maxSide = ALBUM_SIZE, quality = ALBUM_QUALITY) {
  const img = await loadImage(src);
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; // JPEG has no alpha
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('encode failed');
  return { blob, w, h };
}

/** Triggers a download of a Blob / dataURL. Returns true when the click was dispatched. */
export function downloadPhoto(data, filename = 'nongfarm.jpg') {
  try {
    const url = typeof data === 'string' ? data : URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (e) {
    console.error('download failed', e);
    return false;
  }
}

/** Web Share API with a file, when the browser supports it. Resolves true when the share sheet was used. */
export async function sharePhoto(blob, text = '') {
  try {
    const file = new File([blob], 'nongfarm.jpg', { type: 'image/jpeg' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], text });
    return true;
  } catch {
    return false; // cancelled or not allowed
  }
}

/** 'nongfarm-2026-10-25-1405.jpg' */
export function photoFilename(meta) {
  const d = new Date(meta && Number.isFinite(meta.at) ? meta.at : now());
  const p = n => String(n).padStart(2, '0');
  return `nongfarm-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.jpg`;
}

// ---- album ----

/** Stores a photo (dataURL from world.snapshot / the frame canvas). Falls back to a download when IndexedDB is missing or fails. */
export async function savePhoto(dataUrl, { petIds = [], frame = 0, filename } = {}) {
  let scaled;
  try {
    scaled = await toAlbumBlob(dataUrl);
  } catch (e) {
    return { ok: false, stored: false, error: String(e && e.message || e) };
  }
  const at = now();
  const meta = {
    id: `ph${at.toString(36)}${uid().slice(0, 4)}`, at,
    petIds: (Array.isArray(petIds) ? petIds : []).filter(x => typeof x === 'string').slice(0, 20),
    frame: Number.isFinite(frame) ? frame : 0, w: scaled.w, h: scaled.h, bytes: scaled.blob.size,
  };
  try {
    const db = await openDb();
    const tx = db.transaction(['meta', 'blobs'], 'readwrite');
    tx.objectStore('meta').put(meta);
    tx.objectStore('blobs').put(scaled.blob, meta.id);
    await txDone(tx);
    try { await trimAlbum(db); } catch (e) { console.error('album trim failed', e); } // stored anyway
    return { ok: true, stored: true, id: meta.id, meta };
  } catch (e) {
    const ok = downloadPhoto(scaled.blob, filename || photoFilename(meta));
    return { ok, stored: false, fallback: 'download', error: String(e && e.message || e) };
  }
}

/** Keeps the newest ALBUM_MAX photos. */
async function trimAlbum(db) {
  const all = await reqP(db.transaction('meta').objectStore('meta').getAll());
  if (all.length <= ALBUM_MAX) return;
  all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const tx = db.transaction(['meta', 'blobs'], 'readwrite');
  for (const m of all.slice(0, all.length - ALBUM_MAX)) { tx.objectStore('meta').delete(m.id); tx.objectStore('blobs').delete(m.id); }
  await txDone(tx);
}

export async function listPhotos() {
  try {
    const db = await openDb();
    const all = await reqP(db.transaction('meta').objectStore('meta').getAll());
    return all.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  } catch {
    return [];
  }
}

export const photoCount = async () => (await listPhotos()).length;

export async function getPhotoBlob(id) {
  try {
    const db = await openDb();
    return (await reqP(db.transaction('blobs').objectStore('blobs').get(id))) || null;
  } catch {
    return null;
  }
}

export async function getPhotoUrl(id) {
  const blob = await getPhotoBlob(id);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function deletePhoto(id) {
  try {
    const db = await openDb();
    const tx = db.transaction(['meta', 'blobs'], 'readwrite');
    tx.objectStore('meta').delete(id);
    tx.objectStore('blobs').delete(id);
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

export async function clearAlbum() {
  try {
    const db = await openDb();
    const tx = db.transaction(['meta', 'blobs'], 'readwrite');
    tx.objectStore('meta').clear();
    tx.objectStore('blobs').clear();
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

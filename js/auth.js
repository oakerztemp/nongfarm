// Firebase Auth (Google) + Firestore handle. Firebase is loaded lazily via dynamic import()
// and only when firebase-config.js has real values, so Guest mode never touches the network.
import { firebaseConfig } from './firebase-config.js';
import { notify } from './util.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const REQUIRED_KEYS = ['apiKey', 'projectId', 'appId'];

export function isFirebaseConfigured() {
  return REQUIRED_KEYS.every(k => {
    const v = firebaseConfig[k];
    return typeof v === 'string' && v !== '' && !v.startsWith('YOUR_');
  });
}

// Redirect sign-in only survives browser storage partitioning when the page is served from the
// project's own Firebase Hosting domain (which also serves /__/auth/handler). Elsewhere, e.g.
// localhost, it returns to the game without a user, so we never fall back to it there.
function isOnFirebaseHosting() {
  const host = location.hostname;
  const id = firebaseConfig.projectId;
  return host === `${id}.web.app` || host === `${id}.firebaseapp.com`;
}

let loading = null;

function loadFirebase() {
  if (!loading) {
    loading = (async () => {
      const [appMod, authMod, fsMod] = await Promise.all([
        import(`${SDK}firebase-app.js`),
        import(`${SDK}firebase-auth.js`),
        import(`${SDK}firebase-firestore.js`),
      ]);
      const config = isOnFirebaseHosting() ? { ...firebaseConfig, authDomain: location.host } : firebaseConfig;
      const app = appMod.initializeApp(config);
      return { auth: authMod.getAuth(app), authMod, db: fsMod.getFirestore(app), fsMod };
    })().catch(err => {
      loading = null; // allow a retry on the next call
      throw err;
    });
  }
  return loading;
}

/**
 * Firestore accessors for storage.js: { db, doc, getDoc, setDoc }.
 * Resolves to null when Firebase is not configured; rejects if the SDK cannot be loaded.
 */
export async function getDb() {
  if (!isFirebaseConfigured()) return null;
  const { db, fsMod } = await loadFirebase();
  return { db, doc: fsMod.doc, getDoc: fsMod.getDoc, setDoc: fsMod.setDoc };
}

function toPlainUser(u) {
  return u ? { uid: u.uid, displayName: u.displayName || '', photoURL: u.photoURL || '' } : null;
}

/** Calls onUserChange({uid, displayName, photoURL} | null) at least once (null if Firebase is unavailable). */
export async function initAuth(onUserChange) {
  if (!isFirebaseConfigured()) {
    onUserChange(null);
    return;
  }
  try {
    const { auth, authMod } = await loadFirebase();
    authMod.onAuthStateChanged(auth, u => onUserChange(toPlainUser(u)));
    // Surface a failed redirect sign-in instead of silently landing back as Guest.
    authMod.getRedirectResult(auth).catch(e => {
      console.error('Redirect sign-in failed', e);
      notify(`เข้าสู่ระบบไม่สำเร็จ (${e.code || e.message})`, 'error');
    });
  } catch (e) {
    console.error('Firebase load failed', e);
    notify('โหลด Firebase ไม่สำเร็จ — เล่นแบบ Guest ต่อ', 'warn');
    onUserChange(null);
  }
}

const SILENT_ERRORS = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

export async function signInWithGoogle() {
  if (!isFirebaseConfigured()) {
    notify('ยังไม่ได้ตั้งค่า Firebase — ดู README', 'warn');
    return;
  }
  try {
    const { auth, authMod } = await loadFirebase();
    const provider = new authMod.GoogleAuthProvider();
    try {
      await authMod.signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code !== 'auth/popup-blocked') throw e;
      if (!isOnFirebaseHosting()) {
        notify('เบราว์เซอร์บล็อกหน้าต่างล็อกอิน (popup) — กดอนุญาต popup ของเว็บนี้ที่แถบที่อยู่ แล้วกดเข้าสู่ระบบอีกครั้ง', 'warn');
        return;
      }
      await authMod.signInWithRedirect(auth, provider); // page navigates away
    }
  } catch (e) {
    if (SILENT_ERRORS.includes(e.code)) return;
    console.error('Sign-in failed', e);
    notify(`เข้าสู่ระบบไม่สำเร็จ (${e.code || e.message})`, 'error');
  }
}

export async function signOutUser() {
  try {
    const { auth, authMod } = await loadFirebase();
    await authMod.signOut(auth);
  } catch (e) {
    console.error('Sign-out failed', e);
    notify('ออกจากระบบไม่สำเร็จ', 'error');
  }
}

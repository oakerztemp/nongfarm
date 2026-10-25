// Bootstrap: load save, offline catch-up, game loop, header, tabs, toasts, daily reward, login UI.
import {
  getState, replaceState, update, subscribe, emit, migrate,
  addCoins, addItem, xpForLevel, DEFAULT_FARM_NAME,
} from './state.js';
import {
  now, escapeHtml, notify, onNotify, openModal, refreshTimers, morph,
  todayKey, randInt, addLog, formatDuration,
} from './util.js';
import * as storage from './storage.js';
import { initAuth, signInWithGoogle, signOutUser, isFirebaseConfigured } from './auth.js';
import { advance, MAX_OFFLINE_MS } from './tick.js';
import { syncJournal, journalAway } from './journal.js';
import { AWAY_MIN_MS, snapshotForAway, buildAwayDigest, setAwayDigest, takeAwayDigest } from './away.js';
import { CROPS } from './data/crops.js';
import { initQuestBar } from './ui/questBar.js';
import { openSettings } from './ui/settings.js';
import { createNotifyMemory, pollNotifications } from './notify.js';
import { initInstallPrompt, registerServiceWorker, showNotice } from './pwa.js';

const WELCOME_BACK_MS = 5 * 60 * 1000;
const RENDER_EVERY_MS = 10 * 1000;
const notifyMemory = createNotifyMemory();
const TAB_KEY = 'nongfarm_tab';
const VIEW_ORDER = ['barn', 'farm', 'explore', 'shop', 'bag', 'book'];
const VIEW_MODULES = ['./ui/petsView.js', './ui/farmView.js'];
const MAX_TOASTS = 5;
const TOAST_MS = 3000;
const DAILY_EGG_CHANCE = 0.2;

const $ = id => document.getElementById(id);

const panes = new Map(); // viewId -> { view, el }
let activeId = null;
let lastRender = 0;
let lastTickAt = now();
let lastReadySig = '';
let renderQueued = false;
let currentUser = null;
let currentUid = null;
let needsName = false;
let ready = false; // true after the first auth result (daily reward waits for it)
let authChain = Promise.resolve();
let authBusy = false;

// ---- time advance (ticks + offline catch-up live in tick.js) ----

/** The "pets welcome you back" digest, once: { lines, highlights, awayMs, at } after an absence of >= 30 min, else null (CONTRACT_V8 §3). */
export function getAwayDigest() {
  const d = takeAwayDigest();
  if (d) update(st => { st.lastGreetAt = now(); }); // shown now: no second greeting until another 30 min have passed
  return d;
}

function advanceTo(state, toMs) {
  // snapshot BEFORE the catch-up so the digest can say what changed while the player was away
  const greeted = toMs - (Number(state.lastGreetAt) || 0) < AWAY_MIN_MS; // greeted less than 30 min ago: stay quiet
  const before = !greeted && toMs - state.lastTick >= AWAY_MIN_MS ? snapshotForAway(state) : null;
  const { gap, replayed } = advance(state, toMs);
  if (before) {
    try {
      const digest = buildAwayDigest(before, state, Math.min(gap, MAX_OFFLINE_MS));
      setAwayDigest(digest, Math.min(gap, MAX_OFFLINE_MS));
      journalAway(state, digest); // the diary keeps the highlights of the time away
    } catch (e) { console.error('away digest failed', e); }
  }
  if (replayed && gap > WELCOME_BACK_MS) {
    notify(`ยินดีต้อนรับกลับ! ผ่านไป ${formatDuration(Math.min(gap, MAX_OFFLINE_MS))}`, 'info');
  }
}

/** Installs a loaded/merged state after replaying the time since it was last played. */
function loadState(raw) {
  const s = migrate(raw);
  advanceTo(s, now());
  replaceState(s);
}

function loop() {
  advanceTo(getState(), now());
  emit('tick');
  refreshTimers(document);
  if (ready) {
    maybeClaimDaily();
    sendNotifications();
  }
}

/** Local notifications: only when the player is not looking at the game (see notify.js for the rules). */
function sendNotifications() {
  const active = document.visibilityState === 'visible' && document.hasFocus();
  for (const notice of pollNotifications(getState(), now(), notifyMemory, { active })) {
    void showNotice(notice, tab => showTab(tab));
  }
}

// ---- toasts ----

function showToast(msg, type) {
  const root = $('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' || type === 'warn' ? 'alert' : 'status');
  el.textContent = msg;
  const dismiss = () => {
    if (el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  el.addEventListener('click', dismiss);
  root.appendChild(el);
  while (root.children.length > MAX_TOASTS) root.firstElementChild.remove();
  setTimeout(dismiss, TOAST_MS);
}

// ---- header ----

function updateHeader() {
  const { player } = getState();
  const need = xpForLevel(player.level);
  $('hdr-farm-name').textContent = player.farmName;
  $('hdr-level').textContent = `Lv.${player.level}`;
  $('hdr-xp-fill').style.width = `${Math.min(100, (player.xp / need) * 100).toFixed(1)}%`;
  $('hdr-xp-text').textContent = `${Math.floor(player.xp)}/${need}`;
  $('hdr-coins').textContent = Math.floor(player.coins).toLocaleString('th-TH');
}

function updateSaveDot() {
  const st = storage.getSaveStatus();
  const cloud = storage.isCloudActive();
  const titles = {
    saved: cloud ? 'บันทึกบนคลาวด์แล้ว' : 'บันทึกในเครื่องแล้ว (Guest)',
    saving: 'กำลังบันทึกขึ้นคลาวด์…',
    offline: cloud ? 'บันทึกขึ้นคลาวด์ไม่ได้ — เล่นต่อในเครื่อง' : 'บันทึกในเครื่องไม่ได้',
    othertab: 'อีกแท็บกำลังเล่นอยู่ — แท็บนี้ไม่บันทึกขึ้นคลาวด์',
    syncing: 'กำลังซิงก์ข้อมูลล่าสุด…',
  };
  const dot = $('save-dot');
  dot.dataset.status = st;
  dot.title = titles[st];
  dot.setAttribute('aria-label', titles[st]);
  // A backup tab is read-only: dim it and block every interaction until the player claims it again.
  // While syncing right after taking over, the same lock applies (briefly) so no action can be lost.
  const inactive = st === 'othertab' || st === 'syncing';
  $('tab-banner').hidden = !inactive;
  $('tab-banner-text').textContent = st === 'syncing' ? 'กำลังซิงก์…' : "แท็บนี้เป็นแท็บสำรอง — กด 'เล่นที่นี่' เพื่อเล่นต่อ";
  $('tab-claim').hidden = st === 'syncing';
  document.body.classList.toggle('tab-inactive', st === 'othertab');
  document.body.classList.toggle('tab-syncing', st === 'syncing');
  for (const id of ['view-root', 'quest-bar', 'modal-root']) $(id).inert = inactive;
}

function renderUser() {
  const el = $('hdr-user');
  if (currentUser) {
    const name = currentUser.displayName || 'ผู้เล่น';
    const photo = currentUser.photoURL.startsWith('https://')
      ? `<img class="hdr-avatar" src="${escapeHtml(currentUser.photoURL)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="hdr-avatar hdr-avatar-fallback" aria-hidden="true">${escapeHtml([...name][0])}</span>`;
    el.innerHTML =
      `${photo}<span class="hdr-user-name">${escapeHtml(name)}</span>` +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="logout">ออก</button>';
  } else if (isFirebaseConfigured()) {
    el.innerHTML =
      '<button type="button" class="btn btn-primary btn-sm" data-act="login" title="เข้าสู่ระบบด้วย Google">เข้าสู่ระบบ</button>';
  } else {
    el.innerHTML =
      '<span title="ยังไม่ได้ตั้งค่า Firebase — ดู README">' +
      '<button type="button" class="btn btn-sm" disabled>เข้าสู่ระบบ</button></span>';
  }
  updateSaveDot();
}

async function onUserAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || authBusy) return;
  authBusy = true;
  btn.disabled = true;
  try {
    if (btn.dataset.act === 'login') {
      await signInWithGoogle();
    } else if (btn.dataset.act === 'logout') {
      // Save to the cloud first (bounded wait), then sign out.
      await Promise.race([storage.flushSave(), new Promise(r => setTimeout(r, 4000))]);
      await signOutUser();
    }
  } finally {
    authBusy = false;
    btn.disabled = false;
  }
}

// ---- tabs & views ----

async function loadViews() {
  const byId = new Map();
  const mods = await Promise.all(VIEW_MODULES.map(path =>
    import(path).catch(e => {
      console.error(`Failed to load ${path}`, e);
      return null;
    })));
  for (const m of mods) {
    for (const v of (m && m.views) || []) byId.set(v.id, v);
  }
  return VIEW_ORDER.filter(id => byId.has(id)).map(id => byId.get(id));
}

function buildViews(views) {
  const root = $('view-root');
  const bar = $('tab-bar');
  if (!views.length) {
    root.innerHTML = '<div class="empty-state">โหลดหน้าจอเกมไม่สำเร็จ — ลองรีเฟรชหน้า</div>';
    return;
  }
  for (const view of views) {
    const el = document.createElement('section');
    el.className = `view view-${view.id}`;
    el.hidden = true;
    root.appendChild(el);
    panes.set(view.id, { view, el });
    try { view.bind(el); } catch (e) { console.error(`bind(${view.id}) failed`, e); }

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.dataset.tab = view.id;
    tab.setAttribute('role', 'tab');
    tab.innerHTML =
      `<span class="tab-icon" aria-hidden="true">${escapeHtml(view.icon)}</span>` +
      `<span class="tab-label">${escapeHtml(view.label)}</span>`;
    bar.appendChild(tab);
  }
  bar.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) showTab(tab.dataset.tab);
  });

  let saved = new URLSearchParams(location.search).get('tab'); // set by notification clicks
  if (!panes.has(saved)) {
    try { saved = localStorage.getItem(TAB_KEY); } catch { /* storage unavailable */ }
  }
  showTab(panes.has(saved) ? saved : views[0].id);
}

function showTab(id) {
  if (!panes.has(id)) return;
  activeId = id;
  try { localStorage.setItem(TAB_KEY, id); } catch { /* storage unavailable */ }
  for (const [pid, p] of panes) p.el.hidden = pid !== id;
  for (const tab of $('tab-bar').children) {
    const on = tab.dataset.tab === id;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
  }
  renderActive();
  window.scrollTo(0, 0);
}

function renderActive() {
  const pane = panes.get(activeId);
  if (!pane) return;
  lastRender = now();
  lastReadySig = readySignature(getState());
  try {
    morph(pane.el, pane.view.render(getState()));
  } catch (e) {
    console.error(`render(${activeId}) failed`, e);
    pane.el.innerHTML = '<div class="empty-state">หน้านี้แสดงผลไม่ได้ — ลองสลับแท็บหรือรีเฟรช</div>';
  }
  refreshTimers(pane.el);
}

/** Cheap fingerprint of "something just became ready" (eggs, crops, expeditions). */
function readySignature(s) {
  const t = now();
  const eggs = s.incubator.filter(slot => slot.readyAt <= t).length;
  const crops = s.plots.filter(p => p.cropId && p.progress >= 1).length;
  const trips = s.expeditions.filter(e => e.done).length;
  return `${eggs}|${crops}|${trips}`;
}

/** True if a countdown shown in the active view reached zero since the previous tick. */
function countdownFinished(sinceMs, untilMs) {
  const pane = panes.get(activeId);
  if (!pane) return false;
  return [...pane.el.querySelectorAll('[data-countdown]')].some(el => {
    const end = Number(el.dataset.countdown);
    return end > sinceMs && end <= untilMs;
  });
}

function isEditingInActiveView() {
  const pane = panes.get(activeId);
  const a = document.activeElement;
  return !!(pane && a && pane.el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

function onStateEvent(ev) {
  if (ev === 'change') {
    try { syncJournal(getState()); } catch (e) { console.error('syncJournal failed', e); } // hatches + postcards of today -> diary (no emit: lines only)
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      updateHeader();
      renderActive();
    });
  } else if (ev === 'tick') {
    try { syncJournal(getState()); } catch (e) { console.error('syncJournal failed', e); }
    updateHeader();
    const t = now();
    const readyChanged = readySignature(getState()) !== lastReadySig || countdownFinished(lastTickAt, t);
    lastTickAt = t;
    if ((readyChanged || t - lastRender >= RENDER_EVERY_MS) && !isEditingInActiveView()) renderActive();
  }
}

// ---- daily reward & first run ----

function maybeClaimDaily() {
  const today = todayKey();
  const { player } = getState();
  if (player.lastDailyClaim === today) return;
  const unlocked = CROPS.filter(c => c.unlockLevel <= player.level);
  const seeds = [];
  const bonusEgg = Math.random() < DAILY_EGG_CHANCE;
  update(s => {
    s.player.lastDailyClaim = today;
    addCoins(s, 50);
    if (unlocked.length) {
      for (let i = 0; i < 3; i++) {
        const crop = unlocked[randInt(0, unlocked.length - 1)];
        addItem(s, `seed_${crop.id}`, 1);
        seeds.push(crop);
      }
    }
    if (bonusEgg) addItem(s, 'egg_farm', 1);
    addLog(s, 'รับรางวัลรายวัน');
  });
  const seedText = seeds.map(c => `${c.emoji}${c.nameTh}`).join(' ');
  notify(`🎁 รางวัลรายวัน! +50 🪙${seedText ? ` และเมล็ด ${seedText}` : ''}${bonusEgg ? ' และไข่ทุ่งนา 🥚 โชคดี!' : ''}`, 'success');
}

function promptFarmName() {
  const close = openModal({
    title: 'ยินดีต้อนรับสู่ฟาร์มน้องๆ 🐣',
    html:
      '<p class="muted">ตั้งชื่อฟาร์มของคุณ (ไม่เกิน 20 ตัวอักษร)</p>' +
      '<form class="name-form">' +
        `<input class="input" name="farm" maxlength="20" autocomplete="off" required value="${escapeHtml(DEFAULT_FARM_NAME)}">` +
        '<button type="submit" class="btn btn-primary">เริ่มเลย!</button>' +
      '</form>',
    onMount(el) {
      const form = el.querySelector('form');
      const input = form.elements.farm;
      input.focus();
      input.select();
      form.addEventListener('submit', e => {
        e.preventDefault();
        const name = input.value.trim().slice(0, 20) || DEFAULT_FARM_NAME;
        update(s => { s.player.farmName = name; });
        close();
      });
    },
  });
}

// ---- auth ----

const farmCardHtml = (heading, f) =>
  `<div class="card"><strong>${escapeHtml(heading)}</strong>` +
  `<div>${escapeHtml(f.farmName)}</div>` +
  `<div class="muted">Lv.${f.level} · 🪙 ${f.coins.toLocaleString('th-TH')} · น้องๆ ${f.pets} ตัว</div></div>`;

/** Asks which farm to keep when the account already has one and the guest save has real progress. */
function askWhichFarm(account, guest) {
  return new Promise(resolve => {
    let choice = 'cloud'; // closing the dialog keeps the account farm
    const close = openModal({
      title: 'พบฟาร์ม 2 แห่ง — เลือกฟาร์มที่จะใช้',
      html:
        '<div class="name-form">' +
          farmCardHtml('ฟาร์มในบัญชีของคุณ (คลาวด์)', account) +
          farmCardHtml('ฟาร์ม Guest ในเครื่องนี้', guest) +
          '<p class="muted">ฟาร์มที่ไม่ได้เลือกจะถูกสำรองไว้ในเครื่อง</p>' +
          '<button type="button" class="btn btn-primary" data-pick="cloud">ใช้ฟาร์มในบัญชี</button>' +
          '<button type="button" class="btn" data-pick="guest">ใช้ฟาร์ม Guest นี้</button>' +
        '</div>',
      onMount(el) {
        el.addEventListener('click', e => {
          const btn = e.target.closest('[data-pick]');
          if (!btn) return;
          choice = btn.dataset.pick;
          close();
        });
      },
      onClose: () => resolve(choice),
    });
  });
}

async function applyAuth(user) {
  const uid = user ? user.uid : null;
  if (uid !== currentUid) {
    if (user) {
      const { source, cloudFailed, switched } = await storage.connectUser(uid, loadState, askWhichFarm);
      if (switched) needsName = false;
      if (!cloudFailed) { // on failure storage already warned
        notify(source === 'cloud'
          ? 'เข้าสู่ระบบแล้ว — โหลดฟาร์มจากคลาวด์'
          : 'เข้าสู่ระบบแล้ว — กำลังบันทึกฟาร์มของคุณขึ้นคลาวด์', 'success');
      }
    } else {
      needsName = storage.disconnectUser(loadState).isNew;
      notify('ออกจากระบบแล้ว — กลับสู่โหมด Guest', 'info');
    }
    currentUid = uid;
  }
  currentUser = user;
  renderUser();
  if (needsName) {
    needsName = false;
    promptFarmName();
  }
  ready = true;
}

function onUserChange(user) {
  authChain = authChain.then(() => applyAuth(user)).catch(e => console.error('Auth handling failed', e));
}

// ---- start ----

async function start() {
  onNotify(showToast);

  const guest = storage.loadGuest();
  needsName = guest.isNew;
  loadState(guest.state);

  buildViews(await loadViews());
  initQuestBar($('quest-bar'), showTab);
  updateHeader();
  renderUser();
  $('hdr-user').addEventListener('click', onUserAction);
  storage.onSaveStatus(updateSaveDot);
  subscribe(onStateEvent);
  storage.startAutosave(loadState);
  $('tab-claim').addEventListener('click', storage.claimWriter);

  $('settings-btn').addEventListener('click', openSettings);
  initInstallPrompt();
  void registerServiceWorker();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => { // a notification was clicked
      if (e.data && e.data.type === 'open-tab') showTab(e.data.tab);
    });
  }

  setInterval(loop, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loop();
  });

  initAuth(onUserChange);
}

start().catch(e => console.error('Startup failed', e));

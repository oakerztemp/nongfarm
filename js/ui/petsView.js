// Pet views: 🏠 barn (incubator + pets + care) and 📖 book (collection).
// render() is pure string-building; all events go through delegated data-action handlers.

import { notify, escapeHtml, openModal, now, formatDuration, clamp, morph } from '../util.js';
import { update, getState, countItem } from '../state.js';
import { getBarnViewPref, setBarnViewPref, onPrefChange } from '../prefs.js';
import { isWorldSupported } from '../world3d/support.js'; // tiny, no three.js: asked before the engine is downloaded
import { getItem } from '../data/items.js';
import { EGGS, getEgg } from '../data/eggs.js';
import { SPECIES, HABITATS, RARITIES, JOBS, getSpecies } from '../data/species.js';
import { getTraitDef, TRAIT_SCALE } from '../data/traits.js';
import {
  STAGES, PERSONALITIES, petEmoji, petName, petMood, getPet,
  putEggInIncubator, hatchReady, feedPet, playWithPet, cleanPet, pickPoop,
  giveToy, healPet, toggleSleep, renamePet, releasePet, foodEffect,
  getTrait, bondProgress, giftAvailable, claimGift, BOND_DAILY_CAP, GIFT_MIN_HEARTS,
  STARDUST_BY_RARITY, BOOK_GOALS, getGoal, isGoalClaimed, claimGoal, makeShiny, buyHabitatEgg,
} from '../pets.js';

const e = escapeHtml;
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const DIET_TH = {
  veg: 'ผัก', fruit: 'ผลไม้', grain: 'ธัญพืช', meat: 'เนื้อสัตว์', fish: 'ปลา',
  insect: 'แมลง', sweet: 'ของหวาน', milk: 'นม', leaf: 'ใบไม้',
};

// ── Shared helpers ──────────────────────────────────────────────────────────
function run(fn) {
  const r = update(fn);
  if (!r) return r;
  if (r.ok) { if (r.msg) notify(r.msg, 'success'); }
  else notify(r.reason || 'ทำไม่สำเร็จ', 'warn');
  return r;
}

/** One click listener that dispatches on the nearest [data-action]. */
function delegate(root, handlers) {
  root.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || !root.contains(btn) || btn.disabled) return;
    const fn = handlers[btn.dataset.action];
    if (fn) fn(btn, ev);
  });
}

const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
const lvClass = v => (v >= 60 ? 'pet-lv-high' : v >= 30 ? 'pet-lv-mid' : 'pet-lv-low');
const stageOf = pet => STAGES[pet.stage] || STAGES[0];
const persOf = pet => PERSONALITIES[pet.personality] || PERSONALITIES.cheerful;

function statBar(icon, label, value) {
  const v = Math.round(clamp(value, 0, 100));
  return `<div class="pet-stat" title="${label} ${v}/100">
    <span class="pet-stat-label">${icon} ${label}</span>
    <span class="pet-bar"><span class="pet-bar-fill ${lvClass(v)}" style="width:${v}%"></span></span>
    <span class="pet-stat-val">${v}</span>
  </div>`;
}

function xpProgress(pet) {
  const cur = stageOf(pet);
  if (pet.stage >= STAGES.length - 1) return { pct: 100, text: `${Math.floor(pet.xp)} XP · ระดับสูงสุดแล้ว 👑` };
  const next = STAGES[pet.stage + 1];
  const pct = clamp(((pet.xp - cur.xp) / (next.xp - cur.xp)) * 100, 0, 100);
  return { pct, text: `${Math.floor(pet.xp)} / ${next.xp} XP → ${next.icon} ${next.nameTh}` };
}

function statusLabel(pet, state) {
  switch (pet.status) {
    case 'sleeping': return '💤 กำลังนอนหลับ';
    case 'working': {
      const idx = pet.task && pet.task.type === 'plot' ? pet.task.plotIndex : null;
      return idx == null ? '🌾 กำลังทำงาน' : `🌾 ทำงานที่แปลง ${idx + 1}`;
    }
    case 'expedition': {
      const ex = pet.task && state.expeditions.find(x => x.id === pet.task.expeditionId);
      return ex && !ex.done
        ? `🧭 ออกสำรวจ (อีก <span data-countdown="${ex.endAt}">${formatDuration(ex.endAt - now())}</span>)`
        : '🧭 ออกสำรวจ';
    }
    default: return pet.sick ? '🤒 ป่วย' : '🟢 ว่าง';
  }
}

function heartsHtml(hearts) {
  return Array.from({ length: 5 }, (_, i) => (i < hearts ? '❤️' : '🤍')).join('');
}

function traitBadge(species) {
  const def = species && getTraitDef(species.trait);
  return def ? `<span class="pet-trait" title="${e(def.descTh)}">${def.emoji} ${def.nameTh}</span>` : '';
}

function traitBlock(species) {
  const def = getTraitDef(species.trait);
  if (!def) return '';
  const scale = TRAIT_SCALE[species.rarity] || 1;
  return `<div class="pet-trait-box"><b>${def.emoji} ${def.nameTh}</b><br><small>${def.descTh}</small>` +
    `${scale > 1 ? `<br><small class="muted">โบนัสตามความหายาก x${scale}</small>` : ''}</div>`;
}

function dietChips(species) {
  return species.diet.map(t => `<span class="pet-tag">${DIET_TH[t] || t}</span>`).join('');
}

function favoriteLabel(species) {
  const it = getItem(species.favorite);
  return it ? `${it.emoji} ${e(it.nameTh)}` : e(species.favorite);
}

function rarityBadge(species) {
  const r = RARITIES[species.rarity];
  return `<span class="pet-rarity" style="--rar:${r.color}">${r.nameTh}</span>`;
}

// ── Pet chip & picker (exported for farm views) ─────────────────────────────
export function petChipHtml(pet) {
  const st = stageOf(pet);
  return `<span class="pet-chip${pet.shiny ? ' is-shiny' : ''}">` +
    `<span class="pet-chip-emoji">${petEmoji(pet)}</span>` +
    `<span class="pet-chip-name">${e(petName(pet))}</span>` +
    `<span class="pet-chip-stage">${st.icon} ${st.nameTh}</span></span>`;
}

export function openPetPicker({ title = 'เลือกน้อง', filter, describe, onPick } = {}) {
  const pets = getState().pets.filter(p => (filter ? filter(p) : true));
  const html = pets.length
    ? `<div class="pet-picker-list">${pets.map(p =>
        `<button type="button" class="pet-picker-item" data-pet-id="${e(p.id)}">` +
        `${petChipHtml(p)}<span class="pet-picker-desc">${describe ? describe(p) : ''}</span></button>`).join('')}</div>`
    : '<p class="muted pet-picker-empty">ตอนนี้ไม่มีน้องที่ทำงานนี้ได้ (ดูว่าน้องหิว เหนื่อย ป่วย หรือกำลังทำอย่างอื่นอยู่หรือเปล่า)</p>';
  let close = () => {};
  close = openModal({
    title,
    html,
    onMount(el) {
      el.addEventListener('click', ev => {
        const b = ev.target.closest('.pet-picker-item');
        if (!b) return;
        const id = b.dataset.petId;
        close();
        if (onPick) onPick(id);
      });
    },
  });
  return close;
}

// ── Barn: incubator ─────────────────────────────────────────────────────────
function renderIncubator(state, t) {
  const slots = [];
  for (let i = 0; i < state.incubatorCapacity; i++) {
    const slot = state.incubator[i];
    if (!slot) {
      const owned = EGGS.reduce((n, eg) => n + countItem(state, eg.id), 0);
      slots.push(`<div class="incu-slot is-empty">
        <div class="incu-egg" aria-hidden="true">➕</div>
        <div class="incu-info">
          <div class="incu-name">ช่องว่าง</div>
          ${owned > 0
            ? '<button type="button" class="btn btn-sm btn-primary" data-action="put-egg">🥚 ใส่ไข่</button>'
            : '<div class="incu-time muted">ไม่มีไข่ในกระเป๋า — ซื้อได้ที่ร้านค้า 🛒</div>'}
        </div></div>`);
      continue;
    }
    const egg = getEgg(slot.eggId);
    const ready = t >= slot.readyAt;
    const pct = ready ? 100 : clamp(((t - slot.startAt) / (slot.readyAt - slot.startAt)) * 100, 0, 100);
    slots.push(`<div class="incu-slot${ready ? ' is-ready' : ''}" style="--egg-color:${egg ? egg.color : '#f6e7b0'}">
      <div class="incu-egg" aria-hidden="true">${egg ? egg.emoji : '🥚'}</div>
      <div class="incu-info">
        <div class="incu-name">${egg ? e(egg.nameTh) : 'ไข่ปริศนา'}</div>
        ${ready
          ? '<div class="incu-time incu-ready-text">พร้อมฟักแล้ว! 🎉</div>'
          : `<div class="incu-time">เหลือ <span data-countdown="${slot.readyAt}">${formatDuration(slot.readyAt - t)}</span></div>`}
        <div class="incu-bar"><div class="incu-bar-fill" data-progress-start="${slot.startAt}" data-progress-end="${slot.readyAt}" style="width:${pct}%"></div></div>
        ${ready ? `<button type="button" class="btn btn-sm btn-primary incu-hatch" data-action="hatch" data-slot="${i}">🐣 ฟักเลย!</button>` : ''}
      </div></div>`);
  }
  return `<section class="incu-section card">
    <div class="barn-head"><h2 class="barn-title">🥚 ตู้ฟักไข่</h2>
      <span class="badge">${state.incubator.length}/${state.incubatorCapacity}</span></div>
    <div class="incu-slots">${slots.join('')}</div></section>`;
}

// ── Barn: pet card ──────────────────────────────────────────────────────────
function actionBtn(action, petId, label, disabledReason, attr = 'data-action') {
  return `<button type="button" class="btn btn-sm btn-ghost pet-act" ${attr}="${action}" data-pet-id="${e(petId)}"` +
    `${disabledReason ? ` disabled title="${e(disabledReason)}"` : ''}>${label}</button>`;
}

/** The care buttons of a pet (card and 3D sheet share them; `attr` is the attribute carrying the action name). */
function petActionsHtml(pet, attr) {
  const sleeping = pet.status === 'sleeping';
  const working = pet.status === 'working';
  const away = pet.status === 'expedition';
  const careBlock = away ? 'ออกสำรวจอยู่' : sleeping ? 'หลับอยู่ ปลุกก่อนนะ' : '';
  const playBlock = away ? 'ออกสำรวจอยู่' : sleeping ? 'หลับอยู่' : working ? 'กำลังทำงาน' : pet.sick ? 'ป่วยอยู่' : '';
  const sleepBlock = working ? 'กำลังทำงาน' : away ? 'ออกสำรวจอยู่' : '';
  return `${actionBtn('feed', pet.id, '🍖 ให้อาหาร', careBlock, attr)}
      ${actionBtn('play', pet.id, '🎾 เล่น', playBlock, attr)}
      ${actionBtn('bath', pet.id, '🛁 อาบน้ำ', careBlock, attr)}
      ${actionBtn('toy', pet.id, '🧸 ของเล่น', playBlock, attr)}
      ${pet.sick ? actionBtn('heal', pet.id, '💊 รักษา', '', attr) : ''}
      ${actionBtn('sleep', pet.id, sleeping ? '☀️ ตื่น' : '💤 นอน', sleepBlock, attr)}
      ${giftAvailable(pet) ? actionBtn('gift', pet.id, '🎁 ของขวัญ', '', attr) : ''}
      ${actionBtn('details', pet.id, '📋 รายละเอียด', '', attr)}`;
}

function renderPetCard(pet, state) {
  const sp = getSpecies(pet.speciesId);
  const rarColor = sp ? RARITIES[sp.rarity].color : '#8e9aa6';
  const st = stageOf(pet);
  const mood = petMood(pet);
  const sleeping = pet.status === 'sleeping';
  const notIdle = pet.status !== 'idle';
  const bond = bondProgress(pet);

  const poops = Array.from({ length: pet.poop }, () =>
    `<button type="button" class="pet-poop" data-action="poop" data-pet-id="${e(pet.id)}" title="เก็บอึ" aria-label="เก็บอึ">💩</button>`).join('');

  const cls = ['pet-card'];
  if (sleeping) cls.push('is-sleeping');
  if (pet.sick) cls.push('is-sick');
  if (pet.shiny) cls.push('is-shiny');
  if (notIdle && !sleeping) cls.push('is-busy');

  return `<article class="${cls.join(' ')}" data-pet-id="${e(pet.id)}" style="--rar:${rarColor}">
    <div class="pet-stage">
      <button type="button" class="pet-avatar" data-action="details" data-pet-id="${e(pet.id)}" aria-label="ดูรายละเอียด ${e(petName(pet))}">
        <span class="pet-emoji">${petEmoji(pet)}</span>
        ${pet.shiny ? '<span class="pet-sparkle" aria-hidden="true">✨</span>' : ''}
        ${sleeping ? '<span class="pet-zzz" aria-hidden="true">💤</span>' : ''}
        ${pet.sick ? '<span class="pet-sicko" aria-hidden="true">🤒</span>' : ''}
      </button>
      <span class="pet-mood" title="${mood.text}">${mood.emoji}</span>
      <div class="pet-poops">${poops}</div>
    </div>
    <div class="pet-head">
      <h3 class="pet-name">${e(petName(pet))}</h3>
      <span class="badge pet-stage-badge">${st.icon} ${st.nameTh}</span>
    </div>
    <div class="pet-sub">
      <span>${sp ? e(sp.nameTh) : ''}</span>
      ${sp ? rarityBadge(sp) : ''}
      ${pet.shiny ? '<span class="pet-shiny-tag">✨ ไชนี่</span>' : ''}
      ${traitBadge(sp)}
    </div>
    <div class="pet-status">${statusLabel(pet, state)}</div>
    <div class="pet-hearts" title="ความผูกพัน ${bond.hearts}/5">${heartsHtml(bond.hearts)}${bond.hearts >= 5 ? ' <span class="pet-bond-badge" title="สนิทสุดๆ">💖</span>' : ''}</div>
    <div class="pet-stats">
      ${statBar('🍖', 'อิ่ม', pet.stats.hunger)}
      ${statBar('💖', 'สุข', pet.stats.happy)}
      ${statBar('⚡', 'พลัง', pet.stats.energy)}
      ${statBar('🫧', 'สะอาด', pet.stats.clean)}
    </div>
    <div class="pet-actions">
      ${petActionsHtml(pet, 'data-action')}
    </div>
  </article>`;
}

// 3D barn lifecycle (CONTRACT_V4). The world modules are loaded lazily: if any of them is missing or WebGL is
// unavailable, the card grid below is used and everything keeps working.
let worldDeps = null;       // null = still loading, false = unavailable, else { engine, barn }
let barnRoot = null;        // the pane element (set in bindBarn)
let barn3d = null;          // the mounted 3D barn instance
let barnHost = null;        // the host element it is mounted in

let depsStarted = false;

/** Loads engine + barn3d (three.js is 650 KB) only once the 3D barn is actually wanted. */
function ensureWorldDeps() {
  if (depsStarted) return;
  depsStarted = true;
  Promise.all([import('../world3d/engine.js'), import('./barn3d.js')])
    .then(([engine, barn]) => { worldDeps = { engine, barn }; })
    .catch(err => { worldDeps = false; console.warn('3D barn unavailable, using the list view', err); })
    .then(() => { if (barnRoot && !barnRoot.hidden) rerenderBarn(); });
}

function rerenderBarn() {
  if (!barnRoot) return;
  try { morph(barnRoot, renderBarn(getState())); } catch (err) { console.error('barn re-render failed', err); }
}

function worldSupported() {
  try { return worldDeps !== false && isWorldSupported(); } catch { return false; }
}

/** 'list' | '3d' | 'loading' */
function barnMode() {
  if (getBarnViewPref() === 'list') return 'list';
  if (!worldSupported()) return 'list'; // never downloads three.js on unsupported devices
  ensureWorldDeps();
  if (worldDeps === null) return 'loading';
  return '3d';
}

/** Toggle shown whenever the 3D barn could be used on this device. */
function barnToggleHtml(mode) {
  if (!worldSupported()) return '';
  const on = mode === 'list' ? 'list' : '3d';
  return `<div class="barn-toggle" role="group" aria-label="มุมมองคอก">
    <button type="button" class="barn-toggle-btn${on === '3d' ? ' is-on' : ''}" data-action="barn-mode" data-mode="3d" aria-pressed="${on === '3d'}">🌳 คอก</button>
    <button type="button" class="barn-toggle-btn${on === 'list' ? ' is-on' : ''}" data-action="barn-mode" data-mode="list" aria-pressed="${on === 'list'}">📋 รายการ</button></div>`;
}

function renderBarn(state) {
  const t = now();
  const pets = state.pets;
  const mode = barnMode();
  const toggle = barnToggleHtml(mode);
  if (mode === '3d' || mode === 'loading') {
    return `<div class="barn-view barn-3d">
      <section class="barn-section">
        <div class="barn-head"><h2 class="barn-title">🏠 คอกสัตว์</h2>
          <div class="barn-head-r"><span class="badge barn-cap">${pets.length}/${state.barnCapacity}</span>${toggle}</div></div>
        ${mode === '3d'
          ? '<div class="b3" data-key="barn3d" data-morph="skip"></div>'
          : '<div class="b3 b3-loading" data-key="barn3d-loading">กำลังโหลดคอก 3 มิติ…</div>'}
      </section></div>`;
  }
  const hasEgg = state.incubator.length > 0 || EGGS.some(eg => countItem(state, eg.id) > 0);
  const empty = `<div class="empty-state barn-empty">
      <div class="barn-empty-emoji">🥚</div>
      <p>ยังไม่มีน้องในคอกเลย</p>
      <p class="muted">${hasEgg ? 'ใส่ไข่ในตู้ฟักด้านบน แล้วรอฟักเป็นเพื่อนตัวแรกของคุณ!' : 'ไปซื้อไข่ที่ร้านค้า 🛒 แล้วนำมาฟักในตู้ฟักได้เลย'}</p>
    </div>`;
  return `<div class="barn-view">
    ${renderIncubator(state, t)}
    <section class="barn-section">
      <div class="barn-head"><h2 class="barn-title">🏠 คอกสัตว์</h2>
        <div class="barn-head-r"><span class="badge barn-cap">${pets.length}/${state.barnCapacity}</span>${toggle}</div></div>
      ${pets.length ? `<div class="barn-grid">${pets.map(p => renderPetCard(p, state)).join('')}</div>` : empty}
    </section></div>`;
}

// ── 3D sheet / tray content (called by barn3d.js; pure string building) ─────
/** Food rows for a pet, best match first. */
function foodRows(pet, state) {
  return Object.entries(state.inventory)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ item: getItem(id), n }))
    .filter(r => r.item && r.item.food)
    .map(r => {
      const fx = foodEffect(pet, r.item);
      return { ...r, fx, rank: fx.favorite ? 0 : fx.match ? 1 : 2 };
    })
    .sort((a, b) => a.rank - b.rank || a.item.nameTh.localeCompare(b.item.nameTh, 'th'));
}

function foodListHtml(pet, state, attr) {
  const rows = foodRows(pet, state);
  if (!rows.length) return '<p class="muted pet-picker-empty">ไม่มีอาหารในกระเป๋า ไปซื้อที่ร้านค้า 🛒 หรือเก็บผลผลิตจากไร่มาให้น้องนะ</p>';
  return `<div class="pet-picker-list">${rows.map(r => {
    const tag = r.fx.favorite ? '⭐ ของโปรด' : r.fx.match ? '✅ ถูกปาก' : '😐 พอกินได้';
    return `<button type="button" class="pet-food-item${r.fx.favorite ? ' is-fav' : r.fx.match ? ' is-match' : ''}" ${attr}="food" data-item-id="${e(r.item.id)}" data-pet-id="${e(pet.id)}">
      <span class="pet-food-emoji">${r.item.emoji}</span>
      <span class="pet-food-main"><b>${e(r.item.nameTh)}</b> <small>×${r.n}</small>
        <span class="pet-food-meta">อิ่ม +${Math.round(r.fx.hunger)} · สุข +${Math.round(r.fx.happy)}</span></span>
      <span class="pet-food-tag">${tag}</span></button>`;
  }).join('')}</div>`;
}

function miniStat(icon, label, value) {
  const v = Math.round(clamp(value, 0, 100));
  return `<div class="b3-stat" title="${label} ${v}/100"><span class="b3-stat-i">${icon}</span>
    <span class="pet-bar"><span class="pet-bar-fill ${lvClass(v)}" style="width:${v}%"></span></span><span class="b3-stat-v">${v}</span></div>`;
}

/** Bottom sheet for a tapped pet. mode 'main' = card content + actions, 'feed' = food list for that pet. */
function petSheetHtml(pet, state, mode = 'main', opts = {}) {
  const sp = getSpecies(pet.speciesId);
  const st = stageOf(pet);
  const bond = bondProgress(pet);
  const head = `<div class="b3-sheet-head">
      ${mode === 'feed' ? '<button type="button" class="btn btn-sm btn-ghost" data-b3="back" aria-label="กลับ">‹</button>' : ''}
      <span class="b3-sheet-emoji" aria-hidden="true">${petEmoji(pet)}</span>
      <div class="b3-sheet-title"><b>${e(petName(pet))}</b>
        <small>${sp ? e(sp.nameTh) : ''} · ${st.icon} ${st.nameTh}${pet.shiny ? ' · ✨' : ''}</small></div>
      <button type="button" class="b3-sheet-close" data-b3="close" aria-label="ปิด">✕</button></div>`;
  if (mode === 'feed') {
    return `${head}<div class="b3-sheet-body">${foodListHtml(pet, state, 'data-b3')}</div>`;
  }
  const pers = persOf(pet);
  const reveal = opts.reveal && sp ? `<div class="b3-reveal${pet.shiny ? ' is-shiny' : ''}" style="--rar:${RARITIES[sp.rarity].color}">
      <b>${pet.shiny ? '✨ ฟักสำเร็จ! ร่างไชนี่!' : '🐣 ฟักสำเร็จ!'}</b>
      <div>${e(sp.nameTh)} ${rarityBadge(sp)} ${traitBadge(sp)}</div>
      <small class="muted">นิสัย ${pers.emoji} ${pers.nameTh} · ${e(sp.desc)}</small></div>` : '';
  return `${head}<div class="b3-sheet-body">${reveal}
      <div class="b3-sheet-line"><span class="pet-status">${statusLabel(pet, state)}</span>
        <span class="pet-hearts" title="ความผูกพัน ${bond.hearts}/5">${heartsHtml(bond.hearts)}</span></div>
      <div class="b3-stats">
        ${miniStat('🍖', 'อิ่ม', pet.stats.hunger)}${miniStat('💖', 'สุข', pet.stats.happy)}
        ${miniStat('⚡', 'พลัง', pet.stats.energy)}${miniStat('🫧', 'สะอาด', pet.stats.clean)}</div>
      <div class="pet-actions b3-acts">${petActionsHtml(pet, 'data-b3')}</div></div>`;
}

/** Edible items for the food tray (chips); `pet` (optional) marks favorites. */
function foodTrayHtml(state, pet, selectedId) {
  const chips = Object.entries(state.inventory)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ item: getItem(id), n }))
    .filter(r => r.item && r.item.food && r.item.type !== 'egg')
    .map(r => ({ ...r, fx: pet ? foodEffect(pet, r.item) : null }))
    .sort((a, b) => (b.fx ? +b.fx.favorite : 0) - (a.fx ? +a.fx.favorite : 0) || a.item.nameTh.localeCompare(b.item.nameTh, 'th'));
  if (!chips.length) return '<span class="b3-tray-empty">ไม่มีอาหารในกระเป๋า 🛒</span>';
  return chips.map(r => `<button type="button" class="b3-food${selectedId === r.item.id ? ' is-on' : ''}${r.fx && r.fx.favorite ? ' is-fav' : ''}" data-b3="tray-food" data-item-id="${e(r.item.id)}" aria-label="${e(r.item.nameTh)} ${r.n}" aria-pressed="${selectedId === r.item.id}">
      <span class="b3-food-e">${r.item.emoji}</span><small>${r.n}</small></button>`).join('');
}

/** What barn3d.js needs from this module. */
const barnCtx = {
  run, esc: e, petSheetHtml, foodTrayHtml,
  openDetails: id => openDetails(id),
  openEggPicker: () => openEggPicker(),
  onFatal(err) {
    console.error('3D barn failed, falling back to the list view', err);
    worldDeps = false;
    if (barn3d) { try { barn3d.dispose(); } catch { /* already gone */ } barn3d = null; barnHost = null; }
    rerenderBarn();
  },
};

/** Mount / unmount / pause the 3D barn so it always matches what the DOM currently shows. */
function reconcileBarn3d() {
  if (!barnRoot || !worldDeps) return;
  const host = barnRoot.querySelector('.b3[data-morph="skip"]');
  if (!host) {
    if (barn3d) { barn3d.dispose(); barn3d = null; barnHost = null; }
    return;
  }
  if (barnRoot.hidden) { if (barn3d) barn3d.setActive(false); return; }
  if (barn3d && barnHost !== host) { barn3d.dispose(); barn3d = null; }
  if (!barn3d) {
    barnHost = host;
    try {
      barn3d = worldDeps.barn.mountBarn3d(host, barnCtx);
    } catch (err) {
      barn3d = null;
      barnCtx.onFatal(err);
      return;
    }
  }
  barn3d.setActive(true);
}

// ── Modals ──────────────────────────────────────────────────────────────────
function openEggPicker() {
  const state = getState();
  const owned = EGGS.filter(eg => countItem(state, eg.id) > 0);
  const html = owned.length
    ? `<div class="pet-picker-list">${owned.map(eg =>
        `<button type="button" class="pet-picker-item incu-pick" data-egg-id="${e(eg.id)}" style="--egg-color:${eg.color}">` +
        `<span class="incu-pick-egg">${eg.emoji}</span>` +
        `<span class="incu-pick-main"><b>${e(eg.nameTh)}</b> <small>×${countItem(state, eg.id)}</small></span>` +
        `<span class="pet-picker-desc">ฟัก ${formatDuration(eg.hatchMs)}</span></button>`).join('')}</div>`
    : '<p class="muted pet-picker-empty">ไม่มีไข่ในกระเป๋า ไปซื้อที่ร้านค้าได้เลย 🛒</p>';
  let close = () => {};
  close = openModal({
    title: '🥚 เลือกไข่ที่จะฟัก',
    html,
    onMount(el) {
      el.addEventListener('click', ev => {
        const b = ev.target.closest('[data-egg-id]');
        if (!b) return;
        close();
        run(s => putEggInIncubator(s, b.dataset.eggId));
      });
    },
  });
}

function openFoodPicker(petId) {
  const state = getState();
  const pet = getPet(state, petId);
  if (!pet) return;
  const sp = getSpecies(pet.speciesId);
  const rows = foodRows(pet, state);

  const list = rows.map(r => {
    const hunger = Math.round(r.fx.hunger);
    const happy = Math.round(r.fx.happy);
    const tag = r.fx.favorite ? '⭐ ของโปรด' : r.fx.match ? '✅ ถูกปาก' : '😐 พอกินได้';
    return `<button type="button" class="pet-food-item${r.fx.favorite ? ' is-fav' : r.fx.match ? ' is-match' : ''}" data-item-id="${e(r.item.id)}">
      <span class="pet-food-emoji">${r.item.emoji}</span>
      <span class="pet-food-main"><b>${e(r.item.nameTh)}</b> <small>×${r.n}</small>
        <span class="pet-food-meta">อิ่ม +${hunger} · สุข +${happy}</span></span>
      <span class="pet-food-tag">${tag}</span></button>`;
  }).join('');

  const html = `<div class="pet-food-head">${petChipHtml(pet)}
      <div class="pet-food-hint muted">${sp ? `ชอบกิน: ${dietChips(sp)} · ของโปรด ${favoriteLabel(sp)}` : ''}</div></div>
    ${rows.length
      ? `<div class="pet-picker-list">${list}</div>`
      : '<p class="muted pet-picker-empty">ไม่มีอาหารในกระเป๋า ไปซื้อที่ร้านค้า 🛒 หรือเก็บผลผลิตจากไร่มาให้น้องนะ</p>'}`;

  let close = () => {};
  close = openModal({
    title: '🍖 เลือกอาหาร',
    html,
    onMount(el) {
      el.addEventListener('click', ev => {
        const b = ev.target.closest('[data-item-id]');
        if (!b) return;
        const r = run(s => feedPet(s, petId, b.dataset.itemId));
        if (r && r.ok) close();
      });
    },
  });
}

function jobsHtml(species) {
  return `<ul class="pet-jobs">${Object.keys(JOBS).map(k => {
    const v = species.jobs[k] || 0;
    return `<li class="pet-job${v ? ' has' : ''}"><span>${JOBS[k].emoji} ${JOBS[k].nameTh}</span>` +
      `<span class="pet-stars" aria-label="${v}/3">${stars(v)}</span></li>`;
  }).join('')}</ul>`;
}

function openDetails(petId) {
  const state = getState();
  const pet = getPet(state, petId);
  if (!pet) return;
  const sp = getSpecies(pet.speciesId);
  if (!sp) return;
  const hab = HABITATS[sp.habitat];
  const pers = persOf(pet);
  const xp = xpProgress(pet);
  const st = stageOf(pet);
  const busy = pet.status === 'working' || pet.status === 'expedition';
  const bond = bondProgress(pet);

  const html = `<div class="pet-detail">
    <div class="pet-detail-top${pet.shiny ? ' is-shiny' : ''}" style="--rar:${RARITIES[sp.rarity].color}">
      <span class="pet-detail-emoji pet-emoji">${sp.emoji}</span>
      ${pet.shiny ? '<span class="pet-sparkle" aria-hidden="true">✨</span>' : ''}
      <div>
        <div class="pet-detail-species">${e(sp.nameTh)} ${rarityBadge(sp)}</div>
        <div class="muted">${hab.emoji} ถิ่น${hab.nameTh}${pet.shiny ? ' · ✨ ไชนี่ (พลัง x1.1)' : ''}</div>
      </div>
    </div>
    <p class="pet-detail-desc">${e(sp.desc)}</p>
    <div class="pet-detail-grid">
      <div><span class="muted">นิสัย</span><br>${pers.emoji} <b>${pers.nameTh}</b><br><small class="muted">${pers.desc}</small></div>
      <div><span class="muted">ขั้นการเติบโต</span><br>${st.icon} <b>${st.nameTh}</b><br><small class="muted">พลังงาน x${st.mult}</small></div>
    </div>
    <div class="pet-detail-xp">
      <span class="pet-bar"><span class="pet-bar-fill pet-lv-high" style="width:${xp.pct}%"></span></span>
      <small class="muted">${xp.text}</small>
    </div>
    <h4 class="pet-detail-h">ความสามารถพิเศษ</h4>
    ${traitBlock(sp)}
    <h4 class="pet-detail-h">ความผูกพัน ${heartsHtml(bond.hearts)}${bond.hearts >= 5 ? ' 💖' : ''}</h4>
    <div class="pet-detail-xp">
      <span class="pet-bar"><span class="pet-bar-fill pet-bond-fill" style="width:${bond.pct}%"></span></span>
      <small class="muted">${bond.max ? 'สนิทสุดๆ แล้ว (+20% พลังงาน)' : `อีก ${bond.need - bond.cur} แต้มถึงหัวใจดวงถัดไป`} · วันนี้ได้อีก ${bond.remainingToday}/${BOND_DAILY_CAP} แต้ม · โบนัสงาน +${bond.hearts * 4}%</small>
      ${giftAvailable(pet)
        ? '<button type="button" class="btn btn-sm btn-primary pet-gift-btn" data-action="gift">🎁 รับของขวัญจากน้อง</button>'
        : `<small class="muted">${bond.hearts >= GIFT_MIN_HEARTS ? '🎁 วันนี้รับของขวัญแล้ว' : `🎁 สนิทถึง ${GIFT_MIN_HEARTS} หัวใจ จะมีของขวัญให้ทุกวัน`}</small>`}
    </div>
    <h4 class="pet-detail-h">ความถนัดงาน</h4>
    ${jobsHtml(sp)}
    <h4 class="pet-detail-h">อาหาร</h4>
    <div class="pet-detail-diet">${dietChips(sp)} <span class="pet-fav">⭐ ของโปรด: ${favoriteLabel(sp)}</span></div>
    <h4 class="pet-detail-h">ตั้งชื่อ</h4>
    <div class="pet-rename">
      <input type="text" class="pet-rename-input" maxlength="16" value="${e(petName(pet))}" aria-label="ชื่อน้อง">
      <button type="button" class="btn btn-sm btn-primary" data-action="rename-save">บันทึก</button>
    </div>
    <div class="pet-release">
      <button type="button" class="btn btn-sm btn-ghost pet-release-btn" data-action="release-ask"${busy ? ' disabled title="น้องกำลังทำงานอยู่"' : ''}>👋 ปล่อยกลับธรรมชาติ</button>
      <div class="pet-release-confirm" hidden>
        <p>ปล่อย <b>${e(petName(pet))}</b> จริงๆ หรือ? จะไม่สามารถเอากลับมาได้ (ได้ 10 🪙 + ผงดาว ${(STARDUST_BY_RARITY[sp.rarity] || 1) * (pet.shiny ? 2 : 1)} ✨)</p>
        <button type="button" class="btn btn-sm pet-release-yes" data-action="release-yes">ยืนยันปล่อย</button>
        <button type="button" class="btn btn-sm btn-ghost" data-action="release-no">ยกเลิก</button>
      </div>
    </div></div>`;

  let close = () => {};
  close = openModal({
    title: `${sp.emoji} ข้อมูลน้อง`,
    html,
    onMount(el) {
      const input = el.querySelector('.pet-rename-input');
      const confirmBox = el.querySelector('.pet-release-confirm');
      const askBtn = el.querySelector('.pet-release-btn');
      const save = () => {
        const r = run(s => renamePet(s, petId, input.value));
        if (r && r.ok) close();
      };
      if (input) input.addEventListener('keydown', ev => { if (ev.key === 'Enter') save(); });
      delegate(el, {
        gift: () => {
          const r = run(s => claimGift(s, petId));
          if (r && r.ok) close();
        },
        'rename-save': save,
        'release-ask': () => { confirmBox.hidden = false; askBtn.hidden = true; },
        'release-no': () => { confirmBox.hidden = true; askBtn.hidden = false; },
        'release-yes': () => {
          const r = run(s => releasePet(s, petId));
          if (r && r.ok) close();
        },
      });
    },
  });
}

function openHatchReveal(pet) {
  const sp = getSpecies(pet.speciesId);
  if (!sp) return;
  const pers = persOf(pet);
  openModal({
    title: pet.shiny ? '✨ ฟักสำเร็จ! ร่างไชนี่!' : '🐣 ฟักสำเร็จ!',
    html: `<div class="pet-reveal${pet.shiny ? ' is-shiny' : ''}" style="--rar:${RARITIES[sp.rarity].color}">
      <div class="pet-reveal-emoji pet-emoji">${sp.emoji}</div>
      <h3>${e(petName(pet))}</h3>
      <p>${e(sp.nameTh)} ${rarityBadge(sp)}</p>
      <p class="muted">นิสัย ${pers.emoji} ${pers.nameTh} · ${e(sp.desc)}</p></div>`,
  });
}

// ── Barn view ───────────────────────────────────────────────────────────────
function bindBarn(root) {
  barnRoot = root;
  onPrefChange(name => { if (name === 'barnView' && !root.hidden) rerenderBarn(); }); // e.g. changed in the settings modal
  const withPet = fn => btn => {
    const id = btn.dataset.petId || (btn.closest('[data-pet-id]') || {}).dataset?.petId;
    if (id) fn(id, btn);
  };
  delegate(root, {
    feed: withPet(id => openFoodPicker(id)),
    play: withPet(id => run(s => playWithPet(s, id))),
    bath: withPet(id => run(s => cleanPet(s, id))),
    toy: withPet(id => run(s => giveToy(s, id))),
    heal: withPet(id => run(s => healPet(s, id))),
    sleep: withPet(id => run(s => toggleSleep(s, id))),
    poop: withPet(id => run(s => pickPoop(s, id))),
    details: withPet(id => openDetails(id)),
    gift: withPet(id => run(s => claimGift(s, id))),
    'put-egg': () => openEggPicker(),
    hatch: btn => {
      const r = run(s => hatchReady(s, Number(btn.dataset.slot)));
      if (r && r.ok && r.pet) openHatchReveal(r.pet);
    },
    'barn-mode': btn => {
      setBarnViewPref(btn.dataset.mode === 'list' ? 'list' : '3d');
      rerenderBarn(); // (barnMode() starts loading the 3D modules when needed)
    },
  });
  // The 3D host is skipped by morph, so mount/unmount it by watching what the view currently contains.
  if (typeof MutationObserver === 'function') {
    new MutationObserver(reconcileBarn3d).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
}

// ── Book ────────────────────────────────────────────────────────────────────
function speciesInfoHtml(sp, entry) {
  return `<div class="pet-detail">
    <div class="pet-detail-top" style="--rar:${RARITIES[sp.rarity].color}">
      <span class="pet-detail-emoji pet-emoji">${sp.emoji}</span>
      <div><div class="pet-detail-species">${e(sp.nameTh)} ${rarityBadge(sp)}</div>
        <div class="muted">${HABITATS[sp.habitat].emoji} ถิ่น${HABITATS[sp.habitat].nameTh} · ฟักได้แล้ว ${entry.owned} ตัว${entry.shiny ? ' · ✨ เคยได้ร่างไชนี่' : ''}</div></div>
    </div>
    <p class="pet-detail-desc">${e(sp.desc)}</p>
    <h4 class="pet-detail-h">ความสามารถพิเศษ</h4>${traitBlock(sp)}
    <h4 class="pet-detail-h">ความถนัดงาน</h4>${jobsHtml(sp)}
    <h4 class="pet-detail-h">อาหาร</h4>
    <div class="pet-detail-diet">${dietChips(sp)} <span class="pet-fav">⭐ ของโปรด: ${favoriteLabel(sp)}</span></div></div>`;
}

function rewardText(r) {
  const parts = [];
  if (r.coins) parts.push(`🪙 ${r.coins}`);
  if (r.stardust) parts.push(`✨ ${r.stardust}`);
  for (const [id, n] of Object.entries(r.items || {})) {
    const it = getItem(id);
    parts.push(`${it ? it.emoji : '🎁'} ${it ? e(it.nameTh) : e(id)}${n > 1 ? ` ×${n}` : ''}`);
  }
  return parts.join(' · ');
}

function goalHtml(state, g) {
  const claimed = isGoalClaimed(state, g.id);
  const done = g.check(state);
  const have = g.progress(state);
  const action = claimed
    ? '<span class="book-goal-done">✅ รับแล้ว</span>'
    : `<button type="button" class="btn btn-sm${done ? ' btn-primary' : ''}" data-action="claim-goal" data-goal-id="${e(g.id)}"${done ? '' : ' disabled'}>รับรางวัล</button>`;
  return `<div class="book-goal${done && !claimed ? ' is-ready' : ''}${claimed ? ' is-claimed' : ''}">
    <div class="book-goal-main">
      <div class="book-goal-title">${e(g.titleTh)} <small class="muted">${have}/${g.need}</small></div>
      <div class="book-goal-reward muted">${rewardText(g.reward)}</div>
    </div>${action}</div>`;
}

function renderStardustShop(state) {
  const dust = state.stardust || 0;
  const lvl = state.player.level || 1;
  const eggs = EGGS.map(eg => {
    const locked = lvl < eg.unlockLevel;
    const poor = dust < 40;
    const why = locked ? `ปลดล็อกที่เลเวล ${eg.unlockLevel}` : poor ? 'ผงดาวไม่พอ' : '';
    return `<button type="button" class="btn btn-sm btn-ghost book-shop-egg" data-action="buy-egg" data-habitat="${e(eg.habitat)}"${why ? ` disabled title="${why}"` : ''}>
      ${eg.emoji} ${e(eg.nameTh)} <small>40 ✨</small></button>`;
  }).join('');
  const canShiny = dust >= 100 && state.pets.some(p => !p.shiny);
  return `<section class="card book-shop">
    <div class="barn-head"><h2 class="barn-title">✨ ร้านผงดาว</h2><span class="badge book-dust">✨ ${dust}</span></div>
    <p class="muted book-shop-hint">ปล่อยน้องกลับธรรมชาติเพื่อรับผงดาว (ยิ่งหายากยิ่งได้เยอะ) แล้วนำมาแลกของที่นี่</p>
    <div class="book-shop-row">
      <button type="button" class="btn btn-sm btn-primary" data-action="make-shiny"${canShiny ? '' : ' disabled'}>🌈 เปลี่ยนน้องเป็นร่างไชนี่ <small>100 ✨</small></button>
    </div>
    <div class="book-shop-eggs">${eggs}</div></section>`;
}

function renderBook(state) {
  const col = state.collection || {};
  const known = sp => (col[sp.id] && col[sp.id].owned > 0);
  const total = SPECIES.length;
  const have = SPECIES.filter(known).length;
  const shinyN = SPECIES.filter(sp => col[sp.id] && col[sp.id].shiny).length;
  const pct = total ? Math.round((have / total) * 100) : 0;
  const readyN = BOOK_GOALS.filter(g => !isGoalClaimed(state, g.id) && g.check(state)).length;
  const globalGoals = BOOK_GOALS.filter(g => !HABITATS[g.id.split('_')[0]]);

  const groups = Object.keys(HABITATS).map(hid => {
    const list = SPECIES.filter(sp => sp.habitat === hid)
      .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
    const got = list.filter(known).length;
    const hp = list.length ? Math.round((got / list.length) * 100) : 0;
    const goals = BOOK_GOALS.filter(g => g.id.startsWith(hid + '_'));
    const cells = list.map(sp => {
      if (!known(sp)) {
        return `<div class="book-cell is-unknown" title="ยังไม่เคยพบ">
          <span class="book-emoji book-sil" aria-hidden="true">${sp.emoji}</span>
          <span class="book-q">?</span><span class="book-name">???</span></div>`;
      }
      const c = col[sp.id];
      return `<button type="button" class="book-cell is-known${c.shiny ? ' has-shiny' : ''}" data-action="species-info" data-species-id="${e(sp.id)}" style="--rar:${RARITIES[sp.rarity].color}">
        ${c.shiny ? '<span class="book-shiny" title="เคยได้ร่างไชนี่">✨</span>' : ''}
        <span class="book-emoji">${sp.emoji}</span>
        <span class="book-name">${e(sp.nameTh)}</span>
        <span class="book-count">×${c.owned}</span></button>`;
    }).join('');
    return `<section class="book-group">
      <div class="book-group-head"><h3>${HABITATS[hid].emoji} ${HABITATS[hid].nameTh}</h3>
        <span class="muted">${got}/${list.length} (${hp}%)</span></div>
      <div class="book-bar"><div class="book-bar-fill" style="width:${hp}%"></div></div>
      <div class="book-grid">${cells}</div>
      <div class="book-goals">${goals.map(g => goalHtml(state, g)).join('')}</div></section>`;
  }).join('');

  return `<div class="book-view">
    <section class="card book-summary">
      <h2 class="barn-title">📖 สมุดสัตว์</h2>
      <p>สะสมแล้ว <b>${have}</b> / ${total} สายพันธุ์ (${pct}%) · ✨ ไชนี่ ${shinyN} ชนิด${readyN ? ` · 🎁 รับรางวัลได้ ${readyN} ข้อ` : ''}</p>
      <div class="book-bar"><div class="book-bar-fill" style="width:${pct}%"></div></div>
      <div class="book-goals">${globalGoals.map(g => goalHtml(state, g)).join('')}</div>
    </section>
    ${renderStardustShop(state)}${groups}</div>`;
}

function bindBook(root) {
  delegate(root, {
    'species-info': btn => {
      const sp = getSpecies(btn.dataset.speciesId);
      const entry = sp && getState().collection[sp.id];
      if (!sp || !entry) return;
      openModal({ title: `${sp.emoji} ${sp.nameTh}`, html: speciesInfoHtml(sp, entry) });
    },
    'claim-goal': btn => {
      const g = getGoal(btn.dataset.goalId);
      if (g) run(s => claimGoal(s, g.id));
    },
    'buy-egg': btn => run(s => buyHabitatEgg(s, btn.dataset.habitat)),
    'make-shiny': () => openPetPicker({
      title: '🌈 เลือกน้องที่จะเปลี่ยนเป็นไชนี่ (100 ✨)',
      filter: p => !p.shiny,
      describe: () => '100 ✨',
      onPick: id => run(s => makeShiny(s, id)),
    }),
  });
}

export const views = [
  { id: 'barn', icon: '🏠', label: 'คอก', render: renderBarn, bind: bindBarn },
  { id: 'book', icon: '📖', label: 'สมุดสัตว์', render: renderBook, bind: bindBook },
];

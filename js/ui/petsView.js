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
  putEggInIncubator, hatchReady, feedPet, playWithPet, cleanPet, pickPoop, playSession, playBlocker, lonelyLevel, favToyOf,
  giveToy, healPet, toggleSleep, renamePet, rehomePet, rehomeDust, foodEffect,
  collectYard, collectPetGift, petGift, yardPreview, stationStatus,
  getTrait, bondProgress, giftAvailable, claimGift, BOND_DAILY_CAP, GIFT_MIN_HEARTS,
  STARDUST_BY_RARITY, BOOK_GOALS, getGoal, isGoalClaimed, claimGoal, makeShiny, buyHabitatEgg,
  RELEASE_COINS, NURSERY_SLOTS, nurseryPets, getNurseryPet, adoptFromNursery, swapWithNursery, compareCandidates,
  arrivedPostcards, unreadPostcardCount, markPostcardRead, favoriteLine, friendLine, wearOf, wardrobeList, wearAccessory, takeOffAccessory,
  bondHearts,
} from '../pets.js';
import {
  breedPreview, breed, putFamilyEggInIncubator, familyEggHatchMs, BREED_UNLOCK_LEVEL, BREED_MIN_STAGE, BREED_MIN_HEARTS, FAMILY_EGG_MAX,
  familyTree, hasFamily,
} from '../breeding.js';
import { COATS, getCoat, coatOf } from '../data/coats.js';
import { limitedOf } from '../data/limited.js';
import { kitchenList, cook } from '../kitchen.js';
import { startPlayGame } from './playGame.js';
import { favoriteDish } from '../data/recipes.js';
import { getAccessory, ACC_SLOTS } from '../data/accessories.js';
import { journalDays } from '../journal.js';
import { listPhotos, getPhotoUrl, deletePhoto, downloadPhoto, photoFilename } from '../album.js';
import * as farmLogic from '../farm.js'; // decor build / place / remove (namespace import: guarded, in case it is missing)
import { DECOR, getDecor } from '../data/decor.js';
import { takeAwayDigest } from '../away.js';
import { onBestFriend, friendEventMessage, bestFriendOf } from '../friends.js';
import { festChipHtml, openFestivalSheet } from './festivalSheet.js';
import { activeFestival, ensureFestival, loginLantern, pendingFestival } from '../festival.js';

const e = escapeHtml;

// ── Greeting (CONTRACT_V8 §3): the away digest is told once per app open ───────────────────────────────────
/** The digest of the time away (>= 30 min), handed out once per app open by away.js; null when there is none. */
function takeGreeting() {
  let d = null;
  try { d = takeAwayDigest(); } catch (err) { console.warn('away digest unavailable', err); }
  d = d && Array.isArray(d.lines) && d.lines.length ? d : null;
  // CONTRACT_V11 §4: a festival that began while the player was away gets the first line of the digest
  try {
    const fest = festNews || pendingFestival(getState());
    festNews = null;
    if (d && fest) {
      d = { ...d, lines: [{ emoji: fest.emoji, text: `ระหว่างที่คุณไม่อยู่ เทศกาล${fest.nameTh.replace(/^เทศกาล/, '')} เริ่มแล้ว!` }, ...d.lines].slice(0, 5) };
    }
  } catch (err) { console.warn('festival digest line skipped', err); }
  return d;
}

// ── เทศกาล 🏮 (CONTRACT_V11 §4): the first time the yard is shown each day / festival, roll the tasks and take the login lantern ──
let festChecked = '';
let festNews = null;   // the festival that began while away, kept until the digest has told it (the daily check below rolls the state first)
function festivalDailyCheck() {
  let sig = '';
  try { sig = `${activeFestival(now()).key}|${new Date(now()).toDateString()}`; } catch { return; }
  if (sig === festChecked) return;
  festChecked = sig;
  try { festNews = pendingFestival(getState()) || festNews; } catch { /* none */ }
  setTimeout(() => {
    try {
      const r = update(s => { ensureFestival(s); return loginLantern(s); });
      if (r && r.ok && r.msg) notify(r.msg, 'success');
    } catch (err) { console.warn('festival check failed', err); }
  }, 0);
}

function openFestival() {
  openFestivalSheet({
    run,
    pickPet: opts => openPetPicker(opts),
    onFloated: id => { if (barn3d && typeof barn3d.krathongScene === 'function') { try { barn3d.krathongScene(id); } catch (err) { console.warn('krathong scene skipped', err); } } },
  });
}

// a new best-friend pair (CONTRACT_V8 §4): one toast, here (friends.js only queues / emits the event)
onBestFriend(evt => { if (!evt.offline) notify(friendEventMessage(evt), 'success'); });
let listGreet = null;   // { lines, i } for the list view (and reduced motion): just the speech bubble, no running pets
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const DIET_TH = {
  veg: 'ผัก', fruit: 'ผลไม้', grain: 'ธัญพืช', meat: 'เนื้อสัตว์', fish: 'ปลา',
  insect: 'แมลง', sweet: 'ของหวาน', milk: 'นม', leaf: 'ใบไม้',
};

// ── Shared helpers ──────────────────────────────────────────────────────────
/** V18: "🥺 คิดถึงเรา" / "😢 น้อยใจ" when the pet has not played (or had a toy) for 24 / 48 h. */
const lonelyTag = pet => {
  const l = lonelyLevel(pet);
  return l === 2 ? '<span class="pet-lonely-tag is-sulk" title="ไม่ได้เล่นด้วยกัน 2 วันแล้ว">😢 น้อยใจ</span>'
    : l === 1 ? '<span class="pet-lonely-tag" title="ไม่ได้เล่นด้วยกันวันนึงแล้ว">🥺 คิดถึงเรา</span>' : '';
};

/** V18 list view: the same play mini-game in a window, with the pet big in the middle. */
function openPlayModal(petId) {
  const state = getState();
  const pet = getPet(state, petId);
  if (!pet) return;
  const why = playBlocker(state, petId);
  if (why) { notify(why, 'warn'); return; }
  let game = null, close = () => {};
  close = openModal({
    title: `🎾 เล่นกับ${petName(pet)}`,
    html: `<div class="pg-stage"><span class="pg-pet-wrap"><span class="pg-pet pet-emoji${pet.shiny ? ' is-shiny' : ''}${limitedOf(pet) ? ' is-limited' : ''}" aria-hidden="true">${petEmoji(pet)}</span>`
      + '<span class="pg-think" aria-hidden="true"></span><span class="pg-face" aria-hidden="true"></span></span></div>',
    onMount(body) {
      const stage = body.querySelector('.pg-stage');
      const big = body.querySelector('.pg-pet');
      const think = body.querySelector('.pg-think');
      const face = body.querySelector('.pg-face');
      // V19: the big emoji bounces + 😍 on a right toy, shakes + 😭 💧 on a wrong one
      const feel = (cls, emoji) => {
        big.classList.remove('is-bounce', 'is-cry'); void big.offsetWidth; if (cls) big.classList.add(cls);
        face.textContent = emoji; face.classList.remove('is-show'); void face.offsetWidth; face.classList.add('is-show');
      };
      game = startPlayGame({
        host: stage,
        title: '',
        favToy: favToyOf(pet).emoji,
        spread: Math.min(150, Math.max(100, stage.clientWidth * 0.36)),
        onWish: w => { think.textContent = w; think.classList.remove('is-new'); void think.offsetWidth; think.classList.add('is-new'); },
        onHit: (n, el, combo, { fav }) => feel('is-bounce', fav ? '😍' : combo % 2 ? '🥰' : '😆'),
        onWrong: () => feel('is-cry', '😭💧'),
        onMissWish: () => feel('', '🥺'),   // a toy that got away: just a little face, no crying
        onEnd: (score, counted, { favFound } = {}) => {
          game = null;
          if (counted) run(s => playSession(s, petId, score, { favFound }));
          else notify('ยังไม่ทันได้เล่นเลย น้องยังอยากเล่นอยู่นะ 🥺', 'info');
          close();
        },
      });
    },
    onClose: () => { if (game) game.stop(); },
  });
}

/** V16: "😋 อิ่มอร่อย" while a dish treat lasts. */
const treatTag = pet => (pet.treat && pet.treat.until > now() ? '<span class="pet-treat-tag" title="เพิ่งได้กินเมนูพิเศษ">😋 อิ่มอร่อย</span>' : '');
/** V16: the species' favourite dish, a riddle until this pet has eaten it. */
function favDishLineHtml(pet) {
  const fav = favoriteDish(getSpecies(pet.speciesId));
  if (!fav) return '';
  return `<div class="b3-station pet-favdish">🍽️ เมนูโปรด: ${pet.favDishKnown ? `${fav.emoji} ${e(fav.nameTh)}` : '??? <small class="muted">(ลองทำอาหารในครัว 🍳 ป้อนดูสิ)</small>'}</div>`;
}

/** V19: this pet's favourite toy, a riddle until found in the play game. */
function favToyLineHtml(pet) {
  const fav = favToyOf(pet);
  return `<div class="b3-station pet-favtoy">🧸 ของเล่นโปรด: ${pet.favToyKnown ? `${fav.emoji} ${e(fav.nameTh)}` : '??? <small class="muted">(เล่นกับน้อง 🎾 แล้วสังเกตว่าน้องอยากได้อะไรบ่อยๆ)</small>'}</div>`;
}

/** V12: the Limited chip (empty for every other pet). */
const limitedTag = pet => (limitedOf(pet) ? `${limitedOf(pet).icon} <span class="pet-limited-tag">${limitedOf(pet).badge}</span>` : '');

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
    case 'nursery': return '👶 นอนในเปลอนุบาล';
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

// ── ครอบครัวน้อง 💞 (CONTRACT_V10 §3): coat chips, family line, "หาคู่" status ─────────────────────────────
const speciesEmoji = id => { const sp = getSpecies(id); return sp ? sp.emoji : '🐾'; };
const pctText = v => { const p = v * 100; return String(p >= 10 ? Math.round(p) : Math.round(p * 10) / 10); };

/** A coat as a small chip ("🌿 สีมิ้นต์", optionally with its odds). Empty string for an unknown coat. */
export function coatChipHtml(id, chance) {
  const c = getCoat(id);
  return c ? `<span class="coat-chip coat-${e(c.id)}" title="${e(c.nameTh)}">${c.emoji} ${e(c.nameTh)}${chance != null ? ` <b>${pctText(chance)}%</b>` : ''}</span>` : '';
}

/** "ครอบครัว" line of a bred pet: parent emojis + names, generation, coat chip. Empty string for shop / expedition pets. */
export function familyLineHtml(pet) {
  const f = pet && pet.family;
  if (!f || !f.a || !f.b) return '';
  return `<div class="b3-station b3-family">👪 ครอบครัว ${speciesEmoji(f.a.speciesId)} ${e(f.a.name)} + ${speciesEmoji(f.b.speciesId)} ${e(f.b.name)} · รุ่นที่ ${Number(f.gen) || 1} ${coatChipHtml(coatOf(pet))}</div>`;
}

/** Why this pet cannot look for a partner yet: { ok, text } (text = a friendly Thai sentence; the cooldown has a live countdown). */
export function breedStatus(state, pet) {
  const sp = getSpecies(pet.speciesId);
  const no = text => ({ ok: false, text });
  if ((state.player.level || 1) < BREED_UNLOCK_LEVEL) return no(`ปลดล็อกที่เลเวล ${BREED_UNLOCK_LEVEL}`);
  if (sp && sp.rarity === 'legendary') return no('ตำนานมีได้ตัวเดียวในโลก จึงมีลูกไม่ได้นะ');
  if (pet.stage < BREED_MIN_STAGE) return no('ต้องโตเต็มวัยก่อนนะ');
  if (bondHearts(pet) < BREED_MIN_HEARTS) return no(`ต้องสนิทถึง ${BREED_MIN_HEARTS} หัวใจ`);
  if (pet.sick) return no('ไม่สบายอยู่ ให้หายก่อนนะ');
  if (pet.status === 'sleeping') return no('หลับอยู่ ปลุกก่อนนะ');
  if (pet.status === 'working') return no('กำลังทำงานอยู่');
  if (pet.status === 'expedition') return no('ออกสำรวจอยู่');
  const wait = (Number(pet.breedReadyAt) || 0) - now();
  if (wait > 0) return no(`พักหลังมีลูก อีก <span data-countdown="${Number(pet.breedReadyAt)}">${formatDuration(wait)}</span>`);
  if ((state.familyEggs || []).length >= FAMILY_EGG_MAX) return no(`ไข่ครอบครัวเต็มแล้ว (${FAMILY_EGG_MAX} ใบ) ใส่ตู้ฟักก่อนนะ`);
  if (state.pets.filter(p => p.status !== 'nursery').length < 2) return no('ต้องมีน้องในลานอย่างน้อย 2 ตัว');
  return { ok: true, text: 'เลือกคู่ได้เลย' };
}
const plainText = html => String(html).replace(/<[^>]*>/g, '');

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
/** "🐶 A + 🐱 B" of a family egg (snapshot of its parents). */
const familyParentsHtml = fam => `${speciesEmoji(fam.a.speciesId)} ${e(fam.a.name)} + ${speciesEmoji(fam.b.speciesId)} ${e(fam.b.name)}`;

/** 🥚💞 ไข่ครอบครัว: laid family eggs waiting for an incubator slot. Empty string when there are none. */
function renderFamilyEggs(state) {
  const list = state.familyEggs || [];
  if (!list.length) return '';
  const full = state.incubator.length >= state.incubatorCapacity;
  return `<section class="incu-section card fam-section">
    <div class="barn-head"><h2 class="barn-title">🥚💞 ไข่ครอบครัว</h2><span class="badge">${list.length}/${FAMILY_EGG_MAX}</span></div>
    <div class="incu-slots">${list.map(egg => `<div class="incu-slot is-family" style="--egg-color:#ffd3e4">
      <div class="incu-egg" aria-hidden="true">🥚💞</div>
      <div class="incu-info"><div class="incu-name">${familyParentsHtml(egg)}</div>
        <div class="incu-time muted">ฟักใน ${formatDuration(familyEggHatchMs(egg))}</div>
        <button type="button" class="btn btn-sm btn-primary" data-action="put-family-egg" data-egg-id="${e(egg.id)}"${full ? ' disabled title="ตู้ฟักเต็ม"' : ''}>ใส่ตู้ฟัก</button></div></div>`).join('')}</div></section>`;
}

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
    const fam = slot.family || null;
    const egg = fam ? null : getEgg(slot.eggId);
    const ready = t >= slot.readyAt;
    const pct = ready ? 100 : clamp(((t - slot.startAt) / (slot.readyAt - slot.startAt)) * 100, 0, 100);
    slots.push(`<div class="incu-slot${ready ? ' is-ready' : ''}${fam ? ' is-family' : ''}" style="--egg-color:${fam ? '#ffd3e4' : egg ? egg.color : '#f6e7b0'}">
      <div class="incu-egg" aria-hidden="true">${fam ? '🥚💞' : egg ? egg.emoji : '🥚'}</div>
      <div class="incu-info">
        <div class="incu-name">${fam ? '🥚💞 ไข่ครอบครัว' : egg ? e(egg.nameTh) : 'ไข่ปริศนา'}</div>
        ${fam ? `<div class="incu-parents">${familyParentsHtml(fam)}</div>` : ''}
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

  const gift = petGift(state, pet.id);
  const giftBadge = gift.has
    ? `<button type="button" class="pet-gift-badge${gift.full ? ' is-full' : ''}" data-action="pet-gift" data-pet-id="${e(pet.id)}"
        title="เก็บของขวัญ 🪙${gift.coins}${gift.itemCount ? ` +${gift.itemCount} ชิ้น` : ''}" aria-label="เก็บของขวัญจาก${e(petName(pet))}">${gift.full ? '🎁✨' : '🎁'}</button>`
    : '';
  const poops = Array.from({ length: pet.poop }, () =>
    `<button type="button" class="pet-poop" data-action="poop" data-pet-id="${e(pet.id)}" title="เก็บอึ" aria-label="เก็บอึ">💩</button>`).join('');

  const cls = ['pet-card'];
  if (sleeping) cls.push('is-sleeping');
  if (pet.sick) cls.push('is-sick');
  if (pet.shiny) cls.push('is-shiny');
  if (limitedOf(pet)) cls.push('is-limited');
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
      ${giftBadge}
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
      ${limitedTag(pet)}
      ${treatTag(pet)}
      ${lonelyTag(pet)}
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
      ${actionBtn('wear', pet.id, '👗 แต่งตัว', pet.status === 'sleeping' ? '' : '')}
      ${actionBtn('breed', pet.id, '💞 หาคู่', (() => { const b = breedStatus(state, pet); return b.ok ? '' : plainText(b.text); })())}
    </div>
  </article>`;
}

// ── เปลอนุบาล + ตัวช่วยเปรียบเทียบ + ส่งไปบ้านใหม่ (CONTRACT_V7 §5) ─────────────────────────────────
/** 👶 Nursery rows (list view): frozen babies waiting for a yard slot. Empty string when the nursery is empty. */
function renderNursery(state) {
  const babies = nurseryPets(state);
  if (!babies.length) return '';
  const yardFull = state.pets.length >= state.barnCapacity;
  const rows = babies.map(pet => {
    const sp = getSpecies(pet.speciesId);
    const pers = persOf(pet);
    return `<div class="nursery-row${pet.shiny ? ' is-shiny' : ''}" data-pet-id="${e(pet.id)}" style="--rar:${sp ? RARITIES[sp.rarity].color : '#8e9aa6'}">
      <span class="nursery-emoji" aria-hidden="true">${petEmoji(pet)}<i class="nursery-zzz">💤</i></span>
      <div class="nursery-info">
        <div class="nursery-name"><b>${e(petName(pet))}</b> ${sp ? rarityBadge(sp) : ''}${pet.shiny ? ' <span class="pet-shiny-tag">✨ ไชนี่</span>' : ''} ${limitedTag(pet)}</div>
        <div class="nursery-sub muted">${sp ? e(sp.nameTh) : ''} · ${pers.emoji} ${pers.nameTh} ${traitBadge(sp)}</div>
        <div class="nursery-acts">
          <button type="button" class="btn btn-sm btn-primary" data-action="nursery-adopt" data-pet-id="${e(pet.id)}"${yardFull ? ' disabled title="ลานเต็ม — สลับกับน้องในลานแทนนะ"' : ''}>🏡 รับเข้าลาน</button>
          <button type="button" class="btn btn-sm" data-action="nursery-swap" data-pet-id="${e(pet.id)}">🔄 สลับกับน้องในลาน…</button>
          ${limitedOf(pet) ? '' : `<button type="button" class="btn btn-sm btn-ghost" data-action="nursery-rehome" data-pet-id="${e(pet.id)}">💌 ส่งไปบ้านใหม่</button>`}
        </div>
      </div></div>`;
  }).join('');
  return `<section class="nursery-section card">
    <div class="barn-head"><h2 class="barn-title">👶 เปลอนุบาล</h2><span class="badge">${babies.length}/${NURSERY_SLOTS}</span></div>
    <p class="muted nursery-note">ลานเต็ม น้องใหม่เลยหลับรออยู่ในเปล — ไม่หิว ไม่โต ไม่ทำงาน จนกว่าจะรับเข้าลาน</p>
    <div class="nursery-list">${rows}</div></section>`;
}

/** Bottom sheet for a nursery baby in the 3D yard (pure string; buttons carry data-b3 so barn3d can handle them). */
function nurserySheetHtml(pet, state, opts = {}) {
  const sp = getSpecies(pet.speciesId);
  const pers = persOf(pet);
  const yardFull = state.pets.length >= state.barnCapacity;
  const reveal = opts.reveal && sp ? `<div class="b3-reveal${pet.shiny ? ' is-shiny' : ''}" style="--rar:${RARITIES[sp.rarity].color}">
      <b>${sp.rarity === 'legendary' ? '✦ ตำนานปรากฏตัว!' : pet.shiny ? '✨ ฟักสำเร็จ! ร่างไชนี่!' : '🐣 ฟักสำเร็จ!'}</b>
      <div>${e(sp.nameTh)} ${rarityBadge(sp)} ${traitBadge(sp)}</div>
      ${pet.family ? `<div class="b3-reveal-family">💞 ลูกของ ${e(pet.family.a.name)} กับ ${e(pet.family.b.name)}</div>` : ''}
      <small class="muted">นิสัย ${pers.emoji} ${pers.nameTh} · ${e(sp.desc)}</small></div>` : '';
  return `<div class="b3-sheet-head">
      <span class="b3-sheet-emoji" aria-hidden="true">${petEmoji(pet)}</span>
      <div class="b3-sheet-title"><b>${e(petName(pet))}</b>
        <small>${sp ? e(sp.nameTh) : ''} · 👶 นอนในเปลอนุบาล${pet.shiny ? ' · ✨' : ''}</small></div>
      <button type="button" class="b3-sheet-close" data-b3="close" aria-label="ปิด">✕</button></div>
    <div class="b3-sheet-body">${reveal}
      <p class="muted b3-nursery-note">${yardFull ? 'ลานเต็มอยู่ — สลับกับน้องในลาน หรือขยายลานก่อนนะ' : 'ลานมีที่ว่างแล้ว รับน้องเข้าลานได้เลย!'}</p>
      <div class="pet-actions b3-acts b3-acts-3">
        <button type="button" class="btn btn-sm btn-primary pet-act" data-b3="nursery-adopt" data-pet-id="${e(pet.id)}"${yardFull ? ' disabled title="ลานเต็ม"' : ''}>🏡 รับเข้าลาน</button>
        <button type="button" class="btn btn-sm pet-act" data-b3="nursery-swap" data-pet-id="${e(pet.id)}">🔄 สลับกับน้องในลาน…</button>
        ${limitedOf(pet) ? '' : `<button type="button" class="btn btn-sm btn-ghost pet-act" data-b3="nursery-rehome" data-pet-id="${e(pet.id)}">💌 ส่งไปบ้านใหม่</button>`}
      </div></div>`;
}

/**
 * One candidate of the compare picker (pure string, exported for tests): emoji, name, stage, power, hearts, shiny, station,
 * rarity and "ซ้ำ ×N" (how many of the species you own, the baby included). Duplicates carry a soft "ตัวซ้ำ แนะนำ" hint.
 */
export function compareRowHtml(row) {
  const st = STAGES[row.stage] || STAGES[0];
  const sp = getSpecies(row.pet.speciesId);
  const chips = [
    `<span class="cmp-chip" title="พลังทำงาน">💪 ${row.power}</span>`,
    `<span class="cmp-chip" title="ความผูกพัน ${row.hearts}/5">❤️ ${row.hearts}</span>`,
    row.shiny ? '<span class="cmp-chip is-shiny" title="ไชนี่">✨ ไชนี่</span>' : '',
    row.station ? `<span class="cmp-chip is-warn" title="ถ้าน้องไป แปลงนี้จะว่าง">📌 ${e(row.station)}</span>` : '',
    row.dup > 1 ? `<span class="cmp-chip is-dup" title="มีสายพันธุ์นี้ ${row.dup} ตัว">ซ้ำ ×${row.dup}</span>` : '',
    row.where === 'nursery' ? '<span class="cmp-chip">👶 ในเปล</span>' : '',
  ].join('');
  return `<button type="button" class="pet-picker-item cmp-item${row.suggest ? ' is-suggest' : ''}" data-pet-id="${e(row.id)}"${row.eligible ? '' : ` disabled title="${e(row.reason)}"`}>
    <span class="cmp-emoji${row.shiny ? ' is-shiny' : ''}" aria-hidden="true">${row.emoji}</span>
    <span class="cmp-main"><span class="cmp-name"><b>${e(row.name)}</b> <small>${st.icon} ${st.nameTh}</small>${sp ? ` ${rarityBadge(sp)}` : ''}</span>
      <span class="cmp-chips">${chips}</span>
      ${row.suggest ? '<span class="cmp-hint">💡 ตัวซ้ำ แนะนำ</span>' : ''}${row.eligible ? '' : `<span class="cmp-hint is-off">${e(row.reason)}</span>`}</span></button>`;
}

/** Modal that lists compare rows; nothing is pre-selected. onPick(petId) runs after the modal closes. */
function openComparePicker({ title, intro = '', rows, onPick }) {
  const html = `${intro ? `<p class="muted cmp-intro">${intro}</p>` : ''}${rows.length
    ? `<div class="pet-picker-list cmp-list">${rows.map(compareRowHtml).join('')}</div>`
    : '<p class="muted pet-picker-empty">ยังไม่มีน้องให้เลือกเลย</p>'}`;
  let close = () => {};
  close = openModal({
    title,
    html,
    onMount(el) {
      el.addEventListener('click', ev => {
        const b = ev.target.closest('.cmp-item');
        if (!b || b.disabled) return;
        const id = b.dataset.petId;
        close();
        if (onPick) onPick(id);
      });
    },
  });
  return close;
}

/** "สลับกับน้องในลาน…": pick the yard pet that goes to the crib instead of the baby. */
function openSwapPicker(babyId) {
  const state = getState();
  if (!getNurseryPet(state, babyId)) return;
  openComparePicker({
    title: '🔄 เลือกน้องในลานที่จะสลับ',
    intro: 'น้องที่เลือกจะไปนอนในเปลแทน (ของขวัญที่ถืออยู่จะถูกเก็บให้ก่อน) และน้องในเปลจะเข้าลานทันที',
    rows: compareCandidates(state, { scope: 'yard' }),
    onPick: yardId => run(s => swapWithNursery(s, babyId, yardId)),
  });
}

/** Confirm step of "ส่งไปบ้านใหม่ 🏡💌" (always asked: it cannot be undone). */
function confirmRehome(petId) {
  const state = getState();
  const pet = getPet(state, petId) || getNurseryPet(state, petId);
  if (!pet) return;
  const gift = petGift(state, petId);
  const station = stationStatus(state, pet);
  let close = () => {};
  close = openModal({
    title: '💌 ส่งไปบ้านใหม่',
    html: `<div class="rehome-confirm">${petChipHtml(pet)}
      <p>ส่ง <b>${e(petName(pet))}</b> ไปอยู่บ้านใหม่จริงๆ หรือ? จะไม่สามารถเอากลับมาได้ แต่น้องอาจส่งโปสการ์ดมาหาในอีกสองสามวัน 💌</p>
      <p class="muted">ได้ ${RELEASE_COINS} 🪙 และผงดาว ${rehomeDust(pet)} ✨${gift.has ? ` · ของขวัญที่น้องถืออยู่ (🪙${gift.coins}${gift.itemCount ? ` +${gift.itemCount} ชิ้น` : ''}) จะถูกเก็บให้ก่อน` : ''}</p>
      ${station ? `<p class="pet-release-station">📌 ${station.label} อยู่ — ส่งไปแล้วแปลงนี้จะว่าง</p>` : ''}
      <div class="rehome-actions"><button type="button" class="btn btn-sm pet-release-yes" data-action="yes">💌 ส่งไปบ้านใหม่</button>
      <button type="button" class="btn btn-sm btn-ghost" data-action="no">ยกเลิก</button></div></div>`,
    onMount(el) {
      delegate(el, {
        yes: () => { close(); run(s => rehomePet(s, petId)); },
        no: () => close(),
      });
    },
  });
}

/** Both the yard and the nursery are full: pick who moves on (compare helper, never auto-selected). */
function openRehomePicker(intro = 'ลานกับเปลเต็มแล้ว เลือกน้องที่จะส่งไปบ้านใหม่ เพื่อเปิดที่ให้น้องใหม่') {
  openComparePicker({
    title: '💌 เลือกน้องที่จะส่งไปบ้านใหม่',
    intro,
    rows: compareCandidates(getState(), { scope: 'all' }),
    onPick: id => confirmRehome(id),
  });
}

/** 💌 mailbox: postcards from pets in their new homes, newest first. Opening it marks them read. */
function openMailbox() {
  const state = getState();
  const cards = arrivedPostcards(state);
  const t = now();
  const html = cards.length
    ? `<div class="mail-list">${cards.map(c => {
        const sp = getSpecies(c.speciesId);
        return `<article class="mail-card${c.read ? '' : ' is-new'}">
          <div class="mail-head"><span class="mail-emoji" aria-hidden="true">${sp ? sp.emoji : '💌'}</span><b>${e(c.petName)}</b>
            <small class="muted">${c.read ? '' : '✨ ใหม่ · '}${formatDuration(t - c.at)}ที่แล้ว</small></div>
          <p class="mail-text">${e(c.text)}</p></article>`;
      }).join('')}</div>`
    : '<p class="muted pet-picker-empty">ยังไม่มีโปสการ์ด — น้องที่ส่งไปบ้านใหม่จะเขียนมาหาในอีก 12–36 ชม. 💌</p>';
  openModal({ title: '💌 โปสการ์ดจากบ้านใหม่', html });
  if (cards.some(c => !c.read)) update(s => { for (const c of arrivedPostcards(s)) markPostcardRead(s, c.id); });
}

/** 📔 บันทึก: the diary, newest day first, in a cute handwritten style (CSS only). */
/** V16 🍳 ครัว: recipes with what the bag holds; cooking re-draws the list in place. */
function kitchenHtml(state) {
  const rows = kitchenList(state).map(({ recipe: r, locked, parts, ok }) => {
    const have = countItem(state, r.id);
    const chips = parts.map(p => `<span class="kit-part${p.have >= p.need ? ' is-ok' : ''}">${p.item ? p.item.emoji : '❓'} ${p.item ? e(p.item.nameTh) : ''} ${Math.min(p.have, p.need)}/${p.need}</span>`).join('');
    return `<div class="kit-row${locked ? ' is-locked' : ''}">
      <span class="kit-emoji" aria-hidden="true">${r.emoji}</span>
      <div class="kit-info"><b>${e(r.nameTh)}</b>${have ? ` <span class="badge">มี x${have}</span>` : ''}
        <div class="muted kit-desc">${e(r.desc)} · 😋 อิ่มอร่อย 3 ชม.</div>
        ${locked ? `<div class="muted">🔒 ปลดล็อกที่เลเวล ${r.unlockLevel}</div>` : `<div class="kit-parts">${chips}</div>`}</div>
      <button type="button" class="btn btn-sm${ok ? ' btn-primary' : ''}" data-cook="${e(r.id)}"${ok ? '' : ' disabled'}>🍳 ทำ</button>
    </div>`;
  }).join('');
  return `<div class="kitchen"><p class="muted kit-note">เอาผลผลิตจากไร่กับของป่ามาทำเมนูพิเศษ แล้วลากไปป้อนน้องในลาน น้องจะอิ่มอร่อย 😋 และถ้าเจอเมนูโปรดจะดีใจมาก 💕</p>${rows}</div>`;
}

function openKitchen() {
  openModal({
    title: '🍳 ครัวน้องๆ',
    html: kitchenHtml(getState()),
    onMount(body) {
      body.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-cook]');
        if (!btn || btn.disabled) return;
        run(s => cook(s, btn.dataset.cook));
        body.innerHTML = kitchenHtml(getState());
      });
    },
  });
}

function openJournal() {
  const days = journalDays(getState());
  const dayLabel = d => { try { return new Date(`${d}T12:00:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return d; } };
  const html = days.length
    ? `<div class="jr-book">${days.map((d, i) => `<section class="jr-day${i === 0 ? ' is-today' : ''}">
        <h4 class="jr-date">${i === 0 ? '✏️ ' : ''}${e(dayLabel(d.day))}</h4>
        <ul class="jr-lines">${[...d.lines].reverse().map(l => `<li><span class="jr-e" aria-hidden="true">${e(l.emoji || '🐾')}</span><span class="jr-t">${e(l.text)}</span></li>`).join('')}</ul></section>`).join('')}</div>`
    : '<p class="muted pet-picker-empty jr-empty">สมุดบันทึกยังว่างอยู่ — ลองเล่นกับน้องๆ แล้วเรื่องน่ารักจะมาอยู่ที่นี่ 📔</p>';
  openModal({ title: '📔 บันทึกน้อง', html });
}

/** 🖼️ อัลบั้ม: photo grid (local to this device); tap to view full size, delete there. */
async function openAlbum() {
  const urls = [];
  const revoke = () => { for (const u of urls) URL.revokeObjectURL(u); urls.length = 0; };
  const photos = await listPhotos();
  const items = [];
  for (const m of photos) { const u = await getPhotoUrl(m.id); if (u) { urls.push(u); items.push({ m, u }); } }
  const grid = items.length
    ? `<div class="al-grid">${items.map(({ m, u }) => `<button type="button" class="al-cell" data-photo-id="${e(m.id)}" aria-label="ดูรูป"><img src="${u}" alt="รูปน้อง" loading="lazy"></button>`).join('')}</div><p class="muted al-note">รูปเก็บไว้ในเครื่องนี้เท่านั้น (สูงสุด 30 รูป)</p>`
    : '<p class="muted pet-picker-empty">ยังไม่มีรูป — กด 📸 บนลานเพื่อถ่ายรูปน้องๆ ได้เลย</p>';
  let close = () => {};
  close = openModal({
    title: '🖼️ อัลบั้ม',
    html: grid,
    onClose: revoke,
    onMount(el) {
      el.addEventListener('click', ev => {
        const b = ev.target.closest('.al-cell');
        if (!b) return;
        const it = items.find(x => x.m.id === b.dataset.photoId);
        if (!it) return;
        const when = new Date(it.m.at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
        el.innerHTML = `<div class="al-view"><img src="${it.u}" alt="รูปน้อง"><small class="muted">${e(when)}</small>
          <div class="al-acts"><button type="button" class="btn btn-sm" data-al="back">‹ กลับ</button>
          <button type="button" class="btn btn-sm" data-al="dl">⬇️ ดาวน์โหลด</button>
          <button type="button" class="btn btn-sm btn-ghost" data-al="del">🗑️ ลบ</button></div></div>`;
        el.onclick = ev2 => {
          const a = ev2.target.closest('[data-al]');
          if (!a) return;
          if (a.dataset.al === 'dl') downloadPhoto(it.u, photoFilename(it.m));
          else if (a.dataset.al === 'del') {
            if (!confirm('ลบรูปนี้ออกจากอัลบั้ม?')) return;
            deletePhoto(it.m.id).then(() => { close(); openAlbum(); });
          } else { close(); openAlbum(); }
        };
      });
    },
  });
}

/** List view: the same wear panel in a modal. */
function openWearModal(petId) {
  const pet = getPet(getState(), petId);
  if (!pet) return;
  let box = null;
  const paint = () => { const p = getPet(getState(), petId); if (box && p) box.innerHTML = wearPanelHtml(p, getState()); };
  openModal({
    title: `👗 แต่งตัว ${petName(pet)}`,
    html: `<div class="wear-modal">${wearPanelHtml(pet, getState())}</div>`,
    onMount(el) {
      box = el.querySelector('.wear-modal');
      el.addEventListener('click', ev => {
        const b = ev.target.closest('[data-b3]');
        if (!b) return;
        if (b.dataset.b3 === 'wear-pick') run(s => wearAccessory(s, petId, b.dataset.accId));
        else if (b.dataset.b3 === 'wear-off') run(s => takeOffAccessory(s, petId, b.dataset.slot));
        paint();
      });
    },
  });
}

/** Decor picker for one spot of the 3D yard: place something you built, or take the placed one back. */
function openDecorPicker(spot) {
  const state = getState();
  const placed = (state.decor || []).find(d => d.spot === spot) || null;
  const built = Object.entries(state.inventoryDecor || {}).filter(([, n]) => n > 0).map(([id, n]) => ({ d: getDecor(id), n })).filter(r => r.d);
  const cur = placed && getDecor(placed.decorId);
  const list = built.length
    ? `<div class="pet-picker-list">${built.map(r => `<button type="button" class="pet-picker-item decor-pick" data-decor-id="${e(r.d.id)}">
        <span class="decor-pick-emoji" aria-hidden="true">${r.d.emoji}</span>
        <span class="incu-pick-main"><b>${e(r.d.nameTh)}</b> <small>×${r.n}</small></span>
        <span class="pet-picker-desc">${e(r.d.useTh)}</span></button>`).join('')}</div>`
    : '<p class="muted pet-picker-empty">ยังไม่มีของตกแต่งที่สร้างไว้ — ไปสร้างได้ที่ร้านค้า 🛒 (ตกแต่งลาน) ใช้วัสดุจากการสำรวจนะ</p>';
  let close = () => {};
  close = openModal({
    title: `✨ จุดตกแต่ง #${spot + 1}`,
    html: `${cur ? `<div class="decor-current"><span class="decor-pick-emoji">${cur.emoji}</span> <b>${e(cur.nameTh)}</b> วางอยู่ตรงนี้
        <button type="button" class="btn btn-sm btn-ghost" data-decor-take="${e(placed.id)}">เก็บกลับกระเป๋า</button></div>` : ''}
      ${built.length || !cur ? `<h4 class="pet-detail-h">${cur ? 'เปลี่ยนเป็น' : 'วางอะไรดี?'}</h4>` : ''}${list}`,
    onMount(el) {
      el.addEventListener('click', ev => {
        const take = ev.target.closest('[data-decor-take]');
        if (take) { close(); run(s => farmLogic.removeDecor(s, take.dataset.decorTake)); return; }
        const b = ev.target.closest('.decor-pick');
        if (!b) return;
        close();
        run(s => {
          if (placed) { const r = farmLogic.removeDecor(s, placed.id); if (!r.ok) return r; }
          return farmLogic.placeDecor(s, b.dataset.decorId, spot);
        });
      });
    },
  });
}

/** What barn3d may do with decor (all guarded: farm.js decor API is Coder C's). */
const decorApi = {
  available: () => typeof farmLogic.placeDecor === 'function' && typeof farmLogic.removeDecor === 'function',
  openPicker: spot => openDecorPicker(spot),
  emoji: decorId => { const d = getDecor(decorId); return d ? d.emoji : '✨'; },
  info: decorId => getDecor(decorId),
  all: DECOR,
};


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
  return `<div class="barn-toggle" role="group" aria-label="มุมมองลาน">
    <button type="button" class="barn-toggle-btn${on === '3d' ? ' is-on' : ''}" data-action="barn-mode" data-mode="3d" aria-pressed="${on === '3d'}">🌳 ลาน</button>
    <button type="button" class="barn-toggle-btn${on === 'list' ? ' is-on' : ''}" data-action="barn-mode" data-mode="list" aria-pressed="${on === 'list'}">📋 รายการ</button></div>`;
}

/** Small "🎁 N" chip (list view): N = pets holding a gift; collects every pet's gift. Empty string when nothing waits. */
function giftChipHtml(state) {
  const pv = yardPreview(state);
  if (!pv.pets) return '';
  const n = Object.values(pv.items).reduce((a, b) => a + b, 0);
  return `<button type="button" class="yard-chip${pv.fullPets ? ' is-full' : ''}" data-action="yard-collect"
    title="เก็บของขวัญจากน้องทุกตัว 🪙${pv.coins}${n ? ` +${n} ชิ้น` : ''}" aria-label="เก็บของขวัญจากน้อง ${pv.pets} ตัว">🎁 ${pv.pets}</button>`;
}

/** 💌 on the yard header once a postcard has arrived; the number counts the unread ones. */
function mailBtnHtml(state) {
  const arrived = arrivedPostcards(state);
  if (!arrived.length) return '';
  const unread = arrived.filter(c => !c.read).length;
  return `<button type="button" class="yard-mail${unread ? ' has-new' : ''}" data-action="open-mail" aria-label="โปสการ์ดจากบ้านใหม่${unread ? ` (ใหม่ ${unread})` : ''}">💌${unread ? `<b class="yard-mail-n">${unread}</b>` : ''}</button>`;
}

/** 🍳 ครัว, 📔 บันทึก and 🖼️ อัลบั้ม chips on the yard header. */
const memoryBtnsHtml = () =>
  '<button type="button" class="yard-mail yard-memo" data-action="open-kitchen" title="ครัว" aria-label="ครัวทำอาหารให้น้อง">🍳</button>' +
  '<button type="button" class="yard-mail yard-memo" data-action="open-journal" title="บันทึกน้อง" aria-label="บันทึกน้อง">📔</button>' +
  '<button type="button" class="yard-mail yard-memo" data-action="open-album" title="อัลบั้ม" aria-label="อัลบั้มรูป">🖼️</button>';

function renderBarn(state) {
  const t = now();
  const pets = state.pets;
  const mode = barnMode();
  const toggle = barnToggleHtml(mode);
  let festChip = '';
  try { festChip = festChipHtml(state); festivalDailyCheck(); } catch (err) { console.warn('festival chip unavailable', err); }
  if (mode === '3d' || mode === 'loading') {
    return `<div class="barn-view barn-3d">
      ${renderFamilyEggs(state)}
      <section class="barn-section">
        <div class="barn-head"><h2 class="barn-title">🏡 ลานน้องๆ</h2>
          <div class="barn-head-r">${memoryBtnsHtml()}${mailBtnHtml(state)}<span class="badge barn-cap">${pets.length}/${state.barnCapacity}</span>${toggle}</div></div>
        ${festChip}
        ${mode === '3d'
          ? '<div class="b3" data-key="barn3d" data-morph="skip"></div>'
          : '<div class="b3 b3-loading" data-key="barn3d-loading">กำลังโหลดลาน 3 มิติ…</div>'}
      </section></div>`;
  }
  if (!listGreet) { const d = takeGreeting(); if (d) listGreet = { lines: d.lines.slice(0, 5), i: 0 }; }
  const greetBar = listGreet ? (() => {
    const l = listGreet.lines[listGreet.i];
    return `<button type="button" class="greet-bar" data-action="greet-next"><span class="greet-t">${e(l.emoji || '💬')} ${e(l.text)}</span>
      <small>${listGreet.i < listGreet.lines.length - 1 ? `แตะเพื่ออ่านต่อ ▸ (${listGreet.i + 1}/${listGreet.lines.length})` : 'แตะเพื่อปิด'}</small></button>`;
  })() : '';
  const hasEgg = state.incubator.length > 0 || EGGS.some(eg => countItem(state, eg.id) > 0);
  const empty = `<div class="empty-state barn-empty">
      <div class="barn-empty-emoji">🥚</div>
      <p>ยังไม่มีน้องในลานเลย</p>
      <p class="muted">${hasEgg ? 'ใส่ไข่ในตู้ฟักด้านบน แล้วรอฟักเป็นเพื่อนตัวแรกของคุณ!' : 'ไปซื้อไข่ที่ร้านค้า 🛒 แล้วนำมาฟักในตู้ฟักได้เลย'}</p>
    </div>`;
  return `<div class="barn-view">
    ${greetBar}
    ${renderFamilyEggs(state)}
    ${renderIncubator(state, t)}
    ${renderNursery(state)}
    <section class="barn-section">
      <div class="barn-head"><h2 class="barn-title">🏡 ลานน้องๆ</h2>
        <div class="barn-head-r">${giftChipHtml(state)}${memoryBtnsHtml()}${mailBtnHtml(state)}<span class="badge barn-cap">${pets.length}/${state.barnCapacity}</span>${toggle}</div></div>
      ${festChip}
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
      ${mode === 'feed' || mode === 'wear' ? '<button type="button" class="btn btn-sm btn-ghost" data-b3="back" aria-label="กลับ">‹</button>' : ''}
      <span class="b3-sheet-emoji" aria-hidden="true">${petEmoji(pet)}</span>
      <div class="b3-sheet-title"><b>${e(petName(pet))}</b>
        <small>${sp ? e(sp.nameTh) : ''} · ${st.icon} ${st.nameTh}${pet.shiny ? ' · ✨' : ''}${sp && sp.rarity === 'legendary' ? ' · ✦ ตำนาน' : ''}</small></div>
      <button type="button" class="b3-sheet-close" data-b3="close" aria-label="ปิด">✕</button></div>`;
  if (mode === 'feed') {
    return `${head}<div class="b3-sheet-body">${foodListHtml(pet, state, 'data-b3')}</div>`;
  }
  if (mode === 'wear') return `${head}<div class="b3-sheet-body">${wearPanelHtml(pet, state)}</div>`;
  const pers = persOf(pet);
  const station = stationStatus(state, pet);
  const stationLine = (station ? `<div class="b3-station">📌 ${station.label} · ${station.emoji} ${station.text}</div>` : '') +
    (favoriteLine(pet) ? `<div class="b3-station">💕 ${e(favoriteLine(pet))}</div>` : '') +
    (friendLine(state, pet) ? `<div class="b3-station">🤝 ${e(friendLine(state, pet))}</div>` : '');
  const reveal = opts.reveal && sp ? `<div class="b3-reveal${pet.shiny ? ' is-shiny' : ''}" style="--rar:${RARITIES[sp.rarity].color}">
      <b>${sp.rarity === 'legendary' ? '✦ ตำนานปรากฏตัว!' : pet.shiny ? '✨ ฟักสำเร็จ! ร่างไชนี่!' : '🐣 ฟักสำเร็จ!'}</b>
      <div>${e(sp.nameTh)} ${rarityBadge(sp)} ${traitBadge(sp)}</div>
      ${pet.family ? `<div class="b3-reveal-family">💞 ลูกของ ${e(pet.family.a.name)} กับ ${e(pet.family.b.name)}</div>` : ''}
      <small class="muted">นิสัย ${pers.emoji} ${pers.nameTh} · ${e(sp.desc)}</small></div>` : '';
  const br = breedStatus(state, pet);
  return `${head}<div class="b3-sheet-body">${reveal}${stationLine}${familyLineHtml(pet)}${favDishLineHtml(pet)}${favToyLineHtml(pet)}${lonelyLevel(pet) ? `<div class="b3-station pet-lonely-line">${lonelyTag(pet)} ${lonelyLevel(pet) === 2 ? 'ป่วยง่ายขึ้นนะ' : ''} — เล่นด้วยกัน 🎾 หรือให้ของเล่น 🧸</div>` : ''}
      <div class="b3-sheet-line"><span class="pet-status">${statusLabel(pet, state)}</span>
        <span class="pet-hearts" title="ความผูกพัน ${bond.hearts}/5">${heartsHtml(bond.hearts)}</span></div>
      <div class="b3-stats">
        ${miniStat('🍖', 'อิ่ม', pet.stats.hunger)}${miniStat('💖', 'สุข', pet.stats.happy)}
        ${miniStat('⚡', 'พลัง', pet.stats.energy)}${miniStat('🫧', 'สะอาด', pet.stats.clean)}</div>
      <div class="pet-actions b3-acts">${petActionsHtml(pet, 'data-b3')}</div>
      <button type="button" class="b3-wear-row" data-b3="wear" data-pet-id="${e(pet.id)}" aria-label="แต่งตัวให้${e(petName(pet))}">
        <span class="b3-wear-t">👗 แต่งตัว</span><span class="b3-wear-now">${wornEmojis(pet) || '<small class="muted">ยังไม่ได้ใส่อะไร</small>'}</span><span aria-hidden="true">›</span></button>
      <button type="button" class="b3-wear-row b3-breed-row${br.ok ? '' : ' is-off'}" data-b3="breed" data-pet-id="${e(pet.id)}"${br.ok ? '' : ' disabled'} aria-label="หาคู่ให้${e(petName(pet))}">
        <span class="b3-wear-t">💞 หาคู่</span><span class="b3-wear-now"><small class="${br.ok ? '' : 'muted'}">${br.text}</small></span>${br.ok ? '<span aria-hidden="true">›</span>' : ''}</button></div>`;
}

const SLOT_TH = { head: 'หัว', neck: 'คอ' };
const wornEmojis = pet => Object.values(wearOf(pet)).map(id => { const a = getAccessory(id); return a ? `<span class="b3-wear-e">${a.emoji}</span>` : ''; }).join('');

/** "👗 แต่งตัว": what the pet wears (tap ✕ to take off) and the free items in the wardrobe. */
function wearPanelHtml(pet, state) {
  const w = wearOf(pet);
  const slots = ACC_SLOTS.map(slot => {
    const a = getAccessory(w[slot]);
    return `<div class="wear-slot${a ? ' has' : ''}"><small>${SLOT_TH[slot]}</small>` +
      (a ? `<span class="wear-slot-e">${a.emoji}</span><b>${e(a.nameTh)}</b><button type="button" class="wear-off" data-b3="wear-off" data-pet-id="${e(pet.id)}" data-slot="${slot}" aria-label="ถอด${e(a.nameTh)}">✕</button>`
        : '<span class="wear-slot-e is-empty">·</span><span class="muted">ว่าง</span>') + '</div>';
  }).join('');
  const items = wardrobeList(state);
  const list = items.length
    ? `<div class="wear-list">${items.map(({ acc, n }) => `<button type="button" class="wear-item" data-b3="wear-pick" data-pet-id="${e(pet.id)}" data-acc-id="${e(acc.id)}">
        <span class="wear-item-e">${acc.emoji}</span><span class="wear-item-n">${e(acc.nameTh)}</span><small>${SLOT_TH[acc.slot]}${n > 1 ? ` ×${n}` : ''}</small></button>`).join('')}</div>`
    : '<p class="muted pet-picker-empty">ตู้เสื้อผ้ายังว่างอยู่ — ซื้อได้ที่ร้านค้า 🛒 หรือลุ้นเจอตอนออกสำรวจ 🧭</p>';
  return `<div class="wear-slots">${slots}</div>${list}`;
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
  revealHatch: (pet, toNursery) => openHatchReveal(pet, !!toNursery), // the list's normal reveal, used when the 3D ceremony is cut short
  nurserySheetHtml,
  takeGreeting,
  nurseryAdopt: id => run(s => adoptFromNursery(s, id)),
  nurserySwap: id => openSwapPicker(id),
  nurseryRehome: id => confirmRehome(id),
  openBreed: id => openBreedPicker(id),
  onHatchBlocked: () => openRehomePicker(),
  decor: decorApi,
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
  const fams = state.familyEggs || [];
  const famHtml = fams.length
    ? `<h4 class="pet-detail-h">🥚💞 ไข่ครอบครัว</h4><div class="pet-picker-list">${fams.map(g =>
        `<button type="button" class="pet-picker-item incu-pick is-family" data-family-egg-id="${e(g.id)}" style="--egg-color:#ffd3e4">` +
        '<span class="incu-pick-egg">🥚💞</span>' +
        `<span class="incu-pick-main"><b>${familyParentsHtml(g)}</b></span>` +
        `<span class="pet-picker-desc">ใส่ตู้ฟัก · ${formatDuration(familyEggHatchMs(g))}</span></button>`).join('')}</div>`
    : '';
  const html = owned.length || fams.length
    ? `${famHtml}<div class="pet-picker-list">${owned.map(eg =>
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
        const f = ev.target.closest('[data-family-egg-id]');
        if (f) { close(); run(s => putFamilyEggInIncubator(s, f.dataset.familyEggId)); return; }
        const b = ev.target.closest('[data-egg-id]');
        if (!b) return;
        close();
        run(s => putEggInIncubator(s, b.dataset.eggId));
      });
    },
  });
}

/** "ลูกจะเป็น 🐶 45 % · 🐱 45 % · 🥚 สุ่มถิ่น 10 %" from breedPreview().species. */
function speciesOddsText(list) {
  const fresh = list.filter(x => !x.speciesId);
  const parts = list.filter(x => x.speciesId).map(x => `${speciesEmoji(x.speciesId)} ${pctText(x.chance)} %`);
  if (fresh.length) {
    const habs = [...new Set(fresh.map(x => (HABITATS[x.habitat] || {}).emoji).filter(Boolean))].join('');
    parts.push(`🥚 สุ่มถิ่น${habs} ${pctText(fresh.reduce((n, x) => n + x.chance, 0))} %`);
  }
  return `ลูกจะเป็น ${parts.join(' · ')}`;
}

/** One row of the partner picker (pure string, exported for tests). armed = the second tap shows the price. */
export function breedRowHtml(pet, pv, { best = false, armed = false } = {}) {
  const st = STAGES[pet.stage] || STAGES[0];
  const sp = getSpecies(pet.speciesId);
  const priceTxt = pv.cost ? `🪙 ${pv.cost}${pv.friendDiscount > 0 ? ` <small class="breed-save">ลด ${pv.friendDiscount} 🪙 เพราะเพื่อนซี้</small>` : ''}` : '';
  return `<button type="button" class="pet-picker-item cmp-item breed-row${best ? ' is-best' : ''}${armed ? ' is-armed' : ''}" data-pet-id="${e(pet.id)}"${pv.ok ? '' : ` disabled title="${e(pv.reason)}"`}>
    <span class="cmp-emoji${pet.shiny ? ' is-shiny' : ''}" aria-hidden="true">${petEmoji(pet)}</span>
    <span class="cmp-main"><span class="cmp-name"><b>${e(petName(pet))}</b> <small>${st.icon} ${st.nameTh}</small>${sp ? ` ${rarityBadge(sp)}` : ''}${best ? ' <span class="cmp-chip is-best">💕 เพื่อนซี้</span>' : ''}</span>
      ${pv.ok || pv.species.length ? `<span class="breed-odds">${speciesOddsText(pv.species)}</span>
      <span class="breed-odds">✨ ไชนี่ ${pctText(pv.shinyChance)} %</span>
      <span class="cmp-chips">${pv.coats.filter(c => c.chance >= 0.005).map(c => coatChipHtml(c.coat, c.chance)).join('')}</span>` : ''}
      ${pv.ok ? `<span class="breed-price">${priceTxt}</span>` : `<span class="cmp-hint is-off">${e(pv.reason)}</span>`}
      ${armed && pv.ok ? `<span class="breed-confirm">💞 แตะอีกครั้งเพื่อยืนยัน · จ่าย ${pv.cost} 🪙</span>` : ''}</span></button>`;
}

/** 💞 หาคู่: the partner picker (best friend first). Two taps: the first shows the price, the second lays the egg. */
function openBreedPicker(petId) {
  const first = getPet(getState(), petId);
  if (!first) return;
  let armed = null;
  let box = null;
  let close = () => {};
  const paint = () => {
    const state = getState();
    const me = getPet(state, petId);
    if (!box || !me) return;
    const bf = bestFriendOf(state, petId);
    const rows = state.pets.filter(p => p.id !== petId && p.status !== 'nursery')
      .map(p => ({ p, pv: breedPreview(state, petId, p.id), best: p.id === bf }))
      .sort((x, y) => (y.best - x.best) || (y.pv.ok - x.pv.ok) || petName(x.p).localeCompare(petName(y.p), 'th'));
    const mine = breedStatus(state, me);
    box.innerHTML = `<div class="breed-head">${petChipHtml(me)}</div>
      <p class="muted cmp-intro">เลือกคู่ให้ <b>${e(petName(me))}</b> · ลูกจะได้หน้าตา นิสัย และสีขนจากพ่อแม่ (บางทีก็กลายพันธุ์!) · จ่ายค่าไข่ครั้งเดียว แล้วพ่อแม่พักฟื้น 3 วัน</p>
      ${mine.ok ? '' : `<p class="breed-note">💞 ${mine.text}</p>`}
      ${rows.length
        ? `<div class="pet-picker-list cmp-list">${rows.map(r => breedRowHtml(r.p, r.pv, { best: r.best, armed: armed === r.p.id })).join('')}</div>`
        : '<p class="muted pet-picker-empty">ยังไม่มีน้องตัวอื่นในลานให้เป็นคู่เลย</p>'}`;
  };
  close = openModal({
    title: '💞 หาคู่',
    html: '<div class="breed-picker"></div>',
    onMount(el) {
      box = el.querySelector('.breed-picker');
      paint();
      el.addEventListener('click', ev => {
        const b = ev.target.closest('.breed-row');
        if (!b || b.disabled) return;
        const pid = b.dataset.petId;
        if (armed !== pid) { armed = pid; paint(); return; }   // first tap: show the price
        const r = run(s => breed(s, petId, pid));
        if (r && r.ok) {
          close();
          if (barn3d && typeof barn3d.breedScene === 'function') { try { barn3d.breedScene(petId, pid); } catch (err) { console.warn('breeding scene skipped', err); } }
        } else { armed = null; paint(); }
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
    <div class="pet-detail-top${pet.shiny ? ' is-shiny' : ''}${limitedOf(pet) ? ' is-limited' : ''}" style="--rar:${RARITIES[sp.rarity].color}">
      <span class="pet-detail-emoji pet-emoji">${sp.emoji}</span>
      ${pet.shiny ? '<span class="pet-sparkle" aria-hidden="true">✨</span>' : ''}
      <div>
        <div class="pet-detail-species">${e(sp.nameTh)} ${rarityBadge(sp)}</div>
        <div class="muted">${hab.emoji} ถิ่น${hab.nameTh}${pet.shiny ? ' · ✨ ไชนี่ (พลัง x1.1)' : ''}</div>
        ${limitedOf(pet) ? `<div class="pet-limited-line">${limitedTag(pet)} ${e(limitedOf(pet).nameTh)} — ${e(limitedOf(pet).desc)}</div>` : ''}
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
    ${familyLineHtml(pet)}
    ${hasFamily(state, pet.id) ? '<div class="pet-detail-family"><button type="button" class="btn btn-sm" data-action="family-tree">👪 ต้นตระกูล</button></div>' : ''}
    ${favDishLineHtml(pet)}
    ${favToyLineHtml(pet)}
    ${lonelyLevel(pet) ? `<div class="b3-station pet-lonely-line">${lonelyTag(pet)} ${lonelyLevel(pet) === 2 ? 'ไม่ได้เล่นด้วยกันนานแล้ว ความสุขลดเร็ว และป่วยง่ายขึ้น' : 'ไม่ได้เล่นด้วยกันมาวันนึงแล้ว'} — กด 🎾 เล่น หรือให้ 🧸 ของเล่น</div>` : ''}
    ${(() => { const b = breedStatus(state, pet); return `<div class="pet-detail-breed"><button type="button" class="btn btn-sm${b.ok ? ' btn-primary' : ''}" data-action="breed"${b.ok ? '' : ' disabled'}>💞 หาคู่</button> <small class="muted">${b.text}</small></div>`; })()}
    <h4 class="pet-detail-h">ตั้งชื่อ</h4>
    <div class="pet-rename">
      <input type="text" class="pet-rename-input" maxlength="16" value="${e(petName(pet))}" aria-label="ชื่อน้อง">
      <button type="button" class="btn btn-sm btn-primary" data-action="rename-save">บันทึก</button>
    </div>
    <div class="pet-release"${limitedOf(pet) ? ' hidden' : ''}>
      <button type="button" class="btn btn-sm btn-ghost pet-release-btn" data-action="release-ask"${busy ? ' disabled title="น้องกำลังทำงานอยู่"' : ''}>💌 ส่งไปบ้านใหม่ 🏡</button>
      <div class="pet-release-confirm" hidden>
        <p>ส่ง <b>${e(petName(pet))}</b> ไปบ้านใหม่จริงๆ หรือ? จะไม่สามารถเอากลับมาได้ (ได้ ${RELEASE_COINS} 🪙 + ผงดาว ${rehomeDust(pet)} ✨) ของขวัญที่น้องถืออยู่จะถูกเก็บให้ก่อน และน้องอาจส่งโปสการ์ดมาหา 💌</p>
        ${stationStatus(state, pet) ? `<p class="pet-release-station">📌 ${stationStatus(state, pet).label} อยู่ — ส่งไปแล้วแปลงนี้จะว่าง</p>` : ''}
        <button type="button" class="btn btn-sm pet-release-yes" data-action="release-yes">ยืนยันส่งไปบ้านใหม่</button>
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
        'family-tree': () => openFamilyTree(petId),
        gift: () => {
          const r = run(s => claimGift(s, petId));
          if (r && r.ok) close();
        },
        breed: () => { close(); openBreedPicker(petId); },
        'rename-save': save,
        'release-ask': () => { confirmBox.hidden = false; askBtn.hidden = true; },
        'release-no': () => { confirmBox.hidden = true; askBtn.hidden = false; },
        'release-yes': () => {
          const r = run(s => rehomePet(s, petId));
          if (r && r.ok) close();
        },
      });
    },
  });
}

function openHatchReveal(pet, toNursery = false) {
  const sp = getSpecies(pet.speciesId);
  if (!sp) return;
  const pers = persOf(pet);
  openModal({
    title: pet.shiny ? '✨ ฟักสำเร็จ! ร่างไชนี่!' : '🐣 ฟักสำเร็จ!',
    html: `<div class="pet-reveal${pet.shiny ? ' is-shiny' : ''}" style="--rar:${RARITIES[sp.rarity].color}">
      <div class="pet-reveal-emoji pet-emoji">${sp.emoji}</div>
      <h3>${e(petName(pet))}</h3>
      <p>${e(sp.nameTh)} ${rarityBadge(sp)}</p>
      ${pet.family ? `<p class="pet-reveal-family">💞 ลูกของ ${e(pet.family.a.name)} กับ ${e(pet.family.b.name)} · รุ่นที่ ${Number(pet.family.gen) || 1} ${coatChipHtml(coatOf(pet))}</p>` : ''}
      <p class="muted">นิสัย ${pers.emoji} ${pers.nameTh} · ${e(sp.desc)}</p>
      ${toNursery ? '<p class="nursery-note">👶 ลานเต็ม น้องเลยพักอยู่ในเปลอนุบาล — รับเข้าลานได้เมื่อมีที่ว่าง หรือสลับกับน้องในลานก็ได้</p>' : ''}</div>`,
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
    play: withPet(id => openPlayModal(id)),
    bath: withPet(id => run(s => cleanPet(s, id))),
    toy: withPet(id => run(s => giveToy(s, id))),
    heal: withPet(id => run(s => healPet(s, id))),
    sleep: withPet(id => run(s => toggleSleep(s, id))),
    poop: withPet(id => run(s => pickPoop(s, id))),
    details: withPet(id => openDetails(id)),
    wear: withPet(id => openWearModal(id)),
    breed: withPet(id => openBreedPicker(id)),
    'put-family-egg': btn => { run(s => putFamilyEggInIncubator(s, btn.dataset.eggId)); },
    gift: withPet(id => run(s => claimGift(s, id))),
    'put-egg': () => openEggPicker(),
    hatch: btn => {
      const r = run(s => hatchReady(s, Number(btn.dataset.slot)));
      if (r && r.ok && r.pet) openHatchReveal(r.pet, !!r.nursery);
      else if (r && !r.ok && /เปลเต็ม/.test(r.reason || '')) openRehomePicker();   // yard and nursery both full: who moves on?
    },
    'yard-collect': () => { run(s => collectYard(s)); },
    'pet-gift': withPet(id => { run(s => collectPetGift(s, id)); }),
    'nursery-adopt': withPet(id => { run(s => adoptFromNursery(s, id)); }),
    'nursery-swap': withPet(id => openSwapPicker(id)),
    'nursery-rehome': withPet(id => confirmRehome(id)),
    'open-mail': () => openMailbox(),
    'open-festival': () => openFestival(),
    'open-journal': () => openJournal(),
    'open-kitchen': () => openKitchen(),
    'open-album': () => { openAlbum(); },
    'greet-next': () => {
      if (!listGreet) return;
      if (listGreet.i >= listGreet.lines.length - 1) listGreet = null; else listGreet.i++;
      rerenderBarn();
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
/** V17 👪 ต้นตระกูล: grandparents -> parents -> the pet (+ siblings) -> children. Pets that moved away show faded with 🏡. */
function familyCardHtml(ref, opts = {}) {
  const p = ref.pet || null;
  const sp = getSpecies(p ? p.speciesId : ref.speciesId);
  const name = p ? petName(p) : ref.name;
  const coat = p ? coatOf(p) : 'base';
  return `<div class="fam-card${p ? '' : ' is-gone'}${opts.me ? ' is-me' : ''}" title="${p ? '' : 'ไปบ้านใหม่แล้ว'}">
      <span class="fam-emoji" aria-hidden="true">${sp ? sp.emoji : '❓'}</span>
      <b>${e(name)}</b><small class="muted">${sp ? e(sp.nameTh) : ''}${p ? '' : ' · 🏡'}</small>
      ${p && coat !== 'base' ? coatChipHtml(coat) : ''}${p && p.shiny ? '<small>✨</small>' : ''}</div>`;
}

function familyTreeHtml(t) {
  const row = (title, cards) => (cards.length ? `<div class="fam-row"><div class="fam-label">${title}</div><div class="fam-cards">${cards.join('')}</div></div>` : '');
  const grand = t.grand.flat();
  return `<div class="fam-tree">
    ${row('👴👵 ปู่ย่าตายาย', grand.map(g => familyCardHtml(g)))}
    ${row('👪 พ่อแม่', t.parents.map(p => familyCardHtml(p)))}
    ${row(`🐣 น้อง${t.gen ? ` · รุ่นที่ ${t.gen}` : ''}`, [familyCardHtml({ pet: t.pet }, { me: true }), ...t.siblings.map(s => familyCardHtml({ pet: s }))])}
    ${row('🍼 ลูกๆ', t.children.map(c => familyCardHtml({ pet: c })))}
    ${!t.parents.length ? '<p class="muted">น้องตัวนี้ฟักจากไข่ทั่วไป เป็นรุ่นแรกของครอบครัว</p>' : ''}
  </div>`;
}

function openFamilyTree(petId) {
  const t = familyTree(getState(), petId);
  if (!t) return;
  openModal({ title: `👪 ต้นตระกูลของ ${petName(t.pet)}`, html: familyTreeHtml(t) });
}

/** V17 สมุดสีขน: the six coats of a species, the seen ones in colour. */
/** "n/N": coats seen over (species owned x coats). */
function coatBookCount(state) {
  const book = state.coatBook || {};
  const owned = SPECIES.filter(sp => state.collection[sp.id]);
  const n = owned.reduce((t, sp) => t + COATS.filter(c => (book[sp.id] || {})[c.id]).length, 0);
  return `${n}/${owned.length * COATS.length}`;
}

function speciesCoatsHtml(book) {
  const seen = book || {};
  const n = COATS.filter(c => seen[c.id]).length;
  return `<h4 class="pet-detail-h">🎨 สีขนที่เคยได้ (${n}/${COATS.length})</h4>
    <div class="sp-coats">${COATS.map(c => seen[c.id]
      ? `<span class="sp-coat-chip">${c.emoji} ${e(c.nameTh)}</span>`
      : '<span class="sp-coat-chip is-unknown" title="ยังไม่เคยได้ — ลองผสมพันธุ์ดูสิ">❔ ???</span>').join('')}</div>`;
}

function speciesInfoHtml(sp, entry, book) {
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
    <div class="pet-detail-diet">${dietChips(sp)} <span class="pet-fav">⭐ ของโปรด: ${favoriteLabel(sp)}</span></div>
    ${speciesCoatsHtml(book)}</div>`;
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
    <p class="muted book-shop-hint">ส่งน้องไปบ้านใหม่ 💌 เพื่อรับผงดาว (ยิ่งหายากยิ่งได้เยอะ) แล้วนำมาแลกของที่นี่</p>
    <div class="book-shop-row">
      <button type="button" class="btn btn-sm btn-primary" data-action="make-shiny"${canShiny ? '' : ' disabled'}>🌈 เปลี่ยนน้องเป็นร่างไชนี่ <small>100 ✨</small></button>
    </div>
    <div class="book-shop-eggs">${eggs}</div></section>`;
}

/** 🎨 coat collection: one chip per coat; the ones not seen yet are greyed out. */
function coatBookHtml(state) {
  const seen = state.coatsSeen || { base: true };
  const have = COATS.filter(c => seen[c.id]).length;
  return `<div class="coat-book"><div class="book-group-head"><h3>🎨 สีขน</h3><span class="muted">${have}/${COATS.length}</span></div>
    <div class="coat-chips">${COATS.map(c => seen[c.id]
      ? coatChipHtml(c.id)
      : `<span class="coat-chip is-unseen" title="ยังไม่เคยเจอ">❔ ???</span>`).join('')}</div>
    <small class="muted">ได้สีใหม่จากลูกๆ ของคู่รัก — ดูได้ที่ 💞 หาคู่</small></div>`;
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
      <p>สะสมแล้ว <b>${have}</b> / ${total} สายพันธุ์ (${pct}%) · ✨ ไชนี่ ${shinyN} ชนิด · 🎨 สีขน ${coatBookCount(state)}${readyN ? ` · 🎁 รับรางวัลได้ ${readyN} ข้อ` : ''}</p>
      <div class="book-bar"><div class="book-bar-fill" style="width:${pct}%"></div></div>
      ${coatBookHtml(state)}
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
      openModal({ title: `${sp.emoji} ${sp.nameTh}`, html: speciesInfoHtml(sp, entry, (getState().coatBook || {})[sp.id]) });
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
  { id: 'barn', icon: '🏡', label: 'ลาน', render: renderBarn, bind: bindBarn },
  { id: 'book', icon: '📖', label: 'สมุดสัตว์', render: renderBook, bind: bindBook },
];

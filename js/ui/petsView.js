// Pet views: 🏠 barn (incubator + pets + care) and 📖 book (collection).
// render() is pure string-building; all events go through delegated data-action handlers.

import { notify, escapeHtml, openModal, now, formatDuration, clamp } from '../util.js';
import { update, getState, countItem } from '../state.js';
import { getItem } from '../data/items.js';
import { EGGS, getEgg } from '../data/eggs.js';
import { SPECIES, HABITATS, RARITIES, JOBS, getSpecies } from '../data/species.js';
import {
  STAGES, PERSONALITIES, petEmoji, petName, petMood, getPet,
  putEggInIncubator, hatchReady, feedPet, playWithPet, cleanPet, pickPoop,
  giveToy, healPet, toggleSleep, renamePet, releasePet, foodEffect,
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
function actionBtn(action, petId, label, disabledReason) {
  return `<button type="button" class="btn btn-sm btn-ghost pet-act" data-action="${action}" data-pet-id="${e(petId)}"` +
    `${disabledReason ? ` disabled title="${e(disabledReason)}"` : ''}>${label}</button>`;
}

function renderPetCard(pet, state) {
  const sp = getSpecies(pet.speciesId);
  const rarColor = sp ? RARITIES[sp.rarity].color : '#8e9aa6';
  const st = stageOf(pet);
  const mood = petMood(pet);
  const away = pet.status === 'expedition';
  const sleeping = pet.status === 'sleeping';
  const working = pet.status === 'working';
  const notIdle = pet.status !== 'idle';

  const careBlock = away ? 'ออกสำรวจอยู่' : sleeping ? 'หลับอยู่ ปลุกก่อนนะ' : '';
  const playBlock = away ? 'ออกสำรวจอยู่' : sleeping ? 'หลับอยู่' : working ? 'กำลังทำงาน' : pet.sick ? 'ป่วยอยู่' : '';
  const sleepBlock = working ? 'กำลังทำงาน' : away ? 'ออกสำรวจอยู่' : '';

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
    </div>
    <div class="pet-status">${statusLabel(pet, state)}</div>
    <div class="pet-stats">
      ${statBar('🍖', 'อิ่ม', pet.stats.hunger)}
      ${statBar('💖', 'สุข', pet.stats.happy)}
      ${statBar('⚡', 'พลัง', pet.stats.energy)}
      ${statBar('🫧', 'สะอาด', pet.stats.clean)}
    </div>
    <div class="pet-actions">
      ${actionBtn('feed', pet.id, '🍖 ให้อาหาร', careBlock)}
      ${actionBtn('play', pet.id, '🎾 เล่น', playBlock)}
      ${actionBtn('bath', pet.id, '🛁 อาบน้ำ', careBlock)}
      ${actionBtn('toy', pet.id, '🧸 ของเล่น', playBlock)}
      ${pet.sick ? actionBtn('heal', pet.id, '💊 รักษา', '') : ''}
      ${actionBtn('sleep', pet.id, sleeping ? '☀️ ตื่น' : '💤 นอน', sleepBlock)}
      ${actionBtn('details', pet.id, '📋 รายละเอียด', '')}
    </div>
  </article>`;
}

function renderBarn(state) {
  const t = now();
  const pets = state.pets;
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
        <span class="badge barn-cap">${pets.length}/${state.barnCapacity}</span></div>
      ${pets.length ? `<div class="barn-grid">${pets.map(p => renderPetCard(p, state)).join('')}</div>` : empty}
    </section></div>`;
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
  const rows = Object.entries(state.inventory)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ item: getItem(id), n }))
    .filter(r => r.item && r.item.food)
    .map(r => {
      const fx = foodEffect(pet, r.item);
      return { ...r, fx, rank: fx.favorite ? 0 : fx.match ? 1 : 2 };
    })
    .sort((a, b) => a.rank - b.rank || a.item.nameTh.localeCompare(b.item.nameTh, 'th'));

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
    'put-egg': () => openEggPicker(),
    hatch: btn => {
      const r = run(s => hatchReady(s, Number(btn.dataset.slot)));
      if (r && r.ok && r.pet) openHatchReveal(r.pet);
    },
  });
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

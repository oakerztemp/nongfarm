// Farm-side views: farm (ไร่), explore (สำรวจ), shop (ร้าน), bag (กระเป๋า).
// Each view = { id, icon, label, render(state) -> HTML, bind(rootEl) } (see CONTRACT §4).
// Events use delegation on rootEl via data-action attributes; no inline handlers.
import { now, notify, escapeHtml, formatDuration, openModal } from '../util.js';
import { update, getState, emit } from '../state.js';
import { canWork, getWorkPower, getPet } from '../pets.js';
import { petChipHtml } from './petsView.js';
import { JOBS } from '../data/species.js';
import { CROPS, getCrop } from '../data/crops.js';
import { ITEMS, getItem, YARD_MATERIALS } from '../data/items.js';
import { DECOR } from '../data/decor.js';
import { ACCESSORIES } from '../data/accessories.js';
import { getEgg } from '../data/eggs.js';
import {
  ZONES, getZone, MAX_PLOTS, MAX_BARN,
  plantSeed, waterPlot, fertilize, assignPet, unassignPet, harvestPlot, harvestAll, replantPlot, completeOrder,
  incubatorUpgradePrice, upgradeIncubator, MAX_INCUBATOR, nextMidnight,
  startExpedition, claimExpedition, buyItem, sellItem,
  plotPrice, buyPlot, upgradeBarn, barnUpgradeStatus, sortPetsForSlot,
  buildDecor, placeDecor, decorBuildStatus, decorSpotList, buyAccessory, accessoryOwned,
  plotSpeed, plotEtaMs, effectivePower, plotTeam, slotPowerPreview, slotJobs, TEAM_COMBO, plotBonusPreview,
  stationPet, unstationPet, stationInfo, stationLabel, MAX_STATIONS, yardUpgradePreview,
} from '../farm.js';

const esc = escapeHtml;
const READY_EPS = 1e-9;

// ---------------------------------------------------------------- shared helpers

// Run a logic function against the live state, toast the result, return it.
function run(fn) {
  const r = update(fn) || { ok: false, reason: 'เกิดข้อผิดพลาด' };
  const text = r.ok ? r.msg : r.reason;
  if (text) notify(text, r.ok ? 'success' : 'warn');
  return r;
}

// One click listener per view root; dispatches on the nearest [data-action].
function delegate(rootEl, handlers) {
  rootEl.addEventListener('click', ev => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!el || !rootEl.contains(el) || el.disabled) return;
    const fn = handlers[el.dataset.action];
    if (fn) fn(el.dataset, el);
  });
}

const coinsOf = state => Math.floor(Number(state.player && state.player.coins) || 0);
const levelOf = state => Number(state.player && state.player.level) || 1;
const invOf = (state, id) => Number(state.inventory && state.inventory[id]) || 0;
const clamp01 = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const num = n => Number(n).toLocaleString('th-TH');

function jobsHtml(jobs) {
  return (jobs || []).map(j => {
    const info = JOBS && JOBS[j];
    return `<span class="farm-job" title="${esc(info ? info.nameTh : j)}">${info ? info.emoji : '🔧'} ${esc(info ? info.nameTh : j)}</span>`;
  }).join('');
}

const jobEmoji = j => (JOBS && JOBS[j] ? JOBS[j].emoji : '🔧');
const jobName = j => (JOBS && JOBS[j] ? JOBS[j].nameTh : j);
const PET_PCT = 0.3; // pet crop-speed share per effective power (same constant as farm.js)

// Team slots of a growing plot: one row per slot = job emoji + pet chip (with its speed share and a
// recall button) or a "+" button that opens the picker for that slot.
function slotsHtml(team, plotIndex, ready) {
  const multi = team.slots.length > 1;
  const rows = team.slots.map(sl => {
    const emoji = multi ? jobEmoji(sl.job) : team.crop.jobs.map(jobEmoji).join('');
    const title = multi ? `ช่อง ${sl.slot + 1}: ${esc(jobName(sl.job))}` : 'ช่องคนช่วย';
    const pinned = !!(sl.station && sl.pet && sl.station.pet.id === sl.pet.id);
    if (sl.pet) {
      const pct = Math.round(PET_PCT * sl.power * (team.full && multi ? TEAM_COMBO : 1) * 100);
      const pin = pinned ? '<span class="plot-slot-pin" title="ประจำแปลง">📌</span>' : '';
      const xLabel = pinned ? 'เลิกประจำแปลง' : 'เรียกกลับ';
      return `<div class="plot-slot is-filled${pinned ? ' is-pinned' : ''}" title="${title}"><span class="plot-slot-job">${emoji}</span>${pin}${petChipHtml(sl.pet)}<span class="plot-slot-pow">+${pct}%</span><button type="button" class="plot-slot-x" data-action="unassign" data-plot="${plotIndex}" data-slot="${sl.slot}" aria-label="${xLabel}" title="${xLabel}">✕</button></div>`;
    }
    if (sl.station) return restingRow(sl.station, plotIndex, sl.slot, emoji, title);
    if (ready) return '';
    return `<button type="button" class="plot-slot is-empty" data-action="helper" data-plot="${plotIndex}" data-slot="${sl.slot}" title="${title}"><span class="plot-slot-job">${emoji}</span> ＋ ส่งน้อง</button>`;
  }).join('');
  const combo = team.full && multi ? `<span class="badge plot-combo">🤝 คอมโบ! x${TEAM_COMBO}</span>` : '';
  return `<div class="plot-slots">${rows}${combo}</div>`;
}

// A stationed (📌) pet that is not working right now: dimmed chip + why (พัก / หิว / ป่วย / รอที่ลาน).
function restingRow(info, plotIndex, slot, emoji, title) {
  return `<div class="plot-slot is-filled is-resting" title="${title}"><span class="plot-slot-job">${emoji}</span><span class="plot-slot-pin" title="ประจำแปลง">📌</span>${petChipHtml(info.pet)}<span class="plot-slot-state">${info.emoji} ${esc(info.text)}</span><button type="button" class="plot-slot-x" data-action="unstation" data-plot="${plotIndex}" data-slot="${slot}" aria-label="เลิกประจำแปลง" title="เลิกประจำแปลง">✕</button></div>`;
}

// Empty plot: stationed pets wait at the yard (รอที่ลาน) until something is planted again.
function stationWaitHtml(state, plotIndex) {
  const rows = [];
  for (let slot = 0; slot < MAX_STATIONS; slot++) {
    const info = stationInfo(state, plotIndex, slot);
    if (info) rows.push(restingRow(info, plotIndex, slot, '📌', `ประจำแปลง #${plotIndex + 1}`));
  }
  return rows.length ? `<div class="plot-slots plot-slots-wait">${rows.join('')}</div>` : '';
}

// Pet picker sorted by power for the job (best first, ties -> more hearts). `power(pet)` is the raw work power there.
function openPowerPicker({ title, pets, power, describe, onPick }) {
  const sorted = sortPetsForSlot(pets, power);
  const list = sorted.map((pet, i) => `<button type="button" class="pet-picker-item${i === 0 && sorted.length > 1 ? ' is-best' : ''}" data-pet-id="${esc(pet.id)}">${petChipHtml(pet)}<span class="pet-picker-desc">${describe(pet)}</span></button>`).join('');
  let close = () => {};
  close = openModal({
    title,
    html: `<div class="pet-picker-list">${list}</div>`,
    onMount(el) {
      el.addEventListener('click', ev => {
        const b = ev.target && ev.target.closest ? ev.target.closest('.pet-picker-item') : null;
        if (!b) return;
        close();
        onPick(b.dataset.petId);
      });
    },
  });
  return close;
}

function powerNote(pet, jobs, label, ctx) {
  const p = Number(getWorkPower(pet, jobs, ctx)) || 0;
  return `<span class="farm-power">พลัง ${p.toFixed(1)}${label ? ' · ' + label(effectivePower(p)) : ''}</span>`;
}

function itemLine(id, n) {
  const it = getItem(id);
  return it ? `<span class="farm-reward">${it.emoji} ${esc(it.nameTh)} <b>x${n}</b></span>` : '';
}

function petCanWork(pet) {
  try { return !!canWork(pet).ok; } catch (e) { return false; }
}

// ================================================================ FARM VIEW

function plotCard(state, plot, i, fertCount) {
  const crop = getCrop(plot && plot.cropId);
  if (!crop) {
    const last = getCrop(plot && plot.lastCropId);
    const again = last
      ? `<button class="btn btn-primary btn-sm" data-action="replant" data-plot="${i}" title="ปลูก${esc(last.nameTh)}ซ้ำ">🔁 ปลูกซ้ำ ${last.emoji}</button>`
      : '';
    return `<div class="plot-card plot-empty">
      <div class="plot-head"><span class="plot-num">#${i + 1}</span></div>
      <div class="plot-soil"><div class="plot-plant plot-plant-empty">🟫</div></div>
      <div class="plot-body"><span class="muted">แปลงว่าง</span></div>
      ${stationWaitHtml(state, i)}
      <div class="plot-actions">${again}<button class="btn ${last ? '' : 'btn-primary '}btn-sm" data-action="plant" data-plot="${i}">🌱 ${last ? 'เลือกพืช' : 'ปลูก'}</button></div>
    </div>`;
  }

  const progress = clamp01(Number(plot.progress));
  const ready = progress >= 1 - READY_EPS;
  const pct = Math.floor(progress * 100);
  const team = plotTeam(state, plot);
  const speed = team ? team.speed : plotSpeed(state, plot);
  const t = now();
  const eta = plotEtaMs(state, plot);
  const startMs = Math.round(t - (progress * crop.growMs) / speed);
  const endMs = Math.round(t + eta);
  const glyph = progress < 0.2 ? '🌱' : crop.emoji;

  const bar = ready
    ? `<div class="bar plot-bar"><div class="bar-fill" style="width:100%"></div></div>`
    : `<div class="bar plot-bar"><div class="bar-fill" style="width:${pct}%" data-progress-start="${startMs}" data-progress-end="${endMs}"></div></div>`;
  const bonusPreview = ready ? 0 : plotBonusPreview(state, plot);
  const status = ready
    ? `<b class="plot-ready-text">พร้อมเก็บเกี่ยว!</b>${Number(plot.helperBonus) > 0 ? ` <span class="muted">น้องช่วย +${Number(plot.helperBonus)}</span>` : ''}`
    : `<span>${pct}% · เหลือ <span data-countdown="${endMs}">${formatDuration(eta)}</span></span>${bonusPreview > 0 ? ` <span class="muted">· น้องช่วย +${bonusPreview}</span>` : ''}`;

  const slotsRow = team && team.slots.some(sl => sl.pet || sl.station || !ready) ? slotsHtml(team, i, ready) : '';

  let actions = '';
  if (ready) {
    actions += `<button class="btn btn-primary btn-sm" data-action="harvest" data-plot="${i}">🧺 เก็บเกี่ยว</button>`;
  } else {
    actions += plot.watered
      ? `<span class="badge plot-watered">💧 รดน้ำแล้ว</span>`
      : `<button class="btn btn-sm" data-action="water" data-plot="${i}">💧 รดน้ำ</button>`;
    if (plot.fertilized) {
      actions += `<span class="badge plot-watered">🧪 ใส่ปุ๋ยแล้ว</span>`;
    } else if (fertCount > 0 && progress < 0.95) {
      actions += `<button class="btn btn-sm" data-action="fertilize" data-plot="${i}">🧪 ปุ๋ย (${fertCount})</button>`;
    }
  }

  return `<div class="plot-card ${ready ? 'is-ready' : 'is-growing'}${plot.watered && !ready ? ' is-watered' : ''}">
    <div class="plot-head">
      <span class="plot-num">#${i + 1}</span>
      ${ready ? '' : `<span class="plot-speed" title="ความเร็วการเติบโต">⚡ x${speed.toFixed(2)}</span>`}
    </div>
    <div class="plot-soil">
      <div class="plot-plant${ready ? ' is-ready' : ''}" style="--p:${progress.toFixed(3)}">${glyph}</div>
      ${plot.watered && !ready ? '<span class="plot-drop">💧</span>' : ''}
    </div>
    <div class="plot-body">
      <div class="plot-title">${crop.emoji} ${esc(crop.nameTh)}</div>
      ${bar}
      <div class="plot-status muted">${status}</div>
      ${crop.slots > 1 ? '' : `<div class="plot-jobs">${jobsHtml(crop.jobs)}</div>`}
    </div>
    ${slotsRow}
    <div class="plot-actions">${actions}</div>
  </div>`;
}

// ---- orders board (below the plots, collapsible; open state is a per-device preference)

const ORDERS_OPEN_KEY = 'nongfarm_orders_open';
let ordersOpen = true;
try { ordersOpen = localStorage.getItem(ORDERS_OPEN_KEY) !== '0'; } catch { /* storage blocked: stay open */ }

function toggleOrders() {
  ordersOpen = !ordersOpen;
  try { localStorage.setItem(ORDERS_OPEN_KEY, ordersOpen ? '1' : '0'); } catch { /* ignore */ }
  emit('change');
}

function orderCard(state, o, weekly) {
  const lines = Object.entries(o.items || {}).map(([id, n]) => {
    const it = getItem(id);
    const have = invOf(state, id);
    return `<span class="order-line${have >= n ? ' is-ok' : ''}">${it ? it.emoji : '❓'} ${esc(it ? it.nameTh : id)} <b>${Math.min(have, n)}/${n}</b></span>`;
  }).join('');
  const r = o.reward || {};
  const gifts = Object.entries(r.items || {}).map(([id, n]) => {
    const it = getItem(id);
    return it ? ` · ${it.emoji} ${esc(it.nameTh)} x${n}` : '';
  }).join('');
  const can = !o.done && Object.entries(o.items || {}).every(([id, n]) => invOf(state, id) >= n);
  const btn = o.done
    ? '<span class="badge order-done">✅ ส่งแล้ว</span>'
    : `<button class="btn ${can ? 'btn-primary ' : ''}btn-sm" data-action="order-done" data-order="${esc(o.id)}" ${can ? '' : 'disabled'}>ส่งของ</button>`;
  return `<div class="order-card${weekly ? ' is-weekly' : ''}${o.done ? ' is-done' : ''}">
    <div class="order-lines">${lines}</div>
    <div class="order-foot"><span class="order-reward">🪙 ${num(r.coins || 0)} · ⭐ ${num(r.xp || 0)} XP${gifts}</span>${btn}</div>
  </div>`;
}

function ordersHtml(state) {
  const o = state.orders;
  if (!o || !Array.isArray(o.list) || !o.list.length) return '';
  const reset = nextMidnight(now());
  const all = o.weekly ? [...o.list, o.weekly] : o.list;
  const open = all.filter(x => x && !x.done);
  const ready = open.filter(x => Object.entries(x.items || {}).every(([id, n]) => invOf(state, id) >= n)).length;
  const summary = ready > 0
    ? `<span class="badge order-ready">ส่งได้ ${ready}</span>`
    : `<span class="muted farm-small">เหลือ ${open.length} ใบ</span>`;
  const weekly = o.weekly ? `<div class="order-sub">🏆 ออเดอร์ประจำสัปดาห์ <span class="muted farm-small">รางวัลใหญ่ + ไข่พิเศษ</span></div>${orderCard(state, o.weekly, true)}` : '';
  const body = ordersOpen
    ? `<div class="order-list">${o.list.map(x => orderCard(state, x, false)).join('')}</div>${weekly}`
    : '';
  return `<div class="order-board card">
    <button type="button" class="order-head" data-action="toggle-orders" aria-expanded="${ordersOpen}">
      <b>📋 ออเดอร์วันนี้</b> ${summary}
      <span class="muted farm-small order-reset">รีเซ็ตใน <span data-countdown="${reset}">${formatDuration(reset - now())}</span> ${ordersOpen ? '▲' : '▼'}</span>
    </button>
    ${body}
  </div>`;
}

function farmRender(state) {
  const plots = Array.isArray(state.plots) ? state.plots : [];
  const fert = invOf(state, 'care_fertilizer');
  const price = plotPrice(state);
  const readyCount = plots.filter(p => p && p.cropId && clamp01(Number(p.progress)) >= 1 - READY_EPS).length;
  const replantable = plots.filter(p => p && !p.cropId && getCrop(p.lastCropId)).length;

  const buyCard = price == null
    ? ''
    : `<div class="plot-card plot-buy">
        <div class="plot-soil"><div class="plot-plant plot-plant-empty">➕</div></div>
        <div class="plot-body"><div class="plot-title">แปลงใหม่</div>
          <div class="muted">${plots.length}/${MAX_PLOTS} แปลง</div></div>
        <div class="plot-actions"><button class="btn btn-primary btn-sm" data-action="buy-plot" ${coinsOf(state) < price ? 'disabled' : ''}>🪙 ${num(price)}</button></div>
      </div>`;

  return `<section class="farm-wrap">
    <div class="farm-help card">
      <b>💡 เคล็ดลับ</b> ส่งน้องที่ถนัดงานตรงกับพืชไปช่วย พืชจะโตไวขึ้น!
      <span class="muted">รดน้ำ +20% · น้องช่วย +30% × พลัง · ปุ๋ย +25% (ครั้งเดียวต่อรอบ) · พืชหลายช่อง ส่งน้องครบทุกช่อง = คอมโบ x1.25</span>
    </div>
    <div class="farm-toolbar">
      <span class="muted">🪙 ${num(coinsOf(state))}${fert > 0 ? ` · 🧪 ปุ๋ย ${fert}` : ''}</span>
      <span class="farm-toolbar-btns">
        ${readyCount > 0 ? `<button class="btn btn-primary btn-sm" data-action="harvest-all">🧺 เก็บเกี่ยวทั้งหมด (${readyCount})</button>` : ''}
        ${readyCount > 0 ? `<button class="btn btn-sm" data-action="harvest-replant">🧺🔁 เก็บแล้วปลูกซ้ำ</button>` : ''}
        ${replantable > 1 ? `<button class="btn btn-sm" data-action="replant-all">🔁 ปลูกซ้ำทุกแปลงว่าง (${replantable})</button>` : ''}
      </span>
    </div>
    <div class="farm-grid">${plots.map((p, i) => plotCard(state, p, i, fert)).join('')}${buyCard}</div>
    ${ordersHtml(state)}
  </section>`;
}

// ---- seed picker modal

function seedPickerHtml(state, plotIndex) {
  const lvl = levelOf(state);
  const coins = coinsOf(state);
  const rows = CROPS.map(c => {
    const locked = lvl < c.unlockLevel;
    const owned = invOf(state, 'seed_' + c.id);
    const price = c.seedPrice;
    const afford = coins >= price;
    let btns;
    if (locked) {
      btns = `<span class="badge">🔒 Lv.${c.unlockLevel}</span>`;
    } else if (owned > 0) {
      btns = `<button class="btn btn-primary btn-sm" data-action="seed-plant" data-crop="${esc(c.id)}">ปลูก</button>
        <button class="btn btn-ghost btn-sm" data-action="seed-buy" data-crop="${esc(c.id)}" ${afford ? '' : 'disabled'}>+ซื้อ 🪙${num(price)}</button>`;
    } else {
      btns = `<button class="btn btn-primary btn-sm" data-action="seed-buyplant" data-crop="${esc(c.id)}" ${afford ? '' : 'disabled'}>ซื้อ+ปลูก 🪙${num(price)}</button>`;
    }
    return `<div class="farm-seed${locked ? ' is-locked' : ''}">
      <span class="farm-seed-emoji">${c.emoji}</span>
      <div class="farm-seed-info">
        <div><b>${esc(c.nameTh)}</b> ${locked ? '' : `<span class="muted">มีเมล็ด ${owned}</span>`}</div>
        <div class="muted farm-small">⏱️ ${formatDuration(c.growMs)} · ผลผลิต ${c.yield[0]}–${c.yield[1]} · ขาย ${num(c.sellPrice)}🪙</div>
        <div class="farm-small">${jobsHtml(c.jobs)}</div>
      </div>
      <div class="farm-seed-actions">${btns}</div>
    </div>`;
  }).join('');
  return `<div class="farm-seedlist" data-plot="${plotIndex}"><div class="muted farm-small">🪙 ${num(coins)}</div>${rows}</div>`;
}

function openSeedPicker(plotIndex) {
  let close = null;
  const body = () => seedPickerHtml(getState(), plotIndex);
  close = openModal({
    title: `🌱 เลือกพืชที่จะปลูก (แปลง #${plotIndex + 1})`,
    html: body(),
    onMount(el) {
      el.addEventListener('click', ev => {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
        if (!b || b.disabled || !el.contains(b)) return;
        const cropId = b.dataset.crop;
        const act = b.dataset.action;
        if (act === 'seed-plant') {
          const r = run(s => plantSeed(s, plotIndex, cropId));
          if (r.ok && close) close(); else el.innerHTML = body();
        } else if (act === 'seed-buy') {
          run(s => buyItem(s, 'seed_' + cropId, 1));
          el.innerHTML = body();
        } else if (act === 'seed-buyplant') {
          const r = run(s => {
            const bought = buyItem(s, 'seed_' + cropId, 1);
            return bought.ok ? plantSeed(s, plotIndex, cropId) : bought;
          });
          if (r.ok && close) close(); else el.innerHTML = body();
        }
      });
    },
  });
}

const STATION_PREF_KEY = 'nongfarm_station_default';
function stationDefault() {
  try { return localStorage.getItem(STATION_PREF_KEY) !== '0'; } catch { return true; }   // default: pinned
}
function setStationDefault(on) {
  try { localStorage.setItem(STATION_PREF_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}

/** Send a helper; with `pin` also station it (replacing a resting pet that was pinned to that slot). */
function sendHelper(s, plotIndex, slot, petId, pin) {
  const r = assignPet(s, plotIndex, petId, slot);
  if (!r.ok || !pin) return r;
  const plot = s.plots[plotIndex];
  const holder = plot && Array.isArray(plot.stations) ? plot.stations[slot] : null;
  if (holder && holder !== petId) unstationPet(s, plotIndex, slot);
  const pr = stationPet(s, plotIndex, slot, petId);
  return { ok: true, msg: pr.ok ? `${r.msg} 📌 ประจำแปลงแล้ว` : `${r.msg} (${pr.reason})` };
}

function confirmModal(title, text, yesLabel, onYes) {
  let close = () => {};
  close = openModal({
    title,
    html: `<p>${esc(text)}</p><div class="farm-confirm-btns"><button type="button" class="btn" data-confirm="no">ไว้ก่อน</button> <button type="button" class="btn btn-primary" data-confirm="yes">${esc(yesLabel)}</button></div>`,
    onMount(el) {
      el.addEventListener('click', ev => {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-confirm]') : null;
        if (!b) return;
        close();
        if (b.dataset.confirm === 'yes') onYes();
      });
    },
  });
}

function pickHelper(plotIndex, slot) {
  const st = getState();
  const plot = st.plots[plotIndex];
  const crop = plot && getCrop(plot.cropId);
  if (!crop) return;
  if (!st.pets.some(petCanWork)) {
    notify('ตอนนี้ไม่มีน้องที่พร้อมทำงาน (ต้องตื่น ไม่ป่วย พลัง ≥ 20 อิ่ม ≥ 15)', 'warn');
    return;
  }
  const jobs = slotJobs(crop, slot);
  const multi = (crop.slots || 1) > 1;
  const pets = sortPetsForSlot(st.pets.filter(petCanWork), pet => slotPowerPreview(st, plotIndex, slot, pet).raw);   // best power for this slot first
  const list = pets.map((pet, i) => {
    const pv = slotPowerPreview(st, plotIndex, slot, pet);
    const where = stationLabel(pet);
    return `<button type="button" class="pet-picker-item${i === 0 && pets.length > 1 ? ' is-best' : ''}" data-pet-id="${esc(pet.id)}">${petChipHtml(pet)}<span class="pet-picker-desc"><span class="farm-power">${jobs.map(jobEmoji).join('')} พลัง ${pv.raw.toFixed(1)} · โต +${Math.round(PET_PCT * pv.eff * 100)}%</span>${where ? ` <span class="badge">📌 ${esc(where)}</span>` : ''}</span></button>`;
  }).join('');
  let close = () => {};
  close = openModal({
    title: `ส่งน้องมาช่วย ${crop.emoji} ${crop.nameTh}${multi ? ` · ช่อง ${slot + 1} ${jobEmoji(jobs[0])} ${jobName(jobs[0])}` : ''}`,
    html: `<label class="station-toggle"><input type="checkbox" class="station-check" ${stationDefault() ? 'checked' : ''}> 📌 ประจำแปลง <span class="muted farm-small">(กลับมาช่วยเองทุกรอบ ไม่ต้องส่งใหม่)</span></label><div class="pet-picker-list">${list}</div>`,
    onMount(el) {
      const check = el.querySelector('.station-check');
      check.addEventListener('change', () => setStationDefault(check.checked));
      el.addEventListener('click', ev => {
        const b = ev.target && ev.target.closest ? ev.target.closest('.pet-picker-item') : null;
        if (!b) return;
        const id = b.dataset.petId;
        const pin = check.checked;
        close();
        run(s => sendHelper(s, plotIndex, slot, id, pin));
      });
    },
  });
}

function farmBind(rootEl) {
  const idx = d => Number(d.plot);
  delegate(rootEl, {
    plant: d => openSeedPicker(idx(d)),
    water: d => run(s => waterPlot(s, idx(d))),
    fertilize: d => run(s => fertilize(s, idx(d))),
    helper: d => pickHelper(idx(d), Number(d.slot) || 0),
    unassign: d => run(s => unassignPet(s, idx(d), d.slot === undefined ? null : Number(d.slot))),
    unstation: d => run(s => unstationPet(s, idx(d), Number(d.slot) || 0)),
    harvest: d => run(s => harvestPlot(s, idx(d))),
    'harvest-all': () => run(s => harvestAll(s, false)),
    'harvest-replant': () => run(s => harvestAll(s, true)),
    replant: d => run(s => replantPlot(s, idx(d))),
    'replant-all': () => run(s => {
      let n = 0;
      s.plots.forEach((p, i) => { if (p && !p.cropId && replantPlot(s, i).ok) n++; });
      return n > 0 ? { ok: true, msg: `🔁 ปลูกซ้ำ ${n} แปลง` } : { ok: false, reason: 'ปลูกซ้ำไม่ได้ (เหรียญหรือเลเวลไม่พอ)' };
    }),
    'order-done': d => run(s => completeOrder(s, d.order)),
    'toggle-orders': () => toggleOrders(),
    'buy-plot': () => run(s => buyPlot(s)),
  });
}

// ================================================================ EXPLORE VIEW

function zoneCard(state, zone) {
  const locked = levelOf(state) < zone.unlockLevel;
  const busy = (state.expeditions || []).filter(e => e && e.zoneId === zone.id && !e.done).length;
  const lootIds = [...new Set(zone.loot.map(l => l.itemId))];
  const lootEmoji = lootIds.map(id => { const it = getItem(id); return it ? `<span title="${esc(it.nameTh)}">${it.emoji}</span>` : ''; }).join('');
  return `<div class="zone-card${locked ? ' is-locked' : ''}">
    <div class="zone-emoji">${zone.emoji}</div>
    <div class="zone-info">
      <div class="zone-title"><b>${esc(zone.nameTh)}</b> ${busy ? `<span class="badge">กำลังสำรวจ ${busy}</span>` : ''}</div>
      <div class="muted farm-small">${esc(zone.desc || '')}</div>
      <div class="farm-small">⏱️ ${formatDuration(zone.durationMs)} · งาน: ${jobsHtml([zone.job])}</div>
      <div class="zone-loot" aria-label="ของที่อาจได้">${lootEmoji}</div>
    </div>
    <div class="zone-action">
      ${locked
        ? `<span class="badge">🔒 Lv.${zone.unlockLevel}</span>`
        : `<button class="btn btn-primary btn-sm" data-action="explore-send" data-zone="${esc(zone.id)}">🐾 ส่งน้องไปสำรวจ</button>`}
    </div>
  </div>`;
}

function runCard(state, ex) {
  const zone = getZone(ex.zoneId);
  const pet = getPet(state, ex.petId);
  const zoneName = zone ? `${zone.emoji} ${esc(zone.nameTh)}` : '🧭 การสำรวจ';
  const chip = pet ? petChipHtml(pet) : '<span class="muted">น้อง</span>';
  if (ex.done) {
    const rewards = ex.rewards || {};
    const lines = Object.entries(rewards).map(([id, n]) => itemLine(id, n)).join('') || '<span class="muted">ไม่ได้อะไรเลย</span>';
    return `<div class="zone-run is-done">
      <div class="zone-run-head"><b>${zoneName}</b> ${chip}</div>
      <div class="zone-rewards">${lines}</div>
      <button class="btn btn-primary btn-sm" data-action="claim" data-exp="${esc(ex.id)}">🎁 รับของ</button>
    </div>`;
  }
  const left = Math.max(0, ex.endAt - now());
  return `<div class="zone-run">
    <div class="zone-run-head"><b>${zoneName}</b> ${chip}</div>
    <div class="bar"><div class="bar-fill" style="width:${Math.floor(clamp01((now() - ex.startAt) / Math.max(1, ex.endAt - ex.startAt)) * 100)}%" data-progress-start="${ex.startAt}" data-progress-end="${ex.endAt}"></div></div>
    <div class="muted farm-small">เหลืออีก <span data-countdown="${ex.endAt}">${formatDuration(left)}</span></div>
  </div>`;
}

function exploreRender(state) {
  const list = (Array.isArray(state.expeditions) ? state.expeditions : []).filter(Boolean)
    .slice().sort((a, b) => (b.done - a.done) || (a.endAt - b.endAt));
  const runs = list.length
    ? `<h3 class="farm-h">กำลังสำรวจ (${list.length})</h3><div class="zone-runs">${list.map(e => runCard(state, e)).join('')}</div>`
    : '';
  return `<section class="farm-wrap">
    <div class="farm-help card">
      <b>💡 เคล็ดลับ</b> ส่งน้องที่ถนัดงานตรงกับโซนไปสำรวจ ยิ่งพลังสูงยิ่งได้ของเยอะ
      <span class="muted">เบบี้ยังไปไม่ได้ · เวลาเดินต่อแม้ปิดเกม</span>
    </div>
    ${runs}
    <h3 class="farm-h">โซนสำรวจ</h3>
    <div class="zone-list">${ZONES.map(z => zoneCard(state, z)).join('')}</div>
  </section>`;
}

function pickExplorer(zoneId) {
  const zone = getZone(zoneId);
  const st = getState();
  if (!zone) return;
  if (levelOf(st) < zone.unlockLevel) {
    notify(`${zone.nameTh}ปลดล็อกที่เลเวล ${zone.unlockLevel}`, 'warn');
    return;
  }
  const eligible = pet => pet.stage >= 1 && petCanWork(pet);
  if (!st.pets.some(eligible)) {
    notify('ไม่มีน้องที่พร้อมออกสำรวจ (ต้องโตกว่าเบบี้ ตื่น ไม่ป่วย พลัง ≥ 20 อิ่ม ≥ 15)', 'warn');
    return;
  }
  const ctx = { kind: 'expedition', jobs: [zone.job], zoneId: zone.id, hour: new Date(now()).getHours() };
  openPowerPicker({
    title: `ส่งน้องไปสำรวจ ${zone.emoji} ${zone.nameTh}`,
    pets: st.pets.filter(eligible),
    power: pet => getWorkPower(pet, [zone.job], ctx),
    describe: pet => powerNote(pet, [zone.job], p => `เก็บของ ~${Math.round(zone.baseRolls + 0.75 * p)} ครั้ง`, { kind: 'expedition', jobs: [zone.job], zoneId: zone.id, hour: new Date(now()).getHours() })
      + (pet.station ? ` <span class="badge">📌 ${esc(stationLabel(pet))}</span>` : ''),
    onPick: petId => {
      const pet = getPet(getState(), petId);
      const go = () => run(s => startExpedition(s, petId, zoneId));
      if (pet && pet.station) {
        confirmModal('📌 น้องประจำแปลงอยู่', `${stationLabel(pet)} — ถ้าส่งไปสำรวจ น้องจะเลิกประจำแปลงนี้ ตกลงไหม?`, 'ส่งไปสำรวจ', go);
      } else go();
    },
  });
}

function exploreBind(rootEl) {
  delegate(rootEl, {
    'explore-send': d => pickExplorer(d.zone),
    claim: d => run(s => claimExpedition(s, d.exp)),
  });
}

// ================================================================ SHOP VIEW

const SHOP_TABS = [
  { id: 'seed', label: '🌱 เมล็ด' },
  { id: 'food', label: '🍖 อาหาร' },
  { id: 'care', label: '🧼 ของใช้' },
  { id: 'egg', label: '🥚 ไข่' },
  { id: 'upgrade', label: '⬆️ อัปเกรด' },
];
const TAG_TH = { veg: 'ผัก', fruit: 'ผลไม้', grain: 'ธัญพืช', meat: 'เนื้อ', fish: 'ปลา', insect: 'แมลง', sweet: 'ของหวาน', milk: 'นม', leaf: 'ใบไม้' };
let shopTab = 'seed';

function shopDetail(item) {
  if (item.type === 'seed') {
    const c = getCrop(item.id.replace(/^seed_/, ''));
    if (c) return `⏱️ ${formatDuration(c.growMs)} · ผลผลิต ${c.yield[0]}–${c.yield[1]} · ขาย ${num(c.sellPrice)}🪙/ชิ้น`;
  }
  if (item.type === 'food' && item.food) {
    const tags = (item.food.tags || []).map(t => TAG_TH[t] || t).join('/');
    return `อิ่ม +${item.food.hunger} · สุข +${item.food.happy} · ${tags}`;
  }
  if (item.type === 'egg') {
    const e = getEgg(item.id);
    if (e) return `ฟักใน ${formatDuration(e.hatchMs)}`;
  }
  return item.desc || '';
}

function shopItemCard(state, item) {
  const locked = levelOf(state) < item.unlockLevel;
  const owned = invOf(state, item.id);
  const coins = coinsOf(state);
  let buy;
  if (locked) {
    buy = `<span class="badge">🔒 Lv.${item.unlockLevel}</span>`;
  } else {
    const b = (q) => `<button class="btn btn-sm${q === 1 ? ' btn-primary' : ''}" data-action="buy" data-item="${esc(item.id)}" data-qty="${q}" ${coins < item.buy * q ? 'disabled' : ''}>ซื้อ x${q}</button>`;
    buy = `<span class="shop-price">🪙 ${num(item.buy)}</span>${b(1)}${b(5)}`;
  }
  return `<div class="shop-item${locked ? ' is-locked' : ''}">
    <span class="shop-emoji">${item.emoji}</span>
    <div class="shop-info">
      <div><b>${esc(item.nameTh)}</b> ${owned > 0 ? `<span class="badge">มี ${num(owned)}</span>` : ''}</div>
      <div class="muted farm-small">${esc(shopDetail(item))}</div>
    </div>
    <div class="shop-buy">${buy}</div>
  </div>`;
}

// ✅/❌ chip for one requirement ("🪵 ไม้ 1/2").
const matChip = (emoji, label, have, need) => {
  const ok = have >= need;
  return `<span class="mat-chip ${ok ? 'is-ok' : 'is-miss'}" title="${ok ? 'พอแล้ว' : 'ยังไม่พอ'}">${emoji} ${esc(label)} <b>${num(Math.min(have, 9999))}/${num(need)}</b> ${ok ? '✅' : '❌'}</span>`;
};

// "ขยายลาน": coins + the materials of the next slot (✅/❌ each) and what the next tier looks like.
function yardCard(state) {
  const st = barnUpgradeStatus(state);
  const cap = Number(state.barnCapacity) || 3;
  const head = `<span class="shop-emoji">🏡</span>`;
  if (!st) {
    return `<div class="shop-item">${head}<div class="shop-info"><div><b>ขยายลาน</b></div><div class="muted farm-small">ตอนนี้ ${cap}/${MAX_BARN} ช่อง · ${esc(yardUpgradePreview(state))}</div></div><div class="shop-buy"><span class="badge">เต็มแล้ว</span></div></div>`;
  }
  const { cost, rows } = st;
  const chips = [matChip('🪙', 'เหรียญ', coinsOf(state), cost.coins), ...rows.map(r => matChip(r.emoji, r.nameTh, r.have, r.need))].join('');
  const alt = cost.alt ? `<div class="muted farm-small">หรือใช้ ${Object.entries(cost.alt).map(([id, n]) => { const it = getItem(id); return `${it ? it.emoji + ' ' + esc(it.nameTh) : esc(id)} x${n}`; }).join(' + ')} แทน</div>` : '';
  const how = st.itemsOk ? '' : '<div class="muted farm-small">🧭 วัสดุหาได้จากการสำรวจ (ซื้อไม่ได้)</div>';
  return `<div class="shop-item yard-card${cost.enters ? ' is-tier-up' : ''}">
    ${head}
    <div class="shop-info">
      <div><b>ขยายลาน</b> <span class="badge">${cap}/${MAX_BARN} ช่อง</span>${cost.enters ? ' <span class="badge">✨ ลานชั้นใหม่</span>' : ''}</div>
      <div class="muted farm-small">${esc(yardUpgradePreview(state))}</div>
      <div class="mat-chips">${chips}</div>${alt}${how}
    </div>
    <div class="shop-buy"><button class="btn btn-primary btn-sm" data-action="upgrade-barn" ${st.ok ? '' : 'disabled'}>ขยาย</button></div>
  </div>`;
}

// "ตกแต่งลาน": build decor from materials + a few coins; "วาง" puts it on the first free spot (the 3D yard has the spots).
function decorSection(state) {
  const spots = decorSpotList(state);
  const placedN = spots.filter(x => x.placed).length;
  const free = spots.length - placedN;
  const cards = DECOR.map(d => {
    const bag = Number(state.inventoryDecor && state.inventoryDecor[d.id]) || 0;
    const onYard = (Array.isArray(state.decor) ? state.decor : []).filter(x => x.decorId === d.id).length;
    const bs = decorBuildStatus(state, d.id);
    const chips = [matChip('🪙', 'เหรียญ', coinsOf(state), d.coins), ...Object.entries(d.items).map(([id, n]) => { const it = getItem(id); return matChip(it ? it.emoji : '❔', it ? it.nameTh : id, invOf(state, id), n); })].join('');
    return `<div class="decor-card">
      <span class="decor-emoji">${d.emoji}</span>
      <div class="decor-info">
        <div><b>${esc(d.nameTh)}</b> ${bag ? `<span class="badge">ในกระเป๋า ${bag}</span>` : ''}${onYard ? ` <span class="badge">วางแล้ว ${onYard}</span>` : ''}</div>
        <div class="muted farm-small">${esc(d.useTh)}</div>
        <div class="mat-chips">${chips}</div>
      </div>
      <div class="decor-btns">
        <button class="btn btn-sm${bag ? '' : ' btn-primary'}" data-action="build-decor" data-decor="${d.id}" ${bs.ok ? '' : 'disabled'}>สร้าง</button>
        ${bag ? `<button class="btn btn-primary btn-sm" data-action="place-decor" data-decor="${d.id}" ${free ? '' : 'disabled title="ลานไม่มีจุดว่าง"'}>วาง</button>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<h3 class="farm-h">🎀 ตกแต่งลาน <span class="badge">วางแล้ว ${placedN}/${spots.length} จุด</span></h3>
    <div class="muted farm-small">แค่ของสวยๆ น้องๆ ชอบมาเล่น ไม่มีโบนัสเงิน · จุดวางเพิ่มเมื่อลานโตขึ้น</div>
    <div class="decor-list">${cards}</div>`;
}

// "ร้านแต่งตัว": cosmetic accessories bought into state.wardrobe (worn from the pet sheet). Three are expedition-only; none can be sold.
function dressShopSection(state) {
  const coins = coinsOf(state);
  const zoneName = id => { const z = getZone(id); return z ? `${z.emoji} ${z.nameTh}` : ''; };
  const cards = ACCESSORIES.map(a => {
    const own = accessoryOwned(state, a.id);
    const badge = own ? ` <span class="badge">มี ${own}</span>` : '';
    const slot = a.slot === 'head' ? 'หัว' : 'คอ';
    if (a.price == null) {
      return `<div class="decor-card">
        <span class="decor-emoji">${a.emoji}</span>
        <div class="decor-info"><div><b>${esc(a.nameTh)}</b>${badge}</div>
          <div class="muted farm-small">${slot} · หาได้จากการสำรวจ ${esc(zoneName(a.zone))} เท่านั้น (หายาก)</div></div>
      </div>`;
    }
    return `<div class="decor-card">
      <span class="decor-emoji">${a.emoji}</span>
      <div class="decor-info"><div><b>${esc(a.nameTh)}</b>${badge}</div>
        <div class="muted farm-small">${slot} · แค่ความน่ารัก ไม่มีโบนัส</div></div>
      <div class="decor-btns"><span class="shop-price">🪙 ${num(a.price)}</span>
        <button class="btn btn-primary btn-sm" data-action="buy-accessory" data-acc="${a.id}" ${coins < a.price ? 'disabled' : ''}>ซื้อ</button></div>
    </div>`;
  }).join('');
  return `<h3 class="farm-h">👗 ร้านแต่งตัว</h3>
    <div class="muted farm-small">ของแต่งตัวน้อง ใส่ได้ที่หน้าน้อง · ขายคืนไม่ได้</div>
    <div class="decor-list">${cards}</div>`;
}

function upgradeCards(state) {
  const coins = coinsOf(state);
  const pp = plotPrice(state);
  const ip = incubatorUpgradePrice(state);
  const incCap = Number(state.incubatorCapacity) || 1;
  const plots = Array.isArray(state.plots) ? state.plots.length : 0;
  const card = (emoji, title, sub, price, action) => `<div class="shop-item">
    <span class="shop-emoji">${emoji}</span>
    <div class="shop-info"><div><b>${title}</b></div><div class="muted farm-small">${sub}</div></div>
    <div class="shop-buy">${price == null
      ? '<span class="badge">เต็มแล้ว</span>'
      : `<span class="shop-price">🪙 ${num(price)}</span><button class="btn btn-primary btn-sm" data-action="${action}" ${coins < price ? 'disabled' : ''}>ซื้อ</button>`}</div>
  </div>`;
  return card('🌾', 'ขยายแปลงไร่', `ตอนนี้ ${plots}/${MAX_PLOTS} แปลง · ปลูกได้พร้อมกันมากขึ้น`, pp, 'buy-plot')
    + yardCard(state)
    + card('🥚', 'ขยายตู้ฟัก', `ตอนนี้ ${incCap}/${MAX_INCUBATOR} ช่อง · ฟักไข่ได้พร้อมกันมากขึ้น`, ip, 'upgrade-incubator')
    + decorSection(state)
    + dressShopSection(state);
}

function shopRender(state) {
  if (!SHOP_TABS.some(t => t.id === shopTab)) shopTab = 'seed';
  const tabs = SHOP_TABS.map(t =>
    `<button class="shop-tab${t.id === shopTab ? ' is-active' : ''}" data-action="shop-tab" data-tab="${t.id}" role="tab" aria-selected="${t.id === shopTab}">${t.label}</button>`).join('');
  let body;
  if (shopTab === 'upgrade') {
    body = upgradeCards(state);
  } else {
    const items = Object.values(ITEMS).filter(it => it.type === shopTab && it.buy != null);
    body = items.map(it => shopItemCard(state, it)).join('') || '<div class="empty-state">ยังไม่มีสินค้า</div>';
  }
  return `<section class="farm-wrap">
    <div class="shop-head"><h3 class="farm-h">🛒 ร้านค้า</h3><span class="shop-coins">🪙 ${num(coinsOf(state))}</span></div>
    <div class="shop-tabs" role="tablist">${tabs}</div>
    <div class="shop-list">${body}</div>
  </section>`;
}

function shopBind(rootEl) {
  delegate(rootEl, {
    'shop-tab': d => { shopTab = d.tab; emit('change'); },
    buy: d => run(s => buyItem(s, d.item, Number(d.qty) || 1)),
    'buy-plot': () => run(s => buyPlot(s)),
    'upgrade-barn': () => run(s => upgradeBarn(s)),
    'buy-accessory': d => run(s => buyAccessory(s, d.acc)),
    'build-decor': d => run(s => buildDecor(s, d.decor)),
    'place-decor': d => run(s => {
      const spot = decorSpotList(s).find(x => !x.placed);
      return spot ? placeDecor(s, d.decor, spot.spot) : { ok: false, reason: 'ลานไม่มีจุดว่างสำหรับของตกแต่ง' };
    }),
    'upgrade-incubator': () => run(s => upgradeIncubator(s)),
  });
}

// ================================================================ BAG VIEW

const BAG_GROUPS = [
  { type: 'crop', title: '🧺 ผลผลิต' },
  { type: 'forage', title: '🍄 ของป่า' },
  { type: 'seed', title: '🌱 เมล็ด' },
  { type: 'food', title: '🍖 อาหาร' },
  { type: 'care', title: '🧼 ของใช้' },
  { type: 'egg', title: '🥚 ไข่' },
];

function bagRow(id, count) {
  const it = getItem(id);
  if (!it) return '';
  let acts = '';
  if (it.sell != null) {
    acts = `<button class="btn btn-sm" data-action="sell" data-item="${esc(id)}" data-qty="1">ขาย x1</button>`
      + (count > 1 ? `<button class="btn btn-sm btn-primary" data-action="sell" data-item="${esc(id)}" data-qty="all">ขายทั้งหมด +${num(it.sell * count)}🪙</button>` : '');
  } else if (it.type === 'egg') {
    acts = '<span class="muted farm-small">ฟักที่แท็บลาน</span>';
  } else {
    acts = '<span class="muted farm-small">ขายไม่ได้</span>';
  }
  const sub = [it.sell != null ? `ขาย ${num(it.sell)}🪙/ชิ้น` : (it.type === 'care' || it.type === 'food' ? 'ใช้ที่แท็บลาน' : ''),
    YARD_MATERIALS[id] ? `🏡 ${YARD_MATERIALS[id]}` : ''].filter(Boolean).join(' · ');
  return `<div class="bag-row">
    <span class="bag-emoji">${it.emoji}</span>
    <div class="bag-info"><div><b>${esc(it.nameTh)}</b> <span class="badge">x${num(count)}</span></div>
      ${sub ? `<div class="muted farm-small">${sub}</div>` : ''}</div>
    <div class="bag-actions">${acts}</div>
  </div>`;
}

function bagRender(state) {
  const inv = state.inventory || {};
  const entries = Object.entries(inv).filter(([id, n]) => n > 0 && getItem(id));
  if (!entries.length) {
    return `<section class="farm-wrap"><div class="empty-state">🎒 กระเป๋ายังว่างอยู่<br><span class="muted">เก็บเกี่ยวพืชหรือส่งน้องไปสำรวจเพื่อหาของ</span></div></section>`;
  }
  let total = 0;
  const groups = BAG_GROUPS.map(g => {
    const rows = entries.filter(([id]) => getItem(id).type === g.type);
    if (!rows.length) return '';
    rows.forEach(([id, n]) => { total += (getItem(id).sell || 0) * n; });
    return `<div class="bag-group"><h3 class="farm-h">${g.title}</h3>${rows.map(([id, n]) => bagRow(id, n)).join('')}</div>`;
  }).join('');
  return `<section class="farm-wrap">
    <div class="bag-summary"><span>🎒 ${entries.length} ชนิด</span><span class="muted">มูลค่าขายรวม 🪙 ${num(total)}</span></div>
    ${groups}
  </section>`;
}

function bagBind(rootEl) {
  delegate(rootEl, {
    sell: d => run(s => sellItem(s, d.item, d.qty === 'all' ? (Number(s.inventory[d.item]) || 0) : Number(d.qty) || 1)),
  });
}

// ================================================================ exports

export const views = [
  { id: 'farm', icon: '🌾', label: 'ไร่', render: farmRender, bind: farmBind },
  { id: 'explore', icon: '🧭', label: 'สำรวจ', render: exploreRender, bind: exploreBind },
  { id: 'shop', icon: '🛒', label: 'ร้าน', render: shopRender, bind: shopBind },
  { id: 'bag', icon: '🎒', label: 'กระเป๋า', render: bagRender, bind: bagBind },
];

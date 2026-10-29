// เทศกาล 🏮 UI (CONTRACT_V11 §4): the chip on the yard header and the festival sheet (tasks, login dots, shop, krathong craft + float).
// Pure string building plus one modal; every game change goes through js/festival.js actions via the injected `run`.

import { escapeHtml, openModal, now } from '../util.js';
import { getState, countItem } from '../state.js';
import { getItem } from '../data/items.js';
import { activeFestival, festivalDaysLeft, festivalView, claimTask, loginLantern, buyFestivalItem, craftKrathong, floatKrathong } from '../festival.js';
import { petEmoji } from '../pets.js';

const e = escapeHtml;

/** "🏮 🌾 เทศกาลเก็บเกี่ยว · เหลือ 3 วัน": reads the state only (never rolls the tasks). */
export function festChipHtml(state, opts = {}) {
  const fest = activeFestival(now());
  const f = state && state.festival;
  const claim = f && f.key === fest.key && Array.isArray(f.tasks) ? f.tasks.filter(t => t && !t.claimed && t.progress >= t.target).length : 0;
  const left = festivalDaysLeft(fest);
  const icon = fest.emoji === '🏮' ? '🏮' : `🏮 ${fest.emoji}`;
  const compact = !!opts.compact;
  return `<button type="button" class="fest-chip fest-${fest.kind}${compact ? ' fest-chip-compact' : ''}${claim ? ' has-claim' : ''}" data-action="open-festival" aria-label="เทศกาล ${e(fest.nameTh)} เหลือ ${left} วัน${claim ? ` มีรางวัลให้รับ ${claim}` : ''}">
    <span class="fest-chip-e" aria-hidden="true">${compact ? fest.emoji : icon}</span>${compact ? '' : `<span class="fest-chip-t">${e(fest.nameTh)}</span>`}<span class="fest-chip-d">${compact ? '' : '· '}เหลือ ${left} วัน</span>${claim ? `<b class="fest-chip-n">รับ ${claim}</b>` : ''}</button>`;
}

const itemList = recipe => Object.entries(recipe).map(([id, n]) => { const it = getItem(id); return `${it ? it.emoji : ''}×${n}`; }).join(' + ');

/** The whole sheet from festivalView(state) (pass a view in tests). */
export function festivalSheetHtml(state, view = festivalView(state)) {
  const fest = view.festival;
  const tasks = view.tasks.map(t => {
    const pct = Math.min(100, Math.round((t.progress / Math.max(1, t.target)) * 100));
    const btn = t.claimed ? '<span class="fest-done">รับแล้ว ✓</span>'
      : `<button type="button" class="btn btn-sm${t.claimable ? ' btn-primary' : ''}" data-fest="claim" data-id="${e(t.id)}"${t.claimable ? '' : ' disabled'}>รับ 🏮${t.reward}</button>`;
    return `<div class="fest-task${t.claimed ? ' is-done' : ''}"><span class="fest-task-e" aria-hidden="true">${t.emoji}</span>
      <div class="fest-task-main"><b>${e(t.nameTh)}</b>
        <div class="fest-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${t.target}" aria-valuenow="${t.progress}"><span style="width:${pct}%"></span></div>
        <small class="muted">${t.progress}/${t.target}</small></div>${btn}</div>`;
  }).join('');
  const dots = Array.from({ length: view.login.max }, (_, i) => `<span class="fest-dot${i < view.login.days ? ' is-on' : ''}" aria-hidden="true">${i < view.login.days ? '🏮' : '·'}</span>`).join('');
  const loginLine = view.login.done ? `ครบ ${view.login.max} วันแล้ว 🎉` : view.login.today ? 'วันนี้รับโคมไฟแล้ว พรุ่งนี้มาใหม่นะ' : 'แวะมาวันนี้ ได้ 🏮1';
  const login = `<div class="fest-login"><div class="fest-dots" aria-label="แวะมาแล้ว ${view.login.days}/${view.login.max} วัน">${dots}</div>
    <small class="muted">${loginLine}</small>${view.login.today || view.login.done ? '' : '<button type="button" class="btn btn-sm btn-primary" data-fest="login">รับโคมไฟวันนี้</button>'}</div>`;
  const shop = view.shop.map(it => `<div class="fest-item${it.owned ? ' is-owned' : ''}"><span class="fest-item-e" aria-hidden="true">${it.emoji}</span>
      <div class="fest-item-main"><b>${e(it.nameTh)}</b><small class="muted">${it.type === 'acc' ? (it.slot === 'head' ? 'ใส่หัว' : 'ใส่คอ') : 'ของตกแต่งลาน'}</small></div>
      ${it.owned ? '<span class="fest-done">มีแล้ว</span>'
        : `<button type="button" class="btn btn-sm${it.affordable ? ' btn-primary' : ''}" data-fest="buy" data-id="${e(it.id)}"${it.affordable ? '' : ' disabled'}>🏮 ${it.price}</button>`}</div>`).join('');
  let kr = '';
  if (view.krathong) {
    const k = view.krathong;
    const bag = Object.entries(k.recipe).map(([id, n]) => { const it = getItem(id); return `${it ? it.emoji : ''} ${countItem(state, id)}/${n}`; }).join(' · ');
    kr = `<section class="fest-sec"><h4 class="pet-detail-h">🪷 กระทง</h4>
      <p class="muted fest-note">สูตร ${itemList(k.recipe)} ต่อ 1 ใบ · ในกระเป๋า ${bag}</p>
      <div class="fest-kr"><span class="fest-kr-n">🪷 ${k.stock}/${k.max}</span>
        <button type="button" class="btn btn-sm" data-fest="craft"${k.canCraft ? '' : ' disabled'}>🪷 ทำกระทง</button>
        <button type="button" class="btn btn-sm btn-primary" data-fest="float"${k.stock > 0 && k.left > 0 ? '' : ' disabled'}>ลอยกระทง</button></div>
      <small class="muted">วันนี้ลอยแล้ว ${k.floatsToday}/${k.cap} ใบ${k.peak ? ' · คืนลอยกระทง ลอยได้เพิ่ม 🌕' : ''} · ลอยแล้วได้ 🏮1</small></section>`;
  }
  return `<div class="fest-head"><span class="fest-head-e" aria-hidden="true">${fest.emoji}</span>
      <div><b>${e(fest.nameTh)}</b><small class="muted">เหลือ ${fest.daysLeft} วัน${fest.peak ? ' · คืนนี้คือคืนลอยกระทง! 🌕' : ''}</small></div>
      <span class="fest-lanterns" title="โคมไฟเทศกาล">🏮 <b>${view.lanterns}</b></span></div>
    <section class="fest-sec"><h4 class="pet-detail-h">📋 งานเทศกาล</h4>${tasks}</section>
    <section class="fest-sec"><h4 class="pet-detail-h">📅 แวะมาทุกวัน</h4>${login}</section>
    ${kr}
    <section class="fest-sec"><h4 class="pet-detail-h">🛍️ ร้านเทศกาล</h4><div class="fest-shop">${shop}</div></section>
    <p class="muted fest-note">โคมไฟใช้แลกของแต่งตัวเท่านั้น — เทศกาลไม่ให้เหรียญหรือผงดาว</p>`;
}

/**
 * Opens the sheet. deps: { run(fn), pickPet({ title, filter, describe, onPick }), onFloated(petId) }.
 * Returns the modal's close function.
 */
export function openFestivalSheet(deps) {
  let box = null;
  let close = () => {};
  const paint = () => { if (box) box.innerHTML = festivalSheetHtml(getState()); };
  close = openModal({
    title: '🏮 เทศกาล',
    html: '<div class="fest-sheet"></div>',
    onMount(el) {
      box = el.querySelector('.fest-sheet');
      paint();
      el.addEventListener('click', ev => {
        const b = ev.target.closest('[data-fest]');
        if (!b || b.disabled) return;
        const id = b.dataset.id;
        switch (b.dataset.fest) {
          case 'claim': deps.run(s => claimTask(s, id)); break;
          case 'login': deps.run(s => loginLantern(s)); break;
          case 'buy': deps.run(s => buyFestivalItem(s, id)); break;
          case 'craft': deps.run(s => craftKrathong(s)); break;
          case 'float':
            deps.pickPet({
              title: '🪷 ใครจะลอยกระทง?',
              filter: p => p.status === 'idle' && !p.sick,
              describe: p => `${petEmoji(p)}`,
              onPick: pid => {
                const r = deps.run(s => floatKrathong(s, pid));
                if (r && r.ok) { close(); if (deps.onFloated) deps.onFloated(pid); } else paint();
              },
            });
            return;
          default: return;
        }
        paint();
      });
    },
  });
  return close;
}


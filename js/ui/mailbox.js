// V12 mailbox modal (📬 in the header): list system mail, take gifts. Logic lives in js/mail.js.
import { getState, update } from '../state.js';
import { escapeHtml as e, notify, openModal } from '../util.js';
import { mailList, mailBadgeCount, readMail, claimMail } from '../mail.js';
import { LIMITED_PETS } from '../data/limited.js';
import { getSpecies } from '../data/species.js';
import { getEgg } from '../data/eggs.js';

const dateTh = at => (at ? new Date(at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '');

const claimBtn = m => (m.claimed ? '<span class="badge">✅ รับแล้ว</span>'
  : `<button type="button" class="btn btn-primary btn-sm" data-mail-claim="${e(m.id)}">🎁 รับของขวัญ</button>`);

function giftHtml(m) {
  const egg = m.def.gift && m.def.gift.egg && getEgg(m.def.gift.egg);
  if (egg) {
    return `<div class="mail-gift">
      <span class="mail-gift-emoji" aria-hidden="true">${egg.emoji}</span>
      <span><b>${e(egg.nameTh)}</b><br><small class="muted">✦ ฟักได้น้องระดับตำนาน 1 ตัว (สุ่ม) · เข้าตู้ฟักทันที</small></span>
      ${claimBtn(m)}
    </div>`;
  }
  const L = m.def.gift && LIMITED_PETS[m.def.gift.limited];
  if (!L) return '';
  const sp = getSpecies(L.speciesId);
  return `<div class="mail-gift">
      <span class="mail-gift-emoji" aria-hidden="true">${sp ? sp.emoji : '🎁'}</span>
      <span><b>${e(L.nameTh)}</b> ${L.icon} <span class="pet-limited-tag">${L.badge}</span><br><small class="muted">✨ ไชนี่ · ✦ ตำนาน · ออร่าสีรุ้งเฉพาะตัว</small></span>
      ${claimBtn(m)}
    </div>`;
}

function listHtml(state) {
  const list = mailList(state);
  if (!list.length) return '<p class="muted">ยังไม่มีจดหมาย</p>';
  return '<div class="mailbox">' + list.map(m => `<article class="mail-item${m.read ? '' : ' is-new'}">
      <div class="mail-item-head"><b>${e(m.def.title)}</b><small class="muted">${dateTh(m.at)}</small></div>
      <small class="muted">จาก ${e(m.def.from)}</small>
      <p class="mail-item-body">${e(m.def.body)}</p>
      ${giftHtml(m)}
    </article>`).join('') + '</div>';
}

export function openMailbox() {
  const state = getState();
  const html = listHtml(state);   // drawn before marking read, so new mail still shows as new this time
  if (mailList(state).some(m => !m.read)) update(s => { for (const m of mailList(s)) readMail(s, m.id); });
  openModal({
    title: '📬 จดหมาย',
    html,
    onMount(body) {
      body.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-mail-claim]');
        if (!btn) return;
        const r = update(s => claimMail(s, btn.dataset.mailClaim));
        if (r && r.ok) notify(r.msg, 'success'); else notify((r && r.reason) || 'รับไม่สำเร็จ', 'warn');
        body.innerHTML = listHtml(getState());
      });
    },
  });
}

/** Header badge: unread mail + gifts not taken yet. */
export function updateMailBadge(btn) {
  if (!btn) return;
  const n = mailBadgeCount(getState());
  let b = btn.querySelector('.hdr-mail-badge');
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'hdr-mail-badge'; btn.appendChild(b); }
  b.textContent = String(n);
}

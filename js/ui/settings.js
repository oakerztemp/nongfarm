// Settings modal (⚙️): notification opt-in, app install, version.
import { getState, update, STATE_VERSION } from '../state.js';
import { escapeHtml, notify, openModal } from '../util.js';
import {
  APP_VERSION, canInstall, isInstalled, onInstallChange, promptInstall,
  notificationsSupported, notificationPermission, requestNotificationPermission,
} from '../pwa.js';

function notifyHint() {
  if (!notificationsSupported()) return 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน';
  if (notificationPermission() === 'denied') return 'เบราว์เซอร์บล็อกการแจ้งเตือนไว้ — เปิดสิทธิ์ในการตั้งค่าเว็บไซต์ก่อน';
  return 'แจ้งเตือนเมื่อไข่ฟัก พืชพร้อมเก็บ สำรวจเสร็จ หรือน้องหิว (เฉพาะตอนไม่ได้เปิดดูเกมอยู่ และไม่เกิน 1 ครั้งต่อ 10 นาที)';
}

function installSection() {
  if (isInstalled()) return '<p class="muted">ติดตั้งแอปแล้ว ✅</p>';
  if (canInstall()) return '<button type="button" class="btn btn-primary" data-set="install">📲 ติดตั้งแอป</button>';
  return '<p class="muted">ติดตั้งเป็นแอป: เมนูของเบราว์เซอร์ &gt; “ติดตั้งแอป / เพิ่มลงหน้าจอหลัก” (iPhone: ปุ่มแชร์ &gt; เพิ่มไปยังหน้าจอโฮม)</p>';
}

export function openSettings() {
  const on = !!(getState().settings && getState().settings.notify) && notificationPermission() === 'granted';
  let stopInstallWatch = () => {};
  openModal({
    title: '⚙️ ตั้งค่า',
    html:
      '<div class="settings">' +
        '<label class="settings-row">' +
          `<input type="checkbox" data-set="notify"${on ? ' checked' : ''}${notificationsSupported() ? '' : ' disabled'}>` +
          '<span><strong>การแจ้งเตือน</strong>' +
          `<span class="muted settings-hint" data-hint>${escapeHtml(notifyHint())}</span></span>` +
        '</label>' +
        `<div class="settings-install" data-install>${installSection()}</div>` +
        `<p class="muted settings-version">เวอร์ชันเกม ${escapeHtml(APP_VERSION)} · โครงสร้างเซฟ v${STATE_VERSION}</p>` +
      '</div>',
    onMount(el) {
      const box = el.querySelector('[data-set="notify"]');
      el.addEventListener('change', async e => {
        if (e.target !== box) return;
        if (!box.checked) {
          update(s => { s.settings.notify = false; });
          return;
        }
        const permission = await requestNotificationPermission();
        if (permission === 'granted') {
          update(s => { s.settings.notify = true; });
          notify('เปิดการแจ้งเตือนแล้ว 🔔', 'success');
        } else {
          box.checked = false;
          notify('ยังไม่ได้รับอนุญาตให้แจ้งเตือน — เปิดสิทธิ์ในเบราว์เซอร์แล้วลองใหม่', 'warn');
        }
        el.querySelector('[data-hint]').textContent = notifyHint();
      });
      el.addEventListener('click', async e => {
        if (!e.target.closest('[data-set="install"]')) return;
        await promptInstall();
      });
      stopInstallWatch = onInstallChange(() => {
        el.querySelector('[data-install]').innerHTML = installSection();
      });
    },
    onClose: () => stopInstallWatch(),
  });
}

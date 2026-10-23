// PWA glue: service worker registration (never on localhost by default), install prompt, local notifications.

/** Version stamped into the module URL by the deploy workflow (?v=<commit>); 'dev' when served locally. */
export const APP_VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * Whether the service worker should be registered: only over https, and on localhost only with ?sw=1
 * (a service worker on a dev server leaves stale caches behind).
 */
export function shouldRegisterSW(loc = location, nav = navigator) {
  if (!nav || !('serviceWorker' in nav)) return false;
  const host = loc.hostname;
  if (LOCAL_HOSTS.includes(host) || host.endsWith('.localhost')) return new URLSearchParams(loc.search).get('sw') === '1';
  return loc.protocol === 'https:';
}

let swRegistration = null;

export async function registerServiceWorker() {
  if (!shouldRegisterSW()) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js'); // deploy step appends ?v=<commit>
  } catch (e) {
    console.error('Service worker registration failed', e);
  }
  return swRegistration;
}

// ---- install prompt ----

let installEvent = null;
const installListeners = new Set();

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // keep it for the settings button
    installEvent = e;
    for (const fn of [...installListeners]) fn();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    for (const fn of [...installListeners]) fn();
  });
}

export const canInstall = () => installEvent !== null;
export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function onInstallChange(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

/** Opens the browser's install dialog. Resolves true if the player accepted. */
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  return outcome === 'accepted';
}

// ---- notifications ----

export const notificationsSupported = () => typeof Notification !== 'undefined';
export const notificationPermission = () => (notificationsSupported() ? Notification.permission : 'unsupported');

/** Asks for permission (call only from a user action). Resolves 'granted' | 'denied' | 'default' | 'unsupported'. */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Shows a notice from notify.js through the service worker when possible. onOpen(tab) runs when it is clicked. */
export async function showNotice(notice, onOpen) {
  if (notificationPermission() !== 'granted') return false;
  const options = { body: notice.body, tag: notice.tag, icon: './icons/icon-192.png', data: { tab: notice.tab } };
  try {
    if (swRegistration && swRegistration.showNotification) {
      await swRegistration.showNotification(notice.title, options);
    } else {
      const n = new Notification(notice.title, options);
      n.onclick = () => {
        window.focus();
        if (onOpen) onOpen(notice.tab);
        n.close();
      };
    }
    return true;
  } catch (e) {
    console.error('Notification failed', e);
    return false;
  }
}

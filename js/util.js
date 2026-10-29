// Shared helpers: time, random, formatting, notifications, modal, timers.
// Everything here except openModal/refreshTimers/morph is DOM-free.

let clock = Date.now;

/** Replaces the time source (tests use this to fake time). Call with no argument to restore the real clock. */
export function setClock(fn) {
  clock = typeof fn === 'function' ? fn : Date.now;
}

export const now = () => clock();

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Short random id, unique enough for pets/expeditions. */
export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}

/** Random integer, both ends inclusive. */
export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Pick one element of `list`, weighted by weightFn(element). */
export function pickWeighted(list, weightFn) {
  if (!list.length) return undefined;
  const weights = list.map(item => Math.max(0, Number(weightFn(item)) || 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return list[0];
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r < 0) return list[i];
  }
  return list[list.length - 1];
}

/** '1ชม. 5น.' / '3น. 20ว.' / '12ว.'; nothing left -> 'เสร็จแล้ว'. */
export function formatDuration(ms) {
  if (!(ms > 0)) return 'เสร็จแล้ว';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}ชม. ${m}น.` : `${h}ชม.`;
  if (m > 0) return s > 0 ? `${m}น. ${s}ว.` : `${m}น.`;
  return `${s}ว.`;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/** Local date as 'YYYY-MM-DD'. */
export function todayKey() {
  const d = new Date(now());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---- notifications (main.js subscribes and renders toasts) ----

const notifyListeners = new Set();

/** type: 'info' | 'success' | 'warn' | 'error'; opts: { ms } = how long the toast stays (default: renderer's own). */
export function notify(msg, type = 'info', opts = {}) {
  for (const fn of [...notifyListeners]) {
    try { fn(String(msg), type, opts); } catch (e) { console.error(e); }
  }
}

export function onNotify(fn) {
  notifyListeners.add(fn);
  return () => notifyListeners.delete(fn);
}

/** Newest first, capped at 50 entries. */
export function addLog(state, msg) {
  state.log.unshift({ t: now(), msg: String(msg) });
  if (state.log.length > 50) state.log.length = 50;
}

// ---- modal ----

const openModals = [];

function onModalKeydown(e) {
  if (e.key === 'Escape' && openModals.length) {
    e.stopPropagation();
    openModals[openModals.length - 1]();
  }
}

/**
 * Opens a modal. `title` is plain text (escaped here), `html` is trusted markup.
 * Closes on backdrop click, Esc or the close button. Returns close().
 */
export function openModal({ title = '', html = '', onMount, onClose } = {}) {
  const host = document.getElementById('modal-root') || document.body;
  const previousFocus = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" tabindex="-1">' +
      '<div class="modal-header">' +
        `<h2 class="modal-title">${escapeHtml(title)}</h2>` +
        '<button type="button" class="modal-close" aria-label="ปิด">✕</button>' +
      '</div>' +
      `<div class="modal-body">${html}</div>` +
    '</div>';
  const dialog = backdrop.querySelector('.modal');
  const body = backdrop.querySelector('.modal-body');

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    const idx = openModals.indexOf(close);
    if (idx >= 0) openModals.splice(idx, 1);
    if (!openModals.length) {
      document.removeEventListener('keydown', onModalKeydown, true);
      document.body.classList.remove('modal-open');
    }
    backdrop.remove();
    if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
      previousFocus.focus();
    }
    if (onClose) {
      try { onClose(); } catch (e) { console.error(e); }
    }
  }

  // Only close when the press started AND ended on the backdrop (not on a drag out of the dialog).
  let pressedOnBackdrop = false;
  backdrop.addEventListener('pointerdown', e => { pressedOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop && pressedOnBackdrop) close();
  });
  backdrop.querySelector('.modal-close').addEventListener('click', close);

  if (!openModals.length) {
    document.addEventListener('keydown', onModalKeydown, true);
    document.body.classList.add('modal-open');
  }
  openModals.push(close);
  host.appendChild(backdrop);
  dialog.focus();

  if (onMount) {
    try { onMount(body); } catch (e) { console.error(e); }
  }
  return close;
}

// ---- live timers ----

/**
 * Updates countdown text ([data-countdown="<endMs>"]) and progress bar widths
 * ([data-progress-start][data-progress-end]) under `root`.
 */
export function refreshTimers(root) {
  const t = now();
  for (const el of root.querySelectorAll('[data-countdown]')) {
    const text = formatDuration(Number(el.dataset.countdown) - t);
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of root.querySelectorAll('[data-progress-start][data-progress-end]')) {
    const start = Number(el.dataset.progressStart);
    const end = Number(el.dataset.progressEnd);
    const pct = end > start ? clamp((t - start) / (end - start), 0, 1) * 100 : 100;
    el.style.width = `${pct.toFixed(1)}%`;
  }
}

// ---- DOM morph ----

const keyOf = n => (n.nodeType === 1 ? n.getAttribute('data-key') : null);
const isSkip = n => n.nodeType === 1 && n.getAttribute('data-morph') === 'skip';
// Elements marked data-morph="skip" (persistent hosts such as the 3D canvas) only ever match another skip
// element of the same tag, and are then left completely untouched (attributes and children).
const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName && isSkip(a) === isSkip(b);

function syncAttributes(el, fresh) {
  for (const { name } of [...el.attributes]) {
    if (!fresh.hasAttribute(name)) el.removeAttribute(name);
  }
  for (const { name, value } of [...fresh.attributes]) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
}

function syncFormValue(el, fresh) {
  if (el === document.activeElement) return; // never fight the user while they type
  if (el.nodeName === 'INPUT') {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = fresh.checked;
    else if (el.value !== fresh.value) el.value = fresh.value;
  } else if (el.nodeName === 'TEXTAREA') {
    if (el.value !== fresh.value) el.value = fresh.value;
  } else if (el.nodeName === 'SELECT') {
    if (el.value !== fresh.value) el.value = fresh.value;
  }
}

function morphNode(el, fresh) {
  if (isSkip(el)) return; // data-morph="skip": keep as-is
  if (el.nodeType !== 1) {
    if (el.nodeValue !== fresh.nodeValue) el.nodeValue = fresh.nodeValue;
    return;
  }
  syncAttributes(el, fresh);
  if (el.nodeName !== 'TEXTAREA') morphChildren(el, fresh);
  syncFormValue(el, fresh);
}

function morphChildren(parent, source) {
  const olds = [...parent.childNodes];
  const news = [...source.childNodes];
  const keyed = new Map();
  for (const n of olds) {
    const k = keyOf(n);
    if (k !== null) keyed.set(k, n);
  }

  // Pass 1: decide which existing node each new node reuses (no DOM changes yet).
  const used = new Set();
  let cursor = 0;
  const matches = news.map(fresh => {
    const k = keyOf(fresh);
    let match = null;
    if (k !== null) {
      const cand = keyed.get(k);
      if (cand && !used.has(cand) && sameKind(cand, fresh)) match = cand;
    } else {
      while (cursor < olds.length && (used.has(olds[cursor]) || keyOf(olds[cursor]) !== null)) cursor++;
      if (cursor < olds.length) {
        const cand = olds[cursor++];
        if (sameKind(cand, fresh)) match = cand;
      }
    }
    if (match) used.add(match);
    return match;
  });
  for (const n of olds) {
    if (!used.has(n)) n.remove();
  }

  // Pass 2: place nodes in order, morphing the reused ones in place.
  news.forEach((fresh, i) => {
    const node = matches[i] || fresh;
    if (parent.childNodes[i] !== node) parent.insertBefore(node, parent.childNodes[i] || null);
    if (matches[i]) morphNode(node, fresh);
  });
}

/**
 * Updates rootEl's content to match `html` while keeping existing nodes (so CSS animations keep running
 * and focused inputs keep their state). Optional data-key attributes pin identity across reorders.
 * An element with data-morph="skip" is kept exactly as it is (children and attributes untouched) as long as the
 * new html also has a skip element of the same tag at that spot; give it a data-key so it survives reorders.
 */
export function morph(rootEl, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morphChildren(rootEl, tpl.content);
}

// Slim "what to do next" bar under the header, driven by the starter quest chain.
import { getState, update, subscribe } from '../state.js';
import { QUESTS, currentQuest, claimQuest } from '../quests.js';
import { escapeHtml, notify, morph } from '../util.js';

const TAB_LABELS = { barn: 'คอก', farm: 'ไร่', explore: 'สำรวจ' };

function html(state) {
  const quest = currentQuest(state);
  if (!quest) return '';
  const done = quest.check(state);
  const action = done
    ? '<button type="button" class="btn btn-primary btn-sm" data-qb="claim">รับรางวัล</button>'
    : `<button type="button" class="btn btn-sm" data-qb="go" data-tab="${escapeHtml(quest.tab)}">ไปที่แท็บ${escapeHtml(TAB_LABELS[quest.tab] || '')}</button>`;
  return (
    `<span class="quest-step">${state.quests.step + 1}/${QUESTS.length}</span>` +
    '<div class="quest-text">' +
      `<strong class="quest-title">${escapeHtml(quest.titleTh)}</strong>` +
      `<span class="quest-hint muted">${escapeHtml(done ? 'สำเร็จแล้ว! กดรับรางวัลได้เลย' : quest.hintTh)}</span>` +
    '</div>' +
    `<span class="quest-reward" title="รางวัล">🎁 ${escapeHtml(quest.reward.textTh)}</span>` +
    action
  );
}

/** rootEl: the #quest-bar element; showTab(id): switches the main tab. */
export function initQuestBar(rootEl, showTab) {
  const render = () => {
    const content = html(getState());
    rootEl.hidden = content === '';
    morph(rootEl, content);
  };

  rootEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-qb]');
    if (!btn) return;
    if (btn.dataset.qb === 'go') {
      showTab(btn.dataset.tab);
      return;
    }
    const res = update(s => claimQuest(s));
    notify(res.ok ? res.msg : res.reason, res.ok ? 'success' : 'warn');
  });

  subscribe(ev => { if (ev === 'change') render(); });
  render();
}

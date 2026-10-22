// Starter quest chain: tells new players what to do next. DOM-free; progress lives in state.stats.
import { addCoins, addItem } from './state.js'; // circular with state.js (migration), only used inside functions
import { addLog } from './util.js';

const stat = (s, key) => (s.stats && s.stats[key]) || 0;

export const QUESTS = [
  { id: 'hatch', titleTh: 'ฟักไข่ใบแรก', hintTh: 'ใส่ไข่ในตู้ฟักที่แท็บคอก แล้วรอให้ฟัก', tab: 'barn',
    check: s => stat(s, 'hatched') >= 1, reward: { coins: 30, textTh: '🪙 30' } },
  { id: 'feed', titleTh: 'ให้อาหารน้อง', hintTh: 'กดให้อาหารน้องที่แท็บคอก', tab: 'barn',
    check: s => stat(s, 'fed') >= 1, reward: { items: { food_kibble: 3 }, textTh: 'อาหารเม็ด ×3' } },
  { id: 'plant', titleTh: 'ปลูกพืช', hintTh: 'เลือกแปลงว่างที่แท็บไร่ แล้วปลูกเมล็ดแครอท', tab: 'farm',
    check: s => stat(s, 'planted') >= 1, reward: { items: { seed_corn: 3 }, textTh: 'เมล็ดข้าวโพด ×3' } },
  { id: 'help', titleTh: 'ส่งน้องไปช่วยที่แปลง', hintTh: 'กดมอบหมายน้องที่แปลง พืชจะโตไวขึ้น', tab: 'farm',
    check: s => stat(s, 'helped') >= 1, reward: { coins: 50, textTh: '🪙 50' } },
  { id: 'harvest', titleTh: 'เก็บเกี่ยวครั้งแรก', hintTh: 'รอพืชโตเต็มที่ แล้วกดเก็บเกี่ยว', tab: 'farm',
    check: s => stat(s, 'harvested') >= 1, reward: { coins: 50, textTh: '🪙 50' } },
  { id: 'order', titleTh: 'ส่งออเดอร์ 1 ใบ', hintTh: 'ดูออเดอร์วันนี้ที่ด้านบนของแท็บไร่', tab: 'farm',
    check: s => stat(s, 'ordersDone') >= 1, reward: { items: { egg_farm: 1 }, textTh: 'ไข่ทุ่งนา ×1' } },
  { id: 'explore', titleTh: 'ออกสำรวจ 1 ครั้ง', hintTh: 'ส่งน้องที่โตแล้วไปสำรวจที่แท็บสำรวจ', tab: 'explore',
    check: s => stat(s, 'expeditionsStarted') >= 1, reward: { items: { egg_forest: 1 }, textTh: 'ไข่ป่า ×1' } },
];

/**
 * Quests object for a save that predates the chain (migration): `step` is the first unmet step and `preDone`
 * lists every step that is already satisfied, so veterans never receive rewards for things they had done.
 */
export function fastForwardQuests(state) {
  let step = 0;
  while (step < QUESTS.length && QUESTS[step].check(state)) step++;
  const preDone = QUESTS.filter(q => q.check(state)).map(q => q.id);
  return { step, done: step >= QUESTS.length, preDone };
}

/** Moves past steps recorded as already done at migration time (no reward). */
function skipPreDone(quests) {
  const skipped = quests.preDone || [];
  while (quests.step < QUESTS.length && skipped.includes(QUESTS[quests.step].id)) quests.step += 1;
  quests.done = quests.step >= QUESTS.length;
}

/** The quest the player is on, or null when the chain is finished. */
export function currentQuest(state) {
  const q = state.quests;
  if (!q || q.done) return null;
  return QUESTS[q.step] || null;
}

/** Grants the reward of the current quest if its condition is met, then advances. */
export function claimQuest(state) {
  const quest = currentQuest(state);
  if (!quest) return { ok: false, reason: 'ไม่มีภารกิจให้รับรางวัล' };
  if (!quest.check(state)) return { ok: false, reason: 'ยังทำภารกิจนี้ไม่สำเร็จ' };
  if (quest.reward.coins) addCoins(state, quest.reward.coins);
  for (const [itemId, n] of Object.entries(quest.reward.items || {})) addItem(state, itemId, n);
  state.quests.step += 1;
  skipPreDone(state.quests);
  addLog(state, `ภารกิจสำเร็จ: ${quest.titleTh}`);
  return { ok: true, msg: `ภารกิจสำเร็จ! ${quest.titleTh} — ได้ ${quest.reward.textTh}` };
}

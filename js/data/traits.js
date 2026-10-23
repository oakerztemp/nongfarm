// Species traits: ~12 reusable passive perks. Pure data; the maths lives in pets.js (traitEffect).
// Rarity scales only the bonus part (see TRAIT_SCALE).

export const TRAITS = {
  nightOwl:   { nameTh: 'นกฮูกกลางคืน',     emoji: '🌙', descTh: 'ทำงานเก่งขึ้น 30% ช่วง 19:00–06:00' },
  earlyBird:  { nameTh: 'ตื่นเช้า',          emoji: '🌅', descTh: 'ทำงานเก่งขึ้น 30% ช่วง 05:00–11:00' },
  sunLover:   { nameTh: 'รักแดด',           emoji: '☀️', descTh: 'ทำงานเก่งขึ้น 25% ช่วง 11:00–17:00' },
  waterLover: { nameTh: 'รักน้ำ',           emoji: '💧', descTh: 'เก่งขึ้น 25% กับพืชที่ต้องรดน้ำ และการสำรวจบึง' },
  digger:     { nameTh: 'นักขุด',           emoji: '⛏️', descTh: 'เก่งขึ้น 25% กับพืชที่ต้องขุดดิน และการสำรวจภูเขา' },
  teamPlayer: { nameTh: 'ชอบทำงานเป็นทีม',   emoji: '🤝', descTh: 'เก่งขึ้น 10% ต่อน้องอีกตัวที่อยู่แปลงเดียวกัน' },
  loner:      { nameTh: 'ชอบอยู่คนเดียว',    emoji: '🧘', descTh: 'เก่งขึ้น 30% เมื่อทำงานคนเดียวในแปลง' },
  harvester:  { nameTh: 'มือเก็บเกี่ยว',     emoji: '🧺', descTh: 'ได้ผลผลิตเพิ่ม +1 เมื่อเก็บเกี่ยวแปลงที่ช่วยดูแล' },
  forager:    { nameTh: 'นักหาของ',         emoji: '🎒', descTh: 'ออกสำรวจแล้วได้ของเพิ่มอีก 1 ครั้ง' },
  lucky:      { nameTh: 'ดวงดี',            emoji: '🍀', descTh: 'โอกาสเจอไข่ตอนสำรวจเพิ่มเป็น 2 เท่า' },
  tireless:   { nameTh: 'อึด',              emoji: '🔋', descTh: 'พลังงานลดตอนทำงานช้าลง 30%' },
  gourmet:    { nameTh: 'นักชิม',           emoji: '😋', descTh: 'กินอาหารแล้วได้ความสุขเพิ่ม 50%' },
};

export const TRAIT_SCALE = { common: 1, uncommon: 1.1, rare: 1.25, epic: 1.5, legendary: 2 };

export function getTraitDef(id) {
  return Object.prototype.hasOwnProperty.call(TRAITS, id) ? TRAITS[id] : null;
}

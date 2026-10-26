// V12 system mail. Pure data, no imports. state.mail keeps only { id, at, read, claimed }; the text and gift come from here.
// gift.limited = a LIMITED_PETS id (js/data/limited.js), gift.egg = an egg id put straight into the incubator (V14).
// minLevel: delivered on reaching that level. New entries reach every save once (state.mailSent).

export const MAIL_MAX = 20;

export const SYSTEM_MAILS = [
  {
    id: 'welcome_celestial',
    from: '🧚 นางฟ้าประจำฟาร์ม',
    title: 'ของขวัญต้อนรับ: ยูนิคอร์นดาราจักร 🌌',
    body: 'ยินดีต้อนรับสู่ฟาร์มน้องๆ นะ! นางฟ้าเก็บไข่ดาวดวงพิเศษไว้ให้เพื่อนรุ่นแรกของฟาร์มเท่านั้น ' +
      'ข้างในคือ "ดาราจักร" ยูนิคอร์นขนสีห้วงอวกาศที่มีออร่าสีรุ้งไม่ซ้ำใคร ฝากดูแลน้องให้ดีนะ ✨',
    gift: { limited: 'celestial' },
  },
  {
    id: 'gift_legend_egg',
    minLevel: 5,   // V14: arrives on reaching Lv.5 (day-1 income is too small for one more legendary: yard <= 20% rule)
    from: '🧚 นางฟ้าประจำฟาร์ม',
    title: 'ของขวัญเลเวล 5: ไข่ตำนาน 🥚✨',
    body: 'เก่งมากเลย! ฟาร์มเติบโตขึ้นเยอะแล้ว นางฟ้าเลยนำไข่ตำนานมาให้อีกหนึ่งใบ ' +
      'ข้างในเป็นน้องระดับตำนานตัวไหนก็ได้ ลุ้นกันเลยว่าจะได้ใคร! (รับแล้วไข่จะเข้าตู้ฟักทันที)',
    gift: { egg: 'egg_legend' },
  },
];

const BY_ID = new Map(SYSTEM_MAILS.map(m => [m.id, m]));
export const getMailDef = id => BY_ID.get(id) || null;

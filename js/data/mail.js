// V12 system mail. Pure data, no imports. state.mail keeps only { id, at, read, claimed }; the text and gift come from here.
// gift.limited = a LIMITED_PETS id (js/data/limited.js). New entries reach every save once (state.mailSent).

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
];

const BY_ID = new Map(SYSTEM_MAILS.map(m => [m.id, m]));
export const getMailDef = id => BY_ID.get(id) || null;

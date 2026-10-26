// Festival data (CONTRACT_V11): the weekly rotation, the special dates, the task pool, wishes and postcard templates.
// Pure data, imports nothing (state.js reads it to sanitise saves). The accessory / decor entries themselves live in
// accessories.js / decor.js (`festival: '<fest id>'`); this file only knows their ids, prices (in 🏮) and preview emoji.

export const TASK_REWARD = 2;          // lanterns per claimed task
export const TASKS_PER_FESTIVAL = 3;
export const LOGIN_MAX = 7;            // login lanterns per festival
export const LANTERN_MAX = 999;        // lanterns carried (sanitiser cap)
export const KRATHONG_MAX = 5;         // krathongs in stock
export const FLOAT_DAILY_CAP = 3;      // floats per day
export const FLOAT_PEAK_CAP = 5;       // floats on the night of loy (peak day, from PEAK_FROM_HOUR)
export const PEAK_FROM_HOUR = 18;
export const KRATHONG_RECIPE = { forage_herb: 3, forage_wood: 1 };
export const FLOAT_HAPPY = 2;
export const LEDGER_MAX = 10;         // festival keys remembered (tasks + login days), so returning to a key restores it
export const SEEN_DAYS_MAX = 30;       // recent days that already paid a login lantern, whatever the festival key
export const FLOAT_DAYS_MAX = 10;      // recent days whose float count is remembered

/** Featured habitat of the week = WEEKLY_ORDER[weeks since the fixed Monday 2024-01-01, mod 8]: every habitat returns every 8 weeks. */
export const WEEKLY_ORDER = ['farm', 'forest', 'bug', 'water', 'sky', 'savanna', 'polar', 'mystic'];

const weekly = (habitat, id, nameTh, emoji, item) => ({ id, kind: 'weekly', habitat, nameTh, emoji, items: [{ ...item, price: 6 }] });
const acc = (id, emoji, nameTh, slot) => ({ id, type: 'acc', slot, emoji, nameTh });
const decor = (id, emoji, nameTh) => ({ id, type: 'decor', slot: null, emoji, nameTh });

/** The 8 weekly festivals (one per habitat), each selling one accessory for 6 🏮. */
export const WEEKLY_FESTIVALS = [
  weekly('farm', 'fest_farm', 'เทศกาลเก็บเกี่ยว', '🌾', acc('acc_strawhat', '👒', 'หมวกฟาง', 'head')),
  weekly('forest', 'fest_forest', 'เทศกาลป่าเขียว', '🌲', acc('acc_leafcrown', '🍃', 'มงกุฎใบไม้', 'head')),
  weekly('bug', 'fest_bug', 'เทศกาลหิ่งห้อย', '✨', acc('acc_antenna', '🐞', 'หนวดแมลงน้อย', 'head')),
  weekly('water', 'fest_water', 'เทศกาลสายน้ำ', '🌊', acc('acc_floatie', '🛟', 'ห่วงยางจิ๋ว', 'neck')),
  weekly('sky', 'fest_sky', 'เทศกาลว่าว', '🪁', acc('acc_kitescarf', '🧣', 'ผ้าพันคอลายว่าว', 'neck')),
  weekly('savanna', 'fest_savanna', 'เทศกาลกลองทุ่ง', '🥁', acc('acc_beads', '📿', 'สร้อยลูกปัด', 'neck')),
  weekly('polar', 'fest_polar', 'เทศกาลหิมะ', '❄️', acc('acc_beanie', '🧶', 'หมวกไหมพรม', 'head')),
  weekly('mystic', 'fest_mystic', 'เทศกาลดวงดาว', '🔮', acc('acc_wizardhat', '🎩', 'หมวกพ่อมดดาว', 'head')),
];

/** Special festivals' look + shop (their dates are in SPECIALS, so a later year only adds a row there). */
export const SPECIAL_FESTIVALS = [
  {
    id: 'fest_loykrathong', kind: 'special', habitat: null, nameTh: 'ลอยกระทง', emoji: '🏮',
    items: [
      { ...acc('acc_chada', '👑', 'ชฎาน้อย', 'head'), price: 6 },
      { ...acc('acc_sabai', '🧣', 'ผ้าสไบ', 'neck'), price: 6 },
      { ...decor('decor_lanna_lamp', '🏮', 'โคมล้านนา'), price: 10 },
      { ...decor('decor_big_krathong', '🪷', 'กระทงยักษ์'), price: 10 },
    ],
  },
];

/**
 * Special windows, local dates 'YYYY-MM-DD', both ends inclusive (00:00 of `from` to 24:00 of `to`). While one is on it replaces the
 * weekly festival. ลอยกระทง 2569 = Tuesday 24 November 2026 (full moon of the 12th lunar month; checked on 2026-10-26).
 */
export const SPECIALS = [
  { id: 'fest_loykrathong', from: '2026-11-17', to: '2026-11-30', peakDay: '2026-11-24' },
];

export const FESTIVAL_DEFS = [...WEEKLY_FESTIVALS, ...SPECIAL_FESTIVALS];
export const FESTIVAL_IDS = FESTIVAL_DEFS.map(f => f.id);
export const getFestivalDef = id => FESTIVAL_DEFS.find(f => f.id === id) || null;

/** Every item any festival sells: [{ id, type: 'acc'|'decor', slot, emoji, nameTh, price, festival }]. */
export const SHOP_ITEMS = FESTIVAL_DEFS.flatMap(f => f.items.map(it => ({ ...it, festival: f.id })));
export const SHOP_ITEM_IDS = SHOP_ITEMS.map(it => it.id);
export const getShopItem = id => SHOP_ITEMS.find(it => it.id === id) || null;

/**
 * Task pool. kind = the festivalEvent kind that counts; h = a "native to the featured habitat" task (needs the habitat's egg unlocked;
 * the festival's habitat must match). nameTh may use {h} = the habitat's Thai name.
 */
export const TASK_POOL = [
  { id: 'hatch_h', kind: 'hatch', target: 1, h: true, emoji: '🐣', nameTh: 'ฟักน้องถิ่น{h}' },
  { id: 'trip_h', kind: 'expedition', target: 2, h: true, emoji: '🧭', nameTh: 'ส่งน้องถิ่น{h}ออกสำรวจ' },
  { id: 'feed_fav', kind: 'feed', target: 5, h: false, emoji: '⭐', nameTh: 'ป้อนของที่น้องชอบ' },
  { id: 'order', kind: 'order', target: 3, h: false, emoji: '📋', nameTh: 'ส่งออเดอร์' },
  { id: 'pat', kind: 'pat', target: 10, h: false, emoji: '🤚', nameTh: 'ลูบหัวน้อง' },
  { id: 'harvest', kind: 'harvest', target: 8, h: false, emoji: '🧺', nameTh: 'เก็บเกี่ยว' },
];
export const TASK_KINDS = [...new Set(TASK_POOL.map(t => t.kind))];
export const getTaskDef = id => TASK_POOL.find(t => t.id === id) || null;

/** Wishes written on the journal line "🪷 {name} ลอยกระทง ขอให้…" (12 cute templates, deterministic pick). */
export const WISH_TEMPLATES = [
  'ทุกคนที่ลานสุขภาพแข็งแรง',
  'พืชผลงอกงามทุกแปลง',
  'ได้กินของโปรดทุกวัน',
  'มีเพื่อนซี้ไปด้วยกันตลอดไป',
  'ฝนไม่ตกวันที่ตากผ้า',
  'ได้นอนหลับฝันดีทุกคืน',
  'ลานของเราสวยขึ้นทุกวัน',
  'ได้ไปสำรวจที่ไกลๆ แล้วกลับมาปลอดภัย',
  'เจ้าของฟาร์มยิ้มได้ทั้งวัน',
  'ไข่ทุกใบฟักออกมาเป็นน้องน่ารัก',
  'ขนนุ่มฟูตลอดปี',
  'ปีหน้ามีเทศกาลสนุกๆ อีกเยอะเลย',
];

/** Postcards that come from the new homes while ลอยกระทง is on (data only, no reward). {name} {species} like POSTCARD_TEMPLATES. */
export const KRATHONG_POSTCARDS = [
  '{name} ลอยกระทงที่บ้านใหม่ด้วยนะ แสงเทียนวิบวับสวยมาก 🪷',
  'คืนนี้ {name} ({species}) ขอพรให้ทุกคนที่ลานมีความสุข ส่งกระทงดอกบัวมาฝากด้วย 🏮',
  '{name} นั่งดูโคมลอยขึ้นฟ้าที่บ้านใหม่ นึกถึงลานของคุณเลย ✨',
];

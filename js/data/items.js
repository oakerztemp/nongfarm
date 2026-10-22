// Item catalogue: generated seeds/crops, forage, shop food, care items, eggs.
// Item = { id, emoji, nameTh, type, buy, sell, unlockLevel, food?: { hunger, happy, tags }, desc? }
// buy === null  -> not sold in the shop;  sell === null -> cannot be sold.
import { CROPS } from './crops.js';
import { EGGS } from './eggs.js';

export const ITEMS = {};

function add(item) {
  ITEMS[item.id] = item;
}

// ---- seeds + harvested crops (generated from CROPS) ----
const CROP_TAGS = {
  carrot: ['veg'],
  corn: ['grain', 'veg'],
  tomato: ['veg', 'fruit'],
  potato: ['veg'],
  lettuce: ['leaf', 'veg'],
  strawberry: ['fruit', 'sweet'],
  eggplant: ['veg'],
  chili: ['veg'],
  pumpkin: ['veg'],
  watermelon: ['fruit', 'sweet'],
  sunflower: ['grain'],
  rice: ['grain'],
  grape: ['fruit', 'sweet'],
  broccoli: ['veg', 'leaf'],
  sweetpotato: ['veg', 'sweet'],
  pineapple: ['fruit', 'sweet'],
};

for (const c of CROPS) {
  const tags = CROP_TAGS[c.id] || ['veg'];
  add({
    id: 'seed_' + c.id,
    emoji: c.emoji,
    nameTh: 'เมล็ด' + c.nameTh,
    type: 'seed',
    buy: c.seedPrice,
    sell: Math.floor(c.seedPrice / 2),
    unlockLevel: c.unlockLevel,
    desc: 'เมล็ดสำหรับปลูกในแปลงไร่',
  });
  add({
    id: 'crop_' + c.id,
    emoji: c.emoji,
    nameTh: c.nameTh,
    type: 'crop',
    buy: null,
    sell: c.sellPrice,
    unlockLevel: c.unlockLevel,
    food: {
      hunger: 10 + 2 * c.unlockLevel,
      happy: 1 + Math.round(c.unlockLevel / 3) + (tags.includes('sweet') ? 3 : 0),
      tags,
    },
    desc: 'ผลผลิตจากไร่ ขายหรือเอามาเลี้ยงน้องได้',
  });
}

// ---- forage (from expeditions) ----
const FORAGE = [
  // id, emoji, nameTh, sell, food|null
  ['forage_mushroom', '🍄', 'เห็ด',      5,   { hunger: 12, happy: 2,  tags: ['veg', 'leaf'] }],
  ['forage_berry',    '🫐', 'เบอร์รีป่า', 4,   { hunger: 10, happy: 4,  tags: ['fruit'] }],
  ['forage_honey',    '🍯', 'น้ำผึ้ง',    30,  { hunger: 15, happy: 12, tags: ['sweet'] }],
  ['forage_wood',     '🪵', 'ไม้ฟืน',     3,   null],
  ['forage_fish',     '🐟', 'ปลา',        14,  { hunger: 22, happy: 3,  tags: ['fish'] }],
  ['forage_shrimp',   '🦐', 'กุ้ง',       18,  { hunger: 20, happy: 4,  tags: ['fish'] }],
  ['forage_shell',    '🐚', 'เปลือกหอย',  12,  null],
  ['forage_stone',    '🪨', 'ก้อนหิน',    4,   null],
  ['forage_gem',      '💎', 'อัญมณี',     140, null],
  ['forage_bone',     '🦴', 'กระดูก',     6,  { hunger: 14, happy: 3,  tags: ['meat'] }],
  ['forage_feather',  '🪶', 'ขนนก',       14,  null],
  ['forage_star',     '🌟', 'เศษดาว',     260, null],
  ['forage_herb',     '🌿', 'สมุนไพร',    5,   { hunger: 10, happy: 2,  tags: ['veg', 'leaf'] }],
];
for (const [id, emoji, nameTh, sell, food] of FORAGE) {
  const item = { id, emoji, nameTh, type: 'forage', buy: null, sell, unlockLevel: 1, desc: 'ของที่ได้จากการออกสำรวจ' };
  if (food) item.food = food;
  add(item);
}

// ---- shop foods ----
const FOODS = [
  // id, emoji, nameTh, buy, unlock, food, desc
  ['food_kibble',  '🥣', 'อาหารเม็ด',   15, 1, { hunger: 30, happy: 2,  tags: ['grain', 'meat', 'veg', 'fish', 'insect'] }, 'อาหารเม็ดรวมมิตร น้องกินได้เกือบทุกตัว'],
  ['food_meat',    '🥩', 'เนื้อสด',     30, 2, { hunger: 45, happy: 5,  tags: ['meat'] },                                   'อิ่มนาน สำหรับสายกินเนื้อ'],
  ['food_milk',    '🥛', 'นมสด',        20, 1, { hunger: 25, happy: 6,  tags: ['milk'] },                                   'นมอุ่นๆ สำหรับน้องที่ชอบนม'],
  ['food_cake',    '🍰', 'เค้กหวาน',    60, 3, { hunger: 20, happy: 35, tags: ['sweet'] },                                  'สุขเต็มปรี่ แต่อิ่มไม่มาก'],
  ['food_leaf',    '🍃', 'ใบไม้สด',     12, 1, { hunger: 28, happy: 2,  tags: ['leaf'] },                                   'ใบไม้กรอบๆ สำหรับสายกินใบ'],
  ['food_seedmix', '🌰', 'เมล็ดธัญพืชรวม', 14, 1, { hunger: 28, happy: 4, tags: ['grain', 'insect'] },                         'ธัญพืชผสมโปรตีนจากแมลง'],
];
for (const [id, emoji, nameTh, buy, unlockLevel, food, desc] of FOODS) {
  add({ id, emoji, nameTh, type: 'food', buy, sell: Math.floor(buy / 2), unlockLevel, food, desc });
}

// ---- care items ----
const CARE = [
  ['care_soap',       '🧼', 'สบู่',     25, 1, 'อาบน้ำให้น้องสะอาดเอี่ยม (clean = 100)'],
  ['care_toy',        '🧸', 'ของเล่น',  40, 1, 'ให้น้องเล่น สุข +40'],
  ['care_medicine',   '💊', 'ยา',       50, 1, 'รักษาน้องที่ป่วย'],
  ['care_fertilizer', '🧪', 'ปุ๋ย',     60, 2, 'ใส่แปลงแล้วพืชโตเร็วขึ้น +25%'],
];
for (const [id, emoji, nameTh, buy, unlockLevel, desc] of CARE) {
  add({ id, emoji, nameTh, type: 'care', buy, sell: Math.floor(buy / 2), unlockLevel, desc });
}

// ---- eggs (merged from eggs.js) ----
for (const e of EGGS) {
  add({
    id: e.id,
    emoji: e.emoji,
    nameTh: e.nameTh,
    type: 'egg',
    buy: e.price,
    sell: null,
    unlockLevel: e.unlockLevel || 1,
    desc: 'ไข่สำหรับฟักในตู้ฟัก',
  });
}

export function getItem(id) {
  return Object.prototype.hasOwnProperty.call(ITEMS, id) ? ITEMS[id] : null;
}

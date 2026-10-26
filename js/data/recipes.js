// V16 kitchen recipes (CONTRACT_V16 §1). Pure data, no imports.
// A dish is an item (type 'dish', built in items.js): it can't be bought or sold, only cooked here and fed to a pet.
// Economy rules (tests/v16.test.js): food.hunger <= 2 x the summed sell value of the ingredients (kibble: 2 hunger / coin), so cooking
// is never a cheaper way to fill pets than the shop; food.happy is that of plain shop food (<= 6, milk). Happy is income here: a pet at
// happy >= 70 pays the full yard gift rate, and the sim showed a +8 happy dish lifting a day-1 yard from 13% to 22% of income. The
// reward is cuteness only: the 😋 treat look, reactions in the yard, favourite dishes.

export const TREAT_MS = 3 * 60 * 60 * 1000;   // how long the 😋 อิ่มอร่อย look lasts after a dish

export const RECIPES = [
  { id: 'dish_salad',    emoji: '🥗', nameTh: 'สลัดผักรวม',    unlockLevel: 1, ingredients: { crop_carrot: 2, crop_corn: 1 },
    food: { hunger: 28, happy: 5, tags: ['veg', 'grain', 'leaf'] }, desc: 'แครอทกรอบกับข้าวโพดหวาน เมนูแรกของครัว' },
  { id: 'dish_tomsoup',  emoji: '🍅', nameTh: 'ซุปมะเขือเทศ',  unlockLevel: 2, ingredients: { crop_tomato: 1, crop_potato: 1 },
    food: { hunger: 45, happy: 5, tags: ['veg'] }, desc: 'ซุปอุ่นๆ หอมมะเขือเทศ ซดแล้วยิ้มแก้มปริ' },
  { id: 'dish_fishcongee', emoji: '🍲', nameTh: 'ข้าวต้มปลา',  unlockLevel: 2, ingredients: { forage_fish: 1, crop_corn: 1, forage_herb: 1 },
    food: { hunger: 45, happy: 5, tags: ['fish', 'grain'] }, desc: 'ข้าวต้มร้อนๆ ใส่ปลากับสมุนไพร' },
  { id: 'dish_stew',     emoji: '🍖', nameTh: 'สตูว์เนื้อ',     unlockLevel: 3, ingredients: { food_meat: 1, crop_potato: 1, forage_herb: 1 },
    food: { hunger: 55, happy: 5, tags: ['meat'] }, desc: 'เนื้อตุ๋นนุ่มๆ กับมันฝรั่ง สำหรับสายกินเนื้อ' },
  { id: 'dish_greens',   emoji: '🥬', nameTh: 'สลัดใบเขียว',   unlockLevel: 3, ingredients: { crop_lettuce: 1, forage_herb: 2 },
    food: { hunger: 55, happy: 5, tags: ['leaf', 'veg'] }, desc: 'ผักกาดสดกับสมุนไพรหอมๆ' },
  { id: 'dish_smoothie', emoji: '🍹', nameTh: 'สมูทตี้เบอร์รี่', unlockLevel: 4, ingredients: { crop_strawberry: 1, forage_berry: 2, food_milk: 1 },
    food: { hunger: 30, happy: 5, tags: ['fruit', 'sweet', 'milk'] }, desc: 'สตรอว์เบอร์รี่ปั่นกับนม สีชมพูน่ารัก' },
  { id: 'dish_pie',      emoji: '🥧', nameTh: 'พายฟักทอง',     unlockLevel: 6, ingredients: { crop_pumpkin: 1, food_milk: 1 },
    food: { hunger: 45, happy: 5, tags: ['veg', 'sweet'] }, desc: 'พายฟักทองอบใหม่ หอมไปทั้งลาน' },
  { id: 'dish_fruitparty', emoji: '🍉', nameTh: 'ปาร์ตี้ผลไม้', unlockLevel: 7, ingredients: { crop_watermelon: 1, crop_strawberry: 1 },
    food: { hunger: 45, happy: 5, tags: ['fruit', 'sweet'] }, desc: 'ผลไม้หั่นเต็มจาน ฉลองวันดีๆ' },
  { id: 'dish_seedbar',  emoji: '🍪', nameTh: 'ขนมธัญพืช',     unlockLevel: 8, ingredients: { crop_sunflower: 1, crop_corn: 2 },
    food: { hunger: 50, happy: 5, tags: ['grain', 'insect', 'sweet'] }, desc: 'ขนมกรุบกรอบจากเมล็ดทานตะวัน' },
];

const BY_ID = new Map(RECIPES.map(r => [r.id, r]));
export const getRecipe = id => BY_ID.get(id) || null;

/**
 * A species' favourite dish: the recipe sharing the most food tags with its diet (ties: the earlier recipe). Deterministic,
 * so the player can discover it once and it stays the same. species: an entry of species.js (needs .diet).
 */
export function favoriteDish(species) {
  if (!species || !Array.isArray(species.diet)) return null;
  let best = null, score = 0;
  for (const r of RECIPES) {
    const s = r.food.tags.filter(t => species.diet.includes(t)).length;
    if (s > score) { best = r; score = s; }
  }
  return best;
}

// V16 kitchen (CONTRACT_V16 §1): cook a recipe from farm crops + forage into a dish item. DOM-free.
// Feeding a dish goes through pets.js feedPet (treat glow + favourite dish there).
import { countItem, removeItem, addItem, bumpStat } from './state.js';
import { RECIPES, getRecipe } from './data/recipes.js';
import { getItem } from './data/items.js';

const fail = reason => ({ ok: false, reason });

/** What the kitchen shows for one recipe: { recipe, locked, parts: [{ item, need, have }], ok }. */
export function recipeStatus(state, recipe) {
  const locked = (state.player.level || 1) < recipe.unlockLevel;
  const parts = Object.entries(recipe.ingredients).map(([id, need]) => ({ item: getItem(id), need, have: countItem(state, id) }));
  return { recipe, locked, parts, ok: !locked && parts.every(p => p.have >= p.need) };
}

export const kitchenList = state => RECIPES.map(r => recipeStatus(state, r));

/** Cooks one dish: ingredients out, the dish into the bag. */
export function cook(state, recipeId) {
  const r = getRecipe(recipeId);
  if (!r) return fail('ไม่รู้จักเมนูนี้');
  const st = recipeStatus(state, r);
  if (st.locked) return fail(`ทำ${r.nameTh}ได้ที่เลเวล ${r.unlockLevel}`);
  const short = st.parts.find(p => p.have < p.need);
  if (short) return fail(`${short.item ? short.item.nameTh : 'วัตถุดิบ'}ไม่พอ (มี ${short.have}/${short.need})`);
  for (const p of st.parts) removeItem(state, p.item.id, p.need);
  addItem(state, r.id, 1);
  bumpStat(state, 'cooked');
  return { ok: true, msg: `🍳 ทำ${r.emoji} ${r.nameTh}เสร็จแล้ว! ลากไปป้อนน้องในลานได้เลย`, dish: r.id };
}

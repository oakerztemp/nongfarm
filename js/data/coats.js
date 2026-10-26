// Coat colours (CONTRACT_V10 §2). A bred baby can inherit or mutate into a coat; every other pet is 'base'.
//   weight = mutation weight (base is never a mutation, weight 0).
//   hue / sat / light = the body-colour recolour critters.js applies to body-like ('tm') colours in 3D:
//     hue = the coat's target hue in degrees, sat = target saturation, light = lightness multiplier (1 = unchanged). Base is untouched.

export const COATS = [
  { id: 'base',     nameTh: 'ขนปกติ',        emoji: '⚪', weight: 0,  hue: 0,   sat: 1,    light: 1 },
  { id: 'cream',    nameTh: 'สีครีม',        emoji: '🍦', weight: 30, hue: 45,  sat: 0.45, light: 1.12 },
  { id: 'cocoa',    nameTh: 'สีโกโก้',       emoji: '🍫', weight: 30, hue: 25,  sat: 0.4,  light: 0.72 },
  { id: 'mint',     nameTh: 'สีมิ้นต์',      emoji: '🌿', weight: 20, hue: 150, sat: 0.42, light: 1.05 },
  { id: 'rose',     nameTh: 'สีชมพูกุหลาบ',  emoji: '🌸', weight: 15, hue: 340, sat: 0.5,  light: 1.08 },
  { id: 'midnight', nameTh: 'สีเที่ยงคืน',   emoji: '🌙', weight: 5,  hue: 230, sat: 0.4,  light: 0.62 },
];

const BY_ID = new Map(COATS.map(c => [c.id, c]));

export const COAT_IDS = COATS.map(c => c.id);
export const MUTATION_COATS = COATS.filter(c => c.weight > 0);

/** The coat with this id, or null. */
export function getCoat(id) {
  return BY_ID.get(id) || null;
}

/** The pet's coat id; a missing or unknown one is 'base'. */
export function coatOf(pet) {
  return pet && BY_ID.has(pet.coat) ? pet.coat : 'base';
}

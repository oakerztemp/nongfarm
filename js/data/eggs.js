// Egg catalogue: one egg per habitat. Hatching picks a species of that habitat.

const MIN = 60 * 1000;
const SEC = 1000;

export const EGGS = [
  { id: 'egg_farm',    emoji: '🥚', nameTh: 'ไข่ทุ่งนา',       habitat: 'farm',    price: 100,  unlockLevel: 1,  hatchMs: 30 * SEC, color: '#f6e7b0' },
  { id: 'egg_forest',  emoji: '🥚', nameTh: 'ไข่ป่าใหญ่',      habitat: 'forest',  price: 250,  unlockLevel: 2,  hatchMs: 2 * MIN,  color: '#bfe3a8' },
  { id: 'egg_bug',     emoji: '🥚', nameTh: 'ไข่แมลงน้อย',     habitat: 'bug',     price: 300,  unlockLevel: 3,  hatchMs: 3 * MIN,  color: '#e4efa0' },
  { id: 'egg_water',   emoji: '🥚', nameTh: 'ไข่แหล่งน้ำ',     habitat: 'water',   price: 400,  unlockLevel: 4,  hatchMs: 5 * MIN,  color: '#a8d8f0' },
  { id: 'egg_sky',     emoji: '🥚', nameTh: 'ไข่ท้องฟ้า',      habitat: 'sky',     price: 600,  unlockLevel: 5,  hatchMs: 8 * MIN,  color: '#c9d9ff' },
  { id: 'egg_savanna', emoji: '🥚', nameTh: 'ไข่ทุ่งสะวันนา',  habitat: 'savanna', price: 900,  unlockLevel: 7,  hatchMs: 10 * MIN, color: '#f5c98a' },
  { id: 'egg_polar',   emoji: '🥚', nameTh: 'ไข่ขั้วโลก',      habitat: 'polar',   price: 1300, unlockLevel: 8,  hatchMs: 12 * MIN, color: '#d6f1fb' },
  { id: 'egg_mystic',  emoji: '🥚', nameTh: 'ไข่ดินแดนตำนาน',  habitat: 'mystic',  price: 2000, unlockLevel: 10, hatchMs: 15 * MIN, color: '#e0c3f5' },
];

// The family egg (CONTRACT_V10) lives in an incubator slot as eggId 'egg_family' so getEgg() never returns null for it.
// It is deliberately NOT in EGGS: the shop, the sell list, the stardust shop and expedition drops iterate EGGS, and a
// family egg can't be bought, sold or gifted. hatchMs is 0 here; the real time comes from breeding.js familyEggHatchMs().
export const FAMILY_EGG = { id: 'egg_family', emoji: '🥚', nameTh: 'ไข่ครอบครัว', habitat: null, price: 0, unlockLevel: 99, hatchMs: 0, color: '#ffd3e4', family: true };

// V14 legendary egg: only from system mail (claimMail puts it straight into the incubator). Not in EGGS for the same reasons
// as the family egg (no shop, sell, stardust or drop path). Hatches a random legendary species (pets.js hatchReady).
export const LEGEND_EGG = { id: 'egg_legend', emoji: '🥚', nameTh: 'ไข่ตำนาน', habitat: null, price: 0, unlockLevel: 99, hatchMs: 10 * MIN, color: '#ffd36b', legend: true };

const BY_ID = new Map([...EGGS, FAMILY_EGG, LEGEND_EGG].map(e => [e.id, e]));

export function getEgg(id) {
  return BY_ID.get(id) || null;
}

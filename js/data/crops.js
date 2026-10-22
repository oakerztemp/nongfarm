// Crop catalogue (16 crops). Static data only.
// Economy target: profit per hour (sellPrice * avg yield - seedPrice) rises gently from
// ~150/h (carrot) to ~420/h (pineapple); short crops need attention, long crops pay per harvest.
// Crops >= 1 h carry a yield bonus so that someone checking in every 2-4 h still earns more per hour
// from long crops (see tests/econ-sim.test.js). XP per harvest is deliberately flat at the top end.
// jobs = work aptitudes (keys of JOBS in species.js) that help this crop grow / yield more.

const MIN = 60 * 1000;

export const CROPS = [
  { id: 'carrot',      emoji: '🥕', nameTh: 'แครอท',        seedPrice: 3,   sellPrice: 4,   growMs: 2 * MIN,   yield: [2, 3], unlockLevel: 1,  jobs: ['dig', 'water'],       xp: 3 },
  { id: 'corn',        emoji: '🌽', nameTh: 'ข้าวโพด',      seedPrice: 5,   sellPrice: 6,   growMs: 5 * MIN,   yield: [2, 4], unlockLevel: 1,  jobs: ['carry', 'water'],     xp: 4 },
  { id: 'tomato',      emoji: '🍅', nameTh: 'มะเขือเทศ',    seedPrice: 9,   sellPrice: 13,  growMs: 10 * MIN,  yield: [2, 4], unlockLevel: 2,  jobs: ['pollinate', 'water'], xp: 6 },
  { id: 'potato',      emoji: '🥔', nameTh: 'มันฝรั่ง',     seedPrice: 14,  sellPrice: 19,  growMs: 15 * MIN,  yield: [3, 4], unlockLevel: 2,  jobs: ['dig', 'water'],       xp: 7 },
  { id: 'lettuce',     emoji: '🥬', nameTh: 'ผักกาด',       seedPrice: 21,  sellPrice: 27,  growMs: 20 * MIN,  yield: [3, 4], unlockLevel: 3,  jobs: ['water', 'guard'],     xp: 9 },
  { id: 'strawberry',  emoji: '🍓', nameTh: 'สตรอว์เบอร์รี', seedPrice: 34,  sellPrice: 38,  growMs: 30 * MIN,  yield: [3, 5], unlockLevel: 4,  jobs: ['pollinate', 'guard'], xp: 11 },
  { id: 'eggplant',    emoji: '🍆', nameTh: 'มะเขือม่วง',   seedPrice: 42, sellPrice: 48,  growMs: 45 * MIN,  yield: [3, 5], unlockLevel: 5,  jobs: ['pollinate', 'water'], xp: 13 },
  { id: 'chili',       emoji: '🌶️', nameTh: 'พริก',         seedPrice: 56, sellPrice: 43,  growMs: 60 * MIN,  yield: [5, 7], unlockLevel: 5,  jobs: ['pollinate', 'guard'], xp: 14 },
  { id: 'pumpkin',     emoji: '🎃', nameTh: 'ฟักทอง',       seedPrice: 73, sellPrice: 56,  growMs: 75 * MIN,  yield: [5, 7], unlockLevel: 6,  jobs: ['carry', 'guard'],     xp: 15 },
  { id: 'watermelon',  emoji: '🍉', nameTh: 'แตงโม',        seedPrice: 90, sellPrice: 68, growMs: 90 * MIN,  yield: [5, 7], unlockLevel: 7,  jobs: ['carry', 'water'],     xp: 16 },
  { id: 'sunflower',   emoji: '🌻', nameTh: 'ทานตะวัน',     seedPrice: 93, sellPrice: 60, growMs: 105 * MIN, yield: [6, 8], unlockLevel: 8,  jobs: ['pollinate', 'fly'],   xp: 14 },
  { id: 'rice',        emoji: '🌾', nameTh: 'ข้าว',         seedPrice: 104, sellPrice: 63, growMs: 120 * MIN, yield: [6, 9], unlockLevel: 9,  jobs: ['water', 'carry'],     xp: 14 },
  { id: 'grape',       emoji: '🍇', nameTh: 'องุ่น',        seedPrice: 116, sellPrice: 70, growMs: 150 * MIN, yield: [6, 9], unlockLevel: 10, jobs: ['pollinate', 'fly'],   xp: 15 },
  { id: 'broccoli',    emoji: '🥦', nameTh: 'บร็อกโคลี',    seedPrice: 127, sellPrice: 68, growMs: 180 * MIN, yield: [7, 10], unlockLevel: 11, jobs: ['water', 'guard'],     xp: 15 },
  { id: 'sweetpotato', emoji: '🍠', nameTh: 'มันเทศ',       seedPrice: 147, sellPrice: 83, growMs: 210 * MIN, yield: [7, 9], unlockLevel: 12, jobs: ['dig', 'carry'],       xp: 16 },
  { id: 'pineapple',   emoji: '🍍', nameTh: 'สับปะรด',      seedPrice: 169, sellPrice: 85, growMs: 240 * MIN, yield: [8, 10], unlockLevel: 12, jobs: ['carry', 'guard'],     xp: 16 },
];

const BY_ID = new Map(CROPS.map(c => [c.id, c]));

export function getCrop(id) {
  return BY_ID.get(id) || null;
}

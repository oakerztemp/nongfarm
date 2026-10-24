// Yard decorations (V7 §3): cosmetic + behaviour only (no stat bonus, so the economy is untouched beyond the build cost).
// Each is built from gathered materials plus a few coins, kept in state.inventoryDecor until placed on a yard spot,
// and cannot be sold (removing it just puts it back in the bag), so there is no buy->sell loop.
// Decor = { id, emoji, nameTh, use, useTh, coins, items: { itemId: n } }; `use` is the behaviour key pets read (petBehaviour).
export const DECOR = [
  { id: 'bed',    emoji: '🛏️', nameTh: 'ที่นอนนุ่ม',     use: 'nap',  useTh: 'น้องมานอนงีบ',     coins: 60,  items: { forage_wood: 4, forage_feather: 2 } },
  { id: 'bowl',   emoji: '🥣', nameTh: 'ชามอาหาร',      use: 'eat',  useTh: 'น้องมากินข้าว',    coins: 40,  items: { forage_wood: 2, forage_shell: 2 } },
  { id: 'ball',   emoji: '⚽', nameTh: 'ลูกบอล',        use: 'kick', useTh: 'น้องเตะเล่น',      coins: 30,  items: { forage_wood: 2, forage_herb: 3 } },
  { id: 'horse',  emoji: '🐴', nameTh: 'ม้าโยก',        use: 'rock', useTh: 'น้องนั่งโยก',      coins: 120, items: { forage_wood: 8, forage_stone: 3 } },
  { id: 'leaves', emoji: '🍂', nameTh: 'กองใบไม้',      use: 'jump', useTh: 'น้องกระโดดเล่น',   coins: 25,  items: { forage_herb: 5, forage_berry: 3 } },
  { id: 'sign',   emoji: '🪧', nameTh: 'ป้ายชื่อฟาร์ม',  use: 'sign', useTh: 'โชว์ชื่อฟาร์ม',    coins: 80,  items: { forage_wood: 6, forage_stone: 4 } },
];

export function getDecor(id) {
  return DECOR.find(d => d.id === id) || null;
}

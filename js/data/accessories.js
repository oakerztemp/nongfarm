// Pet accessories (V9 §1): purely cosmetic, one slot each ('head' or 'neck'). Owned copies live in state.wardrobe { accId: count };
// a pet wears them via pet.wear = { head, neck } (pets side). They can never be sold, so there is no buy->sell loop.
// price = shop price in coins (a late-game coin sink); price null = expedition-only, `zone` = where it drops (~1% per trip).
export const ACC_SLOTS = ['head', 'neck'];
export const ACC_DROP_CHANCE = 0.01;

export const ACCESSORIES = [
  // head
  { id: 'acc_bow',        slot: 'head', emoji: '🎀', nameTh: 'โบว์',            price: 300,  zone: null },
  { id: 'acc_cap',        slot: 'head', emoji: '🧢', nameTh: 'หมวกแก๊ป',        price: 800,  zone: null },
  { id: 'acc_widehat',    slot: 'head', emoji: '👒', nameTh: 'หมวกปีกกว้าง',    price: 1200, zone: null },
  { id: 'acc_tophat',     slot: 'head', emoji: '🎩', nameTh: 'หมวกทรงสูง',      price: 2000, zone: null },
  { id: 'acc_crown',      slot: 'head', emoji: '👑', nameTh: 'มงกุฎดอกไม้',     price: null, zone: 'forest' },
  { id: 'acc_grad',       slot: 'head', emoji: '🎓', nameTh: 'หมวกรับปริญญา',   price: null, zone: 'mountain' },
  // neck
  { id: 'acc_bell',       slot: 'neck', emoji: '🔔', nameTh: 'กระดิ่ง',         price: 400,  zone: null },
  { id: 'acc_scarf',      slot: 'neck', emoji: '🧣', nameTh: 'ผ้าพันคอ',        price: 600,  zone: null },
  { id: 'acc_lei',        slot: 'neck', emoji: '📿', nameTh: 'สร้อยดอกไม้',     price: 1500, zone: null },
  { id: 'acc_butterfly',  slot: 'neck', emoji: '🦋', nameTh: 'หูกระต่ายผีเสื้อ', price: null, zone: 'cloud' },
];

export function getAccessory(id) {
  return ACCESSORIES.find(a => a.id === id) || null;
}
export const isAccessoryId = id => !!getAccessory(id);
export const accessoriesBySlot = slot => ACCESSORIES.filter(a => a.slot === slot);
export const shopAccessories = () => ACCESSORIES.filter(a => a.price != null);
export const expeditionAccessories = zoneId => ACCESSORIES.filter(a => a.price == null && (!zoneId || a.zone === zoneId));

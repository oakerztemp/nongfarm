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

// V11 festival accessories (CONTRACT_V11 §2): sold ONLY in their festival's shop for lanterns (`lanterns`), never for coins, never for sale back.
// They live in their own list so ACCESSORIES (the coin shop + expedition list the UI walks) stays exactly as it was; getAccessory / accessoriesBySlot / isAccessoryId
// see both lists, so wearing, the wardrobe, the sanitiser and the 3D meshes treat them like any other accessory. price null + zone null = no coin shop, no expedition drop.
export const FESTIVAL_ACCESSORIES = [
  { id: 'acc_strawhat',  slot: 'head', emoji: '👒', nameTh: 'หมวกฟาง',          price: null, zone: null, festival: 'fest_farm',    lanterns: 6 },
  { id: 'acc_leafcrown', slot: 'head', emoji: '🍃', nameTh: 'มงกุฎใบไม้',       price: null, zone: null, festival: 'fest_forest',  lanterns: 6 },
  { id: 'acc_antenna',   slot: 'head', emoji: '🐞', nameTh: 'หนวดแมลงน้อย',     price: null, zone: null, festival: 'fest_bug',     lanterns: 6 },
  { id: 'acc_beanie',    slot: 'head', emoji: '🧶', nameTh: 'หมวกไหมพรม',       price: null, zone: null, festival: 'fest_polar',   lanterns: 6 },
  { id: 'acc_wizardhat', slot: 'head', emoji: '🎩', nameTh: 'หมวกพ่อมดดาว',     price: null, zone: null, festival: 'fest_mystic',  lanterns: 6 },
  { id: 'acc_chada',     slot: 'head', emoji: '👑', nameTh: 'ชฎาน้อย',          price: null, zone: null, festival: 'fest_loykrathong', lanterns: 6 },
  { id: 'acc_floatie',   slot: 'neck', emoji: '🛟', nameTh: 'ห่วงยางจิ๋ว',      price: null, zone: null, festival: 'fest_water',   lanterns: 6 },
  { id: 'acc_kitescarf', slot: 'neck', emoji: '🧣', nameTh: 'ผ้าพันคอลายว่าว',  price: null, zone: null, festival: 'fest_sky',     lanterns: 6 },
  { id: 'acc_beads',     slot: 'neck', emoji: '📿', nameTh: 'สร้อยลูกปัด',      price: null, zone: null, festival: 'fest_savanna', lanterns: 6 },
  { id: 'acc_sabai',     slot: 'neck', emoji: '🧣', nameTh: 'ผ้าสไบ',           price: null, zone: null, festival: 'fest_loykrathong', lanterns: 6 },
];
export const ALL_ACCESSORIES = [...ACCESSORIES, ...FESTIVAL_ACCESSORIES];

export function getAccessory(id) {
  return ALL_ACCESSORIES.find(a => a.id === id) || null;
}
export const isAccessoryId = id => !!getAccessory(id);
export const isFestivalAccessory = id => FESTIVAL_ACCESSORIES.some(a => a.id === id);
export const accessoriesBySlot = slot => ALL_ACCESSORIES.filter(a => a.slot === slot);
export const shopAccessories = () => ACCESSORIES.filter(a => a.price != null && !a.festival);
export const expeditionAccessories = zoneId => ACCESSORIES.filter(a => a.price == null && !a.festival && (!zoneId || a.zone === zoneId));

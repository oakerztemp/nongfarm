// Species catalogue for NongFarm. Pure data, no DOM, no imports.
// Emoji are limited to Unicode <= 14 so they render on Windows 11 Segoe UI Emoji.

export const HABITATS = {
  farm:    { nameTh: 'ทุ่งนา',        emoji: '🌾' },
  forest:  { nameTh: 'ป่าใหญ่',       emoji: '🌲' },
  water:   { nameTh: 'แหล่งน้ำ',      emoji: '🌊' },
  sky:     { nameTh: 'ท้องฟ้า',       emoji: '☁️' },
  bug:     { nameTh: 'แมลงน้อย',      emoji: '🍃' },
  savanna: { nameTh: 'ทุ่งสะวันนา',   emoji: '🌅' },
  polar:   { nameTh: 'ขั้วโลก',       emoji: '❄️' },
  mystic:  { nameTh: 'ดินแดนตำนาน',   emoji: '🔮' },
};

export const RARITIES = {
  common:    { nameTh: 'ทั่วไป',   weight: 60, color: '#8e9aa6' },
  uncommon:  { nameTh: 'ไม่ธรรมดา', weight: 25, color: '#3fae72' },
  rare:      { nameTh: 'หายาก',    weight: 10, color: '#3f8cff' },
  epic:      { nameTh: 'มหากาพย์', weight: 4,  color: '#9b5de5' },
  legendary: { nameTh: 'ตำนาน',    weight: 1,  color: '#f2a516' },
};

export const JOBS = {
  dig:       { nameTh: 'ขุดดิน',      emoji: '⛏️' },
  water:     { nameTh: 'รดน้ำ',       emoji: '💧' },
  pollinate: { nameTh: 'ผสมเกสร',     emoji: '🌼' },
  guard:     { nameTh: 'เฝ้าไร่',      emoji: '🛡️' },
  carry:     { nameTh: 'แบกของ',      emoji: '📦' },
  forage:    { nameTh: 'หาของป่า',    emoji: '🧺' },
  fish:      { nameTh: 'จับปลา',      emoji: '🎣' },
  fly:       { nameTh: 'บินสำรวจ',    emoji: '🕊️' },
};

// trait = id from traits.js (one passive perk per species).
// Compact constructor keeps the table below readable.
function sp(id, emoji, nameTh, habitat, rarity, jobs, diet, favorite, desc, trait) {
  return { id, emoji, nameTh, habitat, rarity, jobs, diet, favorite, desc, trait };
}

export const SPECIES = [
  // ───────── ทุ่งนา (farm) ─────────
  sp('hamster', '🐹', 'แฮมสเตอร์', 'farm', 'common', { dig: 3, carry: 1 }, ['grain', 'veg'], 'crop_corn', 'ตัวจิ๋วแก้มตุ่ย ขุดดินเก่งที่สุดในคอก', 'digger'),
  sp('chicken', '🐔', 'ไก่', 'farm', 'common', { forage: 2, dig: 1 }, ['grain', 'insect'], 'food_seedmix', 'คุ้ยเขี่ยหาเมล็ดพืชตั้งแต่เช้าตรู่', 'earlyBird'),
  sp('cow', '🐮', 'วัว', 'farm', 'common', { carry: 2, dig: 1 }, ['leaf', 'grain', 'veg'], 'food_leaf', 'ใจเย็น แบกของหนักได้สบายๆ', 'tireless'),
  sp('pig', '🐷', 'หมู', 'farm', 'common', { dig: 2, forage: 2 }, ['veg', 'fruit', 'grain'], 'crop_potato', 'จมูกไวมาก ดมหาของกินใต้ดินได้', 'gourmet'),
  sp('sheep', '🐑', 'แกะ', 'farm', 'common', { carry: 2, guard: 1 }, ['leaf', 'veg'], 'crop_lettuce', 'ขนฟูนุ่ม ชอบนอนกลิ้งบนหญ้า', 'teamPlayer'),
  sp('goat', '🐐', 'แพะ', 'farm', 'common', { forage: 2, dig: 1 }, ['leaf', 'veg'], 'forage_herb', 'กินได้ทุกอย่าง ซนปีนป่ายเก่ง', 'forager'),
  sp('duck', '🦆', 'เป็ด', 'farm', 'common', { forage: 2, water: 1, fish: 1 }, ['grain', 'insect', 'fish'], 'forage_shrimp', 'เดินเตาะแตะ ว่ายน้ำหาของกินได้', 'waterLover'),
  sp('cat', '🐱', 'แมว', 'farm', 'common', { guard: 2, forage: 1 }, ['meat', 'fish', 'milk'], 'food_milk', 'เฝ้าไร่ไล่หนูตัวจริง แต่ชอบอ้อน', 'loner'),
  sp('dog', '🐶', 'สุนัข', 'farm', 'common', { guard: 3, forage: 1 }, ['meat', 'grain'], 'food_kibble', 'เพื่อนซี้ผู้ซื่อสัตย์ เห่าไล่ขโมยทุกราย', 'teamPlayer'),
  sp('mouse', '🐭', 'หนูนา', 'farm', 'common', { forage: 2, dig: 1 }, ['grain', 'sweet'], 'crop_sunflower', 'ตัวเล็กแต่แอบกินเก่ง', 'forager'),
  sp('rabbit', '🐰', 'กระต่าย', 'farm', 'uncommon', { dig: 2, forage: 1 }, ['veg', 'leaf'], 'crop_carrot', 'หูยาวกระโดดไว ขุดรูได้ลึก', 'lucky'),
  sp('rooster', '🐓', 'ไก่ชน', 'farm', 'uncommon', { guard: 2, forage: 1 }, ['grain', 'insect'], 'crop_rice', 'ขันปลุกฟาร์มทุกเช้า ใจกล้ามาก', 'earlyBird'),
  sp('horse', '🐴', 'ม้า', 'farm', 'uncommon', { carry: 3, guard: 1 }, ['grain', 'veg', 'leaf'], 'crop_carrot', 'วิ่งเร็ว แข็งแรง ลากของได้เป็นกอง', 'tireless'),
  sp('buffalo', '🐃', 'ควาย', 'farm', 'uncommon', { carry: 3, dig: 2, water: 1 }, ['leaf', 'grain'], 'food_leaf', 'เพื่อนชาวนาไทย ไถนาเก่งสุดๆ', 'digger'),
  sp('rat', '🐀', 'หนูพุก', 'farm', 'uncommon', { dig: 2, forage: 2 }, ['grain', 'veg', 'sweet'], 'crop_sweetpotato', 'ขุดโพรงใต้ไร่ได้เป็นร้อยเมตร', 'digger'),
  sp('servicedog', '🐕‍🦺', 'สุนัขกู้ภัย', 'farm', 'uncommon', { guard: 3, carry: 1 }, ['meat', 'grain'], 'food_meat', 'ใส่เสื้อกั๊กเท่ๆ ดูแลความปลอดภัยทั้งฟาร์ม', 'teamPlayer'),
  sp('llama', '🦙', 'ลามะ', 'farm', 'rare', { carry: 3, guard: 1 }, ['leaf', 'veg'], 'crop_potato', 'ลามะหน้าตลก แบกของข้ามเขาได้สบาย', 'harvester'),
  sp('dairycow', '🐄', 'วัวนมพันธุ์ดี', 'farm', 'rare', { carry: 2, water: 1, forage: 1 }, ['leaf', 'grain'], 'food_milk', 'ให้นมสดหอมหวาน ใจดีที่สุดในทุ่ง', 'harvester'),
  sp('turkey', '🦃', 'ไก่งวง', 'farm', 'epic', { guard: 2, forage: 2 }, ['grain', 'insect', 'fruit'], 'crop_pumpkin', 'กางหางสง่างาม ไม่มีใครกล้ามายุ่ง', 'harvester'),
  sp('poodle', '🐩', 'พุดเดิ้ลแสนรู้', 'farm', 'epic', { guard: 2, forage: 2, carry: 1 }, ['meat', 'sweet'], 'food_cake', 'ฉลาดล้ำ ทำได้ทุกอย่างถ้ามีขนมเป็นรางวัล', 'gourmet'),
  sp('racehorse', '🐎', 'ม้าสายฟ้า', 'farm', 'legendary', { carry: 3, guard: 2, forage: 2 }, ['grain', 'fruit', 'sweet'], 'crop_watermelon', 'ตำนานแห่งทุ่งนา วิ่งเร็วจนเห็นแต่ฝุ่น', 'tireless'),

  // ───────── ป่าใหญ่ (forest) ─────────
  sp('squirrel', '🐿️', 'กระรอก', 'forest', 'common', { forage: 3, carry: 1 }, ['grain', 'fruit'], 'forage_berry', 'ซุกซนปีนต้นไม้ เก็บเมล็ดไว้เต็มแก้ม', 'harvester'),
  sp('deer', '🦌', 'กวาง', 'forest', 'common', { forage: 2, guard: 1 }, ['leaf', 'veg', 'fruit'], 'forage_herb', 'เดินเงียบกริบ หูไวมาก', 'earlyBird'),
  sp('boar', '🐗', 'หมูป่า', 'forest', 'common', { dig: 3, forage: 2 }, ['veg', 'fruit', 'meat'], 'crop_sweetpotato', 'งาแหลมขุดรากไม้ได้ทั้งวัน', 'digger'),
  sp('fox', '🦊', 'จิ้งจอก', 'forest', 'common', { forage: 2, guard: 1 }, ['meat', 'fruit', 'insect'], 'crop_grape', 'เจ้าเล่ห์แต่น่ารัก หาของกินเก่ง', 'nightOwl'),
  sp('hedgehog', '🦔', 'เม่นแคระ', 'forest', 'common', { forage: 2, dig: 1 }, ['insect', 'fruit'], 'forage_mushroom', 'ขนหนามนุ่มๆ ขี้อายนิดหน่อย', 'nightOwl'),
  sp('raccoon', '🦝', 'แรคคูน', 'forest', 'common', { forage: 3, dig: 1 }, ['fruit', 'meat', 'fish'], 'forage_shrimp', 'มือไวมาก ล้างของก่อนกินเสมอ', 'nightOwl'),
  sp('bear', '🐻', 'หมีป่า', 'forest', 'uncommon', { carry: 3, forage: 2, dig: 1 }, ['fruit', 'fish', 'sweet'], 'forage_honey', 'ตัวใหญ่ใจดี รักน้ำผึ้งสุดหัวใจ', 'gourmet'),
  sp('badger', '🦡', 'แบดเจอร์', 'forest', 'uncommon', { dig: 3, forage: 1, guard: 1 }, ['insect', 'meat', 'veg'], 'crop_potato', 'นักขุดอุโมงค์ตัวยง', 'digger'),
  sp('skunk', '🦨', 'สกั๊งค์', 'forest', 'uncommon', { guard: 3, forage: 1 }, ['insect', 'veg'], 'crop_tomato', 'ใครเข้าใกล้ไร่ได้กลิ่นหนีหมด', 'nightOwl'),
  sp('beaver', '🦫', 'บีเวอร์', 'forest', 'uncommon', { dig: 2, carry: 2, water: 2 }, ['leaf', 'veg'], 'forage_herb', 'ช่างไม้ประจำป่า ทำทางน้ำเก่ง', 'waterLover'),
  sp('sloth', '🦥', 'สล็อธ', 'forest', 'rare', { forage: 1, carry: 2 }, ['leaf', 'fruit'], 'food_leaf', 'ช้าแต่ชัวร์ ทำอะไรก็ใจเย็น', 'loner'),
  sp('monkey', '🐒', 'ลิง', 'forest', 'rare', { forage: 3, carry: 1, pollinate: 1 }, ['fruit', 'insect', 'sweet'], 'crop_pineapple', 'ปีนป่ายคล่องแคล่ว เก็บผลไม้ได้ไว', 'harvester'),
  sp('orangutan', '🦧', 'อุรังอุตัง', 'forest', 'rare', { forage: 2, carry: 2 }, ['fruit', 'leaf'], 'crop_strawberry', 'ผู้ชาญฉลาดแห่งป่าฝน ใช้เครื่องมือเป็น', 'forager'),
  sp('tiger', '🐅', 'เสือโคร่ง', 'forest', 'epic', { guard: 3, forage: 1 }, ['meat'], 'food_meat', 'ลายสวยสง่า ผู้พิทักษ์แห่งป่า', 'loner'),
  sp('gorilla', '🦍', 'กอริลลา', 'forest', 'epic', { carry: 3, dig: 2, guard: 2 }, ['leaf', 'fruit', 'veg'], 'crop_broccoli', 'แข็งแรงสุดในป่า แต่จิตใจอ่อนโยน', 'tireless'),
  sp('panda', '🐼', 'แพนด้ายักษ์', 'forest', 'legendary', { carry: 3, forage: 2, dig: 1 }, ['leaf'], 'food_leaf', 'สมบัติล้ำค่าของป่า นั่งกินใบไม้ได้ทั้งวัน', 'gourmet'),

  // ───────── แหล่งน้ำ (water) ─────────
  sp('fish', '🐟', 'ปลา', 'water', 'common', { water: 2, fish: 1 }, ['insect', 'veg'], 'forage_shrimp', 'ว่ายน้ำปุ๋งปั๋ง ช่วยรดน้ำได้ดี', 'waterLover'),
  sp('tropicalfish', '🐠', 'ปลาการ์ตูน', 'water', 'common', { water: 2 }, ['insect', 'veg'], 'crop_lettuce', 'สีสันสดใส ว่ายวนไม่หยุด', 'waterLover'),
  sp('frog', '🐸', 'กบ', 'water', 'common', { water: 2, forage: 1, fish: 1 }, ['insect'], 'forage_mushroom', 'ร้องก้องหนองน้ำทุกคืนฝนตก', 'waterLover'),
  sp('turtle', '🐢', 'เต่า', 'water', 'common', { carry: 2, water: 1, dig: 1 }, ['leaf', 'veg', 'fruit'], 'crop_lettuce', 'เดินช้าๆ แต่มั่นคง แบกบ้านไปไหนมาไหนได้', 'sunLover'),
  sp('crab', '🦀', 'ปู', 'water', 'common', { dig: 1, forage: 2, carry: 1 }, ['fish', 'veg'], 'forage_shrimp', 'เดินข้างๆ แต่ใช้ก้ามหนีบเก่ง', 'digger'),
  sp('shrimp', '🦐', 'กุ้ง', 'water', 'common', { forage: 2, water: 1 }, ['insect', 'veg'], 'forage_shrimp', 'ตัวเล็กดีดตัวไว', 'forager'),
  sp('conch', '🐚', 'หอยสังข์', 'water', 'common', { water: 1, dig: 2 }, ['veg', 'leaf'], 'food_leaf', 'ฟังเสียงทะเลได้ในเปลือก', 'forager'),
  sp('blowfish', '🐡', 'ปลาปักเป้า', 'water', 'uncommon', { guard: 2, water: 1 }, ['insect', 'fish'], 'forage_shrimp', 'พองตัวขู่ศัตรู ใครก็ไม่กล้าแตะ', 'loner'),
  sp('squid', '🦑', 'หมึกกระดอง', 'water', 'uncommon', { fish: 2, water: 1 }, ['fish'], 'forage_fish', 'พ่นหมึกหนีเก่ง ตาโตน่ารัก', 'nightOwl'),
  sp('otter', '🦦', 'นากน้อย', 'water', 'uncommon', { fish: 3, water: 1 }, ['fish'], 'forage_fish', 'จับปลาเก่งที่สุด ชอบจับมือกันนอน', 'waterLover'),
  sp('oyster', '🦪', 'หอยนางรม', 'water', 'uncommon', { water: 2, forage: 1 }, ['veg'], 'forage_mushroom', 'เก็บไข่มุกไว้ในใจ', 'lucky'),
  sp('octopus', '🐙', 'ปลาหมึกยักษ์', 'water', 'rare', { carry: 2, fish: 2, water: 2 }, ['fish'], 'forage_shrimp', 'แปดแขนช่วยงานได้พร้อมกัน', 'teamPlayer'),
  sp('lobster', '🦞', 'กุ้งมังกร', 'water', 'rare', { guard: 2, forage: 2, dig: 1 }, ['fish', 'meat'], 'forage_shrimp', 'ก้ามใหญ่ เปลือกแข็งแกร่ง', 'loner'),
  sp('dolphin', '🐬', 'โลมา', 'water', 'epic', { fish: 3, water: 2 }, ['fish'], 'forage_fish', 'ฉลาดและขี้เล่น กระโดดโชว์ทุกครั้งที่มีคนดู', 'teamPlayer'),
  sp('shark', '🦈', 'ฉลาม', 'water', 'epic', { fish: 3, guard: 3 }, ['fish', 'meat'], 'food_meat', 'เจ้าแห่งน้ำลึก ใครเห็นก็ต้องหลบ', 'loner'),
  sp('humpback', '🐋', 'ราชาวาฬลึก', 'water', 'legendary', { water: 3, carry: 3, fish: 2 }, ['fish'], 'forage_fish', 'ร้องเพลงก้องมหาสมุทร ตำนานแห่งท้องทะเล', 'waterLover'),

  // ───────── ท้องฟ้า (sky) ─────────
  sp('sparrow', '🐦', 'นกกระจอก', 'sky', 'common', { fly: 3, forage: 1 }, ['grain', 'insect'], 'crop_rice', 'ตื่นเช้า ร้องเจื้อยแจ้วหน้าบ้าน', 'earlyBird'),
  sp('dove', '🕊️', 'นกพิราบ', 'sky', 'common', { fly: 2, carry: 1 }, ['grain'], 'crop_corn', 'สัญลักษณ์แห่งสันติ ส่งสารได้ด้วย', 'earlyBird'),
  sp('canary', '🐤', 'นกขมิ้น', 'sky', 'common', { fly: 2, pollinate: 1 }, ['grain', 'sweet'], 'crop_sunflower', 'ขนเหลืองสดใส ร้องเพลงเพราะ', 'earlyBird'),
  sp('tit', '🐥', 'นกกระจิบ', 'sky', 'common', { fly: 2, forage: 1 }, ['insect', 'grain'], 'food_seedmix', 'จิ๋วแต่แจ๋ว บินว่องไว', 'earlyBird'),
  sp('hatchling', '🐣', 'ลูกนกเพิ่งฟัก', 'sky', 'common', { fly: 1, forage: 1 }, ['insect', 'grain'], 'food_seedmix', 'เพิ่งออกจากไข่ ยังบินไม่ค่อยแข็ง', 'forager'),
  sp('parrot', '🦜', 'นกแก้ว', 'sky', 'uncommon', { fly: 2, forage: 1, pollinate: 1 }, ['fruit', 'grain'], 'crop_pineapple', 'พูดเจื้อยแจ้ว เลียนเสียงเก่ง', 'gourmet'),
  sp('bat', '🦇', 'ค้างคาว', 'sky', 'uncommon', { fly: 2, pollinate: 2 }, ['fruit', 'insect'], 'crop_grape', 'ออกหากินกลางคืน ช่วยผสมเกสรให้ไร่', 'nightOwl'),
  sp('swan', '🦢', 'หงส์', 'sky', 'rare', { fly: 2, water: 1, carry: 1 }, ['leaf', 'veg'], 'crop_lettuce', 'ลีลาสง่างามบนผิวน้ำ', 'waterLover'),
  sp('owl', '🦉', 'นกฮูก', 'sky', 'rare', { fly: 2, guard: 3 }, ['meat', 'insect'], 'food_meat', 'ตาดีตอนกลางคืน เฝ้าไร่ได้ทั้งคืน', 'nightOwl'),
  sp('flamingo', '🦩', 'ฟลามิงโก', 'sky', 'epic', { fly: 2, fish: 2 }, ['fish', 'insect'], 'forage_shrimp', 'ยืนขาเดียวสีชมพูสด ตัวแทนความมั่นใจ', 'waterLover'),
  sp('peacock', '🦚', 'นกยูง', 'sky', 'epic', { fly: 1, guard: 2 }, ['grain', 'insect', 'fruit'], 'food_seedmix', 'รำแพนหางงดงาม ประดับไร่ให้สวย', 'lucky'),
  sp('eagle', '🦅', 'อินทรีทองคำ', 'sky', 'legendary', { fly: 3, guard: 2, carry: 1 }, ['meat', 'fish'], 'food_meat', 'เจ้าแห่งนภา มองเห็นไกลนับสิบกิโล', 'sunLover'),

  // ───────── แมลงน้อย (bug) ─────────
  sp('bee', '🐝', 'ผึ้ง', 'bug', 'common', { pollinate: 3, forage: 1, fly: 1 }, ['sweet'], 'forage_honey', 'ผสมเกสรเก่งที่สุด ทำน้ำผึ้งได้ด้วย', 'sunLover'),
  sp('butterfly', '🦋', 'ผีเสื้อ', 'bug', 'common', { pollinate: 3, fly: 1 }, ['sweet', 'fruit'], 'crop_sunflower', 'ปีกสวยบินระหว่างดอกไม้', 'sunLover'),
  sp('ladybug', '🐞', 'เต่าทอง', 'bug', 'common', { guard: 2, pollinate: 1 }, ['insect'], 'crop_tomato', 'กินเพลี้ยให้ ช่วยปกป้องพืชผัก', 'lucky'),
  sp('ant', '🐜', 'มด', 'bug', 'common', { carry: 3, dig: 1, forage: 2 }, ['sweet', 'grain'], 'food_cake', 'แบกของหนักกว่าตัวเองเป็นร้อยเท่า', 'teamPlayer'),
  sp('caterpillar', '🐛', 'หนอนน้อย', 'bug', 'common', { forage: 1, dig: 1 }, ['leaf'], 'food_leaf', 'กินใบไม้ไม่หยุด รอวันกลายร่าง', 'gourmet'),
  sp('earthworm', '🪱', 'ไส้เดือน', 'bug', 'common', { dig: 3 }, ['veg', 'leaf'], 'crop_potato', 'พรวนดินให้ร่วนซุย พืชโตดี', 'digger'),
  sp('snail', '🐌', 'หอยทาก', 'bug', 'common', { forage: 1, water: 1 }, ['leaf', 'veg'], 'crop_lettuce', 'ค่อยๆ ไป ไม่ต้องรีบ', 'loner'),
  sp('cricket', '🦗', 'จิ้งหรีด', 'bug', 'uncommon', { forage: 2, guard: 1 }, ['leaf', 'grain'], 'crop_corn', 'ขับกล่อมไร่ยามค่ำคืน', 'nightOwl'),
  sp('fly', '🪰', 'แมลงวันทอง', 'bug', 'uncommon', { pollinate: 2, forage: 1 }, ['sweet', 'fruit'], 'crop_watermelon', 'บินว่อนรอบผลไม้สุก ช่วยผสมเกสรได้', 'forager'),
  sp('cockroach', '🪳', 'แมลงสาบเหนียว', 'bug', 'rare', { forage: 3, dig: 1 }, ['sweet', 'grain'], 'food_cake', 'อึดที่สุดในโลก หาของกินได้ทุกที่', 'tireless'),
  sp('mosquito', '🦟', 'ยุงจอมกวน', 'bug', 'rare', { pollinate: 2, fly: 2 }, ['sweet', 'fruit'], 'forage_berry', 'ตัวจิ๋ว บินไว กินแต่น้ำหวานดอกไม้', 'nightOwl'),
  sp('spider', '🕷️', 'แมงมุมทอผ้า', 'bug', 'epic', { guard: 2, forage: 2 }, ['insect'], 'forage_herb', 'ใยเหนียวดักศัตรูพืชได้หมด', 'loner'),
  sp('scorpion', '🦂', 'แมงป่องหางเพชร', 'bug', 'epic', { guard: 3, dig: 1 }, ['insect', 'meat'], 'food_meat', 'เหล็กในแหลมคม ผู้พิทักษ์ผืนทราย', 'nightOwl'),
  sp('beetle', '🪲', 'ด้วงเพชรราชัน', 'bug', 'legendary', { carry: 3, dig: 3, guard: 1 }, ['fruit', 'leaf', 'sweet'], 'crop_watermelon', 'เกราะแวววาวดุจอัญมณี แรงเยอะสุดในหมู่แมลง', 'harvester'),

  // ───────── ทุ่งสะวันนา (savanna) ─────────
  sp('lizard', '🦎', 'กิ้งก่า', 'savanna', 'common', { forage: 2, dig: 1 }, ['insect'], 'crop_tomato', 'อาบแดดทั้งวัน เปลี่ยนสีได้', 'sunLover'),
  sp('camel', '🐪', 'อูฐหนอกเดียว', 'savanna', 'common', { carry: 3, forage: 1 }, ['grain', 'leaf'], 'crop_pumpkin', 'อดน้ำได้นาน แบกของข้ามทะเลทราย', 'tireless'),
  sp('bactrian', '🐫', 'อูฐสองหนอก', 'savanna', 'common', { carry: 3, dig: 1 }, ['grain', 'leaf'], 'crop_sweetpotato', 'สองหนอกเก็บพลังงานได้เยอะกว่าเดิม', 'tireless'),
  sp('zebra', '🦓', 'ม้าลาย', 'savanna', 'uncommon', { carry: 2, guard: 1 }, ['leaf', 'veg'], 'crop_corn', 'ลายขาวดำไม่ซ้ำใคร', 'teamPlayer'),
  sp('kangaroo', '🦘', 'จิงโจ้', 'savanna', 'uncommon', { carry: 2, forage: 1, dig: 1 }, ['veg', 'leaf'], 'crop_carrot', 'ใส่ของในกระเป๋าหน้าท้องแล้วกระโดดไปส่ง', 'harvester'),
  sp('bison', '🦬', 'ไบซัน', 'savanna', 'uncommon', { carry: 3, dig: 1 }, ['grain', 'leaf'], 'crop_corn', 'ตัวใหญ่ขนฟู ผลักของหนักได้สบาย', 'tireless'),
  sp('crocodile', '🐊', 'จระเข้', 'savanna', 'uncommon', { guard: 3, fish: 2 }, ['meat', 'fish'], 'forage_fish', 'นอนนิ่งในโคลน รอจังหวะจับปลา', 'loner'),
  sp('elephant', '🐘', 'ช้าง', 'savanna', 'rare', { water: 3, carry: 3 }, ['veg', 'fruit', 'leaf'], 'crop_watermelon', 'พ่นน้ำรดไร่ได้ทั้งแปลง แบกของได้เป็นตัน', 'waterLover'),
  sp('giraffe', '🦒', 'ยีราฟ', 'savanna', 'rare', { forage: 3, guard: 1 }, ['leaf', 'fruit'], 'food_leaf', 'คอยาวเก็บใบไม้ยอดสูง เห็นศัตรูแต่ไกล', 'forager'),
  sp('hippo', '🦛', 'ฮิปโป', 'savanna', 'rare', { water: 3, carry: 2 }, ['veg', 'leaf'], 'crop_pumpkin', 'อ้วนกลมแช่น้ำทั้งวัน แต่แบกของเก่ง', 'waterLover'),
  sp('rhino', '🦏', 'แรด', 'savanna', 'epic', { carry: 3, guard: 2, dig: 2 }, ['leaf', 'veg'], 'crop_broccoli', 'เขาแข็งผิวหนาเหมือนเกราะ', 'digger'),
  sp('leopard', '🐆', 'เสือดาว', 'savanna', 'epic', { guard: 2, forage: 2 }, ['meat'], 'food_meat', 'ลายจุดงดงาม ปราดเปรียวที่สุด', 'nightOwl'),
  sp('lion', '🦁', 'ราชสีห์ทองคำ', 'savanna', 'legendary', { guard: 3, carry: 1, forage: 1 }, ['meat'], 'food_meat', 'เจ้าแห่งทุ่งหญ้า แผงคอสีทองเปล่งประกาย', 'sunLover'),

  // ───────── ขั้วโลก (polar) ─────────
  sp('penguin', '🐧', 'เพนกวิน', 'polar', 'common', { fish: 2, water: 1, carry: 1 }, ['fish'], 'forage_fish', 'เดินเตาะแตะบนน้ำแข็ง ดำน้ำเก่ง', 'teamPlayer'),
  sp('seal', '🦭', 'แมวน้ำ', 'polar', 'common', { fish: 3, carry: 1 }, ['fish'], 'forage_fish', 'ตาโตกลมโต ชอบนอนผึ่งหิมะ', 'sunLover'),
  sp('snowhare', '🐇', 'กระต่ายหิมะ', 'polar', 'common', { dig: 2, forage: 1 }, ['veg', 'leaf'], 'crop_carrot', 'ขนขาวพรางตัวกับหิมะ', 'digger'),
  sp('husky', '🐕', 'ฮัสกี้', 'polar', 'uncommon', { carry: 3, guard: 2 }, ['meat', 'fish'], 'food_meat', 'ลากเลื่อนข้ามน้ำแข็งได้ไม่เหนื่อย', 'tireless'),
  sp('siberiancat', '🐈', 'แมวไซบีเรีย', 'polar', 'uncommon', { guard: 2, forage: 1 }, ['meat', 'fish', 'milk'], 'food_milk', 'ขนหนานุ่ม ทนหนาวสุดๆ', 'loner'),
  sp('snowram', '🐏', 'แกะภูเขาหิมะ', 'polar', 'uncommon', { guard: 1, carry: 2, dig: 1 }, ['leaf', 'veg'], 'crop_broccoli', 'เขาโค้งใหญ่ ปีนผาน้ำแข็งเก่ง', 'teamPlayer'),
  sp('beluga', '🐳', 'วาฬเบลูก้า', 'polar', 'rare', { water: 3, fish: 2 }, ['fish'], 'forage_shrimp', 'วาฬขาวยิ้มหวาน ร้องเพลงใต้น้ำแข็ง', 'waterLover'),
  sp('yak', '🐂', 'จามรี', 'polar', 'epic', { carry: 3, dig: 2 }, ['leaf', 'grain'], 'crop_potato', 'ขนยาวสยาย แบกของข้ามที่สูงได้สบาย', 'tireless'),
  sp('arcticwolf', '🐺', 'หมาป่าหิมะ', 'polar', 'epic', { guard: 3, carry: 1 }, ['meat'], 'food_meat', 'ขนขาวบริสุทธิ์ ยืนเฝ้าอย่างเงียบสงบ', 'teamPlayer'),
  sp('polarbear', '🐻‍❄️', 'ราชาหมีขาว', 'polar', 'legendary', { carry: 3, fish: 2, dig: 1 }, ['fish', 'meat'], 'forage_fish', 'เจ้าแห่งขั้วโลกเหนือ แข็งแรงและใจดี', 'loner'),

  // ───────── ดินแดนตำนาน (mystic) ─────────
  sp('dodo', '🦤', 'โดโด้ฟื้นคืนชีพ', 'mystic', 'uncommon', { forage: 2, guard: 1 }, ['fruit', 'grain'], 'crop_pumpkin', 'นกในตำนานที่กลับมาจากความสูญพันธุ์', 'forager'),
  sp('blackcat', '🐈‍⬛', 'แมวดำพ่อมด', 'mystic', 'uncommon', { guard: 2, forage: 2, pollinate: 1 }, ['meat', 'fish', 'milk'], 'food_milk', 'ดวงตาเรืองแสง มีเวทมนตร์เล็กๆ น้อยๆ', 'nightOwl'),
  sp('naga', '🐍', 'พญานาคน้อย', 'mystic', 'rare', { guard: 3, water: 2 }, ['meat', 'fish'], 'forage_fish', 'ผู้พิทักษ์สายน้ำศักดิ์สิทธิ์', 'waterLover'),
  sp('sauropod', '🦕', 'ไดโนคอยาว', 'mystic', 'rare', { carry: 3, water: 2, forage: 1 }, ['leaf', 'veg'], 'food_leaf', 'ตัวใหญ่ใจเย็น กินยอดไม้สูงๆ', 'gourmet'),
  sp('trex', '🦖', 'ไทแรนโนซอรัส', 'mystic', 'rare', { guard: 3, dig: 2 }, ['meat'], 'food_meat', 'ราชาแห่งยุคโบราณ แขนสั้นแต่ใจนักสู้', 'loner'),
  sp('mammoth', '🦣', 'แมมมอธน้ำแข็งนิรันดร์', 'mystic', 'epic', { carry: 3, dig: 3, water: 1 }, ['veg', 'leaf', 'fruit'], 'crop_sweetpotato', 'งายาวโค้ง ตื่นขึ้นมาจากธารน้ำแข็งโบราณ', 'digger'),
  sp('dragonhead', '🐲', 'มังกรน้อยเมฆา', 'mystic', 'epic', { fly: 2, guard: 2, forage: 1 }, ['fruit', 'meat', 'sweet'], 'crop_pineapple', 'มังกรเด็กขี้เล่น พ่นควันรูปหัวใจ', 'lucky'),
  sp('dragon', '🐉', 'มังกรทองสวรรค์', 'mystic', 'legendary', { fly: 3, guard: 3, water: 2 }, ['meat', 'fruit'], 'food_cake', 'ผู้ปกครองท้องฟ้าและสายน้ำ นำโชคมาให้ฟาร์ม', 'lucky'),
  sp('unicorn', '🦄', 'ยูนิคอร์นแสงจันทร์', 'mystic', 'legendary', { pollinate: 3, forage: 3, carry: 1 }, ['sweet', 'fruit', 'leaf'], 'crop_strawberry', 'เขาเรืองแสง ปลูกอะไรก็งอกงามราวเวทมนตร์', 'harvester'),
];

const BY_ID = new Map(SPECIES.map(s => [s.id, s]));

export function getSpecies(id) {
  return BY_ID.get(id) || null;
}

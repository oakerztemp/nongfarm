# ฟาร์มน้องๆ (NongFarm) 🐣🌾

เกมเลี้ยงสัตว์สไตล์ทามาก็อตจิบนเว็บ — ฟักไข่ เลี้ยงน้องๆ สัตว์กว่า 100 สายพันธุ์ แล้วส่งไปช่วยทำไร่ ปลูกผัก และออกสำรวจหาของป่า
**ไม่มีการต่อสู้** เวลาเดินจริงตลอด (ออฟไลน์ก็โต) เล่นได้ทันทีแบบ Guest หรือล็อกอินด้วย Google เพื่อเซฟบนคลาวด์

รายละเอียดกติกา: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) · สัญญาเชิงเทคนิคระหว่างโมดูล: [`docs/CONTRACT.md`](docs/CONTRACT.md)

## วิธีรัน

ไม่ต้องติดตั้งอะไร ไม่มี build step (Vanilla JS ES modules) แค่เปิดเว็บเซิร์ฟเวอร์ในโฟลเดอร์เกม:

```bash
python -m http.server 8787
```

แล้วเปิด <http://localhost:8787/> — ห้ามเปิดไฟล์ `index.html` ตรงๆ (`file://`) เพราะ ES modules ใช้ไม่ได้

ถ้ายังไม่ตั้งค่า Firebase เกมจะเล่นแบบ **Guest** (เซฟใน localStorage ของเบราว์เซอร์) ปุ่มเข้าสู่ระบบจะกดไม่ได้ และจะไม่โหลด Firebase เลย

## ตั้งค่า Firebase (Login Google + เซฟบนคลาวด์)

1. ไปที่ <https://console.firebase.google.com/> แล้วกด **Add project** ตั้งชื่อโปรเจกต์ (ปิด Google Analytics ได้)
2. เมนู **Build > Authentication > Get started** แล้วที่แท็บ **Sign-in method** เปิดใช้ **Google** (ใส่อีเมลสนับสนุนโปรเจกต์ แล้ว Save)
3. กลับหน้า **Project overview** กดไอคอน **Web (`</>`)** เพื่อ **Add app** ตั้งชื่อแอป (ไม่ต้องเปิด Hosting) แล้วคัดลอกค่า `firebaseConfig` ที่แสดง
4. เปิด `js/firebase-config.js` แล้ววางค่าทับของเดิม ให้ `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId` เป็นค่าจริง (ค่า `apiKey` ของเว็บแอปไม่ใช่ความลับ ความปลอดภัยอยู่ที่ Firestore rules)
5. เมนู **Build > Firestore Database > Create database** เลือกโลเคชันที่ใกล้ที่สุด (เช่น `asia-southeast1`) และเริ่มด้วย production mode
6. ที่แท็บ **Rules** ของ Firestore คัดลอกเนื้อหาจากไฟล์ [`firestore.rules`](firestore.rules) ไปวางทับ แล้วกด **Publish**
7. เมนู **Authentication > Settings > Authorized domains** ตรวจว่ามี `localhost` (มีให้อยู่แล้วโดยปริยาย) และเพิ่มโดเมนที่จะนำเกมไปโฮสต์จริงถ้ามี
8. รีเฟรชเกม ปุ่ม **เข้าสู่ระบบ** จะกดได้ ลอง Login แล้วดูจุดสถานะเซฟที่ header (เขียว = บันทึกแล้ว, เหลือง = กำลังบันทึก, แดง = ออฟไลน์/บันทึกไม่ได้)

### การทำงานของเซฟ

- Guest เก็บที่ `localStorage` คีย์ `nongfarm3_guest`; ผู้ใช้ที่ล็อกอินเก็บแคชที่ `nongfarm3_<uid>` (เกมเวอร์ชัน 3 ใช้คีย์และช่อง BroadcastChannel ของตัวเอง เพื่อไม่ให้แท็บเวอร์ชันเก่าที่ยังเปิดค้างอยู่เขียนทับ; ครั้งแรกจะอ่านเซฟจากคีย์เก่า `nongfarm_guest` / `nongfarm_<uid>` มาแปลงให้หนึ่งครั้งโดยไม่แตะคีย์เก่า) และบนคลาวด์ที่ `users/{uid}` (ฟิลด์ `state` + `updatedAt`)
- เซฟลงเครื่องไม่เกินทุก 2 วินาทีเมื่อมีการเปลี่ยนแปลง เซฟขึ้นคลาวด์ทุก 30 วินาทีเมื่อมีการเปลี่ยนแปลง และตอนปิดแท็บ/ซ่อนหน้าต่าง
- ตอนล็อกอินครั้งแรก (บัญชียังไม่มีเซฟบนคลาวด์): อัปโหลดเซฟ Guest ขึ้นไปเป็นฟาร์มของบัญชี แล้วล้างช่อง Guest
- ถ้าบัญชีมีเซฟอยู่แล้ว: ระหว่างคลาวด์กับแคช `nongfarm3_<uid>` ฉบับที่ `updatedAt` ใหม่กว่าชนะ; ถ้าในเครื่องมีฟาร์ม Guest ที่เล่นไปแล้วด้วย เกมจะถามว่าจะใช้ฟาร์มไหน (ปิดหน้าต่าง = ใช้ฟาร์มในบัญชี)
- ฉบับที่ถูกเขียนทับจะถูกสำรองไว้ที่ `nongfarm_<uid>_backup_<timestamp>` (เก็บ 3 ชุดล่าสุด)
- ออกจากระบบแล้วกลับไปใช้ช่อง Guest
- ถ้าต่อคลาวด์ไม่ได้ เกมเล่นต่อในเครื่องได้ และจะลองบันทึกใหม่เอง

## ทดสอบอัตโนมัติ

ไม่ต้องมี Node — ใช้ Python + Edge/Chrome headless:

```bash
python tests/run_tests.py
```

สคริปต์เปิดเว็บเซิร์ฟเวอร์ชั่วคราวบนพอร์ตว่าง รัน `tests/index.html` (unit test ของ state/migration/storage/pets/farm + ตัวจำลองเศรษฐกิจ) แล้วจบด้วย exit code 0 เฉพาะเมื่อขึ้น `ALL PASS`
อยากดูผลในเบราว์เซอร์: รัน `python -m http.server 8787` แล้วเปิด <http://localhost:8787/tests/index.html>
ไฟล์ save ตัวอย่างสำหรับทดสอบ migration อยู่ใน `tests/fixtures/` — ถ้าเปลี่ยนโครง state ต้องเพิ่ม migration step ใน `js/state.js` (`MIGRATIONS`) และไฟล์ตัวอย่างใหม่

## Deploy (GitHub Pages)

ไฟล์ `.github/workflows/pages.yml` ทดสอบแล้ว deploy โฟลเดอร์เกมเป็นเว็บสาธารณะทุกครั้งที่ push เข้า `main` (ไม่มี build step ไม่ต้องมี Node ในเครื่อง)

1. สร้าง repository บน GitHub โดยให้ **รากของ repo = โฟลเดอร์เกมนี้** (มี `index.html` อยู่ชั้นนอกสุด) แล้ว push ขึ้น branch `main`
2. ที่ repo เปิด **Settings > Pages > Build and deployment > Source = GitHub Actions**
3. รอ workflow **Deploy to GitHub Pages** รันเสร็จ จะได้ลิงก์ `https://<user>.github.io/<repo>/`
4. เพิ่มโดเมน `<user>.github.io` ใน Firebase Console: **Authentication > Settings > Authorized domains** (ไม่ต้องใส่ path) ไม่งั้น Login Google จะถูกปฏิเสธ
5. จำกัด API key ตามโดเมนที่ Google Cloud Console: **APIs & Services > Credentials** เลือก Browser key ของโปรเจกต์ > **Application restrictions = Websites** แล้วเพิ่ม `https://<user>.github.io/*` และ `http://localhost:8787/*` (ค่า key ของเว็บแอปไม่ใช่ความลับ แต่ควรกันคนอื่นนำไปใช้โควตาของคุณ)
6. ลองเล่นบนมือถือด้วยลิงก์เดียว: Guest → Login → ออก → Login อีกครั้ง

**กัน cache ปนเวอร์ชัน:** ขั้นตอน `Version assets` ใน workflow รัน `.github/scripts/version_assets.py` ต่อท้าย `?v=<commit 8 ตัว>` ให้ทุก import ใน `js/**/*.js` และลิงก์ css/js ใน `index.html` ของโฟลเดอร์ `_site` เท่านั้น (ไฟล์ในเครื่อง/รีโปไม่ถูกแก้) ทำให้การ deploy แต่ละครั้งเป็นชุดไฟล์เดียวกัน ไม่เกิดกรณีผู้เล่นได้ `main.js` ใหม่แต่ `farm.js` เก่าจากแคช

## ติดตั้งเป็นแอป (PWA) + แจ้งเตือน

- **ติดตั้ง:** เปิดเกมบนมือถือ/คอมด้วย Chrome/Edge แล้วกด ⚙️ > **ติดตั้งแอป** (หรือเมนูเบราว์เซอร์ > ติดตั้งแอป; iPhone: ปุ่มแชร์ > เพิ่มไปยังหน้าจอโฮม) เปิดจากไอคอนได้เหมือนแอปทั่วไป
- **ออฟไลน์:** `sw.js` แคชไฟล์เกมของแต่ละเวอร์ชัน (ชื่อแคช `nongfarm-<commit>`) เปิดเกมได้แม้ไม่มีเน็ต; หน้าเว็บ/คำขอ Firebase และ Google **ไม่ผ่าน** service worker เวอร์ชันใหม่จะมีผลตอนโหลดหน้าครั้งถัดไป (ไม่รีโหลดกลางเกม) และแคชเก่าถูกลบอัตโนมัติ
- **ในเครื่อง localhost ไม่ลงทะเบียน service worker** (กันแคชค้างตอนพัฒนา) อยากทดสอบให้เปิด `http://localhost:8787/?sw=1`
- **แจ้งเตือน:** ⚙️ > เปิด **การแจ้งเตือน** (ขออนุญาตเบราว์เซอร์ตอนกดเปิดเท่านั้น) เมื่อไข่ฟัก / พืชพร้อมเก็บ / สำรวจเสร็จ / น้องหิว (ต่ำกว่า 20) ไม่เกิน 1 ครั้งต่อประเภทต่อ 10 นาที และไม่แจ้งตอนกำลังเปิดดูเกมอยู่ กดที่การแจ้งเตือนจะเปิดแท็บที่เกี่ยวข้อง
  - เป็นการแจ้งเตือนในเครื่อง (ไม่ใช่ push) จึงทำงานตอนหน้าเกมยังเปิดอยู่เบื้องหลังเท่านั้น ถ้าปิดแอป/แท็บแล้วจะไม่เตือน (ต้องใช้แผน Blaze + Cloud Functions)
  - ตรรกะอยู่ที่ `js/notify.js` (ไม่แตะ DOM, มีเทสต์) ส่วนการแสดงอยู่ที่ `js/pwa.js`
- **ไอคอน:** วาดด้วย `python .github/scripts/make_icons.py` (ไม่ต้องใช้ไลบรารีภายนอก) ไฟล์ผลลัพธ์อยู่ใน `icons/` และ commit ไว้
- ขั้นตอน `Version assets` ตอน deploy จะประทับเวอร์ชันลงใน `sw.js` (`const VERSION`), การลงทะเบียน service worker, ลิงก์ manifest/ไอคอนด้วย

## ลานน้องๆ 3 มิติ

แท็บ 🏡 **ลาน** แสดงน้องๆ เป็นฉาก 3 มิติ (three.js r160 ฝังไว้ใน `vendor/` ไม่ต้องใช้ CDN) ลากนิ้วเดียวเพื่อเลื่อนมุมมอง บีบนิ้ว/เลื่อนล้อเพื่อซูม แตะน้องเพื่อดูรายละเอียด ลานจะกว้างขึ้นเป็น 4 ระดับตามความจุ (3–5 · 6–9 · 10–14 · 15–20 ตัว)

**กล้องลาน (v7):** ระยะกล้องเท่ากันทุกระดับ (ใช้ค่าที่พอดีกับระดับ M) น้องจึงตัวขนาดเดิมเสมอ ลานเล็กที่ระดับ S จะดูเล็กอยู่กลางทุ่งกว้าง และที่ XL ลานใหญ่กว่าจอ — ลากนิ้วเดียวเลื่อนกล้อง (จำกัดไว้ในรัศมีเกาะปัจจุบัน; ขยับน้อยกว่า ~8 px ยังนับเป็นการแตะ) แตะสองครั้งที่พื้นว่างเพื่อกลับกลางลาน, เมาส์คลิกขวาลาก (หรือ Shift+ลาก) เพื่อหมุน, สองนิ้วบิดเพื่อหมุน ระหว่างที่นิ้วอยู่บนฉาก 3 มิติหน้าเว็บจะไม่เลื่อน (`touch-action: none`) นอกลานคือป่า/ทุ่งหญ้า พุ่มไม้ ต้นไม้ ก้อนหิน และลำธาร (ใช้แค่ 6 draw call) — เมื่อลานขยาย ของป่าที่อยู่ในรั้วใหม่จะค่อยๆ จมหายไป `world.decorSpots` ให้จุดวางของตกแต่ง 2/4/6/8 จุดตามระดับ (ตำแหน่งแต่ละจุดคงที่ทุกระดับ)

**เซฟ v5:** `yard.byPet[petId] = { c, ms, prog, items }` เก็บของขวัญไว้ที่ตัวน้องแต่ละตัว (เซฟ v4 เดิมถูกแบ่งให้น้องที่อยู่บ้านเท่าๆ กัน ไม่มีเหรียญ/ไอเทมหาย), `nursery` (เปลอนุบาล สูงสุด `NURSERY_SLOTS` = 3), `decor` + `inventoryDecor` (ของตกแต่งที่วาง/ที่ยังไม่วาง), `postcards` (โปสการ์ดสูงสุด `POSTCARDS_MAX` = 30) migration อยู่ที่ `MIGRATIONS[4]` ใน `js/state.js` และไฟล์ทดสอบ `tests/fixtures/save_v4_midgame.json`

- ⚙️ ตั้งค่า > **มุมมองลาน** (3 มิติ / รายการ) และ **คุณภาพกราฟิก** (อัตโนมัติ / ต่ำ) — จำไว้เฉพาะในเครื่องนั้น
- เครื่องที่ไม่มี WebGL หรือเปิด "ลดการเคลื่อนไหว" จะแสดงเป็นรายการการ์ดเอง (ไม่โหลด three.js เลย)
- ทดสอบบนเครื่องที่ไม่มี GPU จริง: เปิด `/?soft3d=1`; หน้าสาธิตเอนจิน: `/tests/world-demo.html`
- เอนจินอยู่ที่ `js/world3d/` (`support.js` ตรวจความพร้อม ไม่ import three · `engine.js` · `fx.js`) และค่าที่ตั้งเฉพาะเครื่องอยู่ที่ `js/prefs.js`

## โครงสร้างไฟล์ & เจ้าของ

| ไฟล์ | เจ้าของ |
|---|---|
| `index.html`, `firestore.rules`, `README.md`, `css/style.css` | A (Core/Platform) |
| `js/main.js`, `auth.js`, `storage.js`, `state.js`, `util.js`, `tick.js`, `quests.js`, `notify.js`, `pwa.js`, `ui/questBar.js`, `ui/settings.js`, `firebase-config.js`, `sw.js`, `manifest.webmanifest`, `icons/` | A (Core/Platform) |
| `js/world3d/engine.js`, `fx.js`, `support.js`, `js/prefs.js`, `vendor/`, `tests/world.test.js`, `tests/world-demo.html` | A (Core/Platform) |
| `tests/index.html`, `harness.js`, `run_tests.py`, `core.test.js`, `fixtures/`, `.github/workflows/pages.yml`, `.github/scripts/version_assets.py` | A (Core/Platform) |
| `js/data/species.js`, `data/eggs.js`, `js/pets.js`, `js/ui/petsView.js`, `css/pets.css` | B (Pets) |
| `js/data/crops.js`, `data/items.js`, `js/farm.js`, `js/ui/farmView.js`, `css/farm.css` | C (Farm) |
| `docs/GAME_DESIGN.md`, `docs/CONTRACT.md` | Lead |

## กติกาเซฟบนคลาวด์ (กันเซฟทับกัน)

- เอกสาร `users/{uid}` เก็บ `{ state, updatedAt, version, rev }` — ทุกครั้งที่เซฟ `rev` ต้องเพิ่มจากค่าที่รู้ล่าสุดทีละ 1 และ `firestore.rules` บังคับกฎนี้ (**ต้อง Publish rules ใหม่ใน Firebase Console ทุกครั้งที่ไฟล์เปลี่ยน**) แท็บ/เครื่อง/เกมเวอร์ชันเก่าที่ไม่รู้ว่ามีการเซฟใหม่กว่าจึงถูกปฏิเสธ แทนที่จะเขียนทับ
- ถ้าถูกปฏิเสธ เกมจะหยุดอัปโหลด โหลดเซฟล่าสุดจากคลาวด์มาใช้ และสำรองสำเนาในเครื่องไว้ที่ `nongfarm_<uid>_backup_<เวลา>` (เก็บ 3 ชุดล่าสุด)
- เปิดหลายแท็บบัญชีเดียวกัน: เฉพาะแท็บที่เพิ่งใช้งานล่าสุดเท่านั้นที่อัปโหลด แท็บอื่นแสดงสถานะ "อีกแท็บกำลังเล่นอยู่"

## หมายเหตุ

เกมนี้เป็นแบบ **client-authoritative** — ตรรกะเกมทั้งหมดรันในเบราว์เซอร์และเซฟเป็นข้อมูลที่ผู้เล่นแก้เองได้ (เกมงานอดิเรก ไม่มีเงินจริง) Firestore rules แค่กันไม่ให้คนอื่นอ่าน/เขียนเซฟของคุณ ไม่ได้ตรวจความถูกต้องของข้อมูลเซฟ

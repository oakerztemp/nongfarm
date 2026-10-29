# CONTRACT V23 — แมพใหญ่ จัดโซน ครัวในแมพ แก้อาหารหาย (Phase 6 รอบที่ 1)

> 2026-10-29 · ผู้ใช้สั่งเริ่ม V23 · แผนรวม docs/PLAN_PHASE6.md · ภาพก่อน docs/design/v23/before_*.jpg
> **ไม่แตะ state (ยัง v9) · ไม่แตะเศรษฐกิจ (ราคาขยายลานเดิม) · ไม่เพิ่ม library**
> ทีม: หัวหน้า (Opus) + coder sonnet A / B / C / D — แต่ละไฟล์มีเจ้าของคนเดียว (ตารางท้ายไฟล์)

## 1. ขนาดลานใหม่ (C: engine.js · A: petBehaviour.js ต้องตรงกัน)

| tier | walk | fence | island | barnZ |
|---|---|---|---|---|
| S | 5.0 | 5.7 | 6.4 | -4.3 |
| M | 6.4 | 7.1 | 7.8 | -5.2 |
| L | 7.6 | 8.3 | 9.0 | -5.8 |
| XL | 9.0 | 9.7 | 10.4 | -6.4 |

- `engine.YARD_TIERS` และ `petBehaviour.YARD_TIER_LAYOUT` ใช้ตัวเลขชุดนี้ (test เดิมเช็คว่าตรงกัน)
- ทุ่งนอกลาน: `WILD = { meadow: 48, rMin: 6.7, rMax: 30, streamX: 14.5, ... }` (ลำธารต้องอยู่นอก fence XL อย่างน้อย 2.5)
- หมอก: `FOG_NEAR 28`, `FOG_FAR 72`
- รั้วโค้งธรรมชาติ: `fenceRadiusAt(tierCfg, theta) = fence * (1 + 0.035*sin(3θ+1.0) + 0.02*sin(5θ+2.0))` (pure, export) — เสารั้วตามเส้นนี้; walk ยังเป็นวงกลม (walk < fence ต่ำสุดเสมอ)

## 2. กล้อง (C: engine.js)
- ระยะกล้องปกติ = fit ของรัศมี **6.4** คงที่ (`CAMERA_FIT_RADIUS = 6.4`, แทน CAMERA_FIT_TIER) → น้องขนาดบนจอเท่าเดิมทุก tier
- เลื่อนดู (pan) ได้ถึงขอบ island เหมือนเดิม · `ZOOM_MAX = 2.0`
- `world.viewWholeFarm(on)` → on: ซูม+pan ให้เห็นทั้ง island (zoom = min(ZOOM_MAX, fit(island)/fit(6.4)), pan (0, 0)), off: กลับมุมเดิมก่อนกด · `world.isWholeFarm()`; ผู้เล่นซูม/pan เองระหว่างนั้น = หลุดโหมดเอง
- ปุ่ม 🗺️ ในแถบปุ่มบนฉาก (ข้าง 📷) class `b3-mapbtn` aria-label "ดูทั้งฟาร์ม" สลับ on/off (C ใน barn3d; B ทำ CSS)

## 3. ผังโซน (A: petBehaviour.js — ตัวเลขชุดนี้เป็นค่าเริ่ม; ถ้า test ข้อจำกัดไม่ผ่าน ขยับได้ ±0.4 แล้วรายงานหัวหน้า)
ลานกลาง (รัศมี ≤ 0.4·walk) ต้องโล่ง: ไม่มี prop / decor spot / ครัว
- **โรงนา + ตู้ฟัก** หลัง (เดิม) · ตู้ฟักสูงสุด 3 ใบ (`MAX_INCUBATOR`) · เปลอนุบาลซ้ายแถวตู้ฟัก (เดิม)
- **โรงครัว** ขวาหลัง ทุก tier: `kitchenSpot(tier) = { x: 3.0 + (walk-5)*0.45, z: barnZ + 1.1, r: 1.1 }` (export จาก petBehaviour) → อยู่ใน `YARD.obstacles` และ `YARD.kitchen`
- **ชามข้าว** หน้า (1.7, 2.3) เดิม
- **props** (prop ที่ปลดล็อกที่ tier ใด ใช้พิกัดเดิมใน tier ที่สูงกว่า):
  - M: pond (4.3, 1.4) r1.1 — ฝั่งขวาใกล้ลำธาร · tree (-4.6, -1.6) r0.55
  - L: + flowerbed (-3.4, 4.6) r0.9 · playground (-5.4, 1.6) r1.0
  - XL: + hill/gazebo (-6.6, -3.6) r1.3 · lanterns (-6.6, 4.8) (6.6, 4.8) (-2.2, 7.4) (2.2, 7.4) r0.25 (สองดวงแรกขยับจาก ±6.2, 4.4 เพราะชิด decor spot 5)
- **แถบหลังโรงนา**: `validTarget` ห้ามเป้าหมาย z < backLimit **เฉพาะ** x ∈ [-5.2, kitchen.x + kitchen.r + 0.3] (ด้านข้างหลังโรงนาเดินได้ใน tier ใหญ่)
- **decor spots** (C: engine.DECOR_SPOTS, spot i คงที่ทุก tier, state เก็บเป็น index → ของที่วางไว้ย้ายตามเอง ไม่ต้อง migrate):
  S (0.0, 3.6) (-2.8, 1.6) · M (2.6, 4.6) (-2.9, -0.9) · L (0.0, 6.6) (5.6, 4.0) · XL (-7.6, -0.2) (7.6, -1.4)
- ข้อจำกัด (test A): ทุก spot/prop/ครัว อยู่ใน walk ของ tier ที่ปลดล็อก (spot ≤ walk-0.2; footprint ครัว/prop ≤ fence-0.1 ที่ทุกมุม), ห่างกัน ≥ 0.7 (ขอบถึงขอบ), ห่างชาม ≥ 1.0, ไม่ทับแถวตู้ฟัก 3 ใบ / เปล / โรงนา
- **ทางเดินดิน** (C วาด, D ให้ตัวสร้าง mesh): ประตูโรงนา → กลางลาน → ชามข้าว · กลางลาน → ประตูครัว · กลางลาน → บ่อ (M+) — 1 draw call รวม
- ค่าพิกัดอื่นใน petBehaviour ที่ hard-code ไว้ตามขนาดลานเก่า (greetSpots, partySpot, puddleSpots, shelterSpots ฯลฯ) ต้องอยู่ในลานและไม่ทับครัว

## 4. น้องกระจายตัว (A: petBehaviour.js)
- `pickTarget` ใช้ได้เลยกับลานใหญ่ + เพิ่ม tries เป็น 10 · นิสัยชอบโซน (คะแนนบวกเล็กน้อย ≤ 0.5 เมื่อเป้าใกล้โซน): ขี้เซา/sleepy → ใกล้โรงนา, ตะกละ/glutton → ใกล้ครัวและชาม, ร่าเริง/ซน → ลานกลางและสนามเด็กเล่น, ขี้อาย/shy → ขอบลาน
- เกณฑ์: น้อง 16 ตัว XL (จำลองด้วย rng seed) ระยะเฉลี่ยถึงตัวใกล้สุด ≥ 1.5 เท่าของ baseline โค้ดเดิม (A วัด baseline จากโค้ดก่อนแก้ แล้ว hard-code ค่าใน test พร้อมคอมเมนต์)

## 5. โรงครัวในแมพ
- **D: `js/world3d/buildings.js` (ใหม่, LF)**:
  - `buildKitchen(THREE, { gradient, tier: 'high'|'medium'|'low' })` → `{ group, radius: 1.1, height, doorLocal:{x,y,z}, chimneyLocal:{x,y,z}, setCooking(sec), setNight(bool), update(dt, t), dispose() }`
  - โรงครัวน่ารักโทนเดียวกับโรงนา (ไม้ หลังคากระเบื้องส้ม ปล่องอิฐ หน้าต่างมีแสงตอนกลางคืน ป้าย 🍳 เหนือประตู) ประตูหัน +z · ≤ 3 draw calls (merged) + ควัน
  - ควัน: puff กลมๆ ลอยขึ้นจางหาย; ปกติควันจางๆ นานๆ ครั้ง (high/medium), `setCooking(4)` = ควันพุ่งถี่ 4 วิ · low = ไม่มีควัน
  - `buildPathMesh(THREE, polylines /* [[{x,z},...],...] */, { width: 0.9, color })` → Mesh เดียว แถบดินแบนสูง y=0.015 ขอบนุ่ม (vertex colour/alpha) รับเงาได้
  - `tests/v23d.test.js` (D เป็นเจ้าของ): draw call/สามเหลี่ยมของครัว, dispose ไม่ค้าง, path mesh เป็น 1 mesh
- **C: barn3d.js** วางครัวที่ `kitchenSpot(tier)` เป็น actor `'kitchen'` (stroke:false) ย้ายตาม tier · แตะครัว → กล้อง pan ไปหา 0.4 วิ แล้ว `ctx.openKitchen()`
- API ใหม่ของ mountBarn3d: `cooked(dishId)` → `setCooking(4)` + จานลอย (DOM ghost class `b3-dish-fly`) จากตำแหน่งจอของประตูครัวไปยังชิปจานในถาด (หรือมุมถาดถ้ายังไม่ render) ~0.8 วิ; calmMotion = ไม่ลอย
- **B: petsView.js** — หน้าลาน 3D **เอาปุ่ม 🍳 ออก** (โหมดรายการ/ไม่มี 3D ยังมี) · `barnCtx.openKitchen = openKitchen` · ทำสำเร็จ → `barn3d?.cooked?.(id)`

## 6. แก้อาหารหาย
- **B (petsView foodTrayHtml)**: ลำดับ = จานที่เพิ่งทำ (fresh) → จานอื่น → ของโปรดของน้องที่เลือก → ที่เหลือ; จาน fresh มีป้าย `<i class="b3-food-new">ใหม่</i>`; fresh = ทำในเซสชันนี้และยังไม่ได้ป้อน (เก็บใน Map ระดับโมดูล id → จำนวนตอนทำ; จำนวนลดลง = เลิก fresh) · ถาดเลื่อนกลับซ้ายสุดเมื่อมีจาน fresh ใหม่
- **B (util.notify)**: `notify(msg, type, { ms })` ส่งต่อให้ toast แสดงนานตาม ms (ไม่ส่ง = เดิม) · `run()` ใน petsView: ผลที่มี `r.dish` → 5000 ms
- **A (kitchen.js)**: ข้อความทำเสร็จ = `🍳 ทำ{emoji} {name}เสร็จแล้ว! อยู่ในถาดอาหารหน้าลาน ลากไปป้อนน้องได้เลย`
- **A (journal)**: kind ใหม่ `cook` (🍳 "วันนี้ทำ{a}ให้น้องๆ" ไม่มี pet) เรียกใน cook(); kind `dish` (😋 "{n} กิน{a}หมดจาน") เรียกใน feedPet เมื่อเป็นจานที่ไม่ใช่เมนูโปรด (เมนูโปรดใช้ favDish เดิม)
- **C (barn3d)**:
  - ลากอาหาร: น้องที่จะได้กินมีป้ายชื่อเหนือหัว (DOM class `b3-feed-tag`, ตามตำแหน่งจอทุกเฟรม) นอกจากวงเดิม · ปล่อยที่ไม่มีน้อง = เด้งกลับ (เดิม — ตรวจให้แน่ใจ)
  - แตะเลือกอาหาร (armed): ยกเลิกเองเมื่อ 8 วิไม่ได้ใช้ (`ARMED_FOOD_MS = 8000`) หรือแตะพื้นที่ว่าง
- **A (ตรวจ)**: อ่าน storage.js แล้วรายงานหัวหน้า (ไม่แก้) ว่ากรณีเล่น 2 เครื่อง/2 แท็บ มีทางที่ของที่ทำบนเครื่องหนึ่งหายโดยไม่มี backup ไหม

## 7. CSS (B: css/pets.css)
`.b3-mapbtn` (เหมือนปุ่ม 📷, สถานะ on), `.b3-food-new` (ป้ายเล็กมุมบนของชิป สีชมพู/ส้ม), `.b3-feed-tag` (ป้ายชื่อเม็ดยา ตัวหนา เหนือหัวน้อง pointer-events:none), `.b3-dish-fly` (position fixed, ตัวอีโมจิใหญ่, z-index เหนือฉาก) · มือถือ 375 px ไม่ล้น

## เจ้าของไฟล์ (ห้ามแก้ไฟล์ของคนอื่น — ต้องการอะไรให้แจ้งหัวหน้า)
| coder | ไฟล์ |
|---|---|
| A core | js/petBehaviour.js, js/kitchen.js, js/journal.js, js/pets.js, tests/v23.test.js (ใหม่), tests/pets.test.js, tests/world.test.js, tests/farm.test.js, tests/index.html (เพิ่ม 'v23','v23d') |
| B UI | js/ui/petsView.js, js/util.js, ไฟล์ toast/notify UI ที่เกี่ยว, css/*.css |
| C 3D | js/world3d/engine.js, js/ui/barn3d.js |
| D content | js/world3d/buildings.js (ใหม่), js/world3d/fx.js (ถ้าต้องใช้), tests/v23d.test.js (ใหม่) |

## เกณฑ์ผ่าน
- `python tests/run_tests.py` ALL PASS (test เดิมที่ล็อกตัวเลขรัศมีเก่า → A อัปเดตเป็นตัวเลขใหม่ ไม่ลบเจตนาของ test)
- tests/v23.test.js: ตัวเลข tier ตรงกันสองฝั่ง, ข้อจำกัดผัง §3, ครัวทุก tier, เป้าหมายเดินไม่ทับครัว, การกระจายตัว §4, journal cook/dish, ข้อความ cook
- draw call ที่ XL เพิ่ม ≤ 15 จาก V22 · มือถือ 375 px ไม่มี error ใน console
- หัวหน้าตรวจ: ภาพหลัง เดสก์ท็อป + มือถือ น้อง 16 ตัว XL, มุมดูทั้งฟาร์ม, แตะครัว→ทำอาหาร→จานลอยเข้าถาด→ลากป้อน (มีป้ายชื่อ)

## หมายเหตุหลังตรวจ (หัวหน้า)
- จานที่ทำในครัวลอยเข้าถาด **หลังปิดหน้าครัว** (ระหว่างเปิด หน้าต่างบังอยู่) · ป้าย "ใหม่" ตั้งก่อน cook เพื่อให้ถาดที่ re-render ใน run() เห็น
- เรื่องเล่นหลายเครื่อง: เซฟเป็นก้อนเดียว ใหม่กว่าชนะ (มี backup 3 ชุดในเครื่องที่ reconcile) — ยังไม่แก้ใน V23

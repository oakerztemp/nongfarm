# CONTRACT V25 — แมพสวย (Phase 6 รอบที่ 3 รอบสุดท้าย)

> 2026-10-29 · ผู้ใช้สั่งเริ่ม V25 · แผนรวม docs/PLAN_PHASE6.md · ภาพก่อน docs/design/v25/before_*.jpg (กลางวัน, กลางคืน, ดูทั้งฟาร์ม)
> **ไม่แตะ state (v9) · ไม่แตะเศรษฐกิจ · ไม่เพิ่ม library · ใช้แสง/หมอก/ลมของ Phase 5**
> ทีม: หัวหน้า (Opus) + coder sonnet A / B / C / D — ไฟล์มีเจ้าของคนเดียว (ตารางท้ายไฟล์)
> งบ: draw call ที่ XL เพิ่ม ≤ 10 จาก V24 (high) · ระดับ low ตัดของประดับเล็กออกได้ · ไม่มี per-frame allocation

## 1. พื้นและขอบแมพ (C: engine.js)
- **หญ้าเป็นหย่อม**: สนามในรั้ว (lawn) ไล่สีเขียว 3 เฉด เป็นหย่อมใหญ่นุ่มๆ (noise ความถี่ต่ำ, vertex colour — ไม่เพิ่ม draw call) + แถบตัดหญ้าจางๆ
- **ไม่เป็นเกาะ**: ขอบสนามกลืนเข้ากับทุ่ง (เลิกขอบสีดินวงกลมรอบนอก; สีขอบสนาม = สีทุ่งใกล้ๆ) · ทุ่งด้านในมีหย่อมดอกไม้ป่าเล็กๆ เพิ่ม (ใน instanced เดิม)
- **รั้วต้นไม้**: แนวหลังโรงนา (มุม ~200°–340° วัดจาก +x ทวนเข็มบนระนาบ x/z, ฝั่ง −z) เปลี่ยนเสา/ราวรั้วเป็นพุ่มไม้กลมเรียงกัน (instanced 1 draw call) ส่วนที่เหลือเป็นรั้วไม้เดิม
- **ประตูรั้ว**: ตรงที่ทางเดิน (§2 `yardPaths`) ตัดผ่านเส้นรั้ว เว้นช่องรั้ว + เสาประตู 2 ต้นสูงกว่าเสาปกติ มีซุ้มโค้งไม้เล็กๆ บนประตูหน้า
- **สะพานไม้ข้ามลำธาร**: ที่ปลายทางเดินฝั่ง +x (`yardPaths` เส้น 'bridge') สะพานไม้โค้งเล็กมีราว (merged 1 draw call) + ก้อนหินริมตลิ่งเป็นระยะ (instanced)
- **โรงนา**: กระบะดอกไม้ใต้หน้าต่าง, ฟางก้อน 2 ก้อนข้างโรงนา, หน้าต่าง/ประตูมีแสงอุ่นตอนกลางคืน (ใช้ night state เดียวกับโคม V20) — รวมอยู่ใน mesh โรงนาเดิมได้หรือ +1 draw call สำหรับหน้าต่างเรือง

## 2. ผังทางเดิน (A: petBehaviour.js, pure)
- `export function yardPaths(tier) -> [{ id, points:[{x,z},...], width }]` ย้ายนิยามเส้นทางที่ barn3d สร้างใน V23 มาไว้ที่นี่ (ประตูโรงนา→กลาง→ชาม, กลาง→ประตูครัว, กลาง→บ่อ M+) + เพิ่ม:
  - 'gate': กลางลาน → ประตูหน้า (ตัดรั้วด้านหน้าฝั่ง +z) → ออกไปในทุ่ง ~3 หน่วย
  - 'bridge': ข้างบ่อ/ฝั่งขวา → ตัดรั้วฝั่ง +x → ไปถึงหัวสะพานที่ลำธาร (ลำธาร: engine WILD.streamX, streamAmp, streamFreq — ใช้สูตรเดียวกับ engine หาตำแหน่ง x ของลำธารที่ z ของสะพาน)
  - export `fenceGates(tier) -> [{ id, angle, halfWidth }]` มุมที่ทางเดินตัดรั้ว (C ใช้เว้นช่องรั้ว)
- `export function pathLightSpots(tier) -> [{x,z}]` เสาไฟข้างทาง ห่างกัน ~2.6 ตามทางในรั้ว + 2 ต้นที่ประตูหน้า, อยู่ข้างทาง (ห่างเส้นกลางทาง 0.75), ไม่ทับ obstacle/ครัว/landmark/decor spot/ชาม/แถวตู้ฟัก (≥0.4 ขอบถึงขอบ), เข้า YARD.obstacles (r 0.15) · S ≤ 6 ต้น, XL ≤ 14 ต้น
- เกณฑ์ (test): ทุก tier เส้นทางอยู่ในลาน (ยกเว้นส่วนนอกประตู), ไม่ผ่าน obstacle อื่น (ยกเว้นปลายทางที่ประตูครัว/บ่อ/ชาม), ช่องประตูตรงกับจุดตัดรั้ว, เสาไฟตามข้อกำหนด, เป้าเดินเล่นน้องไม่ทับเสาไฟ

## 3. ของประดับทางเดิน + ไฟ (D: buildings.js)
- `buildPathBorder(THREE, paths, { gradient, tier, avoid:[{x,z,r}], seed })` → Group ≤ 2 draw calls (instanced ดอกไม้เล็ก 4 สี + ก้อนกรวด) วางสลับสองข้างทางห่างขอบทาง ~0.15–0.35 ไม่วางในวงกลม avoid และช่วงทางแยก (ใกล้จุดต่อของเส้นอื่น 0.8) · low = กรวดอย่างเดียว · มี dispose()
- `buildPathLights(THREE, spots, { gradient, tier })` → { group, setNight(bool), update(dt,t), dispose } เสาไฟไม้หัวโคมกระดาษ (instanced 1) + แสงเรือง additive (instanced 1, มองเห็นเฉพาะกลางคืน แสงกระพริบเบาๆ) · low = ไม่มีแสงเรือง (โคมเปลี่ยนสีเหลืองแทน)
- `buildSignBoard(THREE, { gradient, tier, texture })` → { group, setTexture(tex), dispose } ป้ายไม้มีเสาคู่ หน้าป้ายใช้ texture (≤ 2 draw calls) — ใช้แทนโมเดลของตกแต่ง 'sign' เดิม (C เปลี่ยนใน barn3d)
- tests/v25d.test.js: draw call ต่อชิ้นตามข้างบน, border ไม่วางใน avoid, lights setNight เปิด/ปิด glow, dispose

## 4. ชื่อฟาร์มบนป้าย (B)
- `js/world3d/signText.js` (ใหม่): `makeSignTexture(THREE, text, { width: 512, height: 160, fg: '#5a3a1e', bg: '#f3dfb8' })` → { texture, setText(text), dispose } วาดด้วย canvas ฟอนต์เกม (`getComputedStyle(document.body).fontFamily`, ตัวหนา) ย่อขนาดอัตโนมัติให้พอดี 1–2 บรรทัด (ภาษาไทยไม่ตัดกลางคำ: ตัดที่ช่องว่าง) วาดใหม่เมื่อ `document.fonts.ready` · ไม่มี DOM document (test env) = คืน texture ว่างไม่ throw
- ป้ายชื่อฟาร์ม (ของตกแต่ง 'sign' ที่ผู้เล่นสร้างเอง — **ไม่แจกฟรี**) แสดงชื่อฟาร์มจริง · แตะป้าย → `ctx.openFarmName()` เปิดหน้าตั้งชื่อฟาร์มเดิม (main.js ~บรรทัด 363 — แยกเป็นฟังก์ชัน export ให้ petsView เรียกผ่าน barnCtx)
- tests: B เพิ่มใน tests/v25.test.js ของ A ไม่ได้ (ไฟล์ของ A) → B เขียน tests/v25b.test.js (ใหม่) ทดสอบ makeSignTexture: ข้อความยาว/สั้น/ว่าง ไม่ throw, setText เปลี่ยน version ของ texture

## 5. ประกอบฉาก (C: barn3d.js)
- ทางเดิน: ใช้ `yardPaths(tier)` แทนเส้นที่เขียนเองใน placePaths (ทางนอกรั้วด้วย) · ของประดับทาง (`buildPathBorder` avoid = obstacles+landmarks+ครัว+decor spots+ชาม) · เสาไฟ (`buildPathLights(pathLightSpots(tier))`, setNight จาก syncLanterns) · ทั้งหมด rebuild ตาม tier, dispose ถูก
- ของตกแต่ง 'sign' ใช้ `buildSignBoard` + `makeSignTexture(ชื่อฟาร์ม)` อัปเดตเมื่อชื่อเปลี่ยน · แตะ = `ctx.openFarmName()` (แทน toast เดิม)
- ตรวจ draw call XL ก่อน/หลัง (world.getStats หลังนิ่ง) บันทึกในรายงาน

## เจ้าของไฟล์
| coder | ไฟล์ |
|---|---|
| A core | js/petBehaviour.js, tests/v25.test.js (ใหม่), tests เดิมถ้าจำเป็น, tests/index.html (+ 'v25','v25b','v25d') |
| B UI | js/world3d/signText.js (ใหม่), js/main.js, js/ui/petsView.js, css/*.css, tests/v25b.test.js (ใหม่) |
| C 3D | js/world3d/engine.js, js/ui/barn3d.js |
| D content | js/world3d/buildings.js, tests/v25d.test.js (ใหม่) |

## เกณฑ์ผ่าน
- `python tests/run_tests.py` ALL PASS
- draw call XL (high) ≤ V24 + 10 · มือถือ 375 px ไม่มี error · low tier ไม่มีของประดับเล็ก/แสงเรือง
- หัวหน้าตรวจ: ภาพหลัง กลางวัน / กลางคืน / ดูทั้งฟาร์ม (เดสก์ท็อป) + มือถือ เทียบภาพก่อน

## หมายเหตุหลังตรวจ (หัวหน้า)
- ป้ายชื่อฟาร์ม: หลังคาป้ายแคบลง (half 0.1) เพราะกล้องมองจากมุมสูง ~50 องศา หลังคาเดิมบังชื่อ
- draw call XL (high) หลังนิ่ง: V24 ~144-146 -> V25 ~142-143 (รวมโรงนาเป็น mesh เดียวชดเชยของใหม่)
- ไม่แจกป้ายชื่อฟาร์มฟรี (ทับกับของตกแต่ง 'sign' 80 เหรียญ) — ใช้ของตกแต่งเดิมแสดงชื่อจริงแทน

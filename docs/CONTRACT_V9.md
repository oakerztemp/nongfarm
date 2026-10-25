# NongFarm — Plan + Contract v9 (Phase 3B-2 "ความทรงจำกับน้อง" + 3C wave 2 "น้องน้ำ 3D")

Extends CONTRACT.md + V2–V8 (binding). The user approved starting the next phase (2026-10-25, ROADMAP_V3 §3B part 2 + §3C next wave).

**Theme:** reasons to stay and remember: dress the pets up, take photos, read their diary, enjoy the weather, and celebrate their birthdays. All of it is cosmetic or memory. Progress caps from V8 stay as they are, and coin sinks are welcome because late-game coins pile up.

## 1. แต่งตัวน้อง 🎀 (C — data, shop, drops; B — equip UI + 3D; A — state)
- **Data:** a new file `js/data/accessories.js` with 10 items, each in one slot, `head` or `neck`.

  | Slot | Items |
  |---|---|
  | head | 🎩 หมวกทรงสูง, 👒 หมวกปีกกว้าง, 🎀 โบว์, 👑 มงกุฎดอกไม้, 🧢 หมวกแก๊ป, 🎓 หมวกรับปริญญา |
  | neck | 🧣 ผ้าพันคอ, 🔔 กระดิ่ง, 📿 สร้อยดอกไม้, 🦋 หูกระต่ายผีเสื้อ |

- **Getting them:**
  - Most are bought in the shop for 300–3000 🪙, as a late-game coin sink.
  - 3 can only be found on expeditions, at a rare drop chance of about 1 % per trip in a matching zone.
  - Owned items go into `state.wardrobe { accId: count }`. A copy can be worn by one pet at a time.
  - Accessories can't be sold, so there's no buy→sell loop.
- **Equip (B):**
  - The pet sheet gets a "👗 แต่งตัว" row to pick from the wardrobe or take an item off. Stored as `pet.wear = { head, neck }`.
  - In 3D, items are simple merged meshes (≤ 1 extra draw call per worn item). `head` attaches to the head anchor and sits above the stage-3 crown. Billboards draw the accessory emoji overlaid on the sprite.
  - Rehoming a pet returns its accessories to the wardrobe.
- **Effect:** none. Purely cosmetic, plus a tiny happy +5 the first time an item is put on that day, which goes through the pet's normal happy stat and has no bond effect.

## 2. โหมดถ่ายรูป 📸 (A — engine snapshot + album storage; B — UI)
- **Engine (A):** `world.snapshot({ width, height, hideUi })` → a Promise of a dataURL. It renders one frame at the requested size, without the DOM labels, the way the lead's debug captures do today.
- **Album (A):** a new `js/album.js` keeps photos in **IndexedDB, local only**. Photos are never stored in the save, so cloud saves stay small. Up to 30 photos, each a JPEG of about 960 px, with `{ id, at, petIds, frame }` metadata. If IndexedDB is missing, the photo is offered as a download instead.
- **UI (B):**
  - A 📸 button on the yard opens photo mode. The UI hides, and you can drag or zoom the camera.
  - Choose a frame (5 cute frames, drawn on a 2D canvas over the snapshot, with the farm name and date) and add up to 3 stickers (emoji you can drag on).
  - Then save to the album, download, or share through the Web Share API when available.
  - The "📔 อัลบั้ม" sheet shows the photos in a grid; tap one to view it full size or delete it.

## 3. บันทึกน้อง 📔 (A — js/journal.js logic + state; B — sheet UI)
- `state.journal = [{ day: 'YYYY-MM-DD', lines: [{ emoji, text, petId? }] }]`, capped at 14 days and 6 lines per day.
- **Writers:** hatch, best friend formed, favourite spot discovered, birthday, first accessory worn, a photo taken, a postcard received, a melt from a long stroke (at most once a day per pet), and the away-digest highlights. Each kind of event per pet is written at most once a day, so it stays a diary and not a log.
- **UI:** a "📔 บันทึก" sheet on the yard, newest day first, written in a cute handwritten style (CSS only, no new font files).

## 4. อากาศ 🌦️ (A — js/weather.js + engine; B — behaviours)
- **Deterministic weather per real hour:** a hash of the date and hour picks sunny, cloudy, or light rain, with rain about 15 % of hours. It's the same on every device for the same hour. `weatherAt(ms)` returns `{ kind, intensity }`.
- **Engine (A):** a rain particle system (instanced, ≤ 2 draw calls), a softer sky and light tint on cloudy hours, and a few puddle decals on the ground while it rains. It works with the existing night lighting and lanterns.
- **Behaviours (B):**
  - Some pets jump in puddles, especially the `waterLover` trait, the water habitat, and ducks and frogs.
  - Others shelter under a tree or the gazebo.
  - When the rain stops there's a short sparkle of sun and sometimes a rainbow arc.
- **Effect:** none on the economy.

## 5. วันเกิดน้อง 🎂 (A — logic; B — scene)
- Every **30 days since hatch** (`bornAt`) is a "ครบเดือน" birthday, celebrated on that real day.
- **Scene (B):** the pet wears a party hat, a cake appears next to it, other pets gather and hop, and there's confetti.
- **Gift:** the first tap on the birthday pet that day gives +1 heart point through `addBond`, so the daily cap still applies, plus a journal line and a toast "🎂 วันนี้วันเกิด{ชื่อ} ครบ N เดือน!".
- If you weren't there that day, the next login's away digest mentions it, but there's no backfill gift.

## 6. น้องน้ำ 3D — 3C wave 2 (C — critters.js / models.js)
- **Fifteen water models** (humpback already exists): fish, tropicalfish, blowfish, squid, octopus, oyster, conch, shrimp, lobster, crab, frog, turtle, otter, dolphin, shark.
- **Fully aquatic pets** (fish, tropicalfish, blowfish, squid, octopus, dolphin, shark) live inside a **floating water bubble 🫧**. The bubble is a translucent sphere, shared across them through one material, so it adds ≤ 1 call each. They hover and bob around the yard inside it. That solves "fish on grass" in a cute way.
- **Walkers:** crab walks sideways, frog hops, turtle is slow, otter is playful.
- **Shells:** oyster and conch sit on a small sand tuft and open and close.
- **Budgets:** common and uncommon ≤ 1.2k tris and ≤ 6 calls; rare and epic ≤ 1.6k tris and ≤ 7 calls, plus the bubble. Use the standard part names.
- Also: shiny palettes, tests, and a "water" gallery set. B wires the special locomotion (bubble float, crab sideways, frog hop) in petBehaviour.

## Economy and save guardrails
- **State v7** (A — `MIGRATIONS[6]`, fixture `save_v6_midgame.json`): new fields `wardrobe`, `pet.wear`, `journal`, `pet.lastBirthdayGift`. Photos stay **out of the save**.
- **Econ gates** (C): every existing gate still passes.
  - Accessory prices are a coin sink: the day-14 3h income gate is unaffected, and buying accessories doesn't slow tier progress beyond ±25 %, since the bot only buys when it's rich.
  - Expedition drop odds don't change the existing drop value by more than 2 %.
  - No buy→sell loop.
- **Bond:** only the birthday +1, through `addBond`. A test proves the 30-a-day cap holds.
- **Save size:** a test checks that a maximal v7 save (20 pets, a full wardrobe, 14 days of journal, 120 friend pairs) serialises under 120 KB.

## Owners
- **A:** v7 migration first, `world.snapshot`, js/album.js, js/journal.js, js/weather.js plus the rain engine, birthday logic, tests.
- **B:** equip UI and 3D accessories, photo mode UI and the album sheet, the journal sheet, rain behaviours, the birthday scene, special locomotion for the water models.
- **C:** accessories data and shop and drops, econ gates, 15 water models with the bubble.
- **Browser:** open your **own tab** on your **own port**. Never act on an existing tab or on localhost:8790.

## Done
- ALL PASS, including the new gates and the save-size test.
- Dressed pets, a photo saved, downloaded and shown in the album, a diary with real lines, rain with puddle jumps, and a birthday party, all seen in the pane.
- 15 water pets in 3D within budget: 20 pets at XL ≤ 240 calls, counting bubbles and accessories.
- Then the reviewer, the lead check, and asking the user before deploy.

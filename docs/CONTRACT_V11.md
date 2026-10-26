# NongFarm — Plan + Contract v11 (Phase 3E "เทศกาล" + 3C wave 4 "น้องแมลง 3D")

Extends CONTRACT.md + V2–V10 (binding). The user approved this round on 2026-10-26: weekly festivals, starting with ลอยกระทง, plus the bug models.

**Theme:** a reason to come back every week. Each week one habitat has its festival, with small tasks, 🏮 festival lanterns to earn, and a cosmetic only that festival sells. In late November, ลอยกระทง replaces the weekly festival. You craft a krathong, float it on the stream with a pet, and sky lanterns rise at night.

**Economy rule:** festivals give no coins and no stardust. Everything they give is cosmetic. Materials spent on krathongs are the only economic touch.

## 1. Calendar (A — js/data/festivals.js, js/festival.js)

- **Weekly festival:** the week runs Monday 00:00 to Sunday 24:00, local time. The week key is `YYYY-Www` (ISO week). The featured habitat is `WEEKLY_ORDER[isoWeekNumber % 8]`, so it's the same on every device.

  | habitat | id | nameTh | emoji | festival accessory |
  |---|---|---|---|---|
  | farm | fest_farm | เทศกาลเก็บเกี่ยว | 🌾 | acc_strawhat 👒 หมวกฟาง (head) |
  | forest | fest_forest | เทศกาลป่าเขียว | 🌲 | acc_leafcrown 🍃 มงกุฎใบไม้ (head) |
  | bug | fest_bug | เทศกาลหิ่งห้อย | ✨ | acc_antenna 🐞 หนวดแมลงน้อย (head) |
  | water | fest_water | เทศกาลสายน้ำ | 🌊 | acc_floatie 🛟 ห่วงยางจิ๋ว (neck) |
  | sky | fest_sky | เทศกาลว่าว | 🪁 | acc_kitescarf 🧣 ผ้าพันคอลายว่าว (neck) |
  | savanna | fest_savanna | เทศกาลกลองทุ่ง | 🥁 | acc_beads 📿 สร้อยลูกปัด (neck) |
  | polar | fest_polar | เทศกาลหิมะ | ❄️ | acc_beanie 🧶 หมวกไหมพรม (head) |
  | mystic | fest_mystic | เทศกาลดวงดาว | 🔮 | acc_wizardhat 🎩 หมวกพ่อมดดาว (head) |

- **Special festival:** ลอยกระทง `fest_loykrathong` 🏮 runs **2026-11-17 00:00 to 2026-11-30 24:00**, and the night of loy is 2026-11-24. These dates sit in a `SPECIALS` table (`{ id, from, to, peakDay }`) so later years only add a row. The date was checked on 2026-10-26: ลอยกระทง 2569 is Tuesday 24 November, the full moon of the 12th Thai lunar month. While a special is on, it replaces the weekly festival.
- `activeFestival(nowMs)` returns `{ id, kind: 'weekly'|'special', habitat|null, nameTh, emoji, from, to, peakDay? }`. It is pure and deterministic.
- **Debug only:** with `?debug=1&fest=<id>`, that festival is forced (for tests and the lead's check). It is ignored without debug.

## 2. Tasks + lanterns 🏮 (A)

- Each weekly festival has **3 tasks**, picked deterministically from the week key out of this pool (H = the featured habitat):

  | task | target |
  |---|---|
  | ฟักน้องถิ่น H | 1 hatch |
  | ส่งน้องถิ่น H ออกสำรวจ | 2 trips |
  | ป้อนของที่น้องชอบ | 5 times |
  | ส่งออเดอร์ | 3 orders |
  | ลูบหัวน้อง | 10 strokes or pats |
  | เก็บเกี่ยว | 8 harvests |

  If the player's level hasn't unlocked H's egg yet, the H tasks are swapped for others from the pool. Each task pays **2 🏮** when claimed.
- **Progress** comes from `festivalEvent(state, kind, data)` hooks in the existing actions: hatch, expedition start, feed (favourite), order complete, pat/stroke, harvest. Only events inside the active festival's window count.
- **Login:** the first open each day during a festival gives +1 🏮, at most 7 per festival.
- **Lanterns** go in `state.festival.lanterns`. They carry over between festivals, can't be sold, and are worth no coins.
- **Festival shop:** each festival sells only its own items, for lanterns.
  - Weekly festivals: the accessory for **6 🏮**.
  - ลอยกระทง: acc_chada 👑 ชฎาน้อย (head) 6 🏮, acc_sabai 🧣 ผ้าสไบ (neck) 6 🏮, decor_lanna_lamp 🏮 โคมล้านนา (decor) 10 🏮, decor_big_krathong 🪷 กระทงยักษ์ (decor) 10 🏮.
  - One copy of each item per player. The item comes back when its festival returns in the rotation (8 weeks), so nothing is lost forever.
- **State:** `state.festival = { id, key, tasks: [{ id, kind, target, progress, claimed }], loginDays: ['YYYY-MM-DD'], lanterns, owned: { itemId: true }, krathong: { day, n } }`. When `activeFestival` returns a new key, the tasks reset and lanterns are kept.

## 3. ลอยกระทง 🪷 (A — logic; B — scene; C — data)

- **Craft** with `craftKrathong(state)`: 3 🌿 forage_herb + 1 🪵 forage_wood make 1 krathong, kept in `state.festival.krathongs` (≤ 5). Only while ลอยกระทง is on.
- **Float** with `floatKrathong(state, petId)`: needs a krathong and a yard pet that is idle, not sick and not asleep.
  - It gives +1 🏮, **at most 3 floats a day** (`krathong.day/n`). On the night of loy (peak day, 18:00–24:00) the cap is 5.
  - Each float writes a journal line "🪷 {ชื่อ} ลอยกระทง ขอให้…" with a wish from 12 cute templates.
  - It gives +2 happy to the pet. No bond, no coins.
- **Scene (B):**
  - The pet walks to the stream bank and sets the krathong on the water, which drifts downstream with a flickering candle light and fades at the yard edge.
  - At night, 6–10 sky lanterns (โคมลอย) rise slowly from the yard. They're instanced, ≤ 2 draw calls.
  - During ลอยกระทง there are paper lanterns on the fence and floating flowers. Total festival decoration is ≤ 4 extra calls.
- **Postcards:** while ลอยกระทง is on, new postcards come from 3 extra krathong-themed templates (data only, no reward).

## 4. UI (B)

- **Yard header:** a festival chip "🏮 {emoji} {nameTh} · เหลือ N วัน" that opens the festival sheet.
- **Festival sheet:**
  - The 3 tasks with progress bars and claim buttons, the lantern count, and the login streak dots.
  - The festival shop: items with their 3D-free preview emoji, price, and "มีแล้ว".
  - During ลอยกระทง, a "🪷 ทำกระทง" button showing the recipe and stock, and "ลอยกระทง" opening a pet picker.
- **Yard decoration:** bunting flags in the festival's colour along the fence (≤ 2 calls). ลอยกระทง has its own decoration (§3).
- **Accessories:**
  - The 10 festival accessories in 3D, built like V9: merged meshes, ≤ 1 call each.
  - The 2 decors are placeable like V7 decor. The big krathong sits on the pond or ground, and the lamp glows at night.
- **Away digest:** "ระหว่างที่คุณไม่อยู่ เทศกาล X เริ่มแล้ว!" when a new festival began while you were away.

## 5. น้องแมลง 3D — 3C wave 4 (C — models.js / critters.js; B — locomotion)

- **Thirteen bug models** (the beetle exists): bee, butterfly, ladybug, ant, caterpillar, earthworm, snail, cricket, fly, cockroach, mosquito, spider, scorpion.
  - Cute chibi with big eyes. The cockroach and mosquito must look friendly: round and pastel, never gross.
  - Use the standard part names (`wingL`/`wingR`, `tail`, `shell`, …).
  - **Budgets:** common and uncommon ≤ 1.0k tris and ≤ 6 calls; rare and epic ≤ 1.6k tris and ≤ 7 calls.
  - Add shiny palettes, coat support (free via `tm` colours), tests, and a "bug" gallery set.
- **Locomotion and idles (B, petBehaviour):**
  - Flyers (bee, butterfly, fly, mosquito) hover above the grass with fast-flapping wings. Like the water bubble pets, they never walk. The bee visits flowers and the pond lilies, and the butterfly drifts in loops.
  - The ladybug crawls and sometimes takes a short flight.
  - The ant marches, and two or more ants walk in a line.
  - The caterpillar inches along (body squash wave).
  - The earthworm wriggles and sometimes burrows down and pops up nearby.
  - The snail is very slow and hides in its `shell` when tapped.
  - The cricket hops, and chirps ♪ at night.
  - The spider sometimes hangs from a tree on a thread (one line mesh shared by all spiders).
  - The scorpion curls its `tail` when idle.

## Economy and save guardrails

- **State v9** (A — `MIGRATIONS[8]`, fixture `save_v8_midgame.json`):
  - It adds `state.festival` (defaults, `lanterns: 0`, `krathongs: 0`).
  - The sanitiser caps lanterns at 999 and krathongs at 5, removes unknown owned ids, and checks the tasks have the right shape.
  - Festival accessories go into the existing `wardrobe`. Festival decors go into `inventoryDecor`.
- **Econ gates (C, econ-sim):**
  1. Festivals pay no coins and no stardust. Festival items can't be sold and aren't in any coin shop.
  2. The bot does festival tasks and crafts and floats krathongs, but only with herbs and wood beyond the next two yard upgrades' needs. With festivals ON vs OFF:
     - income per hour is within ±3 %
     - yard tier times stay within ±25 % of the V6 baseline
     - the existing day-14 gates still pass
  3. Lantern income is bounded: one weekly festival gives ≤ 6 + 7 = 13 🏮, and ลอยกระทง ≤ 14 × 3 + 2 + 7 + 6 = 57 🏮. A test enumerates both.
  4. Every existing gate still passes.
- **Save size:** the maximal save stays under 120 KB with the festival state included.

## Owners

- **A (core):** festivals.js (calendar, SPECIALS, task pool), festival.js (activeFestival, festivalEvent hooks, claimTask, loginLantern, buyFestivalItem, craftKrathong, floatKrathong), the hooks in the existing actions, v9 migration + fixture **first**, journal and postcard data, tests (calendar incl. ISO week edges and the special window, task determinism, hooks count only inside the window, daily caps, peak-night cap, shop once-only, migration, sanitiser).
- **B (UI/behaviour):** the festival chip and sheet, shop UI, krathong craft and float flow, the stream scene + sky lanterns + festival decoration, the 10 festival accessories' 3D meshes, the 2 festival decor models, the away line, bug locomotion and idles (+ tests like the water/sky ones).
- **C (content/econ):** 13 bug models + gallery set + model tests, the festival accessory and decor **data entries** (accessories.js / decor.js: `festival: '<fest id>'`, price in 🏮, not in the coin shop), econ gates + bot festival play.
- B and C import A's API by the names above. Until A lands, they code against this contract and never edit A's files.
- **Browser:** open your **own tab** on your **own port** (B 8795, C 8796, A 8797 if needed). Never act on another tab and never use 8790. Never open tests/index.html on 8790. `.claude/launch.json` lives at the SANDBOX root.
- **Line endings:** keep each file's existing line endings (`git ls-files --eol`). Many files are CRLF.

## Done

- ALL PASS (`python tests/run_tests.py`), including the new gates.
- Seen in the pane:
  - a weekly festival chip, sheet and task claim, and an accessory bought and worn
  - with `?debug=1&fest=fest_loykrathong`: a krathong crafted and floated by a pet, drifting with its candle, and sky lanterns at night
  - the 13 bug pets moving as described
  - 20 pets at XL ≤ 240 calls with the festival decoration on
- Then the reviewer, the lead check (including the ลอยกระทง 2026 date), and asking the user before deploy.

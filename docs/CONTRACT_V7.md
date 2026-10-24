# NongFarm — Plan + Contract v7 (Phase 3A "ลานของน้อง")

Extends CONTRACT.md + V2–V6 (binding). Approved by the user 2026-10-24 (ROADMAP_V3.md §3A). Lead plan written before code.
Theme for every decision: **the pets are the star, not the UI**. Less chrome, more pet.

## User comments this round fixes
1. Yard grows but looks the same size (camera re-fits every tier).
2. Yard upgrade only costs coins; expeditions feel pointless.
3. The 🎁 gift card is too big; attention should be on the pets.
4. A full yard blocks hatching, so players must release a pet blind.
+ leftover: pet picker sorted by power.

## 1. State v5 (A — `STATE_VERSION = 5`, `MIGRATIONS[4]`, fixture `save_v4_midgame.json`)
```js
yard.byPet: { [petId]: { c: 0, ms: 0, prog: 0, items: {} } }  // per-pet gift (coins float, credited ms ≤ cap, item progress, held items)
nursery: []            // [{ pet, hatchedAt }] max NURSERY_SLOTS = 3; pet is a full pet object (status 'nursery')
decor: []              // [{ id, decorId, spot }] placed yard decorations (spot = index of a tier-dependent decor spot)
inventoryDecor: {}     // decorId -> count built but not placed
postcards: []          // [{ id, petName, speciesId, text, at, read }] max 30 (oldest dropped)
```
Migration: v4 `yard.pending` + `yard.items` are split evenly across pets at home into `byPet` (no coins lost; rounding remainder to the first pet); `yard.prog` dropped into byPet proportionally or as a carry. Old `yard.accMs/pending/items/prog/n` removed after the move. `repairStations` still runs. Unknown species / dangling `byPet` keys → dropped.

## 2. ลานโตจริง (A — engine; B — barn3d)
- **Fixed camera scale:** the camera distance no longer re-fits the island per tier. Use one distance (the current fit for tier **M**) for every tier, so pets keep the same size on screen.
- **Wilderness outside the fence:** a wide meadow ring beyond the yard (ground radius ≥ XL island + 4), with instanced tall grass, bushes, trees and rocks, plus a small stream on one side. ≤ +6 draw calls. At tier S the fenced patch sits small inside this landscape. At XL the yard is larger than the screen.
- **Upgrade = the fence moves outward** into the wild (the existing 0.9 s grow animation). Wild props that end up inside the new fence fade or sink away; new yard props pop in.
- **Pan:** one-finger drag pans the camera target, clamped to the current island radius. Pinch/wheel zoom keeps working, clamped to sensible bounds. Double-tap re-centres. Pans must not steal taps on pets (move threshold ~8 px).
- Budgets: 20 pets at XL ≤ 230 draw calls; S-tier scene ≤ 140.

## 3. ขยายลานใช้วัสดุ + ของตกแต่ง (C — farm.js data/logic, shop UI; econ sim)
- `barnUpgradeCost(state)` returns `{ coins, items: { forage_wood: n, forage_stone: n, ... } }` (replacing the price-only API; keep `barnUpgradePrice` returning coins for old callers). Each slot needs wood + stone. Tier-entry slots also need a themed item: entering M needs `forage_shell` (pond), L needs `forage_berry` or `forage_honey` (flowers), XL needs `forage_gem` (hill). Coin price may drop so total value stays similar.
- Materials can't be bought, only gathered (expeditions, orders' leftovers, yard gifts). Their sell price stays low, so there is no loop.
- **Decor** (new `js/data/decor.js`, C), 6 items, each built from materials + a few coins:

  | Decor | Emoji | Pets use it for |
  |---|---|---|
  | ที่นอนนุ่ม | 🛏️ | napping |
  | ชามอาหาร | 🥣 | eating at it |
  | ลูกบอล | ⚽ | kicking it around |
  | ม้าโยก | 🐴 | rocking |
  | กองใบไม้ | 🍂 | jumping in it |
  | ป้ายชื่อฟาร์ม | 🪧 | shows the farm name |

  - Decor is **cosmetic + behaviour only**. No stat bonus, so the economy isn't touched beyond the build cost.
  - `buildDecor(state, decorId)`, `placeDecor(state, decorId, spot)`, `removeDecor(state, id)`.
  - Spot count per tier: S 2, M 4, L 6, XL 8. Spots are given by A's engine as `world.decorSpots`.
- Shop: a "ขยายลาน" card showing what's needed (✅/❌ per material) plus the next-tier preview, and a "ตกแต่งลาน" section.
- **Econ gates** (C extends `econ-sim.test.js`; all existing gates must pass):
  - The bot gathers materials via expeditions and upgrades when it can. Time to reach yard M/L/XL stays within ±25 % of the V6 baseline: record the baseline first and paste it in the test.
  - No buy→sell loop with materials or decor.
  - Decor build cost is a coin sink, and the 3h day-14 coins/h gate still holds.

## 4. ของขวัญอยู่ที่ตัวน้อง (B — pets.js logic, barn3d + petsView UI)
- `tickYard` credits per pet into `yard.byPet[id]` with the same rates. The cap is **6 h of that pet's own production** (`ms ≤ YARD_CAP_MS`). Items: each pet's fractional progress becomes held items in its own habitat. Still deterministic, with no RNG.
- `collectPetGift(state, petId)` → `{ ok, coins, items }`; `collectYard(state)` collects all (the chip). `yardPreview` stays as an aggregate.
- **UI:**
  - **Remove the big 🎁 card** (both 3D and list headers).
  - In 3D, a pet with a gift ≥ 1 coin shows a small 🎁 above its head; when that pet's cap is full it shows 🎁✨ and waves.
  - **Tapping that pet collects its gift**: the pet hops, coins fly to the coin counter, and the pet sheet opens only on a second tap.
  - A small chip "🎁 N" in the scene's top corner collects everything.
  - The list view shows a 🎁 badge on each pet card.
- Economy is unchanged (same rates, per-pet cap ≈ the old global cap). C re-runs the yard gates with per-pet collection.

## 5. เปลอนุบาล + ส่งไปบ้านใหม่ (B — pets.js, petsView, barn3d nests)
- `hatchReady` with a full yard → the baby goes to `state.nursery` (if a nursery slot is free) with the normal reveal ceremony, showing species, personality, trait and shiny. Hatching is blocked only when both the yard and the nursery are full ("เปลเต็มแล้ว").
- Nursery babies are frozen: no stat decay, no work, no yard gifts. They show as sleeping babies in cribs beside the nests in 3D and as a "👶 เปลอนุบาล" row in the list.
- **Actions on a nursery baby:**
  - "รับเข้าลาน" (needs a free yard slot)
  - "สลับกับน้องในลาน…" opens the compare picker
  - "ส่งไปบ้านใหม่"
- **Rename release → "ส่งไปบ้านใหม่ 🏡💌"** everywhere (UI text). The reward stays the same stardust (STARDUST_BY_RARITY ×2 shiny). Gifts the pet still holds are auto-collected first.
- **Postcards:** 12–36 h after rehoming, a postcard arrives in `state.postcards` with a cute template line using the pet's name and species (≥ 20 templates). A 💌 badge appears on the yard header, and opening it shows the card. Postcards have no reward, only warmth.
- **Compare helper** (used by both swap and rehome pickers): each candidate shows emoji, name, stage, power, ❤️ hearts, ✨ shiny, 📌 station, rarity, and **"ซ้ำ ×N"** (how many of that species you own including the baby). It's sorted so the likely choices (duplicates, lowest power, fewest hearts, not shiny, not stationed) come first, with a soft hint "ตัวซ้ำ แนะนำ". Never auto-select.
- Working or expedition pets can't be rehomed (existing rule). A stationed pet shows the 📌 warning (V6).

## 6. Small leftovers
- Pet picker sorted by power for that slot (C, farmView), best first, with a ties → hearts tiebreak.

## Owners & order
- **A**: §1 migration + fixture **first** (others depend on it), §2 engine (camera, wilderness, pan, `decorSpots`), README.
- **B**: §4 gifts on pets, §5 nursery/rehome/postcards/compare, barn3d for §2 (props fading, upgrade moment), decor behaviours (pets use placed decor), decor placement UI in the 3D yard (tap a glowing spot → pick decor).
- **C**: §3 materials + decor data/logic + shop UI + econ gates, §6 picker sort.
- Each owner edits only their own files and asks the lead before touching another's file.
- Tests: **never open tests/index.html on localhost:8790** (the showcase origin). Use `python tests/run_tests.py` or your own port.

## Done
- ALL PASS including the new econ gates, and v4 saves migrate with no coins or pets lost.
- At S the yard looks small in a wide landscape, and at XL it is bigger than the screen with pan working.
- Gifts are collected by tapping pets, with no big card.
- A full yard can still hatch into the nursery, and the compare helper shows duplicates.
- Budgets hold, with no console errors.
- Reviewer → lead (pane + screenshots) → ask the user before deploy.

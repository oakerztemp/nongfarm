# NongFarm — Plan + Contract v6 (ลานน้องๆ, น้องประจำแปลง, ลานให้ของ, ปั้นตำนานที่เหลือ)

Extends CONTRACT.md + V2–V5 (binding). Lead plan written **before** any code (user rule: plan first every time; anything touching income must pass the economy simulator).

## User requests → plan

| # | Request | Plan |
|---|---|---|
| 1 | ทำงานที่ค้าง | **This round:** 3D models for the 4 remaining legendaries (humpback 🐋, eagle 🦅, beetle 🪲, polar bear 🐻‍❄️). **Next rounds (not now):** other habitats' models, farm tab 3D (L3). |
| 2 | อัปเกรดแล้วคอกเหมือนเดิม + เปลี่ยนคำว่า "คอก" เป็น "ลาน" | Rename everywhere in UI to **ลาน** (tab 🏡 ลาน, ขยายลาน, ลานเต็ม…). Yard visibly grows with `barnCapacity` in 4 tiers with new props. |
| 3 | น้องประจำแปลงได้ ไม่ต้องใส่ใหม่ทุกรอบ | **Stations**: a pet can be pinned 📌 to a plot slot; it auto-returns to work whenever the plot is growing and it can work, goes home to rest when tired/hungry/sick or when the crop is ready, and comes back by itself. |
| 4 | น้องในลานทำประโยชน์ เช่น เงินต่อนาที (กลัวเศรษฐกิจพัง) | **ลานให้ของ**: idle/happy pets at home slowly produce small coin gifts + occasional habitat items, accumulated up to a cap and collected with one tap. Strict economy guardrails below. |

## 1. State v4 (A — `STATE_VERSION = 4`, `MIGRATIONS[3]`, fixture `save_v3_midgame.json`)
```js
plot.stations: [null, null, null]   // petId pinned per slot index (persists across crops)
pet.station: null | { plotIndex, slot }
yard: { pending: 0, items: {}, lastAt: 0 }   // ลานให้ของ accumulator (coins float, items {itemId: n})
```
Migration: pets currently working on a plot become stationed on that slot (friendly default); everything else null; `yard.lastAt = now`. Keep pet↔plot links consistent both ways (a station pointing at a missing pet/plot → cleared).

## 2. Stations (C — farm.js/farmView.js; B — status handling in pets.js where needed)
- `stationPet(state, plotIndex, slot, petId)` / `unstationPet(state, plotIndex, slot)`; assigning a helper from the picker stations it by default (picker has a "📌 ประจำแปลง" toggle, default on; off = one-off like today).
- `tickFarm` auto-dispatch per growing plot and active slot (slot < crop.slots): stationed pet idle (not sleeping) && canWork → assign (task); working && (energy < 20 || hunger < 15 || sick) → send home (keep station). When the crop becomes ready → helpers go home (existing), stations kept. Empty plot → stationed pets stay home "รอที่ลาน".
- Tired stationed pets auto-sleep at home (energy +20/h) and wake at 100 (existing) → automatic work/rest cycle. A stationed pet can't be stationed elsewhere; sending it on an expedition or releasing it clears the station (with a confirm in the UI).
- The ≥ 25 % share rule for harvest bonus/XP/bond stays as is.
- UI: 📌 badge on stationed slot chips; plot card shows stationed-but-resting pets dimmed with their state (💤 พัก / 😋 หิว / 🤒); ✕ removes the station; barn/yard sheet shows "ประจำแปลง #N".

## 3. ลานให้ของ (B — pets.js logic + barn3d visuals; C — economy sim)
- `tickYard(state, dtMs)` (called from tickPets; offline catch-up uses the same function): each pet that is **at home and awake or sleeping** (not working/expedition) adds coins/h = `base[rarity] × (1 + 0.1 × hearts) × mood`, base = common 3, uncommon 4, rare 6, epic 9, legendary 14; mood = happy ≥ 70 → 1, ≥ 30 → 0.6, else 0.2; sleeping × 0.5; sick → 0. Working pets earn nothing here (real choice: farm vs. home).
- Items: per pet, a chance per hour (rare 5 %, epic 8 %, legendary 12 %, others 3 %) of one item from its habitat table (farm → food_milk / seed of an unlocked crop; forest → forage_mushroom/forage_berry; water → forage_shell/forage_fish; sky → forage_feather; bug → forage_honey; savanna → forage_bone; polar → forage_fish; mystic → forage_star/forage_gem). Deterministic expected-value accumulation (no RNG farming by reloading): accumulate fractional item progress per habitat.
- **Cap**: the yard stores at most **6 hours** of production (coins and items); beyond that it stops filling (nudges players to come back, limits offline windfall).
- `collectYard(state)` → `{ok, msg}` adds coins/items, bumps `stats.yardCollected`. Not affected by the bond daily cap.
- UI: a 🎁 "ของขวัญจากลาน 🪙N" button on the yard header (and list view header) with a fill bar to the cap; in 3D, pets with pending gifts occasionally pop a small 🪙 above them; collecting makes coins fly from pets to the button.

### Economy guardrails (C extends tests/econ-sim.test.js — all existing V2 gates must still pass)
- Sim profiles collect the yard at every session; the bot decides farm vs. home as today.
- New gates: yard income ≤ 20 % of total coin income for every day of the 3h and realistic profiles; total 3h coins/h on day 14 still ≤ 4500; plots-full day still ≥ 10; no buy→sell loop with yard items; a 72 h offline return yields ≤ 6 h of yard production.
- If a gate fails, tune `base` rates / cap (data), never the gates.

## 4. ลาน grows with upgrades (A — engine island/props API; B — barn3d)
- Tiers by `barnCapacity`: **S** 3–5 (small meadow), **M** 6–9 (+ pond 💧 and a tree), **L** 10–14 (+ flower bed and a little playground), **XL** 15–20 (+ hill with a gazebo, lanterns that glow at night). Walkable radius grows per tier (~4.3 → 5.0 → 5.6 → 6.2) and the camera fits it. Upgrading the yard plays a short "ลานกว้างขึ้น!" moment (fence expands + confetti).
- Props are static, merged/instanced, ≤ +15 draw calls at XL.
- Shop/upgrade card: "ขยายลาน" with a preview line of what the next tier adds.

## 5. Rename "คอก" → "ลาน" (each owner in their own files; 24 occurrences today in pets.js, quests.js, farm.js, engine.js, petsView.js, species.js, questBar.js, farmView.js, settings.js)
Tab label 🏡 ลาน; incubator/ nest copy unchanged; README/docs updated by A. Save field names stay (`barnCapacity`) — UI text only.

## 6. Legendary models (C — critters.js/models.js)
humpback (chubby whale, tail fluke pivot, water spout anchor), eagle (wings spread pivots, hooked beak, white head), beetle (iridescent shell halves as wing pivots, horn), polarbear (round, small ears, black nose). Same budgets as V5 (≤ 1.8k tris, ≤ 7 calls), legendary ×1.25, curated shinyPalette, gallery + tests. B wires their signature moves to the real parts (eagle wing flaps while soaring, whale fluke + spout on breach, beetle shell open on shimmer).

## Owners & order
- **A**: §1 migration first (others depend on it), §4 engine API for island radius/props/tier, rename in own files, README.
- **B**: §3 yard logic + UI + 3D gifts, §4 barn3d tiers, §2 station display in yard sheet, §6 wiring, rename in own files.
- **C**: §2 stations (logic + farm UI), §3 economy sim gates, §6 models, rename in own files.
- Reviewer → Lead (pane + showcase screenshots) → ask user before deploy.

## Done
ALL PASS incl. new econ gates; migration of real v3 saves keeps every pet/plot; showcase shows a visibly bigger yard at capacity 20; no console errors; budgets: 20 pets XL yard ≤ 215 draw calls.

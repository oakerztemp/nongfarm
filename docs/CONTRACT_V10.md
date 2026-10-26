# NongFarm — Plan + Contract v10 (Phase 3D-1 "ครอบครัวน้อง" breeding + 3C wave 3 "น้องฟ้า 3D")

Extends CONTRACT.md + V2–V9 (binding). The user approved the next phase on 2026-10-26 and picked **breeding** as the first 3D feature (ROADMAP_V3 §3D). 3C wave 3 (sky) runs alongside, as in earlier rounds.

**Theme:** two pets who love each other get a family egg. The baby takes after its parents (species, personality, coat colour, a better shiny chance) and remembers who they are. Breeding is a late-game coin sink and a collection goal (coats), never a faster way to stardust or legendaries.

## 1. Rules (A — js/breeding.js, pets.js hatch path)

- **Unlock:** player level ≥ 6.
- **Who can breed:** two different pets **in the yard** (not nursery), both stage ≥ 2 (โตเต็มวัย), both ≥ 3 hearts, not sick, not sleeping, not working, not on an expedition, and `now() >= pet.breedReadyAt`. **Legendary pets cannot breed** (they are one of a kind; the UI says so kindly). Any two species may pair, across habitats too.
- **Cost:** `breedCost(a, b) = 3 × max(egg price of a's habitat, egg price of b's habitat)` coins (EGGS table). **Best friends** (friends.js `bestFriendOf`) pay ×0.8, rounded to 10. No stardust cost.
  - This was 2× and ×0.7 in the first draft. Econ gate 1 failed with those values: 144 of 484 pairs out-earned the egg in stardust per coin, and the worst was +65 %. With 3× and ×0.8, the worst pair reaches 0.96 of the egg.
- **Cooldown:** `BREED_COOLDOWN_MS = 72 h` per parent, set on both.
- **Result:** a **family egg** is laid at once into `state.familyEggs` (cap `FAMILY_EGG_MAX = 2`; breeding refuses when full). Family eggs can't be sold, bought, or gifted.
  `{ id, laidAt, habitatA, habitatB, a: { petId, name, speciesId, personality, shiny, coat, gen }, b: {…} }`: a snapshot, so a parent may be rehomed later.
- **Incubate:** `putFamilyEggInIncubator(state, eggId)` uses the normal incubator capacity. The slot is `{ eggId: 'egg_family', family: <egg>, startAt, readyAt }`, hatch time = **2 × the longer** of the two habitat eggs' `hatchMs`.
- **Hatch (`hatchReady` reads `slot.family`)** rolls the genes then (same nursery rules as normal eggs):
  - **Species:** pick parent A or B 50/50. With chance `INHERIT[rarity]` = common 1, uncommon 0.85, rare 0.6, epic 0.3 the baby is that parent's species; otherwise a normal egg roll of that parent's habitat (`pickSpeciesForHabitat`).
  - **Personality:** 40 % A, 40 % B, 20 % random.
  - **Shiny:** 3 % base + 7 % per shiny parent (max 17 %).
  - **Coat:** same coat on both parents → 80 % that coat; else 45 % / 45 %; the rest (20 % / 10 %) is a **mutation** to a random non-base coat (weighted, see §2).
  - **Family:** `pet.family = { gen, a: { name, speciesId }, b: { name, speciesId } }`, `gen = max(parent gen) + 1` (shop/expedition pets are gen 0, no `family`).
  - Collection, player XP, `bumpStat('hatched')` as normal, plus `bumpStat('bred')` and `state.coatsSeen[coat] = true`.
- `breedPreview(state, a, b)` → `{ ok, reason, cost, friendDiscount, species: [{ speciesId|null, habitat, chance }], shinyChance, coats: [{ coat, chance }] }`. It's the single source of truth for the UI odds; a test checks it sums to 1 and matches 20k rolls within ±1.5 %.
- **Journal (journal.js):** "💞 {A} กับ {B} มีไข่ครอบครัวแล้ว" when laid; "🐣 ลูกของ {A} กับ {B} ฟักออกมาแล้ว" on hatch; the usual once-a-day rule applies.

## 2. Coats 🎨 (A — js/data/coats.js; C — 3D)

| id | nameTh | emoji | mutation weight |
|---|---|---|---|
| base | ขนปกติ | ⚪ | — (every non-bred pet, default when the field is missing) |
| cream | สีครีม | 🍦 | 30 |
| cocoa | สีโกโก้ | 🍫 | 30 |
| mint | สีมิ้นต์ | 🌿 | 20 |
| rose | สีชมพูกุหลาบ | 🌸 | 15 |
| midnight | สีเที่ยงคืน | 🌙 | 5 |

- Each coat has a gentle body-colour transform `{ hue, sat, light }` (C tunes it so the pets stay cute and readable). It applies only to body-like (`tm`) colours, never eyes or fixed colours.
- **3D (C):** `makePalette` takes the coat. The template cache key becomes `id|shiny|coat|gradient`. **Shiny wins:** a shiny pet uses the shiny palette and ignores the coat in 3D. Billboards don't tint; the UI shows the coat chip.
- **Book (A):** goal `coats_all` "🎨 สะสมสีขนครบทุกสี (6)" → 50 ✨, counted from `state.coatsSeen`.

## 3. UI + scene (B)

- **Pet sheet:**
  - A new "💞 หาคู่" row shows why a pet can't breed yet (level, stage, hearts, cooldown countdown, legendary, family eggs full).
  - It also shows a "ครอบครัว" line for bred pets: parent emojis, names, "รุ่นที่ N", and the coat chip.
- **Partner picker:**
  - It lists the eligible yard pets, with the best friend first (💕 and the discount).
  - Each row previews from `breedPreview`: cost, "ลูกจะเป็น 🐶 45 % · 🐱 45 % · 🥚 สุ่มถิ่น 10 %", shiny %, and the coat odds as chips.
  - Confirm only after a second tap that shows the price.
- **Scene (barn3d):**
  - Both pets walk to each other, nuzzle, and get a heart burst.
  - A ribbon egg pops out between them, and there's a toast.
  - It works for billboards too, and it's skipped gracefully while either pet is off-screen or the 3D view is off.
- **Incubator view:**
  - A "🥚💞 ไข่ครอบครัว" row shows each family egg with its parents' emojis and a "ใส่ตู้ฟัก" button.
  - In the incubator, the egg has a pastel ribbon and shows its parents.
  - The hatch ceremony says "ลูกของ {A} กับ {B}".
- **Book:** coat collection progress with the 6 chips.

## 4. น้องฟ้า 3D — 3C wave 3 (C — models.js / critters.js; B — locomotion)

- **Eleven sky models** (the eagle already exists): sparrow, dove, canary, tit, hatchling, parrot, bat, swan, owl, flamingo, peacock. Use the standard part names (`wingL`/`wingR`, `tail`, …).
- **Budgets:** common and uncommon ≤ 1.2k tris and ≤ 6 calls; rare and epic ≤ 1.6k tris and ≤ 7 calls. Add shiny palettes, tests, and a "sky" gallery set.
- **Locomotion and idles (B, petBehaviour):**
  - Small birds (sparrow, dove, canary, tit, parrot) hop-hop and sometimes flutter up for a short hop-flight with flapping wings.
  - The hatchling wobbles in half an eggshell.
  - The bat sleeps (wings folded) by day and flutters in loops at night.
  - The owl turns its head on tap.
  - The swan glides slowly.
  - The flamingo stands on one leg when idle.
  - The peacock fans its tail when tapped, as its special move.

## Economy and save guardrails

- **State v8** (A — `MIGRATIONS[7]`, fixture `save_v7_midgame.json`): `state.familyEggs = []`, `state.coatsSeen = { base: true }`, `pet.coat` (missing = base), `pet.family`, `pet.breedReadyAt`, incubator `slot.family`. The sanitiser keeps `slot.family` and drops a malformed one.
- **Econ gates (C, econ-sim):**
  1. **No dust pump.** For every parent-rarity pair (common…epic) and habitat, the expected rehome stardust (shiny ×2 included) per coin of `breedCost` is ≤ the same for buying that habitat's egg. Best-friend price included.
  2. **No coin pump.** Per coin spent, a bred baby's `RELEASE_COINS` plus 14 days of yard value is ≤ the same for a bought egg. (The first wording, "can't repay its cost in 14 days", was impossible: any pet repays an egg many times over.)
  3. The bot breeds when rich (coins ≥ 3× cost, best friend preferred). With breeding ON vs OFF:
     - day-14 income/h is ≤ 1.15×
     - yard income stays ≤ 20 % on every day
     - yard tier times stay within ±25 % of the V6 baseline
     - the bot really breeds (≥ 3 family eggs hatched by day 14)
  4. Family eggs and coats have no buy→sell path.
  5. Every existing gate still passes.
- **Save size:** a maximal v8 save (V9 test + 2 family eggs + 3 bred slots) stays under 120 KB.

## Owners

- **A (core):** coats.js data, v8 migration + fixture **first**, breeding.js (canBreed, breedCost, breedPreview, breed, putFamilyEggInIncubator), the hatch path in pets.js, journal lines, the coat book goal, tests (rules, cooldown, legendary block, odds vs. preview, migration, sanitiser, save size).
- **B (UI/behaviour):** pet-sheet row + family line, partner picker with preview, family-egg row + incubator look + hatch line, book coat progress, the barn3d breeding scene, the sky locomotion and idles.
- **C (content/econ):** coat palettes in critters.js, 11 sky models, model tests + gallery set, econ gates + bot breeding.
- B and C import A's API by the names above. Until A lands, they code against this contract and don't edit A's files.
- **Browser:** open your **own tab** on your **own port**. Never act on an existing tab or on localhost:8790. Never open tests/index.html on 8790.

## Done

- ALL PASS (`python tests/run_tests.py`), including the new gates and the save-size test.
- Seen in the pane:
  - a breeding scene
  - a family egg put in the incubator and hatched with a family line and a coat
  - a mint / rose coat visible in 3D
  - the 11 sky pets moving as described
  - 20 pets at XL ≤ 240 calls
- Then the reviewer, the lead check, and asking the user before deploy.

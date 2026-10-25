# NongFarm — Plan + Contract v8 (Phase 3B-1 "จับต้องน้องได้" + 3C wave 1 "น้องป่า 3D")

Extends CONTRACT.md + V2–V7 (binding). Approved by the user 2026-10-24 (ROADMAP_V3 §3B part 1 + §3C forest).

**Theme:** touching a pet should feel like touching a real pet. Every gesture gets an immediate, physical, cute reaction. The rewards stay exactly where they are today: hearts and bond still come only from `patPet` (5 a day) and `feedPet`, under the same 30-a-day bond cap. New interactions are about feel, not faster progress.

## What exists today (build on it, don't duplicate)
- Tapping a pet in 3D calls `patPet`, which gives +1 bond and +3 happy, 5 rewarded pats a day, and a heart effect (barn3d `onPetTap`).
- The food tray works by arming an item and then tapping a pet; `feedWith` flies the food emoji to the pet and the pet does an eat reaction.
- Bond caps: `BOND_DAILY_CAP` is 30 and `PAT_DAILY_MAX` is 5.

## 1. ลูบหัว / เกาคาง (A — engine gesture API; B — barn3d reactions)
- **Engine (A):** a press that starts on a pet and moves becomes a **stroke**, not a pan. API: `world.onPetStroke(fn)` with `{ id, phase: 'start'|'move'|'end', point, region, speed, durationMs }`. `region` is one of `'head' | 'chin' | 'back'`, picked from the hit point relative to the actor's head anchor and body. Taps stay taps (< 8 px), and drags that start on empty ground still pan.
- **Reactions (B):**
  - While stroking, the pet faces the hand, leans in, tilts its head, squints (eyes ^^), with soft 💕/♪ particles.
  - After about 2 s of stroking it melts: lies down or rolls over (a generic body-roll for models; billboards squash and wiggle).
  - Fast scrubbing makes it giggle and hop. A sleeping pet smiles in its sleep and doesn't wake.
- **Favourite spot:** every pet has a favourite of head, chin or back, derived deterministically from its id (no RNG). Stroking that spot gives an extra-happy reaction (sparkles, wiggle).
  - The first time, it's discovered: toast "ค้นพบแล้ว! {name} ชอบให้เกาคาง 💕", and the pet sheet shows "ชอบ: เกาคาง". It's saved as `pet.favKnown = true`.
- **Reward:** one stroke session (start → end, ≥ 0.6 s) calls `patPet` **once**, the same as a tap. Over the 5-a-day limit the pet still reacts, but there's no reward. A test must prove a session can't count as more than one pat.

## 2. ลากอาหารไปป้อน (B)
- Drag a food item from the tray onto a pet. When the food comes within about 1.2 units of a pet, that pet **looks at it, opens its mouth and leans toward it**.
- Dropping on a pet runs the same flow as `feedWith`, so `feedPet` keeps its rules. Dropping anywhere else springs the food back to the tray.
- Arm+tap stays as the fallback, for accessibility.
- Sleeping or full pets turn their head away ("no" reaction) as the food approaches.

## 3. น้องๆ มารับตอนเปิดเกม (A — away digest; B — scene)
- **A:** a new pure module `js/away.js`, `buildAwayDigest(before, after, awayMs)` → `{ lines: [{ petId?, emoji, text }], highlights: [petId] }`. It diffs a snapshot taken before offline catch-up against the state after it.
  - **Line sources:** pets that slept or woke, got hungry or sick, filled their 🎁, finished work, came back from an expedition, made a friend (see §4); crops ready; postcards arrived; nursery babies.
  - Up to 5 lines, cute and short in Thai, with names. Fully deterministic (a template picked by hashing the pet id and day).
  - `main.js` (A) captures the snapshot and exposes the digest to the yard view **only when away ≥ 30 min**.
- **B:**
  - When the yard opens with a digest, 2–4 highlighted pets run toward the camera, stop in a row, wave or hop, and a small speech bubble shows the lines one at a time. Tap to advance or skip.
  - Under reduced motion it's just the bubble. It plays at most once per app open, and never interrupts the hatch ceremony or the nursery reveal.

## 4. เพื่อนซี้ (A — js/friends.js logic + state; B — behaviours)
- **State v6** (A — `STATE_VERSION = 6`, `MIGRATIONS[5]`, fixture `save_v5_midgame.json`):
  - `friends: { [pairKey]: points }`, where `pairKey` = the two sorted pet ids joined by `|`.
  - `pet.favKnown: false`.
  - `lastGreetAt: 0`.
  - Rehoming a pet, or a pet leaving for the nursery, removes its pairs.
- **Points per hour:**
  - +1 for two pets both at home and awake.
  - +2 for working the same plot together.
  - +1 for napping at the same time.
  - Credited in `tickFriends(state, dtMs)` from `tickPets`, offline included. Fractional and deterministic.
  - Only the top 40 pairs are kept, to bound the save size.
- **เพื่อนซี้** = a mutual best pair with ≥ 72 points (about 3 days at home together). Each pet has at most one best friend.
  - Forming one triggers a moment: toast "🤝 A กับ B เป็นเพื่อนซี้กันแล้ว!", a heart arc between them, and a digest line.
- **Behaviours (B):** best friends wander together, nap side by side, greet each other with a nuzzle, and share decor (both on the ball or the bed). The pet sheet shows "เพื่อนซี้: {emoji} {name}".
- **Effect:** while a pet's best friend is also at home, its happiness decays ×0.8. This touches yard income through mood, so it's covered by the econ gates below. No direct coin or bond bonus.

## 5. น้องป่า 3D — 3C wave 1 (C — critters.js / models.js)
Fifteen forest models (panda already exists):

| Species | Rarity | Signature part |
|---|---|---|
| squirrel | common | big curled tail on a pivot, cheek pouches |
| deer | common | antlers, white spots |
| boar | common | tusks, bristle ridge |
| fox | common | big brush tail with a white tip, pointy ears |
| hedgehog | common | spike shell with a merged cone ring, tiny snout |
| raccoon | common | eye mask, ringed tail |
| bear | uncommon | round ears, honey-coloured muzzle |
| badger | uncommon | head stripe |
| skunk | uncommon | big striped tail |
| beaver | uncommon | flat paddle tail, teeth |
| sloth | rare | long arms, sleepy eye patches |
| monkey | rare | long curly tail, big ears |
| orangutan | rare | long arms, shaggy orange |
| tiger | epic | stripes as vertex colours |
| gorilla | epic | broad shoulders, knuckle stance |

- **Budgets:** common/uncommon ≤ 1.2k tris and ≤ 6 draw calls; rare/epic ≤ 1.6k tris and ≤ 7 draw calls. Use the shared toon material and merged vertex colours. Tails and ears are animated parts (`tail`, `tailTip`, `earL`/`earR`) so §1's reactions and the existing behaviours drive them.
- Gentle shiny palettes; tests and the gallery are updated.
- **Scene budget:** 20 pets at XL that are all models, plus cribs and decor, stay ≤ 230 draw calls.
- B wires the favourite-spot regions to the real head/chin/back anchors of every model. Billboards use a vertical split.

## Economy and progress guardrails
- Bond pace is unchanged:
  - New tests: a stroke session = one `patPet`; drag-feed = one `feedPet`.
  - Spamming strokes or drags gives nothing beyond today's caps.
- The friends happiness effect is included in the econ sim (the bot keeps pets at home as today). All existing gates must pass: yard share ≤ 20 % every day, 3h day-14 ≤ 4500 coins/h, realistic/3h ≤ 2.5, days-to-tier within ±25 % of V6, and the rest.
- If a gate fails, tune the friend effect, not the gate.

## Owners
- **A** (engine, state, main, new js/away.js and js/friends.js): v6 migration first, stroke gesture API, away digest, friends logic plus tests.
- **B** (barn3d, petBehaviour, pets.js glue, petsView): stroke reactions, favourite spot, drag-feed, greeting scene, friend behaviours, pet-sheet lines.
- **C** (critters.js, models.js, tests/models.test.js, tests/models.html, econ-sim): 15 forest models, then the econ gate run with friends.
- Edit only your own files, and ask the lead before touching another owner's file.
- **Browser:** open your **own tab** (tabs_create) on your **own port**. Never act on an existing tab or on localhost:8790 (the user's showcase).

## Done
- ALL PASS, including the new gates.
- Stroking and drag-feeding feel alive in the pane, at mouse and 360 px.
- The greeting plays after ≥ 30 min away.
- A best-friend pair forms in an accelerated test and is visible in 3D.
- All 15 forest pets are 3D in the showcase within budgets.
- Then the reviewer, the lead check, and ask the user before deploy.

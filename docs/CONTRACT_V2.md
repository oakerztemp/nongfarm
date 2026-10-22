# NongFarm — Contract v2 addendum (Phase 0 + Phase 1)

Extends `docs/CONTRACT.md` (still binding). Same rules: file ownership is strict, logic modules stay DOM-free, escape user strings, Thai UI text. Read `docs/ROADMAP.md` for the why.

New files and owners:

```
tests/index.html            A   test runner page (imports every *.test.js, prints ALL PASS / FAIL list into #result)
tests/harness.js            A   test(name, fn), assert(cond, msg), assertEq(a, b, msg), withFakeNow(ms, fn)
tests/run_tests.py          A   starts http.server on a free port, runs headless Edge --dump-dom, exit 0 only on ALL PASS
tests/fixtures/*.json       A   save_v1_typical.json, save_v1_corrupt.json, save_v1_midgame.json
tests/core.test.js          A   migrate, v1→v2, storage merge (mock getDb), quests
tests/pets.test.js          B
tests/farm.test.js          C   farm + orders
tests/econ-sim.test.js      C   economy simulator (see §6)
js/quests.js                A   starter quest chain (DOM-free) + js/ui/questBar.js (A) for its UI
.github/workflows/pages.yml A   GitHub Pages deploy (static, no build) — prepare only, lead pushes later with user approval
```

Tests import game modules with relative paths (`../js/state.js`). Logic must remain testable without DOM: `notify()` and `now()` from util.js must work in tests (harness may stub `now` via `withFakeNow`, implemented by A as an overridable clock in util.js: `export function setClock(fn)`; `now()` uses it).

## 1. State v2 (A adds to `createNewState()` and to the v1→v2 migration)

```js
version: 2,
stats: {                     // lifetime counters, bumped via bumpStat()
  hatched: 0, fed: 0, played: 0, cleaned: 0, released: 0,
  planted: 0, harvested: 0, helped: 0,          // helped = successful assignPet
  expeditionsStarted: 0, expeditionsClaimed: 0,
  ordersDone: 0, sold: 0, bought: 0
},
quests: { step: 0, done: false },              // starter chain progress (A)
orders: { day: null, list: [], week: null, weekly: null },   // C (see §4)
stardust: 0,                                   // B
claimedGoals: [],                              // B: book milestone ids already claimed
```
Plot gets optional `lastCropId` (C). Existing optional fields stay.

### Migrations (A, state.js)
- `export const STATE_VERSION = 2`
- `MIGRATIONS = { 1: s => { …add v2 fields…; s.version = 2; return s; } }` run in order while `s.version < STATE_VERSION`, then the existing deep-fill.
- `migrate()` must never throw and never drop unknown fields. A save with `version > STATE_VERSION` (from a newer client) → load as-is + `notify('warn')`, and **storage must not upload it** (prevents an old tab overwriting a newer save).

### New helpers in state.js (A)
```js
export function bumpStat(state, key, n = 1)   // creates key if missing; ignores n <= 0
```
**B and C must call bumpStat in their logic functions on success** with exactly the keys above:
B: hatchReady→hatched, feedPet→fed, playWithPet/giveToy→played, cleanPet/pickPoop→cleaned, releasePet→released.
C: plantSeed→planted, harvestPlot→harvested, assignPet→helped, startExpedition→expeditionsStarted, claimExpedition→expeditionsClaimed, completeOrder→ordersDone, sellItem→sold (qty), buyItem→bought (qty).

## 2. Starter quests (A — js/quests.js + js/ui/questBar.js)

7 steps, each `{ id, titleTh, hintTh, tab, check(state) → bool, reward: { coins?, items? } }`:
1 ฟักไข่ใบแรก (stats.hatched ≥ 1) → 30🪙
2 ให้อาหารน้อง (fed ≥ 1) → food_kibble ×3
3 ปลูกพืช (planted ≥ 1) → seed_corn ×3
4 ส่งน้องไปช่วยที่แปลง (helped ≥ 1) → 50🪙
5 เก็บเกี่ยวครั้งแรก (harvested ≥ 1) → 50🪙
6 ส่งออเดอร์ 1 ใบ (ordersDone ≥ 1) → egg_farm ×1
7 ออกสำรวจ 1 ครั้ง (expeditionsStarted ≥ 1) → egg_forest ×1
Exports: `QUESTS`, `currentQuest(state)`, `claimQuest(state)` → `{ok,msg}` (only when check passes; grants reward, step++, done when past last). Existing v1 saves: migration sets `step` by skipping steps whose check already passes **without** granting rewards (no free loot for veterans).
UI: a slim bar under the header (all tabs) showing current step, a "ไปที่แท็บ" button (switches tab) and "รับรางวัล" when complete; hidden when done. main.js exposes tab switching for it.

## 3. Pets changes (B)
- Stage thresholds → `0 / 25 / 200 / 600` (stage 1 reachable in ~10 min so exploring unlocks early).
- `releasePet` refund → coins 10 **plus stardust** by rarity: common 1, uncommon 2, rare 5, epic 10, legendary 25 (shiny ×2). Message shows both.
- Stardust spend (pets.js): `makeShiny(state, petId)` costs 100, `buyHabitatEgg(state, habitat)` costs 40 → adds that habitat's egg item (only habitats whose egg `unlockLevel` ≤ player level).
- Book milestones (pets.js): `BOOK_GOALS` = per habitat: own 3 species, own 6, own all; global: 25 / 50 / 111 species, first shiny. Each `{ id, titleTh, check(state), reward: { coins?, stardust?, items? } }`. `claimGoal(state, goalId)` → `{ok,msg}`, records `claimedGoals`. Rewards must be meaningful but not economy-breaking (e.g. habitat-3 = 100🪙 + 10✨, habitat-all = that habitat's egg + 50✨).
- Book view: progress + claim buttons + stardust balance + stardust shop.
- `incubatorCapacity` max 3 (state field exists). Pets logic must already handle multiple slots.

## 4. Farm changes (C)
- **Incubator upgrade** in farm.js: `incubatorUpgradePrice(state)` (null at 3), `upgradeIncubator(state)`; shown in Shop → อัปเกรด.
- **Eggs as loot**: each zone gets a rare egg drop (≈3–6% per expedition, habitat matching the zone: forest→egg_forest, pond→egg_water, mountain→egg_savanna or egg_polar, cloud→egg_sky).
- **Orders** (farm.js): `ensureOrders(state, dayKey)` — if `orders.day !== dayKey` regenerate 3 daily orders; weekly order regenerated when ISO week changes. Deterministic from the day key + player level (seeded RNG, so reloads don't reroll). Items only from crops/forage the player has unlocked. `Order = { id, items: {itemId: n}, reward: { coins, xp, items? }, done }`. `completeOrder(state, orderId)` removes items, grants reward. Daily order value ≈ 1.6–2× sell value; weekly ≈ 3× + a special egg (egg_mystic only if level ≥ 10, else best unlocked egg). `ensureOrders` is called from tickFarm with `todayKey()`.
- **Orders UI**: a "📋 ออเดอร์วันนี้" section at the top of the farm view (have/need counts, ส่งของ button enabled when complete, weekly order card).
- **Rebalance**: crops ≥ 1 h get yield bonus so profit/hour of long crops ≥ short crops for a player checking in every 2–4 h; add `plot.lastCropId` + "ปลูกซ้ำ 🔁" one-tap button (also on harvest-all). Keep fertilizer cap rules.

## 5. Platform (A)
- **DOM morph**: `util.morph(rootEl, html)` minimal diff (keep existing nodes when tag + key match; `data-key` attributes optional hint), used by main.js instead of `innerHTML` so animations don't restart and inputs keep focus. Views unchanged (still return HTML strings).
- Ask farm name for a fresh guest farm after logout.
- Daily reward: +20% chance of an extra egg_farm.
- `.github/workflows/pages.yml` + README "Deploy" section (GitHub Pages, add `<user>.github.io` to Firebase Authorized domains, restrict API key by HTTP referrer). **Do not run git or push.**

## 6. Economy simulator (C — tests/econ-sim.test.js)
Scripted player for 14 virtual days using the real logic functions with a fake clock: checks in every 3 h (8 sessions/day): harvest, replant best unlocked crop, do orders it can, feed pets, run expeditions with idle stage≥1 pets, buy eggs/plots when affordable. Report (console + test output) coins/hour and level by day. **Fail** if: any item can be bought and sold for profit; any order reward < its items' sell value; a fertilizer/replant loop yields instant profit; level < 5 by day 3 or > 20 by day 14 (sanity band). Also an "active clicker" profile (checks every 10 min) must not earn more than 2.5× the 3-hour profile per hour.

## 7. Done criteria
`python tests/run_tests.py` prints ALL PASS (A runs it at the end after all three are done; each coder makes their own test file pass first via the browser pane at `tests/index.html`). Every v1 fixture loads through migrate + 72 h catch-up with no NaN and no lost items.

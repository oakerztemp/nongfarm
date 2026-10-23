# NongFarm — Contract v3 addendum (Phase 2: "สัตว์ทุกตัวมีความหมาย")

Extends `CONTRACT.md` + `CONTRACT_V2.md` (both still binding). Same rules: strict file ownership, DOM-free logic, escape user strings, Thai UI, tests for every new rule, `python tests/run_tests.py` must end ALL PASS. Any state-shape change goes through a numbered migration (A) + fixture.

## 1. State v3 (A — `STATE_VERSION = 3`, `MIGRATIONS[2]`)

```js
// Plot
plot.petIds: (string|null)[]          // replaces plot.petId; length = slot count of the planted crop (empty plot: [])
plot.helperBonus, plot.helperPetIds   // snapshot at ready time (helperPetId → helperPetIds: string[])
// Pet
pet.task: { type:'plot', plotIndex, slot } | { type:'expedition', expeditionId } | null   // slot is new
pet.bond: 0                           // bond points (see §3)
pet.bondDay: null, pet.bondToday: 0   // daily cap bookkeeping ('YYYY-MM-DD' from todayKey())
pet.giftDay: null                     // last day a heart gift was claimed
// Player settings (device-independent, saved)
settings: { notify: false }           // A: notification opt-in (see §5)
```
Migration v2→v3: `petId` → `petIds` (`[petId]` if set, sized to the crop's slot count, extra slots null); `helperPetId` → `helperPetIds`; pet tasks of type plot get `slot: 0`; bond fields default; `settings` default. Must keep every pet ↔ plot link consistent (a pet whose task points at a plot that doesn't list it → idle). Add fixture `save_v2_midgame.json` (generated from the current game with pets working on plots + an expedition).

## 2. Species traits (B)

`js/data/traits.js` (B, new) — about 12 reusable traits:
```js
export const TRAITS = {
  nightOwl:   { nameTh:'นกฮูกกลางคืน', emoji:'🌙', descTh:'ทำงานเก่งขึ้นช่วง 19:00–06:00' },        // power +30% at night
  earlyBird:  { …'ตื่นเช้า', '🌅', 05:00–11:00 +30% },
  sunLover:   { …'รักแดด', '☀️', 11:00–17:00 +25% },
  waterLover: { …'รักน้ำ', '💧', +25% on crops whose jobs include water, and pond zone },
  digger:     { …'นักขุด', '⛏️', +25% on crops with dig, mountain zone },
  teamPlayer: { …'ชอบทำงานเป็นทีม', '🤝', +10% per other pet on the same plot },
  loner:      { …'ชอบอยู่คนเดียว', '🧘', +30% when alone on a plot (other slots empty) },
  harvester:  { …'มือเก็บเกี่ยว', '🧺', +1 yield on harvest of a plot it worked },
  forager:    { …'นักหาของ', '🎒', +1 loot roll on expeditions },
  lucky:      { …'ดวงดี', '🍀', ×2 egg-drop chance on expeditions },
  tireless:   { …'อึด', '🔋', work energy drain −30% },
  gourmet:    { …'นักชิม', '😋', +50% happy from food },
};
```
- Every species in `species.js` gets `trait: '<id>'` that fits it (owl → nightOwl, rooster → earlyBird, otter → waterLover, mole → digger, ant → teamPlayer, cat → loner, …). Each trait used by ≥ 4 species.
- Rarity scales only the bonus part: common ×1, uncommon ×1.1, rare ×1.25, epic ×1.5, legendary ×2 (e.g. legendary nightOwl = +60%; harvester/forager integer bonuses: +1, epic/legendary +2).
- **pets.js API:**
  ```js
  export function getTrait(pet)                       // → { id, ...TRAITS[id], scale } | null
  export function traitEffect(pet, ctx)               // → { power: mult≥1, yieldBonus: int, extraRolls: int, eggChanceMult: number }
  // ctx = { kind: 'plot'|'expedition', jobs: string[], zoneId?, teamSize?: number /* pets on this plot incl. self */, hour: 0..23 (from now()) }
  export function getWorkPower(pet, jobs, ctx)        // ctx optional; when given, multiplies in traitEffect(pet, ctx).power and bondPowerMult(pet)
  ```
  `tickPets` applies tireless (energy drain) and gourmet is applied inside `foodEffect`. Book/details modal shows the trait with emoji + description; barn card shows the trait emoji.

## 3. Bond hearts ❤️ (B)

- `pet.bond` points; hearts = thresholds `[0, 20, 60, 120, 220, 360]` → 0..5.
- Gains (only via `addBond(state, petId, n)` which enforces a **daily cap of 30 points** per pet using bondDay/bondToday): feed +2 (favorite +5), play +3, toy +4, clean/pickPoop +1, each harvest of a plot the pet helped +1 (C calls `addBond`). No decay.
- Effects: `bondPowerMult(pet)` = 1 + 0.04 × hearts (max +20%). At ≥ 3 hearts: once per day `claimGift(state, petId)` gives 1–2 items drawn from the pet's diet (edible items matching species diet/favorite; favorite more likely) — returns `{ok,msg}`. At 5 hearts: a 💖 badge on the card.
- UI: hearts row on pet card + details modal (progress to next heart, today's remaining bond points), 🎁 button when a gift is available.

## 4. Team plots (C, with B's `task.slot`)

- `crops.js`: each crop gets `slots`: 1 for growMs < 30 min, 2 for 30 min–<2 h, 3 for ≥ 2 h. Crops with 3 slots need 3 `jobs` (add a fitting third job). Slot i is tied to `crop.jobs[i]`; 1-slot crops keep today's rule (power uses the best of the crop's jobs).
- farm.js:
  ```js
  export function assignPet(state, plotIndex, petId, slot = firstFreeSlot)   // canWork, slot free, sets pet.task {type:'plot', plotIndex, slot}
  export function unassignPet(state, plotIndex, slot)                        // slot omitted → all pets on the plot
  ```
  Per-slot power = `getWorkPower(pet, [slotJob], ctx)` with ctx `{kind:'plot', jobs:[slotJob], teamSize, hour}`; speed bonus = Σ 0.3 × effectivePower(p_i) × (all slots filled ? **1.25 combo** : 1). Keep diminishing returns per pet; tune so a full 3-pet team on a long crop is clearly better than one strong pet but the 14-day sim gates from CONTRACT_V2 §6 still hold (re-tune data, not the gates). Yield bonus: snapshot at ready = Σ per-pet bonus + harvester trait bonuses; XP to every helper; `addBond(+1)` each helper at harvest. Ready plot sends all helpers home (existing behaviour, now for all slots).
- Expeditions: use `getWorkPower(pet, [zone.job], {kind:'expedition', jobs:[zone.job], zoneId, hour})` and apply `extraRolls` / `eggChanceMult` from `traitEffect`.
- UI (farmView): plot card shows N slot chips (job emoji + pet chip or "＋" button per slot, picker filtered by canWork, showing that slot's power incl. trait), a "คอมโบ!" badge when all slots are filled, unassign per slot. Keep the 360px layout tidy (slots wrap).

## 5. PWA + local notifications (A)

- `manifest.webmanifest` (name ฟาร์มน้องๆ, short_name NongFarm, `start_url: "./"`, `scope: "./"`, display standalone, theme/background colors from tokens) + icons 192/512 PNG (+ maskable). No image libraries are guaranteed: generate the PNGs by rendering an HTML page with headless Edge `--screenshot` (or pure-Python PNG) — commit the PNG files.
- `sw.js`: app-shell cache with a versioned cache name; network-first for navigations/index.html, cache-first for versioned `?v=` assets, **never** intercept Firebase/gstatic/googleapis/firestore requests. Old caches deleted on activate; new version activates on next load (no surprise reload mid-play). `version_assets.py` must stamp the version into `sw.js` and the SW registration URL. **Do not register the SW on localhost/127.0.0.1** unless `?sw=1` (avoid stale dev caches).
- Settings (⚙️ button in header → modal): notifications toggle (requests permission only when the user turns it on; stores `state.settings.notify`), "ติดตั้งแอป" button when `beforeinstallprompt` fired, game version text.
- Local notifications (no push, Spark plan): while the page is open or backgrounded, schedule the next relevant event and show a notification (via `registration.showNotification` when available, else `new Notification`) when: an egg becomes ready, a crop is ready, an expedition finishes, or a pet's hunger drops below 20. Throttle (≤ 1 per category per 10 min), never notify while the tab is visible and focused, click focuses the game on the right tab. DOM-free scheduling logic in `js/notify.js` (A) with tests (what to notify, throttling) using the fake clock.

## 6. Tests + sim
- A: migration v2→v3 + fixture, notify.js scheduling/throttle tests, SW is not registered on localhost (unit-test the guard function).
- B: traits (data coverage: every species has a valid trait, each trait ≥ 4 species; scaling by rarity; each trait's effect in its context), bond (cap per day, thresholds, gift once per day, diet-matching gift), getWorkPower with ctx.
- C: slot assignment/unassign per slot, combo, per-slot job power, harvest snapshot with multiple helpers + harvester trait, bond +1 per helper, expedition traits (extraRolls, eggChanceMult), econ sim updated to use teams (bot fills slots with best-fitting idle pets) and still passes the V2 gates.

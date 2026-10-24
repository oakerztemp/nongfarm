# NongFarm — Technical Contract v1 (binding for all coders)

Everyone codes against this file in parallel. **Do not change a signature here on your own** — if you must deviate, write it in your final report so the lead can reconcile. Read `docs/GAME_DESIGN.md` for the game rules and numbers.

## 0. Ground rules

- Vanilla JS ES modules, no build, no npm. Every import uses a relative path with `.js` extension.
- Runs from `python -m http.server 8787` inside `10_GAME_NONGFARM/`. Never assume file://.
- All UI text Thai. Code/ids/comments English.
- All time values are epoch milliseconds from `now()` (util.js). Durations in ms. Never `setTimeout` for game timers — everything is derived from timestamps so offline progress works.
- Logic modules (`state.js`, `pets.js`, `farm.js`) **never touch the DOM**. They mutate the state object passed in and return results. They may call `notify()` (util.js) for messages.
- Any user-controlled string (pet nickname, farm name, Google displayName) rendered into HTML **must** go through `escapeHtml()`.
- File ownership is strict (see GAME_DESIGN §8). Don't edit another coder's file.

## 1. Folder layout

```
10_GAME_NONGFARM/
  index.html                 A
  firestore.rules            A
  README.md                  A
  css/style.css              A  (theme tokens, layout, header, tabs, modal, toast, buttons, bars)
  css/pets.css               B
  css/farm.css               C
  js/firebase-config.js      A
  js/util.js                 A
  js/state.js                A
  js/storage.js              A
  js/auth.js                 A
  js/main.js                 A
  js/data/species.js         B
  js/data/eggs.js            B
  js/pets.js                 B
  js/ui/petsView.js          B
  js/data/crops.js           C
  js/data/items.js           C
  js/farm.js                 C
  js/ui/farmView.js          C
```

## 2. State shape (single JSON-serializable object; saved as-is)

```js
{
  version: 1,
  updatedAt: 0,            // ms, set by update()
  lastTick: 0,             // ms, last time ticks were applied (main.js owns)
  player: {
    farmName: 'ฟาร์มของฉัน',
    level: 1, xp: 0, coins: 100,
    createdAt: 0,
    lastDailyClaim: null   // 'YYYY-MM-DD' local date or null
  },
  pets: [],                // Pet[]
  barnCapacity: 3,         // max pets
  incubator: [],           // IncubatorSlot[]  (length <= incubatorCapacity)
  incubatorCapacity: 1,
  inventory: {},           // { [itemId]: count }  — count>0 only; delete key at 0
  plots: [],               // Plot[]  (createNewState makes 4)
  expeditions: [],         // Expedition[]
  collection: {},          // { [speciesId]: { owned: number, shiny: boolean } }  (owned = total ever hatched)
  log: []                  // { t, msg }[] newest first, max 50 (util.addLog)
}

Pet = {
  id: string,              // util.uid()
  speciesId: string,
  nickname: string,
  shiny: boolean,
  personality: 'hardworking'|'lazy'|'glutton'|'cheerful'|'shy'|'naughty',
  stage: 0|1|2|3,          // baby, child, adult, master
  xp: number,
  stats: { hunger, happy, energy, clean },   // 0..100 floats
  poop: 0..3,
  sick: false,
  zeroSince: null,         // ms when hunger or clean first hit 0 (for sickness), else null
  lastFedAt: 0,            // for poop timing
  status: 'idle'|'sleeping'|'working'|'expedition',
  task: null | { type: 'plot', plotIndex: number } | { type: 'expedition', expeditionId: string },
  bornAt: number
}

IncubatorSlot = { eggId: string, startAt: number, readyAt: number }

Plot = {
  index: number,
  cropId: string|null,     // id from CROPS (e.g. 'carrot'), null = empty
  plantedAt: number,
  progress: number,        // 0..1, ready when >= 1
  watered: boolean,
  petId: string|null       // pet assigned here
}

Expedition = { id, petId, zoneId, startAt, endAt, done: boolean, rewards: null | { [itemId]: count } }
```

Pet status/task ownership: **farm.js** sets `status`/`task` when assigning/unassigning work or expeditions (always both together, and also `plot.petId`). **pets.js** sets `'sleeping'`/`'idle'` for sleep. A pet in `working`/`expedition` cannot sleep, be released, or be assigned elsewhere.

## 3. Item ids (canonical — B and C both rely on these)

- Seeds `seed_<crop>` and harvested crops `crop_<crop>` for crop ids:
  `carrot corn tomato potato lettuce strawberry eggplant chili pumpkin watermelon sunflower rice grape broccoli sweetpotato pineapple`
- Forage (from expeditions): `forage_mushroom forage_berry forage_honey forage_wood forage_fish forage_shrimp forage_shell forage_stone forage_gem forage_bone forage_feather forage_star forage_herb`
- Shop food: `food_kibble food_meat food_milk food_cake food_leaf food_seedmix`
- Care: `care_soap care_toy care_medicine care_fertilizer`
- Eggs: `egg_farm egg_forest egg_water egg_sky egg_bug egg_savanna egg_polar egg_mystic`

Diet tags (used on food items and species): `veg fruit grain meat fish insect sweet milk leaf`

## 4. Module APIs

### util.js (A)
```js
export const now = () => Date.now();
export function clamp(v, min, max)
export function uid()                         // short random id string
export function randInt(min, max)             // inclusive
export function pickWeighted(list, weightFn)  // returns one element
export function formatDuration(ms)            // '1ชม. 5น.' / '3น. 20ว.' / '12ว.' ; <=0 → 'เสร็จแล้ว'
export function escapeHtml(str)
export function todayKey()                    // local 'YYYY-MM-DD'
export function notify(msg, type='info')      // 'info'|'success'|'warn'|'error' — DOM-free; dispatches to listeners
export function onNotify(fn)                  // main.js subscribes and shows toast
export function addLog(state, msg)            // unshift {t:now(),msg}, cap 50
export function openModal({ title, html, onMount, onClose }) // returns close(); modal root has class .modal; onMount(el) gets modal body element
export function refreshTimers(root)           // updates [data-countdown="<endMs>"] text with formatDuration(end-now)
                                              // and [data-progress-start][data-progress-end] elements' style.width %
```

### state.js (A)
```js
export function createNewState()             // full default state per §2 + GAME_DESIGN §5 start kit
export function migrate(raw)                 // deep-fill missing fields from createNewState(); returns state
export function getState()
export function replaceState(s)              // used by storage/auth on load; emits 'change'
export function update(mutator)              // mutator(state) → returns mutator's return value; sets updatedAt; emits 'change'
export function subscribe(fn)                // fn(eventName) where eventName 'change'|'tick'; returns unsubscribe
export function emit(eventName)
// inventory / economy helpers (DOM-free, mutate given state)
export function addItem(state, itemId, n=1)
export function removeItem(state, itemId, n=1)   // returns false (and changes nothing) if not enough
export function countItem(state, itemId)
export function addCoins(state, n)
export function spendCoins(state, n)              // false if not enough
export function addPlayerXp(state, n)             // handles level ups (+ notify 'success' 'เลเวลอัพ! Lv.X')
export function xpForLevel(level)                 // Math.round(50 * level ** 1.5)
```

### storage.js / auth.js / main.js (A)
- `auth.js`: `initAuth(onUserChange)`, `signInWithGoogle()`, `signOutUser()`, `isFirebaseConfigured()`. Firebase loaded via `https://www.gstatic.com/firebasejs/10.12.2/firebase-*.js`. If config is placeholder → never import Firebase, guest only.
- `storage.js`: `loadLocal(key)`, `saveLocal(key, state)`, `loadCloud(uid)`, `saveCloud(uid, state)`. Local keys `nongfarm_guest`, `nongfarm_<uid>`. On login: cloud missing → upload current guest state; both exist → newer `updatedAt` wins. Save local throttled ≤ every 2 s on change; cloud every 30 s if dirty + on `visibilitychange` hidden / `pagehide`.
- `main.js`: bootstraps, loads state, applies offline catch-up (`lastTick` → now, capped 72 h, in 60 s steps calling `tickPets(state, step, {offline:true})` then `tickFarm(state, t)`), then every 1 s: `tickPets(state, dt, {offline:false})`, `tickFarm(state, now())`, `emit('tick')`, `refreshTimers(document)`. Re-renders active view on `'change'` immediately and on `'tick'` at most every 10 s. Daily reward. Header. Tab router. Toasts from `onNotify`.
- View registry: main imports `views` from `./ui/petsView.js` and `./ui/farmView.js` and shows them in this order: barn, farm, explore, shop, bag, book.

### View object (B and C export `export const views = [...]`)
```js
{ id: 'barn', icon: '🏠', label: 'ลาน',
  render(state) → HTML string,         // pure, uses escapeHtml for user strings
  bind(rootEl) }                        // called ONCE when the view container is created; use event delegation
                                        // (rootEl persists; its innerHTML is replaced on each render)
```
Handlers call logic inside `update(s => logicFn(s, ...))`, then `notify()` the result message. Logic functions return `{ ok: true, msg? }` or `{ ok: false, reason }`.

B views: `barn` (pets + incubator + care actions), `book` (collection).
C views: `farm`, `explore`, `shop`, `bag`.

### data/species.js (B)
```js
export const HABITATS = { farm:{nameTh,emoji}, forest:…, water:…, sky:…, bug:…, savanna:…, polar:…, mystic:… }
export const RARITIES = { common:{nameTh,weight:60,color}, uncommon:{…25}, rare:{…10}, epic:{…4}, legendary:{…1} }
export const JOBS = { dig:{nameTh,emoji}, water:…, pollinate:…, guard:…, carry:…, forage:…, fish:…, fly:… }
export const SPECIES = [ { id:'hamster', emoji:'🐹', nameTh:'แฮมสเตอร์', habitat:'farm', rarity:'common',
   jobs:{ dig:3, carry:1 },            // only non-zero entries; missing = 0
   diet:['grain','veg'], favorite:'crop_corn', desc:'…' }, … ]   // >= 100 species, ids unique
export function getSpecies(id)
```
Use only emoji that render on Windows 11 Segoe UI Emoji (Unicode ≤ 14).

### data/eggs.js (B)
```js
export const EGGS = [ { id:'egg_farm', emoji:'🥚', nameTh:'ไข่ทุ่งนา', habitat:'farm', price:100, unlockLevel:1,
   hatchMs: 2*60*1000, color:'#f6e7b0' }, … ]   // one per habitat (8 total)
export function getEgg(id)
```

### pets.js (B)
```js
export function tickPets(state, dtMs, { offline })   // decay/regen, poop, sickness, stage-up via addPetXp; offline → decay x0.5
export function tickIncubator(state, nowMs)          // (optional helper; main does NOT call it — call from tickPets)
export function putEggInIncubator(state, eggId)      // uses inventory egg; needs free incubator slot
export function hatchReady(state, slotIndex)         // needs barn space; creates pet; collection; addPlayerXp 10
export function feedPet(state, petId, itemId)        // uses getItem(itemId).food; diet match full, else half; favorite → happy x2
export function playWithPet(state, petId)            // +20 happy, −8 energy
export function cleanPet(state, petId)               // remove poop, clean +40 (care_soap in inventory → clean = 100 and consumes it)
export function giveToy(state, petId)                // consumes care_toy, +40 happy
export function healPet(state, petId)                // consumes care_medicine, sick=false
export function toggleSleep(state, petId)            // idle <-> sleeping
export function renamePet(state, petId, name)        // trim, max 16 chars
export function releasePet(state, petId)             // only idle/sleeping; refund 20 coins
export function addPetXp(state, petId, n)            // stage thresholds 0/50/200/600, notify on evolve
export function canWork(pet)                         // → { ok, reason }: idle (not sleeping), !sick, energy>=20, hunger>=15
export function getWorkPower(pet, jobs)              // jobs: string[]; (0.5 + max aptitude) * stageMult * moodMult * personalityMult * (shiny?1.1:1)
export function getPet(state, petId)
export function petEmoji(pet)                        // species emoji
export function petName(pet)                         // nickname || species nameTh  (NOT escaped)
```

### ui/petsView.js (B) — additionally exports
```js
export function openPetPicker({ title, filter, describe, onPick })  // modal listing pets; filter(pet)→bool; describe(pet)→short HTML; onPick(petId)
export function petChipHtml(pet)    // small inline chip: emoji + escaped name + stage badge (shiny style applied)
```

### data/crops.js (C)
```js
export const CROPS = [ { id:'carrot', emoji:'🥕', nameTh:'แครอท', seedPrice:5, sellPrice:12, growMs:2*60*1000,
   yield:[2,3], unlockLevel:1, jobs:['dig','water'], xp:3 }, … ]   // 16 crops per §3
export function getCrop(id)
```

### data/items.js (C)
```js
// Item = { id, emoji, nameTh, type:'seed'|'crop'|'forage'|'food'|'care'|'egg', buy:number|null, sell:number|null,
//          unlockLevel:number, food?:{ hunger, happy, tags:string[] }, desc? }
export const ITEMS            // object map id → Item, includes generated seed_/crop_ from CROPS and egg_ from EGGS (import from ./eggs.js)
export function getItem(id)   // returns Item or null
// crops and most forage are edible (food field) so pets can eat harvests
```

### farm.js (C)
```js
export function tickFarm(state, nowMs)               // grow plots (progress), give working pets 1 xp/min (addPetXp),
                                                      // auto-unassign pets with energy<=0 or sick (notify),
                                                      // finish expeditions (done=true, roll rewards, pet → idle)
export function plantSeed(state, plotIndex, cropId)
export function waterPlot(state, plotIndex)
export function fertilize(state, plotIndex)          // consumes care_fertilizer, progress += 0.25
export function assignPet(state, plotIndex, petId)   // uses canWork
export function unassignPet(state, plotIndex)
export function harvestPlot(state, plotIndex)        // yields crop_ items, addPlayerXp(crop.xp), pet xp bonus, resets plot
export const ZONES = [ { id:'forest', emoji:'🌲', nameTh, job:'forage', durationMs, unlockLevel, loot:[{itemId, weight, min, max}] }, … ]
export function startExpedition(state, petId, zoneId) // canWork + stage>=1
export function claimExpedition(state, expeditionId) // add rewards, remove expedition, addPlayerXp
export function buyItem(state, itemId, qty=1)
export function sellItem(state, itemId, qty=1)
export function plotPrice(state)                      // next plot cost; max 16 plots
export function buyPlot(state)
export function barnUpgradePrice(state)               // max barnCapacity 20
export function upgradeBarn(state)
```

## 5. Shared CSS tokens (A defines in css/style.css `:root`, B/C only consume)

`--bg --surface --surface-2 --text --text-dim --primary --primary-text --accent --danger --success --warn --border --radius --shadow --font`
Dark mode via `@media (prefers-color-scheme: dark)`. Reusable classes A provides: `.btn .btn-primary .btn-sm .btn-ghost .card .grid .bar > .bar-fill .badge .muted .empty-state`.
B/C prefix their own classes (`.pet-*`, `.farm-*`, `.shop-*`…) to avoid clashes.

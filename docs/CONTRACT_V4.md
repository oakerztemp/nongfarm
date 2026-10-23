# NongFarm — Contract v4 addendum (คอก 3 มิติ แบบผสม)

Extends CONTRACT.md + V2 + V3 (all still binding: strict file ownership, DOM-free logic where possible, Thai UI, tests, `python tests/run_tests.py` ALL PASS). Why: `docs/LIVING_WORLD.md` + the user approved the **hybrid** direction: a real 3D barn world; pets with a procedural 3D model where one exists, emoji billboards for the rest; the current card grid stays as "มุมมองรายการ" and as the fallback.

**Scope of this round: the barn (🏠 คอก) only.** Farm/explore stay 2D. No save-shape change (STATE_VERSION stays 3) except B's optional `pet.lastPatDay/patToday` fields below (defaults in code, no migration needed).

## 0. Principles
- Cosmetic only: positions, animations, camera are never saved and never affect game numbers.
- The 3D world lives in a persistent host element that `morph` must not touch.
- Must stay smooth on a mid/low phone: ≤ 40k triangles in the barn, shared geometries/materials, pixelRatio ≤ 1.5, render paused when the tab/view is hidden, 30 fps cap when nothing is interacting.
- Fallback to the existing card grid when WebGL is unavailable, `prefers-reduced-motion: reduce`, or the user chooses list view (remembered per device in localStorage).

## 1. Coder A — engine (`js/world3d/engine.js`, `vendor/three.module.min.js`, util.morph, main wiring)
- Vendor three.js **r160** ESM build (`three.module.min.js` from the official npm package via jsdelivr) into `vendor/` and record version + SHA-256 in `vendor/README.md`. Same-origin so the service worker caches it; version_assets.py must stamp it like other assets.
- `util.morph`: elements with attribute `data-morph="skip"` are kept as-is (children untouched). Test it.
- `engine.js` exports:
  ```js
  export function isWorldSupported()          // WebGL2/1 available && !reduced-motion
  export function createWorld(hostEl, { onTap(actorId), onTapGround(point) })
  // → world = { THREE, scene, camera, addActor(id, object3d, { radius }), removeActor(id), getActor(id),
  //             onFrame(fn(dt, t)) → unsubscribe, setActive(bool), dispose(), worldToScreen(vec3) }
  ```
  Toon lighting (hemisphere + directional), ground disc, fence, small barn prop; camera: drag to orbit (yaw only, clamped pitch), pinch/wheel zoom within limits, tap vs drag threshold, raycast picking with a generous radius (min 44 px on screen). Pauses on `visibilitychange` and when `setActive(false)`. Resizes with the host (ResizeObserver). Quality tier auto-picked (devicePixelRatio, hardwareConcurrency) — shadows are blob meshes, no shadow maps.
- `js/world3d/fx.js` (A): small sprite effects shared by scenes: `heart(world, pos)`, `emojiPop(world, pos, emoji)`, `flyEmoji(world, fromPos, toPos, emoji, onDone)`, `bubble(world, actorId, emoji)` (floating thought bubble that follows an actor), `sparkle(world, actorId)`. Emoji → CanvasTexture cache.
- Settings modal: add "มุมมองคอก: 3 มิติ / รายการ" and a "คุณภาพกราฟิก: อัตโนมัติ/ต่ำ" option (device-local).

## 2. Coder C — critter kit + first 21 models (`js/world3d/critters.js`, `js/data/models.js`, `tests/models.html` preview page)
- `critters.js` exports:
  ```js
  export function hasModel(speciesId)
  export function buildPetModel(THREE, pet, species)     // → { root: Group, body: Group /* squash/stretch target */, head?: Group, height, radius, kind: 'model'|'billboard' }
  export function buildBillboard(THREE, emoji)           // same shape; used when no spec exists
  ```
  Parametric chibi kit (spheres/capsules/cones, MeshToonMaterial, cached geometries & materials): body/belly colors, eyes with highlight, blush, ears (round, long, floppy, cat, none), snout (nose, beak, pig, muzzle), tail (puff, long, curly, fluffy, none), extras (comb, wattle, horns, mane, spots, wool puff, whiskers, wings), feet. Stage scale (baby 0.7 … master 1.15 + 👑 sprite), shiny = color shift + sparkle hook. ≤ 1.5k triangles per pet.
- `models.js`: `MODEL_SPECS` for **all 21 farm-habitat species** (the egg every new player hatches first). Each must be recognisable (hamster, chicken, cow, pig, sheep, goat, duck, cat, dog, rabbit, horse…).
- `tests/models.html`: gallery that renders every spec (and a billboard) on a turntable for visual QA. Plus `tests/models.test.js`: every spec builds without throwing, no NaN positions, triangle budget, billboard fallback for species without spec.

## 3. Coder B — barn scene + behaviours (`js/ui/barn3d.js`, `js/petBehaviour.js`, petsView.js, pets.js)
- `petBehaviour.js` (DOM-free, testable): `nextAction(pet, actorState, rng, now)` → one of `wander(target) | idle | sleep | eat | poop | sick | lookAtCamera | hop | approach(otherId)`, driven by state (sleeping → sleep curl, hunger < 25 → walks to the food bowl + bubble of its favorite food, clean low → flies 🪰 bubble, sick → shiver, happy ≥ 80 → occasional hops, personality: lazy naps more, cheerful hops, shy keeps distance, naughty runs) + gentle randomness with long pauses.
- `barn3d.js`: mounts the world in the barn view inside `<div data-morph="skip">`, syncs actors with `state.pets` on change (add/remove/update model when stage/shiny changes), working/expedition pets are not in the yard (a small sign "ไปทำงาน N ตัว"), incubator = a 3D nest with the egg (wobbles when ready; tap = hatch ceremony: wobble → crack → pet pops out with confetti, walks toward the camera, bubble with its name), poop meshes on the ground (tap to pick → existing `pickPoop`), food bowl.
- Interactions: tap pet → pat (heart + small bond via new `patPet(state, petId)` in pets.js: +1 bond, +3 happy, max 5 pats/day/pet, uses the bond daily cap) and opens a bottom sheet with the existing card content/actions; food tray (edible inventory) → tap food then tap pet → `flyEmoji` to the pet, chew animation, then the real `feedPet` result; sleep/wake, bath (bubbles fx), play (pet hops around) map to existing actions with visible reactions.
- List view toggle "🌳 คอก / 📋 รายการ" in the barn header; list = current grid (unchanged behaviour, still the accessible path).
- Tests: petBehaviour decisions (hungry → bowl, sleeping → sleep, personality biases) with seeded rng; patPet caps.

## 4. Done criteria
ALL PASS; barn 3D runs ≥ 30 fps with 12 pets in the browser pane at phone size; fallback list works with WebGL disabled; no console errors; tap/drag work on touch; nothing in save data changes besides pat bookkeeping.

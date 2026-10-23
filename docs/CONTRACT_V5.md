# NongFarm — Contract v5 addendum (น้องตำนานอลังการ)

Extends CONTRACT.md + V2–V4 (all binding). User request: legendary pets must feel epic — aura, real 3D dragon/unicorn, and shiny on emoji billboards must stop looking colour-broken. Barn tab only; cosmetic only (no save change, no game numbers change).

Lead's observations from the "ฟาร์มเทพ" showcase (20 master pets, 9 legendary, 9 shiny): legendary looks identical to common apart from the crown that every master has; most legendaries are emoji billboards; billboard shiny = hue-rotate → green lion, cyan panda; 20 pets clump in the centre; many nap at the same time (💤 everywhere).

Budget after this round (20 pets incl. 9 legendary, tier high): ≤ 200 draw calls, ≤ 45k triangles, 30 fps idle. Tier `low`: no particles/trails, aura = flat ring only.

## A — fx primitives (`js/world3d/fx.js`, engine)
- `aura(world, actorId, { color, intensity })` → handle `{ remove, setColor }`: soft additive glowing ground ring + slow rotating rune ring under the actor, gentle pulse. All auras share one InstancedMesh per layer (aura count must not scale draw calls linearly).
- `particles(world, actorId, { kind: 'motes'|'embers'|'stars'|'petals', rate })` → handle: rising glowing motes around the actor; one shared InstancedMesh/Points for all emitters; capped total particles (e.g. 300) with tier scaling.
- `trail(world, actorId, { colors: [...], width, length })` → handle: ribbon following an actor (rainbow for unicorn, ember for dragon); ≤ 1 draw call each, max 4 trails alive.
- `lightBeam(world, pos, { color, duration })`, `dimScene(world, amount, ms)` (tween lights/fog; restore automatically), `shake(world, ms, strength)` — for the legendary hatch.
- `glowHalo(world, actorId, { color })` for billboards (sprite behind the emoji, additive) and `twinkle(world, actorId)` small star sparkles — B/C use these for shiny billboards.
- Respect reduced motion (no shake, no trails), pause with the world, dispose cleanly, tests for pooling/caps.

## C — legendary models + shiny fix (`js/world3d/critters.js`, `js/data/models.js`)
- New `MODEL_SPECS` (3D) for **dragon 🐉, unicorn 🦄, dragonhead 🐲 (as a small chibi dragon variant), mammoth 🦣, lion 🦁, panda 🐼**. New kit parts as needed: bat wings (2-bone flap pivots), horn (spiral for unicorn), rainbow mane/tail (vertex-colour bands), tusks + trunk (mammoth, trunk as a pivot that can swing), lion mane ring, dragon spikes along the back + long tail with pivot, small flames/nostril puff anchor. Keep ≤ 6–7 draw calls and ≤ 1.8k triangles each; expose new animated parts in `parts` (`wingL/wingR` reuse, `trunk`, `tailTip`, `mane`).
- Every model/billboard returns `rarity` and (new) `legendary: boolean`; legendary root scale ×1.25 on top of stage scale.
- **Shiny fix:** billboards no longer hue-rotate. Instead return a `shinyStyle: 'halo'` flag so the scene adds `glowHalo` + `twinkle` (A). For 3D models keep a palette shift but use curated per-species shiny palettes (pleasant, e.g. golden lion, white-gold panda, sapphire dragon, pastel-galaxy unicorn) instead of a blanket hue rotation; add `shinyPalette` to specs (fallback: gentle pastel shift, never > 60° hue).
- Gallery: add a "legendary" filter row; tests: new specs build, budgets, legendary flag/scale, billboards never apply colour filters when shiny.

## B — legendary presence + hatch ceremony + crowd (`js/ui/barn3d.js`, `js/petBehaviour.js`)
- Legendary actors get: `aura` in a colour per habitat (mystic violet, sky gold, water aqua, savanna amber, forest green, polar ice, bug emerald, farm warm gold), `particles` (motes; embers for dragon), name tag with a ✦ legendary style when selected.
- Signature idle moves (in petBehaviour as new actions, chosen occasionally, legendary only): dragon — take off, fly a slow circle above the yard with ember trail, land; unicorn — gallop loop leaving a rainbow trail, rear up; eagle — soar circle; humpback — "breach" hop with water splash emoji pop; lion — roar pose (head up, 🗯️ bubble, tiny shake); panda — sit and munch bamboo 🎋; polar bear — snow puff 🌨️ around; beetle — shimmering wing flick; racehorse — sprint lap. Epic pets get a smaller version (no aura, occasional sparkle).
- Legendary hatch ceremony (egg whose result is legendary, decided by the real hatchReady result): dimScene → egg glows and rises → lightBeam + shake → burst of golden confetti/stars → pet floats down with aura → name tag "✦ ตำนาน". Non-legendary hatch unchanged.
- Shiny billboards: use `glowHalo` + `twinkle` (no colour filter).
- Crowd fix: spread wander targets using a simple repulsion/occupancy grid so pets don't clump; stagger naps (at most ~25% of idle pets napping at once; lazy still naps more).
- Tests: signature actions only for legendary, nap cap, repulsion keeps min distance, ceremony picks legendary path from the hatch result.

## Done
ALL PASS; showcase save at localhost:8790 ("ฟาร์มเทพ") looks clearly epic; budgets met; reduced-motion and `low` tier stay calm; no console errors.

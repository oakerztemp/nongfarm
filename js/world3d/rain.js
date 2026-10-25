// Weather for the 3D world (CONTRACT_V9 §4): instanced rain streaks + puddle decals = 2 draw calls at most, plus the pure
// maths the engine uses for the cloudy tint. Cosmetic only. engine.js owns one of these (world.setWeather / world.puddles).
//
//   weatherTargets(kind, intensity) -> { cloud, rain }      0..1 targets the engine eases towards
//   puddleLayout(radius, obstacles, count, seed) -> [{ x, z, r }]   deterministic, clear of obstacles and of each other
//   createRain(THREE, { quality, reduced }) -> { group, setArea, setRain, update, puddles, info, dispose }

export const RAIN_DROPS = { high: 360, medium: 240, low: 120 };
export const PUDDLE_COUNT = 6;
export const RAIN_HEIGHT = 9;
export const RAIN_SPEED = 13;       // units / s
export const RAIN_WIND = 0.18;      // sideways drift per unit of fall

const clamp01 = v => Math.min(1, Math.max(0, v));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the sky should be: sunny = clear, cloudy = grey-ish (more with intensity), rain = full cloud + rain amount = intensity. Pure. */
export function weatherTargets(kind, intensity = 1) {
  const k = clamp01(Number.isFinite(intensity) ? intensity : 1);
  if (kind === 'rain') return { cloud: 1, rain: Math.max(0.15, k) };
  if (kind === 'cloudy') return { cloud: 0.4 + 0.6 * k, rain: 0 };
  return { cloud: 0, rain: 0 };
}

/** Light multipliers for a given cloud / rain amount: { hemi, sun, grey } (grey = how far colours drift to storm grey). Pure. */
export function weatherLight(cloud, rain) {
  return { hemi: 1 - 0.12 * cloud - 0.1 * rain, sun: 1 - 0.4 * cloud - 0.2 * rain, grey: 0.5 * cloud + 0.15 * rain };
}

/**
 * Puddle decals for a yard: `count` ellipses in the ring 1.6 .. radius - 0.9, never touching an obstacle ({x,z,r}) or each other.
 * Deterministic for the same inputs (so they sit in the same place every rain). Pure.
 */
export function puddleLayout(radius, obstacles = [], count = PUDDLE_COUNT, seed = 20261025) {
  const rand = mulberry32(seed);
  const out = [];
  const rMin = 1.6, rMax = Math.max(rMin + 0.5, radius - 0.9);
  for (let tries = 0; out.length < count && tries < 400; tries++) {
    const a = rand() * Math.PI * 2;
    const d = rMin + Math.sqrt(rand()) * (rMax - rMin);
    const r = 0.38 + rand() * 0.3;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (obstacles.some(o => Math.hypot(o.x - x, o.z - z) < o.r + r + 0.15)) continue;
    if (out.some(p => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.8)) continue;
    out.push({ x: +x.toFixed(3), z: +z.toFixed(3), r: +r.toFixed(3) });
  }
  return out;
}

export function createRain(THREE, { quality = 'high', reduced = false } = {}) {
  const group = new THREE.Group();
  group.name = 'weather';
  const maxDrops = Math.max(24, Math.round((RAIN_DROPS[quality] || RAIN_DROPS.high) * (reduced ? 0.5 : 1)));

  // ---- rain streaks: ONE instanced box, the rotation (a lean with the wind) is baked in, only the translation moves
  const dropGeo = new THREE.BoxGeometry(0.02, 0.5, 0.02);
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.55, depthWrite: false });
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, maxDrops);
  drops.frustumCulled = false;
  drops.count = 0;
  drops.renderOrder = 5;
  drops.userData.noPick = true;
  const lean = new THREE.Matrix4().makeRotationZ(Math.atan(RAIN_WIND));
  const dx = new Float32Array(maxDrops), dy = new Float32Array(maxDrops), dz = new Float32Array(maxDrops), dv = new Float32Array(maxDrops);
  for (let i = 0; i < maxDrops; i++) drops.setMatrixAt(i, lean);

  // ---- puddles: ONE instanced flat disc, scaled into ellipses
  const puddleGeo = new THREE.CircleGeometry(1, 20);
  puddleGeo.rotateX(-Math.PI / 2);
  const puddleMat = new THREE.MeshBasicMaterial({
    color: 0xa9d6f2, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const puddleMesh = new THREE.InstancedMesh(puddleGeo, puddleMat, PUDDLE_COUNT);
  puddleMesh.frustumCulled = false;
  puddleMesh.count = 0;
  puddleMesh.visible = false;
  puddleMesh.renderOrder = -0.5;
  puddleMesh.userData.noPick = true;
  group.add(puddleMesh, drops);

  let area = 6;                 // half-width of the square the rain falls in (world units)
  let rain = 0;                 // current 0..1
  let list = [];
  let t = 0;
  const rand = mulberry32(77);
  const dummy = new THREE.Object3D();

  function seedDrop(i, spreadY) {
    dx[i] = (rand() * 2 - 1) * area;
    dz[i] = (rand() * 2 - 1) * area;
    dy[i] = spreadY ? rand() * RAIN_HEIGHT : RAIN_HEIGHT * (0.85 + rand() * 0.15);
    dv[i] = RAIN_SPEED * (0.8 + rand() * 0.4);
  }
  for (let i = 0; i < maxDrops; i++) seedDrop(i, true);

  function setArea(radius, obstacles) {
    area = Math.max(4, radius + 1.5);
    for (let i = 0; i < maxDrops; i++) seedDrop(i, true);
    list = puddleLayout(radius, obstacles || []);
    for (let i = 0; i < list.length; i++) {
      dummy.position.set(list[i].x, 0.03, list[i].z);
      dummy.scale.set(list[i].r * 1.25, 1, list[i].r);
      dummy.updateMatrix();
      puddleMesh.setMatrixAt(i, dummy.matrix);
    }
    puddleMesh.count = list.length;
    puddleMesh.instanceMatrix.needsUpdate = true;
  }

  function setRain(v) { rain = clamp01(v); }

  function update(dt) {
    t += dt;
    const on = rain > 0.02;
    drops.visible = on;
    puddleMesh.visible = rain > 0.1 && list.length > 0;
    if (!on) { drops.count = 0; return; }
    const n = Math.max(1, Math.round(maxDrops * rain));
    drops.count = n;
    dropMat.opacity = 0.3 + 0.3 * rain;
    puddleMat.opacity = 0.5 * clamp01((rain - 0.1) / 0.5) * (0.92 + 0.08 * Math.sin(t * 2.2));
    const arr = drops.instanceMatrix.array;
    for (let i = 0; i < n; i++) {
      dy[i] -= dv[i] * dt;
      dx[i] += dv[i] * dt * RAIN_WIND;
      if (dy[i] < 0.1 || dx[i] > area) { seedDrop(i, false); dx[i] = (rand() * 2 - 1) * area - area * 0.15; }
      const o = i * 16;
      arr[o + 12] = dx[i]; arr[o + 13] = dy[i]; arr[o + 14] = dz[i];
    }
    drops.instanceMatrix.needsUpdate = true;
  }

  return {
    group, setArea, setRain, update,
    get rain() { return rain; },
    puddles: () => list.map(p => ({ ...p })),
    info: () => ({ rain, drops: drops.visible ? drops.count : 0, puddles: puddleMesh.visible ? list.length : 0, meshes: (drops.visible ? 1 : 0) + (puddleMesh.visible ? 1 : 0), maxDrops }),
    dispose() {
      group.removeFromParent();
      dropGeo.dispose(); dropMat.dispose(); puddleGeo.dispose(); puddleMat.dispose();
      drops.dispose(); puddleMesh.dispose();
    },
  };
}

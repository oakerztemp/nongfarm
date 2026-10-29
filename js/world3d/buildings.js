// V23 buildings (CONTRACT_V23 s5): the cottage kitchen (2 merged meshes + night halo + one smoke InstancedMesh) and the dirt path ribbon.
//   buildKitchen(THREE, { gradient, tier }) -> { group, radius, height, doorLocal, chimneyLocal, setCooking(sec), setNight(bool), update(dt, t), info(), dispose() }
//   buildPathMesh(THREE, polylines, { width, color, gradient }) -> one Mesh (y = 0.015, soft alpha edges, receives shadow, noPick)
// V24 landmarks (CONTRACT_V24 s2): front = +z, origin = footprint centre on the ground, merged vertex-coloured toon meshes.
//   buildMailbox(THREE, { gradient, tier }) -> { group, radius 0.35, height, setFlag(bool), update(dt, t), dispose() }   (2 draw calls: box + flag)
//   buildNoticeBoard(THREE, { gradient, tier }) -> { group, radius 0.6, height, dispose() }   (1 draw call)
//   buildBench(THREE, { gradient, tier }) -> { group, radius 0.7, height, dispose() }   (1 draw call)

const PATH_Y = 0.015;

/** Merges parts [{ geo, color, pos, rot }] into one non-indexed, vertex-coloured BufferGeometry (the source geometries are disposed). */
function mergeColored(THREE, parts) {
  const pos = [], nor = [], col = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const one = new THREE.Vector3(1, 1, 1);
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    e.set(...(p.rot || [0, 0, 0]));
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(...(p.pos || [0, 0, 0])), q, one);
    g.applyMatrix4(m);
    c.set(p.color);
    const a = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    g.dispose(); p.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

const SMOKE_POOL = { high: 16, medium: 8, low: 0 };
const SMOKE_LIFE = 2.4;

export function buildKitchen(THREE, { gradient, tier = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'kitchen';
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  const WOOD = 0xc98f55, CREAM = 0xf5e6c8, ROOF = 0xe2763a, ROOF_D = 0xc9602b, DOOR = 0x7a4a2a, BRICK = 0xb4533a, BRICK_L = 0xcf6d4a, DARK = 0x4a3a30, METAL = 0x5b5f66;
  const wallH = 0.8, rise = 0.5, a = Math.atan2(rise, 0.85), slab = Math.hypot(0.85, rise) + 0.12;
  const parts = [
    { geo: box(1.8, wallH, 1.5), color: WOOD, pos: [0, wallH / 2, 0] },                                    // body
    { geo: box(1.86, 0.07, 1.56), color: CREAM, pos: [0, 0.035, 0] },                                       // plinth
    { geo: box(0.08, wallH, 0.08), color: CREAM, pos: [-0.9, wallH / 2, 0.75] },                            // corner posts
    { geo: box(0.08, wallH, 0.08), color: CREAM, pos: [0.9, wallH / 2, 0.75] },
    { geo: box(0.08, wallH, 0.08), color: CREAM, pos: [-0.9, wallH / 2, -0.75] },
    { geo: box(0.08, wallH, 0.08), color: CREAM, pos: [0.9, wallH / 2, -0.75] },
    { geo: box(0.4, 0.5, 0.05), color: DOOR, pos: [-0.25, 0.3, 0.76] },                                     // door
    { geo: box(0.46, 0.04, 0.07), color: CREAM, pos: [-0.25, 0.57, 0.765] },
    { geo: new THREE.SphereGeometry(0.025, 6, 5), color: 0xf2c14e, pos: [-0.13, 0.3, 0.8] },                // knob
    { geo: box(0.4, 0.3, 0.05), color: CREAM, pos: [0.55, 0.5, 0.765] },                                    // window frame
    { geo: box(0.025, 0.3, 0.07), color: DOOR, pos: [0.55, 0.5, 0.775] },                                   // window cross
    { geo: box(0.4, 0.025, 0.07), color: DOOR, pos: [0.55, 0.5, 0.775] },
    { geo: box(0.48, 0.04, 0.12), color: DOOR, pos: [0.55, 0.32, 0.8] },                                    // sill
    { geo: box(0.7, 0.04, 0.18), color: DOOR, pos: [0.55, 0.14, 0.95] },                                    // bench
    { geo: box(0.05, 0.14, 0.14), color: DOOR, pos: [0.25, 0.07, 0.95] },
    { geo: box(0.05, 0.14, 0.14), color: DOOR, pos: [0.85, 0.07, 0.95] },
    { geo: new THREE.CylinderGeometry(0.15, 0.17, 0.3, 10), color: 0x9b6a3c, pos: [-0.8, 0.15, 0.86] },     // barrel
    { geo: new THREE.CylinderGeometry(0.157, 0.157, 0.03, 10), color: METAL, pos: [-0.8, 0.08, 0.86] },
    { geo: new THREE.CylinderGeometry(0.16, 0.16, 0.03, 10), color: METAL, pos: [-0.8, 0.24, 0.86] },
    { geo: new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14), color: CREAM, pos: [-0.25, 0.7, 0.8], rot: [Math.PI / 2, 0, 0] },   // sign board
    { geo: new THREE.CylinderGeometry(0.075, 0.075, 0.03, 12), color: DARK, pos: [-0.25, 0.69, 0.83], rot: [Math.PI / 2, 0, 0] }, // pan
    { geo: box(0.1, 0.025, 0.025), color: DARK, pos: [-0.14, 0.69, 0.84] },                                 // pan handle
    { geo: new THREE.SphereGeometry(0.03, 8, 6), color: 0xf2c14e, pos: [-0.26, 0.7, 0.85] },                // yolk
  ];
  // gable triangles + roof slabs
  const tri = new THREE.Shape(); tri.moveTo(-0.75, 0); tri.lineTo(0.75, 0); tri.lineTo(0, rise); tri.closePath();
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 1.8, bevelEnabled: false });
  gable.translate(0, 0, -0.9); gable.rotateY(Math.PI / 2);
  parts.push({ geo: gable, color: CREAM, pos: [0, wallH, 0] });
  for (const s of [1, -1]) parts.push({ geo: box(2.0, 0.08, slab), color: ROOF, pos: [0, wallH + rise / 2 + 0.04, s * 0.425], rot: [s * a, 0, 0] });
  parts.push({ geo: box(2.04, 0.1, 0.12), color: ROOF_D, pos: [0, wallH + rise + 0.07, 0] });                // ridge cap
  // chimney (on the back slope, right side)
  parts.push({ geo: box(0.26, 0.9, 0.26), color: BRICK, pos: [0.55, 1.05, -0.28] });
  parts.push({ geo: box(0.32, 0.06, 0.32), color: BRICK_L, pos: [0.55, 1.53, -0.28] });
  parts.push({ geo: box(0.14, 0.05, 0.14), color: DARK, pos: [0.55, 1.57, -0.28] });

  const bodyGeo = mergeColored(THREE, parts);
  const bodyMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = 'kitchen-body';
  group.add(body);

  // window glass: dim by day, warm at night
  const glassGeo = new THREE.PlaneGeometry(0.3, 0.22);
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x9fc4d6 });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(0.55, 0.5, 0.795);
  group.add(glass);

  // night halo: radial additive disc in front of the window (vertex colours: bright centre, black rim)
  const haloGeo = new THREE.CircleGeometry(0.45, 24);
  const hc = [];
  const hp = haloGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) { const r = Math.hypot(hp.getX(i), hp.getY(i)) / 0.45; const k = Math.pow(1 - r, 1.6) * 0.8; hc.push(k, 0.72 * k, 0.32 * k); }
  haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
  const haloMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(0.55, 0.52, 0.84);
  halo.visible = false; halo.renderOrder = 5;
  group.add(halo);

  // smoke: one InstancedMesh, preallocated pool, zero per-frame allocation
  const poolN = SMOKE_POOL[tier] ?? SMOKE_POOL.high;
  const chimneyLocal = { x: 0.55, y: 1.6, z: -0.28 };
  let smoke = null, smokeGeo = null, smokeMat = null;
  const age = new Float32Array(poolN).fill(-1), sx = new Float32Array(poolN), sz = new Float32Array(poolN), sph = new Float32Array(poolN);
  const dummy = new THREE.Object3D();
  if (poolN > 0) {
    smokeGeo = new THREE.SphereGeometry(0.1, 8, 6);
    smokeMat = new THREE.MeshBasicMaterial({ color: 0xf1eeea, transparent: true, opacity: 0.55, depthWrite: false });
    smoke = new THREE.InstancedMesh(smokeGeo, smokeMat, poolN);
    smoke.frustumCulled = false; smoke.renderOrder = 6;
    smoke.count = poolN;
    dummy.scale.setScalar(0); dummy.updateMatrix();
    for (let i = 0; i < poolN; i++) smoke.setMatrixAt(i, dummy.matrix);
    smoke.instanceMatrix.needsUpdate = true;
    group.add(smoke);
  }
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let cookLeft = 0, spawnTimer = 1.2, active = 0, night = false;
  const cookEvery = SMOKE_LIFE / Math.max(1, poolN) * 1.15;

  function spawn() {
    for (let i = 0; i < poolN; i++) if (age[i] < 0) { age[i] = 0; sx[i] = (rnd() - 0.5) * 0.08; sz[i] = (rnd() - 0.5) * 0.08; sph[i] = rnd() * 6.28; return; }
  }

  return {
    group, radius: 1.1, height: 1.6,
    doorLocal: { x: -0.25, y: 0.3, z: 0.8 },
    chimneyLocal,
    /** Frequent puffs for `sec` seconds (no-op on the low tier). */
    setCooking(sec) { if (poolN > 0) { cookLeft = Math.max(cookLeft, +sec || 0); spawnTimer = Math.min(spawnTimer, 0); } },
    setNight(on) {
      night = !!on;
      glassMat.color.setHex(night ? 0xffcf7a : 0x9fc4d6);
      halo.visible = night;
      if (smokeMat) smokeMat.color.setHex(night ? 0xc2c6d6 : 0xf1eeea);
    },
    update(dt, t = 0) {
      if (night) haloMat.opacity = 0.9 + Math.sin(t * 3.1) * 0.08 + Math.sin(t * 7.3) * 0.04;
      if (!smoke) return;
      if (cookLeft > 0) { cookLeft -= dt; spawnTimer -= dt; if (spawnTimer <= 0) { spawn(); spawnTimer += cookEvery; } }
      else { spawnTimer -= dt; if (spawnTimer <= 0) { if (tier !== 'medium' || rnd() < 0.7) spawn(); spawnTimer = 3 + rnd() * 3.5; } }
      active = 0;
      for (let i = 0; i < poolN; i++) {
        if (age[i] < 0) continue;
        age[i] += dt;
        const k = age[i] / SMOKE_LIFE;
        if (k >= 1) {
          age[i] = -1; dummy.scale.setScalar(0); dummy.position.set(0, 0, 0);
        } else {
          active++;
          const grow = 0.55 + k * 1.5, fade = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
          dummy.position.set(chimneyLocal.x + sx[i] + Math.sin(age[i] * 1.3 + sph[i]) * 0.07 + k * 0.28, chimneyLocal.y + 0.05 + age[i] * 0.42, chimneyLocal.z + sz[i]);
          dummy.scale.setScalar(grow * (0.35 + 0.65 * fade));
        }
        dummy.updateMatrix();
        smoke.setMatrixAt(i, dummy.matrix);
      }
      smoke.instanceMatrix.needsUpdate = true;
    },
    /** Debug / tests: how many smoke puffs are alive, and the pool size. */
    info() { return { puffs: active, pool: poolN, hasSmoke: !!smoke }; },
    dispose() {
      bodyGeo.dispose(); bodyMat.dispose(); glassGeo.dispose(); glassMat.dispose(); haloGeo.dispose(); haloMat.dispose();
      if (smoke) { smokeGeo.dispose(); smokeMat.dispose(); smoke.dispose(); }
      if (group.parent) group.parent.remove(group);
      group.clear();
    },
  };
}

/**
 * Flat dirt ribbons following polylines [[{x,z},...],...]: one strip per polyline (mitred joins, half-disc ends),
 * RGBA vertex colours = opaque centre, transparent rims (soft edge). One merged geometry, one Mesh.
 */
export function buildPathMesh(THREE, polylines, { width = 0.9, color = 0xc9a26b, gradient = null } = {}) {
  const pos = [], col = [], idx = [];
  const base = new THREE.Color(color), rim = base.clone().multiplyScalar(0.82);
  const hw = width / 2;
  const vert = (x, y, z, c, al) => { pos.push(x, y, z); col.push(c.r, c.g, c.b, al); return pos.length / 3 - 1; };
  polylines.forEach((raw, li) => {
    const pts = [];
    for (const p of raw || []) { const l = pts[pts.length - 1]; if (!l || Math.hypot(p.x - l.x, p.z - l.z) > 1e-4) pts.push({ x: p.x, z: p.z }); }
    if (pts.length < 2) return;
    const y = PATH_Y + li * 0.0004;
    const dir = [];
    for (let i = 0; i < pts.length - 1; i++) { const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z, l = Math.hypot(dx, dz); dir.push({ x: dx / l, z: dz / l }); }
    const rows = [];
    for (let i = 0; i < pts.length; i++) {
      const d0 = dir[Math.max(0, i - 1)], d1 = dir[Math.min(dir.length - 1, i)];
      let nx = -(d0.z + d1.z), nz = d0.x + d1.x;                        // left normal of the averaged tangent (mitre)
      let l = Math.hypot(nx, nz);
      if (l < 1e-6) { nx = -d0.z; nz = d0.x; l = 1; }
      nx /= l; nz /= l;
      const dot = Math.max(0.55, nx * -d0.z + nz * d0.x);                // clamp the mitre so tight corners do not spike
      const m = hw / dot;
      const p = pts[i];
      rows.push([vert(p.x + nx * m, y, p.z + nz * m, rim, 0), vert(p.x, y, p.z, base, 1), vert(p.x - nx * m, y, p.z - nz * m, rim, 0)]);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const A = rows[i], B = rows[i + 1];
      idx.push(A[0], A[1], B[1], A[0], B[1], B[0], A[1], A[2], B[2], A[1], B[2], B[1]);
    }
    // round ends: half-disc fans from the left rim, swinging round the outward direction to the right rim
    const cap = (p, d, row, sign) => {
      let prev = row[0];
      for (let k = 1; k <= 8; k++) {
        const th = (k / 8) * Math.PI;
        const cx = -d.z * Math.cos(th) + sign * d.x * Math.sin(th), cz = d.x * Math.cos(th) + sign * d.z * Math.sin(th);
        const v = k === 8 ? row[2] : vert(p.x + cx * hw, y, p.z + cz * hw, rim, 0);
        idx.push(row[1], prev, v);
        prev = v;
      }
    };
    cap(pts[0], dir[0], rows[0], -1);
    cap(pts[pts.length - 1], dir[dir.length - 1], rows[rows.length - 1], 1);
  });
  // winding: make every triangle face up (+y)
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const cy = (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]) - (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]);
    if (cy < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const matOpts = { vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  const mat = gradient ? new THREE.MeshToonMaterial({ ...matOpts, gradientMap: gradient }) : new THREE.MeshLambertMaterial(matOpts);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'dirt-path';
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.renderOrder = 1;
  mesh.userData.noPick = true;
  return mesh;
}

// ---------------------------------------------------------------- V24 landmarks

function toonMesh(THREE, name, parts, gradient) {
  const geo = mergeColored(THREE, parts);
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  return mesh;
}

function disposeGroup(group, meshes) {
  for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); }
  if (group.parent) group.parent.remove(group);
  group.clear();
}

function heartGeo(THREE, size, depth) {
  const h = new THREE.Shape();
  h.moveTo(0, -0.5); h.bezierCurveTo(-0.9, 0.05, -0.55, 0.7, 0, 0.3); h.bezierCurveTo(0.55, 0.7, 0.9, 0.05, 0, -0.5);
  const g = new THREE.ExtrudeGeometry(h, { depth, bevelEnabled: false, curveSegments: 5 });
  g.scale(size, size, 1);
  return g;
}

const WOOD_D = 0x7a4a2a, WOOD_M = 0xc98f55, WOOD_L = 0xdcab72, CREAM_L = 0xf5e6c8;

export function buildMailbox(THREE, { gradient, tier = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'mailbox';
  const seg = tier === 'low' ? 8 : 14;
  const BLUE = 0x4f8fd6, BLUE_D = 0x3a6fae, RED = 0xe0463c;
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const parts = [
    { geo: box(0.22, 0.04, 0.22), color: 0x8f9a6a, pos: [0, 0.02, 0] },                                       // footing
    { geo: box(0.09, 0.68, 0.09), color: WOOD_M, pos: [0, 0.34, 0] },                                        // post
    { geo: box(0.07, 0.07, 0.3), color: WOOD_D, pos: [0, 0.66, 0.0] },                                       // shelf brace
    { geo: box(0.3, 0.13, 0.5), color: BLUE, pos: [0, 0.745, 0] },                                           // lower box
  ];
  parts.push({ geo: new THREE.CylinderGeometry(0.15, 0.15, 0.5, seg), color: BLUE, pos: [0, 0.81, 0], rot: [Math.PI / 2, 0, 0] });   // rounded lid (axis along z)
  parts.push({ geo: box(0.31, 0.13, 0.03), color: BLUE_D, pos: [0, 0.745, 0.255] });                         // door (lower half)
  parts.push({ geo: new THREE.CylinderGeometry(0.152, 0.152, 0.03, seg), color: BLUE_D, pos: [0, 0.81, 0.255], rot: [Math.PI / 2, 0, 0] }); // door (round top)
  parts.push({ geo: heartGeo(THREE, 0.1, 0.012), color: RED, pos: [0, 0.8, 0.27] });                         // heart on the door
  parts.push({ geo: box(0.05, 0.03, 0.02), color: 0xf2c14e, pos: [0, 0.69, 0.275] });                        // latch
  parts.push({ geo: box(0.015, 0.09, 0.14), color: CREAM_L, pos: [-0.155, 0.8, 0.0] });                      // envelope on the left side
  parts.push({ geo: box(0.02, 0.02, 0.1), color: RED, pos: [-0.158, 0.8, 0.0], rot: [0.5, 0, 0] });
  const body = toonMesh(THREE, 'mailbox-body', parts, gradient);
  group.add(body);

  // flag: pivots about the x axis on the right side; rotation.x 0 = up, FLAG_DOWN = lowered
  const FLAG_DOWN = -1.45;
  const flagGeo = mergeColored(THREE, [
    { geo: box(0.025, 0.17, 0.025), color: RED, pos: [0, 0.085, 0] },
    { geo: box(0.02, 0.07, 0.11), color: RED, pos: [0, 0.14, 0.06] },
    { geo: new THREE.SphereGeometry(0.03, 6, 5), color: 0xb8312a, pos: [0, 0, 0] },
  ]);
  const flagMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradient });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.name = 'mailbox-flag';
  flag.position.set(0.175, 0.78, -0.09);
  flag.rotation.x = FLAG_DOWN;
  group.add(flag);

  let want = false;
  return {
    group, radius: 0.35, height: 0.97,
    /** Raise (true) or lower (false) the red flag; the motion happens in update(). */
    setFlag(on) { want = !!on; },
    update(dt, t = 0) {
      const target = want ? 0 : FLAG_DOWN;
      const d = target - flag.rotation.x;
      if (Math.abs(d) > 1e-4) flag.rotation.x += d * Math.min(1, dt * 7);
      else flag.rotation.x = target;
      flag.rotation.z = want && Math.abs(d) < 0.02 ? Math.sin(t * 5) * 0.03 : 0;      // tiny wiggle while it is up
    },
    dispose() { disposeGroup(group, [body, flag]); },
  };
}

export function buildNoticeBoard(THREE, { gradient, tier = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'noticeboard';
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const rise = 0.17, half = 0.29, a = Math.atan2(rise, half), slab = Math.hypot(half, rise) + 0.08;
  const parts = [
    { geo: box(0.1, 1.15, 0.1), color: WOOD_M, pos: [-0.44, 0.575, 0] },                                     // posts
    { geo: box(0.1, 1.15, 0.1), color: WOOD_M, pos: [0.44, 0.575, 0] },
    { geo: box(0.2, 0.05, 0.2), color: 0x8f9a6a, pos: [-0.44, 0.025, 0] },                                   // footings
    { geo: box(0.2, 0.05, 0.2), color: 0x8f9a6a, pos: [0.44, 0.025, 0] },
    { geo: box(1.0, 0.66, 0.05), color: WOOD_L, pos: [0, 0.74, 0.0] },                                       // board
    { geo: box(1.04, 0.05, 0.08), color: WOOD_D, pos: [0, 1.085, 0.015] },                                   // frame
    { geo: box(1.04, 0.05, 0.08), color: WOOD_D, pos: [0, 0.395, 0.015] },
    { geo: box(0.05, 0.66, 0.08), color: WOOD_D, pos: [-0.5, 0.74, 0.015] },
    { geo: box(0.05, 0.66, 0.08), color: WOOD_D, pos: [0.5, 0.74, 0.015] },
    // coloured notes (slightly rotated, with pins)
    { geo: box(0.24, 0.28, 0.012), color: 0xffe27a, pos: [-0.3, 0.8, 0.032], rot: [0, 0, 0.08] },
    { geo: box(0.2, 0.22, 0.012), color: 0xf59ab5, pos: [-0.02, 0.84, 0.034], rot: [0, 0, -0.1] },
    { geo: box(0.26, 0.2, 0.012), color: 0x8ed0f0, pos: [0.28, 0.82, 0.032], rot: [0, 0, 0.06] },
    { geo: box(0.28, 0.2, 0.012), color: 0xa8e08a, pos: [-0.14, 0.55, 0.034], rot: [0, 0, -0.05] },
    { geo: box(0.2, 0.24, 0.012), color: 0xffffff, pos: [0.22, 0.56, 0.036], rot: [0, 0, 0.12] },
  ];
  const pin = (x, y, c) => parts.push({ geo: new THREE.SphereGeometry(0.022, 6, 5), color: c, pos: [x, y, 0.048] });
  pin(-0.3, 0.92, 0xe0463c); pin(-0.02, 0.94, 0x4f8fd6); pin(0.28, 0.91, 0xe0463c); pin(-0.14, 0.64, 0x4f8fd6); pin(0.22, 0.67, 0xe0463c);
  // little "writing" lines on the white note
  parts.push({ geo: box(0.13, 0.015, 0.006), color: 0x6b5a4a, pos: [0.22, 0.6, 0.044], rot: [0, 0, 0.12] });
  parts.push({ geo: box(0.1, 0.015, 0.006), color: 0x6b5a4a, pos: [0.22, 0.54, 0.044], rot: [0, 0, 0.12] });
  // small gabled roof
  const tri = new THREE.Shape(); tri.moveTo(-0.26, 0); tri.lineTo(0.26, 0); tri.lineTo(0, rise); tri.closePath();
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 1.0, bevelEnabled: false });
  gable.translate(0, 0, -0.5); gable.rotateY(Math.PI / 2);
  parts.push({ geo: gable, color: CREAM_L, pos: [0, 1.15, 0] });
  for (const s of [1, -1]) parts.push({ geo: box(1.16, 0.06, slab), color: 0xe2763a, pos: [0, 1.15 + rise / 2 + 0.03, s * half / 2], rot: [s * a, 0, 0] });
  parts.push({ geo: box(1.18, 0.07, 0.09), color: 0xc9602b, pos: [0, 1.15 + rise + 0.05, 0] });
  const body = toonMesh(THREE, 'noticeboard-body', parts, gradient);
  group.add(body);
  return { group, radius: 0.6, height: 1.4, dispose() { disposeGroup(group, [body]); } };
}

export function buildBench(THREE, { gradient, tier = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'bench';
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const seg = tier === 'low' ? 7 : 12;
  const parts = [];
  for (const sx of [-1, 1]) {                                                                                  // side frames
    parts.push({ geo: box(0.07, 0.36, 0.06), color: WOOD_D, pos: [sx * 0.43, 0.18, 0.14] });
    parts.push({ geo: box(0.07, 0.36, 0.06), color: WOOD_D, pos: [sx * 0.43, 0.18, -0.12] });
    parts.push({ geo: box(0.08, 0.04, 0.4), color: WOOD_D, pos: [sx * 0.43, 0.38, 0.01] });                    // arm rest
    parts.push({ geo: box(0.06, 0.52, 0.05), color: WOOD_D, pos: [sx * 0.43, 0.6, -0.17], rot: [-0.12, 0, 0] }); // back post
  }
  for (const z of [0.14, 0.01, -0.12]) parts.push({ geo: box(1.0, 0.045, 0.12), color: WOOD_M, pos: [0, 0.4, z] }); // seat planks
  for (const [y, c] of [[0.58, WOOD_L], [0.7, WOOD_M]]) parts.push({ geo: box(0.94, 0.09, 0.03), color: c, pos: [0, y, -0.2 - (y - 0.4) * 0.12], rot: [-0.12, 0, 0] }); // back slats
  // flower pot beside the bench
  const px = 0.58, pz = 0.06;
  parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.075, 0.17, seg), color: 0xc8603a, pos: [px, 0.085, pz] });
  parts.push({ geo: new THREE.CylinderGeometry(0.108, 0.108, 0.035, seg), color: 0xb04f2e, pos: [px, 0.18, pz] });
  parts.push({ geo: new THREE.CylinderGeometry(0.09, 0.09, 0.02, seg), color: 0x5a3e2b, pos: [px, 0.19, pz] });
  const flowers = tier === 'low' ? 2 : 4;
  const spots = [[-0.04, 0.0, 0xf59ab5, 0.33], [0.04, -0.03, 0xffe27a, 0.38], [0.0, 0.05, 0xffffff, 0.3], [0.05, 0.04, 0xf08a5d, 0.35]];
  parts.push({ geo: new THREE.SphereGeometry(0.075, 7, 5), color: 0x6fae4f, pos: [px, 0.24, pz] });             // leaves
  for (let i = 0; i < flowers; i++) {
    const [dx, dz, c, y] = spots[i];
    parts.push({ geo: box(0.014, y - 0.2, 0.014), color: 0x4f8f3f, pos: [px + dx, 0.2 + (y - 0.2) / 2, pz + dz] });
    parts.push({ geo: new THREE.SphereGeometry(0.04, 7, 5), color: c, pos: [px + dx, y + 0.01, pz + dz] });
    parts.push({ geo: new THREE.SphereGeometry(0.016, 5, 4), color: 0xf2c14e, pos: [px + dx, y + 0.03, pz + dz + 0.03] });
  }
  const body = toonMesh(THREE, 'bench-body', parts, gradient);
  group.add(body);
  return { group, radius: 0.7, height: 0.85, dispose() { disposeGroup(group, [body]); } };
}

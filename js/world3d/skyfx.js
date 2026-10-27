// V20 sky extras (CONTRACT_V20 §3, §4): drifting low-poly clouds on the horizon, stars, fireflies and cloud shadows on the lawn.
// Engine-owned, at most 4 draw calls (clouds 1, stars 1, fireflies 1, cloud shadows 1); quality tier decides what exists.
//
//   const sky = createSkyFx(THREE, { tier: 'high'|'medium'|'low', gradient, walkRadius })
//   scene.add(sky.group); sky.setLook(look, cloudiness)   // look = daylight.skyAt(...); call when the light changes (~1 s)
//   sky.update(dt, t)                                     // every rendered frame (cheap; fireflies only move at night)
//   sky.setArea(walkRadius); sky.info() -> { clouds, stars, fireflies, shadows }; sky.dispose()

const CLOUD_R = 52;        // ring radius of the horizon clouds
const STAR_R = 70;         // star dome radius (inside the camera far plane 140)
const SHADOW_SIZE = 46;    // cloud shadow plane (covers the meadow around the yard)

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function softTexture(THREE, draw, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSkyFx(THREE, { tier = 'medium', gradient = null, walkRadius = 5.6 } = {}) {
  const group = new THREE.Group();
  group.name = 'skyfx';
  const owned = [];
  const own = x => { owned.push(x); return x; };
  const R = rng(20261027);
  const nFireflies = tier === 'high' ? 28 : tier === 'medium' ? 14 : 0;
  const withShadows = tier === 'high';

  // ---- clouds: puffy blobs (3-5 squashed spheres each) merged into one mesh on a slowly turning ring
  const puff = own(new THREE.IcosahedronGeometry(1, 1));
  const parts = [];
  const nClouds = tier === 'low' ? 6 : 9;
  for (let i = 0; i < nClouds; i++) {
    const a = (i / nClouds) * Math.PI * 2 + R() * 0.4;
    const y = 13 + R() * 7, s = 2.6 + R() * 2.2;
    const cx = Math.cos(a) * CLOUD_R, cz = Math.sin(a) * CLOUD_R;
    const n = 3 + Math.floor(R() * 3);
    for (let k = 0; k < n; k++) {
      const g = puff.clone();
      const off = (k - (n - 1) / 2) * s * 0.9;
      const r = s * (0.7 + R() * 0.5) * (k === Math.floor(n / 2) ? 1.25 : 1);
      g.scale(r * 1.15, r * 0.62, r);
      // spread along the tangent of the ring so a cloud is wide, not deep
      g.translate(cx - Math.sin(a) * off, y + R() * 0.8 + (k === Math.floor(n / 2) ? r * 0.25 : 0), cz + Math.cos(a) * off);
      parts.push(g);
    }
  }
  const cloudGeo = own(mergeGeometries(THREE, parts));
  for (const g of parts) g.dispose();
  const cloudMat = own(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient, fog: false }));
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.userData.noPick = true;
  clouds.renderOrder = -2;
  group.add(clouds);

  // ---- stars: points on the upper dome, fade in at night
  const nStars = tier === 'low' ? 120 : 260;
  const starPos = new Float32Array(nStars * 3);
  for (let i = 0; i < nStars; i++) {
    const az = R() * Math.PI * 2, el = 0.12 + Math.pow(R(), 0.7) * 1.35;
    starPos[i * 3] = Math.cos(az) * Math.cos(el) * STAR_R;
    starPos[i * 3 + 1] = Math.sin(el) * STAR_R;
    starPos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * STAR_R;
  }
  const starGeo = own(new THREE.BufferGeometry());
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const dotTex = own(softTexture(THREE, (g, n) => {
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  }));
  const starMat = own(new THREE.PointsMaterial({ map: dotTex, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: false, color: 0xf4f1ff }));
  const stars = new THREE.Points(starGeo, starMat);
  stars.userData.noPick = true;
  stars.frustumCulled = false;
  stars.visible = false;
  group.add(stars);

  // ---- fireflies: a few glowing points drifting around the yard at night (CPU-moved, tiny buffer)
  let flies = null;
  if (nFireflies) {
    const pos = new Float32Array(nFireflies * 3);
    const seeds = [];
    for (let i = 0; i < nFireflies; i++) seeds.push({ a: R() * Math.PI * 2, r: 0.35 + R() * 0.65, h: 0.35 + R() * 1.2, sp: 0.15 + R() * 0.25, ph: R() * 10 });
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const glow = own(softTexture(THREE, (g, n) => {
      const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.25, 'rgba(230,255,140,0.9)'); gr.addColorStop(1, 'rgba(180,255,90,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
    }));
    const mat = own(new THREE.PointsMaterial({ map: glow, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false }));
    const pts = new THREE.Points(geo, mat);
    pts.userData.noPick = true;
    pts.frustumCulled = false;
    pts.visible = false;
    group.add(pts);
    flies = { pts, pos, seeds, mat };
  }

  // ---- cloud shadows: a soft blotchy texture sliding over the ground
  let shade = null;
  if (withShadows) {
    const tex = own(softTexture(THREE, (g, n) => {
      const r = rng(7);
      g.clearRect(0, 0, n, n);
      for (let i = 0; i < 9; i++) {
        const x = r() * n, y = r() * n, rad = n * (0.12 + r() * 0.16);
        for (const [dx, dy] of [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n]]) {   // tile seamlessly
          const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
          gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(0, 0, n, n);
        }
      }
    }, 256));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.6, 1.6);
    const edge = own(softTexture(THREE, (g, n) => {   // radial fade: the plane has no visible square border
      const gr = g.createRadialGradient(n / 2, n / 2, n * 0.2, n / 2, n / 2, n / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
    }));
    const geo = own(new THREE.PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE));
    geo.rotateX(-Math.PI / 2);
    const mat = own(new THREE.MeshBasicMaterial({ map: tex, alphaMap: edge, color: 0x203040, transparent: true, opacity: 0, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.025;
    mesh.renderOrder = -1;
    mesh.userData.noPick = true;
    group.add(mesh);
    shade = { mesh, mat, tex };
  }

  let night = 0, day = 1;

  function setLook(look, cloudiness = 0) {
    night = look.night;
    day = 1 - look.night;
    cloudMat.color.set(look.cloud);
    starMat.opacity = Math.max(0, (night - 0.4) / 0.6) * (1 - cloudiness * 0.9);
    stars.visible = starMat.opacity > 0.01;
    if (flies) {
      flies.mat.opacity = Math.max(0, (night - 0.5) / 0.5);
      flies.pts.visible = flies.mat.opacity > 0.01;
    }
    if (shade) {
      shade.mat.opacity = day * (0.13 + 0.12 * cloudiness);
      shade.mesh.visible = shade.mat.opacity > 0.01;
    }
  }

  function update(dt, t) {
    clouds.rotation.y += dt * 0.004;
    if (shade && shade.mesh.visible) { shade.tex.offset.x += dt * 0.006; shade.tex.offset.y += dt * 0.0025; }
    if (flies && flies.pts.visible) {
      const { pos, seeds } = flies;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        const a = s.a + t * s.sp * 0.4 + Math.sin(t * 0.7 + s.ph) * 0.4;
        const r = walkRadius * (s.r + Math.sin(t * 0.33 + s.ph) * 0.12);
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = s.h + Math.sin(t * 1.3 + s.ph) * 0.25;
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
      flies.pts.geometry.attributes.position.needsUpdate = true;
      flies.mat.size = 0.55 + 0.14 * Math.sin(t * 3.1);   // a gentle shared pulse
    }
  }

  return {
    group, setLook, update,
    setArea(r) { walkRadius = r; },
    info: () => ({ clouds: nClouds, stars: stars.visible ? nStars : 0, fireflies: flies && flies.pts.visible ? nFireflies : 0, shadows: !!(shade && shade.mesh.visible) }),
    dispose() { for (const o of owned) o.dispose(); group.clear(); },
  };
}

/** Merges non-indexed / indexed geometries with position + normal only (enough for the toon clouds). */
function mergeGeometries(THREE, geos) {
  let n = 0;
  const flat = geos.map(g => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
    if (!g.attributes.normal) g.computeVertexNormals();   // keep the sphere's smooth normals (soft toon puffs)
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
    if (g !== geos[flat.indexOf(g)]) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

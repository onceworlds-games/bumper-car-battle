// The camera against what is really built: the plazas are dressed headlessly (their meshes, with no GPU), and from everywhere you can
// stand the camera must not sit inside a wall-sized surface (a house, the stage and its backdrop, a roof, a stair wall, the terrace) or have one
// between it and you. This is the guard for scenery added without telling the camera (plazas.js: obstacles, `roofs`, `walls`).
//
// "Wall-sized": a triangle of at least 0.75 m2, so poles, balusters, wires and trim are left to pass (the camera slides round pillars), and
// the iron balcony floors that dress the house fronts (12 cm thick, 0.9 m deep) and the awnings and curtain (double-sided: the camera may look
// through them) are not counted either.
import test from 'node:test';
import assert from 'node:assert/strict';

const fakeCtx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => fakeCtx), set: () => true });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx, style: {} }), addEventListener() {} };
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.matchMedia = () => ({ matches: false });
globalThis.addEventListener = () => {};

const THREE = await import('three');
const { buildPlaza } = await import('../src/render/plaza3d.js');
const { createCamera } = await import('../src/render/camera.js');
const { PLAZAS, floorY } = await import('../src/sim/plazas.js');
const { navFor, makePath, pathAt, walkPath } = await import('../src/sim/nav.js');

const MIN_AREA = 0.75;

/** The wall-sized triangles of a plaza's scenery, in world space: { t: [9 numbers], double }. */
function surfaces(plaza) {
  const scene = new THREE.Scene();
  const built = buildPlaza(scene, plaza);
  scene.updateMatrixWorld(true);
  const b = plaza.bounds;
  const nearEdge = (t) => {
    const cx = (t[0] + t[3] + t[6]) / 3;
    const cz = (t[2] + t[5] + t[8]) / 3;
    return Math.min(cx - b.x0, b.x1 - cx, cz - b.z0, b.z1 - cz) < 1.1;
  };
  const out = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.material.type !== 'MeshLambertMaterial') return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const at = (i) => v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).toArray();
    for (let i = 0; i < (idx ? idx.count : pos.count); i += 3) {
      const t = [...at(idx ? idx.getX(i) : i), ...at(idx ? idx.getX(i + 1) : i + 1), ...at(idx ? idx.getX(i + 2) : i + 2)];
      const ux = t[3] - t[0];
      const uy = t[4] - t[1];
      const uz = t[5] - t[2];
      const wx = t[6] - t[0];
      const wy = t[7] - t[1];
      const wz = t[8] - t[2];
      const area = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
      if (area < MIN_AREA) continue;
      const flat = Math.abs(t[1] - t[4]) < 1e-3 && Math.abs(t[1] - t[7]) < 1e-3;
      if (flat && t[1] > 3.85 && t[1] < 4.05 && nearEdge(t)) continue; // balcony floors
      out.push({ t, double: o.material.side === THREE.DoubleSide });
    }
  });
  built.dispose?.();
  return out;
}

/** Nearest hit along a ray (Moller-Trumbore): { d, back } (back: the surface faces away, so the ray started inside it). */
function nearest(tris, o, d, max) {
  let best = null;
  for (const { t } of tris) {
    const e1x = t[3] - t[0];
    const e1y = t[4] - t[1];
    const e1z = t[5] - t[2];
    const e2x = t[6] - t[0];
    const e2y = t[7] - t[1];
    const e2z = t[8] - t[2];
    const px = d[1] * e2z - d[2] * e2y;
    const py = d[2] * e2x - d[0] * e2z;
    const pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const sx = o[0] - t[0];
    const sy = o[1] - t[1];
    const sz = o[2] - t[2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (w < 0 || u + w > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist < 1e-4 || dist > max || (best && dist >= best.d)) continue;
    best = { d: dist, back: (e1y * e2z - e1z * e2y) * d[0] + (e1z * e2x - e1x * e2z) * d[1] + (e1x * e2y - e1y * e2x) * d[2] > 0, t };
  }
  return best;
}

const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** Inside a closed solid: the nearest surface is seen from behind along most of the six axes (one is a ray along an edge or an open shell). */
const insideAt = (tris, p) => AXES.filter((d) => nearest(tris, [p.x, p.y, p.z], d, 80)?.back).length >= 4;
/** Is a wall-sized surface (one the camera can't look through) between the camera and you? */
function hiddenAt(tris, p, c) {
  const dx = c.tx - p.x;
  const dy = c.ty - p.y;
  const dz = c.tz - p.z;
  const len = Math.hypot(dx, dy, dz);
  const h = nearest(tris.solid, [p.x, p.y, p.z], [dx / len, dy / len, dz / len], len - 0.35);
  return h && h.d > 0.12 ? h : null;
}

function views(plaza, step, each) {
  const nav = navFor(plaza);
  const b = plaza.bounds;
  for (let x = b.x0 + 1; x < b.x1; x += step) {
    for (let z = b.z0 + 1; z < b.z1; z += step) {
      if (nav.clear(x, z) < 0.4) continue;
      for (const [pitch, dist] of [[0.46, 10], [0.12, 10], [0.9, 6]]) {
        for (let k = 0; k < 8; k++) {
          const c = createCamera();
          c.st.yaw = (k / 8) * Math.PI * 2;
          c.st.pitch = c.st.mine.pitch = pitch;
          c.st.dist = c.st.mine.dist = dist;
          const fy = floorY(plaza, x, z);
          c.snap(x, fy, z);
          for (let i = 0; i < 40; i++) c.update(0.05, x, fy, z, plaza, { now: i });
          each(c, x, z, k);
        }
      }
    }
  }
}

for (const plaza of PLAZAS) {
  const all = surfaces(plaza);
  const tris = Object.assign(all, { solid: all.filter((s) => !s.double) });
  test(`${plaza.id}: from everywhere you can stand the camera is outside the real walls, and they don't hide you`, () => {
    let n = 0;
    views(plaza, 4, (c, x, z, k) => {
      n++;
      const p = c.cam.position;
      const where = `you at (${x}, ${z}), looking round ${k}/8, camera at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
      assert.ok(!insideAt(tris.solid, p), `inside a wall: ${where}`);
      const h = hiddenAt(tris, p, c.st);
      assert.ok(!h, `a wall between you and the camera (${h && h.t.map((v) => v.toFixed(1))}): ${where}`);
    });
    assert.ok(n > 300);
  });
}

const TOURS = {
  piazza: [[-29.3, -20.3], [-24, -7.5], [-24, 7.5], [-29.3, 20.3], [14, 20.3], [29.3, 20.3], [24.5, 12], [24.5, -12], [29.3, -20.3], [-12, -16], [-29.3, -20.3]],
  quay: [[-35.3, -17.3], [14, -16.8], [35.3, -17.3], [35.3, 2], [20, 2.5], [0, 14], [-8, 8.5], [-5, -5], [-27, -2], [-35.3, 0], [-35.3, -17.3]],
  palazzo: [[-21.4, -21.3], [21.4, -21.3], [21.4, -13], [18, -10], [18, 17.3], [-18, 17.4], [-18, -10], [-21.4, -13], [0, -8], [0, 8.8], [-12, 14], [-15, -15]],
};

test('walking along every wall, the real walls are never round the camera and hide you only for a moment', () => {
  const DT = 1 / 60;
  for (const plaza of PLAZAS) {
    const all = surfaces(plaza);
    const solid = all.filter((s) => !s.double);
    const pts = [];
    let cur = null;
    for (const to of TOURS[plaza.id]) {
      if (!cur) {
        cur = to;
        pts.push(to);
        continue;
      }
      const leg = walkPath(plaza, cur[0], cur[1], to[0], to[1], 0.42);
      if (!leg) continue;
      for (const q of leg.slice(1)) pts.push(q);
      cur = leg[leg.length - 1];
    }
    const path = makePath(pts);
    const c = createCamera();
    const P = {};
    pathAt(path, 0, P);
    c.st.yaw = Math.atan2(-P.tx, -P.tz);
    c.snap(P.x, floorY(plaza, P.x, P.z), P.z);
    let frames = 0;
    let hidden = 0;
    for (let s = 0, now = 0; s < path.len; s += 4.5 * DT, now += DT, frames++) {
      pathAt(path, s, P);
      // now and then the player drags the view round by hand, into the walls
      if (frames % 600 > 300 && frames % 600 < 420) c.orbit(0.9 * DT, 0, now);
      c.update(DT, P.x, floorY(plaza, P.x, P.z), P.z, plaza, { heading: Math.atan2(P.tx, P.tz), moving: true, now });
      if (frames % 3) continue;
      const p = c.cam.position;
      assert.ok(!insideAt(solid, p), `${plaza.id}: inside a wall at (${P.x.toFixed(1)}, ${P.z.toFixed(1)}), camera (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
      if (hiddenAt({ solid }, p, c.st)) hidden++;
    }
    assert.ok(hidden / (frames / 3) < 0.01, `${plaza.id}: a wall hid you in ${((hidden / (frames / 3)) * 100).toFixed(1)}% of the frames`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamera } from '../src/render/camera.js';
import { PLAZAS, floorY } from '../src/sim/plazas.js';
import { navFor } from '../src/sim/nav.js';

/** Walks the camera to a spot, facing a direction, and lets it settle. */
function settle(plaza, x, z, yaw, pitch = 0.46, dist = 10) {
  const c = createCamera();
  c.st.yaw = yaw;
  c.st.pitch = pitch;
  c.st.dist = dist;
  c.snap(x, floorY(plaza, x, z), z);
  for (let i = 0; i < 40; i++) c.update(0.05, x, floorY(plaza, x, z), z, plaza, { now: i });
  return c;
}

const insideOccluder = (nav, p, margin) => {
  for (const o of nav.occluders) {
    if (p.y > o.h + 0.2) continue;
    const d = o.t === 'c' ? Math.hypot(p.x - o.x, p.z - o.z) - o.r : Math.max(Math.abs(p.x - o.x) - o.w / 2, Math.abs(p.z - o.z) - o.d / 2);
    if (d < margin) return o;
  }
  return null;
};

test('the camera never ends up inside a column, a roof or a house, from anywhere you can stand', () => {
  let samples = 0;
  let close = 0;
  for (const plaza of PLAZAS) {
    const nav = navFor(plaza);
    const b = plaza.bounds;
    for (let x = b.x0 + 1; x < b.x1; x += 3) {
      for (let z = b.z0 + 1; z < b.z1; z += 3) {
        if (nav.clear(x, z) < 0.4) continue;
        for (let k = 0; k < 8; k++) {
          const yaw = (k / 8) * Math.PI * 2;
          const c = settle(plaza, x, z, yaw);
          const p = c.cam.position;
          samples++;
          const hit = insideOccluder(nav, p, 0.15);
          assert.ok(!hit, `${plaza.id} (${x}, ${z}) yaw ${yaw.toFixed(1)}: the camera is inside a ${hit?.kind}`);
          for (const rf of plaza.roofs ?? []) {
            const inside = p.x > rf.x0 && p.x < rf.x1 && p.z > rf.z0 && p.z < rf.z1 && p.y > (rf.lo ?? rf.h - 1.2) && p.y < rf.h + 0.2;
            assert.ok(!inside, `${plaza.id} (${x}, ${z}) yaw ${yaw.toFixed(1)}: the camera is in a roof`);
          }
          assert.ok(p.y >= floorY(plaza, p.x, p.z) + 0.6, 'above the floor');
          assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
          const d = Math.hypot(p.x - c.st.tx, p.y - c.st.ty, p.z - c.st.tz);
          if (d < 4.5) close++;
        }
      }
    }
  }
  // Most of the plaza is open: the camera keeps its distance almost everywhere.
  assert.ok(close / samples < 0.12, `too many cramped views: ${((close / samples) * 100).toFixed(1)}%`);
});

test('the camera gets over a house wall behind you instead of sitting on your shoulder', () => {
  const plaza = PLAZAS[2];
  // The Palazzo's south wall: standing at the gate, looking north (the camera behind you is the wall).
  const c = settle(plaza, 0, 16, Math.PI);
  const d = Math.hypot(c.cam.position.x - c.st.tx, c.cam.position.y - c.st.ty, c.cam.position.z - c.st.tz);
  assert.ok(d > 4, `a usable view at the wall (${d.toFixed(1)} m)`);
});

// ---- the camera against everything solid: the stage, the walls, the roofs, the pillars, the houses

import { solidsFor, rayClear, cameraBlocked } from '../src/render/camera.js';
import { makePath, pathAt, walkPath } from '../src/sim/nav.js';

const piazza = PLAZAS[0];

test('the stage and the houses keep the camera off you instead of hiding you behind them', () => {
  // You stand east of the stage with the camera swung round to its far side: it must come in front of the stage's backdrop (or over it),
  // not sit behind it looking at its back.
  const c = settle(piazza, -23.5, 0, (3 * Math.PI) / 2);
  const p = c.cam.position;
  assert.ok(p.x > -29.7 || p.y > 7, `the camera is behind the stage's backdrop at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  assert.ok(!cameraBlocked(piazza, p.x, p.y, p.z));
  // Against the north houses, looking south at them: the camera is not in the houses.
  const n = settle(piazza, -12, -20, Math.PI);
  assert.ok(n.cam.position.z > piazza.bounds.z0, 'the camera is inside the houses');
  // The Quay's lagoon side has no houses: the camera may go out over the water there, but never through the houses on the other three.
  const quay = PLAZAS[1];
  const q = settle(quay, 0, 19, 0);
  assert.ok(q.cam.position.z > 19, 'the camera swings out over the water');
  const w = settle(quay, -34.5, 0, (3 * Math.PI) / 2);
  assert.ok(w.cam.position.x > quay.bounds.x0, 'the camera is in the houses');
});

test('the title looks at the statue on the fountain and the finale at the sky over the plaza: the camera keeps its distance', () => {
  // The title's camera is aimed at the middle of the fountain, inside the statue's own pedestal: it doesn't stand between you and the view.
  const c = createCamera();
  c.snap(-6, 0.5, 0);
  c.st.pitch = 0.1;
  c.st.dist = 10.5;
  for (let i = 0; i < 40; i++) c.update(0.05, -6, 0.5, 0, piazza, { now: i });
  assert.ok(c.st.reach > 0.95, `the title's view comes in to ${(c.st.reach * 10.5).toFixed(1)} m`);
  // After the last result the camera lifts its eyes to the fireworks, far back and low (21 m, in the plaza's own bounds).
  for (const plaza of PLAZAS) {
    const b = plaza.bounds;
    const f = createCamera();
    const x = (b.x0 + b.x1) / 2;
    const z = (b.z0 + b.z1) / 2;
    f.snap(x, 5, z);
    f.st.pitch = 0.2;
    f.st.dist = 21;
    for (let i = 0; i < 60; i++) {
      f.st.yaw += 0.05;
      f.update(0.05, x, 5, z, plaza, { now: i });
      const p = f.cam.position;
      assert.ok(!cameraBlocked(plaza, p.x, p.y, p.z), `${plaza.id}: the finale's camera is inside something at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    assert.ok(f.st.reach > 0.5, `${plaza.id}: the finale's view comes in to ${(f.st.reach * 21).toFixed(1)} m`);
  }
});

test('what hides you pulls the camera in: a ray from you to a spot behind the stage stops at it', () => {
  // from east of the stage to a point beyond its backdrop at head height
  const u = rayClear(piazza, -23.5, 1.4, 0, -33, 3, 0);
  assert.ok(u < 0.75, `the backdrop stops the camera at ${(u * 100).toFixed(0)}% of the way`);
  // and over the top of it, high enough, nothing does
  assert.equal(rayClear(piazza, -23.5, 1.4, 0, -28, 14, 0), 1);
  assert.ok(solidsFor(piazza).boxes.length > 8, 'the camera knows the stage, the roofs and the stalls');
});

test('the camera never rests inside anything, whatever you and the player do to it (fuzz)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const plaza of PLAZAS) {
    const nav = navFor(plaza);
    const b = plaza.bounds;
    const c = createCamera();
    let x = 0;
    let z = 0;
    for (let i = 0; i < 6000; i++) {
      if (i % 300 === 0) {
        const sx = b.x0 + 1 + rnd() * (b.x1 - b.x0 - 2);
        const sz = b.z0 + 1 + rnd() * (b.z1 - b.z0 - 2);
        if (nav.clear(sx, sz) < 0.4) continue;
        x = sx;
        z = sz;
        c.snap(x, floorY(plaza, x, z), z);
        c.st.yaw = rnd() * 6.28;
        c.st.pitch = 0.12 + rnd() * 1.1;
        c.st.dist = 3.2 + rnd() * 13.8;
      }
      const nx = x + (rnd() - 0.5) * 0.12;
      const nz = z + (rnd() - 0.5) * 0.12;
      if (nav.clear(nx, nz) >= 0.4) {
        x = nx;
        z = nz;
      }
      c.orbit((rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.02, i / 60);
      c.st.shake = 0;
      c.update(rnd() < 0.03 ? 0.25 : 1 / 60, x, floorY(plaza, x, z), z, plaza, { heading: rnd() * 6.28, moving: rnd() < 0.5, now: i / 60 });
      const p = c.cam.position;
      assert.ok(Number.isFinite(p.x + p.y + p.z), `${plaza.id}: the camera went to ${p.x}, ${p.y}, ${p.z}`);
      assert.ok(!cameraBlocked(plaza, p.x, p.y, p.z), `${plaza.id}: the camera rests inside something at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}), you at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
});

test('walking along the walls, the camera eases in and round: it never jumps, and never rests inside anything', () => {
  const TOURS = {
    piazza: [[-29.3, -20.3], [-24, -7.5], [-24, 7.5], [-29.3, 20.3], [14, 20.3], [29.3, 20.3], [24.5, 12], [24.5, -12], [29.3, -20.3], [-12, -16], [-29.3, -20.3]],
    quay: [[-35.3, -17.3], [14, -16.8], [35.3, -17.3], [35.3, 2], [20, 2.5], [0, 14], [-8, 8.5], [-5, -5], [-27, -2], [-35.3, 0], [-35.3, -17.3]],
    palazzo: [[-21.4, -21.3], [21.4, -21.3], [21.4, -13], [18, -10], [18, 17.3], [-18, 17.4], [-18, -10], [-21.4, -13], [0, -8], [0, 8.8], [-12, 14], [-15, -15]],
  };
  const DT = 1 / 60;
  for (const plaza of PLAZAS) {
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
    let prev = null;
    let frames = 0;
    let biggest = 0;
    for (let s = 0, now = 0; s < path.len; s += 4.5 * DT, now += DT, frames++) {
      pathAt(path, s, P);
      // now and then the player drags the view round by hand, into the walls
      if (frames % 600 > 300 && frames % 600 < 420) c.orbit(0.9 * DT, 0, now);
      c.update(DT, P.x, floorY(plaza, P.x, P.z), P.z, plaza, { heading: Math.atan2(P.tx, P.tz), moving: true, now });
      const p = c.cam.position;
      const st = c.st;
      assert.ok(!cameraBlocked(plaza, p.x, p.y, p.z), `${plaza.id}: inside something at ${P.x.toFixed(1)}, ${P.z.toFixed(1)}`);
      // How far the camera is from the pose it would have with nothing in the way, and how fast that changes: the pull-in.
      const k = Math.cos(st.pitch) * st.dist;
      const dev = [p.x - (st.tx + Math.sin(st.yaw) * k), p.y - (st.ty + Math.sin(st.pitch) * st.dist), p.z - (st.tz + Math.cos(st.yaw) * k)];
      if (prev && frames > 5) biggest = Math.max(biggest, Math.hypot(dev[0] - prev[0], dev[1] - prev[1], dev[2] - prev[2]));
      prev = dev;
    }
    // (Squeezing along an alley between a house front and the customs house may cost a few metres in one frame; the camera that
    // came before this one jumped 9 to 18 m, across the plaza, and into the houses.)
    assert.ok(biggest < 5.5, `${plaza.id}: the camera jumped ${biggest.toFixed(1)} m in a frame`);
  }
});

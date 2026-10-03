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

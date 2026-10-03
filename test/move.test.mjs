import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMover, stepMover } from '../src/sim/move.js';
import { createCrowd } from '../src/sim/crowd.js';
import { PLAZAS } from '../src/sim/plazas.js';
import { navFor, walkPath } from '../src/sim/nav.js';
import { FIGURE_R } from '../src/sim/const.js';
import { rng } from '../src/sim/rng.js';

test('a figure steered at random, at a sprint, into every wall and the water never leaves the plaza or sinks into anything', () => {
  for (const plaza of PLAZAS) {
    const nav = navFor(plaza);
    const crowd = createCrowd(plaza, 777, 9);
    const R = rng(4242 + plaza.id.length);
    const b = plaza.bounds;
    const mv = makeMover(plaza.anchors[0][0], plaza.anchors[0][1], 0);
    const ctx = { plaza, slot: null, canLock: false, crowd: crowd.eval(60), count: crowd.count, skip: null, others: null, sprintOk: true };
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < 12000; i++) {
      if (i % 40 === 0) {
        // A new heading now and then (sometimes straight at the nearest edge), sometimes standing still.
        const a = R.range(0, Math.PI * 2);
        const still = R.chance(0.1);
        dx = still ? 0 : Math.sin(a);
        dz = still ? 0 : Math.cos(a);
      }
      stepMover(mv, { dx, dz, sprint: R.chance(0.5), steer: dx !== 0 || dz !== 0 }, 1 / 60, ctx);
      assert.ok(Number.isFinite(mv.x) && Number.isFinite(mv.z) && Number.isFinite(mv.h), `${plaza.id}: finite at step ${i}`);
      assert.ok(mv.x > b.x0 - 0.5 && mv.x < b.x1 + 0.5 && mv.z > b.z0 - 0.5 && mv.z < b.z1 + 0.5, `${plaza.id}: inside the plaza at step ${i} (${mv.x.toFixed(1)}, ${mv.z.toFixed(1)})`);
      assert.ok(nav.clear(mv.x, mv.z) >= FIGURE_R - 0.08, `${plaza.id}: not inside something at step ${i} (${mv.x.toFixed(1)}, ${mv.z.toFixed(1)})`);
    }
  }
});

test('a walk to anywhere ends on solid ground or nowhere', () => {
  for (const plaza of PLAZAS) {
    const nav = navFor(plaza);
    const R = rng(99);
    const b = plaza.bounds;
    const from = plaza.anchors[0];
    for (let i = 0; i < 200; i++) {
      const tx = R.range(b.x0 - 5, b.x1 + 5);
      const tz = R.range(b.z0 - 5, b.z1 + 5);
      const path = walkPath(plaza, from[0], from[1], tx, tz);
      if (!path) continue;
      const end = path[path.length - 1];
      assert.ok(nav.clear(end[0], end[1]) >= 0, `${plaza.id}: a path to (${tx.toFixed(1)}, ${tz.toFixed(1)}) ends at (${end[0].toFixed(1)}, ${end[1].toFixed(1)}) in something`);
      for (const p of path) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
    }
  }
});

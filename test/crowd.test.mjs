import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAZAS, districtAt, floorY } from '../src/sim/plazas.js';
import { navFor, lineOfSight, walkPath, straightClear } from '../src/sim/nav.js';
import { buildScripts, memberAt } from '../src/sim/choreo.js';
import { createCrowd, STRIDE } from '../src/sim/crowd.js';
import { FIGURE_R, SCRIPT_S } from '../src/sim/const.js';
import { rng } from '../src/sim/rng.js';

const SIZES = [6, 9, 12];

test('every anchor has room for a troupe and every loop exists', () => {
  for (const plaza of PLAZAS) {
    const nav = navFor(plaza);
    plaza.anchors.forEach(([x, z], i) => assert.ok(nav.clear(x, z) >= 3.5, `${plaza.id} anchor ${i} is cramped`));
    const set = buildScripts(plaza, 1, 9);
    assert.equal(set.scripts.length, 8);
    for (const s of set.scripts) assert.notEqual(s.loop, -1, `${plaza.id}: a troupe fell back to standing still`);
  }
});

test('a thousand seeds: no reveller ever stands inside a wall, a pillar or the water', () => {
  for (const plaza of PLAZAS) {
    const nav = navFor(plaza);
    const out = {};
    for (let seed = 0; seed < 1000; seed++) {
      const n = SIZES[seed % 3];
      const set = buildScripts(plaza, seed * 2654435761, n);
      const R = rng(seed);
      for (let k = 0; k < 6; k++) {
        const t = R.range(0, SCRIPT_S);
        for (let tr = 0; tr < 8; tr++) {
          for (let i = 0; i < n; i++) {
            memberAt(set, tr, i, t, out);
            assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z), `${plaza.id} seed ${seed}: NaN position`);
            const c = nav.clear(out.x, out.z);
            assert.ok(c >= FIGURE_R, `${plaza.id} seed ${seed} troupe ${tr} member ${i} at t=${t.toFixed(2)} is inside something (${c.toFixed(2)})`);
          }
        }
      }
    }
  }
});

test('the crowd after separation is still clear of everything (the ghost slot never sits in a wall)', () => {
  for (const plaza of PLAZAS) {
    const nav = navFor(plaza);
    for (let seed = 0; seed < 300; seed++) {
      const n = SIZES[seed % 3];
      const crowd = createCrowd(plaza, seed * 40503 + 7, n);
      const R = rng(seed + 99);
      for (let k = 0; k < 3; k++) {
        const t = R.range(0, 400);
        const buf = crowd.eval(t, k === 2 ? t - 1 : Infinity);
        for (let s = 0; s < crowd.count; s++) {
          const c = nav.clear(buf[s * STRIDE], buf[s * STRIDE + 1]);
          assert.ok(c >= FIGURE_R - 1e-6, `${plaza.id} seed ${seed} slot ${s} inside something`);
          assert.ok(Number.isFinite(buf[s * STRIDE + 3]), 'heading is a number');
        }
      }
    }
  }
});

test('scripts are deterministic and loop seamlessly every two minutes', () => {
  for (const plaza of PLAZAS) {
    const a = buildScripts(plaza, 424242, 9);
    const b = buildScripts(plaza, 424242, 9);
    const pa = {};
    const pb = {};
    for (let tr = 0; tr < 8; tr++) {
      for (let i = 0; i < 9; i++) {
        for (const t of [0, 13.7, 59.99, 119.95, 250.5]) {
          memberAt(a, tr, i, t, pa);
          memberAt(b, tr, i, t, pb);
          assert.equal(pa.x, pb.x);
          assert.equal(pa.z, pb.z);
        }
        // Continuity everywhere, including across the loop point.
        let px = null;
        let pz = null;
        for (let t = 0; t <= SCRIPT_S + 0.5; t += 0.05) {
          memberAt(a, tr, i, t, pa);
          if (px !== null) {
            const sp = Math.sqrt((pa.x - px) ** 2 + (pa.z - pz) ** 2) / 0.05;
            assert.ok(sp < 3.2, `${plaza.id} troupe ${tr} member ${i} moves at ${sp.toFixed(2)} m/s at t=${t.toFixed(2)}`);
          }
          px = pa.x;
          pz = pa.z;
        }
      }
    }
  }
});

test('different seeds give different choreography', () => {
  const plaza = PLAZAS[0];
  const a = buildScripts(plaza, 1, 9);
  const b = buildScripts(plaza, 2, 9);
  const pa = {};
  const pb = {};
  let differ = 0;
  for (let tr = 0; tr < 8; tr++) {
    memberAt(a, tr, 0, 30, pa);
    memberAt(b, tr, 0, 30, pb);
    if (Math.abs(pa.x - pb.x) + Math.abs(pa.z - pb.z) > 0.5) differ++;
  }
  assert.ok(differ >= 5);
});

test('the crowd freezes in the Hush', () => {
  const crowd = createCrowd(PLAZAS[1], 77, 9);
  const a = Float32Array.from(crowd.eval(101, 100));
  const b = Float32Array.from(crowd.eval(110, 100));
  for (let s = 0; s < crowd.count; s++) {
    assert.ok(Math.abs(a[s * STRIDE] - b[s * STRIDE]) < 1e-4, 'frozen x');
    assert.equal(b[s * STRIDE + 6], 0, 'no speed');
  }
});

test('districts, floors, sight and walking', () => {
  const [piazza, quay, palazzo] = PLAZAS;
  assert.equal(piazza.districts[districtAt(piazza, -6, 1)].id, 'fountain');
  assert.equal(quay.districts[districtAt(quay, 0, 16)].id, 'pier');
  assert.equal(palazzo.districts[districtAt(palazzo, 0, -18)].id, 'terrace');
  assert.equal(floorY(palazzo, 0, -18), 2.4);
  assert.ok(floorY(palazzo, 0, -9) > 0 && floorY(palazzo, 0, -9) < 2.4);
  assert.ok(floorY(piazza, 17, -10) > 0.6);
  assert.equal(lineOfSight(piazza, -6, -6, -6, 6), false, 'the statue blocks the view across the fountain');
  assert.equal(lineOfSight(piazza, -20, -8, -20, 8), true);
  // Walking around the fountain ends at the spot asked for; into the canal ends on the nearest bank.
  const p = walkPath(piazza, -6, -6, -6, 6);
  assert.ok(p.length > 2);
  const nav = navFor(piazza);
  for (let i = 1; i < p.length; i++) assert.ok(straightClear(nav, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], 0.4));
  const wet = walkPath(piazza, 8, 0, 17, 0);
  const end = wet[wet.length - 1];
  assert.ok(nav.clear(end[0], end[1]) >= 0.4, 'a walk into the water stops on the bank');
});

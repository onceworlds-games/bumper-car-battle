// The whole crowd at a moment: every slot of every troupe, with facing, emote and speed, the Hush freeze and a
// separation pass so revellers never stand inside one another. Deterministic: the same numbers on every page.
import { buildScripts, memberAt, EM } from './choreo.js';
import { navFor, settle } from './nav.js';
import { floorY } from './plazas.js';
import { SEPARATION, FIGURE_R, TROUPES } from './const.js';
import { lerpAngle, smooth } from './geom.js';
import { unit } from './rng.js';

export const STRIDE = 7; // x, z, y, h, em, et, speed
export const F = { x: 0, z: 1, y: 2, h: 3, em: 4, et: 5, sp: 6 };
const DT = 0.1;

/** Seconds the crowd takes to come to a stop when the Hush falls; then it stands still. */
function hushTime(t, hushAt) {
  if (!(t > hushAt)) return t;
  const x = t - hushAt;
  return hushAt + (x < 0.6 ? x - (x * x) / 1.2 : 0.3);
}

export function createCrowd(plaza, seed, n) {
  navFor(plaza);
  const set = buildScripts(plaza, seed, n);
  const count = TROUPES.length * n;
  const buf = new Float32Array(count * STRIDE);
  const look = new Float32Array(count);
  for (let s = 0; s < count; s++) look[s] = 0.2 + 0.7 * unit('look', seed, s);
  const A = { x: 0, z: 0, face: 0, restH: 0, em: 0, et: 0 };
  const B = { x: 0, z: 0, face: 0, restH: 0, em: 0, et: 0 };
  const P = { x: 0, z: 0 };
  const crowd = {
    plaza,
    seed,
    n,
    count,
    set,
    buf,
    troupeOf: (slot) => Math.floor(slot / n),
    memberOf: (slot) => slot % n,
    slot: (tr, i) => tr * n + i,
    /**
     * Fills `out` (default: the crowd's own buffer) with every slot at round time t (seconds). `hushAt` (seconds or
     * Infinity) is when the Hush falls: from then the crowd stops where it stands and looks up.
     */
    eval(t, hushAt = Infinity, out = buf) {
      const te = hushTime(t, hushAt);
      for (let s = 0; s < count; s++) {
        const tr = (s / n) | 0;
        const i = s - tr * n;
        memberAt(set, tr, i, te, A);
        memberAt(set, tr, i, te - DT, B);
        const dx = A.x - B.x;
        const dz = A.z - B.z;
        const sp = te === t || t - hushAt < 0.6 ? Math.sqrt(dx * dx + dz * dz) / DT : 0;
        let h = A.face;
        if (h !== h) {
          // NaN: face where you walk, easing from the rest facing as you get going.
          const mv = Math.atan2(dx, dz);
          h = lerpAngle(A.restH, mv, smooth(sp / 0.6));
        }
        const o = s * STRIDE;
        out[o] = A.x;
        out[o + 1] = A.z;
        out[o + 3] = h;
        out[o + 4] = A.em;
        out[o + 5] = A.et;
        out[o + 6] = sp;
        if (t > hushAt + look[s]) {
          out[o + 4] = EM.lookup;
          out[o + 5] = t - hushAt - look[s];
        }
      }
      separate(out, count);
      for (let s = 0; s < count; s++) {
        const o = s * STRIDE;
        out[o + 2] = floorY(plaza, out[o], out[o + 1]);
      }
      return out;
    },
  };

  /** Pushes overlapping revellers apart (one pass, fixed order) and back out of anything solid. */
  function separate(out, cnt) {
    const nav = navFor(plaza);
    for (let a = 0; a < cnt; a++) {
      const oa = a * STRIDE;
      for (let b = a + 1; b < cnt; b++) {
        const ob = b * STRIDE;
        const dx = out[ob] - out[oa];
        if (dx > SEPARATION || dx < -SEPARATION) continue;
        const dz = out[ob + 1] - out[oa + 1];
        if (dz > SEPARATION || dz < -SEPARATION) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= SEPARATION * SEPARATION) continue;
        let d = Math.sqrt(d2);
        let nx;
        let nz;
        if (d < 1e-4) {
          // Exactly on top of each other: part along a direction fixed by the pair.
          const ang = ((a * 7 + b * 13) % 16) * (Math.PI / 8);
          nx = Math.sin(ang);
          nz = Math.cos(ang);
          d = 0;
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        const push = (SEPARATION - d) * 0.42;
        out[oa] -= nx * push;
        out[oa + 1] -= nz * push;
        out[ob] += nx * push;
        out[ob + 1] += nz * push;
      }
    }
    for (let s = 0; s < cnt; s++) {
      const o = s * STRIDE;
      if (nav.clear(out[o], out[o + 1]) < FIGURE_R) {
        settle(plaza, out[o], out[o + 1], FIGURE_R, P);
        out[o] = P.x;
        out[o + 1] = P.z;
      }
    }
  }

  return crowd;
}

/** Crowd sizes by the lobby setting. */
export const crowdSize = (setting) => ({ light: 6, normal: 9, packed: 12 })[setting] ?? 9;

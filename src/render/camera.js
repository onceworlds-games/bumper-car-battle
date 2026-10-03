// The chase camera: behind and above you, orbit by drag or keys, zoom by wheel or pinch, pulled in by walls and
// pillars, wider in portrait, and the opera glass's 3x zoom. Figures between it and you fade (see view.js).
import * as THREE from 'three';
import { navFor } from '../sim/nav.js';
import { floorY } from '../sim/plazas.js';

const MIN_D = 3.2;
const MAX_D = 17;
const ROOF_CLEAR = 1.6; // the camera stays this far above a roof, or out of the way
const MIN_REACH = 0.34; // never closer than this share of the distance unless something is right there
const LIFTS = [0.2, 0.42, 0.75]; // higher views to try when the way behind you is shut
const TURNS = [0.5, -0.5, 1.0, -1.0, 1.6, -1.6]; // and angles to swing round to

/** How far along the line from (ax, ay, az) to (px, py, pz) the camera can go, 0..1, before it meets something. */
function rayClear(plaza, nav, ax, ay, az, px, py, pz) {
  const b = plaza.bounds;
  const steps = 14;
  const len = Math.hypot(px - ax, py - ay, pz - az);
  let last = 0;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const sx = ax + (px - ax) * u;
    const sz = az + (pz - az) * u;
    const sy = ay + (py - ay) * u;
    // Beyond the plaza are the houses: not below their roofs.
    if (!(sx > b.x0 - 1.5 && sx < b.x1 + 1.5 && sz > b.z0 - 1.5 && sz < b.z1 + 1.5) && sy < 16) break;
    let hit = false;
    // Arcade roofs and the like: never above them looking down at the tiles, never inside the beams.
    if (plaza.roofs) {
      for (const rf of plaza.roofs) {
        if (sy < (rf.lo ?? rf.h - 1.2) || sy > rf.h + ROOF_CLEAR) continue;
        if (sx > rf.x0 - 0.5 && sx < rf.x1 + 0.5 && sz > rf.z0 - 0.5 && sz < rf.z1 + 0.5) {
          hit = true;
          break;
        }
      }
    }
    if (!hit) {
      for (const o of nav.occluders) {
        if (o.h + ROOF_CLEAR < sy) continue;
        // Right at the start of the line, what you stand against doesn't count (you can't be inside it).
        if (u * len < 1.4) {
          const near = o.t === 'c' ? Math.hypot(ax - o.x, az - o.z) - o.r : Math.max(Math.abs(ax - o.x) - o.w / 2, Math.abs(az - o.z) - o.d / 2);
          if (near < 1.2) continue;
        }
        const d = o.t === 'c' ? Math.hypot(sx - o.x, sz - o.z) - o.r : Math.max(Math.abs(sx - o.x) - o.w / 2, Math.abs(sz - o.z) - o.d / 2);
        if (d < 0.4) {
          hit = true;
          break;
        }
      }
    }
    if (hit) break;
    last = u;
  }
  return last;
}

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(52, 1, 0.1, 900);
  const st = {
    yaw: 0.6,
    pitch: 0.46,
    dist: 10,
    tx: 0,
    ty: 1.4,
    tz: 0,
    opera: 0,
    shake: 0,
    manualAt: -99,
    look: { yaw: 0, pitch: 0 },
    reach: 1,
    lift: 0,
    turn: 0,
    // What you chose with the wheel and the drag: the title's drifting view and the spectators' don't overwrite it.
    mine: { pitch: 0.46, dist: 10 },
  };
  const out = new THREE.Vector3();
  const api = {
    cam,
    st,
    /** The way the camera really looks (the yaw you steer by): the orbit plus any swing round an obstacle. */
    heading() {
      return st.yaw + st.turn;
    },
    aspect(w, h) {
      cam.aspect = w / h;
      api.fov();
    },
    fov() {
      // Keep at least ~68 degrees across in portrait, so a phone held upright still sees the crowd.
      const a = cam.aspect;
      let v = 52;
      if (a < 1.25) v = (2 * Math.atan(Math.tan((68 * Math.PI) / 360) / a) * 180) / Math.PI;
      v = Math.min(88, v);
      cam.fov = v / (1 + st.opera * 2);
      cam.updateProjectionMatrix();
    },
    orbit(dyaw, dpitch, now) {
      st.yaw += dyaw;
      st.pitch = Math.max(0.12, Math.min(1.25, st.pitch + dpitch));
      st.manualAt = now;
      st.mine.pitch = st.pitch;
    },
    zoom(f) {
      st.dist = Math.max(MIN_D, Math.min(MAX_D, st.dist * f));
      st.mine.dist = st.dist;
    },
    /** Puts the camera behind a heading straight away (a new round, back from the Powder Room). */
    snap(x, y, z, heading) {
      st.tx = x;
      st.ty = y + 1.4;
      st.tz = z;
      st.reach = 1;
      st.lift = 0;
      st.turn = 0;
      st.pitch = st.mine.pitch;
      st.dist = st.mine.dist;
      if (heading !== undefined) st.yaw = heading + Math.PI;
    },
    /**
     * Follows (x, y, z). `moving` with `heading`: when you walk and haven't orbited lately, the camera swings
     * gently round behind you.
     */
    update(dt, x, y, z, plaza, { heading = null, moving = false, now = 0, reduced = false } = {}) {
      const k = 1 - Math.exp(-dt * 9);
      st.tx += (x - st.tx) * k;
      st.ty += (y + 1.4 - st.ty) * k;
      st.tz += (z - st.tz) * k;
      if (moving && heading !== null && now - st.manualAt > 2.2 && st.opera < 0.05) {
        const want = heading + Math.PI;
        let d = want - st.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        // Only swing when walking away from the camera-ish: walking toward it shouldn't spin the view.
        if (Math.abs(d) < 2.2) st.yaw += d * Math.min(1, dt * 0.9);
      }
      const opera = st.opera;
      const dist = st.dist * (1 - opera * 0.15);
      let px;
      let py;
      let pz;
      // The camera sits behind and above you. A wall, a column or a roof in the way brings it in, or lifts it over
      // (a higher view of the same spot) rather than letting it crowd your shoulder.
      const at = (pitch, d, turn = 0) => {
        const c = Math.cos(pitch);
        px = st.tx + Math.sin(st.yaw + turn) * c * d;
        pz = st.tz + Math.cos(st.yaw + turn) * c * d;
        py = st.ty + Math.sin(pitch) * d;
      };
      if (plaza) {
        const nav = navFor(plaza);
        const reach = (pitch, turn) => {
          at(pitch, dist, turn);
          return rayClear(plaza, nav, st.tx, st.ty, st.tz, px, py, pz);
        };
        let want = reach(st.pitch, 0);
        let lift = 0;
        let turn = 0;
        if (want < 1) {
          let best = want;
          const tryIt = (l, tn) => {
            const u = reach(Math.min(1.45, st.pitch + l), tn);
            if (u > best + 1e-6) {
              best = u;
              lift = l;
              turn = tn;
            }
            return u >= 1;
          };
          let done = false;
          for (const l of LIFTS) if (!done) done = tryIt(l, 0);
          // Still shut (a column right behind you): swing round it.
          if (!done && best < 0.6) for (const tn of TURNS) for (const l of [0, ...LIFTS.slice(0, 2)]) if (!done) done = tryIt(l, tn);
          want = Math.max(MIN_REACH * 0.3, best);
        }
        // Worse is at once, better is slow: no flicker in a doorway.
        const rec = 1 - Math.exp(-dt * 2.2);
        st.reach = want < st.reach ? want : st.reach + (want - st.reach) * rec;
        st.lift = lift > st.lift ? lift : st.lift + (lift - st.lift) * rec;
        st.turn = Math.abs(turn) > Math.abs(st.turn) ? turn : st.turn + (turn - st.turn) * rec;
        const pitch = Math.min(1.45, st.pitch + st.lift);
        at(pitch, dist * st.reach, st.turn);
        // The eased pose must be clear too (the slow recovery could swing it into something).
        const u = rayClear(plaza, nav, st.tx, st.ty, st.tz, px, py, pz);
        if (u < 1) {
          st.reach = Math.max(0.1, st.reach * u);
          at(pitch, dist * st.reach, st.turn);
        }
        py = Math.max(py, floorY(plaza, px, pz) + 0.7);
      } else at(st.pitch, dist);
      if (st.shake > 0 && !reduced) {
        const s = st.shake * 0.12;
        px += (Math.random() - 0.5) * s;
        py += (Math.random() - 0.5) * s;
        pz += (Math.random() - 0.5) * s;
      }
      st.shake = Math.max(0, st.shake - dt * 2.5);
      cam.position.set(px, py, pz);
      // With the opera glass up, look further ahead along the view.
      const ahead = opera * 14;
      out.set(st.tx - Math.sin(st.yaw) * ahead, st.ty + opera * 0.4, st.tz - Math.cos(st.yaw) * ahead);
      cam.lookAt(out);
      api.fov();
    },
  };
  return api;
}

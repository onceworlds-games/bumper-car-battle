// The chase camera: behind and above you, orbit by drag or keys, zoom by wheel or pinch, kept out of the walls, the stage, the
// roofs and the houses (it eases in, up or round rather than sit behind them and hide you; pillars it slides past), wider in
// portrait, and the opera glass's 3x zoom. Figures between it and you fade (see view.js).
import * as THREE from 'three';
import { floorY } from '../sim/plazas.js';

const MIN_D = 3.2;
const MAX_D = 17;
const ROOF_CLEAR = 1.6; // the camera stays this far above a roof, or out of the way
const MIN_REACH = 0.34; // never closer than this share of the distance unless something is right there
const LIFTS = [0.2, 0.42, 0.75]; // higher views to try when the way behind you is shut
const TURNS = [0.5, -0.5, 1.0, -1.0, 1.6, -1.6]; // and angles to swing round to
const TURN_LIFTS = [0, 0.2, 0.42]; // with how much of a lift, when it has to
const SKIN = 0.3; // how near to a wall, a pillar or the floor the camera may come (a figure's own clearance is 0.34)
const FLOOR = 0.7; // the camera stays this far above the floor (the terrace, the stairs and a bridge's hump rise under it)
const ROOFLINE = 18.5; // the houses round a plaza stop below this: only above it may the camera leave the plaza
const LOOK = 0.15; // seconds ahead the camera looks for what is coming (you walking on, the view swinging round)
const THIN = 1.2; // a pillar or post this narrow doesn't pull the camera in (it slides round it): a column hides a sliver, a jump hides you

/**
 * What the camera keeps out of, from the plaza's data (built once): boxes and upright cylinders with their heights.
 * Every pillar, column, statue, kiosk, stall and house front that blocks sight; whatever else stands tall and wide enough
 * to hide you or to be inside of (the stage, the fountain, the bandstand, the well); the roofs and the walls the rules don't
 * see (`plaza.roofs`, `plaza.walls`). The ground is `floorY`, the edge of the plaza is its houses (`xMin`..`zMax`: its bounds
 * less a skin, open to the water where `plaza.open` says there are no houses).
 */
const solidCache = new Map();
export function solidsFor(plaza) {
  let s = solidCache.get(plaza.id);
  if (s) return s;
  const b = plaza.bounds;
  const open = plaza.open ?? [];
  s = {
    boxes: [],
    cyls: [],
    xMin: open.includes('x0') ? -Infinity : b.x0 + SKIN,
    xMax: open.includes('x1') ? Infinity : b.x1 - SKIN,
    zMin: open.includes('z0') ? -Infinity : b.z0 + SKIN,
    zMax: open.includes('z1') ? Infinity : b.z1 - SKIN,
  };
  // `soft`: dressing the camera may look through (an awning) but never sit inside of; it holds it back only when the camera would be in it.
  const box = (cx, cz, hx, hz, y0, y1, pad, rot = 0, soft = false) => s.boxes.push({ cx, cz, hx, hz, c: Math.cos(-rot), s: Math.sin(-rot), y0, y1, pad, thin: soft || Math.max(hx, hz) * 2 < THIN });
  for (const o of plaza.obstacles) {
    // Sight-blocking things are solid to the camera up to a little above their tops; the rest only when they are big enough to
    // matter (lamps, mooring posts and the balustrades you see through are left to the camera to pass).
    const big = o.h >= 0.8 && (o.t === 'c' ? o.r >= 0.5 : o.w * o.d >= 1.5);
    if (!o.occ && !big) continue;
    const base = floorY(plaza, o.x, o.z); // columns on the terrace stand on it
    const top = base + (o.camH ?? o.h) + (o.occ ? ROOF_CLEAR : 0); // (an open pavilion's camH is its platform: its roof is in `roofs`)
    if (o.t === 'c') s.cyls.push({ x: o.x, z: o.z, r: o.r, y0: base - 2, y1: top, pad: SKIN, thin: o.r * 2 < THIN });
    else box(o.x, o.z, o.w / 2, o.d / 2, base - 2, top, SKIN, o.rot || 0);
    // A stall's or a kiosk's awning overhangs it.
    if (o.kind === 'stall' || o.kind === 'kiosk') box(o.x + (o.kind === 'stall' ? 0.3 : 0), o.z, o.w / 2 + 0.6, o.d / 2 + 0.5, base + 1.9, base + 3.1, SKIN, 0, true);
  }
  // Arcade roofs and the like: never above them looking down at the tiles, never inside the beams.
  for (const rf of plaza.roofs ?? []) box((rf.x0 + rf.x1) / 2, (rf.z0 + rf.z1) / 2, (rf.x1 - rf.x0) / 2, (rf.z1 - rf.z0) / 2, rf.lo ?? rf.h - 1.2, rf.h + ROOF_CLEAR, 0.5);
  for (const w of plaza.walls ?? []) box((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2, (w.x1 - w.x0) / 2, (w.z1 - w.z0) / 2, w.y0, w.y1, SKIN);
  solidCache.set(plaza.id, s);
  return s;
}

// The part of the segment a + t * d, t in 0..1, that is inside every slab so far: [_t0, _t1].
let _t0 = 0;
let _t1 = 1;
/** Clips it to where p + t * d lies between lo and hi; false when nothing is left. */
function slab(p, d, lo, hi) {
  if (Math.abs(d) < 1e-9) return p >= lo && p <= hi;
  let ta = (lo - p) / d;
  let tb = (hi - p) / d;
  if (ta > tb) {
    const t = ta;
    ta = tb;
    tb = t;
  }
  if (ta > _t0) _t0 = ta;
  if (tb < _t1) _t1 = tb;
  return _t0 <= _t1;
}

/** The fraction of the segment a -> a + d before it enters a box grown by its pad plus `grow` (0 when it starts inside), or 2. */
function enterBox(bx, ax, ay, az, dx, dy, dz, grow) {
  const pad = bx.pad + grow;
  _t0 = 0;
  _t1 = 1;
  const lax = (ax - bx.cx) * bx.c - (az - bx.cz) * bx.s;
  const laz = (ax - bx.cx) * bx.s + (az - bx.cz) * bx.c;
  const hx = bx.hx + pad;
  const hz = bx.hz + pad;
  if (!slab(lax, dx * bx.c - dz * bx.s, -hx, hx) || !slab(laz, dx * bx.s + dz * bx.c, -hz, hz) || !slab(ay, dy, bx.y0 - pad, bx.y1 + pad)) return 2;
  return _t0;
}

/** The same for an upright cylinder (a circle in the ground plane, a height range). */
function enterCyl(cy, ax, ay, az, dx, dy, dz, grow) {
  const pad = cy.pad + grow;
  const R = cy.r + pad;
  _t0 = 0;
  _t1 = 1;
  const fx = ax - cy.x;
  const fz = az - cy.z;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - R * R;
  if (a < 1e-12) {
    if (c > 0) return 2;
  } else {
    const bq = fx * dx + fz * dz;
    const disc = bq * bq - a * c;
    if (disc < 0) return 2;
    const q = Math.sqrt(disc);
    _t0 = Math.max(0, (-bq - q) / a);
    _t1 = Math.min(1, (-bq + q) / a);
    if (_t0 > _t1) return 2;
  }
  return slab(ay, dy, cy.y0 - pad, cy.y1 + pad) ? _t0 : 2;
}

/** The fraction of a segment's way (from coordinate a, by d) to where it leaves lo..hi below the houses' roofline (the height there: ay + dy * t), or 2. */
function leave(a, d, lo, hi, ay, dy) {
  const t = d > 1e-9 ? (hi - a) / d : d < -1e-9 ? (lo - a) / d : 2;
  return t < 2 && ay + dy * t < ROOFLINE ? Math.max(0, t) : 2;
}

/**
 * How far along the line from (ax, ay, az) to (px, py, pz) the camera can go, 0..1, before something would stand between it
 * and you (or hold it): a wall or the stage, a roof, the floor, a house (the camera is a ball, not a point). Pillars and posts
 * are left out: the camera slides round those (see `pushOut`).
 */
export function rayClear(plaza, ax, ay, az, px, py, pz) {
  const dx = px - ax;
  const dy = py - ay;
  const dz = pz - az;
  const s = solidsFor(plaza);
  let hit = 1;
  // Something that already holds the start (the view eases after you round a corner) gives way at once: only its own body counts, and
  // one the start is in the middle of (the title looks at the statue on the fountain) doesn't stand between you and the camera.
  for (const bx of s.boxes) {
    if (bx.thin) continue;
    let t = enterBox(bx, ax, ay, az, dx, dy, dz, 0);
    if (t <= 0) t = enterBox(bx, ax, ay, az, dx, dy, dz, -bx.pad + 0.05);
    if (t > 0 && t < hit) hit = t;
  }
  for (const cy of s.cyls) {
    if (cy.thin) continue;
    let t = enterCyl(cy, ax, ay, az, dx, dy, dz, 0);
    if (t <= 0) t = enterCyl(cy, ax, ay, az, dx, dy, dz, -cy.pad + 0.05);
    if (t > 0 && t < hit) hit = t;
  }
  // The plaza ends at its houses: below their roofs the camera stays inside.
  hit = Math.min(hit, leave(ax, dx, s.xMin, s.xMax, ay, dy), leave(az, dz, s.zMin, s.zMax, ay, dy));
  // The floor, rising (the terrace, the stairs, a bridge's hump) as well as falling away.
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    if (u >= hit) break;
    if (ay + dy * u < floorY(plaza, ax + dx * u, az + dz * u) + FLOOR) {
      let lo = (i - 1) / steps;
      let hi = u;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        if (ay + dy * mid < floorY(plaza, ax + dx * mid, az + dz * mid) + FLOOR) hi = mid;
        else lo = mid;
      }
      hit = lo;
      break;
    }
  }
  return Math.max(0, hit);
}

/**
 * Moves a point (the camera) out of whatever it is inside of (or within its skin of) by the way that moves it least, round a
 * pillar, over a counter, off the floor, back inside the plaza's walls. `thinOnly`: just the pillars, posts and awnings (the
 * camera slides round those; a wall, the stage or a roof is passed by pulling the camera in toward you instead). Returns true if it moved.
 */
export function pushOut(plaza, p, thinOnly = false) {
  const s = solidsFor(plaza);
  const EPS = 0.002; // (a point exactly on the boundary counts as inside)
  let moved = false;
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (const cy of s.cyls) {
      if ((thinOnly && !cy.thin) || p.y < cy.y0 - cy.pad || p.y > cy.y1 + cy.pad) continue;
      const R = cy.r + cy.pad + EPS;
      const dx = p.x - cy.x;
      const dz = p.z - cy.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2);
      p.x = cy.x + (d > 1e-6 ? (dx * R) / d : R);
      p.z = cy.z + (d > 1e-6 ? (dz * R) / d : 0);
      any = true;
    }
    for (const bx of s.boxes) {
      if (thinOnly && !bx.thin) continue;
      const qx = p.x - bx.cx;
      const qz = p.z - bx.cz;
      const lx = qx * bx.c - qz * bx.s;
      const lz = qx * bx.s + qz * bx.c;
      const hx = bx.hx + bx.pad + EPS;
      const hz = bx.hz + bx.pad + EPS;
      const y0 = bx.y0 - bx.pad - EPS;
      const y1 = bx.y1 + bx.pad + EPS;
      if (Math.abs(lx) >= hx || Math.abs(lz) >= hz || p.y <= y0 || p.y >= y1) continue;
      const ex = hx - Math.abs(lx);
      const ez = hz - Math.abs(lz);
      const up = y1 - p.y;
      const down = p.y - y0;
      if (Math.min(up, down) <= ex && Math.min(up, down) <= ez) p.y = up < down ? y1 : y0;
      else {
        const nlx = ex <= ez ? (lx < 0 ? -hx : hx) : lx;
        const nlz = ex <= ez ? lz : lz < 0 ? -hz : hz;
        p.x = bx.cx + nlx * bx.c + nlz * bx.s;
        p.z = bx.cz - nlx * bx.s + nlz * bx.c;
      }
      any = true;
    }
    if (!thinOnly) {
      if (p.y < ROOFLINE) {
        const x = Math.min(s.xMax - EPS, Math.max(s.xMin + EPS, p.x));
        const z = Math.min(s.zMax - EPS, Math.max(s.zMin + EPS, p.z));
        if (x !== p.x || z !== p.z) {
          p.x = x;
          p.z = z;
          any = true;
        }
      }
      const f = floorY(plaza, p.x, p.z) + FLOOR + EPS;
      if (p.y < f) {
        p.y = f;
        any = true;
      }
    }
    if (!any) break;
    moved = true;
  }
  return moved;
}

/** Is a camera at (x, y, z) inside something, or within its skin of it: a house, a wall, a pillar, a roof, the floor? */
export function cameraBlocked(plaza, x, y, z) {
  const s = solidsFor(plaza);
  for (const bx of s.boxes) {
    if (enterBox(bx, x, y, z, 0, 0, 0, 0) <= 0) return true;
  }
  for (const cy of s.cyls) {
    if (enterCyl(cy, x, y, z, 0, 0, 0, 0) <= 0) return true;
  }
  if (y < ROOFLINE && (x < s.xMin || x > s.xMax || z < s.zMin || z > s.zMax)) return true;
  return y < floorY(plaza, x, z) + FLOOR;
}

const _cam = { x: 0, y: 0, z: 0 }; // scratch: where the camera is being put
const next = { tx: 0, ty: 0, tz: 0, yaw: 0 }; // scratch: where the view will be a moment on

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
    last: { tx: 0, ty: 0, tz: 0, yaw: 0 }, // where the view was a frame ago (`had`: there was a frame ago), to see where it is heading
    had: false,
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
      st.had = false;
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
      // Where the view is heading a moment from now: you walking on, the view swinging round (or dragged round by hand).
      const was = st.had;
      next.tx = st.tx;
      next.ty = st.ty;
      next.tz = st.tz;
      next.yaw = st.yaw;
      if (was && dt > 1e-4) {
        const cap = (v, m) => (v > m ? m : v < -m ? -m : v);
        const last = st.last;
        next.tx += cap((st.tx - last.tx) / dt, 8) * LOOK;
        next.ty += cap((st.ty - last.ty) / dt, 8) * LOOK;
        next.tz += cap((st.tz - last.tz) / dt, 8) * LOOK;
        next.yaw += cap(Math.atan2(Math.sin(st.yaw - last.yaw), Math.cos(st.yaw - last.yaw)) / dt, 2.5) * LOOK;
      }
      let px;
      let py;
      let pz;
      // The camera sits behind and above you (round a base: where you are, or will be).
      const at = (b, pitch, d, turn = 0) => {
        const c = Math.cos(pitch);
        px = b.tx + Math.sin(b.yaw + turn) * c * d;
        pz = b.tz + Math.cos(b.yaw + turn) * c * d;
        py = b.ty + Math.sin(pitch) * d;
      };
      if (plaza) {
        // A wall, the stage or a roof in the way brings the camera in, or lifts it over (a higher view of the same spot), or swings it
        // round, rather than letting it crowd your shoulder or hide you.
        const reach = (b, pitch, turn) => {
          at(b, pitch, dist, turn);
          return rayClear(plaza, b.tx, b.ty, b.tz, px, py, pz);
        };
        let want = reach(st, st.pitch, 0);
        let lift = 0;
        let turn = 0;
        if (want < 1) {
          let best = want;
          let score = want;
          const tryIt = (l, tn, bonus = 0) => {
            const u = reach(st, Math.min(1.45, st.pitch + l), tn);
            if (u + bonus > score + 1e-6) {
              score = u + bonus;
              best = u;
              lift = l;
              turn = tn;
            }
            return u >= 1;
          };
          // The way round it is in already comes first, and stays unless another is clearly better: no flicker between two.
          let done = st.lift > 0.02 || Math.abs(st.turn) > 0.02 ? tryIt(st.lift, st.turn, 0.12) : false;
          for (const l of LIFTS) if (!done) done = tryIt(l, 0);
          // Still shut (a wall right behind you, a corner): swing round it.
          if (!done && best < 0.6) for (const tn of TURNS) for (const l of TURN_LIFTS) if (!done) done = tryIt(l, tn);
          want = Math.max(MIN_REACH * 0.3, best);
        }
        // And what that way will look like a moment on: a wall's edge about to cross the line starts the camera in before it does.
        const soon = reach(next, Math.min(1.45, st.pitch + lift), turn);
        if (soon < want) want = Math.max(MIN_REACH * 0.3, soon);
        // Worse is quick, better is slow: no flicker in a doorway, and the view never jumps (a wall coming up behind you eases the
        // camera in and round over a few frames).
        // (A view just put behind someone, a new round or back from the Powder Room, starts where it should: nothing to ease from.)
        const rec = was ? 1 - Math.exp(-dt * 2.2) : 1;
        const pull = was ? 1 - Math.exp(-dt * 10) : 1;
        // (and never faster than the eye can follow: a swing right round, in a corner, takes a few tenths of a second)
        const ease = (a, b, k, rate) => {
          const d = (b - a) * k;
          if (!was) return a + d;
          const cap = rate * dt;
          return a + (d > cap ? cap : d < -cap ? -cap : d);
        };
        st.reach = ease(st.reach, want, want < st.reach ? pull : rec, 6);
        st.lift = ease(st.lift, lift, lift > st.lift ? pull : rec, 4);
        st.turn = ease(st.turn, turn, Math.abs(turn) > Math.abs(st.turn) ? pull : rec, 7);
        const pitch = Math.min(1.45, st.pitch + st.lift);
        at(st, pitch, dist * st.reach, st.turn);
        // Wherever it ends up it is never inside anything: round a pillar it slides, a wall, the stage, the floor, a roof or a house
        // hold it back toward you (the easing above is why this rarely has to), and what is left it is moved out of the shortest way.
        const cam3 = _cam;
        cam3.x = px;
        cam3.y = py;
        cam3.z = pz;
        pushOut(plaza, cam3, true);
        if (cameraBlocked(plaza, cam3.x, cam3.y, cam3.z)) {
          let r = st.reach - 0.03;
          for (; r > 0.04; r -= 0.03) {
            at(st, pitch, dist * r, st.turn);
            cam3.x = px;
            cam3.y = py;
            cam3.z = pz;
            pushOut(plaza, cam3, true);
            if (!cameraBlocked(plaza, cam3.x, cam3.y, cam3.z)) break;
          }
          st.reach = Math.max(0.04, r);
        }
        pushOut(plaza, cam3);
        px = cam3.x;
        py = cam3.y;
        pz = cam3.z;
      } else at(st, st.pitch, dist);
      st.last.tx = st.tx;
      st.last.ty = st.ty;
      st.last.tz = st.tz;
      st.last.yaw = st.yaw;
      st.had = true;
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

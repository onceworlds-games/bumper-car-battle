// The physics of one bumper car and of two cars meeting. Pure: no window, no document, no SDK.
// World units: the rink starts at radius 11, a car is 0.75 around. y points down (like the screen).

export const TAU = Math.PI * 2;
export const STEP = 1 / 60;

export const CAR_R = 0.75;
export const MASS = 1;
export const HEAVY_MASS = 2.2; // a car that just boosted
export const TURN = 7; // rad/s toward the stick direction (or the keys)
export const ACCEL = 18; // u/s^2 forward
export const MAX_V = 7; // u/s that driving alone reaches
export const REV_V = 4; // u/s backwards
export const DRAG = 1.6; // per second: cars glide
export const BOOST_V = 11; // instant forward impulse
export const BOOST_CD = 2.2; // s
export const HEAVY_T = 0.35; // s a boosting car is heavy
export const REST = 0.9; // restitution between cars
export const KNOCK = 4; // extra u/s for the lighter car when the other one boosts
export const BIG_HIT = 9; // relative speed of a hit that freezes the screen for a moment
export const BUMPER_W = 1; // the rubber ring inside the edge pushes back over this width...
export const BUMPER_K = 80; // ...with this spring: slow cars bounce, boosted ones fly over
export const BUMPER_DAMP = 1.5;
export const WALL_REST = 0.65; // the lobby edge is a bouncy wall
export const MAX_SPEED = 30;
export const KO_WINDOW = 3000; // ms: the last car that hit it within this long gets the knockout

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function makeCar(id, x, y, a) {
  return { id, x, y, vx: 0, vy: 0, a, cd: 0, heavy: 0, boostAge: 99, alive: true };
}

export function resetCar(c, x, y, a) {
  c.x = x;
  c.y = y;
  c.a = a;
  c.vx = 0;
  c.vy = 0;
  c.cd = 0;
  c.heavy = 0;
  c.boostAge = 99;
  c.alive = true;
}

/** How far the boost has recharged: 0 just used, 1 ready. */
export const cdFrac = (c) => 1 - clamp(c.cd / BOOST_CD, 0, 1);

/**
 * One step of driving. `inp`: { aim, steer, thr, boost }.
 *   aim: heading to turn toward (stick), or null to use `steer` (keys: -1 left, 1 right).
 *   thr: -1..1, forward or back. boost: true fires if the cooldown is over.
 * `wall`: the edge is a hard bouncy wall (lobby, title, a finished round) instead of a drop.
 * Returns true if the car boosted this step.
 */
export function stepCar(c, inp, dt, R, wall) {
  if (!(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.vx) && Number.isFinite(c.vy))) {
    c.x = 0;
    c.y = 0;
    c.vx = 0;
    c.vy = 0;
  }
  if (!Number.isFinite(c.a)) c.a = 0;
  let boosted = false;
  const aim = inp.aim !== null && inp.aim !== undefined && Number.isFinite(inp.aim) ? inp.aim : null;
  let err = 0;
  if (aim !== null) {
    const m = TURN * dt;
    const e = wrapAngle(aim - c.a);
    c.a = wrapAngle(c.a + (e > m ? m : e < -m ? -m : e));
    err = wrapAngle(aim - c.a);
  } else {
    c.a = wrapAngle(c.a + clamp(Number(inp.steer) || 0, -1, 1) * TURN * dt);
  }
  const hx = Math.cos(c.a);
  const hy = Math.sin(c.a);
  const thr = clamp(Number(inp.thr) || 0, -1, 1);
  const vf = c.vx * hx + c.vy * hy;
  if (thr > 0) {
    // Pointing the wrong way, a car gathers speed slowly: it has to come round first.
    const k = aim !== null ? thr * (0.4 + 0.6 * Math.max(0, Math.cos(err))) : thr;
    const cap = MAX_V * thr;
    if (vf < cap) {
      const add = Math.min(ACCEL * k * dt, cap - vf);
      c.vx += hx * add;
      c.vy += hy * add;
    }
  } else if (thr < 0) {
    const cap = REV_V * thr; // negative
    if (vf > cap) {
      const add = Math.min(ACCEL * 0.7 * -thr * dt, vf - cap);
      c.vx -= hx * add;
      c.vy -= hy * add;
    }
  }
  if (inp.boost && c.cd <= 0) {
    c.vx += hx * BOOST_V;
    c.vy += hy * BOOST_V;
    c.cd = BOOST_CD;
    c.heavy = HEAVY_T;
    c.boostAge = 0;
    boosted = true;
  }
  const f = Math.exp(-DRAG * dt);
  c.vx *= f;
  c.vy *= f;
  const sp = Math.hypot(c.vx, c.vy);
  if (sp > MAX_SPEED) {
    c.vx *= MAX_SPEED / sp;
    c.vy *= MAX_SPEED / sp;
  }
  c.cd = c.cd > dt ? c.cd - dt : 0;
  c.heavy = c.heavy > dt ? c.heavy - dt : 0;
  c.boostAge += dt;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  const r = Math.hypot(c.x, c.y);
  if (r > 1e-9) {
    const nx = c.x / r;
    const ny = c.y / r;
    if (wall) {
      const lim = R - CAR_R;
      if (r > lim) {
        c.x = nx * lim;
        c.y = ny * lim;
        const vr = c.vx * nx + c.vy * ny;
        if (vr > 0) {
          c.vx -= (1 + WALL_REST) * vr * nx;
          c.vy -= (1 + WALL_REST) * vr * ny;
        }
      }
    } else {
      const inner = R - BUMPER_W;
      if (r > inner) {
        const depth = r - inner;
        const vr = c.vx * nx + c.vy * ny;
        c.vx -= nx * BUMPER_K * depth * dt;
        c.vy -= ny * BUMPER_K * depth * dt;
        if (vr > 0) {
          c.vx -= nx * BUMPER_DAMP * vr * dt;
          c.vy -= ny * BUMPER_DAMP * vr * dt;
        }
      }
    }
  }
  return boosted;
}

/** A car whose centre has left the rink has fallen in. */
export const outside = (c, R) => c.x * c.x + c.y * c.y > R * R;

/**
 * What the last collision call found (reused, never allocated): `speed` is how fast the cars were closing (0 when no impulse
 * was applied), `aggA`/`aggB` how fast each was moving toward the other: the larger one is the car that did the hitting.
 */
export const HIT = { speed: 0, aggA: 0, aggB: 0, nx: 1, ny: 0 };

const MIN_D = CAR_R * 2;

function resolve(a, b, applyA, applyB) {
  HIT.speed = 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (!(d2 < MIN_D * MIN_D)) return false;
  let d = Math.sqrt(d2);
  let nx = 1;
  let ny = 0;
  if (d > 1e-6) {
    nx = dx / d;
    ny = dy / d;
  } else d = 0;
  const ma = a.heavy > 0 ? HEAVY_MASS : MASS;
  const mb = b.heavy > 0 ? HEAVY_MASS : MASS;
  const total = ma + mb;
  // Pushed apart so they never sit inside each other: each car moves its own share.
  const overlap = MIN_D - d;
  if (applyA) {
    a.x -= nx * overlap * (mb / total);
    a.y -= ny * overlap * (mb / total);
  }
  if (applyB) {
    b.x += nx * overlap * (ma / total);
    b.y += ny * overlap * (ma / total);
  }
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; // < 0: closing
  HIT.nx = nx;
  HIT.ny = ny;
  if (vn >= 0) return false;
  HIT.aggA = a.vx * nx + a.vy * ny;
  HIT.aggB = -(b.vx * nx + b.vy * ny);
  const j = (-(1 + REST) * vn) / (1 / ma + 1 / mb);
  if (applyA) {
    a.vx -= (j / ma) * nx;
    a.vy -= (j / ma) * ny;
  }
  if (applyB) {
    b.vx += (j / mb) * nx;
    b.vy += (j / mb) * ny;
  }
  const ha = a.heavy > 0;
  const hb = b.heavy > 0;
  if (ha !== hb) {
    // The car that boosted knocks the lighter one extra hard.
    if (ha && applyB) {
      b.vx += nx * KNOCK;
      b.vy += ny * KNOCK;
    } else if (hb && applyA) {
      a.vx -= nx * KNOCK;
      a.vy -= ny * KNOCK;
    }
  }
  HIT.speed = -vn;
  return true;
}

/** Two cars that both live here: both get their half. True if they hit (HIT has the details). */
export const collidePair = (a, b) => resolve(a, b, true, true);

/** `me` meets a car whose position and velocity come from elsewhere (presence, a snapshot): only `me` changes. */
export const collideOne = (me, other) => resolve(me, other, true, false);

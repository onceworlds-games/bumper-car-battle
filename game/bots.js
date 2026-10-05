// What a bot decides each step. Pure: it reads the round's cars and returns a driving input like a player's.
// A bot thinks every 0.2-0.4 s (its reaction time), stays off the edge, lines up behind a car so a hit pushes it
// outward, and boosts when it is close and pointing at it. Weaker bots aim worse and boost at the wrong moments.

import { clamp, wrapAngle } from './sim.js';

/** A bot's character, from the round's random numbers (idx only varies the stream). */
export function newAI(rng, idx) {
  const skill = 0.25 + rng() * 0.6; // 0.25 .. 0.85: kids play this, so nobody is perfect
  return {
    idx,
    skill,
    react: 0.2 + (1 - skill) * 0.2, // 0.23 .. 0.35 s between decisions
    calm: 2500 + rng() * 1500, // ms at the start of a round before it starts boosting: time to find your feet
    aimErr: (1 - skill) * 0.5, // radians of error in where it aims
    boostAngle: 0.35 + (1 - skill) * 0.4, // 20 degrees for the best, wider for the rest
    fireDelay: 0.06 + (1 - skill) * 0.2,
    reckless: (1 - skill) * 0.3, // chance per decision to boost without looking where it ends up
    edge: 1.4 + skill * 1.2, // how close to the edge it lets itself get
    focus: 0.55 + skill * 0.35, // how often it goes for the nearest car that is closer to the edge
    thinkT: rng() * 0.3,
    tgt: '',
    tgtT: 0,
    px: 0,
    py: 0,
    thr: 1,
    attack: false,
    rash: false,
    fireT: 0,
    inp: { aim: null, steer: 0, thr: 0, boost: false },
  };
}

function pick(c, round) {
  const ai = c.ai;
  const rng = round.rng;
  const r = Math.hypot(c.x, c.y);
  let best = null;
  let bd = Infinity;
  let rnd = null;
  let count = 0;
  for (const o of round.cars) {
    if (o === c || o.out) continue;
    count++;
    if (rng() * count < 1) rnd = o;
    if (Math.hypot(o.x, o.y) > r - 0.3) {
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
  }
  if (best && rng() < ai.focus) return best;
  return rnd || best;
}

function think(c, round, R) {
  const ai = c.ai;
  const rng = round.rng;
  ai.rash = rng() < ai.reckless;
  let t = ai.tgt ? round.byId.get(ai.tgt) : null;
  if (!t || t.out || ai.tgtT <= 0) {
    t = pick(c, round);
    ai.tgt = t ? t.id : '';
    ai.tgtT = 1.5 + rng() * 1.5;
  }
  if (!t) {
    ai.attack = false;
    ai.px = 0;
    ai.py = 0;
    ai.thr = 0.4;
    return;
  }
  const dx = t.x - c.x;
  const dy = t.y - c.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const tr = Math.hypot(t.x, t.y);
  // The way out of the rink at the target: a hit along it pushes the target toward the water.
  const ux = tr > 0.6 ? t.x / tr : dx / d;
  const uy = tr > 0.6 ? t.y / tr : dy / d;
  const cosA = (dx / d) * ux + (dy / d) * uy;
  let px;
  let py;
  if (cosA > 0.55 || d < 2.4) {
    px = t.x + t.vx * 0.25;
    py = t.y + t.vy * 0.25;
  } else {
    px = t.x - ux * 2.8; // behind it, on the centre side
    py = t.y - uy * 2.8;
  }
  const pr = Math.hypot(px, py);
  const lim = Math.max(1, R - 2.5);
  if (pr > lim) {
    px *= lim / pr;
    py *= lim / pr;
  }
  const e = (rng() - 0.5) * 2 * ai.aimErr;
  const ox = px - c.x;
  const oy = py - c.y;
  const cs = Math.cos(e);
  const sn = Math.sin(e);
  ai.px = c.x + ox * cs - oy * sn;
  ai.py = c.y + ox * sn + oy * cs;
  ai.attack = true;
  ai.thr = 1;
}

const IDLE = Object.freeze({ aim: null, steer: 0, thr: 0, boost: false });
export { IDLE };

/** The bot's input for this step (the object is reused: read it at once). */
export function botInput(c, round, dt, R) {
  const ai = c.ai;
  const inp = ai.inp;
  ai.thinkT -= dt;
  ai.tgtT -= dt;
  if (ai.thinkT <= 0) {
    ai.thinkT = ai.react * (0.85 + round.rng() * 0.3);
    think(c, round, R);
  }
  const r = Math.hypot(c.x, c.y);
  const nx = r > 1e-6 ? c.x / r : 1;
  const ny = r > 1e-6 ? c.y / r : 0;
  const vout = c.vx * nx + c.vy * ny;
  inp.boost = false;
  inp.steer = 0;
  // Near the edge it forgets everything else: turn to the middle, and brake if it is sliding out backwards-ish.
  // The rubber ring catches anything slow, so on a small rink there is much less to be afraid of.
  const room = clamp((R - 3) / 8, 0.3, 1);
  if (R - r < (ai.edge + 0.3 * Math.max(0, vout)) * room) {
    inp.aim = Math.atan2(-c.y, -c.x);
    const facingOut = Math.cos(c.a) * nx + Math.sin(c.a) * ny > 0.5;
    inp.thr = vout > 2.5 && facingOut ? -1 : 1;
    ai.fireT = 0;
    return inp;
  }
  const dx = ai.px - c.x;
  const dy = ai.py - c.y;
  inp.aim = dx * dx + dy * dy > 0.04 ? Math.atan2(dy, dx) : null;
  inp.thr = ai.thr;
  const t = ai.attack && ai.tgt ? round.byId.get(ai.tgt) : null;
  if (t && !t.out && c.cd <= 0 && (round.demo || round.t >= ai.calm)) {
    const tx = t.x - c.x;
    const ty = t.y - c.y;
    const d = Math.hypot(tx, ty);
    const err = Math.abs(wrapAngle(Math.atan2(ty, tx) - c.a));
    if (d < 3.5 && err < ai.boostAngle) {
      // Would the lunge carry it over the edge (the target's spot and a little past it)? Careful bots wait for a better angle.
      const safe = Math.hypot(c.x + Math.cos(c.a) * (d + 0.6), c.y + Math.sin(c.a) * (d + 0.6)) < R - 0.3;
      if (safe || ai.rash) {
        ai.fireT += dt;
        if (ai.fireT >= ai.fireDelay) {
          inp.boost = true;
          ai.fireT = 0;
        }
      } else ai.fireT = 0;
    } else ai.fireT = 0;
  } else ai.fireT = 0;
  return inp;
}

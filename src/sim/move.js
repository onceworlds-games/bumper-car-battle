// How a masker moves, the same for your own figure and for bots: NPC pace and turning, sprint, falling in step
// with your slot, and never through walls, water or other revellers.
import { WALK, SPRINT, POISE, FIGURE_R, SEPARATION } from './const.js';
import { settle } from './nav.js';
import { STRIDE } from './crowd.js';
import { wrap, clamp } from './geom.js';

const TURN = 6.5; // rad/s
const ACC_WALK = WALK / 0.35;
const ACC_SPRINT = 11;
const GLIDE = 0.45; // seconds to settle onto your slot
const P = { x: 0, z: 0 };

export function makeMover(x = 0, z = 0, h = 0) {
  return { x, z, h, vx: 0, vz: 0, locked: false, glide: 0, gx: 0, gz: 0, idle: 0, sprint: false, path: null, pathI: 0, speed: 0 };
}

/**
 * One fixed step. input: { dx, dz } desired direction on the ground (length 0..1), sprint, steer (true while the
 * player or bot is asking to move). ctx: { plaza, slot: { x, z, h } | null, canLock, crowd (buffer), count,
 * skip (Uint8Array: 1 for slots with no reveller in them), others ([x, z, ...] of other maskers), sprintOk }.
 */
export function stepMover(mv, input, dt, ctx) {
  const steer = !!input.steer;
  if (steer) {
    mv.idle = 0;
    if (mv.locked || mv.glide > 0) {
      mv.locked = false;
      mv.glide = 0;
    }
  } else mv.idle += dt;
  const slot = ctx.slot;
  if (!mv.locked && slot && ctx.canLock && !steer && mv.idle >= POISE.lockDelay) {
    const d = Math.sqrt((slot.x - mv.x) ** 2 + (slot.z - mv.z) ** 2);
    if (mv.glide > 0 || d <= POISE.lock) {
      if (mv.glide === 0) {
        mv.gx = mv.x;
        mv.gz = mv.z;
      }
      mv.glide = Math.min(1, mv.glide + dt / GLIDE);
      const k = mv.glide * mv.glide * (3 - 2 * mv.glide);
      mv.x = mv.gx + (slot.x - mv.gx) * k;
      mv.z = mv.gz + (slot.z - mv.gz) * k;
      mv.h += wrap(slot.h - mv.h) * Math.min(1, dt * 8);
      mv.vx = 0;
      mv.vz = 0;
      mv.speed = 0;
      if (mv.glide >= 1) {
        mv.locked = true;
        mv.glide = 0;
      }
      return mv;
    }
  }
  if (mv.locked) {
    if (!slot || !ctx.canLock) {
      mv.locked = false;
    } else {
      mv.x = slot.x;
      mv.z = slot.z;
      mv.h = slot.h;
      mv.speed = slot.sp ?? 0;
      return mv;
    }
  }
  const wantSprint = !!input.sprint && ctx.sprintOk !== false && (input.dx || input.dz);
  mv.sprint = !!wantSprint;
  let dx = input.dx || 0;
  let dz = input.dz || 0;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 1) {
    dx /= len;
    dz /= len;
  }
  const top = wantSprint ? SPRINT : WALK;
  const tvx = dx * top;
  const tvz = dz * top;
  const acc = (wantSprint ? ACC_SPRINT : ACC_WALK) * dt;
  const ex = tvx - mv.vx;
  const ez = tvz - mv.vz;
  const el = Math.sqrt(ex * ex + ez * ez);
  if (el <= acc) {
    mv.vx = tvx;
    mv.vz = tvz;
  } else {
    mv.vx += (ex / el) * acc;
    mv.vz += (ez / el) * acc;
  }
  mv.x += mv.vx * dt;
  mv.z += mv.vz * dt;
  const sp = Math.sqrt(mv.vx * mv.vx + mv.vz * mv.vz);
  mv.speed = sp;
  if (sp > 0.15) {
    const want = Math.atan2(mv.vx, mv.vz);
    const turn = wrap(want - mv.h);
    mv.h = wrap(mv.h + clamp(turn, -TURN * dt, TURN * dt));
  }
  collide(mv, ctx);
  return mv;
}

/** Pushes a mover out of revellers, other maskers and anything solid. */
export function collide(mv, ctx) {
  const buf = ctx.crowd;
  if (buf) {
    for (let s = 0; s < ctx.count; s++) {
      if (ctx.skip && ctx.skip[s]) continue;
      const o = s * STRIDE;
      const dx = mv.x - buf[o];
      if (dx > SEPARATION || dx < -SEPARATION) continue;
      const dz = mv.z - buf[o + 1];
      if (dz > SEPARATION || dz < -SEPARATION) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 >= SEPARATION * SEPARATION) continue;
      const d = Math.sqrt(d2) || 1e-3;
      const push = SEPARATION - d;
      mv.x += (dx / d) * push;
      mv.z += (dz / d) * push;
    }
  }
  const others = ctx.others;
  if (others) {
    for (let i = 0; i < others.length; i += 2) {
      const dx = mv.x - others[i];
      const dz = mv.z - others[i + 1];
      const d2 = dx * dx + dz * dz;
      if (d2 >= SEPARATION * SEPARATION || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const push = (SEPARATION - d) * 0.5;
      mv.x += (dx / d) * push;
      mv.z += (dz / d) * push;
    }
  }
  settle(ctx.plaza, mv.x, mv.z, FIGURE_R, P);
  mv.x = P.x;
  mv.z = P.z;
}

/** Steering toward the next point of a path; returns false when the path is done. Writes input.dx/dz. */
export function followPath(mv, input) {
  const p = mv.path;
  if (!p || mv.pathI >= p.length) {
    mv.path = null;
    input.dx = 0;
    input.dz = 0;
    return false;
  }
  let [tx, tz] = p[mv.pathI];
  let d = Math.sqrt((tx - mv.x) ** 2 + (tz - mv.z) ** 2);
  while (d < 0.35 && mv.pathI < p.length - 1) {
    mv.pathI++;
    [tx, tz] = p[mv.pathI];
    d = Math.sqrt((tx - mv.x) ** 2 + (tz - mv.z) ** 2);
  }
  if (d < 0.25 && mv.pathI >= p.length - 1) {
    mv.path = null;
    input.dx = 0;
    input.dz = 0;
    return false;
  }
  // Ease in on the last point so arrivals stop like a reveller would.
  const slow = mv.pathI >= p.length - 1 ? Math.min(1, d / 0.6) : 1;
  input.dx = ((tx - mv.x) / d) * slow;
  input.dz = ((tz - mv.z) / d) * slow;
  return true;
}

// You: steering (keys relative to the camera, or a walk to where you clicked), falling in step with your slot, the
// sprint, and the verbs. Every verb answers at once on your own screen (a fan flick, a wave) and asks the host, which
// decides; a refusal says why in a word.
import { makeMover, stepMover, followPath } from '../sim/move.js';
import { walkPath } from '../sim/nav.js';
import { UNMASK, GREET, ABILITIES, POISE } from '../sim/const.js';
import { EM } from '../sim/choreo.js';
import { FLAG } from '../sim/rules.js';
import { wrap } from '../sim/geom.js';

const LONG_PRESS = 0.45;

export function createPlayer() {
  const mv = makeMover();
  const st = {
    rid: '',
    path: null,
    mark: null,
    target: null,
    em: 0,
    emAt: -99,
    prompt: null,
    answer: null,
    lastAnswerG: -1,
    opera: false,
    abHeldAt: -1,
    abFired: false,
    sprinting: false,
    steer: false,
    fallIn: false,
  };
  const input = { dx: 0, dz: 0, sprint: false, steer: false, mul: 1 };
  let lastSlot = null;

  const p = {
    mv,
    st,
    /** A new round (or a reloaded page): stand in your slot, or where your presence says you were. */
    place(rid, x, z, h, locked) {
      st.rid = rid;
      mv.x = x;
      mv.z = z;
      mv.h = h;
      mv.vx = 0;
      mv.vz = 0;
      mv.locked = !!locked;
      mv.glide = 0;
      mv.idle = locked ? 1 : 0;
      mv.path = null;
      st.path = null;
      st.mark = null;
      st.target = null;
      st.prompt = null;
      st.opera = false;
      st.fallIn = false;
    },
    emote(code, now) {
      st.em = code;
      st.emAt = now;
    },
    /** The emote my figure shows now (code, seconds into it). */
    emoteNow(now) {
      const len = { [EM.flick]: 0.9, [EM.wave]: 1.4, [EM.eager]: 0.7, [EM.flourish]: 1.9 }[st.em] ?? 0;
      if (!st.em || now - st.emAt > len) return null;
      return [st.em, now - st.emAt];
    },
    /** Back to your place in the troupe (tap your shadow, or F). */
    fallIn() {
      mv.path = null;
      st.path = null;
      st.fallIn = true;
    },
    /** Walks to a point (a tap or click on the stones). */
    walkTo(plaza, x, z) {
      st.fallIn = false;
      const path = walkPath(plaza, mv.x, mv.z, x, z);
      if (!path) return false;
      mv.path = path;
      mv.pathI = 1;
      st.path = path;
      return true;
    },
    stop() {
      mv.path = null;
      st.path = null;
    },
    /**
     * One fixed step. ctx: { keys (input.held), camYaw, plaza, slot, canLock, crowd, count, skip, others, sprintOk,
     * frozen }.
     */
    update(dt, ctx) {
      const k = ctx.keys;
      let fx = 0;
      let fz = 0;
      if (!ctx.frozen) {
        const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
        const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
        if (f || r) {
          const y = ctx.camYaw;
          const fwx = -Math.sin(y);
          const fwz = -Math.cos(y);
          fx = fwx * f + -fwz * r;
          fz = fwz * f + fwx * r;
          const l = Math.hypot(fx, fz) || 1;
          fx /= l;
          fz /= l;
          mv.path = null;
          st.path = null;
        }
      }
      if (fx || fz) st.fallIn = false;
      input.dx = fx;
      input.dz = fz;
      input.steer = !!(fx || fz);
      input.mul = 1;
      if (!input.steer && st.fallIn && ctx.slot && !ctx.frozen) {
        // Falling in: head for where your slot will be, a touch brisker than the crowd, until you're in step.
        const s = ctx.slot;
        const vx = lastSlot ? (s.x - lastSlot.x) / dt : 0;
        const vz = lastSlot ? (s.z - lastSlot.z) / dt : 0;
        const d = Math.hypot(s.x - mv.x, s.z - mv.z);
        const lead = Math.min(2.5, d / 1.9);
        const tx = s.x + vx * lead - mv.x;
        const tz = s.z + vz * lead - mv.z;
        const l = Math.hypot(tx, tz);
        if (mv.locked || d < 0.9) st.fallIn = false;
        else if (d > 4 && ctx.plaza) {
          // Far off: find a way round whatever is in between, aimed at where the slot is heading.
          st.repath = (st.repath ?? 0) - dt;
          if (!mv.path || st.repath <= 0) {
            mv.path = walkPath(ctx.plaza, mv.x, mv.z, mv.x + tx, mv.z + tz);
            mv.pathI = 1;
            st.repath = 0.8;
          }
          input.steer = followPath(mv, input);
          input.mul = 1.18;
        } else if (l > 0.05) {
          mv.path = null;
          input.dx = tx / l;
          input.dz = tz / l;
          input.steer = d > 1.1;
          input.mul = 1.18;
        }
      }
      if (ctx.slot) lastSlot = lastSlot ? Object.assign(lastSlot, { x: ctx.slot.x, z: ctx.slot.z }) : { x: ctx.slot.x, z: ctx.slot.z };
      if (!input.steer && mv.path && !ctx.frozen && !st.fallIn) input.steer = followPath(mv, input);
      if (!mv.path) st.path = null;
      input.sprint = !ctx.frozen && k.has('shift') && input.steer;
      st.steer = input.steer;
      stepMover(mv, input, dt, ctx);
      st.sprinting = mv.sprint && !mv.locked;
      return mv;
    },
    flags() {
      return (mv.locked ? FLAG.locked : 0) | (st.sprinting ? FLAG.sprint : 0) | (st.opera ? FLAG.opera : 0) | (mv.speed > 0.2 ? FLAG.moving : 0);
    },
    /**
     * The figure you'd unmask or greet: within range and roughly in front of you (or of the camera), the one you
     * marked if it qualifies. targets: [{ ref, x, z }].
     */
    pick(targets, range, camYaw) {
      let best = null;
      let bestScore = Infinity;
      const dirs = [mv.h, camYaw + Math.PI];
      for (let pass = 0; pass < 2 && !best; pass++) {
        const face = dirs[pass];
        for (const t of targets) {
          const dx = t.x - mv.x;
          const dz = t.z - mv.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > range || d < 0.05) continue;
          const ang = Math.abs(wrap(Math.atan2(dx, dz) - face));
          if (ang > UNMASK.cone / 2 && d > 0.9) continue;
          let score = ang * 1.3 + d * 0.3;
          if (st.mark && sameRef(st.mark, t.ref)) score -= 3;
          if (score < bestScore) {
            bestScore = score;
            best = t;
          }
        }
      }
      return best;
    },
    /** Turns to face a figure at once (for an unmask or a wave), so the host sees you facing it. */
    face(t) {
      mv.h = Math.atan2(t.x - mv.x, t.z - mv.z);
    },
    /** The ability button on a touch screen: a tap uses the first, a hold the second. */
    abilityKey(down, now) {
      if (down) {
        st.abHeldAt = now;
        st.abFired = false;
        return null;
      }
      const held = st.abHeldAt >= 0 ? now - st.abHeldAt : 0;
      st.abHeldAt = -1;
      if (st.abFired) return null;
      return held >= LONG_PRESS ? 1 : 0;
    },
    /** Called each frame while the ability key is held: fires the second ability once the hold is long enough. */
    abilityHold(now) {
      if (st.abHeldAt >= 0 && !st.abFired && now - st.abHeldAt >= LONG_PRESS) {
        st.abFired = true;
        return 1;
      }
      return null;
    },
  };
  return p;
}

export const sameRef = (a, b) => !!a && !!b && a.k === b.k && (a.k === 'n' ? a.s === b.s : a.id === b.id);

/** Why a verb can't happen right now, from your status as the host last wrote it (or null when it can). */
export function blocked(verb, { stage, rs, t, ab }) {
  if (!rs) return 'Watching';
  if (rs.out > t) return 'Powder Room';
  if (rs.aud) return 'Watching';
  if (verb === 'unmask') {
    if (stage === 'assign' || stage === 'blend') return 'Not yet';
    if (stage !== 'hunt' && stage !== 'hush') return 'Over';
    if (rs.fl > t) return 'Flustered';
    if (t < rs.cu) return 'Wait';
    if (rs.p < POISE.unmaskCost - 3) return 'No poise';
  } else if (verb === 'greet') {
    if (stage === 'assign' || stage === 'reveal' || stage === 'results') return 'Not now';
    if (t < rs.cg) return 'Wait';
  } else if (verb === 'ability') {
    if (stage === 'assign' || stage === 'reveal' || stage === 'results') return 'Not now';
    if (ab && ab.cd > t) return 'Wait';
  }
  return null;
}

export { GREET, ABILITIES };

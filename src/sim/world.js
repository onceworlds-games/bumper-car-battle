// A round in motion: the crowd, the rules and the bots stepped together at a fixed rate. The host's page drives one
// with its players' positions; the balance harness and the tests drive one with bots only.
import { createCrowd, STRIDE } from './crowd.js';
import { PLAZAS } from './plazas.js';
import * as rules from './rules.js';
import { createBot, botsTick } from './bots.js';
import { TROUPES } from './const.js';

export const STEP = 0.1;

/**
 * cfg: the rules' round config. Returns a world with `step(dt)` and `t` (round seconds). Humans' positions are set by
 * the caller with `world.place(id, x, z, h, flags)` before each step.
 */
export function createWorld(cfg, { crowd: sharedCrowd, S: adopted = null, t = 0, botPos = null } = {}) {
  const S = adopted || rules.newRound(cfg);
  const plaza = PLAZAS[S.r.plaza];
  const crowd = sharedCrowd || createCrowd(plaza, S.r.seed, S.r.crowd);
  const count = TROUPES.length * S.r.crowd;
  const skip = new Uint8Array(count);
  const W = {
    S,
    plaza,
    crowd,
    count,
    skip,
    buf: crowd.buf,
    t,
    bots: [],
    wasOut: new Map(),
    idle: new Map(),
    place(id, x, z, h, f) {
      rules.setPos(S, id, x, z, h, f);
    },
    slotPos(id, out) {
      const m = S.r.m[id];
      if (!m) return null;
      const o = (m.tr * S.r.crowd + m.sl) * STRIDE;
      out.x = W.buf[o];
      out.z = W.buf[o + 1];
      out.h = W.buf[o + 3];
      out.sp = W.buf[o + 6];
      return out;
    },
    hushAt: () => (S.endAt < Infinity ? Math.min(S.timing.hushStart, S.endAt) : S.timing.hushStart),
    evalCrowd(t) {
      crowd.eval(t, W.hushAt());
      skip.fill(0);
      for (const [id, m] of Object.entries(S.r.m)) if (!m.gone) skip[m.tr * S.r.crowd + m.sl] = 1;
    },
  };
  W.evalCrowd(t);
  // Everyone starts in their slot (an adopted round keeps the positions it knew; bots resume where they were seen).
  const sp = { x: 0, z: 0, h: 0, sp: 0 };
  for (const [id, m] of Object.entries(S.r.m)) {
    if (m.gone) continue;
    W.slotPos(id, sp);
    const seen = botPos?.get?.(id);
    if (!adopted || !S.pos?.[id]) rules.setPos(S, id, seen ? seen.x : sp.x, seen ? seen.z : sp.z, seen ? seen.h : sp.h, seen ? seen.f : rules.FLAG.locked);
    if (m.b) {
      const p = S.pos[id];
      const B = createBot(S, id, p.x, p.z, p.h);
      if (seen && !(seen.f & rules.FLAG.locked)) B.mv.locked = false;
      // Don't answer greetings that happened before this page took over.
      B.seenEv = S.seq;
      W.bots.push(B);
    }
  }
  const tmp = { x: 0, z: 0, h: 0, sp: 0 };
  const act = {
    unmask: (id, ref, pose) => rules.unmask(S, W.t, id, ref, pose, W.buf),
    greet: (id, ref) => rules.greet(S, W.t, id, ref, W.buf),
    ability: (id, ab, params) => rules.ability(S, W.t, id, ab, params, W.buf),
    answer: (id, g, delay) => rules.answer(S, W.t, id, g, delay),
  };
  W.act = act;
  const view = {
    slotDist(id) {
      const p = S.pos?.[id];
      if (!p || !W.slotPos(id, tmp)) return 0;
      return Math.sqrt((p.x - tmp.x) ** 2 + (p.z - tmp.z) ** 2);
    },
    idle: (id) => W.idle.get(id) || 0,
  };
  const ctx = { plaza, crowd: W.buf, count, skip, slotPos: (id, out) => W.slotPos(id, out), act };
  /** Advances the round to time t (seconds), in fixed steps. */
  W.step = (dt = STEP) => {
    W.t += dt;
    const t = W.t;
    W.evalCrowd(t);
    for (const B of W.bots) {
      const out = rules.isOut(S, B.id, t);
      if (W.wasOut.get(B.id) && !out) {
        // Back from the Powder Room in a new costume: start in step in the new slot.
        W.slotPos(B.id, tmp);
        B.mv.x = tmp.x;
        B.mv.z = tmp.z;
        B.mv.h = tmp.h;
        B.mv.locked = true;
        B.mv.path = null;
      }
      W.wasOut.set(B.id, out);
      if (out) continue;
      if (B.mv.locked) {
        W.slotPos(B.id, tmp);
        B.mv.x = tmp.x;
        B.mv.z = tmp.z;
        B.mv.h = tmp.h;
      }
      const f = (B.mv.locked ? rules.FLAG.locked : 0) | (B.mv.sprint && !B.mv.locked ? rules.FLAG.sprint : 0) | (B.mv.speed > 0.2 ? rules.FLAG.moving : 0);
      rules.setPos(S, B.id, B.mv.x, B.mv.z, B.mv.h, f);
    }
    rules.tick(S, t, dt, view);
    botsTick(S, W.bots, t, dt, ctx);
    return W;
  };
  W.done = () => rules.stage(S, W.t) === 'over';
  return W;
}

// The Rehearsal: a guided mini case before your first ball, played on this page only. One clumsy Bauta is no
// reveller; the Master of Ceremonies teaches walking, your place in the troupe, greeting and unmasking, one step at a
// time. It runs while the room waits in its lobby, and it can be skipped.
import { createWorld, STEP } from '../sim/world.js';
import * as rules from '../sim/rules.js';
import { TROUPES } from '../sim/const.js';

const ME = 'you';

/** A session-shaped view of a local world, so the round view and the events can draw it like a real round. */
function localSession(W) {
  const r = () => ({ ...W.S.r, t0: 0, endAt: W.S.endAt === Infinity ? -1 : W.S.endAt, timing: W.S.timing, case: W.S.case ? { ...W.S.case, solved: !!W.S.case.solved } : null });
  let cached = null;
  let cachedAt = -1;
  const s = {
    me: ME,
    room: { me: { presence: null }, matchNow: () => W.t * 1000, kind: 'solo', isHost: true, setPrivate() {} },
    host: { active: () => true, world: W, finish() {} },
    get round() {
      if (cachedAt !== W.t || !cached) {
        cached = r();
        cachedAt = W.t;
      }
      return cached;
    },
    get status() {
      return W.S.rs;
    },
    get scores() {
      return W.S.sc;
    },
    get fx() {
      return W.S.fx;
    },
    get events() {
      return W.S.ev;
    },
    get game() {
      return null;
    },
    get intel() {
      return null;
    },
    time: () => W.t,
    crowdFor: () => W.crowd,
    pose(id, rr, out) {
      const p = W.S.pos?.[id];
      if (!p) return null;
      out.x = p.x;
      out.z = p.z;
      out.h = p.h;
      out.f = p.f;
      out.w = null;
      out.e = null;
      return out;
    },
    request(req) {
      const t = W.t;
      const S = W.S;
      if (req.t === 'um') return rules.unmask(S, t, ME, req.ref, { x: req.x, z: req.z, h: req.h }, W.buf);
      if (req.t === 'gr') return rules.greet(S, t, ME, req.ref, W.buf);
      if (req.t === 'ab') return rules.ability(S, t, ME, req.a, { x: req.x, z: req.z, h: req.h, tx: req.tx, tz: req.tz }, W.buf);
      if (req.t === 'an') return rules.answer(S, t, ME, req.g, req.d);
      return null;
    },
  };
  return s;
}

const STEPS = [
  { say: 'Welcome to the ball, darling.', hint: 'You are the one in the ring', until: (c) => c.t > 4.5 },
  { say: 'Stroll a little. Do.', hint: 'Move: WASD, or tap the stones', touchHint: 'Move: the stick, or tap the stones', until: (c) => c.away > 3 },
  { say: 'Your shadow marks your place.', hint: 'Stand on your shadow', until: (c) => c.locked && c.wasAway },
  { say: 'In step, you are invisible. And calm.', hint: 'In step, poise fills', until: (c) => c.stepT > 3.5 },
  { say: 'Now. One Bauta is no reveller.', hint: 'Watch for the odd one out', until: (c) => c.t - c.stepAt > 5, impostor: true },
  { say: 'There. Wave at it. People flinch.', hint: 'Get close, then greet: G', touchHint: 'Get close, then Greet', until: (c) => c.greeted, impostor: true },
  { say: 'Stiff as a post. Unmask it!', hint: 'Face it, then unmask: E', touchHint: 'Face it, then Unmask', until: (c) => c.found, impostor: true },
  { say: 'Splendid. Now, the real ball.', hint: '', until: (c) => c.t - c.stepAt > 3.2 },
];

export function createRehearsal() {
  let W = null;
  let session = null;
  let step = 0;
  let stepAt = 0;
  let paused = false;
  const c = { t: 0, away: 0, wasAway: false, locked: true, stepT: 0, greeted: false, found: false, stepAt: 0 };
  const api = {
    get active() {
      return !!W;
    },
    get session() {
      return session;
    },
    get step() {
      return step;
    },
    pause(p) {
      paused = !!p;
    },
    start() {
      W = createWorld({ mid: 'rehearsal', n: 1, mode: 'spot', plaza: 0, seed: 20261003, crowd: 6, minutes: 7, skill: 'novice', loadouts: 'standard', humans: [{ id: ME, name: 'You', ab: ['smoke', 'decoy'] }] });
      // Skip straight to the hunt (no assignment card, no blend), and slow the impostor down until it's its turn.
      W.t = W.S.timing.huntStart + 0.01;
      W.evalCrowd(W.t);
      const imp = W.S.case.imps[0];
      for (const id of W.S.case.imps.slice(1)) W.S.r.m[id].gone = 1;
      W.S.case.imps = [imp];
      const B = W.bots.find((b) => b.id === imp);
      B.P = { ...B.P, miss: 1 };
      B.mode = 'rest';
      B.until = 1e9;
      session = localSession(W);
      step = 0;
      stepAt = W.t;
      Object.assign(c, { t: 0, away: 0, wasAway: false, locked: true, stepT: 0, greeted: false, found: false, stepAt: 0 });
      return session;
    },
    stop() {
      W = null;
      session = null;
    },
    /** Steps the local world. me: { x, z, h, f, locked } from the player. Returns the step to show (or null when done). */
    update(dt, me, slot, hooks) {
      if (!W) return null;
      if (!paused) {
        let acc = Math.min(0.1, dt);
        while (acc > 0) {
          const s = Math.min(STEP, acc);
          W.place(ME, me.x, me.z, me.h, me.f);
          W.step(s);
          acc -= s;
        }
        // The Hush would end the case: keep it far off.
        if (W.t > W.S.timing.hushStart - 30) W.t = W.S.timing.huntStart + 5;
      }
      const t = W.t - W.S.timing.huntStart;
      c.t = t;
      c.stepAt = stepAt - W.S.timing.huntStart;
      const d = slot ? Math.hypot(me.x - slot.x, me.z - slot.z) : 0;
      c.away = Math.max(c.away, d);
      if (d > 3) c.wasAway = true;
      c.locked = me.locked;
      c.stepT = me.locked && step === 3 ? c.stepT + dt : step === 3 ? 0 : c.stepT;
      const imp = W.S.case.imps[0];
      c.found = !!W.S.r.m[imp].gone;
      c.greeted = W.S.ev.some((e) => e.k === 'greet' && e.a === ME && e.b === imp);
      const cur = STEPS[step];
      // The impostor's errand: it comes out to cross near you, conspicuously.
      if (cur?.impostor) {
        const B = W.bots.find((b) => b.id === imp);
        if (B && B.mode === 'rest' && !c.found) {
          const p = W.S.pos[imp];
          const tx = me.x + (p.x - me.x) * 0.25 + 3;
          const tz = me.z + (p.z - me.z) * 0.25 + 2;
          B.mode = 'errand';
          B.goal = [tx, tz];
          B.close = 0.8;
          B.sprintTrip = false;
          B.next = [30, 40];
        } else if (B && B.mode === 'loiter') B.until = Math.max(B.until, W.t + 2);
        hooks?.mark?.({ k: 'p', id: imp });
      }
      if (cur && cur.until(c)) {
        step++;
        stepAt = W.t;
        if (step >= STEPS.length) return null;
        hooks?.say?.(STEPS[step]);
      }
      return STEPS[Math.min(step, STEPS.length - 1)];
    },
    first() {
      return STEPS[0];
    },
    troupe() {
      return W ? TROUPES[W.S.r.m[ME].tr].name : '';
    },
  };
  return api;
}

export { ME as REHEARSAL_ID };

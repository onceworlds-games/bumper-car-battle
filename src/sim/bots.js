// Bots: Maskers that fill a round, and the impostors of Spot the Mask. They see only what a player could see (a
// figure out of formation, sprint dust, a shimmering or slipped mask, a stiff or eager wave, a fan flick), notice it
// with a skill-scaled chance, lose track in a crowd, and sometimes misread the choreography. Never secret knowledge.
import { hash32, rng } from './rng.js';
import { POISE, UNMASK, GREET, SEEN, ABILITIES, TROUPES, WALK } from './const.js';
import { districtAt } from './plazas.js';
import { lineOfSight, walkPath } from './nav.js';
import { STRIDE } from './crowd.js';
import { makeMover, stepMover, followPath } from './move.js';
import { isOut, stage, smokeBetween, FLAG } from './rules.js';
import { dist, wrap } from './geom.js';

export const SKILL = {
  novice: { loud: 2.4, imp: 2.6, see: 10, notice: 0.09, dev: 2.8, confirm: 1, probe: 0.15, sprint: 0.4, rt: 0.95, rtSd: 0.45, miss: 0.15, low: 8, rest: [8, 18], first: [6, 22], confuse: 0.55, misread: 0.55, lose: 0.55, fp: 0.12, decay: 0.12, watch: [4, 8], smart: 0 },
  adept: { loud: 1, imp: 1.4, see: 15, notice: 0.15, dev: 1.9, confirm: 1.5, probe: 0.5, sprint: 0.12, rt: 0.78, rtSd: 0.25, miss: 0.05, low: 30, rest: [12, 24], first: [20, 42], confuse: 0.25, misread: 0.15, lose: 0.32, fp: 0.02, decay: 0.07, watch: [6, 12], smart: 0.5 },
  master: { loud: 0.55, imp: 1.3, see: 19, notice: 0.24, dev: 1.3, confirm: 1.6, probe: 0.75, sprint: 0.03, rt: 0.75, rtSd: 0.14, miss: 0.01, low: 35, rest: [12, 24], first: [20, 42], confuse: 0.2, misread: 0.05, lose: 0.2, fp: 0.008, decay: 0.05, watch: [8, 14], smart: 1 },
};
// Behaviours for the balance harness: a bot that never leaves its slot, and one that unmasks anything in reach.
export const STYLES = { normal: 0, patient: 1, brute: 2 };

export function createBot(S, id, x, z, h) {
  const m = S.r.m[id];
  const P = SKILL[m.sk] || SKILL.adept;
  return {
    id,
    P,
    R: rng(hash32('bot', S.r.seed, id, S.r.n)),
    mv: Object.assign(makeMover(x, z, h), { locked: true }),
    style: STYLES.normal,
    mode: 'rest',
    until: -1,
    susp: new Map(),
    target: null,
    probe: null,
    goal: null,
    repath: 0,
    sprintTrip: false,
    pending: [],
    seenEv: 0,
    lantern: new Set(),
  };
}

const keyOf = (ref) => (ref.k === 'n' ? `n${ref.s}` : `${ref.k}:${ref.id}`);
const refOfKey = (k) => (k[0] === 'n' ? { k: 'n', s: Number(k.slice(1)) } : { k: k[0], id: k.slice(2) });

/**
 * Runs every bot for one step. ctx: { plaza, crowd (buffer at t), count, skip (Uint8Array of slots with no reveller),
 * slotPos(id, out) -> {x, z, h, sp}, act: { unmask(id, ref, pose), greet(id, ref), ability(id, ab, params), answer(id, g, delay) } }.
 */
export function botsTick(S, bots, t, dt, ctx) {
  const st = stage(S, t);
  for (const B of bots) {
    const m = S.r.m[B.id];
    if (!m || m.gone) continue;
    // Answers that are due (to a greeting or a lantern).
    for (let i = B.pending.length - 1; i >= 0; i--) {
      const p = B.pending[i];
      if (t >= p.at) {
        B.pending.splice(i, 1);
        if (!isOut(S, B.id, t)) ctx.act.answer(B.id, p.g, p.delay);
      }
    }
    if (isOut(S, B.id, t)) {
      B.mv.locked = true;
      B.mode = 'rest';
      B.until = t + 4;
      B.susp.clear();
      B.target = null;
      continue;
    }
    observe(S, B, t, dt, ctx);
    if (S.r.mode === 'spot' && m.imp) errands(S, B, t, ctx, st);
    else decide(S, B, t, ctx, st);
    move(S, B, t, dt, ctx);
  }
}

function answerLater(B, g, P) {
  let delay = P.rt + B.R.gauss(0, P.rtSd);
  if (B.R.chance(P.miss)) delay = -1;
  else delay = Math.max(0.12, delay);
  B.pending.push({ g, delay, at: B.lastT + (delay < 0 ? 1.6 : Math.min(delay, 1.6)) });
}

function observe(S, B, t, dt, ctx) {
  const P = B.P;
  const R = B.R;
  const m = S.r.m[B.id];
  B.lastT = t;
  // A new quarry (or a new costume to look for): yesterday's suspects mean nothing now.
  const qKey = S.r.mode === 'masq' ? `${S.intel[B.id]?.q}:${S.intel[B.id]?.tr}` : 'case';
  if (qKey !== B.qKey) {
    B.qKey = qKey;
    B.susp.clear();
    B.target = null;
    B.probe = null;
    B.probed = null;
    if (B.mode === 'strike') B.mode = 'hunt';
  }
  const me = B.mv;
  const qTrs = wantedTroupes(S, B.id);
  const plaza = ctx.plaza;
  // Events: greetings aimed at me, what others did in plain sight, how my own probes were answered.
  for (const ev of S.ev) {
    if (ev.q <= B.seenEv) continue;
    if (ev.k === 'greet' && ev.b === B.id) answerLater(B, ev.q, P);
    const actor = ev.a && ev.a !== B.id ? ev.a : null;
    if (actor && (ev.k === 'greet' || ev.k === 'unmask' || ev.k === 'faux' || ev.k === 'wrong' || ev.k in ABILITIES)) {
      const ap = S.pos?.[actor];
      if (ap && dist(ap.x, ap.z, me.x, me.z) < P.see && S.r.m[actor] && qTrs.has(S.r.m[actor].tr)) bump(B, `p:${actor}`, ev.k === 'greet' ? 1.1 : ev.k in ABILITIES ? 1.3 : 1.8);
      if (ap && dist(ap.x, ap.z, me.x, me.z) < 5 && P.smart > 0 && (ev.k === 'greet' || ev.k === 'faux')) B.threat = { x: ap.x, z: ap.z, until: t + 6 };
    }
    if (ev.k === 'answer' && B.probe && ev.g === B.probe.g) {
      const k = B.probe.key;
      if (ev.v !== 'ok') bump(B, k, 4);
      else B.susp.set(k, Math.max(0, (B.susp.get(k) || 0) - 0.4));
      B.probe = null;
    }
  }
  B.seenEv = S.seq;
  // Lanterns landing near me want a look, like a greeting does.
  for (const f of S.fx) {
    if (f.k === 'lantern' && f.owner !== B.id && !B.lantern.has(f.id) && t - f.t < 0.3 && dist(f.x, f.z, me.x, me.z) < ABILITIES.lantern.radius) {
      B.lantern.add(f.id);
      answerLater(B, -1, P);
    }
  }
  if (!qTrs.size) return;
  // Tells from other maskers: deviation from their troupe's formation, sprint dust, shimmer, a slipped mask. Where I
  // look matters: watching I see the most, walking I mostly watch my feet, in step I keep up appearances.
  const n = S.r.crowd;
  // A packed crowd splits your attention over more figures; a light one makes everyone easier to read.
  const attention = (B.mode === 'watch' || B.mode === 'strike' ? 1 : me.locked ? 0.45 : 0.4) * (9 / n);
  const seeShimmer = m.ab.includes('opera') && B.mode === 'watch' ? SEEN.shimmerOpera : SEEN.shimmer;
  for (const [id, om] of Object.entries(S.r.m)) {
    if (id === B.id || om.gone || isOut(S, id, t)) continue;
    const p = S.pos?.[id];
    if (!p) continue;
    const d = dist(p.x, p.z, me.x, me.z);
    if (d > Math.max(P.see * 2, SEEN.slip)) continue;
    if (!lineOfSight(plaza, me.x, me.z, p.x, p.z) || smokeBetween(S, t, me.x, me.z, p.x, p.z)) continue;
    const rs = S.rs[id];
    let rate = 0;
    if (qTrs.has(om.tr)) {
      let dev = Infinity;
      for (let sl = 0; sl < n; sl++) {
        const o = (om.tr * n + sl) * STRIDE;
        dev = Math.min(dev, dist(p.x, p.z, ctx.crowd[o], ctx.crowd[o + 1]));
      }
      // A lone costume far from its troupe stands out from much further away than one shuffling at its edge.
      const range = P.see * (1 + Math.min(dev, 12) / 12);
      const vis = d > range ? 0 : Math.max(0.3, 1 - d / range);
      // How a figure moves matters too: a beginner walks like a person, a master like a reveller (players count as 1).
      const sk = SKILL[om.sk] || SKILL.adept;
      const loud = om.b ? (om.imp ? sk.imp : sk.loud) : 1;
      rate += P.notice * vis * loud * Math.max(0, Math.min(1, (dev - P.dev) / 2));
    }
    if (p.f & FLAG.sprint && d <= SEEN.dust) rate += 0.9;
    if (rs && rs.fl > t && d <= seeShimmer) rate += 0.8;
    if (rs && rs.sl > t && d <= SEEN.slip) rate += 1.4;
    if (rate > 0 && R.chance(rate * attention * dt)) {
      if (qTrs.has(om.tr)) {
        // A beginner often pins what they saw on the wrong one of a cluster of look-alikes.
        let pinned = `p:${id}`;
        if (R.chance(P.misread)) {
          for (let sl = 0; sl < n; sl++) {
            const s = om.tr * n + sl;
            if (ctx.skip[s]) continue;
            const o = s * STRIDE;
            if (dist(p.x, p.z, ctx.crowd[o], ctx.crowd[o + 1]) < 2.2) {
              pinned = `n${s}`;
              break;
            }
          }
        }
        bump(B, pinned, 1);
      }
      else if (d < 5 && P.smart > 0) B.threat = { x: p.x, z: p.z, until: t + 5 };
    }
  }
  // Misreading the dance: now and then a perfectly ordinary reveller looks wrong.
  if (R.chance(P.fp * dt)) {
    const sl = R.int(n);
    const s = R.pick([...qTrs]) * n + sl;
    if (!ctx.skip[s]) {
      const o = s * STRIDE;
      if (dist(ctx.crowd[o], ctx.crowd[o + 1], me.x, me.z) < P.see) bump(B, `n${s}`, 1);
    }
  }
  // Losing track: a suspect who stands among look-alikes can be swapped for one of them in my mind.
  for (const [k, v] of B.susp) {
    if (v <= 0.05) {
      B.susp.delete(k);
      continue;
    }
    B.susp.set(k, v * (1 - P.decay * dt));
    if (k[0] !== 'p') continue;
    const id = k.slice(2);
    const p = S.pos?.[id];
    const om = S.r.m[id];
    if (!p || !om) continue;
    let near = -1;
    let count = 0;
    for (let sl = 0; sl < n; sl++) {
      const s = om.tr * n + sl;
      if (ctx.skip[s]) continue;
      const o = s * STRIDE;
      if (dist(p.x, p.z, ctx.crowd[o], ctx.crowd[o + 1]) < 1.4) {
        count++;
        near = s;
      }
    }
    if (count >= 2 && R.chance(P.lose * dt)) {
      B.susp.delete(k);
      bump(B, `n${near}`, v);
      if (B.target === k) B.target = `n${near}`;
    }
  }
}

/** The troupes I am looking for: my quarry's (Masquerade), or the case file's unfound impostors' (Spot the Mask). */
function wantedTroupes(S, id) {
  const out = new Set();
  if (S.r.mode === 'masq') {
    const intel = S.intel[id];
    if (intel && intel.q) out.add(intel.tr);
  } else if (S.case && !S.r.m[id].imp) {
    for (const imp of S.case.imps) if (!S.r.m[imp].gone && S.case.clues[imp]) out.add(S.case.clues[imp].tr);
  }
  return out;
}

function bump(B, key, by) {
  B.susp.set(key, Math.min(6, (B.susp.get(key) || 0) + by));
}

function figurePos(S, key, ctx, t, out) {
  const ref = refOfKey(key);
  if (ref.k === 'n') {
    if (ctx.skip[ref.s]) return null;
    out.x = ctx.crowd[ref.s * STRIDE];
    out.z = ctx.crowd[ref.s * STRIDE + 1];
    return out;
  }
  const p = S.pos?.[ref.id];
  if (!p || isOut(S, ref.id, t)) return null;
  out.x = p.x;
  out.z = p.z;
  return out;
}

const T = { x: 0, z: 0 };

function decide(S, B, t, ctx, st) {
  const P = B.P;
  const R = B.R;
  const rs = S.rs[B.id];
  const me = B.mv;
  B.sprintNow = false;
  if (st === 'assign' || st === 'blend' || st === 'reveal' || st === 'results' || st === 'over') {
    B.mode = 'rest';
    B.goal = null;
    return;
  }
  if (B.style === STYLES.patient) {
    B.mode = 'rest';
    return;
  }
  if (B.style === STYLES.brute) return brute(S, B, t, ctx);
  const hush = st === 'hush';
  // Out of breath: back to my slot to recover.
  if (rs.fl > t || (rs.p < P.low && B.mode !== 'rest')) {
    B.mode = 'rest';
    B.until = t + R.range(P.rest[0], P.rest[1]);
    B.goal = null;
  }
  if (B.threat && B.threat.until > t && dist(B.threat.x, B.threat.z, me.x, me.z) < 4.5 && P.smart > 0) {
    const m = S.r.m[B.id];
    if (m.ab.includes('smoke') && R.chance(P.smart * 0.4)) ctx.act.ability(B.id, 'smoke', { x: me.x, z: me.z });
    if (B.mode !== 'rest' && R.chance(0.5 * P.smart)) {
      B.mode = 'rest';
      B.until = t + R.range(P.rest[0], P.rest[1]);
    }
    B.threat = null;
  }
  // The best suspect.
  let topK = null;
  let topV = 0;
  for (const [k, v] of B.susp) {
    if (v > topV) {
      topV = v;
      topK = k;
    }
  }
  const need = hush ? Math.min(P.confirm, 1) : P.confirm;
  if (topK && topV >= need && rs.p >= POISE.unmaskCost && rs.fl <= t && t >= rs.cu) {
    const at = figurePos(S, topK, ctx, t, T);
    if (at && (B.mode !== 'rest' || dist(at.x, at.z, me.x, me.z) < 6)) {
      B.mode = 'strike';
      B.target = topK;
    }
  }
  if (B.mode === 'rest') {
    // The first trip of the round waits a while: nobody bolts the moment the hunt opens.
    if (B.until < 0) B.until = S.timing.huntStart + R.range(P.first[0], P.first[1]);
    if (rs.p >= 85 && t >= B.until && !hush) {
      B.mode = 'hunt';
      B.goal = null;
      B.sprintTrip = R.chance(P.sprint);
      const m = S.r.m[B.id];
      if (m.ab.includes('decoy') && P.smart > 0 && R.chance(P.smart)) ctx.act.ability(B.id, 'decoy', { x: me.x, z: me.z });
    }
    return;
  }
  if (hush && B.mode !== 'strike') {
    // Everyone freezes in the Hush: a moving figure is a giveaway.
    B.goal = null;
    return;
  }
  if (B.mode === 'strike') return strike(S, B, t, ctx);
  hunt(S, B, t, ctx);
}

function strike(S, B, t, ctx) {
  const P = B.P;
  const R = B.R;
  const me = B.mv;
  const at = figurePos(S, B.target, ctx, t, T);
  if (!at) {
    B.susp.delete(B.target);
    B.mode = 'hunt';
    B.target = null;
    return;
  }
  const d = dist(at.x, at.z, me.x, me.z);
  const v = B.susp.get(B.target) || 0;
  // Not sure yet and close enough to wave: a greeting will tell.
  if (!B.probe && v < P.confirm + 1 && d < GREET.range - 0.5 && !B.probed?.has(B.target) && t >= S.rs[B.id].cg) {
    B.probed = B.probed || new Set();
    B.probed.add(B.target);
    if (R.chance(P.probe)) {
      const ev = ctx.act.greet(B.id, refOfKey(B.target));
      if (ev && ev.q) B.probe = { g: ev.q, key: B.target, until: t + 1.8 };
      return;
    }
  }
  if (B.probe && t < B.probe.until) return;
  B.probe = null;
  if (d > UNMASK.range - 0.5) {
    B.goal = [at.x, at.z];
    B.close = 1.6;
    return;
  }
  B.goal = null;
  const want = Math.atan2(at.x - me.x, at.z - me.z);
  if (Math.abs(wrap(want - me.h)) > 0.6) {
    B.face = want;
    return;
  }
  // In a cluster of look-alikes the fan can find the wrong face.
  let ref = refOfKey(B.target);
  if (ref.k === 'p') {
    const om = S.r.m[ref.id];
    const n = S.r.crowd;
    const near = [];
    for (let sl = 0; sl < n; sl++) {
      const s = om.tr * n + sl;
      if (ctx.skip[s]) continue;
      const o = s * STRIDE;
      if (dist(at.x, at.z, ctx.crowd[o], ctx.crowd[o + 1]) < 1.1) near.push(s);
    }
    if (near.length && R.chance(P.confuse)) ref = { k: 'n', s: R.pick(near) };
  }
  ctx.act.unmask(B.id, ref, { x: me.x, z: me.z, h: me.h });
  B.susp.delete(B.target);
  B.target = null;
  B.mode = 'rest';
  B.until = t + R.range(P.rest[0], P.rest[1]) * 0.6;
}

function hunt(S, B, t, ctx) {
  const P = B.P;
  const R = B.R;
  const me = B.mv;
  let intel = S.intel[B.id];
  if (S.r.mode === 'spot' && S.case) {
    // The case file: the freshest clue about an impostor still at large.
    let best = null;
    for (const imp of S.case.imps) {
      const c = S.case.clues[imp];
      if (!S.r.m[imp].gone && c && (!best || c.at > best.at)) best = c;
    }
    intel = best ? { q: 'case', tr: best.tr, d: best.d, at: best.at } : null;
  }
  if (!intel || !intel.q) {
    B.mode = 'rest';
    B.until = t + 3;
    return;
  }
  const plaza = ctx.plaza;
  const n = S.r.crowd;
  // Where the quarry's troupe is now (anyone can see it), and where the clue says the quarry is.
  let cx = 0;
  let cz = 0;
  for (let sl = 0; sl < n; sl++) {
    const o = (intel.tr * n + sl) * STRIDE;
    cx += ctx.crowd[o];
    cz += ctx.crowd[o + 1];
  }
  cx /= n;
  cz /= n;
  let ax = cx;
  let az = cz;
  if (intel.d >= 0 && t - intel.at < 30) {
    const dTroupe = districtAt(plaza, cx, cz);
    if (dTroupe !== intel.d) {
      const c = plaza.districts[intel.d].at[0];
      ax = c[0];
      az = c[1];
    }
  }
  const d = dist(ax, az, me.x, me.z);
  if (B.mode === 'watch') {
    if (t >= B.until || d > 11) {
      B.mode = 'hunt';
      B.goal = null;
    } else {
      // Once a watch: toss a lantern into a crowd of the quarry's troupe (whoever doesn't look is no reveller), or slip
      // into a nearby troupe with a swap to watch from in step.
      const m = S.r.m[B.id];
      if (B.plan === 'lantern' && t >= B.planAt) {
        B.plan = null;
        if (m.ab.includes('lantern')) ctx.act.ability(B.id, 'lantern', { x: me.x, z: me.z, tx: cx, tz: cz });
      } else if (B.plan === 'swap' && t >= B.planAt) {
        B.plan = null;
        if (m.ab.includes('swap')) ctx.act.ability(B.id, 'swap', { x: me.x, z: me.z });
      }
      return;
    }
  }
  if (d < 6.5) {
    B.mode = 'watch';
    B.until = t + R.range(P.watch[0], P.watch[1]);
    B.goal = null;
    B.face = Math.atan2(cx - me.x, cz - me.z);
    const m = S.r.m[B.id];
    B.plan = null;
    if (P.smart > 0 && m.ab.includes('lantern') && R.chance(0.35 * P.smart)) B.plan = 'lantern';
    else if (P.smart > 0.6 && m.ab.includes('swap') && R.chance(0.3)) B.plan = 'swap';
    B.planAt = t + R.range(1.5, 4);
    return;
  }
  // Keep a little way off the troupe, on my side of it.
  const off = Math.min(4.5, d);
  B.goal = [ax + ((me.x - ax) / d) * off, az + ((me.z - az) / d) * off];
  B.close = 1;
  B.sprintNow = B.sprintTrip && d > 16 && S.rs[B.id].p > 55;
}

function brute(S, B, t, ctx) {
  const me = B.mv;
  const rs = S.rs[B.id];
  if (rs.p < POISE.unmaskCost || rs.fl > t || t < rs.cu) {
    B.mode = 'rest';
    B.goal = null;
    return;
  }
  // Fan at whoever is nearest in front, then wander on.
  let best = null;
  let bestD = UNMASK.range - 0.4;
  const n = S.r.crowd;
  for (let s = 0; s < TROUPES.length * n; s++) {
    if (ctx.skip[s]) continue;
    const o = s * STRIDE;
    const d = dist(ctx.crowd[o], ctx.crowd[o + 1], me.x, me.z);
    if (d < bestD) {
      bestD = d;
      best = { k: 'n', s };
    }
  }
  for (const id of Object.keys(S.r.m)) {
    if (id === B.id || isOut(S, id, t)) continue;
    const p = S.pos?.[id];
    if (p && dist(p.x, p.z, me.x, me.z) < bestD) {
      bestD = dist(p.x, p.z, me.x, me.z);
      best = { k: 'p', id };
    }
  }
  B.mode = 'hunt';
  if (best) {
    const at = best.k === 'n' ? { x: ctx.crowd[best.s * STRIDE], z: ctx.crowd[best.s * STRIDE + 1] } : S.pos[best.id];
    me.h = Math.atan2(at.x - me.x, at.z - me.z);
    ctx.act.unmask(B.id, best, { x: me.x, z: me.z, h: me.h });
  } else if (!B.goal) {
    const a = B.R.pick(ctx.plaza.anchors);
    B.goal = [a[0], a[1]];
  }
}

/** Spot the Mask impostors: rest in step, then slip away on an errand across the plaza, then come back. */
function errands(S, B, t, ctx, st) {
  const P = B.P;
  const R = B.R;
  const me = B.mv;
  B.sprintNow = false;
  const alert = S.case?.alert && S.case.alert.until > t && dist(S.case.alert.x, S.case.alert.z, me.x, me.z) < SEEN.slip;
  if (st !== 'hunt' && st !== 'blend' && st !== 'hush') {
    B.mode = 'rest';
    B.goal = null;
    return;
  }
  if (st === 'hush' || alert) {
    if (B.mode === 'errand' && alert) B.mode = 'rest';
    B.goal = null;
    if (alert) B.until = Math.max(B.until, t + 4);
    return;
  }
  if (B.mode === 'rest') {
    if (t >= B.until && st === 'hunt') {
      const pace = { novice: [5, 11], adept: [14, 26], master: [16, 28] }[S.r.skill] || [14, 26];
      const plaza = ctx.plaza;
      const here = districtAt(plaza, me.x, me.z);
      const options = plaza.anchors.filter(([x, z]) => districtAt(plaza, x, z) !== here);
      const a = R.pick(options.length ? options : plaza.anchors);
      B.mode = 'errand';
      B.goal = [a[0] + R.range(-2, 2), a[1] + R.range(-2, 2)];
      B.close = 0.8;
      B.sprintTrip = R.chance(P.sprint);
      B.next = pace;
      const m = S.r.m[B.id];
      if (m.ab.includes('decoy') && P.smart > 0 && R.chance(0.5 * P.smart)) ctx.act.ability(B.id, 'decoy', { x: me.x, z: me.z });
    }
    return;
  }
  if (B.mode === 'errand') {
    B.sprintNow = B.sprintTrip && S.rs[B.id].p > 40;
    if (!B.goal || dist(B.goal[0], B.goal[1], me.x, me.z) < 1.2) {
      B.mode = 'loiter';
      B.until = t + R.range(3, 7);
      B.goal = null;
      const m = S.r.m[B.id];
      if (m.ab.includes('swap') && S.r.skill === 'master' && R.chance(0.6)) ctx.act.ability(B.id, 'swap', { x: me.x, z: me.z });
    }
    return;
  }
  if (B.mode === 'loiter' && t >= B.until) {
    B.mode = 'rest';
    B.until = t + R.range(B.next?.[0] ?? 12, B.next?.[1] ?? 24);
  }
}

const SLOT = { x: 0, z: 0, h: 0, sp: 0 };
const INPUT = { dx: 0, dz: 0, sprint: false, steer: false };

function move(S, B, t, dt, ctx) {
  const me = B.mv;
  const slot = ctx.slotPos(B.id, SLOT);
  INPUT.dx = 0;
  INPUT.dz = 0;
  INPUT.sprint = false;
  INPUT.steer = false;
  const resting = B.mode === 'rest';
  if (resting && slot) {
    // Walk home to my slot; within a step, fall in.
    const d = dist(slot.x, slot.z, me.x, me.z);
    if (!me.locked && d > 0.8) {
      if (!me.path || t >= B.repath) {
        me.path = walkPath(ctx.plaza, me.x, me.z, slot.x, slot.z);
        me.pathI = 0;
        B.repath = t + 1.5;
      }
      INPUT.steer = followPath(me, INPUT);
    }
  } else if (B.goal) {
    const d = dist(B.goal[0], B.goal[1], me.x, me.z);
    if (d > (B.close ?? 1)) {
      if (!me.path || t >= B.repath) {
        me.path = walkPath(ctx.plaza, me.x, me.z, B.goal[0], B.goal[1]);
        me.pathI = 0;
        B.repath = t + 1.2;
      }
      INPUT.steer = followPath(me, INPUT);
      INPUT.sprint = !!B.sprintNow;
    } else me.path = null;
  } else if (B.mode !== 'rest' && (B.mode === 'watch' || B.mode === 'strike' || B.mode === 'loiter')) {
    // Standing out of step, turning to look.
    INPUT.steer = true;
    if (B.face !== undefined && B.face !== null) {
      me.h = me.h + wrap(B.face - me.h) * Math.min(1, dt * 5);
    }
  }
  if (!INPUT.steer && !resting && !me.locked) INPUT.steer = true;
  stepMover(me, INPUT, dt, {
    plaza: ctx.plaza,
    slot,
    canLock: resting && !S.fx.some((f) => f.k === 'decoy' && f.owner === B.id && f.until > t),
    crowd: ctx.crowd,
    count: ctx.count,
    skip: ctx.skip,
    others: null,
    sprintOk: S.rs[B.id].p > 0 && S.rs[B.id].fl <= t,
  });
}

export { refOfKey, keyOf, WALK };

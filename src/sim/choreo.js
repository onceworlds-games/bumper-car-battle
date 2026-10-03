// Choreography: each troupe's two-minute script, seeded per round, and where every reveller is at any moment.
// A script is a cycle of stops (gather, pose, dance, admire) at open anchors joined by legs (a file walking a path, or a
// ring/V formation on a promenade loop). Every position is a pure function of time, so every page draws the same crowd
// with no network, and a human shows up as a deviation from it.
import { hash32, rng } from './rng.js';
import { WALK, SCRIPT_S, TROUPES } from './const.js';
import { troupePath, pathAt, navFor } from './nav.js';
import { TAU, wrap, lerpAngle, smooth, clamp } from './geom.js';

export const EM = { none: 0, bow: 1, wave: 2, sip: 3, juggle: 4, clap: 5, spin: 6, admire: 7, lookup: 8, gasp: 9, flick: 10, stiff: 11, eager: 12, point: 13, flourish: 14 };
const POSE_EMOTES = [EM.bow, EM.wave, EM.sip, EM.juggle, EM.clap];
const ACCEL = 0.35; // seconds to reach walking pace
const FORM_T = 3; // seconds to form up or break formation on a promenade
const FILE_GAP = 1.15;

/** Distance covered after time tau on a trapezoid: accelerate, cruise at v, decelerate, total U. */
function trap(tau, U, v) {
  if (tau <= 0 || U <= 0) return 0;
  const T = U / v + ACCEL;
  if (tau >= T) return U;
  const a = v / ACCEL;
  if (tau < ACCEL) return Math.min(U, 0.5 * a * tau * tau);
  const left = T - tau;
  if (left < ACCEL) return Math.max(0, U - 0.5 * a * left * left);
  return Math.min(U, 0.5 * v * ACCEL + v * (tau - ACCEL));
}

/** Base spots (and facings) for a stop's layout around an anchor, all within 2.6 m. */
function layout(kind, n, ax, az, R, focus) {
  const spots = [];
  const faces = [];
  const toFocus = focus ? Math.atan2(focus.x - ax, focus.z - az) : R.range(-Math.PI, Math.PI);
  if (kind === 'gather') {
    // A sunflower disk: even spacing, no grid.
    const rot = R.range(0, TAU);
    for (let i = 0; i < n; i++) {
      const r = 1.65 * Math.sqrt((i + 0.5) / n);
      const a = rot + i * 2.39996;
      spots.push([ax + Math.sin(a) * r, az + Math.cos(a) * r]);
      faces.push(Math.atan2(ax - spots[i][0], az - spots[i][1]));
    }
  } else if (kind === 'pose') {
    const r = Math.max(1.05, (n * 0.95) / TAU);
    const rot = R.range(0, TAU);
    const inward = R.chance(0.35);
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      spots.push([ax + Math.sin(a) * r, az + Math.cos(a) * r]);
      faces.push(inward ? wrap(a + Math.PI) : a);
    }
  } else if (kind === 'dance') {
    const pairs = Math.ceil(n / 2);
    const rc = pairs <= 1 ? 0 : Math.max(1.0, (pairs * 1.25) / TAU);
    const rot = R.range(0, TAU);
    for (let i = 0; i < n; i++) {
      const p = Math.floor(i / 2);
      const a = rot + (p / pairs) * TAU;
      const pcx = ax + Math.sin(a) * rc;
      const pcz = az + Math.cos(a) * rc;
      const side = i % 2 ? Math.PI : 0;
      spots.push([pcx + Math.sin(a + side + Math.PI / 2) * 0.5, pcz + Math.cos(a + side + Math.PI / 2) * 0.5]);
      faces.push(Math.atan2(pcx - spots[i][0], pcz - spots[i][1]));
    }
  } else {
    // Admire: one or two rows across the line to the landmark, facing it.
    const perRow = n > 7 ? Math.ceil(n / 2) : n;
    const fx = Math.sin(toFocus);
    const fz = Math.cos(toFocus);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow);
      const k = i % perRow;
      const count = Math.min(perRow, n - row * perRow);
      const lat = (k - (count - 1) / 2) * 0.88;
      const back = row * 1.0 - (n > 7 ? 0.5 : 0);
      spots.push([ax + fz * lat - fx * back, az - fx * lat - fz * back]);
      faces.push(toFocus);
    }
  }
  return { spots, faces };
}

/** Builds a stop: its layout, emote and per-member wiggles. Start and end spots are its base spots. */
function makeStop(kind, anchorIdx, plaza, n, R, dur) {
  const [ax, az] = plaza.anchors[anchorIdx];
  let focus = null;
  if (kind === 'admire') {
    let best = Infinity;
    for (const f of plaza.focus) {
      const d = Math.sqrt((f.x - ax) ** 2 + (f.z - az) ** 2);
      if (d > 4 && d < best) {
        best = d;
        focus = f;
      }
    }
  }
  const { spots, faces } = layout(kind, n, ax, az, R, focus);
  const stop = { k: kind, anchor: anchorIdx, ax, az, spots, faces, dur, focus, em: EM.none, period: 0, offs: [], wig: [], waves: [] };
  for (let i = 0; i < n; i++) stop.offs.push(R.range(0, 0.12));
  if (kind === 'pose') {
    stop.em = R.pick(POSE_EMOTES);
    stop.period = { [EM.bow]: 3.2, [EM.wave]: 2.6, [EM.sip]: 4.2, [EM.juggle]: 2.4, [EM.clap]: 1.3 }[stop.em];
  } else if (kind === 'dance') {
    stop.em = EM.spin;
    stop.spinDir = R.chance(0.5) ? 1 : -1;
  } else if (kind === 'admire') {
    stop.em = EM.admire;
    for (let i = 0; i < n; i++) stop.waves.push(R.chance(0.5) ? R.range(1.5, 6) : -1);
  } else {
    for (let i = 0; i < n; i++) {
      stop.wig.push([R.range(0.25, 0.55), R.range(0.18, 0.42), R.range(0, TAU), R.range(0, TAU), R.range(0.3, 0.55), R.range(0.2, 0.45)]);
      stop.waves.push(R.chance(0.6) ? R.range(2.5, 9) : -1);
    }
  }
  return stop;
}

/** The block's facing: the chord across 14 m of path, so a formation wheels round a corner instead of whipping. */
const chordDir = (path, s, tmpA, tmpB) => {
  pathAt(path, s - 7, tmpA);
  pathAt(path, s + 7, tmpB);
  return Math.atan2(tmpB.x - tmpA.x, tmpB.z - tmpA.z);
};

/** A leg between two stops along a path. File legs follow the path one by one; formation legs move as a block. */
function makeLeg(path, from, to, n, form, R) {
  const p0 = { x: 0, z: 0, tx: 0, tz: 0 };
  const p1 = { x: 0, z: 0, tx: 0, tz: 0 };
  const leg = { k: form === 'file' || form === 'shuffle' ? form : 'form', form, path, from: from.spots, to: to.spots, hFrom: from.faces, hTo: to.faces, n };
  if (path) {
    pathAt(path, 0, p0);
    pathAt(path, path.len, p1);
  }
  if (form === 'shuffle') {
    // Same anchor, new layout: everyone steps straight to their new spot (both spots lie in the anchor's clear disk).
    leg.u = new Float64Array(n);
    let far = 0;
    for (let i = 0; i < n; i++) {
      leg.u[i] = Math.sqrt((to.spots[i][0] - from.spots[i][0]) ** 2 + (to.spots[i][1] - from.spots[i][1]) ** 2);
      far = Math.max(far, leg.u[i]);
    }
    leg.dur = far / WALK + ACCEL + 0.4;
    return leg;
  }
  if (form === 'file') {
    // Who leaves first: the one nearest the path's start. Delays keep the file spaced and nobody leaves early.
    const order = [...Array(n).keys()].sort((a, b) => {
      const da = (from.spots[a][0] - p0.x) ** 2 + (from.spots[a][1] - p0.z) ** 2;
      const db = (from.spots[b][0] - p0.x) ** 2 + (from.spots[b][1] - p0.z) ** 2;
      return da - db || a - b;
    });
    leg.a = new Float64Array(n);
    leg.b = new Float64Array(n);
    leg.d = new Float64Array(n);
    let prev = -Infinity;
    for (const i of order) {
      leg.a[i] = Math.sqrt((from.spots[i][0] - p0.x) ** 2 + (from.spots[i][1] - p0.z) ** 2);
      leg.b[i] = Math.sqrt((to.spots[i][0] - p1.x) ** 2 + (to.spots[i][1] - p1.z) ** 2);
      leg.d[i] = Math.max(prev + FILE_GAP, leg.a[i]);
      prev = leg.d[i];
    }
    let end = 0;
    for (let i = 0; i < n; i++) end = Math.max(end, (leg.d[i] - leg.a[i]) / WALK + (leg.a[i] + path.len + leg.b[i]) / WALK + ACCEL);
    leg.dur = end + 0.4;
  } else {
    // Formation offsets (back, side) around the block's centre; the block forms up, walks the loop, then breaks.
    const offs = [];
    if (form === 'ring') {
      const r = Math.max(1.0, (n * 0.86) / TAU);
      for (let i = 0; i < n; i++) offs.push([Math.cos((i / n) * TAU) * r, Math.sin((i / n) * TAU) * r]);
      leg.spin = R.chance(0.5) ? 0.22 : -0.22;
    } else {
      for (let i = 0; i < n; i++) {
        const row = Math.ceil(i / 2);
        const side = i === 0 ? 0 : i % 2 ? 1 : -1;
        offs.push([-row * 0.92, side * Math.min(row, 3) * 0.6]);
      }
      const mid = offs.reduce((s, o) => s + o[0], 0) / n;
      for (const o of offs) o[0] -= mid;
      leg.spin = 0;
    }
    leg.offs = offs;
    leg.travel = path.len / WALK + ACCEL;
    leg.dur = FORM_T + leg.travel + FORM_T;
  }
  return leg;
}

/** Writes the position of member i of a leg at local time tau into out ({x, z, h}). */
function legAt(leg, i, tau, out, tmpA, tmpB) {
  const P = leg.path;
  if (leg.k === 'shuffle') {
    const U = leg.u[i];
    const u = trap(tau, U, WALK);
    const t = U > 1e-6 ? u / U : 1;
    out.x = leg.from[i][0] + (leg.to[i][0] - leg.from[i][0]) * t;
    out.z = leg.from[i][1] + (leg.to[i][1] - leg.from[i][1]) * t;
    out.face = u <= 0 ? leg.hFrom[i] : u >= U ? leg.hTo[i] : NaN;
    out.restH = t < 0.5 ? leg.hFrom[i] : leg.hTo[i];
    return out;
  }
  if (leg.k === 'file') {
    const a = leg.a[i];
    const U = a + P.len + leg.b[i];
    const u = trap(tau - (leg.d[i] - a) / WALK, U, WALK);
    if (u <= a) {
      const t = a > 1e-6 ? u / a : 1;
      pathAt(P, 0, tmpA);
      out.x = leg.from[i][0] + (tmpA.x - leg.from[i][0]) * t;
      out.z = leg.from[i][1] + (tmpA.z - leg.from[i][1]) * t;
    } else if (u <= a + P.len) {
      pathAt(P, u - a, tmpA);
      out.x = tmpA.x;
      out.z = tmpA.z;
    } else {
      const t = leg.b[i] > 1e-6 ? (u - a - P.len) / leg.b[i] : 1;
      pathAt(P, P.len, tmpA);
      out.x = tmpA.x + (leg.to[i][0] - tmpA.x) * t;
      out.z = tmpA.z + (leg.to[i][1] - tmpA.z) * t;
    }
    out.face = u <= 0 ? leg.hFrom[i] : u >= U ? leg.hTo[i] : NaN;
    out.restH = u < a + P.len / 2 ? leg.hFrom[i] : leg.hTo[i];
    return out;
  }
  // Formation: the block's centre and facing, then this member's slot in it.
  const s = trap(tau - FORM_T, P.len, WALK);
  pathAt(P, s, tmpA);
  const cxp = tmpA.x;
  const czp = tmpA.z;
  const dir = chordDir(P, s, tmpA, tmpB);
  const spinA = leg.spin * Math.max(0, Math.min(tau, leg.dur) - FORM_T);
  const o = leg.offs[i];
  const ca = Math.cos(spinA);
  const sa = Math.sin(spinA);
  const back = o[0] * ca - o[1] * sa;
  const side = o[0] * sa + o[1] * ca;
  const fx = Math.sin(dir);
  const fz = Math.cos(dir);
  const sx = cxp + fx * back + fz * side;
  const sz = czp + fz * back - fx * side;
  const wIn = smooth(tau / FORM_T);
  const wOut = smooth((leg.dur - tau) / FORM_T);
  let x = sx;
  let z = sz;
  if (tau < FORM_T) {
    x = leg.from[i][0] + (sx - leg.from[i][0]) * wIn;
    z = leg.from[i][1] + (sz - leg.from[i][1]) * wIn;
  } else if (leg.dur - tau < FORM_T) {
    x = leg.to[i][0] + (sx - leg.to[i][0]) * wOut;
    z = leg.to[i][1] + (sz - leg.to[i][1]) * wOut;
  }
  out.x = x;
  out.z = z;
  let face = dir;
  if (tau < FORM_T) face = lerpAngle(leg.hFrom[i], dir, wIn);
  else if (leg.dur - tau < FORM_T) face = lerpAngle(leg.hTo[i], dir, wOut);
  out.face = face;
  out.restH = face;
  return out;
}

/** Where member i of a stop is at local time tau, its facing and its emote. */
function stopAt(stop, i, tau, out) {
  const [bx, bz] = stop.spots[i];
  out.x = bx;
  out.z = bz;
  out.h = stop.faces[i];
  out.em = stop.em;
  out.et = 0;
  const D = stop.dur;
  if (stop.k === 'gather') {
    const env = smooth(tau / 2) * smooth((D - tau) / 2);
    const w = stop.wig[i];
    out.x = bx + env * (w[0] * Math.sin(w[4] * tau + w[2]) + w[1] * Math.sin(w[5] * tau * 1.7 + w[3]));
    out.z = bz + env * (w[0] * Math.cos(w[5] * tau + w[3]) + w[1] * Math.sin(w[4] * tau * 1.3 + w[2]));
    out.h = Math.atan2(stop.ax - out.x, stop.az - out.z);
    const wt = stop.waves[i];
    if (wt >= 0 && wt < D - 2 && tau >= wt && tau < wt + 1.4) {
      out.em = EM.wave;
      out.et = tau - wt;
    }
  } else if (stop.k === 'pose') {
    const t = tau - stop.offs[i];
    out.et = t < 0 ? 0 : t % stop.period;
    if (t < 0.6 || D - tau < 0.8) out.em = EM.none;
  } else if (stop.k === 'dance') {
    // Each pair spins round its centre a whole number of turns, so the dance ends where it began.
    const pairCx = (stop.spots[i - (i % 2)][0] + stop.spots[Math.min(stop.spots.length - 1, i - (i % 2) + 1)][0]) / 2;
    const pairCz = (stop.spots[i - (i % 2)][1] + stop.spots[Math.min(stop.spots.length - 1, i - (i % 2) + 1)][1]) / 2;
    const alone = i % 2 === 0 && i + 1 >= stop.spots.length;
    const turns = Math.max(1, Math.round((D - 2) * 0.33));
    const ang = stop.spinDir * TAU * turns * smooth(clamp((tau - 1) / (D - 2), 0, 1));
    if (alone) {
      out.h = stop.faces[i] + ang;
    } else {
      const rx = bx - pairCx;
      const rz = bz - pairCz;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      out.x = pairCx + rx * c + rz * s;
      out.z = pairCz - rx * s + rz * c;
      out.h = Math.atan2(pairCx - out.x, pairCz - out.z);
    }
    out.et = tau;
  } else {
    const wt = stop.waves[i];
    if (wt >= 0 && tau >= wt && tau < wt + 1.6) {
      out.em = EM.point;
      out.et = tau - wt;
    } else out.et = tau;
  }
  return out;
}

/** The troupes' scripts for one round: deterministic in (plaza, seed, members per troupe). */
export function buildScripts(plaza, seed, n) {
  navFor(plaza);
  const loops = plaza.loops.map((L, i) => troupePath(plaza, `loop${i}`, [plaza.anchors[L.root], ...L.via], L.wide ? 2.6 : 0.9, true));
  const reserved = plaza.anchors.map(() => []);
  // Intervals live on a two-minute circle: shift by a whole loop either way to catch the ones that wrap.
  const overlap = (a0, a1, b0, b1) => [-SCRIPT_S, 0, SCRIPT_S].some((k) => a0 < b1 + k + 2 && b0 + k < a1 + 2);
  const busy = (a, t0, t1) => reserved[a].some(([r0, r1]) => overlap(t0, t1, r0, r1));
  const scripts = [];
  const starts = rng(hash32('starts', seed, plaza.id)).shuffle([...plaza.loops.keys()]);
  for (let tr = 0; tr < TROUPES.length; tr++) {
    let script = null;
    for (let attempt = 0; attempt < 24 && !script; attempt++) {
      script = tryScript(plaza, loops, n, rng(hash32('troupe', seed, plaza.id, tr, attempt)), starts[tr % starts.length], (a, t0, t1) => busy(a, t0 - phaseOf(tr), t1 - phaseOf(tr)), attempt);
    }
    if (!script) script = fallbackScript(plaza, n, tr, seed);
    // Reserve in round time: a troupe's script time is round time plus its phase.
    for (const seg of script.segs) if (seg.stop) reserved[seg.stop.anchor].push([seg.t0 - phaseOf(tr), seg.t1 - phaseOf(tr)]);
    scripts.push(script);
  }
  return { plaza, seed, n, scripts };
}

function travelPath(plaza, a, b) {
  return troupePath(plaza, `a${a}-${b}`, [plaza.anchors[a], plaza.anchors[b]], 0.9, false);
}

export const scriptStats = { tries: 0, noLoop: 0, noPath: 0, tooLong: 0, unspent: 0, busy: 0 };
const CAPS = { gather: 34, pose: 16, dance: 26, admire: 22 };

/** Lays stops and legs end to end; the stops soak up whatever time is left so the cycle is exactly two minutes. */
function fit(stops, legs) {
  const legT = legs.reduce((sum, l) => sum + l.dur, 0);
  const stopMin = stops.reduce((sum, st) => sum + st.dur, 0);
  const slack = SCRIPT_S - legT - stopMin;
  if (slack < 0) return 'long';
  const room = stops.reduce((sum, st) => sum + Math.max(0, CAPS[st.k] - st.dur), 0);
  if (room < slack) return 'short';
  let left = slack;
  for (let pass = 0; pass < 4 && left > 1e-9; pass++) {
    const open = stops.filter((st) => st.dur < CAPS[st.k] - 1e-9);
    if (!open.length) break;
    const share = left / open.length;
    for (const st of open) {
      const add = Math.min(share, CAPS[st.k] - st.dur);
      st.dur += add;
      left -= add;
    }
  }
  const segs = [];
  let t = 0;
  for (let i = 0; i < stops.length; i++) {
    segs.push({ stop: stops[i], t0: t, t1: t + stops[i].dur });
    t += stops[i].dur;
    segs.push({ leg: legs[i], t0: t, t1: t + legs[i].dur });
    t += legs[i].dur;
  }
  segs[segs.length - 1].t1 = SCRIPT_S;
  return segs;
}

function tryScript(plaza, loops, n, R, loopPref, busy, attempt) {
  scriptStats.tries++;
  const loopIdx = attempt < 6 ? loopPref : R.int(plaza.loops.length);
  const L = plaza.loops[loopIdx];
  const loop = loops[loopIdx];
  if (!loop) return (scriptStats.noLoop++, null);
  const root = L.root;
  const others = plaza.anchors.map((_, i) => i).filter((i) => i !== root);
  const gap = (a, b) => Math.sqrt((plaza.anchors[a][0] - plaza.anchors[b][0]) ** 2 + (plaza.anchors[a][1] - plaza.anchors[b][1]) ** 2);
  const near = (a, b) => (gap(a, b) >= 7 && gap(a, b) <= 26 ? 1 : 0.2);
  const x = R.weighted(others, others.map((i) => near(root, i)));
  const ys = others.filter((i) => i !== x);
  const y = R.weighted(ys, ys.map((i) => near(x, i) * near(i, root)));
  const form = L.wide ? R.weighted(['ring', 'v', 'file'], [4, n <= 9 ? 3 : 0, 2]) : 'file';
  const k0 = R.weighted(['gather', 'admire', 'pose'], [5, 2, 2]);
  const k2 = R.weighted(['dance', 'pose', 'gather'], [4, 4, 2]);
  const k3 = R.weighted(['gather', 'admire', 'pose', 'dance'], [4, 3, 3, 2]);
  const d0 = R.range(8, 12);
  const d1 = R.range(4, 6);
  const d2 = R.range(8, 11);
  const d3 = R.range(8, 11);
  const build = (withY) => {
    const stops = [makeStop(k0, root, plaza, n, R, d0), makeStop('pose', root, plaza, n, R, d1), makeStop(k2, x, plaza, n, R, d2)];
    if (withY) stops.push(makeStop(k3, y, plaza, n, R, d3));
    const legs = [makeLeg(loop, stops[0], stops[1], n, form, R)];
    for (let i = 1; i < stops.length; i++) {
      const next = i + 1 < stops.length ? stops[i + 1] : stops[0];
      const p = travelPath(plaza, stops[i].anchor, next.anchor);
      if (!p) return 'nopath';
      legs.push(makeLeg(p, stops[i], next, n, 'file', R));
    }
    return fit(stops, legs);
  };
  let segs = build(true);
  if (segs === 'long') segs = build(false);
  if (segs === 'nopath') return (scriptStats.noPath++, null);
  if (segs === 'long') return (scriptStats.tooLong++, null);
  if (segs === 'short') return (scriptStats.unspent++, null);
  if (attempt < 18) for (const seg of segs) if (seg.stop && busy(seg.stop.anchor, seg.t0, seg.t1)) return (scriptStats.busy++, null);
  return { segs, form, loop: loopIdx };
}

/** A script that always exists: gather, then pose, in place at one anchor, shuffling between the two layouts. */
function fallbackScript(plaza, n, tr, seed) {
  const R = rng(hash32('fallback', seed, plaza.id, tr));
  const a = (tr * 2) % plaza.anchors.length;
  const s0 = makeStop('gather', a, plaza, n, R, 0);
  const s1 = makeStop('pose', a, plaza, n, R, 0);
  const l0 = makeLeg(null, s0, s1, n, 'shuffle', R);
  const l1 = makeLeg(null, s1, s0, n, 'shuffle', R);
  const left = SCRIPT_S - l0.dur - l1.dur;
  s0.dur = left * 0.6;
  s1.dur = left - s0.dur;
  const t1 = s0.dur;
  const t2 = t1 + l0.dur;
  const t3 = t2 + s1.dur;
  return {
    segs: [
      { stop: s0, t0: 0, t1 },
      { leg: l0, t0: t1, t1: t2 },
      { stop: s1, t0: t2, t1: t3 },
      { leg: l1, t0: t3, t1: SCRIPT_S },
    ],
    form: 'none',
    loop: -1,
  };
}

function segIndex(segs, t) {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const tmpA = { x: 0, z: 0, tx: 0, tz: 0 };
const tmpB = { x: 0, z: 0, tx: 0, tz: 0 };
const tmpL = { x: 0, z: 0, face: 0, restH: 0 };
const tmpS = { x: 0, z: 0, h: 0, em: 0, et: 0 };

/** Each troupe runs its script offset by an eighth of the loop, so troupes sharing a route never start together. */
export const phaseOf = (tr) => (tr * SCRIPT_S) / 8;

/**
 * Raw position of member i of troupe tr at round time t (seconds; the script loops). Writes {x, z, face, restH, em, et}:
 * `face` is a heading, or NaN for "facing where you walk" (the crowd works it out from the motion).
 */
export function memberAt(set, tr, i, t, out) {
  const script = set.scripts[tr];
  let tt = (t + phaseOf(tr)) % SCRIPT_S;
  if (tt < 0) tt += SCRIPT_S;
  const seg = script.segs[segIndex(script.segs, tt)];
  const tau = tt - seg.t0;
  if (seg.stop) {
    stopAt(seg.stop, i, tau, tmpS);
    out.x = tmpS.x;
    out.z = tmpS.z;
    out.face = tmpS.h;
    out.restH = tmpS.h;
    out.em = tmpS.em;
    out.et = tmpS.et;
  } else {
    legAt(seg.leg, i, tau, tmpL, tmpA, tmpB);
    out.x = tmpL.x;
    out.z = tmpL.z;
    out.face = tmpL.face;
    out.restH = tmpL.restH;
    out.em = EM.none;
    out.et = tt;
  }
  return out;
}

export { lerpAngle };

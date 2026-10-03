// What travels between pages: the round as room state, requests as messages, secrets as private values. Everything
// read from another page is untrusted (the host's too, after a change of host): shapes are checked, numbers clamped,
// strings cut short, unknown fields dropped.
import { roundTiming, TROUPES, ABILITY_IDS, LIMITS } from '../sim/const.js';
import { PLAZAS } from '../sim/plazas.js';
import { cleanName, SKILLS } from '../sim/rules.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const num = (v, lo, hi, fb = lo) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
export const int = (v, lo, hi, fb = lo) => Math.round(num(v, lo, hi, fb));
const str = (v, max, fb = '') => (typeof v === 'string' ? v.slice(0, max) : fb);
const id = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null);
const r2 = (v) => Math.round(v * 100) / 100;

/** The round's public part as the host writes it ('r'). */
export function packRound(S, t0) {
  return { ...S.r, t0, endAt: S.endAt === Infinity ? -1 : r2(S.endAt), case: S.case ? { imps: S.case.imps, found: S.case.found, clues: S.case.clues, solved: S.case.solved | 0, bonus: S.case.bonus | 0 } : null, closed: S.closed ? 1 : 0, seq: S.seq };
}

/** Reads 'r' from room state; null when it isn't a round this page can draw. */
export function readRound(v) {
  if (!isObj(v) || !isObj(v.m)) return null;
  const crowd = [6, 9, 12].includes(v.crowd) ? v.crowd : null;
  if (!crowd) return null;
  const mode = v.mode === 'spot' ? 'spot' : 'masq';
  const r = {
    mid: str(v.mid, 80),
    n: int(v.n, 1, 99, 1),
    rid: str(v.rid, 90),
    mode,
    plaza: int(v.plaza, 0, PLAZAS.length - 1, 0),
    seed: int(v.seed, 0, 2 ** 32 - 1, 0),
    crowd,
    minutes: int(v.minutes, 3, 7, 5),
    skill: SKILLS.includes(v.skill) ? v.skill : 'adept',
    chaos: !!v.chaos,
    t0: num(v.t0, 0, 1e12, 0),
    endAt: num(v.endAt, -1, 1e5, -1),
    closed: !!v.closed,
    seq: int(v.seq, 0, 1e9, 0),
    m: {},
    case: null,
  };
  if (!r.rid) return null;
  let n = 0;
  for (const [k, m] of Object.entries(v.m)) {
    if (!id(k) || !isObj(m) || ++n > 24) continue;
    r.m[k] = {
      tr: int(m.tr, 0, TROUPES.length - 1, 0),
      sl: int(m.sl, 0, crowd - 1, 0),
      nm: cleanName(str(m.nm, 64)),
      b: m.b ? 1 : 0,
      imp: m.imp ? 1 : 0,
      sk: SKILLS.includes(m.sk) ? m.sk : undefined,
      ab: Array.isArray(m.ab) ? m.ab.filter((a) => ABILITY_IDS.includes(a)).slice(0, 2) : [],
      gone: m.gone ? 1 : 0,
    };
  }
  if (isObj(v.case) && mode === 'spot') {
    const imps = Array.isArray(v.case.imps) ? v.case.imps.filter((x) => id(x) && r.m[x]).slice(0, 6) : [];
    const clues = {};
    if (isObj(v.case.clues)) {
      for (const [k, c] of Object.entries(v.case.clues)) {
        if (!imps.includes(k) || !isObj(c)) continue;
        clues[k] = { tr: int(c.tr, 0, TROUPES.length - 1, 0), d: int(c.d, -1, 15, -1), at: num(c.at, 0, 1e5, 0) };
      }
    }
    r.case = { imps, found: Array.isArray(v.case.found) ? v.case.found.filter((x) => imps.includes(x)) : [], clues, solved: !!v.case.solved, bonus: int(v.case.bonus, 0, 9999, 0) };
  }
  r.timing = roundTiming(mode, r.minutes);
  return r;
}

/** Statuses ('rs'): poise and timers per masker. */
export function readStatus(v, r) {
  const out = {};
  if (!isObj(v) || !r) return out;
  for (const k of Object.keys(r.m)) {
    const s = v[k];
    if (!isObj(s)) continue;
    out[k] = { p: num(s.p, 0, 100, 0), fl: num(s.fl, 0, 1e5, 0), sl: num(s.sl, 0, 1e5, 0), out: num(s.out, 0, 1e5, 0), aud: s.aud ? 1 : 0, cu: num(s.cu, 0, 1e5, 0), cg: num(s.cg, 0, 1e5, 0), c1: num(s.c1, 0, 1e5, 0), c2: num(s.c2, 0, 1e5, 0), lf: num(s.lf, -999, 1e5, -999), op: s.op ? 1 : 0 };
  }
  return out;
}

export function readScores(v, r) {
  const out = {};
  if (!isObj(v) || !r) return out;
  for (const k of Object.keys(r.m)) {
    const s = v[k];
    if (!isObj(s)) continue;
    out[k] = { pts: int(s.pts, -9999, 99999, 0), unm: int(s.unm, 0, 999, 0), faux: int(s.faux, 0, 999, 0), caught: int(s.caught, 0, 999, 0), close: int(s.close, 0, 999, 0), wrong: int(s.wrong, 0, 999, 0), hush: int(s.hush, 0, 999, 0), best: num(s.best, 0, 9999, 0), streak: num(s.streak, 0, 9999, 0) };
  }
  return out;
}

const FX_KINDS = ['smoke', 'decoy', 'lantern', 'swap'];
export function readFx(v, r) {
  if (!Array.isArray(v) || !r) return [];
  const out = [];
  for (const f of v.slice(0, 40)) {
    if (!isObj(f) || !FX_KINDS.includes(f.k)) continue;
    out.push({
      k: f.k,
      id: str(f.id, 24),
      owner: id(f.owner) || '',
      x: num(f.x, -200, 200, 0),
      z: num(f.z, -200, 200, 0),
      tx: num(f.tx, -200, 200, 0),
      tz: num(f.tz, -200, 200, 0),
      fx: num(f.fx, -200, 200, 0),
      fz: num(f.fz, -200, 200, 0),
      nx: num(f.nx, -200, 200, 0),
      nz: num(f.nz, -200, 200, 0),
      tr: int(f.tr, 0, TROUPES.length - 1, 0),
      sl: int(f.sl, 0, r.crowd - 1, 0),
      t: num(f.t, 0, 1e5, 0),
      until: num(f.until, 0, 1e5, 0),
    });
  }
  return out;
}

const EV_KINDS = ['unmask', 'faux', 'wrong', 'greet', 'answer', 'smoke', 'decoy', 'lantern', 'swap', 'fluster', 'back', 'audience', 'left', 'end', 'solved'];
export function readEvents(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const e of v.slice(-LIMITS.events)) {
    if (!isObj(e) || !EV_KINDS.includes(e.k)) continue;
    out.push({
      k: e.k,
      q: int(e.q, 0, 1e9, 0),
      t: num(e.t, 0, 1e5, 0),
      a: id(e.a) || '',
      b: id(e.b) || '',
      n: int(e.n, -1, 200, -1),
      d: str(e.d, 24),
      x: num(e.x, -200, 200, 0),
      z: num(e.z, -200, 200, 0),
      tx: num(e.tx, -200, 200, 0),
      tz: num(e.tz, -200, 200, 0),
      pts: int(e.pts, -999, 999, 0),
      hush: e.hush ? 1 : 0,
      clean: e.clean ? 1 : 0,
      close: id(e.close) || '',
      bait: id(e.bait) || '',
      reply: num(e.reply, 0, 3, 0),
      v: ['ok', 'eager', 'stiff'].includes(e.v) ? e.v : 'ok',
      g: int(e.g, -1, 1e9, -1),
      dl: num(e.dl, -1, 9, -1),
      bonus: int(e.bonus, 0, 9999, 0),
    });
  }
  return out;
}

/** The game record ('g'): which match and round, when it started, totals, the final podium's timer. */
export function readGame(v) {
  if (!isObj(v)) return null;
  const tot = {};
  if (isObj(v.tot)) {
    let n = 0;
    for (const [k, t] of Object.entries(v.tot)) {
      if (!id(k) || !isObj(t) || ++n > 40) continue;
      tot[k] = { pts: int(t.pts, -99999, 999999, 0), unm: int(t.unm, 0, 999, 0), faux: int(t.faux, 0, 999, 0), caught: int(t.caught, 0, 999, 0), close: int(t.close, 0, 999, 0), wrong: int(t.wrong, 0, 999, 0), hush: int(t.hush, 0, 999, 0), best: num(t.best, 0, 9999, 0), rounds: int(t.rounds, 0, 99, 0), nm: cleanName(str(t.nm, 64)), b: t.b ? 1 : 0 };
    }
  }
  return { mid: str(v.mid, 80), by: id(v.by) || '', n: int(v.n, 0, 99, 0), t0: num(v.t0, 0, 1e12, 0), rounds: int(v.rounds, 1, 5, 3), tot, fin: num(v.fin, 0, 1e12, 0), mode: v.mode === 'spot' ? 'spot' : 'masq' };
}

/** A hunter's clue ('q', private). */
export function readIntel(v) {
  if (!isObj(v)) return null;
  return { rid: str(v.rid, 90), q: id(v.q), tr: int(v.tr, 0, TROUPES.length - 1, 0), d: int(v.d, -1, 15, -1), at: num(v.at, 0, 1e5, 0), nm: cleanName(str(v.nm, 64)) };
}

/** A reference to a figure in a request: a reveller's slot, a masker, or a decoy. */
export function readRef(v, r) {
  if (!isObj(v) || !r) return null;
  if (v.k === 'n') {
    const s = int(v.s, -1, TROUPES.length * r.crowd - 1, -1);
    return s < 0 ? null : { k: 'n', s };
  }
  if (v.k === 'p' && id(v.id) && r.m[v.id]) return { k: 'p', id: v.id };
  if (v.k === 'd' && typeof v.id === 'string' && v.id.length < 24) return { k: 'd', id: v.id };
  return null;
}

/** A request message from a player to the host. Returns a clean copy or null. */
export function readRequest(v, r) {
  if (!isObj(v) || !r || typeof v.t !== 'string' || v.rid !== r.rid) return null;
  const pose = { x: num(v.x, -200, 200, NaN), z: num(v.z, -200, 200, NaN), h: num(v.h, -10, 10, NaN) };
  switch (v.t) {
    case 'um':
    case 'gr': {
      const ref = readRef(v.ref, r);
      return ref ? { t: v.t, ref, pose } : null;
    }
    case 'an':
      return { t: 'an', g: int(v.g, -1, 1e9, -1), d: num(v.d, -1, 9, -1) };
    case 'ab':
      return ABILITY_IDS.includes(v.a) ? { t: 'ab', a: v.a, pose, tx: num(v.tx, -200, 200, NaN), tz: num(v.tz, -200, 200, NaN) } : null;
    case 'lo':
      return Array.isArray(v.ab) ? { t: 'lo', ab: v.ab.filter((a) => ABILITY_IDS.includes(a)).slice(0, 2) } : null;
    default:
      return null;
  }
}

/** A player's presence (position and what they're doing). */
export function readPresence(v) {
  if (!isObj(v)) return null;
  return {
    s: ['t', 'w', 'p', 'r', 'k'].includes(v.s) ? v.s : 't',
    r: str(v.r, 90),
    x: num(v.x, -200, 200, 0),
    z: num(v.z, -200, 200, 0),
    h: num(v.h, -50, 50, 0),
    f: int(v.f, 0, 15, 0),
    tr: int(v.tr, -1, TROUPES.length - 1, -1),
    sl: int(v.sl, -1, 11, -1),
    w: Array.isArray(v.w) ? [int(v.w[0], -1, 1e9, -1), ['ok', 'eager', 'stiff'].includes(v.w[1]) ? v.w[1] : 'ok', num(v.w[2], 0, 1e5, 0)] : null,
    e: Array.isArray(v.e) ? [int(v.e[0], 0, 20, 0), num(v.e[1], 0, 1e5, 0)] : null,
    b: Array.isArray(v.b) ? v.b.slice(0, 12).map((q) => (Array.isArray(q) ? [num(q[0], -200, 200, 0), num(q[1], -200, 200, 0), num(q[2], -50, 50, 0), int(q[3], 0, 15, 0)] : [0, 0, 0, 0])) : null,
  };
}

export { r2 };

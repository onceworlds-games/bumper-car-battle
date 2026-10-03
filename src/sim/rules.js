// The rules of a round, as plain data and pure functions: what the host's page runs (and the balance harness).
// State `S` is split the way the room stores it: `r` (who wears what, written at the start and on changes), `rs`
// (each masker's poise and timers), `fx` (smoke, decoys, lanterns, swaps), `sc` (scores) and `ev` (recent events);
// `chain` (who hunts whom) and `intel` (each hunter's clue) are secrets the host keeps in private values.
import { hash32, rng, unit } from './rng.js';
import { POISE, UNMASK, GREET, SEEN, ABILITIES, ABILITY_IDS, SCORE, CLUE, SPOT, TROUPES, FILL_TO, MIN_MASKERS, LIMITS, roundTiming, phaseAt } from './const.js';
import { PLAZAS, districtAt } from './plazas.js';
import { lineOfSight, walkPath, navFor } from './nav.js';
import { STRIDE } from './crowd.js';
import { wrap, dist, segHitsCircle } from './geom.js';

export const BOT_NAMES = ['Ottavio', 'Lucrezia', 'Orsino', 'Fiammetta', 'Tobia', 'Nerina', 'Bastiano', 'Ginevra', 'Pippo', 'Zanetta', 'Marcello', 'Ortensia'];
export const SKILLS = ['novice', 'adept', 'master'];

const clampPoise = (p) => (p < 0 ? 0 : p > POISE.max ? POISE.max : p);
const sameRef = (a, b) => a && b && a.k === b.k && (a.k === 'n' ? a.s === b.s : a.id === b.id);

/**
 * A new round. cfg: { mid, n, mode: 'masq'|'spot', plaza (index), seed, crowd (per troupe), minutes, skill, loadouts:
 * 'standard'|'chaos', bots: true|false, humans: [{ id, name, ab: [a, b], unlocked: [...] }] }.
 */
export function newRound(cfg) {
  const R = rng(hash32('round', cfg.seed, cfg.n));
  const mode = cfg.mode === 'spot' ? 'spot' : 'masq';
  const timing = roundTiming(mode, cfg.minutes);
  const n = cfg.crowd;
  const humans = cfg.humans.slice(0, 10);
  const skill = SKILLS.includes(cfg.skill) ? cfg.skill : 'adept';
  const S = {
    v: 1,
    r: {
      mid: cfg.mid,
      n: cfg.n,
      rid: `${cfg.mid}.${cfg.n}`,
      mode,
      plaza: Math.max(0, Math.min(PLAZAS.length - 1, cfg.plaza | 0)),
      seed: cfg.seed >>> 0,
      crowd: n,
      minutes: timing.total / 60,
      skill,
      chaos: cfg.loadouts === 'chaos',
      m: {},
    },
    rs: {},
    fx: [],
    sc: {},
    ev: [],
    seq: 0,
    chain: [],
    intel: {},
    timing,
    endAt: Infinity,
    case: null,
    dirty: { r: true, rs: true, fx: true, sc: true, ev: true, chain: true, intel: new Set() },
  };
  // Who plays: the humans, then bots (Masquerade: fill to eight unless bots are off; Spot the Mask: the impostors).
  const ids = humans.map((h) => h.id);
  const bots = [];
  if (mode === 'masq') {
    const want = cfg.bots === false ? Math.max(0, MIN_MASKERS - ids.length) : Math.max(0, FILL_TO - ids.length);
    for (let i = 0; i < want; i++) bots.push({ id: `bot${i}`, name: BOT_NAMES[(i + cfg.n) % BOT_NAMES.length], skill });
  } else {
    for (let i = 0; i < SPOT.impostors[skill]; i++) bots.push({ id: `imp${i}`, name: BOT_NAMES[(i + cfg.n * 3) % BOT_NAMES.length], skill, imp: true });
  }
  // Costumes: spread maskers over the troupes, at most two to a troupe, each in a different slot.
  const all = [...humans.map((h) => ({ ...h, bot: false })), ...bots.map((b) => ({ ...b, bot: true }))];
  const order = R.shuffle([...TROUPES.keys()]);
  const used = new Set();
  // Two maskers never share a name on the results: a later one gets a number (players come before bots).
  const taken = new Set();
  const uniqueName = (raw) => {
    const base = cleanName(raw);
    let nm = base;
    for (let k = 2; taken.has(nm.toLowerCase()); k++) nm = `${base.slice(0, LIMITS.names - String(k).length - 1).trimEnd()} ${k}`;
    taken.add(nm.toLowerCase());
    return nm;
  };
  all.forEach((p, i) => {
    const tr = order[i % TROUPES.length];
    let sl = R.int(n);
    while (used.has(tr * n + sl)) sl = (sl + 1) % n;
    used.add(tr * n + sl);
    const ab = pickLoadout(S.r.chaos, p.ab, p.unlocked, R, p.bot ? skill : null);
    S.r.m[p.id] = { tr, sl, nm: uniqueName(p.name), b: p.bot ? 1 : 0, sk: p.bot ? p.skill : undefined, imp: p.imp ? 1 : 0, ab };
    S.rs[p.id] = fresh();
    S.sc[p.id] = { pts: 0, unm: 0, faux: 0, caught: 0, close: 0, wrong: 0, hush: 0, best: 0, streak: 0 };
  });
  if (mode === 'masq') {
    S.chain = makeChain(S, Object.keys(S.r.m), R);
    for (const id of S.chain) setIntel(S, id, 0, true);
  } else {
    S.case = { imps: bots.map((b) => b.id), found: [], clueAt: timing.huntStart, next: 0, clues: {} };
    // The case file opens with each impostor's costume; districts come as clues during the hunt.
    for (const b of bots) S.case.clues[b.id] = { tr: S.r.m[b.id].tr, d: -1, at: 0 };
  }
  return S;
}

function fresh() {
  return { p: 70, fl: 0, sl: 0, out: 0, aud: 0, cu: 0, cg: 0, c1: 0, c2: 0, lf: -999, op: 0 };
}

// Control characters, zero-width marks and bidi overrides (kept as escapes: raw separators break a regex literal).
const BAD_CHARS = new RegExp('[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]', 'g');

export function cleanName(name) {
  const s = typeof name === 'string' ? name : '';
  const t = s.replace(BAD_CHARS, '').trim();
  return (t || 'Masker').slice(0, LIMITS.names);
}

/** Two abilities: the player's picks if they own them, else sensible defaults; chaos rolls any two. */
export function pickLoadout(chaos, wanted, unlocked, R, botSkill) {
  if (chaos) return R.shuffle(ABILITY_IDS).slice(0, 2);
  if (botSkill) {
    const pools = { novice: ['smoke', 'decoy', 'opera'], adept: ['smoke', 'decoy', 'lantern', 'opera'], master: ABILITY_IDS };
    return R.shuffle(pools[botSkill]).slice(0, 2);
  }
  const own = Array.isArray(unlocked) && unlocked.length ? unlocked.filter((a) => ABILITY_IDS.includes(a)) : ['smoke', 'decoy', 'opera'];
  const pick = (Array.isArray(wanted) ? wanted : []).filter((a, i, l) => own.includes(a) && l.indexOf(a) === i).slice(0, 2);
  for (const a of ['smoke', 'decoy', 'opera', 'lantern', 'swap']) if (pick.length < 2 && own.includes(a) && !pick.includes(a)) pick.push(a);
  return pick;
}

/** A cycle where nobody hunts someone in their own troupe when it can be helped. */
function makeChain(S, ids, R) {
  let best = R.shuffle(ids);
  let bestBad = Infinity;
  for (let k = 0; k < 40 && bestBad > 0; k++) {
    const c = k === 0 ? best : R.shuffle(ids);
    let bad = 0;
    for (let i = 0; i < c.length; i++) if (c.length > 1 && S.r.m[c[i]].tr === S.r.m[c[(i + 1) % c.length]].tr) bad++;
    if (bad < bestBad) {
      bestBad = bad;
      best = c;
    }
  }
  S.dirty.chain = true;
  return best;
}

export const quarryOf = (S, id) => {
  const i = S.chain.indexOf(id);
  return i < 0 || S.chain.length < 2 ? null : S.chain[(i + 1) % S.chain.length];
};
export const pursuerOf = (S, id) => {
  const i = S.chain.indexOf(id);
  return i < 0 || S.chain.length < 2 ? null : S.chain[(i - 1 + S.chain.length) % S.chain.length];
};
/** Where a round stands at time t, including an early close (Spot the Mask solved). */
export function stage(S, t) {
  if (t >= S.endAt) {
    const since = t - S.endAt;
    return since < S.timing.reveal - S.timing.end ? 'reveal' : since < S.timing.over - S.timing.end ? 'results' : 'over';
  }
  if (t >= S.timing.over) return 'over';
  return phaseAt(S.timing, t);
}
export const hunting = (S, t) => {
  const st = stage(S, t);
  return st === 'hunt' || st === 'hush';
};
export const isOut = (S, id, t) => {
  const s = S.rs[id];
  return !s || s.aud || s.out > t || !!S.r.m[id]?.gone;
};

function push(S, t, ev) {
  ev.q = ++S.seq;
  ev.t = Math.round(t * 100) / 100;
  S.ev.push(ev);
  if (S.ev.length > LIMITS.events) S.ev.splice(0, S.ev.length - LIMITS.events);
  S.dirty.ev = true;
  return ev;
}

function addPts(S, id, pts) {
  const sc = S.sc[id];
  if (!sc) return;
  sc.pts = Math.max(-9999, Math.min(99999, sc.pts + pts));
  S.dirty.sc = true;
}

/** Updates a hunter's clue: their quarry's troupe and district now. */
function setIntel(S, id, t, initial) {
  const q = quarryOf(S, id);
  if (!q) {
    if (S.intel[id]) {
      S.intel[id] = { q: null, at: t };
      S.dirty.intel.add(id);
    }
    return;
  }
  const pos = S.pos?.[q];
  const plaza = PLAZAS[S.r.plaza];
  const district = pos && !initial ? districtAt(plaza, pos.x, pos.z) : -1;
  const every = S.chain.length <= 2 ? CLUE.duel : CLUE.every;
  S.intel[id] = { q, tr: S.r.m[q].tr, d: district, at: t, next: Math.max(t, S.timing.huntStart) + (initial ? 0 : every) };
  S.dirty.intel.add(id);
}

/** Every hunter in the chain has a clue (a new host fills the gaps it couldn't recover). */
export function ensureIntel(S, t) {
  for (const id of S.chain) {
    const it = S.intel[id];
    if (!it || it.q !== quarryOf(S, id)) setIntel(S, id, t, t < S.timing.huntStart);
  }
}

/** Positions the rules look at; the host refreshes them each tick from presence and the bots. */
export function setPos(S, id, x, z, h, flags) {
  if (!S.pos) S.pos = {};
  const p = S.pos[id] || (S.pos[id] = { x: 0, z: 0, h: 0, f: 0 });
  p.x = x;
  p.z = z;
  p.h = h;
  p.f = flags;
}
export const FLAG = { locked: 1, sprint: 2, opera: 4, moving: 8 };

/** Where a figure is: an NPC slot (from the crowd buffer), a masker, or a decoy. */
export function refPos(S, ref, crowdBuf, t, out) {
  if (!ref) return null;
  if (ref.k === 'n') {
    const s = ref.s | 0;
    if (s < 0 || s >= TROUPES.length * S.r.crowd) return null;
    out.x = crowdBuf[s * STRIDE];
    out.z = crowdBuf[s * STRIDE + 1];
    return out;
  }
  if (ref.k === 'p') {
    const p = S.pos?.[ref.id];
    if (!p || !S.r.m[ref.id]) return null;
    out.x = p.x;
    out.z = p.z;
    return out;
  }
  if (ref.k === 'd') {
    const d = S.fx.find((f) => f.k === 'decoy' && f.id === ref.id && f.until > t);
    if (!d) return null;
    decoyAt(S, d, crowdBuf, t, out);
    return out;
  }
  return null;
}

/** Slots taken by maskers (and decoys holding a slot): the crowd draws no reveller there. */
export function takenSlots(S) {
  const taken = new Map();
  for (const [id, m] of Object.entries(S.r.m)) if (!m.gone) taken.set(m.tr * S.r.crowd + m.sl, id);
  return taken;
}

/** A decoy walks from where it was dropped to its owner's slot, then stands in it. Pure in time. */
export function decoyAt(S, d, crowdBuf, t, out) {
  const s = d.tr * S.r.crowd + d.sl;
  const sx = crowdBuf[s * STRIDE];
  const sz = crowdBuf[s * STRIDE + 1];
  if (!d.path) {
    const p = walkPath(PLAZAS[S.r.plaza], d.x, d.z, d.tx ?? sx, d.tz ?? sz) || [[d.x, d.z]];
    let len = 0;
    for (let i = 1; i < p.length; i++) len += dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
    Object.defineProperty(d, 'path', { value: { p, len }, enumerable: false, writable: true });
  }
  const { p, len } = d.path;
  const walked = Math.max(0, (t - d.t) * 1.7);
  if (walked >= len) {
    // Arrived: glide onto the moving slot over half a second, then hold it.
    const k = Math.min(1, (walked - len) / 0.85);
    const ex = p[p.length - 1][0];
    const ez = p[p.length - 1][1];
    out.x = ex + (sx - ex) * k;
    out.z = ez + (sz - ez) * k;
    out.held = k >= 1;
    return out;
  }
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const seg = dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
    if (acc + seg >= walked) {
      const u = seg > 1e-6 ? (walked - acc) / seg : 1;
      out.x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * u;
      out.z = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * u;
      out.held = false;
      return out;
    }
    acc += seg;
  }
  out.x = p[p.length - 1][0];
  out.z = p[p.length - 1][1];
  out.held = false;
  return out;
}

const tmp = { x: 0, z: 0 };
const tmp2 = { x: 0, z: 0 };

function inSmoke(S, t, x, z) {
  for (const f of S.fx) if (f.k === 'smoke' && f.until > t && f.t <= t && dist(f.x, f.z, x, z) < ABILITIES.smoke.radius) return true;
  return false;
}
export function smokeBetween(S, t, ax, az, bx, bz) {
  for (const f of S.fx) if (f.k === 'smoke' && f.until > t && f.t <= t && segHitsCircle(ax, az, bx, bz, f.x, f.z, ABILITIES.smoke.radius)) return true;
  return false;
}

/**
 * An unmask request. `pose`: where the unmasker says they stand and face ({x, z, h}); the host's own view (S.pos) wins
 * when they disagree by more than the latency allowance. Returns { ok, why } or the outcome event.
 */
export function unmask(S, t, id, ref, pose, crowdBuf) {
  const m = S.r.m[id];
  const st = S.rs[id];
  if (!m || !st || isOut(S, id, t)) return { ok: false, why: 'out' };
  if (!hunting(S, t)) return { ok: false, why: 'phase' };
  if (st.fl > t) return { ok: false, why: 'flustered' };
  if (t < st.cu) return { ok: false, why: 'cooldown' };
  if (st.p < POISE.unmaskCost - 5) return { ok: false, why: 'poise' };
  const me = S.pos?.[id];
  if (!me) return { ok: false, why: 'nowhere' };
  let px = me.x;
  let pz = me.z;
  let ph = me.h;
  if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.z) && dist(pose.x, pose.z, me.x, me.z) < 1.5) {
    px = pose.x;
    pz = pose.z;
    if (Number.isFinite(pose.h)) ph = pose.h;
  }
  if (ref?.k === 'p' && ref.id === id) return { ok: false, why: 'self' };
  if (ref?.k === 'p' && isOut(S, ref.id, t)) return { ok: false, why: 'gone' };
  if (ref?.k === 'n' && takenSlots(S).has(ref.s | 0)) return { ok: false, why: 'gone' };
  const at = refPos(S, ref, crowdBuf, t, tmp);
  if (!at) return { ok: false, why: 'gone' };
  const d = dist(px, pz, at.x, at.z);
  if (d > UNMASK.range + UNMASK.tolerance) return { ok: false, why: 'far' };
  const ang = Math.abs(wrap(Math.atan2(at.x - px, at.z - pz) - ph));
  if (d > 0.9 && ang > UNMASK.cone / 2 + UNMASK.coneTolerance) return { ok: false, why: 'cone' };
  if (inSmoke(S, t, px, pz) || inSmoke(S, t, at.x, at.z) || smokeBetween(S, t, px, pz, at.x, at.z)) return { ok: false, why: 'smoke' };

  // The fan flicks: the attempt costs poise whatever happens.
  st.p = clampPoise(st.p - POISE.unmaskCost);
  S.dirty.rs = true;
  const hush = stage(S, t) === 'hush';
  if (S.r.mode === 'spot') return spotUnmask(S, t, id, ref, at, hush);

  const q = quarryOf(S, id);
  if (ref.k === 'p' && ref.id === q) {
    const clean = t - st.lf >= UNMASK.cleanWindow;
    const pts = SCORE.unmask * (hush ? SCORE.hushMult : 1) + (clean ? SCORE.clean : 0);
    addPts(S, id, pts);
    S.sc[id].unm++;
    if (hush) S.sc[id].hush++;
    S.sc[ref.id].caught++;
    addPts(S, ref.id, SCORE.caught);
    st.cu = t + 2;
    const qs = S.rs[ref.id];
    qs.out = t + UNMASK.powderS;
    qs.p = Math.max(qs.p, 60);
    endStreak(S, ref.id);
    // The chain closes over the gap; the unmasked one rejoins it when they come back.
    S.chain = S.chain.filter((x) => x !== ref.id);
    S.dirty.chain = true;
    setIntel(S, id, t, false);
    if (S.intel[ref.id]) {
      S.intel[ref.id] = { q: null, at: t };
      S.dirty.intel.add(ref.id);
    }
    return push(S, t, { k: 'unmask', a: id, b: ref.id, x: at.x, z: at.z, pts, hush: hush ? 1 : 0, clean: clean ? 1 : 0 });
  }
  st.cu = t + UNMASK.missCooldown;
  if (ref.k === 'p') {
    addPts(S, id, SCORE.wrongPlayer);
    addPts(S, ref.id, SCORE.wrongVictim);
    S.sc[id].wrong++;
    return push(S, t, { k: 'wrong', a: id, b: ref.id, x: at.x, z: at.z });
  }
  // An innocent reveller (or a decoy): a faux pas. Your mask slips for all to see.
  return fauxPas(S, t, id, ref, at);
}

function fauxPas(S, t, id, ref, at) {
  const st = S.rs[id];
  addPts(S, id, SCORE.fauxPas);
  S.sc[id].faux++;
  st.sl = t + SEEN.slipS;
  st.lf = t;
  S.dirty.rs = true;
  let bait = null;
  if (ref.k === 'd') {
    const d = S.fx.find((f) => f.k === 'decoy' && f.id === ref.id);
    if (d) {
      d.until = t;
      S.dirty.fx = true;
      if (S.sc[d.owner] && d.owner !== id) {
        addPts(S, d.owner, SCORE.bait);
        bait = d.owner;
      }
    }
  }
  // A close call for the quarry this pursuer was hunting, if they were right there.
  let close = null;
  if (S.r.mode === 'masq') {
    const q = quarryOf(S, id);
    const qp = q && S.pos?.[q];
    if (qp && !isOut(S, q, t) && dist(qp.x, qp.z, at.x, at.z) <= SCORE.closeCallR) {
      addPts(S, q, SCORE.closeCall);
      S.sc[q].close++;
      close = q;
    }
  } else if (S.case) {
    // Impostors nearby take fright and keep still for a while.
    S.case.alert = { x: at.x, z: at.z, until: t + SPOT.alertS };
  }
  return push(S, t, { k: 'faux', a: id, n: ref.k === 'n' ? ref.s : -1, d: ref.k === 'd' ? ref.id : undefined, x: at.x, z: at.z, close, bait });
}

function spotUnmask(S, t, id, ref, at, hush) {
  const st = S.rs[id];
  const m = ref.k === 'p' ? S.r.m[ref.id] : null;
  if (m && m.imp && !m.gone) {
    const pts = SPOT.points[S.r.skill] * (hush ? SCORE.hushMult : 1);
    addPts(S, id, pts);
    S.sc[id].unm++;
    if (hush) S.sc[id].hush++;
    m.gone = 1;
    S.dirty.r = true;
    st.cu = t + 2;
    S.case.found.push(ref.id);
    const ev = push(S, t, { k: 'unmask', a: id, b: ref.id, x: at.x, z: at.z, pts, hush: hush ? 1 : 0, clean: 0 });
    if (S.case.found.length >= S.case.imps.length) closeCase(S, t);
    return ev;
  }
  st.cu = t + UNMASK.missCooldown;
  if (m) {
    addPts(S, id, SCORE.wrongPlayer);
    S.sc[id].wrong++;
    return push(S, t, { k: 'wrong', a: id, b: ref.id, x: at.x, z: at.z });
  }
  return fauxPas(S, t, id, ref, at);
}

function closeCase(S, t) {
  if (S.endAt !== Infinity) return;
  const left = Math.max(0, S.timing.end - t);
  const bonus = Math.round(left * 2);
  for (const [id, m] of Object.entries(S.r.m)) if (!m.b && S.sc[id].unm > 0) addPts(S, id, bonus);
  S.endAt = t;
  S.case.solved = 1;
  S.case.bonus = bonus;
  S.dirty.r = true;
  push(S, t, { k: 'solved', bonus });
}

/** A greeting. Returns the event (with the NPC's reply delay, or which masker must answer), or { ok: false }. */
export function greet(S, t, id, ref, crowdBuf) {
  const st = S.rs[id];
  const me = S.pos?.[id];
  if (!st || !me || isOut(S, id, t)) return { ok: false, why: 'out' };
  if (t < st.cg) return { ok: false, why: 'cooldown' };
  const st2 = stage(S, t);
  if (st2 === 'assign' || st2 === 'reveal' || st2 === 'results' || st2 === 'over') return { ok: false, why: 'phase' };
  const at = refPos(S, ref, crowdBuf, t, tmp);
  if (!at || (ref.k === 'p' && (ref.id === id || isOut(S, ref.id, t)))) return { ok: false, why: 'gone' };
  if (dist(me.x, me.z, at.x, at.z) > GREET.range + UNMASK.tolerance) return { ok: false, why: 'far' };
  st.cg = t + GREET.cooldown;
  S.dirty.rs = true;
  const ev = { k: 'greet', a: id, x: me.x, z: me.z, tx: at.x, tz: at.z };
  if (ref.k === 'n' || ref.k === 'd') ev.reply = Math.round((GREET.npcMin + (GREET.npcMax - GREET.npcMin) * unit('greet', S.r.seed, ref.s ?? ref.id, Math.floor(t * 10))) * 100) / 100;
  if (ref.k === 'n') ev.n = ref.s;
  else if (ref.k === 'd') ev.d = ref.id;
  else ev.b = ref.id;
  return push(S, t, ev);
}

/** How a masker answered a greeting or a lantern (delay in seconds, or -1 for no answer). */
export function verdict(delay) {
  if (!(delay >= 0)) return 'stiff';
  if (delay < GREET.okMin) return 'eager';
  if (delay > GREET.okMax) return 'stiff';
  return 'ok';
}
export function answer(S, t, id, g, delay) {
  if (!S.r.m[id]) return null;
  const v = verdict(delay);
  return push(S, t, { k: 'answer', a: id, g: g | 0, v, dl: Math.round(Math.max(-1, Math.min(9, delay)) * 100) / 100 });
}

/** Uses an ability. params: { x, z, h } for where the user is; { tx, tz } for a lantern's landing spot. */
export function ability(S, t, id, ab, params, crowdBuf) {
  const m = S.r.m[id];
  const st = S.rs[id];
  const me = S.pos?.[id];
  if (!m || !st || !me || isOut(S, id, t)) return { ok: false, why: 'out' };
  const slot = m.ab.indexOf(ab);
  if (slot < 0) return { ok: false, why: 'unequipped' };
  const st2 = stage(S, t);
  if (st2 === 'assign' || st2 === 'reveal' || st2 === 'results' || st2 === 'over') return { ok: false, why: 'phase' };
  const key = slot === 0 ? 'c1' : 'c2';
  if (ab === 'opera') {
    st.op = st.op ? 0 : 1;
    if (st.op && st.p <= 0) st.op = 0;
    S.dirty.rs = true;
    return { ok: true, k: 'opera', on: st.op };
  }
  if (t < st[key]) return { ok: false, why: 'cooldown' };
  const A = ABILITIES[ab];
  if (ab === 'smoke') {
    S.fx.push({ k: 'smoke', id: `s${S.seq + 1}`, owner: id, x: me.x, z: me.z, t, until: t + A.duration });
  } else if (ab === 'decoy') {
    // One decoy at a time; it walks to its owner's slot and holds it.
    for (const f of S.fx) if (f.k === 'decoy' && f.owner === id && f.until > t) f.until = t;
    const s = m.tr * S.r.crowd + m.sl;
    S.fx.push({ k: 'decoy', id: `d${S.seq + 1}`, owner: id, tr: m.tr, sl: m.sl, x: me.x, z: me.z, tx: crowdBuf[s * STRIDE], tz: crowdBuf[s * STRIDE + 1], t, until: t + A.duration });
  } else if (ab === 'lantern') {
    let tx = Number(params?.tx);
    let tz = Number(params?.tz);
    if (!Number.isFinite(tx) || !Number.isFinite(tz)) {
      tx = me.x + Math.sin(me.h) * 5;
      tz = me.z + Math.cos(me.h) * 5;
    }
    const d = dist(me.x, me.z, tx, tz);
    if (d > A.reach) {
      tx = me.x + ((tx - me.x) / d) * A.reach;
      tz = me.z + ((tz - me.z) / d) * A.reach;
    }
    const nav = navFor(PLAZAS[S.r.plaza]);
    if (nav.clear(tx, tz) < 0) {
      tx = me.x;
      tz = me.z;
    }
    S.fx.push({ k: 'lantern', id: `l${S.seq + 1}`, owner: id, x: tx, z: tz, fx: me.x, fz: me.z, t, until: t + A.duration });
  } else if (ab === 'swap') {
    const taken = takenSlots(S);
    let best = -1;
    let bestD = A.radius;
    const total = TROUPES.length * S.r.crowd;
    for (let s = 0; s < total; s++) {
      if (Math.floor(s / S.r.crowd) === m.tr || taken.has(s)) continue;
      if (S.fx.some((f) => f.k === 'decoy' && f.until > t && f.tr * S.r.crowd + f.sl === s)) continue;
      const d = dist(me.x, me.z, crowdBuf[s * STRIDE], crowdBuf[s * STRIDE + 1]);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best < 0) return { ok: false, why: 'nobody' };
    const oldTr = m.tr;
    const oldSl = m.sl;
    m.tr = Math.floor(best / S.r.crowd);
    m.sl = best % S.r.crowd;
    st.p = POISE.swapTo;
    S.dirty.r = true;
    // The reveller takes your old costume and place, and walks back to your old slot.
    S.fx.push({ k: 'swap', id: `w${S.seq + 1}`, owner: id, tr: oldTr, sl: oldSl, x: me.x, z: me.z, nx: crowdBuf[best * STRIDE], nz: crowdBuf[best * STRIDE + 1], t, until: t + 12 });
  } else return { ok: false, why: 'unknown' };
  st[key] = t + A.cooldown;
  S.dirty.rs = true;
  S.dirty.fx = true;
  return push(S, t, { k: ab, a: id, x: me.x, z: me.z });
}

function endStreak(S, id) {
  const sc = S.sc[id];
  if (sc && sc.streak > sc.best) sc.best = Math.round(sc.streak * 10) / 10;
  if (sc) sc.streak = 0;
}

/**
 * Advances the round by dt seconds to time t. `view`: { slotDist(id) -> metres from the masker to its slot,
 * idle(id) -> seconds idle (0 if active), away(id) -> bool } plus S.pos kept fresh by the caller.
 */
export function tick(S, t, dt, view) {
  const st0 = stage(S, t);
  // Effects expire.
  const before = S.fx.length;
  S.fx = S.fx.filter((f) => f.until > t - 1);
  if (S.fx.length !== before) S.dirty.fx = true;
  for (const [id, m] of Object.entries(S.r.m)) {
    const st = S.rs[id];
    if (!st || m.gone) continue;
    // Back from the Powder Room: a new costume, a new slot, and a place in the chain.
    if (st.out && st.out <= t) {
      st.out = 0;
      returnFromPowder(S, t, id);
    }
    if (isOut(S, id, t)) continue;
    const pos = S.pos?.[id];
    const flags = pos ? pos.f : FLAG.locked;
    const d = view.slotDist(id);
    let rate;
    if (flags & FLAG.sprint) rate = POISE.sprint;
    else if (flags & FLAG.locked || d <= POISE.lock * 0.6) rate = POISE.inStep;
    else if (d <= POISE.near) rate = 0;
    else rate = POISE.out;
    if (st.op || flags & FLAG.opera) rate += POISE.opera;
    if (rate > 0 && pos && S.fx.some((f) => f.k === 'lantern' && f.until > t && dist(f.x, f.z, pos.x, pos.z) < ABILITIES.lantern.radius)) rate = 0;
    if (st0 === 'assign' || st0 === 'reveal' || st0 === 'results') rate = Math.max(0, rate);
    const was = st.p;
    st.p = clampPoise(st.p + rate * dt);
    if (Math.round(was) !== Math.round(st.p)) S.dirty.rs = true;
    if (st.p <= 0 && was > 0 && st.fl <= t) {
      st.fl = t + POISE.flusterS;
      st.op = 0;
      endStreak(S, id);
      S.dirty.rs = true;
      push(S, t, { k: 'fluster', a: id });
    }
    // Idle players shimmer, then become audience and leave the chain.
    const idle = view.idle ? view.idle(id) : 0;
    if (idle > 0 && !m.b) {
      if (st.fl < t + 1) {
        st.fl = t + 2;
        S.dirty.rs = true;
      }
      if (idle >= 15) toAudience(S, t, id);
    }
    // The hunt streak: time out of step without getting flustered.
    const sc = S.sc[id];
    if (hunting(S, t) && d > POISE.near && st.fl <= t) sc.streak += dt;
    else if (sc.streak > 0 && (d <= POISE.lock || st.fl > t)) endStreak(S, id);
  }
  // Clues on each hunter's own schedule.
  if (S.r.mode === 'masq' && hunting(S, t)) {
    // Two left: a closed duel, with a clue every fifteen seconds for both.
    const every = S.chain.length <= 2 ? CLUE.duel : CLUE.every;
    for (const id of S.chain) {
      const intel = S.intel[id];
      if (!intel || !intel.q || t >= Math.min(intel.next, intel.at + every)) setIntel(S, id, t, false);
    }
  }
  if (S.case && hunting(S, t) && t >= S.case.clueAt) spotClue(S, t);
  // Masquerade with fewer than two maskers left in play (and nobody due back): nothing left to hunt.
  if (S.r.mode === 'masq' && hunting(S, t) && S.endAt === Infinity) {
    const due = Object.keys(S.r.m).filter((id) => !S.r.m[id].gone && !S.rs[id].aud && S.rs[id].out > t).length;
    if (S.chain.length + due < 2) {
      S.endAt = t;
      S.dirty.r = true;
    }
  }
  // The round ends: survivors score.
  if (!S.closed && (st0 === 'reveal' || st0 === 'results' || st0 === 'over')) {
    S.closed = true;
    for (const [id, m] of Object.entries(S.r.m)) {
      if (m.gone || S.rs[id]?.aud) continue;
      endStreak(S, id);
      if (S.r.mode === 'masq' && S.sc[id].caught === 0) addPts(S, id, SCORE.survivor);
    }
    push(S, t, { k: 'end' });
  }
}

function spotClue(S, t) {
  const left = S.case.imps.filter((id) => !S.r.m[id].gone);
  if (!left.length) return;
  const id = left[S.case.next % left.length];
  S.case.next++;
  const p = S.pos?.[id];
  if (p) S.case.clues[id] = { tr: S.r.m[id].tr, d: districtAt(PLAZAS[S.r.plaza], p.x, p.z), at: Math.round(t) };
  S.case.clueAt = t + CLUE.spot;
  S.dirty.r = true;
}

function returnFromPowder(S, t, id) {
  const m = S.r.m[id];
  const R = rng(hash32('powder', S.r.seed, id, Math.floor(t * 10)));
  const taken = takenSlots(S);
  const n = S.r.crowd;
  const troupes = R.shuffle([...TROUPES.keys()].filter((tr) => tr !== m.tr));
  for (const tr of troupes) {
    const free = [...Array(n).keys()].filter((sl) => !taken.has(tr * n + sl));
    if (!free.length) continue;
    m.tr = tr;
    m.sl = R.pick(free);
    break;
  }
  S.dirty.r = true;
  if (S.r.mode !== 'masq' || S.rs[id].aud) return;
  // Into the chain between two others (never next to a troupe-mate when avoidable).
  const c = S.chain;
  if (c.length === 0) {
    S.chain = [id];
  } else {
    let at = R.int(c.length);
    for (let k = 0; k < c.length; k++) {
      const i = (at + k) % c.length;
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (S.r.m[a].tr !== m.tr && S.r.m[b].tr !== m.tr) {
        at = i;
        break;
      }
    }
    S.chain = [...c.slice(0, at + 1), id, ...c.slice(at + 1)];
  }
  S.dirty.chain = true;
  const p = pursuerOf(S, id);
  if (p) setIntel(S, p, t, false);
  setIntel(S, id, t, false);
  push(S, t, { k: 'back', a: id });
}

/** Out of the chain until the next round: idle too long, or left the room. The chain closes over the gap. */
export function toAudience(S, t, id) {
  const st = S.rs[id];
  if (!st || st.aud) return;
  st.aud = 1;
  S.dirty.rs = true;
  dropFromChain(S, t, id);
  push(S, t, { k: 'audience', a: id });
}
export function leave(S, t, id) {
  const m = S.r.m[id];
  if (!m || m.gone) return;
  m.gone = 1;
  S.dirty.r = true;
  dropFromChain(S, t, id);
  push(S, t, { k: 'left', a: id });
}
function dropFromChain(S, t, id) {
  const p = pursuerOf(S, id);
  if (S.chain.includes(id)) {
    S.chain = S.chain.filter((x) => x !== id);
    S.dirty.chain = true;
  }
  if (p && p !== id) setIntel(S, p, t, false);
}

/** Pursuer warning: is this masker's pursuer within the heart range with a clear line (smoke blocks it)? */
export function pursuerNear(S, t, id) {
  const p = pursuerOf(S, id);
  if (!p || isOut(S, p, t) || isOut(S, id, t)) return false;
  const a = S.pos?.[p];
  const b = S.pos?.[id];
  if (!a || !b) return false;
  if (dist(a.x, a.z, b.x, b.z) > SEEN.heart) return false;
  return lineOfSight(PLAZAS[S.r.plaza], a.x, a.z, b.x, b.z) && !smokeBetween(S, t, a.x, a.z, b.x, b.z);
}

/** Ranking with shared places for ties: [{ id, pts, place }]. */
export function standings(scores, ids = Object.keys(scores)) {
  const rows = ids.map((id) => ({ id, pts: scores[id]?.pts ?? 0 })).sort((a, b) => b.pts - a.pts || (a.id < b.id ? -1 : 1));
  let place = 0;
  rows.forEach((r, i) => {
    if (i === 0 || r.pts !== rows[i - 1].pts) place = i + 1;
    r.place = place;
  });
  return rows;
}

/** Adds a round's scores into match totals. */
export function addTotals(tot, S) {
  const out = { ...tot };
  for (const [id, sc] of Object.entries(S.sc)) {
    const m = S.r.m[id];
    const t = out[id] ? { ...out[id] } : { pts: 0, unm: 0, faux: 0, caught: 0, close: 0, wrong: 0, hush: 0, best: 0, rounds: 0, nm: m.nm, b: m.b };
    t.pts += sc.pts;
    t.unm += sc.unm;
    t.faux += sc.faux;
    t.caught += sc.caught;
    t.close += sc.close;
    t.wrong += sc.wrong;
    t.hush += sc.hush;
    t.best = Math.max(t.best, sc.best);
    t.rounds += 1;
    t.nm = m.nm;
    t.b = m.b;
    out[id] = t;
  }
  return out;
}

/** The match's awards from its totals: Hawkeye, Slapstick, Ghost, Master of Disguise. */
export function awards(tot) {
  const ids = Object.keys(tot);
  const best = (score, ok) => {
    let top = null;
    for (const id of ids) {
      if (!ok(tot[id])) continue;
      if (!top || score(tot[id]) > score(tot[top])) top = id;
    }
    return top;
  };
  return {
    hawkeye: best((t) => t.unm * 1000 - t.faux, (t) => t.unm > 0),
    slapstick: best((t) => t.faux, (t) => t.faux > 0),
    ghost: best((t) => t.pts, (t) => t.caught === 0 && t.rounds > 0),
    disguise: best((t) => t.best, (t) => t.best >= 10),
  };
}

export { ABILITY_IDS };

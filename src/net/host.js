// The host's page runs the rules: it steps the round from the room's match clock, checks every request (range, cone,
// cooldowns, poise), writes the round into room state, deals each hunter's clue as a private value, carries the
// bots in its presence and moves rounds and the match along. A new host adopts what the room holds and carries on.
import { createWorld, STEP } from '../sim/world.js';
import * as rules from '../sim/rules.js';
import { hash32 } from '../sim/rng.js';
import { ABILITY_IDS, CROWD, ABILITIES } from '../sim/const.js';
import { PLAZAS } from '../sim/plazas.js';
import { safe, matchSettings } from '../platform.js';
import { packRound, readRound, readStatus, readScores, readFx, readEvents, readGame, readIntel, readRequest, readPresence, r2 } from './wire.js';

const FINAL_PUBLIC = 32000;
const FINAL_PRIVATE = 45000;

export function createHost(room, hooks = {}) {
  let W = null;
  let G = null;
  let queue = [];
  let lastRs = 0;
  let lastFast = 0;
  let lastHb = 0;
  const hb = new Map();
  const idleSince = new Map();
  const answered = new Set();
  let admitted = '';
  const me = () => safe(() => room.me.id, '');

  const writeGame = () => safe(() => room.setState('g', { ...G }), null, 'setState g');

  function settingsNow() {
    const s = matchSettings(room);
    return { mode: s.mode, rounds: s.rounds, minutes: s.length, crowd: CROWD[s.crowd] ?? 9, loadouts: s.loadout, skill: s.bots === 'off' ? 'adept' : s.bots, bots: s.bots !== 'off' };
  }

  /** Who plays the next round: the match's players who are still in the room (connected, or holding their seat). */
  function roster() {
    const ids = safe(() => room.match.participants, []) || [];
    const out = [];
    for (const id of ids) {
      const p = safe(() => room.players.get(id), null);
      if (!p) continue;
      const lo = safe(() => room.privateOf(id)?.lo, null);
      out.push({ id, name: p.name, ab: Array.isArray(lo?.ab) ? lo.ab : [], unlocked: ABILITY_IDS });
    }
    return out.slice(0, 10);
  }

  function startMatch() {
    const st = settingsNow();
    const match = room.match;
    G = { v: 1, mid: match.id, by: me(), n: 0, t0: 0, rounds: st.rounds, tot: {}, fin: 0, mode: st.mode, plz: (match.seed >>> 0) % PLAZAS.length };
    nextRound();
  }

  function nextRound() {
    const st = settingsNow();
    const n = G.n + 1;
    const now = room.matchNow();
    const cfg = {
      mid: G.mid,
      n,
      mode: st.mode,
      plaza: ((G.plz ?? 0) + n - 1) % PLAZAS.length,
      seed: hash32('carnevale', room.match.seed, n),
      crowd: st.crowd,
      minutes: st.minutes,
      skill: st.skill,
      loadouts: st.loadouts,
      bots: st.bots,
      humans: roster(),
    };
    W = createWorld(cfg, { t: 0 });
    G = { ...G, n, t0: now, by: me() };
    queue = [];
    answered.clear();
    hb.clear();
    writeGame();
    flush(true);
  }

  /** A new host: rebuild the round from room state, the secrets from private values, the bots from the old presence. */
  function adopt() {
    const g = readGame(safe(() => room.state.g, null));
    const match = room.match;
    if (!g || g.mid !== match.id) return startMatch();
    G = { ...g, v: 1, plz: safe(() => room.state.g.plz, 0) | 0 };
    const r = readRound(safe(() => room.state.r, null));
    if (!r || r.rid !== `${g.mid}.${g.n}`) {
      // The round never made it into the room (the old host went at that moment): start it again.
      G.n = Math.max(0, g.n - 1);
      return nextRound();
    }
    const { endAt, closed, seq, timing, case: cs, ...rest } = r;
    const rr = { ...rest };
    delete rr.t0;
    const S = {
      v: 1,
      r: rr,
      rs: readStatus(safe(() => room.state.rs, null), r),
      fx: readFx(safe(() => room.state.fx, null), r),
      sc: readScores(safe(() => room.state.sc, null), r),
      ev: readEvents(safe(() => room.state.ev, null)),
      seq,
      chain: [],
      intel: {},
      timing,
      endAt: endAt < 0 ? Infinity : endAt,
      case: cs ? { ...cs, clueAt: 0, next: 0, alert: null } : null,
      closed,
      pos: {},
      dirty: { r: true, rs: true, fx: true, sc: true, ev: true, chain: true, intel: new Set() },
    };
    for (const id of Object.keys(S.r.m)) {
      if (!S.rs[id]) S.rs[id] = { p: 70, fl: 0, sl: 0, out: 0, aud: 0, cu: 0, cg: 0, c1: 0, c2: 0, lf: -999, op: 0 };
      if (!S.sc[id]) S.sc[id] = { pts: 0, unm: 0, faux: 0, caught: 0, close: 0, wrong: 0, hush: 0, best: 0, streak: 0 };
    }
    S.seq = Math.max(S.seq, ...S.ev.map((e) => e.q), 0);
    const t = (room.matchNow() - G.t0) / 1000;
    // The chain: the old host's copy if it is this round's, else rebuilt from each player's own clue.
    const old = safe(() => room.privateOf(g.by)?.chain, null);
    const active = (id) => S.r.m[id] && !S.r.m[id].gone && !S.rs[id].aud;
    if (S.r.mode === 'masq') {
      if (old && old.rid === r.rid && Array.isArray(old.c)) S.chain = old.c.filter((id) => typeof id === 'string' && active(id) && !rules.isOut(S, id, t));
      if (S.chain.length < 2) {
        const known = new Map();
        for (const id of Object.keys(S.r.m)) {
          const q = readIntel(safe(() => room.privateOf(id)?.q, null));
          if (q && q.rid === r.rid && q.q && active(q.q)) known.set(id, q.q);
        }
        const free = Object.keys(S.r.m).filter((id) => active(id) && !rules.isOut(S, id, t));
        const chain = [];
        let cur = free[0];
        while (cur && !chain.includes(cur)) {
          chain.push(cur);
          const nx = known.get(cur);
          cur = nx && free.includes(nx) && !chain.includes(nx) ? nx : free.find((x) => !chain.includes(x));
        }
        S.chain = chain;
      }
      const bi = old && old.rid === r.rid && old.bi && typeof old.bi === 'object' ? old.bi : {};
      for (const id of S.chain) {
        const q = S.r.m[id].b ? bi[id] : readIntel(safe(() => room.privateOf(id)?.q, null));
        const qq = q && (q.rid === undefined || q.rid === r.rid) ? q : null;
        if (qq && qq.q === rules.quarryOf(S, id)) S.intel[id] = { q: qq.q, tr: qq.tr | 0, d: qq.d ?? -1, at: Number(qq.at) || 0, next: (Number(qq.at) || 0) + 40 };
      }
    }
    // Bots resume where the old host last showed them.
    const botPos = new Map();
    const oldPres = readPresence(safe(() => room.players.get(g.by)?.presence, null));
    const bots = Object.keys(S.r.m).filter((id) => S.r.m[id].b).sort();
    if (oldPres?.b && oldPres.r === r.rid) bots.forEach((id, i) => oldPres.b[i] && botPos.set(id, { x: oldPres.b[i][0], z: oldPres.b[i][1], h: oldPres.b[i][2], f: oldPres.b[i][3] }));
    W = createWorld(null, { S, t: Math.max(0, t), botPos });
    rules.ensureIntel(S, W.t);
    G.by = me();
    writeGame();
    flush(true);
  }

  /** Writes what changed into room state (fast parts at up to 10 Hz, statuses at 4 Hz). */
  function flush(force = false) {
    if (!W) return;
    const S = W.S;
    const now = performance.now();
    if (S.dirty.r || force) {
      safe(() => room.setState('r', packRound(S, G.t0)), null, 'setState r');
      S.dirty.r = false;
    }
    if (force || now - lastFast > 100) {
      lastFast = now;
      // Copies: the rules keep changing their own objects, and room state must not change under anyone's feet.
      if (S.dirty.fx || force) safe(() => room.setState('fx', S.fx.map((f) => ({ ...f }))), null, 'setState fx');
      if (S.dirty.sc || force) safe(() => room.setState('sc', Object.fromEntries(Object.entries(S.sc).map(([k, v]) => [k, { ...v, streak: Math.round(v.streak * 10) / 10 }]))), null, 'setState sc');
      if (S.dirty.ev || force) safe(() => room.setState('ev', S.ev.map((e) => ({ ...e }))), null, 'setState ev');
      S.dirty.fx = S.dirty.sc = S.dirty.ev = false;
    }
    if ((S.dirty.rs && now - lastRs > 250) || force) {
      lastRs = now;
      const rs = {};
      for (const [id, s] of Object.entries(S.rs)) rs[id] = { ...s, p: Math.round(s.p) };
      safe(() => room.setState('rs', rs), null, 'setState rs');
      S.dirty.rs = false;
    }
    for (const id of S.dirty.intel) {
      const m = S.r.m[id];
      if (!m || m.b) continue;
      const it = S.intel[id] || { q: null };
      const qn = it.q ? S.r.m[it.q]?.nm : '';
      safe(() => room.setPrivateFor(id, 'q', { rid: S.r.rid, q: it.q, tr: it.tr ?? 0, d: it.d ?? -1, at: r2(it.at ?? 0), nm: qn }), null, 'setPrivateFor q');
    }
    if (S.dirty.intel.size || S.dirty.chain || force) {
      const bi = {};
      for (const id of S.chain) if (S.r.m[id].b && S.intel[id]) bi[id] = { q: S.intel[id].q, tr: S.intel[id].tr, d: S.intel[id].d, at: r2(S.intel[id].at) };
      safe(() => room.setPrivate('chain', { rid: S.r.rid, c: S.chain, bi }), null, 'setPrivate chain');
      S.dirty.chain = false;
    }
    S.dirty.intel.clear();
  }

  /** A request from a player (or the host's own page). Checked, then applied to the round. */
  function apply(from, req) {
    if (!W || !req) return null;
    const S = W.S;
    if (!S.r.m[from] || S.r.m[from].gone) return null;
    const t = W.t;
    if (req.t === 'um') return rules.unmask(S, t, from, req.ref, req.pose, W.buf);
    if (req.t === 'gr') return rules.greet(S, t, from, req.ref, W.buf);
    if (req.t === 'ab') return rules.ability(S, t, from, req.a, { ...req.pose, tx: req.tx, tz: req.tz }, W.buf);
    if (req.t === 'an') {
      // Only an answer to a greeting aimed at you, or a lantern that landed by you, and only once.
      const key = `${from}:${req.g}`;
      if (answered.has(key)) return null;
      const ev = S.ev.find((e) => e.q === req.g);
      if (!ev || t - ev.t > 3) return null;
      if (ev.k === 'greet' && ev.b !== from) return null;
      if (ev.k === 'lantern') {
        const p = S.pos?.[from];
        const lf = S.fx.find((f) => f.k === 'lantern' && Math.abs(f.t - ev.t) < 0.05);
        if (!p || !lf || Math.hypot(p.x - lf.x, p.z - lf.z) > ABILITIES.lantern.radius + 1) return null;
      } else if (ev.k !== 'greet') return null;
      answered.add(key);
      return rules.answer(S, t, from, req.g, req.d);
    }
    if (req.t === 'lo') {
      if (rules.stage(S, t) !== 'assign' || S.r.chaos || req.ab.length !== 2 || req.ab[0] === req.ab[1]) return null;
      S.r.m[from].ab = req.ab;
      S.dirty.r = true;
      return { ok: true };
    }
    return null;
  }

  function feedPlayers(t) {
    const S = W.S;
    const tmp = { x: 0, z: 0, h: 0, sp: 0 };
    for (const [id, m] of Object.entries(S.r.m)) {
      if (m.b || m.gone) continue;
      const p = safe(() => room.players.get(id), null);
      if (!p) {
        rules.leave(S, t, id);
        continue;
      }
      if (rules.isOut(S, id, t)) continue;
      const pres = readPresence(p.presence);
      if (pres && pres.r === S.r.rid && (pres.s === 'p' || pres.s === 'k')) W.place(id, pres.x, pres.z, pres.h, pres.f);
      else if (W.slotPos(id, tmp)) W.place(id, tmp.x, tmp.z, tmp.h, rules.FLAG.locked);
      // Idle players (the platform's flag) shimmer, then sit out the rest of the round as audience.
      if (p.idle && p.connected !== false) {
        if (!idleSince.has(id)) idleSince.set(id, t);
        W.idle.set(id, Math.max(0.01, t - idleSince.get(id)));
      } else {
        idleSince.delete(id);
        W.idle.delete(id);
      }
    }
  }

  function heartbeats(t) {
    const S = W.S;
    if (S.r.mode !== 'masq') return;
    for (const [id, m] of Object.entries(S.r.m)) {
      if (m.b || m.gone) continue;
      const near = rules.pursuerNear(S, t, id) ? 1 : 0;
      if ((hb.get(id) ?? 0) === near) continue;
      hb.set(id, near);
      if (id === me()) hooks.onHeartbeat?.(near);
      else safe(() => room.send({ t: 'hb', rid: S.r.rid, on: near }, { to: id }), null, 'send hb');
    }
  }

  /** Watchers who said they want in (presence 'w', not idle) join the match at the next round. */
  function admitWatchers() {
    const ids = [];
    for (const p of safe(() => room.spectators, []) || []) {
      const pres = readPresence(p.presence);
      if (pres?.s === 'w' && !p.idle) ids.push(p.id);
    }
    const key = ids.join(',');
    if (ids.length && key !== admitted) {
      admitted = key;
      safe(() => room.admit(ids), null, 'admit');
    }
  }

  const host = {
    get world() {
      return W;
    },
    get game() {
      return G;
    },
    active: () => safe(() => room.isHost && room.connected, false),
    reset() {
      W = null;
      G = null;
      queue = [];
      hb.clear();
      idleSince.clear();
    },
    /** A message from another player. at/matchTime: the room's clock when it arrived. */
    onMessage(data, from, matchTime) {
      if (!host.active() || !W || !from) return;
      const r = W.S.r;
      const req = readRequest(data, { ...r, rid: r.rid });
      if (!req) return;
      queue.push({ from: from.id, at: Number(matchTime) || 0, req });
      if (queue.length > 200) queue.splice(0, queue.length - 200);
    },
    /** The host's own action, applied straight away. */
    local(req) {
      if (!W) return null;
      const r = readRequest({ ...req, rid: W.S.r.rid }, W.S.r);
      return r ? apply(me(), r) : null;
    },
    /** Called every frame. */
    tick() {
      if (!host.active()) {
        W = null;
        return;
      }
      const match = room.match;
      if (!match || match.phase !== 'playing') {
        W = null;
        G = null;
        return;
      }
      const g = readGame(safe(() => room.state.g, null));
      if (!W || !G || G.mid !== match.id || (g && g.by && g.by !== me() && g.mid === match.id) || W.S.r.rid !== `${G.mid}.${G.n}`) adopt();
      if (!W || !safe(() => room.running, false)) return;
      const now = room.matchNow();
      if (G.fin) {
        if (now >= G.fin) safe(() => room.endMatch(), null, 'endMatch');
        return;
      }
      const t = (now - G.t0) / 1000;
      // Requests first, earliest first (two unmasks on one face: the room's clock decides).
      if (queue.length) {
        const q = queue.sort((a, b) => a.at - b.at || (a.from < b.from ? -1 : 1));
        queue = [];
        for (const item of q) apply(item.from, item.req);
      }
      let steps = 0;
      while (W.t + STEP <= t && steps < 30) {
        feedPlayers(W.t + STEP);
        W.step(STEP);
        steps++;
      }
      // A long freeze (a hidden tab): jump, don't replay a minute of rules.
      if (t - W.t > 3) W.t = t;
      if (now - lastHb > 250) {
        lastHb = now;
        heartbeats(W.t);
      }
      const st = rules.stage(W.S, W.t);
      if (st === 'results') admitWatchers();
      if (st === 'over') {
        G.tot = rules.addTotals(G.tot, W.S);
        if (G.n < G.rounds) nextRound();
        else {
          G.fin = now + (room.kind === 'private' ? FINAL_PRIVATE : FINAL_PUBLIC);
          writeGame();
        }
      }
      flush();
    },
    /** A private server's host ends the podium early. */
    finish() {
      if (host.active() && G?.fin) safe(() => room.endMatch(), null, 'endMatch');
    },
    /** Bots for the host's presence: [[x, z, h, flags], ...] in id order. */
    botPresence() {
      if (!W) return null;
      const S = W.S;
      return W.bots
        .slice()
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((B) => {
          const p = S.pos?.[B.id];
          return p ? [r2(p.x), r2(p.z), r2(p.h), p.f | 0] : [0, 0, 0, 0];
        });
    },
  };
  return host;
}

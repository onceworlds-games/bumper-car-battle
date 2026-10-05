// The match over the network. One state record `g` per match is written by the host's page; every page draws from it.
// The host's page also drives the bots (a Round) and judges who has fallen. Follows the party template: everything a new
// host needs is in room state (`g`, the bots' snapshot `b`), deadlines are match time, and adopt() is safe to call again.
//
// g: { mid, by, round, rounds, rid, phase: 'intro'|'play'|'end'|'board'|'final', until (match ms), t0 (match ms play began),
//      tEnd (ms of play when the round ended, 0 while it runs), roster: [{id, bot, n, c}], scores, kos, surv: {id: n},
//      out: {id: [n, by, x, y, vx, vy]} (this round's falls, in order), rp: {id: round points}|null, rk: [ids]|null,
//      win: id|'', small: 0|1 }
// b:  { rid, t (match ms), p: [[x, y, vx, vy, heading, flags], ...] } the bots, in roster order

import { Round } from './round.js';
import { BOARD_MS, DEFAULT_ROUNDS, END_MS, FINAL_MS, INTRO_MS, ROUND_MS, ROUND_OPTIONS, buildRoster, radiusAt } from './rules.js';
import { HEAVY_T } from './sim.js';

const PHASES = new Set(['intro', 'play', 'end', 'board', 'final']);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** env: { vOf(id) -> the page's view of that car ({x,y,vx,vy,heavy,fresh,pOut}) or null, onHit(fromId) } */
export function createNet(room, env) {
  let round = null; // the host's Round for g.rid
  let roundRid = '';
  let lastB = -1e9;
  const reported = new Set(); // `${rid}|${id}` of hit counts the host has taken

  // ---------------------------------------------------------------- the record
  let rawG = null;
  let goodG = null;
  let goodMid = '';

  function cleanG(g) {
    if (!isObj(g) || typeof g.mid !== 'string' || g.mid !== room.match.id || typeof g.by !== 'string') return null;
    if (!PHASES.has(g.phase) || typeof g.rid !== 'string') return null;
    if (!Number.isFinite(g.round) || g.round < 1 || g.round > 9 || !Number.isFinite(g.rounds) || g.rounds < 1 || g.rounds > 9) return null;
    if (!Number.isFinite(g.until) || !Number.isFinite(g.t0) || !Number.isFinite(g.tEnd)) return null;
    if (!Array.isArray(g.roster) || g.roster.length < 1 || g.roster.length > 12) return null;
    for (const e of g.roster) {
      if (!isObj(e) || typeof e.id !== 'string' || e.id.length > 80 || !Number.isFinite(e.c)) return null;
      if (e.bot && typeof e.n !== 'string') return null;
    }
    if (!isObj(g.scores) || !isObj(g.kos) || !isObj(g.surv) || !isObj(g.out)) return null;
    return g;
  }

  /** The record of this match (valid and not left over from the last one), or null. */
  function G() {
    const raw = room.state.g;
    if (raw === rawG && goodMid === room.match.id) return goodG;
    rawG = raw;
    goodMid = room.match.id;
    goodG = cleanG(raw);
    return goodG;
  }

  const write = (patch) => room.setState('g', { ...(G() ?? {}), ...patch });
  const hosting = (g) => room.isHost && room.running && g && g.by === room.me.id;
  const roundsSetting = () => {
    const v = Number(room.settings?.rounds);
    return ROUND_OPTIONS.includes(v) ? v : DEFAULT_ROUNDS;
  };

  /** Play time of the round (ms since GO), frozen once the round has ended. */
  function tPlay(g) {
    if (g.phase === 'intro') return 0;
    const t = room.matchNow() - g.t0;
    return clamp(t, 0, g.tEnd > 0 ? g.tEnd : Infinity);
  }

  // ---------------------------------------------------------------- the host's page runs the match
  function startMatch() {
    if (!room.isHost) return;
    const ids = (room.match.participants || []).filter((id) => typeof id === 'string');
    const roster = buildRoster(ids, num(room.match.seed, 1));
    const zero = () => Object.fromEntries(roster.map((r) => [r.id, 0]));
    round = null;
    roundRid = '';
    reported.clear();
    room.setState('g', {
      mid: room.match.id,
      by: room.me.id,
      round: 1,
      rounds: roundsSetting(),
      rid: `${room.match.id}.1`,
      phase: 'intro',
      until: room.matchNow() + INTRO_MS,
      t0: 0,
      tEnd: 0,
      roster,
      scores: zero(),
      kos: zero(),
      surv: zero(),
      out: {},
      rp: null,
      rk: null,
      win: '',
      small: 0,
    });
  }

  function nextRound(g) {
    const n = g.round + 1;
    if (n > g.rounds) {
      write({ phase: 'final', until: room.matchNow() + FINAL_MS, rid: `${g.mid}.final`, out: {} });
      return;
    }
    round = null;
    roundRid = '';
    write({ round: n, rid: `${g.mid}.${n}`, phase: 'intro', until: room.matchNow() + INTRO_MS, t0: 0, tEnd: 0, out: {}, rp: null, rk: null, win: '', small: 0 });
  }

  function ensureRound(g) {
    if (round && roundRid === g.rid) return round;
    round = new Round(g.roster, num(room.match.seed, 1), g.round);
    roundRid = g.rid;
    round.restoreOut(g.out);
    const b = room.state.b;
    if (isObj(b) && b.rid === g.rid) round.restoreBots(b.p);
    return round;
  }

  /** Take the record over from the previous host: the same state, written by us from now on. */
  function takeOver() {
    round = null;
    roundRid = '';
    write({ by: room.me.id });
  }

  /** Carries on as the host: from room state. Safe to call as often as you like. */
  function adopt() {
    if (!room.isHost || !room.running) return;
    const g = G();
    if (!g) return startMatch();
    if (g.by !== room.me.id) takeOver();
  }

  function flushOut() {
    if (!round) return;
    write({ out: round.outObject() });
    round.dirty = false;
  }

  function finishRound(g, now, t) {
    const res = round.finish(t);
    const scores = { ...g.scores };
    const kos = { ...g.kos };
    const surv = { ...g.surv };
    for (const [id, pts] of Object.entries(res.points)) scores[id] = (scores[id] || 0) + pts;
    for (const [id, k] of Object.entries(res.kos)) kos[id] = (kos[id] || 0) + k;
    for (const c of round.cars) if (c.kind === 'bot') surv[c.id] = (surv[c.id] || 0) + round.survivedHits(c.id);
    write({ phase: 'end', until: now + END_MS, tEnd: Math.max(1, Math.round(t)), rk: res.ranking, rp: res.points, win: res.winner, small: res.small ? 1 : 0, scores, kos, surv, out: round.outObject() });
    round.dirty = false;
  }

  /** The host's ticker, every 100 ms. Only acts for the host of a running match. */
  function tick() {
    const g = G();
    // The host changed hands but the old host's last write landed after ours: ours wins again.
    if (g && room.isHost && room.running && g.by !== room.me.id) return takeOver();
    if (!hosting(g)) return;
    const now = room.matchNow();
    if (g.phase === 'intro') {
      if (now >= g.until) {
        ensureRound(g);
        write({ phase: 'play', t0: now, until: now + ROUND_MS });
      }
    } else if (g.phase === 'play') {
      const r = ensureRound(g);
      const t = now - g.t0;
      const R = radiusAt(t);
      // People who left, away ones the edge has taken, pages that said so by presence but whose message never came.
      for (const c of r.cars) {
        if (c.kind !== 'ext' || c.out) continue;
        const p = room.players.get(c.id);
        if (!p) {
          r.eliminate(c.id, { by: '', x: c.x, y: c.y, vx: 0, vy: 0 }, t);
          continue;
        }
        const v = env.vOf(c.id);
        if (v && v.fresh) {
          const rr = Math.hypot(v.x, v.y);
          if (p.connected === false && rr > R) r.eliminate(c.id, { by: '', x: v.x, y: v.y, vx: 0, vy: 0 }, t); // away: standing still, and the edge took the floor
          else if (v.pOut || rr > R + 0.4) {
            // Their page says they are out (or they are far beyond the edge), but their own report hasn't come: it has a second,
            // because it carries who knocked them out.
            if (!c.pOutSince) c.pOutSince = now;
            else if (now - c.pOutSince > 1000) r.eliminate(c.id, { by: '', x: v.x, y: v.y, vx: v.vx, vy: v.vy }, t);
          } else c.pOutSince = 0;
        }
      }
      if (r.dirty) flushOut();
      if (r.isOver(t)) finishRound(G(), now, t);
    } else if (g.phase === 'end') {
      if (now >= g.until) write({ phase: 'board', until: now + BOARD_MS });
    } else if (g.phase === 'board') {
      if (now >= g.until) nextRound(g);
    } else if (g.phase === 'final') {
      if (now >= g.until) room.endMatch(); // back to the lobby, ready flags cleared
    }
  }

  /** Called every fixed step on every page: only the host's does anything. Drives the bots. */
  function hostFrame(dt) {
    const g = G();
    if (!hosting(g) || (g.phase !== 'play' && g.phase !== 'end')) return;
    const r = ensureRound(g);
    const now = room.matchNow();
    const t = g.phase === 'play' ? Math.max(0, now - g.t0) : g.tEnd;
    for (const c of r.cars) {
      if (c.kind !== 'ext' || c.out) continue;
      const v = env.vOf(c.id);
      if (!v || !v.fresh) continue;
      c.x = v.x;
      c.y = v.y;
      c.vx = v.vx;
      c.vy = v.vy;
      c.heavy = v.heavy > 0 ? HEAVY_T * 0.5 : 0;
    }
    r.step(dt, t, g.phase !== 'play');
    if (r.dirty) flushOut();
    if (now - lastB >= 80) {
      lastB = now;
      room.setState('b', { rid: g.rid, t: Math.round(now), p: r.snapshotBots() });
    }
  }

  // ---------------------------------------------------------------- what people tell the host
  /** A person fell in (told by their own page, or by this page for its own player). info: { rid, by, x, y, vx, vy, h }. */
  function hostOut(fromId, info) {
    const g = G();
    if (!hosting(g) || g.phase !== 'play' || !isObj(info) || info.rid !== g.rid) return;
    const entry = g.roster.find((e) => e.id === fromId);
    if (!entry || entry.bot || g.out[fromId]) return;
    const r = ensureRound(g);
    const by = typeof info.by === 'string' && info.by !== fromId && g.roster.some((e) => e.id === info.by) ? info.by : '';
    const lim = (v) => clamp(num(v), -40, 40);
    const n = r.eliminate(fromId, { by, x: lim(info.x), y: lim(info.y), vx: lim(info.vx), vy: lim(info.vy) }, Math.max(0, room.matchNow() - g.t0));
    if (!n) return;
    const hits = Math.max(0, clamp(Math.round(num(info.h)), 0, 99) - (by ? 1 : 0));
    reported.add(`${g.rid}|${fromId}`);
    const surv = { ...g.surv, [fromId]: (g.surv[fromId] || 0) + hits };
    write({ out: r.outObject(), surv });
    r.dirty = false;
  }

  /** The hits a surviving person took this round (sent when the round ends). */
  function hostHits(fromId, info) {
    const g = G();
    if (!hosting(g) || (g.phase !== 'end' && g.phase !== 'board') || !isObj(info) || info.rid !== g.rid) return;
    const entry = g.roster.find((e) => e.id === fromId);
    const key = `${g.rid}|${fromId}`;
    if (!entry || entry.bot || reported.has(key)) return;
    reported.add(key);
    const h = clamp(Math.round(num(info.h)), 0, 99);
    if (h > 0) write({ surv: { ...g.surv, [fromId]: (g.surv[fromId] || 0) + h } });
  }

  room.on('message', (d, from) => {
    if (!isObj(d) || !from || typeof from.id !== 'string') return;
    if (d.t === 'out') hostOut(from.id, d);
    else if (d.t === 'hits') hostHits(from.id, d);
    else if (d.t === 'hit') env.onHit(from.id, d);
  });

  return {
    G,
    tPlay,
    adopt,
    tick,
    hostFrame,
    startMatch,
    /** This page's player fell: tell the host (or be the host). */
    sendOut(info) {
      if (room.isHost) hostOut(room.me.id, info);
      else room.send({ t: 'out', rid: info.rid, by: info.by, x: info.x, y: info.y, vx: info.vx, vy: info.vy, h: info.h }, { to: room.host });
    },
    /** This page's player hit another person. */
    sendHit(toId, rid) {
      room.send({ t: 'hit', rid }, { to: toId });
    },
    /** The round ended and this player is still in: how many hits they took. */
    sendHits(rid, h) {
      if (room.isHost) hostHits(room.me.id, { rid, h });
      else room.send({ t: 'hits', rid, h }, { to: room.host });
    },
    /** The host's Round (bots and their ghosts), or null on other pages. */
    get round() {
      const g = G();
      return round && g && roundRid === g.rid && room.isHost ? round : null;
    },
    reset() {
      round = null;
      roundRid = '';
      lastB = -1e9;
      reported.clear();
    },
  };
}

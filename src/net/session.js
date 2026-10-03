// Every page's view of the room: the round mirrored from room state (parsed once per change, defensively), my clue
// from my private values, my presence out at 15 Hz (the host adds its bots), requests to the host, and where every
// other masker is, drawn 100 ms behind so they glide.
import { createCrowd } from '../sim/crowd.js';
import { PLAZAS } from '../sim/plazas.js';
import { FLAG } from '../sim/rules.js';
import { wrap } from '../sim/geom.js';
import { safe } from '../platform.js';
import { readRound, readStatus, readScores, readFx, readEvents, readGame, readIntel, readPresence, r2 } from './wire.js';

export function createSession(room, host, hooks = {}) {
  const cache = { g: null, r: null, rs: {}, sc: {}, fx: [], ev: [], intel: null };
  let crowd = null;
  let crowdKey = '';
  let lastPresence = 0;
  let unwrapped = 0;
  let lastH = 0;
  const botH = new Map();

  function parse(key) {
    const st = safe(() => room.state, {}) || {};
    if (key === 'g' || !key) cache.g = readGame(st.g);
    if (key === 'r' || !key) cache.r = readRound(st.r);
    if (key === 'rs' || key === 'r' || !key) cache.rs = readStatus(st.rs, cache.r);
    if (key === 'sc' || key === 'r' || !key) cache.sc = readScores(st.sc, cache.r);
    if (key === 'fx' || key === 'r' || !key) cache.fx = readFx(st.fx, cache.r);
    if (key === 'ev' || !key) {
      cache.ev = readEvents(st.ev);
      hooks.onEvents?.(cache.ev);
    }
  }
  function readMine() {
    cache.intel = readIntel(safe(() => room.private?.q, null));
  }
  parse();
  readMine();
  safe(() => room.on('state', (key) => parse(key)));
  safe(() => room.on('private', (key, value, pid) => {
    if (key === 'q' && (!pid || pid === room.me.id)) readMine();
  }));
  safe(() => room.on('reconnect', () => (parse(), readMine())));
  safe(() => room.on('message', (data, from, at, matchTime) => {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'hb') {
      // Only the host tells you your pursuer is near.
      if (from?.id === room.host && data.rid === cache.r?.rid) hooks.onHeartbeat?.(data.on ? 1 : 0);
      return;
    }
    host.onMessage(data, from, matchTime);
  }));

  const me = () => safe(() => room.me.id, '');
  const session = {
    room,
    host,
    get me() {
      return me();
    },
    get game() {
      return cache.g;
    },
    /** The current round, if it belongs to the running match (a stale one from the last match reads as none). */
    get round() {
      const r = cache.r;
      const m = safe(() => room.match, null);
      if (!r || !m || m.phase !== 'playing' || !r.rid.startsWith(`${m.id}.`)) return null;
      return r;
    },
    get status() {
      return cache.rs;
    },
    get scores() {
      return cache.sc;
    },
    get fx() {
      return cache.fx;
    },
    get events() {
      return cache.ev;
    },
    get intel() {
      const r = session.round;
      return r && cache.intel && cache.intel.rid === r.rid ? cache.intel : null;
    },
    /** Round time in seconds (the match clock: it stands still while the match waits). */
    time() {
      const r = session.round;
      return r ? (safe(() => room.matchNow(), 0) - r.t0) / 1000 : 0;
    },
    /** The crowd for a round, built once per round. */
    crowdFor(r) {
      const key = `${r.rid}:${r.plaza}:${r.seed}:${r.crowd}`;
      if (key !== crowdKey) {
        crowdKey = key;
        crowd = createCrowd(PLAZAS[r.plaza], r.seed, r.crowd);
      }
      return crowd;
    },
    /** Sends a request to the host (or applies it, on the host's own page). */
    request(req) {
      const r = session.round;
      if (!r) return null;
      if (host.active()) return host.local(req);
      safe(() => room.send({ ...req, rid: r.rid }, { to: room.host }), null, 'send');
      return true;
    },
    /** My presence: what I'm doing (title, watching, playing, rehearsal, powder room) and where I am. 15 Hz. */
    presence(p, nowMs, force = false) {
      if (!force && nowMs - lastPresence < 66) return;
      lastPresence = nowMs;
      // Headings travel unwrapped so a turn through south never spins the long way on other screens.
      unwrapped += wrap((p.h ?? 0) - lastH);
      lastH = p.h ?? 0;
      const out = { s: p.s, r: p.r ?? '', x: r2(p.x ?? 0), z: r2(p.z ?? 0), h: r2(unwrapped), f: p.f | 0, tr: p.tr ?? -1, sl: p.sl ?? -1 };
      if (p.w) out.w = p.w;
      if (p.e) out.e = p.e;
      if (host.active()) {
        const b = host.botPresence();
        if (b) {
          out.b = b.map((q, i) => {
            const prev = botH.get(i) ?? q[2];
            const h = prev + wrap(q[2] - prev);
            botH.set(i, h);
            return [q[0], q[1], r2(h), q[3]];
          });
        }
      }
      safe(() => room.setPresence(out), null, 'presence');
    },
    /**
     * Where another masker is to draw them: humans from their presence, bots from the host's (or the host's own
     * world). Writes {x, z, h, f, w, e} into out, or returns null when they aren't in this round's plaza yet.
     */
    pose(id, r, out) {
      const m = r.m[id];
      if (!m) return null;
      if (m.b) {
        const W = host.active() ? host.world : null;
        if (W && W.S.r.rid === r.rid) {
          const p = W.S.pos?.[id];
          if (!p) return null;
          out.x = p.x;
          out.z = p.z;
          out.h = p.h;
          out.f = p.f;
          out.w = null;
          out.e = null;
          return out;
        }
        const bots = Object.keys(r.m).filter((k) => r.m[k].b).sort();
        const i = bots.indexOf(id);
        const hp = readPresence(safe(() => room.presenceAt(room.host), null));
        if (!hp || hp.r !== r.rid || !hp.b || !hp.b[i]) return null;
        const q = hp.b[i];
        out.x = q[0];
        out.z = q[1];
        out.h = q[2];
        out.f = q[3];
        out.w = null;
        out.e = null;
        return out;
      }
      const raw = safe(() => room.presenceAt(id, { angles: ['h'], snap: 5 }), null);
      const p = readPresence(raw);
      if (!p || p.r !== r.rid || (p.s !== 'p' && p.s !== 'k')) return null;
      // Snapping flags and answers come from the newest update, not the in-between one.
      const latest = readPresence(safe(() => room.players.get(id)?.presence, null));
      out.x = p.x;
      out.z = p.z;
      out.h = p.h;
      out.f = latest ? latest.f : p.f;
      out.w = latest?.w ?? null;
      out.e = latest?.e ?? null;
      return out;
    },
    isLocked: (f) => (f & FLAG.locked) !== 0,
  };
  return session;
}

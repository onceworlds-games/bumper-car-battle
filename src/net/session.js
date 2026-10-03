// Every page's view of the room: the round mirrored from room state (parsed once per change, defensively), my clue
// from my private values, my presence out at 15 Hz (the host adds its bots), requests to the host, and where every
// other masker is, drawn 100 ms behind so they glide.
import { createCrowd } from '../sim/crowd.js';
import { PLAZAS } from '../sim/plazas.js';
import { FLAG } from '../sim/rules.js';
import { wrap, TAU } from '../sim/geom.js';
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
  // Room state is read lazily: a key is parsed again only when its value object changed (the host's own writes
  // change room.state without an event on its own page, so events alone would miss them).
  const seen = { g: undefined, r: undefined, rs: undefined, sc: undefined, fx: undefined, ev: undefined, q: undefined };
  function fresh(key) {
    const st = safe(() => room.state, {}) || {};
    const raw = st[key];
    if (raw === seen[key]) return false;
    seen[key] = raw;
    return true;
  }
  function sync() {
    const st = safe(() => room.state, {}) || {};
    const rChanged = fresh('r');
    if (fresh('g')) cache.g = readGame(st.g);
    if (rChanged) cache.r = readRound(st.r);
    if (fresh('rs') || rChanged) cache.rs = readStatus(st.rs, cache.r);
    if (fresh('sc') || rChanged) cache.sc = readScores(st.sc, cache.r);
    if (fresh('fx') || rChanged) cache.fx = readFx(st.fx, cache.r);
    if (fresh('ev')) cache.ev = readEvents(st.ev);
    const q = safe(() => room.private?.q, null);
    if (q !== seen.q) {
      seen.q = q;
      cache.intel = readIntel(q);
    }
  }
  sync();
  let syncedAt = -1;
  const synced = () => {
    // At most once per frame.
    const now = performance.now();
    if (now - syncedAt < 4) return;
    syncedAt = now;
    sync();
  };
  safe(() => room.on('message', (data, from, at, matchTime) => {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'hb') {
      // Only the host tells you your pursuer is near.
      if (from?.id === room.host && data.rid === cache.r?.rid) hooks.onHeartbeat?.(data.on ? 1 : 0);
      return;
    }
    if (data.t === 'cc') {
      // Only the host tells you your pursuer blundered beside you.
      if (from?.id === room.host && data.rid === cache.r?.rid) hooks.onClose?.();
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
      synced();
      return cache.g;
    },
    /** The current round, if it belongs to the running match (a stale one from the last match reads as none). */
    get round() {
      synced();
      const r = cache.r;
      const m = safe(() => room.match, null);
      if (!r || !m || m.phase !== 'playing' || !r.rid.startsWith(`${m.id}.`)) return null;
      return r;
    },
    get status() {
      synced();
      return cache.rs;
    },
    get scores() {
      synced();
      return cache.sc;
    },
    get fx() {
      synced();
      return cache.fx;
    },
    get events() {
      synced();
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
      // Whole turns are dropped now and then: the number stays small, and the short way round is all that is read.
      if (Math.abs(unwrapped) > 20) unwrapped -= TAU * Math.round(unwrapped / TAU);
      const out = { s: p.s, r: p.r ?? '', x: r2(p.x ?? 0), z: r2(p.z ?? 0), h: r2(unwrapped), f: p.f | 0, tr: p.tr ?? -1, sl: p.sl ?? -1 };
      if (p.w) out.w = p.w;
      if (p.e) out.e = p.e;
      if (p.bn) out.bn = p.bn;
      if (host.active()) {
        const b = host.botPresence();
        if (b) {
          out.b = b.map((q, i) => {
            const prev = botH.get(i) ?? q[2];
            let h = prev + wrap(q[2] - prev);
            if (Math.abs(h) > 20) h -= TAU * Math.round(h / TAU);
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
          out.away = false;
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
        out.away = false;
        return out;
      }
      const raw = safe(() => room.presenceAt(id, { angles: ['h'], snap: 5 }), null);
      const p = readPresence(raw);
      if (!p || p.r !== r.rid || (p.s !== 'p' && p.s !== 'k')) return null;
      // Snapping flags and answers come from the newest update, not the in-between one.
      const latest = readPresence(safe(() => room.players.get(id)?.presence, null));
      // A page that has gone (reload, dropped connection) is drawn in its place in the troupe until it is back.
      out.away = safe(() => room.players.get(id)?.connected === false, false);
      out.x = p.x;
      out.z = p.z;
      out.h = p.h;
      out.f = latest ? latest.f : p.f;
      out.w = latest?.w ?? null;
      out.e = latest?.e ?? null;
      return out;
    },
    /** The banner a player hangs by their name (an index into BANNERS), from their own presence. */
    bannerOf: (id) => readPresence(safe(() => room.players.get(id)?.presence, null))?.bn ?? 0,
    isLocked: (f) => (f & FLAG.locked) !== 0,
  };
  return session;
}

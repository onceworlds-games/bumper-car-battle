// One round of a match: all the cars, the bots driving theirs, the shrinking edge, who has fallen and why.
// Pure, so the tests can play whole matches. In the game the host's page runs one of these: the bots are driven here
// (kind 'bot'), the humans are 'ext' cars whose positions the page copies in from their own pages (and who are never
// moved here), and a human who falls is reported with eliminate(), like a bot that falls on its own.

import { botInput, IDLE, newAI } from './bots.js';
import { mulberry32, hashStr } from './rng.js';
import { MIN_R, R0, ROUND_MS, koCounts, radiusAt, scoreRound, seatOrder, startSpot } from './rules.js';
import { HIT, KO_WINDOW, collideOne, collidePair, makeCar, outside, stepCar } from './sim.js';

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const fin = (v, d) => (Number.isFinite(v) ? v : d);

export class Round {
  /** roster: [{ id, bot }]; seed: the match's; roundNo: 1-based. `demo` rounds never end and have a bouncy wall. */
  constructor(roster, seed, roundNo, opts = {}) {
    this.roster = roster;
    this.seed = seed >>> 0;
    this.roundNo = roundNo;
    this.demo = Boolean(opts.demo);
    this.rng = mulberry32(hashStr(`${this.seed}:${roundNo}`));
    this.cars = [];
    this.byId = new Map();
    this.out = new Map(); // id -> { n, by, x, y, vx, vy, at }
    this.nOut = 0;
    this.t = 0;
    this.dirty = false; // set when someone fell: the host writes the new state, then clears it
    const n = roster.length;
    const seats = seatOrder(n, this.seed, roundNo);
    for (let i = 0; i < n; i++) this._add(roster[i], i, startSpot(seats[i], n));
  }

  _add(entry, idx, spot) {
    const c = makeCar(entry.id, spot.x, spot.y, spot.a);
    c.kind = entry.bot ? 'bot' : 'ext';
    c.idx = idx;
    c.out = false;
    c.lastBy = '';
    c.lastT = -1e9;
    c.hitsTaken = 0;
    c.ai = c.kind === 'bot' ? newAI(this.rng, idx) : null;
    this.cars.push(c);
    this.byId.set(c.id, c);
    return c;
  }

  /** Bots wandering a bouncy rink (title screen and lobby): `extIds` are the people whose cars bots bump into. */
  static createDemo(nBots, seed, extIds = []) {
    const roster = [];
    for (let i = 0; i < nBots; i++) roster.push({ id: `bot${i + 1}`, bot: 1 });
    const round = new Round(roster, seed, 1, { demo: true });
    round.syncExt(extIds);
    return round;
  }

  /** Demo rounds: add and remove the ext cars (people) without disturbing the bots. */
  syncExt(ids) {
    const want = new Set(ids);
    this.cars = this.cars.filter((c) => c.kind === 'bot' || want.has(c.id));
    for (const id of [...this.byId.keys()]) if (!this.byId.get(id) || (this.byId.get(id).kind === 'ext' && !want.has(id))) this.byId.delete(id);
    for (const id of ids) {
      if (this.byId.has(id)) continue;
      const c = this._add({ id, bot: 0 }, this.cars.length, { x: 0, y: 0, a: 0 });
      c.x = 99; // until its page puts it somewhere
      c.y = 99;
    }
  }

  alive() {
    return this.cars.filter((c) => !c.out);
  }

  aliveCount() {
    let n = 0;
    for (const c of this.cars) if (!c.out) n++;
    return n;
  }

  /** Advance every bot (and the bots' meetings with everyone) by dt seconds. t: ms since play began. coast: the round is over. */
  step(dt, t, coast = false) {
    this.t = t;
    const demo = this.demo;
    const R = demo ? R0 : radiusAt(t);
    const wall = demo || coast;
    const cars = this.cars;
    for (const c of cars) {
      if (c.kind !== 'bot') continue;
      if (c.out) {
        this._ghost(c, dt, R);
        continue;
      }
      stepCar(c, coast ? IDLE : botInput(c, this, dt, R), dt, R, wall);
    }
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.out) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.out) continue;
        if (a.kind === 'bot' && b.kind === 'bot') {
          if (collidePair(a, b)) this._touched(a, b, t, true);
        } else if (a.kind === 'bot') {
          if (collideOne(a, b)) this._touched(a, b, t, false);
        } else if (b.kind === 'bot') {
          if (collideOne(b, a)) this._touched(b, a, t, false);
        }
      }
    }
    if (!demo && !coast) {
      for (const c of cars) if (c.kind === 'bot' && !c.out && outside(c, R)) this.eliminate(c.id, { x: c.x, y: c.y, vx: c.vx, vy: c.vy }, t);
    }
  }

  // A bot `a` just collided with `b` (HIT says how). Whoever was moving into the other harder did the hitting.
  _touched(a, b, t, bBot) {
    const aHit = HIT.aggA > HIT.aggB; // a was the hitter
    // A "hit taken" is a ram from a car that was boosting, felt by one that wasn't.
    if (!aHit) {
      a.lastBy = b.id;
      a.lastT = t;
      if (b.heavy > 0 && a.heavy <= 0 && HIT.speed >= 4) a.hitsTaken++;
    }
    if (bBot && aHit) {
      b.lastBy = a.id;
      b.lastT = t;
      if (a.heavy > 0 && b.heavy <= 0 && HIT.speed >= 4) b.hitsTaken++;
    }
  }

  // An out bot swims to the water beside the rink and floats there.
  _ghost(c, dt, R) {
    const r = Math.hypot(c.x, c.y);
    const ang = Math.atan2(c.y, c.x) + (c.idx % 2 ? 1 : -1) * 0.1 * dt;
    const target = Math.min(R + 1.6 + (c.idx % 3) * 0.5, 12.3);
    let nr = r;
    if (r < target) nr = Math.min(target, r + 2.5 * dt);
    else if (r > target + 0.05) nr = Math.max(target, r - 2.5 * dt);
    c.x = Math.cos(ang) * nr;
    c.y = Math.sin(ang) * nr;
  }

  /**
   * A car is out. `info`: { by, x, y, vx, vy } (by: the id of the car that knocked it out, or ''). A bot's own fall leaves `by`
   * out and is credited to the last car that hit it within 3 s. Returns its elimination number (1 = first out), 0 if it already was.
   */
  eliminate(id, info = {}, t = this.t) {
    const c = this.byId.get(id);
    if (!c || c.out) return 0;
    c.out = true;
    c.alive = false;
    this.nOut++;
    this.dirty = true;
    let by = '';
    if (typeof info.by === 'string') {
      if (info.by !== id && this.byId.has(info.by)) by = info.by;
    } else if (c.kind === 'bot' && c.lastBy !== id && t - c.lastT <= KO_WINDOW && this.byId.has(c.lastBy)) by = c.lastBy;
    const rec = { n: this.nOut, by, x: fin(info.x, c.x), y: fin(info.y, c.y), vx: fin(info.vx, c.vx), vy: fin(info.vy, c.vy), at: t };
    this.out.set(id, rec);
    if (c.kind === 'bot') {
      c.x = rec.x;
      c.y = rec.y;
    }
    c.vx = 0;
    c.vy = 0;
    return rec.n;
  }

  /** Why the round is over (and nothing if it isn't): 'last' (one car left, or none) or 'time'. */
  isOver(t) {
    if (this.demo) return '';
    if (this.aliveCount() <= 1) return 'last';
    if (t >= ROUND_MS) return 'time';
    return '';
  }

  /** The round's result: ranking (best first), the winner, knockouts, points, and whether the rink was at its smallest. */
  finish(t) {
    const kos = koCounts(Object.fromEntries([...this.out].map(([id, rec]) => [id, rec])));
    const alive = this.cars.filter((c) => !c.out);
    // Survivors at the whistle: most knockouts, then closest to the middle.
    alive.sort((a, b) => (kos[b.id] || 0) - (kos[a.id] || 0) || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.idx - b.idx);
    const outs = [...this.out.entries()].sort((a, b) => b[1].n - a[1].n);
    const ranking = alive.map((c) => c.id).concat(outs.map(([id]) => id));
    return { ranking, winner: ranking[0] || '', kos, points: scoreRound(ranking, kos), small: radiusAt(t) <= MIN_R + 1e-9, reason: this.isOver(t) };
  }

  /** Hits a bot took and survived this round. */
  survivedHits(id) {
    const c = this.byId.get(id);
    if (!c) return 0;
    const rec = this.out.get(id);
    return Math.max(0, c.hitsTaken - (rec && rec.by ? 1 : 0));
  }

  // ---------------------------------------------------------------- what travels over the network

  /** The elimination records as the host writes them: { id: [n, by, x, y, vx, vy] }. */
  outObject() {
    const o = {};
    for (const [id, rec] of this.out) o[id] = [rec.n, rec.by, r1(rec.x), r1(rec.y), r1(rec.vx), r1(rec.vy)];
    return o;
  }

  /** Take over the eliminations a previous host had written. */
  restoreOut(out) {
    if (!out || typeof out !== 'object') return;
    for (const [id, rec] of Object.entries(out)) {
      const c = this.byId.get(id);
      if (!c || c.out || !Array.isArray(rec)) continue;
      c.out = true;
      c.alive = false;
      const n = fin(rec[0], this.nOut + 1);
      this.nOut = Math.max(this.nOut, n);
      this.out.set(id, { n, by: typeof rec[1] === 'string' ? rec[1] : '', x: fin(rec[2], c.x), y: fin(rec[3], c.y), vx: fin(rec[4], 0), vy: fin(rec[5], 0), at: 0 });
      if (c.kind === 'bot') {
        c.x = fin(rec[2], c.x);
        c.y = fin(rec[3], c.y);
      }
      c.vx = 0;
      c.vy = 0;
    }
  }

  /** The bots as a compact list for the room: [x, y, vx, vy, heading, flags] (1 out, 2 boosting), in roster order. */
  snapshotBots() {
    const p = [];
    for (const c of this.cars) {
      if (c.kind !== 'bot') continue;
      p.push([r1(c.x), r1(c.y), r1(c.vx), r1(c.vy), r2(c.a), (c.out ? 1 : 0) | (c.heavy > 0 ? 2 : 0)]);
    }
    return p;
  }

  /** Carry on from a snapshot (a new host). Out bots keep their ghost position. */
  restoreBots(p) {
    if (!Array.isArray(p)) return;
    let i = 0;
    for (const c of this.cars) {
      if (c.kind !== 'bot') continue;
      const s = p[i++];
      if (!Array.isArray(s) || s.length < 6) continue;
      if (!s.every(Number.isFinite)) continue;
      c.x = s[0];
      c.y = s[1];
      if (!c.out) {
        c.vx = s[2];
        c.vy = s[3];
        c.a = s[4];
        if (s[5] & 2) c.heavy = 0.2;
      }
    }
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/sim/rules.js';
import { createWorld, STEP } from '../src/sim/world.js';
import { STRIDE } from '../src/sim/crowd.js';
import { POISE, SCORE, TROUPES, roundTiming } from '../src/sim/const.js';
import { rng } from '../src/sim/rng.js';

const humans = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));
const cfg = (over = {}) => ({ mid: 'm1', n: 1, mode: 'masq', plaza: 0, seed: 12345, crowd: 9, minutes: 5, skill: 'adept', loadouts: 'standard', bots: true, humans: humans(2), ...over });

/** A world stepped to time t with the humans standing still in their slots (locked in step). */
function worldAt(c, t) {
  const W = createWorld(c);
  const sp = { x: 0, z: 0, h: 0, sp: 0 };
  while (W.t < t - 1e-9) {
    for (const h of c.humans) {
      if (!W.S.r.m[h.id] || rules.isOut(W.S, h.id, W.t)) continue;
      W.slotPos(h.id, sp);
      W.place(h.id, sp.x, sp.z, sp.h, rules.FLAG.locked);
    }
    W.step(STEP);
  }
  return W;
}

/** Puts masker `a` right in front of the figure at (x, z), facing it. */
function standBefore(W, a, x, z) {
  W.place(a, x, z - 1.5, 0, 0);
}

test('a round seats humans and fills with bots, two to a troupe at most, a chain with no self-hunting', () => {
  const S = rules.newRound(cfg());
  const ids = Object.keys(S.r.m);
  assert.equal(ids.length, 8);
  assert.equal(ids.filter((id) => S.r.m[id].b).length, 6);
  const perTroupe = new Map();
  const slots = new Set();
  for (const m of Object.values(S.r.m)) {
    perTroupe.set(m.tr, (perTroupe.get(m.tr) || 0) + 1);
    slots.add(m.tr * 9 + m.sl);
  }
  assert.ok(Math.max(...perTroupe.values()) <= 2);
  assert.equal(slots.size, 8, 'every masker has a slot of their own');
  assert.equal(new Set(S.chain).size, 8);
  for (const id of ids) assert.notEqual(rules.quarryOf(S, id), id);
  // Bots off: still at least three maskers.
  assert.equal(Object.keys(rules.newRound(cfg({ bots: false, humans: humans(1) })).r.m).length, 3);
  // Ten humans: no bots at all.
  assert.equal(Object.values(rules.newRound(cfg({ humans: humans(10) })).r.m).filter((m) => m.b).length, 0);
});

test('names are cleaned and clamped; loadouts respect what a player owns', () => {
  assert.equal(rules.cleanName('  A very very long name indeed, far too long  ').length, 24);
  assert.equal(rules.cleanName(''), 'Masker');
  assert.equal(rules.cleanName({}), 'Masker');
  // Name collisions: everyone ends up with a different name, still within the limit.
  const S = rules.newRound({ mid: 'm', n: 1, mode: 'masq', plaza: 0, seed: 3, crowd: 9, minutes: 5, skill: 'adept', loadouts: 'standard', bots: true, humans: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'ann' }, { id: 'c', name: 'X'.repeat(40) }, { id: 'd', name: 'X'.repeat(30) }] });
  const names = Object.values(S.r.m).map((m) => m.nm.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  assert.equal(S.r.m.a.nm, 'Ann');
  assert.ok(Object.values(S.r.m).every((m) => m.nm.length <= 24));
  const R = rng(1);
  assert.deepEqual(rules.pickLoadout(false, ['swap', 'smoke'], ['smoke', 'decoy', 'opera'], R), ['smoke', 'decoy']);
  assert.deepEqual(rules.pickLoadout(false, ['opera', 'opera'], ['smoke', 'decoy', 'opera'], R), ['opera', 'smoke']);
  assert.equal(rules.pickLoadout(true, [], [], R).length, 2);
});

test('unmasking: the quarry, another player, a reveller; the rules around it', () => {
  const W = worldAt(cfg({ bots: false, humans: humans(3) }), 31);
  const S = W.S;
  const t = W.t;
  const [a] = S.chain;
  const q = rules.quarryOf(S, a);
  const other = S.chain.find((id) => id !== a && id !== q);
  S.rs[a].p = 100;
  // Out of range: refused, no cost.
  const qp = S.pos[q];
  W.place(a, qp.x + 20, qp.z, 0, 0);
  assert.equal(rules.unmask(S, t, a, { k: 'p', id: q }, null, W.buf).why, 'far');
  assert.equal(S.rs[a].p, 100);
  // Facing away: refused.
  W.place(a, qp.x, qp.z - 2, Math.PI, 0);
  assert.equal(rules.unmask(S, t, a, { k: 'p', id: q }, null, W.buf).why, 'cone');
  // Another player: -10 / +10 and a cooldown.
  const op = S.pos[other];
  standBefore(W, a, op.x, op.z);
  const wrong = rules.unmask(S, t, a, { k: 'p', id: other }, null, W.buf);
  assert.equal(wrong.k, 'wrong');
  assert.equal(S.sc[a].pts, SCORE.wrongPlayer);
  assert.equal(S.sc[other].pts, SCORE.wrongVictim);
  assert.equal(S.rs[a].p, 100 - POISE.unmaskCost);
  assert.equal(rules.unmask(S, t + 1, a, { k: 'p', id: q }, null, W.buf).why, 'cooldown');
  // The quarry, after the cooldown: +100 (clean), Powder Room, the chain closes over the gap.
  const t2 = t + 9;
  const qq = rules.quarryOf(S, q);
  standBefore(W, a, qp.x, qp.z);
  const ok = rules.unmask(S, t2, a, { k: 'p', id: q }, null, W.buf);
  assert.equal(ok.k, 'unmask');
  assert.equal(S.sc[a].pts, SCORE.wrongPlayer + SCORE.unmask + SCORE.clean);
  assert.equal(S.sc[q].pts, SCORE.caught);
  assert.ok(rules.isOut(S, q, t2 + 1));
  assert.equal(rules.quarryOf(S, a), qq);
  // A second unmask on the same target a moment later is refused without a penalty.
  const p3 = S.chain.find((id) => id !== a);
  S.rs[p3].p = 100;
  standBefore(W, p3, qp.x, qp.z);
  assert.equal(rules.unmask(S, t2, p3, { k: 'p', id: q }, null, W.buf).why, 'gone');
  assert.equal(S.rs[p3].p, 100);
});

test('a faux pas: -15, the mask slips, and a close call for a quarry standing right there', () => {
  const W = worldAt(cfg({ bots: false, humans: humans(3) }), 40);
  const S = W.S;
  const t = W.t;
  const a = S.chain[0];
  const q = rules.quarryOf(S, a);
  S.rs[a].p = 100;
  // A reveller standing next to the quarry.
  const taken = rules.takenSlots(S);
  let s = 0;
  while (taken.has(s)) s++;
  const nx = W.buf[s * STRIDE];
  const nz = W.buf[s * STRIDE + 1];
  W.place(q, nx + 1, nz, 0, 0);
  standBefore(W, a, nx, nz);
  const ev = rules.unmask(S, t, a, { k: 'n', s }, null, W.buf);
  assert.equal(ev.k, 'faux');
  assert.equal(ev.close, q);
  assert.equal(S.sc[a].pts, SCORE.fauxPas);
  assert.equal(S.sc[q].pts, SCORE.closeCall);
  assert.ok(S.rs[a].sl > t);
  // The next unmask within 30 s is not clean.
  assert.equal(rules.unmask(S, t + 2, a, { k: 'p', id: q }, null, W.buf).why, 'cooldown');
});

test('no unmasking in the Blend, while flustered, without poise, or through smoke', () => {
  const W = worldAt(cfg({ bots: false, humans: humans(3) }), 15);
  const S = W.S;
  const a = S.chain[0];
  const q = rules.quarryOf(S, a);
  const qp = S.pos[q];
  standBefore(W, a, qp.x, qp.z);
  assert.equal(rules.unmask(S, 15, a, { k: 'p', id: q }, null, W.buf).why, 'phase');
  S.rs[a].fl = 60;
  assert.equal(rules.unmask(S, 40, a, { k: 'p', id: q }, null, W.buf).why, 'flustered');
  S.rs[a].fl = 0;
  S.rs[a].p = 10;
  assert.equal(rules.unmask(S, 40, a, { k: 'p', id: q }, null, W.buf).why, 'poise');
  S.rs[a].p = 100;
  S.fx.push({ k: 'smoke', id: 's', owner: q, x: qp.x, z: qp.z, t: 39, until: 44 });
  assert.equal(rules.unmask(S, 40, a, { k: 'p', id: q }, null, W.buf).why, 'smoke');
  assert.equal(S.rs[a].p, 100);
});

test('leaving repairs the chain: the pursuer inherits the quarry', () => {
  const S = rules.newRound(cfg({ bots: false, humans: humans(5) }));
  const [a, b, c] = S.chain;
  assert.equal(rules.quarryOf(S, a), b);
  rules.leave(S, 50, b);
  assert.equal(rules.quarryOf(S, a), c);
  assert.equal(S.intel[a].q, c);
  assert.ok(!S.chain.includes(b));
});

test('idle players shimmer, then become audience after fifteen seconds', () => {
  const W = createWorld(cfg({ bots: false, humans: humans(4) }));
  const S = W.S;
  const id = 'p0';
  while (W.t < 40) W.step(STEP);
  W.idle.set(id, 5);
  W.step(STEP);
  assert.ok(S.rs[id].fl > W.t, 'shimmering while idle');
  W.idle.set(id, 16);
  W.step(STEP);
  assert.equal(S.rs[id].aud, 1);
  assert.ok(!S.chain.includes(id));
});

test('the last two maskers get a clue every fifteen seconds', () => {
  const W = worldAt(cfg({ bots: false, humans: humans(3) }), 31);
  const S = W.S;
  rules.leave(S, W.t, S.chain[2]);
  assert.equal(S.chain.length, 2);
  const a = S.chain[0];
  const at = S.intel[a].at;
  while (W.t < at + 16) W.step(STEP);
  assert.ok(S.intel[a].at > at && S.intel[a].at - at <= 15.2);
  assert.ok(S.intel[a].d >= 0);
});

test('survivors score at the end; standings share places on ties; awards', () => {
  const W = createWorld(cfg({ humans: humans(1) }));
  while (!W.done()) W.step(STEP);
  const S = W.S;
  assert.ok(S.ev.some((e) => e.k === 'end'));
  for (const [id, sc] of Object.entries(S.sc)) if (sc.caught === 0 && !S.rs[id].aud) assert.ok(sc.pts >= SCORE.survivor - 200);
  const rows = rules.standings({ a: { pts: 10 }, b: { pts: 10 }, c: { pts: 5 } });
  assert.deepEqual(rows.map((r) => r.place), [1, 1, 3]);
  const tot = rules.addTotals({}, S);
  const aw = rules.awards(tot);
  for (const v of Object.values(aw)) assert.ok(v === null || tot[v]);
});

test('Spot the Mask: finding every impostor closes the case early with a bonus', () => {
  const W = worldAt(cfg({ mode: 'spot', skill: 'novice', humans: humans(1) }), 25);
  const S = W.S;
  const h = 'p0';
  assert.equal(S.case.imps.length, 3);
  assert.equal(S.chain.length, 0);
  let t = W.t;
  for (const imp of S.case.imps) {
    t += 9;
    S.rs[h].p = 100;
    S.rs[h].cu = 0;
    const p = S.pos[imp];
    standBefore(W, h, p.x, p.z);
    const ev = rules.unmask(S, t, h, { k: 'p', id: imp }, null, W.buf);
    assert.equal(ev.k, 'unmask');
  }
  assert.equal(S.case.solved, 1);
  assert.ok(S.endAt <= t);
  assert.equal(rules.stage(S, t + 1), 'reveal');
  assert.ok(S.sc[h].pts > 300);
});

test('worlds are deterministic: same seed, same round, same results', () => {
  const run = () => {
    const W = createWorld(cfg({ humans: [], seed: 777 }));
    while (W.t < 150) W.step(STEP);
    return JSON.stringify({ sc: W.S.sc, pos: W.S.pos, chain: W.S.chain });
  };
  assert.equal(run(), run());
});

test('fuzz: random and hostile requests for thousands of ticks never break the round', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const R = rng(seed);
    const c = cfg({ seed: seed * 99, plaza: seed % 3, crowd: [6, 9, 12][seed % 3], humans: humans(3), mode: seed % 2 ? 'masq' : 'spot', loadouts: seed % 3 ? 'standard' : 'chaos' });
    const W = createWorld(c);
    const S = W.S;
    const garbage = [null, undefined, {}, { k: 'n', s: -5 }, { k: 'n', s: 1e9 }, { k: 'n', s: NaN }, { k: 'p', id: 'nobody' }, { k: 'd', id: 'x' }, { k: 'q' }];
    const ids = Object.keys(S.r.m);
    while (!W.done()) {
      for (const h of c.humans) {
        if (!S.r.m[h.id] || rules.isOut(S, h.id, W.t)) continue;
        const p = S.pos[h.id];
        W.place(h.id, p.x + R.range(-1, 1), p.z + R.range(-1, 1), R.range(-4, 4), R.int(8));
      }
      W.step(STEP);
      const a = R.pick(ids);
      const t = W.t;
      const ref = R.chance(0.3) ? R.pick(garbage) : R.chance(0.5) ? { k: 'n', s: R.int(8 * S.r.crowd) } : { k: 'p', id: R.pick(ids) };
      const pose = R.chance(0.2) ? { x: NaN, z: Infinity, h: 'x' } : null;
      const which = R.int(4);
      if (which === 0) rules.unmask(S, t, a, ref, pose, W.buf);
      else if (which === 1) rules.greet(S, t, a, ref, W.buf);
      else if (which === 2) rules.ability(S, t, a, R.pick(['smoke', 'decoy', 'lantern', 'swap', 'opera', 'nope']), { tx: R.range(-80, 80), tz: R.range(-80, 80) }, W.buf);
      else rules.answer(S, t, a, R.int(100), R.range(-2, 3));
      for (const [id, st] of Object.entries(S.rs)) {
        assert.ok(st.p >= 0 && st.p <= 100, 'poise in range');
        assert.ok(Number.isFinite(S.sc[id].pts) && Math.abs(S.sc[id].pts) <= 99999);
        const p = S.pos[id];
        if (p) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), 'positions are numbers');
      }
      assert.ok(S.ev.length <= 24);
      assert.equal(new Set(S.chain).size, S.chain.length, 'no one twice in the chain');
      for (const id of S.chain) assert.ok(S.r.m[id] && !S.r.m[id].gone);
      const slots = new Set(Object.values(S.r.m).filter((m) => !m.gone).map((m) => m.tr * S.r.crowd + m.sl));
      assert.equal(slots.size, Object.values(S.r.m).filter((m) => !m.gone).length, 'slots stay unique');
      assert.ok(Object.values(S.r.m).every((m) => m.tr >= 0 && m.tr < TROUPES.length && m.sl >= 0 && m.sl < S.r.crowd));
    }
    // Everything the room would store fits its limits.
    for (const part of ['r', 'rs', 'fx', 'sc', 'ev']) assert.ok(JSON.stringify(S[part]).length < 12000, `${part} fits a state value`);
  }
});

test('round timings', () => {
  const t = roundTiming('masq', 5);
  assert.equal(t.huntStart, 30);
  assert.equal(t.hushStart, 275);
  assert.equal(t.end, 300);
  const s = roundTiming('spot', 5);
  assert.equal(s.end - s.huntStart, 240);
  assert.equal(roundTiming('masq', 99).total, 420);
  assert.equal(roundTiming('masq', 'x').total, 300);
});

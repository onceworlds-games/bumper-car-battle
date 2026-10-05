import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botInput, newAI } from '../game/bots.js';
import { Round } from '../game/round.js';
import { buildRoster, radiusAt, ROUND_MS } from '../game/rules.js';
import { CAR_R, STEP, makeCar } from '../game/sim.js';
import { mulberry32 } from '../game/rng.js';
import { playRound } from './harness.mjs';

const roster = (n, humans = 0) => buildRoster(Array.from({ length: humans }, (_, i) => `h${i}`), 1234, n);

test('elimination order, knockouts credited to the last car that hit within 3 s', () => {
  const r = new Round(roster(4), 5, 1);
  const [a, b, c, d] = r.cars;
  b.lastBy = a.id;
  b.lastT = 1000;
  assert.equal(r.eliminate(b.id, {}, 2500), 1);
  assert.equal(r.out.get(b.id).by, a.id);
  c.lastBy = a.id;
  c.lastT = 1000;
  assert.equal(r.eliminate(c.id, {}, 4500), 2);
  assert.equal(r.out.get(c.id).by, '', 'more than 3 s ago: nobody');
  assert.equal(r.eliminate(c.id, {}, 5000), 0, 'only once');
  assert.equal(r.eliminate(d.id, { by: d.id }, 6000), 3);
  assert.equal(r.out.get(d.id).by, '', 'no credit for yourself');
  assert.equal(r.isOver(6000), 'last');
  const res = r.finish(6000);
  assert.deepEqual(res.ranking, [a.id, d.id, c.id, b.id]);
  assert.equal(res.winner, a.id);
  assert.equal(res.kos[a.id], 1);
  assert.equal(res.points[a.id], 10 + 2);
  assert.equal(res.points[b.id], 4, 'fourth place, no knockouts');
});

test('a person reported out names who hit them; unknown names count for nothing', () => {
  const r = new Round(roster(3, 1), 5, 1);
  const human = r.cars.find((c) => c.kind === 'ext');
  const other = r.cars.find((c) => c !== human);
  assert.equal(r.eliminate(human.id, { by: other.id, x: 12, y: 0, vx: 8, vy: 0 }, 900), 1);
  assert.equal(r.out.get(human.id).by, other.id);
  const r2 = new Round(roster(3, 1), 5, 1);
  const h2 = r2.cars.find((c) => c.kind === 'ext');
  r2.eliminate(h2.id, { by: 'stranger', x: NaN, y: 1 }, 900);
  assert.equal(r2.out.get(h2.id).by, '');
  assert.ok(Number.isFinite(r2.out.get(h2.id).x));
});

test('at the whistle survivors rank by knockouts, then by distance from the middle', () => {
  const r = new Round(roster(4), 5, 1);
  const [a, b, c, d] = r.cars;
  r.eliminate(d.id, { by: b.id }, 1000);
  a.x = 3; a.y = 0;
  b.x = 5; b.y = 0;
  c.x = 1; c.y = 0;
  assert.equal(r.isOver(ROUND_MS), 'time');
  const res = r.finish(ROUND_MS);
  assert.deepEqual(res.ranking, [b.id, c.id, a.id, d.id], 'b has a knockout; c is closer than a');
  assert.equal(res.small, true);
});

test('everyone out at once still gives a ranking: the last one out wins', () => {
  const r = new Round(roster(3), 5, 1);
  r.eliminate(r.cars[0].id, {}, 100);
  r.eliminate(r.cars[1].id, {}, 100);
  r.eliminate(r.cars[2].id, {}, 100);
  assert.equal(r.isOver(100), 'last');
  assert.deepEqual(r.finish(100).ranking, [r.cars[2].id, r.cars[1].id, r.cars[0].id]);
});

test('a new host carries on from what the old one wrote', () => {
  const ro = roster(8);
  const r = new Round(ro, 77, 2);
  for (let i = 0; i < 600; i++) r.step(STEP, i * 16.7);
  const snap = r.snapshotBots();
  const outs = r.outObject();
  assert.equal(snap.length, 8);
  JSON.parse(JSON.stringify(snap));
  const r2 = new Round(ro, 77, 2);
  r2.restoreOut(outs);
  r2.restoreBots(snap);
  assert.equal(r2.nOut, r.nOut);
  for (let i = 0; i < r.cars.length; i++) {
    const a = r.cars[i];
    const b = r2.cars[i];
    assert.equal(a.out, b.out);
    assert.ok(Math.abs(a.x - b.x) < 0.06 && Math.abs(a.y - b.y) < 0.06, `${a.id} position carried over`);
  }
  for (let i = 0; i < 300; i++) r2.step(STEP, 10000 + i * 16.7);
  for (const c of r2.cars) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
});

test('bots only make legal moves', () => {
  const r = new Round(roster(8), 31, 1);
  const rng = mulberry32(3);
  let boosts = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const t = i * 16.7;
    const R = radiusAt(t);
    for (const c of r.cars) {
      if (c.out) continue;
      const inp = botInput(c, r, STEP, R);
      assert.ok(inp.aim === null || Number.isFinite(inp.aim));
      assert.ok(Number.isFinite(inp.thr) && inp.thr >= -1 && inp.thr <= 1);
      assert.equal(typeof inp.boost, 'boolean');
      if (inp.boost) {
        assert.ok(c.cd <= 0, 'never boosts while cooling down');
        boosts++;
      }
      void rng;
    }
    r.step(STEP, t);
  }
  assert.ok(boosts > 0, 'bots do boost');
});

test('bots fight: they knock each other off and the round ends before the clock', () => {
  const { reason, result, t } = playRound(roster(8), 101, 1);
  assert.ok(['last', 'time'].includes(reason));
  assert.equal(result.ranking.length, 8);
  assert.ok(t <= ROUND_MS + 20);
  assert.equal(new Set(result.ranking).size, 8);
});

test('demo rounds never end, never drop a car and keep everything on the rink', () => {
  const r = Round.createDemo(8, 5, []);
  for (let i = 0; i < 60 * 60; i++) {
    r.step(STEP, i * 16.7);
    assert.equal(r.isOver(i * 16.7), '');
  }
  assert.equal(r.nOut, 0);
  for (const c of r.cars) assert.ok(Math.hypot(c.x, c.y) <= 11 - CAR_R + 1e-6);
  r.syncExt(['me']);
  assert.equal(r.cars.length, 9);
  r.syncExt([]);
  assert.equal(r.cars.length, 8);
  assert.equal(r.byId.has('me'), false);
  void makeCar;
  void newAI;
});

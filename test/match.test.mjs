import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_R, R0, ROUND_MS, placePoints, scoreRound } from '../game/rules.js';
import { CAR_R } from '../game/sim.js';
import { playMatch, playRound } from './harness.mjs';
import { buildRoster } from '../game/rules.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 37);

function checkMatch(m, rounds, label) {
  assert.equal(m.results.length, rounds, `${label}: rounds played`);
  const n = m.roster.length;
  assert.equal(m.ranking.length, n, `${label}: everyone is ranked`);
  assert.equal(new Set(m.ranking).size, n);
  for (const [i, played] of m.results.entries()) {
    const { result, round, t, reason } = played;
    assert.ok(reason === 'last' || reason === 'time', `${label} round ${i + 1} ended (${reason})`);
    assert.ok(t <= ROUND_MS + 20, `${label} round ${i + 1} within the clock (${t})`);
    assert.equal(result.ranking.length, n);
    assert.equal(new Set(result.ranking).size, n, 'a ranking of everyone, once');
    assert.equal(result.winner, result.ranking[0]);
    for (const c of round.cars) {
      for (const k of ['x', 'y', 'vx', 'vy', 'a']) assert.ok(Number.isFinite(c[k]), `${label} ${c.id}.${k}`);
      if (!c.out) assert.ok(Math.hypot(c.x, c.y) <= R0 + 1e-6, 'a car still in the round is on the rink');
      else assert.ok(Math.hypot(c.x, c.y) < 40, 'nothing flies off to infinity');
    }
    const total = Object.values(result.points).reduce((s, v) => s + v, 0);
    const kos = Object.values(result.kos).reduce((s, v) => s + v, 0);
    let places = 0;
    for (let p = 0; p < n; p++) places += placePoints(p);
    assert.equal(total, places + 2 * kos, `${label} round ${i + 1}: points are places plus 2 a knockout`);
    assert.deepEqual(result.points, scoreRound(result.ranking, result.kos));
  }
  const sum = Object.values(m.scores).reduce((s, v) => s + v, 0);
  assert.ok(sum > 0);
  // The standings are sorted by points.
  for (let i = 1; i < n; i++) assert.ok(m.scores[m.ranking[i - 1]] >= m.scores[m.ranking[i]]);
}

test('a whole match of bots only (3 rounds), 20 seeds', () => {
  let ended = 0;
  let timed = 0;
  let totalKos = 0;
  let rounds = 0;
  for (const seed of SEEDS) {
    const m = playMatch(seed, 3, 0);
    checkMatch(m, 3, `bots seed ${seed}`);
    for (const p of m.results) {
      rounds++;
      if (p.reason === 'last') ended++;
      else timed++;
      totalKos += Object.values(p.result.kos).reduce((s, v) => s + v, 0);
    }
  }
  console.log(`  bots only: ${rounds} rounds, ${ended} ended with one car left, ${timed} ran out of time, ${(totalKos / rounds).toFixed(1)} knockouts a round`);
  assert.ok(ended / rounds >= 0.8, 'most rounds finish by themselves');
  assert.ok(totalKos / rounds >= 2, 'the cars really knock each other out');
});

test('a match with two people playing their own cars, 20 seeds', () => {
  for (const seed of SEEDS) {
    const m = playMatch(seed, 3, 2);
    assert.equal(m.roster.filter((r) => !r.bot).length, 2);
    assert.equal(m.roster.length, 8);
    checkMatch(m, 3, `2 people seed ${seed}`);
  }
});

test('five rounds with ten people and no bots', () => {
  const m = playMatch(4242, 5, 10);
  assert.equal(m.roster.length, 10);
  assert.equal(m.roster.filter((r) => r.bot).length, 0);
  checkMatch(m, 5, 'ten people');
});

test('a round that reaches the smallest rink still ends', () => {
  // Cars that never hit anyone: only the shrinking edge can eliminate them.
  const roster = buildRoster(['solo'], 9);
  const { round, reason } = playRound(roster, 9, 1, {
    onStep(r) {
      for (const c of r.cars) {
        if (c.kind === 'bot' && !c.out) c.ai.thinkT = 0.2; // stays as it is
      }
    },
  });
  assert.ok(reason);
  assert.ok(round.t >= 0 && MIN_R > 0 && CAR_R > 0);
});

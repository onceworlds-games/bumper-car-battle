import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLORS, MAX_CARS, MIN_R, R0, ROUND_MS, SHRINK_BY, SPAWN_R, TABLE, assignColors, awards, buildRoster, isBotId, koCounts, matchRanking,
  placePoints, radiusAt, scoreRound, seatOrder, stageAt, startSpot, warningAt,
} from '../game/rules.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

test('the rink shrinks 1.4 after 25 s and every 8 s, down to 4.5', () => {
  assert.equal(radiusAt(0), R0);
  assert.equal(radiusAt(24999), R0);
  near(radiusAt(25000), R0 - SHRINK_BY);
  near(radiusAt(32999), R0 - SHRINK_BY);
  near(radiusAt(33000), R0 - 2 * SHRINK_BY);
  near(radiusAt(41000), R0 - 3 * SHRINK_BY);
  near(radiusAt(49000), R0 - 4 * SHRINK_BY);
  assert.equal(radiusAt(57000), MIN_R);
  assert.equal(radiusAt(ROUND_MS), MIN_R);
  assert.equal(stageAt(-5), 0);
  assert.equal(stageAt(NaN), 0);
  let last = R0;
  for (let t = 0; t <= ROUND_MS; t += 250) {
    const r = radiusAt(t);
    assert.ok(r <= last && r >= MIN_R);
    last = r;
  }
});

test('the edge flashes for the 2 s before it falls', () => {
  assert.equal(warningAt(22999).warn, false);
  assert.equal(warningAt(23000).warn, true);
  assert.equal(warningAt(24999).warn, true);
  assert.equal(warningAt(25000).warn, false); // it has fallen
  assert.equal(warningAt(31000).warn, true);
  near(warningAt(24000).left, 1000);
  near(warningAt(24000).to, R0 - SHRINK_BY);
  assert.equal(warningAt(60000).warn, false, 'nothing left to crumble');
});

test('places and knockouts: 10, 7, 5, 4, 3, 2, then 1, plus 2 per knockout', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(placePoints), [10, 7, 5, 4, 3, 2, 1, 1]);
  const pts = scoreRound(['a', 'b', 'c', 'd'], { b: 2, d: 1 });
  assert.deepEqual(pts, { a: 10, b: 7 + 4, c: 5, d: 4 + 2 });
  assert.deepEqual(koCounts({ x: [1, 'a', 0, 0, 0, 0], y: [2, 'a'], z: [3, ''], w: { by: 'b' } }), { a: 2, b: 1 });
});

test('the roster: people plus bots up to 8, none when there are 8 or more people', () => {
  for (let humans = 1; humans <= MAX_CARS; humans++) {
    const ids = Array.from({ length: humans }, (_, i) => `p${i}`);
    const roster = buildRoster(ids, 12345 + humans);
    assert.equal(roster.length, Math.max(TABLE, humans));
    assert.equal(roster.filter((r) => !r.bot).length, humans);
    assert.equal(new Set(roster.map((r) => r.id)).size, roster.length);
    assert.equal(new Set(roster.map((r) => r.c)).size, roster.length, 'every car has its own colour');
    for (const r of roster) {
      assert.ok(Number.isInteger(r.c) && r.c >= 0 && r.c < COLORS.length);
      if (r.bot) {
        assert.ok(isBotId(r.id));
        assert.ok(typeof r.n === 'string' && r.n.length > 0);
      }
    }
    const names = roster.filter((r) => r.bot).map((r) => r.n);
    assert.equal(new Set(names).size, names.length, 'bot names are not repeated');
  }
  assert.deepEqual(buildRoster(['a', 'b'], 7), buildRoster(['a', 'b'], 7), 'same seed, same roster');
});

test('colours are the same wherever they are worked out', () => {
  const ids = ['zed', 'amy', 'bot1', 'bot2', 'carl'];
  assert.deepEqual(assignColors(ids), assignColors(ids.slice().reverse()));
});

test('start spots: evenly spread on the circle of radius 7, facing the centre', () => {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const s = startSpot(i, n);
    near(Math.hypot(s.x, s.y), SPAWN_R);
    // heading points at the centre
    near(Math.cos(s.a) * s.x + Math.sin(s.a) * s.y, -SPAWN_R, 1e-9);
  }
  const gap = Math.hypot(startSpot(0, n).x - startSpot(1, n).x, startSpot(0, n).y - startSpot(1, n).y);
  assert.ok(gap > 1.5 * 2, 'cars start well apart');
});

test('seat orders are permutations, the first round keeps the roster order', () => {
  assert.deepEqual(seatOrder(5, 99, 1), [0, 1, 2, 3, 4]);
  for (let round = 2; round <= 5; round++) assert.deepEqual(seatOrder(8, 99, round).slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(seatOrder(8, 99, 3), seatOrder(8, 99, 3));
});

test('match standings: points, then knockouts, then roster order', () => {
  const roster = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(matchRanking(roster, { a: 5, b: 9, c: 9, d: 1 }, { b: 1, c: 3 }), ['c', 'b', 'a', 'd']);
  assert.deepEqual(matchRanking(roster, { a: 4, b: 4, c: 4, d: 4 }, {}), ['a', 'b', 'c', 'd']);
});

test('awards go to the most knockouts and the most hits survived, and to nobody at zero', () => {
  const roster = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(awards(roster, { a: 2, c: 5 }, { b: 4, c: 4 }), { wrecking: 'c', slippery: 'b' });
  assert.deepEqual(awards(roster, {}, {}), { wrecking: '', slippery: '' });
});

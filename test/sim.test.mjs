import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../game/rng.js';
import { BOOST_CD, BOOST_V, CAR_R, HEAVY_T, HIT, KNOCK, MAX_V, STEP, collideOne, collidePair, makeCar, outside, stepCar, wrapAngle } from '../game/sim.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

test('driving gathers speed up to 7 u/s and no further', () => {
  const c = makeCar('a', 0, 0, 0);
  for (let i = 0; i < 150; i++) stepCar(c, { aim: null, steer: 0, thr: 1, boost: false }, STEP, 100, true);
  const v = Math.hypot(c.vx, c.vy);
  assert.ok(v > 6.5 && v <= MAX_V + 0.05, `speed ${v}`);
});

test('a car glides to a stop when nobody drives it', () => {
  const c = makeCar('a', 0, 0, 0);
  c.vx = 7;
  for (let i = 0; i < 60; i++) stepCar(c, { aim: null, steer: 0, thr: 0, boost: false }, STEP, 40, true);
  assert.ok(c.vx < 7 * Math.exp(-1.6) * 1.01 && c.vx > 7 * Math.exp(-1.6) * 0.9, `vx ${c.vx}`);
});

test('the stick turns the car toward it at 7 rad/s and the car then drives that way', () => {
  const c = makeCar('a', 0, 0, 0);
  stepCar(c, { aim: Math.PI / 2, steer: 0, thr: 1, boost: false }, 0.1, 40, true);
  near(c.a, 0.7, 1e-9);
  for (let i = 0; i < 120; i++) stepCar(c, { aim: Math.PI / 2, steer: 0, thr: 1, boost: false }, STEP, 40, true);
  near(wrapAngle(c.a - Math.PI / 2), 0, 1e-6);
  assert.ok(c.vy > 5);
});

test('keys: left/right steer, back reverses at most 4 u/s', () => {
  const c = makeCar('a', 0, 0, 0);
  stepCar(c, { aim: null, steer: 1, thr: 0, boost: false }, 0.1, 40, true);
  near(c.a, 0.7, 1e-9);
  const d = makeCar('d', 0, 0, 0);
  for (let i = 0; i < 400; i++) stepCar(d, { aim: null, steer: 0, thr: -1, boost: false }, STEP, 40, true);
  assert.ok(d.vx < -3.4 && d.vx >= -4.01, `reverse ${d.vx}`);
});

test('boost: +11 u/s forward at once, 2.2 s cooldown, heavy for 0.35 s', () => {
  const c = makeCar('a', 0, 0, 0);
  const did = stepCar(c, { aim: null, steer: 0, thr: 0, boost: true }, STEP, 40, true);
  assert.equal(did, true);
  assert.ok(c.vx > BOOST_V * 0.97 && c.vx <= BOOST_V, `vx ${c.vx}`);
  assert.ok(c.heavy > 0 && c.heavy <= HEAVY_T);
  const vx = c.vx;
  assert.equal(stepCar(c, { aim: null, steer: 0, thr: 0, boost: true }, STEP, 40, true), false, 'cooling down');
  assert.ok(c.vx < vx);
  for (let i = 0; i < Math.ceil(BOOST_CD / STEP) + 2; i++) stepCar(c, { aim: null, steer: 0, thr: 0, boost: false }, STEP, 40, true);
  assert.equal(c.cd, 0);
  assert.equal(stepCar(c, { aim: null, steer: 0, thr: 0, boost: true }, STEP, 40, true), true);
  assert.equal(c.heavy > 0, true);
  for (let i = 0; i < 30; i++) stepCar(c, { aim: null, steer: 0, thr: 0, boost: false }, STEP, 40, true);
  assert.equal(c.heavy, 0);
});

test('two equal cars meeting head on trade speed with restitution 0.9 and keep momentum', () => {
  const a = makeCar('a', -0.7, 0, 0);
  const b = makeCar('b', 0.7, 0, Math.PI);
  a.vx = 5;
  assert.equal(collidePair(a, b), true);
  near(a.vx + b.vx, 5, 1e-9);
  near(b.vx - a.vx, 0.9 * 5, 1e-9);
  near(HIT.speed, 5, 1e-9);
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= CAR_R * 2 - 1e-9, 'pushed apart');
});

test('each side applying only its own half gives the same result as one pair call', () => {
  const mk = () => [Object.assign(makeCar('a', 0, 0, 0), { vx: 6, vy: 1, heavy: 0.2 }), Object.assign(makeCar('b', 1.1, 0.3, 0), { vx: -1, vy: 0 })];
  const [a1, b1] = mk();
  collidePair(a1, b1);
  const [a2, b2] = mk();
  const a2copy = { ...a2 };
  const b2copy = { ...b2 };
  collideOne(a2, b2copy); // a's page: b is only read
  collideOne(b2, a2copy); // b's page, from its own point of view (b is "me")
  // collideOne treats the first as A, so for b the normal is mirrored, but the result for each car must match the pair call.
  for (const k of ['x', 'y', 'vx', 'vy']) near(a2[k], a1[k], 1e-9);
  // b: its page sees (b, a) with the normal pointing from b to a
  const [, b3] = mk();
  const a3 = { ...mk()[0] };
  collideOne(b3, a3);
  for (const k of ['x', 'y', 'vx', 'vy']) near(b3[k], b1[k], 1e-9);
});

test('a boosting car knocks the lighter one an extra 4 u/s', () => {
  const heavy = makeCar('a', -0.7, 0, 0);
  heavy.vx = 8;
  heavy.heavy = 0.3;
  const light = makeCar('b', 0.7, 0, 0);
  const plain = makeCar('c', 0.7, 0, 0);
  const heavy2 = makeCar('d', -0.7, 0, 0);
  heavy2.vx = 8;
  collidePair(heavy, light);
  collidePair(heavy2, plain); // same, but nobody boosting: masses equal
  assert.ok(light.vx > plain.vx, 'heavier hit sends it faster');
  // the knockback itself: 4 more than the impulse alone gives
  const j = (1.9 * 8) / (1 / 2.2 + 1);
  near(light.vx, j + KNOCK, 1e-9);
});

test('the rubber ring bounces a car at driving speed but a boost flies over it', () => {
  const R = 11;
  const slow = makeCar('a', 8, 0, 0);
  for (let i = 0; i < 240; i++) stepCar(slow, { aim: null, steer: 0, thr: 1, boost: false }, STEP, R, false);
  assert.equal(outside(slow, R), false, 'driving at the edge never drops you');
  assert.ok(Math.hypot(slow.x, slow.y) < R);
  const fast = makeCar('b', 8, 0, 0);
  fast.vx = 7;
  stepCar(fast, { aim: null, steer: 0, thr: 1, boost: true }, STEP, R, false);
  let fell = false;
  for (let i = 0; i < 120 && !fell; i++) {
    stepCar(fast, { aim: null, steer: 0, thr: 1, boost: false }, STEP, R, false);
    fell = outside(fast, R);
  }
  assert.equal(fell, true, 'boosting toward the edge from close range goes over');
});

test('hard-wall mode keeps every car inside whatever it does', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry32(seed);
    const c = makeCar('a', 0, 0, 0);
    for (let i = 0; i < 3000; i++) {
      stepCar(c, { aim: rng() < 0.5 ? rng() * 7 - 3.5 : null, steer: rng() * 2 - 1, thr: rng() * 2 - 1, boost: rng() < 0.05 }, STEP, 11, true);
      assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.vx));
      assert.ok(Math.hypot(c.x, c.y) <= 11 - CAR_R + 1e-6);
    }
  }
});

test('bad inputs never produce NaN', () => {
  const c = makeCar('a', 1, 1, 0);
  stepCar(c, { aim: NaN, steer: NaN, thr: Infinity, boost: true }, STEP, 11, false);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.a) && Number.isFinite(c.vx));
  c.x = NaN;
  stepCar(c, { aim: null, steer: 0, thr: 0, boost: false }, STEP, 11, false);
  assert.ok(Number.isFinite(c.x));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readRound, readStatus, readScores, readFx, readEvents, readGame, readIntel, readRequest, readPresence, readRef, packRound } from '../src/net/wire.js';
import { parseProfile, freshProfile, levelFor, xpStep, unlockedAbilities, MAX_LEVEL } from '../src/game/progress.js';
import * as rules from '../src/sim/rules.js';
import { rng } from '../src/sim/rng.js';

const cfg = { mid: 'm', n: 2, mode: 'masq', plaza: 1, seed: 99, crowd: 9, minutes: 5, skill: 'adept', loadouts: 'standard', bots: true, humans: [{ id: 'a', name: 'Ann' }] };

test('a round survives the trip through room state', () => {
  const S = rules.newRound(cfg);
  const packed = JSON.parse(JSON.stringify(packRound(S, 12345)));
  const r = readRound(packed);
  assert.equal(r.rid, 'm.2');
  assert.equal(r.t0, 12345);
  assert.equal(r.crowd, 9);
  assert.equal(Object.keys(r.m).length, 8);
  assert.equal(r.m.a.nm, 'Ann');
  assert.equal(r.timing.end, 300);
  assert.equal(readStatus(JSON.parse(JSON.stringify(S.rs)), r).a.p, 70);
});

test('hostile room state never throws and is cleaned', () => {
  const R = rng(5);
  const junk = () => {
    const pick = R.int(9);
    if (pick === 0) return null;
    if (pick === 1) return 'x'.repeat(R.int(200));
    if (pick === 2) return R.range(-1e12, 1e12);
    if (pick === 3) return NaN;
    if (pick === 4) return [junk(), junk()];
    if (pick === 5) return { m: { a: { tr: 999, sl: -4, nm: '<img onerror=x>'.repeat(9), ab: ['smoke', 'nuke', 'smoke', 'decoy'] } }, crowd: 9, rid: 'x', mode: 'spot', case: { imps: ['a', 7], clues: { a: { tr: 99, d: 99 } } } };
    if (pick === 6) return Infinity;
    if (pick === 7) return { __proto__: null, toString: 1 };
    return {};
  };
  for (let i = 0; i < 3000; i++) {
    const v = junk();
    const r = readRound(v);
    if (r) {
      for (const m of Object.values(r.m)) {
        assert.ok(m.tr >= 0 && m.tr < 8 && m.sl >= 0 && m.sl < r.crowd);
        assert.ok(m.nm.length <= 24);
        assert.ok(m.ab.every((a) => ['smoke', 'decoy', 'opera', 'lantern', 'swap'].includes(a)));
      }
    }
    readStatus(junk(), r);
    readScores(junk(), r);
    readFx(junk(), r);
    readEvents(junk());
    readGame(junk());
    readIntel(junk());
    readPresence(junk());
    readRef(junk(), r);
    readRequest(junk(), r);
  }
});

test('requests: wrong round, wrong shapes and absurd numbers are refused or clamped', () => {
  const S = rules.newRound(cfg);
  const r = readRound(JSON.parse(JSON.stringify(packRound(S, 0))));
  assert.equal(readRequest({ t: 'um', rid: 'other', ref: { k: 'n', s: 3 } }, r), null);
  assert.equal(readRequest({ t: 'um', rid: r.rid, ref: { k: 'n', s: 9999 } }, r), null);
  assert.equal(readRequest({ t: 'um', rid: r.rid, ref: { k: 'p', id: 'nobody' } }, r), null);
  const ok = readRequest({ t: 'um', rid: r.rid, ref: { k: 'n', s: 3 }, x: 1e9, z: NaN, h: 'west' }, r);
  assert.equal(ok.ref.s, 3);
  assert.equal(ok.pose.x, 200);
  assert.ok(Number.isNaN(ok.pose.z));
  assert.equal(readRequest({ t: 'ab', rid: r.rid, a: 'fly' }, r), null);
  assert.deepEqual(readRequest({ t: 'lo', rid: r.rid, ab: ['swap', 'x', 'opera', 'decoy'] }, r).ab, ['swap', 'opera']);
  assert.equal(readRequest({ t: 'an', rid: r.rid, g: 4, d: 99 }, r).d, 9);
  const p = readPresence({ s: 'p', x: 1e9, z: -1e9, h: 'n', f: 99, b: Array(40).fill([1, 2, 3, 4]) });
  assert.equal(p.x, 200);
  assert.equal(p.z, -200);
  assert.equal(p.f, 15);
  assert.equal(p.b.length, 12);
});

test('saves: missing, empty, corrupt, older and newer all load', () => {
  assert.deepEqual(parseProfile(null), freshProfile());
  assert.deepEqual(parseProfile(undefined), freshProfile());
  assert.deepEqual(parseProfile('garbage'), freshProfile());
  assert.deepEqual(parseProfile([1, 2]), freshProfile());
  assert.deepEqual(parseProfile({}), freshProfile());
  const corrupt = parseProfile({ v: 1, xp: -5, loadout: ['swap', 'swap'], burst: 'nope', stats: { rounds: 'many', unmasks: Infinity }, hints: 'x', credited: [1, 'a'] });
  assert.equal(corrupt.xp, 0);
  assert.deepEqual(corrupt.loadout, ['smoke', 'decoy']);
  assert.equal(corrupt.burst, 'confetti');
  assert.equal(corrupt.stats.rounds, 0);
  assert.equal(corrupt.stats.unmasks, 0);
  assert.deepEqual(corrupt.credited, ['a']);
  // A save from a newer version keeps what this one understands and ignores the rest.
  const newer = parseProfile({ v: 7, xp: 9000, loadout: ['swap', 'lantern'], pose: 'spin', future: { x: 1 }, rehearsed: 1 });
  assert.equal(newer.xp, 9000);
  assert.deepEqual(newer.loadout, ['swap', 'lantern']);
  assert.equal(newer.rehearsed, 1);
  assert.equal(newer.future, undefined);
  // A loadout with tricks the level doesn't own falls back to ones it does.
  assert.deepEqual(parseProfile({ xp: 0, loadout: ['swap', 'lantern'] }).loadout, ['smoke', 'decoy']);
});

test('levels: steps, unlocks and the cap', () => {
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(xpStep(1) - 1).level, 1);
  assert.equal(levelFor(xpStep(1)).level, 2);
  assert.deepEqual(unlockedAbilities(1), ['smoke', 'decoy', 'opera']);
  assert.ok(unlockedAbilities(2).includes('lantern'));
  assert.ok(!unlockedAbilities(3).includes('swap'));
  assert.ok(unlockedAbilities(4).includes('swap'));
  assert.equal(levelFor(1e9).level, MAX_LEVEL);
  let xp = 0;
  for (let l = 1; l < 10; l++) xp += xpStep(l);
  assert.equal(levelFor(xp).level, 10);
});

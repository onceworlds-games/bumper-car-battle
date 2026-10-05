// Runs the real main.js (and draw.js, ui.js, net.js...) on a fake page through the title, the lobby and a whole match, with a
// player who drives and boosts, on the stand-in room. Fails on any exception, NaN handed to the canvas, or a stuck phase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frames, frame, makePage, audioStats } from './fakedom.mjs';
import { makeStubOw } from '../game/stub.js';

test('title, lobby and a full match (3 rounds) on one page', async () => {
  const ow = makeStubOw();
  const room = ow.room;
  const page = makePage({ w: 812, h: 375, onceworlds: ow });
  page.install();
  await import('../game/main.js');
  assert.deepEqual(errors, []);
  frames(90); // title
  assert.ok(page.ctx.counts.calls > 1000, 'the title drew something');
  assert.deepEqual(page.ctx.bad, []);
  page.key('Space'); // PLAY
  frames(10);
  assert.equal(audioStats.contexts, 1, 'sound started from the tap');
  page.key('KeyW');
  page.key('KeyD');
  frames(120);
  page.key('KeyD', false);
  page.key('Space');
  frames(30);
  assert.equal(room.match.phase, 'lobby');
  // tap a rounds button as the host
  page.tap(406, 30);
  frames(5);
  assert.equal(room.settings.rounds, 1, 'the host tapped 1 round');
  room.setSetting('rounds', 3);
  frames(5);
  assert.equal(room.settings.rounds, 3);
  room.setReady(true); // the platform's Ready strip
  const seen = new Set();
  const phases = [];
  let n = 0;
  let wasPlaying = false;
  for (; n < 60 * 600; n++) {
    // a person who drives, steers about and boosts
    if (n % 90 === 0) page.key('KeyA', false), page.key('KeyD', true);
    if (n % 90 === 45) page.key('KeyD', false), page.key('KeyA', true);
    if (n % 140 === 0) page.key('Space');
    frame();
    const g = room.state.g;
    if (room.match.phase === 'playing' && g && g.mid === room.match.id) {
      wasPlaying = true;
      const key = `${g.round}:${g.phase}`;
      if (!seen.has(key)) {
        seen.add(key);
        phases.push(key);
      }
    }
    if (wasPlaying && room.match.phase === 'lobby') break;
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, [], 'nothing odd was handed to the canvas');
  assert.ok(wasPlaying, 'the match started');
  assert.equal(room.match.phase, 'lobby', `the match ended itself (after ${n} frames)`);
  const rounds = room.state.g.rounds;
  const expected = [];
  for (let r = 1; r <= rounds; r++) for (const p of ['intro', 'play', 'end', 'board']) expected.push(`${r}:${p}`);
  expected.push(`${rounds}:final`);
  assert.deepEqual(phases, expected);
  console.log(`  rounds ${rounds}, phases: ${phases.join(' ')}`);
  frames(60 * 8); // the lobby again, with the results card
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, []);
});

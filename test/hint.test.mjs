// A keyboard player who never boosts sees the Space hint during play; nothing in drawing it trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frames, frame, makePage } from './fakedom.mjs';
import { makeStubOw } from '../game/stub.js';

test('the Space hint, the splash word and a spectator-free solo match draw cleanly', async () => {
  const ow = makeStubOw();
  const page = makePage({ w: 1280, h: 720, onceworlds: ow });
  page.install();
  await import('../game/main.js');
  frames(30);
  page.key('Enter');
  frames(30);
  ow.room.setReady(true);
  let n = 0;
  while (!(ow.room.state.g && ow.room.state.g.phase === 'play') && n++ < 3000) frame();
  assert.equal(ow.room.state.g.phase, 'play');
  frames(60 * 6); // standing still: the hint is up, the bots go for the sitting duck
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, []);
  // wait for the car to fall (standing still it will be knocked off or the edge takes it) and for the round to end
  let m = 0;
  while (ow.room.state.g.phase !== 'end' && m++ < 60 * 130) frame();
  assert.equal(ow.room.state.g.phase, 'end');
  frames(60 * 10);
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, []);
});

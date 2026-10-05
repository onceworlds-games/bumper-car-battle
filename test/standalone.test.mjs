// The game opened on its own (no window.onceworlds): it makes its own one-player room, readies by itself and plays a whole match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frame, frames, makePage } from './fakedom.mjs';

test('a page with no platform around it plays a whole match by itself', async () => {
  const page = makePage({ w: 960, h: 540 });
  let api = null;
  page.window.__bumperTest = (a) => {
    api = a;
  };
  page.install();
  await import('../game/main.js');
  assert.ok(api, 'the game started without window.onceworlds');
  frames(60);
  page.tap(480, 400); // the PLAY button
  frames(30);
  assert.equal(api.S.started, true, 'PLAY started it');
  let played = false;
  for (let n = 0; n < 60 * 600; n++) {
    frame();
    if (api.room.match.phase === 'playing') played = true;
    if (played && api.room.match.phase === 'lobby') break;
  }
  assert.ok(played, 'a match started on its own');
  assert.equal(api.room.match.phase, 'lobby', 'and ended');
  frames(60);
  assert.deepEqual(errors, []);
  assert.deepEqual(page.ctx.bad, []);
  assert.equal(page.ctx.depth, 0);
});

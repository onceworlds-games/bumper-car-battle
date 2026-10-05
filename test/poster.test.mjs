// The store art: every poster draws, finishes, and sets body.dataset.ready, with the real renderer on a fake canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePage } from './fakedom.mjs';
import { runPoster } from '../game/poster.js';

const SIZES = {
  cover: [1280, 720],
  action: [1280, 720],
  win: [1280, 720],
  icon: [512, 512],
  'badge-first-win': [256, 256],
  'badge-knockout-king': [256, 256],
  'badge-last-second': [256, 256],
  'badge-road-trip': [256, 256],
};

for (const [name, [w, h]] of Object.entries(SIZES)) {
  test(`poster ${name} is ${w}x${h} and draws without trouble`, async () => {
    const page = makePage({ w, h });
    page.install();
    await runPoster(name, page.canvas);
    assert.equal(page.canvas.width, w);
    assert.equal(page.canvas.height, h);
    assert.equal(page.document.body.dataset.ready, '1');
    assert.ok(page.ctx.counts.calls > 20, 'it drew something');
    assert.deepEqual(page.ctx.bad, []);
  });
}

test('an unknown poster name still finishes', async () => {
  const page = makePage();
  page.install();
  await runPoster('nope', page.canvas);
  assert.equal(page.document.body.dataset.ready, '1');
});

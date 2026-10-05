// Chaos: three people in one room play matches while pages reload, connections drop and come back, the host changes, people leave and
// watchers arrive, all at random moments (seeded). Nothing may throw, nothing odd may reach a canvas, and every match must end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frame, makePage } from './fakedom.mjs';
import { Hub, owFor } from './hub.mjs';
import { mulberry32 } from '../game/rng.js';

let tagN = 0;
async function boot(hub, id) {
  const ow = owFor(hub, id, id);
  const page = makePage({ w: 812, h: 375, onceworlds: ow });
  let api = null;
  page.window.__bumperTest = (a) => {
    api = a;
  };
  page.install();
  await import(`../game/main.js?chaos=${tagN++}`);
  return { ow, room: ow.room, page, id, api };
}

for (const seed of [1, 2]) {
  test(`chaos, seed ${seed}`, async () => {
    const rng = mulberry32(seed * 7919);
    const hub = new Hub();
    hub.settings = { rounds: 1 };
    const pages = new Map();
    for (const id of ['ann', 'ben', 'cy']) pages.set(id, await boot(hub, id));
    const step = () => {
      hub.tick();
      frame();
    };
    for (const p of pages.values()) {
      p.page.install();
      p.page.key('Space');
    }
    for (let i = 0; i < 90; i++) step();
    let matches = 0;
    let frameN = 0;
    let started = false;
    let late = 0;
    for (; matches < 1 && frameN < 60 * 900; frameN++) {
      if (hub.match.phase === 'lobby' && frameN % 120 === 0 && !started) {
        hub.settings = { rounds: rng() < 0.5 ? 1 : 3 };
        hub.start();
        started = true;
      }
      // random inputs for everyone
      for (const [id, p] of pages) {
        if (frameN % 25 === Math.floor(rng() * 25)) {
          p.page.install();
          for (const k of ['KeyW', 'KeyA', 'KeyD', 'KeyS']) p.page.key(k, rng() < 0.45);
          if (rng() < 0.4) p.page.key('Space');
        }
        void id;
      }
      // random disruptions while a match plays
      if (hub.match.phase === 'playing' && frameN % 200 === 0 && rng() < 0.35) {
        const ids = [...pages.keys()];
        const id = ids[Math.floor(rng() * ids.length)];
        const roll = rng();
        if (roll < 0.3) {
          // a reload
          hub.setAway(id, true);
          for (let i = 0; i < 20; i++) step();
          pages.get(id).page.dead = true;
          const next = await boot(hub, id);
          next.page.install();
          next.page.tap(300, 200);
          pages.set(id, next);
        } else if (roll < 0.55) {
          // a dropped connection for a few seconds
          hub.setAway(id, true);
          for (let i = 0; i < 60 * (1 + Math.floor(rng() * 4)); i++) step();
          hub.setAway(id, false);
        } else if (roll < 0.8) {
          hub.setHost(id);
        } else if (late < 2 && !pages.has(`late${late}`)) {
          const next = await boot(hub, `late${late++}`);
          next.page.install();
          next.page.tap(300, 200);
          pages.set(next.id, next);
        }
      }
      step();
      if (started && hub.match.phase === 'lobby') {
        started = false;
        matches++;
        for (let i = 0; i < 90; i++) step();
      }
    }
    assert.deepEqual(errors.map(String), [], `seed ${seed}: no exceptions`);
    for (const p of pages.values()) assert.deepEqual(p.page.ctx.bad, [], `seed ${seed}: ${p.id}'s canvas`);
    assert.ok(matches >= 1, `seed ${seed}: at least one match ended (${matches} in ${frameN} frames)`);
  });
}

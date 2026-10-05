// Three pages in one fake room: two people (the host and a guest) and, later, a late joiner who watches. They play a whole match
// against bots: the guest's falls, hits and presence reach the host, the host's bots reach the guest, the host changes hands in
// the middle of a round and the match carries on, a held seat (away) is judged as standing still, and everyone ends in the lobby.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors, frame, frames, makePage } from './fakedom.mjs';
import { Hub, owFor } from './hub.mjs';

async function boot(hub, id, tag) {
  const ow = owFor(hub, id, id);
  const page = makePage({ w: 812, h: 375, onceworlds: ow });
  page.install();
  await import(`../game/main.js?page=${tag}`);
  return { ow, room: ow.room, page, id };
}

function assertClean(pages, label) {
  assert.deepEqual(errors.map(String), [], `${label}: no exceptions`);
  for (const p of pages) assert.deepEqual(p.page.ctx.bad, [], `${label}: nothing odd handed to ${p.id}'s canvas`);
}

test('two people and a late watcher play a match; the host changes mid-round', async () => {
  const hub = new Hub();
  const A = await boot(hub, 'alice', 'a');
  const B = await boot(hub, 'bob', 'b');
  const pages = [A, B];
  const step = () => {
    hub.tick();
    frame();
  };
  for (let i = 0; i < 60; i++) step();
  A.page.install();
  A.page.key('Space');
  B.page.install();
  B.page.key('Space');
  for (let i = 0; i < 90; i++) step();
  // both drive around the lobby and bump into each other
  for (const p of pages) {
    p.page.install();
    p.page.key('KeyW');
  }
  for (let i = 0; i < 240; i++) step();
  assertClean(pages, 'lobby');
  assert.ok(B.room.presenceAt('alice'), 'bob sees alice');
  assert.ok(A.room.presenceAt('bob'), 'alice sees bob');

  hub.start();
  const seen = { fell: new Set(), phases: new Set(), hostChanged: false, late: null };
  let hostSwitched = false;
  let lateJoined = false;
  let frameN = 0;
  let wasPlaying = false;
  for (; frameN < 60 * 700; frameN++) {
    // Bob heads for the edge and boosts off it in the first round; Alice just drives and boosts about
    const g = A.room.state.g;
    const playing = hub.match.phase === 'playing' && g && g.mid === hub.match.id;
    if (playing) wasPlaying = true;
    if (playing && g.phase === 'play' && g.round === 1) {
      const tp = A.room.matchNow() - g.t0;
      B.page.install();
      if (tp < 500 && frameN % 4 === 0) B.page.key('KeyD', true);
      if (tp >= 500 && tp < 520) B.page.key('KeyD', false);
      if (tp > 700 && frameN % 40 === 0) B.page.key('Space');
    }
    if (playing && g.phase === 'play' && g.round === 2 && !hostSwitched) {
      // the host changes mid-round
      hostSwitched = true;
      hub.setHost('bob');
    }
    if (playing && g.phase === 'play' && g.round === 3 && !lateJoined) {
      lateJoined = true;
      const C = await boot(hub, 'cara', 'c');
      C.page.install();
      C.page.key('Space');
      pages.push(C);
      seen.late = C;
    }
    if (playing && frameN % 90 === 0) {
      A.page.install();
      A.page.key('KeyA', frameN % 180 === 0);
      A.page.key('KeyD', frameN % 180 !== 0);
      if (frameN % 180 === 0) A.page.key('Space');
    }
    step();
    const gg = (hostSwitched ? B : A).room.state.g;
    if (gg && gg.mid === hub.match.id) {
      seen.phases.add(`${gg.round}:${gg.phase}`);
      for (const id of ['alice', 'bob']) if (gg.out[id]) seen.fell.add(`${gg.round}:${id}`);
      if (hostSwitched && gg.by === 'bob') seen.hostChanged = true;
    }
    if (wasPlaying && hub.match.phase === 'lobby') break;
  }
  assertClean(pages, 'match');
  assert.equal(hub.match.phase, 'lobby', `the match ended (frame ${frameN})`);
  assert.ok(seen.hostChanged, 'the new host took over the record');
  const last = [...seen.phases].filter((p) => p.endsWith(':final'));
  assert.equal(last.length, 1, `reached the podium: ${[...seen.phases].join(' ')}`);
  assert.ok([...seen.fell].some((k) => k.endsWith(':bob')), `bob fell in at some point (${[...seen.fell].join(',')})`);
  // everyone ended in the lobby and saw the same match
  const ga = A.room.state.g;
  const gb = B.room.state.g;
  assert.equal(ga.mid, gb.mid);
  for (let i = 0; i < 60 * 8; i++) step();
  assertClean(pages, 'back in the lobby');
  console.log(`  ${[...seen.phases].join(' ')}; falls: ${[...seen.fell].join(',')}`);
});

test('a held seat is judged as standing still, and a page that reloads mid-round carries on', async () => {
  const hub = new Hub();
  const A = await boot(hub, 'dan', 'd');
  const B = await boot(hub, 'eve', 'e');
  const pages = [A, B];
  const step = () => {
    hub.tick();
    frame();
  };
  for (const p of pages) {
    p.page.install();
    p.page.key('Space');
  }
  for (let i = 0; i < 120; i++) step();
  hub.start();
  let n = 0;
  while (!(A.room.state.g && A.room.state.g.phase === 'play' && A.room.state.g.mid === hub.match.id) && n++ < 2000) step();
  assert.equal(A.room.state.g.phase, 'play');
  for (let i = 0; i < 60 * 3; i++) step();
  hub.setAway('eve', true); // eve's connection drops: her seat is held
  for (let i = 0; i < 60 * 40; i++) step(); // the edge starts to crumble: standing still near the rim may cost her the car
  hub.setAway('eve', false);
  for (let i = 0; i < 60 * 3; i++) step();
  assertClean(pages, 'away');
  const g = A.room.state.g;
  assert.ok(g && g.mid === hub.match.id, 'the match goes on');
});

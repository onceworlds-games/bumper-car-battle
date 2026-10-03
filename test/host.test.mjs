// The host's page against a stand-in room: rounds written into room state, each hunter's quarry kept in private values,
// a new host adopting a round half played, requests from other pages checked, close calls told to one player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../src/net/host.js';
import { readRound } from '../src/net/wire.js';
import * as rules from '../src/sim/rules.js';
import { PLAZAS } from '../src/sim/plazas.js';

const IDS = ['p0', 'p1', 'p2'];

/** One room's shared data, and a page's view of it. */
function hub(ids = IDS, over = {}) {
  const H = {
    state: {},
    priv: Object.fromEntries(ids.map((id) => [id, {}])),
    players: new Map(ids.map((id) => [id, { id, name: `Player ${id}`, presence: null, connected: true, idle: false }])),
    match: { phase: 'playing', id: 'mt1', seed: 4242, participants: ids },
    clock: 0,
    host: ids[0],
    sent: [],
    ended: 0,
    settings: { mode: 'masq', rounds: 3, length: 5, crowd: 'normal', loadout: 'standard', bots: 'adept' },
    ...over,
  };
  H.page = (id) => ({
    me: { id },
    players: H.players,
    get state() {
      return H.state;
    },
    get match() {
      return H.match;
    },
    get settings() {
      return H.settings;
    },
    get isHost() {
      return H.host === id;
    },
    connected: true,
    running: true,
    kind: 'public',
    spectators: [],
    matchNow: () => H.clock,
    setState: (k, v) => {
      if (v === null) delete H.state[k];
      else H.state[k] = JSON.parse(JSON.stringify(v));
    },
    setPrivate: (k, v) => {
      H.priv[id][k] = JSON.parse(JSON.stringify(v));
    },
    setPrivateFor: (to, k, v) => {
      assert.equal(H.host, id, 'only the host deals private values');
      H.priv[to][k] = JSON.parse(JSON.stringify(v));
    },
    privateOf: (who) => H.priv[who],
    send: (data, opts) => H.sent.push({ from: id, to: opts?.to ?? null, data }),
    endMatch: () => {
      H.ended++;
      H.match = { ...H.match, phase: 'lobby' };
    },
    admit: () => {},
    get private() {
      return H.priv[id];
    },
  });
  return H;
}

const run = (H, host, seconds) => {
  for (let i = 0; i < seconds * 10; i++) {
    H.clock += 100;
    host.tick();
  }
};

test('a host starts the round, writes it to room state and deals every hunter a private quarry', () => {
  const H = hub();
  const host = createHost(H.page('p0'));
  run(H, host, 1);
  const r = readRound(H.state.r);
  assert.ok(r, 'the round is in room state');
  assert.equal(r.rid, 'mt1.1');
  assert.equal(Object.keys(r.m).length, 8, 'three players and five bots');
  for (const id of IDS) {
    const q = H.priv[id].q;
    assert.ok(q && q.q && q.rid === 'mt1.1', 'each player has a quarry');
    assert.notEqual(q.q, id);
    assert.equal(q.nm, r.m[q.q].nm);
  }
  // The chain stays with the host alone.
  assert.ok(H.priv.p0.chain.c.length >= 8);
  assert.equal(H.priv.p1.chain, undefined);
  assert.equal(H.priv.p2.chain, undefined);
  // Nothing in room state says who hunts whom.
  const pub = JSON.stringify(H.state);
  assert.ok(!pub.includes('"chain"') && !pub.includes('"q":"'), 'no quarry in the public state');
});

test('a new host adopts the round and every hunter keeps the same quarry', () => {
  const H = hub();
  const a = createHost(H.page('p0'));
  run(H, a, 3);
  const before = Object.fromEntries(IDS.map((id) => [id, H.priv[id].q.q]));
  const oldChain = H.priv.p0.chain.c.slice();
  // The host drops; p1 takes over with a fresh page's memory.
  H.host = 'p1';
  H.priv.p1.chain = undefined;
  const b = createHost(H.page('p1'));
  run(H, b, 2);
  const r = readRound(H.state.r);
  assert.equal(r.rid, 'mt1.1', 'the same round carries on');
  assert.equal(H.state.g.by, 'p1');
  for (const id of IDS) assert.equal(H.priv[id].q.q, before[id], `${id} keeps their quarry`);
  assert.equal(H.priv.p1.chain.c.length, oldChain.length, 'the chain is rebuilt whole');
  // The old host's page, no longer the host, does nothing.
  H.clock += 100;
  a.tick();
  assert.equal(H.state.g.by, 'p1');
});

test('a faux pas beside the quarry is a private close call, never a public event', async () => {
  const H = hub();
  const host = createHost(H.page('p0'));
  run(H, host, 1);
  const W = host.world;
  const S = W.S;
  // Past the Blend, p1 has the poise and is hunting someone standing beside a reveller.
  while (W.t < S.timing.huntStart + 1) {
    H.clock += 100;
    host.tick();
  }
  const a = IDS.find((id) => id !== 'p0');
  const q = rules.quarryOf(S, a);
  assert.ok(q);
  // Find a reveller slot and put the quarry beside it, the hunter before it.
  const taken = rules.takenSlots(S);
  let s = 0;
  while (taken.has(s)) s++;
  const nx = W.buf[s * 7];
  const nz = W.buf[s * 7 + 1];
  W.place(q, nx + 1, nz, 0, 0);
  W.place(a, nx, nz - 1.5, 0, 0);
  S.rs[a].p = 100;
  S.rs[a].cu = 0;
  const ev = rules.unmask(S, W.t, a, { k: 'n', s }, null, W.buf);
  assert.equal(ev.k, 'faux');
  H.sent.length = 0;
  S.dirty.ev = true;
  await new Promise((r) => setTimeout(r, 130)); // the host writes the fast parts at most ten times a second
  H.clock += 100;
  host.tick();
  const pub = H.state.ev.find((e) => e.k === 'faux');
  assert.ok(pub, 'the faux pas is public');
  assert.ok(!('close' in pub), 'but it names no quarry');
  if (!S.r.m[q].b) assert.ok(H.sent.some((m) => m.to === q && m.data.t === 'cc'), 'the quarry is told, privately');
});

test('requests: only players in the round are heard, hostile shapes are dropped, a stale round id is ignored', () => {
  const H = hub();
  const host = createHost(H.page('p0'));
  run(H, host, 1);
  const rid = readRound(H.state.r).rid;
  const before = JSON.stringify(H.state.ev);
  host.onMessage({ t: 'um', rid: 'old.1', ref: { k: 'n', s: 3 } }, { id: 'p1' }, 1000);
  host.onMessage({ t: 'um', rid, ref: { k: 'n', s: 99999 } }, { id: 'p1' }, 1000);
  host.onMessage({ t: 'um', rid, ref: { k: 'p', id: 'nobody' } }, { id: 'p1' }, 1000);
  host.onMessage({ t: 'ab', rid, a: 'nonsense' }, { id: 'p1' }, 1000);
  host.onMessage({ t: 'gr', rid, ref: { k: 'n', s: 1 }, x: NaN, z: Infinity }, { id: 'stranger' }, 1000);
  host.onMessage(null, { id: 'p1' }, 1000);
  host.onMessage('hello', { id: 'p1' }, 1000);
  run(H, host, 1);
  assert.equal(JSON.stringify(H.state.ev), before, 'none of it changed the round');
});

test('a player who leaves has the chain closed over them and their pursuer gets a new quarry', () => {
  const H = hub();
  const host = createHost(H.page('p0'));
  run(H, host, 2);
  const pursuer = rules.pursuerOf(host.world.S, 'p1');
  const inherits = rules.quarryOf(host.world.S, 'p1');
  H.players.delete('p1');
  run(H, host, 1);
  const S = host.world.S;
  assert.ok(S.r.m.p1.gone);
  assert.ok(!S.chain.includes('p1'));
  if (pursuer !== 'p1') assert.equal(rules.quarryOf(S, pursuer), inherits);
});

test('three rounds in a row: ids never repeat, the match ends after the podium', () => {
  const H = hub(['p0'], { settings: { mode: 'masq', rounds: 3, length: 3, crowd: 'light', loadout: 'standard', bots: 'novice' } });
  const host = createHost(H.page('p0'));
  const rids = new Set();
  for (let i = 0; i < 20000 && !H.ended; i++) {
    H.clock += 100;
    host.tick();
    if (H.state.r?.rid) rids.add(H.state.r.rid);
  }
  assert.deepEqual([...rids], ['mt1.1', 'mt1.2', 'mt1.3']);
  assert.equal(H.ended, 1, 'endMatch once');
  assert.ok(H.state.g.fin > 0);
  assert.equal(Object.keys(H.state.g.tot).length, 8);
  assert.ok(PLAZAS.length === 3);
});

test('a page cannot claim to be in step far from its slot, or to walk while sprinting', () => {
  const H = hub();
  const host = createHost(H.page('p0'));
  run(H, host, 1);
  const rid = readRound(H.state.r).rid;
  const W = host.world;
  const p = W.S.pos.p1;
  const sp = { x: 0, z: 0, h: 0, sp: 0 };
  W.slotPos('p1', sp);
  // Claims "in step" ten metres from the slot.
  H.players.get('p1').presence = { s: 'p', r: rid, x: sp.x + 10, z: sp.z, h: 0, f: rules.FLAG.locked };
  run(H, host, 1);
  assert.equal(W.S.pos.p1.f & rules.FLAG.locked, 0, 'the lock is not believed');
  // Runs 4 m/s with no sprint flag.
  let x = sp.x + 10;
  for (let i = 0; i < 20; i++) {
    x += 0.4;
    H.players.get('p1').presence = { s: 'p', r: rid, x, z: sp.z, h: 0, f: 0 };
    run(H, host, 0.1);
  }
  assert.ok(W.S.pos.p1.f & rules.FLAG.sprint, 'moving that fast is sprinting');
  // Walking at the crowd's pace is not.
  for (let i = 0; i < 25; i++) {
    x += 0.17;
    H.players.get('p1').presence = { s: 'p', r: rid, x, z: sp.z, h: 0, f: 0 };
    run(H, host, 0.1);
  }
  assert.equal(W.S.pos.p1.f & rules.FLAG.sprint, 0);
  assert.ok(p);
});

test('someone whose page has gone stands in their place in the troupe, not where they were last seen', () => {
  const H = hub();
  const host = createHost(H.page('p0'));
  run(H, host, 12);
  const rid = readRound(H.state.r).rid;
  const W = host.world;
  const sp = { x: 0, z: 0, h: 0, sp: 0 };
  H.players.get('p1').presence = { s: 'p', r: rid, x: 3, z: 3, h: 0, f: 0 };
  run(H, host, 1);
  W.slotPos('p1', sp);
  assert.ok(Math.hypot(W.S.pos.p1.x - 3, W.S.pos.p1.z - 3) < 0.01, 'a present player is where they say');
  H.players.get('p1').connected = false;
  run(H, host, 1);
  W.slotPos('p1', sp);
  assert.ok(Math.hypot(W.S.pos.p1.x - sp.x, W.S.pos.p1.z - sp.z) < 0.35, 'an absent one is in their slot (a step behind the crowd)');
  assert.ok(W.S.pos.p1.f & rules.FLAG.locked);
});

test('a greeted player cannot claim a quicker answer than the host saw', () => {
  const H = hub();
  const host = createHost(H.page('p0'));
  run(H, host, 12);
  const rid = readRound(H.state.r).rid;
  const W = host.world;
  const near = { s: 'p', r: rid, x: 0, z: 0, h: 0, f: 0 };
  H.players.get('p0').presence = { ...near, x: 5, z: 5 };
  H.players.get('p1').presence = { ...near, x: 5, z: 7 };
  run(H, host, 1);
  const g = host.local({ t: 'gr', ref: { k: 'p', id: 'p1' }, x: 5, z: 5, h: 0 });
  assert.equal(g.k, 'greet');
  run(H, host, 3);
  host.onMessage({ t: 'an', rid, g: g.q, d: 0.9 }, { id: 'p1' }, H.clock);
  run(H, host, 0.3);
  const a = W.S.ev.find((e) => e.k === 'answer');
  assert.ok(a, 'the answer is recorded');
  assert.equal(a.v, 'stiff', 'three seconds late is stiff whatever the page claims');
  // On time, the claim stands.
  H.players.get('p2').presence = { ...near, x: 5, z: 6 };
  run(H, host, 4);
  const g2 = host.local({ t: 'gr', ref: { k: 'p', id: 'p2' }, x: 5, z: 5, h: 0 });
  run(H, host, 0.8);
  host.onMessage({ t: 'an', rid, g: g2.q, d: 0.8 }, { id: 'p2' }, H.clock);
  run(H, host, 0.3);
  assert.equal(W.S.ev.find((e) => e.k === 'answer' && e.g === g2.q).v, 'ok');
});

test('a new host takes over in the Hush, at the results and on the podium without a restart', () => {
  const H = hub(['p0', 'p1'], { settings: { mode: 'masq', rounds: 1, length: 3, crowd: 'light', loadout: 'standard', bots: 'novice' } });
  let host = createHost(H.page('p0'));
  const rid = 'mt1.1';
  const handOver = (to, label) => {
    H.host = to;
    H.priv[to].chain = undefined;
    host = createHost(H.page(to));
    run(H, host, 1);
    assert.equal(H.state.g.by, to, `${label}: the new host wrote itself in`);
    assert.equal(readRound(H.state.r).rid, rid, `${label}: same round`);
    assert.equal(H.state.g.n, 1, `${label}: no new round`);
  };
  // Run to the Hush.
  while (!(host.world && host.world.t > host.world.S.timing.hushStart + 3)) run(H, host, 5);
  const keep = H.priv.p1.q.q;
  handOver('p1', 'in the Hush');
  assert.equal(H.priv.p0.q.q !== undefined, true);
  assert.equal(H.priv.p1.q.q, keep, 'the quarry survives the change');
  assert.equal(rules.stage(host.world.S, host.world.t), 'hush');
  // Run to the results.
  while (!(host.world && rules.stage(host.world.S, host.world.t) === 'results')) run(H, host, 2);
  handOver('p0', 'at the results');
  // Run to the podium.
  while (!H.state.g.fin) run(H, host, 2);
  const fin = H.state.g.fin;
  handOver('p1', 'on the podium');
  assert.equal(H.state.g.fin, fin, 'the podium keeps its own clock');
  assert.equal(H.ended, 0);
  while (!H.ended) run(H, host, 5);
  assert.equal(H.ended, 1);
});

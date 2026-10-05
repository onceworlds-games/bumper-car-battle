// Bumper Car Battle: boot, the frame loop and the screens.
//
// Pages: every page simulates its own car at 60 Hz and publishes it as presence ({ x, y, v: [vx, vy], a, h, o, r }). Other cars
// are drawn from presence (humans) or from the host's bot snapshots (bots). The host's page drives the bots, applies falls
// and writes the match record `g` (see net.js). Screens are derived from room.match.phase plus `g`.

import { createAudio } from './audio.js';
import { initAvatars } from './avatars.js';
import { FALL_AIR, FALL_SINK, drawTopParticles, drawWorld, makeBubbles, makeCarView, makeDucks, makeWaves } from './draw.js';
import { createFx } from './fx.js';
import { clamp } from './gfx.js';
import { createInput } from './input.js';
import { createNet } from './net.js';
import { runPoster } from './poster.js';
import { hashStr } from './rng.js';
import { Round } from './round.js';
import { COLORS, DEFAULT_ROUNDS, INTRO_MS, R0, ROUND_OPTIONS, assignColors, awards, botNames, koCounts, matchRanking, radiusAt, seatOrder, stageAt, startSpot, warningAt } from './rules.js';
import { BIG_HIT, HIT, KO_WINDOW, STEP, cdFrac, collideOne, makeCar, outside, resetCar, stepCar } from './sim.js';
import { makeStubOw, makeStubRoom } from './stub.js';
import * as ui from './ui.js';

const params = new URLSearchParams(location.search);
const posterName = params.get('poster');
const canvas = document.getElementById('c');

async function boot() {
  const standalone = !window.onceworlds;
  const ow = window.onceworlds || makeStubOw();
  try {
    ow.ui.setOrientation('landscape');
  } catch {
    // not on the platform
  }
  // Join first, before anything heavy is built, so a reload doesn't miss its seat.
  let room;
  let offline = standalone;
  try {
    room = await ow.rooms.join({
      maxPlayers: 10,
      minPlayers: 1,
      lobby: 'bar',
      settings: [{ id: 'rounds', label: 'Rounds', options: ROUND_OPTIONS, default: DEFAULT_ROUNDS }],
    });
  } catch (err) {
    console.error('could not join a room', err);
    room = standalone ? ow.room : makeStubRoom(() => ow.now());
    offline = true;
  }
  try {
    document.fonts?.load('40px Bungee');
  } catch {
    // fonts are only for looks
  }
  run(ow, room, room.kind === 'solo' && typeof room.tick === 'function' ? room : null, offline);
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 24) || 'Player';
const QUALITY = { low: 0.4, medium: 0.7, high: 1 };
const GHOST_SPEED = 3.6;
const EXTRAP = 0.06; // s: other people's cars are drawn this far ahead along their velocity

function run(ow, room, tickable, offline) {
  const ctx = canvas.getContext('2d');
  const audio = createAudio();
  const input = createInput(ow);
  const fx = createFx();
  const meId = room.me.id;
  initAvatars((id) => ow.player.avatarUrl(id, 'head'));

  const Sc = {
    w: 1,
    h: 1,
    pr: 1,
    cx: 0,
    cy: 0,
    scale: 10,
    shx: 0,
    shy: 0,
    time: 0,
    R: R0,
    warn: false,
    warnTo: R0,
    cars: [],
    fx,
    q: 1,
    reduced: false,
    waves: makeWaves(7),
    ducks: makeDucks(3),
    bubbles: makeBubbles(5),
    youUntil: 0,
    rimPop: 9,
    partsOnTop: false,
  };

  const S = {
    started: false, // PLAY was tapped
    scene: 'lobby', // 'lobby' (also the title) or 'match'
    sceneKey: '',
    views: new Map(),
    demo: null,
    demoN: 0,
    demoT: 0,
    dirty: true,
    car: makeCar(meId, 0, 0, 0),
    ghost: { x: 0, y: 0 },
    inp: { aim: null, steer: 0, thr: 0, mag: 0, boost: false, dx: 0, dy: 0, gm: 0 },
    rid: '',
    seats: [],
    myIdx: -1,
    iAmIn: false,
    myHits: 0,
    lastHit: null,
    sentOut: false,
    phaseKey: '',
    phaseAt: 0,
    goAt: -9,
    snaps: [],
    lastBObj: null,
    stage: 0,
    warnBeep: -1,
    freeze: 0,
    controls: '',
    stats: { matches: 0, wins: 0, kos: 0 },
    badged: new Set(),
    lastG: null,
    card: null,
    cardAt: -99,
    boardKey: '',
    boardRows: null,
    podiumKey: '',
    podium: null,
    statsFor: '',
    count: -1,
    hintDone: false,
    layoutReady: false,
    tmp: { x: 0, y: 0, vx: 0, vy: 0, a: 0, flags: 0 },
    shake: { x: 0, y: 0 },
    dots: [],
    pairCd: new Float32Array(16 * 16),
    lastPoint: -1,
    koOut: null,
    koVal: {},
    errors: 0,
    lobbySince: -1,
  };

  // ---------------------------------------------------------------- saves and badges
  Promise.resolve()
    .then(() => ow.save.get('stats'))
    .then((s) => {
      if (s && typeof s === 'object') S.stats = { matches: fin(s.matches), wins: fin(s.wins), kos: fin(s.kos) };
    })
    .catch(() => {});

  function badge(id) {
    if (S.badged.has(id)) return;
    S.badged.add(id);
    Promise.resolve()
      .then(() => ow.badges.award(id))
      .catch(() => {});
  }

  // ---------------------------------------------------------------- the net
  function onHit(fromId, d) {
    // Another car says it just hit mine: remember who, for the knockout.
    const g = net.G();
    if (!g || g.phase !== 'play' || d.rid !== g.rid || !S.iAmIn || !S.car.alive || !S.views.has(fromId)) return;
    S.lastHit = { by: fromId, t: room.matchNow() };
  }
  const net = createNet(room, { vOf: (id) => S.views.get(id) ?? null, onHit });

  const rosterEntry = (g, id) => (g ? g.roster.find((e) => e.id === id) : null);
  // The match seed as every page and the host's Round read it.
  const seedOf = () => fin(room.match.seed, 1) >>> 0;
  /** Knockouts so far this round, by car (worked out again only when the record changes). */
  function koOf(g) {
    if (S.koOut !== g.out) {
      S.koOut = g.out;
      S.koVal = koCounts(g.out);
    }
    return S.koVal;
  }
  function nameOf(g, id) {
    const e = rosterEntry(g, id);
    if (e && e.bot) return cleanName(e.n);
    return cleanName(room.players.get(id)?.name);
  }

  // ---------------------------------------------------------------- views of the cars
  const makeView = (id, kind, name, c) => makeCarView(id, { kind, name, c, set: { pop: 1 } });

  function rebuild(g) {
    S.dirty = false;
    const key = g ? (g.phase === 'final' ? S.rid || g.rid : g.rid) : 'lobby';
    const fresh = key !== S.sceneKey;
    S.sceneKey = key;
    const old = fresh ? new Map() : S.views;
    const next = new Map();
    if (g) {
      S.demo = null;
      let bi = 0;
      g.roster.forEach((e, i) => {
        let v = old.get(e.id);
        if (!v) {
          const kind = e.bot ? 'bot' : e.id === meId ? 'me' : 'human';
          v = makeView(e.id, kind, e.bot ? cleanName(e.n) : '', e.c);
          if (g.out[e.id]) {
            // Already out when this page looked (a reload, a late look): no splash, straight to the swimmer.
            v.out = true;
            v.outSeen = true;
            v.ghost = true;
          }
          placeAtStart(v, g, i);
        }
        v.idx = i;
        v.bi = e.bot ? bi : 0;
        if (e.bot) bi++;
        next.set(e.id, v);
      });
    } else {
      const humans = S.started ? room.online.map((p) => p.id) : [];
      if (S.started && !humans.includes(meId)) humans.push(meId);
      const nBots = S.started ? 3 : 8;
      if (!S.demo || S.demoN !== nBots) {
        S.demo = Round.createDemo(nBots, 20260, humans);
        S.demoN = nBots;
        S.demoT = 0;
      } else S.demo.syncExt(humans);
      const botIds = S.demo.cars.filter((c) => c.kind === 'bot').map((c) => c.id);
      const colors = assignColors([...humans, ...botIds]);
      const names = botNames(nBots, 777);
      humans.forEach((id) => {
        let v = old.get(id);
        if (!v) {
          v = makeView(id, id === meId ? 'me' : 'human', '', colors[id]);
          if (id === meId) lobbySpawn(v);
        }
        v.c = colors[id];
        v.color = COLORS[v.c % COLORS.length];
        next.set(id, v);
      });
      botIds.forEach((id, i) => {
        let v = old.get(id);
        if (!v) v = makeView(id, 'demo', names[i], colors[id]);
        v.c = colors[id];
        v.color = COLORS[v.c % COLORS.length];
        next.set(id, v);
      });
    }
    S.views = next;
  }

  /** A start spot for a car that has not shown us where it is yet. */
  function placeAtStart(v, g, idx) {
    const n = g.roster.length;
    const seats = S.seats.length === n ? S.seats : seatOrder(n, seedOf(), g.round);
    const s = startSpot(seats[idx] ?? idx, n);
    v.x = s.x;
    v.y = s.y;
    v.a = s.a;
    v.vx = 0;
    v.vy = 0;
  }

  function lobbySpawn(v) {
    const ang = ((hashStr(meId) % 628) / 100) + room.match.n;
    resetCar(S.car, Math.cos(ang) * 5, Math.sin(ang) * 5, ang + Math.PI);
    v.x = S.car.x;
    v.y = S.car.y;
  }

  room.on('join', () => (S.dirty = true));
  room.on('leave', () => (S.dirty = true));
  room.on('back', () => (S.dirty = true));
  room.on('away', () => (S.dirty = true));

  // ---------------------------------------------------------------- layout
  function resize() {
    const w = Math.max(1, window.innerWidth || 800);
    const h = Math.max(1, window.innerHeight || 450);
    const pr = Math.max(0.5, Number(ow.settings.pixelRatio(2)) || 1);
    Sc.w = w;
    Sc.h = h;
    Sc.pr = pr;
    canvas.width = Math.floor(w * pr);
    canvas.height = Math.floor(h * pr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    S.layoutReady = false;
  }
  function applySettings() {
    Sc.q = QUALITY[ow.settings.quality] ?? 1;
    Sc.reduced = Boolean(ow.settings.reducedMotion);
    fx.q = Sc.q;
    fx.reduced = Sc.reduced;
  }
  resize();
  applySettings();
  addEventListener('resize', resize);
  try {
    ow.settings.on('change', () => {
      applySettings();
      resize();
    });
  } catch {
    // older platform
  }

  function layout(dt) {
    const lobby = S.scene === 'lobby';
    const top = lobby ? (S.started ? 56 : 0) : 40;
    const bottom = lobby && S.started ? 46 : 0;
    const half = lobby ? 13 : 12.5;
    const availH = Math.max(80, Sc.h - top - bottom);
    const scale = Math.min(Sc.w / (half * 2.2), availH / (half * 2));
    const cy = top + availH / 2;
    const cx = Sc.w / 2;
    if (!S.layoutReady || Sc.reduced) {
      Sc.scale = scale;
      Sc.cx = cx;
      Sc.cy = cy;
      S.layoutReady = true;
    } else {
      const k = 1 - Math.exp(-6 * dt);
      Sc.scale += (scale - Sc.scale) * k;
      Sc.cx += (cx - Sc.cx) * k;
      Sc.cy += (cy - Sc.cy) * k;
    }
  }

  // ---------------------------------------------------------------- phase of the screen
  function setScene(g) {
    const want = g ? 'match' : 'lobby';
    if (want !== S.scene) {
      S.scene = want;
      S.dirty = true;
    }
  }

  function placeMyCar(g) {
    const car = S.car;
    const rec = g.out[meId];
    S.sentOut = Boolean(rec);
    S.myHits = 0;
    S.lastHit = null;
    if (S.myIdx < 0) return;
    if (rec) {
      // already out when this page loaded: a swimmer from the start
      car.alive = false;
      S.ghost.x = Array.isArray(rec) ? fin(rec[2]) : 0;
      S.ghost.y = Array.isArray(rec) ? fin(rec[3]) : 0;
      pushGhostOut();
      return;
    }
    const n = g.roster.length;
    const s = startSpot(S.seats[S.myIdx] ?? S.myIdx, n);
    resetCar(car, s.x, s.y, s.a);
    // A reload in the middle of a round: carry on from the last presence the room has.
    const p = room.me.presence;
    if (g.phase !== 'intro' && p && typeof p === 'object' && p.r === g.rid && Array.isArray(p.v)) {
      car.x = fin(p.x, car.x);
      car.y = fin(p.y, car.y);
      car.vx = fin(p.v[0]);
      car.vy = fin(p.v[1]);
      car.a = fin(p.a, car.a);
    }
  }

  /** A swimmer stays in the water: at least a car's width beyond the rink's edge. */
  function pushGhostOut() {
    const R = Sc.R;
    const r = Math.hypot(S.ghost.x, S.ghost.y);
    const want = Math.max(R + 1.0, r);
    if (r > 1e-6) {
      S.ghost.x *= want / r;
      S.ghost.y *= want / r;
    } else S.ghost.x = want;
  }

  function enterRound(g) {
    S.rid = g.rid;
    S.myIdx = g.roster.findIndex((e) => e.id === meId && !e.bot);
    S.iAmIn = S.myIdx >= 0 && !room.spectating && room.isParticipant(meId);
    S.seats = seatOrder(g.roster.length, seedOf(), g.round);
    S.snaps.length = 0;
    S.lastBObj = null;
    S.dirty = true;
    fx.clear();
    Sc.partsOnTop = false;
    Sc.youUntil = Sc.time + 3;
    S.warnBeep = -1;
    S.stage = stageAt(net.tPlay(g));
    rebuild(g);
    if (S.iAmIn) placeMyCar(g);
    for (const v of S.views.values()) v.pop = 1;
    S.lastG = g;
  }

  // ---------------------------------------------------------------- effects
  function hitFx(x, y, speed, nx, ny, mine) {
    fx.sparks(x, y, nx, ny, speed);
    if (speed >= 6) fx.bonk(x, y, speed, fx.rand() < 0.6 ? 'BONK!' : fx.rand() < 0.5 ? 'BAM!' : 'POW!');
    if (speed >= 8) fx.puff(x, y, 4, '#ffffff', 2);
    audio.bonk(mine ? speed : speed * 0.6);
    if (mine) fx.shake(clamp(speed / 28, 0.06, 0.6));
    else if (speed >= BIG_HIT) fx.shake(0.12);
  }

  function squash(v, speed, nx, ny, flip) {
    v.sq = Math.max(v.sq, clamp(speed / 12, 0.3, 1));
    v.sqa = Math.atan2(flip ? -ny : ny, flip ? -nx : nx);
    if (speed >= BIG_HIT && !Sc.reduced) v.flash = 1;
  }

  const hitSentAt = new Map();

  function onMyHit(v, g) {
    const speed = HIT.speed;
    const nx = HIT.nx;
    const ny = HIT.ny;
    const car = S.car;
    const mv = S.views.get(meId);
    hitFx((car.x + v.x) / 2, (car.y + v.y) / 2, speed, nx, ny, true);
    if (mv) squash(mv, speed, nx, ny, false);
    squash(v, speed, nx, ny, true);
    if (speed >= BIG_HIT && !Sc.reduced) S.freeze = 0.06;
    if (!g || g.phase !== 'play') return;
    const iWasHit = HIT.aggB > HIT.aggA;
    if (iWasHit) {
      S.lastHit = { by: v.id, t: room.matchNow() };
      if (speed >= 4 && v.heavy > 0 && car.heavy <= 0) S.myHits++;
    } else if (v.kind === 'human') {
      // I did the hitting: tell them, so the knockout is mine if they fall.
      const now = performance.now();
      if (now - (hitSentAt.get(v.id) ?? -1e9) > 250) {
        hitSentAt.set(v.id, now);
        net.sendHit(v.id, g.rid);
      }
    }
  }

  function startFall(v, x, y, vx, vy) {
    v.out = true;
    v.fall = { t: 0, x0: x, y0: y, vx: clamp(vx, -30, 30), vy: clamp(vy, -30, 30), spin: (hashStr(v.id) % 2 ? 1 : -1) * (8 + (hashStr(v.id) % 5)), splashed: false };
    v.a = fin(v.a);
    audio.fall();
  }

  function myFall(g) {
    const car = S.car;
    car.alive = false;
    const lh = S.lastHit;
    const by = lh && room.matchNow() - lh.t <= KO_WINDOW ? lh.by : '';
    S.sentOut = true;
    net.sendOut({ rid: g.rid, by, x: r1(car.x), y: r1(car.y), vx: r1(car.vx), vy: r1(car.vy), h: S.myHits });
    const mv = S.views.get(meId);
    if (mv) startFall(mv, car.x, car.y, car.vx, car.vy);
    S.ghost.x = car.x;
    S.ghost.y = car.y;
    pushGhostOut();
    try {
      navigator.vibrate?.(60);
    } catch {
      // not on every phone
    }
  }

  /** A new elimination record in `g` that this page hasn't shown yet. */
  function onOut(v, rec) {
    v.outSeen = true;
    const by = typeof rec[1] === 'string' ? rec[1] : '';
    if (v.kind === 'me') {
      if (!v.fall && S.car.alive) {
        // the host put us out (our own message never arrived): fall from where we are
        S.car.alive = false;
        startFall(v, S.car.x, S.car.y, S.car.vx, S.car.vy);
        S.ghost.x = S.car.x;
        S.ghost.y = S.car.y;
        pushGhostOut();
      }
    } else if (!v.fall && !v.out) {
      const x = fin(rec[2]);
      const y = fin(rec[3]);
      if (Math.hypot(x, y) < Sc.R - 0.3 && Math.hypot(fin(rec[4]), fin(rec[5])) < 0.2) {
        // a car that was taken out where it stood (its player left): it just vanishes in a puff
        v.out = true;
        fx.puff(v.x, v.y, 8, '#ffffff', 2.5);
        audio.pop();
      } else startFall(v, x, y, fin(rec[4]), fin(rec[5]));
    }
    if (by) {
      const k = S.views.get(by);
      if (k) {
        fx.popup('KO!', k.x, k.y, '#ffe14a', 1.35);
        fx.popup('+2', k.x, k.y, '#ffffff', 0.9, 0.15);
        fx.puff(k.x, k.y, 5, '#ffe14a', 2.2);
      }
      if (by === meId) {
        audio.ko();
        fx.shake(0.25);
      } else audio.pop();
    }
  }

  function stepFalls(dt) {
    for (const v of S.views.values()) {
      const f = v.fall;
      if (!f) continue;
      f.t += dt;
      if (f.t < FALL_AIR + FALL_SINK) {
        const k = (1 - Math.exp(-1.2 * f.t)) / 1.2;
        v.x = f.x0 + f.vx * k;
        v.y = f.y0 + f.vy * k;
        v.a += f.spin * dt;
        v.vx = 0;
        v.vy = 0;
        v.heavy = 0;
        if (!f.splashed && f.t >= FALL_AIR) {
          f.splashed = true;
          fx.splash(v.x, v.y, 1);
          audio.splash();
          if (v.me) fx.shake(0.3);
        }
      } else {
        v.fall = null;
        v.ghost = true;
        v.ghostPop = 1;
      }
    }
  }

  function crumbleFx(oldR, newR) {
    const n = Math.max(8, fx.count(26));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + fx.rand() * 0.2;
      const r = newR + (oldR - newR) * (0.1 + fx.rand() * 0.9);
      fx.debris(Math.cos(ang) * r, Math.sin(ang) * r, ang, i & 1 ? '#efe1b4' : i % 3 === 0 ? '#e8283c' : '#fbf5df');
    }
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + fx.rand();
      fx.splash(Math.cos(ang) * (oldR + 0.6), Math.sin(ang) * (oldR + 0.6), 0.6);
    }
    audio.crumble();
    fx.shake(0.55);
    Sc.rimPop = 0;
  }

  // ---------------------------------------------------------------- bots' snapshots (pages that aren't the host)
  function readSnaps(g) {
    const b = room.state.b;
    if (!b || b === S.lastBObj) return;
    S.lastBObj = b;
    if (typeof b !== 'object' || b.rid !== g.rid || !Number.isFinite(b.t) || !Array.isArray(b.p)) return;
    const last = S.snaps[S.snaps.length - 1];
    if (last && b.t <= last.t) return;
    S.snaps.push({ t: b.t, p: b.p });
    if (S.snaps.length > 6) S.snaps.shift();
  }

  function botAt(i, out, rt) {
    const s = S.snaps;
    const n = s.length;
    if (!n) return false;
    let a = s[0];
    let b = s[n - 1];
    let f = 0;
    let ex = 0;
    if (rt <= a.t) b = a;
    else if (rt >= b.t) {
      a = b;
      ex = clamp((rt - b.t) / 1000, 0, 0.12);
    } else {
      for (let k = n - 2; k >= 0; k--) {
        if (s[k].t <= rt) {
          a = s[k];
          b = s[k + 1];
          break;
        }
      }
      f = (rt - a.t) / Math.max(1, b.t - a.t);
    }
    const pa = a.p[i];
    const pb = b.p[i];
    if (!Array.isArray(pa) || !Array.isArray(pb) || pa.length < 6 || pb.length < 6) return false;
    for (let k = 0; k < 6; k++) if (!Number.isFinite(pa[k]) || !Number.isFinite(pb[k])) return false;
    out.vx = pb[2];
    out.vy = pb[3];
    out.x = pa[0] + (pb[0] - pa[0]) * f + (a === b ? out.vx * ex : 0);
    out.y = pa[1] + (pb[1] - pa[1]) * f + (a === b ? out.vy * ex : 0);
    let da = pb[4] - pa[4];
    da = ((((da + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    out.a = pa[4] + da * f;
    out.flags = pb[5] | 0;
    return true;
  }

  // ---------------------------------------------------------------- updating the views each frame
  function copyCar(v, c) {
    v.x = c.x;
    v.y = c.y;
    v.a = c.a;
    v.vx = c.vx;
    v.vy = c.vy;
    v.heavy = c.heavy > 0 ? Math.max(c.heavy, 0.05) : 0;
  }

  function refreshViews(dt, g) {
    const rt = room.matchNow() - 70; // bots are drawn a little behind the host, between its last two snapshots
    if (g && !room.isHost) readSnaps(g);
    const hide = g && (g.phase === 'board' || g.phase === 'final');
    Sc.cars.length = 0;
    const hr = net.round;
    for (const v of S.views.values()) {
      const inFall = v.fall !== null;
      if (v.kind === 'me') {
        const c = S.car;
        if (!inFall) {
          if (v.out) {
            v.x = S.ghost.x;
            v.y = S.ghost.y;
            v.vx = 0;
            v.vy = 0;
            v.heavy = 0;
          } else copyCar(v, c);
        }
        v.cd = cdFrac(c);
        v.hidden = !S.started || (g && !S.iAmIn);
        v.pOut = !c.alive;
        v.tag = nameOf(g, meId);
        v.fresh = true;
        if (!v.out && v.cd >= 1 && v.wasReady === false) v.pop = Math.max(v.pop, 0.45);
        v.wasReady = v.cd >= 1;
      } else if (v.kind === 'human') {
        const p = room.presenceAt(v.id, { angles: ['a'], snap: 9 });
        const pl = room.players.get(v.id);
        v.tag = cleanName(pl?.name);
        const away = !pl || pl.connected === false;
        const okp = p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Array.isArray(p.v);
        const same = okp && (!g || p.r === g.rid);
        if (same) {
          v.hidden = false;
          v.fresh = Boolean(g);
          const vx = away ? 0 : clamp(fin(p.v[0]), -40, 40);
          const vy = away ? 0 : clamp(fin(p.v[1]), -40, 40);
          v.pOut = fin(p.o) > 0.5;
          if (!inFall) {
            const still = v.out || v.pOut;
            v.vx = vx;
            v.vy = vy;
            v.x = clamp(p.x, -40, 40) + (still ? 0 : vx * EXTRAP);
            v.y = clamp(p.y, -40, 40) + (still ? 0 : vy * EXTRAP);
            v.a = fin(p.a);
            v.heavy = !away && fin(p.h) > 0.5 && !still ? 0.25 : 0;
            if (v.out) {
              v.vx = 0;
              v.vy = 0;
            }
          }
        } else if (g) {
          v.fresh = false;
          v.pOut = false;
          if (!inFall && !v.out) placeAtStart(v, g, v.idx);
          v.hidden = false;
        } else v.hidden = !okp;
        if (!g) {
          v.ready = Boolean(pl?.ready);
        }
      } else if (v.kind === 'bot') {
        let ok = false;
        if (hr) {
          const c = hr.byId.get(v.id);
          if (c) {
            if (!inFall) {
              copyCar(v, c);
              if (v.out) {
                v.vx = 0;
                v.vy = 0;
                v.heavy = 0;
              } else if (c.out) {
                // it has just fallen: show the fall with the speed it went over the edge with
                const rec = hr.out.get(v.id);
                if (rec) {
                  v.vx = rec.vx;
                  v.vy = rec.vy;
                }
                v.heavy = 0;
              }
            }
            v.pOut = c.out;
            ok = true;
          }
        } else if (!room.isHost && S.snaps.length && botAt(v.bi, S.tmp, rt)) {
          if (!inFall) {
            v.x = S.tmp.x;
            v.y = S.tmp.y;
            v.a = S.tmp.a;
            v.vx = S.tmp.vx;
            v.vy = S.tmp.vy;
            v.heavy = S.tmp.flags & 2 ? 0.25 : 0;
            if (v.out) {
              v.vx = 0;
              v.vy = 0;
              v.heavy = 0;
            }
          }
          v.pOut = (S.tmp.flags & 1) === 1;
          ok = true;
        }
        if (!ok && g && !inFall && !v.out) placeAtStart(v, g, v.idx);
        v.fresh = true;
      } else {
        const c = S.demo?.byId.get(v.id);
        if (c) copyCar(v, c);
      }
      if (v.kind === 'bot' || v.kind === 'demo') v.tag = v.name;
      // Their page (or the host, for a bot) says it fell: start the fall now, the record will confirm it a moment later.
      if (g && v.pOut && !v.out && !v.fall && v.kind !== 'me' && g.phase === 'play') startFall(v, v.x, v.y, v.vx, v.vy);
      // winners spin on the spot
      if (g && g.phase === 'end' && g.win === v.id && !v.out) {
        v.spin += dt;
        v.a = v.spin * 7;
        v.vx = 0;
        v.vy = 0;
      }
      v.sq = Math.max(0, v.sq - dt * 5);
      v.flash = Math.max(0, v.flash - dt * 6);
      v.pop = Math.max(0, v.pop - dt * 3);
      v.ghostPop = Math.max(0, v.ghostPop - dt * 3);
      if (v.ready) v.readyPop = Math.min(1, v.readyPop + dt * 4);
      else v.readyPop = 0;
      // a little dust behind a car that is going fast
      if (!v.out && !v.hidden) {
        const sp = Math.hypot(v.vx, v.vy);
        if (sp > 4) {
          v.dust += sp * dt;
          if (v.dust > 1.1) {
            v.dust = 0;
            fx.puff(v.x - Math.cos(v.a) * 0.8, v.y - Math.sin(v.a) * 0.8, 1, 'rgba(255,255,255,0.9)', 0.5);
          }
        }
      }
      if (!v.hidden && !hide) Sc.cars.push(v);
    }
  }

  /** Sparks, a BONK and a thump when two cars (neither of them mine) run into each other. */
  function otherCollisions(dt) {
    const cars = Sc.cars;
    const n = cars.length;
    const cd = S.pairCd;
    for (let k = 0; k < cd.length; k++) if (cd[k] > 0) cd[k] -= dt;
    for (let i = 0; i < n; i++) {
      const a = cars[i];
      if (a.me || a.out || a.pOut) continue;
      for (let j = i + 1; j < n; j++) {
        const b = cars[j];
        if (b.me || b.out || b.pOut) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1.6 * 1.6 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const key = Math.min(i, 15) * 16 + Math.min(j, 15);
        if (closing > 3.5 && cd[key] <= 0) {
          cd[key] = 0.35;
          hitFx((a.x + b.x) / 2, (a.y + b.y) / 2, closing, nx, ny, false);
          squash(a, closing, nx, ny, false);
          squash(b, closing, nx, ny, true);
        }
      }
    }
  }

  // ---------------------------------------------------------------- my car, in fixed steps
  function myMeet(g) {
    const car = S.car;
    const mv = S.views.get(meId);
    for (const v of Sc.cars) {
      if (v === mv || v.out || v.pOut || v.hidden) continue;
      if (collideOne(car, v)) onMyHit(v, g);
    }
  }

  function stepMe(g) {
    const car = S.car;
    const inp = S.inp;
    if (!S.started) return;
    if (S.scene === 'lobby') {
      input.drive(inp);
      inp.boost = false;
      if (input.wantsBoost() && car.cd <= 0) {
        inp.boost = true;
        input.useBoost();
      }
      if (stepCar(car, inp, STEP, R0, true)) onMyBoost();
      myMeet(null);
      return;
    }
    if (!g || !S.iAmIn) return;
    if (g.phase === 'intro') {
      car.vx = 0;
      car.vy = 0;
      return;
    }
    if (!car.alive) {
      stepGhost(STEP);
      return;
    }
    if (g.phase === 'play') {
      input.drive(inp);
      inp.boost = false;
      if (input.wantsBoost() && car.cd <= 0) {
        inp.boost = true;
        input.useBoost();
      }
      if (stepCar(car, inp, STEP, Sc.R, false)) onMyBoost();
      myMeet(g);
      if (outside(car, Sc.R)) myFall(g);
    } else if (g.phase === 'end') {
      inp.aim = null;
      inp.steer = 0;
      inp.thr = 0;
      inp.boost = false;
      stepCar(car, inp, STEP, Sc.R, true);
    }
  }

  function stepGhost(dt) {
    const v = S.views.get(meId);
    if (v && v.fall) return; // still on the way down
    input.drive(S.inp);
    const gh = S.ghost;
    const sp = GHOST_SPEED * S.inp.gm;
    gh.x += S.inp.dx * sp * dt;
    gh.y += S.inp.dy * sp * dt;
    pushGhostOut();
    const hw = Sc.w / 2 / Sc.scale - 0.9;
    const hh = (Sc.h - Sc.cy) / Sc.scale - 0.9;
    gh.x = clamp(gh.x, -hw, hw);
    gh.y = clamp(gh.y, -(Sc.cy / Sc.scale) + 2.2, hh);
  }

  function onMyBoost() {
    audio.boost();
    fx.shake(0.07);
    S.hintDone = true;
    const c = S.car;
    fx.puff(c.x - Math.cos(c.a) * 0.9, c.y - Math.sin(c.a) * 0.9, 6, '#ffd9a0', 2.5);
    const mv = S.views.get(meId);
    if (mv) {
      mv.sq = Math.max(mv.sq, 0.35);
      mv.sqa = c.a;
    }
  }

  function publish(g) {
    if (!S.started) return;
    const car = S.car;
    let rid = '';
    if (S.scene === 'match') {
      if (!g || !S.iAmIn) return;
      rid = S.rid;
    }
    const out = car.alive ? 0 : 1;
    // While the car is still on its way down, others are told where it went over and how fast, so they can show the same fall.
    const mv = S.views.get(meId);
    const f = out && mv ? mv.fall : null;
    const p = f ? { x: f.x0, y: f.y0 } : out ? S.ghost : car;
    const vel = f ? [r1(f.vx), r1(f.vy)] : out ? [0, 0] : [r1(car.vx), r1(car.vy)];
    room.setPresence({ x: r2(p.x), y: r2(p.y), v: vel, a: r2(car.a), h: !out && car.heavy > 0 ? 1 : 0, o: out, r: rid });
  }

  // ---------------------------------------------------------------- controls, music
  function setControls(g) {
    let want = '';
    if (S.started) {
      if (S.scene === 'lobby') want = 'full';
      else if (g && S.iAmIn && g.phase !== 'board' && g.phase !== 'final') want = S.car.alive ? 'full' : 'ghost';
    }
    if (want === S.controls) return;
    S.controls = want;
    try {
      if (want === 'full') ow.controls.set({ stick: 'analog', buttons: [{ id: 'boost', label: 'Boost', key: ' ' }] });
      else if (want === 'ghost') ow.controls.set({ stick: 'analog', buttons: [] });
      else ow.controls.set(null);
    } catch {
      // controls are only on the platform
    }
  }

  function setMusic(g) {
    let level = 'menu';
    if (S.scene === 'match' && g && (g.phase === 'play' || g.phase === 'intro' || g.phase === 'end')) level = 'play';
    audio.setLevel(level);
  }

  // ---------------------------------------------------------------- screens: what happens when a phase begins
  function onPhase(g) {
    S.phaseKey = `${g.rid}|${g.phase}`;
    S.phaseAt = Sc.time;
    if (g.phase === 'intro') {
      for (const v of S.views.values()) v.pop = 1;
      audio.pop();
    } else if (g.phase === 'play') {
      if (net.tPlay(g) < 1500) {
        S.goAt = Sc.time;
        audio.go();
      }
      S.stage = stageAt(net.tPlay(g));
    } else if (g.phase === 'end') {
      const w = S.views.get(g.win);
      if (w) {
        fx.confetti(w.x, w.y - 1, 40, 5, 8);
        fx.puff(w.x, w.y, 8, '#ffffff', 2);
      }
      if (g.win === meId) {
        audio.win();
        if (g.small) badge('last-second');
      } else if (S.iAmIn && !S.views.get(meId)?.out) audio.pop();
      else audio.lose();
      // hits taken and survived: the host adds them to the Slippery award
      if (S.iAmIn && S.car.alive && !S.sentOut) net.sendHits(g.rid, S.myHits);
    } else if (g.phase === 'board') {
      S.boardRows = null;
      S.boardKey = '';
    } else if (g.phase === 'final') {
      Sc.partsOnTop = true;
      fx.confetti(0, -13, 90, 12, 3);
      audio.win();
      finishStats(g);
    }
  }

  function finishStats(g) {
    if (S.statsFor === g.mid) return;
    S.statsFor = g.mid;
    if (S.myIdx < 0 || !S.started) return;
    const ranking = matchRanking(g.roster, g.scores, g.kos);
    const won = ranking[0] === meId;
    const stats = S.stats;
    stats.matches += 1;
    stats.kos += fin(g.kos[meId]);
    if (won) {
      stats.wins += 1;
      badge('first-win');
    }
    if (stats.matches >= 10) badge('road-trip');
    Promise.resolve()
      .then(() => ow.save.set('stats', { matches: stats.matches, wins: stats.wins, kos: stats.kos }))
      .catch(() => {});
    if (won) {
      Promise.resolve()
        .then(() => ow.leaderboards.submit('wins', stats.wins))
        .catch(() => {});
    }
  }

  function podiumData(g) {
    const ranking = matchRanking(g.roster, g.scores, g.kos);
    const entry = (id) => {
      const e = rosterEntry(g, id);
      const idx = g.roster.indexOf(e);
      return { id, name: nameOf(g, id), bot: Boolean(e && e.bot), color: COLORS[(e ? e.c : idx) % COLORS.length], score: fin(g.scores[id]), me: id === meId };
    };
    const top = ranking.slice(0, 3).map(entry);
    const aw = awards(g.roster, g.kos, g.surv);
    const award = (id) => (id ? { ...entry(id), value: 0 } : null);
    const place = ranking.indexOf(meId) + 1;
    return { top, awards: { wrecking: award(aw.wrecking), slippery: award(aw.slippery) }, you: S.myIdx >= 0 && place > 0 ? { place, score: fin(g.scores[meId]) } : null };
  }

  function boardData(g) {
    const rp = g.rp || {};
    const rows = g.roster.map((e, i) => {
      const total = fin(g.scores[e.id]);
      const pts = fin(rp[e.id]);
      return { id: e.id, name: nameOf(g, e.id), bot: Boolean(e.bot), color: COLORS[e.c % COLORS.length], me: e.id === meId, prevTotal: total - pts, total, pts, i, prevRank: 0, rank: 0 };
    });
    const byNew = rows.slice().sort((a, b) => b.total - a.total || a.i - b.i);
    const byOld = rows.slice().sort((a, b) => b.prevTotal - a.prevTotal || a.i - b.i);
    byNew.forEach((r, k) => (r.rank = k));
    byOld.forEach((r, k) => (r.prevRank = k));
    return rows;
  }

  // ---------------------------------------------------------------- one frame of the world
  function updateScene(dt) {
    const g0 = room.match.phase === 'playing' ? net.G() : null;
    const g = g0;
    setScene(g);
    if (g) S.lastG = g;

    // the rink's radius and its warning
    let tp = 0;
    if (g) tp = g.phase === 'play' || g.phase === 'end' ? net.tPlay(g) : g.phase === 'board' || g.phase === 'final' ? g.tEnd : 0;
    const oldR = Sc.R;
    Sc.R = g && g.phase !== 'intro' ? radiusAt(tp) : R0;
    if (g && g.phase === 'play') {
      const w = warningAt(tp);
      Sc.warn = w.warn;
      Sc.warnTo = w.to;
      if (w.warn) {
        const b = Math.floor(w.left / 500);
        if (b !== S.warnBeep) {
          S.warnBeep = b;
          audio.warn();
        }
      } else S.warnBeep = -1;
      const stage = stageAt(tp);
      if (stage > S.stage) {
        S.stage = stage;
        crumbleFx(oldR > Sc.R ? oldR : Sc.R + 1.4, Sc.R);
      }
    } else {
      Sc.warn = false;
      S.warnBeep = -1;
    }
    Sc.rimPop += dt;

    if (g && g.phase !== 'final' && g.rid !== S.rid) enterRound(g);
    else if (S.dirty || (!g && S.sceneKey !== 'lobby') || (g && S.views.size === 0)) rebuild(g);
    if (g && `${g.rid}|${g.phase}` !== S.phaseKey) onPhase(g);

    // the lobby's demo cars: positions of the people they bump into
    if (S.demo && !g) {
      for (const v of S.views.values()) {
        if (v.kind === 'me' || v.kind === 'human') {
          const c = S.demo.byId.get(v.id);
          if (c && !v.hidden) {
            c.x = v.x;
            c.y = v.y;
            c.vx = v.vx;
            c.vy = v.vy;
            c.heavy = v.heavy;
          }
        }
      }
    }

    refreshViews(dt, g);
    if (g) {
      // new falls in the record
      for (const v of S.views.values()) {
        const rec = g.out[v.id];
        if (Array.isArray(rec) && !v.outSeen) onOut(v, rec);
      }
      // knockouts: the badge for three in one round
      if ((koOf(g)[meId] || 0) >= 3) badge('knockout-king');
    }
    stepFalls(dt);
    otherCollisions(dt);

    // the countdown
    const m = room.match;
    if (m.phase === 'starting' && Number.isFinite(m.startsAt)) {
      const left = m.startsAt - ow.now();
      const n = left > 0 ? Math.min(3, Math.ceil(left / 1000)) : 0;
      if (n !== S.count) {
        S.count = n;
        if (n >= 1 && S.started) audio.tick();
      }
    } else S.count = -1;

    // ready checks keep their pop
    const lobbyNow = !g && room.match.phase === 'lobby';
    if (lobbyNow) {
      const me = S.views.get(meId);
      if (me) {
        const ready = Boolean(room.me.ready);
        if (ready && !me.ready) audio.ready();
        me.ready = ready;
      }
    }

    fx.update(dt);
    fx.shakeOffset(S.shake, Math.min(Sc.w, Sc.h) * 0.02);
    Sc.shx = S.shake.x;
    Sc.shy = S.shake.y;
    return g;
  }

  // ---------------------------------------------------------------- drawing
  function drawScreens(g) {
    const t = Sc.time;
    if (!S.started) {
      ui.drawTitle(ctx, Sc, t);
      return;
    }
    const m = room.match;
    if (S.scene === 'lobby') {
      if (m.phase === 'lobby') {
        const rounds = ROUND_OPTIONS.includes(Number(room.settings.rounds)) ? Number(room.settings.rounds) : DEFAULT_ROUNDS;
        ui.drawLobbyHud(ctx, Sc, { rounds, options: ROUND_OPTIONS, isHost: room.isHost, hint: 'Bump them off!' });
        if (S.card && t - S.cardAt < 6) ui.drawResultsCard(ctx, Sc, { top: S.card.top, age: t - S.cardAt });
      } else ui.rects.rounds.length = 0;
      if (m.phase === 'starting' && S.count >= 1) {
        const left = m.startsAt - ow.now();
        ui.drawCountdown(ctx, Sc, S.count, Math.max(0, (S.count * 1000 - left) / 1000));
      }
      return;
    }
    ui.rects.rounds.length = 0;
    if (!g) return;
    const age = t - S.phaseAt;
    const koTotal = koOf(g);
    const dead = g.out[meId] !== undefined;
    if (g.phase === 'intro' || g.phase === 'play' || g.phase === 'end') {
      const dots = S.dots;
      while (dots.length < g.roster.length) dots.push({ color: '#fff', out: false, me: false });
      dots.length = g.roster.length;
      g.roster.forEach((e, i) => {
        const d = dots[i];
        d.color = COLORS[e.c % COLORS.length];
        d.out = g.out[e.id] !== undefined;
        d.me = e.id === meId && !e.bot;
      });
      const mv = S.views.get(meId);
      ui.drawHud(ctx, Sc, {
        round: g.round,
        rounds: g.rounds,
        dots,
        timeLeft: g.phase === 'play' ? g.until - room.matchNow() : Infinity,
        score: fin(g.scores[meId]),
        kos: koTotal[meId] || 0,
        out: S.iAmIn && dead,
        spectating: !S.iAmIn,
        warn: Sc.warn,
        t,
        outAge: mv && mv.fall ? mv.fall.t : undefined,
      });
    }
    if (g.phase === 'intro') {
      ui.drawRibbon(ctx, Sc, 'LAST CAR WINS!', `ROUND ${g.round}/${g.rounds}`, age, INTRO_MS / 1000, '#e8283c', 0.5, Sc.reduced);
    } else if (g.phase === 'play') {
      if (t - S.goAt < 0.9) ui.drawCountdown(ctx, Sc, 0, t - S.goAt);
      if (S.iAmIn && S.car.alive && !ow.controls.touch && !S.hintDone && age > 0.9) ui.drawKeyHint(ctx, Sc, t);
    } else if (g.phase === 'end') {
      const e = rosterEntry(g, g.win);
      ui.drawEnd(ctx, Sc, { id: g.win, name: nameOf(g, g.win), bot: Boolean(e && e.bot), me: g.win === meId, color: COLORS[(e ? e.c : 0) % COLORS.length], age });
    } else if (g.phase === 'board') {
      if (S.boardKey !== g.rid) {
        S.boardKey = g.rid;
        S.boardRows = boardData(g);
      }
      ui.drawBoard(ctx, Sc, { rows: S.boardRows, round: g.round, age });
    } else if (g.phase === 'final') {
      if (S.podiumKey !== g.mid) {
        S.podiumKey = g.mid;
        S.podium = podiumData(g);
        S.card = { top: S.podium.top };
      }
      ui.drawPodium(ctx, Sc, { top: S.podium.top, you: S.podium.you, awards: S.podium.awards, age });
      drawTopParticles(ctx, Sc);
    }
    // the point sounds of the scoreboard
    if (g.phase === 'board' && S.boardRows) {
      const k = Math.floor((age - 0.3) / 0.12);
      if (k !== S.lastPoint && k >= 0 && k < S.boardRows.length) audio.point();
      S.lastPoint = k;
    }
  }

  // ---------------------------------------------------------------- the loop
  let last = performance.now();
  let acc = 0;
  let sceneG = null;

  function frame(ts) {
    requestAnimationFrame(frame);
    try {
      const dt = clamp((ts - last) / 1000, 0, 0.1);
      last = ts;
      Sc.time = ts / 1000;
      if (tickable) tickable.tick();
      // Opened on its own there is no Ready strip: get ready by itself so the whole game can be seen.
      if (offline && S.started && room.match.phase === 'lobby') {
        if (S.lobbySince < 0) S.lobbySince = Sc.time;
        else if (Sc.time - S.lobbySince > 2.5 && !room.me.ready) room.setReady(true);
      } else S.lobbySince = -1;
      input.poll();
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 6) {
        acc -= STEP;
        steps++;
        if (room.running || S.scene === 'lobby') {
          if (S.freeze > 0) S.freeze -= STEP;
          else stepMe(sceneG);
          if (S.demo && !sceneG) {
            S.demoT += STEP * 1000;
            S.demo.step(STEP, S.demoT);
          }
          net.hostFrame(STEP);
        }
      }
      if (steps === 6) acc = 0;
      sceneG = updateScene(dt);
      layout(dt);
      setControls(sceneG);
      setMusic(sceneG);
      publish(sceneG);
      drawWorld(ctx, Sc);
      drawScreens(sceneG);
    } catch (err) {
      S.errors++;
      console.error(err);
      if (S.errors <= 3) setTimeout(() => { throw err; });
    }
  }

  // ---------------------------------------------------------------- starting, tapping, the match's life
  function pressPlay() {
    if (S.started) return;
    S.started = true;
    audio.unlock();
    audio.click();
    input.useBoost();
    S.dirty = true;
    Sc.youUntil = Sc.time + 3;
    try {
      room.hideLobby(false);
    } catch {
      // nothing to hide outside the platform
    }
  }

  const inRect = (r, x, y) => Boolean(r) && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!S.started) {
      if (inRect(ui.rects.play, x, y) || room.match.phase !== 'lobby') pressPlay();
      return;
    }
    if (S.scene === 'lobby' && room.match.phase === 'lobby' && room.isHost) {
      for (const r of ui.rects.rounds) {
        if (inRect(r, x, y)) {
          audio.click();
          room.setSetting('rounds', r.v);
          break;
        }
      }
    }
  });

  // iPhones start sound only from the end of a tap, so ask again when the finger lifts
  for (const type of ['pointerup', 'touchend', 'click']) addEventListener(type, () => audio.unlock(), true);

  addEventListener('keydown', (e) => {
    audio.unlock();
    if (!S.started && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault();
      pressPlay();
    }
  });

  room.on('matchstart', () => {
    S.snaps.length = 0;
    S.lastBObj = null;
    S.rid = '';
    S.dirty = true;
    try {
      room.hideLobby(!S.started);
    } catch {
      // not on the platform
    }
    net.adopt();
  });
  room.on('starting', () => {
    S.count = -1;
  });
  room.on('matchend', (match, previous) => {
    try {
      room.hideLobby(!S.started);
    } catch {
      // not on the platform
    }
    if (!previous || previous.phase !== 'playing') return; // a countdown that was stopped: nothing to put away
    const g = S.lastG;
    if (g && g.phase === 'final') {
      S.card = { top: S.podium && S.podiumKey === g.mid ? S.podium.top : podiumData(g).top };
      S.cardAt = Sc.time;
    }
    S.lastG = null;
    S.rid = '';
    S.phaseKey = '';
    S.sceneKey = '';
    S.dirty = true;
    S.stage = 0;
    S.car.alive = true;
    Sc.youUntil = Sc.time + 3;
    Sc.partsOnTop = false;
    Sc.warn = false;
    net.reset();
    fx.clear();
  });
  room.on('host', () => net.adopt());
  room.on('reconnect', () => net.adopt());
  room.on('matchresume', () => net.adopt());

  setInterval(() => net.tick(), 100);
  try {
    room.hideLobby(true); // the title is up: no Ready strip yet
  } catch {
    // not on the platform
  }
  net.adopt();
  requestAnimationFrame(frame);
  // a seam for the node tests (they set this before loading the page); nothing in the game uses it
  if (typeof window.__bumperTest === 'function') window.__bumperTest({ S, Sc, net, room });
}

// Everything above is declared before the page starts: run() reads it at once.
if (posterName) await runPoster(posterName, canvas);
else await boot();

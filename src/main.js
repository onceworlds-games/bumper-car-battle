// Carnevale. Joins the room first (before anything heavy), then builds the plaza. The flow: the title (the platform's
// lobby hidden) -> the Rehearsal on your first evening -> the platform's lobby card over a living plaza -> the match
// (or watching it) -> back to the lobby. Poster mode (?poster=) draws store art with no platform at all.
import './ui/style.css';
import { ow, safe, JOIN, onPlatform, controls, touchMode, reducedMotion, onPlatformEvent } from './platform.js';
import { createStage } from './render/stage.js';
import { createInput } from './game/input.js';
import { createPlayer } from './game/player.js';
import { createRoundView } from './game/round.js';
import { createEvents } from './game/events.js';
import { createMatchUI } from './game/match.js';
import { createProgress, BANNERS } from './game/progress.js';
import { createRehearsal } from './game/rehearsal.js';
import { createSession } from './net/session.js';
import { createHost } from './net/host.js';
import { createHud } from './ui/hud.js';
import { createScreens } from './ui/screens.js';
import { createMap } from './ui/map.js';
import { audio } from './audio/engine.js';
import { createMusic } from './audio/music.js';
import { sfx, createAmbience } from './audio/sfx.js';
import { createCrowd } from './sim/crowd.js';
import { PLAZAS } from './sim/plazas.js';
import { drawFigures } from './game/view.js';
import { installTestHook } from './testhook.js';

const params = new URLSearchParams(location.search);
if (params.has('poster')) import('./poster.js').then((m) => m.runPoster(params.get('poster')));
else boot();

async function boot() {
  // Join as the page loads, so a reload never misses its seat.
  let roomP = Promise.resolve(safe(() => ow.rooms.join(JOIN), null, 'join'));
  // The join waits for the platform's handshake: let that happen before building the plaza holds the page for a
  // while, so a slow machine (or someone arriving mid-match) is not kept out of the room by it.
  const handshake = typeof ow.ready === 'function' ? safe(() => ow.ready(), null) : null;
  await Promise.race([Promise.resolve(handshake), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
  const canvas = document.getElementById('scene');
  const uiRoot = document.getElementById('ui');
  const labels = document.getElementById('labels');
  const stage = createStage(canvas);
  const input = createInput(canvas);
  const progress = createProgress();
  const music = createMusic();
  const ambience = createAmbience();
  const rehearsal = createRehearsal();
  const screens = createScreens(uiRoot);
  const map = createMap(uiRoot, { onClose: () => map.show(false) });
  const player = createPlayer();
  let matchUI = null;
  let rehearsalUI = null;
  const hud = createHud(uiRoot, labels, {
    onCard: () => {
      map.show(!map.open);
      sfx.ui();
    },
    onChip: (i) => verbs.ability(i),
    onHome: () => {
      player.fallIn();
      sfx.ui();
    },
  });
  if (reducedMotion()) document.body.classList.add('reduced');

  let room = null;
  let session = null;
  let host = null;
  let phase = 'title';
  let entered = false;
  let closedReason = '';
  let lastInfo = null;
  let ctrlKey = '';
  let manualAt = -99;
  let lastStep = 0;

  // The attract plaza (title and lobby): a crowd at golden hour, the camera drifting round.
  const attract = { plaza: PLAZAS[0], crowd: null };

  function makeMatch(sess) {
    const view = createRoundView();
    const events = createEvents({ stage, hud, session: sess, player, view, progress });
    const ui = createMatchUI({ stage, hud, screens, map, session: sess, player, view, events, progress, music });
    ui.view = view;
    return ui;
  }

  function setupRoom(r) {
    room = r;
    closedReason = '';
    if (!room) return;
    host = createHost(room, { onHeartbeat: (on) => matchUI?.heartbeat(on) });
    session = createSession(room, host, { onHeartbeat: (on) => matchUI?.heartbeat(on) });
    matchUI = makeMatch(session);
    safe(() => room.on('close', (reason) => onClosed(reason)));
    safe(() => room.on('matchstart', () => {
      if (rehearsal.active) stopRehearsal(false);
      if (entered) phase = 'match';
    }));
    safe(() => room.on('matchend', () => {
      host.reset();
      if (entered && phase !== 'rehearsal') toLobby();
    }));
    // A reload in the middle of a match you're playing: straight back in (one tap for the sound).
    const m = safe(() => room.match, null);
    const me = safe(() => room.me.id, '');
    if (m && m.phase === 'playing' && safe(() => room.isParticipant(me), false)) {
      entered = true;
      phase = 'match';
      screens.close();
      screens.tapToPlay(() => {
        unlockAudio();
        screens.close();
      });
    } else if (phase === 'title') safe(() => room.hideLobby(true));
    else if (entered && phase !== 'rehearsal') toLobby();
  }

  function onClosed(reason) {
    closedReason = reason || 'disconnected';
    if (reason === 'moved' || reason === 'left') return;
    phase = 'closed';
    controls(null);
    hud.show(false);
    const text = reason === 'kicked' ? 'You were removed' : reason === 'replaced' ? 'Playing in another tab' : 'Connection lost';
    const action = reason === 'kicked' ? 'Play' : reason === 'replaced' ? 'Play here' : 'Rejoin';
    screens.closed({
      text,
      action,
      onAction: () => {
        screens.close();
        phase = entered ? 'lobby' : 'title';
        roomP = Promise.resolve(safe(() => ow.rooms.join(JOIN), null, 'join'));
        roomP.then(setupRoom);
      },
    });
  }
  safe(() => ow.rooms.on('moved', (r) => setupRoom(r)));

  function unlockAudio() {
    if (audio.unlock()) {
      ambience.start();
      if (music.mode === 'off') music.set(phase === 'match' ? 'blend' : 'lobby');
    }
  }

  function toLobby() {
    phase = 'lobby';
    screens.close();
    hud.show(false);
    map.show(false);
    safe(() => room?.hideLobby(false));
    music.set('lobby');
    if (!onPlatform() && room) {
      // Opened on its own there is no platform lobby: a Play card of our own.
      setTimeout(() => {
        if (phase !== 'lobby') return;
        screens.closed({
          text: 'Carnevale',
          action: 'Play',
          onAction: () => {
            screens.close();
            safe(() => room.setReady(true));
          },
        });
      }, 400);
    }
  }

  function enter() {
    unlockAudio();
    sfx.confirm();
    entered = true;
    screens.close();
    const playing = safe(() => room?.match?.phase === 'playing', false);
    if (!progress.profile.rehearsed && !playing) startRehearsal();
    else if (playing) phase = 'match';
    else toLobby();
  }

  const skipBtn = document.createElement('button');
  skipBtn.className = 'btn ghost live';
  skipBtn.type = 'button';
  skipBtn.textContent = 'Skip';
  Object.assign(skipBtn.style, { position: 'fixed', right: 'calc(12px + var(--safe-r))', top: 'calc(112px + var(--safe-t))', display: 'none' });
  skipBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  skipBtn.addEventListener('click', () => stopRehearsal(true));
  uiRoot.appendChild(skipBtn);

  function startRehearsal() {
    phase = 'rehearsal';
    safe(() => room?.hideLobby(true));
    const sess = rehearsal.start();
    rehearsalUI = makeMatch(sess);
    hud.bark(rehearsal.first().say, 3600);
    if (rehearsal.first().hint) hud.hint(rehearsal.first().hint, 4000);
    music.set('blend');
    skipBtn.style.display = '';
  }
  function stopRehearsal(done) {
    rehearsal.stop();
    rehearsalUI = null;
    skipBtn.style.display = 'none';
    hud.show(false);
    hud.tags([]);
    screens.close();
    if (done) progress.rehearsed();
    if (safe(() => room?.match?.phase === 'playing', false)) phase = 'match';
    else toLobby();
  }

  // ---- verbs: keys, the touch buttons (they press keys) and the HUD chips ----
  const current = () => (phase === 'rehearsal' ? rehearsalUI : matchUI);
  const verbs = {
    unmask: () => current()?.unmask(lastInfo, performance.now()),
    greet: () => current()?.greet(lastInfo, performance.now()),
    ability: (i) => current()?.ability(lastInfo, i),
  };
  input.on('press', (k) => {
    unlockAudio();
    if (phase === 'title' && k === 'enter') return enter();
    if (k === 'tab' || k === 'm') {
      if (phase === 'match' || phase === 'rehearsal') {
        map.show(!map.open);
        sfx.ui();
      }
      return;
    }
    if (k === 'escape') return map.show(false);
    if (k === 'z') stage.camera.orbit(0.35, 0, performance.now() / 1000);
    if (k === 'x') stage.camera.orbit(-0.35, 0, performance.now() / 1000);
    if (phase !== 'match' && phase !== 'rehearsal') return;
    if (k === 'e') verbs.unmask();
    else if (k === 'g') verbs.greet();
    else if (k === '1') verbs.ability(0);
    else if (k === '2') verbs.ability(1);
    else if (k === 'v') player.abilityKey(true, performance.now() / 1000);
    else if (k === 'f') player.fallIn();
    else if (k === ' ') current()?.flourish(performance.now());
  });
  input.on('release', (k) => {
    if (k === 'v') {
      const slot = player.abilityKey(false, performance.now() / 1000);
      if (slot !== null) verbs.ability(slot);
    }
  });
  input.on('tap', (x, y, type) => {
    unlockAudio();
    if (map.open) return map.show(false);
    if (phase !== 'match' && phase !== 'rehearsal') return;
    const sess = phase === 'rehearsal' ? rehearsal.session : session;
    const ui = current();
    if (!sess || !ui?.view) return;
    const res = ui.view.tapWorld(stage, player, sess, x, y, type === 'touch' || type === 'pen');
    if (res === 'mark' || res === 'unmark') sfx.ui();
  });
  input.on('orbit', (dy, dp) => {
    manualAt = performance.now() / 1000;
    stage.camera.orbit(dy, dp, manualAt);
  });
  input.on('zoom', (f) => stage.camera.zoom(f));
  onPlatformEvent('pause', () => rehearsal.pause(true));
  onPlatformEvent('resume', () => rehearsal.pause(false));

  // ---- the title: the living plaza behind one button ----
  screens.title({ onEnter: enter });
  progress.load();
  roomP.then(setupRoom);
  installTestHook({
    get room() {
      return room;
    },
    get session() {
      return session;
    },
    get host() {
      return host;
    },
    get phase() {
      return phase;
    },
    get info() {
      return lastInfo;
    },
    get closed() {
      return closedReason;
    },
    player,
    enter,
    verbs,
    stage,
    screens,
    progress,
    rehearsal,
    stopRehearsal,
  });

  // ---- the frame ----
  let last = performance.now();
  function frame(nowMs) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
    last = nowMs;
    const now = nowMs / 1000;
    const touch = touchMode();
    if (touch !== document.body.classList.contains('touch')) document.body.classList.toggle('touch', touch);
    try {
      host?.tick();
    } catch (e) {
      console.warn('[carnevale] host', e?.message ?? e);
    }
    let u = 0.18;
    let clockU = 0.5;
    lastInfo = null;
    const manualOrbit = now - manualAt < 3;
    if (phase === 'rehearsal' && rehearsal.active) {
      const info = rehearsalUI.update({ now, dt, input, touch, reduced: reducedMotion(), spectate: false, manualOrbit });
      lastInfo = info;
      if (info) {
        const me = { x: player.mv.x, z: player.mv.z, h: player.mv.h, f: player.flags(), locked: player.mv.locked };
        const step = rehearsal.update(dt, me, info.slot, {
          say: (s) => {
            hud.bark(s.say, 3800);
            const h = touch && s.touchHint ? s.touchHint : s.hint;
            if (h) hud.hint(h, 6000);
            sfx.clue();
          },
          mark: (ref) => {
            if (rehearsal.step >= 5) player.st.mark = ref;
          },
        });
        if (!step) stopRehearsal(true);
        u = 0.3;
      }
    } else if (phase === 'match' && session?.round) {
      const me = session.me;
      const spectate = safe(() => room.spectating, false) && !session.round.m[me];
      const info = matchUI.update({ now, dt, input, touch, reduced: reducedMotion(), spectate, manualOrbit });
      lastInfo = info;
      if (info) {
        u = Math.max(0, Math.min(1, info.t / info.r.timing.hushStart));
        clockU = u;
        if (info.st === 'reveal' || info.st === 'results' || info.st === 'over') u = 1;
      }
    } else {
      hud.show(false);
      hud.tags([]);
      stage.setPlaza(attract.plaza);
      if (!attract.crowd) attract.crowd = createCrowd(attract.plaza, 4242, 9);
      const crowd = attract.crowd;
      const buf = crowd.eval(now + 30, Infinity);
      const cam = stage.camera;
      if (!manualOrbit) cam.st.yaw += dt * 0.04;
      cam.st.pitch = 0.36;
      cam.st.dist = 18;
      cam.st.opera = 0;
      cam.update(dt, -6, 0, 2, attract.plaza, { now });
      drawFigures(stage, { time: now, crowd, buf, skip: null, plaza: attract.plaza, cam: { x: cam.cam.position.x, z: cam.cam.position.z, fx: cam.st.tx, fz: cam.st.tz } });
      stage.fx.rings([]);
      stage.fx.lanterns([]);
      stage.fx.fireworksOff();
      u = 0.22;
      clockU = (now / 900) % 1;
    }
    // Touch controls only while you play.
    const sess = phase === 'rehearsal' ? rehearsal.session : session;
    const r = sess?.round;
    const myId = phase === 'rehearsal' ? 'you' : session?.me;
    const rs = r && myId ? sess.status[myId] : null;
    const tNow = lastInfo?.t ?? 0;
    const canPlay = (phase === 'match' || phase === 'rehearsal') && !!lastInfo?.me && !(rs && rs.out > tNow) && !['results', 'reveal', 'over', 'assign'].includes(lastInfo?.st) && screens.kind !== 'final' && screens.kind !== 'tap';
    const key = canPlay ? 'play' : 'none';
    if (key !== ctrlKey) {
      ctrlKey = key;
      controls(canPlay ? { stick: 'wasd', buttons: [{ id: 'unmask', label: 'Unmask', key: 'e' }, { id: 'greet', label: 'Greet', key: 'g' }, { id: 'sprint', label: 'Sprint', key: 'Shift' }, { id: 'trick', label: 'Trick', key: 'v' }] } : null);
      input.held.delete('shift');
    }
    if (canPlay) {
      const fired = player.abilityHold(now);
      if (fired !== null) verbs.ability(fired);
    }
    // My presence: where I am and what I'm doing.
    if (session && room) {
      const mr = session.round;
      const mineM = mr?.m[session.me];
      let pres;
      if (phase === 'title') pres = { s: 't' };
      else if (phase === 'rehearsal') pres = { s: 'r' };
      else if (mr && mineM && lastInfo?.me) {
        const myRs = session.status[session.me];
        const out = myRs && myRs.out > tNow;
        const e = player.emoteNow(now);
        const at = safe(() => room.matchNow(), 0);
        pres = out ? { s: 'k', r: mr.rid } : { s: 'p', r: mr.rid, x: player.mv.x, z: player.mv.z, h: player.mv.h, f: player.flags(), tr: mineM.tr, sl: mineM.sl, w: player.st.answer ?? undefined, e: e ? [e[0], at - e[1] * 1000] : undefined };
      } else pres = { s: 'w', r: mr?.rid ?? '' };
      pres.bn = Math.max(0, BANNERS.findIndex((b) => b.id === progress.profile.banner));
      session.presence(pres, nowMs);
    }
    // Footsteps under you, and the murmur of the crowd.
    if (lastInfo?.me && player.mv.speed > 0.4 && !player.mv.locked) {
      const cadence = player.st.sprinting ? 0.19 : 0.31;
      if (now - lastStep > cadence) {
        lastStep = now;
        sfx.step(player.st.sprinting);
      }
    }
    ambience.set(lastInfo?.st === 'hush' ? 0.1 : 0.55, lastInfo?.r && lastInfo.r.plaza !== 2 ? 0.5 : 0);
    stage.render(now, u, clockU);
    stage.R.frame(dt * 1000, nowMs);
  }
  requestAnimationFrame(frame);
}

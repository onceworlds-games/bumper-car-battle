// ?test: exposes the game's state for smoke tests (window.__cv), and ?test=auto drives the game through its own
// public paths (Enter, Ready, walking, greeting, unmasking) the way a player would. Off unless asked for.
import { stage as stageOf } from './sim/rules.js';
import { audio } from './audio/engine.js';
import { sfx, createAmbience } from './audio/sfx.js';
import { createMusic } from './audio/music.js';

export function installTestHook(g) {
  const params = new URLSearchParams(location.search);
  if (!params.has('test')) return;
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message || e.reason)));
  window.__cv = {
    errors,
    state() {
      const s = g.session;
      const r = s?.round;
      const t = s ? s.time() : 0;
      return {
        phase: g.phase,
        closed: g.closed,
        match: g.room?.match?.phase ?? null,
        rid: r?.rid ?? null,
        stage: r ? stageOf({ r, endAt: r.endAt < 0 ? Infinity : r.endAt, timing: r.timing }, t) : null,
        t: Math.round(t * 10) / 10,
        isHost: !!g.room?.isHost,
        me: s?.me ?? null,
        inRound: !!(r && s && r.m[s.me]),
        maskers: r ? Object.keys(r.m).length : 0,
        poise: r && s ? s.status[s.me]?.p ?? null : null,
        scores: s ? Object.fromEntries(Object.entries(s.scores).map(([k, v]) => [k, v.pts])) : {},
        events: s ? s.events.length : 0,
        pos: { x: Math.round(g.player.mv.x * 10) / 10, z: Math.round(g.player.mv.z * 10) / 10, locked: g.player.mv.locked },
        level: g.progress.level,
        quality: g.stage.R.level,
      };
    },
    /** Draws n frames back to back, waiting for the GPU each time: milliseconds per frame (for the tiers' costs). */
    bench(n = 120) {
      const gl = g.stage.R.renderer.getContext();
      const px = new Uint8Array(4);
      const out = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        g.stage.render(performance.now() / 1000 + i / 60, 0.4, 0.4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // a read waits for the GPU to finish the frame
        out.push(performance.now() - t0);
      }
      out.sort((a, b) => a - b);
      const info = g.stage.R.renderer.info;
      return { avg: out.reduce((a, b) => a + b, 0) / n, p50: out[n >> 1], p95: out[Math.floor(n * 0.95)], calls: info.render.calls, tris: info.render.triangles, level: g.stage.R.level, size: [g.stage.R.size.w, g.stage.R.size.h, g.stage.R.size.pr] };
    },
    enter: () => g.enter(),
    skipRehearsal: () => g.rehearsal.active && g.stopRehearsal(true),
    ready: () => g.room?.setReady(true),
    verbs: g.verbs,
    screens: g.screens,
    audioKit: { audio, sfx, createAmbience, createMusic },
  };
  if (params.get('test') !== 'auto') return;
  // The autopilot: in, ready, then wander between troupes, greet, and unmask what's in reach now and then.
  let step = 0;
  setInterval(() => {
    try {
      step++;
      if (g.phase === 'title') g.enter();
      if (g.phase === 'rehearsal') g.stopRehearsal(true);
      const room = g.room;
      if (!room) return;
      if (room.match?.phase === 'lobby' && !room.me?.ready) room.setReady?.(true);
      const info = g.info;
      if (!info?.me) return;
      const keys = ['w', 'a', 's', 'd'];
      if (step % 9 === 0) {
        const k = keys[Math.floor(Math.random() * 4)];
        window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
        setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: k })), 900 + Math.random() * 1500);
      }
      if (step % 13 === 0) g.verbs.greet();
      if (step % 23 === 0 && (info.st === 'hunt' || info.st === 'hush')) g.verbs.unmask();
      if (step % 41 === 0) g.verbs.ability(step % 2);
    } catch (e) {
      errors.push(`autopilot: ${e?.message ?? e}`);
    }
  }, 250);
}

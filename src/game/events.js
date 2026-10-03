// Events from the host, turned into theatre: confetti, a mask flying off and the face beneath, a reveller's gasp,
// heads turning to a greeting or a lantern, smoke, puffs, prompts aimed at you, score pops and the Master of
// Ceremonies, who has something to say about most of it.
import * as THREE from 'three';
import { TROUPES, ABILITIES } from '../sim/const.js';
import { EM } from '../sim/choreo.js';
import { floorY, PLAZAS } from '../sim/plazas.js';
import { sfx, near } from '../audio/sfx.js';
import { avatarUrl } from '../platform.js';
import { makeCanvas, drawBust } from '../ui/icons.js';
import { unit } from '../sim/rng.js';
import { BURSTS } from './progress.js';

const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const BARKS = {
  blend: ['Find your place, darling.', 'Masks on, dears.', 'Do try to blend.'],
  hunt: ['The hunt is open.', 'Fans at the ready.', 'Hunt, dears. Discreetly.'],
  spot: ['Impostors among us, darling.', 'Someone here is no reveller.'],
  mine: ['Splendid.', 'Exquisite.', 'Bravissimo!', 'How deliciously rude.'],
  caught: ['Caught! Off you go.', 'Unmasked, darling.', 'Do freshen up.'],
  faux: ['Mortifying.', 'Wrong face, dear.', 'Oh dear. Oh dear.'],
  close: ['Close, darling.', 'That was nearly you.'],
  wrong: ['A masker. Not yours.'],
  tried: ['Someone tried you. Bold.'],
  fluster: ['Compose yourself.', 'Breathe, darling.'],
  hush: ['Midnight, dears. Do hold still.'],
  minute: ['One minute to midnight.'],
  duel: ['Just the two of you now.'],
  found: ['One impostor fewer.', 'Caught red-handed.'],
  solved: ['Case closed. Brava.'],
};

export function createEvents({ stage, hud, session, player, view, progress }) {
  let rid = '';
  let lastQ = 0;
  let seeded = false;
  const attention = [];
  const faces = new Map();
  let prompt = null;
  const answeredG = new Set();

  function faceTexture(id, r) {
    if (faces.has(id)) return faces.get(id);
    const [c, g] = makeCanvas(96);
    const m = r.m[id];
    drawBust(g, m ? m.tr : 0, 0, 0, 96, { off: true });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    faces.set(id, tex);
    if (m && !m.b) {
      // The player's own avatar's face, where the platform has one.
      Promise.resolve(avatarUrl(id))
        .then((url) => {
          if (!url) return;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              g.setTransform(1, 0, 0, 1, 0, 0);
              g.clearRect(0, 0, c.width, c.height);
              g.save();
              g.beginPath();
              g.arc(c.width / 2, c.height / 2, c.width / 2 - 2, 0, Math.PI * 2);
              g.clip();
              g.fillStyle = '#f1e3c8';
              g.fillRect(0, 0, c.width, c.height);
              g.drawImage(img, 0, 0, c.width, c.height);
              g.restore();
              tex.needsUpdate = true;
            } catch {}
          };
          img.src = url;
        })
        .catch(() => {});
    }
    return tex;
  }

  const ev = {
    attention,
    get prompt() {
      return prompt;
    },
    /** Processes new events. me: my masker id; pos: where I am. */
    update(r, t, events, pos) {
      if (r.rid !== rid) {
        rid = r.rid;
        lastQ = 0;
        seeded = false;
        attention.length = 0;
        prompt = null;
        answeredG.clear();
        view.answers.clear();
      }
      const plaza = PLAZAS[r.plaza];
      const me = session.me;
      for (const e of events) {
        if (e.q <= lastQ) continue;
        lastQ = Math.max(lastQ, e.q);
        // A page that has just opened doesn't replay what already happened.
        if (!seeded && t - e.t > 2.5) continue;
        handle(e, r, t, me, pos, plaza);
      }
      seeded = true;
      // Prune old attention.
      for (let i = attention.length - 1; i >= 0; i--) {
        const a = attention[i];
        a.age = t - a.t;
        if (a.age > a.dur + 0.5) attention.splice(i, 1);
      }
      if (attention.length > 40) attention.splice(0, attention.length - 40);
      // A prompt runs out: a stiff, silent figure.
      if (prompt && t - prompt.shown > 1.6) {
        session.request({ t: 'an', g: prompt.g, d: -1 });
        prompt = null;
      }
    },
    /** G pressed: answer the greeting or the lantern, if one is waiting. Returns true if it did. */
    answer(t, nowMs) {
      if (!prompt) return false;
      const d = t - prompt.shown;
      session.request({ t: 'an', g: prompt.g, d });
      player.st.answer = [prompt.g, d < 0.4 ? 'eager' : d > 1.4 ? 'stiff' : 'ok', nowMs];
      view.answers.set(session.me, { v: d < 0.4 ? 'eager' : d > 1.4 ? 'stiff' : 'ok', t });
      sfx.wave(1);
      prompt = null;
      return true;
    },
  };

  function addAtt(a) {
    attention.push({ age: 0, ...a });
  }

  function handle(e, r, t, me, pos, plaza) {
    const d = pos ? Math.hypot(e.x - pos.x, e.z - pos.z) : 10;
    const vol = near(d);
    const y = floorY(plaza, e.x, e.z);
    const nameOf = (id) => r.m[id]?.nm ?? 'Someone';
    switch (e.k) {
      case 'unmask': {
        const victim = r.m[e.b];
        const burst = e.a === me ? BURSTS.find((b) => b.id === progress.profile.burst) ?? BURSTS[0] : BURSTS[0];
        stage.fx.confetti(e.x, y + 1.6, e.z, burst.palette);
        if (victim) stage.fx.dropMask(e.x, y + 1.5, e.z, Math.random() * 6.28, TROUPES[victim.tr].mask);
        stage.fx.face(e.x, y + 1.62, e.z, faceTexture(e.b, r), 3);
        addAtt({ x: e.x, z: e.z, r: 6, tx: e.x, tz: e.z, t: e.t, dur: 2.5, up: 0.1 });
        sfx.flick(vol);
        sfx.unmask(vol, e.a === me);
        if (d < 8) stage.camera.st.shake = Math.max(stage.camera.st.shake, e.a === me ? 1 : 0.4);
        if (e.a === me) {
          hud.pop(`+${e.pts}${e.hush ? ' Hush!' : ''}${e.clean ? ' Clean' : ''}`, true);
          hud.bark(r.mode === 'spot' ? pick(BARKS.found) : pick(BARKS.mine));
          progress.badge('first-unmask');
          if (e.hush) progress.badge('hush-hero');
          sfx.points(true);
        } else if (e.b === me) {
          hud.bark(pick(BARKS.caught));
          hud.pop(`Unmasked by ${nameOf(e.a)}`, false);
        }
        break;
      }
      case 'faux': {
        if (e.n >= 0) {
          addAtt({ slot: e.n, em: EM.gasp, t: e.t, dur: 2.2 });
          addAtt({ x: e.x, z: e.z, r: 3.5, tx: e.x, tz: e.z, t: e.t + 0.2, dur: 2 });
        }
        if (e.d) stage.fx.puff(e.x, y, e.z, 0xf1e3c8, 18);
        sfx.flick(vol);
        sfx.faux(vol, e.a === me);
        if (e.a === me) {
          hud.pop(`Faux pas ${e.d ? '(a decoy!) ' : ''}-15`, false);
          hud.bark(pick(BARKS.faux));
          progress.badge('faux-pas');
        }
        if (e.close === me) {
          hud.pop('Close call +15', true);
          hud.bark(pick(BARKS.close));
          progress.badge('close-call');
        }
        if (e.bait === me) {
          hud.pop('Your decoy fooled them +15', true);
          progress.badge('bait');
        }
        break;
      }
      case 'wrong':
        sfx.flick(vol);
        sfx.faux(vol * 0.6, false);
        if (e.a === me) {
          hud.pop('Wrong masker -10', false);
          hud.bark(pick(BARKS.wrong));
        } else if (e.b === me) {
          hud.pop('Someone tried you +10', true);
          hud.bark(pick(BARKS.tried));
        }
        break;
      case 'greet': {
        // Heads turn to whoever waves out of turn; the greeted reveller waves back after its own beat.
        addAtt({ x: e.x, z: e.z, r: 4, tx: e.x, tz: e.z, t: e.t, dur: 1.5 });
        if (e.n >= 0) addAtt({ slot: e.n, em: EM.wave, t: e.t + e.reply + 0.3, dur: 1.4 });
        sfx.wave(vol * 0.7);
        if (e.b === me && !answeredG.has(e.q)) {
          answeredG.add(e.q);
          prompt = { g: e.q, kind: 'wave', shown: t };
          sfx.prompt();
          if (progress.hint('wave', 4)) hud.hint('Wave back: G');
        }
        break;
      }
      case 'answer':
        if (e.a !== me) view.answers.set(e.a, { v: e.v, t: e.t });
        break;
      case 'smoke':
        stage.fx.smoke(e.x, e.z, ABILITIES.smoke.radius);
        sfx.smoke(vol);
        break;
      case 'decoy':
        stage.fx.puff(e.x, y, e.z, 0xf1e3c8, 16);
        sfx.pop(vol);
        break;
      case 'lantern': {
        sfx.lantern(vol);
        const f = session.fx.find((x) => x.k === 'lantern' && Math.abs(x.t - e.t) < 0.05);
        if (f) {
          addAtt({ x: f.x, z: f.z, r: ABILITIES.lantern.radius, tx: f.x, tz: f.z, t: e.t + 0.6, dur: 3, up: -0.15 });
          if (pos && e.a !== me && Math.hypot(f.x - pos.x, f.z - pos.z) < ABILITIES.lantern.radius && !answeredG.has(e.q)) {
            answeredG.add(e.q);
            prompt = { g: e.q, kind: 'look', shown: t + 0.6 };
            sfx.prompt();
          }
        }
        break;
      }
      case 'swap': {
        const f = session.fx.find((x) => x.k === 'swap' && Math.abs(x.t - e.t) < 0.05);
        stage.fx.puff(e.x, y, e.z, 0xe8e1d6, 14);
        if (f) stage.fx.puff(f.nx, floorY(plaza, f.nx, f.nz), f.nz, 0xe8e1d6, 14);
        sfx.swish(vol);
        break;
      }
      case 'fluster':
        if (e.a === me) {
          sfx.fluster();
          hud.bark(pick(BARKS.fluster));
          if (progress.hint('fluster', 3)) hud.hint('Out of poise: no unmasking');
        }
        break;
      case 'back':
        if (e.a === me) hud.banner('Back to the ball', `now a ${TROUPES[r.m[me]?.tr ?? 0].name}`);
        break;
      case 'audience':
        if (e.a === me) hud.banner('Audience', 'You play next round', 3000);
        break;
      case 'solved':
        hud.banner('Case closed', `+${e.bonus} for speed`, 2600);
        hud.bark(pick(BARKS.solved));
        sfx.fanfare();
        break;
      case 'end':
        sfx.reveal();
        break;
      default:
        break;
    }
  }

  /** Each reveller turns a beat apart from its neighbour. */
  ev.delay = (s) => 0.05 + unit('turn', s) * 0.35;
  return ev;
}

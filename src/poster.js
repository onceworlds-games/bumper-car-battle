// Poster mode (?poster=thumb1|thumb2|thumb3|thumb4|icon|badge-<id>): the game's own renderer drawing a composed,
// deterministic scene for the store at the high quality tier, with no platform and no network. It sets
// window.__posterReady when the frame is final. scripts/store.mjs captures these.
import * as THREE from 'three';
import './ui/style.css';
import { createStage } from './render/stage.js';
import { createCrowd } from './sim/crowd.js';
import { PLAZAS, floorY } from './sim/plazas.js';
import { drawFigures } from './game/view.js';
import { EM } from './sim/choreo.js';
import { TROUPES } from './sim/const.js';
import { drawBadge } from './ui/badgeart.js';
import { makeCanvas, drawFace } from './ui/icons.js';

const SCENES = {
  // The cover: the plaza at dusk, every troupe at its business, and one figure walking where no reveller would.
  thumb1: { plaza: 0, seed: 23, n: 9, t: 80, u: 0.42, eye: [6.5, 4.6, 10.5], at: [-3.5, 1.6, 0], fov: 54, title: true, odd: { tr: 5, x: 0.9, z: 4.2, h: 0.35 } },
  // The unmask: a fan snaps, a mask flies, confetti.
  thumb2: { plaza: 0, seed: 9, n: 9, t: 33, u: 0.68, eye: [-3.2, 1.7, 5.3], at: [-0.4, 1.5, 2.35], fov: 40, unmask: true },
  // The Hush: midnight, fireworks over a crowd that has stopped to look up.
  thumb3: { plaza: 0, seed: 23, n: 9, t: 71, u: 1, hush: true, eye: [-1.5, 2.1, 12.5], at: [-7, 8.2, -10], fov: 60, shells: [[-14, 24, -16], [1, 22, -15], [-7, 31, -26], [9, 19, -9], [-23, 21, -6], [-4, 27, -9]] },
  // The Quay at sunset: the lagoon, the columns, gondolas, troupes on the waterfront.
  thumb4: { plaza: 2, seed: 31, n: 9, t: 95, u: 0.5, eye: [5.6, 3.3, 14.2], at: [-0.5, 2.5, -10], fov: 56 },
};

/** For composing: ?eye=x,y,z&at=x,y,z&fov=..&t=..&u=..&seed=.. override a scene's numbers. */
function overrides(sc) {
  const q = new URLSearchParams(location.search);
  const v3 = (k) => (q.has(k) ? q.get(k).split(',').map(Number) : null);
  const out = { ...sc };
  if (v3('eye')) out.eye = v3('eye');
  if (v3('at')) out.at = v3('at');
  for (const k of ['fov', 't', 'u', 'seed', 'fw']) if (q.has(k)) out[k] = Number(q.get(k));
  return out;
}

export function runPoster(kind) {
  if (kind?.startsWith('badge-')) return badge(kind.slice(6));
  if (kind === 'icon') return icon();
  const sc = overrides(SCENES[kind] ?? SCENES.thumb1);
  const canvas = document.getElementById('scene');
  const stage = createStage(canvas);
  const plaza = PLAZAS[sc.plaza];
  stage.setPlaza(plaza);
  const crowd = createCrowd(plaza, sc.seed, sc.n);
  const cam = stage.camera.cam;
  const hushAt = sc.hush ? sc.t - 3 : Infinity;
  const attention = [];
  const maskers = [];
  if (sc.odd) {
    // The one out of step: a reveller's costume walking alone across open stones.
    maskers.push({ tr: sc.odd.tr, x: sc.odd.x, z: sc.odd.z, h: sc.odd.h, em: 0, et: 0, sp: 1.7, phase: 3 });
  }
  if (sc.unmask) {
    maskers.push({ tr: 6, x: 0.4, z: 3.1, h: Math.atan2(-1.6, -1.5), em: EM.flick, et: 0.32, sp: 0, phase: 1 });
    maskers.push({ tr: 4, x: -1.2, z: 1.6, h: Math.atan2(1.6, 1.5), em: EM.gasp, et: 0.3, sp: 0, phase: 2, off: true });
  }
  let frames = 0;
  const start = 0;
  let face = null;
  const loop = () => {
    const time = start + frames / 60;
    const buf = crowd.eval(sc.t + (sc.hush ? 0 : time * 0.2), hushAt);
    cam.position.set(...sc.eye);
    cam.lookAt(new THREE.Vector3(...sc.at));
    cam.fov = sc.fov;
    cam.aspect = stage.R.size.w / stage.R.size.h;
    cam.updateProjectionMatrix();
    if (sc.unmask) {
      // Heads turn to the commotion.
      if (!attention.length) attention.push({ x: -1.2, z: 1.6, r: 6, tx: -1.2, tz: 1.6, t: 0, dur: 99, age: 2, up: 0.1 });
    }
    drawFigures(stage, { time: 3 + time, crowd, buf, skip: skipFor(crowd, maskers), plaza, maskers, attention, cam: null, turnDelay: () => 0 });
    if (sc.unmask && frames === 14) {
      stage.fx.confetti(-1.2, floorY(plaza, -1.2, 1.6) + 1.7, 1.6, [0xf2b544, 0xb3263a, 0x1f7a80, 0xf1e3c8, 0xe58c8a], 120);
      stage.fx.dropMask(-1.2, 1.62, 1.6, -0.9, TROUPES[4].mask);
      face = paintedFace(4);
      stage.fx.face(-1.2, 1.67, 1.6, face, 99);
    }
    if (sc.odd && frames === 1) stage.fx.rings([{ x: sc.odd.x, y: 0, z: sc.odd.z, r: 0.62, hex: 0xf1e3c8, a: 0.55 }]);
    if (sc.hush) {
      if (frames === 0) {
        const b = plaza.bounds;
        stage.fx.setFireworks(sc.seed, hushAt, 30, { x: (b.x0 + b.x1) / 2 - 6, z: -6 }, 16, hushAt + 9.2, sc.shells);
      }
      stage.fx.fireworksTime(hushAt + 9.2);
    }
    stage.render(time, sc.u, sc.u);
    frames++;
    if (frames === (sc.unmask ? 25 : 8)) {
      if (sc.title) title();
      requestAnimationFrame(() => requestAnimationFrame(() => (window.__posterReady = true)));
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function skipFor(crowd, maskers) {
  // Maskers here stand where no reveller is, so nothing needs hiding.
  void crowd;
  void maskers;
  return null;
}

function paintedFace(seed) {
  const [c, g] = makeCanvas(96);
  drawFace(g, 96, seed);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function title() {
  const h = document.createElement('div');
  h.textContent = 'Carnevale';
  Object.assign(h.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    top: '5%',
    textAlign: 'center',
    font: 'italic 700 104px/1 "Bodoni Moda", Georgia, serif',
    color: '#f1e3c8',
    textShadow: '0 5px 0 rgba(26,20,20,0.55), 0 0 40px rgba(26,20,20,0.6)',
  });
  document.body.appendChild(h);
}

/** The icon: the Medico's beak on terracotta. */
function icon() {
  const canvas = document.getElementById('scene');
  const stage = createStage(canvas);
  stage.scene.background = new THREE.Color(0xc8553d);
  stage.scene.fog = null;
  stage.sky.dome.visible = false;
  const cam = stage.camera.cam;
  const pose = { bend: 0.08, yaw: -0.25, pitch: 0.05, bob: 0, roll: 0, squash: 0, lp: 0, lr: 0.12, rp: 0, rr: 0.12, fan: 0 };
  let frames = 0;
  const loop = () => {
    stage.figures.begin();
    stage.figures.add(0, 0, 0, 0, 0.75, pose, { fade: 1, shimmer: 0, slip: 0 });
    stage.figures.end(1);
    cam.position.set(1.05, 1.78, 1.25);
    cam.lookAt(new THREE.Vector3(0.12, 1.66, 0.05));
    cam.fov = 38;
    cam.aspect = 1;
    cam.updateProjectionMatrix();
    stage.sky.set(0.2, 1);
    stage.sky.hemi.intensity = 1.6;
    stage.sky.sun.intensity = 2.4;
    stage.sky.sun.position.set(40, 60, 70);
    stage.R.renderer.render(stage.scene, cam);
    if (++frames === 6) window.__posterReady = true;
    else requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function badge(id) {
  document.body.style.background = 'transparent';
  document.documentElement.style.background = 'transparent';
  document.getElementById('scene').style.display = 'none';
  const [c, g] = makeCanvas(256);
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0' });
  document.body.appendChild(c);
  const draw = () => {
    drawBadge(g, id, 256);
    window.__posterReady = true;
  };
  // The medallion's numeral uses the display face: wait for it.
  (document.fonts?.load ? document.fonts.load('italic 700 112px "Bodoni Moda"').catch(() => {}) : Promise.resolve()).then(draw);
}

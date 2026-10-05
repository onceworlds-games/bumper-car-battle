// Store art. Opened with ?poster=<name>, the game skips the room and the SDK and draws one staged, frozen frame with the real
// renderer, then sets document.body.dataset.ready = '1'. cover and action are 1280x720, win is 1280x720, icon 512x512 and
// badge-<id> 256x256. The same seed gives the same picture every time.

import { drawWorld, makeBubbles, makeCarView, makeDucks, makeWaves } from './draw.js';
import { createFx } from './fx.js';
import { DARK, TAU, circle, shade, text } from './gfx.js';
import { iconCar, iconCrown, iconGlove, iconIsland } from './icons.js';
import { mulberry32 } from './rng.js';
import { COLORS } from './rules.js';
import { drawLogo } from './ui.js';

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

function car(id, c, x, y, a, set = {}) {
  return makeCarView(id, { kind: id.startsWith('bot') ? 'bot' : 'human', c, name: '', set: { x, y, a, ...set } });
}

function scene(w, h, o) {
  const fx = createFx();
  fx.rand = mulberry32(o.seed ?? 11);
  return {
    w,
    h,
    pr: 1,
    cx: o.cx,
    cy: o.cy,
    scale: o.scale,
    shx: 0,
    shy: 0,
    time: o.time ?? 3.7,
    R: o.R ?? 11,
    warn: false,
    warnTo: 0,
    cars: o.cars ?? [],
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
}

function cover(ctx) {
  const Sc = scene(1280, 720, { cx: 640, cy: 416, scale: 27 });
  const big = { size: 1.3 };
  const c = (id, ci, x, y, a, set) => car(id, ci, x, y, a, { ...big, ...set });
  // the one that boosts, the one it hits, a crowd, and one flying off the edge into the water
  const boost = c('bot1', 0, -1.75, 1.7, 0.05, { heavy: 0.3, vx: 9, vy: 0.4 });
  const hit = c('p2', 6, 0.5, 1.7, Math.PI + 0.2, { sq: 0.9, sqa: 0.1, vx: 2, vy: 0 });
  const flying = c('bot3', 4, 11.9, -1.8, 0.5, { out: true, fall: { t: 0.2 }, vx: 9, vy: -1 });
  Sc.cars = [
    boost,
    hit,
    c('bot2', 2, 4.6, -4.4, 2.4),
    c('hero', 3, -5.2, -4.2, 0.9),
    c('bot4', 8, 3.8, 5.8, -2.2),
    c('p3', 1, -6.4, 4.6, 0.3),
    c('bot5', 9, -0.8, -6.6, 1.7),
    flying,
  ];
  const fx = Sc.fx;
  fx.sparks(-0.6, 1.7, 1, 0, 14);
  fx.sparks(-0.6, 1.7, 1, 0, 14);
  fx.bonk(-0.6, 0.8, 16, '');
  fx.splash(12.6, 1.4, 1.2);
  fx.puff(-4.2, 1.7, 5, '#ffd9a0', 1.5);
  fx.update(0.2);
  drawWorld(ctx, Sc);
  drawLogo(ctx, 640, 46, 50, 0, true);
}

function action(ctx) {
  const Sc = scene(1280, 720, { cx: -35, cy: 400, scale: 90, time: 2.2 });
  const a = car('p1', 0, 6.75, 0.1, 0, { heavy: 0.3, vx: 11, vy: 0, sq: 0.95, sqa: 0, flash: 0.5 });
  const b = car('bot2', 6, 8.25, 0, Math.PI, { vx: -3, vy: 0, sq: 0.95, sqa: Math.PI, flash: 0.4 });
  Sc.cars = [a, b, car('hero', 3, 2.4, -3.2, 1.1), car('bot4', 8, 3.0, 2.9, -1.3)];
  const fx = Sc.fx;
  for (let i = 0; i < 3; i++) fx.sparks(7.5, 0.05, 1, 0, 22);
  fx.bonk(7.5, -0.9, 20, '');
  fx.puff(7.5, 0.1, 6, '#ffffff', 3);
  fx.splash(13.2, -2.6, 1.5);
  fx.update(0.12);
  drawWorld(ctx, Sc);
}

function win(ctx) {
  const Sc = scene(1280, 720, { cx: 640, cy: 392, scale: 62, R: 4.5, time: 4.1 });
  const winner = car('hero', 2, 0, 0.2, 0.7, { vx: 0, vy: 0, size: 1.6 });
  const swimmers = [
    ['bot1', 0, -8.2, -3.6],
    ['bot2', 6, 8.6, -2.6],
    ['p2', 8, -9.4, 3.0],
    ['bot3', 4, 9.2, 3.4],
    ['p3', 9, -6.0, 3.9],
    ['bot4', 1, 4.6, -5.0],
  ].map(([id, ci, x, y]) => car(id, ci, x, y, 0, { out: true, ghost: true, size: 1.25 }));
  Sc.cars = [...swimmers, winner];
  const fx = Sc.fx;
  fx.confetti(0, -4, 70, 11, 12);
  fx.confetti(-6, -3, 40, 8, 10);
  fx.confetti(6, -3, 40, 8, 10);
  fx.update(0.7);
  drawWorld(ctx, Sc);
  // a crown over the winner and a big 1
  iconCrown(ctx, 640, 392 - 112, 44);
  const bx = 1120;
  const by = 120;
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const r = i % 2 ? 66 : 92;
    const ang = (Math.PI * i) / 12;
    if (i === 0) ctx.moveTo(bx + Math.cos(ang) * r, by + Math.sin(ang) * r);
    else ctx.lineTo(bx + Math.cos(ang) * r, by + Math.sin(ang) * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffd21f';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = DARK;
  ctx.stroke();
  text(ctx, '1', bx, by + 4, 96, { fill: '#ffffff', lw: 14 });
}

function icon(ctx) {
  // one car, boosting up and to the right, over plain water
  const Sc = scene(512, 512, { cx: 320, cy: 225, scale: 130, time: 1.6, R: 1 });
  Sc.noRink = true;
  Sc.ducks = [];
  Sc.cars = [car('pilot', 0, 0, 0, -0.7, { heavy: 0.2, vx: 7, vy: -6 })];
  Sc.fx.puff(-1.0, 1.0, 6, '#ffd9a0', 1.2);
  Sc.fx.update(0.1);
  drawWorld(ctx, Sc);
}

function badge(ctx, name) {
  const colors = { 'badge-first-win': '#ffb81f', 'badge-knockout-king': '#ff4b4b', 'badge-last-second': '#2fb7f4', 'badge-road-trip': '#27c95a' };
  const col = colors[name];
  ctx.fillStyle = shade(col, -0.35);
  ctx.fillRect(0, 0, 256, 256);
  circle(ctx, 128, 134, 112);
  ctx.fillStyle = shade(col, -0.45);
  ctx.fill();
  circle(ctx, 128, 128, 112);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.strokeStyle = DARK;
  ctx.stroke();
  circle(ctx, 128, 128, 94);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  if (name === 'badge-first-win') iconCrown(ctx, 128, 132, 62);
  else if (name === 'badge-knockout-king') iconGlove(ctx, 128, 126, 64);
  else if (name === 'badge-last-second') {
    // a tiny island in a ring of water
    circle(ctx, 128, 140, 72);
    ctx.fillStyle = '#6fd6ff';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.stroke();
    iconIsland(ctx, 128, 122, 58);
  } else iconCar(ctx, 128, 128, 66, COLORS[0]);
  ctx.beginPath();
  ctx.arc(128, 128, 120, Math.PI * 0.95, Math.PI * 1.35);
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
  void TAU;
}

/** Waits for the Bungee font: the stylesheet has to arrive (it declares the faces), then the face itself. */
async function fontReady() {
  const fonts = document.fonts;
  if (!fonts) return;
  try {
    for (let i = 0; i < 60 && !(fonts.size > 0); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    await fonts.load('60px Bungee', 'BUMPER CAR BATTLE 1');
    await fonts.ready;
  } catch {
    // the fallback font still draws
  }
}

export async function runPoster(name, canvas) {
  const size = SIZES[name];
  const done = () => {
    document.body.dataset.ready = '1';
  };
  if (!size) {
    done();
    return;
  }
  const [w, h] = size;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  const ctx = canvas.getContext('2d');
  await fontReady();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (name === 'cover') cover(ctx);
  else if (name === 'action') action(ctx);
  else if (name === 'win') win(ctx);
  else if (name === 'icon') icon(ctx);
  else badge(ctx, name);
  done();
}

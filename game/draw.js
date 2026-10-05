// Drawing the world: the water, the rink, the cars, the ghosts and the particles, then the labels over them.
// Everything is a function of (ctx, scene), so the posters draw exactly what the game draws. Nothing here touches the page.
//
// scene (Sc): { w, h, pr, cx, cy, scale (px per world unit), shx, shy (camera shake, px), time (s), R (rink radius),
//   warn (the edge is about to fall), warnTo (the radius it leaves), cars: [car views], fx, q (0.4..1), reduced,
//   waves, ducks, bubbles, youUntil (s), rimPop (s since the edge last fell), noRink (posters: just water) }
// car view (v): { id, name, bot, color, x, y, a, vx, vy, heavy, me, cd (0..1, 1 ready), out, fall: {t} | null, ghost (draw the
//   swimmer), sq, sqa, pop, flash, ready, readyPop, phase, tag, size (posters draw cars bigger) }

import { drawHead } from './avatars.js';
import { DARK, TAU, circle, clamp, drawCheck, easeOutBack, easeOutCubic, fit, shade, starPath, text } from './gfx.js';
import { DEBRIS, DOT, DROP, PUFF, SPARK, CONFETTI } from './fx.js';
import { COLORS } from './rules.js';
import { hashStr, mulberry32 } from './rng.js';

export const WATER = '#2fb7f4';
const TILE_A = '#fbf5df';
const TILE_B = '#efe1b4';
const TILE = 2.2;
export const FALL_AIR = 0.5; // s a car thrown off the rink is in the air before the splash
export const FALL_SINK = 0.45;

/** A car as the renderer wants it. o: { kind: 'me'|'human'|'bot'|'demo', name, c (colour index) } and any field to override. */
export function makeCarView(id, o = {}) {
  const kind = o.kind || 'human';
  const c = o.c ?? 0;
  return {
    id,
    kind,
    name: o.name || '',
    tag: o.name || '',
    bot: kind === 'bot' || kind === 'demo',
    c,
    color: COLORS[c % COLORS.length],
    me: kind === 'me',
    x: 0,
    y: 0,
    a: 0,
    vx: 0,
    vy: 0,
    heavy: 0,
    cd: 1,
    out: false,
    outSeen: false,
    fall: null,
    ghost: false,
    ghostPop: 0,
    sq: 0,
    sqa: 0,
    pop: 0,
    flash: 0,
    ready: false,
    readyPop: 1,
    phase: (hashStr(id) % 1000) / 1000,
    fresh: false,
    pOut: false,
    hidden: false,
    idx: 0,
    bi: 0,
    dust: 0,
    wasReady: true,
    spin: 0,
    ...(o.set || {}),
  };
}

// ---------------------------------------------------------------- the water's decorations

export function makeWaves(seed, n = 26) {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => {
    const a = rng() * TAU;
    const r = 12.5 + rng() * 14;
    return { x: Math.cos(a) * r * 1.35, y: Math.sin(a) * r * 0.9, ph: rng() * TAU, s: 0.4 + rng() * 0.4 };
  });
}

export function makeDucks(seed, n = 6) {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => ({
    rx: 15.5 + rng() * 6,
    ry: 12.8 + rng() * 3.5,
    a0: (i / n) * TAU + rng(),
    sp: (0.035 + rng() * 0.03) * (i % 2 ? 1 : -1),
    ph: rng() * TAU,
    s: 0.8 + rng() * 0.3,
  }));
}

export function makeBubbles(seed, n = 12) {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => ({ x: rng(), ph: rng(), sp: 0.03 + rng() * 0.04, r: 3 + rng() * 5 }));
}

function drawBubbles(ctx, Sc) {
  const n = Math.min(Sc.bubbles.length, Math.round(4 + 8 * Sc.q));
  ctx.lineWidth = 1.5;
  for (let i = 0; i < n; i++) {
    const b = Sc.bubbles[i];
    const y = Sc.h * (1.08 - ((Sc.time * b.sp + b.ph) % 1.16));
    const x = b.x * Sc.w + Math.sin(Sc.time * 1.3 + b.ph * 9) * 6;
    circle(ctx, x, y, b.r);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  }
}

function drawRipples(ctx, Sc) {
  const lw = 1 / Sc.scale;
  // a lighter pool around the rink
  circle(ctx, 0, 0, Sc.R + 3.2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();
  circle(ctx, 0, 0, Sc.R + 1.6);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();
  const rings = Sc.q >= 0.7 ? 4 : 2;
  for (let i = 0; i < rings; i++) {
    const f = ((Sc.time * 0.16 + i / rings) % 1);
    circle(ctx, 0, 0, Sc.R + 0.9 + f * 14);
    ctx.lineWidth = 2.5 * lw;
    ctx.strokeStyle = `rgba(255,255,255,${(0.3 * (1 - f)).toFixed(3)})`;
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  const n = Math.min(Sc.waves.length, Math.round(8 + 18 * Sc.q));
  for (let i = 0; i < n; i++) {
    const w = Sc.waves[i];
    const bob = Math.sin(Sc.time * 1.6 + w.ph) * 0.12;
    ctx.beginPath();
    ctx.arc(w.x, w.y + bob, w.s, Math.PI * 1.1, Math.PI * 1.9);
    ctx.lineWidth = 2.5 * lw;
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.stroke();
  }
}

function drawDuck(ctx, Sc, d) {
  const t = Sc.time;
  const a = d.a0 + d.sp * t;
  const x = Math.cos(a) * d.rx;
  const y = Math.sin(a) * d.ry;
  const heading = Math.atan2(Math.cos(a) * d.ry * d.sp, -Math.sin(a) * d.rx * d.sp);
  const lw = 2.6 / Sc.scale / d.s;
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 2 + d.ph) * 0.08);
  ctx.rotate(heading + Math.sin(t * 1.7 + d.ph) * 0.06);
  ctx.scale(d.s, d.s);
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = DARK;
  // shadow ripple
  ctx.beginPath();
  ctx.ellipse(0.05, 0.12, 0.85, 0.62, 0, 0, TAU);
  ctx.fillStyle = 'rgba(8,60,130,0.22)';
  ctx.fill();
  // tail
  ctx.beginPath();
  ctx.moveTo(-0.55, -0.2);
  ctx.lineTo(-1.0, -0.05);
  ctx.lineTo(-0.55, 0.2);
  ctx.closePath();
  ctx.fillStyle = '#ffd91f';
  ctx.fill();
  ctx.stroke();
  // body
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.72, 0.5, 0, 0, TAU);
  ctx.fillStyle = '#ffd91f';
  ctx.fill();
  ctx.stroke();
  // wing
  ctx.beginPath();
  ctx.ellipse(-0.1, 0.12, 0.34, 0.2, 0.2, 0, TAU);
  ctx.fillStyle = '#ffb81f';
  ctx.fill();
  // head
  circle(ctx, 0.55, 0, 0.3);
  ctx.fillStyle = '#ffd91f';
  ctx.fill();
  ctx.stroke();
  // beak
  ctx.beginPath();
  ctx.moveTo(0.8, -0.1);
  ctx.lineTo(1.12, 0);
  ctx.lineTo(0.8, 0.1);
  ctx.closePath();
  ctx.fillStyle = '#ff8a1f';
  ctx.fill();
  ctx.stroke();
  circle(ctx, 0.62, -0.14, 0.05);
  ctx.fillStyle = DARK;
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- the rink

function drawRink(ctx, Sc) {
  const R = Sc.R;
  const lw = (px) => px / Sc.scale;
  const t = Sc.time;
  const pop = Sc.rimPop < 0.3 && !Sc.reduced ? 1 + 0.025 * Math.sin((Sc.rimPop / 0.3) * Math.PI) : 1;
  ctx.save();
  ctx.scale(pop, pop);
  ctx.lineJoin = 'round';
  // shadow on the water, then the slab's side
  circle(ctx, 0.4, 0.7, R + 0.35);
  ctx.fillStyle = 'rgba(8,60,130,0.30)';
  ctx.fill();
  circle(ctx, 0, 0.5, R + 0.15);
  ctx.fillStyle = '#7c72b8';
  ctx.fill();
  ctx.lineWidth = lw(3.5);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  // the floor: big checker tiles
  circle(ctx, 0, 0, R);
  ctx.fillStyle = TILE_A;
  ctx.fill();
  ctx.save();
  circle(ctx, 0, 0, R);
  ctx.clip();
  ctx.fillStyle = TILE_B;
  const k = Math.ceil(R / TILE) + 1;
  for (let iy = -k; iy <= k; iy++) {
    for (let ix = -k; ix <= k; ix++) {
      if ((ix + iy) & 1) continue;
      ctx.fillRect((ix - 0.5) * TILE, (iy - 0.5) * TILE, TILE, TILE);
    }
  }
  // a soft ring in the middle, so the centre reads as the safest place
  circle(ctx, 0, 0, Math.min(1.6, R * 0.4));
  ctx.lineWidth = lw(3);
  ctx.strokeStyle = 'rgba(40,40,80,0.12)';
  ctx.stroke();
  ctx.restore();
  // the rubber bumper: a fat red and white striped tube
  const rc = R - 0.32;
  const wd = 1.05;
  circle(ctx, 0, 0, rc);
  ctx.lineWidth = wd + lw(7);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  const n = Math.max(12, Math.round(R * 3.6) & ~1);
  ctx.lineWidth = wd;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, rc, (i * TAU) / n, ((i + 1) * TAU) / n + 0.012);
    ctx.strokeStyle = i & 1 ? '#ffffff' : '#e8283c';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, rc - wd * 0.2, Math.PI * 1.05, Math.PI * 1.45);
  ctx.lineWidth = lw(3.5);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  ctx.lineCap = 'butt';
  // the edge that is about to crumble flashes red
  if (Sc.warn) {
    const to = Math.max(0.5, Sc.warnTo);
    const a = Sc.reduced ? 0.34 : 0.2 + 0.3 * (0.5 + 0.5 * Math.sin(t * 14));
    ctx.beginPath();
    ctx.arc(0, 0, R + 0.25, 0, TAU);
    ctx.arc(0, 0, to, 0, TAU, true);
    ctx.fillStyle = `rgba(255,30,40,${a.toFixed(3)})`;
    ctx.fill();
    circle(ctx, 0, 0, to);
    ctx.setLineDash([lw(12), lw(9)]);
    ctx.lineDashOffset = Sc.reduced ? 0 : -t * 2;
    ctx.lineWidth = lw(3.5);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- cars

function flame(ctx, Sc, v) {
  const k = clamp(v.heavy / 0.35, 0.35, 1);
  const len = 0.8 + 1.9 * k;
  const fl = 1 + 0.16 * Math.sin(Sc.time * 70 + v.phase * 5);
  const lw = 2.5 / Sc.scale;
  ctx.save();
  ctx.rotate(v.a);
  ctx.lineJoin = 'round';
  for (const [scl, col] of [[1, '#ff7a1f'], [0.6, '#ffe14a']]) {
    const L = len * fl * scl;
    ctx.beginPath();
    ctx.moveTo(-0.5, -0.34 * scl);
    ctx.quadraticCurveTo(-0.5 - L * 0.55, -0.3 * scl, -0.5 - L, 0);
    ctx.quadraticCurveTo(-0.5 - L * 0.55, 0.3 * scl, -0.5, 0.34 * scl);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    if (scl === 1) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = DARK;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** One bumper car. o: { scale, alpha, lift (rises toward the camera, for a car in the air) }. */
export function drawCar(ctx, Sc, v, o = {}) {
  const S = Sc.scale;
  const lw = (px) => px / S;
  const col = v.color || COLORS[0];
  const lift = o.lift || 0;
  const pop = v.pop > 0 ? v.pop : 0;
  const sc = (o.scale ?? 1) * (v.size ?? 1) * (1 + 0.3 * pop * pop);
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.lineJoin = 'round';
  // the shadow stays on the floor while the car is in the air
  ctx.beginPath();
  ctx.ellipse(v.x + 0.14 + lift * 0.7, v.y + 0.26 + lift * 1.0, 0.9 * sc, 0.84 * sc, 0, 0, TAU);
  ctx.fillStyle = 'rgba(8,40,100,0.30)';
  ctx.fill();
  ctx.translate(v.x, v.y - lift * 0.55);
  ctx.scale(sc, sc);
  if (v.sq > 0.02) {
    ctx.rotate(v.sqa);
    ctx.scale(1 - 0.26 * v.sq, 1 + 0.2 * v.sq);
    ctx.rotate(-v.sqa);
  }
  if (v.heavy > 0.001) flame(ctx, Sc, v);
  ctx.rotate(v.a);
  // the black rubber ring
  circle(ctx, 0, 0, 0.84);
  ctx.fillStyle = '#2b2e3d';
  ctx.fill();
  ctx.lineWidth = lw(3.2);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  // the body
  circle(ctx, 0, 0, 0.66);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = lw(2.6);
  ctx.strokeStyle = shade(col, -0.55);
  ctx.stroke();
  // the front: a lighter bumper bar and two headlights, so you can always see which way it faces
  ctx.beginPath();
  ctx.arc(0, 0, 0.55, -0.95, 0.95);
  ctx.lineWidth = lw(5);
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(col, 0.45);
  ctx.stroke();
  for (const s of [-1, 1]) {
    circle(ctx, 0.56, s * 0.27, 0.1);
    ctx.fillStyle = '#fff7a8';
    ctx.fill();
    ctx.lineWidth = lw(1.8);
    ctx.strokeStyle = DARK;
    ctx.stroke();
  }
  // the little steering wheel, just in front of the driver
  circle(ctx, 0.42, 0, 0.17);
  ctx.lineWidth = lw(3);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.42, -0.17);
  ctx.lineTo(0.42, 0.17);
  ctx.lineWidth = lw(2);
  ctx.stroke();
  // the pole and its pennant, streaming behind
  const sp = Math.hypot(v.vx, v.vy);
  const sway = Math.sin(Sc.time * 9 + v.phase * 6) * (0.05 + sp * 0.012);
  const L = 0.8 + Math.min(0.5, sp * 0.05);
  ctx.beginPath();
  ctx.moveTo(-0.5, -0.11);
  ctx.lineTo(-0.5 - L, sway * 2);
  ctx.lineTo(-0.5, 0.11);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = lw(2.2);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  circle(ctx, -0.5, 0, 0.08);
  ctx.fillStyle = DARK;
  ctx.fill();
  ctx.rotate(-v.a);
  // a shine that stays put while the car turns
  ctx.beginPath();
  ctx.arc(0, 0, 0.52, Math.PI * 1.08, Math.PI * 1.5);
  ctx.lineWidth = lw(3);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.stroke();
  // the driver
  if (v.bot) {
    const bob = Math.sin(Sc.time * 5 + v.phase * 6) * 0.05;
    ctx.beginPath();
    ctx.moveTo(0.02, -0.34);
    ctx.lineTo(0.14, -0.98 + bob);
    ctx.lineWidth = lw(2.2);
    ctx.strokeStyle = DARK;
    ctx.stroke();
    circle(ctx, 0.14, -1.0 + bob, 0.11);
    ctx.fillStyle = '#ff4d6d';
    ctx.fill();
    ctx.lineWidth = lw(2);
    ctx.stroke();
  }
  drawHead(ctx, v.id, -0.04, 0, 0.43, v.bot, lw(2.4));
  // white flash when it was just hit hard
  if (v.flash > 0.02 && !Sc.reduced) {
    circle(ctx, 0, 0, 0.86);
    ctx.fillStyle = `rgba(255,255,255,${(v.flash * 0.6).toFixed(3)})`;
    ctx.fill();
  }
  ctx.restore();
}

function drawRingUnder(ctx, Sc, v) {
  // A light ring under your own car, always; and the boost recharging as a ring that fills.
  const lw = (px) => px / Sc.scale;
  circle(ctx, v.x, v.y, 1.12);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.lineWidth = lw(3);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  if (v.cd < 0.999) {
    ctx.beginPath();
    ctx.arc(v.x, v.y, 1.28, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(v.cd, 0, 1));
    ctx.lineWidth = lw(5);
    ctx.lineCap = 'round';
    ctx.strokeStyle = DARK;
    ctx.stroke();
    ctx.lineWidth = lw(3);
    ctx.strokeStyle = '#ffe14a';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

function drawGhost(ctx, Sc, v) {
  const t = Sc.time;
  const lw = (px) => px / Sc.scale;
  const s = v.ghostPop > 0 ? 1 + 0.25 * v.ghostPop : 1;
  const bob = Math.sin(t * 2.6 + v.phase * 6) * 0.07;
  ctx.save();
  ctx.translate(v.x, v.y + bob);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  // ripples
  const f = (t * 0.7 + v.phase) % 1;
  circle(ctx, 0, 0.1, 0.7 + f * 0.6);
  ctx.lineWidth = lw(2);
  ctx.strokeStyle = `rgba(255,255,255,${(0.5 * (1 - f)).toFixed(3)})`;
  ctx.stroke();
  // the swim ring: white with red quarters
  circle(ctx, 0, 0, 0.62);
  ctx.lineWidth = 0.34 + lw(5);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.lineWidth = 0.34;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 0.62, (i * TAU) / 4, ((i + 1) * TAU) / 4 + 0.01);
    ctx.strokeStyle = i & 1 ? '#ffffff' : v.color || '#ff3b3b';
    ctx.stroke();
  }
  // the head
  drawHead(ctx, v.id, 0, 0, 0.36, v.bot, lw(2.2));
  // a waving hand
  const wave = Math.sin(t * 8 + v.phase * 6);
  const hx = 0.62 + wave * 0.1;
  const hy = -0.72 - Math.abs(wave) * 0.1;
  ctx.beginPath();
  ctx.moveTo(0.42, -0.22);
  ctx.lineTo(hx, hy);
  ctx.lineWidth = 0.18 + lw(4);
  ctx.lineCap = 'round';
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.lineWidth = 0.18;
  ctx.strokeStyle = '#ffd9b3';
  ctx.stroke();
  circle(ctx, hx, hy, 0.17);
  ctx.fillStyle = '#ffd9b3';
  ctx.fill();
  ctx.lineWidth = lw(2.2);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.restore();
}

const byY = (a, b) => a.y - b.y;
const order = [];

function drawCars(ctx, Sc) {
  order.length = 0;
  for (const v of Sc.cars) order.push(v);
  order.sort(byY);
  // swimmers first, they are in the water
  for (const v of order) if (v.out && v.ghost) drawGhost(ctx, Sc, v);
  for (const v of order) {
    if (v.out && v.fall) {
      const tt = v.fall.t;
      if (tt < FALL_AIR) {
        const z = Math.sin((Math.PI * tt) / FALL_AIR);
        drawCar(ctx, Sc, v, { scale: 1 + 0.12 * z, lift: z * 0.9 });
      } else if (tt < FALL_AIR + FALL_SINK) {
        const u = (tt - FALL_AIR) / FALL_SINK;
        drawCar(ctx, Sc, v, { scale: 1 - 0.85 * easeOutCubic(u), alpha: 1 - u });
      }
    }
  }
  for (const v of order) {
    if (v.out) continue;
    if (v.me) drawRingUnder(ctx, Sc, v);
    drawCar(ctx, Sc, v);
  }
}

// ---------------------------------------------------------------- particles and rings (world space)

function drawRings(ctx, Sc) {
  const lw = 1 / Sc.scale;
  for (const r of Sc.fx.rings) {
    if (!r.on) continue;
    const u = clamp(r.age / r.life, 0, 1);
    circle(ctx, r.x, r.y, r.r0 + (r.r1 - r.r0) * easeOutCubic(u));
    ctx.lineWidth = r.lw * lw * (1 - u * 0.6);
    ctx.globalAlpha = 1 - u;
    ctx.strokeStyle = r.col;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawParts(ctx, Sc) {
  const lw = 1 / Sc.scale;
  ctx.lineCap = 'round';
  for (const p of Sc.fx.parts) {
    if (!p.on) continue;
    const u = clamp(p.life / p.max, 0, 1); // 1 new, 0 gone
    switch (p.kind) {
      case SPARK:
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
        ctx.lineWidth = p.size * (0.4 + u * 0.6) * 1.6;
        ctx.strokeStyle = p.col;
        ctx.stroke();
        break;
      case CONFETTI: {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.sin(p.rot * 1.7)) * 0.9 + 0.1);
        ctx.globalAlpha = u > 0.2 ? 1 : u / 0.2;
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.size, -p.size * 0.55, p.size * 2, p.size * 1.1);
        ctx.restore();
        ctx.globalAlpha = 1;
        break;
      }
      case DROP:
        circle(ctx, p.x, p.y, p.size * (0.5 + u * 0.5));
        ctx.globalAlpha = Math.min(1, u * 2);
        ctx.fillStyle = p.col;
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case DEBRIS: {
        const fall = u < 0.45 ? u / 0.45 : 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(0.35 + 0.65 * fall, 0.35 + 0.65 * fall);
        ctx.globalAlpha = fall;
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.lineWidth = 2.4 * lw;
        ctx.strokeStyle = DARK;
        ctx.strokeRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
        ctx.globalAlpha = 1;
        break;
      }
      case PUFF:
        circle(ctx, p.x, p.y, p.size * (1.6 - u * 0.9));
        ctx.globalAlpha = u * 0.7;
        ctx.fillStyle = p.col;
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      case DOT:
      default:
        circle(ctx, p.x, p.y, p.size);
        ctx.fillStyle = p.col;
        ctx.fill();
    }
  }
  ctx.lineCap = 'butt';
}

// ---------------------------------------------------------------- the world

export function drawWorld(ctx, Sc) {
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  ctx.fillStyle = WATER;
  ctx.fillRect(0, 0, Sc.w, Sc.h);
  drawBubbles(ctx, Sc);
  ctx.save();
  ctx.translate(Sc.cx + Sc.shx, Sc.cy + Sc.shy);
  ctx.scale(Sc.scale, Sc.scale);
  drawRipples(ctx, Sc);
  const ducks = Math.min(Sc.ducks.length, Math.round(2 + 4 * Sc.q));
  for (let i = 0; i < ducks; i++) drawDuck(ctx, Sc, Sc.ducks[i]);
  if (!Sc.noRink) drawRink(ctx, Sc);
  drawRings(ctx, Sc);
  drawCars(ctx, Sc);
  if (!Sc.partsOnTop) drawParts(ctx, Sc);
  ctx.restore();
  drawLabels(ctx, Sc);
}

/** Particles again, over the screens that cover the world (confetti over the podium). */
export function drawTopParticles(ctx, Sc) {
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  ctx.save();
  ctx.translate(Sc.cx + Sc.shx, Sc.cy + Sc.shy);
  ctx.scale(Sc.scale, Sc.scale);
  drawParts(ctx, Sc);
  ctx.restore();
}

// ---------------------------------------------------------------- labels over the world (screen space)

/** Names, the YOU arrow, READY checks, BONK clouds and floating numbers. */
export function drawLabels(ctx, Sc) {
  ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);
  const S = Sc.scale;
  const ox = Sc.cx + Sc.shx;
  const oy = Sc.cy + Sc.shy;
  const tagSize = clamp(S * 0.8, 10, 19);
  for (const v of Sc.cars) {
    if (!v.tag) continue;
    if (v.out && !v.ghost) continue;
    const sx = ox + v.x * S;
    let sy = oy + (v.y - (v.out ? 1.0 : 1.22)) * S;
    if (v.out) sy += Math.sin(Sc.time * 2.6 + v.phase * 6) * S * 0.07;
    const name = fit(ctx, v.tag, tagSize, 120);
    text(ctx, name, sx, sy, tagSize, { lw: tagSize * 0.26, alpha: v.out ? 0.9 : 1 });
    if (v.ready) {
      const cs = clamp(S * 1.5, 22, 40);
      drawCheck(ctx, sx, sy - tagSize * 0.9 - cs * 0.55, cs, easeOutBack(clamp((v.readyPop ?? 1) * 1, 0, 1)));
    }
    if (v.me && !v.out && Sc.youUntil > Sc.time) {
      // a bouncing arrow over the name: this one is you
      const bounce = Math.abs(Math.sin(Sc.time * 6)) * S * 0.28;
      const fs = clamp(S * 1.0, 13, 24);
      const tip = sy - tagSize * 0.62 - 6 - bounce - (v.ready ? clamp(S * 1.5, 22, 40) + 6 : 0);
      ctx.beginPath();
      ctx.moveTo(sx - fs * 0.5, tip - fs * 0.6);
      ctx.lineTo(sx + fs * 0.5, tip - fs * 0.6);
      ctx.lineTo(sx, tip);
      ctx.closePath();
      ctx.fillStyle = '#ffe14a';
      ctx.fill();
      ctx.lineWidth = Math.max(2, fs * 0.16);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = DARK;
      ctx.stroke();
      text(ctx, 'YOU', sx, tip - fs * 0.6 - fs * 0.6, fs, { fill: '#ffe14a', lw: fs * 0.28 });
    }
  }
  // BONK clouds
  for (const b of Sc.fx.bursts) {
    if (!b.on) continue;
    const u = b.age / b.life;
    const k = easeOutBack(clamp(u * 4, 0, 1)) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
    if (k <= 0.02) continue;
    const r = (0.8 + b.power * 0.055) * S * k;
    const sx = ox + b.x * S;
    const sy = oy + b.y * S;
    ctx.save();
    ctx.translate(sx, sy - S * 0.4 * u);
    ctx.rotate(b.rot);
    starPath(ctx, 0, 0, r * 1.5, r * 0.85, 9, b.rot * 2);
    ctx.fillStyle = '#ffe14a';
    ctx.fill();
    ctx.lineWidth = Math.max(3, r * 0.12);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = DARK;
    ctx.stroke();
    starPath(ctx, 0, 0, r * 1.05, r * 0.6, 9, b.rot * 2 + 0.2);
    ctx.fillStyle = '#fff6b8';
    ctx.fill();
    if (b.txt) text(ctx, b.txt, 0, 0, clamp(r * 0.62, 12, 60), { fill: '#e8283c', stroke: DARK, lw: Math.max(3, r * 0.1) });
    ctx.restore();
  }
  // floating numbers and KO! labels
  for (const p of Sc.fx.popups) {
    if (!p.on || p.age < 0) continue;
    const u = p.age / p.life;
    const k = easeOutBack(clamp(p.age * 5, 0, 1));
    const size = clamp(S * 1.0 * p.size, 14, 70) * k;
    const sx = ox + p.x * S;
    const sy = oy + (p.y - 1.1 - u * 1.4) * S;
    text(ctx, p.text, sx, sy, Math.max(6, size), { fill: p.col, alpha: u > 0.75 ? (1 - u) / 0.25 : 1, lw: Math.max(3, size * 0.2) });
  }
}

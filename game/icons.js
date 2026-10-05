// Little icons drawn with paths (no images): score star, boxing glove, crown, island, car, eye, wrecking ball, water drop.
// All are centred on (x, y) and drawn in the context's units; s is roughly the radius. Nothing touches the page.

import { DARK, TAU, circle, roundRect, shade, starPath } from './gfx.js';

function outline(ctx, s) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, s * 0.14);
  ctx.strokeStyle = DARK;
  ctx.stroke();
}

export function iconStar(ctx, x, y, s, fill = '#ffd21f') {
  starPath(ctx, x, y, s, s * 0.46, 5, -Math.PI / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  outline(ctx, s);
}

export function iconGlove(ctx, x, y, s, fill = '#e8283c') {
  ctx.save();
  ctx.translate(x, y);
  // the cuff
  roundRect(ctx, -0.5 * s, 0.35 * s, 1.0 * s, 0.55 * s, 0.12 * s);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  outline(ctx, s);
  // the thumb
  ctx.beginPath();
  ctx.ellipse(-0.62 * s, 0.05 * s, 0.26 * s, 0.4 * s, -0.35, 0, TAU);
  ctx.fillStyle = shade(fill, -0.15);
  ctx.fill();
  outline(ctx, s);
  // the fist
  roundRect(ctx, -0.55 * s, -0.8 * s, 1.1 * s, 1.35 * s, 0.5 * s);
  ctx.fillStyle = fill;
  ctx.fill();
  outline(ctx, s);
  ctx.beginPath();
  ctx.moveTo(-0.1 * s, -0.7 * s);
  ctx.lineTo(-0.1 * s, -0.2 * s);
  ctx.moveTo(0.28 * s, -0.7 * s);
  ctx.lineTo(0.28 * s, -0.2 * s);
  ctx.lineWidth = Math.max(1.2, s * 0.09);
  ctx.strokeStyle = shade(fill, -0.5);
  ctx.stroke();
  ctx.restore();
}

export function iconCrown(ctx, x, y, s, fill = '#ffd21f') {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-0.9 * s, 0.6 * s);
  ctx.lineTo(-1.0 * s, -0.55 * s);
  ctx.lineTo(-0.45 * s, -0.05 * s);
  ctx.lineTo(0, -0.8 * s);
  ctx.lineTo(0.45 * s, -0.05 * s);
  ctx.lineTo(1.0 * s, -0.55 * s);
  ctx.lineTo(0.9 * s, 0.6 * s);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  outline(ctx, s);
  for (const [px, py, c] of [[-1.0, -0.6, '#ff3b3b'], [0, -0.85, '#3d6bff'], [1.0, -0.6, '#ff3b3b']]) {
    circle(ctx, px * s, py * s, 0.16 * s);
    ctx.fillStyle = c;
    ctx.fill();
    outline(ctx, s * 0.7);
  }
  ctx.beginPath();
  ctx.moveTo(-0.85 * s, 0.3 * s);
  ctx.lineTo(0.85 * s, 0.3 * s);
  ctx.lineWidth = Math.max(1.5, s * 0.1);
  ctx.strokeStyle = shade(fill, -0.35);
  ctx.stroke();
  ctx.restore();
}

export function iconIsland(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  // sand
  ctx.beginPath();
  ctx.ellipse(0, 0.45 * s, 0.9 * s, 0.4 * s, 0, 0, TAU);
  ctx.fillStyle = '#ffd98a';
  ctx.fill();
  outline(ctx, s);
  // trunk
  ctx.beginPath();
  ctx.moveTo(0, 0.3 * s);
  ctx.quadraticCurveTo(0.2 * s, -0.2 * s, 0.1 * s, -0.7 * s);
  ctx.lineWidth = Math.max(2, s * 0.2);
  ctx.lineCap = 'round';
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.lineWidth = Math.max(1.2, s * 0.1);
  ctx.strokeStyle = '#a8693a';
  ctx.stroke();
  // leaves
  for (const a of [-2.6, -1.9, -1.2, -0.5]) {
    ctx.beginPath();
    ctx.ellipse(0.1 * s + Math.cos(a) * 0.35 * s, -0.7 * s + Math.sin(a) * 0.2 * s, 0.4 * s, 0.14 * s, a, 0, TAU);
    ctx.fillStyle = '#27c95a';
    ctx.fill();
    outline(ctx, s * 0.7);
  }
  ctx.restore();
}

/** A bumper car seen from above. */
export function iconCar(ctx, x, y, s, col = '#ff3b3b') {
  ctx.save();
  ctx.translate(x, y);
  circle(ctx, 0, 0, s);
  ctx.fillStyle = '#2b2e3d';
  ctx.fill();
  outline(ctx, s);
  circle(ctx, 0, 0, s * 0.76);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, s * 0.08);
  ctx.strokeStyle = shade(col, -0.5);
  ctx.stroke();
  for (const sy of [-1, 1]) {
    circle(ctx, s * 0.66, sy * s * 0.3, s * 0.12);
    ctx.fillStyle = '#fff7a8';
    ctx.fill();
  }
  circle(ctx, -s * 0.05, 0, s * 0.42);
  ctx.fillStyle = '#ffe0bd';
  ctx.fill();
  outline(ctx, s * 0.6);
  ctx.restore();
}

export function iconEye(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-s, 0);
  ctx.quadraticCurveTo(0, -s * 1.1, s, 0);
  ctx.quadraticCurveTo(0, s * 1.1, -s, 0);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  outline(ctx, s);
  circle(ctx, 0, 0, s * 0.38);
  ctx.fillStyle = '#3d6bff';
  ctx.fill();
  circle(ctx, 0, 0, s * 0.17);
  ctx.fillStyle = DARK;
  ctx.fill();
  ctx.restore();
}

export function iconBall(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.1);
  ctx.lineTo(0, -s * 0.3);
  ctx.lineWidth = Math.max(2, s * 0.18);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  circle(ctx, 0, s * 0.3, s * 0.7);
  ctx.fillStyle = '#4a4f6a';
  ctx.fill();
  outline(ctx, s);
  circle(ctx, -s * 0.22, s * 0.05, s * 0.18);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
  ctx.restore();
}

export function iconDrop(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s * 0.9, -s * 0.1, s * 0.8, s * 0.9, 0, s * 0.9);
  ctx.bezierCurveTo(-s * 0.8, s * 0.9, -s * 0.9, -s * 0.1, 0, -s);
  ctx.closePath();
  ctx.fillStyle = '#6fd6ff';
  ctx.fill();
  outline(ctx, s);
  ctx.beginPath();
  ctx.arc(-s * 0.15, s * 0.3, s * 0.38, Math.PI * 0.55, Math.PI * 0.95);
  ctx.lineWidth = Math.max(1.5, s * 0.12);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.stroke();
  ctx.restore();
}

export function iconFlag(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, s);
  ctx.lineTo(-s * 0.5, -s);
  ctx.lineWidth = Math.max(2, s * 0.16);
  ctx.lineCap = 'round';
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, -s);
  ctx.lineTo(s * 0.9, -s * 0.5);
  ctx.lineTo(-s * 0.5, 0);
  ctx.closePath();
  ctx.fillStyle = '#e8283c';
  ctx.fill();
  outline(ctx, s);
  ctx.restore();
}

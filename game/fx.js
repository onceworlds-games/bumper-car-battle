// Particles, floating numbers, BONK bursts, water rings and camera shake. Fixed pools: nothing is allocated while playing.
// World units (a car is 0.75 around). The renderer draws what is "on"; update(dt) moves it.

import { clamp } from './gfx.js';

const MAX_PARTS = 420;
const MAX_POPUPS = 24;
const MAX_BURSTS = 10;
const MAX_RINGS = 28;

// kinds: 0 dot, 1 spark (a short line along its motion), 2 confetti, 3 droplet, 4 debris tile, 5 puff
export const DOT = 0;
export const SPARK = 1;
export const CONFETTI = 2;
export const DROP = 3;
export const DEBRIS = 4;
export const PUFF = 5;

const CONFETTI_COLORS = ['#ff3b3b', '#ffd21f', '#8ee02a', '#3d6bff', '#ee4dff', '#ff9a1f', '#12c9b8', '#ffffff'];

export function createFx() {
  const parts = Array.from({ length: MAX_PARTS }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 0.1, col: '#fff', kind: 0, g: 0, drag: 0, rot: 0, vr: 0 }));
  const popups = Array.from({ length: MAX_POPUPS }, () => ({ on: false, text: '', x: 0, y: 0, age: 0, life: 1, size: 1, col: '#fff', delay: 0 }));
  const bursts = Array.from({ length: MAX_BURSTS }, () => ({ on: false, x: 0, y: 0, age: 0, life: 0.5, power: 1, txt: '', rot: 0 }));
  const rings = Array.from({ length: MAX_RINGS }, () => ({ on: false, x: 0, y: 0, r0: 0, r1: 1, age: 0, life: 1, col: '#fff', lw: 3 }));
  let cursor = 0;
  let pCursor = 0;
  let bCursor = 0;
  let rCursor = 0;

  const fx = {
    parts,
    popups,
    bursts,
    rings,
    trauma: 0,
    t: 0,
    q: 1, // 0.4 low, 0.7 medium, 1 high
    reduced: false,
    rand: Math.random,

    count(n) {
      return Math.max(1, Math.round(n * this.q * (this.reduced ? 0.5 : 1)));
    },

    spawn(kind, x, y, vx, vy, life, size, col, g = 0, drag = 0) {
      const cap = Math.max(40, Math.floor(MAX_PARTS * this.q));
      const p = parts[cursor % cap];
      cursor = (cursor + 1) % MAX_PARTS;
      p.on = true;
      p.kind = kind;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = life;
      p.max = life;
      p.size = size;
      p.col = col;
      p.g = g;
      p.drag = drag;
      p.rot = this.rand() * 6.28;
      p.vr = (this.rand() - 0.5) * 12;
      return p;
    },

    /** Sparks flying off a hit at (x, y) along the line of contact (nx, ny). */
    sparks(x, y, nx, ny, power) {
      const n = this.count(6 + power * 1.1);
      for (let i = 0; i < n; i++) {
        const side = this.rand() < 0.5 ? -1 : 1;
        const a = Math.atan2(ny, nx) + Math.PI / 2 * side + (this.rand() - 0.5) * 2.2;
        const s = 4 + this.rand() * (5 + power * 0.6);
        const col = this.rand() < 0.5 ? '#ffe14a' : this.rand() < 0.5 ? '#ffffff' : '#ff9a1f';
        this.spawn(SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.22 + this.rand() * 0.25, 0.08 + this.rand() * 0.05, col, 0, 3);
      }
    },

    puff(x, y, n, col = '#ffffff', speed = 1.5) {
      const k = this.count(n);
      for (let i = 0; i < k; i++) {
        const a = this.rand() * 6.28;
        const s = speed * (0.3 + this.rand());
        this.spawn(PUFF, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + this.rand() * 0.35, 0.12 + this.rand() * 0.12, col, 0, 2.5);
      }
    },

    /** A car landing in the water. */
    splash(x, y, power = 1) {
      this.ring(x, y, 0.3, 2.4 + power, 0.8, '#ffffff', 4);
      this.ring(x, y, 0.1, 1.5 + power * 0.7, 0.55, '#bdf0ff', 3);
      const n = this.count(16 + power * 8);
      for (let i = 0; i < n; i++) {
        const a = this.rand() * 6.28;
        const s = 1.5 + this.rand() * 3.5;
        this.spawn(DROP, x, y, Math.cos(a) * s, Math.sin(a) * s - (3 + this.rand() * 7 * power), 0.6 + this.rand() * 0.4, 0.1 + this.rand() * 0.14, this.rand() < 0.5 ? '#ffffff' : '#bdf0ff', 18, 0.4);
      }
      this.puff(x, y, 6, '#e8fbff', 2);
    },

    confetti(x, y, n, spread = 6, up = 9) {
      const k = this.count(n);
      for (let i = 0; i < k; i++) {
        const col = CONFETTI_COLORS[Math.floor(this.rand() * CONFETTI_COLORS.length)];
        this.spawn(CONFETTI, x + (this.rand() - 0.5) * 2, y, (this.rand() - 0.5) * 2 * spread, -(3 + this.rand() * up), 1.6 + this.rand() * 1.2, 0.16 + this.rand() * 0.1, col, 8, 0.9);
      }
    },

    /** A tile of the edge breaking off. (ang: the way it leaves the rink) */
    debris(x, y, ang, col) {
      const s = 1.5 + this.rand() * 3;
      this.spawn(DEBRIS, x, y, Math.cos(ang) * s, Math.sin(ang) * s, 0.9 + this.rand() * 0.5, 0.35 + this.rand() * 0.3, col, 0, 0.6);
    },

    ring(x, y, r0, r1, life, col, lw = 3) {
      const r = rings[rCursor];
      rCursor = (rCursor + 1) % MAX_RINGS;
      r.on = true;
      r.x = x;
      r.y = y;
      r.r0 = r0;
      r.r1 = r1;
      r.age = 0;
      r.life = life;
      r.col = col;
      r.lw = lw;
    },

    /** A floating label ("+2", "KO!") that pops in and drifts up. size: in car radii. */
    popup(text, x, y, col = '#ffffff', size = 1, delay = 0) {
      const p = popups[pCursor];
      pCursor = (pCursor + 1) % MAX_POPUPS;
      p.on = true;
      p.text = text;
      p.x = x;
      p.y = y;
      p.age = -delay;
      p.life = 1.1;
      p.size = size;
      p.col = col;
    },

    /** A BONK cloud. power ~ the closing speed. */
    bonk(x, y, power, txt = 'BONK!') {
      const b = bursts[bCursor];
      bCursor = (bCursor + 1) % MAX_BURSTS;
      b.on = true;
      b.x = x;
      b.y = y;
      b.age = 0;
      b.life = 0.6;
      b.power = clamp(power, 2, 24);
      b.txt = txt;
      b.rot = (this.rand() - 0.5) * 0.5;
    },

    shake(amount) {
      if (this.reduced) return;
      this.trauma = Math.min(1, this.trauma + amount);
    },

    /** Smooth sine offsets from the decaying trauma (trauma squared, never fresh random jitter). */
    shakeOffset(out, amp) {
      const k = this.trauma * this.trauma * amp;
      out.x = k * (Math.sin(this.t * 43.7) + 0.5 * Math.sin(this.t * 71.3 + 1.3));
      out.y = k * (Math.sin(this.t * 37.1 + 2.1) + 0.5 * Math.sin(this.t * 59.9));
      return out;
    },

    update(dt) {
      this.t += dt;
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p.on) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.on = false;
          continue;
        }
        p.vy += p.g * dt;
        if (p.drag > 0) {
          const f = Math.exp(-p.drag * dt);
          p.vx *= f;
          p.vy *= f;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
      for (let i = 0; i < popups.length; i++) {
        const p = popups[i];
        if (!p.on) continue;
        p.age += dt;
        if (p.age >= p.life) p.on = false;
      }
      for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i];
        if (!b.on) continue;
        b.age += dt;
        if (b.age >= b.life) b.on = false;
      }
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (!r.on) continue;
        r.age += dt;
        if (r.age >= r.life) r.on = false;
      }
    },

    clear() {
      for (const p of parts) p.on = false;
      for (const p of popups) p.on = false;
      for (const b of bursts) b.on = false;
      for (const r of rings) r.on = false;
      this.trauma = 0;
    },
  };
  return fx;
}

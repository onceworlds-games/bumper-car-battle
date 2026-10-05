// The screens drawn over the world: title, lobby settings, countdown, round banners, the HUD, the scoreboard, the podium.
// Few words, big shapes. Every function draws in CSS pixels (the context is scaled to the pixel ratio already) and takes plain
// data, so the posters can use them too. Nothing here touches the page.

import { drawHead } from './avatars.js';
import { DARK, circle, clamp, easeInOut, easeOutBack, easeOutCubic, fit, font, lerp, plate, shade, text } from './gfx.js';
import { iconBall, iconCrown, iconDrop, iconEye, iconFlag, iconGlove, iconStar } from './icons.js';

/** Where the buttons are right now (set while drawing, read by the tap handler). */
export const rects = { play: null, rounds: [] };

export const unit = (Sc) => clamp(Math.min(Sc.w, Sc.h) / 20, 14, 38);
export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH'}`;

const base = (ctx, Sc) => ctx.setTransform(Sc.pr, 0, 0, Sc.pr, 0, 0);

// ---------------------------------------------------------------- title

/** The chunky logo: two lines of bouncing letters. (cx, cy) is the middle of the first line. */
export function drawLogo(ctx, cx, cy, size, t, still = false) {
  const lines = [
    ['BUMPER CAR', 1, '#ffe14a', '#b3541e'],
    ['BATTLE', 1.3, '#ffffff', '#e8283c'],
  ];
  let y = cy;
  lines.forEach(([str, k, fill, shadow], li) => {
    const s = size * k;
    ctx.font = font(s);
    const chars = Array.from(str);
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = cx - total / 2;
    chars.forEach((ch, i) => {
      if (ch !== ' ') {
        const bob = still ? 0 : Math.sin(t * 3.2 + i * 0.55 + li) * s * 0.045;
        const rot = (still ? 0 : Math.sin(t * 2.4 + i * 0.7) * 0.05) + (li ? 0.02 : -0.03);
        ctx.save();
        ctx.translate(x + widths[i] / 2, y + bob);
        ctx.rotate(rot);
        text(ctx, ch, 0, 0, s, { fill, shadow: s * 0.09, shadowColor: shadow, lw: s * 0.2 });
        ctx.restore();
      }
      x += widths[i];
    });
    y += s * 1.08;
  });
}

export function drawTitle(ctx, Sc, t) {
  base(ctx, Sc);
  const { w, h } = Sc;
  // the logo stays clear of the platform's buttons in the top left corner
  const logo = Math.min(w * 0.09, h * 0.15, 110, Math.max(20, (w / 2 - 138) / 3.5));
  drawLogo(ctx, w / 2, Math.max(h * 0.17, logo * 0.9), logo, t);
  const bw = clamp(h * 0.62, 190, 320);
  const bh = clamp(h * 0.18, 60, 100);
  const bx = w / 2 - bw / 2;
  const by = h * 0.72 - bh / 2;
  const pulse = 1 + 0.035 * Math.sin(t * 4);
  ctx.save();
  ctx.translate(w / 2, by + bh / 2);
  ctx.scale(pulse, pulse);
  ctx.translate(-w / 2, -(by + bh / 2));
  plate(ctx, bx, by, bw, bh, bh * 0.32, '#2fd45f', { shine: true });
  const fs = bh * 0.5;
  ctx.font = font(fs);
  const tw = ctx.measureText('PLAY').width;
  const tx = w / 2 + bh * 0.2;
  text(ctx, 'PLAY', tx, by + bh * 0.5, fs, { lw: fs * 0.2 });
  // a play triangle beside the word
  const ix = tx - tw / 2 - bh * 0.34;
  ctx.beginPath();
  ctx.moveTo(ix - bh * 0.14, by + bh * 0.3);
  ctx.lineTo(ix + bh * 0.2, by + bh * 0.5);
  ctx.lineTo(ix - bh * 0.14, by + bh * 0.7);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = Math.max(3, bh * 0.06);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.restore();
  rects.play = { x: bx, y: by, w: bw, h: bh };
}

// ---------------------------------------------------------------- lobby

/** The settings as big values at the top (the host's are buttons), and the three-word hint. st: { rounds, options, isHost, hint } */
export function drawLobbyHud(ctx, Sc, st) {
  base(ctx, Sc);
  const u = unit(Sc);
  const bh = clamp(u * 2.5, 46, 62);
  const bw = bh * 1.05;
  const gap = 8;
  const ls = clamp(u * 0.95, 15, 22);
  ctx.font = font(ls);
  const lw = ctx.measureText('ROUNDS').width;
  const n = st.options.length;
  const total = 30 + lw + 14 + n * bw + (n - 1) * gap;
  const y = 8;
  let x = Math.max(Sc.w / 2 - total / 2, 138);
  iconFlag(ctx, x + 12, y + bh / 2, 13);
  text(ctx, 'ROUNDS', x + 30, y + bh / 2, ls, { align: 'left', lw: ls * 0.26 });
  x += 30 + lw + 14;
  rects.rounds.length = 0;
  for (const v of st.options) {
    const sel = v === st.rounds;
    plate(ctx, x, y, bw, bh, 14, sel ? '#ffe14a' : st.isHost ? '#ffffff' : '#9fb0d8', { shadow: sel ? 5 : 4, shine: sel });
    text(ctx, String(v), x + bw / 2, y + bh / 2, bh * 0.58, { alpha: sel || st.isHost ? 1 : 0.7 });
    if (st.isHost) rects.rounds.push({ v, x, y, w: bw, h: bh });
    x += bw + gap;
  }
  const hs = clamp(u * 1.2, 18, 30);
  text(ctx, st.hint, Sc.w / 2, y + bh + hs * 1.1, hs, { lw: hs * 0.24 });
}

/** The podium results kept on screen for a few seconds after a match. st: { top: [{id,name,bot,color,score,me}], age } */
export function drawResultsCard(ctx, Sc, st) {
  base(ctx, Sc);
  const fade = clamp((6 - st.age) / 0.8, 0, 1) * easeOutCubic(st.age / 0.3);
  if (fade <= 0) return;
  const u = unit(Sc);
  const cw = clamp(Sc.w * 0.6, 300, 540);
  const ch = clamp(u * 6.4, 100, 150);
  const x = Sc.w / 2 - cw / 2;
  const y = Sc.h * 0.3;
  ctx.save();
  ctx.globalAlpha = fade;
  plate(ctx, x, y, cw, ch, 20, '#ffffff', { shadow: 5 });
  const n = st.top.length;
  st.top.forEach((p, i) => {
    const cx = x + (cw / n) * (i + 0.5);
    const r = ch * 0.2;
    ctx.lineWidth = 4;
    ctx.strokeStyle = p.color;
    circle(ctx, cx, y + ch * 0.36, r + 2);
    ctx.stroke();
    drawHead(ctx, p.id, cx, y + ch * 0.36, r, p.bot, 2.5);
    text(ctx, String(i + 1), cx - r - 6, y + ch * 0.2, ch * 0.28, { fill: i === 0 ? '#ffd21f' : '#ffffff' });
    const ns = clamp(ch * 0.15, 12, 18);
    text(ctx, fit(ctx, p.name, ns, cw / n - 12), cx, y + ch * 0.7, ns, { fill: DARK, stroke: '#ffffff', lw: ns * 0.26 });
    text(ctx, String(p.score), cx, y + ch * 0.88, ns * 1.2, { fill: DARK, stroke: '#ffffff', lw: ns * 0.3 });
  });
  ctx.restore();
}

// ---------------------------------------------------------------- countdown and banners

/** 3, 2, 1 (n = 3..1) or GO! (n = 0), age: seconds since this one appeared. */
export function drawCountdown(ctx, Sc, n, age) {
  base(ctx, Sc);
  const size = Math.min(Sc.w, Sc.h) * (n ? 0.55 : 0.42);
  const k = easeOutBack(clamp(age * 4.5, 0, 1));
  const fade = n ? 1 : clamp(1 - (age - 0.45) / 0.3, 0, 1);
  const col = n === 3 ? '#ff5a5a' : n === 2 ? '#ffb020' : n === 1 ? '#ffe14a' : '#3be06a';
  if (fade <= 0) return;
  circle(ctx, Sc.w / 2, Sc.h * 0.47, size * 0.32 + age * size * 0.9);
  ctx.lineWidth = Math.max(4, size * 0.04);
  ctx.strokeStyle = `rgba(255,255,255,${(Math.max(0, 0.8 - age * 1.1) * fade).toFixed(3)})`;
  ctx.stroke();
  text(ctx, n ? String(n) : 'GO!', Sc.w / 2, Sc.h * 0.47, Math.max(8, size * k), { fill: col, shadow: size * 0.05, lw: size * 0.1, alpha: fade });
}

/** A ribbon across the screen with a few big words. Slides in, holds, slides out. yFrac: where it sits. */
export function drawRibbon(ctx, Sc, big, sub, age, life, fill, yFrac = 0.5, reduced = false) {
  base(ctx, Sc);
  const u = unit(Sc);
  const bh = clamp(u * 3.6, 62, 118);
  const inK = reduced ? 1 : easeOutBack(clamp(age / 0.28, 0, 1));
  const outK = reduced ? 0 : easeOutCubic(clamp((age - (life - 0.25)) / 0.25, 0, 1));
  const alpha = reduced ? clamp(Math.min(age / 0.15, (life - age) / 0.15), 0, 1) : 1;
  if (alpha <= 0) return;
  const off = (1 - inK) * -Sc.w + outK * Sc.w;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, Sc.h * yFrac);
  ctx.rotate(reduced ? 0 : -0.025);
  ctx.translate(off, 0);
  ctx.fillStyle = shade(fill, -0.45);
  ctx.fillRect(-40, -bh / 2 + 6, Sc.w + 80, bh);
  ctx.fillStyle = fill;
  ctx.fillRect(-40, -bh / 2, Sc.w + 80, bh);
  ctx.lineWidth = 4;
  ctx.strokeStyle = DARK;
  ctx.strokeRect(-40, -bh / 2, Sc.w + 80, bh);
  const fs = bh * 0.52;
  text(ctx, fit(ctx, big, fs, Sc.w * 0.9), Sc.w / 2, 2, fs, { lw: fs * 0.2, shadow: fs * 0.05 });
  if (sub) {
    const ss = clamp(bh * 0.24, 14, 26);
    plate(ctx, Sc.w / 2 - ss * 3.2, -bh / 2 - ss * 1.9, ss * 6.4, ss * 1.7, ss * 0.6, '#ffffff', { shadow: 3, lw: 3 });
    text(ctx, sub, Sc.w / 2, -bh / 2 - ss * 1.05, ss, { fill: DARK, stroke: '#ffffff', lw: ss * 0.2 });
  }
  ctx.restore();
}

/** "SPLASH!" over the screen of the player who just fell in. */
export function drawSplashWord(ctx, Sc, age) {
  base(ctx, Sc);
  const k = easeOutBack(clamp(age * 5, 0, 1)) * clamp(1.6 - age, 0, 1);
  if (k <= 0.02) return;
  const size = Math.min(Sc.w, Sc.h) * 0.2 * k;
  text(ctx, 'SPLASH!', Sc.w / 2, Sc.h * 0.3, Math.max(8, size), { fill: '#bdf0ff', shadow: size * 0.05, lw: size * 0.16 });
}

// ---------------------------------------------------------------- HUD while playing

/**
 * st: { round, rounds, dots: [{color, out, me}], timeLeft (ms), score, kos, out, spectating, warn, hintBoost, t, outAge }
 */
export function drawHud(ctx, Sc, st) {
  base(ctx, Sc);
  const u = unit(Sc);
  const y0 = st.spectating ? 40 : 8; // the platform's "Watching" note sits at the top centre
  const ls = clamp(u * 0.95, 14, 22);
  text(ctx, `ROUND ${st.round}/${st.rounds}`, Sc.w / 2, y0 + ls * 0.7, ls, { lw: ls * 0.26 });
  // one dot per car: alive in its colour, out greyed with a cross
  const r = clamp(u * 0.42, 6, 11);
  const step = r * 2 + 5;
  const rowW = st.dots.length * step - 5;
  const dy = y0 + ls * 1.4 + r + 3;
  st.dots.forEach((d, i) => {
    const dx = Sc.w / 2 - rowW / 2 + r + i * step;
    circle(ctx, dx, dy, r);
    ctx.fillStyle = d.out ? '#8a93b8' : d.color;
    ctx.fill();
    ctx.lineWidth = d.me ? 4 : 2.5;
    ctx.strokeStyle = d.me ? '#ffffff' : DARK;
    ctx.stroke();
    if (d.me) {
      circle(ctx, dx, dy, r + 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = DARK;
      ctx.stroke();
    }
    if (d.out) {
      ctx.beginPath();
      ctx.moveTo(dx - r * 0.5, dy - r * 0.5);
      ctx.lineTo(dx + r * 0.5, dy + r * 0.5);
      ctx.moveTo(dx + r * 0.5, dy - r * 0.5);
      ctx.lineTo(dx - r * 0.5, dy + r * 0.5);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = DARK;
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  });
  let bottom = dy + r + 4;
  if (st.timeLeft < 30000) {
    const secs = Math.max(0, Math.ceil(st.timeLeft / 1000));
    const ts = clamp(u * 1.3, 18, 30);
    const hot = secs <= 10 && !Sc.reduced && Math.floor(st.t * 3) % 2 === 0;
    text(ctx, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, Sc.w / 2, bottom + ts * 0.6, ts, { fill: hot ? '#ff6a6a' : '#ffffff', lw: ts * 0.24 });
    bottom += ts * 1.2;
  }
  if (st.warn) {
    const ws = clamp(u * 1.5, 20, 40) * (Sc.reduced ? 1 : 1 + 0.04 * Math.sin(st.t * 12));
    text(ctx, 'RINK SHRINKING!', Sc.w / 2, bottom + ws * 0.8, ws, { fill: '#ffe14a', stroke: '#8c1020', lw: ws * 0.26, shadow: ws * 0.05 });
  }
  // top right: your points (and knockouts), or Watching
  const ph = clamp(u * 2.3, 44, 58);
  if (st.spectating) {
    const pw = clamp(u * 7.6, 140, 210);
    const x = Sc.w - 12 - pw;
    plate(ctx, x, 10, pw, ph, ph * 0.3, '#ffffff', { shadow: 4, lw: 3 });
    iconEye(ctx, x + ph * 0.6, 10 + ph / 2, ph * 0.3);
    text(ctx, 'WATCHING', x + pw - 12, 10 + ph / 2, ph * 0.34, { align: 'right', fill: DARK, stroke: '#ffffff', lw: ph * 0.1 });
  } else {
    const pw = clamp(u * 5.6, 104, 160);
    const x = Sc.w - 12 - pw;
    plate(ctx, x, 10, pw, ph, ph * 0.3, '#ffffff', { shadow: 4, lw: 3 });
    iconStar(ctx, x + ph * 0.58, 10 + ph / 2, ph * 0.3);
    text(ctx, String(st.score), x + pw - 14, 10 + ph / 2, ph * 0.62, { align: 'right', fill: DARK, stroke: '#ffffff', lw: ph * 0.14 });
    let ry = 10 + ph + 8;
    if (st.kos > 0) {
      const kh = ph * 0.7;
      const kw = pw * 0.7;
      plate(ctx, Sc.w - 12 - kw, ry, kw, kh, kh * 0.3, '#ffffff', { shadow: 3, lw: 3 });
      iconGlove(ctx, Sc.w - 12 - kw + kh * 0.55, ry + kh / 2, kh * 0.32);
      text(ctx, `×${st.kos}`, Sc.w - 12 - 12, ry + kh / 2, kh * 0.6, { align: 'right', fill: DARK, stroke: '#ffffff', lw: kh * 0.14 });
      ry += kh + 8;
    }
    if (st.out) {
      const os = ph * 0.5;
      text(ctx, 'OUT', Sc.w - 12 - pw / 2, ry + os * 0.6, os, { fill: '#ff6a6a', lw: os * 0.26 });
    }
  }
  if (st.outAge !== undefined && st.outAge >= 0 && st.outAge < 1.6) drawSplashWord(ctx, Sc, st.outAge);
}

/** A "SPACE: boost" key shown at the bottom centre to keyboard players until they have boosted once. */
export function drawKeyHint(ctx, Sc, t) {
  base(ctx, Sc);
  const u = unit(Sc);
  const kh = clamp(u * 2.1, 40, 56);
  const kw = kh * 3.1;
  const x = Sc.w / 2 - kw / 2;
  const y = Sc.h - kh - 16 - (Math.sin(t * 6) * 0.5 + 0.5) * 4;
  plate(ctx, x, y, kw, kh, kh * 0.25, '#ffffff', { shadow: 5, lw: 3 });
  text(ctx, 'SPACE', x + kw / 2, y + kh / 2, kh * 0.4, { fill: DARK, stroke: '#ffffff', lw: kh * 0.1 });
  text(ctx, 'BOOST!', Sc.w / 2, y - kh * 0.45, kh * 0.5, { fill: '#ffe14a', lw: kh * 0.14 });
}

// ---------------------------------------------------------------- the scoreboard between rounds

/**
 * st: { rows: [{id, name, bot, color, me, prevTotal, total, pts, prevRank, rank}] (any order), round, age }
 * Rows start in last round's order, count up, and slide into the new order.
 */
export function drawBoard(ctx, Sc, st) {
  base(ctx, Sc);
  const { w, h } = Sc;
  const u = unit(Sc);
  ctx.fillStyle = 'rgba(10,25,70,0.62)';
  ctx.fillRect(0, 0, w, h);
  const hs = clamp(u * 1.7, 22, 40);
  const hy = clamp(h * 0.1, 30, 56);
  text(ctx, `ROUND ${st.round}`, w / 2, hy, hs * easeOutBack(clamp(st.age * 4, 0, 1)), { lw: hs * 0.22, shadow: hs * 0.05 });
  const n = st.rows.length;
  const top = hy + hs * 0.9;
  const rowH = clamp((h - top - 20) / Math.max(1, n), 22, 46);
  const rowW = clamp(w * 0.66, 300, 600);
  const x0 = w / 2 - rowW / 2;
  const slide = easeInOut((st.age - 0.9) / 0.8);
  const rows = st.rows.slice().sort((a, b) => a.rank - b.rank);
  rows.forEach((row) => {
    const appear = easeOutBack(clamp((st.age - 0.05 - row.prevRank * 0.04) / 0.25, 0, 1));
    if (appear <= 0.01) return;
    const y = top + lerp(row.prevRank, row.rank, slide) * rowH;
    const ox = (1 - appear) * -80;
    plate(ctx, x0 + ox, y + 2, rowW, rowH - 5, rowH * 0.3, row.me ? '#ffe14a' : '#ffffff', { shadow: 3, lw: 3 });
    const mid = y + 2 + (rowH - 5) / 2;
    const place = Math.round(lerp(row.prevRank, row.rank, slide)) + 1;
    text(ctx, String(place), x0 + ox + rowH * 0.5, mid, rowH * 0.5, { fill: DARK, stroke: '#ffffff', lw: rowH * 0.12 });
    const hr = (rowH - 5) * 0.38;
    const hx = x0 + ox + rowH * 1.3;
    ctx.lineWidth = 4;
    ctx.strokeStyle = row.color;
    circle(ctx, hx, mid, hr + 2);
    ctx.stroke();
    drawHead(ctx, row.id, hx, mid, hr, row.bot, 2);
    const ns = rowH * 0.5;
    const tot = Math.round(lerp(row.prevTotal, row.total, easeOutCubic((st.age - 0.35) / 0.8)));
    ctx.font = font(rowH * 0.62);
    const totW = ctx.measureText(String(tot)).width;
    text(ctx, fit(ctx, row.name, ns, rowW - rowH * 1.9 - totW - 90), x0 + ox + rowH * 1.9, mid, ns, { align: 'left', fill: DARK, stroke: '#ffffff', lw: ns * 0.26 });
    text(ctx, String(tot), x0 + ox + rowW - 14, mid, rowH * 0.62, { align: 'right', fill: DARK, stroke: '#ffffff', lw: rowH * 0.15 });
    const pk = easeOutBack(clamp((st.age - 0.3 - row.prevRank * 0.05) / 0.3, 0, 1));
    if (row.pts > 0 && pk > 0.01) {
      text(ctx, `+${row.pts}`, x0 + ox + rowW - 14 - totW - 14, mid, ns * 0.95 * pk, { align: 'right', fill: '#1fb44f', stroke: '#ffffff', lw: ns * 0.3 });
    }
  });
}

// ---------------------------------------------------------------- the winner of a round, and the match podium

/** st: { id, name, bot, me, color, age } */
export function drawEnd(ctx, Sc, st) {
  const label = st.me ? 'YOU WIN!' : `${st.name} WINS!`;
  drawRibbon(ctx, Sc, label, '', st.age, 2.4, '#27b85a', 0.26, Sc.reduced);
  if (st.age > 0.25 && st.age < 2.15) {
    const u = unit(Sc);
    const r = clamp(u * 1.5, 24, 50);
    const k = easeOutBack(clamp((st.age - 0.25) * 4, 0, 1));
    const cx = Sc.w / 2;
    const cy = Sc.h * 0.26 + clamp(u * 3.6, 62, 118) * 0.5 + r * 1.15;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    ctx.lineWidth = 5;
    ctx.strokeStyle = st.color;
    circle(ctx, 0, 0, r + 2);
    ctx.stroke();
    drawHead(ctx, st.id, 0, 0, r, st.bot, 3);
    iconCrown(ctx, 0, -r - r * 0.55, r * 0.55);
    ctx.restore();
  }
}

const AWARDS = [
  { key: 'wrecking', label: 'WRECKING BALL', icon: iconBall },
  { key: 'slippery', label: 'SLIPPERY', icon: iconDrop },
];

/** st: { top: [{id,name,bot,color,score,me}], you: {place, score}|null, awards: {wrecking, slippery}, age } */
export function drawPodium(ctx, Sc, st) {
  base(ctx, Sc);
  const { w, h } = Sc;
  const u = unit(Sc);
  ctx.fillStyle = 'rgba(10,25,70,0.6)';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const bw = clamp(w * 0.17, 96, 180);
  const gx = bw * 0.1;
  const baseY = h * 0.84;
  const heights = [h * 0.27, h * 0.2, h * 0.145];
  const fills = ['#ffd21f', '#d5dcec', '#ff9a4d'];
  const delays = [1.5, 0.9, 0.3];
  const slots = [1, 0, 2]; // 2nd, 1st, 3rd from left to right
  slots.forEach((place, i) => {
    const p = st.top[place];
    if (!p) return;
    const k = easeOutBack(clamp((st.age - delays[place]) / 0.5, 0, 1));
    if (k <= 0.01) return;
    const x = cx + (i - 1) * (bw + gx) - bw / 2;
    const bh = heights[place] * k;
    const top = baseY - bh;
    plate(ctx, x, top, bw, bh + 8, 12, fills[place], { shadow: 5, lw: 4 });
    text(ctx, String(place + 1), x + bw / 2, top + Math.min(bh * 0.4, bw * 0.3), bw * 0.34, { lw: bw * 0.07 });
    text(ctx, String(p.score), x + bw / 2, top + Math.min(bh * 0.4, bw * 0.3) + bw * 0.28, bw * 0.19, { fill: DARK, stroke: '#ffffff', lw: bw * 0.05 });
    const r = bw * 0.3;
    const jump = place === 0 && !Sc.reduced ? Math.abs(Math.sin(st.age * 4)) * r * 0.25 : 0;
    const hy = top - r * 1.05 - jump;
    ctx.lineWidth = 5;
    ctx.strokeStyle = p.color;
    circle(ctx, x + bw / 2, hy, r + 2.5);
    ctx.stroke();
    drawHead(ctx, p.id, x + bw / 2, hy, r, p.bot, 3);
    if (place === 0) iconCrown(ctx, x + bw / 2, hy - r - r * 0.5, r * 0.6);
    const ns = clamp(bw * 0.15, 13, 20);
    text(ctx, fit(ctx, p.name, ns, bw * 1.3), x + bw / 2, hy - r - (place === 0 ? r * 1.35 : r * 0.6) - 4, ns, { lw: ns * 0.26 });
  });
  // the two fun awards across the top
  const have = AWARDS.filter((a) => st.awards?.[a.key]);
  if (have.length && st.age > 2.4) {
    const k = easeOutBack(clamp((st.age - 2.4) / 0.4, 0, 1));
    const ph = clamp(u * 2.4, 44, 58);
    const pw = Math.min(250, (w - 150) / Math.max(1, have.length) - 10);
    const total = have.length * pw + (have.length - 1) * 10;
    let x = Math.max(w / 2 - total / 2, 140);
    for (const a of have) {
      const who = st.awards[a.key];
      ctx.save();
      ctx.translate(x + pw / 2, 10 + ph / 2);
      ctx.scale(k, k);
      ctx.translate(-(x + pw / 2), -(10 + ph / 2));
      plate(ctx, x, 10, pw, ph, ph * 0.3, '#ffffff', { shadow: 4, lw: 3 });
      a.icon(ctx, x + ph * 0.5, 10 + ph / 2, ph * 0.3);
      const ls = clamp(ph * 0.28, 11, 15);
      text(ctx, a.label, x + ph * 0.95, 10 + ph * 0.32, ls, { align: 'left', fill: '#e8283c', stroke: '#ffffff', lw: ls * 0.26 });
      text(ctx, fit(ctx, who.name, ls * 1.15, pw - ph * 1.05), x + ph * 0.95, 10 + ph * 0.72, ls * 1.15, { align: 'left', fill: DARK, stroke: '#ffffff', lw: ls * 0.28 });
      ctx.restore();
      x += pw + 10;
    }
  }
  if (st.you && st.you.place > 3) {
    const ph = clamp(u * 2.2, 42, 56);
    const pw = clamp(u * 9, 170, 260);
    const k = easeOutBack(clamp((st.age - 1.2) / 0.4, 0, 1));
    ctx.save();
    ctx.translate(cx, h - 12 - ph / 2);
    ctx.scale(k, k);
    plate(ctx, -pw / 2, -ph / 2, pw, ph, ph * 0.3, '#ffe14a', { shadow: 4, lw: 3 });
    text(ctx, `YOU: ${ordinal(st.you.place)}`, 0, 0, ph * 0.5, { lw: ph * 0.12 });
    ctx.restore();
  }
}


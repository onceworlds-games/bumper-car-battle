// Painted icons for the HUD, the map and the cards: a bust of each costume (mask, hat and colours, so a troupe never
// depends on colour alone), the ability glyphs, the poise fan and the answer ring. Drawn on canvas, crisp at any
// pixel ratio, cached.
import { TROUPES } from '../sim/const.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const shade = (n, k) => {
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
};
const cache = new Map();

export function makeCanvas(css, cls, cssH = css) {
  const c = document.createElement('canvas');
  const pr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  c.width = Math.round(css * pr);
  c.height = Math.round(cssH * pr);
  c.style.width = `${css}px`;
  c.style.height = `${cssH}px`;
  if (cls) c.className = cls;
  const g = c.getContext('2d');
  g.setTransform(pr, 0, 0, pr, 0, 0);
  return [c, g];
}

/** Draws a costume bust centred in a box of size s at (x, y) (top-left). */
export function drawBust(g, tr, x, y, s, { off = false } = {}) {
  const t = TROUPES[tr] || TROUPES[0];
  const u = s / 100;
  g.save();
  g.translate(x, y);
  g.lineJoin = 'round';
  // Shoulders.
  g.fillStyle = hex(t.robe);
  if (t.id === 'jolly') {
    g.fillStyle = hex(t.robe);
    g.beginPath();
    g.moveTo(50 * u, 66 * u);
    g.lineTo(16 * u, 78 * u);
    g.quadraticCurveTo(10 * u, 96 * u, 12 * u, 100 * u);
    g.lineTo(50 * u, 100 * u);
    g.fill();
    g.fillStyle = hex(t.trim);
    g.beginPath();
    g.moveTo(50 * u, 66 * u);
    g.lineTo(84 * u, 78 * u);
    g.quadraticCurveTo(90 * u, 96 * u, 88 * u, 100 * u);
    g.lineTo(50 * u, 100 * u);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(22 * u, 100 * u);
    g.quadraticCurveTo(10 * u, 80 * u, 30 * u, 72 * u);
    g.lineTo(70 * u, 72 * u);
    g.quadraticCurveTo(90 * u, 80 * u, 78 * u, 100 * u);
    g.closePath();
    g.fill();
    if (t.id === 'arlecchino') {
      g.save();
      g.clip();
      g.fillStyle = hex(t.trim);
      for (let i = -2; i < 6; i++) {
        g.beginPath();
        g.moveTo((20 + i * 16) * u, 86 * u);
        g.lineTo((28 + i * 16) * u, 74 * u);
        g.lineTo((36 + i * 16) * u, 86 * u);
        g.lineTo((28 + i * 16) * u, 98 * u);
        g.fill();
      }
      g.restore();
    }
  }
  if (t.id === 'volto' || t.id === 'arlecchino' || t.id === 'jolly') {
    g.fillStyle = t.id === 'jolly' ? hex(0xf2b544) : '#f6efe0';
    g.beginPath();
    g.ellipse(50 * u, 70 * u, 20 * u, 6 * u, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Head (the cowl).
  g.fillStyle = shade(t.robe, 0.75);
  g.beginPath();
  g.arc(50 * u, 46 * u, 22 * u, 0, Math.PI * 2);
  g.fill();
  // The mask.
  if (!off) {
    g.fillStyle = hex(t.mask);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1.2 * u;
    const eyes = (col = '#1a1414') => {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(42 * u, 44 * u, 4 * u, 2.6 * u, 0.1, 0, Math.PI * 2);
      g.ellipse(58 * u, 44 * u, 4 * u, 2.6 * u, -0.1, 0, Math.PI * 2);
      g.fill();
    };
    switch (t.id) {
      case 'medico':
        g.beginPath();
        g.ellipse(50 * u, 46 * u, 18 * u, 19 * u, 0, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.moveTo(48 * u, 50 * u);
        g.quadraticCurveTo(70 * u, 52 * u, 92 * u, 70 * u);
        g.quadraticCurveTo(68 * u, 62 * u, 50 * u, 60 * u);
        g.fill();
        g.stroke();
        g.fillStyle = '#c89a3a';
        g.beginPath();
        g.arc(42 * u, 42 * u, 4.5 * u, 0, Math.PI * 2);
        g.arc(57 * u, 42 * u, 4.5 * u, 0, Math.PI * 2);
        g.fill();
        break;
      case 'arlecchino':
      case 'colombina':
      case 'jolly':
        g.beginPath();
        g.moveTo(28 * u, 42 * u);
        g.quadraticCurveTo(50 * u, 30 * u, 72 * u, 42 * u);
        g.quadraticCurveTo(66 * u, 54 * u, 50 * u, 48 * u);
        g.quadraticCurveTo(34 * u, 54 * u, 28 * u, 42 * u);
        g.fill();
        eyes(t.id === 'arlecchino' ? '#f2b544' : '#1a1414');
        break;
      case 'moretta':
        g.beginPath();
        g.ellipse(50 * u, 47 * u, 15 * u, 19 * u, 0, 0, Math.PI * 2);
        g.fill();
        eyes('#3a6e72');
        break;
      case 'volto':
      case 'gatto':
      case 'bauta':
        g.beginPath();
        if (t.id === 'bauta') {
          g.moveTo(31 * u, 36 * u);
          g.quadraticCurveTo(50 * u, 22 * u, 69 * u, 36 * u);
          g.lineTo(70 * u, 60 * u);
          g.lineTo(62 * u, 70 * u);
          g.lineTo(38 * u, 70 * u);
          g.lineTo(30 * u, 60 * u);
          g.closePath();
        } else g.ellipse(50 * u, 47 * u, 19 * u, 21 * u, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        eyes();
        if (t.id === 'gatto') {
          g.fillStyle = '#231d1f';
          g.beginPath();
          g.moveTo(47 * u, 52 * u);
          g.lineTo(53 * u, 52 * u);
          g.lineTo(50 * u, 56 * u);
          g.fill();
        }
        if (t.id === 'volto') {
          g.fillStyle = hex(t.trim);
          g.beginPath();
          g.moveTo(50 * u, 30 * u);
          g.lineTo(53 * u, 34 * u);
          g.lineTo(50 * u, 38 * u);
          g.lineTo(47 * u, 34 * u);
          g.fill();
        }
        break;
      default:
        break;
    }
  } else {
    // Unmasked: a surprised face.
    g.fillStyle = '#e8b896';
    g.beginPath();
    g.ellipse(50 * u, 47 * u, 17 * u, 19 * u, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a1414';
    g.beginPath();
    g.arc(43 * u, 44 * u, 2.5 * u, 0, Math.PI * 2);
    g.arc(57 * u, 44 * u, 2.5 * u, 0, Math.PI * 2);
    g.ellipse(50 * u, 56 * u, 3.5 * u, 4.5 * u, 0, 0, Math.PI * 2);
    g.fill();
  }
  // The hat: the troupe's silhouette.
  g.fillStyle = '#15110f';
  switch (t.id) {
    case 'medico':
      g.beginPath();
      g.ellipse(50 * u, 27 * u, 34 * u, 6 * u, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(36 * u, 10 * u, 28 * u, 17 * u);
      break;
    case 'arlecchino':
      for (const [dx, a, col] of [
        [0, 0, t.trim],
        [-17, -0.7, t.robe],
        [17, 0.7, t.robe],
      ]) {
        g.save();
        g.translate((50 + dx) * u, 26 * u);
        g.rotate(a);
        g.fillStyle = hex(col);
        g.beginPath();
        g.moveTo(-8 * u, 4 * u);
        g.lineTo(0, -24 * u);
        g.lineTo(8 * u, 4 * u);
        g.fill();
        g.restore();
      }
      break;
    case 'moretta':
      g.fillStyle = hex(t.trim);
      g.fillRect(38 * u, 18 * u, 24 * u, 8 * u);
      g.fillStyle = 'rgba(16,29,34,0.85)';
      g.beginPath();
      g.moveTo(30 * u, 26 * u);
      g.quadraticCurveTo(50 * u, 18 * u, 70 * u, 26 * u);
      g.lineTo(76 * u, 62 * u);
      g.lineTo(70 * u, 40 * u);
      g.quadraticCurveTo(50 * u, 30 * u, 30 * u, 40 * u);
      g.lineTo(24 * u, 62 * u);
      g.closePath();
      g.fill();
      break;
    case 'volto':
      g.fillStyle = hex(t.robe);
      g.fillRect(40 * u, 0, 20 * u, 26 * u);
      g.fillStyle = hex(t.trim);
      g.fillRect(38 * u, 22 * u, 24 * u, 5 * u);
      g.fillRect(40 * u, 2 * u, 20 * u, 3 * u);
      break;
    case 'colombina':
      for (const [dx, a, col] of [
        [8, -0.35, 0xf6d6b8],
        [2, 0.05, 0xd8a032],
        [-6, 0.4, 0xb3263a],
      ]) {
        g.save();
        g.translate((56 + dx) * u, 26 * u);
        g.rotate(a);
        g.fillStyle = hex(col);
        g.beginPath();
        g.ellipse(0, -14 * u, 5 * u, 16 * u, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      break;
    case 'gatto':
      g.fillStyle = hex(t.mask);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo((50 + side * 6) * u, 28 * u);
        g.lineTo((50 + side * 18) * u, 8 * u);
        g.lineTo((50 + side * 20) * u, 32 * u);
        g.fill();
      }
      break;
    case 'bauta':
      g.fillStyle = '#0f1420';
      g.beginPath();
      g.moveTo(16 * u, 26 * u);
      g.lineTo(50 * u, 12 * u);
      g.lineTo(84 * u, 26 * u);
      g.lineTo(50 * u, 32 * u);
      g.closePath();
      g.fill();
      g.strokeStyle = hex(0xd8a032);
      g.lineWidth = 1.6 * u;
      g.stroke();
      break;
    case 'jolly':
      for (const side of [-1, 1]) {
        g.fillStyle = hex(side < 0 ? t.trim : t.robe);
        g.beginPath();
        g.moveTo((50 + side * 4) * u, 26 * u);
        g.quadraticCurveTo((50 + side * 26) * u, 22 * u, (50 + side * 34) * u, 6 * u);
        g.quadraticCurveTo((50 + side * 22) * u, 30 * u, (50 + side * 12) * u, 32 * u);
        g.fill();
        g.fillStyle = '#f2b544';
        g.beginPath();
        g.arc((50 + side * 34) * u, 6 * u, 4 * u, 0, Math.PI * 2);
        g.fill();
      }
      break;
    default:
      break;
  }
  g.restore();
}

/** A cached bust canvas for the DOM (a fresh node each call, painted from a cached bitmap). */
export function bust(tr, css = 52, opts = {}) {
  const key = `${tr}:${css}:${opts.off ? 1 : 0}`;
  let src = cache.get(key);
  if (!src) {
    const [c, g] = makeCanvas(css);
    drawBust(g, tr, 0, 0, css, opts);
    src = c;
    cache.set(key, c);
  }
  const [c, g] = makeCanvas(css, opts.cls);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(src, 0, 0);
  return c;
}

/** Ability glyphs, cream on dark. */
export function drawGlyph(g, id, s) {
  const u = s / 40;
  g.save();
  g.strokeStyle = '#f1e3c8';
  g.fillStyle = '#f1e3c8';
  g.lineWidth = 2.4 * u;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  switch (id) {
    case 'smoke':
      for (const [x, y, r] of [
        [14, 24, 8],
        [24, 18, 10],
        [28, 27, 7],
      ]) {
        g.beginPath();
        g.arc(x * u, y * u, r * u, 0, Math.PI * 2);
        g.globalAlpha = 0.85;
        g.fill();
      }
      break;
    case 'decoy':
      for (const [x, a] of [
        [14, 0.45],
        [26, 1],
      ]) {
        g.globalAlpha = a;
        g.beginPath();
        g.arc(x * u, 13 * u, 5 * u, 0, Math.PI * 2);
        g.moveTo((x - 8) * u, 34 * u);
        g.lineTo(x * u, 18 * u);
        g.lineTo((x + 8) * u, 34 * u);
        g.closePath();
        g.fill();
      }
      break;
    case 'opera':
      g.beginPath();
      g.arc(13 * u, 21 * u, 7 * u, 0, Math.PI * 2);
      g.moveTo(34 * u, 21 * u);
      g.arc(27 * u, 21 * u, 7 * u, 0, Math.PI * 2);
      g.moveTo(17 * u, 15 * u);
      g.lineTo(23 * u, 15 * u);
      g.moveTo(30 * u, 27 * u);
      g.lineTo(34 * u, 37 * u);
      g.stroke();
      break;
    case 'lantern':
      g.fillStyle = '#f2b544';
      g.beginPath();
      g.ellipse(20 * u, 22 * u, 10 * u, 12 * u, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1a1414';
      g.lineWidth = 1.4 * u;
      for (const y of [16, 22, 28]) {
        g.beginPath();
        g.moveTo(11 * u, y * u);
        g.lineTo(29 * u, y * u);
        g.stroke();
      }
      g.strokeStyle = '#f1e3c8';
      g.lineWidth = 2.4 * u;
      g.beginPath();
      g.moveTo(20 * u, 4 * u);
      g.lineTo(20 * u, 10 * u);
      g.stroke();
      break;
    case 'swap':
      g.beginPath();
      g.arc(20 * u, 20 * u, 11 * u, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
      g.beginPath();
      g.arc(20 * u, 20 * u, 11 * u, Math.PI * 0.1, Math.PI * 0.9);
      g.stroke();
      for (const [x, y, a] of [
        [30, 15, 0.6],
        [10, 25, Math.PI + 0.6],
      ]) {
        g.save();
        g.translate(x * u, y * u);
        g.rotate(a);
        g.beginPath();
        g.moveTo(-4 * u, -3 * u);
        g.lineTo(2 * u, 0);
        g.lineTo(-4 * u, 4 * u);
        g.stroke();
        g.restore();
      }
      break;
    default:
      g.beginPath();
      g.arc(20 * u, 20 * u, 8 * u, 0, Math.PI * 2);
      g.stroke();
  }
  g.restore();
}

export function glyph(id, css = 34) {
  const [c, g] = makeCanvas(css);
  drawGlyph(g, id, css);
  return c;
}

/** The poise fan: ribs that fill with gold; red and trembling when flustered. */
export function drawFan(g, w, h, poise, flustered, time) {
  g.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h - 6;
  const R = Math.min(w / 2 - 4, h - 10);
  const ribs = 14;
  const filled = (poise / 100) * ribs;
  for (let i = 0; i < ribs; i++) {
    const a0 = Math.PI + (i / ribs) * Math.PI;
    const a1 = Math.PI + ((i + 1) / ribs) * Math.PI;
    const k = Math.max(0, Math.min(1, filled - i));
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, a0 + 0.02, a1 - 0.02);
    g.closePath();
    g.fillStyle = flustered ? `hsl(${(time * 300 + i * 25) % 360} 70% 60% / 0.85)` : k > 0 ? `rgba(242,181,68,${0.25 + 0.75 * k})` : 'rgba(26,20,20,0.82)';
    g.fill();
    g.strokeStyle = 'rgba(26,20,20,0.9)';
    g.lineWidth = 1.5;
    g.stroke();
  }
  g.beginPath();
  g.arc(cx, cy, R, Math.PI, 0);
  g.strokeStyle = '#f2b544';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = '#9e1b32';
  g.beginPath();
  g.arc(cx, cy, 9, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f2b544';
  g.stroke();
}

/** The answer ring: it sweeps for 1.6 s; the good window (0.4 to 1.4 s) is the gold arc. */
export function drawRing(g, s, elapsed) {
  g.clearRect(0, 0, s, s);
  const c = s / 2;
  const R = s / 2 - 10;
  const A = (sec) => -Math.PI / 2 + (sec / 1.6) * Math.PI * 2;
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(26,20,20,0.7)';
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(242,181,68,0.85)';
  g.beginPath();
  g.arc(c, c, R, A(0.4), A(1.4));
  g.stroke();
  g.strokeStyle = '#f1e3c8';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(c, c, R, A(0), A(Math.min(1.6, elapsed)));
  g.stroke();
}

/** A face for a fallen mask: round, caught out, a hint of the cowl round it. Skin tones vary by seed. */
export function drawFace(g, s, seed = 0) {
  const tones = ['#f2c9a0', '#e0ac7e', '#c68b5e', '#9a6440', '#f6d8bd', '#b07850'];
  const u = s / 100;
  g.clearRect(0, 0, s, s);
  g.fillStyle = '#2a1f1d';
  g.beginPath();
  g.arc(50 * u, 50 * u, 48 * u, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = tones[Math.abs(seed) % tones.length];
  g.beginPath();
  g.ellipse(50 * u, 55 * u, 33 * u, 37 * u, 0, 0, Math.PI * 2);
  g.fill();
  // Raised brows, wide eyes, a small round mouth: caught.
  g.strokeStyle = '#2a1f1d';
  g.lineWidth = 3 * u;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(30 * u, 36 * u);
  g.quadraticCurveTo(37 * u, 30 * u, 44 * u, 35 * u);
  g.moveTo(56 * u, 35 * u);
  g.quadraticCurveTo(63 * u, 30 * u, 70 * u, 36 * u);
  g.stroke();
  g.fillStyle = '#fbf6ea';
  g.beginPath();
  g.ellipse(37 * u, 48 * u, 6 * u, 5 * u, 0, 0, Math.PI * 2);
  g.ellipse(63 * u, 48 * u, 6 * u, 5 * u, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1414';
  g.beginPath();
  g.arc(37 * u, 48 * u, 2.8 * u, 0, Math.PI * 2);
  g.arc(63 * u, 48 * u, 2.8 * u, 0, Math.PI * 2);
  g.ellipse(50 * u, 72 * u, 4 * u, 5 * u, 0, 0, Math.PI * 2);
  g.fill();
}

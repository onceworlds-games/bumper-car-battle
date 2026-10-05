// Small drawing helpers shared by every screen: colours, easing, outlined text. Nothing here touches the page at import time.

export const TAU = Math.PI * 2;
export const FONT = "'Bungee', 'Impact', 'Arial Black', system-ui, sans-serif";
export const DARK = '#1b1f3b'; // the outline colour of everything

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInCubic = (t) => Math.pow(clamp(t, 0, 1), 3);
export const easeInOut = (t) => {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
/** Overshoots past 1 and settles: a pop. */
export const easeOutBack = (t, s = 1.70158) => {
  t = clamp(t, 0, 1) - 1;
  return 1 + (s + 1) * t * t * t + s * t * t;
};

const rgbCache = new Map();
export function hexRgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, c);
  }
  return c;
}

const shadeCache = new Map();
/** A lighter (amt > 0) or darker (amt < 0) copy of a #rrggbb colour. */
export function shade(hex, amt) {
  const key = hex + amt;
  let out = shadeCache.get(key);
  if (!out) {
    const [r, g, b] = hexRgb(hex);
    const t = amt < 0 ? 0 : 255;
    const k = Math.abs(amt);
    out = `rgb(${Math.round(r + (t - r) * k)},${Math.round(g + (t - g) * k)},${Math.round(b + (t - b) * k)})`;
    shadeCache.set(key, out);
  }
  return out;
}

export function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${Math.round(clamp(a, 0, 1) * 100) / 100})`;
}

const fontCache = new Map();
export function font(px) {
  const k = Math.max(6, Math.round(px));
  let f = fontCache.get(k);
  if (!f) {
    f = `${k}px ${FONT}`;
    fontCache.set(k, f);
  }
  return f;
}

/**
 * White text with a thick dark outline (and an optional solid drop shadow). o: { fill, stroke, lw, align, base, shadow, alpha }.
 * Names and anything else from other players go through here: it only ever calls fillText/strokeText.
 */
export function text(ctx, str, x, y, size, o = {}) {
  if (o.alpha !== undefined && o.alpha <= 0) return;
  const prev = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = prev * o.alpha;
  ctx.font = font(size);
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.base || 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const lw = o.lw ?? Math.max(3, size * 0.18);
  if (o.shadow) {
    ctx.fillStyle = o.shadowColor || DARK;
    ctx.strokeStyle = o.shadowColor || DARK;
    ctx.lineWidth = lw;
    ctx.strokeText(str, x + o.shadow, y + o.shadow);
    ctx.fillText(str, x + o.shadow, y + o.shadow);
  }
  ctx.strokeStyle = o.stroke || DARK;
  ctx.lineWidth = lw;
  ctx.strokeText(str, x, y);
  ctx.fillStyle = o.fill || '#ffffff';
  ctx.fillText(str, x, y);
  ctx.globalAlpha = prev;
}

/** The text shortened with an ellipsis to fit `maxW` pixels at this size. */
export function fit(ctx, str, size, maxW) {
  ctx.font = font(size);
  if (ctx.measureText(str).width <= maxW) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** A chunky button/plate: a solid drop shadow block, a dark outline, a flat fill. */
export function plate(ctx, x, y, w, h, r, fill, o = {}) {
  const off = o.shadow ?? Math.max(3, h * 0.08);
  const lw = o.lw ?? Math.max(3, h * 0.07);
  ctx.lineJoin = 'round';
  roundRect(ctx, x, y + off, w, h, r);
  ctx.fillStyle = o.shadowColor || shade(fill, -0.45);
  ctx.fill();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = DARK;
  ctx.stroke();
  if (o.shine) {
    roundRect(ctx, x + lw, y + lw, w - lw * 2, h * 0.42, r * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();
  }
}

/** A star burst polygon path (for BONK clouds and badges). */
export function starPath(ctx, x, y, r1, r2, points, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = rot + (Math.PI * i) / points;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

/** A tick mark in a round green badge (READY). */
export function drawCheck(ctx, x, y, size, pop = 1) {
  const s = size * pop;
  ctx.save();
  ctx.translate(x, y);
  circle(ctx, 0, s * 0.06, s * 0.5);
  ctx.fillStyle = shade('#27c95a', -0.4);
  ctx.fill();
  circle(ctx, 0, 0, s * 0.5);
  ctx.fillStyle = '#27c95a';
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, s * 0.1);
  ctx.strokeStyle = DARK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, 0);
  ctx.lineTo(-s * 0.05, s * 0.17);
  ctx.lineTo(s * 0.25, -s * 0.17);
  ctx.lineWidth = Math.max(3, s * 0.16);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();
}

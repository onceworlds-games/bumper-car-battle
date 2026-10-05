// The driver's head: the player's platform avatar when it has loaded, else a cute generated face (always, for bots).
// Images are loaded once per id and cached; a failed or missing avatar just keeps the generated face.

import { DARK, TAU, circle } from './gfx.js';
import { hashStr } from './rng.js';

const cache = new Map(); // id -> { img, ok }
let lookup = null;

/** `getUrl(id)` resolves with an avatar URL or null (ow.player.avatarUrl(id, 'head')). Never call it for bots. */
export function initAvatars(getUrl) {
  lookup = typeof getUrl === 'function' ? getUrl : null;
}

/** The loaded avatar image for a player, or null (and the load is started the first time). */
export function headImage(id) {
  let e = cache.get(id);
  if (!e) {
    e = { img: null, ok: false };
    cache.set(id, e);
    if (lookup && typeof Image !== 'undefined') {
      Promise.resolve()
        .then(() => lookup(id))
        .then((url) => {
          if (!url || typeof url !== 'string') return;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            e.ok = true;
          };
          img.onerror = () => {
            e.ok = false;
          };
          e.img = img;
          img.src = url;
        })
        .catch(() => {});
    }
  }
  return e.ok ? e.img : null;
}

const SKIN = ['#ffd9b3', '#f6c28b', '#e0a070', '#c68642', '#a8693a', '#ffe0bd'];
const BOT_SKIN = ['#ffe58a', '#ffc6e0', '#bfeaff', '#d2ffb8', '#e2d0ff', '#ffd0a8', '#a8f0e0'];

/** A round cartoon face: eyes, mouth and cheeks from the seed. Sizes are all relative to r, so it works in world units or pixels. */
export function drawFace(ctx, x, y, r, seed, bot = false) {
  const palette = bot ? BOT_SKIN : SKIN;
  const h = hashStr(String(seed));
  const mouth = (h >>> 3) % 4;
  ctx.save();
  ctx.translate(x, y);
  circle(ctx, 0, 0, r);
  ctx.fillStyle = palette[h % palette.length];
  ctx.fill();
  ctx.lineWidth = r * 0.2;
  ctx.strokeStyle = DARK;
  ctx.stroke();
  // eyes
  ctx.fillStyle = DARK;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.34, -r * 0.1, r * 0.13, r * 0.2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  for (const s of [-1, 1]) {
    circle(ctx, s * r * 0.34 + r * 0.04, -r * 0.18, r * 0.05);
    ctx.fill();
  }
  // cheeks
  ctx.fillStyle = 'rgba(255,90,120,0.45)';
  for (const s of [-1, 1]) {
    circle(ctx, s * r * 0.58, r * 0.2, r * 0.13);
    ctx.fill();
  }
  // mouth
  ctx.lineCap = 'round';
  ctx.strokeStyle = DARK;
  ctx.fillStyle = DARK;
  ctx.lineWidth = r * 0.13;
  if (mouth === 0) {
    ctx.beginPath();
    ctx.arc(0, r * 0.2, r * 0.3, 0.2, Math.PI - 0.2);
    ctx.stroke();
  } else if (mouth === 1) {
    ctx.beginPath();
    ctx.arc(0, r * 0.18, r * 0.28, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  } else if (mouth === 2) {
    circle(ctx, 0, r * 0.36, r * 0.12);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, r * 0.22);
    ctx.quadraticCurveTo(0, r * 0.62, r * 0.3, r * 0.22);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A driver's head centred on (x, y), radius r (in whatever units the context is in). `lw`: outline width in the same units.
 * With a loaded avatar the head is the avatar in a round window; otherwise the generated face.
 */
export function drawHead(ctx, id, x, y, r, bot, lw) {
  const img = bot ? null : headImage(id);
  if (img) {
    ctx.save();
    circle(ctx, x, y, r);
    ctx.fillStyle = '#e9f4ff';
    ctx.fill();
    ctx.clip();
    try {
      ctx.drawImage(img, x - r * 1.08, y - r * 1.08, r * 2.16, r * 2.16);
    } catch {
      // a broken image never stops the frame
    }
    ctx.restore();
    circle(ctx, x, y, r);
    ctx.lineWidth = lw;
    ctx.strokeStyle = DARK;
    ctx.stroke();
  } else {
    drawFace(ctx, x, y, r, id, bot);
  }
}

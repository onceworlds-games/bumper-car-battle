// Canvas-painted textures: a facade bay (plaster, arched windows, shutters), its lit-window twin for the night,
// terracotta roof tiles, the clock face, stage curtains and awning stripes. All made here, nothing loaded.
import * as THREE from 'three';

const cache = new Map();

function canvas(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  paint(g, w, h);
  return c;
}

function tex(key, w, h, paint, { repeat = true, srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const t = new THREE.CanvasTexture(canvas(w, h, paint));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/** One bay of a facade, one floor high: white plaster (tinted by vertex colour), a window with shutters, a cornice band. */
export function bayTexture() {
  return tex('bay', 256, 256, (g, w, h) => {
    g.fillStyle = '#f4ede0';
    g.fillRect(0, 0, w, h);
    // Plaster: soft blotches so walls never look flat-printed.
    seed = 11;
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${150 + rand() * 60},${120 + rand() * 50},${90 + rand() * 40},${0.03 + rand() * 0.05})`;
      g.beginPath();
      g.arc(rand() * w, rand() * h, 6 + rand() * 30, 0, Math.PI * 2);
      g.fill();
    }
    // A string course at the top (top faces and cornices sample this band).
    g.fillStyle = '#e2d6c0';
    g.fillRect(0, 0, w, 22);
    g.fillStyle = 'rgba(60,40,30,0.25)';
    g.fillRect(0, 22, w, 3);
    // The window: arched head, dark glass, stone surround, sill.
    const wx = 88;
    const wy = 70;
    const ww = 80;
    const wh = 130;
    g.fillStyle = '#d9c9ad';
    g.beginPath();
    g.moveTo(wx - 8, wy + wh + 6);
    g.lineTo(wx - 8, wy + 28);
    g.arc(wx + ww / 2, wy + 28, ww / 2 + 8, Math.PI, 0);
    g.lineTo(wx + ww + 8, wy + wh + 6);
    g.closePath();
    g.fill();
    g.fillStyle = '#1d2a30';
    g.beginPath();
    g.moveTo(wx, wy + wh);
    g.lineTo(wx, wy + 28);
    g.arc(wx + ww / 2, wy + 28, ww / 2, Math.PI, 0);
    g.lineTo(wx + ww, wy + wh);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(240,230,210,0.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(wx + ww / 2, wy + 2);
    g.lineTo(wx + ww / 2, wy + wh);
    g.moveTo(wx, wy + 74);
    g.lineTo(wx + ww, wy + 74);
    g.stroke();
    // Shutters, teal and slatted.
    for (const sx of [wx - 34, wx + ww + 6]) {
      g.fillStyle = '#2e6b66';
      g.fillRect(sx, wy + 10, 28, wh - 10);
      g.fillStyle = 'rgba(10,30,30,0.35)';
      for (let y = wy + 16; y < wy + wh; y += 9) g.fillRect(sx + 3, y, 22, 3);
    }
    g.fillStyle = '#cbb894';
    g.fillRect(wx - 14, wy + wh + 2, ww + 28, 10);
  });
}

/** Where the bay is plaster (white: takes the house's colour) and where it is window, shutter or sill (black). */
export function bayMaskTexture() {
  return tex(
    'bay-mask',
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#000';
      const wx = 88;
      const wy = 70;
      const ww = 80;
      const wh = 130;
      g.beginPath();
      g.moveTo(wx - 8, wy + wh + 6);
      g.lineTo(wx - 8, wy + 28);
      g.arc(wx + ww / 2, wy + 28, ww / 2 + 8, Math.PI, 0);
      g.lineTo(wx + ww + 8, wy + wh + 6);
      g.closePath();
      g.fill();
      g.fillRect(wx - 34, wy + 10, 28, wh - 10);
      g.fillRect(wx + ww + 6, wy + 10, 28, wh - 10);
      g.fillRect(wx - 14, wy + wh + 2, ww + 28, 10);
      g.fillStyle = '#7a7a7a';
      g.fillRect(0, 0, w, 25);
    },
    { srgb: false },
  );
}

/** The same bay at night: only the glass, warm. Which windows are lit varies per bay in the facade shader. */
export function bayLightTexture() {
  return tex('bay-light', 256, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const wx = 88;
    const wy = 70;
    const grad = g.createLinearGradient(0, wy, 0, wy + 130);
    grad.addColorStop(0, '#ffd88a');
    grad.addColorStop(1, '#f59a3c');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(wx, wy + 130);
    g.lineTo(wx, wy + 28);
    g.arc(wx + 40, wy + 28, 40, Math.PI, 0);
    g.lineTo(wx + 80, wy + 130);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(wx + 38, wy, 4, 130);
    g.fillRect(wx, wy + 72, 80, 4);
  });
}

export function roofTexture() {
  return tex('roof', 256, 256, (g, w, h) => {
    g.fillStyle = '#b4472f';
    g.fillRect(0, 0, w, h);
    seed = 3;
    for (let y = 0; y < h; y += 16) {
      const off = (y / 16) % 2 ? 8 : 0;
      for (let x = -16; x < w; x += 16) {
        const shade = 0.75 + rand() * 0.3;
        g.fillStyle = `rgb(${Math.round(196 * shade)},${Math.round(84 * shade)},${Math.round(54 * shade)})`;
        g.beginPath();
        g.ellipse(x + off + 8, y + 10, 7.5, 9, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(60,20,10,0.35)';
        g.fillRect(x + off + 1, y + 15, 14, 2);
      }
    }
  });
}

/** The clock face: ivory and gold on deep teal, Roman numerals. */
export function clockTexture() {
  return tex(
    'clock',
    256,
    256,
    (g, w) => {
      const c = w / 2;
      g.fillStyle = '#0e3b45';
      g.fillRect(0, 0, w, w);
      g.fillStyle = '#e9d6a8';
      g.beginPath();
      g.arc(c, c, 118, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#123f4a';
      g.beginPath();
      g.arc(c, c, 106, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f2b544';
      g.font = 'bold 22px serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const nums = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
      nums.forEach((n, i) => {
        const a = (i / 12) * Math.PI * 2;
        g.fillText(n, c + Math.sin(a) * 84, c - Math.cos(a) * 84);
      });
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        g.fillRect(c + Math.sin(a) * 102 - 1, c - Math.cos(a) * 102 - 1, i % 5 ? 2 : 4, i % 5 ? 2 : 4);
      }
      g.fillStyle = '#f2b544';
      g.beginPath();
      g.arc(c, c, 7, 0, Math.PI * 2);
      g.fill();
    },
    { repeat: false },
  );
}

export function curtainTexture() {
  return tex('curtain', 256, 256, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const k = 0.55 + 0.45 * Math.sin((x / w) * Math.PI * 14);
      g.fillStyle = `rgb(${Math.round(150 * k + 30)},${Math.round(22 * k + 8)},${Math.round(40 * k + 10)})`;
      g.fillRect(x, 0, 1, h);
    }
    g.fillStyle = '#f2b544';
    g.fillRect(0, h - 14, w, 6);
    for (let x = 6; x < w; x += 14) {
      g.beginPath();
      g.arc(x, h - 6, 4, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function stripeTexture(a = '#f1e3c8', b = '#9e1b32') {
  return tex(`stripe-${a}-${b}`, 64, 64, (g, w, h) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect((i * w) / 4, 0, w / 4, h);
    }
  });
}

/** A soft round glow for lanterns and fireworks. */
export function glowTexture() {
  return tex(
    'glow',
    64,
    64,
    (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.2, 'rgba(255,240,210,0.8)');
      r.addColorStop(0.5, 'rgba(255,200,120,0.25)');
      r.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    },
    { repeat: false },
  );
}

/** A soft puff (smoke, dust, confetti uses its own colours). */
export function puffTexture() {
  return tex(
    'puff',
    64,
    64,
    (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,0.9)');
      r.addColorStop(0.55, 'rgba(255,255,255,0.45)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    },
    { repeat: false },
  );
}

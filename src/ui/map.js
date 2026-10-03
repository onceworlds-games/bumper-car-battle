// The map (Tab, or a tap on the quarry card): the plaza from above, its districts named, where each troupe is
// (anyone can see the troupes), you and your slot, and the district your last clue named, ringed.
import { makeCanvas, drawBust } from './icons.js';
import { districtAt } from '../sim/plazas.js';
import { STRIDE } from '../sim/crowd.js';
import { TROUPES } from '../sim/const.js';

const TINTS = ['#e7d7b8', '#dcc8a6', '#e2cfae', '#d6c29e', '#e9dcc0', '#d9c6a2', '#e4d3b4', '#d2bd98'];

export function createMap(root, { onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'mapwrap';
  wrap.style.display = 'none';
  root.appendChild(wrap);
  wrap.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    onClose?.();
  });
  let canvas = null;
  let g = null;
  let base = null;
  let baseKey = '';
  let open = false;
  const api = {
    get open() {
      return open;
    },
    show(on) {
      open = !!on;
      wrap.style.display = on ? '' : 'none';
      requestAnimationFrame(() => wrap.classList.toggle('show', open));
    },
    /** Redraws: plaza, the crowd buffer, my position and slot, the clue district (index or -1). */
    draw(plaza, crowd, buf, me, slot, clue, nowSec) {
      if (!open) return;
      const b = plaza.bounds;
      const vw = Math.min(window.innerWidth - 32, 900);
      const vh = Math.min(window.innerHeight - 96, 640);
      const sc = Math.min(vw / (b.x1 - b.x0 + 4), vh / (b.z1 - b.z0 + 4));
      const W = Math.round((b.x1 - b.x0 + 4) * sc);
      const H = Math.round((b.z1 - b.z0 + 4) * sc);
      const key = `${plaza.id}:${W}:${H}`;
      if (key !== baseKey) {
        baseKey = key;
        [canvas, g] = makeCanvas(W, '', H);
        wrap.replaceChildren(canvas);
        base = paintBase(plaza, W, H, sc);
      }
      const X = (x) => (x - b.x0 + 2) * sc;
      const Z = (z) => (z - b.z0 + 2) * sc;
      g.clearRect(0, 0, W, H);
      g.drawImage(base, 0, 0, W, H);
      // The clue: the district ringed in crimson, pulsing.
      if (clue >= 0 && plaza.districts[clue]) {
        g.save();
        g.strokeStyle = '#b3263a';
        g.lineWidth = 3 + Math.sin(nowSec * 4) * 1.2;
        for (const [cx, cz] of plaza.districts[clue].at) {
          g.beginPath();
          g.arc(X(cx), Z(cz), 6.5 * sc, 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();
      }
      // Troupes: a bust at each troupe's middle.
      if (crowd && buf) {
        const n = crowd.n;
        for (let tr = 0; tr < TROUPES.length; tr++) {
          let x = 0;
          let z = 0;
          for (let i = 0; i < n; i++) {
            x += buf[(tr * n + i) * STRIDE];
            z += buf[(tr * n + i) * STRIDE + 1];
          }
          x /= n;
          z /= n;
          const s = Math.max(26, 2.6 * sc);
          g.fillStyle = 'rgba(26,20,20,0.55)';
          g.beginPath();
          g.arc(X(x), Z(z), s * 0.55, 0, Math.PI * 2);
          g.fill();
          drawBust(g, tr, X(x) - s / 2, Z(z) - s / 2, s);
        }
      }
      if (slot) {
        g.strokeStyle = 'rgba(255,241,200,0.9)';
        g.setLineDash([4, 3]);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(X(slot.x), Z(slot.z), 7, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      if (me) {
        g.save();
        g.translate(X(me.x), Z(me.z));
        g.rotate(-me.h);
        g.fillStyle = '#f2b544';
        g.strokeStyle = '#1a1414';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, 11);
        g.lineTo(7, -7);
        g.lineTo(0, -3);
        g.lineTo(-7, -7);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
    },
  };
  return api;
}

function paintBase(plaza, W, H, sc) {
  const [c, g] = makeCanvas(W, '', H);
  const b = plaza.bounds;
  const X = (x) => (x - b.x0 + 2) * sc;
  const Z = (z) => (z - b.z0 + 2) * sc;
  g.fillStyle = '#3a2420';
  g.fillRect(0, 0, W, H);
  // Districts: cells tinted by which district they belong to.
  const step = 1;
  for (let z = b.z0; z < b.z1; z += step) {
    for (let x = b.x0; x < b.x1; x += step) {
      g.fillStyle = TINTS[districtAt(plaza, x + 0.5, z + 0.5) % TINTS.length];
      g.fillRect(X(x), Z(z), step * sc + 0.6, step * sc + 0.6);
    }
  }
  g.fillStyle = '#1b7f8c';
  for (const w of plaza.water) g.fillRect(X(w.x - w.w / 2), Z(w.z - w.d / 2), w.w * sc, w.d * sc);
  g.fillStyle = '#cdbfa5';
  for (const d of plaza.decks) g.fillRect(X(d.x - d.w / 2), Z(d.z - d.d / 2), d.w * sc, d.d * sc);
  for (const r of plaza.raised) {
    g.fillStyle = 'rgba(26,20,20,0.12)';
    g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc);
  }
  g.fillStyle = '#6a5446';
  for (const o of plaza.obstacles) {
    if (o.t === 'c') {
      g.beginPath();
      g.arc(X(o.x), Z(o.z), Math.max(1.5, o.r * sc), 0, Math.PI * 2);
      g.fill();
    } else {
      g.save();
      g.translate(X(o.x), Z(o.z));
      g.rotate(-(o.rot || 0));
      g.fillRect((-o.w / 2) * sc, (-o.d / 2) * sc, o.w * sc, o.d * sc);
      g.restore();
    }
  }
  // District names.
  g.font = `italic 700 ${Math.max(13, Math.round(sc * 1.5))}px "Bodoni Moda", Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const d of plaza.districts) {
    const [cx, cz] = d.at[0];
    const name = d.name.replace(/^the /, '');
    g.fillStyle = 'rgba(26,20,20,0.75)';
    g.fillText(name, X(cx) + 1, Z(cz) + 1);
    g.fillStyle = '#1a1414';
    g.globalAlpha = 0.9;
    g.fillText(name, X(cx), Z(cz));
    g.globalAlpha = 1;
  }
  g.strokeStyle = '#f2b544';
  g.lineWidth = 2;
  g.strokeRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
  return c;
}

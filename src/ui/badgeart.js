// Badge medallions, painted in the game's own style: a gilt rim, a coloured field, one motif drawn with the same
// busts and glyphs the game uses. 256x256, transparent outside the medallion.
import { drawBust, drawGlyph } from './icons.js';

export const BADGES = [
  { id: 'first-unmask', name: 'First Unmask', description: 'Unmask your quarry.', field: '#9e1b32', motif: 'fall' },
  { id: 'faux-pas', name: 'Faux Pas', description: 'Unmask a reveller who was only a reveller.', field: '#c8553d', motif: 'gasp' },
  { id: 'ghost', name: 'Ghost', description: 'Finish a round of Masquerade without being unmasked.', field: '#0e4d5c', motif: 'ghost' },
  { id: 'hush-hero', name: 'Hush Hero', description: 'Unmask someone in the Hush, after midnight strikes.', field: '#12263a', motif: 'fireworks' },
  { id: 'close-call', name: 'Close Call', description: 'Your pursuer blunders right beside you.', field: '#3d6b55', motif: 'near' },
  { id: 'master-of-disguise', name: 'Master of Disguise', description: 'Hunt for a whole minute without getting flustered.', field: '#24365c', motif: 'bauta' },
  { id: 'sharp-eye', name: 'Sharp Eye', description: 'Five unmasks in one match without a single faux pas.', field: '#1f7a80', motif: 'glass' },
  { id: 'case-closed', name: 'Case Closed', description: 'Solve Spot the Mask against Master impostors.', field: '#5a2a1e', motif: 'seal' },
  { id: 'full-house', name: 'Full House', description: 'Play a round with ten players.', field: '#9e1b32', motif: 'house' },
  { id: 'level-10', name: 'Level 10', description: 'Reach level ten.', field: '#1a1414', motif: 'ten' },
  { id: 'bait', name: 'Bait', description: 'Someone unmasks your decoy.', field: '#d9822b', motif: 'decoy' },
];

function rim(g, s, field) {
  const c = s / 2;
  const grad = g.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#ffe39a');
  grad.addColorStop(0.5, '#f2b544');
  grad.addColorStop(1, '#b8801f');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c, c, c - 6, 0, Math.PI * 2);
  g.fill();
  // Beads round the rim.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    g.fillStyle = i % 2 ? '#fff1c8' : '#c8902a';
    g.beginPath();
    g.arc(c + Math.cos(a) * (c - 14), c + Math.sin(a) * (c - 14), 3.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = field;
  g.beginPath();
  g.arc(c, c, c - 24, 0, Math.PI * 2);
  g.fill();
  const shine = g.createRadialGradient(c * 0.7, c * 0.6, 4, c, c, c - 24);
  shine.addColorStop(0, 'rgba(255,255,255,0.22)');
  shine.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = shine;
  g.beginPath();
  g.arc(c, c, c - 24, 0, Math.PI * 2);
  g.fill();
}

function star(g, x, y, r, col) {
  g.fillStyle = col;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/** A white mask on its own (the falling one), centred at (x, y), scale k, tilted by a. */
function mask(g, x, y, k, a, col = '#fbf6ea') {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = col;
  g.beginPath();
  g.ellipse(0, 0, 34 * k, 42 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1414';
  g.beginPath();
  g.ellipse(-12 * k, -6 * k, 8 * k, 5 * k, 0.15, 0, Math.PI * 2);
  g.ellipse(12 * k, -6 * k, 8 * k, 5 * k, -0.15, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d8a032';
  g.lineWidth = 3 * k;
  g.beginPath();
  g.ellipse(0, 0, 34 * k, 42 * k, 0, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

export function drawBadge(g, id, s = 256) {
  const b = BADGES.find((x) => x.id === id) ?? BADGES[0];
  g.clearRect(0, 0, s, s);
  rim(g, s, b.field);
  const c = s / 2;
  g.save();
  g.beginPath();
  g.arc(c, c, c - 24, 0, Math.PI * 2);
  g.clip();
  switch (b.motif) {
    case 'fall': {
      mask(g, c + 16, c - 10, 1.25, 0.5);
      g.save();
      g.translate(c - 46, c + 40);
      g.rotate(-0.6);
      g.fillStyle = '#f2b544';
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 56, -Math.PI * 0.95, -Math.PI * 0.25);
      g.closePath();
      g.fill();
      g.strokeStyle = '#9e1b32';
      g.lineWidth = 3;
      for (let i = 0; i <= 6; i++) {
        const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.7;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * 56, Math.sin(a) * 56);
        g.stroke();
      }
      g.restore();
      for (let i = 0; i < 14; i++) {
        g.fillStyle = ['#f2b544', '#f1e3c8', '#1f7a80', '#e58c8a'][i % 4];
        g.fillRect(c - 70 + ((i * 47) % 140), c - 80 + ((i * 31) % 70), 7, 11);
      }
      break;
    }
    case 'gasp':
      drawBust(g, 3, c - 66, c - 70, 132, { off: true });
      mask(g, c + 52, c + 36, 0.7, 1.1);
      break;
    case 'ghost':
      g.globalAlpha = 0.35;
      drawBust(g, 6, c - 62, c - 58, 124);
      g.globalAlpha = 1;
      mask(g, c, c - 6, 1.0, 0, 'rgba(251,246,234,0.92)');
      break;
    case 'fireworks':
      for (const [x, y, r, col] of [
        [c - 34, c - 30, 40, '#ffd27a'],
        [c + 40, c - 46, 30, '#7ae0d0'],
        [c + 24, c + 8, 24, '#ff9ac0'],
      ]) {
        g.strokeStyle = col;
        g.lineWidth = 3;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          g.beginPath();
          g.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35);
          g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          g.stroke();
        }
      }
      mask(g, c - 10, c + 52, 0.75, -0.2);
      break;
    case 'near':
      drawBust(g, 2, c - 82, c - 40, 110);
      drawBust(g, 7, c - 24, c - 40, 110);
      g.strokeStyle = '#f1e3c8';
      g.lineWidth = 4;
      g.setLineDash([6, 6]);
      g.beginPath();
      g.arc(c, c + 6, 70, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      g.setLineDash([]);
      break;
    case 'bauta':
      drawBust(g, 6, c - 70, c - 74, 140);
      star(g, c + 52, c - 56, 18, '#f2b544');
      break;
    case 'glass':
      g.save();
      g.translate(c - 78, c - 92);
      drawGlyph(g, 'opera', 156);
      g.restore();
      for (let i = 0; i < 5; i++) star(g, c - 56 + i * 28, c + 64, 11, '#f2b544');
      break;
    case 'seal':
      drawBust(g, 0, c - 60, c - 76, 120);
      g.fillStyle = '#b3263a';
      g.beginPath();
      g.arc(c + 34, c + 42, 34, 0, Math.PI * 2);
      g.fill();
      star(g, c + 34, c + 42, 18, '#f2b544');
      break;
    case 'house':
      for (let i = 0; i < 10; i++) {
        const a = Math.PI * (0.15 + (i / 9) * 0.7);
        drawBust(g, i % 8, c - 22 + Math.cos(a) * -70, c - 16 - Math.sin(a) * 60 + 30, 44);
      }
      break;
    case 'ten':
      g.fillStyle = '#f2b544';
      g.font = 'italic 700 112px "Bodoni Moda", Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('X', c, c + 8);
      for (let i = 0; i < 3; i++) star(g, c - 40 + i * 40, c + 74, 9, '#f1e3c8');
      break;
    case 'decoy':
      g.save();
      g.translate(c - 74, c - 66);
      g.scale(3.6, 3.6);
      drawGlyph(g, 'decoy', 40);
      g.restore();
      break;
    default:
      break;
  }
  g.restore();
}

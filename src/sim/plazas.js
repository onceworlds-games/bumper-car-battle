// The three plazas as plain data: walkable bounds, water, decks (bridges, the pier), raised floors and stairs,
// obstacles (circles and boxes; `occ` ones block sight), districts (named by their nearest centre), anchors (open
// spots with 3.5 m clear around them where troupes stop) and promenade loops. The renderer dresses the same data.

const pillars = (xs, z, r = 0.42, h = 4.6) => xs.map((x) => ({ t: 'c', x, z, r, occ: true, h, kind: 'pillar' }));
const pillarsZ = (x, zs, r = 0.45, h = 4.6) => zs.map((z) => ({ t: 'c', x, z, r, occ: true, h, kind: 'pillar' }));
const posts = (xs, z) => xs.map((x) => ({ t: 'c', x, z, r: 0.18, occ: false, h: 1.1, kind: 'post' }));

const PIAZZA = {
  id: 'piazza',
  name: 'The Piazza',
  bounds: { x0: -30, x1: 30, z0: -21, z1: 21 },
  water: [{ x: 17, z: 0, w: 6, d: 46 }],
  decks: [
    { x: 17, z: -10, w: 7, d: 4, hump: 0.7, axis: 'x', kind: 'bridge' },
    { x: 17, z: 10, w: 7, d: 4, hump: 0.7, axis: 'x', kind: 'bridge' },
  ],
  raised: [],
  ramps: [],
  obstacles: [
    { t: 'c', x: -6, z: 0, r: 3.1, occ: false, h: 0.9, kind: 'fountain' },
    { t: 'c', x: -6, z: 0, r: 0.8, occ: true, h: 4.2, kind: 'statue' },
    { t: 'b', x: -6, z: -20.5, w: 6, d: 5, occ: true, h: 24, kind: 'tower' },
    { t: 'b', x: -27.5, z: 0, w: 5, d: 12, occ: false, h: 1.2, kind: 'stage' },
    ...pillars([-27, -23.5, -20, -16.5, -13], -17.5),
    ...pillars([-27, -23.5, -20, -16.5, -13], 17.5),
    ...pillars([-2, 1.5, 5, 8.5, 12], -17.5),
    ...pillars([-2, 1.5, 5, 8.5, 12], 17.5),
    ...[[-15, -7], [-15, 7], [3, -7], [3, 7]].map(([x, z]) => ({ t: 'c', x, z, r: 0.22, occ: false, h: 4, kind: 'lamp' })),
    { t: 'b', x: 27.5, z: 18, w: 3, d: 3, occ: true, h: 3.2, kind: 'kiosk' },
    ...posts([-18, -14, -6, -2, 2, 6, 14, 18], 0).map((p) => ({ ...p, x: 20.6, z: p.x })),
  ],
  districts: [
    { id: 'fountain', name: 'the Fountain', at: [[-6, 0]] },
    { id: 'clock', name: 'the Clock Tower', at: [[-6, -13]] },
    { id: 'stage', name: 'the Stage', at: [[-21, 0]] },
    { id: 'bridges', name: 'the Bridges', at: [[17, -10], [17, 10], [25, 0], [10, 0]] },
    { id: 'glass', name: 'the Glass Arcade', at: [[-21, -15]] },
    { id: 'silk', name: 'the Silk Arcade', at: [[-21, 15]] },
    { id: 'spice', name: 'the Spice Arcade', at: [[5, -15]] },
    { id: 'lace', name: 'the Lace Arcade', at: [[5, 15]] },
  ],
  anchors: [
    [1.5, 0], [-13.5, 0], [-6, 7.5], [-6, -7.5], [-6, -13], [-20.5, -5], [-20.5, 5], [-21, -12.5], [-21, 12.5],
    [5, -12.5], [5, 12.5], [24.5, -4], [24.5, 5], [10, 0], [-12, -11], [-12, 11], [25, -15], [24, 12.5],
  ],
  loops: [
    { root: 0, via: [[-6, 7.5], [-13.5, 0], [-6, -7.5]], wide: true },
    { root: 4, via: [[5, -12.5], [10, 0], [5, 12.5], [-12, 11], [-13.5, 0], [-12, -11]], wide: true },
    { root: 13, via: [[17, -10], [24.5, -4], [24.5, 5], [17, 10]], wide: false },
    { root: 5, via: [[-21, -12.5], [-12, -11], [-13.5, 0], [-12, 11], [-21, 12.5], [-20.5, 5]], wide: true },
  ],
  focus: [
    { x: -6, z: 0, y: 3.5, name: 'fountain' },
    { x: -6, z: -19, y: 14, name: 'clock' },
    { x: -28, z: 0, y: 2.5, name: 'stage' },
    { x: 17, z: 0, y: 0.5, name: 'canal' },
    { x: -20, z: -19, y: 3, name: 'arcade' },
    { x: -20, z: 19, y: 3, name: 'arcade' },
    { x: 5, z: -19, y: 3, name: 'arcade' },
    { x: 5, z: 19, y: 3, name: 'arcade' },
  ],
};

const QUAY = {
  id: 'quay',
  name: 'The Quay',
  bounds: { x0: -36, x1: 36, z0: -18, z1: 20 },
  water: [
    { x: 0, z: 14.5, w: 74, d: 13 },
    { x: -20, z: -5, w: 4, d: 30 },
    { x: 20, z: -5, w: 4, d: 30 },
  ],
  decks: [
    { x: 0, z: 14, w: 8, d: 12.4, hump: 0, axis: 'z', kind: 'pier' },
    { x: -20, z: -9, w: 5.5, d: 4, hump: 0.6, axis: 'x', kind: 'bridge' },
    { x: -20, z: 2.5, w: 5.5, d: 4, hump: 0.6, axis: 'x', kind: 'bridge' },
    { x: 20, z: -9, w: 5.5, d: 4, hump: 0.6, axis: 'x', kind: 'bridge' },
    { x: 20, z: 2.5, w: 5.5, d: 4, hump: 0.6, axis: 'x', kind: 'bridge' },
  ],
  raised: [],
  ramps: [],
  obstacles: [
    { t: 'c', x: -6, z: 4, r: 0.9, occ: true, h: 14, kind: 'column' },
    { t: 'c', x: 6, z: 4, r: 0.9, occ: true, h: 14, kind: 'column' },
    ...pillars([-15, -11.5, -8, -4.5, -1, 2.5, 6, 9.5, 13], -14.5, 0.45),
    { t: 'c', x: -8, z: -5, r: 2.6, occ: false, h: 4.2, kind: 'bandstand' },
    { t: 'c', x: 9, z: -5, r: 1.4, occ: false, h: 1.2, kind: 'well' },
    { t: 'b', x: -33.5, z: -11, w: 4, d: 3, occ: true, h: 2.6, kind: 'stall' },
    { t: 'b', x: -33.5, z: -3, w: 4, d: 3, occ: true, h: 2.6, kind: 'stall' },
    { t: 'b', x: -33.5, z: 5, w: 4, d: 2.4, occ: true, h: 2.6, kind: 'stall' },
    { t: 'b', x: 32, z: -12, w: 8, d: 7, occ: true, h: 7, kind: 'customs' },
    ...posts([-16, -12, -8, 8, 12, 16], 7.6),
  ],
  districts: [
    { id: 'pier', name: 'the Pier', at: [[0, 15]] },
    { id: 'columns', name: 'the Twin Columns', at: [[0, 4]] },
    { id: 'loggia', name: 'the Loggia', at: [[0, -13]] },
    { id: 'bandstand', name: 'the Bandstand', at: [[-9, -5]] },
    { id: 'well', name: 'the Lion Well', at: [[9, -5]] },
    { id: 'fish', name: 'the Fish Market', at: [[-28, -3]] },
    { id: 'customs', name: 'the Customs House', at: [[28, -3]] },
    { id: 'bridges', name: 'the Bridges', at: [[-20, -3], [20, -3]] },
  ],
  anchors: [
    [0, 15.5], [0, -1], [0, -9.5], [-12, 2.5], [12, 2.5], [-14, -9.5], [14, -9.5], [-28, -7], [-28, 3], [28, -2],
    [28, 4.2], [-28, -14],
  ],
  loops: [
    { root: 2, via: [[-14, -9.5], [-12, 2.5], [0, -1]], wide: true },
    { root: 1, via: [[-14, -9.5], [-20, -9], [-28, -7], [-28, 3], [-20, 2.5], [-12, 2.5]], wide: false },
    { root: 6, via: [[20, -9], [28, -2], [28, 4.2], [20, 2.5], [12, 2.5]], wide: false },
    { root: 1, via: [[12, 2.5], [14, -9.5], [0, -9.5]], wide: true },
  ],
  focus: [
    { x: 0, z: 26, y: 1, name: 'lagoon' },
    { x: -6, z: 4, y: 13, name: 'column' },
    { x: 6, z: 4, y: 13, name: 'column' },
    { x: -8, z: -5, y: 3, name: 'bandstand' },
    { x: 0, z: -17, y: 4, name: 'loggia' },
    { x: 32, z: -12, y: 5, name: 'customs' },
  ],
};

const PALAZZO = {
  id: 'palazzo',
  name: 'The Palazzo',
  bounds: { x0: -22, x1: 22, z0: -22, z1: 18 },
  water: [],
  decks: [],
  raised: [{ x0: -22, x1: 22, z0: -22, z1: -12, y: 2.4 }],
  ramps: [
    { x0: -4, x1: 4, z0: -12, z1: -6, y0: 2.4, y1: 0 },
    { x0: -20, x1: -16, z0: -12, z1: -8, y0: 2.4, y1: 0 },
    { x0: 16, x1: 20, z0: -12, z1: -8, y0: 2.4, y1: 0 },
  ],
  obstacles: [
    // The terrace's balustrade, open at the three stairs, and the stairs' own side walls.
    { t: 'b', x: -21, z: -12, w: 2, d: 0.4, occ: false, h: 1, kind: 'rail' },
    { t: 'b', x: -10, z: -12, w: 12, d: 0.4, occ: false, h: 1, kind: 'rail' },
    { t: 'b', x: 10, z: -12, w: 12, d: 0.4, occ: false, h: 1, kind: 'rail' },
    { t: 'b', x: 21, z: -12, w: 2, d: 0.4, occ: false, h: 1, kind: 'rail' },
    { t: 'b', x: -4.2, z: -9, w: 0.4, d: 6, occ: false, h: 1, kind: 'stairwall' },
    { t: 'b', x: 4.2, z: -9, w: 0.4, d: 6, occ: false, h: 1, kind: 'stairwall' },
    { t: 'b', x: -20.2, z: -10, w: 0.4, d: 4, occ: false, h: 1, kind: 'stairwall' },
    { t: 'b', x: -15.8, z: -10, w: 0.4, d: 4, occ: false, h: 1, kind: 'stairwall' },
    { t: 'b', x: 15.8, z: -10, w: 0.4, d: 4, occ: false, h: 1, kind: 'stairwall' },
    { t: 'b', x: 20.2, z: -10, w: 0.4, d: 4, occ: false, h: 1, kind: 'stairwall' },
    ...pillars([-18, -13, -8, 8, 13, 18], -20.5, 0.5, 4.4),
    ...pillarsZ(-17.5, [-4, 0, 4, 8, 12, 16]),
    ...pillarsZ(17.5, [-4, 0, 4, 8, 12, 16]),
    { t: 'c', x: 0, z: 3, r: 1.8, occ: false, h: 1.4, kind: 'well' },
    ...[[-10, -1], [10, -1], [-10, 11], [10, 11]].map(([x, z]) => ({ t: 'c', x, z, r: 1.3, occ: true, h: 4.2, kind: 'tree' })),
    { t: 'c', x: 12, z: 15.5, r: 0.7, occ: true, h: 3.2, kind: 'statue' },
    { t: 'c', x: 15.5, z: 12.5, r: 0.7, occ: true, h: 3.2, kind: 'statue' },
  ],
  districts: [
    { id: 'stair', name: 'the Grand Stair', at: [[0, -8]] },
    { id: 'terrace', name: 'the Terrace', at: [[0, -17], [-14, -17], [14, -17]] },
    { id: 'well', name: 'the Well', at: [[0, 3]] },
    { id: 'orange', name: 'the Orange Trees', at: [[-10, 5], [10, 5]] },
    { id: 'sculpt', name: 'the Sculptures', at: [[13, 14]] },
    { id: 'east', name: 'the East Gallery', at: [[20, 2]] },
    { id: 'west', name: 'the West Gallery', at: [[-20, 2]] },
    { id: 'gate', name: 'the Gate', at: [[-2, 14]] },
  ],
  anchors: [
    [0, -16], [-14, -16], [-7, -16], [7, -16], [14, -16], [0, -2.5], [0, 9], [-9, 5], [9, 5], [-4, 14.5], [4, 14],
  ],
  loops: [
    { root: 5, via: [[7, 3], [0, 9], [-7, 3]], wide: true },
    { root: 5, via: [[0, -12], [0, -16], [14, -16], [18, -10], [18, -6], [9, 5]], wide: false },
    { root: 0, via: [[-14, -16], [-18, -10], [-18, -6], [-9, 5], [0, 9], [9, 5], [18, -6], [18, -10], [14, -16]], wide: false },
    { root: 7, via: [[-19.8, 2], [-19.8, 14], [-4, 14.5]], wide: false },
  ],
  focus: [
    { x: 0, z: -22, y: 7, name: 'palace' },
    { x: 0, z: 3, y: 1.5, name: 'well' },
    { x: -10, z: -1, y: 3, name: 'tree' },
    { x: 10, z: 11, y: 3, name: 'tree' },
    { x: 12, z: 15.5, y: 2.6, name: 'statue' },
    { x: 0, z: 18, y: 4, name: 'gate' },
  ],
};

export const PLAZAS = [PIAZZA, QUAY, PALAZZO];
export const PLAZA_IDS = PLAZAS.map((p) => p.id);

/** The district a point is in: the one with the nearest centre. Returns its index. */
export function districtAt(plaza, x, z) {
  let best = 0;
  let bestD = Infinity;
  plaza.districts.forEach((d, i) => {
    for (const [cx, cz] of d.at) {
      const dd = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
  });
  return best;
}

/** Floor height at a point: raised floors, stairs and humped bridges. */
export function floorY(plaza, x, z) {
  for (const r of plaza.ramps) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.y0 + ((z - r.z0) / (r.z1 - r.z0)) * (r.y1 - r.y0);
  }
  for (const r of plaza.raised) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.y;
  for (const d of plaza.decks) {
    if (!d.hump) continue;
    if (Math.abs(x - d.x) <= d.w / 2 && Math.abs(z - d.z) <= d.d / 2) {
      const u = d.axis === 'x' ? (x - (d.x - d.w / 2)) / d.w : (z - (d.z - d.d / 2)) / d.d;
      return d.hump * Math.sin(Math.PI * u);
    }
  }
  return 0;
}

/** Is the point in water that no deck covers? */
export function inWater(plaza, x, z) {
  for (const d of plaza.decks) if (Math.abs(x - d.x) <= d.w / 2 && Math.abs(z - d.z) <= d.d / 2) return false;
  for (const w of plaza.water) if (Math.abs(x - w.x) <= w.w / 2 && Math.abs(z - w.z) <= w.d / 2) return true;
  return false;
}

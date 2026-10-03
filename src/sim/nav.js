// Where figures can stand and how they get about: exact clearance from walls, water and obstacles; an A* grid;
// string-pulled, filleted paths with arc-length tables. Everything is a pure function of the plaza (cached per plaza).
import { boxDistance, segHitsBox, segHitsCircle, clamp } from './geom.js';
import { floorY } from './plazas.js';

const CELL = 0.5;
const cache = new Map();

/** Water boxes with the decks cut out, as axis-aligned rectangles. */
function waterRects(plaza) {
  let rects = plaza.water.map((w) => ({ x0: w.x - w.w / 2, x1: w.x + w.w / 2, z0: w.z - w.d / 2, z1: w.z + w.d / 2 }));
  for (const d of plaza.decks) {
    const D = { x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z - d.d / 2, z1: d.z + d.d / 2 };
    const next = [];
    for (const R of rects) {
      if (D.x1 <= R.x0 || D.x0 >= R.x1 || D.z1 <= R.z0 || D.z0 >= R.z1) {
        next.push(R);
        continue;
      }
      if (D.x0 > R.x0) next.push({ x0: R.x0, x1: D.x0, z0: R.z0, z1: R.z1 });
      if (D.x1 < R.x1) next.push({ x0: D.x1, x1: R.x1, z0: R.z0, z1: R.z1 });
      const mx0 = Math.max(R.x0, D.x0);
      const mx1 = Math.min(R.x1, D.x1);
      if (D.z0 > R.z0) next.push({ x0: mx0, x1: mx1, z0: R.z0, z1: D.z0 });
      if (D.z1 < R.z1) next.push({ x0: mx0, x1: mx1, z0: D.z1, z1: R.z1 });
    }
    rects = next;
  }
  return rects.map((r) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, w: r.x1 - r.x0, d: r.z1 - r.z0, rot: 0 }));
}

/** The navigation data for a plaza, built once. */
export function navFor(plaza) {
  let nav = cache.get(plaza.id);
  if (nav) return nav;
  const b = plaza.bounds;
  const water = waterRects(plaza);
  const circles = plaza.obstacles.filter((o) => o.t === 'c');
  const boxes = plaza.obstacles.filter((o) => o.t === 'b').map((o) => ({ ...o, rot: o.rot || 0 }));
  const occluders = plaza.obstacles.filter((o) => o.occ).map((o) => (o.t === 'b' ? { ...o, rot: o.rot || 0 } : o));

  /** Exact distance from a point to the nearest thing a figure can't overlap (negative inside). */
  const clear = (x, z) => {
    let c = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z);
    for (let i = 0; i < circles.length; i++) {
      const o = circles[i];
      const d = Math.sqrt((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z)) - o.r;
      if (d < c) c = d;
    }
    for (let i = 0; i < boxes.length; i++) {
      const d = boxDistance(x, z, boxes[i]);
      if (d < c) c = d;
    }
    for (let i = 0; i < water.length; i++) {
      const d = boxDistance(x, z, water[i]);
      if (d < c) c = d;
    }
    return c;
  };

  const x0 = b.x0;
  const z0 = b.z0;
  const cols = Math.ceil((b.x1 - b.x0) / CELL);
  const rows = Math.ceil((b.z1 - b.z0) / CELL);
  const cl = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cl[r * cols + c] = clear(x0 + (c + 0.5) * CELL, z0 + (r + 0.5) * CELL);

  nav = { plaza, cols, rows, x0, z0, cell: CELL, cl, clear, water, occluders, paths: new Map(), comps: new Map() };
  cache.set(plaza.id, nav);
  return nav;
}

const cellOf = (nav, x, z) => {
  const c = clamp(Math.floor((x - nav.x0) / CELL), 0, nav.cols - 1);
  const r = clamp(Math.floor((z - nav.z0) / CELL), 0, nav.rows - 1);
  return r * nav.cols + c;
};
const cx = (nav, i) => nav.x0 + ((i % nav.cols) + 0.5) * CELL;
const cz = (nav, i) => nav.z0 + (Math.floor(i / nav.cols) + 0.5) * CELL;

/** A minimal binary heap of cell indices keyed by a Float64Array of scores (ties go to the lower index). */
function heap(score) {
  const a = [];
  const less = (i, j) => score[a[i]] < score[a[j]] || (score[a[i]] === score[a[j]] && a[i] < a[j]);
  return {
    get size() {
      return a.length;
    },
    push(v) {
      a.push(v);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(i, p)) break;
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      }
    },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < a.length && less(l, m)) m = l;
          if (r < a.length && less(r, m)) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]];
          i = m;
        }
      }
      return top;
    },
  };
}

/** Cells reachable with clearance c from cell i (component labels, cached per clearance). */
function components(nav, c) {
  const key = c.toFixed(2);
  let comp = nav.comps.get(key);
  if (comp) return comp;
  comp = new Int32Array(nav.cl.length).fill(-1);
  let label = 0;
  const stack = [];
  for (let i = 0; i < comp.length; i++) {
    if (comp[i] !== -1 || nav.cl[i] < c) continue;
    comp[i] = label;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      const jc = j % nav.cols;
      const jr = (j - jc) / nav.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = jc + dc;
          const nr = jr + dr;
          if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
          const k = nr * nav.cols + nc;
          if (comp[k] !== -1 || nav.cl[k] < c) continue;
          if (dr && dc && (nav.cl[jr * nav.cols + nc] < c || nav.cl[nr * nav.cols + jc] < c)) continue;
          comp[k] = label;
          stack.push(k);
        }
      }
    }
    label++;
  }
  nav.comps.set(key, comp);
  return comp;
}

/** The nearest cell to (x, z) with clearance c (and, if given, in component `want`). */
function nearestCell(nav, x, z, c, comp, want) {
  const start = cellOf(nav, x, z);
  if (nav.cl[start] >= c && (want === undefined || comp[start] === want)) return start;
  const sc = start % nav.cols;
  const sr = (start - sc) / nav.cols;
  let best = -1;
  let bestD = Infinity;
  for (let ring = 1; ring < Math.max(nav.cols, nav.rows); ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;
        const nc = sc + dc;
        const nr = sr + dr;
        if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
        const k = nr * nav.cols + nc;
        if (nav.cl[k] < c || (want !== undefined && comp[k] !== want)) continue;
        const d = (cx(nav, k) - x) ** 2 + (cz(nav, k) - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    }
    if (best >= 0 && ring * CELL > Math.sqrt(bestD) + CELL) break;
  }
  return best;
}

/** A* over cells with clearance >= c. Returns a list of cell indices, or null. */
function astar(nav, from, to, c) {
  const n = nav.cl.length;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tx = cx(nav, to);
  const tz = cz(nav, to);
  const h = (i) => {
    const dx = Math.abs(cx(nav, i) - tx);
    const dz = Math.abs(cz(nav, i) - tz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const open = heap(f);
  g[from] = 0;
  f[from] = h(from);
  open.push(from);
  while (open.size) {
    const i = open.pop();
    if (closed[i]) continue;
    if (i === to) break;
    closed[i] = 1;
    const ic = i % nav.cols;
    const ir = (i - ic) / nav.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = ic + dc;
        const nr = ir + dr;
        if (nc < 0 || nr < 0 || nc >= nav.cols || nr >= nav.rows) continue;
        const k = nr * nav.cols + nc;
        if (closed[k] || nav.cl[k] < c) continue;
        if (dr && dc && (nav.cl[ir * nav.cols + nc] < c || nav.cl[nr * nav.cols + ic] < c)) continue;
        const step = dr && dc ? Math.SQRT2 * CELL : CELL;
        const tight = Math.max(0, 1.5 - (nav.cl[k] - c)) / 1.5;
        const ng = g[i] + step * (1 + 0.6 * tight);
        if (ng < g[k]) {
          g[k] = ng;
          f[k] = ng + h(k);
          prev[k] = i;
          open.push(k);
        }
      }
    }
  }
  if (from !== to && prev[to] === -1) return null;
  const out = [];
  for (let i = to; i !== -1; i = prev[i]) out.push(i);
  return out.reverse();
}

/** Can a figure walk straight from a to b keeping clearance c? */
export function straightClear(nav, ax, az, bx, bz, c) {
  const len = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2);
  const n = Math.max(1, Math.ceil(len / 0.2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (nav.clear(ax + (bx - ax) * t, az + (bz - az) * t) < c) return false;
  }
  return true;
}

/** Greedy string pull: the fewest straight legs through the points that keep clearance c. */
function pull(nav, pts, c) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !straightClear(nav, pts[i][0], pts[i][1], pts[j][0], pts[j][1], c)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** Rounds the corners of a polyline with arcs that stray at most `dev` from each corner. */
function fillet(pts, dev, maxR) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const [qx, qz] = pts[i + 1];
    const l1 = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    const l2 = Math.sqrt((qx - bx) * (qx - bx) + (qz - bz) * (qz - bz));
    const d1x = (bx - ax) / l1;
    const d1z = (bz - az) / l1;
    const d2x = (qx - bx) / l2;
    const d2z = (qz - bz) / l2;
    const cos = clamp(d1x * d2x + d1z * d2z, -1, 1);
    const turn = Math.acos(cos);
    if (turn < 0.05 || l1 < 0.2 || l2 < 0.2) {
      out.push(pts[i]);
      continue;
    }
    const sec = 1 / Math.cos(turn / 2);
    let r = Math.min(maxR, dev / Math.max(1e-6, sec - 1));
    const tanLen = r * Math.tan(turn / 2);
    const lim = Math.min(l1, l2) * 0.45;
    if (tanLen > lim) r = lim / Math.tan(turn / 2);
    const t = r * Math.tan(turn / 2);
    const sx = bx - d1x * t;
    const sz = bz - d1z * t;
    // The arc's centre sits on the inside of the turn.
    const cross = d1x * d2z - d1z * d2x;
    const nx = cross > 0 ? -d1z : d1z;
    const nz = cross > 0 ? d1x : -d1x;
    const ccx = sx + nx * r;
    const ccz = sz + nz * r;
    const a0 = Math.atan2(sz - ccz, sx - ccx);
    const steps = Math.max(2, Math.ceil((r * turn) / 0.3));
    const dir = cross > 0 ? 1 : -1;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + dir * turn * (k / steps);
      out.push([ccx + Math.cos(a) * r, ccz + Math.sin(a) * r]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** A path with an arc-length table, from a list of [x, z] points. */
export function makePath(points, closed = false) {
  const pts = points.slice();
  if (closed && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0]);
  const n = pts.length;
  const xy = new Float64Array(n * 2);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xy[i * 2] = pts[i][0];
    xy[i * 2 + 1] = pts[i][1];
    if (i) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dz = pts[i][1] - pts[i - 1][1];
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dz * dz);
    }
  }
  return { xy, cum, len: cum[n - 1], closed, n };
}

/** The point at arc length s (clamped, or wrapped for a loop), with the unit tangent. Writes into out. */
export function pathAt(path, s, out) {
  const { xy, cum, len, n } = path;
  if (len <= 1e-9) {
    out.x = xy[0];
    out.z = xy[1];
    out.tx = 0;
    out.tz = 1;
    return out;
  }
  if (path.closed) s = ((s % len) + len) % len;
  else s = s < 0 ? 0 : s > len ? len : s;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg > 1e-9 ? (s - cum[lo]) / seg : 0;
  const ax = xy[lo * 2];
  const az = xy[lo * 2 + 1];
  const bx = xy[hi * 2];
  const bz = xy[hi * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  const L = Math.max(1e-9, seg);
  out.tx = (bx - ax) / L;
  out.tz = (bz - az) / L;
  return out;
}

/** Smallest exact clearance along a path (sampled every 0.25 m). */
export function pathClearance(nav, path) {
  let m = Infinity;
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  for (let s = 0; s <= path.len; s += 0.25) {
    pathAt(path, s, p);
    m = Math.min(m, nav.clear(p.x, p.z));
  }
  return m;
}

/** Cell route between two points as world points (with exact ends), or null. */
function route(nav, ax, az, bx, bz, c) {
  const comp = components(nav, c);
  const from = nearestCell(nav, ax, az, c);
  if (from < 0) return null;
  const to = nearestCell(nav, bx, bz, c, comp, comp[from]);
  if (to < 0) return null;
  const cells = astar(nav, from, to, c);
  if (!cells) return null;
  const pts = cells.map((i) => [cx(nav, i), cz(nav, i)]);
  pts[0] = [ax, az];
  pts[pts.length - 1] = [bx, bz];
  if (pts.length === 1) pts.push([bx, bz]);
  return pts;
}

/**
 * A troupe's path from one point to another through `via` points (a promenade loop when closed), keeping clearance c.
 * Cached. Returns a path with `minClear`, or null when there is no way.
 */
export function troupePath(plaza, key, points, c, closed) {
  const nav = navFor(plaza);
  const k = `${key}|${c}`;
  if (nav.paths.has(k)) return nav.paths.get(k);
  const seq = closed ? [...points, points[0]] : points;
  let all = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const leg = route(nav, seq[i][0], seq[i][1], seq[i + 1][0], seq[i + 1][1], c);
    if (!leg) {
      nav.paths.set(k, null);
      return null;
    }
    const pulled = pull(nav, leg, c);
    if (i > 0) pulled.shift();
    all = all.concat(pulled);
  }
  const rounded = fillet(all, 0.3, 2.4);
  let path = makePath(rounded, closed);
  let m = pathClearance(nav, path);
  if (m < c - 0.4) {
    path = makePath(all, closed);
    m = pathClearance(nav, path);
  }
  path.minClear = m;
  nav.paths.set(k, path);
  return path;
}

/** A player's walk to a point: straight legs around obstacles, ending at the nearest reachable spot. */
export function walkPath(plaza, ax, az, bx, bz, c = 0.42) {
  const nav = navFor(plaza);
  if (straightClear(nav, ax, az, bx, bz, c)) return [[ax, az], [bx, bz]];
  const comp = components(nav, c);
  const from = nearestCell(nav, ax, az, c);
  if (from < 0) return null;
  const to = nearestCell(nav, bx, bz, c, comp, comp[from]);
  if (to < 0) return null;
  const end = nav.cl[cellOf(nav, bx, bz)] >= c && comp[cellOf(nav, bx, bz)] === comp[from] ? [bx, bz] : [cx(nav, to), cz(nav, to)];
  const cells = astar(nav, from, to, c);
  if (!cells) return null;
  const pts = cells.map((i) => [cx(nav, i), cz(nav, i)]);
  pts[0] = [ax, az];
  pts[pts.length - 1] = end;
  if (pts.length === 1) pts.push(end);
  return pull(nav, pts, c);
}

/** Is there a clear line of sight between two points (occluding obstacles only)? */
export function lineOfSight(plaza, ax, az, bx, bz) {
  const nav = navFor(plaza);
  for (const o of nav.occluders) {
    if (o.t === 'c' ? segHitsCircle(ax, az, bx, bz, o.x, o.z, o.r) : segHitsBox(ax, az, bx, bz, o)) return false;
  }
  return true;
}

/** Moves a point out of anything solid to the nearest spot with clearance r. Writes into out. */
export function settle(plaza, x, z, r, out) {
  const nav = navFor(plaza);
  if (nav.clear(x, z) >= r) {
    out.x = x;
    out.z = z;
    return out;
  }
  // Step down the clearance gradient a few times, then fall back to the nearest good cell.
  let px = x;
  let pz = z;
  for (let i = 0; i < 6; i++) {
    const c0 = nav.clear(px, pz);
    if (c0 >= r) break;
    const e = 0.05;
    const gx = (nav.clear(px + e, pz) - nav.clear(px - e, pz)) / (2 * e);
    const gz = (nav.clear(px, pz + e) - nav.clear(px, pz - e)) / (2 * e);
    const gl = Math.sqrt(gx * gx + gz * gz);
    if (gl < 1e-6) break;
    const step = r - c0 + 0.02;
    px += (gx / gl) * step;
    pz += (gz / gl) * step;
  }
  if (nav.clear(px, pz) < r) {
    const k = nearestCell(nav, x, z, r + 0.1);
    if (k >= 0) {
      px = cx(nav, k);
      pz = cz(nav, k);
    }
  }
  out.x = px;
  out.z = pz;
  return out;
}

export { floorY, CELL };

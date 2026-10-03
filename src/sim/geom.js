// Small 2D helpers on the ground plane (x east, z south). No allocation in the hot ones.

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const smoothRange = (a, b, x) => smooth((x - a) / (b - a));

/** Wraps an angle to (-PI, PI]. */
export function wrap(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}
export const angDiff = (a, b) => wrap(b - a);
export const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
/** Heading (radians) of a direction on the ground: 0 faces +z (south), PI/2 faces +x. */
export const heading = (dx, dz) => Math.atan2(dx, dz);

export const dist = (ax, az, bx, bz) => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

/** A finite number, or the fallback. Clamped to +-limit. */
export function num(v, fallback = 0, limit = 1e6) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n > limit ? limit : n < -limit ? -limit : n;
}

/** Does the segment a->b pass within r of the point c? */
export function segHitsCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((cx - ax) * dx + (cz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = ax + dx * t - cx;
  const pz = az + dz * t - cz;
  return px * px + pz * pz < r * r;
}

/** Does the segment a->b cross the box (centre, half sizes, rotation)? Slab test in the box's frame. */
export function segHitsBox(ax, az, bx, bz, box, pad = 0) {
  const c = Math.cos(-box.rot || 0);
  const s = Math.sin(-box.rot || 0);
  const lax = (ax - box.x) * c - (az - box.z) * s;
  const laz = (ax - box.x) * s + (az - box.z) * c;
  const lbx = (bx - box.x) * c - (bz - box.z) * s;
  const lbz = (bx - box.x) * s + (bz - box.z) * c;
  const hx = box.w / 2 + pad;
  const hz = box.d / 2 + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = lbx - lax;
  const dz = lbz - laz;
  for (const [p, d, h] of [
    [lax, dx, hx],
    [laz, dz, hz],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (p < -h || p > h) return false;
    } else {
      let ta = (-h - p) / d;
      let tb = (h - p) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Signed distance from a point to a box's outline (negative inside). */
export function boxDistance(px, pz, box) {
  const c = Math.cos(-box.rot || 0);
  const s = Math.sin(-box.rot || 0);
  const lx = Math.abs((px - box.x) * c - (pz - box.z) * s) - box.w / 2;
  const lz = Math.abs((px - box.x) * s + (pz - box.z) * c) - box.d / 2;
  const ox = Math.max(lx, 0);
  const oz = Math.max(lz, 0);
  return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(lx, lz), 0);
}

/** Pushes a point out of a box by at least r; returns true if it moved. Writes into out. */
export function pushOutOfBox(px, pz, r, box, out) {
  const c = Math.cos(-box.rot || 0);
  const s = Math.sin(-box.rot || 0);
  const lx = (px - box.x) * c - (pz - box.z) * s;
  const lz = (px - box.x) * s + (pz - box.z) * c;
  const hx = box.w / 2 + r;
  const hz = box.d / 2 + r;
  if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return false;
  let nx = lx;
  let nz = lz;
  if (hx - Math.abs(lx) < hz - Math.abs(lz)) nx = lx < 0 ? -hx : hx;
  else nz = lz < 0 ? -hz : hz;
  const ci = Math.cos(box.rot || 0);
  const si = Math.sin(box.rot || 0);
  out.x = box.x + nx * ci - nz * si;
  out.z = box.z + nx * si + nz * ci;
  return true;
}

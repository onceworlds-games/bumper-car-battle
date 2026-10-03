// The chase camera: behind and above you, orbit by drag or keys, zoom by wheel or pinch, pulled in by walls and
// pillars, wider in portrait, and the opera glass's 3x zoom. Figures between it and you fade (see view.js).
import * as THREE from 'three';
import { navFor } from '../sim/nav.js';
import { floorY } from '../sim/plazas.js';

const MIN_D = 3.2;
const MAX_D = 17;
const ROOF_CLEAR = 1.6; // the camera stays this far above a roof, or out of the way

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(52, 1, 0.1, 900);
  const st = {
    yaw: 0.6,
    pitch: 0.52,
    dist: 10.5,
    tx: 0,
    ty: 1.4,
    tz: 0,
    opera: 0,
    shake: 0,
    manualAt: -99,
    look: { yaw: 0, pitch: 0 },
  };
  const out = new THREE.Vector3();
  const api = {
    cam,
    st,
    aspect(w, h) {
      cam.aspect = w / h;
      api.fov();
    },
    fov() {
      // Keep at least ~68 degrees across in portrait, so a phone held upright still sees the crowd.
      const a = cam.aspect;
      let v = 52;
      if (a < 1.25) v = (2 * Math.atan(Math.tan((68 * Math.PI) / 360) / a) * 180) / Math.PI;
      v = Math.min(88, v);
      cam.fov = v / (1 + st.opera * 2);
      cam.updateProjectionMatrix();
    },
    orbit(dyaw, dpitch, now) {
      st.yaw += dyaw;
      st.pitch = Math.max(0.12, Math.min(1.25, st.pitch + dpitch));
      st.manualAt = now;
    },
    zoom(f) {
      st.dist = Math.max(MIN_D, Math.min(MAX_D, st.dist * f));
    },
    /** Puts the camera behind a heading straight away (a new round, back from the Powder Room). */
    snap(x, y, z, heading) {
      st.tx = x;
      st.ty = y + 1.4;
      st.tz = z;
      if (heading !== undefined) st.yaw = heading + Math.PI;
    },
    /**
     * Follows (x, y, z). `moving` with `heading`: when you walk and haven't orbited lately, the camera swings
     * gently round behind you.
     */
    update(dt, x, y, z, plaza, { heading = null, moving = false, now = 0, reduced = false } = {}) {
      const k = 1 - Math.exp(-dt * 9);
      st.tx += (x - st.tx) * k;
      st.ty += (y + 1.4 - st.ty) * k;
      st.tz += (z - st.tz) * k;
      if (moving && heading !== null && now - st.manualAt > 2.2 && st.opera < 0.05) {
        const want = heading + Math.PI;
        let d = want - st.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        // Only swing when walking away from the camera-ish: walking toward it shouldn't spin the view.
        if (Math.abs(d) < 2.2) st.yaw += d * Math.min(1, dt * 0.9);
      }
      const opera = st.opera;
      const dist = st.dist * (1 - opera * 0.15);
      const cp = Math.cos(st.pitch);
      let px = st.tx + Math.sin(st.yaw) * cp * dist;
      let pz = st.tz + Math.cos(st.yaw) * cp * dist;
      let py = st.ty + Math.sin(st.pitch) * dist;
      // Pull in from walls and tall things (never through the houses around the plaza).
      if (plaza) {
        const nav = navFor(plaza);
        const b = plaza.bounds;
        const steps = 14;
        let lastOk = 0;
        for (let i = 1; i <= steps; i++) {
          const u = i / steps;
          const sx = st.tx + (px - st.tx) * u;
          const sz = st.tz + (pz - st.tz) * u;
          const sy = st.ty + (py - st.ty) * u;
          const inside = sx > b.x0 - 1.5 && sx < b.x1 + 1.5 && sz > b.z0 - 1.5 && sz < b.z1 + 1.5;
          let blocked = !inside && sy < 16;
          if (!blocked && plaza.roofs) {
            // Arcade roofs: never above them looking down at the tiles, never inside the beams.
            for (const rf of plaza.roofs) {
              if (sy < rf.h - 1.2 || sy > rf.h + ROOF_CLEAR) continue;
              if (sx > rf.x0 - 0.5 && sx < rf.x1 + 0.5 && sz > rf.z0 - 0.5 && sz < rf.z1 + 0.5) {
                blocked = true;
                break;
              }
            }
          }
          if (!blocked) {
            for (const o of nav.occluders) {
              if (o.h + ROOF_CLEAR < sy) continue;
              // Whatever stands right by the target (you can't be inside it) doesn't pull the camera in.
              const dt = o.t === 'c' ? Math.hypot(st.tx - o.x, st.tz - o.z) - o.r : Math.max(Math.abs(st.tx - o.x) - o.w / 2, Math.abs(st.tz - o.z) - o.d / 2);
              if (dt < 1.2) continue;
              const d = o.t === 'c' ? Math.hypot(sx - o.x, sz - o.z) - o.r : Math.max(Math.abs(sx - o.x) - o.w / 2, Math.abs(sz - o.z) - o.d / 2);
              if (d < 0.4) {
                blocked = true;
                break;
              }
            }
          }
          if (blocked) break;
          lastOk = u;
        }
        if (lastOk < 1) {
          const u = Math.max(0.18, lastOk);
          px = st.tx + (px - st.tx) * u;
          pz = st.tz + (pz - st.tz) * u;
          py = st.ty + (py - st.ty) * u + (1 - u) * 1.2;
        }
        py = Math.max(py, floorY(plaza, px, pz) + 0.7);
      }
      if (st.shake > 0 && !reduced) {
        const s = st.shake * 0.12;
        px += (Math.random() - 0.5) * s;
        py += (Math.random() - 0.5) * s;
        pz += (Math.random() - 0.5) * s;
      }
      st.shake = Math.max(0, st.shake - dt * 2.5);
      cam.position.set(px, py, pz);
      // With the opera glass up, look further ahead along the view.
      const ahead = opera * 14;
      out.set(st.tx - Math.sin(st.yaw) * ahead, st.ty + opera * 0.4, st.tz - Math.cos(st.yaw) * ahead);
      cam.lookAt(out);
      api.fov();
    },
  };
  return api;
}

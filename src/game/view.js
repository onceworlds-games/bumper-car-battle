// From a moment of the round to figures on the stage: revellers from the crowd buffer (skipping slots a masker
// stands in), maskers wherever they are, decoys, revellers walking back after a swap, heads turning toward greetings,
// gasps and lanterns, and anything between the camera and you faded out.
import { STRIDE } from '../sim/crowd.js';
import { newPose, poseFor } from '../render/anim.js';
import { unit } from '../sim/rng.js';
import { floorY } from '../sim/plazas.js';
import { wrap } from '../sim/geom.js';

const pose = newPose();
const fx = { shimmer: 0, slip: 0, off: false, fade: 1, slipAmt: 0 };
const phases = new Float32Array(256);
for (let i = 0; i < 256; i++) phases[i] = unit('phase', i) * Math.PI * 2;

/** How far a point is from the segment camera -> focus (to fade what stands in the way). */
function lineDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  if (t < 0.05 || t > 0.92) return 99;
  t = Math.min(1, Math.max(0, t));
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

/**
 * frame: { time (seconds, for animation), crowd, buf, skip (Uint8Array), plaza, cam {x, z, fx, fz} (camera and focus),
 * maskers: [{ tr, x, y, z, h, em, et, sp, sprint, shimmer, slip, off, hidden }], decoys: [{ tr, x, z, h, em, et, sp }],
 * returning: Map(slot -> {x, z, k}) (revellers walking back after a swap), attention: [{ x, z, r, tx, tz, until, gasp, slot }] }
 */
export function drawFigures(stage, frame) {
  const figs = stage.figures;
  const { buf, crowd, skip, time, plaza, cam } = frame;
  figs.begin();
  const count = crowd ? crowd.count : 0;
  const att = frame.attention || [];
  for (let s = 0; s < count; s++) {
    if (skip && skip[s]) continue;
    const o = s * STRIDE;
    let x = buf[o];
    let z = buf[o + 1];
    let h = buf[o + 3];
    let em = buf[o + 4];
    let et = buf[o + 5];
    let sp = buf[o + 6];
    const ret = frame.returning?.get(s);
    if (ret) {
      // Walking back to its own place after a swap took it.
      x = ret.x + (x - ret.x) * ret.k;
      z = ret.z + (z - ret.z) * ret.k;
      if (ret.k < 1) {
        h = Math.atan2(buf[o] - ret.x, buf[o + 1] - ret.z);
        sp = 1.7;
        em = 0;
      }
    }
    poseFor(em, et, sp, time, phases[s & 255], false, pose);
    // Attention: a reveller can be told to gasp or wave back (a slot entry); heads within reach of a greeting, a
    // commotion or a lantern turn toward it, each a beat apart.
    for (let k = 0; k < att.length; k++) {
      const a = att[k];
      if (a.age < 0) continue;
      if (a.slot !== undefined) {
        if (a.slot === s && a.age < a.dur) poseFor(a.em, a.age, 0, time, phases[s & 255], false, pose);
        continue;
      }
      const dx = a.x - x;
      const dz = a.z - z;
      if (dx * dx + dz * dz > a.r * a.r) continue;
      const dl = frame.turnDelay ? frame.turnDelay(s) : 0;
      const k2 = Math.min(1, Math.max(0, (a.age - dl) * 4)) * Math.min(1, Math.max(0, (a.dur - a.age) * 3));
      if (k2 <= 0) continue;
      const want = wrap(Math.atan2(a.tx - x, a.tz - z) - h);
      const turn = Math.max(-1.25, Math.min(1.25, want));
      pose.yaw += (turn - pose.yaw) * k2;
      pose.pitch = pose.pitch * (1 - k2) + (a.up ?? 0) * k2;
      if (Math.abs(want) > 1.25) h += Math.sign(want) * (Math.abs(want) - 1.25) * 0.5 * k2;
    }
    fx.shimmer = 0;
    fx.slip = 0;
    fx.off = false;
    fx.slipAmt = 0;
    fx.fade = fadeFor(x, z, cam);
    figs.add(crowd.troupeOf(s), x, floorY(plaza, x, z), z, h, pose, fx);
  }
  for (const m of frame.maskers || []) {
    if (m.hidden) continue;
    poseFor(m.em || 0, m.et || 0, m.sp || 0, time, phases[(m.phase ?? 7) & 255], !!m.sprint, pose);
    if (m.yaw !== undefined) pose.yaw = m.yaw;
    fx.shimmer = m.shimmer || 0;
    fx.slip = m.slip || 0;
    fx.slipAmt = m.slip ? Math.min(1, m.slip * 1.5) : 0;
    fx.off = !!m.off;
    fx.fade = m.me ? Math.max(0.35, fadeFor(m.x, m.z, cam)) : fadeFor(m.x, m.z, cam);
    figs.add(m.tr, m.x, m.y ?? floorY(plaza, m.x, m.z), m.z, m.h, pose, fx);
  }
  for (const d of frame.decoys || []) {
    poseFor(d.em || 0, d.et || 0, d.sp || 0, time, phases[(d.phase ?? 3) & 255], false, pose);
    fx.shimmer = 0;
    fx.slip = 0;
    fx.slipAmt = 0;
    fx.off = false;
    fx.fade = fadeFor(d.x, d.z, cam);
    figs.add(d.tr, d.x, floorY(plaza, d.x, d.z), d.z, d.h, pose, fx);
  }
  if (frame.ghost) {
    const g = frame.ghost;
    figs.ghost(g.tr, g.x, floorY(plaza, g.x, g.z), g.z, g.h, g.alpha);
  }
  figs.end(time);
}

function fadeFor(x, z, cam) {
  if (!cam) return 1;
  const dc = Math.sqrt((x - cam.x) * (x - cam.x) + (z - cam.z) * (z - cam.z));
  if (dc < 1.6) return Math.max(0, (dc - 0.6) / 1.0);
  const d = lineDist(x, z, cam.x, cam.z, cam.fx, cam.fz);
  if (d > 0.9) return 1;
  return 0.25 + (d / 0.9) * 0.75;
}

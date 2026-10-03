// Body language: from what a figure is doing (walking, bowing, waving, gasping...) to the few numbers the figure
// renderer animates: a bend at the waist, the head's turn and tilt, both arms, a bob, a sway and a squash.
import { EM } from '../sim/choreo.js';

const TAU = Math.PI * 2;
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function newPose() {
  return { bend: 0, yaw: 0, pitch: 0, bob: 0, roll: 0, squash: 0, lp: 0, lr: 0.12, rp: 0, rr: 0.12, fan: 0 };
}

/**
 * Writes the pose for emote `em` at `et` seconds into it, moving at `speed` m/s, at clock `time` (seconds), with a
 * per-figure phase so a crowd never steps in lockstep. `sprint` leans into a run.
 */
export function poseFor(em, et, speed, time, phase, sprint, out) {
  const amp = Math.min(1.7, speed / 1.7);
  const cadence = sprint ? 2.9 : 1.9;
  const w = time * TAU * cadence + phase;
  const s = Math.sin(w);
  out.bend = sprint ? 0.3 * Math.min(1, amp) : 0.05 * amp;
  out.yaw = 0;
  out.pitch = 0;
  out.bob = Math.abs(s) * (sprint ? 0.07 : 0.032) * amp;
  out.roll = s * 0.03 * amp;
  out.squash = 0;
  out.lp = s * (sprint ? 0.9 : 0.42) * amp;
  out.rp = -out.lp;
  out.lr = 0.12;
  out.rr = 0.12;
  out.fan = 0;
  // Idle sway when standing: a reveller is never quite still.
  if (amp < 0.15) {
    out.roll = Math.sin(time * 0.9 + phase) * 0.018;
    out.yaw = Math.sin(time * 0.37 + phase * 2) * 0.12;
  }
  if (!em) return out;
  const still = sm(1 - amp / 0.5);
  switch (em) {
    case EM.bow: {
      // Down, hold, up: a courtly bow with one hand across the chest.
      const k = et < 0.45 ? sm(et / 0.45) : et < 1.0 ? 1 : sm(1 - (et - 1.0) / 0.45);
      out.bend = 0.85 * k * still + out.bend * (1 - still);
      out.pitch = -0.25 * k;
      out.rp = -1.25 * k + out.rp * (1 - k);
      out.rr = 0.15;
      out.lr = 0.12 + 0.55 * k;
      out.lp = 0.25 * k;
      break;
    }
    case EM.wave:
    case EM.eager: {
      // An eager wave is too quick and too much: a double flap.
      const fast = em === EM.eager ? 2.2 : 1;
      const up = em === EM.eager ? 1 : sm(et * 5) * sm((1.4 - et) * 5);
      out.rr = 0.12 + 2.35 * up;
      out.rp = -0.25 * up + Math.sin(et * 14 * fast) * 0.45 * up;
      out.yaw *= 1 - up;
      out.pitch = 0.08 * up;
      out.squash = em === EM.eager ? Math.sin(et * 30) * 0.03 : 0;
      break;
    }
    case EM.sip: {
      const k = sm(Math.sin((et / 4.2) * TAU) * 1.5);
      out.rp = -1.9 * k;
      out.rr = 0.25 * k;
      out.pitch = 0.18 * k;
      break;
    }
    case EM.juggle: {
      const a = Math.sin(et * TAU * 1.5);
      out.lp = -1.0 - 0.45 * a;
      out.rp = -1.0 + 0.45 * a;
      out.lr = 0.3;
      out.rr = 0.3;
      out.pitch = 0.35;
      out.bob = Math.abs(a) * 0.02;
      break;
    }
    case EM.clap: {
      const a = Math.abs(Math.sin(et * TAU * 1.9));
      out.lp = -1.25;
      out.rp = -1.25;
      out.lr = 0.05 + a * 0.4;
      out.rr = 0.05 + a * 0.4;
      out.bob = a * 0.015;
      break;
    }
    case EM.spin: {
      out.lr = 1.3;
      out.rr = 1.3;
      out.lp = -0.2;
      out.rp = -0.2;
      out.bob = Math.abs(Math.sin(et * TAU * 1.1)) * 0.05;
      out.pitch = 0.1;
      break;
    }
    case EM.admire:
      out.pitch = 0.3;
      out.yaw *= 0.3;
      break;
    case EM.point: {
      const k = sm(et * 4) * sm((1.6 - et) * 4);
      out.pitch = 0.3;
      out.rp = -1.55 * k;
      out.rr = 0.15;
      break;
    }
    case EM.lookup: {
      const k = sm(et * 1.5);
      out.pitch = 0.75 * k;
      out.bend = -0.12 * k;
      out.yaw = Math.sin(et * 0.6 + phase) * 0.25 * k;
      out.lp = 0;
      out.rp = 0;
      out.roll = 0;
      break;
    }
    case EM.gasp: {
      const k = et < 0.25 ? sm(et / 0.25) : sm(1 - (et - 1.6) / 0.6);
      out.bend = -0.22 * k;
      out.lp = -2.2 * k;
      out.rp = -2.2 * k;
      out.lr = 0.35 * k;
      out.rr = 0.35 * k;
      out.squash = -0.06 * k;
      out.pitch = 0.2 * k;
      break;
    }
    case EM.flick: {
      // The fan snaps open and sweeps across: the unmasking gesture.
      const k = et < 0.18 ? sm(et / 0.18) : sm(1 - (et - 0.55) / 0.3);
      out.rp = -1.1 * k;
      out.rr = 0.2 + 1.1 * Math.max(0, Math.sin(Math.min(1, et / 0.45) * Math.PI)) * k;
      out.bend = 0.15 * k;
      out.fan = k;
      break;
    }
    case EM.stiff:
      out.lp = 0;
      out.rp = 0;
      out.lr = 0.04;
      out.rr = 0.04;
      out.roll = 0;
      out.yaw = 0;
      out.bob = 0;
      break;
    case EM.flourish: {
      const k = et < 0.4 ? sm(et / 0.4) : et < 1.4 ? 1 : sm(1 - (et - 1.4) / 0.4);
      out.rr = 0.12 + 2.1 * k;
      out.lr = 0.12 + 1.2 * k;
      out.bend = 0.4 * sm(Math.max(0, et - 0.9) * 3) * k;
      out.pitch = -0.15 * k;
      break;
    }
    default:
      break;
  }
  return out;
}

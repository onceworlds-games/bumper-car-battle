// A round on screen: the crowd at this moment, every masker where they are (one locked in step is drawn exactly on
// its slot, so lag never becomes a tell), you stepped at a fixed rate, what you could unmask, and the camera.
import { STRIDE } from '../sim/crowd.js';
import { stage as stageOf, decoyAt, FLAG } from '../sim/rules.js';
import { PLAZAS, floorY } from '../sim/plazas.js';
import { SEEN } from '../sim/const.js';
import { EM } from '../sim/choreo.js';
import { drawFigures } from './view.js';
import { readPresence } from '../net/wire.js';
import { safe } from '../platform.js';

const FIXED = 1 / 60;
const VERDICT_EM = { ok: EM.wave, eager: EM.eager, stiff: EM.stiff };

export function createRoundView() {
  const maskerList = [];
  const decoyList = [];
  const returning = new Map();
  const targets = [];
  const others = [];
  const pose = { x: 0, z: 0, h: 0, f: 0, w: null, e: null };
  const slotTmp = { x: 0, z: 0, h: 0, sp: 0 };
  const prevPos = new Map();
  const answers = new Map();
  let skip = new Uint8Array(0);
  let acc = 0;
  let wasOut = false;
  let fwRid = '';
  let lastDust = 0;
  const view = {
    targets,
    answers,
    lastRid: '',
    /** Who is who this frame, for labels: [{ id, x, y, z }] */
    labels: [],
    frame: null,
    /**
     * ctx: { stage, session, player, input, now (seconds, wall), dt, attention, reduced, spectate }. Returns the state
     * the HUD needs: { r, t, st, me (masker or null), rs, slot }.
     */
    update(ctx) {
      const { stage, session, player } = ctx;
      const r = session.round;
      if (!r) return null;
      const plaza = PLAZAS[r.plaza];
      stage.setPlaza(plaza);
      const crowd = session.crowdFor(r);
      const t = session.time();
      const S = { r, fx: session.fx, endAt: r.endAt < 0 ? Infinity : r.endAt, timing: r.timing };
      const st = stageOf(S, t);
      const hushAt = Math.min(r.timing.hushStart, r.endAt >= 0 ? r.endAt : Infinity);
      const buf = crowd.eval(t, hushAt);
      if (skip.length !== crowd.count) skip = new Uint8Array(crowd.count);
      skip.fill(0);
      for (const m of Object.values(r.m)) if (!m.gone) skip[m.tr * r.crowd + m.sl] = 1;
      const rs = session.status;
      const meId = session.me;
      const meM = r.m[meId] && !r.m[meId].gone ? r.m[meId] : null;
      const myRs = meM ? rs[meId] : null;
      const out = myRs ? myRs.out > t : false;
      const playing = !!meM && !myRs?.aud && !ctx.spectate;

      // ---- me ----
      if (playing && (player.st.rid !== r.rid || (wasOut && !out))) {
        const s = slotOf(r, meId, buf, slotTmp);
        const mine = readPresence(safe(() => session.room.me.presence, null));
        if (player.st.rid !== r.rid && mine && mine.r === r.rid && mine.s === 'p' && !(mine.f & FLAG.locked)) player.place(r.rid, mine.x, mine.z, mine.h, false);
        else player.place(r.rid, s.x, s.z, s.h, true);
        stage.camera.snap(player.mv.x, floorY(plaza, player.mv.x, player.mv.z), player.mv.z, player.mv.h);
        view.lastRid = r.rid;
      }
      wasOut = out;
      // Sprint dust, a puff every few frames for anyone sprinting near you.
      const dustNow = ctx.now - lastDust > 0.07;
      if (dustNow) lastDust = ctx.now;
      // Other maskers, for collisions and drawing.
      others.length = 0;
      maskerList.length = 0;
      view.labels.length = 0;
      targets.length = 0;
      for (const [id, m] of Object.entries(r.m)) {
        if (m.gone || id === meId) continue;
        const s = rs[id];
        if (s && (s.out > t || s.aud)) continue;
        if (!session.pose(id, r, pose)) {
          // Not in the plaza yet (still loading): they stand in their slot.
          const sp = slotOf(r, id, buf, slotTmp);
          pose.x = sp.x;
          pose.z = sp.z;
          pose.h = sp.h;
          pose.f = FLAG.locked;
          pose.w = null;
          pose.e = null;
        }
        let x = pose.x;
        let z = pose.z;
        let h = pose.h;
        let em = 0;
        let et = 0;
        let sp = 0;
        if (pose.f & FLAG.locked) {
          const o = (m.tr * r.crowd + m.sl) * STRIDE;
          x = buf[o];
          z = buf[o + 1];
          h = buf[o + 3];
          em = buf[o + 4];
          et = buf[o + 5];
          sp = buf[o + 6];
        } else {
          const prev = prevPos.get(id);
          if (prev) sp = Math.min(5, Math.hypot(x - prev.x, z - prev.z) / Math.max(1e-3, ctx.dt));
          prevPos.set(id, { x, z });
          sp = prev ? prev.sp * 0.7 + sp * 0.3 : sp;
          prevPos.get(id).sp = sp;
        }
        // What they're doing: an answer to a greeting, a fan flick, a wave, a flourish.
        const ans = answers.get(id);
        if (ans && t - ans.t < 1.5) {
          em = VERDICT_EM[ans.v];
          et = t - ans.t;
        }
        if (pose.e && pose.e[0]) {
          const eAt = (pose.e[1] - r.t0) / 1000;
          if (t - eAt >= 0 && t - eAt < 2.2) {
            em = pose.e[0];
            et = t - eAt;
          }
        }
        const dist = Math.hypot(x - player.mv.x, z - player.mv.z);
        const opera = player.st.opera;
        const shimmer = s && s.fl > t && (dist <= SEEN.shimmer || (opera && dist <= SEEN.shimmerOpera) || ctx.spectate) ? 1 : 0;
        const slip = s && s.sl > t && (dist <= SEEN.slip || ctx.spectate) ? Math.min(1, (s.sl - t) / 1.5) : 0;
        const sprint = !!(pose.f & FLAG.sprint) && !(pose.f & FLAG.locked);
        if (sprint && dist <= SEEN.dust && dustNow) stage.fx.dust(x, floorY(plaza, x, z), z);
        maskerList.push({ id, tr: m.tr, x, z, h, em, et, sp, sprint, shimmer, slip, off: st === 'reveal' || st === 'results', phase: hashId(id) });
        others.push(x, z);
        targets.push({ ref: { k: 'p', id }, x, z });
        view.labels.push({ id, x, z, name: m.nm, bot: m.b });
      }
      // Decoys and revellers walking back after a swap.
      decoyList.length = 0;
      returning.clear();
      for (const f of session.fx) {
        if (f.k === 'decoy' && f.until > t && f.t <= t) {
          const p = decoyAt({ r }, f, buf, t, slotTmp);
          const o = (f.tr * r.crowd + f.sl) * STRIDE;
          const held = p.held;
          decoyList.push({ tr: f.tr, x: p.x, z: p.z, h: held ? buf[o + 3] : Math.atan2(buf[o] - p.x, buf[o + 1] - p.z), em: held ? buf[o + 4] : 0, et: held ? buf[o + 5] : 0, sp: held ? buf[o + 6] : 1.7, phase: 11 });
          targets.push({ ref: { k: 'd', id: f.id }, x: p.x, z: p.z });
        } else if (f.k === 'swap' && f.until > t) {
          const s = f.tr * r.crowd + f.sl;
          if (skip[s]) continue;
          const o = s * STRIDE;
          const d = Math.hypot(buf[o] - f.x, buf[o + 1] - f.z);
          const k = Math.min(1, ((t - f.t) * 1.7) / Math.max(0.1, d));
          returning.set(s, { x: f.x, z: f.z, k });
        }
      }
      for (let s = 0; s < crowd.count; s++) {
        if (skip[s]) continue;
        const o = s * STRIDE;
        targets.push({ ref: { k: 'n', s }, x: buf[o], z: buf[o + 1] });
      }

      // ---- step me at a fixed rate ----
      const frozenMe = !playing || out || st === 'reveal' || st === 'results' || st === 'over';
      const slot = playing ? slotOf(r, meId, buf, slotTmp) : null;
      const decoyHolds = session.fx.some((f) => f.k === 'decoy' && f.owner === meId && f.until > t);
      if (playing && !out) {
        acc = Math.min(acc + ctx.dt, 0.25);
        while (acc >= FIXED) {
          acc -= FIXED;
          player.update(FIXED, {
            keys: ctx.input.held,
            camYaw: stage.camera.st.yaw,
            plaza,
            slot,
            canLock: !decoyHolds && st !== 'over',
            crowd: buf,
            count: crowd.count,
            skip,
            others,
            sprintOk: !!myRs && myRs.p > 0 && myRs.fl <= t,
            frozen: frozenMe || ctx.blocked,
          });
        }
      }
      // ---- draw ----
      const mv = player.mv;
      if (playing && !out) {
        const e = player.emoteNow(ctx.now);
        let em = 0;
        let et = 0;
        let sp = mv.speed;
        if (mv.locked && slot) {
          const o = (meM.tr * r.crowd + meM.sl) * STRIDE;
          em = buf[o + 4];
          et = buf[o + 5];
          sp = buf[o + 6];
        }
        if (e) [em, et] = e;
        const ans = answers.get(meId);
        if (ans && t - ans.t < 1.5) {
          em = VERDICT_EM[ans.v];
          et = t - ans.t;
        }
        maskerList.push({ id: meId, me: true, tr: meM.tr, x: mv.x, z: mv.z, h: mv.h, em, et, sp, sprint: player.st.sprinting, shimmer: myRs && myRs.fl > t ? 1 : 0, slip: myRs && myRs.sl > t ? Math.min(1, (myRs.sl - t) / 1.5) : 0, off: st === 'reveal' || st === 'results', phase: 5 });
        view.labels.push({ id: meId, x: mv.x, z: mv.z, name: meM.nm, me: true });
        if (player.st.sprinting && dustNow) stage.fx.dust(mv.x, floorY(plaza, mv.x, mv.z), mv.z);
      }
      // Camera: you, or (watching) a slow turn round the plaza.
      const cam = stage.camera;
      if (playing && !out) {
        cam.st.opera += ((player.st.opera ? 1 : 0) - cam.st.opera) * Math.min(1, ctx.dt * 6);
        cam.update(ctx.dt, mv.x, floorY(plaza, mv.x, mv.z), mv.z, plaza, { heading: mv.h, moving: player.st.steer && mv.speed > 0.5, now: ctx.now, reduced: ctx.reduced });
      } else {
        cam.st.opera = 0;
        const b = plaza.bounds;
        const cx = (b.x0 + b.x1) / 2;
        const cz = (b.z0 + b.z1) / 2;
        if (!ctx.manualOrbit) cam.st.yaw += ctx.dt * 0.05;
        cam.st.pitch = Math.max(cam.st.pitch, 0.5);
        cam.st.dist = Math.max(cam.st.dist, 16);
        cam.update(ctx.dt, cx, 0, cz, plaza, { now: ctx.now });
      }
      const ghost = playing && !out && !mv.locked && slot && st !== 'reveal' && st !== 'results' ? { tr: meM.tr, x: slot.x, z: slot.z, h: slot.h, alpha: Math.min(1, Math.hypot(slot.x - mv.x, slot.z - mv.z) / 1.2) } : null;
      view.frame = {
        time: ctx.now,
        crowd,
        buf,
        skip,
        plaza,
        maskers: maskerList,
        decoys: decoyList,
        returning,
        attention: ctx.attention,
        ghost,
        cam: { x: cam.cam.position.x, z: cam.cam.position.z, fx: cam.st.tx, fz: cam.st.tz },
      };
      drawFigures(stage, view.frame);
      // Lanterns in flight and glowing where they landed.
      const lan = [];
      for (const f of session.fx) if (f.k === 'lantern' && f.until > t - 0.2) lan.push({ fx: f.fx, fz: f.fz, x: f.x, z: f.z, age: t - f.t });
      stage.fx.lanterns(lan, (x, z) => floorY(plaza, x, z));
      // The Hush: fireworks over the plaza, the same show on every screen.
      if (fwRid !== r.rid) {
        fwRid = r.rid;
        const b = plaza.bounds;
        stage.fx.setFireworks(r.seed, hushAt, r.timing.end - hushAt + 4, { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 }, Math.min(b.x1 - b.x0, b.z1 - b.z0) * 0.45);
      }
      stage.fx.fireworksTime(t);
      return { r, t, st, me: playing ? meM : null, rs: myRs, slot, out, buf, crowd, plaza, hushAt };
    },
    /** A tap or click on the stones: walk there (or, on a figure, mark it). */
    tapWorld(stage, player, session, sx, sy, touch) {
      const r = session.round;
      if (!r) return;
      const plaza = PLAZAS[r.plaza];
      const cam = stage.camera.cam;
      // A figure under the finger first (screen distance to its head).
      const w = stage.R.size.w;
      const h = stage.R.size.h;
      let best = null;
      let bestD = touch ? 42 : 28;
      for (const tg of targets) {
        const v = projected(cam, tg.x, floorY(plaza, tg.x, tg.z) + 1.3, tg.z, w, h);
        if (!v) continue;
        const d = Math.hypot(v[0] - sx, v[1] - sy);
        if (d < bestD) {
          bestD = d;
          best = tg;
        }
      }
      if (best) {
        const same = player.st.mark && sameKind(player.st.mark, best.ref);
        player.st.mark = same ? null : best.ref;
        return same ? 'unmark' : 'mark';
      }
      const g = groundPoint(cam, sx, sy, w, h);
      if (!g) return null;
      return player.walkTo(plaza, g[0], g[1]) ? 'walk' : null;
    },
  };
  return view;
}

const sameKind = (a, b) => a.k === b.k && (a.k === 'n' ? a.s === b.s : a.id === b.id);

function slotOf(r, id, buf, out) {
  const m = r.m[id];
  const o = (m.tr * r.crowd + m.sl) * STRIDE;
  out.x = buf[o];
  out.z = buf[o + 1];
  out.h = buf[o + 3];
  out.sp = buf[o + 6];
  return out;
}

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 255;
  return h;
}

/** Screen position of a world point, or null when it's behind the camera. */
export function projected(cam, x, y, z, w, h) {
  const v = projected.v || (projected.v = new cam.position.constructor());
  v.set(x, y, z).project(cam);
  if (v.z > 1 || v.z < -1) return null;
  return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
}

function groundPoint(cam, sx, sy, w, h) {
  const V = cam.position.constructor;
  const a = new V((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5).unproject(cam);
  const dir = a.sub(cam.position).normalize();
  if (dir.y > -0.02) return null;
  const k = -cam.position.y / dir.y;
  return [cam.position.x + dir.x * k, cam.position.z + dir.z * k];
}

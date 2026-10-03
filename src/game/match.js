// A match on screen: the round view, the HUD, the cards for each moment (assignment, Powder Room, results, podium),
// banners and the Master's cues, music, the heartbeat, the fireworks' booms, rings on the stones, name tags, the map,
// the verbs, and crediting each round once.
import { standings, awards as awardsOf, isOut } from '../sim/rules.js';
import { TROUPES, ABILITIES, UNMASK, GREET, ABILITY_IDS } from '../sim/const.js';
import { floorY, PLAZAS } from '../sim/plazas.js';
import { EM } from '../sim/choreo.js';
import { blocked } from './player.js';
import { projected } from './round.js';
import { BARKS } from './events.js';
import { sfx, near } from '../audio/sfx.js';
import { unlockedAbilities, POSES, BANNERS } from './progress.js';
import { safe } from '../platform.js';

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const POSE_EM = { bow: EM.bow, flourish: EM.flourish, spin: EM.spin, juggle: EM.juggle, clap: EM.clap };
const fmt = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createMatchUI(d) {
  const { stage, hud, screens, map, session, player, view, events, progress, music } = d;
  let lastStage = '';
  let lastRid = '';
  let card = null;
  let cardKind = '';
  let beatOn = 0;
  let nextBeat = 0;
  let shells = [];
  let shellI = 0;
  let minuteBarked = '';
  let credited = '';
  let lastClue = '';
  const rings = [];

  function chooseLoadout(ab) {
    progress.setLoadout(ab);
    safe(() => session.room.setPrivate('lo', { ab }), null, 'setPrivate lo');
    session.request({ t: 'lo', ab });
  }

  const ui = {
    get beat() {
      return beatOn;
    },
    heartbeat(on) {
      beatOn = on;
      if (on && progress.hint('heart', 3)) hud.hint('Your pursuer is near');
    },
    /** Unmask (E / the button). */
    unmask(info, nowMs) {
      if (!info?.me) return;
      const why = blocked('unmask', { stage: info.st, rs: info.rs, t: info.t });
      const tgt = player.pick(view.targets, UNMASK.range, stage.camera.st.yaw);
      if (why) {
        hud.why(why);
        sfx.refuse();
        return;
      }
      player.emote(EM.flick, nowMs / 1000);
      sfx.flick(1);
      if (!tgt) {
        hud.why('Nobody in reach');
        return;
      }
      player.face(tgt);
      session.request({ t: 'um', ref: tgt.ref, x: player.mv.x, z: player.mv.z, h: player.mv.h });
    },
    /** Greet (G), or answer a greeting or lantern. */
    greet(info, nowMs) {
      if (!info?.me) return;
      if (events.answer(info.t, safe(() => session.room.matchNow(), 0))) {
        player.emote(EM.wave, nowMs / 1000);
        return;
      }
      const why = blocked('greet', { stage: info.st, rs: info.rs, t: info.t });
      if (why) {
        hud.why(why);
        sfx.refuse();
        return;
      }
      const tgt = player.pick(view.targets, GREET.range, stage.camera.st.yaw);
      if (!tgt) {
        hud.why('Nobody near');
        return;
      }
      player.face(tgt);
      player.emote(EM.wave, nowMs / 1000);
      sfx.wave(1);
      session.request({ t: 'gr', ref: tgt.ref, x: player.mv.x, z: player.mv.z, h: player.mv.h });
    },
    /** Ability 0 or 1. */
    ability(info, i) {
      if (!info?.me) return;
      const id = info.me.ab[i];
      if (!id) return;
      const key = i === 0 ? 'c1' : 'c2';
      const why = blocked('ability', { stage: info.st, rs: info.rs, t: info.t, ab: { cd: info.rs?.[key] ?? 0 } });
      if (why) {
        hud.why(why);
        sfx.refuse();
        return;
      }
      if (id === 'opera') {
        player.st.opera = !player.st.opera;
        sfx.glass(player.st.opera);
        if (player.st.opera && progress.hint('opera', 2)) hud.hint('Shimmer shows from afar');
      }
      let tx;
      let tz;
      if (id === 'lantern') {
        // Lob it ahead, where the camera looks.
        const y = stage.camera.st.yaw;
        tx = player.mv.x - Math.sin(y) * 6;
        tz = player.mv.z - Math.cos(y) * 6;
      }
      session.request({ t: 'ab', a: id, x: player.mv.x, z: player.mv.z, h: player.mv.h, tx, tz });
    },
    flourish(nowMs) {
      const pose = POSES.find((p) => p.id === progress.profile.pose) ?? POSES[0];
      player.emote(POSE_EM[pose.id] ?? EM.flourish, nowMs / 1000);
      player.st.flourish = [POSE_EM[pose.id] ?? EM.flourish, safe(() => session.room.matchNow(), 0)];
    },
    /** One frame of the match. ctx: { now (s), dt, input, touch, reduced, spectate }. Returns the round info. */
    update(ctx) {
      const r = session.round;
      if (!r) {
        hud.show(false);
        return null;
      }
      if (r.rid !== lastRid) {
        lastRid = r.rid;
        lastStage = '';
        shells = [];
        shellI = 0;
        card?.close?.();
        screens.close();
        cardKind = '';
        player.st.opera = false;
      }
      const info = view.update({ stage, session, player, input: ctx.input, now: ctx.now, dt: ctx.dt, attention: events.attention, reduced: ctx.reduced, spectate: ctx.spectate, blocked: map.open, manualOrbit: ctx.manualOrbit });
      if (!info) return null;
      view.frame.turnDelay = events.delay;
      const { t, st, me, rs } = info;
      const pos = me ? { x: player.mv.x, z: player.mv.z } : null;
      events.update(r, t, session.events, pos);
      const g = session.game;
      // ---- stage changes: banners, the bell, music ----
      if (st !== lastStage) {
        onStage(st, r, info, ctx);
        lastStage = st;
      }
      const u = Math.max(0, Math.min(1, (t - r.timing.huntStart) / Math.max(1, r.timing.hushStart - r.timing.huntStart)));
      music.set(st === 'hunt' ? 'hunt' : st === 'blend' || st === 'assign' ? 'blend' : st === 'hush' ? 'hush' : 'results', u, r.seed);
      if (st === 'hunt' && r.mode === 'masq' && r.timing.hushStart - t < 60 && minuteBarked !== r.rid) {
        minuteBarked = r.rid;
        hud.bark(pick(BARKS.minute));
      }
      // ---- the cards ----
      const out = me && rs && rs.out > t;
      const finalOn = g && g.fin > 0 && g.mid === safe(() => session.room.match.id, '');
      let want = '';
      if (finalOn) want = 'final';
      else if (st === 'results' || st === 'over') want = 'results';
      else if (out) want = 'powder';
      else if (st === 'assign' && me) want = 'assign';
      if (want !== cardKind) {
        cardKind = want;
        card = null;
        if (!want) screens.close();
        else if (want === 'assign') card = openAssign(r, me);
        else if (want === 'powder') card = screens.powder({ seconds: rs.out - t });
        else if (want === 'results') card = openResults(r);
        else if (want === 'final') card = openFinal(g);
      }
      if (card?.tick) {
        if (want === 'powder') card.tick(rs.out - t);
        else if (want === 'results') card.tick(r.timing.over - t + (r.endAt >= 0 ? r.endAt - r.timing.end : 0));
        else if (want === 'final') card.tick((g.fin - safe(() => session.room.matchNow(), 0)) / 1000);
      }
      if (card?.progress && want === 'assign') card.progress((r.timing.assign - t) / r.timing.assign);
      // ---- credit the round once ----
      if ((st === 'results' || st === 'over') && me && credited !== r.rid) {
        credited = r.rid;
        const sc = session.scores[session.me];
        if (sc) {
          const humans = Object.values(r.m).filter((m) => !m.b).length;
          const tot = g?.tot?.[session.me];
          const res = progress.creditRound({ rid: r.rid, mode: r.mode, skill: r.skill, sc, solved: !!r.case?.solved, humans, matchTot: tot ? { unm: tot.unm + sc.unm, faux: tot.faux + sc.faux } : { unm: sc.unm, faux: sc.faux } });
          if (res?.levelUp) setTimeout(() => hud.banner(`Level ${res.level}`, res.unlocked.join(' · '), 3200), 1200);
        }
      }
      // ---- HUD ----
      const playing = !!me && !rs?.aud && !ctx.spectate;
      hud.show(playing && !out && want !== 'results' && want !== 'final' && st !== 'reveal');
      hud.layout(ctx.touch, window.innerWidth);
      if (playing && !out) {
        const flust = rs && rs.fl > t;
        hud.poise(rs ? rs.p : 0, !!flust, ctx.now);
        hud.chips(
          me.ab.map((id, i) => {
            const cd = rs ? rs[i === 0 ? 'c1' : 'c2'] : 0;
            const len = ABILITIES[id]?.cooldown || 1;
            return { id, left: Math.max(0, Math.min(1, (cd - t) / len)), on: id === 'opera' && player.st.opera };
          }),
        );
        hud.quarry(quarryInfo(r, t, info));
        hud.prompt(events.prompt ? events.prompt.kind : null, events.prompt ? t - events.prompt.shown : 0);
        if (player.st.opera && rs && rs.p <= 0) player.st.opera = false;
      }
      // ---- the heartbeat: your pursuer close; in the Hush, everyone's ----
      if ((beatOn || st === 'hush') && playing && !out && ctx.now >= nextBeat) {
        nextBeat = ctx.now + (beatOn ? 0.85 : 1.25);
        sfx.heartbeat(beatOn ? 0.55 : 0.3);
        if (beatOn && !ctx.reduced) hud.beat();
      }
      // ---- fireworks' booms, from the same seed as the show ----
      if (st === 'hush' || st === 'reveal') {
        if (!shells.length) shells = stage.fx.shells?.() ?? [];
        while (shellI < shells.length && shells[shellI].t + 1.3 <= t) {
          const s = shells[shellI++];
          if (t - (s.t + 1.3) < 0.5) sfx.boom(pos ? near(Math.hypot(s.x - pos.x, s.z - pos.z) * 0.5) : 0.6);
        }
      }
      // ---- rings on the stones ----
      rings.length = 0;
      const plaza = PLAZAS[r.plaza];
      if (playing && !out && (st === 'hunt' || st === 'hush' || st === 'blend')) {
        const tgt = player.pick(view.targets, UNMASK.range, stage.camera.st.yaw);
        rings.push({ x: player.mv.x, y: floorY(plaza, player.mv.x, player.mv.z), z: player.mv.z, r: 0.55, hex: 0xf1e3c8, a: 0.35 });
        if (tgt && st !== 'blend') rings.push({ x: tgt.x, y: floorY(plaza, tgt.x, tgt.z), z: tgt.z, r: 0.62, hex: 0xf2b544, a: 0.9 });
        const mk = player.st.mark ? view.targets.find((x) => x.ref.k === player.st.mark.k && (x.ref.k === 'n' ? x.ref.s === player.st.mark.s : x.ref.id === player.st.mark.id)) : null;
        if (mk) rings.push({ x: mk.x, y: floorY(plaza, mk.x, mk.z), z: mk.z, r: 0.75, hex: 0xb3263a, a: 0.95 });
        else if (player.st.mark) player.st.mark = null;
      }
      for (const m of view.frame?.maskers ?? []) if (m.slip > 0) rings.push({ x: m.x, y: floorY(plaza, m.x, m.z), z: m.z, r: 0.9 + 0.2 * Math.sin(ctx.now * 8), hex: 0xff4a2a, a: m.slip });
      stage.fx.rings(rings);
      // ---- name tags: at the reveal for everyone, always for those watching ----
      const tags = [];
      if (st === 'reveal' || st === 'results' || !playing) {
        const cam = stage.camera.cam;
        for (const l of view.labels) {
          const v = projected(cam, l.x, floorY(plaza, l.x, l.z) + 2.25, l.z, stage.R.size.w, stage.R.size.h);
          if (v) tags.push({ key: l.id, x: v[0], y: v[1], text: l.bot ? `${l.name} (bot)` : l.name, me: l.me });
        }
      }
      hud.tags(tags);
      // Your place off screen: point to it from the edge.
      const gh = view.frame?.ghost;
      if (playing && !out && gh && gh.alpha > 0.2 && st !== 'reveal') {
        const w = stage.R.size.w;
        const h = stage.R.size.h;
        const v = projected(stage.camera.cam, gh.x, floorY(plaza, gh.x, gh.z) + 1, gh.z, w, h);
        const inset = 70;
        if (!v || v[0] < inset || v[0] > w - inset || v[1] < inset + 40 || v[1] > h - inset - 60) {
          // Direction on screen from the middle (behind the camera: flip it).
          const cam = stage.camera.cam;
          const dx = gh.x - cam.position.x;
          const dz = gh.z - cam.position.z;
          const yaw = stage.camera.st.yaw;
          const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
          const fwd = -(dx * Math.sin(yaw) + dz * Math.cos(yaw));
          const ang = Math.atan2(right, fwd);
          const cx = w / 2;
          const cy = h / 2;
          const k = Math.min((w / 2 - inset) / Math.max(1e-3, Math.abs(Math.sin(ang))), (h / 2 - inset - 50) / Math.max(1e-3, Math.abs(Math.cos(ang))));
          hud.homing(cx + Math.sin(ang) * k, cy - Math.cos(ang) * k, ang);
        } else hud.homing(null);
      } else hud.homing(null);
      hud.foot(!playing && !finalOn && want !== 'results' ? (rs?.aud ? 'Audience · you play next round' : 'Watching · you play next round') : '');
      // ---- the map ----
      if (map.open) {
        const clue = r.mode === 'masq' ? session.intel?.d ?? -1 : latestCase(r)?.d ?? -1;
        map.draw(plaza, info.crowd, info.buf, playing ? { x: player.mv.x, z: player.mv.z, h: player.mv.h } : null, playing && !player.mv.locked ? info.slot : null, clue, ctx.now);
      }
      // A new clue: a soft arpeggio and the Master says where.
      const clueKey = r.mode === 'masq' ? `${session.intel?.q}:${session.intel?.at}` : `${latestCase(r)?.at}`;
      if (playing && clueKey !== lastClue && st === 'hunt') {
        const first = !lastClue;
        lastClue = clueKey;
        const where = r.mode === 'masq' ? session.intel : latestCase(r);
        if (!first && where && where.d >= 0) {
          sfx.clue();
          hud.bark(r.mode === 'masq' ? `${session.intel?.nm ?? 'Your quarry'} lingers by ${plaza.districts[where.d].name}.` : `An impostor, by ${plaza.districts[where.d].name}.`, 3200);
        }
      }
      return info;
    },
  };

  function latestCase(r) {
    if (!r.case) return null;
    let best = null;
    for (const id of r.case.imps) {
      if (r.case.found.includes(id)) continue;
      const c = r.case.clues[id];
      if (c && (!best || c.at > best.at)) best = c;
    }
    return best;
  }

  function quarryInfo(r, t, info) {
    const plaza = PLAZAS[r.plaza];
    const timing = r.timing;
    const clock = info.st === 'hush' ? 'Midnight' : info.st === 'assign' || info.st === 'blend' ? fmt(timing.huntStart - t) : fmt(timing.hushStart - t);
    if (r.mode === 'spot' && r.case) {
      const c = latestCase(r);
      return { caseFile: r.case.imps.map((id) => ({ tr: r.case.clues[id]?.tr ?? r.m[id]?.tr ?? 0, found: r.case.found.includes(id) })), where: c && c.d >= 0 ? `by ${plaza.districts[c.d].name}` : `${r.case.imps.length - r.case.found.length} at large`, clock };
    }
    const q = session.intel;
    if (!q || !q.q) return { tr: r.m[session.me]?.tr ?? 0, name: 'No quarry', where: 'Wait for one', clock };
    const ago = q.d >= 0 ? Math.max(0, Math.round(t - q.at)) : -1;
    return { tr: q.tr, name: q.nm, where: `a ${TROUPES[q.tr].name}`, where2: ago >= 0 ? `by ${plaza.districts[q.d].name} · ${ago}s` : info.st === 'hunt' ? 'Clue soon' : 'Clue at the hunt', clock };
  }

  function onStage(st, r, info, ctx) {
    const playing = !!info.me && !ctx.spectate;
    if (st === 'blend' && playing) {
      hud.banner('Blend', 'find your place');
      hud.bark(pick(BARKS.blend));
      if (progress.hint('ghost', 3)) setTimeout(() => hud.hint('Stand on your shadow'), 2200);
    } else if (st === 'hunt') {
      hud.banner(r.mode === 'spot' ? 'The Case' : 'The Hunt', r.mode === 'spot' ? 'find the impostors' : 'unmask your quarry');
      hud.bark(pick(r.mode === 'spot' ? BARKS.spot : BARKS.hunt));
      if (playing && progress.hint('unmask', 3)) setTimeout(() => hud.hint(ctx.touch ? 'Close in, then Unmask' : 'Close in, then E'), 2600);
    } else if (st === 'hush') {
      hud.banner('Midnight', 'hold still');
      hud.bark(pick(BARKS.hush), 3400);
      sfx.bell(12);
      sfx.whistle();
    } else if (st === 'reveal') {
      hud.banner('Masks off!', '', 1800);
    }
  }

  function openAssign(r, me) {
    const level = progress.level;
    const own = unlockedAbilities(level);
    const q = session.intel;
    return screens.assign({
      tr: me.tr,
      quarry: r.mode === 'masq' && q && q.q ? { name: q.nm, tr: q.tr } : null,
      caseFile: r.mode === 'spot' && r.case ? r.case.imps.map((id) => r.case.clues[id]?.tr ?? 0) : null,
      picks: ABILITY_IDS.map((id) => ({ id, unlocked: own.includes(id) || r.chaos })),
      chosen: me.ab,
      chaos: r.chaos,
      onPick: (ab) => {
        sfx.ui();
        chooseLoadout(ab);
      },
    });
  }

  /** A player's banner colours (bots hang none). */
  function bannerOf(id, bot) {
    if (bot) return null;
    const i = id === session.me ? BANNERS.findIndex((b) => b.id === progress.profile.banner) : session.bannerOf(id);
    return (BANNERS[i] ?? BANNERS[0]).colors;
  }

  function openResults(r) {
    const sc = session.scores;
    const rows = standings(sc, Object.keys(r.m)).map((row) => ({ ...row, name: r.m[row.id].nm, bot: !!r.m[row.id].b, tr: r.m[row.id].tr, unm: sc[row.id]?.unm ?? 0, me: row.id === session.me, banner: bannerOf(row.id, !!r.m[row.id].b) }));
    const g = session.game;
    const last = g && g.n >= g.rounds;
    const solved = r.case?.solved;
    return screens.results({ title: r.mode === 'spot' ? (solved ? 'Case closed' : 'They slipped away') : rows[0] ? `${rows[0].name} leads` : 'Midnight', sub: `Round ${r.n}`, rows, nextLabel: last ? 'The podium' : 'Next round' });
  }

  function openFinal(g) {
    const rows = standings(g.tot, Object.keys(g.tot)).map((row) => ({ ...row, name: g.tot[row.id].nm, bot: !!g.tot[row.id].b, tr: 0, me: row.id === session.me, banner: bannerOf(row.id, !!g.tot[row.id].b) }));
    const r = session.round;
    for (const row of rows) row.tr = r?.m[row.id]?.tr ?? 0;
    const aw = awardsOf(g.tot);
    const names = (id) => (id ? g.tot[id]?.nm + (g.tot[id]?.b ? ' (bot)' : '') : null);
    const list = [
      ['Hawkeye', names(aw.hawkeye)],
      ['Master of Disguise', names(aw.disguise)],
      ['Ghost', names(aw.ghost)],
      ['Slapstick', names(aw.slapstick)],
    ]
      .filter(([, n]) => n)
      .map(([title, name]) => ({ title, name }));
    sfx.fanfare();
    const privateHost = safe(() => session.room.kind === 'private' && session.room.isHost, false);
    return screens.final({ top: rows.slice(0, 3), awards: list, rows, onContinue: privateHost ? () => session.host.finish() : null });
  }

  ui.isOut = (r, id, t) => isOut({ r, rs: session.status }, id, t);
  return ui;
}

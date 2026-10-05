// Plays rounds and whole matches in node with the same pure code the game runs. Some cars can be played like a person's
// page plays them ("humans": their own physics, their own meetings with every other car, their own fall report), the rest are
// the bots the host drives.

import { botInput, newAI } from '../game/bots.js';
import { Round } from '../game/round.js';
import { MIN_R, R0, ROUND_MS, buildRoster, matchRanking, radiusAt } from '../game/rules.js';
import { HIT, KO_WINDOW, STEP, collideOne, outside, stepCar } from '../game/sim.js';

export function checkFinite(round, where) {
  for (const c of round.cars) {
    for (const k of ['x', 'y', 'vx', 'vy', 'a', 'cd', 'heavy']) {
      if (!Number.isFinite(c[k])) throw new Error(`${where}: ${c.id}.${k} is ${c[k]}`);
    }
  }
}

/** Play one round to its end. Returns the round, the result and the number of steps. */
export function playRound(roster, seed, roundNo, { humans = [], onStep } = {}) {
  const round = new Round(roster, seed, roundNo);
  const people = humans.map((id) => round.byId.get(id));
  for (const c of people) c.ai = newAI(round.rng, c.idx);
  let steps = 0;
  let reason = '';
  const maxSteps = Math.ceil((ROUND_MS + 2000) / 1000 / STEP);
  for (; steps < maxSteps; steps++) {
    const t = steps * STEP * 1000;
    const R = radiusAt(t);
    for (const c of people) {
      if (c.out) continue;
      stepCar(c, botInput(c, round, STEP, R), STEP, R, false);
      for (const o of round.cars) {
        if (o === c || o.out) continue;
        if (collideOne(c, o) && HIT.aggB > HIT.aggA) {
          c.lastBy = o.id;
          c.lastT = t;
        }
      }
      if (outside(c, R)) round.eliminate(c.id, { by: t - c.lastT <= KO_WINDOW ? c.lastBy : '', x: c.x, y: c.y, vx: c.vx, vy: c.vy }, t);
    }
    round.step(STEP, t);
    checkFinite(round, `round ${roundNo} step ${steps}`);
    if (onStep) onStep(round, t, R);
    reason = round.isOver(t);
    if (reason) break;
  }
  const t = steps * STEP * 1000;
  return { round, steps, t, reason, result: round.finish(t) };
}

/** A whole match: `rounds` rounds, scoring as the host does. */
export function playMatch(seed, rounds, nHumans = 0) {
  const humanIds = Array.from({ length: nHumans }, (_, i) => `human-${seed}-${i}`);
  const roster = buildRoster(humanIds, seed);
  const scores = Object.fromEntries(roster.map((r) => [r.id, 0]));
  const kos = Object.fromEntries(roster.map((r) => [r.id, 0]));
  const results = [];
  for (let n = 1; n <= rounds; n++) {
    const played = playRound(roster, seed, n, { humans: humanIds });
    results.push(played);
    for (const [id, pts] of Object.entries(played.result.points)) scores[id] += pts;
    for (const [id, k] of Object.entries(played.result.kos)) kos[id] += k;
  }
  return { roster, humanIds, scores, kos, results, ranking: matchRanking(roster, scores, kos) };
}

export { MIN_R, R0 };

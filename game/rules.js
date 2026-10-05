// The rules of a match: the shrinking rink, who starts where, the roster, points, ranking and awards.
// Pure: nothing here touches the page or the SDK, and everything is a function of its arguments (and a seed).

import { hashStr, mulberry32, shuffle } from './rng.js';

export const R0 = 11; // the rink's radius at the start of a round
export const MIN_R = 4.5;
export const SHRINK_START = 25000; // ms into the round: the first edge crumbles
export const SHRINK_EVERY = 8000;
export const SHRINK_BY = 1.4;
export const WARN_MS = 2000; // the edge flashes this long before it falls
export const MAX_STAGE = Math.ceil((R0 - MIN_R) / SHRINK_BY);
export const ROUND_MS = 120000;
export const INTRO_MS = 1500;
export const END_MS = 2400;
export const BOARD_MS = 4000;
export const FINAL_MS = 9000;
export const SPAWN_R = 7;

export const TABLE = 8; // bots fill a match up to this many cars
export const MAX_CARS = 10;
export const ROUND_OPTIONS = [1, 3, 5];
export const DEFAULT_ROUNDS = 3;

export const PLACE_POINTS = [10, 7, 5, 4, 3, 2];
export const KO_POINTS = 2;

// Ten bright, well separated colours (none of them water blue).
export const COLORS = ['#ff3b3b', '#ff9a1f', '#ffd21f', '#8ee02a', '#16b85a', '#12c9b8', '#3d6bff', '#9a52ff', '#ee4dff', '#ff5aa8'];

export const BOT_NAMES = ['Pip', 'Ziggy', 'Bubbles', 'Noodle', 'Pickles', 'Mochi', 'Sprout', 'Bean', 'Waffles', 'Taco', 'Biscuit', 'Peanut', 'Jelly', 'Nugget'];

export const isBotId = (id) => typeof id === 'string' && /^bot\d{1,3}$/.test(id);

// ---------------------------------------------------------------- the shrinking rink

/** How many times the edge has crumbled by `t` ms into the round. */
export function stageAt(t) {
  if (!(t >= SHRINK_START)) return 0;
  return Math.min(MAX_STAGE, 1 + Math.floor((t - SHRINK_START) / SHRINK_EVERY));
}

export function radiusAt(t) {
  return Math.max(MIN_R, R0 - stageAt(t) * SHRINK_BY);
}

/** `warn` is true during the 2 s before the next crumble; `left` is ms until it; `to` the radius it leaves. */
export function warningAt(t) {
  const k = stageAt(t) + 1;
  if (k > MAX_STAGE) return { warn: false, left: Infinity, to: MIN_R };
  const at = SHRINK_START + (k - 1) * SHRINK_EVERY;
  const left = at - t;
  return { warn: left <= WARN_MS && left > 0, left, to: radiusAt(at) };
}

// ---------------------------------------------------------------- seats and the roster

/** Which start slot each roster entry takes this round (a different order every round after the first). */
export function seatOrder(n, seed, round) {
  const slots = Array.from({ length: n }, (_, i) => i);
  if (round > 1) shuffle(slots, mulberry32((hashStr(String(seed)) + round * 7919) >>> 0));
  return slots;
}

/** Cars start evenly spread on a circle, facing the centre. */
export function startSpot(slot, n) {
  const ang = -Math.PI / 2 + (Math.PI * 2 * slot) / Math.max(1, n);
  return { x: Math.cos(ang) * SPAWN_R, y: Math.sin(ang) * SPAWN_R, a: ang + Math.PI };
}

/** A colour index for each id, the same on every page: people keep the colour their id likes unless it is taken. */
export function assignColors(ids) {
  const n = COLORS.length;
  const used = new Array(n).fill(false);
  const out = {};
  const humans = ids.filter((id) => !isBotId(id)).sort();
  const bots = ids.filter(isBotId).sort();
  for (const id of humans) {
    let c = hashStr(id) % n;
    for (let k = 0; k < n && used[c]; k++) c = (c + 1) % n;
    used[c] = true;
    out[id] = c;
  }
  for (const id of bots) {
    let c = 0;
    while (c < n && used[c]) c++;
    if (c >= n) c = hashStr(id) % n;
    used[c] = true;
    out[id] = c;
  }
  return out;
}

/** Names for bots, picked from the seed without repeats (a table has at most 7). */
export function botNames(count, seed) {
  const names = shuffle(BOT_NAMES.slice(), mulberry32((seed ^ 0x51ed270b) >>> 0));
  return Array.from({ length: count }, (_, i) => names[i % names.length]);
}

/**
 * The cars of a match: the humans (ids), bots up to the table size (none when there are already that many people),
 * shuffled by the match seed. Each: { id, bot: 0|1, n: name (bots), c: colour index }.
 */
export function buildRoster(humanIds, seed, table = TABLE) {
  const humans = humanIds.slice(0, MAX_CARS);
  const nBots = Math.max(0, Math.min(MAX_CARS - humans.length, table - humans.length));
  const names = botNames(nBots, seed);
  const entries = humans.map((id) => ({ id, bot: 0 }));
  for (let i = 0; i < nBots; i++) entries.push({ id: `bot${i + 1}`, bot: 1, n: names[i] });
  const colors = assignColors(entries.map((e) => e.id));
  for (const e of entries) e.c = colors[e.id];
  return shuffle(entries, mulberry32((seed ^ 0x9e3779b9) >>> 0));
}

// ---------------------------------------------------------------- points, ranking, awards

export const placePoints = (place) => PLACE_POINTS[place] ?? 1;

/** Points for a round: the place (1st 10, 2nd 7, ...) plus 2 for each knockout. `kos` maps id to knockouts. */
export function scoreRound(ranking, kos) {
  const out = {};
  ranking.forEach((id, place) => {
    out[id] = placePoints(place) + KO_POINTS * (kos[id] || 0);
  });
  return out;
}

/** Knockouts this round, from the elimination records: { id: [n, by, ...] }. */
export function koCounts(out) {
  const kos = {};
  for (const rec of Object.values(out || {})) {
    const by = Array.isArray(rec) ? rec[1] : rec?.by;
    if (typeof by === 'string' && by) kos[by] = (kos[by] || 0) + 1;
  }
  return kos;
}

/** The match standings, best first: points, then knockouts, then the roster's order. */
export function matchRanking(roster, scores, kos) {
  const idx = new Map(roster.map((r, i) => [r.id, i]));
  return roster
    .map((r) => r.id)
    .sort((a, b) => (scores[b] || 0) - (scores[a] || 0) || (kos[b] || 0) - (kos[a] || 0) || idx.get(a) - idx.get(b));
}

const most = (roster, values) => {
  let best = '';
  let bv = 0;
  for (const r of roster) {
    const v = values[r.id] || 0;
    if (v > bv) {
      bv = v;
      best = r.id;
    }
  }
  return best;
};

/** The two fun awards: most knockouts (Wrecking Ball) and most hits taken and survived (Slippery). Empty when nobody earned one. */
export function awards(roster, kos, surv) {
  return { wrecking: most(roster, kos), slippery: most(roster, surv) };
}

// The balance harness: plays whole rounds with bots only (no browser) and prints the numbers the design is tuned to.
//   npm run balance            (about a minute)
//   node scripts/balance.mjs 200   (more rounds per line)
import { createWorld, STEP } from '../src/sim/world.js';
import { createBot, STYLES } from '../src/sim/bots.js';
import { standings } from '../src/sim/rules.js';

const N = Math.max(4, Number(process.argv[2]) || 30);
const pct = (x) => `${Math.round(x * 100)}%`;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : 0;
};

/** One Masquerade round with bots only. skills: one entry per masker ('novice'|'adept'|'master'), styles optional. */
function masqRound(seed, skills, opts = {}) {
  const { crowd = 9, minutes = 5, styles = {} } = opts;
  const humans = skills.map((sk, i) => ({ id: `h${i}`, name: `H${i}` }));
  const W = createWorld({ mid: `m${seed}`, n: 1, mode: 'masq', plaza: seed % 3, seed: seed * 2654435761, crowd, minutes, skill: 'adept', loadouts: 'standard', bots: false, humans });
  const S = W.S;
  // Every "human" here is driven by a bot brain of its own skill.
  for (let i = 0; i < skills.length; i++) {
    const id = `h${i}`;
    S.r.m[id].sk = skills[i];
    const p = S.pos[id];
    const B = createBot(S, id, p.x, p.z, p.h);
    B.style = styles[i] ?? STYLES.normal;
    W.bots.push(B);
  }
  let first = null;
  // Pursuits: each hunter-quarry pairing from when it forms until it ends (an unmask, or anything else).
  const pursuits = [];
  const open = new Map();
  let seen = 0;
  while (!W.done()) {
    W.step(STEP);
    if (first === null && S.ev.some((e) => e.k === 'unmask')) first = W.t;
    if (!opts.trace) continue;
    for (const e of S.ev) {
      if (e.q <= seen) continue;
      if (e.k === 'unmask' && open.get(e.a)?.q === e.b) open.get(e.a).won = true;
    }
    seen = S.seq;
    if (W.t < S.timing.huntStart) continue;
    const live = new Map();
    for (let k = 0; k < S.chain.length && S.chain.length > 1; k++) live.set(S.chain[k], S.chain[(k + 1) % S.chain.length]);
    for (const [h, p] of open) {
      if (live.get(h) !== p.q) {
        pursuits.push(p);
        open.delete(h);
      }
    }
    for (const [h, q] of live) if (!open.has(h)) open.set(h, { h, q, won: false });
  }
  for (const p of open.values()) pursuits.push(p);
  const unm = Object.values(S.sc).reduce((s, x) => s + x.unm, 0);
  const faux = Object.values(S.sc).reduce((s, x) => s + x.faux, 0);
  const wrong = Object.values(S.sc).reduce((s, x) => s + x.wrong, 0);
  return { S, unm, faux, wrong, pursuits, first: first === null ? null : first - S.timing.huntStart, end: S.endAt < Infinity ? S.endAt : S.timing.end };
}

function spotRound(seed, skill, crowd, hunterSkill = 'adept') {
  const W = createWorld({ mid: `s${seed}`, n: 1, mode: 'spot', plaza: seed % 3, seed: seed * 40503 + 1, crowd, minutes: 5, skill, loadouts: 'standard', humans: [{ id: 'hunter', name: 'Hunter' }] });
  const S = W.S;
  S.r.m.hunter.sk = hunterSkill;
  const p = S.pos.hunter;
  W.bots.push(createBot(S, 'hunter', p.x, p.z, p.h));
  while (!W.done()) W.step(STEP);
  const solved = !!S.case.solved;
  return { solved, time: (solved ? S.endAt : S.timing.end) - S.timing.huntStart, found: S.case.found.length, of: S.case.imps.length, faux: S.sc.hunter.faux, pts: S.sc.hunter.pts };
}

const t0 = Date.now();
const lines = [];
const row = (name, value, target, ok) => lines.push(`${ok === null ? 'info' : ok ? 'ok  ' : 'MISS'}  ${name.padEnd(46)} ${String(value).padEnd(18)} ${ok === null ? '' : `target ${target}`}`);

// 1. Six adept maskers, five-minute rounds.
{
  const rs = [];
  for (let i = 0; i < N; i++) rs.push(masqRound(1000 + i, Array(6).fill('adept')));
  const unm = rs.map((r) => r.unm);
  const firsts = rs.map((r) => r.first).filter((x) => x !== null);
  const faux = mean(rs.map((r) => r.faux));
  const att = mean(rs.map((r) => r.unm + r.faux + r.wrong));
  row('unmasks per round (6 adept)', `${mean(unm).toFixed(1)} (${Math.min(...unm)}-${Math.max(...unm)})`, '6-14', mean(unm) >= 6 && mean(unm) <= 14);
  row('time to first unmask after the hunt opens', `${mean(firsts).toFixed(0)} s`, '40-90 s', mean(firsts) >= 40 && mean(firsts) <= 90);
  row('faux pas share of attempts (adept)', pct(faux / att), '15-30%', faux / att >= 0.15 && faux / att <= 0.3);
  row('rounds with no unmask at all', pct(rs.filter((r) => r.unm === 0).length / N), '< 5%', rs.filter((r) => r.unm === 0).length / N < 0.05);
}
// 2. Master vs master: nobody runs away with it.
{
  const ratios = [];
  let fx = 0;
  let at = 0;
  for (let i = 0; i < N; i++) {
    // A three-round match: totals per masker.
    const tot = {};
    for (let k = 0; k < 3; k++) {
      const r = masqRound(2000 + i * 3 + k, Array(6).fill('master'));
      for (const [id, sc] of Object.entries(r.S.sc)) tot[id] = (tot[id] || 0) + sc.unm;
      fx += r.faux;
      at += r.unm + r.faux + r.wrong;
    }
    const v = Object.values(tot);
    ratios.push(Math.max(...v) / Math.max(1, median(v)));
  }
  row('master matches: top unmasks / median', `${mean(ratios).toFixed(2)} (worst ${Math.max(...ratios).toFixed(1)})`, '<= 3', Math.max(...ratios) <= 3.5 && mean(ratios) <= 3);
  row('faux pas share of attempts (master)', pct(fx / at), '15-30%', fx / at >= 0.15 && fx / at <= 0.3);
}
// 3. A patient bot that never hunts, and a brute that fans everyone.
{
  const patient = [];
  const hunters = [];
  const brute = [];
  for (let i = 0; i < N; i++) {
    const r = masqRound(3000 + i, Array(6).fill('adept'), { styles: { 0: STYLES.patient } });
    patient.push(r.S.sc.h0.pts);
    hunters.push(median(Object.entries(r.S.sc).filter(([id]) => id !== 'h0').map(([, s]) => s.pts)));
    const b = masqRound(3500 + i, Array(6).fill('adept'), { styles: { 0: STYLES.brute } });
    brute.push(b.S.sc.h0.pts);
  }
  const ratio = mean(patient) / Math.max(1, mean(hunters));
  row('patient bot vs median hunter', `${pct(ratio)} (${mean(patient).toFixed(0)} vs ${mean(hunters).toFixed(0)})`, '< 35%', ratio < 0.35);
  row('brute-force bot score', mean(brute).toFixed(0), '< 0', mean(brute) < 0);
}
// 3b. Faux pas share and unmasks by skill, in rounds of one skill.
for (const sk of ['novice', 'master']) {
  const rs = [];
  for (let i = 0; i < N; i++) rs.push(masqRound(3800 + i, Array(6).fill(sk)));
  const f = mean(rs.map((r) => r.faux));
  const a = mean(rs.map((r) => r.unm + r.faux + r.wrong));
  row(`${sk} rounds: unmasks / faux pas share`, `${mean(rs.map((r) => r.unm)).toFixed(1)} / ${pct(f / a)}`, sk === 'novice' ? 'faux 30-50%' : 'faux 15-30%', sk === 'novice' ? f / a >= 0.3 && f / a <= 0.5 : f / a >= 0.15 && f / a <= 0.3);
}
// 4. Skill ladders: how often the stronger skill outscores the weaker in mixed rounds.
for (const [lo, hi, target] of [
  ['novice', 'adept', 0.75],
  ['adept', 'master', 0.65],
]) {
  let wins = 0;
  let pairs = 0;
  for (let i = 0; i < N; i++) {
    const r = masqRound(4000 + i + (lo === 'novice' ? 0 : 500), [lo, lo, lo, hi, hi, hi]);
    for (let a = 0; a < 3; a++) {
      for (let b = 3; b < 6; b++) {
        const pa = r.S.sc[`h${a}`].pts;
        const pb = r.S.sc[`h${b}`].pts;
        if (pa === pb) wins += 0.5;
        else if (pb > pa) wins++;
        pairs++;
      }
    }
  }
  row(`${hi} outscores ${lo} (same round)`, pct(wins / pairs), `about ${pct(target)}`, Math.abs(wins / pairs - target) <= 0.1);
}
// 4b. Pursuits: when a stronger bot hunts a weaker one, how often does the pairing end with the quarry unmasked?
for (const [lo, hi] of [
  ['novice', 'adept'],
  ['adept', 'master'],
]) {
  let caught = 0;
  let total = 0;
  for (let i = 0; i < N; i++) {
    const r = masqRound(4600 + i + (lo === 'novice' ? 0 : 500), [lo, lo, lo, hi, hi, hi], { trace: true });
    for (const p of r.pursuits) {
      if (r.S.r.m[p.h].sk !== hi || r.S.r.m[p.q].sk !== lo) continue;
      total++;
      if (p.won) caught++;
    }
  }
  // Informational: a pairing also ends when the hunter is caught first or the chain changes, so this sits well below
  // the head-to-head numbers above.
  row(`${lo} quarry caught by its ${hi} hunter`, `${pct(caught / Math.max(1, total))} of ${total}`, '', null);
}
// 5. Spot the Mask: a hunter against impostors; packed crowds take longer, not twice as long.
{
  for (const skill of ['novice', 'adept', 'master']) {
    const normal = [];
    const packed = [];
    for (let i = 0; i < N * 2; i++) {
      normal.push(spotRound(5000 + i, skill, 9));
      packed.push(spotRound(5000 + i, skill, 12));
    }
    const tn = mean(normal.map((r) => r.time));
    const solved = normal.filter((r) => r.solved).length / normal.length;
    // Finds per minute (a case that runs out of time is capped, so time alone hides the difference).
    const rate = (rs) => rs.reduce((s, r) => s + r.found, 0) / rs.reduce((s, r) => s + r.time / 60, 0);
    const slow = rate(normal) / rate(packed) - 1;
    row(`spot the mask (${skill}): solved / mean time`, `${pct(solved)} / ${tn.toFixed(0)} s`, skill === 'novice' ? '> 80% solved' : skill === 'adept' ? '40-80% solved' : '15-50% solved', skill === 'novice' ? solved > 0.8 : skill === 'adept' ? solved >= 0.4 && solved <= 0.8 : solved >= 0.15 && solved <= 0.5);
    row(`  packed crowd: time per impostor found (${skill})`, `+${pct(slow)}`, '+10-20%', slow >= 0.08 && slow <= 0.25);
  }
}
console.log(`Carnevale balance, ${N} rounds per line (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
console.log(lines.join('\n'));

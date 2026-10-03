// What a player keeps: level and XP, the tricks they've unlocked and the two they carry, cosmetics, stats, which hints
// they've seen and whether they've rehearsed. One versioned save, read defensively (missing, empty, corrupt, older or
// newer all load), written on meaningful events at most every few seconds and flushed when the page hides.
import { saves, badge, submitScore } from '../platform.js';
import { ABILITY_IDS, ABILITIES } from '../sim/const.js';

const KEY = 'profile';
export const MAX_LEVEL = 30;

export const BURSTS = [
  { id: 'confetti', name: 'Confetti', level: 1, palette: [0xf2b544, 0xb3263a, 0x1f7a80, 0xf1e3c8, 0xe58c8a] },
  { id: 'petals', name: 'Rose Petals', level: 5, palette: [0xb3263a, 0xe58c8a, 0xf6d6b8, 0x9e1b32] },
  { id: 'gold', name: 'Gold Leaf', level: 8, palette: [0xf2b544, 0xd8a032, 0xfff0c0] },
  { id: 'feathers', name: 'Feathers', level: 12, palette: [0xfbf6ea, 0xf1e3c8, 0xe2d0ad] },
  { id: 'ribbons', name: 'Teal Ribbons', level: 16, palette: [0x1f7a80, 0x0e4d5c, 0xf1e3c8] },
  { id: 'fireflies', name: 'Fireflies', level: 25, palette: [0xffd27a, 0xfff0c0, 0xffb36a] },
];
export const POSES = [
  { id: 'bow', name: 'Courtly Bow', level: 1 },
  { id: 'flourish', name: 'Flourish', level: 3 },
  { id: 'spin', name: 'Twirl', level: 6 },
  { id: 'juggle', name: 'Juggle', level: 10 },
  { id: 'clap', name: 'Applause', level: 15 },
];

/** The pennant that hangs by your name on the results and the podium (never on your costume: that would be a tell). */
export const BANNERS = [
  { id: 'crimson', name: 'Crimson Banner', level: 1, colors: ['#9e1b32', '#f2b544'] },
  { id: 'lagoon', name: 'Lagoon Banner', level: 4, colors: ['#0e4d5c', '#f1e3c8'] },
  { id: 'gilt', name: 'Gilt Banner', level: 9, colors: ['#d8a032', '#241a17'] },
  { id: 'harlequin', name: 'Harlequin Banner', level: 14, colors: ['#b3263a', '#1f7a80'] },
  { id: 'midnight', name: 'Midnight Banner', level: 20, colors: ['#12263a', '#f2b544'] },
];

/** XP needed to go from level n to n + 1. */
export const xpStep = (n) => 250 + 100 * (n - 1);
export function levelFor(xp) {
  let lvl = 1;
  let left = xp;
  while (lvl < MAX_LEVEL && left >= xpStep(lvl)) {
    left -= xpStep(lvl);
    lvl++;
  }
  return { level: lvl, into: left, need: lvl >= MAX_LEVEL ? 0 : xpStep(lvl) };
}
export const unlockedAbilities = (level) => ABILITY_IDS.filter((a) => ABILITIES[a].unlock <= level);

/** The next thing a level brings after this one: { level, name } or null at the top. */
export function nextUnlock(level) {
  const all = [
    ...ABILITY_IDS.map((a) => ({ level: ABILITIES[a].unlock, name: ABILITIES[a].name })),
    ...BURSTS.map((b) => ({ level: b.level, name: b.name })),
    ...POSES.map((p) => ({ level: p.level, name: p.name })),
    ...BANNERS.map((b) => ({ level: b.level, name: b.name })),
  ].filter((u) => u.level > level);
  all.sort((a, b) => a.level - b.level);
  return all[0] ?? null;
}

const num = (v, lo, hi, fb) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fb);

export function freshProfile() {
  return {
    v: 1,
    xp: 0,
    loadout: ['smoke', 'decoy'],
    burst: 'confetti',
    pose: 'bow',
    banner: 'crimson',
    rehearsed: 0,
    hints: {},
    credited: [],
    stats: { rounds: 0, unmasks: 0, faux: 0, survived: 0, hush: 0, close: 0, best: 0, cases: 0, caseBest: 0 },
  };
}

/** Reads any save: unknown or broken parts fall back to defaults; a newer version keeps what this one understands. */
export function parseProfile(raw) {
  const p = freshProfile();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return p;
  p.xp = num(raw.xp, 0, 1e8, 0);
  if (Array.isArray(raw.loadout)) {
    const l = raw.loadout.filter((a, i, all) => ABILITY_IDS.includes(a) && all.indexOf(a) === i).slice(0, 2);
    if (l.length === 2) p.loadout = l;
  }
  if (BURSTS.some((b) => b.id === raw.burst)) p.burst = raw.burst;
  if (POSES.some((b) => b.id === raw.pose)) p.pose = raw.pose;
  if (BANNERS.some((b) => b.id === raw.banner)) p.banner = raw.banner;
  p.rehearsed = raw.rehearsed ? 1 : 0;
  if (raw.hints && typeof raw.hints === 'object') for (const [k, v] of Object.entries(raw.hints).slice(0, 40)) p.hints[String(k).slice(0, 24)] = num(v, 0, 99, 0);
  if (Array.isArray(raw.credited)) p.credited = raw.credited.filter((x) => typeof x === 'string').slice(-12).map((x) => x.slice(0, 90));
  const s = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  for (const k of Object.keys(p.stats)) p.stats[k] = num(s[k], 0, 1e8, 0);
  // The loadout must be tricks this level owns.
  const own = unlockedAbilities(levelFor(p.xp).level);
  p.loadout = p.loadout.filter((a) => own.includes(a));
  for (const a of ['smoke', 'decoy', 'opera']) if (p.loadout.length < 2 && !p.loadout.includes(a)) p.loadout.push(a);
  return p;
}

export function createProgress() {
  let profile = freshProfile();
  let loaded = false;
  let dirty = false;
  let lastWrite = 0;
  const once = new Set();
  const listeners = [];
  const write = (force) => {
    if (!loaded || !dirty) return;
    const now = performance.now();
    if (!force && now - lastWrite < 3000) return;
    lastWrite = now;
    dirty = false;
    saves.set(KEY, profile);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) write(true);
  });
  setInterval(() => write(false), 1500);
  const P = {
    get profile() {
      return profile;
    },
    get loaded() {
      return loaded;
    },
    get level() {
      return levelFor(profile.xp).level;
    },
    async load() {
      const raw = await saves.get(KEY);
      profile = parseProfile(raw);
      loaded = true;
      return profile;
    },
    touch() {
      dirty = true;
    },
    flush() {
      write(true);
    },
    on(fn) {
      listeners.push(fn);
    },
    setLoadout(l) {
      const own = unlockedAbilities(P.level);
      const ok = l.filter((a, i) => own.includes(a) && l.indexOf(a) === i).slice(0, 2);
      if (ok.length === 2) {
        profile.loadout = ok;
        dirty = true;
      }
    },
    /** A one-shot hint: true the first few times (then it stays quiet). */
    hint(key, times = 3) {
      const n = profile.hints[key] || 0;
      if (n >= times) return false;
      profile.hints[key] = n + 1;
      dirty = true;
      return true;
    },
    rehearsed() {
      profile.rehearsed = 1;
      dirty = true;
      write(true);
    },
    /** Awards a badge once per session (the platform says false for guests and repeats). */
    badge(id) {
      if (once.has(id)) return;
      once.add(id);
      badge(id);
    },
    /**
     * Credits a finished round once (a reload must not credit it twice). info: { rid, mode, skill, sc (my scores),
     * solved, humans, matchTot }. Returns { xp, level, levelUp, unlocked: [names] }.
     */
    creditRound(info) {
      if (!info?.rid || profile.credited.includes(info.rid)) return null;
      profile.credited = [...profile.credited, info.rid].slice(-12);
      const sc = info.sc;
      const before = P.level;
      const st = profile.stats;
      st.rounds++;
      st.unmasks += sc.unm;
      st.faux += sc.faux;
      st.hush += sc.hush;
      st.close += sc.close;
      if (info.mode === 'masq') {
        if (sc.caught === 0) st.survived++;
        st.best = Math.max(st.best, sc.pts);
        submitScore('best-round', sc.pts);
        if (sc.caught === 0) P.badge('ghost');
      } else {
        if (info.solved) st.cases++;
        st.caseBest = Math.max(st.caseBest, sc.pts);
        submitScore('case-file', sc.pts);
        if (info.solved && info.skill === 'master') P.badge('case-closed');
      }
      if (sc.unm > 0) submitScore('career-unmasks', st.unmasks);
      if (sc.best >= 60) P.badge('master-of-disguise');
      if (info.humans >= 10) P.badge('full-house');
      if (info.matchTot && info.matchTot.unm >= 5 && info.matchTot.faux === 0) P.badge('sharp-eye');
      const xp = Math.round(50 + Math.min(600, Math.max(0, sc.pts)) * 0.5 + (info.solved ? 60 : 0));
      profile.xp += xp;
      const after = P.level;
      const unlocked = [];
      for (let l = before + 1; l <= after; l++) {
        for (const a of ABILITY_IDS) if (ABILITIES[a].unlock === l) unlocked.push(ABILITIES[a].name);
        for (const b of BURSTS) if (b.level === l) {
          unlocked.push(b.name);
          profile.burst = b.id;
        }
        for (const q of POSES) if (q.level === l) {
          unlocked.push(q.name);
          profile.pose = q.id;
        }
        for (const q of BANNERS) if (q.level === l) {
          unlocked.push(q.name);
          profile.banner = q.id;
        }
      }
      if (after >= 10) P.badge('level-10');
      dirty = true;
      write(true);
      const res = { xp, level: after, levelUp: after > before, unlocked };
      for (const fn of listeners) fn(res);
      return res;
    },
  };
  return P;
}

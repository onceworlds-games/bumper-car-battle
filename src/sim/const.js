// Every number the rules use, in one place. Tuned against scripts/balance.mjs.

export const WALK = 1.7; // m/s: the crowd's pace, and yours
export const SPRINT = 4.5;
export const FIGURE_R = 0.34; // a reveller's footprint radius
export const SEPARATION = 0.72; // revellers keep this far apart

export const SCRIPT_S = 120; // a troupe's choreography loops every two minutes

export const TROUPES = [
  { id: 'medico', name: 'Medico', robe: 0x231d1f, trim: 0xe9dcbf, mask: 0xf3ead6 },
  { id: 'arlecchino', name: 'Arlecchino', robe: 0xb3263a, trim: 0xf2b544, mask: 0x1a1414 },
  { id: 'moretta', name: 'Moretta', robe: 0x1f7a80, trim: 0x0e4d5c, mask: 0x161214 },
  { id: 'volto', name: 'Volto', robe: 0xefe4cc, trim: 0xd8a032, mask: 0xfbf6ea },
  { id: 'colombina', name: 'Colombina', robe: 0xe58c8a, trim: 0xf6d6b8, mask: 0xf2b544 },
  { id: 'gatto', name: 'Gatto', robe: 0xd9822b, trim: 0xf3e2c4, mask: 0xf6ead0 },
  { id: 'bauta', name: 'Bauta', robe: 0x24365c, trim: 0x111a2c, mask: 0xf4efe2 },
  { id: 'jolly', name: 'Jolly', robe: 0x3d8b4f, trim: 0xe8c547, mask: 0xf4efe2 },
];

/** "a Gatto", "an Arlecchino". */
export const aTroupe = (tr) => `${/^[aeiou]/i.test(TROUPES[tr]?.name ?? '') ? 'an' : 'a'} ${TROUPES[tr]?.name ?? 'Masker'}`;

export const CROWD = { light: 6, normal: 9, packed: 12 }; // revellers per troupe

export const POISE = {
  max: 100,
  inStep: 6, // per second, standing in your slot
  out: -1.5, // per second, beyond NEAR of your slot
  sprint: -8,
  opera: -5,
  near: 2.5, // metres: between LOCK and this you hold steady
  lock: 1.25, // metres: fall in step when this close and not steering
  lockDelay: 0.3, // seconds without input before falling in
  flusterS: 6,
  unmaskCost: 25,
  swapTo: 50,
};

export const UNMASK = {
  range: 3.6,
  cone: (100 * Math.PI) / 180,
  tolerance: 0.8, // host's allowance for latency, metres
  coneTolerance: (20 * Math.PI) / 180,
  missCooldown: 8,
  powderS: 10,
  cleanWindow: 30, // no faux pas this long before: a clean unmask
};

export const GREET = {
  range: 7,
  cooldown: 3,
  npcMin: 0.55,
  npcMax: 1.25,
  okMin: 0.4, // a human answer between these reads as an ordinary wave
  okMax: 1.4,
  turnHeads: 4, // revellers this near a greeting player look at them
  turnS: 1.5,
};

export const SEEN = {
  shimmer: 14, // a flustered mask shimmers this far
  shimmerOpera: 30,
  dust: 15, // sprint dust and footsteps
  slip: 20, // a faux pas leaves your mask askew for everyone this near
  slipS: 6,
  heart: 9, // your pursuer this near (with a clear line) sets your heart going
};

export const ABILITIES = {
  smoke: { name: 'Smoke Pearl', short: 'Smoke', cooldown: 35, duration: 5, radius: 4, unlock: 1 },
  decoy: { name: 'Decoy', short: 'Decoy', cooldown: 30, duration: 15, unlock: 1 },
  opera: { name: 'Opera Glass', short: 'Glass', cooldown: 2, unlock: 1 },
  lantern: { name: 'Lantern Toss', short: 'Lantern', cooldown: 20, duration: 3, radius: 6, reach: 8, unlock: 2 },
  swap: { name: 'Swap', short: 'Swap', cooldown: 40, radius: 6, unlock: 4 },
};
export const ABILITY_IDS = ['smoke', 'decoy', 'opera', 'lantern', 'swap'];

export const SCORE = {
  unmask: 100,
  hushMult: 2,
  clean: 25,
  closeCall: 15,
  closeCallR: 3,
  survivor: 50,
  caught: -25, // being unmasked costs a little: hiding well has to be worth something
  fauxPas: -15,
  wrongPlayer: -10,
  wrongVictim: 10,
  bait: 15,
};

export const PHASES = {
  assign: 10,
  blend: 20,
  hush: 25,
  reveal: 5,
  results: 9,
};

export const CLUE = { every: 40, duel: 15, spot: 15 };

export const SPOT = {
  impostors: { novice: 3, adept: 3, master: 4 },
  points: { novice: 100, adept: 150, master: 200 },
  alertS: 15,
};

// Seconds after the platform marks a player idle (30 s without a touch): out of step they shimmer at once and leave the
// round after audienceAfter; in step (what the game asks of you in a hush, or when you are waiting) they get a minute.
export const IDLE = { audienceAfter: 15, audienceStill: 60 };

export const FILL_TO = 8; // bots fill Masquerade to this many maskers
export const MIN_MASKERS = 3;

export const LIMITS = {
  events: 24,
  names: 24,
  coords: 200,
};

/**
 * A round's timeline in seconds from its start, by mode and the length setting (minutes). Masquerade: assignment,
 * Blend, Hunt, Hush, then the reveal and the results. Spot the Mask: a case of (length - 1) minutes after a short look.
 */
export function roundTiming(mode, minutes) {
  const total = Math.max(3, Math.min(7, Math.round(Number(minutes) || 5))) * 60;
  const assign = PHASES.assign;
  const blend = mode === 'spot' ? 8 : PHASES.blend;
  const huntStart = assign + blend;
  const end = mode === 'spot' ? huntStart + (total - 60) : total;
  const hushStart = end - PHASES.hush;
  const reveal = end + PHASES.reveal;
  return { total, assign, blend, huntStart, hushStart, end, reveal, over: reveal + PHASES.results };
}

/** Which part of the round a time (seconds from its start) falls in. */
export function phaseAt(timing, t) {
  if (t < timing.assign) return 'assign';
  if (t < timing.huntStart) return 'blend';
  if (t < timing.hushStart) return 'hunt';
  if (t < timing.end) return 'hush';
  if (t < timing.reveal) return 'reveal';
  return 'results';
}

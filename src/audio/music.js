// The band: a barcarolle in 6/8 (bass on one and four, accordion breathing on the off-beats, a mandolin tune with
// tremolo on the long notes, a tambourine when it's lively). It responds to the night: calm in the lobby, fuller on
// the hunt, quicker and thinner as midnight nears, silent for the Hush. Each round gets its own tune from its seed.
import { audio, inst, midiHz } from './engine.js';
import { rng, hash32 } from '../sim/rng.js';

// D minor. Chords as MIDI notes (root first).
const CHORDS = {
  Dm: [50, 53, 57],
  Gm: [55, 58, 62],
  A7: [57, 61, 64, 67],
  Bb: [58, 62, 65],
  C: [48, 52, 55],
  F: [53, 57, 60],
};
const PROG = ['Dm', 'Dm', 'Gm', 'A7', 'Dm', 'Bb', 'Gm', 'A7', 'F', 'C', 'Bb', 'A7', 'Dm', 'Gm', 'A7', 'Dm'];
const SCALE = [62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79, 81];
const RHYTHMS = [
  [3, 3],
  [2, 1, 2, 1],
  [1, 1, 1, 3],
  [3, 1, 1, 1],
  [2, 1, 3],
  [1, 1, 1, 1, 1, 1],
];

export function createMusic() {
  let timer = 0;
  let next = 0;
  let step = 0;
  let mode = 'off';
  let intensity = 0.5;
  let tempo = 62;
  let tune = makeTune(1);
  let tuneSeed = 1;
  const m = {
    /** mode: 'off' | 'lobby' | 'blend' | 'hunt' | 'hush' | 'results'; u: 0..1 through the hunt. */
    set(nextMode, u = 0, seed = tuneSeed) {
      if (seed !== tuneSeed) {
        tuneSeed = seed;
        tune = makeTune(seed);
      }
      mode = nextMode;
      intensity = mode === 'lobby' ? 0.55 : mode === 'blend' ? 0.4 : mode === 'hunt' ? 0.6 + 0.4 * u : mode === 'results' ? 0.7 : 0;
      tempo = mode === 'hunt' ? 64 + 14 * u * u : mode === 'results' ? 66 : 60;
      if (mode !== 'off' && mode !== 'hush' && !timer) start();
      if ((mode === 'off' || mode === 'hush') && timer) stop();
    },
    get mode() {
      return mode;
    },
  };

  function start() {
    if (!audio.ctx) return;
    next = audio.now() + 0.1;
    timer = setInterval(schedule, 50);
  }
  function stop() {
    clearInterval(timer);
    timer = 0;
  }
  function schedule() {
    if (!audio.ready) return;
    const now = audio.now();
    if (next < now - 0.5) next = now + 0.05;
    while (next < now + 0.25) {
      play(step, next);
      next += 60 / tempo / 3;
      step = (step + 1) % (PROG.length * 6);
    }
  }
  function play(s, t) {
    const bar = Math.floor(s / 6);
    const pos = s % 6;
    const chord = CHORDS[PROG[bar % PROG.length]];
    const late = mode === 'hunt' && intensity > 0.9;
    // Bass: one and four.
    if (pos === 0) inst.pluck(midiHz(chord[0] - 12), t, 0.55, 'music', -0.2);
    if (pos === 3) inst.pluck(midiHz(chord[0] - 12 + 7), t, 0.4, 'music', -0.2);
    // Accordion on the off-beats (dropped when it gets late: the band thins out).
    if (!late && (pos === 1 || pos === 4) && intensity > 0.35) inst.accordion(chord.slice(0, 3).map((n) => midiHz(n)), t, (60 / tempo / 3) * 1.7, 0.05 + intensity * 0.04);
    // The tune.
    if (intensity >= 0.5) {
      const notes = tune[bar % tune.length];
      for (const n of notes) {
        if (n.pos !== pos) continue;
        const len = (n.len * 60) / tempo / 3;
        if (n.len >= 3 && !late) {
          // Mandolin tremolo on the long notes.
          const reps = Math.floor(len / 0.075);
          for (let i = 0; i < reps; i++) inst.pluck(midiHz(n.midi), t + i * 0.075, 0.18 * (1 - i / (reps * 1.4)), 'music', 0.25);
        } else inst.pluck(midiHz(n.midi + (late ? 12 : 0)), t, late ? 0.22 : 0.3, 'music', 0.25);
      }
    }
    // Tambourine.
    if (intensity > 0.6 && (pos === 0 || pos === 3)) inst.noise(t, 0.12, 7000, 1.2, 0.05 + intensity * 0.04, 'music', 'highpass', 0.1);
    if (intensity > 0.8 && pos % 3 === 2) inst.noise(t, 0.06, 8000, 1, 0.03, 'music', 'highpass', 0.05);
  }
  return m;
}

/** A tune: one phrase per bar, chord tones on the strong beats, steps between. */
function makeTune(seed) {
  const R = rng(hash32('tune', seed));
  const bars = [];
  let prev = 69;
  for (let b = 0; b < PROG.length; b++) {
    const chord = CHORDS[PROG[b]];
    const rhythm = b % 4 === 3 ? [3, 3] : R.pick(RHYTHMS);
    const notes = [];
    let pos = 0;
    for (const len of rhythm) {
      const strong = pos === 0 || pos === 3;
      let target;
      if (strong) {
        const tones = chord.flatMap((n) => [n + 12, n + 24]).filter((n) => n >= 62 && n <= 81);
        target = tones.reduce((a, n) => (Math.abs(n - prev) < Math.abs(a - prev) ? n : a), tones[0]);
        if (R.chance(0.3)) target = R.pick(tones);
      } else {
        const i = SCALE.reduce((best, n, k) => (Math.abs(n - prev) < Math.abs(SCALE[best] - prev) ? k : best), 0);
        target = SCALE[Math.max(0, Math.min(SCALE.length - 1, i + (R.chance(0.5) ? 1 : -1)))];
      }
      notes.push({ pos, len, midi: target });
      prev = target;
      pos += len;
    }
    bars.push(notes);
  }
  return bars;
}

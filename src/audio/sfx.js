// Every action answers with a sound: fans snap, masks clatter, revellers gasp, lanterns whoosh, the bell tolls
// midnight. Pitches vary a little each time and the same variant never plays twice in a row. Positional sounds fade
// with distance from you. The crowd's murmur and your own footsteps run underneath.
import { audio, inst, midiHz } from './engine.js';

let lastVariant = new Map();
const vary = (key, n) => {
  let v = Math.floor(Math.random() * n);
  if (n > 1 && v === lastVariant.get(key)) v = (v + 1) % n;
  lastVariant.set(key, v);
  return v;
};
const jitter = (f, cents = 40) => f * Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200);
const at = (dt = 0) => audio.now() + 0.01 + dt;
/** Loudness by distance: full within 4 m, gone at 30 m. */
export const near = (d) => (d <= 4 ? 1 : d >= 30 ? 0 : 1 - (d - 4) / 26);

export const sfx = {
  ui() {
    if (!audio.ready) return;
    inst.pluck(jitter(midiHz([74, 77, 81][vary('ui', 3)]), 10), at(), 0.28, 'sfx', 0);
  },
  confirm() {
    if (!audio.ready) return;
    inst.pluck(midiHz(74), at(), 0.3, 'sfx');
    inst.pluck(midiHz(81), at(0.07), 0.3, 'sfx');
  },
  refuse() {
    if (!audio.ready) return;
    inst.tone(at(), 220, 150, 0.12, 0.18, 'triangle');
    inst.noise(at(), 0.05, 2500, 3, 0.12);
  },
  step(sprint, vol = 1) {
    if (!audio.ready) return;
    inst.noise(at(), sprint ? 0.07 : 0.05, jitter(sprint ? 1400 : 1100, 200), 1.8, (sprint ? 0.16 : 0.07) * vol, 'sfx', 'bandpass', 0.08);
  },
  /** The fan snaps open: whoosh and click. */
  flick(vol = 1) {
    if (!audio.ready || vol <= 0) return;
    inst.noise(at(), 0.18, jitter(2600, 200), 0.8, 0.22 * vol, 'sfx', 'bandpass', 0.15, 2.2);
    inst.tone(at(0.12), jitter(1800), 900, 0.05, 0.16 * vol, 'square');
  },
  /** A mask falls: wooden clatter bouncing on stone, a chime, the crowd's "ooh". */
  unmask(vol = 1, mine = false) {
    if (!audio.ready || vol <= 0) return;
    const t0 = at(0.05);
    for (let i = 0; i < 4; i++) inst.tone(t0 + 0.35 + i * 0.13 * (1 - i * 0.18), jitter(900 - i * 80, 80), 500, 0.07, 0.2 * vol * (1 - i * 0.2), 'triangle');
    for (const [k, n] of [[0, 74], [1, 78], [2, 81], [3, 86]]) inst.pluck(midiHz(n), t0 + k * 0.06, 0.25 * vol, 'sfx', 0);
    for (let i = 0; i < 5; i++) inst.gasp(t0 + 0.05 + Math.random() * 0.2, jitter(240 + i * 25, 120), 0.07 * vol, 'o');
    if (mine) sfx.applause(0.8);
  },
  applause(vol = 0.6) {
    if (!audio.ready) return;
    for (let i = 0; i < 40; i++) inst.noise(at(Math.random() * 1.6), 0.03, jitter(1700, 400), 1.5, 0.08 * vol * (1 - i / 50), 'sfx', 'bandpass', 0.3);
  },
  /** A faux pas: a reveller's comic "oh!" and a titter round about. */
  faux(vol = 1, mine = false) {
    if (!audio.ready || vol <= 0) return;
    inst.gasp(at(), jitter(mine ? 300 : 280, 60), 0.28 * vol, ['o', 'a', 'e'][vary('faux', 3)]);
    for (let i = 0; i < 3; i++) inst.gasp(at(0.35 + i * 0.12), jitter(420, 120), 0.05 * vol, 'e');
    if (mine) inst.tone(at(0.15), 520, 180, 0.6, 0.12, 'sine');
  },
  wave(vol = 1) {
    if (!audio.ready || vol <= 0) return;
    inst.noise(at(), 0.22, 900, 0.7, 0.07 * vol, 'sfx', 'bandpass', 0.1, 1.8);
    inst.pluck(jitter(midiHz(79), 15), at(0.05), 0.12 * vol, 'sfx');
  },
  /** Somebody greets you: answer it. */
  prompt() {
    if (!audio.ready) return;
    inst.pluck(midiHz(81), at(), 0.35, 'sfx');
    inst.pluck(midiHz(86), at(0.1), 0.35, 'sfx');
  },
  smoke(vol = 1) {
    if (!audio.ready || vol <= 0) return;
    inst.noise(at(), 1.6, 700, 0.5, 0.25 * vol, 'sfx', 'lowpass', 0.4, 0.4);
    inst.tone(at(), 300, 90, 0.4, 0.1 * vol);
  },
  pop(vol = 1) {
    if (!audio.ready || vol <= 0) return;
    inst.tone(at(), jitter(700), 1400, 0.08, 0.2 * vol, 'sine');
    inst.noise(at(0.02), 0.25, 5000, 2, 0.06 * vol, 'sfx', 'highpass', 0.3);
  },
  swish(vol = 1) {
    if (!audio.ready || vol <= 0) return;
    inst.noise(at(), 0.4, 1200, 1.4, 0.18 * vol, 'sfx', 'bandpass', 0.2, 3);
    inst.noise(at(0.15), 0.35, 3600, 1.4, 0.1 * vol, 'sfx', 'bandpass', 0.2, 0.4);
  },
  lantern(vol = 1) {
    if (!audio.ready || vol <= 0) return;
    inst.noise(at(), 0.6, 1500, 1, 0.12 * vol, 'sfx', 'bandpass', 0.2, 0.5);
    inst.tone(at(0.7), 2400, 2350, 0.5, 0.06 * vol, 'sine', 'sfx', 0.4);
  },
  fluster() {
    if (!audio.ready) return;
    for (let i = 0; i < 3; i++) inst.tone(at(i * 0.11), 520 - i * 90, 400 - i * 90, 0.12, 0.12, 'triangle');
  },
  glass(on) {
    if (!audio.ready) return;
    inst.tone(at(), on ? 1200 : 900, on ? 1800 : 600, 0.08, 0.08, 'sine');
  },
  heartbeat(vol = 0.5) {
    if (!audio.ready) return;
    inst.heartbeat(at(), vol);
  },
  clue() {
    if (!audio.ready) return;
    [62, 69, 74, 77].forEach((n, i) => inst.pluck(midiHz(n), at(i * 0.07), 0.2, 'sfx'));
  },
  /** A score in your favour: rising plucks; a loss, falling ones. */
  points(good) {
    if (!audio.ready) return;
    const ns = good ? [74, 78, 81] : [69, 65, 62];
    ns.forEach((n, i) => inst.pluck(midiHz(n), at(i * 0.08), 0.22, 'sfx'));
  },
  bell(strikes = 12) {
    if (!audio.ready) return;
    for (let i = 0; i < strikes; i++) inst.bell(196, at(i * 1.4), 0.3);
  },
  whistle() {
    if (!audio.ready) return;
    inst.tone(at(), 500, 2600, 1.3, 0.06, 'sine', 'sfx', 0.4);
  },
  boom(vol = 1) {
    if (!audio.ready || vol <= 0) return;
    inst.boom(at(), 0.35 * vol);
  },
  reveal() {
    if (!audio.ready) return;
    inst.accordion([midiHz(50), midiHz(57), midiHz(62), midiHz(65)], at(), 1.6, 0.14, 'sfx');
    inst.noise(at(), 1.4, 6000, 0.6, 0.12, 'sfx', 'highpass', 0.5);
  },
  fanfare() {
    if (!audio.ready) return;
    [62, 66, 69, 74, 78, 81].forEach((n, i) => inst.pluck(midiHz(n), at(i * 0.09), 0.3, 'sfx'));
    inst.accordion([midiHz(62), midiHz(66), midiHz(69)], at(0.5), 1.4, 0.12, 'sfx');
  },
};

/** The crowd's murmur: soft bursts of filtered noise, busier the more people are near. */
export function createAmbience() {
  let timer = 0;
  let density = 0.5;
  let water = 0;
  return {
    start() {
      if (timer || !audio.ctx) return;
      timer = setInterval(() => {
        if (!audio.ready) return;
        const t = audio.now() + 0.05;
        if (Math.random() < 0.35 + density * 0.6) inst.noise(t + Math.random() * 0.2, 0.35 + Math.random() * 0.5, 350 + Math.random() * 700, 2.5, 0.02 + density * 0.04, 'amb', 'bandpass', 0.4);
        if (water > 0.05 && Math.random() < 0.3) inst.noise(t, 0.9, 300 + Math.random() * 200, 0.7, 0.04 * water, 'amb', 'lowpass', 0.2);
      }, 180);
    },
    stop() {
      clearInterval(timer);
      timer = 0;
    },
    set(d, w = 0) {
      density = Math.max(0, Math.min(1, d));
      water = Math.max(0, Math.min(1, w));
    },
  };
}

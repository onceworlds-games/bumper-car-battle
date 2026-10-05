// All the sound, synthesized with Web Audio (no files): a short sound for every action and a looping step-sequencer tune.
// The platform applies volume and mute to everything connected to the context's destination. Safe to import anywhere:
// nothing happens until unlock() is called from a tap.

const BPM = 120;
const STEP_S = 60 / BPM / 4; // a sixteenth
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// C G Am F, one bar each: [bass root midi, chord midis]
const BARS = [
  [36, [60, 64, 67]],
  [31, [59, 62, 67]],
  [33, [57, 60, 64]],
  [29, [57, 60, 65]],
];

const LEVELS = { off: 0, menu: 0.2, play: 0.46 };

export function createAudio() {
  let ctx = null;
  let sfxGain = null;
  let musicGain = null;
  let noise = null;
  let timer = null;
  let nextTime = 0;
  let step = 0;
  let level = 'menu';
  let applied = '';
  const last = Object.create(null);

  const live = () => ctx !== null && ctx.state === 'running';
  const can = (name, ms) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - (last[name] ?? -1e9) < ms) return false;
    last[name] = now;
    return true;
  };

  function tone(type, f0, f1, dur, vol, at = 0, dest = sfxGain) {
    if (!live()) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function burst(ftype, f0, f1, dur, vol, at = 0, dest = sfxGain, q = 0.9) {
    if (!live() || !noise) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filt = ctx.createBiquadFilter();
    filt.type = ftype;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.4, dur + 0.05);
  }

  // ------------------------------------------------------------ the tune
  function playStep(s, t) {
    const bar = BARS[(s >> 4) % 4];
    const k = s & 15;
    const [root, chord] = bar;
    const at = t - ctx.currentTime;
    // drums
    if (k % 4 === 0) tone('sine', 130, 42, 0.16, 0.5, at, musicGain);
    if (k === 4 || k === 12) burst('bandpass', 1900, 1500, 0.1, 0.22, at, musicGain, 0.7);
    if (k % 2 === 1) burst('highpass', 7000, 7000, 0.035, 0.07, at, musicGain, 0.5);
    if (k === 14) burst('highpass', 6000, 6000, 0.12, 0.07, at, musicGain, 0.5);
    // bass: root and its octave on the eighths
    if (k % 2 === 0) tone('triangle', hz(root + (k % 4 === 2 ? 12 : 0)), hz(root + (k % 4 === 2 ? 12 : 0)), 0.2, 0.34, at, musicGain);
    // chord stabs on the off beats
    if (k === 6 || k === 14) for (const m of chord) tone('square', hz(m), hz(m), 0.16, 0.05, at, musicGain);
    // a plucked arpeggio
    if (k % 2 === 0) {
      const m = chord[(k >> 1) % 3] + 12;
      tone('triangle', hz(m), hz(m), 0.14, 0.12, at, musicGain);
    }
  }

  function schedule() {
    if (!live()) return;
    if (nextTime < ctx.currentTime - 0.4) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + 0.14) {
      playStep(step, nextTime);
      nextTime += STEP_S;
      step = (step + 1) % 64;
    }
  }

  const api = {
    /** Call from a tap or key: creates the context, starts the tune. True if sound can play. */
    unlock() {
      try {
        if (!ctx) {
          const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
          if (!AC) return false;
          ctx = new AC();
          sfxGain = ctx.createGain();
          sfxGain.gain.value = 0.9;
          sfxGain.connect(ctx.destination);
          musicGain = ctx.createGain();
          musicGain.gain.value = LEVELS[level];
          applied = level;
          musicGain.connect(ctx.destination);
          noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        if (!timer) {
          nextTime = ctx.currentTime + 0.1;
          timer = setInterval(schedule, 30);
        }
        return true;
      } catch {
        return false;
      }
    },

    /** 'menu' (quiet), 'play' (louder) or 'off'. */
    setLevel(name) {
      const next = LEVELS[name] !== undefined ? name : 'menu';
      if (next === level && applied === level) return;
      level = next;
      if (ctx && musicGain) {
        musicGain.gain.setTargetAtTime(LEVELS[level], ctx.currentTime, 0.35);
        applied = level;
      }
    },

    tick() {
      tone('sine', 520, 520, 0.14, 0.4);
    },
    go() {
      tone('sine', 880, 880, 0.4, 0.45);
      tone('sine', 1320, 1320, 0.3, 0.25, 0.04);
    },
    bonk(power = 8) {
      if (!can('bonk', 45)) return;
      const p = Math.min(1, Math.max(0.2, power / 12));
      tone('sine', 190, 52, 0.2, 0.3 + 0.35 * p);
      burst('lowpass', 1500, 300, 0.1, 0.25 * p);
      tone('triangle', 340, 140, 0.12, 0.12 * p);
    },
    boost() {
      if (!can('boost', 60)) return;
      burst('bandpass', 400, 2600, 0.32, 0.3, 0, sfxGain, 1.4);
      tone('sawtooth', 170, 430, 0.26, 0.1);
    },
    ko() {
      tone('triangle', 523, 523, 0.1, 0.3);
      tone('triangle', 659, 659, 0.1, 0.3, 0.09);
      tone('triangle', 784, 784, 0.22, 0.34, 0.18);
    },
    fall() {
      if (!can('fall', 120)) return;
      tone('sine', 950, 200, 0.5, 0.16);
    },
    splash() {
      if (!can('splash', 100)) return;
      burst('lowpass', 3200, 280, 0.6, 0.5);
      tone('sine', 420, 90, 0.22, 0.16);
    },
    pop() {
      tone('sine', 500, 920, 0.09, 0.16);
    },
    warn() {
      tone('triangle', 660, 660, 0.12, 0.3);
      tone('triangle', 440, 440, 0.14, 0.3, 0.14);
    },
    crumble() {
      burst('lowpass', 900, 130, 0.8, 0.55);
      tone('sawtooth', 95, 38, 0.55, 0.16);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.2, 0.16, i * 0.11));
      [523, 659, 784].forEach((f) => tone('triangle', f, f, 0.9, 0.16, 0.44));
    },
    lose() {
      tone('triangle', 330, 220, 0.4, 0.2);
    },
    point() {
      tone('square', 1046, 1046, 0.07, 0.12);
      tone('square', 1568, 1568, 0.1, 0.12, 0.06);
    },
    ready() {
      tone('sine', 784, 1175, 0.16, 0.26);
    },
    click() {
      tone('sine', 660, 660, 0.06, 0.25);
    },
    thump() {
      if (!can('thump', 80)) return;
      tone('sine', 150, 70, 0.1, 0.16);
    },
  };
  return api;
}

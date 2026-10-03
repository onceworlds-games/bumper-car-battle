// The sound engine: one AudioContext started from a tap in the game, buses for music, effects and ambience into a
// limiter so nothing clips, and the instruments, all synthesized: plucked strings (Karplus-Strong, rendered once into
// buffers), a reedy accordion, noise, a bell, a formant "oh!", heartbeats and fireworks. The platform applies the
// player's volume and mute itself.

let ctx = null;
let master = null;
const bus = {};
const buffers = {};
let unlocked = false;

export const audio = {
  get ctx() {
    return ctx;
  },
  get ready() {
    return unlocked && !!ctx && ctx.state === 'running';
  },
  bus,
  buffers,
  /** Call from a tap or key press inside the game: creates or resumes the context. */
  unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
        build();
      }
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      unlocked = true;
      return true;
    } catch {
      return false;
    }
  },
  suspend() {
    try {
      if (ctx && ctx.state === 'running') ctx.suspend();
    } catch {}
  },
  resume() {
    try {
      if (ctx && unlocked && ctx.state !== 'running') ctx.resume().catch(() => {});
    } catch {}
  },
  now: () => (ctx ? ctx.currentTime : 0),
};

function build() {
  master = ctx.createGain();
  master.gain.value = 0.9;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 6;
  limiter.ratio.value = 18;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  master.connect(limiter).connect(ctx.destination);
  for (const [name, v] of [
    ['music', 0.5],
    ['sfx', 0.85],
    ['amb', 0.45],
  ]) {
    bus[name] = ctx.createGain();
    bus[name].gain.value = v;
    bus[name].connect(master);
  }
  // A small room: the plaza's stone answers a little.
  const verb = ctx.createConvolver();
  verb.buffer = impulse(1.8, 2.6);
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.22;
  verb.connect(verbGain).connect(master);
  bus.verb = verb;
  // Noise and plucked-string buffers, rendered once.
  buffers.noise = noiseBuffer(2);
  for (const base of [110, 220, 440, 880]) buffers[`pluck${base}`] = pluckBuffer(base, base < 200 ? 2.2 : 1.4);
}

function impulse(seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}

function noiseBuffer(seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** Karplus-Strong: a burst of noise in a delay line, averaged each pass: a plucked string. */
function pluckBuffer(freq, seconds) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const period = Math.max(2, Math.round(sr / freq));
  const line = new Float32Array(period);
  for (let i = 0; i < period; i++) line[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin((i / period) * Math.PI));
  let idx = 0;
  const damp = 0.996 - freq / 60000;
  for (let i = 0; i < n; i++) {
    const a = line[idx];
    const nb = line[(idx + 1) % period];
    const v = (a + nb) * 0.5 * damp;
    line[idx] = v;
    d[i] = a;
    idx = (idx + 1) % period;
  }
  return b;
}

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export { midiHz };

/** Connects a node to a bus, with a little reverb send. */
function out(node, name = 'sfx', wet = 0.25) {
  node.connect(bus[name]);
  if (wet > 0 && bus.verb) {
    const g = ctx.createGain();
    g.gain.value = wet;
    node.connect(g).connect(bus.verb);
  }
}

export const inst = {
  /** A plucked note (mandolin-ish). */
  pluck(freq, t, vel = 0.5, busName = 'music', pan = 0) {
    if (!ctx) return;
    const base = freq < 165 ? 110 : freq < 330 ? 220 : freq < 660 ? 440 : 880;
    const src = ctx.createBufferSource();
    src.buffer = buffers[`pluck${base}`];
    src.playbackRate.value = freq / base;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p);
    out(p, busName, 0.3);
    src.start(t);
    src.stop(t + 1.4);
  },
  /** An accordion chord: detuned reeds through a soft filter, the bellows breathing. */
  accordion(freqs, t, dur, vel = 0.12, busName = 'music') {
    if (!ctx) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.06);
    g.gain.setValueAtTime(vel, t + Math.max(0.07, dur - 0.08));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const trem = ctx.createOscillator();
    const tg = ctx.createGain();
    trem.frequency.value = 5.5;
    tg.gain.value = vel * 0.18;
    trem.connect(tg).connect(g.gain);
    for (const fr of freqs) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
    f.connect(g);
    out(g, busName, 0.2);
    trem.start(t);
    trem.stop(t + dur + 0.05);
  },
  /** A noise burst through a band filter: footsteps, dust, smoke, a fan's whoosh, a tambourine. */
  noise(t, dur, freq, q, vel, busName = 'sfx', type = 'bandpass', wet = 0.15, sweep = 0) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buffers.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g);
    out(g, busName, wet);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  },
  /** A tone with a pitch glide and a fast envelope (knocks, ticks, thumps, whistles). */
  tone(t, f0, f1, dur, vel, type = 'sine', busName = 'sfx', wet = 0.1) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    out(g, busName, wet);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  /** A bell: inharmonic partials, each with its own decay. */
  bell(freq, t, vel = 0.25) {
    if (!ctx) return;
    for (const [ratio, amp, decay] of [
      [0.5, 0.6, 4],
      [1, 1, 3],
      [1.19, 0.5, 2.2],
      [1.56, 0.4, 1.8],
      [2, 0.35, 1.5],
      [2.66, 0.2, 1],
      [3.01, 0.15, 0.8],
    ]) {
      inst.tone(t, freq * ratio, freq * ratio * 0.999, decay, vel * amp * 0.5, 'sine', 'sfx', 0.5);
    }
  },
  /** A formant "oh!": a buzz through two vowel filters, pitch falling: a comic gasp. */
  gasp(t, pitch = 260, vel = 0.25, vowel = 'o') {
    if (!ctx) return;
    const F = { o: [570, 840], a: [730, 1090], e: [530, 1840] }[vowel] ?? [570, 840];
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch * 1.25, t);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.8, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    const mix = ctx.createGain();
    mix.gain.value = 1;
    for (const [fr, q, a] of [
      [F[0], 7, 1],
      [F[1], 9, 0.6],
    ]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fr;
      bp.Q.value = q;
      const ga = ctx.createGain();
      ga.gain.value = a;
      o.connect(bp).connect(ga).connect(mix);
    }
    mix.connect(g);
    out(g, 'sfx', 0.3);
    o.start(t);
    o.stop(t + 0.55);
    inst.noise(t, 0.25, 1800, 1.2, vel * 0.3, 'sfx', 'bandpass', 0.2);
  },
  heartbeat(t, vel = 0.5) {
    inst.tone(t, 70, 42, 0.16, vel, 'sine', 'sfx', 0);
    inst.tone(t + 0.22, 62, 40, 0.14, vel * 0.7, 'sine', 'sfx', 0);
  },
  boom(t, vel = 0.5) {
    if (!ctx) return;
    inst.tone(t, 110, 32, 0.9, vel, 'sine', 'sfx', 0.6);
    inst.noise(t, 0.6, 600, 0.5, vel * 0.7, 'sfx', 'lowpass', 0.6, 0.3);
    for (let i = 0; i < 9; i++) inst.noise(t + 0.25 + Math.random() * 0.9, 0.04, 3000 + Math.random() * 3000, 2, vel * 0.18, 'sfx', 'bandpass', 0.4);
  },
};

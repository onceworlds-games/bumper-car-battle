// A fake page for running the game's browser code in node: a canvas whose context records bad calls (NaN arguments,
// negative radii that a real browser throws on), requestAnimationFrame / timers driven by a virtual clock, key and pointer
// events, and a fake Web Audio. Not a browser: it only lets main.js, draw.js, ui.js and the rest run through whole matches.

export const T = { ms: 5_000_000 };
const T0 = T.ms;

Date.now = () => T.ms;
Object.defineProperty(globalThis.performance, 'now', { value: () => T.ms - T0, configurable: true });

const timers = [];
let timerId = 1;
globalThis.setTimeout = (fn, ms = 0) => {
  const id = timerId++;
  timers.push({ id, fn, at: T.ms + ms, every: 0 });
  return id;
};
globalThis.clearTimeout = (id) => {
  const i = timers.findIndex((t) => t.id === id);
  if (i >= 0) timers.splice(i, 1);
};
globalThis.setInterval = (fn, ms = 0) => {
  const id = timerId++;
  timers.push({ id, fn, at: T.ms + ms, every: Math.max(1, ms) });
  return id;
};
globalThis.clearInterval = globalThis.clearTimeout;

const rafs = [];
globalThis.requestAnimationFrame = (cb) => {
  rafs.push(cb);
  return rafs.length;
};

export const errors = [];

/** Advance the virtual clock one frame (1/60 s): due timers fire, then every requestAnimationFrame callback. */
export function frame(ms = 1000 / 60) {
  T.ms += ms;
  for (let guard = 0; guard < 1000; guard++) {
    const due = timers.filter((t) => t.at <= T.ms).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    if (due.every) due.at += due.every;
    else timers.splice(timers.indexOf(due), 1);
    try {
      due.fn();
    } catch (e) {
      errors.push(e);
    }
  }
  const cbs = rafs.splice(0);
  for (const cb of cbs) {
    try {
      cb(T.ms - T0);
    } catch (e) {
      errors.push(e);
    }
  }
}

export function frames(n) {
  for (let i = 0; i < n; i++) frame();
}

// ---------------------------------------------------------------- a canvas context that checks what it is asked to do
const DEFAULTS = {
  globalAlpha: 1,
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  textAlign: 'start',
  textBaseline: 'alphabetic',
  lineDashOffset: 0,
  font: '10px sans-serif',
  fillStyle: '#000',
  strokeStyle: '#000',
  shadowBlur: 0,
  globalCompositeOperation: 'source-over',
};

export function makeCtx(label = 'ctx') {
  const state = { ...DEFAULTS };
  const bad = [];
  const counts = { calls: 0 };
  const grad = { addColorStop() {} };
  const note = (what) => {
    if (bad.length < 20) bad.push(what);
  };
  const methods = {
    measureText: (s) => ({ width: String(s).length * 11 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    getLineDash: () => [],
    isPointInPath: () => false,
    drawImage: () => {},
  };
  const proxy = new Proxy(
    {},
    {
      get(_, p) {
        if (p === 'bad') return bad;
        if (p === 'counts') return counts;
        if (p in methods) return methods[p];
        if (p in state) return state[p];
        return (...args) => {
          counts.calls++;
          for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) note(`${label}.${String(p)}(${args.join(', ')})`);
          if (p === 'arc' && args[2] < 0) throw new Error(`${label}.arc with a negative radius: ${args.join(', ')}`);
          if (p === 'ellipse' && (args[2] < 0 || args[3] < 0)) throw new Error(`${label}.ellipse with a negative radius: ${args.join(', ')}`);
          if (p === 'arcTo' && args[4] < 0) throw new Error(`${label}.arcTo with a negative radius: ${args.join(', ')}`);
          if (p === 'fillText' || p === 'strokeText') {
            if (typeof args[0] !== 'string' && typeof args[0] !== 'number') note(`${label}.${String(p)} of a non-string`);
          }
        };
      },
      set(_, p, v) {
        if (typeof v === 'number' && !Number.isFinite(v)) note(`${label}.${String(p)} = ${v}`);
        if (p === 'fillStyle' || p === 'strokeStyle') {
          if (typeof v === 'string' && /NaN|undefined|Infinity/.test(v)) note(`${label}.${String(p)} = ${v}`);
        }
        if (p === 'font' && /NaN|undefined/.test(String(v))) note(`${label}.font = ${v}`);
        state[p] = v;
        return true;
      },
    },
  );
  return proxy;
}

// ---------------------------------------------------------------- fake Web Audio
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
export const audioStats = { contexts: 0, notes: 0 };
class FakeAudioContext {
  constructor() {
    audioStats.contexts++;
    this.state = 'running';
    this.sampleRate = 8000;
    this.destination = {};
  }
  get currentTime() {
    return (T.ms - T0) / 1000;
  }
  createGain() {
    return { gain: param(), connect() {} };
  }
  createOscillator() {
    audioStats.notes++;
    return { type: '', frequency: param(), connect() {}, start() {}, stop() {} };
  }
  createBiquadFilter() {
    return { type: '', Q: { value: 0 }, frequency: param(), connect() {} };
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {} };
  }
  createBuffer(_c, len) {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume() {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------- one page
export function makePage({ w = 812, h = 375, search = '', onceworlds } = {}) {
  const ctx = makeCtx('page');
  const listeners = new Map();
  const bus = (target) => ({
    addEventListener(type, fn) {
      if (!target.has(type)) target.set(type, []);
      target.get(type).push(fn);
    },
  });
  const winL = new Map();
  const canvasL = new Map();
  const docL = new Map();
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
    ...bus(canvasL),
  };
  const document = {
    getElementById: () => canvas,
    fonts: { load: async () => {}, ready: Promise.resolve() },
    body: { dataset: {}, style: {} },
    hidden: false,
    activeElement: null,
    ...bus(docL),
  };
  const win = {
    innerWidth: w,
    innerHeight: h,
    onceworlds,
    AudioContext: FakeAudioContext,
    devicePixelRatio: 2,
    ...bus(winL),
  };
  const page = {
    canvas,
    ctx,
    document,
    window: win,
    audio: audioStats,
    /** Make this page's globals the current ones (do it before importing its main.js, and before firing its events). */
    install() {
      globalThis.window = win;
      globalThis.document = document;
      globalThis.location = { search };
      globalThis.addEventListener = (type, fn) => bus(winL).addEventListener(type, fn);
      globalThis.devicePixelRatio = 2;
      try {
        Object.defineProperty(globalThis, 'navigator', { value: { vibrate() {} }, configurable: true });
      } catch {
        // already there
      }
      globalThis.Image = class {
        set src(v) {
          this._src = v;
        }
      };
    },
    fire(type, ev = {}, target = 'window') {
      const map = target === 'canvas' ? canvasL : target === 'document' ? docL : winL;
      const e = { preventDefault() {}, isTrusted: false, repeat: false, ...ev };
      for (const fn of map.get(type) ?? []) fn(e);
    },
    key(code, down = true) {
      page.fire(down ? 'keydown' : 'keyup', { code, key: code });
    },
    tap(x, y) {
      page.fire('pointerdown', { clientX: x, clientY: y, pointerType: 'touch' }, 'canvas');
    },
    resize(nw, nh) {
      win.innerWidth = nw;
      win.innerHeight = nh;
      page.install();
      page.fire('resize');
    },
  };
  void listeners;
  return page;
}

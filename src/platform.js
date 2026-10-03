// Every call into the platform goes through here. On Onceworlds `window.onceworlds` is injected before the game's
// scripts; opened on its own (local dev, poster mode, tests) the game gets a stand-in with saves in localStorage and
// a solo room where the player is the host, so the same code runs everywhere. Nothing here ever throws into the game.

const warn = (where, e) => {
  try {
    console.warn(`[carnevale] ${where}:`, e?.message ?? e);
  } catch {}
};

/** Runs fn, returning `fallback` if it throws (or returns a rejected promise, for async ones). */
export function safe(fn, fallback, where = 'sdk') {
  try {
    const v = fn();
    if (v && typeof v.then === 'function') return v.catch((e) => (warn(where, e), fallback));
    return v === undefined ? fallback : v;
  } catch (e) {
    warn(where, e);
    return fallback;
  }
}

function urlSettings() {
  const out = {};
  try {
    const q = new URLSearchParams(location.search);
    for (const k of ['mode', 'rounds', 'length', 'crowd', 'loadout', 'bots']) {
      if (!q.has(k)) continue;
      const v = q.get(k);
      out[k] = /^\d+$/.test(v) ? Number(v) : v;
    }
  } catch {}
  return out;
}

function soloRoom(player) {
  const listeners = new Map();
  const me = { id: player.id, name: player.name, presence: null, team: 0, connected: true, ready: false };
  let started = 0;
  let pausedAt = 0;
  let n = 0;
  const hist = new Map();
  const priv = {};
  const emit = (ev, ...args) => {
    for (const fn of [...(listeners.get(ev) ?? [])]) {
      try {
        fn(...args);
      } catch (e) {
        warn(`room ${ev}`, e);
      }
    }
  };
  const room = {
    id: 'solo',
    kind: 'solo',
    me,
    players: new Map([[me.id, me]]),
    state: {},
    host: me.id,
    connected: true,
    // Opened on its own, the lobby settings can come from the address (?rounds=1&length=3): handy for testing.
    settings: urlSettings(),
    budget: { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 131072 },
    match: { phase: 'lobby', n: 0, id: '', seed: 0, min: 1, participants: [] },
    get isHost() {
      return true;
    },
    get online() {
      return [me];
    },
    get participants() {
      return room.match.phase === 'playing' ? [me] : [];
    },
    get spectators() {
      return [];
    },
    get spectating() {
      return false;
    },
    get running() {
      return room.match.phase === 'playing' && !pausedAt;
    },
    get notReady() {
      return [];
    },
    get allReady() {
      return true;
    },
    get canStart() {
      return true;
    },
    get private() {
      return priv[me.id] ?? {};
    },
    isParticipant: (id) => room.match.phase === 'playing' && id === me.id,
    matchNow: () => (started ? (pausedAt || Date.now()) - started : 0),
    send() {},
    setPresence(d) {
      me.presence = d;
      const h = hist.get(me.id) ?? [];
      h.push([Date.now(), d]);
      if (h.length > 6) h.shift();
      hist.set(me.id, h);
      emit('presence', me);
    },
    presenceAt: (id) => room.players.get(id)?.presence ?? null,
    setState(k, v) {
      if (v === null || v === undefined) delete room.state[k];
      else room.state[k] = v;
      emit('state', k, v, me.id);
    },
    setPrivate(k, v) {
      priv[me.id] = { ...(priv[me.id] ?? {}) };
      if (v === null || v === undefined) delete priv[me.id][k];
      else priv[me.id][k] = v;
      emit('private', k, v, me.id);
    },
    setPrivateFor(id, k, v) {
      priv[id] = { ...(priv[id] ?? {}) };
      if (v === null || v === undefined) delete priv[id][k];
      else priv[id][k] = v;
      if (id === me.id) emit('private', k, v, id);
    },
    privateOf: (id) => priv[id] ?? {},
    setReady(r) {
      me.ready = !!r;
      if (r && room.match.phase === 'lobby') room.startMatch();
    },
    clearReady() {
      me.ready = false;
    },
    setSetting(id, v) {
      room.settings = { ...room.settings, [id]: v };
      emit('settings', room.settings);
    },
    hideLobby() {},
    admit() {},
    setOpen() {},
    kick() {},
    voteKick() {},
    reportResult() {},
    pauseMatch(p = true) {
      if (p && !pausedAt) pausedAt = Date.now();
      else if (!p && pausedAt) {
        started += Date.now() - pausedAt;
        pausedAt = 0;
      }
    },
    startMatch() {
      started = Date.now();
      n++;
      const prev = room.match;
      room.match = { phase: 'playing', n, id: `solo${n}-${Math.floor(Math.random() * 1e6)}`, seed: Math.floor(Math.random() * 2 ** 31), min: 1, participants: [me.id], startedAt: started };
      emit('match', room.match, prev);
      emit('matchstart', room.match);
    },
    endMatch() {
      started = 0;
      me.ready = false;
      const prev = room.match;
      room.match = { phase: 'lobby', n, id: prev.id, seed: prev.seed, min: 1, participants: [] };
      emit('match', room.match, prev);
      emit('matchend', room.match, prev);
    },
    leave() {
      emit('close', 'left');
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev)?.delete(fn);
    },
  };
  return room;
}

function standalone() {
  const store = {
    get(k) {
      try {
        const v = localStorage.getItem(`carnevale:${k}`);
        return v ? JSON.parse(v) : null;
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`carnevale:${k}`, JSON.stringify(v));
      } catch {}
    },
    del(k) {
      try {
        localStorage.removeItem(`carnevale:${k}`);
      } catch {}
    },
  };
  let id = store.get('guest-id');
  if (typeof id !== 'string') {
    id = `local-${Math.random().toString(36).slice(2, 10)}`;
    store.set('guest-id', id);
  }
  const player = { id, name: 'You', guest: true };
  const listeners = new Map();
  return {
    mode: 'standalone',
    env: {},
    player: { get: async () => player, rename: async () => null, avatarUrl: async () => null },
    save: { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v), delete: async (k) => store.del(k), list: async () => [] },
    badges: { award: async () => false, list: async () => [], has: async () => false },
    leaderboards: { submit: async () => null, top: async () => ({ entries: [], me: null }) },
    rooms: { join: async () => soloRoom(player), on: () => () => {}, current: null },
    ui: { setMenuPosition() {}, requestFullscreen() {}, showInvite() {}, setOrientation() {} },
    controls: { set() {}, stick: { x: 0, y: 0 }, pressed: () => false, touch: false },
    settings: { quality: 'high', choice: 'auto', scale: 1, reducedMotion: false, pixelRatio: (cap = 2) => Math.min(window.devicePixelRatio || 1, cap), on: () => () => {} },
    now: () => Date.now(),
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
  };
}

export const ow = typeof window !== 'undefined' && window.onceworlds ? window.onceworlds : standalone();
export const onPlatform = () => safe(() => ow.mode !== 'standalone', false);
export const now = () => safe(() => ow.now(), Date.now());

/** The settings the platform's lobby card draws; the host picks, everyone sees. */
export const LOBBY_SETTINGS = [
  { id: 'mode', label: 'Mode', options: [{ value: 'masq', label: 'Masquerade' }, { value: 'spot', label: 'Spot the Mask' }], default: 'masq' },
  { id: 'rounds', label: 'Rounds', options: [1, 3, 5], default: 3 },
  { id: 'length', label: 'Round', options: [{ value: 3, label: '3 min' }, { value: 5, label: '5 min' }, { value: 7, label: '7 min' }], default: 5 },
  { id: 'crowd', label: 'Crowd', options: [{ value: 'light', label: 'Light' }, { value: 'normal', label: 'Normal' }, { value: 'packed', label: 'Packed' }], default: 'normal' },
  { id: 'loadout', label: 'Loadouts', options: [{ value: 'standard', label: 'Standard' }, { value: 'chaos', label: 'Chaos' }], default: 'standard' },
  { id: 'bots', label: 'Bots', options: [{ value: 'adept', label: 'Adept' }, { value: 'novice', label: 'Novice' }, { value: 'master', label: 'Master' }, { value: 'off', label: 'Off' }], default: 'adept' },
];
export const JOIN = { mode: 'masque', maxPlayers: 10, minPlayers: 1, lobby: 'card', countdown: 0, settings: LOBBY_SETTINGS };

/** The settings as the match started with them, each checked against what the game offers. */
export function matchSettings(room) {
  const raw = safe(() => room.settings, {}) || {};
  const out = {};
  for (const s of LOBBY_SETTINGS) {
    const values = s.options.map((o) => (typeof o === 'object' ? o.value : o));
    out[s.id] = values.includes(raw[s.id]) ? raw[s.id] : s.default;
  }
  return out;
}

export const saves = {
  get: (k) => safe(() => ow.save.get(k), null, 'save.get'),
  set: (k, v) => safe(() => ow.save.set(k, v), null, 'save.set'),
};
export const badge = (id) => safe(() => ow.badges.award(id), false, 'badge');
export const submitScore = (board, v, opts) => safe(() => ow.leaderboards.submit(board, v, opts), null, 'leaderboard');
export const controls = (spec) => safe(() => ow.controls.set(spec), null, 'controls');
export const touchMode = () => safe(() => !!ow.controls.touch, false);
export const pressed = (id) => safe(() => !!ow.controls.pressed(id), false);
export const showInvite = () => safe(() => ow.ui.showInvite(), null, 'invite');
export const avatarUrl = (id) => safe(() => ow.player.avatarUrl(id, 'head'), null, 'avatar');
export const settings = () => safe(() => ow.settings, null) || { quality: 'high', choice: 'auto', reducedMotion: false, scale: 1, pixelRatio: (c = 2) => Math.min(window.devicePixelRatio || 1, c) };
export const pixelRatio = (cap = 2) => safe(() => ow.settings.pixelRatio(cap), Math.min(window.devicePixelRatio || 1, cap));
export const reducedMotion = () => safe(() => !!ow.settings.reducedMotion, false);
export const onPlatformEvent = (ev, fn) => safe(() => ow.on(ev, fn), null, `on ${ev}`);
export const onSettings = (fn) => safe(() => ow.settings.on('change', fn), null, 'settings.on');

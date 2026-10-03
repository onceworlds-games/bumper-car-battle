// Keys, mouse and touch. Held keys clear when the window loses focus or hides; presses ignore key repeat; a click
// is a click only if the pointer barely moved (else it was a drag that orbits the camera); two fingers pinch to zoom.
// The touch controls the platform draws press keys here like a keyboard does.

const GAME_KEYS = new Set(['tab', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

export function createInput(target) {
  const held = new Set();
  const handlers = { press: [], release: [], tap: [], orbit: [], zoom: [], hover: [] };
  const emit = (k, ...a) => {
    for (const fn of handlers[k]) {
      try {
        fn(...a);
      } catch (e) {
        console.warn('[carnevale] input', e?.message ?? e);
      }
    }
  };
  const norm = (e) => {
    const k = (e.key || '').toLowerCase();
    if (k === 'shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'shift';
    if (k === 'spacebar') return ' ';
    return k;
  };
  let enabled = true;
  const onKeyDown = (e) => {
    const k = norm(e);
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (GAME_KEYS.has(k) && enabled) e.preventDefault();
    if (e.repeat) return;
    held.add(k);
    if (enabled) emit('press', k, e);
  };
  const onKeyUp = (e) => {
    const k = norm(e);
    const had = held.delete(k);
    if (had) emit('release', k, e);
  };
  const clearAll = () => {
    for (const k of [...held]) {
      held.delete(k);
      emit('release', k, null);
    }
    pointers.clear();
    drag = null;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearAll);
  document.addEventListener('visibilitychange', () => document.hidden && clearAll());

  // ---- pointers ----
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  const onDown = (e) => {
    if (!enabled) return;
    target.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button, type: e.pointerType, moved: 0 });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 };
      drag = null;
    } else if (pointers.size === 1) drag = { id: e.pointerId };
  };
  const onMove = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') emit('hover', e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved = Math.max(p.moved, Math.hypot(p.x - p.sx, p.y - p.sy));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      if (pinch.d > 10 && d > 10) emit('zoom', pinch.d / d);
      emit('orbit', (mx - pinch.mx) * 0.006, 0);
      pinch.d = d;
      pinch.mx = mx;
      return;
    }
    // Left-drag on touch or with the mouse, right- or middle-drag with the mouse: all orbit.
    if (drag && drag.id === e.pointerId && p.moved > 6) emit('orbit', -dx * 0.0055, dy * 0.004);
  };
  const onUp = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!p) return;
    if (drag?.id === e.pointerId) drag = null;
    const quick = performance.now() - p.t < 450;
    if (p.moved < 9 && quick && (p.button === 0 || p.type !== 'mouse') && enabled) emit('tap', e.clientX, e.clientY, p.type);
  };
  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    pinch = null;
    drag = null;
  });
  target.addEventListener('contextmenu', (e) => e.preventDefault());
  target.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (enabled) emit('zoom', Math.exp(Math.max(-1, Math.min(1, e.deltaY * 0.0015))));
    },
    { passive: false },
  );

  return {
    held,
    down: (k) => held.has(k),
    on(kind, fn) {
      handlers[kind].push(fn);
    },
    set enabled(v) {
      enabled = !!v;
      if (!enabled) clearAll();
    },
    get enabled() {
      return enabled;
    },
    clear: clearAll,
  };
}

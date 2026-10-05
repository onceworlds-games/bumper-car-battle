// Steering and the boost button, from the keyboard and the platform's on-screen controls.
// Keys: W/A/S/D and the arrows drive (up/down forward and back, left/right turn), Space boosts.
// The stick (analog) says where to go; the Boost button presses Space too, and is read as a button as well.

const KEYS = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

export function createInput(ow) {
  const held = { up: false, down: false, left: false, right: false };
  let boostAt = -1e9; // when boost was last asked for (performance.now)
  let wasBoost = false;
  let lastKey = -1e9;
  let usedKeys = false; // a keyboard player (for the one-time Space hint)
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function askBoost() {
    const t = now();
    if (t - boostAt < 80) return; // a key and the button saying the same thing
    boostAt = t;
  }

  function onKeyDown(e) {
    const dir = KEYS[e.code];
    if (dir) {
      held[dir] = true;
      usedKeys = true;
      lastKey = now();
      e.preventDefault();
    } else if (e.code === 'Space') {
      if (!e.repeat) askBoost();
      e.preventDefault();
    }
  }
  function onKeyUp(e) {
    const dir = KEYS[e.code];
    if (dir) held[dir] = false;
  }
  function clear() {
    held.up = held.down = held.left = held.right = false;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => document.hidden && clear());
  }

  return {
    /**
     * The driving input of the player, written into `out`: { aim, steer, thr, mag } (see sim.stepCar). The stick wins while it is held.
     */
    drive(out) {
      const st = ow.controls && ow.controls.stick;
      const sx = st && Number.isFinite(st.x) ? st.x : 0;
      const sy = st && Number.isFinite(st.y) ? st.y : 0;
      const m = Math.hypot(sx, sy);
      if (m > 0.16) {
        const mag = Math.min(1, (m - 0.1) / 0.7);
        out.aim = Math.atan2(sy, sx);
        out.steer = 0;
        out.thr = mag;
        out.mag = mag;
        out.gm = mag;
        out.dx = sx / m;
        out.dy = sy / m;
        return out;
      }
      out.aim = null;
      out.steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      out.thr = (held.up ? 1 : 0) - (held.down ? 1 : 0);
      // Steering with no pedal still rolls forward: a car that only spins on the spot looks broken to a kid.
      if (out.thr === 0 && out.steer !== 0) out.thr = 0.55;
      out.mag = Math.abs(out.thr);
      out.dx = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      out.dy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      const l = Math.hypot(out.dx, out.dy);
      out.gm = l > 0 ? 1 : 0;
      if (l > 0) {
        out.dx /= l;
        out.dy /= l;
      }
      return out;
    },

    /** Call once a frame: notices the on-screen Boost button's press even if its key event was missed. */
    poll() {
      const down = Boolean(ow.controls && ow.controls.pressed && ow.controls.pressed('boost'));
      if (down && !wasBoost) askBoost();
      wasBoost = down;
    },

    /** Boost was asked for in the last quarter second and not used yet. */
    wantsBoost() {
      return now() - boostAt < 250;
    },
    useBoost() {
      boostAt = -1e9;
    },
    /** A keyboard player: the Space hint is for them. */
    get keyboard() {
      return usedKeys && !(ow.controls && ow.controls.touch);
    },
    get lastKeyAt() {
      return lastKey;
    },
  };
}

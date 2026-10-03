// Seeded randomness: the same numbers on every page and in Node. Integer maths only, so every engine agrees.

/** A 32-bit hash of any mix of strings and numbers (FNV-1a, then a murmur3 finish). */
export function hash32(...parts) {
  let h = 0x811c9dc5 | 0;
  for (const part of parts) {
    const s = typeof part === 'string' ? part : String(Number.isFinite(part) ? part : 0);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A small seeded generator (mulberry32) with the helpers the game uses. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    /** A float in [lo, hi). */
    range: (lo, hi) => lo + (hi - lo) * next(),
    /** An integer in [0, n). */
    int: (n) => Math.floor(next() * Math.max(1, n)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** A weighted pick: `weights` is a list of numbers matching `list`. */
    weighted(list, weights) {
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return list[0];
      let x = next() * total;
      for (let i = 0; i < list.length; i++) {
        x -= Math.max(0, weights[i]);
        if (x < 0) return list[i];
      }
      return list[list.length - 1];
    },
    /** Shuffles a copy. */
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
    /** A normally distributed number (Box-Muller). */
    gauss(mean = 0, sd = 1) {
      const u = Math.max(1e-9, next());
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return r;
}

/** A deterministic float in [0, 1) for a key, without keeping a generator. */
export function unit(...parts) {
  return hash32(...parts) / 4294967296;
}

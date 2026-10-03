// The WebGL renderer: crisp at any pixel ratio, adaptive quality (the platform's Graphics choice is the ceiling, and
// with Auto this measures its own frame times), resize, a lost context that comes back, and rendering paused while
// the tab is hidden. High: shadows, bloom and grade. Medium: smaller shadows. Low: neither.
import * as THREE from 'three';
import { settings, onSettings, pixelRatio } from '../platform.js';
import { createPost } from './post.js';

const LEVELS = ['low', 'medium', 'high'];

export function createRenderer(canvas) {
  const choice = () => {
    const s = settings();
    return s && LEVELS.includes(s.choice) ? s.choice : 'auto';
  };
  // A phone starts a step down and earns the high tier by running smoothly; a laptop starts at the top.
  const coarse = (() => {
    try {
      return !!window.matchMedia?.('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  })();
  let level = choice() === 'auto' ? (coarse ? 'medium' : 'high') : choice();
  // ?quality= is for trying the tiers by hand (and for the store art).
  const forced = new URLSearchParams(location.search).get('quality');
  if (LEVELS.includes(forced)) level = forced;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x12263a, 1);
  let post = null;
  let postBroken = false;
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    post = null;
    api.onRestore?.();
  });
  const size = { w: 1, h: 1, pr: 1 };
  const resize = () => {
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    const scale = level === 'low' ? 0.7 : level === 'medium' ? 0.85 : 1;
    const pr = Math.max(0.5, Math.min(pixelRatio(2), 2) * scale);
    if (w === size.w && h === size.h && Math.abs(pr - size.pr) < 0.01) return;
    size.w = w;
    size.h = h;
    size.pr = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    post?.setSize(w, h, pr);
    api.onResize?.(w, h);
  };
  // A window dragged to a new size sends a resize per mouse move: one resize per frame is plenty.
  let resizing = false;
  const soon = () => {
    if (resizing) return;
    resizing = true;
    requestAnimationFrame(() => {
      resizing = false;
      resize();
    });
  };
  window.addEventListener('resize', soon);
  window.visualViewport?.addEventListener?.('resize', soon);
  /** Shadows follow the tier; the stage tells the materials so they recompile once. */
  const shadows = () => {
    renderer.shadowMap.enabled = level !== 'low';
    renderer.shadowMap.type = THREE.PCFShadowMap;
  };
  const applyTier = () => {
    shadows();
    if (level !== 'high' && post) {
      post.dispose();
      post = null;
    }
    resize();
    api.onQuality?.(level);
  };
  // The governor: frame times over a few seconds; step down fast, step up slowly.
  const times = [];
  let calmUntil = 0;
  const setLevel = (l) => {
    if (l === level) return;
    level = l;
    applyTier();
  };
  onSettings(() => {
    const c = choice();
    if (c !== 'auto') setLevel(c);
    else resize();
  });
  const api = {
    renderer,
    size,
    grain: 1, // the film grain's strength (the store art asks for less)
    get level() {
      return level;
    },
    get lost() {
      return lost;
    },
    resize,
    /** Draws the frame: through the bloom and the grade at the high tier, straight to the screen below it. */
    render(scene, camera, time, night, reduced) {
      if (level === 'high' && !postBroken) {
        try {
          if (!post) post = createPost(renderer, scene, camera);
          post.draw(time, night, reduced, api.grain);
          return;
        } catch (e) {
          // No half-float targets here: the plain picture will do.
          postBroken = true;
          post = null;
          console.warn('[carnevale] post', e?.message ?? e);
        }
      }
      renderer.render(scene, camera);
    },
    /** Feeds one frame's duration (ms) to the governor. */
    frame(ms, nowMs) {
      if (choice() !== 'auto' || document.hidden) return;
      times.push(Math.min(ms, 200));
      if (times.length < 90) return;
      const sorted = [...times].sort((a, b) => a - b);
      const p80 = sorted[Math.floor(sorted.length * 0.8)];
      times.length = 0;
      const i = LEVELS.indexOf(level);
      if (p80 > 24 && i > 0) {
        setLevel(LEVELS[i - 1]);
        calmUntil = nowMs + 20000;
      } else if (p80 < 13 && i < LEVELS.length - 1 && nowMs > calmUntil) {
        setLevel(LEVELS[i + 1]);
        calmUntil = nowMs + 30000;
      }
    },
  };
  shadows();
  resize();
  return api;
}

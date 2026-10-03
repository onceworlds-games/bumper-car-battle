// The stage: one scene with its sky, the current plaza, every figure and the effects, rendered through the chase
// camera. Swapping plazas disposes the old one.
import * as THREE from 'three';
import { createRenderer } from './renderer.js';
import { createSky } from './sky.js';
import { createFigures } from './figures.js';
import { createCamera } from './camera.js';
import { buildPlaza } from './plaza3d.js';
import { createFx } from './fx.js';
import { reducedMotion } from '../platform.js';

export function createStage(canvas) {
  const R = createRenderer(canvas);
  const scene = new THREE.Scene();
  const sky = createSky(scene);
  const figures = createFigures(scene);
  const camera = createCamera();
  const fx = createFx(scene);
  let built = null;
  let plaza = null;
  R.onResize = (w, h) => camera.aspect(w, h);
  camera.aspect(R.size.w, R.size.h);
  const stage = {
    R,
    scene,
    sky,
    figures,
    camera,
    fx,
    get plaza() {
      return plaza;
    },
    setPlaza(p) {
      if (plaza && plaza.id === p.id) return;
      built?.dispose();
      plaza = p;
      built = buildPlaza(scene, p);
      fx.clear();
      stage.compile();
    },
    /** Compiles every shader up front so the first frames don't stall (iPhones especially). */
    compile() {
      try {
        R.renderer.compile(scene, camera.cam);
      } catch {}
    },
    /** One frame: hour of the night u (0..1), the clock (0..1 to midnight), seconds. */
    render(time, u, clockU) {
      if (R.lost) return;
      sky.set(u, time);
      sky.follow(camera.st.tx, camera.st.tz);
      figures.setNight(u, sky);
      if (built) {
        built.update(time, u, camera.cam.position, clockU);
        built.setSky(sky);
      }
      fx.update(time, camera.cam.position);
      R.render(scene, camera.cam, time, u, reducedMotion());
    },
  };
  /** The tier decides the shadows: none, a small map, or a large one. Materials recompile once for the change. */
  const tier = (level) => {
    fx.setLevel(level);
    figures.setTier(level);
    const on = level !== 'low';
    const px = level === 'high' ? 2048 : 1024;
    sky.sun.castShadow = on;
    if (sky.sun.shadow.mapSize.x !== px) {
      sky.sun.shadow.mapSize.set(px, px);
      sky.sun.shadow.map?.dispose();
      sky.sun.shadow.map = null;
    }
    scene.traverse((o) => {
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  };
  R.onQuality = tier;
  tier(R.level);
  return stage;
}

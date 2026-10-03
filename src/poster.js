// Poster mode (?poster=thumb1|thumb2|thumb3|thumb4|icon|badge-<id>): the game's own renderer drawing a composed,
// deterministic scene for the store, with no platform and no network. Sets window.__posterReady when it's drawn.
import { createStage } from './render/stage.js';
import { createCrowd } from './sim/crowd.js';
import { PLAZAS } from './sim/plazas.js';
import { drawFigures } from './game/view.js';

export function runPoster(kind) {
  const canvas = document.getElementById('scene');
  const stage = createStage(canvas);
  const plaza = PLAZAS[0];
  stage.setPlaza(plaza);
  const crowd = createCrowd(plaza, 7, 9);
  let frames = 0;
  const loop = () => {
    const t = 40 + frames * 0.016;
    const buf = crowd.eval(t, Infinity);
    const c = stage.camera;
    c.st.yaw = 0.8;
    c.st.pitch = 0.4;
    c.st.dist = 20;
    c.update(0.5, -4, 0, 0, plaza, {});
    drawFigures(stage, { time: t, crowd, buf, skip: null, plaza, cam: { x: c.cam.position.x, z: c.cam.position.z, fx: -4, fz: 0 } });
    stage.render(t, 0.3, 0.5);
    if (++frames > 3) window.__posterReady = true;
    if (frames < 400) requestAnimationFrame(loop);
  };
  void kind;
  requestAnimationFrame(loop);
}

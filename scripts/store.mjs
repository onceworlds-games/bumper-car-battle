// Store art, captured from the game's own renderer (?poster=...) in headless Chrome on the machine's GPU, at the
// high quality tier. Writes store/thumb-*.png, store/icon.png and store/badges/*.png.
//   npm run build && npm run store            (all of it)
//   npm run store -- thumb2                    (just the shots whose name contains "thumb2")
import { writeFileSync, mkdirSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';
import { BADGES } from '../src/ui/badgeart.js';

const SHOTS = [
  ['thumb1', 1280, 720, 'store/thumb-1.png'],
  ['thumb2', 1280, 720, 'store/thumb-2.png'],
  ['thumb3', 1280, 720, 'store/thumb-3.png'],
  ['thumb4', 1280, 720, 'store/thumb-4.png'],
  ['icon', 512, 512, 'store/icon.png'],
  ...BADGES.map((b) => [`badge-${b.id}`, 256, 256, `store/badges/${b.id}.png`]),
];

const only = process.argv[2];
mkdirSync('store/badges', { recursive: true });
const { server, port } = await serve('dist');
const b = await launch({ width: 1280, height: 720, gpu: process.env.SOFTWARE_GL ? false : true });
try {
  for (const [kind, w, h, out] of SHOTS) {
    if (only && !kind.includes(only) && !out.includes(only)) continue;
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: kind.startsWith('badge') ? 0 : 1 } });
    await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?poster=${kind}&quality=high` });
    let ok = false;
    for (let i = 0; i < 300 && !ok; i++) {
      await sleep(100);
      ok = (await b.evaluate('window.__posterReady === true')) === true;
    }
    await sleep(kind.startsWith('badge') ? 150 : 600);
    const r = await b.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(out, Buffer.from(r.result.data, 'base64'));
    console.log(ok ? 'saved' : 'TIMEOUT', out);
  }
} finally {
  b.close();
  server.close();
}

// npm run smoke [seconds]: builds nothing; serves dist/ standalone, lets the test autopilot (?test=auto) enter, ready up,
// walk, greet and unmask for a while, prints the game's state every few seconds and fails on any uncaught error.
// GPU=1 uses the machine's GPU instead of software GL.
import { serve, launch, sleep } from './cdp.mjs';

const secs = Number(process.argv[2] || 90);
const dist = new URL('../dist/', import.meta.url).pathname;
const { server, port } = await serve(dist);
const b = await launch({ width: 1100, height: 720, gpu: !!process.env.GPU });
const errors = [];
b.on((m) => {
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
});
let last = null;
try {
  await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=auto` });
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) {
    await sleep(5000);
    last = await b.evaluate('window.__cv ? window.__cv.state() : null');
    const own = await b.evaluate('window.__cv ? window.__cv.errors.slice() : []');
    for (const e of own ?? []) if (!errors.includes(e)) errors.push(e);
    if (last) console.log(`${Math.round((Date.now() - t0) / 1000)}s ${last.phase} ${last.stage ?? '-'} poise ${last.poise ?? '-'} events ${last.events} quality ${last.quality}`);
    else console.log('waiting for the game');
  }
} finally {
  b.close();
  server.close();
}
if (!last) errors.push('the game never started');
else if (!last.rid) errors.push('no round began');
if (errors.length) {
  console.log(`FAIL\n${[...new Set(errors)].slice(0, 12).join('\n')}`);
  process.exit(1);
}
console.log('OK: no errors');

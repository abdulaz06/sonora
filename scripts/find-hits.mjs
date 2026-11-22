// List the moments Ink lands a hit of a band (threshold + cooldown as in ink.ts),
// e.g. to cut a clip of a highlight hit landing.
//   node scripts/find-hits.mjs <track> <band: bass|mid|high> [from] [to]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';

const [track = 'ref-song', band = 'high', from = '0', to = '60'] = process.argv.slice(2);
const TH = { bass: [0.4, 0.13], mid: [0.45, 0.1], high: [0.4, 0.07] }[band];
const server = spawn('npx', ['vite', '--port', String(process.env.SONORA_HARNESS_PORT || 5199), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${process.env.SONORA_HARNESS_PORT || 5199}/web.html`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage();
  await p.goto(`http://localhost:${process.env.SONORA_HARNESS_PORT || 5199}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
  await p.waitForFunction(() => window.__sonora?.ready === true);
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  await p.evaluate((s) => window.__sonora.analyseOnly(s), Number(to));
  const log = await p.evaluate(() => window.__sonora.hitLog());
  let cd = 0;
  const out = [];
  for (const h of log) {
    cd -= 1 / 60;
    if (h[band] > TH[0] && cd <= 0) { cd = TH[1]; if (h.t >= Number(from)) out.push(`${h.t.toFixed(3)} (${h[band].toFixed(2)})`); }
  }
  console.log(`${track} ${band} hits ${from}-${to} s: ${out.join(', ')}`);
  await b.close();
} finally { kill(); }

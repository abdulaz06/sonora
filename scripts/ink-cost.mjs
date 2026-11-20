// Synced frame cost (step + GPU sync) for Ink, previous behaviour vs fix,
// interleaved and repeated (single readings swing with GPU clocks).
//   node scripts/ink-cost.mjs [--rounds 4] [--quality medium] [--size 1920x1080]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';

const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const rounds = Number(arg('--rounds', '4'));
const quality = arg('--quality', 'medium');
const [W, H] = arg('--size', '1920x1080').split('x').map(Number);
const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch('http://localhost:5199/web.html')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await p.goto('http://localhost:5199/web.html?harness=1');
  await p.waitForFunction(() => window.__sonora?.ready === true);
  const res = {};
  for (let r = 0; r < rounds; r++) {
    for (const look of ['glow', 'marble', 'sumi']) for (const view of ['flat', 'depth']) for (const legacy of [false]) {
      await p.evaluate((c) => window.__sonora.configure(c), { style: 'ink', variant: look, depth: view === 'depth', quality, palette: 0, drift: false, debug: { inkExp: {} } });
      if (r === 0 && look === 'glow' && view === 'flat' && !legacy) { await p.evaluate(() => window.__sonora.loadTrack('house-124')); await p.evaluate(() => window.__sonora.analyseOnly(48)); }
      const ms = await p.evaluate(() => window.__sonora.frameCost(120, 1 / 60));
      (res[`${look} ${view} ${legacy ? 'before' : 'after'}`] ??= []).push(ms);
    }
  }
  for (const [k, v] of Object.entries(res)) {
    const s = [...v].sort((x, y) => x - y);
    console.log(`${k.padEnd(20)} min ${s[0].toFixed(2)} ms  median ${s[Math.floor(s.length / 2)].toFixed(2)} ms  (${v.map((x) => x.toFixed(2)).join(', ')})`);
  }
  await b.close();
} finally { kill(); }

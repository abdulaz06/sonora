// Dev helper: save every frame from 2 frames before a kick to ~150 ms after.
// node scripts/kick-frames.mjs <style> <look> <track> [kickIndex] [outDir]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const [style, look, track = 'house-124', ki = '40', out = 'verify/kick-frames'] = process.argv.slice(2);
const meta = JSON.parse(readFileSync('test-audio/tracks.json', 'utf8'))[track];
const kick = meta.kicks[Number(ki)];
const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch('http://localhost:5199/web.html')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.goto('http://localhost:5199/web.html?harness=1');
  await p.waitForFunction(() => window.__sonora?.ready === true);
  await p.evaluate(([s, v]) => window.__sonora.configure({ style: s, variant: v, drift: false }), [style, look]);
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  await p.evaluate((s) => window.__sonora.analyseOnly(s), kick - 6);
  await p.evaluate(() => window.__sonora.advance(6 - 2 / 60, 1 / 60));
  mkdirSync(out, { recursive: true });
  for (let f = 0; f < 12; f++) {
    await p.evaluate(() => window.__sonora.advance(1 / 60, 1 / 60));
    const url = await p.evaluate(() => window.__sonora.snapshot());
    writeFileSync(`${out}/${String(f).padStart(2, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`kick at ${kick.toFixed(3)} s → ${out}`);
  await b.close();
} finally { kill(); }

// Dev helper: save a run of frames (every `step` frames at 60 fps) from a track
// time, e.g. to measure motion against a reference video.
// node scripts/frame-seq.mjs <style> <look|-> <track> <startSeconds> <seconds> [flat|depth] [step] [outDir]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const [style, lookArg = '-', track = 'house-124', t0 = '20', secs = '6', view = 'flat', stepArg = '1', outArg] = process.argv.slice(2);
const look = lookArg === '-' ? undefined : lookArg;
const step = Number(stepArg);
const out = outArg ?? `verify/frame-seq/${style}-${lookArg}-${view}-${track}-${t0}`;
const W = Number(process.env.SEQ_W || 960), H = Number(process.env.SEQ_H || 540);

const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch('http://localhost:5199/web.html')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.goto('http://localhost:5199/web.html?harness=1');
  await p.waitForFunction(() => window.__sonora?.ready === true);
  await p.evaluate(([s, v, d]) => window.__sonora.configure({ style: s, variant: v, depth: d, drift: false }), [style, look, view === 'depth']);
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  const start = Number(t0);
  await p.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 8));
  await p.evaluate((s) => window.__sonora.advance(s, 1 / 60), Math.min(8, start));
  mkdirSync(out, { recursive: true });
  const n = Math.round((Number(secs) * 60) / step);
  for (let f = 0; f < n; f++) {
    await p.evaluate((k) => window.__sonora.advance(k / 60, 1 / 60), step);
    const url = await p.evaluate(() => window.__sonora.snapshot());
    writeFileSync(`${out}/f${String(f).padStart(5, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`${n} frames (every ${step}) from ${start}s → ${out}`);
  await b.close();
} finally { kill(); }

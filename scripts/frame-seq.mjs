// Dev helper: save a run of frames from a track time, e.g. to measure motion
// against a reference video, or to compare render rates (dt sweep).
// node scripts/frame-seq.mjs <style> <look|-> <track> <startSeconds> <seconds> [flat|depth] [step] [outDir]
//   step = save every `step` rendered frames.
// Env: SEQ_W / SEQ_H (viewport, default 960x540), SEQ_FPS (render steps per
// second, default 60; the warm-up renders at the same rate), SEQ_QUALITY,
// SEQ_PALETTE, SEQ_CAMERA, SEQ_RESP, SEQ_DEBUG (JSON debug flags, e.g.
// '{"inkExp":{"veins":0}}'), SEQ_WARMUP (seconds rendered before the start, default 8),
// SEQ_JPG=1 (JPEG frames, quality 0.95: videos).
// Run from another checkout (e.g. a baseline worktree) to render that code.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const [style, lookArg = '-', track = 'house-124', t0 = '20', secs = '6', view = 'flat', stepArg = '1', outArg] = process.argv.slice(2);
const look = lookArg === '-' ? undefined : lookArg;
const step = Number(stepArg);
const fps = Number(process.env.SEQ_FPS || 60);
const dt = 1 / fps;
const out = outArg ?? `verify/frame-seq/${style}-${lookArg}-${view}-${track}-${t0}${fps !== 60 ? `-${fps}fps` : ''}`;
const W = Number(process.env.SEQ_W || 960), H = Number(process.env.SEQ_H || 540);
const warmup = Number(process.env.SEQ_WARMUP ?? 8);
const jpg = process.env.SEQ_JPG === '1';
const cfg = {
  style, variant: look, depth: view === 'depth', drift: false,
  quality: process.env.SEQ_QUALITY || undefined,
  palette: process.env.SEQ_PALETTE !== undefined ? Number(process.env.SEQ_PALETTE) : undefined,
  camera: process.env.SEQ_CAMERA || undefined,
  responsiveness: process.env.SEQ_RESP !== undefined ? Number(process.env.SEQ_RESP) : undefined,
  debug: process.env.SEQ_DEBUG ? JSON.parse(process.env.SEQ_DEBUG) : undefined,
};

const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch('http://localhost:5199/web.html')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log('  [page exception]', e.message));
  await p.goto('http://localhost:5199/web.html?harness=1');
  await p.waitForFunction(() => window.__sonora?.ready === true);
  await p.evaluate((c) => window.__sonora.configure(c), cfg);
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  const start = Number(t0);
  const warm = Math.min(warmup, start);
  await p.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - warm));
  // Warm up in whole steps of dt so every render rate starts at the same audio time.
  const warmSteps = Math.round(warm * fps);
  for (let k = 0; k < warmSteps; k += 120) await p.evaluate(([n, d]) => window.__sonora.advance(n * d, d), [Math.min(120, warmSteps - k), dt]);
  mkdirSync(out, { recursive: true });
  const n = Math.round((Number(secs) * fps) / step);
  for (let f = 0; f < n; f++) {
    await p.evaluate(([k, d]) => window.__sonora.advance(k * d, d), [step, dt]);
    const url = await p.evaluate((jpg) => (jpg ? window.__sonora.snapshot('image/jpeg', 0.95) : window.__sonora.snapshot()), jpg);
    writeFileSync(`${out}/f${String(f).padStart(5, '0')}.${jpg ? 'jpg' : 'png'}`, Buffer.from(url.split(',')[1], 'base64'));
  }
  writeFileSync(`${out}/seq.json`, JSON.stringify({ style, look, track, start, secs: Number(secs), view, step, fps, W, H, cfg }, null, 1));
  console.log(`${n} frames (every ${step} at ${fps} fps) from ${start}s → ${out}`);
  await b.close();
} finally { kill(); }

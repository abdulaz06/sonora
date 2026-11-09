#!/usr/bin/env node
// Verification harness: renders a style against a generated test track in a
// real browser (WebGL on the GPU), deterministically in audio time, and saves
// screenshots at the track's markers plus an 8-frame strip over 1 s around
// the drop. Also measures real-time FPS at the drop.
//
//   npm run verify -- --style flow-ink --variant ink --track house-124
//   npm run verify -- --variant sumi --flat --light light --track all
//
// Options
//   --style <id>        style id (default flow-ink)
//   --variant <id>      variant id (default: style default)
//   --track <name|all>  test track (default house-124)
//   --flat              Flat view instead of Depth
//   --light <auto|dark|light>
//   --quality <low|medium|high>   (default medium)
//   --palette <n>       palette index (default 0)
//   --size <WxH>        viewport (default 1920x1080)
//   --fps <n>           render steps per audio second (default 60)
//   --warmup <s>        seconds rendered before each marker (default 14)
//   --out <dir>         output dir (default verify/<style>-<variant>-<view>[-light]/<track>)
//   --headed            show the browser
//   --no-bench          skip the FPS measurement

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const BENCH_SECONDS = 6;

function parseArgs(argv) {
  const o = { style: 'flow-ink', variant: '', track: 'house-124', flat: false, light: 'auto', quality: 'medium',
    palette: 0, size: '1920x1080', fps: 60, warmup: 14, out: '', headed: false, bench: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--style') o.style = next();
    else if (a === '--variant') o.variant = next();
    else if (a === '--track') o.track = next();
    else if (a === '--flat') o.flat = true;
    else if (a === '--light') o.light = next();
    else if (a === '--quality') o.quality = next();
    else if (a === '--palette') o.palette = Number(next());
    else if (a === '--size') o.size = next();
    else if (a === '--fps') o.fps = Number(next());
    else if (a === '--warmup') o.warmup = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--headed') o.headed = true;
    else if (a === '--no-bench') o.bench = false;
  }
  return o;
}

async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`dev server did not start at ${url}`);
}

async function launchBrowser(headed) {
  const args = ['--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-gpu',
    '--use-angle=d3d11', '--enable-unsafe-swiftshader'];
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch({ channel, headless: !headed, args });
    } catch { /* try the next one */ }
  }
  throw new Error('No Chromium-based browser available (tried Edge, Chrome, bundled Chromium)');
}

const opts = parseArgs(process.argv.slice(2));
const [W, H] = opts.size.split('x').map(Number);

if (!existsSync(join(ROOT, 'test-audio', 'house-124.wav'))) {
  console.log('Generating test audio…');
  execFileSync('node', [join(ROOT, 'scripts', 'gen-test-audio.mjs')], { stdio: 'inherit' });
}
if (!existsSync(join(ROOT, 'src', 'audio', 'wasm-pkg', 'sonora_dsp_bg.wasm'))) {
  console.log('Building WASM…');
  execFileSync('npm', ['run', 'build:wasm'], { stdio: 'inherit', shell: true, cwd: ROOT });
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore' });
const cleanup = () => { try { if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else server.kill(); } catch { /* gone */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

try {
  await waitForServer(`http://localhost:${PORT}/web.html`);
  const browser = await launchBrowser(opts.headed);
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()); });
  page.on('pageerror', (e) => console.log('  [page exception]', e.message));
  await page.goto(`http://localhost:${PORT}/web.html?harness=1`);
  await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 30000 });

  const gpu = await page.evaluate(() => window.__sonora.gpu());
  const tracks = await page.evaluate(() => window.__sonora.tracks);
  const names = opts.track === 'all' ? Object.keys(tracks) : [opts.track];
  const view = opts.flat ? 'flat' : 'depth';
  const summary = [];
  console.log(`GPU: ${gpu}`);

  for (const name of names) {
    const meta = tracks[name];
    if (!meta) throw new Error(`unknown track ${name}`);
    const variant = opts.variant || '';
    const outDir = opts.out
      ? join(ROOT, opts.out, name)
      : join(ROOT, 'verify', `${opts.style}-${variant || 'default'}-${view}${opts.light !== 'auto' ? '-' + opts.light : ''}`, name);
    mkdirSync(outDir, { recursive: true });

    // Fresh page state per track
    await page.reload();
    await page.waitForFunction(() => window.__sonora?.ready === true);
    await page.evaluate((o) => window.__sonora.configure({
      style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality,
      palette: o.palette, drift: false,
    }), opts);
    await page.evaluate((n) => window.__sonora.loadTrack(n), name);

    const m = meta.markers;
    const shots = [
      ['1-silence', m.silence], ['2-fadein', m.fadeIn], ['3-build', m.build],
      ['4-drop', m.drop + 1.2], ['6-breakdown', m.breakdown],
    ].filter(([, t]) => t !== undefined).sort((a, b) => a[1] - b[1]);
    const stripStart = m.drop - 0.25;
    const dt = 1 / opts.fps;
    let t = 0;
    const t0 = Date.now();

    const goTo = async (target) => {
      const gap = target - t;
      if (gap <= 0) return;
      // Analyse quickly up to the warm-up window, then render through it.
      const quiet = Math.max(0, gap - opts.warmup);
      if (quiet > 0) await page.evaluate((s) => window.__sonora.analyseOnly(s), quiet);
      const render = gap - quiet;
      // Render in chunks to keep each evaluate short.
      let left = render;
      while (left > 1e-6) {
        const chunk = Math.min(left, 2);
        await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [chunk, dt]);
        left -= chunk;
      }
      t = target;
    };
    const save = async (file) => {
      const url = await page.evaluate(() => window.__sonora.snapshot());
      writeFileSync(join(outDir, file), Buffer.from(url.split(',')[1], 'base64'));
    };

    for (const [label, time] of shots) {
      if (label === '4-drop') {
        await goTo(stripStart);
        for (let i = 0; i < 8; i++) {
          await save(`5-drop-strip-${i}.png`);
          await goTo(stripStart + ((i + 1) * 1) / 8);
        }
      }
      await goTo(Math.max(time, t));
      await save(`${label}.png`);
    }
    const events = await page.evaluate(() => window.__sonora.events.map((e) => `${e.type}@${e.time.toFixed(2)}`));

    // Real-time FPS at the drop (wall clock, real rAF cadence).
    let fps = null;
    if (opts.bench) {
      await page.reload();
      await page.waitForFunction(() => window.__sonora?.ready === true);
      await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false }), opts);
      await page.evaluate((n) => window.__sonora.loadTrack(n), name);
      await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, m.drop - 1));
      fps = await page.evaluate((secs) => new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          const d = (now - last) / 1000;
          last = now;
          window.__sonora.advance(Math.min(d, 0.05), Math.min(d, 0.05));
          times.push(d * 1000);
          if (now - start < secs * 1000) requestAnimationFrame(tick);
          else {
            const sorted = [...times].sort((a, b) => a - b);
            resolve({ fps: times.length / ((now - start) / 1000), p95: sorted[Math.floor(sorted.length * 0.95)], frames: times.length });
          }
        };
        requestAnimationFrame(tick);
      }), BENCH_SECONDS);
    }
    const stats = await page.evaluate(() => window.__sonora.stats());
    const line = { track: name, outDir, events, fps, scene: `${stats.sceneWidth}x${stats.sceneHeight}`, quality: stats.quality.level, seconds: (Date.now() - t0) / 1000 };
    summary.push(line);
    console.log(`\n${name}: ${outDir}`);
    console.log(`  events: ${events.join(', ') || '(none)'}`);
    if (fps) console.log(`  fps: ${fps.fps.toFixed(1)} avg, p95 frame ${fps.p95.toFixed(1)} ms over ${fps.frames} frames (scene ${line.scene}, ${line.quality})`);
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ gpu, opts, ...line }, null, 2));
  }
  await browser.close();
  cleanup();
  process.exit(0);
} catch (err) {
  console.error(err);
  cleanup();
  process.exit(1);
}

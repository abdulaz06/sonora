#!/usr/bin/env node
// Verification harness: renders a style against a generated test track in a
// real browser (WebGL on the GPU), deterministically in audio time, and saves
// screenshots at the track's markers plus an 8-frame strip over 1 s around
// the drop. Also measures real-time FPS at the drop.
//
//   npm run verify -- --style ink --variant ink --track house-124
//   npm run verify -- --variant sumi --flat --light light --track all
//
// Options
//   --style <id>        style id (default ink)
//   --variant <id>      variant id (default: style default)
//   --track <name|all>  test track (default house-124)
//   --flat              Flat view instead of Depth
//   --light <auto|dark|light>
//   --quality <low|medium|high>   (default medium)
//   --palette <n>       palette index (default 0)
//   --size <WxH>        viewport (default 1920x1080)
//   --fps <n>           render steps per audio second (default 60)
//   --warmup <s>        seconds rendered before each marker (default 14)
//   --out <dir>         output dir (default verify/<style>[-<look>][-flat][-camera][-light]/<track>)
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
  const o = { style: 'ink', variant: '', track: 'house-124', flat: false, light: 'auto', quality: 'medium',
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
    else if (a === '--sync') o.sync = true;
    else if (a === '--camera') o.camera = next();
    else if (a === '--text') o.text = next();
    else if (a === '--resp') o.resp = Number(next());
    else if (a === '--flicker') o.flicker = true;
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

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' },
});
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

  if (opts.sync || opts.flicker) {
    for (const name of names) await (opts.flicker ? runFlicker : runSync)(page, tracks[name], name);
    await browser.close();
    cleanup();
    process.exit(0);
  }

  for (const name of names) {
    const meta = tracks[name];
    if (!meta) throw new Error(`unknown track ${name}`);
    const variant = opts.variant || '';
    const outDir = opts.out
      ? join(ROOT, opts.out, name)
      : join(ROOT, 'verify', `${opts.style}${variant && variant !== opts.style ? '-' + variant : ''}${opts.flat ? '-flat' : ''}${opts.camera ? '-' + opts.camera : ''}${opts.light !== 'auto' ? '-' + opts.light : ''}`, name);
    mkdirSync(outDir, { recursive: true });

    // Fresh page state per track
    await page.reload();
    await page.waitForFunction(() => window.__sonora?.ready === true);
    await page.evaluate((o) => window.__sonora.configure({
      style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality,
      palette: o.palette, drift: false, camera: o.camera, responsiveness: o.resp,
    }), opts);
    await page.evaluate((n) => window.__sonora.loadTrack(n), name);
    // Optional: grow a title out of the pattern right after the fade-in.
    if (opts.text) {
      await page.evaluate((s) => window.__sonora.analyseOnly(s), meta.markers.fadeIn + 1);
      await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [0.2, 1 / opts.fps]);
      await page.evaluate((t) => window.__sonora.seedText(t), opts.text);
    }

    const m = meta.markers;
    const shots = [
      ['1-silence', m.silence], ['2-fadein', m.fadeIn], ['3-build', m.build],
      ['4-drop', m.drop + 1.2], ['6-breakdown', m.breakdown],
      ...(opts.text ? [['2b-text', m.fadeIn + 5]] : []),
    ].filter(([, t]) => t !== undefined).sort((a, b) => a[1] - b[1]);
    const stripStart = m.drop - 0.25;
    const dt = 1 / opts.fps;
    let t = opts.text ? meta.markers.fadeIn + 1.2 : 0;
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
      await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false, responsiveness: o.resp }), opts);
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
    let frameCost = null;
    if (opts.bench) frameCost = await page.evaluate(() => window.__sonora.frameCost(180, 1 / 60));
    const stats = await page.evaluate(() => window.__sonora.stats());
    const line = { track: name, outDir, events, fps, frameCost, scene: `${stats.sceneWidth}x${stats.sceneHeight}`, quality: stats.quality.level, seconds: (Date.now() - t0) / 1000 };
    summary.push(line);
    console.log(`\n${name}: ${outDir}`);
    console.log(`  events: ${events.join(', ') || '(none)'}`);
    if (fps) console.log(`  fps: ${fps.fps.toFixed(1)} avg, p95 frame ${fps.p95.toFixed(1)} ms over ${fps.frames} frames (scene ${line.scene}, ${line.quality})`);
    if (frameCost !== null) console.log(`  frame cost (step + GPU sync): ${frameCost.toFixed(2)} ms  → ~${(1000 / frameCost).toFixed(0)} fps uncapped`);
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

// ── Flicker / exposure measurement ──────────────────────────────────
// Renders 12 s from just before the drop and reports:
//   swings/s  how often mean luminance jumps ≥ FLICKER_SWING above its
//             0.4 s running mean (beat pulses count; strobing scores high)
//   jitter    mean |frame-to-frame luminance change| / mean luminance
//   clip      mean / max fraction of blown-out pixels (any channel ≥ 250)
async function runFlicker(page, meta, name) {
  const FLICKER_SWING = 0.25;
  const start = name === 'silence-fadein' ? 26 : meta.markers.drop - 1;
  const len = 12;
  const dt = 1 / opts.fps;
  await page.reload();
  await page.waitForFunction(() => window.__sonora?.ready === true);
  await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false, camera: o.camera, responsiveness: o.resp }), opts);
  await page.evaluate((n) => window.__sonora.loadTrack(n), name);
  await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start), dt]);
  const { luma, clip } = await page.evaluate(([s, d]) => window.__sonora.exposureTrace(s, d), [len, dt]);
  let ema = luma[0], above = false, swings = 0, jit = 0;
  const k = 1 - Math.exp(-dt / 0.4);
  for (let i = 1; i < luma.length; i++) {
    const d = (luma[i] - ema) / Math.max(ema, 0.03);
    if (!above && d >= FLICKER_SWING) { swings++; above = true; } else if (d < FLICKER_SWING * 0.5) above = false;
    jit += Math.abs(luma[i] - luma[i - 1]);
    ema += (luma[i] - ema) * k;
  }
  const meanL = luma.reduce((a, b) => a + b, 0) / luma.length;
  const meanC = clip.reduce((a, b) => a + b, 0) / clip.length;
  const maxC = Math.max(...clip);
  console.log(`${name} [${opts.style}/${opts.variant || 'default'} p${opts.palette} r${opts.resp ?? 'def'}]: swings ${(swings / len).toFixed(2)}/s, jitter ${(100 * jit / Math.max(1, luma.length - 1) / Math.max(meanL, 0.01)).toFixed(1)}%, clip mean ${(100 * meanC).toFixed(1)}% max ${(100 * maxC).toFixed(1)}%, mean luma ${meanL.toFixed(3)}`);
}

// ── Beat-sync measurement ───────────────────────────────────────────
// Renders a window around the drop at the harness frame rate, records mean
// screen luminance per frame and scores how the picture responds to each
// known kick: rise = (peak in 0–133 ms after the kick − level just before) /
// level before. A kick counts as "seen" if the rise is ≥ SYNC_SEEN.
async function runSync(page, meta, name) {
  const SYNC_SEEN = 0.06;
  const kicks = meta.kicks ?? [];
  if (!kicks.length) { console.log(`${name}: no kicks, skipped`); return; }
  const start = name === 'silence-fadein' ? 26 : meta.markers.drop - 1;
  const len = 12;
  const dt = 1 / opts.fps;
  await page.reload();
  await page.waitForFunction(() => window.__sonora?.ready === true);
  await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false, camera: o.camera, responsiveness: o.resp }), opts);
  await page.evaluate((n) => window.__sonora.loadTrack(n), name);
  await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start), dt]);
  const luma = await page.evaluate(([s, d]) => window.__sonora.lumaTrace(s, d), [len, dt]);
  const rises = [];
  const lags = [];
  for (const k of kicks) {
    if (k < start + 0.1 || k > start + len - 0.2) continue;
    const i = Math.round((k - start) / dt);
    const before = (luma[i - 2] + luma[i - 1]) / 2;
    let peak = -1, at = 0;
    for (let j = 0; j <= Math.round(0.133 / dt); j++) if (luma[i + j] > peak) { peak = luma[i + j]; at = j; }
    // Paper looks darken on a hit, so score the largest change either way.
    let trough = Infinity;
    for (let j = 0; j <= Math.round(0.133 / dt); j++) trough = Math.min(trough, luma[i + j]);
    const up = (peak - before) / Math.max(before, 0.01);
    const down = (before - trough) / Math.max(before, 0.01);
    rises.push(Math.max(up, down));
    lags.push(at * dt * 1000);
  }
  const seen = rises.filter((r) => r >= SYNC_SEEN).length;
  const sorted = [...rises].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const meanLuma = luma.reduce((a, b) => a + b, 0) / luma.length;
  const meanLag = lags.reduce((a, b) => a + b, 0) / Math.max(1, lags.length);
  console.log(`${name} [${opts.variant || 'default'} ${opts.flat ? 'flat' : 'depth'}]: kicks ${rises.length}, seen ${seen} (${(100 * seen / Math.max(1, rises.length)).toFixed(0)}%), median rise ${(100 * median).toFixed(1)}%, peak lag ${meanLag.toFixed(0)} ms, mean luma ${meanLuma.toFixed(3)}`);
  const outDir = join(ROOT, 'verify', 'sync');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}-${opts.variant || 'default'}-${opts.flat ? 'flat' : 'depth'}.json`), JSON.stringify({ start, dt, kicks, luma, rises }, null, 1));
}

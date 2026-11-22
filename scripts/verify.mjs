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
//   --preview-cost      controller preview: frame cost with the tap off / every frame / every 2nd / 6th (D84)
//   --preview           with --pacing: the controller's preview tap runs at its real rate
//   --pacing            real-time frame pacing on the display (renderer's own rAF loop):
//                       interval mean / p99 and held frames per cap (match, 1/2, 60)
//   --dt-sweep          frame-rate independence (forwards to scripts/dt-sweep.mjs)
//   --palette-matrix    every palette × style / look / view + colour metrics (scripts/palette-matrix.mjs)
//   --filter <f>        filter over the style: glyph[:small|medium|large], reeded[:vertical|angled|radial][:fine|medium|wide]
//                       (same as SONORA_FILTER, which every harness script honours)

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// --palette-matrix has its own script (renders every palette × style / look / view).
if (process.argv.includes('--palette-matrix')) {
  const rest = process.argv.slice(2).filter((x) => x !== '--palette-matrix');
  const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'palette-matrix.mjs'), ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
// --dt-sweep has its own script (it renders each rate and runs the image metrics).
if (process.argv.includes('--dt-sweep')) {
  const rest = process.argv.slice(2).filter((x) => x !== '--dt-sweep');
  const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'dt-sweep.mjs'), ...rest], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SONORA_HARNESS_PORT || 5199);
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
    else if (a === '--pacing') o.pacing = true;
    else if (a === '--debug') o.debug = JSON.parse(next());
    else if (a === '--caps') o.caps = next();
    else if (a === '--seconds') o.seconds = Number(next());
    else if (a === '--preview') o.preview = true;
    else if (a === '--preview-cost') o.previewCost = true;
    else if (a === '--filter') process.env.SONORA_FILTER = next();
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
  cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' },
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
  await page.goto(`http://localhost:${PORT}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
  await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 30000 });

  const gpu = await page.evaluate(() => window.__sonora.gpu());
  const tracks = await page.evaluate(() => window.__sonora.tracks);
  const names = opts.track === 'all' ? Object.keys(tracks) : [opts.track];
  const view = opts.flat ? 'flat' : 'depth';
  const summary = [];
  console.log(`GPU: ${gpu}`);

  if (opts.previewCost) {
    await runPreviewCost(page, tracks[names[0]], names[0]);
    await browser.close();
    cleanup();
    process.exit(process.exitCode ?? 0);
  }

  if (opts.pacing) {
    await runPacing(page, tracks[names[0]], names[0]);
    await browser.close();
    cleanup();
    process.exit(process.exitCode ?? 0);
  }

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
      : join(ROOT, 'verify', `${opts.style}${variant && variant !== opts.style ? '-' + variant : ''}${opts.flat ? '-flat' : ''}${opts.camera ? '-' + opts.camera : ''}${opts.light !== 'auto' ? '-' + opts.light : ''}${process.env.SONORA_FILTER ? '-' + process.env.SONORA_FILTER.replace(/:/g, '-') : ''}`, name);
    mkdirSync(outDir, { recursive: true });

    // Fresh page state per track
    await page.reload();
    await page.waitForFunction(() => window.__sonora?.ready === true);
    await page.evaluate((o) => window.__sonora.configure({
      style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality,
      palette: o.palette, drift: false, camera: o.camera, responsiveness: o.resp, debug: o.debug,
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
      await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false, responsiveness: o.resp, debug: o.debug }), opts);
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

// ── Controller preview cost (D84) ───────────────────────────────────
// Frame cost (step + GPU sync) with the preview tap off, and capturing every
// 1st / 2nd / 6th frame, interleaved over rounds; median per setting. At 60 Hz
// the real rate (25 fps) is about every 2.4th frame, at 165 Hz every 6.6th.
// Gate: the real-rate increase ≤ 0.3 ms.
async function runPreviewCost(page, meta, name) {
  const MAX_ADD_MS = 0.3;
  await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false, camera: o.camera }), opts);
  await page.evaluate((n) => window.__sonora.loadTrack(n), name);
  await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, meta.markers.drop - 2));
  await page.evaluate(() => window.__sonora.advance(2, 1 / 60));
  const settings = [0, 1, 2, 6];
  const res = Object.fromEntries(settings.map((e) => [e, []]));
  for (let round = 0; round < 5; round++) {
    for (const every of settings) {
      await page.evaluate((e) => window.__sonora.previewTap({ on: e > 0, every: e }), every);
      res[every].push(await page.evaluate(() => window.__sonora.frameCost(120, 1 / 60)));
    }
  }
  await page.evaluate(() => window.__sonora.previewTap({ on: false }));
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const off = med(res[0]);
  const add = (e) => med(res[e]) - off;
  const at60 = add(1) / 2.4, at165 = add(1) / 6.6;
  console.log(`${name} [${opts.style}/${opts.variant || 'default'} ${opts.flat ? 'flat' : 'depth'} ${opts.size}]: frame cost off ${off.toFixed(3)} ms; capture every frame +${add(1).toFixed(3)}, every 2nd +${add(2).toFixed(3)}, every 6th +${add(6).toFixed(3)} ms → at 25 fps on 60 Hz +${at60.toFixed(3)} ms/frame, on 165 Hz +${at165.toFixed(3)} ms/frame`);
  const ok = add(2) <= MAX_ADD_MS && at60 <= MAX_ADD_MS;
  console.log(ok ? '  preview cost PASS' : '  PREVIEW COST FAIL');
  if (!ok) process.exitCode = 1;
}

// ── Real-time frame pacing ──────────────────────────────────────────
// Runs the renderer's own rAF loop (the app's pacing code) at the display's
// real refresh for a while per cap and reports the intervals between rendered
// frames: mean, p99, and held frames (an interval longer than the paced one
// by half a refresh or more, i.e. a frame shown for an extra refresh).
// Gates: match display and its divisors hold ≤ 1% of frames. Caps that don't
// divide the refresh are reported (they alternate by design).
async function runPacing(page, meta, name) {
  const PACING_MAX_HELD = 0.01;
  const caps = (opts.caps ?? '0,-2,60').split(',').map(Number);
  const secs = opts.seconds ?? 8;
  const fails = [];
  for (const cap of caps) {
    await page.reload();
    await page.waitForFunction(() => window.__sonora?.ready === true);
    await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false, camera: o.camera, responsiveness: o.resp, debug: o.debug }), opts);
    await page.evaluate((n) => window.__sonora.loadTrack(n), name);
    await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, meta.markers.drop - 2));
    // --preview: the controller's preview tap runs at its real rate (D84).
    if (opts.preview) await page.evaluate(() => window.__sonora.previewTap({ on: true }));
    // Warm up (shader compiles, refresh measurement), then measure.
    await page.evaluate((c) => window.__sonora.pacingRun(1.5, c), cap);
    const { frames, displayHz } = await page.evaluate(([s, c]) => window.__sonora.pacingRun(s, c), [secs, cap]);
    const iv = frames.slice(1).map((t, i) => t - frames[i]);
    const refresh = 1000 / displayHz;
    const k = cap === 0 ? 1 : cap < 0 ? -cap : displayHz / cap;
    const even = Math.abs(k - Math.round(k)) < 0.04 * Math.round(k);
    const paced = even ? refresh * Math.round(k) : 1000 / cap;
    const held = iv.filter((d) => d > (even ? paced : refresh * Math.ceil(k)) + refresh * 0.5).length;
    const sorted = [...iv].sort((x, y) => x - y);
    const mean = iv.reduce((x, y) => x + y, 0) / Math.max(1, iv.length);
    const label = cap === 0 ? 'match' : cap < 0 ? `1/${-cap}` : `${cap}`;
    const pattern = [...new Set(iv.slice(0, 60).map((d) => Math.round(d / refresh)))].join('/');
    console.log(`${name} [${opts.style}/${opts.variant || 'default'} ${opts.flat ? 'flat' : 'depth'}] cap ${label}: display ${displayHz.toFixed(1)} Hz, ${iv.length} frames, ${(1000 / mean).toFixed(1)} fps, interval mean ${mean.toFixed(2)} ms p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(2)} ms max ${sorted[sorted.length - 1].toFixed(1)} ms, refreshes per frame {${pattern}}, held ${held} (${(100 * held / Math.max(1, iv.length)).toFixed(1)}%)${even ? '' : ' [uneven cap: alternates by design]'}`);
    if (even && held / Math.max(1, iv.length) > PACING_MAX_HELD) fails.push(`cap ${label} held ${held}`);
  }
  console.log(fails.length ? `  PACING FAIL: ${fails.join(', ')}` : '  pacing PASS');
  if (fails.length) process.exitCode = 1;
}

// ── Flicker / exposure measurement ──────────────────────────────────
// Renders 12 s from just before the drop and reports:
//   swings/s  how often mean luminance jumps ≥ FLICKER_SWING above its
//             0.4 s running mean (beat pulses count; strobing scores high)
//   jitter    mean |frame-to-frame luminance change| / mean luminance
//   clip      mean / max fraction of blown-out pixels (any channel ≥ 250)
async function runFlicker(page, meta, name) {
  const FLICKER_SWING = 0.25;
  // Gates (DOCS/16 Quality Bar): swings either way, the largest one-frame
  // change of mean luminance (a hit may not jump the picture), blown-out share.
  // Swings ≤ 2.5/s: under the WCAG limit of 3 flashes/s (v0.1 Flow Ink, the
  // reference for Ink's hits, measures 3.1/s on its recording). One-frame step
  // ≤ 0.12: the per-hit rule (~0.1), allowing v0.1's own 0.11 (Ink's reference).
  const FLICKER_MAX_SWINGS = 2.5;
  const FLICKER_MAX_STEP = 0.12;
  const FLICKER_MAX_CLIP = 0.06;
  const start = name === 'silence-fadein' ? 26 : meta.markers.drop - 1;
  const len = 12;
  const dt = 1 / opts.fps;
  await page.reload();
  await page.waitForFunction(() => window.__sonora?.ready === true);
  await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false, camera: o.camera, responsiveness: o.resp, debug: o.debug }), opts);
  await page.evaluate((n) => window.__sonora.loadTrack(n), name);
  await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start), dt]);
  const { luma, clip } = await page.evaluate(([s, d]) => window.__sonora.exposureTrace(s, d), [len, dt]);
  // Swings count both ways: a paper look that darkens on each hit flickers
  // just as much as one that brightens.
  let ema = luma[0], above = false, swings = 0, jit = 0, maxStep = 0;
  const k = 1 - Math.exp(-dt / 0.4);
  for (let i = 1; i < luma.length; i++) {
    const d = Math.abs(luma[i] - ema) / Math.max(ema, 0.03);
    if (!above && d >= FLICKER_SWING) { swings++; above = true; } else if (d < FLICKER_SWING * 0.5) above = false;
    jit += Math.abs(luma[i] - luma[i - 1]);
    maxStep = Math.max(maxStep, Math.abs(luma[i] - luma[i - 1]));
    ema += (luma[i] - ema) * k;
  }
  const meanL = luma.reduce((a, b) => a + b, 0) / luma.length;
  const meanC = clip.reduce((a, b) => a + b, 0) / clip.length;
  const maxC = Math.max(...clip);
  console.log(`${name} [${opts.style}/${opts.variant || 'default'} p${opts.palette} r${opts.resp ?? 'def'}]: swings ${(swings / len).toFixed(2)}/s, jitter ${(100 * jit / Math.max(1, luma.length - 1) / Math.max(meanL, 0.01)).toFixed(1)}%, clip mean ${(100 * meanC).toFixed(1)}% max ${(100 * maxC).toFixed(1)}%, mean luma ${meanL.toFixed(3)}, max 1-frame step ${maxStep.toFixed(3)}`);
  const fails = [];
  if (swings / len > FLICKER_MAX_SWINGS) fails.push(`swings > ${FLICKER_MAX_SWINGS}/s`);
  if (maxStep > FLICKER_MAX_STEP) fails.push(`1-frame step > ${FLICKER_MAX_STEP}`);
  if (maxC > FLICKER_MAX_CLIP) fails.push(`blown-out > ${FLICKER_MAX_CLIP * 100}%`);
  console.log(fails.length ? `  FLICKER FAIL: ${fails.join(', ')}` : '  flicker PASS');
  if (fails.length) process.exitCode = 1;
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
  await page.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.variant || undefined, depth: !o.flat, light: o.light, quality: o.quality, palette: o.palette, drift: false, camera: o.camera, responsiveness: o.resp, debug: o.debug }), opts);
  await page.evaluate((n) => window.__sonora.loadTrack(n), name);
  await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start), dt]);
  const { luma, motion, tiles } = await page.evaluate(([s, d]) => window.__sonora.exposureTrace(s, d), [len, dt]);
  // Regional: the largest change of any region (8 x 5 grid) within 133 ms. A
  // drop of ink on paper changes one region strongly but the screen mean
  // little; a kick counts as seen regionally at SYNC_SEEN_REGION.
  const SYNC_SEEN_REGION = 0.15;
  const regional = [];
  for (const k of kicks) {
    if (k < start + 0.1 || k > start + len - 0.2) continue;
    const i = Math.round((k - start) / dt);
    let best = 0;
    for (let c = 0; c < tiles[0].length; c++) {
      const before = (tiles[i - 2][c] + tiles[i - 1][c]) / 2;
      for (let j = 0; j <= Math.round(0.133 / dt); j++) {
        const v = tiles[i + j]?.[c];
        if (v !== undefined) best = Math.max(best, Math.abs(v - before) / Math.max(before, 0.02));
      }
    }
    regional.push(best);
  }
  const seenRegion = regional.filter((r) => r >= SYNC_SEEN_REGION).length;
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
  // Motion sync: peak frame-to-frame change within 133 ms after each kick vs
  // the median change over the window (how much more the picture moves on hits).
  const sortedM = [...motion].sort((a, b) => a - b);
  const medM = Math.max(sortedM[Math.floor(sortedM.length / 2)], 1e-5);
  const mRises = [];
  for (const k of kicks) {
    if (k < start + 0.1 || k > start + len - 0.2) continue;
    const i = Math.round((k - start) / dt);
    let pk = 0;
    for (let j = 0; j <= Math.round(0.133 / dt); j++) pk = Math.max(pk, motion[i + j] ?? 0);
    mRises.push(pk / medM);
  }
  mRises.sort((a, b) => a - b);
  const motionX = mRises[Math.floor(mRises.length / 2)] ?? 0;
  const sorted = [...rises].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const meanLuma = luma.reduce((a, b) => a + b, 0) / luma.length;
  const meanLag = lags.reduce((a, b) => a + b, 0) / Math.max(1, lags.length);
  console.log(`${name} [${opts.variant || 'default'} ${opts.flat ? 'flat' : 'depth'}]: kicks ${rises.length}, seen ${seen} (${(100 * seen / Math.max(1, rises.length)).toFixed(0)}%), median rise ${(100 * median).toFixed(1)}%, peak lag ${meanLag.toFixed(0)} ms, mean luma ${meanLuma.toFixed(3)}, motion on kicks ×${motionX.toFixed(2)}, regional seen ${seenRegion}/${regional.length} (${(100 * seenRegion / Math.max(1, regional.length)).toFixed(0)}%)`);
  const outDir = join(ROOT, 'verify', 'sync');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}-${opts.variant || 'default'}-${opts.flat ? 'flat' : 'depth'}.json`), JSON.stringify({ start, dt, kicks, luma, rises }, null, 1));
}

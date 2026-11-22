#!/usr/bin/env node
// Palette matrix: renders every palette × style / look / view on the same
// seeded passages and saves the frames for scripts/palette-metrics.py
// (colour metrics + contact sheets).
//
//   npm run verify -- --palette-matrix --name baseline
//   node scripts/palette-matrix.mjs --name new --set presets --tracks house-124,ref-song
//   node scripts/palette-matrix.mjs --name hues --hues 15 --combos ink-glow-depth,voyage-void
//   node scripts/palette-matrix.mjs --name drift --drift 30 --base 0
//
// Options
//   --name <id>         set name (frames in <scratch>/<id>, sheets in verify/palettes/<id>)
//   --set presets|<file.json>   palettes: the engine's presets (default) or a JSON list of
//                       { name, resolved: { bg, paper, primary, secondary, accent, highlight } }
//   --hues <step>       instead: custom hue every <step> degrees
//   --drift <step>      instead: Auto Drift at every <step> degrees on preset --base <i>
//   --turns <list>      instead: preset --base <i> held at these exact drift turns (degrees,
//                       e.g. -30,-25,40), to find a wide palette's drift window
//   --only <names>      comma list of palette names to keep
//   --combos <ids>      comma list (default all, see COMBOS)
//   --tracks <names>    comma list (default house-124 + ref-song when present)
//   --size <WxH>        default 640x360
//   --frames <dir>      frame root (default: $PALETTE_FRAMES or the OS temp dir)
//   --jobs <n>          pages rendering at once (default 2)
//   --no-metrics        skip running palette-metrics.py afterwards
//   --flicker           instead of frames: the flicker / blown-out gates (dense-128, Punchy,
//                       12 s from just before the drop, 1920x1080, same maths as verify --flicker)
//                       for every palette × combo → verify/palettes/<name>/flicker.json
//   --clips             instead of frames: per combo, the same 2 s passage (drop + 2 s) once
//                       per palette, joined into one labelled clip; with --drift-cycle, one
//                       Auto Drift full turn (60 s period) at 2× → verify/palettes/<name>/clips/

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PALETTE_PORT || process.env.SONORA_HARNESS_PORT || 5199);
const DT = 1 / 60;

/** Every style / look / view the app offers (classic styles excluded). */
export const COMBOS = [
  { id: 'ink-glow-depth', style: 'ink', variant: 'glow', depth: true },
  { id: 'ink-glow-flat', style: 'ink', variant: 'glow', depth: false },
  { id: 'ink-marble-depth', style: 'ink', variant: 'marble', depth: true },
  { id: 'ink-marble-flat', style: 'ink', variant: 'marble', depth: false },
  { id: 'ink-sumi-depth', style: 'ink', variant: 'sumi', depth: true },
  { id: 'ink-sumi-flat', style: 'ink', variant: 'sumi', depth: false },
  { id: 'ink-glow-flat-light', style: 'ink', variant: 'glow', depth: false, light: 'light' },
  { id: 'ink-marble-flat-light', style: 'ink', variant: 'marble', depth: false, light: 'light' },
  { id: 'ink-sumi-flat-dark', style: 'ink', variant: 'sumi', depth: false, light: 'dark' },
  { id: 'silk-flat', style: 'silk', variant: 'silk', depth: false },
  { id: 'silk-depth', style: 'silk', variant: 'silk', depth: true },
  { id: 'silk-flat-light', style: 'silk', variant: 'silk', depth: false, light: 'light' },
  { id: 'wisp-flat', style: 'wisp', variant: 'ground', depth: false },
  { id: 'wisp-ground', style: 'wisp', variant: 'ground', depth: true },
  { id: 'wisp-tunnel', style: 'wisp', variant: 'tunnel', depth: true },
  { id: 'warp', style: 'warp', variant: 'warp', depth: false },
  { id: 'voyage-void', style: 'voyage', variant: 'void', depth: false },
  { id: 'voyage-city', style: 'voyage', variant: 'city', depth: false },
  { id: 'voyage-ocean', style: 'voyage', variant: 'ocean', depth: false },
];

function parseArgs(argv) {
  const o = { name: 'matrix', set: 'presets', hues: 0, drift: 0, base: 0, only: '', combos: '', tracks: '', size: '640x360', frames: '', jobs: 2, metrics: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--name') o.name = next();
    else if (a === '--set') o.set = next();
    else if (a === '--hues') o.hues = Number(next());
    else if (a === '--drift') o.drift = Number(next());
    else if (a === '--turns') o.turns = next().split(',').map(Number);
    else if (a === '--base') o.base = Number(next());
    else if (a === '--only') o.only = next();
    else if (a === '--combos') o.combos = next();
    else if (a === '--tracks') o.tracks = next();
    else if (a === '--size') o.size = next();
    else if (a === '--frames') o.frames = next();
    else if (a === '--jobs') o.jobs = Number(next());
    else if (a === '--no-metrics') o.metrics = false;
    else if (a === '--flicker') o.flicker = true;
    else if (a === '--clips') o.clips = true;
    else if (a === '--debug') o.debug = JSON.parse(next());
    else if (a === '--drift-cycle') o.driftCycle = true;
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.flicker && !process.argv.includes('--size')) opts.size = '1920x1080';
const [W, H] = opts.size.split('x').map(Number);
const frameRoot = opts.frames || process.env.PALETTE_FRAMES || join(tmpdir(), 'sonora-palettes');
const outFrames = join(frameRoot, opts.name);
mkdirSync(outFrames, { recursive: true });

async function waitForServer(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('vite did not start');
}

// A server left on this port (e.g. from a killed run) would serve stale, cached
// modules: refuse to start rather than render old code.
try {
  await fetch(`http://localhost:${PORT}/web.html`);
  console.error(`port ${PORT} is already in use (a leftover harness server?): stop it or set PALETTE_PORT`);
  process.exit(2);
} catch { /* free */ }

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' },
});
const cleanup = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

/** Shots per passage: a build frame, a 4-frame strip in the drop, a calm frame. */
function shotsFor(m) {
  return [
    ['build', m.drop - 2],
    ['drop0', m.drop + 0.75], ['drop1', m.drop + 1.0], ['drop2', m.drop + 1.25], ['drop3', m.drop + 1.5],
    ['calm', m.breakdown + 3],
  ];
}

async function renderOne(page, combo, pal, track, meta) {
  const dir = join(outFrames, combo.id, pal.name.replace(/[^\w-]+/g, '_'));
  mkdirSync(dir, { recursive: true });
  const shots = shotsFor(meta.markers);
  if (shots.every(([tag]) => existsSync(join(dir, `${track}-${tag}.png`)))) return;
  await page.reload();
  await page.waitForFunction(() => window.__sonora?.ready === true);
  await page.evaluate(([c, dbg]) => window.__sonora.configure({ style: c.style, variant: c.variant, depth: c.depth, light: c.light ?? 'auto', quality: 'medium', drift: false, debug: dbg }), [combo, opts.debug]);
  await page.evaluate((p) => window.__sonora.setPalette(p.def), pal);
  await page.evaluate((n) => window.__sonora.loadTrack(n), track);
  let t = 0;
  const goTo = async (target, warm) => {
    const quiet = Math.max(0, target - t - warm);
    if (quiet > 0) await page.evaluate((s) => window.__sonora.analyseOnly(s), quiet);
    let left = target - t - quiet;
    while (left > 1e-6) {
      const c = Math.min(left, 2);
      await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [c, DT]);
      left -= c;
    }
    t = target;
  };
  for (const [tag, at] of shots) {
    await goTo(at, 6);
    const url = await page.evaluate(() => window.__sonora.snapshot());
    writeFileSync(join(dir, `${track}-${tag}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
}

// Flicker gates (DOCS/16, D47): identical maths to scripts/verify.mjs runFlicker.
const FLICKER_SWING = 0.25, FLICKER_MAX_SWINGS = 2.5, FLICKER_MAX_STEP = 0.12, FLICKER_MAX_CLIP = 0.06;
async function flickerOne(page, combo, pal, meta) {
  const start = meta.markers.drop - 1, len = 12;
  await page.reload();
  await page.waitForFunction(() => window.__sonora?.ready === true);
  await page.evaluate((c) => window.__sonora.configure({ style: c.style, variant: c.variant, depth: c.depth, light: c.light ?? 'auto', quality: 'medium', drift: false, responsiveness: 1 }), combo);
  await page.evaluate((p) => window.__sonora.setPalette(p.def), pal);
  await page.evaluate((n) => window.__sonora.loadTrack(n), 'dense-128');
  await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start), DT]);
  const { luma, clip } = await page.evaluate(([s, d]) => window.__sonora.exposureTrace(s, d), [len, DT]);
  let ema = luma[0], above = false, swings = 0, maxStep = 0;
  const k = 1 - Math.exp(-DT / 0.4);
  for (let i = 1; i < luma.length; i++) {
    const d = Math.abs(luma[i] - ema) / Math.max(ema, 0.03);
    if (!above && d >= FLICKER_SWING) { swings++; above = true; } else if (d < FLICKER_SWING * 0.5) above = false;
    maxStep = Math.max(maxStep, Math.abs(luma[i] - luma[i - 1]));
    ema += (luma[i] - ema) * k;
  }
  const r = {
    swings: swings / len, maxStep, clipMax: Math.max(...clip), clipMean: clip.reduce((a, b) => a + b, 0) / clip.length,
    meanLuma: luma.reduce((a, b) => a + b, 0) / luma.length,
  };
  r.pass = r.swings <= FLICKER_MAX_SWINGS && r.maxStep <= FLICKER_MAX_STEP && r.clipMax <= FLICKER_MAX_CLIP;
  return r;
}

// ── Review clips ────────────────────────────────────────────────
const CLIP_FPS = 30;
async function clipFrames(page, combo, def, track, meta, start, secs, dir, every = 2, drift = false) {
  mkdirSync(dir, { recursive: true });
  await page.reload();
  await page.waitForFunction(() => window.__sonora?.ready === true);
  await page.evaluate((c) => window.__sonora.configure({ style: c.style, variant: c.variant, depth: c.depth, light: c.light ?? 'auto', quality: 'medium', drift: false }), combo);
  await page.evaluate((p) => window.__sonora.setPalette(p), def);
  if (drift) await page.evaluate(() => { window.__sonora.setPalette({ index: 0, driftDeg: 0 }); });
  await page.evaluate((n) => window.__sonora.loadTrack(n), track);
  await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start), DT]);
  const n = Math.round(secs * CLIP_FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [every * DT, DT]);
    const url = await page.evaluate(() => window.__sonora.snapshot('image/jpeg', 0.9));
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
}

async function clipDrift(page, combo, track, meta, dir) {
  mkdirSync(dir, { recursive: true });
  await page.reload();
  await page.waitForFunction(() => window.__sonora?.ready === true);
  await page.evaluate((c) => window.__sonora.configure({ style: c.style, variant: c.variant, depth: c.depth, light: c.light ?? 'auto', quality: 'medium', drift: false }), combo);
  await page.evaluate((n) => window.__sonora.loadTrack(n), track);
  const start = meta.markers.fadeIn + 4;
  await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start), DT]);
  // 60 s of music, the drift turned 6° per second of music (one full turn).
  const frames = Math.round((60 * CLIP_FPS) / 2);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((d) => window.__sonora.setPalette({ index: 0, driftDeg: d }), (i / frames) * 360);
    await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [4 * DT, DT]);
    const url = await page.evaluate(() => window.__sonora.snapshot('image/jpeg', 0.9));
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
}

function ffmpeg() {
  return execFileSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
}

try {
  await waitForServer(`http://localhost:${PORT}/web.html`);
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const pages = [];
  for (let j = 0; j < Math.max(1, opts.jobs); j++) {
    const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => console.log('  [page exception]', e.message));
    await p.goto(`http://localhost:${PORT}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
    await p.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
    pages.push(p);
  }
  const page0 = pages[0];
  const tracks = await page0.evaluate(() => window.__sonora.tracks);
  const trackNames = opts.tracks ? opts.tracks.split(',') : ['house-124', ...(tracks['ref-song'] ? ['ref-song'] : [])];

  // Palette list: each entry { name, def (setPalette argument), resolved (for the metrics) }.
  const presets = await page0.evaluate(() => window.__sonora.palettes());
  let pals;
  if (opts.hues > 0) {
    pals = [];
    for (let h = 0; h < 360; h += opts.hues) pals.push({ name: `hue-${String(h).padStart(3, '0')}`, def: { hue: h } });
  } else if (opts.turns) {
    pals = opts.turns.map((d) => ({ name: `turn-${d < 0 ? 'm' : 'p'}${String(Math.abs(d)).padStart(3, '0')}`, def: { index: opts.base, driftDeg: 0, driftTurn: d } }));
  } else if (opts.drift > 0) {
    pals = [];
    for (let d = 0; d < 360; d += opts.drift) {
      // A phase inside a skipped stretch (a few seconds of quick turning) is a transition: tagged, not judged.
      const crossing = await page0.evaluate(([i, ph]) => window.__sonora.driftCrossing(i, ph), [opts.base, d]);
      pals.push({ name: `drift-${String(d).padStart(3, '0')}${crossing ? '-crossing' : ''}`, def: { index: opts.base, driftDeg: d } });
    }
  } else if (opts.set === 'presets') {
    pals = presets.map((p, i) => ({ name: p.name, def: { index: i } }));
  } else {
    pals = JSON.parse(readFileSync(opts.set, 'utf8')).map((p) => ({ name: p.name, def: { resolved: p.resolved } }));
  }
  if (opts.only) { const keep = new Set(opts.only.split(',')); pals = pals.filter((p) => keep.has(p.name)); }
  // Resolve each palette's RGB as the engine shows it (for analytic separation).
  for (const p of pals) {
    await page0.evaluate((d) => window.__sonora.setPalette(d), p.def);
    p.resolved = await page0.evaluate(() => window.__sonora.currentPalette());
  }
  const combos = opts.combos ? COMBOS.filter((c) => opts.combos.split(',').includes(c.id)) : COMBOS;
  writeFileSync(join(outFrames, 'index.json'), JSON.stringify({
    name: opts.name, size: [W, H], combos, tracks: trackNames, palettes: pals,
    markers: Object.fromEntries(trackNames.map((n) => [n, tracks[n].markers])),
    shots: Object.fromEntries(trackNames.map((n) => [n, shotsFor(tracks[n].markers)])),
  }, null, 1));

  if (opts.clips) {
    const outDir = join(ROOT, 'verify', 'palettes', opts.name, 'clips');
    mkdirSync(outDir, { recursive: true });
    const ff = ffmpeg();
    const track = trackNames[0];
    const meta = tracks[track];
    const page = pages[0];
    for (const combo of combos) {
      const segs = [];
      for (const pal of pals) {
        const dir = join(outFrames, 'clips', combo.id, pal.name.replace(/[^\w-]+/g, '_'));
        if (!existsSync(join(dir, 'f00059.jpg'))) await clipFrames(page, combo, pal.def, track, meta, meta.markers.drop + 2, 2, dir);
        segs.push({ dir, label: pal.name });
      }
      // One labelled segment per palette, then joined.
      const parts = [];
      for (const [k, sgm] of segs.entries()) {
        const part = join(outFrames, 'clips', combo.id, `seg${k}.mp4`);
        execFileSync(ff, ['-y', '-loglevel', 'error', '-framerate', String(CLIP_FPS), '-i', join(sgm.dir, 'f%05d.jpg'),
          '-vf', `drawtext=text='${k + 1} ${sgm.label}':x=16:y=h-36:fontsize=20:fontcolor=0xECE7DF:fontfile='C\\:/Windows/Fonts/consola.ttf'`,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', part]);
        parts.push(part);
      }
      const list = join(outFrames, 'clips', combo.id, 'list.txt');
      writeFileSync(list, parts.map((x) => `file '${x.split('\\').join('/')}'`).join('\n'));
      execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(outDir, `${combo.id}.mp4`)]);
      console.log(`clip ${combo.id} → ${join(outDir, combo.id + '.mp4')}`);
    }
    if (opts.driftCycle) {
      const combo = combos[0];
      const dir = join(outFrames, 'clips', `drift-${combo.id}`);
      // Auto Drift at its shortest period (60 s), one full turn, every 4th frame → 2× speed at 30 fps.
      await clipDrift(page, combo, track, meta, dir);
      execFileSync(ff, ['-y', '-loglevel', 'error', '-framerate', String(CLIP_FPS), '-i', join(dir, 'f%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', join(outDir, `drift-cycle-${combo.id}.mp4`)]);
      console.log(`drift cycle → ${join(outDir, 'drift-cycle-' + combo.id + '.mp4')}`);
    }
    await browser.close();
    cleanup();
    process.exit(0);
  }

  if (opts.flicker) {
    const outDir = join(ROOT, 'verify', 'palettes', opts.name);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, 'flicker.json');
    const res = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const fj = [];
    for (const combo of combos) for (const pal of pals) if (!res[combo.id]?.[pal.name]) fj.push({ combo, pal });
    console.log(`flicker gates "${opts.name}": ${fj.length} runs`);
    const t0 = Date.now();
    await Promise.all(pages.map(async (page) => {
      while (fj.length) {
        const j = fj.shift();
        const r = await flickerOne(page, j.combo, j.pal, tracks['dense-128']);
        (res[j.combo.id] ??= {})[j.pal.name] = r;
        writeFileSync(file, JSON.stringify(res, null, 1));
        console.log(`${j.combo.id.padEnd(22)} ${j.pal.name.padEnd(16)} swings ${r.swings.toFixed(2)}/s step ${r.maxStep.toFixed(3)} clip ${(100 * r.clipMax).toFixed(1)}% luma ${r.meanLuma.toFixed(3)} ${r.pass ? 'PASS' : 'FAIL'}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      }
    }));
    await browser.close();
    cleanup();
    const fails = Object.entries(res).flatMap(([c, ps]) => Object.entries(ps).filter(([, r]) => !r.pass).map(([p]) => `${c}/${p}`));
    console.log(fails.length ? `FLICKER FAIL: ${fails.join(', ')}` : 'flicker PASS (all)');
    process.exit(fails.length ? 1 : 0);
  }

  const jobs = [];
  for (const combo of combos) for (const pal of pals) for (const track of trackNames) jobs.push({ combo, pal, track });
  console.log(`palette matrix "${opts.name}": ${pals.length} palettes × ${combos.length} combos × ${trackNames.length} tracks = ${jobs.length} renders → ${outFrames}`);
  const t0 = Date.now();
  let done = 0;
  await Promise.all(pages.map(async (page) => {
    while (jobs.length) {
      const j = jobs.shift();
      await renderOne(page, j.combo, j.pal, j.track, tracks[j.track]);
      done++;
      if (done % 10 === 0) console.log(`  ${done} done, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }));
  await browser.close();
  cleanup();
  console.log(`rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (opts.metrics) {
    const r = spawnSync('python', [join(ROOT, 'scripts', 'palette-metrics.py'), outFrames, join(ROOT, 'verify', 'palettes', opts.name)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
} catch (e) {
  console.error(e);
  cleanup();
  process.exit(1);
}

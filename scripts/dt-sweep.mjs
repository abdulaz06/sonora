#!/usr/bin/env node
// Frame-rate independence check: renders the same seeded passage at several
// render rates (default 60, 120, 165 fps) and compares what matters, measured
// in time rather than frames:
//   sync     kicks seen (whole-screen ≥6% and regional ≥15% within 133 ms), median rise
//   flicker  swings/s (luminance ≥25% off its 0.4 s mean) and the largest change over 1/60 s
//   motion   large vs fine change between frames 1/60 s apart (fine share)
//   pop      new ink appearing per 1/60 s (scripts/ink-metrics.py pop)
//   drift    large-shape difference from the 60 fps run at the same audio times
// Gates: every rate within tolerance of the 60 fps run (the rate everything was tuned at).
//
//   node scripts/dt-sweep.mjs --style ink --variant marble [--flat] [--track ref-song]
//        [--start s] [--secs s] [--rates 60,120,165] [--camera planet] [--palette n]
//        [--debug '{"inkLegacy":true}'] [--keep]
// Also: npm run verify -- --dt-sweep … (forwards here).
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Tolerances (vs the 60 fps run) ─────────────────────────────
const TOL = {
  seenPts: 5,          // kicks seen, percentage points (whole-screen and regional)
  riseRel: 0.25,       // median rise, relative
  swings: 0.5,         // swings per second
  step60: 0.03,        // largest luminance change over 1/60 s, absolute
  fineSharePts: 5,     // fine share, percentage points
  popRel: 0.35,        // pop p99, relative (peak is one event; p99 is steadier)
  drift: 8,            // mean large-shape difference from the 60 fps run, % of mean luminance
};

const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const style = arg('--style', 'ink'), variant = arg('--variant', 'glow');
const flat = a.includes('--flat');
const track = arg('--track', 'house-124');
const rates = arg('--rates', '60,120,165').split(',').map(Number);
const W = 480, H = 270;
const debug = arg('--debug', '');
const camera = arg('--camera', '');
const palette = arg('--palette', '');
const keep = a.includes('--keep');
const out = arg('--out', `verify/dt-sweep/${style}-${variant}-${flat ? 'flat' : 'depth'}-${track}${debug ? '-dbg' : ''}`);

const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };

function median(xs) { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; }

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch('http://localhost:5199/web.html')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log('  [page exception]', e.message));
  await p.goto('http://localhost:5199/web.html?harness=1');
  await p.waitForFunction(() => window.__sonora?.ready === true);
  const tracks = await p.evaluate(() => window.__sonora.tracks);
  const meta = tracks[track];
  if (!meta) throw new Error(`unknown track ${track}`);
  const start = Number(arg('--start', String(meta.markers.drop - 1)));
  const secs = Number(arg('--secs', '6'));
  const kicks = (meta.kicks ?? []).filter((k) => k > start + 0.1 && k < start + secs - 0.2);
  const results = [];
  mkdirSync(out, { recursive: true });

  for (const fps of rates) {
    const dt = 1 / fps;
    await p.reload();
    await p.waitForFunction(() => window.__sonora?.ready === true);
    await p.evaluate((c) => window.__sonora.configure(c), {
      style, variant, depth: !flat, drift: false,
      camera: camera || undefined, palette: palette !== '' ? Number(palette) : undefined,
      debug: debug ? JSON.parse(debug) : { inkLegacy: false, inkExp: {} },
    });
    await p.evaluate((n) => window.__sonora.loadTrack(n), track);
    const warm = Math.min(8, start);
    await p.evaluate((s) => window.__sonora.analyseOnly(s), start - warm);
    const warmSteps = Math.round(warm * fps);
    for (let k = 0; k < warmSteps; k += 120) await p.evaluate(([n, d]) => window.__sonora.advance(n * d, d), [Math.min(120, warmSteps - k), dt]);
    // Render the window frame by frame: luminance traces + PNGs for motion/pop/drift.
    const dir = join(out, `${fps}fps`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const n = Math.round(secs * fps);
    const luma = [], tiles = [];
    for (let f = 0; f < n; f++) {
      const r = await p.evaluate(([d]) => {
        const t = window.__sonora.exposureTrace(d, d);
        return { l: t.luma[0], tl: t.tiles[0], png: window.__sonora.snapshot() };
      }, [dt]);
      luma.push(r.l); tiles.push(r.tl);
      writeFileSync(join(dir, `f${String(f).padStart(5, '0')}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    }
    writeFileSync(join(dir, 'seq.json'), JSON.stringify({ style, look: variant, track, start, secs, view: flat ? 'flat' : 'depth', step: 1, fps, W, H }));

    // Sync (time windows), as verify --sync.
    const win = Math.round(0.133 * fps);
    const rises = [], regional = [];
    for (const k of kicks) {
      const i = Math.round((k - start) * fps);
      const pre = Math.max(1, Math.round(fps / 30));
      const before = luma.slice(i - pre, i).reduce((x, y) => x + y, 0) / pre;
      let up = 0, down = 0;
      for (let j = 0; j <= win; j++) { const v = luma[i + j]; if (v === undefined) continue; up = Math.max(up, (v - before) / Math.max(before, 0.01)); down = Math.max(down, (before - v) / Math.max(before, 0.01)); }
      rises.push(Math.max(up, down));
      let best = 0;
      for (let c = 0; c < tiles[0].length; c++) {
        let bsum = 0;
        for (let q = 1; q <= pre; q++) bsum += tiles[i - q][c];
        const bt = bsum / pre;
        for (let j = 0; j <= win; j++) { const v = tiles[i + j]?.[c]; if (v !== undefined) best = Math.max(best, Math.abs(v - bt) / Math.max(bt, 0.02)); }
      }
      regional.push(best);
    }
    // Flicker: swings/s and the largest change over 1/60 s.
    let ema = luma[0], above = false, swings = 0, step60 = 0;
    const kf = 1 - Math.exp(-dt / 0.4);
    const lag = Math.max(1, Math.round(fps / 60));
    for (let i = 1; i < luma.length; i++) {
      const d = Math.abs(luma[i] - ema) / Math.max(ema, 0.03);
      if (!above && d >= 0.25) { swings++; above = true; } else if (d < 0.125) above = false;
      if (i >= lag) step60 = Math.max(step60, Math.abs(luma[i] - luma[i - lag]));
      ema += (luma[i] - ema) * kf;
    }
    const py = (cmd, ...dirs) => execFileSync('python', ['scripts/ink-metrics.py', cmd, ...dirs, '--json', join(out, `${cmd}-${fps}.json`)], { encoding: 'utf8' });
    py('motion', dir); py('pop', dir);
    const readJson = (f) => JSON.parse(readFileSync(join(out, f), 'utf8'));
    const motion = readJson(`motion-${fps}.json`);
    const pop = readJson(`pop-${fps}.json`);
    let drift = null;
    if (fps !== rates[0]) {
      py('compare', join(out, `${rates[0]}fps`), dir);
      drift = readJson(`compare-${fps}.json`).large_diff_mean;
    }
    const r = {
      fps, kicks: rises.length,
      seen: 100 * rises.filter((x) => x >= 0.06).length / Math.max(1, rises.length),
      seenRegional: 100 * regional.filter((x) => x >= 0.15).length / Math.max(1, regional.length),
      rise: median(rises) * 100, swings: swings / secs, step60, fineShare: motion.fine_share,
      large: motion.large, popPeak: pop.pop_peak, popP99: pop.pop_p99, drift,
    };
    results.push(r);
    console.log(`${fps} fps: seen ${r.seen.toFixed(0)}% regional ${r.seenRegional.toFixed(0)}% rise ${r.rise.toFixed(1)}% | swings ${r.swings.toFixed(2)}/s step(1/60 s) ${r.step60.toFixed(3)} | large ${r.large.toFixed(2)}% fine share ${r.fineShare.toFixed(0)}% | pop peak ${r.popPeak.toFixed(2)} p99 ${r.popP99.toFixed(2)}${drift !== null ? ` | drift vs ${rates[0]} ${drift.toFixed(2)}%` : ''}`);
  }
  await b.close();

  const ref = results[0];
  const fails = [];
  for (const r of results.slice(1)) {
    const f = (ok, what) => { if (!ok) fails.push(`${r.fps} fps ${what}`); };
    f(Math.abs(r.seen - ref.seen) <= TOL.seenPts, `kicks seen ${r.seen.toFixed(0)} vs ${ref.seen.toFixed(0)}%`);
    f(Math.abs(r.seenRegional - ref.seenRegional) <= TOL.seenPts, `regional seen ${r.seenRegional.toFixed(0)} vs ${ref.seenRegional.toFixed(0)}%`);
    f(Math.abs(r.rise - ref.rise) <= TOL.riseRel * Math.max(ref.rise, 4), `median rise ${r.rise.toFixed(1)} vs ${ref.rise.toFixed(1)}%`);
    f(Math.abs(r.swings - ref.swings) <= TOL.swings, `swings ${r.swings.toFixed(2)} vs ${ref.swings.toFixed(2)}/s`);
    f(Math.abs(r.step60 - ref.step60) <= TOL.step60, `step ${r.step60.toFixed(3)} vs ${ref.step60.toFixed(3)}`);
    f(Math.abs(r.fineShare - ref.fineShare) <= TOL.fineSharePts, `fine share ${r.fineShare.toFixed(0)} vs ${ref.fineShare.toFixed(0)}%`);
    f(Math.abs(r.popP99 - ref.popP99) <= TOL.popRel * Math.max(ref.popP99, 0.5), `pop p99 ${r.popP99.toFixed(2)} vs ${ref.popP99.toFixed(2)}`);
    f(r.drift === null || r.drift <= TOL.drift, `drift ${r.drift?.toFixed(2)}% > ${TOL.drift}%`);
  }
  writeFileSync(join(out, 'dt-sweep.json'), JSON.stringify({ style, variant, flat, track, start, secs, debug, results, fails }, null, 1));
  console.log(fails.length ? `DT-SWEEP FAIL: ${fails.join('; ')}` : 'dt-sweep PASS');
  if (!keep) for (const fps of rates) rmSync(join(out, `${fps}fps`), { recursive: true, force: true });
  if (fails.length) process.exitCode = 1;
} finally { kill(); }

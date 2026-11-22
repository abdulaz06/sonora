#!/usr/bin/env node
// Voyage City / Ocean review captures (1.1 world rebuild): stills at fixed
// moments in several palettes, short wide-shot clips, and frame cost per
// quality preset at those moments (1920×1080, synced). Same harness and
// fixed-step audio time as verify.mjs, so before / after line up exactly.
//
//   node scripts/voyage-shots.mjs <tag> [--looks city,ocean] [--palettes 0,2,3,6] [--track house-124]
//        [--times 30,60,92] [--clips 88:4] [--size 1280x720] [--cost] [--no-stills]
// → verify/voyage-1.1/<tag>/<look>-p<palette>-t<time>.jpg, <look>-clip-<t>.mp4, cost.json
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const tag = process.argv[2] ?? 'scratch';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const LOOKS = arg('looks', 'city,ocean').split(',');
const PALETTES = arg('palettes', '0,2,3,6,7').split(',').map(Number);
const TRACK = arg('track', 'house-124');
const TIMES = arg('times', '30,62,92').split(',').map(Number);
const CLIPS = (arg('clips', '89:4') || '').split(',').filter(Boolean).map((s) => s.split(':').map(Number));
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const PORT = Number(process.env.SONORA_HARNESS_PORT || 5199);
const OUT = join('verify', 'voyage-1.1', tag);
mkdirSync(OUT, { recursive: true });
const ffmpeg = (await import('ffmpeg-static')).default;

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
const cost = {};
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const open = async (look, palette, w, h, quality = 'high') => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', (e) => console.log('  [page]', e.message));
    await p.goto(`http://localhost:${PORT}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
    await p.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
    await p.evaluate(([l, q]) => window.__sonora.configure({ style: 'voyage', variant: l, quality: q, drift: false, debug: { fixedExposure: true } }), [look, quality]);
    await p.evaluate((i) => window.__sonora.setPalette({ index: i }), palette);
    await p.evaluate((n) => window.__sonora.loadTrack(n), TRACK);
    return p;
  };
  for (const look of LOOKS) {
    if (!flag('no-stills')) {
      for (const pal of PALETTES) {
        const p = await open(look, pal, W, H);
        let now = 0;
        for (const t of TIMES) {
          await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [t - now, 1 / 60]);
          now = t;
          const u = await p.evaluate(() => window.__sonora.snapshot('image/jpeg', 0.9));
          writeFileSync(join(OUT, `${look}-p${pal}-t${t}.jpg`), Buffer.from(u.split(',')[1], 'base64'));
        }
        await p.close();
        console.log(`${look} palette ${pal}: ${TIMES.join(', ')} s`);
      }
    }
    for (const [t0, secs] of CLIPS) {
      const p = await open(look, PALETTES[0], W, H);
      await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [t0, 1 / 60]);
      const dir = join(OUT, `_clip-${look}-${t0}`);
      mkdirSync(dir, { recursive: true });
      for (let k = 0; k < secs * 30; k++) {
        const u = await p.evaluate(() => { window.__sonora.advance(1 / 30, 1 / 60); return window.__sonora.snapshot('image/jpeg', 0.92); });
        writeFileSync(join(dir, `f${String(k).padStart(4, '0')}.jpg`), Buffer.from(u.split(',')[1], 'base64'));
      }
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', '30', '-i', join(dir, 'f%04d.jpg'), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(OUT, `${look}-clip-${t0}.mp4`)]);
      rmSync(dir, { recursive: true, force: true });
      await p.close();
      console.log(`${look} clip ${t0}+${secs} s`);
    }
    if (flag('cost')) {
      for (const q of ['low', 'medium', 'high']) {
        const p = await open(look, PALETTES[0], 1920, 1080, q);
        let now = 0;
        for (const t of TIMES) {
          await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [t - now, 1 / 60]);
          now = t;
          const ms = await p.evaluate(() => window.__sonora.frameCost(90, 1 / 60));
          now += 100 / 60;
          (cost[look] ??= {})[q] ??= {};
          cost[look][q][t] = +ms.toFixed(2);
        }
        await p.close();
        console.log(`${look} ${q}: ${JSON.stringify(cost[look][q])} ms`);
      }
    }
  }
  if (flag('cost')) writeFileSync(join(OUT, 'cost.json'), JSON.stringify(cost, null, 1));
  await b.close();
} finally { kill(); }

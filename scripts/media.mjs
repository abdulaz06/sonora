#!/usr/bin/env node
// Media pipeline: renders every thumbnail and preview loop in scripts/media-plan.mjs
// from the engine (real GPU via system Edge, audio time, fixed dt), then encodes
// the shipped assets into src/assets/media/ and writes its manifest.
//
//   npm run media                         render + encode everything (picks)
//   node scripts/media.mjs candidates [names…]   contact sheets for curation → media/sheets/
//   node scripts/media.mjs render [names…]       masters + loop frames → media/
//   node scripts/media.mjs encode [names…]       media/ → src/assets/media/ (+ manifest)
//
// Masters (1920×1080 PNG) and loop frames live in the git-ignored media/ folder.
// Never run two harness instances at once (both use :5199).

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PLAN, withDefaults } from './media-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SONORA_HARNESS_PORT || 5199);
const MEDIA = process.env.SONORA_MEDIA_DIR || join(ROOT, 'media');
const FPS = 30;
const LOOP_W = 1024, LOOP_H = 576;
/** Extra seconds rendered after a loop and blended over its start (seamless). */
const SEAM_S = 0.6;

const [cmd = 'all', ...names] = process.argv.slice(2);
// Names may end in * to match a prefix (e.g. pal-ink-*).
const entries = PLAN.map(withDefaults).filter((e) => names.length === 0
  || names.some((n) => (n.endsWith('*') ? e.name.startsWith(n.slice(0, -1)) : e.name === n)));

async function startServer() {
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' },
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) return server; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('vite did not start');
}
const killServer = (s) => { try { execFileSync('taskkill', ['/pid', String(s.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };

async function openPage(browser, e) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`http://localhost:${PORT}/web.html?harness=1`);
  await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
  await page.evaluate((o) => window.__sonora.configure(o), {
    style: e.style, variant: e.look, depth: e.depth, light: e.light, quality: e.quality,
    palette: e.palette, drift: false, camera: e.camera, responsiveness: e.resp,
  });
  await page.evaluate((n) => window.__sonora.loadTrack(n), e.track);
  return page;
}

/** Advance the page to track time `t` (analysis only until the warm-up window, then rendered). */
async function seek(page, now, t, warmup) {
  const start = Math.max(now, t - warmup);
  if (start > now) await page.evaluate((s) => window.__sonora.analyseOnly(s), start - now);
  if (t > start) await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [t - start, 1 / FPS]);
  return t;
}

const grab = (page, w, h, type = 'image/png', q = 0.92, crop = 1) => page.evaluate(([w, h, type, q, crop]) => {
  const src = document.getElementById('canvas');
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const sw = src.width * crop, sh = src.height * crop;
  c.getContext('2d').drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
  return c.toDataURL(type, q);
}, [w, h, type, q, crop]);
const save = (file, dataUrl) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64')); };

async function candidates(browser) {
  for (const e of entries) {
    const page = await openPage(browser, e);
    let now = 0;
    const dir = join(MEDIA, 'candidates', e.name);
    rmSync(dir, { recursive: true, force: true });
    for (const t of e.candidates) {
      now = await seek(page, now, t, e.warmup);
      save(join(dir, `${String(t).padStart(5, '0')}.jpg`), await grab(page, 960, 540, 'image/jpeg', 0.9, e.crop ?? 1));
    }
    await page.close();
    console.log(`candidates ${e.name}: ${e.candidates.join(', ')}`);
  }
  execFileSync('python', [join(ROOT, 'scripts', 'media-encode.py'), 'sheets', ...entries.map((e) => e.name)], { stdio: 'inherit' });
}

async function render(browser) {
  for (const e of entries) {
    const page = await openPage(browser, e);
    // Replay the contact sheet's path exactly (Voyage's flight depends on where
    // rendering starts): candidates[0] after its warm-up, then continuously
    // through each candidate up to the pick.
    let now = 0;
    for (const t of e.candidates) {
      if (t > e.pick) break;
      now = await seek(page, now, t, e.warmup);
    }
    now = await seek(page, now, e.pick, e.warmup);
    save(join(MEDIA, 'masters', `${e.name}.png`), await grab(page, 1920, 1080, 'image/png', 1, e.crop ?? 1));
    if (e.loop > 0) {
      const dir = join(MEDIA, 'frames', e.name);
      rmSync(dir, { recursive: true, force: true });
      const n = Math.round((e.loop + SEAM_S) * FPS);
      for (let i = 0; i < n; i++) {
        save(join(dir, `${String(i).padStart(4, '0')}.jpg`), await grab(page, LOOP_W, LOOP_H, 'image/jpeg', 0.93));
        await page.evaluate((d) => window.__sonora.advance(d, d), 1 / FPS);
      }
    }
    void now;
    await page.close();
    console.log(`rendered ${e.name}${e.loop ? ` (+${e.loop}s loop)` : ''}`);
  }
}

function encode() {
  execFileSync('python', [join(ROOT, 'scripts', 'media-encode.py'), 'encode', ...entries.map((e) => e.name)], { stdio: 'inherit' });
}

async function main() {
  mkdirSync(MEDIA, { recursive: true });
  if (cmd === 'encode') { encode(); return; }
  const server = await startServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    if (cmd === 'candidates') await candidates(browser);
    else if (cmd === 'render') await render(browser);
    else if (cmd === 'all') { await render(browser); }
    else throw new Error(`unknown command ${cmd}`);
  } finally {
    await browser.close();
    killServer(server);
  }
  if (cmd === 'all') encode();
}

if (!existsSync(join(ROOT, 'test-audio', 'house-124.wav'))) {
  console.error('test audio missing: run `npm run gen:audio` first');
  process.exit(1);
}
await main();

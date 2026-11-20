#!/usr/bin/env node
// Renders the hero poster: the live engine's exact first frame (Ink Glow Depth,
// seed 1234, the demo at the hero's start after its warm-up), so the poster
// crossfades into the live canvas without a jump. Writes public/media/hero-*.webp
// and a 1920 PNG master in verify/site/ (git-ignored).
//   node scripts/poster.mjs        (needs `npm run preview` on :4321, or starts it)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SITE, '..');
const BASE = 'http://localhost:4321';
const ffmpeg = (await import(new URL('../../node_modules/ffmpeg-static/index.js', import.meta.url).href)).default;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
const up = async () => { try { return (await fetch(BASE)).ok; } catch { return false; } };
if (!(await up())) { server = spawn('npx', ['astro', 'preview', '--port', '4321'], { cwd: SITE, shell: true, stdio: 'ignore' }); for (let i = 0; i < 60 && !(await up()); i++) await wait(500); }

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?live&poster`);
  await page.waitForFunction(() => window.__poster, null, { timeout: 90000 });
  const data = await page.evaluate(() => window.__poster);
  const outDir = join(ROOT, 'verify', 'site');
  mkdirSync(outDir, { recursive: true });
  const png = join(outDir, 'hero-master.png');
  writeFileSync(png, Buffer.from(data.split(',')[1], 'base64'));
  for (const w of [960, 1600, 1920]) {
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', png, '-vf', `scale=${w}:-2:flags=lanczos`, '-quality', w > 1000 ? '78' : '74', '-compression_level', '6', join(SITE, 'public', 'media', `hero-${w}.webp`)]);
  }
  console.log('poster: public/media/hero-{960,1600,1920}.webp');
} finally {
  await browser.close();
  if (server) try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
}

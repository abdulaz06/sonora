#!/usr/bin/env node
// Site screenshots for review: every page at 1440×900, 1920×1080 and 390×844
// (landing: one shot per section, waiting for the live engine), plus a full-page
// shot. Uses the system Edge with the real GPU, like the verify harness.
//   node scripts/shots.mjs [--pages home,live,engineering] [--sizes 1440x900] [--out dir] [--static]
// Needs `npm run preview` (port 4321) or starts it.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 4321));
const BASE = `http://localhost:${PORT}`;
const PAGES = arg('pages', 'home,live,engineering').split(',');
const SIZES = arg('sizes', '1440x900,1920x1080,390x844').split(',').map((s) => s.split('x').map(Number));
const OUT = arg('out', join(SITE, '..', 'verify', 'site', 'shots'));
const QUERY = process.argv.includes('--static') ? '?static' : '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
async function up() { try { return (await fetch(BASE)).ok; } catch { return false; } }
if (!(await up())) {
  server = spawn('npx', ['astro', 'preview', '--port', String(PORT)], { cwd: SITE, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await wait(500);
}
const kill = () => { if (server) try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  for (const [w, h] of SIZES) {
    const mobile = w < 600;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  [${w}x${h}] page error:`, e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log(`  [${w}x${h}] console error:`, m.text()); });
    for (const name of PAGES) {
      const path = name === 'home' ? '/' : `/${name}`;
      await page.goto(`${BASE}${path}${QUERY}`, { waitUntil: 'load' });
      await wait(name === 'home' ? 4500 : 2500);
      const tag = `${name}-${w}x${h}`;
      if (name === 'home') {
        const ids = await page.$$eval('main > section', (els) => els.map((e, i) => e.dataset.scene || e.id || e.className.split(' ').pop() || String(i)));
        for (let i = 0; i < ids.length; i++) {
          await page.evaluate((k) => { const el = document.querySelectorAll('main > section')[k]; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY); }, i);
          await wait(i === 0 ? 400 : 2600);
          await page.screenshot({ path: join(OUT, `${tag}-${String(i).padStart(2, '0')}-${ids[i]}.jpg`), quality: 88 });
        }
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await wait(1500);
        await page.screenshot({ path: join(OUT, `${tag}-99-end.jpg`), quality: 88 });
      } else {
        await page.screenshot({ path: join(OUT, `${tag}.jpg`), quality: 88 });
        await page.screenshot({ path: join(OUT, `${tag}-full.jpg`), quality: 80, fullPage: true });
      }
      console.log(`shots: ${tag}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  kill();
}

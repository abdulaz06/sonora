#!/usr/bin/env node
// Reel studio check: starts the studio (no browser window), loads it in
// headless Edge at desktop sizes, waits for the analysis, screenshots it, plays
// the live preview for a few seconds and screenshots again → verify/reels/studio/.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './lib.mjs';

const OUT = join(ROOT, 'verify', 'reels', 'studio');
mkdirSync(OUT, { recursive: true });
const PORT = 5301;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [join(ROOT, 'scripts', 'reel', 'studio.mjs')], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, STUDIO_NO_OPEN: '1', STUDIO_PORT: String(PORT) } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/studio.html`)).ok) break; } catch { /* wait */ } await wait(400); }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  for (const [w, h] of [[1920, 1080], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => console.log('  [page]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
    await page.goto(`http://localhost:${PORT}/studio.html`);
    await page.waitForFunction(() => /bpm/.test(document.querySelector('.st-status')?.textContent ?? ''), null, { timeout: 120000 });
    await wait(800);
    await page.screenshot({ path: join(OUT, `studio-${w}x${h}.png`) });
    if (w === 1920) {
      await page.click('.st-transport .s-btn');
      await wait(9000);
      await page.screenshot({ path: join(OUT, 'studio-preview.png') });
      // Formats
      await page.click('text=beat switch'); await wait(500);
      await page.screenshot({ path: join(OUT, 'studio-beatswitch.png') });
      await page.click('text=styles tour'); await wait(500);
      await page.screenshot({ path: join(OUT, 'studio-tour.png') });
    }
    await page.close();
    console.log(`shot ${w}x${h}`);
  }
  await browser.close();
} finally { kill(); }

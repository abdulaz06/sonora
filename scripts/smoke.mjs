#!/usr/bin/env node
// Smoke test of the web build's flow: first run → menu → style detail →
// visual → menu, plus settings and the quick switcher. Exits 1 on failure.
//   npm run test:smoke        (uses :5199 like the harness: never run both)
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SONORA_HARNESS_PORT || 5199);
const base = `http://localhost:${PORT}/web.html`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const check = (name, ok) => { steps.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch { /* not yet */ } await wait(400); }
  browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL || 'msedge', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const visible = (sel) => page.locator(sel).first().isVisible();
  const running = () => page.evaluate(() => !document.body.classList.contains('scr-overlay'));

  // First run.
  await page.goto(`${base}?fresh=1&nolaunch=1`);
  await page.waitForSelector('.scr-intro', { timeout: 20000 });
  check('first run shows the intro', await visible('.scr-intro'));
  await page.click('text=Begin');
  await page.waitForSelector('text=play something now.');
  check('audio check step', await visible('.big-meter'));
  await page.click('text=Skip intro');
  await page.waitForSelector('.scr-menu:not([hidden])', { timeout: 5000 });
  check('intro → menu', await visible('.scr-menu'));
  check('engine paused on the menu', !(await running()));

  // Menu → detail → visual → menu.
  await page.goto(`${base}?fresh=1&onboarded=1&nolaunch=1&demo=1`);
  await page.waitForSelector('.scr-menu:not([hidden])');
  check('eleven style cards', (await page.locator('.scard').count()) === 11);
  await page.click('.scard:nth-child(2)');
  await page.waitForSelector('.scr-detail:not([hidden])');
  check('detail opens for silk', (await page.textContent('.scr-detail .nm')) === 'silk');
  // The view row is the last two-option group (Silk's looks are two options too since Helix).
  await page.locator('.scr-detail .opts.two').last().locator('.s-thumb').first().click();
  check('picking a view updates the preview', (await page.textContent('.stage-cap .s-label'))?.includes('Depth') ?? false);
  await page.click('text=Start');
  await page.waitForSelector('.hud:not([hidden])', { timeout: 5000 });
  await wait(1200);
  check('start → visual with the engine running', await running());
  check('silk is on screen', (await page.textContent('.hud .n-style')) === 'silk');
  await page.mouse.move(400, 400);
  await page.click('.hud-bar .now');
  check('quick switcher opens', await visible('.qs.open'));
  await page.keyboard.press('Escape');
  await page.mouse.click(800, 200);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.scr-menu:not([hidden])', { timeout: 5000 });
  check('esc → menu, engine paused', !(await running()));

  // Settings + (i).
  await page.click('.topbar >> text=Settings');
  await page.waitForSelector('.s-sheet.is-open');
  await page.click('.s-sheet .s-info >> nth=0');
  await page.waitForSelector('.s-pop.is-open');
  check('settings and (i) card open', await visible('.s-pop.is-open'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Set Mode card starts the visual with Set Mode on.
  await wait(500);
  await page.click('.dock .setmode');
  await page.waitForSelector('.hud:not([hidden])', { timeout: 5000 });
  check('set mode card → visual with set mode on', (await page.getAttribute('.hud-bar .s-btn[title^="Set Mode"]', 'aria-pressed')) === 'true');

  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
} catch (e) {
  check(`threw: ${e.message}`, false);
} finally {
  await browser?.close();
  kill();
}
const failed = steps.filter(([, ok]) => !ok).length;
console.log(failed ? `${failed} failed` : 'smoke test passed');
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Controller (second screen) review in the browser: the output (web.html) and
// the controller (controller.html) in two tabs of one browser, linked exactly
// as the two app windows are (BroadcastChannel). Saves screenshots at laptop
// sizes to verify/controller/ and checks the link both ways plus the preview's
// frame rate and latency.
//
//   node scripts/controller-check.mjs [--sizes 1366x768,1440x900,1920x1080] [--cover test/twotone-01-30-270.jpg] [--headed]
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CONTROLLER_PORT || 5204);
const OUT = join(ROOT, 'verify', 'controller');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SIZES = opt('sizes', '1366x768,1440x900,1920x1080').split(',').map((s) => s.split('x').map(Number));
const COVER = opt('cover', 'test/twotone-01-30-270.jpg');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-controller' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);
const results = {};
const check = (ok, what, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); results[what] = { ok, detail }; };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await wait(400); }
  const browser = await chromium.launch({ channel: 'msedge', headless: !argv.includes('--headed'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const out = await ctx.newPage();
  await out.setViewportSize({ width: 1920, height: 1080 });
  out.on('pageerror', (e) => console.log('  [output]', e.message));
  await out.goto(`http://localhost:${PORT}/web.html?onboarded=1&nolaunch=1&demo=1&fresh=1&screen=visual&track=house-124&t=48`);
  await out.waitForFunction(() => !!window.__sonoraDev, null, { timeout: 60000 });
  await wait(1500);
  await out.evaluate(async (f) => {
    const blob = await fetch(`/local-media/covers/${f}`).then((r) => r.blob());
    const art = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    window.__sonoraDev.nowPlaying({ title: 'Two Tone', artist: 'Test Artist', album: 'Synthetic', art });
  }, COVER);

  const ctl = await ctx.newPage();
  ctl.on('pageerror', (e) => console.log('  [controller]', e.message));
  await ctl.setViewportSize({ width: SIZES[0][0], height: SIZES[0][1] });
  await ctl.goto(`http://localhost:${PORT}/controller.html`);
  // The output tab must keep rendering while the controller tab is in front.
  await out.bringToFront();
  await ctl.waitForFunction(() => document.querySelector('.ctl-main:not(.is-waiting)'), null, { timeout: 20000 });
  check(true, 'controller linked to the output');
  await wait(4000);
  const stats = await ctl.evaluate(() => window.__ctlStats);
  check(stats.fps >= 20 && stats.fps <= 30, 'preview 20–30 fps', `${stats.fps} fps`);
  check(stats.lag < 150, 'preview latency < 150 ms', `${Math.round(stats.lag)} ms`);

  // Controller → output: pick palette 3 (Ember); the output's settings change (and album colours go off).
  await ctl.click('.ctl-pals .s-thumb:has-text("3 Ember")');
  await wait(800);
  const saved = await out.evaluate(() => JSON.parse(localStorage.getItem('sonora.web.settings') || '{}'));
  check(saved.paletteIndex === 2 && saved.albumColours === false, 'controller → output: palette', `palette ${saved.paletteIndex}, album ${saved.albumColours}`);
  // Output → controller: a shortcut on the output (S, next style) shows in the controller.
  const before = await ctl.evaluate(() => document.querySelector('.ctl-styles .s-thumb[aria-pressed="true"] .s-thumb-title')?.textContent);
  await out.keyboard.press('s');
  await wait(700);
  const after = await ctl.evaluate(() => document.querySelector('.ctl-styles .s-thumb[aria-pressed="true"] .s-thumb-title')?.textContent);
  check(before !== after, 'output → controller: style', `${before} → ${after}`);
  // A key pressed in the controller acts on the output (V: next look / view).
  const d0 = await ctl.evaluate(() => document.querySelector('.ctl-desc')?.textContent);
  await ctl.keyboard.press('s');
  await wait(800);
  const d1 = await ctl.evaluate(() => document.querySelector('.ctl-desc')?.textContent);
  check(d0 !== d1, 'controller keys act on the output', `${d0} → ${d1}`);
  // Back to album colours from the controller.
  await ctl.click('.ctl-pals .album-thumb');
  await wait(600);

  for (const [w, hgt] of SIZES) {
    await ctl.setViewportSize({ width: w, height: hgt });
    await out.bringToFront();
    await wait(1800);
    await ctl.evaluate(() => { document.querySelector('.ctl-right').scrollTop = 0; });
    await ctl.screenshot({ path: join(OUT, `controller-${w}x${hgt}.png`) });
    console.log(`shot controller-${w}x${hgt}.png`);
  }
  // Blackout and freeze from the controller.
  await ctl.click('.ctl-actions .s-btn:has-text("Blackout")');
  await out.bringToFront();
  await wait(1200);
  await ctl.screenshot({ path: join(OUT, 'controller-blackout.png') });
  await ctl.click('.ctl-actions .s-btn:has-text("Back from black")');
  await wait(600);
  // The settings sheet, reused.
  // (The controller tab must be in front for the sheet's open animation.)
  await ctl.bringToFront();
  await ctl.click('text=All settings');
  await wait(1200);
  await ctl.screenshot({ path: join(OUT, 'controller-settings.png') });
  await ctl.keyboard.press('Escape');
  // The one-time offer.
  const offer = await ctx.newPage();
  await offer.setViewportSize({ width: 1366, height: 768 });
  await offer.goto(`http://localhost:${PORT}/controller.html?offer=1`);
  await out.bringToFront();
  await wait(2500);
  await offer.screenshot({ path: join(OUT, 'controller-offer.png') });
  // Closing the controller never touches the output.
  const t0 = await out.evaluate(() => performance.now());
  await ctl.close(); await offer.close();
  await wait(4500);
  const alive = await out.evaluate(() => ({ canvas: !!document.getElementById('canvas'), hud: !document.querySelector('.hud')?.hidden }));
  check(alive.canvas && alive.hud, 'closing the controller leaves the output running');
  void t0;
  await browser.close();
  writeFileSync(join(OUT, 'check.json'), JSON.stringify(results, null, 1));
} finally { kill(); }

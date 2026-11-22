#!/usr/bin/env node
// UI screenshot review: renders the web build's screens at 1920×1080,
// 1366×768 and 2560×1440 into verify/ui/<state>-<w>x<h>.png.
//   node scripts/ui-shots.mjs [state…]       (states: see STATES)
// Uses :5199 like the verify harness: never run both at once.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SONORA_HARNESS_PORT || 5199);
const SIZES = (process.env.UI_SIZES || '1920x1080,1366x768,2560x1440').split(',').map((s) => s.split('x').map(Number));
const OUT = join(ROOT, 'verify', 'ui');
const base = `http://localhost:${PORT}/web.html`;
const q = 'onboarded=1&nolaunch=1&demo=1&fresh=1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Simulate a media session with a cover from local-media/covers (album colours). */
const cover = async (p, file, title = 'Two Tone', artist = 'Test Artist') => {
  await p.waitForFunction(() => !!window.__sonoraDev);
  await p.evaluate(async ([f, t, a]) => {
    const blob = await fetch(`/local-media/covers/${f}`).then((r) => r.blob());
    const art = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    window.__sonoraDev.nowPlaying({ title: t, artist: a, album: 'Synthetic', art });
  }, [file, title, artist]);
};

const STATES = {
  'visual-album': { url: `${base}?${q}&screen=visual&track=house-124&t=48`, after: 3000, act: async (p) => { await cover(p, process.env.UI_COVER || 'test/twotone-01-30-270.jpg'); await wait(3600); } },
  'visual-quick-album': { url: `${base}?${q}&screen=visual&track=house-124&t=48`, after: 3000, act: async (p) => { await cover(p, process.env.UI_COVER || 'test/twotone-01-30-270.jpg'); await wait(3000); await p.mouse.move(500, 500); await p.click('.hud-bar .now'); await wait(900); } },
  'settings-album': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => { await cover(p, process.env.UI_COVER || 'test/twotone-01-30-270.jpg'); await wait(800); await p.click('text=Settings'); await wait(700); await p.click('.st-nav button:nth-child(2)'); await wait(900); } },
  'settings-album-none': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => { await p.click('text=Settings'); await wait(700); await p.click('.st-nav button:nth-child(2)'); await wait(900); } },
  'settings-album-info': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => { await cover(p, process.env.UI_COVER || 'test/twotone-01-30-270.jpg'); await wait(800); await p.click('text=Settings'); await wait(700); await p.click('.st-nav button:nth-child(2)'); await wait(700); await p.click('.st-row:has-text("Colours from album art") .s-info'); await wait(900); } },
  menu: { url: `${base}?${q}&screen=menu`, after: 1600 },
  'menu-voyage': { url: `${base}?${q}&screen=menu`, after: 1400, act: async (p) => { await p.hover('.scard:nth-child(5)'); await wait(1400); } },
  'detail-ink': { url: `${base}?${q}&screen=detail&style=ink`, after: 1400 },
  'menu-stage': { url: `${base}?${q}&screen=menu`, after: 1400, act: async (p) => { await p.hover('.scard:nth-child(6)'); await wait(1400); } },
  'detail-stage': { url: `${base}?${q}&screen=detail&style=stage`, after: 1600 },
  'detail-memory': { url: `${base}?${q}&screen=detail&style=memory`, after: 2400 },
  'settings-filter': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => { await p.click('text=Settings'); await wait(700); await p.click('.st-nav button:has-text("filter")'); await wait(900); } },
  'settings-filter-info': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => { await p.click('text=Settings'); await wait(700); await p.click('.st-nav button:has-text("filter")'); await wait(700); await p.click('.st-row:has-text("Filter") .s-info'); await wait(900); } },
  'detail-wisp': { url: `${base}?${q}&screen=detail&style=wisp`, after: 1400 },
  'detail-voyage': { url: `${base}?${q}&screen=detail&style=voyage`, after: 1400 },
  'detail-warp': { url: `${base}?${q}&screen=detail&style=warp`, after: 1400 },
  settings: { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => { await p.click('text=Settings'); await wait(900); } },
  'settings-info': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => {
    await p.click('text=Settings'); await wait(700);
    await p.evaluate(() => document.querySelectorAll('.s-sheet .st-sec')[3]?.scrollIntoView());
    await wait(300);
    await p.click('.s-sheet .st-sec:nth-of-type(4) .s-info'); await wait(900);
  } },
  'settings-colour': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => {
    await p.click('text=Settings'); await wait(700);
    await p.click('.st-nav button:nth-child(2)'); await wait(900);
  } },
  'settings-perf': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => {
    await p.click('text=Settings'); await wait(700);
    await p.click('.st-nav button:has-text("performance")'); await wait(900);
  } },
  'settings-fps-info': { url: `${base}?${q}&screen=menu`, after: 1000, act: async (p) => {
    await p.click('text=Settings'); await wait(700);
    await p.click('.st-nav button:has-text("performance")'); await wait(700);
    await p.click('.st-row:has-text("Frame rate") .s-info'); await wait(900);
  } },
  'visual-fps': { url: `${base}?${q}&screen=visual&track=house-124&t=48`, after: 5000, act: async (p) => { await p.keyboard.press('p'); await wait(2500); } },
  'intro-1': { url: `${base}?nolaunch=1&fresh=1`, after: 1400 },
  'intro-2': { url: `${base}?nolaunch=1&fresh=1&demo=1`, after: 900, act: async (p) => { await p.click('text=Begin'); await wait(1500); } },
  'intro-3': { url: `${base}?nolaunch=1&fresh=1`, after: 900, act: async (p) => { await p.click('text=Begin'); await wait(400); await p.click('text=Not now'); await wait(1400); } },
  'intro-4': { url: `${base}?nolaunch=1&fresh=1`, after: 900, act: async (p) => { await p.click('text=Begin'); await wait(300); await p.click('text=Not now'); await wait(300); await p.click('text=Next'); await wait(1400); } },
  visual: { url: `${base}?${q}&screen=visual&track=house-124&t=48`, after: 6000, act: async (p) => { await p.mouse.move(400, 400); await p.mouse.move(500, 500); await wait(300); } },
  'visual-quick': { url: `${base}?${q}&screen=visual&track=house-124&t=48`, after: 5000, act: async (p) => { await p.mouse.move(500, 500); await p.click('.hud-bar .now'); await wait(900); } },
  launch: { url: `${base}?onboarded=1&fresh=1`, after: 900 },
  kit: { url: `http://localhost:${PORT}/kit.html`, after: 1200 },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STATES);
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch { /* not yet */ } await wait(400); }
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  for (const [w, hgt] of SIZES) {
    for (const n of names) {
      const st = STATES[n];
      if (!st) { console.log(`unknown state ${n}`); continue; }
      const page = await browser.newPage({ viewport: { width: w, height: hgt } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(st.url);
      await wait(st.after);
      if (st.act) await st.act(page);
      await page.screenshot({ path: join(OUT, `${n}-${w}x${hgt}.png`) });
      console.log(`${n} ${w}x${hgt}${errors.length ? `  ERRORS: ${errors.slice(0, 3).join(' | ')}` : ''}`);
      await page.close();
    }
  }
  await browser.close();
} finally { kill(); }

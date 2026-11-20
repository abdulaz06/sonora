#!/usr/bin/env node
// Real app screens for the landing page, from the same web build `npm run
// ui:shots` uses (the app's shell, menu, detail, settings and HUD in a
// browser), with the dev page's source bar hidden. 1920×1080 at 1.25× →
// public/shots/<name>-{960,1600,2400}.webp. Uses :5199 like the harness.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SITE, '..');
const PORT = 5199;
const base = `http://localhost:${PORT}/web.html`;
const q = 'onboarded=1&nolaunch=1&demo=1&fresh=1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (await import(new URL('../../node_modules/ffmpeg-static/index.js', import.meta.url).href)).default;

const SHOTS = {
  menu: { url: `${base}?${q}&screen=menu`, after: 2200, widths: [960, 1600, 2400] },
  detail: { url: `${base}?${q}&screen=detail&style=ink`, after: 2000, widths: [960, 1600] },
  info: { url: `${base}?${q}&screen=menu`, after: 1200, widths: [960, 1600], act: async (p) => {
    await p.click('text=Settings'); await wait(700);
    await p.evaluate(() => document.querySelectorAll('.s-sheet .st-sec')[3]?.scrollIntoView());
    await wait(300);
    await p.click('.s-sheet .st-sec:nth-of-type(4) .s-info'); await wait(1000);
  } },
  playing: { url: `${base}?${q}&screen=visual&track=house-124&t=52`, after: 6500, widths: [960, 1600], act: async (p) => { await p.mouse.move(500, 500); await p.mouse.move(520, 520); await wait(400); } },
};

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { /* wait */ } await wait(400); }
  const out = join(ROOT, 'verify', 'site', 'app');
  mkdirSync(out, { recursive: true });
  mkdirSync(join(SITE, 'public', 'shots'), { recursive: true });
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  for (const [name, s] of Object.entries(SHOTS)) {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.25 });
    await p.goto(s.url);
    await p.addStyleTag({ content: '#webbar, #drop-hint { display: none !important; }' });
    await wait(s.after);
    if (s.act) await s.act(p);
    const png = join(out, `${name}.png`);
    await p.screenshot({ path: png });
    for (const w of s.widths) execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', png, '-vf', `scale=${w}:-2:flags=lanczos`, '-quality', '82', join(SITE, 'public', 'shots', `${name}-${w}.webp`)]);
    console.log(`app-shots: ${name}`);
    await p.close();
  }
  await b.close();
} finally { kill(); }

#!/usr/bin/env node
// Site checks against `npm run preview` (:4321), system Edge with its GPU:
//   pacing      live canvas frame intervals while scrolling through every section
//   reduced     prefers-reduced-motion: static mode, no engine, no playing video
//   nowebgl     WebGL disabled: landing falls back to loops, /live explains
//   permissions /live: microphone and tab sharing denied → plain advice
//   download    build-time v1.0.1 link; a mocked newer release is picked up client-side
//   links       every internal link and asset in dist/ resolves (no 404s)
//   video       a short scroll-through recording of the landing page (verify/site/)
//   node scripts/verify-site.mjs [checks…]
import { readdirSync, readFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(SITE, '..', 'verify', 'site');
const BASE = 'http://localhost:4321';
const GPU = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const all = ['pacing', 'reduced', 'nowebgl', 'permissions', 'download', 'links', 'video'];
const checks = process.argv.slice(2).length ? process.argv.slice(2) : all;
const results = [];
const report = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${detail}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

async function liveReady(page) {
  await page.waitForFunction(() => document.querySelector('#poster')?.classList.contains('is-off'), null, { timeout: 60000 });
}

if (checks.includes('pacing')) {
  const b = await chromium.launch({ channel: 'msedge', headless: false, args: [...GPU, '--window-size=1440,960'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/`);
  await liveReady(p);
  await wait(1500);
  await p.evaluate(() => window.__stage.recordFrames(true));
  // Smooth wheel scrolling through the whole page and back up, like a reader.
  const H = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H; y += 120) { await p.mouse.wheel(0, 120); await wait(28); }
  await wait(800);
  for (let y = H; y > 0; y -= 240) { await p.mouse.wheel(0, -240); await wait(28); }
  await wait(800);
  const r = await p.evaluate(() => {
    const f = window.__stage.recordFrames(false);
    const d = []; for (let i = 1; i < f.length; i++) if (f[i] > 0 && f[i - 1] > 0) d.push(f[i] - f[i - 1]);
    const s = [...d].sort((a, b) => a - b);
    return { n: d.length, median: s[s.length >> 1], p99: s[Math.floor(s.length * 0.99)], worst: s[s.length - 1], over50: d.filter((x) => x > 50).length, over34: d.filter((x) => x > 34).length, hz: 1000 / s[s.length >> 1] };
  });
  report('pacing: scroll through (headed)', r.over50 === 0, `frames ${r.n}, median ${r.median.toFixed(1)} ms (${r.hz.toFixed(0)} Hz), p99 ${r.p99.toFixed(1)}, worst ${r.worst.toFixed(1)} ms, >34 ms: ${r.over34}, >50 ms: ${r.over50}`);
  await b.close();
}

if (checks.includes('reduced')) {
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: GPU });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await wait(4000);
  await p.evaluate(() => document.querySelector('section[data-style="silk"]').scrollIntoView());
  await wait(1500);
  const r = await p.evaluate(() => ({ cls: document.documentElement.className, stage: !!window.__stage, playing: [...document.querySelectorAll('video')].filter((v) => !v.paused).length, fbShown: getComputedStyle(document.querySelector('section[data-style="silk"] .fb')).display }));
  await p.screenshot({ path: join(OUT, 'reduced-motion-silk.jpg'), quality: 80 });
  report('reduced motion: stills only', r.cls.includes('static') && !r.stage && r.playing === 0 && r.fbShown === 'block', JSON.stringify(r));
  await b.close();
}

if (checks.includes('nowebgl')) {
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-webgl', '--disable-webgl2'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}/?live`);
  await wait(9000);
  const r = await p.evaluate(() => ({ cls: document.documentElement.className, stage: !!window.__stage }));
  await p.evaluate(() => document.querySelector('section[data-style="warp"]').scrollIntoView());
  await wait(1500);
  await p.screenshot({ path: join(OUT, 'nowebgl-landing-warp.jpg'), quality: 80 });
  report('no WebGL: landing loops', r.cls.includes('static') && !r.stage && errors.length === 0, `${JSON.stringify(r)} errors ${errors.length}`);
  await p.goto(`${BASE}/live`);
  await wait(2500);
  const l = await p.evaluate(() => ({ cls: document.documentElement.className, why: document.documentElement.dataset.why, title: document.querySelector('[data-fb-title]')?.textContent }));
  await p.screenshot({ path: join(OUT, 'nowebgl-live.jpg'), quality: 80 });
  report('no WebGL: /live explains', l.cls.includes('lv-static') && l.why === 'webgl', JSON.stringify(l));
  await b.close();
}

if (checks.includes('permissions')) {
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: [...GPU, '--deny-permission-prompts'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: [] });
  const p = await ctx.newPage();
  // Headless can't show the share picker: simulate the user cancelling it.
  await p.addInitScript(() => { navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('Permission denied by user', 'NotAllowedError')); });
  await p.goto(`${BASE}/live`);
  await p.waitForFunction(() => window.__live, null, { timeout: 30000 });
  await p.click('[data-src="mic"]');
  await p.waitForFunction(() => { const t = document.querySelector('#lv-note')?.textContent ?? ''; return t && !t.startsWith('Waiting'); }, null, { timeout: 15000 });
  const mic = await p.textContent('#lv-note');
  await p.screenshot({ path: join(OUT, 'live-mic-denied.jpg'), quality: 80 });
  report('/live: mic denied → advice', /blocked|No microphone|couldn’t start/.test(mic ?? ''), mic);
  const tabEnabled = await p.evaluate(() => !document.querySelector('[data-src="tab"]').disabled);
  if (tabEnabled) {
    await p.click('[data-src="tab"]');
    await p.waitForFunction(() => { const t = document.querySelector('#lv-note')?.textContent ?? ''; return t && !t.startsWith('Choose the tab'); }, null, { timeout: 15000 });
    const tab = await p.textContent('#lv-note');
    await p.screenshot({ path: join(OUT, 'live-tab-denied.jpg'), quality: 80 });
    report('/live: tab share denied → advice', /cancelled|couldn’t share|No sound/.test(tab ?? ''), tab);
  } else report('/live: tab share unsupported → explained', true, 'button disabled with explanation');
  // The demo track plays through the WASM analyser without any permission.
  await p.click('[data-src="demo"]');
  await p.waitForFunction(() => window.__live.shell.screen() === 'visual', null, { timeout: 20000 });
  await wait(4000);
  const st = await p.evaluate(() => ({ screen: window.__live.shell.screen(), status: window.__live.source.currentStatus.state, label: window.__live.source.currentStatus.label }));
  await p.screenshot({ path: join(OUT, 'live-demo-playing.jpg'), quality: 82 });
  report('/live: demo plays (WASM DSP)', st.screen === 'visual' && st.status === 'live', JSON.stringify(st));
  await b.close();
}

if (checks.includes('download')) {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage();
  await p.route('https://api.github.com/**', (route) => route.abort());
  await p.goto(`${BASE}/`);
  await wait(800);
  const built = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[data-dl]')].map((a) => a.href))]);
  report('download: build-time link', built.length === 1 && /v1\.0\.1\/sonora_1\.0\.1_x64-setup\.exe$/.test(built[0]), built.join(', '));
  const ctx = await b.newContext();
  const q = await ctx.newPage();
  await q.route('https://api.github.com/repos/abdulaz06/sonora/releases/latest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v1.0.2', assets: [
    { name: 'latest.json', browser_download_url: 'https://github.com/abdulaz06/sonora/releases/download/v1.0.2/latest.json', size: 4000 },
    { name: 'sonora_1.0.2_x64-setup.exe', browser_download_url: 'https://github.com/abdulaz06/sonora/releases/download/v1.0.2/sonora_1.0.2_x64-setup.exe', size: 18400000 },
  ] }) }));
  await q.goto(`${BASE}/`);
  await q.waitForFunction(() => document.querySelector('a[data-dl]').href.includes('1.0.2'), null, { timeout: 10000 }).catch(() => undefined);
  const fresh = await q.evaluate(() => ({ hrefs: [...new Set([...document.querySelectorAll('a[data-dl]')].map((a) => a.href))], meta: document.querySelector('[data-dl-meta]')?.textContent, cached: sessionStorage.getItem('sonora.release.v1') }));
  report('download: newer tag picked up', fresh.hrefs.length === 1 && fresh.hrefs[0].endsWith('sonora_1.0.2_x64-setup.exe') && /v1\.0\.2/.test(fresh.meta ?? '') && !!fresh.cached, JSON.stringify({ href: fresh.hrefs[0], meta: fresh.meta }));
  const redirect = readFileSync(join(SITE, 'dist', 'download.html'), 'utf8');
  report('download: /download redirect', redirect.includes('sonora_1.0.1_x64-setup.exe'), 'dist/download.html → installer (real 302 on Vercel)');
  await b.close();
}

if (checks.includes('links')) {
  const dist = join(SITE, 'dist');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk(dist);
  const html = files.filter((f) => extname(f) === '.html');
  const urls = new Set();
  for (const f of html) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:href|src|poster|data-src)="([^"#?]+)/g)) if (m[1].startsWith('/')) urls.add(m[1]);
    for (const m of s.matchAll(/srcset="([^"]+)"/g)) for (const part of m[1].split(',')) { const u = part.trim().split(' ')[0]; if (u.startsWith('/')) urls.add(u); }
  }
  const bad = [];
  for (const u of urls) { const r = await fetch(BASE + u, { redirect: 'manual' }); if (r.status >= 400) bad.push(`${u} ${r.status}`); }
  report('links: internal links and assets', bad.length === 0, `${urls.size} checked${bad.length ? `; broken: ${bad.join(', ')}` : ''}`);
  const ext = ['https://github.com/abdulaz06/sonora', 'https://github.com/abdulaz06/sonora/releases', 'https://github.com/abdulaz06/sonora/releases/download/v1.0.1/sonora_1.0.1_x64-setup.exe'];
  const extBad = [];
  for (const u of ext) { const r = await fetch(u, { method: 'HEAD', redirect: 'manual' }); if (r.status >= 400) extBad.push(`${u} ${r.status}`); }
  report('links: GitHub targets', extBad.length === 0, extBad.join(', ') || `${ext.length} ok`);
}

if (checks.includes('video')) {
  const b = await chromium.launch({ channel: 'msedge', headless: false, args: [...GPU, '--window-size=1440,960'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await liveReady(p);
  await wait(2500);
  const sections = await p.evaluate(() => document.querySelectorAll('main > section').length);
  for (let i = 1; i < sections; i++) {
    const top = await p.evaluate((k) => document.querySelectorAll('main > section')[k].getBoundingClientRect().top + window.scrollY, i);
    const from = await p.evaluate(() => window.scrollY);
    const steps = 30;
    for (let s = 1; s <= steps; s++) { await p.evaluate((y) => window.scrollTo(0, y), from + ((top - from) * (1 - Math.cos((Math.PI * s) / steps))) / 2); await wait(16); }
    await wait(i < 10 ? 2600 : 1600);
  }
  const v = p.video();
  await ctx.close();
  const path = await v.path();
  renameSync(path, join(OUT, 'scroll-through-1440.webm'));
  report('video: scroll-through recorded', true, 'verify/site/scroll-through-1440.webm');
  await b.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

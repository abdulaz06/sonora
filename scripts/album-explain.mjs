#!/usr/bin/env node
// The album-colours (i) card pictures: a synthetic cover (never a real album:
// the app ships these) and the visual painted in the palette the app extracts
// from it. Writes src/assets/media/explain-album-cover-640.webp and
// explain-album-640.webp.
//   node scripts/album-explain.mjs [cover=local-media/covers/test/gradient-05-sunset.jpg]
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ALBUM_PORT || 5206);
const cover = process.argv[2] || join(ROOT, 'local-media', 'covers', 'test', 'gradient-05-sunset.jpg');
const MEDIA = join(ROOT, 'src', 'assets', 'media');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-album' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await wait(400); }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/web.html?harness=1`);
  await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
  const url = `data:image/jpeg;base64,${readFileSync(cover).toString('base64')}`;
  const ex = await page.evaluate((u) => window.__sonora.albumExtract(u), url);
  if (!ex.resolved) throw new Error(`no palette from ${cover} (${ex.kind})`);
  await page.evaluate(() => window.__sonora.configure({ style: 'ink', variant: 'glow', depth: true, quality: 'high', drift: false, camera: 'glide' }));
  await page.evaluate((r) => window.__sonora.setPalette({ resolved: r }), ex.resolved);
  await page.evaluate(() => window.__sonora.loadTrack('house-124'));
  await page.evaluate(() => window.__sonora.analyseOnly(36));
  for (let k = 0; k < 6; k++) await page.evaluate(() => window.__sonora.advance(1, 1 / 60));
  // A few moments; keep the one where the cover's second colour shows most (both colours visible).
  const shots = [];
  for (let k = 0; k < 10; k++) {
    await page.evaluate(() => window.__sonora.advance(1.5, 1 / 60));
    shots.push(await page.evaluate(() => window.__sonora.snapshot('image/png')));
  }
  const acc = ex.resolved.accent.map((v) => v * 255);
  const pri = ex.resolved.primary.map((v) => v * 255);
  let best = 0, bestScore = -1;
  for (const [k, s] of shots.entries()) {
    const score = await page.evaluate(async ([u, cols]) => {
      const img = new Image(); img.src = u; await img.decode();
      const c = document.createElement('canvas'); c.width = 160; c.height = 90;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 160, 90);
      const d = g.getImageData(0, 0, 160, 90).data;
      const n = cols.map(() => 0);
      for (let i = 0; i < d.length; i += 4) {
        const m = Math.max(d[i], d[i + 1], d[i + 2]);
        if (m < 70) continue;
        cols.forEach((a, j) => {
          const k = m / Math.max(...a);
          if (Math.abs(d[i] - a[0] * k) + Math.abs(d[i + 1] - a[1] * k) + Math.abs(d[i + 2] - a[2] * k) < 70) n[j]++;
        });
      }
      return Math.min(...n);
    }, [s, [pri, acc]]);
    if (score > bestScore) { bestScore = score; best = k; }
  }
  writeFileSync(join(ROOT, 'verify', 'album-explain.png'), Buffer.from(shots[best].split(',')[1], 'base64'));
  // The cover on Night, 16:9 like every (i) picture.
  const html = `<html><body style="margin:0;width:1280px;height:720px;background:#08080A;display:grid;place-items:center"><img src="${url}" style="height:560px;width:560px;object-fit:cover;outline:1px solid rgba(236,231,223,.12)"></body></html>`;
  await page.setContent(html);
  await wait(300);
  await page.screenshot({ path: join(ROOT, 'verify', 'album-explain-cover.png') });
  await browser.close();
  const ff = (await import('ffmpeg-static')).default;
  for (const [src, dst] of [['album-explain.png', 'explain-album-640.webp'], ['album-explain-cover.png', 'explain-album-cover-640.webp']]) {
    execFileSync(ff, ['-y', '-loglevel', 'error', '-i', join(ROOT, 'verify', src), '-vf', 'scale=640:-2:flags=lanczos', '-quality', '82', join(MEDIA, dst)]);
  }
  const man = JSON.parse(readFileSync(join(MEDIA, 'manifest.json'), 'utf8'));
  const src = { track: 'house-124', time: 56, palette: 'album:' + cover.split(/[\\/]/).pop(), light: 'auto', camera: 'glide', quality: 'high', responsiveness: 0.6 };
  man.assets['explain-album'] = { kind: 'explain', style: 'ink', look: 'glow', view: 'depth', stills: { 640: 'explain-album-640.webp' }, loop: null, loopSeconds: null, source: src };
  man.assets['explain-album-cover'] = { kind: 'explain', style: null, look: null, view: null, stills: { 640: 'explain-album-cover-640.webp' }, loop: null, loopSeconds: null, source: { cover: cover.split(/[\\/]/).pop() } };
  writeFileSync(join(MEDIA, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
  console.log(`(i) pictures from ${cover}: ${ex.kind}, hues ${JSON.stringify(ex.hues)}`);
} finally { kill(); }

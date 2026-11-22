#!/usr/bin/env node
// Album colours test set: extracts every cover exactly as the app does (the
// harness page decodes, downscales and clusters it) and writes
//   verify/album/extract.json  every cover: kind, hues, clusters, palette
//   verify/album/set.json      the palettes, for scripts/palette-matrix.mjs --set
//
//   node scripts/album-set.mjs [cover dirs…]   (default local-media/covers/test + local-media/covers)
// Real covers stay in local-media/ (git-ignored); only numbers and sheets land in verify/.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ALBUM_PORT || 5202);
const OUT = process.env.ALBUM_OUT || join(ROOT, 'verify', 'album');
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [join(ROOT, 'local-media', 'covers', 'test'), join(ROOT, 'local-media', 'covers')];
mkdirSync(OUT, { recursive: true });

const covers = [];
for (const d of dirs) {
  if (!existsSync(d)) continue;
  const real = !d.replace(/\\/g, '/').endsWith('/test');
  for (const f of readdirSync(d).sort()) {
    if (!/\.(jpe?g|png|webp)$/i.test(f)) continue;
    covers.push({ name: `${real ? 'real' : 'syn'}-${basename(f, extname(f))}`.replace(/[^\w-]+/g, '_'), file: join(d, f), real });
  }
}
console.log(`${covers.length} covers`);

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-album' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`http://localhost:${PORT}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
  await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
  const results = [];
  for (const c of covers) {
    const mime = /\.png$/i.test(c.file) ? 'image/png' : /\.webp$/i.test(c.file) ? 'image/webp' : 'image/jpeg';
    const url = `data:${mime};base64,${readFileSync(c.file).toString('base64')}`;
    const r = await page.evaluate((u) => window.__sonora.albumExtract(u), url);
    results.push({ ...c, ...r });
    const h = r.hues ? [r.hues.primary, r.hues.secondary, r.hues.accent].map((x) => (x === undefined || x === null ? '–' : `${Math.round(x)}°`)).join(' ') : '';
    console.log(`${c.name.padEnd(34)} ${r.kind.padEnd(7)} ${h}`);
  }
  await browser.close();
  writeFileSync(join(OUT, 'extract.json'), JSON.stringify(results, null, 1));
  const set = results.filter((r) => r.resolved).map((r) => ({ name: r.name, resolved: r.resolved }));
  writeFileSync(join(OUT, 'set.json'), JSON.stringify(set, null, 1));
  console.log(`palettes: ${set.length} of ${results.length} (the rest fall back to the chosen palette) → ${join(OUT, 'set.json')}`);
} finally { kill(); }

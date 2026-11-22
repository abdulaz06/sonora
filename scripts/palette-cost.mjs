#!/usr/bin/env node
// Frame cost, before vs after: two checkouts served side by side, measured in
// alternating rounds on one GPU (1080p, Medium, house-124 drop, synced cost).
//   node scripts/palette-cost.mjs <before checkout dir> [rounds=3]
import { spawn, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEFORE = process.argv[2];
const ROUNDS = Number(process.argv[3] || 3);
const COMBOS = [
  ['ink', 'glow', true], ['ink', 'glow', false], ['ink', 'marble', true], ['ink', 'sumi', true],
  ['silk', 'silk', false], ['wisp', 'ground', false], ['wisp', 'ground', true], ['wisp', 'tunnel', true],
  ['warp', 'warp', false], ['voyage', 'void', false], ['voyage', 'city', false], ['voyage', 'ocean', false],
];
const servers = [];
function serve(cwd, port, cache) {
  const s = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: cache } });
  servers.push(s);
}
const kill = () => servers.forEach((s) => { try { execFileSync('taskkill', ['/pid', String(s.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } });
process.on('exit', kill);
async function up(port) {
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`http://localhost:${port}/web.html`)).ok) return; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  throw new Error(`no server on ${port}`);
}
serve(BEFORE, 5193, 'node_modules/.vite-cost-before');
serve(ROOT, 5192, 'node_modules/.vite-cost-after');
await up(5193); await up(5192);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
async function cost(port, [style, look, depth]) {
  await page.goto(`http://localhost:${port}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
  await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
  await page.evaluate((c) => window.__sonora.configure({ style: c[0], variant: c[1], depth: c[2], quality: 'medium', palette: 0, drift: false }), [style, look, depth]);
  await page.evaluate(() => window.__sonora.loadTrack('house-124'));
  await page.evaluate(() => window.__sonora.analyseOnly(46));
  await page.evaluate(() => window.__sonora.advance(3, 1 / 60));
  return page.evaluate(() => window.__sonora.frameCost(120, 1 / 60));
}
const res = {};
for (let r = 0; r < ROUNDS; r++) {
  for (const c of COMBOS) {
    const key = `${c[0]} ${c[1]} ${c[2] ? 'depth' : 'flat'}`;
    const order = r % 2 ? [['after', 5192], ['before', 5193]] : [['before', 5193], ['after', 5192]];
    for (const [tag, port] of order) ((res[key] ??= { before: [], after: [] })[tag]).push(await cost(port, c));
  }
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const [k, v] of Object.entries(res)) console.log(`${k.padEnd(22)} before ${med(v.before).toFixed(2)} ms  after ${med(v.after).toFixed(2)} ms  (${(med(v.after) - med(v.before) >= 0 ? '+' : '')}${(med(v.after) - med(v.before)).toFixed(2)})`);
await browser.close();
kill();

// Dev helper: snapshots of one style at given track times.
// node scripts/snapshots.mjs <style> <track> <t1> <t2> ...  → verify/snap-<style>-<t>.png
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [style, track, ...times] = process.argv.slice(2);
const server = spawn('npx', ['vite', '--port', String(process.env.SONORA_HARNESS_PORT || 5199), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${process.env.SONORA_HARNESS_PORT || 5199}/web.html`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: Number(process.env.SNAP_W || 960), height: Number(process.env.SNAP_H || 540) } });
  p.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 600)); });
  p.on('pageerror', (e) => console.log('  [page exception]', e.message.slice(0, 600)));
  await p.goto(`http://localhost:${process.env.SONORA_HARNESS_PORT || 5199}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
  await p.waitForFunction(() => window.__sonora?.ready === true);
  await p.evaluate(([s, v, d]) => window.__sonora.configure({ style: s, variant: v || undefined, depth: d === '' ? undefined : d === '1', drift: false }), [style, process.env.SNAP_LOOK || '', process.env.SNAP_DEPTH ?? '']);
  if (process.env.SNAP_COVER) {
    const { readFileSync } = await import('node:fs');
    const ext = process.env.SNAP_COVER.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    await p.evaluate((u) => window.__sonora.setCover(u), `data:image/${ext};base64,${readFileSync(process.env.SNAP_COVER).toString('base64')}`);
  }
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  let now = 0;
  for (const ts of times) {
    const t = Number(ts);
    await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [t - now, 1 / 30]);
    now = t;
    const u = await p.evaluate(() => window.__sonora.snapshot());
    writeFileSync(`verify/snap-${style}${process.env.SNAP_LOOK ? '-' + process.env.SNAP_LOOK : ''}${process.env.SONORA_FILTER ? '-' + process.env.SONORA_FILTER.replace(/:/g, '-') : ''}-${ts}.png`, Buffer.from(u.split(',')[1], 'base64'));
    if (process.env.SNAP_COST) console.log(`t=${ts} frame cost ${(await p.evaluate(() => window.__sonora.frameCost(90, 1 / 60))).toFixed(2)} ms`);
  }
  await b.close();
} finally { kill(); }

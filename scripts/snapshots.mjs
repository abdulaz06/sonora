// Dev helper: snapshots of one style at given track times.
// node scripts/snapshots.mjs <style> <track> <t1> <t2> ...  → verify/snap-<style>-<t>.png
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [style, track, ...times] = process.argv.slice(2);
const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch('http://localhost:5199/web.html')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  await p.goto('http://localhost:5199/web.html?harness=1');
  await p.waitForFunction(() => window.__sonora?.ready === true);
  await p.evaluate((s) => window.__sonora.configure({ style: s, drift: false }), style);
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  let now = 0;
  for (const ts of times) {
    const t = Number(ts);
    await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [t - now, 1 / 30]);
    now = t;
    const u = await p.evaluate(() => window.__sonora.snapshot());
    writeFileSync(`verify/snap-${style}-${ts}.png`, Buffer.from(u.split(',')[1], 'base64'));
  }
  await b.close();
} finally { kill(); }

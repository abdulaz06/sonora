// Dev helper: where the flicker gate's largest one-frame steps happen.
// Mirrors verify --flicker (dense-128 drop window at Punchy) and prints the
// biggest mean-luminance steps with their track times, plus a frame either
// side of the largest one (verify/steps-<style>-<look>-<t>-{a,b}.png).
//   node scripts/luma-steps.mjs <style> <look> [track] [flat|depth]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
const [style, look, track = 'dense-128', view = 'depth'] = process.argv.slice(2);
const PORT = process.env.SONORA_HARNESS_PORT || 5199;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', (e) => console.log('  [page exception]', e.message.slice(0, 400)));
  await p.goto(`http://localhost:${PORT}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
  await p.waitForFunction(() => window.__sonora?.ready === true);
  const meta = JSON.parse(readFileSync('test-audio/tracks.json', 'utf8'))[track];
  const start = meta.markers.drop - 1, dt = 1 / 60;
  await p.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.look, depth: o.view === 'depth', quality: 'medium', palette: 0, drift: false, responsiveness: 1 }), { style, look, view });
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  await p.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start), dt]);
  const { luma, clip } = await p.evaluate(([s, d]) => window.__sonora.exposureTrace(s, d), [12, dt]);
  let ci = 0;
  for (let i = 0; i < clip.length; i++) if (clip[i] > clip[ci]) ci = i;
  console.log(`most blown-out: t=${(start + ci * dt).toFixed(3)} clip ${(100 * clip[ci]).toFixed(1)}%`);
  const steps = luma.slice(1).map((l, i) => ({ i: i + 1, d: l - luma[i], t: start + (i + 1) * dt }));
  steps.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  for (const s of steps.slice(0, 8)) console.log(`t=${s.t.toFixed(3)} step ${s.d >= 0 ? '+' : ''}${s.d.toFixed(3)} (luma ${luma[s.i - 1].toFixed(3)} → ${luma[s.i].toFixed(3)})`);
  // Frames either side of the largest step.
  const top = process.env.CLIP ? { i: ci + 1 } : steps[0];
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  await p.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, start - 6));
  await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(6, start) + (top.i - 1) * dt, dt]);
  const a = await p.evaluate(() => window.__sonora.snapshot());
  await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [dt, dt]);
  const c = await p.evaluate(() => window.__sonora.snapshot());
  writeFileSync(`verify/steps-${style}-${look}-a.png`, Buffer.from(a.split(',')[1], 'base64'));
  writeFileSync(`verify/steps-${style}-${look}-b.png`, Buffer.from(c.split(',')[1], 'base64'));
  await b.close();
} finally { kill(); }

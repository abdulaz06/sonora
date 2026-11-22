// First-use cost (shader compile + link + resources) per style / look, cold:
// a fresh browser per combo (no program cache), timing the first rendered
// frame after the style is chosen, minus a warm frame.
//   node scripts/compile-time.mjs stage:club:flat glass:bubbles:flat ...
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
const combos = process.argv.slice(2).filter((a) => a.includes(':'));
const PORT = process.env.SONORA_HARNESS_PORT || 5199;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  for (const c of combos) {
    const [style, look, view, filter] = c.split(':');
    const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    await p.goto(`http://localhost:${PORT}/web.html?harness=1${filter ? `&filter=${filter}` : ''}`);
    await p.waitForFunction(() => window.__sonora?.ready === true);
    await p.evaluate((n) => window.__sonora.loadTrack(n), 'house-124');
    await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [1, 1 / 60]);
    const ms = await p.evaluate((o) => {
      const t0 = performance.now();
      window.__sonora.configure({ style: o.style, variant: o.look, depth: o.view === 'depth', quality: 'medium', drift: false });
      window.__sonora.frameCost(1, 1 / 60);
      const first = performance.now() - t0;
      const warm = window.__sonora.frameCost(10, 1 / 60);
      return first - warm;
    }, { style, look, view });
    console.log(`COMPILE ${c}: ${ms.toFixed(0)} ms`);
    await b.close();
  }
} finally { kill(); }

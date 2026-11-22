// Frame cost for many style / look / view / filter combos in one page (1920x1080,
// synced: step + GPU finish), at the house-124 drop, per quality. Runs each combo
// ROUNDS times interleaved and reports the median, so a busy moment on a shared
// GPU doesn't decide the number.
//   node scripts/cost.mjs silk:silk:flat stage:club:flat ... [--q low,medium] [--rounds 3] [--filter glyph]
//   combo = style:look:view[:filter]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const combos = args.filter((a) => !a.startsWith('--') && a.includes(':'));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const qualities = opt('--q', 'medium,low').split(',');
const rounds = Number(opt('--rounds', '3'));
const PORT = process.env.SONORA_HARNESS_PORT || 5199;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const results = {};
  for (let r = 0; r < rounds; r++) {
    for (const c of combos) {
      const [style, look, view, filter] = c.split(':');
      const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      p.on('pageerror', (e) => console.log('  [page exception]', e.message.slice(0, 300)));
      await p.goto(`http://localhost:${PORT}/web.html?harness=1${filter ? `&filter=${filter}` : ''}`);
      await p.waitForFunction(() => window.__sonora?.ready === true);
      for (const q of qualities) {
        await p.evaluate((o) => window.__sonora.configure({ style: o.style, variant: o.look, depth: o.view === 'depth', quality: o.q, palette: 0, drift: false }), { style, look, view, q });
        await p.evaluate((n) => window.__sonora.loadTrack(n), 'house-124');
        await p.evaluate((s) => window.__sonora.analyseOnly(s), 44);
        await p.evaluate(([s, d]) => window.__sonora.advance(s, d), [6, 1 / 60]);
        // warm the shaders, then measure
        await p.evaluate(() => window.__sonora.frameCost(30, 1 / 60));
        const ms = await p.evaluate(() => window.__sonora.frameCost(120, 1 / 60));
        (results[`${c} ${q}`] ??= []).push(ms);
      }
      await p.close();
    }
  }
  for (const [k, v] of Object.entries(results)) {
    const s = [...v].sort((a, b) => a - b);
    console.log(`COST ${k}: median ${s[Math.floor(s.length / 2)].toFixed(2)} ms (runs ${v.map((x) => x.toFixed(2)).join(' / ')})`);
  }
  await b.close();
} finally { kill(); }

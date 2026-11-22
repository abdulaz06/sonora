// Dev helper: a contact sheet of frames every 50 ms from just before a kick,
// over ~1.2 s, to judge how a style lands and fades on the beat.
// node scripts/beat-strip.mjs <style> <look|-> <track> [kickIndex] [flat|depth] [out.png]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [style, lookArg = '-', track = 'house-124', ki = '40', view = 'flat', out = `verify/beat-strip/${style}-${lookArg}-${view}-${track}.png`] = process.argv.slice(2);
const look = lookArg === '-' ? undefined : lookArg;
const meta = JSON.parse(readFileSync('test-audio/tracks.json', 'utf8'))[track];
const kick = meta.kicks[Number(ki)];
const STEP = 3;        // frames between shots (50 ms at 60 fps)
const SHOTS = 24;
const COLS = 6;
const W = 480, H = 270;

const server = spawn('npx', ['vite', '--port', String(process.env.SONORA_HARNESS_PORT || 5199), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: process.env.SONORA_VITE_CACHE || 'node_modules/.vite-verify' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${process.env.SONORA_HARNESS_PORT || 5199}/web.html`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 400)); }
  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.goto(`http://localhost:${process.env.SONORA_HARNESS_PORT || 5199}/web.html?harness=1${process.env.SONORA_FILTER ? `&filter=${process.env.SONORA_FILTER}` : ''}`);
  await p.waitForFunction(() => window.__sonora?.ready === true);
  await p.evaluate(([s, v, d]) => window.__sonora.configure({ style: s, variant: v, depth: d, drift: false }), [style, look, view === 'depth']);
  await p.evaluate((n) => window.__sonora.loadTrack(n), track);
  await p.evaluate((s) => window.__sonora.analyseOnly(s), kick - 8);
  await p.evaluate(() => window.__sonora.advance(8 - 3 / 60, 1 / 60));
  const shots = [];
  for (let f = 0; f < SHOTS; f++) {
    await p.evaluate((n) => window.__sonora.advance(n / 60, 1 / 60), STEP);
    shots.push({ url: await p.evaluate(() => window.__sonora.snapshot()), ms: Math.round(((f + 1) * STEP - 3) * 1000 / 60) });
  }
  // Compose the sheet in the page (no image deps in node).
  const sheet = await p.evaluate(async ([list, cols, w, h]) => {
    const rows = Math.ceil(list.length / cols);
    const c = document.createElement('canvas'); c.width = cols * w / 2; c.height = rows * h / 2;
    const g = c.getContext('2d');
    for (let i = 0; i < list.length; i++) {
      const img = new Image(); img.src = list[i].url; await img.decode();
      const x = (i % cols) * w / 2, y = Math.floor(i / cols) * h / 2;
      g.drawImage(img, x, y, w / 2, h / 2);
      g.fillStyle = '#0ff'; g.font = '11px monospace'; g.fillText(`k${list[i].ms >= 0 ? '+' : ''}${list[i].ms}ms`, x + 4, y + 13);
    }
    return c.toDataURL('image/png');
  }, [shots, COLS, W, H]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log(`kick ${ki} at ${kick.toFixed(3)} s → ${out}`);
  await b.close();
} finally { kill(); }

#!/usr/bin/env node
// Portrait framing check (reel studio): every style / look / view rendered in
// 9:16 at three moments of a track (build, drop, calm), next to its 16:9
// version, into verify/reels/portrait/ (+ contact sheets).
//   node scripts/reel/portrait-check.mjs [--tag base] [--portrait 0|1] [--track house-124] [--only ink-glow-depth,…]
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './lib.mjs';
import { COMBOS } from './combos.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const TAG = opt('tag', 'base');
const PORTRAIT = Number(opt('portrait', '1'));
const TRACK = opt('track', 'house-124');
const ONLY = opt('only', '');
const PORT = Number(process.env.REEL_PORT || 5208);
const OUT = join(ROOT, 'verify', 'reels', 'portrait', TAG);
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-reel' } });
const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
process.on('exit', kill);
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await wait(400); }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const combos = ONLY ? COMBOS.filter((c) => ONLY.split(',').includes(c.id)) : COMBOS;
  for (const [w, h, kind] of [[540, 960, 'portrait'], [960, 540, 'landscape']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('  [page]', e.message));
    await page.goto(`http://localhost:${PORT}/web.html?harness=1`);
    await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
    const meta = (await page.evaluate(() => window.__sonora.tracks))[TRACK];
    const shots = [['build', meta.markers.drop - 3], ['drop', meta.markers.drop + 1.2], ['calm', meta.markers.breakdown + 3]];
    for (const c of combos) {
      await page.reload();
      await page.waitForFunction(() => window.__sonora?.ready === true);
      await page.evaluate(([cc, p, k]) => window.__sonora.configure({ style: cc.style, variant: cc.variant, depth: cc.depth, light: 'auto', quality: 'high', palette: 0, drift: false, camera: cc.camera, debug: { portrait: k === 'portrait' ? p : 0 } }), [c, PORTRAIT, kind]);
      await page.evaluate((n) => window.__sonora.loadTrack(n), TRACK);
      let t = 0;
      for (const [tag, at] of shots) {
        const quiet = Math.max(0, at - t - 6);
        if (quiet > 0) await page.evaluate((s) => window.__sonora.analyseOnly(s), quiet);
        let left = at - t - quiet;
        while (left > 1e-6) { const d = Math.min(2, left); await page.evaluate(([s, dt]) => window.__sonora.advance(s, dt), [d, 1 / 60]); left -= d; }
        t = at;
        const url = await page.evaluate(() => window.__sonora.snapshot('image/jpeg', 0.9));
        writeFileSync(join(OUT, `${c.id}-${tag}-${kind}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
      }
      console.log(`${kind} ${c.id}`);
    }
    await page.close();
  }
  await browser.close();
  // Contact sheet: per combo a row of the three portrait shots, then the landscape drop.
  const py = `
import os,sys
from PIL import Image, ImageDraw
d=sys.argv[1]; combos=sys.argv[2].split(',')
rows=[]
for c in combos:
    ims=[Image.open(os.path.join(d,f'{c}-{t}-portrait.jpg')).resize((180,320)) for t in ['build','drop','calm']]
    land=Image.open(os.path.join(d,f'{c}-drop-landscape.jpg')).resize((569,320))
    row=Image.new('RGB',(180*3+12+569,344),(8,8,10))
    for k,im in enumerate(ims): row.paste(im,(k*180,24))
    row.paste(land,(552,24))
    ImageDraw.Draw(row).text((4,4),c,fill=(236,231,223))
    rows.append(row)
for p in range(0,len(rows),5):
    part=rows[p:p+5]; sheet=Image.new('RGB',(part[0].width,344*len(part)),(8,8,10))
    for k,r in enumerate(part): sheet.paste(r,(0,344*k))
    sheet.save(os.path.join(d,f'sheet-{p//5+1}.jpg'),quality=88)
`;
  execFileSync('python', ['-c', py, OUT, combos.map((c) => c.id).join(',')], { stdio: 'inherit' });
  console.log(`→ ${OUT}`);
} finally { kill(); }

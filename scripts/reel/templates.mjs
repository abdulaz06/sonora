#!/usr/bin/env node
// Launch templates (local tool):
//   node scripts/reel/templates.mjs origin     the origin-story reel: seven text cards, one per bar, over
//                                              Silk Depth then Ink Glow on the site's demo track
//   node scripts/reel/templates.mjs carousel   five 1080×1350 slides, each real frames plus a few words
// Outputs: local-media/reels/out/<date>-origin-story/ and local-media/reels/out/<date>-carousel/.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ffmpeg, REELS, ROOT } from './lib.mjs';

const BAR = 240 / 122, OFF = 0.6;          // the demo track: 122 bpm, first bar at 0.6 s
const B = (k) => +(OFF + k * BAR).toFixed(3);
const date = new Date().toISOString().slice(0, 10);
const what = process.argv[2] ?? 'origin';

const CARDS = [
  'i listen to everything at full volume.',
  'every detail, the way the artist made it.',
  'april 2026: my second monitor was doing nothing.',
  'i wanted it to show the music.',
  'i couldn’t find anything that looked right.',
  'so i built it.',
  'sonora. see your music.',
];

if (what === 'origin') {
  const { renderPlan } = await import('./render.mjs');
  // Six cards over the calm and the build on Silk Depth, the seventh on the drop over Ink Glow (two bars).
  const plan = {
    format: 'origin', track: 'demo-sonora', title: 'sonora demo', artist: 'made for sonora',
    window: { start: B(8), end: B(16) }, size: [1080, 1920], fps: 60, quality: 'high', supersample: 1.333, preroll: 8,
    shots: [
      { at: B(8), style: 'silk', variant: 'silk', depth: true, palette: 0, camera: 'planet' },
      { at: B(14), style: 'ink', variant: 'glow', depth: true, palette: 0, camera: 'glide' },
    ],
    textCards: CARDS.map((text, i) => ({ at: B(8 + i), end: i < 6 ? B(9 + i) : B(16), text })),
    text: 'none', labels: false, mark: true, nowPlaying: false,
    name: `${date}-origin-story`, genre: 'electronic',
  };
  const r = await renderPlan(plan, { draft: process.argv.includes('--draft') });
  writeFileSync(join(r.outDir, 'caption.txt'), [
    'i listen to everything at full volume. so i built the visualizer i couldn’t find.',
    'sonora: live visuals for any song, in time with every beat.',
    'free for windows · link in bio',
    '#musicvisualizer #visualizer #sonora #indiedev #windows',
    '',
  ].join('\n'));
} else if (what === 'carousel') {
  const PORT = Number(process.env.REEL_PORT || 5212);
  const W = 1080, H = 1350;
  const out = join(REELS, 'out', `${date}-carousel`);
  mkdirSync(out, { recursive: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-reel2' } });
  const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
  process.on('exit', kill);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await wait(400); }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  /** A real frame from the engine (harness, demo track, warmed up from the start). */
  async function frame(file, w, h, c, t) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${PORT}/web.html?harness=1`);
    await page.waitForFunction(() => window.__sonora?.ready === true, null, { timeout: 60000 });
    await page.evaluate((x) => window.__sonora.configure(x), { style: c.style, variant: c.variant, depth: c.depth, quality: 'high', drift: false, camera: c.camera, debug: { portrait: h > w ? 1 : 0 } });
    await page.evaluate((p) => window.__sonora.setPalette({ index: p }), c.palette ?? 0);
    await page.evaluate(() => window.__sonora.loadTrack('demo-sonora'));
    await page.evaluate((s) => window.__sonora.analyseOnly(s), Math.max(0, t - 8));
    for (let k = 0; k < 4; k++) await page.evaluate(([s, d]) => window.__sonora.advance(s, d), [Math.min(8, t) / 4, 1 / 60]);
    const url = await page.evaluate(() => window.__sonora.snapshot('image/png'));
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    await page.close();
  }
  const tmp = join(out, '_parts');
  mkdirSync(tmp, { recursive: true });
  const drop = B(14) + 1.1, drop2 = B(29) + 0.9;
  // 1 · one strong frame.
  await frame(join(tmp, 's1.png'), W, H, { style: 'ink', variant: 'glow', depth: true, camera: 'glide', palette: 0 }, drop);
  // 2 · five styles: five vertical slices of real frames.
  const five = [['silk', 'silk', true, 'planet', 7], ['ink', 'glow', true, 'glide', 0], ['wisp', 'tunnel', true, null, 3], ['warp', 'warp', false, null, 8], ['voyage', 'void', false, null, 6]];
  // (Silk away from its drop: the drop's inversion cut is a white frame.)
  const fiveAt = [B(20) + 0.6, drop, drop2, drop2 + 0.4, drop + 1.2];
  for (const [i, [style, variant, depth, camera, palette]] of five.entries()) await frame(join(tmp, `s2-${i}.png`), Math.round(W / 5), H, { style, variant, depth, camera, palette }, fiveAt[i]);
  // 3 · nine palettes: a 3 × 3 grid of Silk Depth in each.
  for (let p = 0; p < 9; p++) await frame(join(tmp, `s3-${p}.png`), W / 3, H / 3, { style: 'ink', variant: 'glow', depth: false, palette: p }, drop + 0.4);
  // 4 · works with anything: Voyage with the app's now-playing toast.
  await frame(join(tmp, 's4.png'), W, H, { style: 'voyage', variant: 'city', depth: false, palette: 0 }, drop2);
  // 5 · free for windows: Warp.
  await frame(join(tmp, 's5.png'), W, H, { style: 'silk', variant: 'silk', depth: true, camera: 'planet', palette: 2 }, drop2 + 0.6);
  // Composites for 2 and 3.
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...five.flatMap((_, i) => ['-i', join(tmp, `s2-${i}.png`)]), '-filter_complex', `${five.map((_, i) => `[${i}:v]`).join('')}hstack=inputs=5,scale=${W}:${H}[v]`, '-map', '[v]', join(tmp, 's2.png')]);
  const rows = [0, 1, 2].map((r) => `${[0, 1, 2].map((c) => `[${r * 3 + c}:v]`).join('')}hstack=inputs=3[r${r}]`).join(';');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...Array.from({ length: 9 }, (_, p) => ['-i', join(tmp, `s3-${p}.png`)]).flat(), '-filter_complex', `${rows};[r0][r1][r2]vstack=inputs=3,scale=${W}:${H}[v]`, '-map', '[v]', join(tmp, 's3.png')]);
  // Words (the overlay page, house style), composited.
  const slides = [
    { n: 1, text: 'live visuals for any song, in time with every beat' },
    { n: 2, text: 'five styles', sub: 'silk · ink · wisp · warp · voyage' },
    { n: 3, text: 'nine palettes, or your album’s colours' },
    { n: 4, text: 'works with spotify, youtube, anything you play' },
    { n: 5, text: 'free for windows', sub: 'or try it in your browser · sonoravisuals.com' },
  ];
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/reel-overlay.html`);
  await page.waitForFunction(() => !!window.__overlay);
  for (const s of slides) {
    await page.evaluate((l) => window.__overlay.render(l), { kind: 'slide', text: s.text, sub: s.sub });
    await page.screenshot({ path: join(tmp, `t${s.n}.png`), omitBackground: true });
  }
  // Slide 4 also carries the app's own now-playing toast.
  // A synthetic cover (never a real album on a public slide).
  const art = `data:image/jpeg;base64,${readFileSync(join(ROOT, 'local-media', 'covers', 'test', 'gradient-05-sunset.jpg')).toString('base64')}`;
  await page.evaluate((l) => window.__overlay.render(l), { kind: 'toast', title: 'Night Drive', artist: 'Lumen Field', album: 'Low Light', art });
  await page.screenshot({ path: join(tmp, 'toast.png'), omitBackground: true });
  await browser.close();
  kill();
  for (const s of slides) {
    // A gentle dark scrim behind the words keeps them readable on any frame (Night, not a gradient: a flat band).
    const extra = s.n === 4 ? ['-i', join(tmp, 'toast.png')] : [];
    const fc = `[0:v]drawbox=x=0:y=ih*0.68:w=iw:h=ih*0.32:color=0x08080A@0.55:t=fill[b];[b][1:v]overlay=0:0${s.n === 4 ? '[c];[c][2:v]overlay=0:-280' : ''}[v]`;
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', join(tmp, `s${s.n}.png`), '-i', join(tmp, `t${s.n}.png`), ...extra, '-filter_complex', fc, '-map', '[v]', '-q:v', '2', join(out, `slide-${s.n}.jpg`)]);
  }
  writeFileSync(join(out, 'caption.txt'), 'sonora: live visuals for any song, in time with every beat. five styles, nine palettes, or your album’s colours.\nfree for windows · try it in your browser · link in bio\n#musicvisualizer #visualizer #sonora #windows\n');
  console.log(`carousel → ${out}`);
}

#!/usr/bin/env node
// The trailer: rendered by the engine through the verify harness (real GPU,
// audio time, fixed 1/60 s step) on the demo track, one shot per cut, each
// warmed up first so it opens already full. Cuts land on bar lines, both drops
// on a cut; ends on the lockup and "see your music.".
//
//   node scripts/trailer.mjs [--frames-only] [--encode-only]
// Frames: C:/Users/abdul/sonora-trailer-frames (outside OneDrive, deleted after).
// Master: ../local-media/sonora-trailer-1080p60.mp4 (git-ignored).
// Web: public/media/sonora-trailer.webm / .mp4 (≤ 5 MB) + poster; README WebP.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// ── Tuning ──────────────────────────────────────────────────────
const W = 1920, H = 1080, FPS = 60;
const BAR = (4 * 60) / 122;
const OFF = 0.6;
const B = (b) => OFF + b * BAR;
const START_BAR = 7;
const WARM_S = 6;
const CARD_AT = B(35);          // the last kick: the lockup comes in
const QUALITY = 'high';
const PAL = { ocean: 0, aurora: 1, ember: 2, neon: 3, crimson: 4, solar: 5, violet: 6, sunset: 7, acid: 8 };
const beat = BAR / 4;
const SHOTS = [
  { b0: 7, b1: 10, style: 'ink', variant: 'glow', depth: true, palette: PAL.ocean },
  { b0: 10, b1: 12, style: 'silk', variant: 'silk', depth: false, palette: PAL.ocean },
  { b0: 12, b1: 14, style: 'wisp', variant: 'tunnel', depth: true, palette: PAL.neon },
  { b0: 14, b1: 16, style: 'warp', variant: 'warp', depth: false, palette: PAL.ocean },          // drop
  { b0: 16, b1: 18, style: 'ink', variant: 'marble', depth: true, palette: PAL.ember },
  { b0: 18, b1: 20, style: 'silk', variant: 'silk', depth: true, palette: PAL.sunset },
  { b0: 20, b1: 22, style: 'voyage', variant: 'city', depth: false, palette: PAL.ocean },
  { b0: 22, b1: 24, style: 'voyage', variant: 'void', depth: false, palette: PAL.violet },     // breakdown
  { b0: 24, b1: 26, style: 'wisp', variant: 'ground', depth: true, palette: PAL.ember },
  { b0: 26, b1: 29, style: 'silk', variant: 'silk', depth: false, palette: PAL.aurora,         // build: the knot, and the palettes on the beat
    changes: [PAL.solar, PAL.sunset, PAL.acid, PAL.crimson, PAL.neon, PAL.violet, PAL.ocean, PAL.ember, PAL.aurora].map((p, i) => ({ at: B(26) + (i + 1) * 2 * beat, palette: p })) },
  { b0: 29, b1: 31, style: 'ink', variant: 'glow', depth: true, palette: PAL.neon },            // drop 2
  { b0: 31, b1: 33, style: 'warp', variant: 'warp', depth: false, palette: PAL.acid },
  { b0: 33, b1: 35, style: 'wisp', variant: 'tunnel', depth: true, palette: PAL.crimson },
  { b0: 35, b1: null, style: 'ink', variant: 'glow', depth: true, palette: PAL.ocean },         // tail + card
];

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SITE, '..');
const FRAMES = 'C:/Users/abdul/sonora-trailer-frames';
const MASTER_DIR = join(ROOT, 'local-media');
const PORT = 5199;
const ffmpeg = (await import(new URL('../../node_modules/ffmpeg-static/index.js', import.meta.url).href)).default;
const tracks = JSON.parse(readFileSync(join(ROOT, 'test-audio', 'tracks.json'), 'utf8'));
const END = tracks['demo-sonora'].duration;
const T0 = B(START_BAR);
const frameAt = (t) => Math.round((t - T0) * FPS);
const TOTAL = frameAt(END);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (k) => process.argv.includes(`--${k}`);

async function renderFrames() {
  mkdirSync(FRAMES, { recursive: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true, stdio: 'ignore', env: { ...process.env, SONORA_VITE_CACHE: 'node_modules/.vite-verify' } });
  const kill = () => { try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${PORT}/web.html`)).ok) break; } catch { /* wait */ } await wait(400); }
    const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
    for (const [n, s] of SHOTS.entries()) {
      const t0 = B(s.b0), t1 = s.b1 === null ? END : B(s.b1);
      const k0 = frameAt(t0), k1 = s.b1 === null ? TOTAL : frameAt(t1);
      if (existsSync(join(FRAMES, `f${String(k1 - 1).padStart(5, '0')}.jpg`))) { console.log(`shot ${n}: done`); continue; }
      const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => console.log('  page error', e.message));
      await page.goto(`http://localhost:${PORT}/web.html?harness=1`);
      await page.waitForFunction(() => window.__sonora?.ready === true);
      await page.evaluate((c) => window.__sonora.configure(c), { style: s.style, variant: s.variant, depth: s.depth, palette: s.palette, quality: QUALITY, drift: false });
      await page.evaluate(() => window.__sonora.loadTrack('demo-sonora'));
      // Audio up to the warm-up, then render the warm-up (not captured), landing exactly on frame k0.
      const tStart = T0 + k0 / FPS;
      const warm = Math.min(WARM_S, tStart);
      await page.evaluate((x) => window.__sonora.analyseOnly(x), tStart - warm);
      const warmSteps = Math.round(warm * FPS);
      for (let k = 0; k < warmSteps; k += 120) await page.evaluate(([m, d]) => window.__sonora.advance(m * d, d), [Math.min(120, warmSteps - k), 1 / FPS]);
      const changes = [...(s.changes ?? [])];
      const t = Date.now();
      for (let k = k0; k < k1; k++) {
        const now = T0 + (k + 1) / FPS;
        while (changes.length && changes[0].at <= now) { const c = changes.shift(); await page.evaluate((p) => window.__sonora.configure({ palette: p }), c.palette); }
        const url = await page.evaluate((d) => { window.__sonora.advance(d, d); return window.__sonora.snapshot('image/jpeg', 0.93); }, 1 / FPS);
        writeFileSync(join(FRAMES, `f${String(k).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
      }
      console.log(`shot ${n}: ${s.style} ${s.variant} ${s.depth ? 'depth' : 'flat'} · frames ${k0}–${k1 - 1} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
      await page.close();
    }
    await browser.close();
  } finally { kill(); }
}

async function renderCard() {
  const lockup = readFileSync(join(ROOT, 'DOCS', 'brand', 'sonora-lockup-bone.svg'), 'utf8');
  const font = readFileSync(join(ROOT, 'src', 'assets', 'fonts', 'inter-latin-opsz-normal.woff2')).toString('base64');
  const html = `<!doctype html><html><head><style>
    @font-face { font-family: Inter; src: url(data:font/woff2;base64,${font}) format('woff2-variations'); font-weight: 100 900; }
    html, body { margin: 0; width: ${W}px; height: ${H}px; background: transparent; }
    .c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 44px; }
    .c svg { width: 760px; height: auto; }
    .t { font-family: Inter; font-weight: 600; font-variation-settings: 'opsz' 32; font-size: 58px; letter-spacing: -0.03em; color: #ECE7DF; }
  </style></head><body><div class="c">${lockup}<div class="t">see your music.</div></div></body></html>`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html);
  await page.waitForTimeout(400);
  const out = join(MASTER_DIR, 'card.png');
  await page.screenshot({ path: out, omitBackground: true });
  await browser.close();
  return out;
}

function encode(card) {
  mkdirSync(MASTER_DIR, { recursive: true });
  const n = readdirSync(FRAMES).filter((f) => f.endsWith('.jpg')).length;
  const dur = n / FPS;
  const cardT = CARD_AT - T0;
  const master = join(MASTER_DIR, 'sonora-trailer-1080p60.mp4');
  const filter = [
    `[0:v]fps=${FPS},format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st=${(cardT + 0.15).toFixed(3)}:d=1.6:color=0x08080A[v]`,
    `[2:v]format=rgba,fade=t=in:st=${(cardT + 0.25).toFixed(3)}:d=0.9:alpha=1[card]`,
    `[v][card]overlay=0:0:shortest=1,format=yuv420p[out]`,
    `[1:a]afade=t=in:st=0:d=0.25,afade=t=out:st=${(dur - 0.6).toFixed(3)}:d=0.6[a]`,
  ].join(';');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(FRAMES, 'f%05d.jpg'),
    '-ss', T0.toFixed(4), '-t', dur.toFixed(4), '-i', join(ROOT, 'test-audio', 'demo-sonora.wav'),
    '-loop', '1', '-framerate', String(FPS), '-t', dur.toFixed(4), '-i', card,
    '-filter_complex', filter, '-map', '[out]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-maxrate', '28M', '-bufsize', '56M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', master], { stdio: 'inherit' });
  console.log(`master: ${master} (${(statSync(master).size / 1048576).toFixed(1)} MB, ${dur.toFixed(2)} s)`);
  return { master, dur, cardT };
}

function webEncodes({ master, cardT }) {
  const media = join(SITE, 'public', 'media');
  const webm = join(media, 'sonora-trailer.webm');
  const mp4 = join(media, 'sonora-trailer.mp4');
  const log = join(MASTER_DIR, 'vp9');
  // VP9, two-pass, 1280×720 30 fps: fits ~5 MB for a minute.
  const vp9 = ['-vf', 'scale=1280:720:flags=lanczos,fps=30', '-c:v', 'libvpx-vp9', '-b:v', '560k', '-maxrate', '900k', '-bufsize', '1800k', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '1', '-tile-columns', '2', '-g', '120', '-passlogfile', log];
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', master, ...vp9, '-pass', '1', '-an', '-f', 'webm', 'NUL']);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', master, ...vp9, '-pass', '2', '-c:a', 'libopus', '-b:a', '64k', webm]);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', master, '-vf', 'scale=1280:720:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'veryslow', '-b:v', '540k', '-maxrate', '900k', '-bufsize', '1800k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', mp4]);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', '15.5', '-i', master, '-frames:v', '1', '-vf', 'scale=1280:-2:flags=lanczos', '-quality', '80', join(media, 'trailer-poster.webp')]);
  for (const f of [webm, mp4]) console.log(`web: ${f} ${(statSync(f).size / 1048576).toFixed(2)} MB`);
  // README: an animated WebP of the drop (~9 s), under ~3 MB.
  const readme = join(ROOT, 'DOCS', 'assets', 'sonora-trailer.webp');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', (B(14) - T0 - 0.2).toFixed(3), '-t', '8', '-i', master, '-vf', 'fps=15,scale=640:-2:flags=lanczos', '-c:v', 'libwebp_anim', '-quality', '50', '-compression_level', '6', '-loop', '0', '-an', readme]);
  console.log(`readme: ${readme} ${(statSync(readme).size / 1048576).toFixed(2)} MB`);
  void cardT;
}

if (!arg('encode-only')) await renderFrames();
if (!arg('frames-only')) {
  const card = await renderCard();
  const r = encode(card);
  webEncodes(r);
  if (arg('clean')) rmSync(FRAMES, { recursive: true, force: true });
}

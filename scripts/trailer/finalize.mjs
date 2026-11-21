#!/usr/bin/env node
// Finishes a trailer master for the site, the README and YouTube:
//   node scripts/trailer/finalize.mjs <master.mp4> [--frame-at s] [--clip-at s]
// Writes
//   site/public/media/sonora-trailer.webm / .mp4 (720p30, ≤ 5 MB each, as before) + sonora-trailer-poster.webp
//   DOCS/assets/sonora-trailer.webp (silent animated WebP, ~8 s, < 3 MB)
//   local-media/youtube-thumbnail-iwonder.jpg (1280×720: a frame, the lockup and a line)
// The original demo-track trailer stays as sonora-trailer-demo.* (site.config.mjs TRAILER switches).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ffmpeg, MEDIA, ROOT } from '../reel/lib.mjs';

const master = process.argv[2];
const opt = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const FRAME_AT = opt('frame-at', 24);      // poster and thumbnail frame (s into the trailer)
const CLIP_AT = opt('clip-at', 20.7);      // README clip start
const media = join(ROOT, 'site', 'public', 'media');
const run = (args) => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

// Web: VP9 two-pass and H.264, 1280×720 at 30 fps, ~4.5 MB a minute (the budget the site already uses).
const webm = join(media, 'sonora-trailer.webm'), mp4 = join(media, 'sonora-trailer.mp4');
const log = join(MEDIA, 'trailer', 'vp9');
const vp9 = ['-vf', 'scale=1280:720:flags=lanczos,fps=30', '-c:v', 'libvpx-vp9', '-b:v', '560k', '-maxrate', '900k', '-bufsize', '1800k', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '1', '-tile-columns', '2', '-g', '120', '-passlogfile', log];
run(['-i', master, ...vp9, '-pass', '1', '-an', '-f', 'webm', 'NUL']);
run(['-i', master, ...vp9, '-pass', '2', '-c:a', 'libopus', '-b:a', '64k', webm]);
run(['-i', master, '-vf', 'scale=1280:720:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'veryslow', '-b:v', '540k', '-maxrate', '900k', '-bufsize', '1800k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', mp4]);
run(['-ss', String(FRAME_AT), '-i', master, '-frames:v', '1', '-vf', 'scale=1280:-2:flags=lanczos', '-quality', '80', join(media, 'sonora-trailer-poster.webp')]);
for (const f of [webm, mp4]) console.log(`web: ${f} ${(statSync(f).size / 1048576).toFixed(2)} MB`);

// README: an animated WebP (silent), under ~3 MB.
const readme = join(ROOT, 'DOCS', 'assets', 'sonora-trailer.webp');
run(['-ss', String(CLIP_AT), '-t', '8', '-i', master, '-vf', 'fps=15,scale=640:-2:flags=lanczos', '-c:v', 'libwebp_anim', '-quality', '50', '-compression_level', '6', '-loop', '0', '-an', readme]);
console.log(`readme: ${readme} ${(statSync(readme).size / 1048576).toFixed(2)} MB`);

// YouTube thumbnail: the og template (a real frame, the lockup and a line on a Night block).
const frame = join(MEDIA, 'trailer', 'thumb-frame.jpg');
run(['-ss', String(FRAME_AT), '-i', master, '-frames:v', '1', '-q:v', '2', frame]);
const b64 = (p) => readFileSync(p).toString('base64');
const lockup = readFileSync(join(ROOT, 'DOCS', 'brand', 'sonora-lockup-bone.svg'), 'utf8');
const inter = b64(join(ROOT, 'src', 'assets', 'fonts', 'inter-latin-opsz-normal.woff2'));
const mono = b64(join(ROOT, 'src', 'assets', 'fonts', 'ibm-plex-mono-latin-500-normal.woff2'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.setContent(`<!doctype html><html><head><style>
  @font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format('woff2-variations'); font-weight: 100 900; }
  @font-face { font-family: Mono; src: url(data:font/woff2;base64,${mono}) format('woff2'); font-weight: 500; }
  html, body { margin: 0; width: 1280px; height: 720px; background: #08080A; overflow: hidden; }
  .bg { position: absolute; inset: 0; background: url(data:image/jpeg;base64,${b64(frame)}) center / cover; }
  .card { position: absolute; left: 56px; bottom: 56px; background: #08080A; padding: 34px 38px 30px; border: 1px solid rgba(236,231,223,0.12); }
  .card svg { width: 300px; height: auto; display: block; }
  .line { font-family: Inter; font-weight: 600; font-variation-settings: 'opsz' 32; font-size: 52px; letter-spacing: -0.035em; color: #ECE7DF; margin-top: 22px; line-height: 1; }
  .sub { font-family: Mono; font-weight: 500; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(236,231,223,0.62); margin-top: 18px; }
</style></head><body><div class="bg"></div><div class="card">${lockup}<div class="line">see your music.</div><div class="sub">trailer · music: kanye west — i wonder</div></div></body></html>`);
await page.waitForTimeout(300);
const thumb = join(MEDIA, 'youtube-thumbnail-iwonder.jpg');
await page.screenshot({ path: thumb, type: 'jpeg', quality: 88 });
await browser.close();
console.log(`thumbnail: ${thumb}`);

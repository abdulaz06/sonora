#!/usr/bin/env node
// Small before/after images for /engineering, cut from the review material the
// sprints produced (DOCS/reference/ink-bugs/ is in git; verify/ is local).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SITE, '..');
const ffmpeg = (await import(new URL('../../node_modules/ffmpeg-static/index.js', import.meta.url).href)).default;
const out = (n) => join(SITE, 'public', 'eng', n);
const jobs = [
  ['DOCS/reference/ink-bugs/spawn-pop-0058-f339-350.jpg', 'crop=iw:ih/2:0:0,scale=1400:-2:flags=lanczos', 'pop-evidence.webp'],
  ['DOCS/reference/ink-bugs/jagged-lines-0057-f120-127.jpg', 'scale=1400:-2:flags=lanczos', 'jagged-evidence.webp'],
  ['verify/ink-fix/stills/marble-depth-60-vs-165.png', 'scale=1400:-2:flags=lanczos', 'marble-60-165.webp'],
  ['verify/palettes/review/voyage-before-after.jpg', 'crop=640:540:130:50,scale=1000:-2:flags=lanczos', 'voyage-palettes.webp'],
  ['verify/palettes/review/before-after.jpg', 'scale=1600:-2:flags=lanczos', 'palettes-before-after.webp'],
];
for (const [src, vf, name] of jobs) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', join(ROOT, src), '-vf', vf, '-quality', '80', out(name)]);
  console.log(`eng: ${name}`);
}

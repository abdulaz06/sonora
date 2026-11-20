#!/usr/bin/env node
// Build-time demo assets (git-ignored outputs, regenerated on every build):
//   public/demo/frames.bin   quantised analysis frames of the demo track (real DSP, WASM build)
//   public/demo/demo.webm    the track, Opus (Chrome, Edge, Firefox)
//   public/demo/demo.m4a     the track, AAC (Safari)
//   src/generated/demo.json  frame count, events, sections (for the page and checks)
// Needs: the WASM package (npm --prefix .. run build:wasm) and ffmpeg-static
// (root devDependency). Skips work whose output is newer than its inputs
// unless --force.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Tuning ──────────────────────────────────────────────────────
const OPUS_KBPS = 64;
const AAC_KBPS = 80;

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SITE, '..');
const force = process.argv.includes('--force');
const WAV = join(ROOT, 'test-audio', 'demo-sonora.wav');
const TRACKS = join(ROOT, 'test-audio', 'tracks.json');
const PKG = join(ROOT, 'src', 'audio', 'wasm-pkg');
const OUT = join(SITE, 'public', 'demo');
const GEN = join(SITE, 'src', 'generated');
mkdirSync(OUT, { recursive: true });
mkdirSync(GEN, { recursive: true });

const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });

const GEN_SCRIPT = join(ROOT, 'scripts', 'gen-test-audio.mjs');
if (force || !existsSync(WAV) || mtime(GEN_SCRIPT) > mtime(WAV)) {
  console.log('demo: generating test audio');
  run('node', [GEN_SCRIPT], { cwd: ROOT });
}
if (!existsSync(join(PKG, 'sonora_dsp_bg.wasm'))) {
  console.log('demo: building the WASM analyser');
  run('npm', ['run', 'build:wasm'], { cwd: ROOT });
}

const bin = join(OUT, 'frames.bin');
const json = join(GEN, 'demo.json');
const recorder = join(SITE, 'scripts', 'record-demo.ts');
const inputs = Math.max(mtime(WAV), mtime(join(PKG, 'sonora_dsp_bg.wasm')), mtime(recorder), mtime(join(SITE, 'src', 'lib', 'demo-format.ts')), mtime(join(ROOT, 'src', 'engine', 'events.ts')));
if (force || mtime(bin) < inputs || !existsSync(json)) {
  const bundle = join(SITE, 'node_modules', '.cache', 'record-demo.mjs');
  mkdirSync(dirname(bundle), { recursive: true });
  const esbuild = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  run(esbuild, [recorder, '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`, '--log-level=warning']);
  run('node', [bundle, WAV, PKG, bin, json, TRACKS]);
}

// Audio: exactly the analysed loop (frames × hop samples), so audio and frames loop together.
const meta = JSON.parse(readFileSync(json, 'utf8'));
const ffmpeg = (await import(new URL('../../node_modules/ffmpeg-static/index.js', import.meta.url).href)).default;
const secs = (meta.samples / meta.sampleRate).toFixed(6);
for (const [file, args] of [
  ['demo.webm', ['-c:a', 'libopus', '-b:a', `${OPUS_KBPS}k`, '-vbr', 'on', '-application', 'audio']],
  ['demo.m4a', ['-c:a', 'aac', '-b:a', `${AAC_KBPS}k`, '-movflags', '+faststart']],
]) {
  const out = join(OUT, file);
  if (!force && mtime(out) > mtime(bin)) continue;
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', WAV, '-t', secs, '-ac', '1', ...args, out], { stdio: 'inherit' });
  console.log(`demo: ${file} ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
writeFileSync(join(GEN, 'demo-files.json'), JSON.stringify({
  frames: statSync(bin).size, webm: statSync(join(OUT, 'demo.webm')).size, m4a: statSync(join(OUT, 'demo.m4a')).size,
}));

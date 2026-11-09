#!/usr/bin/env node
// Proves the desktop (native) and browser (WASM) analysers emit the same
// frames for the same audio. Runs the native example and the WASM build over
// a test track and compares every frame field by field.
//
//   npm run check:parity -- [track] [frames]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const track = process.argv[2] ?? 'house-124';
const maxFrames = Number(process.argv[3] ?? 3000);
// Frames are rounded to 3 decimals; libm differences between MSVC and wasm
// can flip a value across a rounding boundary, so allow one quantum.
const TOLERANCE = 1.0001e-3;

const wavPath = join(ROOT, 'test-audio', `${track}.wav`);

// ── Native ──
const nativeOut = execFileSync(
  'cargo',
  ['run', '-q', '-p', 'sonora-dsp', '--example', 'analyze_wav', '--release', '--', wavPath, String(maxFrames)],
  { cwd: ROOT, maxBuffer: 1 << 30, encoding: 'utf8' },
);
const native = nativeOut.trim().split('\n').map((l) => JSON.parse(l));

// ── WASM ──
const pkg = await import(new URL('../src/audio/wasm-pkg/sonora_dsp.js', import.meta.url).href);
pkg.initSync({ module: readFileSync(join(ROOT, 'src/audio/wasm-pkg/sonora_dsp_bg.wasm')) });
const { sampleRate, mono } = decodeWav(readFileSync(wavPath));
const an = new pkg.WasmAnalyzer(sampleRate);
const hop = an.hop();
const wasm = [];
for (let i = 0; i < mono.length && wasm.length < maxFrames; i += hop) {
  an.push(mono.subarray(i, Math.min(i + hop, mono.length)));
  let j;
  while ((j = an.nextFrameJson()) !== undefined) wasm.push(JSON.parse(j));
}

// ── Compare ──
let worst = 0; let worstPath = ''; let mismatches = 0;
function walk(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') {
    const d = Math.abs(a - b);
    if (d > worst) { worst = d; worstPath = path; }
    if (d > TOLERANCE) mismatches++;
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { mismatches++; return; }
    a.forEach((v, i) => walk(v, b[i], `${path}[${i}]`));
  } else if (a && b && typeof a === 'object') {
    for (const k of Object.keys(a)) walk(a[k], b[k], `${path}.${k}`);
  } else if (a !== b) { mismatches++; }
}
const n = Math.min(native.length, wasm.length);
for (let i = 0; i < n; i++) walk(native[i], wasm[i], `frame[${i}]`);

console.log(`track=${track} native=${native.length} wasm=${wasm.length} compared=${n}`);
console.log(`max |diff| = ${worst.toExponential(2)} at ${worstPath || '-'}; fields over ${TOLERANCE}: ${mismatches}`);
if (native.length !== wasm.length || mismatches > 0) {
  console.error('PARITY FAILED');
  process.exit(1);
}
console.log('PARITY OK');

function decodeWav(b) {
  let pos = 12; let channels = 1; let rate = 44100;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4); const size = b.readUInt32LE(pos + 4); const body = pos + 8;
    if (id === 'fmt ') { channels = b.readUInt16LE(body + 2); rate = b.readUInt32LE(body + 4); }
    if (id === 'data') {
      const frames = size / (2 * channels); const out = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) acc += b.readInt16LE(body + (f * channels + c) * 2) / 32768;
        out[f] = acc / channels;
      }
      return { sampleRate: rate, mono: out };
    }
    pos += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

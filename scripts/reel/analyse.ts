// Song analysis for the reel studio and the trailer planner: the whole song
// through the real DSP crate (its WebAssembly build, as the site's demo
// recorder) and the shared analysis (src/export/analysis.ts, also used by the
// app's Export screen), from the very start. Writes <cache>/<slug>.analysis.json.
// Bundled and run by scripts/reel/lib.mjs (analyse()).
//
//   node <bundle> <wav> <wasm-pkg dir> <out.json> <title>
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { analyseFrames } from '../../src/export/analysis';
import type { AudioFeatureFrame } from '../../src/types/audio-frame';

const [wavPath, pkgDir, outPath, title] = process.argv.slice(2);

function decodeWav(buf: Buffer): { sampleRate: number; mono: Float32Array } {
  let p = 12, sampleRate = 44100, channels = 1, bits = 16;
  let data: Buffer | null = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4); const len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(p + 10); sampleRate = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); }
    if (id === 'data') data = buf.subarray(p + 8, p + 8 + Math.min(len, buf.length - p - 8));
    p += 8 + len + (len % 2);
  }
  if (!data || bits !== 16) throw new Error('expected 16-bit PCM');
  const n = Math.floor(data.length / 2 / channels);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2); mono[i] = s / channels / 32768; }
  return { sampleRate, mono };
}

const pkg = await import(pathToFileURL(`${pkgDir}/sonora_dsp.js`).href);
pkg.initSync({ module: readFileSync(`${pkgDir}/sonora_dsp_bg.wasm`) });
const { sampleRate, mono } = decodeWav(readFileSync(wavPath));
const an = new pkg.WasmAnalyzer(sampleRate);
const hop: number = an.hop();
const frames: AudioFeatureFrame[] = [];
for (let i = 0; i + hop <= mono.length; i += hop) {
  an.push(mono.subarray(i, i + hop));
  let j: string | undefined;
  while ((j = an.nextFrameJson()) !== undefined) frames.push(JSON.parse(j) as AudioFeatureFrame);
}
const a = analyseFrames(frames, mono, sampleRate, title);
writeFileSync(outPath, JSON.stringify(a));
console.log(`${title}: ${a.duration.toFixed(1)} s, ${a.bpm.toFixed(1)} bpm, ${a.bars.length} bars, events ${a.events.filter((e) => e.type !== 'bigHit').map((e) => `${e.type}@${e.t.toFixed(1)}`).join(' ')}`);

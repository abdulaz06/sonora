// Runs the demo track through the real DSP crate (the WebAssembly build the
// browser uses) and writes the quantised frame stream the site plays back.
// Bundled and run by scripts/prepare-demo.mjs.
//
// The track is analysed twice in a row and the second pass is kept, so the
// analyser's adaptive state at the loop point is what looping playback hears
// (the end's silence then the start reads as a track change, as it should).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EventDetector } from '../../src/engine/events';
import type { AudioFeatureFrame } from '../../src/types/audio-frame';
import { decodeDemo, encodeDemo, FIELDS, type DemoEvent } from '../src/lib/demo-format';

const [wavPath, pkgDir, outBin, outJson, tracksJson] = process.argv.slice(2);

function decodeWav(buf: Buffer): { sampleRate: number; mono: Float32Array } {
  let p = 12, sampleRate = 44100, channels = 1, bits = 16;
  let data: Buffer | null = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4); const len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(p + 10); sampleRate = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); }
    if (id === 'data') data = buf.subarray(p + 8, p + 8 + len);
    p += 8 + len + (len % 2);
  }
  if (!data || bits !== 16) throw new Error('expected 16-bit PCM');
  const n = data.length / 2 / channels;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2); mono[i] = s / channels / 32768; }
  return { sampleRate, mono };
}

const pkg = await import(pathToFileURL(`${pkgDir}/sonora_dsp.js`).href);
pkg.initSync({ module: readFileSync(`${pkgDir}/sonora_dsp_bg.wasm`) });
const { sampleRate, mono } = decodeWav(readFileSync(wavPath));
const an = new pkg.WasmAnalyzer(sampleRate);
const hop: number = an.hop();
const nFrames = Math.floor(mono.length / hop);
const loop = mono.subarray(0, nFrames * hop);

const all: AudioFeatureFrame[] = [];
for (let pass = 0; pass < 2; pass++) {
  for (let i = 0; i < loop.length; i += hop) {
    an.push(loop.subarray(i, i + hop));
    let j: string | undefined;
    while ((j = an.nextFrameJson()) !== undefined) all.push(JSON.parse(j) as AudioFeatureFrame);
  }
}
const second = all.slice(all.length - nFrames);

// Events as looping playback sees them: run the event layer over pass 1 then
// pass 2 (dequantised, exactly what the site feeds the engine).
const meta = JSON.parse(readFileSync(tracksJson, 'utf8'))['demo-sonora'];
const encodedOnce = encodeDemo(second, { fps: 60, sampleRate, samples: loop.length, events: [], kicks: meta.kicks, sections: meta.sections });
const q = decodeDemo(encodedOnce.buffer.slice(encodedOnce.byteOffset, encodedOnce.byteOffset + encodedOnce.byteLength) as ArrayBuffer).frames;
const det = new EventDetector();
const events: DemoEvent[] = [];
let frameIdx = 0;
det.on((e) => { if (frameIdx >= nFrames) events.push({ type: e.type, t: +((frameIdx - nFrames + 1) / 60).toFixed(3), strength: +e.strength.toFixed(2) }); });
for (const f of [...q, ...q]) { det.process(f); frameIdx++; }
// Same, unquantised, to prove quantisation does not change the events.
const det2 = new EventDetector();
const raw: DemoEvent[] = [];
frameIdx = 0;
det2.on((e) => { if (frameIdx >= nFrames) raw.push({ type: e.type, t: +((frameIdx - nFrames + 1) / 60).toFixed(3), strength: +e.strength.toFixed(2) }); });
for (const f of [...second, ...second]) { det2.process(f); frameIdx++; }
console.log("raw:", raw.map((e) => `${e.type}@${e.t}`).join(" "));
const same = raw.length === events.length && raw.every((e, i) => e.type === events[i].type && Math.abs(e.t - events[i].t) < 0.1);

const bin = encodeDemo(second, { fps: 60, sampleRate, samples: loop.length, events, kicks: meta.kicks, sections: meta.sections });
writeFileSync(outBin, bin);
let worst = 0, worstName = '';
FIELDS.forEach((fd) => { for (let i = 0; i < nFrames; i++) { const d = Math.abs(fd.get(second[i]) - fd.get(q[i])); if (d > worst) { worst = d; worstName = fd.name; } } });
writeFileSync(outJson, JSON.stringify({ frames: nFrames, seconds: +(nFrames / 60).toFixed(3), sampleRate, samples: loop.length, bytes: bin.length, events, kicks: meta.kicks, sections: meta.sections, eventsMatchUnquantised: same, worstError: { field: worstName, value: +worst.toFixed(5) } }, null, 1));
console.log(`demo: ${nFrames} frames (${(nFrames / 60).toFixed(2)} s), ${(bin.length / 1024).toFixed(0)} KB; events ${events.map((e) => `${e.type}@${e.t}`).join(' ')}; quantised events ${same ? 'match' : 'DIFFER from'} unquantised (worst error ${worst.toFixed(4)} in ${worstName})`);

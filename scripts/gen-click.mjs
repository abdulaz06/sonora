#!/usr/bin/env node
// Click track for A/V sync checks: test-audio/click-120.wav, 48 kHz stereo,
// 2 s of silence, then a 3 ms click every 0.5 s (120 bpm) for the rest of the
// track, slightly irregular (±40 ms) so clicks and flashes pair unambiguously.
// Click times are written next to it (click-120.json).
import { writeFileSync, mkdirSync } from 'node:fs';
const SR = 48000, SECS = Number(process.argv[2] ?? 40);
const n = SR * SECS;
const pcm = new Int16Array(n * 2);
const times = [];
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let t = 2; t < SECS - 0.5; t += 0.5) {
  const at = t + (rnd() - 0.5) * 0.08;
  const i0 = Math.round(at * SR);
  times.push(+(i0 / SR).toFixed(6));
  for (let k = 0; k < SR * 0.003; k++) {
    const v = Math.round((rnd() * 2 - 1) * 26000 * Math.exp(-k / (SR * 0.0008)));
    pcm[(i0 + k) * 2] = v; pcm[(i0 + k) * 2 + 1] = v;
  }
}
const buf = Buffer.alloc(44 + pcm.byteLength);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.byteLength, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(pcm.byteLength, 40);
Buffer.from(pcm.buffer).copy(buf, 44);
mkdirSync('test-audio', { recursive: true });
writeFileSync('test-audio/click-120.wav', buf);
writeFileSync('test-audio/click-120.json', JSON.stringify({ sampleRate: SR, clicks: times }));
console.log(`test-audio/click-120.wav: ${SECS} s, ${times.length} clicks`);

// Song analysis for the reel studio and the trailer planner: the whole song
// through the real DSP crate (its WebAssembly build, as the site's demo
// recorder) and the app's event layer, from the very start. Writes
//   <cache>/<slug>.analysis.json
// with per-frame curves (60 fps), waveform peaks, a beat and bar grid, the
// events (builds, drops, breakdowns, big hits), sections, and suggested windows.
// Bundled and run by scripts/reel/lib.mjs (analyse()).
//
//   node <bundle> <wav> <wasm-pkg dir> <out.json> <title>
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EventDetector } from '../../src/engine/events';
import type { AudioFeatureFrame } from '../../src/types/audio-frame';

const [wavPath, pkgDir, outPath, title] = process.argv.slice(2);
const FPS = 60;
/** Waveform peaks per second (the strip). */
const PEAKS_PER_S = 100;
/** Window lengths the studio offers and suggests (s). */
const WINDOWS = [15, 20, 30];

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
const n = frames.length;
const duration = mono.length / sampleRate;
const tOf = (i: number): number => (i + 1) / FPS;

// ── Events and sections (the app's event layer, from the start) ──
const det = new EventDetector();
const events: { type: string; t: number; strength: number }[] = [];
const sections: { section: string; t: number }[] = [];
let idx = 0, lastSection = '';
det.on((e) => { if (e.type !== 'trackChange') events.push({ type: e.type, t: +tOf(idx).toFixed(3), strength: +e.strength.toFixed(2) }); });
const buildProgress: number[] = [];
for (const f of frames) {
  det.process(f);
  const s = det.state.section;
  if (s !== lastSection) { sections.push({ section: s, t: +tOf(idx).toFixed(3) }); lastSection = s; }
  buildProgress.push(det.state.buildProgress);
  idx++;
}

// ── Curves ──
const q = (x: number, d = 3): number => +x.toFixed(d);
const curve = {
  intensity: frames.map((f) => q(f.intensity)),
  energy: frames.map((f) => q(Math.sqrt(Math.max(0, f.energy.instant)))),
  fade: frames.map((f) => q(f.fade_in_out, 2)),
  bass: frames.map((f) => q(Math.max(f.hits.sub_bass, f.hits.bass), 2)),
  mid: frames.map((f) => q(Math.max(f.hits.low_mid, f.hits.mid, f.hits.upper_mid), 2)),
  high: frames.map((f) => q(Math.max(f.hits.high, f.hits.air), 2)),
  build: buildProgress.map((b) => q(b, 2)),
  vocal: frames.map((f) => q(f.elements?.vocal?.presence ?? 0, 2)),
};

// ── Waveform peaks ──
const per = Math.max(1, Math.floor(sampleRate / PEAKS_PER_S));
const peaks: number[] = [];
for (let i = 0; i < mono.length; i += per) {
  let mx = 0;
  for (let k = i; k < Math.min(mono.length, i + per); k++) mx = Math.max(mx, Math.abs(mono[k]));
  peaks.push(q(mx, 3));
}

// ── Beat grid: phase wraps of the beat tracker, then a regular grid fitted
// to them (snapped locally), bars from the best-scoring downbeat. ──
const raw: number[] = [];
for (let i = 1; i < n; i++) {
  const a = frames[i - 1].beat, b = frames[i].beat;
  if (b.confidence > 0.25 && a.phase - b.phase > 0.5) {
    // Interpolate where the phase crossed 1 → 0.
    const span = 1 - a.phase + b.phase;
    raw.push(tOf(i - 1) + (span > 0 ? (1 - a.phase) / span : 0) / FPS);
  }
}
const ivs = raw.slice(1).map((t, i) => t - raw[i]).filter((d) => d > 0.25 && d < 1.5).sort((x, y) => x - y);
let T = ivs.length ? ivs[Math.floor(ivs.length / 2)] : 0.5;
// Refine T as the mean of intervals near the median (tempo of the song).
{ const near = ivs.filter((d) => Math.abs(d - T) < T * 0.08); if (near.length) T = near.reduce((a, b) => a + b, 0) / near.length; }
// Phase of the grid: circular mean of beat times modulo T.
let sx = 0, sy = 0;
for (const t of raw) { const a = (2 * Math.PI * t) / T; sx += Math.cos(a); sy += Math.sin(a); }
let t0 = ((Math.atan2(sy, sx) / (2 * Math.PI)) * T + T) % T;
// The grid, each beat snapped to a detected beat within T/5 (follows small drifts).
const beats: number[] = [];
let ri = 0;
for (let t = t0; t < duration; t += T) {
  while (ri < raw.length && raw[ri] < t - T / 5) ri++;
  const snapped = ri < raw.length && Math.abs(raw[ri] - t) < T / 5 ? raw[ri] : t;
  beats.push(q(snapped, 3));
  t0 = snapped;
  t = snapped;
}
// Downbeat: the offset (0–3) whose beats carry the most bass and the events.
const atFrame = (t: number): number => Math.max(0, Math.min(n - 1, Math.round(t * FPS) - 1));
let best = 0, bestScore = -Infinity;
for (let off = 0; off < 4; off++) {
  let s = 0;
  for (let k = off; k < beats.length; k += 4) {
    const i = atFrame(beats[k]);
    for (let d = -2; d <= 3; d++) s += curve.bass[Math.max(0, Math.min(n - 1, i + d))] ?? 0;
  }
  for (const e of events) if (e.type === 'drop' || e.type === 'breakdown') {
    const k = Math.round((e.t - beats[0]) / T);
    if (((k - off) % 4 + 4) % 4 === 0) s += 6 * e.strength;
  }
  if (s > bestScore) { bestScore = s; best = off; }
}
const bars = beats.filter((_, k) => k >= best && (k - best) % 4 === 0);
const bpm = 60 / T;

// ── Suggested windows (studio): build → release, bar-aligned ──
const mean = (a: number[], i0: number, i1: number): number => { let s = 0; for (let i = i0; i < i1; i++) s += a[i]; return s / Math.max(1, i1 - i0); };
function scoreWindow(start: number, end: number): { score: number; why: string } {
  const i0 = atFrame(start), i1 = atFrame(end);
  const inten = mean(curve.intensity, i0, i1);
  const firstHalf = mean(curve.intensity, i0, (i0 + i1) >> 1), second = mean(curve.intensity, (i0 + i1) >> 1, i1);
  const drops = events.filter((e) => e.type === 'drop' && e.t > start + 2 && e.t < end - 2);
  const hits = events.filter((e) => e.type === 'bigHit' && e.t > start && e.t < end).length;
  // A drop a quarter to a half of the way in: the build is seen, then the release.
  const dropScore = drops.reduce((s, e) => { const x = (e.t - start) / (end - start); return s + e.strength * (x > 0.2 && x < 0.6 ? 1.2 : 0.6); }, 0);
  const startQuiet = curve.fade[i0] < 0.3 ? -0.5 : 0;
  const score = inten * 1.2 + Math.max(0, second - firstHalf) * 1.5 + dropScore + Math.min(hits, 6) * 0.05 + startQuiet;
  const why = [drops.length ? `drop at ${drops.map((e) => (e.t - start).toFixed(1)).join(', ')} s` : 'no drop', `intensity ${inten.toFixed(2)}`, second > firstHalf ? 'rises' : 'steady'].join(' · ');
  return { score, why };
}
const suggestions: Record<string, { start: number; end: number; bars: number; score: number; why: string }[]> = {};
for (const L of WINDOWS) {
  const nb = Math.max(1, Math.round(L / (4 * T)));
  const cands: { start: number; end: number; bars: number; score: number; why: string }[] = [];
  for (let b = 0; b + nb < bars.length; b++) {
    const start = bars[b], end = bars[b + nb];
    if (start < 8) continue;   // the renderer warms up for 8 s before the window
    cands.push({ start, end, bars: nb, ...scoreWindow(start, end) });
  }
  cands.sort((x, y) => y.score - x.score);
  const pick: typeof cands = [];
  for (const c of cands) { if (pick.every((p) => c.end <= p.start || c.start >= p.end)) pick.push(c); if (pick.length === 3) break; }
  suggestions[L] = pick.map((p) => ({ ...p, start: q(p.start), end: q(p.end), score: q(p.score) }));
}

writeFileSync(outPath, JSON.stringify({
  title, duration: q(duration), sampleRate, fps: FPS, frames: n,
  bpm: q(bpm, 2), beatPeriod: q(T, 4), downbeatOffset: best,
  beats, bars, events, sections, suggestions, peaksPerSecond: PEAKS_PER_S, peaks, curve,
}));
console.log(`${title}: ${duration.toFixed(1)} s, ${bpm.toFixed(1)} bpm, ${bars.length} bars, events ${events.filter((e) => e.type !== 'bigHit').map((e) => `${e.type}@${e.t.toFixed(1)}`).join(' ')}`);

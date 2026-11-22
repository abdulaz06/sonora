/**
 * Whole-song analysis, shared by the app's Export screen and the reel studio
 * (scripts/reel/analyse.ts): the DSP frames of the whole song (60 per second,
 * from the very start) and its mono PCM → per-frame curves, waveform peaks, a
 * beat and bar grid, the event layer's events (builds, drops, breakdowns, big
 * hits), sections, and suggested windows.
 */

import { EventDetector } from '../engine/events';
import type { AudioFeatureFrame } from '../types/audio-frame';
import type { Analysis } from './plan-lib.mjs';

// ── Tuning ──────────────────────────────────────────────────────
const FPS = 60;
/** Waveform peaks per second (the strip). */
const PEAKS_PER_S = 100;
/** Window lengths offered and suggested (s). */
export const WINDOW_LENGTHS = [15, 20, 30, 60];
/** The event layer reports a drop a little after its hit (s). */
const DROP_LAG = 0.22;
/** Suggested windows start after this much song, so the render can warm up (s). */
const MIN_START = 8;

export interface SongAnalysis extends Analysis {
  sampleRate: number;
  frames: number;
  downbeatOffset: number;
}

/** Analyse a song from its DSP frames (in order from the song's start) and its mono PCM. */
export function analyseFrames(frames: AudioFeatureFrame[], mono: Float32Array, sampleRate: number, title: string): SongAnalysis {
  const n = frames.length;
  const duration = mono.length / sampleRate;
  const tOf = (i: number): number => (i + 1) / FPS;
  const q = (x: number, d = 3): number => +x.toFixed(d);

  // ── Events and sections (the app's event layer, from the start) ──
  const det = new EventDetector();
  const events: { type: string; t: number; strength: number; beat?: number }[] = [];
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
    const end = Math.min(mono.length, i + per);
    for (let k = i; k < end; k++) { const v = Math.abs(mono[k]); if (v > mx) mx = v; }
    peaks.push(q(mx, 3));
  }

  // ── Beat grid: phase wraps of the beat tracker, then a regular grid fitted
  // to them (snapped locally), bars from the best-scoring downbeat. ──
  const raw: number[] = [];
  for (let i = 1; i < n; i++) {
    const a = frames[i - 1].beat, b = frames[i].beat;
    if (b.confidence > 0.25 && a.phase - b.phase > 0.5) {
      const span = 1 - a.phase + b.phase;
      raw.push(tOf(i - 1) + (span > 0 ? (1 - a.phase) / span : 0) / FPS);
    }
  }
  const ivs = raw.slice(1).map((t, i) => t - raw[i]).filter((d) => d > 0.25 && d < 1.5).sort((x, y) => x - y);
  let T = ivs.length ? ivs[Math.floor(ivs.length / 2)] : 0.5;
  { const near = ivs.filter((d) => Math.abs(d - T) < T * 0.08); if (near.length) T = near.reduce((a, b) => a + b, 0) / near.length; }
  let sx = 0, sy = 0;
  for (const t of raw) { const a = (2 * Math.PI * t) / T; sx += Math.cos(a); sy += Math.sin(a); }
  let t0 = ((Math.atan2(sy, sx) / (2 * Math.PI)) * T + T) % T;
  const beats: number[] = [];
  let ri = 0;
  for (let t = t0; t < duration; t += T) {
    while (ri < raw.length && raw[ri] < t - T / 5) ri++;
    const snapped = ri < raw.length && Math.abs(raw[ri] - t) < T / 5 ? raw[ri] : t;
    beats.push(q(snapped, 3));
    t0 = snapped;
    t = snapped;
  }
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
  // Drops and breakdowns are phrase starts: the grid re-anchors there (a pickup
  // or a half bar before a drop is common), so every drop lands on a bar line.
  const nearestBeat = (t: number): number => { let k = 0, d = Infinity; beats.forEach((b, i) => { const x = Math.abs(b - t); if (x < d) { d = x; k = i; } }); return k; };
  const anchors = events.filter((e) => (e.type === 'drop' || e.type === 'breakdown') && e.strength >= 0.4).map((e) => nearestBeat(e.t - DROP_LAG)).sort((x, y) => x - y);
  const isBar = new Array<boolean>(beats.length).fill(false);
  let phase = best, from = 0;
  for (const kd of [...anchors, beats.length]) {
    for (let k = from; k < kd; k++) if (((k - phase) % 4 + 4) % 4 === 0) isBar[k] = true;
    if (kd < beats.length) { phase = kd; from = kd; }
  }
  const bars = beats.filter((_, k) => isBar[k]);
  for (const e of events) if (e.type === 'drop' || e.type === 'breakdown' || e.type === 'build') e.beat = beats[nearestBeat(e.t - DROP_LAG)];
  const bpm = 60 / T;

  // ── Suggested windows: build → release, bar-aligned ──
  const mean = (a: number[], i0: number, i1: number): number => { let s = 0; for (let i = i0; i < i1; i++) s += a[i]; return s / Math.max(1, i1 - i0); };
  const scoreWindow = (start: number, end: number): { score: number; why: string } => {
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
  };
  const suggestions: Analysis['suggestions'] = {};
  for (const L of WINDOW_LENGTHS) {
    const nb = Math.max(1, Math.round(L / (4 * T)));
    const cands: { start: number; end: number; bars: number; score: number; why: string }[] = [];
    for (let b = 0; b + nb < bars.length; b++) {
      const start = bars[b], end = bars[b + nb];
      if (start < MIN_START) continue;
      cands.push({ start, end, bars: nb, ...scoreWindow(start, end) });
    }
    cands.sort((x, y) => y.score - x.score);
    const pick: typeof cands = [];
    for (const c of cands) { if (pick.every((p) => c.end <= p.start || c.start >= p.end)) pick.push(c); if (pick.length === 3) break; }
    suggestions[String(L)] = pick.map((p) => ({ ...p, start: q(p.start), end: q(p.end), score: q(p.score) }));
  }

  return {
    title, duration: q(duration), sampleRate, fps: FPS, frames: n,
    bpm: q(bpm, 2), beatPeriod: q(T, 4), downbeatOffset: best,
    beats, bars, events, sections, suggestions, peaksPerSecond: PEAKS_PER_S, peaks, curve,
  };
}

/**
 * The song strip, shared by the app's Export screen and the reel studio: the
 * waveform, the intensity line, bar lines (every fourth stronger), the events
 * (drops as triangles, builds, breakdowns, big hits), the chosen window, a
 * marker (the beat switch's bar) and the playhead. Bone on Night only.
 */

import type { Analysis } from './plan-lib.mjs';

export interface StripState {
  window: { start: number; end: number } | null;
  playhead?: number;
  marker?: number;
}

const BONE = '236,231,223';

/** Draw the strip into `canvas` at its displayed size (device pixels). */
export function drawStrip(canvas: HTMLCanvasElement, a: Analysis, st: StripState): void {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  if (r.width < 2) return;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width, H = canvas.height, mid = H * 0.62;
  const sx = (t: number): number => (t / Math.max(1e-3, a.duration)) * W;
  g.clearRect(0, 0, W, H);
  if (st.window) { g.fillStyle = `rgba(${BONE},0.08)`; g.fillRect(sx(st.window.start), 0, sx(st.window.end) - sx(st.window.start), H); }
  a.bars.forEach((b, i) => { g.fillStyle = i % 4 === 0 ? `rgba(${BONE},0.16)` : `rgba(${BONE},0.06)`; g.fillRect(Math.round(sx(b)), 0, 1, H); });
  // Waveform
  g.fillStyle = `rgba(${BONE},0.28)`;
  const n = a.peaks.length;
  for (let x = 0; x < W; x++) {
    const i0 = Math.floor((x / W) * n), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / W) * n));
    let m = 0; for (let i = i0; i < i1; i++) m = Math.max(m, a.peaks[i]);
    const hgt = m * H * 0.32;
    g.fillRect(x, mid - hgt, 1, hgt * 2);
  }
  // Intensity
  g.strokeStyle = `rgba(${BONE},0.85)`; g.lineWidth = 1.5 * dpr; g.beginPath();
  const ci = a.curve.intensity;
  for (let x = 0; x < W; x += 2) { const v = ci[Math.min(ci.length - 1, Math.floor((x / W) * ci.length))]; const y = H * 0.36 - v * H * 0.3; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  // Events
  g.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  for (const e of a.events) {
    const x = sx(e.t);
    if (e.type === 'bigHit') { g.fillStyle = `rgba(${BONE},0.5)`; g.fillRect(x - dpr, H - 6 * dpr, 2 * dpr, 4 * dpr); continue; }
    g.fillStyle = `rgb(${BONE})`;
    if (e.type === 'drop') { g.beginPath(); g.moveTo(x, H - 2 * dpr); g.lineTo(x - 6 * dpr, H - 14 * dpr); g.lineTo(x + 6 * dpr, H - 14 * dpr); g.fill(); g.fillRect(x, 0, dpr, H - 14 * dpr); }
    else g.fillRect(x, H - 14 * dpr, dpr, 12 * dpr);
    g.fillText(e.type === 'breakdown' ? 'break' : e.type, x + 4 * dpr, 12 * dpr);
  }
  g.fillStyle = `rgb(${BONE})`;
  if (st.marker !== undefined) g.fillRect(sx(st.marker) - dpr, 0, 2 * dpr, H);
  if (st.window) { g.fillRect(sx(st.window.start), 0, dpr, H); g.fillRect(sx(st.window.end) - dpr, 0, dpr, H); }
  if (st.playhead !== undefined && st.playhead >= 0) { g.fillStyle = `rgba(${BONE},0.9)`; g.fillRect(sx(st.playhead), 0, dpr, H); }
}

/** Strip x (CSS px from its left) → song time. */
export function stripTime(canvas: HTMLCanvasElement, a: Analysis, clientX: number): number {
  const r = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(a.duration, ((clientX - r.left) / Math.max(1, r.width)) * a.duration));
}

/** CSS px between two song times on the strip (hit-testing). */
export function stripPx(canvas: HTMLCanvasElement, a: Analysis, dt: number): number {
  return (Math.abs(dt) / Math.max(1e-3, a.duration)) * canvas.getBoundingClientRect().width;
}

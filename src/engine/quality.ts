/**
 * Quality presets that change real work: render resolution, simulation size,
 * solver iterations, particle counts, mesh density and bloom depth — not just
 * post-processing values.
 *
 * `auto` starts at Medium and watches frame time: sustained slow frames step
 * down; long stretches of fast frames step back up (with a ban on returning
 * to a level that just failed, so it does not oscillate).
 */

export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityPreset = QualityLevel | 'auto';

export interface QualityParams {
  level: QualityLevel;
  /** Scene render resolution relative to the canvas backing store. */
  renderScale: number;
  /** Velocity/pressure grid resolution (cells along the long side). */
  simResolution: number;
  /** Dye / detail field resolution (texels along the long side). */
  dyeResolution: number;
  /** Pressure-solver (Jacobi) iterations, or raymarch-step budget. */
  iterations: number;
  /** Multiplier for particle counts. */
  particleScale: number;
  /** Ground mesh resolution (vertices per side) for depth views. */
  meshResolution: number;
  /** Bloom mip levels. */
  bloomLevels: number;
}

export const QUALITY_LEVELS: Record<QualityLevel, QualityParams> = {
  low: {
    level: 'low', renderScale: 0.6, simResolution: 160, dyeResolution: 1024,
    iterations: 12, particleScale: 0.35, meshResolution: 160, bloomLevels: 4,
  },
  medium: {
    level: 'medium', renderScale: 0.85, simResolution: 384, dyeResolution: 2048,
    iterations: 22, particleScale: 0.7, meshResolution: 320, bloomLevels: 5,
  },
  high: {
    level: 'high', renderScale: 1.0, simResolution: 512, dyeResolution: 3072,
    iterations: 32, particleScale: 1.0, meshResolution: 448, bloomLevels: 6,
  },
};

// ── Auto tuning ─────────────────────────────────────────────────
/** Frames averaged per decision window. */
const AUTO_WINDOW = 90;
/** Step down when the average frame time exceeds this × the display interval. */
const AUTO_SLOW_RATIO = 1.22;
/** Step up when below this ratio for `AUTO_UP_AFTER_S`. */
const AUTO_FAST_RATIO = 1.04;
const AUTO_UP_AFTER_S = 25;
/** Minimum time between changes, and how long a failed level stays banned (s). */
const AUTO_COOLDOWN_S = 4;
const AUTO_BAN_S = 90;
/** Ignore frame deltas above this (tab switches, hitches) (ms). */
const AUTO_MAX_SAMPLE_MS = 200;

const ORDER: QualityLevel[] = ['low', 'medium', 'high'];

export class QualityManager {
  private preset: QualityPreset = 'medium';
  private level: QualityLevel = 'medium';
  private samples: number[] = [];
  private displayMs = 1000 / 60;
  private fastFor = 0;
  private sinceChange = 0;
  private bannedUntil: Partial<Record<QualityLevel, number>> = {};
  private clock = 0;
  private listeners: ((p: QualityParams) => void)[] = [];

  get params(): QualityParams { return QUALITY_LEVELS[this.level]; }
  get currentPreset(): QualityPreset { return this.preset; }

  onChange(cb: (p: QualityParams) => void): void { this.listeners.push(cb); }

  setPreset(p: QualityPreset): void {
    this.preset = p;
    this.samples = [];
    this.fastFor = 0;
    this.setLevel(p === 'auto' ? 'medium' : p);
  }

  /** Feed the real wall-clock frame delta (ms). */
  sample(frameMs: number): void {
    if (frameMs <= 0 || frameMs > AUTO_MAX_SAMPLE_MS) return;
    this.clock += frameMs / 1000;
    this.sinceChange += frameMs / 1000;
    this.samples.push(frameMs);
    if (this.samples.length < AUTO_WINDOW) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    // The fastest frames approximate the display refresh interval.
    this.displayMs = Math.min(this.displayMs * 0.9 + sorted[Math.floor(sorted.length * 0.1)] * 0.1, 1000 / 30);
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const windowS = avg * this.samples.length / 1000;
    this.samples = [];
    if (this.preset !== 'auto') return;

    const ratio = avg / this.displayMs;
    const idx = ORDER.indexOf(this.level);
    if (ratio > AUTO_SLOW_RATIO && idx > 0 && this.sinceChange > AUTO_COOLDOWN_S) {
      this.bannedUntil[this.level] = this.clock + AUTO_BAN_S;
      this.setLevel(ORDER[idx - 1]);
      return;
    }
    this.fastFor = ratio < AUTO_FAST_RATIO ? this.fastFor + windowS : 0;
    const up = ORDER[idx + 1];
    if (up && this.fastFor > AUTO_UP_AFTER_S && (this.bannedUntil[up] ?? 0) < this.clock) {
      this.setLevel(up);
    }
  }

  private setLevel(l: QualityLevel): void {
    this.fastFor = 0;
    this.sinceChange = 0;
    if (l === this.level) {
      for (const cb of this.listeners) cb(this.params);
      return;
    }
    this.level = l;
    for (const cb of this.listeners) cb(this.params);
  }
}

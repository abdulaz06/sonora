/**
 * Colour system — curated dark, cinematic palettes, duotones, a custom hue,
 * and Auto Drift (a slow, near-imperceptible hue rotation applied on top of
 * whatever palette is active).
 *
 * Every palette has five ink slots (bg, primary, secondary, accent, highlight)
 * plus `paper`, the background used by light (ink-on-paper) variants. Styles
 * should read `getResolved()` for ready-to-upload RGB; classic styles still
 * use `getPalette()` / `getRingColors*()`.
 */

// ── Tuning ──────────────────────────────────────────────────────
/** Default Auto Drift period: one full hue cycle (s). */
export const DEFAULT_DRIFT_PERIOD_S = 180;
export const MIN_DRIFT_PERIOD_S = 60;
export const MAX_DRIFT_PERIOD_S = 600;
/** Palette crossfade speed (1 / seconds). */
const TRANSITION_SPEED = 0.35;
/** Brand bone, the base for paper backgrounds. */
const BONE: HSL = { h: 36, s: 0.22, l: 0.9 };

export interface HSL {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

export type RGB = [number, number, number];

export interface Palette {
  name: string;
  /** CSS preview colour for the picker UI. */
  preview: string;
  /** Duotone palettes keep every ink slot on (nearly) one hue. */
  duotone: boolean;
  bg: HSL;
  primary: HSL;
  secondary: HSL;
  accent: HSL;
  highlight: HSL;
  /** Paper background for light variants. */
  paper: HSL;
}

export interface ResolvedPalette {
  bg: RGB;
  paper: RGB;
  primary: RGB;
  secondary: RGB;
  accent: RGB;
  highlight: RGB;
  duotone: boolean;
}

const h = (hh: number, s: number, l: number): HSL => ({ h: hh, s, l });

function duo(name: string, preview: string, hue: number, sat: number, light = 0.56): Palette {
  return {
    name, preview, duotone: true,
    bg: h(hue, sat * 0.35, 0.025),
    primary: h(hue, sat, light),
    secondary: h(hue + 6, sat * 0.95, light * 0.62),
    accent: h(hue - 8, sat * 0.9, Math.min(0.82, light + 0.18)),
    highlight: h(hue - 4, sat * 0.55, 0.88),
    paper: h(hue, Math.min(0.2, sat * 0.18), 0.9),
  };
}

// ── Preset palettes ─────────────────────────────────────────────
export const PALETTES: Palette[] = [
  {
    name: 'Nocturne', preview: '#2f6fd6', duotone: false,
    bg: h(225, 0.35, 0.03), primary: h(215, 0.72, 0.5), secondary: h(255, 0.45, 0.36),
    accent: h(186, 0.62, 0.52), highlight: h(200, 0.6, 0.86), paper: BONE,
  },
  {
    name: 'Ember', preview: '#e8641e', duotone: false,
    bg: h(15, 0.35, 0.025), primary: h(18, 0.86, 0.5), secondary: h(352, 0.62, 0.36),
    accent: h(36, 0.9, 0.56), highlight: h(42, 0.85, 0.84), paper: BONE,
  },
  {
    name: 'Abyss', preview: '#0ea5b7', duotone: false,
    bg: h(200, 0.4, 0.025), primary: h(190, 0.75, 0.42), secondary: h(222, 0.55, 0.32),
    accent: h(168, 0.6, 0.5), highlight: h(180, 0.5, 0.85), paper: BONE,
  },
  {
    name: 'Orchid', preview: '#b04ad8', duotone: false,
    bg: h(280, 0.3, 0.028), primary: h(290, 0.62, 0.5), secondary: h(330, 0.5, 0.38),
    accent: h(255, 0.55, 0.6), highlight: h(310, 0.45, 0.86), paper: BONE,
  },
  {
    name: 'Verdigris', preview: '#2fa38a', duotone: false,
    bg: h(170, 0.3, 0.025), primary: h(165, 0.55, 0.42), secondary: h(28, 0.5, 0.36),
    accent: h(140, 0.45, 0.55), highlight: h(60, 0.4, 0.84), paper: BONE,
  },
  {
    name: 'Gold', preview: '#d9a028', duotone: false,
    bg: h(32, 0.3, 0.025), primary: h(40, 0.8, 0.5), secondary: h(22, 0.62, 0.34),
    accent: h(50, 0.85, 0.6), highlight: h(48, 0.6, 0.88), paper: BONE,
  },
  duo('Ember / Black', '#f07a1a', 24, 0.92, 0.55),
  duo('Ivory / Black', '#e6dccb', 38, 0.28, 0.82),
  duo('Cold / Black', '#4f8fe6', 214, 0.78, 0.56),
  duo('Crimson / Black', '#d8263f', 352, 0.82, 0.48),
];

// ── Helpers ─────────────────────────────────────────────────────
function wrapHue(x: number): number {
  return ((x % 360) + 360) % 360;
}

function lerpHSL(a: HSL, b: HSL, t: number): HSL {
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return { h: wrapHue(a.h + dh * t), s: a.s + (b.s - a.s) * t, l: a.l + (b.l - a.l) * t };
}

function lerpPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    name: t < 0.5 ? a.name : b.name,
    preview: t < 0.5 ? a.preview : b.preview,
    duotone: t < 0.5 ? a.duotone : b.duotone,
    bg: lerpHSL(a.bg, b.bg, t),
    primary: lerpHSL(a.primary, b.primary, t),
    secondary: lerpHSL(a.secondary, b.secondary, t),
    accent: lerpHSL(a.accent, b.accent, t),
    highlight: lerpHSL(a.highlight, b.highlight, t),
    paper: lerpHSL(a.paper, b.paper, t),
  };
}

function shiftPalette(p: Palette, dh: number): Palette {
  if (dh === 0) return p;
  const s = (c: HSL): HSL => ({ h: wrapHue(c.h + dh), s: c.s, l: c.l });
  // Paper only takes a whisper of the drift so it stays "paper".
  return {
    ...p,
    bg: s(p.bg), primary: s(p.primary), secondary: s(p.secondary), accent: s(p.accent),
    highlight: s(p.highlight), paper: { ...p.paper, h: wrapHue(p.paper.h + dh * 0.15) },
  };
}

/** Coordinated palette from a single hue (custom picker). */
export function paletteFromHue(hue: number): Palette {
  const hh = wrapHue(hue);
  return {
    name: 'Custom',
    preview: `hsl(${hh.toFixed(0)}, 70%, 52%)`,
    duotone: false,
    bg: h(hh, 0.3, 0.028),
    primary: h(hh, 0.72, 0.5),
    secondary: h(hh + 28, 0.55, 0.36),
    accent: h(hh - 24, 0.65, 0.56),
    highlight: h(hh, 0.5, 0.86),
    paper: BONE,
  };
}

export function hslToRgb(hsl: HSL): RGB {
  const hh = wrapHue(hsl.h);
  const { s, l } = hsl;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

// ── Engine ──────────────────────────────────────────────────────
export class ColorEngine {
  private from: Palette;
  private to: Palette;
  private progress = 1;
  private _paletteIndex = 0;
  private autoDrift = true;
  private driftPeriod = DEFAULT_DRIFT_PERIOD_S;
  private driftPhase = 0; // degrees
  private resolved: ResolvedPalette;
  private fromResolved: ResolvedPalette;
  private current: Palette;

  constructor() {
    this.from = PALETTES[0];
    this.to = PALETTES[0];
    this.current = PALETTES[0];
    this.resolved = resolve(PALETTES[0]);
    this.fromResolved = this.resolved;
  }

  get paletteIndex(): number { return this._paletteIndex; }
  get driftEnabled(): boolean { return this.autoDrift; }
  get driftPeriodSeconds(): number { return this.driftPeriod; }
  /** Current Auto Drift hue offset in degrees. */
  get driftDegrees(): number { return this.autoDrift ? this.driftPhase : 0; }

  /** Select a preset; `immediate` skips the crossfade. */
  setPalette(index: number, immediate = false): void {
    const idx = ((index % PALETTES.length) + PALETTES.length) % PALETTES.length;
    if (idx === this._paletteIndex && this.progress >= 1) return;
    this._paletteIndex = idx;
    this.fromResolved = this.resolved;
    this.from = this.basePalette();
    this.to = PALETTES[idx];
    this.progress = immediate ? 1 : 0;
    if (immediate) this.update(0);
  }

  setCustomHue(hue: number): void {
    this._paletteIndex = -1;
    this.fromResolved = this.resolved;
    this.from = this.basePalette();
    this.to = paletteFromHue(hue);
    this.progress = 0.85;
  }

  setAutoDrift(on: boolean): void { this.autoDrift = on; }

  setDriftPeriod(seconds: number): void {
    this.driftPeriod = Math.max(MIN_DRIFT_PERIOD_S, Math.min(MAX_DRIFT_PERIOD_S, seconds));
  }

  update(dt: number): void {
    if (this.progress < 1) this.progress = Math.min(1, this.progress + TRANSITION_SPEED * dt);
    if (this.autoDrift) this.driftPhase = wrapHue(this.driftPhase + (360 * dt) / this.driftPeriod);
    this.current = shiftPalette(this.basePalette(), this.driftDegrees);
    // Crossfade in RGB (an HSL crossfade sweeps through unrelated hues).
    const target = resolve(shiftPalette(this.to, this.driftDegrees));
    this.resolved = this.progress >= 1 ? target : lerpResolved(this.fromResolved, target, smoothT(this.progress));
  }

  /** Active palette (with transition and Auto Drift applied). */
  getPalette(): Palette { return this.current; }

  /** Active palette as linear-ish RGB triples, ready for uniforms. */
  getResolved(): ResolvedPalette { return this.resolved; }

  private basePalette(): Palette {
    return this.progress >= 1 ? this.to : lerpPalette(this.from, this.to, this.progress);
  }

  /** Inner / middle / outer gradient from the primary colour (classic styles). */
  getRingColors(): [RGB, RGB, RGB] {
    const base = this.current.primary;
    const inner: HSL = { h: base.h - 10, s: base.s * 0.9, l: Math.min(0.75, base.l + 0.15) };
    const outer: HSL = { h: base.h + 15, s: base.s * 0.85, l: Math.max(0.2, base.l - 0.12) };
    return [hslToRgb(inner), hslToRgb(base), hslToRgb(outer)];
  }

  getRingColorsN(count: number): RGB[] {
    const base = this.current.primary;
    if (count <= 1) return [hslToRgb(base)];
    const inner: HSL = { h: wrapHue(base.h - 10), s: base.s * 0.9, l: Math.min(0.75, base.l + 0.15) };
    const outer: HSL = { h: wrapHue(base.h + 15), s: base.s * 0.85, l: Math.max(0.2, base.l - 0.12) };
    const out: RGB[] = new Array(count);
    for (let i = 0; i < count; i++) out[i] = hslToRgb(lerpHSL(inner, outer, i / (count - 1)));
    return out;
  }
}

function smoothT(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerpResolved(a: ResolvedPalette, b: ResolvedPalette, t: number): ResolvedPalette {
  const l = (x: RGB, y: RGB): RGB => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  return {
    bg: l(a.bg, b.bg), paper: l(a.paper, b.paper), primary: l(a.primary, b.primary),
    secondary: l(a.secondary, b.secondary), accent: l(a.accent, b.accent), highlight: l(a.highlight, b.highlight),
    duotone: t < 0.5 ? a.duotone : b.duotone,
  };
}

function resolve(p: Palette): ResolvedPalette {
  return {
    bg: hslToRgb(p.bg),
    paper: hslToRgb(p.paper),
    primary: hslToRgb(p.primary),
    secondary: hslToRgb(p.secondary),
    accent: hslToRgb(p.accent),
    highlight: hslToRgb(p.highlight),
    duotone: p.duotone,
  };
}

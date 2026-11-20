/**
 * Colour system: nine curated palettes, a custom hue, and Auto Drift (a slow
 * hue rotation applied on top of whatever palette is active).
 *
 * Every palette has five slots (bg, primary, secondary, accent, highlight)
 * plus `paper`, the background used by light (ink-on-paper) variants. Slots
 * are defined in OKLCH (perceptual lightness, chroma, hue) and converted to
 * sRGB with gamut mapping by chroma reduction (see oklch.ts). Styles read
 * `getResolved()` for ready-to-upload RGB.
 *
 * Design rules (DOCS/16 §8, measured with the palette matrix):
 *  - analogous core: primary and secondary about 20-60° apart, so blends in
 *    every style (additive strands, Voyage's stone) stay saturated;
 *  - one contrasting accent that works as a small detail and as Ink's large
 *    second ink;
 *  - highlight: a lighter version of the core, warm cores shifted toward
 *    yellow, cool cores toward cyan;
 *  - high chroma, primary lightness matched across palettes (exposure and
 *    flicker behave the same), dark palette-tinted background, bone paper.
 */

import { maxChroma, mixOklch, oklchToSrgb, srgbToOklab, oklabToOklch, type OKLCH } from './oklch';

// ── Tuning ──────────────────────────────────────────────────────
/** Default Auto Drift period: one full hue cycle (s). */
export const DEFAULT_DRIFT_PERIOD_S = 180;
export const MIN_DRIFT_PERIOD_S = 60;
export const MAX_DRIFT_PERIOD_S = 600;
/** Palette crossfade speed (1 / seconds). */
const TRANSITION_SPEED = 0.35;
/** Brand bone, the base for paper backgrounds (OKLCH of the old HSL 36/0.22/0.9). */
const BONE: OKLCH = [0.9285, 0.0103, 78.28];
/** Hue-dependent lightness: how far a colour moves toward its hue's gamut
 * cusp (yellow and cyan are brightest at full chroma, blue darkest), and the
 * limits, so a turned or custom palette never goes olive or dull. */
const CUSP_PULL = 0.3;
const LIFT_MIN = -0.06;
const LIFT_MAX = 0.12;
/** Lightness the hue lift is measured from. */
const LIFT_BASE = 0.6;
/** Shade (the primary's dark tone, e.g. Marble on paper): the primary ×
 * SHADE_K, and for yellows the hue turns up to SHADE_TURN° toward orange so
 * dark gold reads amber-brown, never olive. */
const SHADE_K = 0.55;
const SHADE_TURN = 28;
const SHADE_LIFT_L = 0.64;

export type RGB = [number, number, number];

export interface Palette {
  name: string;
  /** Picker swatch colours (CSS): the core and the accent. */
  preview: string;
  previewAccent: string;
  bg: OKLCH;
  primary: OKLCH;
  secondary: OKLCH;
  accent: OKLCH;
  highlight: OKLCH;
  /** Paper background for light variants. */
  paper: OKLCH;
}

export interface ResolvedPalette {
  bg: RGB;
  paper: RGB;
  primary: RGB;
  secondary: RGB;
  accent: RGB;
  highlight: RGB;
  /** The primary's dark tone (derived, see SHADE_K). */
  shade: RGB;
}

const css = (c: OKLCH): string => {
  const [r, g, b] = oklchToSrgb(c);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
};

function pal(name: string, bg: OKLCH, primary: OKLCH, secondary: OKLCH, accent: OKLCH, highlight: OKLCH, paper: OKLCH = BONE): Palette {
  return { name, preview: css(primary), previewAccent: css(accent), bg, primary, secondary, accent, highlight, paper };
}

// ── Preset palettes (keys 1-9) ──────────────────────────────────
// Ocean, Ember, Neon, Crimson and Violet are v0.1's colours exactly (their
// old HSL values converted to OKLCH); Neon's background is lifted from L 0.125
// to 0.14 like the others' (Ink Glow Depth flicker swings 2.58 → 2.33/s, D67).
// Aurora and Acid sit on a slightly lighter floor (0.16) for the same reason. Ink maps ink A = primary, ink B =
// accent, sparkle = highlight.
export const PALETTES: Palette[] = [
  pal('Ocean', [0.1329, 0.0141, 284.31], [0.5716, 0.1737, 262.35], [0.4569, 0.1735, 293.7], [0.7702, 0.1213, 194.93], [0.7925, 0.0987, 231.59]),
  pal('Aurora', [0.16, 0.022, 200], [0.66, 0.16, 158], [0.62, 0.11, 195], [0.62, 0.22, 315], [0.88, 0.12, 170]),
  pal('Ember', [0.142, 0.0098, 33.14], [0.6259, 0.1978, 36.83], [0.6548, 0.1307, 69.52], [0.522, 0.1732, 16.58], [0.8471, 0.1549, 89.45]),
  pal('Neon', [0.14, 0.012, 301.7], [0.6685, 0.2799, 328.16], [0.8714, 0.1478, 194.78], [0.9519, 0.2028, 109.7], [0.687, 0.1997, 352.66]),
  pal('Crimson', [0.1391, 0.0118, 6.31], [0.5907, 0.2277, 21.33], [0.6084, 0.1667, 38.18], [0.6267, 0.2212, 344.54], [0.6832, 0.174, 27.75]),
  pal('Solar', [0.15, 0.02, 60], [0.68, 0.155, 68], [0.63, 0.18, 48], [0.66, 0.22, 355], [0.9, 0.13, 80]),
  pal('Violet', [0.1387, 0.0122, 308.25], [0.5475, 0.2295, 301.97], [0.5541, 0.1989, 327.85], [0.4896, 0.2058, 275.67], [0.7023, 0.1775, 313.42]),
  pal('Sunset', [0.14, 0.025, 330], [0.64, 0.24, 355], [0.55, 0.24, 315], [0.72, 0.18, 55], [0.86, 0.09, 50]),
  pal('Acid', [0.16, 0.028, 150], [0.64, 0.21, 145], [0.7, 0.2, 132], [0.6, 0.24, 280], [0.86, 0.15, 165]),
];

/** Picker swatch (CSS background): the core with a corner of the accent, two flat areas. */
export function swatchCss(p: Palette): string {
  return `linear-gradient(135deg, ${p.preview} 62%, ${p.previewAccent} 62%)`;
}

/** Index of a preset by name (settings migrate by name), or -1. */
export function paletteIndexByName(name: string): number {
  return PALETTES.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
}

// ── Helpers ─────────────────────────────────────────────────────
function wrapHue(x: number): number {
  return ((x % 360) + 360) % 360;
}

/** Lightness at which each hue reaches its largest chroma (5° table). */
const CUSP_L: number[] = (() => {
  const out: number[] = [];
  for (let h = 0; h < 360; h += 5) {
    let bestL = 0.5, bestC = 0;
    for (let l = 0.3; l <= 0.98; l += 0.01) {
      const c = maxChroma(l, h);
      if (c > bestC) { bestC = c; bestL = l; }
    }
    out.push(bestL);
  }
  return out;
})();

function cuspL(h: number): number {
  const x = wrapHue(h) / 5, i = Math.floor(x) % CUSP_L.length, f = x - Math.floor(x);
  return CUSP_L[i] + (CUSP_L[(i + 1) % CUSP_L.length] - CUSP_L[i]) * f;
}

/** Extra lightness a colour of hue h needs to stay vivid (yellows, cyans up; blues down). */
export function hueLift(h: number): number {
  return Math.max(LIFT_MIN, Math.min(LIFT_MAX, CUSP_PULL * (cuspL(h) - LIFT_BASE)));
}

function vivid(l: number, h: number, cMax: number, share: number): OKLCH {
  const L = l + hueLift(h);
  return [L, Math.min(cMax, maxChroma(L, h) * share), wrapHue(h)];
}

/** Turn a palette's hues by dh (Auto Drift), keeping each colour vivid: the
 * chromatic slots follow the hue lift so a blue palette turned to yellow
 * brightens instead of going olive. Paper takes only a whisper of the turn. */
function shiftPalette(p: Palette, dh: number): Palette {
  if (dh === 0) return p;
  const s = (c: OKLCH, lift: boolean): OKLCH => {
    const h = wrapHue(c[2] + dh);
    return [lift ? c[0] + hueLift(h) - hueLift(c[2]) : c[0], c[1], h];
  };
  return {
    ...p,
    bg: s(p.bg, false), primary: s(p.primary, true), secondary: s(p.secondary, true), accent: s(p.accent, true),
    highlight: s(p.highlight, false), paper: [p.paper[0], p.paper[1], wrapHue(p.paper[2] + dh * 0.15)],
  };
}

/** Coordinated palette from a single hue (custom picker): the same structure
 * as the presets, an analogous core (+35°), a split-complementary accent
 * (+150°) and a lighter highlight leaning toward yellow (warm) or cyan (cool). */
export function paletteFromHue(hue: number): Palette {
  const h = wrapHue(hue);
  const dist = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
  const target = dist(h, 95) < dist(h, 195) ? 95 : 195;
  let dh = target - h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const hh = h + Math.sign(dh) * Math.min(15, Math.abs(dh));
  const primary = vivid(0.62, h, 0.22, 0.95);
  const secondary = vivid(0.55, h + 35, 0.2, 0.9);
  const accent = vivid(0.66, h + 150, 0.2, 0.9);
  const highlight: OKLCH = [0.88, Math.min(0.12, maxChroma(0.88, hh) * 0.9), wrapHue(hh)];
  return pal('Custom', [0.14, 0.02, h], primary, secondary, accent, highlight);
}

function lerpPalette(a: Palette, b: Palette, t: number): Palette {
  const m = (x: OKLCH, y: OKLCH): OKLCH => {
    // A near-grey end has no meaningful hue: take the other end's.
    const xx: OKLCH = x[1] < 0.02 ? [x[0], x[1], y[2]] : x;
    const yy: OKLCH = y[1] < 0.02 ? [y[0], y[1], x[2]] : y;
    return mixOklch(xx, yy, t);
  };
  return {
    name: t < 0.5 ? a.name : b.name,
    preview: t < 0.5 ? a.preview : b.preview,
    previewAccent: t < 0.5 ? a.previewAccent : b.previewAccent,
    bg: m(a.bg, b.bg), primary: m(a.primary, b.primary), secondary: m(a.secondary, b.secondary),
    accent: m(a.accent, b.accent), highlight: m(a.highlight, b.highlight), paper: m(a.paper, b.paper),
  };
}

export function resolvePalette(p: Palette): ResolvedPalette {
  const primary = oklchToSrgb(p.primary);
  return {
    bg: oklchToSrgb(p.bg), paper: oklchToSrgb(p.paper), primary,
    secondary: oklchToSrgb(p.secondary), accent: oklchToSrgb(p.accent), highlight: oklchToSrgb(p.highlight),
    shade: shadeOf(primary),
  };
}

/** Dark tone of a colour: × SHADE_K (exactly, outside the yellows). Golds
 * (about 60-110°) turn toward orange at the same lightness; yellow-greens,
 * which can't turn without passing through olive, stay lighter instead
 * (olive is a dark yellow). Both blends are smooth, so Auto Drift never jumps. */
export function shadeOf(c: RGB): RGB {
  const d: RGB = [c[0] * SHADE_K, c[1] * SHADE_K, c[2] * SHADE_K];
  const [l, ch, h] = toOklch(d);
  const turn = smooth(55, 72, h) * (1 - smooth(95, 112, h));
  const lift = smooth(85, 100, h) * (1 - smooth(125, 140, h));
  if ((turn <= 0 && lift <= 0) || ch < 0.02) return d;
  return oklchToSrgb([Math.max(l, l + (SHADE_LIFT_L - l) * lift), ch, h - SHADE_TURN * turn]);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** sRGB → OKLCH (classic styles derive ring colours from the resolved primary). */
function toOklch(c: RGB): OKLCH {
  return oklabToOklch(srgbToOklab(c));
}

// ── Engine ──────────────────────────────────────────────────────
export class ColorEngine {
  private from: Palette;
  private to: Palette;
  private progress = 1;
  private _paletteIndex = 0;
  private autoDrift = false;
  private driftPeriod = DEFAULT_DRIFT_PERIOD_S;
  private driftPhase = 0; // degrees
  private resolved: ResolvedPalette;
  private current: Palette;
  /** Harness only: a palette given as ready RGB, shown instead of the presets. */
  private override: ResolvedPalette | null = null;

  constructor() {
    this.from = PALETTES[0];
    this.to = PALETTES[0];
    this.current = PALETTES[0];
    this.resolved = resolvePalette(PALETTES[0]);
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
    this.from = this.basePalette();
    this.to = PALETTES[idx];
    this.progress = immediate ? 1 : 0;
    if (immediate) this.update(0);
  }

  setCustomHue(hue: number): void {
    this._paletteIndex = -1;
    this.from = this.basePalette();
    this.to = paletteFromHue(hue);
    this.progress = 0.85;
  }

  setAutoDrift(on: boolean): void { this.autoDrift = on; }

  /** Harness only: show this palette (RGB) instead of the presets; null clears. */
  setOverride(p: ResolvedPalette | null): void { this.override = p; if (p) this.resolved = p; }

  /** Harness only: jump Auto Drift to a hue offset (degrees). */
  setDriftPhase(deg: number): void { this.driftPhase = wrapHue(deg); }

  setDriftPeriod(seconds: number): void {
    this.driftPeriod = Math.max(MIN_DRIFT_PERIOD_S, Math.min(MAX_DRIFT_PERIOD_S, seconds));
  }

  update(dt: number): void {
    if (this.progress < 1) this.progress = Math.min(1, this.progress + TRANSITION_SPEED * dt);
    if (this.autoDrift) this.driftPhase = wrapHue(this.driftPhase + (360 * dt) / this.driftPeriod);
    // The crossfade runs in OKLCH along the shorter hue arc (basePalette):
    // chroma never dips through grey, as an RGB crossfade between distant hues does.
    this.current = shiftPalette(this.basePalette(), this.driftDegrees);
    this.resolved = this.override ?? resolvePalette(this.current);
  }

  /** Active palette (with transition and Auto Drift applied). */
  getPalette(): Palette { return this.current; }

  /** Active palette as RGB triples, ready for uniforms. */
  getResolved(): ResolvedPalette { return this.resolved; }

  private basePalette(): Palette {
    return this.progress >= 1 ? this.to : lerpPalette(this.from, this.to, smoothT(this.progress));
  }

  /** Inner / middle / outer gradient from the primary colour (classic styles). */
  getRingColors(): [RGB, RGB, RGB] {
    const [inner, mid, outer] = this.ringEnds();
    return [oklchToSrgb(inner), oklchToSrgb(mid), oklchToSrgb(outer)];
  }

  getRingColorsN(count: number): RGB[] {
    const [inner, mid, outer] = this.ringEnds();
    if (count <= 1) return [oklchToSrgb(mid)];
    const out: RGB[] = new Array(count);
    for (let i = 0; i < count; i++) out[i] = oklchToSrgb(mixOklch(inner, outer, i / (count - 1)));
    return out;
  }

  private ringEnds(): [OKLCH, OKLCH, OKLCH] {
    const base = toOklch(this.resolved.primary);
    return [
      [Math.min(0.85, base[0] + 0.1), base[1] * 0.9, wrapHue(base[2] - 10)],
      base,
      [Math.max(0.3, base[0] - 0.1), base[1] * 0.85, wrapHue(base[2] + 15)],
    ];
  }
}

function smoothT(t: number): number {
  return t * t * (3 - 2 * t);
}

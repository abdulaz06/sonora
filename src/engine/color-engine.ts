/**
 * Color system — user-selectable palettes with smooth transitions.
 */

export interface HSL {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

export interface Palette {
  name: string;
  /** CSS preview color for the picker UI. */
  preview: string;
  bg: HSL;
  primary: HSL;
  secondary: HSL;
  accent: HSL;
  highlight: HSL;
}

// ── Preset Palettes ──────────────────────────────────────────

export const PALETTES: Palette[] = [
  {
    name: 'Ocean',
    preview: '#3b82f6',
    bg: { h: 240, s: 0.3, l: 0.04 },
    primary: { h: 220, s: 0.7, l: 0.55 },
    secondary: { h: 260, s: 0.5, l: 0.45 },
    accent: { h: 180, s: 0.6, l: 0.5 },
    highlight: { h: 200, s: 0.8, l: 0.7 },
  },
  {
    name: 'Aurora',
    preview: '#22c55e',
    bg: { h: 270, s: 0.2, l: 0.04 },
    primary: { h: 150, s: 0.6, l: 0.5 },
    secondary: { h: 280, s: 0.5, l: 0.5 },
    accent: { h: 60, s: 0.7, l: 0.55 },
    highlight: { h: 180, s: 0.7, l: 0.65 },
  },
  {
    name: 'Ember',
    preview: '#f97316',
    bg: { h: 10, s: 0.3, l: 0.04 },
    primary: { h: 15, s: 0.8, l: 0.5 },
    secondary: { h: 35, s: 0.7, l: 0.45 },
    accent: { h: 350, s: 0.6, l: 0.45 },
    highlight: { h: 45, s: 0.9, l: 0.6 },
  },
  {
    name: 'Neon',
    preview: '#d946ef',
    bg: { h: 260, s: 0.25, l: 0.03 },
    primary: { h: 300, s: 0.8, l: 0.55 },
    secondary: { h: 180, s: 0.9, l: 0.5 },
    accent: { h: 60, s: 0.95, l: 0.55 },
    highlight: { h: 330, s: 0.85, l: 0.65 },
  },
  {
    name: 'Crimson',
    preview: '#e11d48',
    bg: { h: 350, s: 0.3, l: 0.04 },
    primary: { h: 350, s: 0.8, l: 0.5 },
    secondary: { h: 15, s: 0.65, l: 0.5 },
    accent: { h: 320, s: 0.7, l: 0.55 },
    highlight: { h: 5, s: 0.85, l: 0.65 },
  },
  {
    name: 'Gold',
    preview: '#f59e0b',
    bg: { h: 30, s: 0.3, l: 0.04 },
    primary: { h: 42, s: 0.85, l: 0.55 },
    secondary: { h: 25, s: 0.75, l: 0.48 },
    accent: { h: 55, s: 0.9, l: 0.6 },
    highlight: { h: 50, s: 0.95, l: 0.72 },
  },
  {
    name: 'Violet',
    preview: '#8b5cf6',
    bg: { h: 270, s: 0.25, l: 0.04 },
    primary: { h: 270, s: 0.7, l: 0.55 },
    secondary: { h: 300, s: 0.5, l: 0.45 },
    accent: { h: 240, s: 0.6, l: 0.55 },
    highlight: { h: 280, s: 0.75, l: 0.7 },
  },
];

// ── Color Engine ─────────────────────────────────────────────

function lerpHSL(a: HSL, b: HSL, t: number): HSL {
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    h: (a.h + dh * t + 360) % 360,
    s: a.s + (b.s - a.s) * t,
    l: a.l + (b.l - a.l) * t,
  };
}

function lerpPalette(a: Palette, b: Palette, t: number): Palette {
  return {
    name: t < 0.5 ? a.name : b.name,
    preview: t < 0.5 ? a.preview : b.preview,
    bg: lerpHSL(a.bg, b.bg, t),
    primary: lerpHSL(a.primary, b.primary, t),
    secondary: lerpHSL(a.secondary, b.secondary, t),
    accent: lerpHSL(a.accent, b.accent, t),
    highlight: lerpHSL(a.highlight, b.highlight, t),
  };
}

/**
 * Generate a coordinated palette from a single base hue.
 * Mirrors the layout of the hand-tuned presets so all five colour
 * slots feel deliberate: primary on the chosen hue, secondary as an
 * analogous neighbour (+30°), accent as the complement (+180°),
 * highlight as a brighter tint of primary, bg as a deep shadow.
 */
export function paletteFromHue(hue: number): Palette {
  const h = ((hue % 360) + 360) % 360;
  return {
    name: 'Custom',
    preview: `hsl(${h.toFixed(0)}, 75%, 55%)`,
    bg:        { h,                  s: 0.30, l: 0.04 },
    primary:   { h,                  s: 0.75, l: 0.55 },
    secondary: { h: (h + 30) % 360,  s: 0.60, l: 0.50 },
    accent:    { h: (h + 180) % 360, s: 0.65, l: 0.55 },
    highlight: { h,                  s: 0.85, l: 0.68 },
  };
}

export function hslToRgb(hsl: HSL): [number, number, number] {
  const { h, s, l } = hsl;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }

  return [r + m, g + m, b + m];
}

export class ColorEngine {
  private currentPalette: Palette;
  private targetPalette: Palette;
  private transitionProgress = 1;
  private transitionSpeed = 0.3; // ~3 second transitions
  private _paletteIndex = 0;

  constructor() {
    this.currentPalette = { ...PALETTES[0] };
    this.targetPalette = { ...PALETTES[0] };
  }

  get paletteIndex(): number {
    return this._paletteIndex;
  }

  /** Select a palette by index. */
  setPalette(index: number): void {
    const newIdx = ((index % PALETTES.length) + PALETTES.length) % PALETTES.length;
    if (newIdx === this._paletteIndex && this.transitionProgress >= 1) return;
    this._paletteIndex = newIdx;
    this.currentPalette = this.getPalette(); // snapshot current state
    this.targetPalette = PALETTES[newIdx];
    this.transitionProgress = 0;
  }

  /**
   * Set a custom palette derived from a single hue (0–360°).
   * `_paletteIndex = -1` marks "custom" mode so the picker UI can
   * distinguish it from any named preset. A short residual transition
   * (0.85 → 1) smooths the slider drag without feeling laggy.
   */
  setCustomHue(hue: number): void {
    this._paletteIndex = -1;
    this.currentPalette = this.getPalette();
    this.targetPalette = paletteFromHue(hue);
    this.transitionProgress = 0.85;
  }

  /** Advance transition. Call once per frame. */
  update(dt: number): void {
    if (this.transitionProgress < 1) {
      this.transitionProgress = Math.min(1, this.transitionProgress + this.transitionSpeed * dt);
    }
  }

  /** Get the current palette (interpolated during transition). */
  getPalette(): Palette {
    if (this.transitionProgress >= 1) {
      return this.targetPalette;
    }
    return lerpPalette(this.currentPalette, this.targetPalette, this.transitionProgress);
  }

  /** Generate coordinated ring colors as a gradient from the primary color.
   *  Always returns exactly 3 entries (inner / middle / outer) — used by code
   *  paths that want a fixed gradient handle (particles, glow orb tinting). */
  getRingColors(): [[number, number, number], [number, number, number], [number, number, number]] {
    const base = this.getPalette().primary;
    const inner: HSL = { h: (base.h - 10 + 360) % 360, s: base.s * 0.9, l: Math.min(0.75, base.l + 0.15) };
    const middle: HSL = { h: base.h, s: base.s, l: base.l };
    const outer: HSL = { h: (base.h + 15) % 360, s: base.s * 0.85, l: Math.max(0.2, base.l - 0.12) };
    return [hslToRgb(inner), hslToRgb(middle), hslToRgb(outer)];
  }

  /** Generate N coordinated ring colors interpolated across the same
   *  inner→outer gradient produced by getRingColors(). With count=1 returns
   *  the middle color; with count>=2 the inner/outer endpoints match the
   *  3-color version, so visuals stay consistent as the user drags the
   *  ring-count slider. */
  getRingColorsN(count: number): [number, number, number][] {
    const base = this.getPalette().primary;
    const inner: HSL = { h: (base.h - 10 + 360) % 360, s: base.s * 0.9, l: Math.min(0.75, base.l + 0.15) };
    const outer: HSL = { h: (base.h + 15) % 360, s: base.s * 0.85, l: Math.max(0.2, base.l - 0.12) };
    if (count <= 1) {
      return [hslToRgb({ h: base.h, s: base.s, l: base.l })];
    }
    const out: [number, number, number][] = new Array(count);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      out[i] = hslToRgb(lerpHSL(inner, outer, t));
    }
    return out;
  }
}

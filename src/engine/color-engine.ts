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
/** Album colours crossfade on a track change (s), with the now-playing toast. */
export const ALBUM_FADE_S = 2.5;
/** Brand bone, the base for paper backgrounds (OKLCH of the old HSL 36/0.22/0.9). */
const BONE: OKLCH = [0.9285, 0.0103, 78.28];
/** Hue-dependent lightness: how far a colour moves toward its hue's gamut
 * cusp (yellow and cyan are brightest at full chroma, blue darkest), and the
 * limits, so a turned or custom palette never goes olive or dull. */
const CUSP_PULL = 0.15;
const LIFT_MIN = -0.04;
const LIFT_MAX = 0.08;
/** Lightness the hue lift is measured from. */
const LIFT_BASE = 0.6;
/** Shade (the primary's dark tone, e.g. Marble on paper): the primary ×
 * SHADE_K, and for yellows the hue turns up to SHADE_TURN° toward orange so
 * dark gold reads amber-brown, never olive. */
const SHADE_K = 0.55;
const SHADE_TURN = 28;
const SHADE_LIFT_L = 0.64;
/** Hue bands a custom or drifting core colour (primary / secondary /
 * accent) passes through steeply instead of resting in: the olive band (a
 * dark yellow or lime reads olive) and the cyan band (sRGB can't make a vivid
 * cyan at matched lightness: Marble and Warp went dull). Inside a band the
 * hue sits within 3° of either edge, with a steep BAND_STEP-wide crossing in
 * the middle (continuous, so drift never jumps). A preset colour that sits
 * in a band at rest (Neon's yellow, Aurora's cyan) stays exactly itself. */
const BANDS: [number, number][] = [[65, 140], [162, 245]];
/** Auto Drift turns the whole palette rigidly and passes quickly through the
 * turns where its primary or secondary would sit in this olive span (their
 * blends would land on olive) or its primary in the cyan band (Marble draws
 * the primary alone: a cyan one goes dull). A narrower olive span than the
 * custom band's, so Acid's light lime secondary (132°) is allowed at rest. */
const DRIFT_OLIVE: [number, number] = [70, 130];
const DRIFT_CYAN: [number, number] = BANDS[1];
/** Lightness range over which a drifting colour switches from the small hue
 * lift to following its hue's gamut cusp (light colours keep their chroma). */
const DRIFT_LIGHT: [number, number] = [0.72, 0.92];
/** Share of a forbidden stretch's width spent crossing it (phase degrees). */
const DRIFT_CROSS = 0.12;
/** The steep middle of a band (input degrees). */
const BAND_STEP = 8;
/** Custom palettes: accent offset from the core (a ~150° accent added up to
 * white with the core in Wisp's flames). */
const ACCENT_OFFSET = 70;
/** Neon's Auto Drift window (turn degrees): its magenta / cyan / yellow triad,
 * turned further, lands on complementary pairs whose light adds up to olive in
 * Wisp and Voyage (90–150°) or on dull Warp streaks. Measured with the palette
 * matrix in 5° steps (D82): −20…+40° pass every gate, −25° and +45° fail Warp's
 * chroma floor (0.093); the window keeps a margin (Warp ≥ 0.100). */
const NEON_DRIFT_WINDOW: [number, number] = [-15, 35];
/** Album palettes (paletteFromCover): a cover colour is used as the secondary
 * when it sits this far from the primary (degrees, analogous), and as the
 * accent from COVER_ACC_RANGE[0] on, pulled back to COVER_ACC_RANGE[1] when it
 * is nearer complementary (Acid's 175° magenta whitened Wisp; 135–157° pass). */
const COVER_SEC_RANGE: [number, number] = [18, 62];
const COVER_ACC_RANGE: [number, number] = [45, 165];
/** Album palettes: a cover hue in the olive band snaps to gold up to this hue
 * and to lime above it (custom hue splits at the band's middle, 102.5°): a
 * yellow cover reads gold, not lime. */
const COVER_OLIVE_SPLIT = 118;
/** Album palettes: a cover accent in the cyan band keeps its hue as a light
 * cyan (Ocean's accent: L 0.77, C 0.12 passes every gate) instead of turning azure. */
const COVER_CYAN_ACCENT_L = 0.77;
const COVER_CYAN_ACCENT_C = 0.125;

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
  /** Wide-hue palettes (Neon): Auto Drift sways between these turns (degrees,
   * min < 0 < max) instead of turning all the way round; every turn inside
   * passes the colour gates (D82). */
  driftWindow?: [number, number];
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

function pal(name: string, bg: OKLCH, primary: OKLCH, secondary: OKLCH, accent: OKLCH, highlight: OKLCH, paper: OKLCH = BONE, driftWindow?: [number, number]): Palette {
  return { name, preview: css(primary), previewAccent: css(accent), bg, primary, secondary, accent, highlight, paper, ...(driftWindow ? { driftWindow } : {}) };
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
  pal('Neon', [0.14, 0.012, 301.7], [0.6685, 0.2799, 328.16], [0.8714, 0.1478, 194.78], [0.9519, 0.2028, 109.7], [0.687, 0.1997, 352.66], BONE, NEON_DRIFT_WINDOW),
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

/** In the olive band (a secondary or accent must not rest there). */
function inOlive(h: number): boolean {
  const x = wrapHue(h);
  return x > BANDS[0][0] && x < BANDS[0][1];
}

/** Hue through the bands: identity outside them. `snap` (a still palette:
 * the custom picker) skips the steep crossing and picks the nearer edge. */
export function bandHue(h: number, snap = false): number {
  const x = wrapHue(h);
  for (const [a, b] of BANDS) {
    if (x <= a || x >= b) continue;
    const mid = (a + b) / 2, s0 = mid - (snap ? 0 : BAND_STEP / 2), s1 = mid + (snap ? 0 : BAND_STEP / 2);
    if (x < s0) return a + ((x - a) / (s0 - a)) * 3;
    if (x >= s1) return b - 3 + ((x - s1) / (b - s1)) * 3;
    return a + 3 + ((x - s0) / BAND_STEP) * (b - a - 6);
  }
  return x;
}

/** Does the shorter arc from hue a to hue b enter the olive band? (The
 * start is skipped: a gold core sits on the band's edge.) */
function arcHitsOlive(a: number, b: number): boolean {
  const d = angDiff(b, a);
  for (let i = 1; i <= 16; i++) if (Math.abs((d * i) / 16) > 4 && inOlive(a + (d * i) / 16)) return true;
  return false;
}

function angDiff(a: number, b: number): number {
  let d = wrapHue(a) - wrapHue(b);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** A slot's hue turned by dh through the bands, relative to where it starts
 * (a preset colour that sits in a band stays exactly itself at dh = 0). Light
 * colours too: styles dim them (flames, veins, trails), and a dimmed light
 * yellow is olive. */
function bandShift(c: OKLCH, dh: number): number {
  const plain = c[2] + dh;
  // The colour's own offset at rest fades out over the first 40° of turn, so
  // further round the bands are avoided exactly (a colour resting in the cyan
  // band would otherwise carry that offset into the olive band).
  const away = Math.abs(angDiff(dh, 0));
  const rest = angDiff(bandHue(c[2]), c[2]) * (1 - smooth(0, 40, away));
  return wrapHue(plain + angDiff(bandHue(plain), plain) - rest);
}

/** Drift phase (0..360, uniform in time) → the hue turn actually applied:
 * turns that put the core in a forbidden span (see DRIFT_OLIVE) are crossed
 * in BAND_STEP degrees of phase, the rest stretched to fill the circle.
 * Phase 0 is turn 0 (the palette exactly as chosen). */
export function driftTurn(p: Palette, phase: number): number {
  return driftMap(p, phase).turn;
}

/** True while Auto Drift is crossing a skipped stretch, or the accent or
 * highlight is in the steep middle of its own band crossing (a few seconds
 * each per turn). */
export function driftCrossing(p: Palette, phase: number): boolean {
  const m = driftMap(p, phase);
  if (m.crossing) return true;
  const steep = (h: number): boolean => BANDS.some(([a, b]) => {
    const x = wrapHue(h), mid = (a + b) / 2;
    return x > mid - BAND_STEP / 2 && x < mid + BAND_STEP / 2;
  });
  return steep(p.accent[2] + m.turn) || steep(p.highlight[2] + m.turn);
}

function driftMap(p: Palette, phase: number): { turn: number; crossing: boolean } {
  if (p.driftWindow) return { turn: windowTurn(p.driftWindow, phase), crossing: false };
  const P = p.primary[2], S = p.secondary[2];
  // Forbidden turns as [start, length] on the circle, relative to turn 0.
  const raw: [number, number][] = [
    [wrapHue(DRIFT_OLIVE[0] - P), DRIFT_OLIVE[1] - DRIFT_OLIVE[0]],
    [wrapHue(DRIFT_OLIVE[0] - S), DRIFT_OLIVE[1] - DRIFT_OLIVE[0]],
    [wrapHue(DRIFT_CYAN[0] - P), DRIFT_CYAN[1] - DRIFT_CYAN[0]],
  ];
  // Unroll onto [0, 360) and merge overlaps (an interval may wrap past 360).
  const iv: [number, number][] = [];
  for (const [a, len] of raw) {
    if (a + len > 360) { iv.push([a, 360]); iv.push([0, a + len - 360]); } else iv.push([a, a + len]);
  }
  iv.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  }
  // Turn 0 itself forbidden (shouldn't happen for a valid palette): turn plainly.
  if (merged.some(([a, b]) => a <= 1e-9 && b > 1e-9 && !(a === 0 && b === 360)) || merged.length === 0) return { turn: wrapHue(phase), crossing: false };
  // Each forbidden stretch is crossed in DRIFT_CROSS of its width (at least
  // BAND_STEP degrees of phase): quick, never a jump.
  const cross = merged.map(([a, b]) => Math.max(BAND_STEP, (b - a) * DRIFT_CROSS));
  const forb = merged.reduce((t, [a, b]) => t + (b - a), 0);
  const crossSum = cross.reduce((t, c) => t + c, 0);
  if (forb >= 360 - crossSum) return { turn: wrapHue(phase), crossing: false };
  const k = (360 - crossSum) / (360 - forb);
  // Walk the circle: allowed stretches scaled by k, forbidden ones squeezed.
  let x = wrapHue(phase), turn = 0;
  for (let i = 0; i < merged.length; i++) {
    const [a, b] = merged[i];
    const allowed = (a - turn) * k;
    if (x <= allowed) return { turn: turn + x / k, crossing: false };
    x -= allowed;
    if (x <= cross[i]) return { turn: a + (x / cross[i]) * (b - a), crossing: true };
    x -= cross[i];
    turn = b;
  }
  return { turn: Math.min(360, turn + x / k), crossing: false };
}

/** A windowed drift: one smooth sway (sine) between the window's ends per full
 * phase cycle, starting from turn 0 at phase 0 (the palette as chosen). */
function windowTurn([lo, hi]: [number, number], phase: number): number {
  const c = (lo + hi) / 2, a = (hi - lo) / 2;
  const theta0 = Math.asin(Math.max(-1, Math.min(1, -c / a)));
  return wrapHue(c + a * Math.sin(theta0 + (wrapHue(phase) * Math.PI) / 180));
}

/** Turn a palette's hues (Auto Drift): rigidly by driftTurn(phase), so the
 * analogous core stays together; the chromatic slots follow the hue lift (a
 * blue palette turned to gold brightens instead of going dull), and the accent
 * and highlight still step through the bands on their own (relative to where
 * they start).
 * Paper takes only a whisper of the turn. */
function shiftPalette(p: Palette, dh: number): Palette {
  if (dh === 0) return p;
  const s = (c: OKLCH, lift: boolean, band = false): OKLCH => {
    const h = band ? bandShift(c, dh) : wrapHue(c[2] + dh);
    if (!lift) return [c[0], c[1], h];
    // Mid tones take the small hue lift; light colours follow their hue's
    // most vivid lightness (the gamut cusp), or a light yellow turned blue
    // would be white (Neon's accent, Solar's highlight went grey).
    const light = smooth(DRIFT_LIGHT[0], DRIFT_LIGHT[1], c[0]);
    const L = c[0] + hueLift(h) - hueLift(c[2]) + light * (1 - CUSP_PULL) * (cuspL(h) - cuspL(c[2]));
    return [Math.max(0.3, Math.min(0.97, L)), c[1], h];
  };
  return {
    ...p,
    bg: s(p.bg, false), primary: s(p.primary, true), secondary: s(p.secondary, true), accent: s(p.accent, true, true),
    highlight: s(p.highlight, true, true), paper: [p.paper[0], p.paper[1], wrapHue(p.paper[2] + dh * 0.15)],
  };
}

/** Coordinated palette from a single hue (custom picker): the same structure
 * as the presets. Primary: the hue, moved out of the olive band (gold or
 * lime) and the cyan band (teal or azure); when it moved, the picked hue is
 * kept as the secondary (a cyan pick still has cyan), otherwise the secondary
 * sits 35° away (the side away from the olive band). Accent: 70° the other
 * way (this way if that lands in the olive band). Highlight: lighter, leaning
 * toward yellow for warm cores and toward cyan for cool ones. */
export function paletteFromHue(hue: number): Palette {
  const h0 = wrapHue(hue);
  const h = bandHue(h0, true);
  const moved = Math.abs(angDiff(h, h0)) > 12;
  const sec = moved && !inOlive(h0) ? h0 : inOlive(h + 35) && !inOlive(h - 35) ? h - 35 : h + 35;
  // The accent's arc to the core must not cross the olive band (their blends,
  // e.g. Glow's two inks, would pass through olive).
  const acc = arcHitsOlive(h, h - ACCENT_OFFSET) ? h + ACCENT_OFFSET : h - ACCENT_OFFSET;
  const warm = h < 90 || h >= 300;
  const hh = warm ? h + Math.max(-15, Math.min(15, angDiff(80, h))) : h + Math.max(-15, Math.min(15, angDiff(195, h)));
  const primary = vivid(0.6, h, 0.22, 1);
  const secondary = vivid(0.55, sec === h0 ? h0 : bandHue(sec, true), 0.2, 0.9);
  const accent = vivid(0.64, bandHue(acc, true), 0.2, 0.9);
  const hl = warm ? 0.88 : 0.86;
  const highlight: OKLCH = [hl, Math.min(0.13, maxChroma(hl, hh) * 0.95), wrapHue(hh)];
  return pal('Custom', [0.14, 0.02, h], primary, secondary, accent, highlight);
}

/** Hues taken from album art (album-palette.ts): the dominant vivid colour,
 * and when the cover has them, an analogous one and a distinct second one. */
export interface CoverHues {
  primary: number;
  secondary?: number;
  accent?: number;
}

/** Album palette: the same structure and rules as paletteFromHue (lightness
 * matched, full chroma, olive and cyan bands, accent arc clear of olive), with
 * the secondary and accent taken from the cover where they fit the rules and
 * derived exactly as for a custom hue where they don't. With only a primary
 * it equals paletteFromHue(primary) (tested). Paper stays bone (Sumi). */
export function paletteFromCover(c: CoverHues, name = 'Album'): Palette {
  const h0 = wrapHue(c.primary);
  const h = coverSnap(h0);
  const moved = Math.abs(angDiff(h, h0)) > 12;
  let sec = moved && !inOlive(h0) ? h0 : inOlive(h + 35) && !inOlive(h - 35) ? h - 35 : h + 35;
  let secFromCover = false;
  if (c.secondary !== undefined) {
    // An olive secondary snaps to its band's nearer edge; a cyan one is kept
    // (as a picked cyan is for custom); either way it must stay analogous.
    const s = inOlive(c.secondary) ? coverSnap(c.secondary) : wrapHue(c.secondary);
    const d = Math.abs(angDiff(s, h));
    if (d >= COVER_SEC_RANGE[0] && d <= COVER_SEC_RANGE[1]) { sec = s; secFromCover = true; }
  }
  let acc = arcHitsOlive(h, h - ACCENT_OFFSET) ? h + ACCENT_OFFSET : h - ACCENT_OFFSET;
  let cyanAccent = false;
  if (c.accent !== undefined) {
    // Complementary accents add up to white with the core (Wisp's flames):
    // nudge them back to COVER_ACC_RANGE[1] on their own side.
    const d = angDiff(c.accent, h);
    const ad = Math.abs(d);
    if (ad >= COVER_ACC_RANGE[0]) {
      const raw = wrapHue(h + Math.sign(d || 1) * Math.min(ad, COVER_ACC_RANGE[1]));
      const cyan = raw > BANDS[1][0] && raw < BANDS[1][1];
      const a = cyan ? raw : coverSnap(raw);
      if (!arcCrossesOlive(h, a) && Math.abs(angDiff(a, h)) >= COVER_ACC_RANGE[0]) { acc = a; cyanAccent = cyan; }
    }
  }
  const warm = h < 90 || h >= 300;
  const hh = warm ? h + Math.max(-15, Math.min(15, angDiff(80, h))) : h + Math.max(-15, Math.min(15, angDiff(195, h)));
  const primary = vivid(0.6, h, 0.22, 1);
  const secondary = vivid(0.55, secFromCover || sec === h0 ? sec : bandHue(sec, true), 0.2, 0.9);
  const accent: OKLCH = cyanAccent
    ? [COVER_CYAN_ACCENT_L, Math.min(COVER_CYAN_ACCENT_C, maxChroma(COVER_CYAN_ACCENT_L, acc) * 0.95), acc]
    : vivid(0.64, bandHue(acc, true), 0.2, 0.9);
  const hl = warm ? 0.88 : 0.86;
  const highlight: OKLCH = [hl, Math.min(0.13, maxChroma(hl, hh) * 0.95), wrapHue(hh)];
  return pal(name, [0.14, 0.02, h], primary, secondary, accent, highlight);
}

/** Through the bands like a still custom pick, but the olive band splits at
 * COVER_OLIVE_SPLIT: yellows go gold, greens go lime. */
function coverSnap(x: number): number {
  const h = wrapHue(x);
  const [a, b] = BANDS[0];
  if (h > a && h < b) return h <= COVER_OLIVE_SPLIT ? a + ((h - a) / (COVER_OLIVE_SPLIT - a)) * 3 : b - 3 + ((h - COVER_OLIVE_SPLIT) / (b - COVER_OLIVE_SPLIT)) * 3;
  return bandHue(h, true);
}

/** Does the shorter arc between two hues pass through the olive band? Only
 * its inside counts: a gold or lime end at the band's edge is fine (magenta
 * to gold blends through red and orange, never olive). */
function arcCrossesOlive(a: number, b: number): boolean {
  const d = angDiff(b, a);
  for (let i = 1; i < 16; i++) {
    const x = wrapHue(a + (d * i) / 16);
    if (x > BANDS[0][0] + 4 && x < BANDS[0][1] - 4) return true;
  }
  return false;
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

/** Auto Drift turn during a crossfade: each end's own turn, blended along the
 * shorter arc (a windowed palette and a full-turn one would otherwise jump). */
function blendTurn(a: Palette, b: Palette, t: number, phase: number): number {
  if (phase === 0) return 0;
  const ta = driftTurn(a, phase), tb = driftTurn(b, phase);
  if (t <= 0) return ta;
  if (t >= 1) return tb;
  return wrapHue(ta + angDiff(tb, ta) * t);
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
  const turn = smooth(50, 80, h) * (1 - smooth(95, 112, h));
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
  private driftHeld = false;
  private turnOverride: number | null = null;
  /** The user's palette (preset or custom): shown unless album colours drive. */
  private chosen: Palette;
  /** Album colours from the cover of what's playing (null: none). */
  private album: Palette | null = null;
  private speed = TRANSITION_SPEED;

  constructor() {
    this.from = PALETTES[0];
    this.to = PALETTES[0];
    this.current = PALETTES[0];
    this.chosen = PALETTES[0];
    this.resolved = resolvePalette(PALETTES[0]);
  }

  get paletteIndex(): number { return this._paletteIndex; }
  get driftEnabled(): boolean { return this.autoDrift; }
  get driftPeriodSeconds(): number { return this.driftPeriod; }
  /** Album colours are driving the palette right now. */
  get albumActive(): boolean { return this.album !== null; }
  /** Current Auto Drift hue offset in degrees (0 while album colours drive: D83). */
  get driftDegrees(): number { return this.autoDrift && !this.album ? this.driftPhase : 0; }

  /** Select a preset; `immediate` skips the crossfade. While album colours
   * drive, this only changes the palette they fall back to. */
  setPalette(index: number, immediate = false): void {
    const idx = ((index % PALETTES.length) + PALETTES.length) % PALETTES.length;
    if (idx === this._paletteIndex && this.progress >= 1 && this.chosen === PALETTES[idx]) return;
    this._paletteIndex = idx;
    this.chosen = PALETTES[idx];
    if (this.album) return;
    this.from = this.basePalette();
    this.to = this.chosen;
    this.speed = TRANSITION_SPEED;
    this.progress = immediate ? 1 : 0;
    if (immediate) this.update(0);
  }

  setCustomHue(hue: number): void {
    this._paletteIndex = -1;
    this.chosen = paletteFromHue(hue);
    if (this.album) return;
    this.from = this.basePalette();
    this.to = this.chosen;
    this.speed = TRANSITION_SPEED;
    this.progress = 0.85;
  }

  /** Album colours: crossfade (from what's on screen, drift included) to the
   * album palette, or back to the chosen palette with null. Auto Drift pauses
   * at turn 0 while an album drives and restarts from the chosen palette as
   * it is (D83). The same colours again change nothing. */
  setAlbum(p: Palette | null, fadeS = ALBUM_FADE_S, immediate = false): void {
    if (p === this.album || (p && this.album && samePalette(p, this.album))) return;
    const shown = this.current;
    this.album = p;
    this.from = shown;
    this.to = p ?? this.chosen;
    this.driftPhase = 0;
    this.speed = 1 / Math.max(0.05, fadeS);
    this.progress = immediate ? 1 : 0;
    if (immediate) this.update(0);
  }

  setAutoDrift(on: boolean): void { this.autoDrift = on; }

  /** Harness only: show this palette (RGB) instead of the presets; null clears. */
  setOverride(p: ResolvedPalette | null): void { this.override = p; if (p) this.resolved = p; }

  /** Harness only: jump Auto Drift to a hue offset (degrees). */
  setDriftPhase(deg: number): void { this.driftPhase = wrapHue(deg); }

  /** Harness only: hold Auto Drift at its phase (palette sweeps render 14 s per frame set). */
  holdDrift(on: boolean): void { this.driftHeld = on; }

  setDriftPeriod(seconds: number): void {
    this.driftPeriod = Math.max(MIN_DRIFT_PERIOD_S, Math.min(MAX_DRIFT_PERIOD_S, seconds));
  }

  update(dt: number): void {
    if (this.progress < 1) this.progress = Math.min(1, this.progress + this.speed * dt);
    if (this.autoDrift && !this.driftHeld && !this.album) this.driftPhase = wrapHue(this.driftPhase + (360 * dt) / this.driftPeriod);
    // The crossfade runs in OKLCH along the shorter hue arc (basePalette):
    // chroma never dips through grey, as an RGB crossfade between distant hues does.
    const base = this.basePalette();
    this.current = shiftPalette(base, this.turnNow(base));
    this.resolved = this.override ?? resolvePalette(this.current);
  }

  /** The Auto Drift turn applied right now (degrees). */
  private turnNow(base: Palette): number {
    if (this.turnOverride !== null) return this.turnOverride;
    const phase = this.driftDegrees;
    if (phase === 0) return 0;
    if (this.progress < 1 && (this.from.driftWindow || this.to.driftWindow)) return blendTurn(this.from, this.to, smoothT(this.progress), phase);
    return driftTurn(base, phase);
  }

  /** Harness only: hold the palette at this exact drift turn (degrees); null clears. */
  setTurnOverride(deg: number | null): void { this.turnOverride = deg === null ? null : wrapHue(deg); }

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

/** Two palettes with (nearly) the same colours: a new track from the same album. */
function samePalette(a: Palette, b: Palette): boolean {
  const slots: (keyof Palette)[] = ['bg', 'primary', 'secondary', 'accent', 'highlight'];
  return slots.every((k) => {
    const x = a[k] as OKLCH, y = b[k] as OKLCH;
    return Math.abs(x[0] - y[0]) < 0.01 && Math.abs(x[1] - y[1]) < 0.01 && Math.abs(angDiff(x[2], y[2])) < 2;
  });
}

function smoothT(t: number): number {
  return t * t * (3 - 2 * t);
}

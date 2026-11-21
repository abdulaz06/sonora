import { describe, expect, it } from 'vitest';
import { extractAlbum, COVER_SIZE } from './album-palette';
import { paletteFromCover, paletteFromHue, PALETTES, resolvePalette, type RGB } from './color-engine';
import { oklabToOklch, oklchToSrgb, srgbToOklab, type OKLCH } from './oklch';

const N = COVER_SIZE;
/** A synthetic cover: f(x, y) in 0..1 → sRGB 0..1. */
function cover(f: (x: number, y: number) => RGB): Uint8ClampedArray {
  const px = new Uint8ClampedArray(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = f((x + 0.5) / N, (y + 0.5) / N);
    const i = (y * N + x) * 4;
    px[i] = c[0] * 255; px[i + 1] = c[1] * 255; px[i + 2] = c[2] * 255; px[i + 3] = 255;
  }
  return px;
}
const lch = (l: number, c: number, h: number): RGB => oklchToSrgb([l, c, h]);
const hueOf = (c: RGB): number => oklabToOklch(srgbToOklab(c))[2];
const lchOf = (c: RGB): OKLCH => oklabToOklch(srgbToOklab(c));
const near = (a: number, b: number, tol: number): boolean => { const d = Math.abs(((a - b + 540) % 360) - 180); return d <= tol; };

describe('album palette: extraction', () => {
  it('a vivid single-colour cover gives that colour as the primary', () => {
    for (const h of [25, 145, 265, 330]) {
      const r = extractAlbum(cover(() => lch(0.6, 0.18, h)), N, N);
      expect(r.kind).toBe('vivid');
      expect(near(r.hues!.primary, h, 3), `hue ${h} → ${r.hues!.primary.toFixed(1)}`).toBe(true);
      expect(r.palette).not.toBeNull();
    }
  });

  it('grey and black-and-white covers give no palette (the user’s palette stays)', () => {
    expect(extractAlbum(cover(() => [0.5, 0.5, 0.5]), N, N).palette).toBeNull();
    expect(extractAlbum(cover((x) => (x < 0.5 ? [0.02, 0.02, 0.02] : [0.96, 0.96, 0.96])), N, N).palette).toBeNull();
    // A photo-like grey gradient with noise.
    const noisy = extractAlbum(cover((x, y) => { const v = 0.15 + 0.7 * x * y + 0.05 * Math.sin(x * 91 + y * 37); return [v, v * 1.01, v * 0.99]; }), N, N);
    expect(noisy.palette).toBeNull();
    expect(noisy.kind).toBe('grey');
  });

  it('near-black and near-white backgrounds are ignored when the cover has colour', () => {
    // Black cover, a blue logo on 6% of it.
    const logo = extractAlbum(cover((x, y) => (Math.hypot(x - 0.5, y - 0.5) < 0.14 ? lch(0.55, 0.2, 262) : [0.03, 0.03, 0.035])), N, N);
    expect(near(logo.hues!.primary, 262, 4)).toBe(true);
    // White cover, red title on a band.
    const title = extractAlbum(cover((_x, y) => (y > 0.45 && y < 0.53 ? lch(0.58, 0.21, 27) : [0.97, 0.96, 0.95])), N, N);
    expect(near(title.hues!.primary, 27, 4)).toBe(true);
  });

  it('a tinted cover without vivid colour (sepia) keeps its hue', () => {
    const r = extractAlbum(cover((x, y) => lch(0.3 + 0.5 * y, 0.035, 60 + 4 * x)), N, N);
    expect(r.kind).toBe('tinted');
    expect(r.palette).not.toBeNull();
  });

  it('two-tone: the second colour becomes the accent when it separates well', () => {
    const r = extractAlbum(cover((x) => (x < 0.6 ? lch(0.55, 0.2, 25) : lch(0.5, 0.2, 265))), N, N);
    expect(near(r.hues!.primary, 25, 4)).toBe(true);
    expect(r.hues!.accent).toBeDefined();
    expect(near(r.hues!.accent!, 265, 4)).toBe(true);
  });

  it('a gradient gives an analogous secondary from the cover', () => {
    const r = extractAlbum(cover((x) => lch(0.55, 0.19, 250 + 50 * x)), N, N);
    expect(r.hues!.secondary).toBeDefined();
    const d = Math.abs(((r.hues!.secondary! - r.hues!.primary + 540) % 360) - 180);
    expect(d).toBeGreaterThanOrEqual(18);
    expect(d).toBeLessThanOrEqual(62);
  });

  it('is deterministic', () => {
    const px = cover((x, y) => lch(0.4 + 0.3 * y, 0.15, (x * 300 + y * 50) % 360));
    expect(JSON.stringify(extractAlbum(px, N, N))).toBe(JSON.stringify(extractAlbum(px, N, N)));
  });

  it('ignores transparent pixels', () => {
    const px = cover((x) => (x < 0.5 ? lch(0.6, 0.2, 145) : [0, 0, 0]));
    for (let i = 0; i < N * N; i++) if (i % N >= N / 2) px[i * 4 + 3] = 0;
    expect(near(extractAlbum(px, N, N).hues!.primary, 145, 4)).toBe(true);
  });
});

describe('album palette: building', () => {
  it('with only a primary it is exactly the custom-hue palette (yellows aside: gold, not lime)', () => {
    for (let h = 0; h < 360; h += 7.5) {
      if (h > 65 && h < 140) continue;   // the olive band splits at 118° for covers (102.5° for custom)
      if (h > 162 && h < 245) continue;  // a cyan pick kept as the secondary is light cyan for covers
      const a = paletteFromCover({ primary: h }), b = paletteFromHue(h);
      // (The floor lifts for gold to teal primaries: Ink Glow Depth flicker.)
      expect({ ...a, name: '', bg: null }).toEqual({ ...b, name: '', bg: null });
    }
  });

  it('every album palette: in gamut, vivid, lightness matched to the presets, bone paper', () => {
    const presetL = PALETTES.map((p) => p.primary[0]);
    const lo = Math.min(...presetL) - 0.02, hi = Math.max(...presetL) + 0.08;
    for (let h = 0; h < 360; h += 10) for (const s of [undefined, h + 30, h - 40]) for (const a of [undefined, h + 100, h + 175, h - 80]) {
      const p = paletteFromCover({ primary: h, secondary: s, accent: a });
      const r = resolvePalette(p);
      for (const c of Object.values(r)) for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(lchOf(r.primary)[1], `h ${h}`).toBeGreaterThan(0.1);
      expect(p.primary[0]).toBeGreaterThan(lo);
      expect(p.primary[0]).toBeLessThan(hi);
      expect(p.paper).toEqual(PALETTES[0].paper);
      // Core colours never rest in the olive band (dark yellows read olive).
      for (const c of [p.primary, p.secondary, p.accent]) expect(c[2] <= 73.01 || c[2] >= 136.99 || c[0] > 0.75, `h ${h} s ${s} a ${a}: ${c}`).toBe(true);
    }
  });

  it('a far cover accent is pulled back to 100° on its own side (far ones whiten Wisp)', () => {
    const p = paletteFromCover({ primary: 260, accent: 260 + 178 });
    const d = Math.abs(((p.accent[2] - p.primary[2] + 540) % 360) - 180);
    expect(d).toBeLessThanOrEqual(101);
    expect(d).toBeGreaterThanOrEqual(80);
  });

  it('a yellow cover reads gold, a green one lime; a gold accent on magenta is kept', () => {
    expect(paletteFromCover({ primary: 108 }).primary[2]).toBeLessThan(70);
    expect(paletteFromCover({ primary: 125 }).primary[2]).toBeGreaterThan(136);
    // Magenta / purple with a yellow accent (a famous kind of cover): gold, not a derived blue.
    const g = paletteFromCover({ primary: 343, secondary: 320, accent: 101 });
    expect(g.accent[2]).toBeGreaterThan(55);
    expect(g.accent[2]).toBeLessThan(72);
  });

  it('gold to teal primaries sit on a lighter floor (Aurora / Acid), others on the usual one', () => {
    expect(paletteFromCover({ primary: 145 }).bg[0]).toBeCloseTo(0.16, 3);
    expect(paletteFromCover({ primary: 262 }).bg[0]).toBeCloseTo(0.14, 3);
    expect(paletteFromCover({ primary: 345 }).bg[0]).toBeCloseTo(0.14, 3);
  });

  it('a cyan cover accent stays cyan, as a light colour', () => {
    const p = paletteFromCover({ primary: 300, accent: 205 });
    expect(near(p.accent[2], 205, 2)).toBe(true);
    expect(p.accent[0]).toBeGreaterThan(0.74);
  });

  it('keeps the cover’s colours recognisable: hues within the band rules', () => {
    const p = paletteFromCover({ primary: 330, secondary: 300, accent: 250 });
    expect(near(p.primary[2], 330, 6)).toBe(true);
    expect(near(p.secondary[2], 300, 6)).toBe(true);
    expect(near(p.accent[2], 250, 6)).toBe(true);

    expect(near(hueOf(resolvePalette(p).primary), 330, 6)).toBe(true);
  });
});

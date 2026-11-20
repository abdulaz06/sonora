import { describe, expect, it } from 'vitest';
import { bandHue, ColorEngine, PALETTES, paletteFromHue, resolvePalette, shadeOf, type RGB } from './color-engine';
import { oklabToOklch, srgbToOklab } from './oklch';

/** v0.1 HSL → RGB, to prove the kept palettes did not move. */
function hsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const chroma = (c: RGB): number => oklabToOklch(srgbToOklab(c))[1];

describe('colour engine', () => {
  it('keeps the loved palettes exactly (Ocean, Ember, Neon, Crimson, Violet)', () => {
    const old: Record<string, RGB[]> = {
      Ocean: [hsl(220, 0.7, 0.55), hsl(260, 0.5, 0.45), hsl(180, 0.6, 0.5), hsl(200, 0.8, 0.7)],
      Ember: [hsl(15, 0.8, 0.5), hsl(35, 0.7, 0.45), hsl(350, 0.6, 0.45), hsl(45, 0.9, 0.6)],
      Neon: [hsl(300, 0.8, 0.55), hsl(180, 0.9, 0.5), hsl(60, 0.95, 0.55), hsl(330, 0.85, 0.65)],
      Crimson: [hsl(350, 0.8, 0.5), hsl(15, 0.65, 0.5), hsl(320, 0.7, 0.55), hsl(5, 0.85, 0.65)],
      Violet: [hsl(270, 0.7, 0.55), hsl(300, 0.5, 0.45), hsl(240, 0.6, 0.55), hsl(280, 0.75, 0.7)],
    };
    for (const [name, slots] of Object.entries(old)) {
      const p = PALETTES.find((x) => x.name === name);
      expect(p, name).toBeDefined();
      const r = resolvePalette(p!);
      [r.primary, r.secondary, r.accent, r.highlight].forEach((c, i) => {
        for (let k = 0; k < 3; k++) expect(Math.abs(c[k] - slots[i][k]), `${name} slot ${i}`).toBeLessThan(2e-3);
      });
    }
  });

  it('has nine palettes, no duotones, every slot in gamut', () => {
    expect(PALETTES).toHaveLength(9);
    for (const p of PALETTES) {
      const r = resolvePalette(p);
      for (const c of Object.values(r)) for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(chroma(r.primary), p.name).toBeGreaterThan(0.1);
    }
  });

  it('shade: the primary × 0.55 outside the yellows; dark gold turns amber, never olive', () => {
    for (const name of ['Ocean', 'Ember', 'Neon', 'Crimson', 'Violet']) {
      const r = resolvePalette(PALETTES.find((p) => p.name === name)!);
      r.primary.forEach((v, k) => expect(r.shade[k], name).toBeCloseTo(v * 0.55, 6));
    }
    for (let h = 60; h <= 120; h += 5) {
      const sh = oklabToOklch(srgbToOklab(shadeOf(resolvePalette(paletteFromHue(h)).primary)));
      expect(sh[2] < 75 || sh[2] > 125 || sh[0] > 0.62, `hue ${h}: shade at ${sh[2].toFixed(0)}°`).toBe(true);
    }
  });

  it('olive band: core hues cross it steeply but continuously; drift starts from the preset exactly', () => {
    for (let h = 0; h < 360; h += 0.5) {
      const d = Math.abs(bandHue(h + 0.5) - bandHue(h));
      expect(Math.min(d, 360 - d), `at ${h}`).toBeLessThan(4);   // ≤ 7× the input step, never a jump
    }
    for (let h = 0; h < 360; h += 5) {
      const p = paletteFromHue(h);
      for (const c of [p.primary, p.secondary, p.accent]) {
        expect(c[2] <= 73.01 || c[2] >= 124.99 || c[0] > 0.75, `hue ${h}: ${c.map((x) => x.toFixed(2))}`).toBe(true);
      }
    }
    const e = new ColorEngine();
    for (let i = 0; i < PALETTES.length; i++) {
      e.setPalette(i, true);
      e.setAutoDrift(true);
      e.setDriftPhase(0);
      e.update(0);
      expect(e.getResolved().primary).toEqual(resolvePalette(PALETTES[i]).primary);
      e.setAutoDrift(false);
    }
  });

  it('custom hue: vivid at every hue (no dead yellow-greens)', () => {
    for (let h = 0; h < 360; h += 15) {
      const r = resolvePalette(paletteFromHue(h));
      expect(chroma(r.primary), `hue ${h}`).toBeGreaterThan(0.1);
      expect(chroma(r.accent), `hue ${h}`).toBeGreaterThan(0.08);
    }
  });

  it('crossfades never dip toward grey', () => {
    for (let a = 0; a < PALETTES.length; a++) for (let b = 0; b < PALETTES.length; b++) {
      if (a === b) continue;
      const e = new ColorEngine();
      e.setPalette(a, true);
      e.setPalette(b);
      const A = resolvePalette(PALETTES[a]).primary, B = resolvePalette(PALETTES[b]).primary;
      const ends = Math.min(chroma(A), chroma(B));
      let minOk = Infinity;
      for (let i = 0; i <= 40; i++) {
        e.update(0.1);
        minOk = Math.min(minOk, chroma(e.getResolved().primary));
      }
      const tag = `${PALETTES[a].name} → ${PALETTES[b].name}`;
      // Only the sRGB gamut limits it (cyans can't be as saturated as blues);
      // grey starts below ~0.04.
      expect(minOk, tag).toBeGreaterThan(Math.max(0.08, ends * 0.5));
    }
  });
});

import { describe, expect, it } from 'vitest';
import { bandHue, ColorEngine, driftTurn, PALETTES, paletteFromHue, resolvePalette, shadeOf, type RGB } from './color-engine';
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
      expect(Math.min(d, 360 - d), `at ${h}`).toBeLessThan(5.5);   // ≤ 11× the input step, never a jump
    }
    for (let h = 0; h < 360; h += 5) {
      const p = paletteFromHue(h);
      for (const c of [p.primary, p.secondary, p.accent]) {
        expect(c[2] <= 73.01 || c[2] >= 136.99 || c[0] > 0.75, `hue ${h}: ${c.map((x) => x.toFixed(2))}`).toBe(true);
      }
      // The primary never rests in the dull cyan band either.
      expect(p.primary[2] <= 175.01 || p.primary[2] >= 241.99, `hue ${h}: primary ${p.primary[2].toFixed(1)}`).toBe(true);
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

  it('Auto Drift turns smoothly and crosses the olive / cyan spans quickly', () => {
    for (const p of PALETTES) {
      if (p.driftWindow) continue;   // sways inside its window instead (next test)
      let prev = 0, inOlive = 0, inCyan = 0;
      for (let ph = 0.5; ph < 360; ph += 0.5) {
        const t = driftTurn(p, ph);
        const step = t - prev;
        expect(step, `${p.name} at ${ph}`).toBeGreaterThanOrEqual(-1e-9);   // monotone
        expect(step, `${p.name} at ${ph}`).toBeLessThan(8);                   // a fast crossing, never a jump
        prev = t;
        const pri = (p.primary[2] + t) % 360, sec = (p.secondary[2] + t) % 360;
        if ((pri > 72 && pri < 128) || (sec > 72 && sec < 128)) inOlive += 0.5;
        if (pri > 165 && pri < 242) inCyan += 0.5;
      }
      // Accent and highlight: away from rest, never resting in the olive band
      // (styles dim them, and a dim yellow is olive).
      const e = new ColorEngine();
      e.setPalette(PALETTES.indexOf(p), true);
      e.setAutoDrift(true);
      let olive = 0;
      for (let ph = 45; ph < 315; ph += 1) {
        e.setDriftPhase(ph);
        e.update(0);
        for (const c of [e.getPalette().accent, e.getPalette().highlight]) if (c[2] > 72 && c[2] < 128) olive++;
      }
      expect(olive, `${p.name} accent/highlight in the olive band`).toBeLessThanOrEqual(30);
      expect(360 - prev, p.name).toBeLessThan(6);   // the turn comes round to 360 (= 0)
      // Only the quick crossings (12% of each forbidden stretch's width).
      expect(inOlive, p.name).toBeLessThanOrEqual(24);
      expect(inCyan, p.name).toBeLessThanOrEqual(24);
    }
  });

  it('wide-hue palettes (Neon) sway inside their drift window, smoothly, from turn 0', () => {
    const wide = PALETTES.filter((p) => p.driftWindow);
    expect(wide.map((p) => p.name)).toEqual(['Neon']);
    for (const p of wide) {
      const [lo, hi] = p.driftWindow!;
      const signed = (t: number): number => (t > 180 ? t - 360 : t);
      expect(driftTurn(p, 0)).toBeCloseTo(0, 9);
      let prev = 0, min = Infinity, max = -Infinity;
      for (let ph = 0.5; ph <= 360; ph += 0.5) {
        const t = signed(driftTurn(p, ph));
        expect(Math.abs(t - prev), `${p.name} at ${ph}`).toBeLessThan(0.6);   // smooth, no jump
        expect(t).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(t).toBeLessThanOrEqual(hi + 1e-9);
        min = Math.min(min, t); max = Math.max(max, t); prev = t;
      }
      expect(min).toBeCloseTo(lo, 1);
      expect(max).toBeCloseTo(hi, 1);
    }
    // Every other palette keeps the full turn.
    for (const p of PALETTES.filter((x) => !x.driftWindow)) expect(driftTurn(p, 359.5), p.name).toBeGreaterThan(354);
  });

  it('a crossfade between a windowed and a full-turn palette under Auto Drift never jumps', () => {
    const e = new ColorEngine();
    const neon = PALETTES.findIndex((p) => p.name === 'Neon');
    e.setPalette(neon, true);
    e.setAutoDrift(true);
    e.setDriftPhase(150);
    e.update(0);
    e.setPalette(0);
    let prev = e.getResolved().primary;
    for (let i = 0; i < 120; i++) {
      e.update(1 / 30);
      const cur = e.getResolved().primary;
      expect(Math.max(...cur.map((v, k) => Math.abs(v - prev[k]))), `step ${i}`).toBeLessThan(0.06);
      prev = cur;
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

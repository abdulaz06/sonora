import { describe, expect, it } from 'vitest';
import { PALETTES } from '../engine/color-engine';
import { capIsEven, DEFAULT_SETTINGS, fpsCapChoices, mergeWithDefaults, migratePaletteIndex, SETTINGS_VERSION } from './settings';

describe('settings migration', () => {
  it('fresh install: defaults, first run pending', () => {
    const s = mergeWithDefaults({ settingsVersion: SETTINGS_VERSION });
    expect(s.onboarded).toBe(false);
    expect(s.openLastVisual).toBe(false);
    expect(s.setMode).toEqual(DEFAULT_SETTINGS.setMode);
    expect(s.nowPlaying).toEqual(DEFAULT_SETTINGS.nowPlaying);
  });

  it('v1 (no version, retired style ids) to current', () => {
    const s = mergeWithDefaults({
      mode: 'flow-ink', variants: { 'flow-ink': 'ink' }, paletteIndex: 3, autoDrift: true,
      lightModes: { 'flow-ink': 'light' }, depth: { 'flow-ink': false }, audioDevice: 'Speakers (Realtek(R) Audio)',
    });
    expect(s.settingsVersion).toBe(SETTINGS_VERSION);
    expect(s.mode).toBe('ink');
    expect(s.variants.ink).toBe('glow');
    expect(s.lightModes.ink).toBe('light');
    expect(s.depth.ink).toBe(false);
    // v3 reset drift for old saves.
    expect(s.autoDrift).toBe(false);
    // Every style starts from the old shared colours.
    expect(s.styles.silk?.paletteIndex).toBe(3);
    // Upgrades skip the intro; the pinned device name becomes the fallback.
    expect(s.onboarded).toBe(true);
    expect(s.audioDeviceName).toBe('Speakers (Realtek(R) Audio)');
  });

  it('v4 retired ids map to the current lineup', () => {
    expect(mergeWithDefaults({ settingsVersion: 4, mode: 'strands', variants: { strands: 'wisp' } }).mode).toBe('wisp');
    expect(mergeWithDefaults({ settingsVersion: 4, mode: 'fractal' }).mode).toBe('voyage');
    expect(mergeWithDefaults({ settingsVersion: 4, mode: 'mosh' }).mode).toBe('ink');
  });

  it('v5 to v6 keeps every per-style value', () => {
    const v5 = {
      settingsVersion: 5, mode: 'silk', paletteIndex: 2, matchColours: false, quality: 'high', fpsCap: 144,
      styles: {
        ink: { paletteIndex: 4, customHue: 10, autoDrift: true, driftPeriod: 300, responsiveness: 0.9, camera: { height: 0.6, tilt: 0.75, curve: 1 }, flatZoom: 1.3 },
        silk: { paletteIndex: 2, customHue: 200, autoDrift: false, driftPeriod: 600, responsiveness: 0.2, camera: { height: 0.9, tilt: 0.73, curve: 1 }, flatZoom: 0.8 },
      },
    };
    const s = mergeWithDefaults(v5);
    expect(s.styles.ink).toEqual(v5.styles.ink);
    expect(s.styles.silk).toEqual(v5.styles.silk);
    expect(s.quality).toBe('high');
    expect(s.fpsCap).toBe(144);
    expect(s.onboarded).toBe(true);
    expect(s.launches).toBeGreaterThan(3);
  });

  it('v6 round-trips and clamps new fields', () => {
    const s = mergeWithDefaults({
      settingsVersion: 6, onboarded: true, openLastVisual: true, launches: 7, fullscreenMonitor: 'DISPLAY2',
      nowPlaying: { show: false, position: 'top-right', controls: false },
      setMode: { on: true, include: ['ink:glow', 'warp', 42], minInterval: 5, palettes: false },
      audioDevice: '{0.0.0.00000000}.{abc}', audioDeviceName: 'Headphones',
    });
    expect(s.openLastVisual).toBe(true);
    expect(s.launches).toBe(7);
    expect(s.fullscreenMonitor).toBe('DISPLAY2');
    expect(s.nowPlaying).toEqual({ show: false, position: 'top-right', controls: false });
    expect(s.setMode.include).toEqual(['ink:glow', 'warp']);
    expect(s.setMode.minInterval).toBe(30);
    expect(s.setMode.palettes).toBe(false);
    expect(s.audioDeviceName).toBe('Headphones');
    expect(mergeWithDefaults(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('v6 to v7: the old 60 fps default becomes match display, other caps are kept', () => {
    expect(mergeWithDefaults({ settingsVersion: 6, fpsCap: 60 }).fpsCap).toBe(0);
    expect(mergeWithDefaults({ settingsVersion: 3, fpsCap: 60 }).fpsCap).toBe(0);
    for (const cap of [30, 90, 120, 144, 0]) expect(mergeWithDefaults({ settingsVersion: 6, fpsCap: cap }).fpsCap).toBe(cap);
    // From v7 on, 60 is an explicit choice and stays.
    expect(mergeWithDefaults({ settingsVersion: 7, fpsCap: 60 }).fpsCap).toBe(60);
    expect(mergeWithDefaults({ settingsVersion: 7, fpsCap: -2 }).fpsCap).toBe(-2);
    expect(mergeWithDefaults({ settingsVersion: 7, fpsCap: 77 }).fpsCap).toBe(0);
    expect(DEFAULT_SETTINGS.fpsCap).toBe(0);
    const s = mergeWithDefaults({ settingsVersion: 6 });
    expect(s.showFps).toBe(false);
    expect(s.fpsCorner).toBe('top-left');
    const v7 = mergeWithDefaults({ settingsVersion: 7, showFps: true, fpsCorner: 'bottom-left', inkLegacy: true });
    expect([v7.showFps, v7.fpsCorner]).toEqual([true, 'bottom-left']);
    // The temporary Ink A/B switch is gone; an old save's value is dropped.
    expect('inkLegacy' in v7).toBe(false);
  });

  it('v7 to v8: palettes migrate by name, not index', () => {
    const name = (i: number): string => (i < 0 ? 'custom' : PALETTES[i].name);
    // Old order: Ocean, Aurora, Ember, Neon, Crimson, Gold, Violet, Ember / Black,
    // Ivory / Black, Cold / Black, Crimson / Black.
    const expected = ['Ocean', 'Aurora', 'Ember', 'Neon', 'Crimson', 'Solar', 'Violet', 'Ember', 'Ocean', 'Ocean', 'Crimson'];
    expected.forEach((n, old) => expect(name(migratePaletteIndex(old, 7))).toBe(n));
    expect(migratePaletteIndex(-1, 7)).toBe(-1);                    // custom hue kept
    expect(migratePaletteIndex(42, 7)).toBe(DEFAULT_SETTINGS.paletteIndex);   // unknown → default
    expect(migratePaletteIndex(3, 8)).toBe(3);                      // current saves untouched
    expect(migratePaletteIndex(99, 8)).toBe(DEFAULT_SETTINGS.paletteIndex);
    const s = mergeWithDefaults({
      settingsVersion: 7, paletteIndex: 5, customHue: 120, autoDrift: true,
      styles: {
        ink: { paletteIndex: 8, customHue: 10, autoDrift: true, driftPeriod: 300 },
        silk: { paletteIndex: -1, customHue: 200, autoDrift: false },
        warp: { paletteIndex: 10 },
        voyage: { paletteIndex: 6 },
      },
    });
    expect(name(s.paletteIndex)).toBe('Solar');
    expect(name(s.styles.ink!.paletteIndex)).toBe('Ocean');
    expect([s.styles.ink!.customHue, s.styles.ink!.autoDrift, s.styles.ink!.driftPeriod]).toEqual([10, true, 300]);
    expect(s.styles.silk!.paletteIndex).toBe(-1);
    expect(s.styles.silk!.customHue).toBe(200);
    expect(name(s.styles.warp!.paletteIndex)).toBe('Crimson');
    expect(name(s.styles.voyage!.paletteIndex)).toBe('Violet');
    // A v8 save is read as is.
    expect(mergeWithDefaults({ settingsVersion: 8, paletteIndex: 7 }).paletteIndex).toBe(7);
  });

  it('frame-rate choices pace evenly on the measured display', () => {
    const c165 = fpsCapChoices(165, 0);
    expect(c165.map((c) => c.label)).toEqual(['match', '82.5', '55', '30', '60', '120', '144']);
    expect(c165.filter((c) => c.uneven).map((c) => c.value)).toEqual([30, 60, 120, 144]);
    const c60 = fpsCapChoices(60, 0);
    expect(c60.map((c) => c.label)).toEqual(['match', '30']);
    expect(fpsCapChoices(144, 0).map((c) => c.label)).toEqual(['match', '72', '48', '30', '60', '120']);
    expect(capIsEven(60, 120)).toBe(true);
    expect(capIsEven(60, 165)).toBe(false);
    // A saved choice missing from the list is still offered.
    expect(fpsCapChoices(165, 90).some((c) => c.value === 90)).toBe(true);
  });

  it('garbage in, defaults out', () => {
    expect(mergeWithDefaults(null).mode).toBe(DEFAULT_SETTINGS.mode);
    expect(mergeWithDefaults({ nowPlaying: { position: 'middle' } }).nowPlaying.position).toBe('bottom-left');
  });
});

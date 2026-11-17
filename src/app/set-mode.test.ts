import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../ipc/settings';
import type { SonoraEvent } from '../engine/events';
import type { AudioFeatureFrame } from '../types/audio-frame';
import type { StyleId } from '../styles/visual-style';
import { PIECES } from './catalog';
import type { Controller, ShowOptions } from './controller';
import { createSetMode } from './set-mode';

function fakeController(flashOk = true) {
  const settings = defaultSettings();
  settings.setMode.on = true;
  const shows: { id: StyleId; o: ShowOptions }[] = [];
  const ctl = {
    settings,
    renderer: { requestFlash: () => flashOk },
    commit: () => undefined,
    variantFor: (id: StyleId) => settings.variants[id] ?? 'glow',
    depthFor: (id: StyleId) => settings.depth[id] ?? false,
    show: (id: StyleId, o: ShowOptions = {}) => {
      shows.push({ id, o });
      settings.mode = id;
      if (o.variant) settings.variants[id] = o.variant;
      if (o.depth !== undefined) settings.depth[id] = o.depth;
    },
    setPalette: (i: number) => { settings.paletteIndex = i; },
  } as unknown as Controller;
  return { ctl, settings, shows };
}

const frame = (intensity: number, four: number, ambient: number, bpm: number): AudioFeatureFrame => ({
  intensity, fade_in_out: 1, beat: { bpm, phase: 0, onset: false, confidence: four > 0.5 ? 0.9 : 0.1 },
  rhythm: { four_on_floor: four, ambient_free: ambient, half_time_heavy: 0, backbeat_groove: 0, broken_beat: 0, syncopated_dance: 0 },
}) as unknown as AudioFeatureFrame;
const ev = (type: SonoraEvent['type']): SonoraEvent => ({ type, strength: 1, time: 0 });

/** Seeded random so the test is repeatable. */
function rng(seed: number): () => number {
  let x = seed;
  return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
}

describe('Set Mode', () => {
  it('switches on a track change and respects the minimum interval', () => {
    const { ctl, settings, shows } = fakeController();
    const sm = createSetMode(ctl, () => undefined, rng(1));
    sm.onEvent(ev('trackChange'));
    expect(shows.length).toBe(1);
    expect(shows[0].o.cut).toBe(false);
    for (let i = 0; i < 60 * 30; i++) sm.onFrame(frame(0.5, 0.5, 0, 120));
    sm.onEvent(ev('trackChange'));
    expect(shows.length).toBe(1);
    for (let i = 0; i < 60 * settings.setMode.minInterval; i++) sm.onFrame(frame(0.5, 0.5, 0, 120));
    sm.onEvent(ev('trackChange'));
    expect(shows.length).toBe(2);
  });

  it('cuts on a drop after a long build only when the flash guard allows', () => {
    let cuts = 0, fades = 0;
    for (let seed = 1; seed < 40; seed++) {
      const { ctl, shows } = fakeController(true);
      const sm = createSetMode(ctl, () => undefined, rng(seed));
      sm.onEvent(ev('build'));
      for (let i = 0; i < 60 * 10; i++) sm.onFrame(frame(0.7, 0.9, 0, 128));
      sm.onEvent(ev('drop'));
      for (const s of shows) if (s.o.cut) cuts++; else fades++;
    }
    expect(cuts).toBeGreaterThan(10);
    expect(fades).toBe(0);
    const { ctl, shows } = fakeController(false);
    const sm = createSetMode(ctl, () => undefined, () => 0.1);
    sm.onEvent(ev('build'));
    for (let i = 0; i < 60 * 10; i++) sm.onFrame(frame(0.7, 0.9, 0, 128));
    sm.onEvent(ev('drop'));
    expect(shows[0]?.o.cut).toBe(false);
  });

  it('suits the music: calm leans calm, driving leans driving', () => {
    const energyOf = (id: StyleId, look?: string): number => PIECES.find((p) => p.style === id && (!look || p.look === look))?.energy ?? 0.5;
    const avg = (intensity: number, four: number, ambient: number, bpm: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const { ctl, shows } = fakeController();
        const sm = createSetMode(ctl, () => undefined, rng(seed));
        for (let i = 0; i < 60 * 40; i++) sm.onFrame(frame(intensity, four, ambient, bpm));
        sm.switchNow();
        sum += energyOf(shows[0].id, shows[0].o.variant);
      }
      return sum / 200;
    };
    expect(avg(0.9, 1, 0, 128) - avg(0.2, 0, 0.9, 80)).toBeGreaterThan(0.2);
  });

  it('never repeats the current piece and honours the include list', () => {
    const { ctl, settings, shows } = fakeController();
    settings.setMode.include = ['warp', 'silk'];
    const sm = createSetMode(ctl, () => undefined, rng(7));
    for (let i = 0; i < 10; i++) sm.switchNow();
    expect(shows.every((s) => s.id === 'warp' || s.id === 'silk')).toBe(true);
    for (let i = 1; i < shows.length; i++) expect(shows[i].id).not.toBe(shows[i - 1].id);
  });
});

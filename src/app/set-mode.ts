/**
 * Set Mode: runs sonora like a VJ. Switches style, look and view on a track
 * change (crossfade) and sometimes on a drop after a long build (hard cut on
 * the drop beat, if the flash guard allows it; else crossfade), never more
 * often than the minimum interval. Chooses to suit the music: a rolling
 * picture of energy, rhythm character and tempo is matched against each
 * piece's place on the calm → driving scale, with randomness and no repeats.
 */

import type { SonoraEvent } from '../engine/events';
import { PALETTES } from '../engine/color-engine';
import type { AudioFeatureFrame } from '../types/audio-frame';
import { PIECES, type Piece } from './catalog';
import type { Controller } from './controller';

// ── Tuning ──────────────────────────────────────────────────────
/** Rolling window for the music picture (s). */
const WINDOW_S = 20;
/** A drop counts as "after a long build" when the build lasted this long (s). */
const LONG_BUILD_S = 8;
/** Chance a long-build drop switches (when allowed by the interval). */
const DROP_SWITCH_P = 0.6;
/** No switch for this many intervals: switch at the next breakdown or track gap anyway. */
const FALLBACK_INTERVALS = 3;
/** How many recent picks are kept out of the next choice. */
const HISTORY = 3;
/** Width of the energy match (smaller = stricter). */
const MATCH_SIGMA = 0.24;

export interface SetMode {
  isOn(): boolean;
  setOn(on: boolean): void;
  onFrame(f: AudioFeatureFrame): void;
  onEvent(e: SonoraEvent): void;
  /** Switch now (e.g. when Set Mode starts). */
  switchNow(cut?: boolean): void;
  /** The music picture (0 calm … 1 driving), for the debug overlay. */
  energy(): number;
}

export function createSetMode(ctl: Controller, onChange: (on: boolean) => void, rand: () => number = Math.random): SetMode {
  const s = ctl.settings;
  let intensity = 0, conf = 0, four = 0, ambient = 0, bpm = 0;
  let lastSwitch = -Infinity;
  let buildStart = -1;
  let clock = 0;
  const history: string[] = [];

  const ema = (cur: number, v: number, dt: number): number => cur + (v - cur) * (1 - Math.exp(-dt / WINDOW_S));
  const energy = (): number => {
    let e = 0.45 * intensity + 0.3 * four + 0.25 * conf - 0.3 * ambient;
    if (bpm > 125) e += 0.1; else if (bpm > 0 && bpm < 95) e -= 0.1;
    return Math.max(0, Math.min(1, e));
  };

  function choose(): { piece: Piece; depth: boolean; palette: number | null } | null {
    const inc = s.setMode.include.length ? PIECES.filter((p) => s.setMode.include.includes(p.id)) : PIECES;
    if (!inc.length) return null;
    const current = currentPieceId();
    let pool = inc.filter((p) => !history.includes(p.id) && p.id !== current);
    if (!pool.length) pool = inc.filter((p) => p.id !== current);
    if (!pool.length) pool = inc;
    const e = energy();
    const weights = pool.map((p) => Math.exp(-((p.energy - e) ** 2) / (2 * MATCH_SIGMA ** 2)) * (0.55 + 0.9 * rand()));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total, k = 0;
    while (k < pool.length - 1 && (r -= weights[k]) > 0) k++;
    const piece = pool[k];
    // Views: driving music leans to Depth for Ink (the camera banks and lurches), calm to Flat.
    const depth = piece.views.length > 1 ? rand() < (piece.style === 'ink' ? 0.35 + 0.5 * e : 0.5) : piece.views[0] === 'depth';
    let palette: number | null = null;
    if (s.setMode.palettes) {
      const list = PALETTES.map((_, i) => i).filter((i) => i !== s.paletteIndex);
      palette = list[Math.floor(rand() * list.length)] ?? null;
    }
    return { piece, depth, palette };
  }

  function currentPieceId(): string {
    const id = s.mode;
    const look = ctl.variantFor(id);
    const depth = ctl.depthFor(id);
    if (id === 'wisp') return depth ? `wisp:${look}` : 'wisp:flat';
    return PIECES.find((p) => p.style === id && p.look === look)?.id ?? id;
  }

  function apply(cut: boolean): void {
    const c = choose();
    if (!c) return;
    // A hard cut is a deliberate flash: only if the guard allows it.
    const doCut = cut && ctl.renderer.requestFlash();
    ctl.show(c.piece.style, { variant: c.piece.look, depth: c.depth, cut: doCut });
    if (c.palette !== null) ctl.setPalette(c.palette);
    history.push(c.piece.id);
    while (history.length > HISTORY) history.shift();
    lastSwitch = clock;
  }

  const allowed = (): boolean => clock - lastSwitch >= s.setMode.minInterval;

  return {
    isOn: () => s.setMode.on,
    setOn(on: boolean) {
      if (s.setMode.on === on) return;
      s.setMode.on = on;
      ctl.commit();
      onChange(on);
    },
    onFrame(f: AudioFeatureFrame) {
      const dt = 1 / 60;
      clock += dt;
      if (!s.setMode.on) return;
      if (f.fade_in_out < 0.2) return;
      intensity = ema(intensity, f.intensity, dt);
      conf = ema(conf, f.beat.confidence, dt);
      four = ema(four, f.rhythm?.four_on_floor ?? 0, dt);
      ambient = ema(ambient, f.rhythm?.ambient_free ?? 0, dt);
      if (f.beat.bpm > 0 && f.beat.confidence > 0.3) bpm = bpm ? ema(bpm, f.beat.bpm, dt) : f.beat.bpm;
    },
    onEvent(e: SonoraEvent) {
      if (e.type === 'build') buildStart = clock;
      if (!s.setMode.on) return;
      if (e.type === 'trackChange' && allowed()) apply(false);
      else if (e.type === 'drop' && allowed()) {
        const longBuild = buildStart >= 0 && clock - buildStart >= LONG_BUILD_S;
        if (longBuild && rand() < DROP_SWITCH_P) apply(true);
      } else if (e.type === 'breakdown' && clock - lastSwitch >= s.setMode.minInterval * FALLBACK_INTERVALS) apply(false);
      if (e.type === 'drop') buildStart = -1;
    },
    switchNow(cut = false) { apply(cut); },
    energy,
  };
}

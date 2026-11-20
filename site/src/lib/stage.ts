/**
 * The page's one live engine. A single fixed canvas behind the sections; the
 * sections hand it scenes (style, look, view, palette) as they come into view.
 * Fed by the recorded demo frames (no permissions), rendered with the real
 * renderer, controller and Set Mode from ../src. Loaded lazily after first paint.
 *
 * It renders only while a live section is on screen, measures its own frame
 * times (Voyage falls back to its loop on slow GPUs), and keeps the engine's
 * flash guard (every deliberate flash goes through ctx.flash.request()).
 */

import { initRenderer, type Renderer } from '../../../src/engine/renderer';
import { initController, type Controller } from '../../../src/app/controller';
import { createSetMode, type SetMode } from '../../../src/app/set-mode';
import { PIECES } from '../../../src/app/catalog';
import { defaultSettings } from '../../../src/ipc/settings';
import type { QualityPreset } from '../../../src/engine/quality';
import type { StyleId } from '../../../src/styles/visual-style';
import type { DemoPlayer } from './demo-player';

// ── Tuning ──────────────────────────────────────────────────────
/** Backing store cap: the page is a showcase, not a fullscreen app. */
const MAX_PIXEL_RATIO = 1.5;
/** Frame-time window for the slow check (frames) and the bar (ms, median interval). */
const PACE_WINDOW = 90;
const SLOW_MEDIAN_MS = 24;
/** Largest dt a single step may take (s); a long pause resumes gently. */
const MAX_STEP_DT = 1 / 20;
/** Fixed seed: the hero poster is rendered with the same one. */
export const STAGE_SEED = 1234;
/** Set Mode on the page: switches as often as the demo allows. */
const SET_MODE_MIN_INTERVAL_S = 12;
/** Warm-up render steps per display frame. */
const WARM_STEPS_PER_FRAME = 4;
/** Frames the renderer's event layer hears per slice while warming up. */
const WARM_EVENT_SLICE = 700;

export interface Scene { style: StyleId; variant?: string; depth?: boolean }

export interface FrameStats { fps: number; medianMs: number; worstMs: number; stepMs: number; frames: number[] }

export interface Stage {
  readonly renderer: Renderer;
  readonly ctl: Controller;
  readonly setMode: SetMode;
  show(scene: Scene, cut?: boolean): void;
  /** Render (true) or idle (false); frames keep flowing either way. */
  setActive(on: boolean): void;
  isActive(): boolean;
  /** Called once when the renderer has drawn its first frames. */
  onReady(cb: () => void): void;
  /** Median frame interval over the last window exceeded the bar while `style` showed. */
  onSlow(cb: (style: StyleId) => void): void;
  stats(): FrameStats;
  /** Record every rendered frame's timestamp (pacing checks; -1 marks an idle gap); returns the log on stop. */
  recordFrames(on: boolean): number[];
  /** Warm-up: render the `seconds` before loop time `from` at `fps`, in small chunks, without showing it. */
  warm(from: number, seconds: number, fps?: number): Promise<void>;
}

/**
 * Compile these scenes' shaders in a worker on an OffscreenCanvas before the
 * page's own context exists. The GPU process caches the programs, so the
 * page's renderer later builds every style in milliseconds instead of seconds
 * (Voyage: ~3 s → ~40 ms). Run it while nothing live is on screen: the GPU
 * process is busy while it compiles. Resolves false if workers or
 * OffscreenCanvas are unavailable, or after `timeoutMs`.
 */
export function prewarm(scenes: Required<Scene>[], width: number, height: number, timeoutMs: number, onScene?: (s: Required<Scene>, ms: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof OffscreenCanvas === 'undefined') { resolve(false); return; }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./prewarm.worker.ts', import.meta.url), { type: 'module' });
    } catch { resolve(false); return; }
    const end = (ok: boolean): void => { window.clearTimeout(timer); worker.terminate(); resolve(ok); };
    const timer = window.setTimeout(() => end(false), timeoutMs);
    worker.onmessage = (e: MessageEvent<{ type: string; scene?: Required<Scene>; ms?: number }>) => {
      const m = e.data;
      if (m.type === 'scene' && m.scene) onScene?.(m.scene, m.ms ?? 0);
      if (m.type === 'done') end(true);
      if (m.type === 'error') end(false);
    };
    worker.onerror = () => end(false);
    const w = Math.max(320, Math.round(width / 2));
    worker.postMessage({ width: w, height: Math.max(180, Math.round((w * height) / Math.max(1, width))), scenes });
  });
}

export function createStage(canvas: HTMLCanvasElement, player: DemoPlayer, quality: QualityPreset): Stage {
  const renderer = initRenderer(canvas, { initialStyle: 'ink', autoStart: false, seed: STAGE_SEED, maxPixelRatio: MAX_PIXEL_RATIO });
  const settings = { ...defaultSettings(), onboarded: true, autoDrift: false, matchColours: true, quality };
  // Paper (Sumi) stays out of the page's Set Mode: a bone page between dark sections jars.
  settings.setMode = { ...settings.setMode, minInterval: SET_MODE_MIN_INTERVAL_S, palettes: false, include: PIECES.filter((p) => p.id !== 'ink:sumi').map((p) => p.id) };
  const ctl = initController({ renderer, settings, persist: () => undefined });
  // Seeded choices so the page's Set Mode is the same for everyone.
  let seed = 7;
  const rand = (): number => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const setMode = createSetMode(ctl, () => undefined, rand);
  renderer.onEvent((e) => setMode.onEvent(e));
  ctl.onLevel((_level, frame) => setMode.onFrame(frame));

  let active = false;
  let last = 0;
  let readyCbs: (() => void)[] | null = [];
  let drawn = 0;
  const slowCbs: ((s: StyleId) => void)[] = [];
  const intervals: number[] = [];
  let worst = 0;
  let stepMs = 0;
  let slowReported: StyleId | null = null;
  let log: number[] | null = null;

  function loop(now: number): void {
    requestAnimationFrame(loop);
    for (const f of player.tick()) ctl.onFrame(f);
    if (!active) {
      last = 0;
      // Pacing log: a gap marker, so idle time is not counted as a long frame.
      if (log && log[log.length - 1] !== -1) log.push(-1);
      return;
    }
    const dt = last ? Math.min((now - last) / 1000, MAX_STEP_DT) : 1 / 60;
    if (last) {
      intervals.push(now - last);
      if (intervals.length > PACE_WINDOW) intervals.shift();
    }
    last = now;
    log?.push(now);
    const t0 = performance.now();
    renderer.step(dt);
    stepMs = stepMs * 0.9 + (performance.now() - t0) * 0.1;
    if (readyCbs && ++drawn >= 3) { const cbs = readyCbs; readyCbs = null; for (const cb of cbs) cb(); }
    if (intervals.length === PACE_WINDOW) {
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[PACE_WINDOW >> 1];
      worst = sorted[PACE_WINDOW - 1];
      const style = renderer.getStyle();
      if (median > SLOW_MEDIAN_MS && slowReported !== style) {
        slowReported = style;
        for (const cb of slowCbs) cb(style);
      }
    }
  }
  requestAnimationFrame(loop);

  return {
    renderer, ctl, setMode,
    show(scene: Scene, cut = false): void {
      const cur = renderer.getStyle();
      const variant = scene.variant ?? ctl.variantFor(scene.style);
      const depth = scene.depth ?? ctl.depthFor(scene.style);
      if (cur === scene.style && renderer.getVariant() === variant && renderer.getDepth() === depth) return;
      intervals.length = 0;
      if (cur === scene.style && !cut) {
        // Same style: switch the look / view in place (as the app's chips do).
        if (renderer.getVariant() !== variant) ctl.setVariant(variant);
        if (renderer.getDepth() !== depth) ctl.setDepth(depth);
        return;
      }
      ctl.show(scene.style, { variant, depth, cut });
    },
    setActive(on: boolean): void {
      if (on === active) return;
      active = on;
      intervals.length = 0;
    },
    isActive: () => active,
    onReady(cb) { if (readyCbs) readyCbs.push(cb); else cb(); },
    onSlow(cb) { slowCbs.push(cb); },
    stats(): FrameStats {
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted.length ? sorted[sorted.length >> 1] : 0;
      return { fps: median ? 1000 / median : 0, medianMs: median, worstMs: worst, stepMs, frames: [...intervals] };
    },
    recordFrames(on: boolean): number[] {
      const out = log ?? [];
      log = on ? [] : null;
      return out;
    },
    async warm(from: number, seconds: number, fps = 30): Promise<void> {
      // Feed the frames before `from` and render at `fps` steps per second,
      // a few steps per display frame (no long task), so the fluid and
      // particles are already full when the canvas fades in.
      const frames = player.frames;
      const n = frames.length;
      const start = Math.round((from - seconds) * 60);
      // The event layer first hears one whole loop, as looping playback would
      // have (section, running loudness), then the render warm-up follows.
      for (let k = -n; k < 0; k += WARM_EVENT_SLICE) {
        for (let j = k; j < Math.min(0, k + WARM_EVENT_SLICE); j++) renderer.pushFrame(frames[(((start + j) % n) + n) % n]);
        await new Promise((r) => setTimeout(r, 0));
      }
      const per = Math.round(60 / fps);
      const total = Math.round(seconds * 60);
      let k = 0;
      while (k < total) {
        const until = Math.min(total, k + per * WARM_STEPS_PER_FRAME);
        for (; k < until; k++) {
          ctl.onFrame(frames[(((start + k) % n) + n) % n]);
          if ((k + 1) % per === 0) renderer.step(1 / fps);
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
    },
  };
}

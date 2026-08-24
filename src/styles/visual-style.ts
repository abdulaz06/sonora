/**
 * Visual style abstraction.
 *
 * A `VisualStyle` is a self-contained scene: it owns its shaders, GPU
 * resources, and per-frame logic. The renderer hands it a `StyleContext`
 * each frame containing the shared per-frame state (canvas, GL, mapping
 * signals, palette, etc.) and the style decides what to draw into the
 * scene FBO.
 *
 * Lifecycle:
 *   1. `init(deps)` — allocate programs, VAOs, buffers, primitives.
 *   2. `update(ctx)` — per-frame logic (no GL state changes required).
 *   3. `render(ctx)` — bound to scene FBO, draw the scene.
 *   4. `dispose()` — free GL resources when the user switches away.
 *
 * Steps 2 and 3 are split so styles can compute logic before any GL
 * binding happens, but it's fine for a style to do everything inside
 * `render` if simpler.
 */

import type { AudioFeatureFrame } from '../types/audio-frame';
import type { BeatPulse } from '../engine/beat-pulse';
import type { ColorEngine } from '../engine/color-engine';
import type { GenerativeState } from '../engine/generative';

export type StyleId = 'aura' | 'halo' | 'flow-ink';

/** A sub-variant within a style (e.g. Halo "Soft" vs "Sharp"). */
export interface VariantOption {
  id: string;
  label: string;
}

/**
 * Static variant definitions per style. The settings panel reads this to
 * show variant buttons immediately when a style is selected — no need to
 * wait for the style instance to be created (which happens mid-crossfade).
 */
export const STYLE_VARIANTS: Partial<Record<StyleId, VariantOption[]>> = {
  aura: [
    { id: 'circle',   label: 'Circle' },
    { id: 'triangle', label: 'Triangle' },
    { id: 'square',   label: 'Square' },
  ],
  halo: [
    { id: 'soft', label: 'Soft' },
    { id: 'sharp', label: 'Sharp' },
  ],
};

/** Shared dependencies handed to a style at construction time. */
export interface StyleDeps {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  /** Shared fullscreen quad VAO (positions in [-1,1]²). */
  quadVAO: WebGLVertexArrayObject;
}

/** Per-frame context. Mapping signals are pre-aggregated for convenience. */
export interface StyleContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  quadVAO: WebGLVertexArrayObject;

  frame: AudioFeatureFrame;
  time: number;
  dt: number;

  // Mapping-layer aggregates (see DOCS/14-MAPPING-LAYER-SPEC.md §"Hierarchy Rule")
  fadeInOut: number;
  intensity: number;        // raw from frame
  intensitySmoothed: number; // local envelope (responsiveness slider applies)
  bassHits: number;
  bassPresence: number;
  midHits: number;
  midPresence: number;
  highHits: number;
  highPresence: number;

  // Shared scene state
  beatPulse: BeatPulse;
  colorEngine: ColorEngine;
  generative: GenerativeState;
}

export interface VisualStyle {
  readonly id: StyleId;
  /** Per-frame logic; safe to do anything except change GL bindings. */
  update(ctx: StyleContext): void;
  /** Render the scene; the scene FBO is already bound and cleared. */
  render(ctx: StyleContext): void;
  /** Free all GL resources owned by this style. */
  dispose(): void;
  /** Optional: react to canvas size changes. Most styles can ignore. */
  resize?(width: number, height: number): void;

  // ── Variant support (optional) ──────────────────────────────
  /** Available sub-variants. Should match the static STYLE_VARIANTS map. */
  variants?: VariantOption[];
  /** Switch to a sub-variant by id. */
  setVariant?(id: string): void;
  /** Return the currently active variant id. */
  getVariant?(): string;

  // ── Ring count (optional, currently used by Aura) ───────────
  /** Set the number of concentric rings/shapes rendered. Implementations
   *  should clamp to their own valid range. */
  setRingCount?(n: number): void;
  /** Return the currently active ring count. */
  getRingCount?(): number;
}

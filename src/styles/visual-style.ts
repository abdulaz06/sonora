/**
 * Visual style interface (v2).
 *
 * A style is described by a `StyleDescriptor` (static metadata + factory, see
 * `registry.ts`) and implemented as a `VisualStyle` instance that owns its GL
 * resources. Each frame the renderer builds a `StyleContext` and calls:
 *
 *   onEvent(e, ctx)  for each event detected since the last frame (optional)
 *   update(ctx)      per-frame logic, no GL state changes required
 *   render(ctx)      draw; the scene FBO is bound and sized to ctx.width/height
 *
 * Styles consume the mapping layer (fade, intensity, presence, hits, juiced
 * FFT, beat) plus events, the world camera, the resolved palette, the quality
 * parameters, and may tweak `ctx.post` (bloom, grain, tonemap) for this frame.
 * Adding a style: write the module, add the id to `StyleId` and
 * `STYLE_VARIANTS`, add a descriptor to `registry.ts`, then verify with
 * `npm run verify` on all test tracks against the Quality Bar (DOCS/16).
 */

import type { AudioFeatureFrame } from '../types/audio-frame';
import type { BeatPulse } from '../engine/beat-pulse';
import type { WorldCamera } from '../engine/camera';
import type { ColorEngine, ResolvedPalette } from '../engine/color-engine';
import type { EventState, SonoraEvent } from '../engine/events';
import type { FlashGuard } from '../engine/flash-guard';
import type { GenerativeState } from '../engine/generative';
import type { QualityParams } from '../engine/quality';

export type StyleId = 'ink' | 'silk' | 'wisp' | 'warp' | 'voyage' | 'mosh' | 'aura' | 'halo';
export type StyleCategory = 'art' | 'classic';
/** Background preference: follow the variant's default, or force one. */
export type LightMode = 'auto' | 'dark' | 'light';

export interface VariantOption {
  id: string;
  label: string;
  /** True if this variant is ink-on-paper by default. */
  defaultLight?: boolean;
  /** Overrides the style's `supportsLight` for this variant. */
  lightCapable?: boolean;
}

/** Static variant definitions per style (UI reads these without an instance). */
export const STYLE_VARIANTS: Record<StyleId, VariantOption[]> = {
  ink: [
    { id: 'glow', label: 'Glow' },
    { id: 'marble', label: 'Marble' },
    { id: 'sumi', label: 'Sumi', defaultLight: true },
  ],
  silk: [{ id: 'silk', label: 'Silk' }],
  wisp: [{ id: 'wisp', label: 'Wisp', lightCapable: false }],
  warp: [{ id: 'warp', label: 'Warp', lightCapable: false }],
  voyage: [{ id: 'voyage', label: 'Voyage' }],
  mosh: [{ id: 'signal', label: 'Signal' }],
  aura: [
    { id: 'circle', label: 'Circle' },
    { id: 'triangle', label: 'Triangle' },
    { id: 'square', label: 'Square' },
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
  /** Shared fullscreen quad VAO (positions in [-1,1]², attribute 0). */
  quadVAO: WebGLVertexArrayObject;
  quality: QualityParams;
  /** Session seed, so the same song twice looks related but not identical. */
  seed: number;
}

/** Per-frame post-processing controls. Reset to defaults every frame. */
export interface PostControls {
  exposure: number;
  /** Bloom amount added to the scene. */
  bloom: number;
  /** HDR luminance above which pixels bloom ("true highlights" ≈ 1). */
  bloomThreshold: number;
  grain: number;
  vignette: number;
  /** 'filmic' for HDR emissive scenes, 'none' for display-referred (paper) scenes. */
  tonemap: 'filmic' | 'none';
  /** Multiplier on the global drop flash (0 disables). */
  flash: number;
}

export interface StyleSignals {
  fadeInOut: number;
  intensity: number;
  /** Intensity through the responsiveness envelope: drive motion with this. */
  intensitySmoothed: number;
  /** Slow, fixed intensity follower: drive brightness / density with this, so
   *  the Responsiveness slider never turns into flicker. */
  intensityGlow: number;
  bassHits: number;
  bassPresence: number;
  midHits: number;
  midPresence: number;
  highHits: number;
  highPresence: number;
  beatPhase: number;
  beatConfidence: number;
  beatOnset: boolean;
  /** Responsiveness slider, 0 = smooth, 1 = punchy. */
  responsiveness: number;
}

export interface StyleContext extends StyleSignals {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  quadVAO: WebGLVertexArrayObject;
  /** Size of the bound scene target (canvas × render scale for art styles). */
  width: number;
  height: number;
  /** Re-bind the scene target (after rendering into your own FBOs). */
  bindScene(): void;

  frame: AudioFeatureFrame;
  time: number;
  dt: number;

  /** Events detected since the previous render frame. */
  events: readonly SonoraEvent[];
  eventState: EventState;
  camera: WorldCamera;
  palette: ResolvedPalette;
  /** Resolved light/dark for this frame (after 'auto' and variant default). */
  light: boolean;
  /** Depth (3D) view requested — only meaningful if `supportsDepth`. */
  depth: boolean;
  quality: QualityParams;
  post: PostControls;
  /** Ask `flash.request()` before any deliberate flash (inversion, strobe). */
  flash: FlashGuard;

  beatPulse: BeatPulse;
  colorEngine: ColorEngine;
  generative: GenerativeState;
}

export interface VisualStyle {
  readonly id: StyleId;
  update(ctx: StyleContext): void;
  render(ctx: StyleContext): void;
  dispose(): void;
  resize?(width: number, height: number): void;

  // ── Optional hooks ──
  /** Variant list (mirrors STYLE_VARIANTS). */
  variants?: VariantOption[];
  /** Called once per event before `update`. */
  onEvent?(e: SonoraEvent, ctx: StyleContext): void;
  /** Quality changed: rebuild sims / meshes at the new sizes. */
  setQuality?(q: QualityParams): void;
  setVariant?(id: string): void;
  getVariant?(): string;
  /** Classic Aura only. */
  setRingCount?(n: number): void;
  getRingCount?(): number;
}

export interface StyleDescriptor {
  id: StyleId;
  label: string;
  category: StyleCategory;
  variants: VariantOption[];
  defaultVariant: string;
  /** Offers a light (ink-on-paper) look. */
  supportsLight: boolean;
  /** Offers a 3D depth view (with a Flat toggle). */
  supportsDepth: boolean;
  /** Depth on by default when supported. */
  defaultDepth: boolean;
  create(deps: StyleDeps): VisualStyle;
}

/** Resolve the effective light flag for a style/variant/user preference. */
export function resolveLight(desc: StyleDescriptor, variant: string, mode: LightMode): boolean {
  const v = desc.variants.find((x) => x.id === variant);
  if (!(v?.lightCapable ?? desc.supportsLight)) return false;
  if (mode === 'light') return true;
  if (mode === 'dark') return false;
  return v?.defaultLight ?? false;
}

/** Whether the Background (light/dark) control applies to this variant. */
export function variantSupportsLight(desc: StyleDescriptor, variant: string): boolean {
  return desc.variants.find((x) => x.id === variant)?.lightCapable ?? desc.supportsLight;
}

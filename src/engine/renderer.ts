/**
 * Renderer — owns the GL context, post-process pipeline, and the active
 * `VisualStyle`. Per-frame logic that's specific to a style lives in that
 * style's module (see `src/styles/`). The renderer's job is:
 *   - manage shared resources (canvas, FBOs, color/beat/generative state)
 *   - aggregate the mapping-layer signals into a `StyleContext`
 *   - hand off to `style.update + style.render`
 *   - run post-processing
 *   - cross-fade smoothly when the active style changes
 */

import type { AudioFeatureFrame } from '../types/audio-frame';
import type { QualityPreset } from '../ui/settings-panel';
import type { StyleId, VisualStyle } from '../styles/visual-style';

import { createAuraStyle } from '../styles/aura';
import { createFlowInkStyle } from '../styles/flow-ink';
import { createHaloStyle } from '../styles/halo-spectrum';

import { BeatPulse } from './beat-pulse';
import { ColorEngine } from './color-engine';
import { EnvelopeFollower, lerpParams, MEDIUM } from './envelope';
import { GenerativeState } from './generative';
import { buildProgram } from './gl-utils';
import { PostProcessPipeline } from './post-process';

import fullscreenVertSrc from './shaders/fullscreen.vert?raw';
import postBloomFragSrc from './shaders/post-bloom.frag?raw';
import postCompositeFragSrc from './shaders/post-composite.frag?raw';

// ── Helpers ─────────────────────────────────────────────────────

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// Cross-fade duration (seconds) when swapping styles. Half the time fades
// the old style out, then the new style is created and faded back in.
const STYLE_FADE_SECONDS = 0.45;

// ── Public API ──────────────────────────────────────────────────

export interface Renderer {
  updateFrame(frame: AudioFeatureFrame): void;
  setResponsiveness(t: number): void;
  setQuality(preset: QualityPreset): void;
  setStyle(id: StyleId): void;
  getStyle(): StyleId;
  setVariant(id: string): void;
  getVariant(): string | null;
  setRingCount(n: number): void;
  getRingCount(): number | null;
  /** True if the active style supports a ring-count slider. */
  styleHasRingCount(): boolean;
  colorEngine: ColorEngine;
}

// ── Renderer impl ───────────────────────────────────────────────

export interface RendererOptions {
  /** Style to start with (no cross-fade). Defaults to 'aura'. */
  initialStyle?: StyleId;
}

export function initRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): Renderer {
  const _gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!_gl) throw new Error('WebGL 2 not supported');
  const gl: WebGL2RenderingContext = _gl;

  // HDR FBO support — if missing, post-process bloom degrades gracefully.
  const extFloat = gl.getExtension('EXT_color_buffer_float');
  if (!extFloat) {
    console.warn('EXT_color_buffer_float not available — bloom quality may be reduced');
  }

  // ── Shared fullscreen quad (used by post-process and most styles) ──
  const quadVerts = new Float32Array([
    -1, -1, 1, -1, -1, 1,
    1, -1, 1, 1, -1, 1,
  ]);
  const quadVAO = gl.createVertexArray()!;
  const quadVBO = gl.createBuffer()!;
  gl.bindVertexArray(quadVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // ── Post-process programs (renderer-owned, style-independent) ──
  const bloomProg = buildProgram(gl, fullscreenVertSrc, postBloomFragSrc);
  const compositeProg = buildProgram(gl, fullscreenVertSrc, postCompositeFragSrc);
  const postProcess = new PostProcessPipeline(
    gl, bloomProg, compositeProg,
    canvas.width || 1024, canvas.height || 768,
  );

  // ── Shared scene state ──────────────────────────────────────
  const beatPulse = new BeatPulse();
  const colorEngine = new ColorEngine();
  const generative = new GenerativeState();

  // Local envelope on intensity — respects responsiveness slider for
  // bloom + flow-field reactivity even though Rust already smooths the
  // macro signal.
  const envIntensity = new EnvelopeFollower(MEDIUM);
  const allEnvelopes = [envIntensity];

  // ── Quality-controlled post-process base values ─────────────
  let bloomBase = 0.25;
  let bloomReactive = 0.2;

  // ── Active style + cross-fade state ─────────────────────────
  const styleDeps = { gl, canvas, quadVAO };
  const styleFactories: Record<StyleId, () => VisualStyle> = {
    aura: () => createAuraStyle(styleDeps),
    halo: () => createHaloStyle(styleDeps),
    'flow-ink': () => createFlowInkStyle(styleDeps),
  };

  let currentStyleId: StyleId = options.initialStyle ?? 'aura';
  let activeStyle: VisualStyle = styleFactories[currentStyleId]();
  let currentVariantId: string | null = null;
  // Cached ring count so it survives a style swap (re-applied to the new
  // style if it supports ring counts).
  let currentRingCount: number | null = null;

  // 1.0 = fully visible, 0.0 = fully hidden. We tween it during a swap.
  let styleFadeAlpha = 1.0;
  // null when idle. When set, we're heading toward this style.
  let pendingStyleId: StyleId | null = null;

  function beginSwap(target: StyleId): void {
    if (target === currentStyleId && pendingStyleId === null) return;
    pendingStyleId = target;
    // The render loop fades alpha to 0, then swaps, then fades back to 1.
  }

  function performSwap(): void {
    if (pendingStyleId === null || pendingStyleId === currentStyleId) {
      pendingStyleId = null;
      return;
    }
    activeStyle.dispose();
    currentStyleId = pendingStyleId;
    pendingStyleId = null;
    activeStyle = styleFactories[currentStyleId]();
    // Apply saved variant to the freshly created style
    if (currentVariantId && activeStyle.setVariant) {
      activeStyle.setVariant(currentVariantId);
    }
    // Re-apply saved ring count if the new style supports it
    if (currentRingCount !== null && activeStyle.setRingCount) {
      activeStyle.setRingCount(currentRingCount);
    }
  }

  // ── Frame state ─────────────────────────────────────────────
  let currentFrame: AudioFeatureFrame | null = null;
  let time = 0;
  let lastTime = performance.now() / 1000;

  gl.clearColor(0.025, 0.02, 0.04, 1.0);

  // ── Render loop ─────────────────────────────────────────────
  function render(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(now - lastTime, 0.05);
    lastTime = now;
    time += dt;

    resizeCanvas(canvas);
    postProcess.resize(canvas.width, canvas.height);
    activeStyle.resize?.(canvas.width, canvas.height);

    // Update generative drift even without frames — keeps state moving.
    generative.update(dt);

    // ── Cross-fade tween ──
    const fadeRate = 1.0 / (STYLE_FADE_SECONDS * 0.5); // half the time per direction
    if (pendingStyleId !== null) {
      // Fading out toward swap
      styleFadeAlpha = Math.max(0, styleFadeAlpha - fadeRate * dt);
      if (styleFadeAlpha <= 0) {
        performSwap();
      }
    } else if (styleFadeAlpha < 1) {
      // Fading back in after swap
      styleFadeAlpha = Math.min(1, styleFadeAlpha + fadeRate * dt);
    }

    if (!currentFrame) {
      // No audio yet — just clear and idle.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      requestAnimationFrame(render);
      return;
    }

    const f = currentFrame;

    // ── Mapping layer aggregates (Hierarchy Rule from spec §4) ──
    const fadeInOut = f.fade_in_out;
    const intensity = f.intensity;
    const bassHits = Math.max(f.hits.sub_bass, f.hits.bass);
    const bassPresence = Math.max(f.presence.sub_bass, f.presence.bass);
    const highHits = Math.max(f.hits.high, f.hits.air);
    const highPresence = Math.max(f.presence.high, f.presence.air);
    const midPresence = (f.presence.low_mid + f.presence.mid + f.presence.upper_mid) / 3;
    const midHits = Math.max(f.hits.low_mid, f.hits.mid, f.hits.upper_mid);

    const intensitySmoothed = envIntensity.update(intensity, dt);

    // ── Beat pulse (used by every style) ──
    beatPulse.update(
      f.beat.phase,
      f.beat.onset && fadeInOut > 0.5,
      dt,
      f.beat.confidence,
      f.energy.instant,
    );

    // ── Color engine ──
    colorEngine.update(dt);

    // ── Build per-frame style context ──
    const ctx = {
      gl, canvas, quadVAO,
      frame: f,
      time, dt,
      fadeInOut, intensity, intensitySmoothed,
      bassHits, bassPresence,
      midHits, midPresence,
      highHits, highPresence,
      beatPulse, colorEngine, generative,
    };

    // ── Style logic ──
    activeStyle.update(ctx);

    // ════════════════════════════════════════════════════════════
    // RENDER — into scene FBO, then post-process to the canvas
    // ════════════════════════════════════════════════════════════
    postProcess.bindSceneFBO();
    activeStyle.render(ctx);

    gl.disable(gl.BLEND);

    // Bloom rides on intensity × fadeInOut so silence genuinely dims.
    postProcess.bloomStrength = bloomBase + intensitySmoothed * bloomReactive * fadeInOut;

    // The cross-fade tint multiplies the scene during a style swap.
    const a = styleFadeAlpha;
    const tint: [number, number, number] = [a, a, a];

    gl.bindVertexArray(quadVAO);
    postProcess.apply(quadVAO, time, tint);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);

  return {
    updateFrame(frame: AudioFeatureFrame): void {
      currentFrame = frame;
    },
    setResponsiveness(t: number): void {
      const params = lerpParams(Math.max(0, Math.min(1, t)));
      for (const env of allEnvelopes) env.setParams(params);
    },
    setQuality(preset: QualityPreset): void {
      switch (preset) {
        case 'low':
          bloomBase = 0.08; bloomReactive = 0.1;
          postProcess.grainAmount = 0.0;
          postProcess.vignetteStrength = 0.2;
          break;
        case 'medium':
          bloomBase = 0.25; bloomReactive = 0.2;
          postProcess.grainAmount = 0.03;
          postProcess.vignetteStrength = 0.3;
          break;
        case 'high':
          bloomBase = 0.4; bloomReactive = 0.25;
          postProcess.grainAmount = 0.05;
          postProcess.vignetteStrength = 0.4;
          break;
      }
    },
    setStyle(id: StyleId): void {
      beginSwap(id);
    },
    getStyle(): StyleId {
      return pendingStyleId ?? currentStyleId;
    },
    setVariant(id: string): void {
      currentVariantId = id;
      if (activeStyle.setVariant) {
        activeStyle.setVariant(id);
      }
    },
    getVariant(): string | null {
      return activeStyle.getVariant?.() ?? currentVariantId;
    },
    setRingCount(n: number): void {
      currentRingCount = n;
      activeStyle.setRingCount?.(n);
    },
    getRingCount(): number | null {
      return activeStyle.getRingCount?.() ?? currentRingCount;
    },
    styleHasRingCount(): boolean {
      return typeof activeStyle.setRingCount === 'function';
    },
    colorEngine,
  };
}

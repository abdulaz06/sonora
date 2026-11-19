/**
 * Renderer — owns the GL context, shared engine state and the active style.
 *
 *   pushFrame(frame)   every analysis frame (60 Hz of audio): event layer runs
 *                      here so events are deterministic for a given input
 *   step(dt)           render one frame (the rAF loop calls this; the
 *                      verification harness calls it directly with a fixed dt)
 *
 * Per render frame: colour + camera + quality update → StyleContext → style
 * onEvent/update/render into the scene target → post → canvas. Art styles use
 * `ArtPost` at canvas × renderScale; classic styles keep the legacy pipeline.
 */

import type { AudioFeatureFrame } from '../types/audio-frame';
import { emptyFrame } from '../types/audio-frame';
import { getStyle } from '../styles/registry';
import {
  resolveLight,
  type LightMode,
  type PostControls,
  type StyleContext,
  type StyleDescriptor,
  type StyleId,
  type VisualStyle,
} from '../styles/visual-style';

import { ArtPost } from './art-post';
import { BeatPulse } from './beat-pulse';
import { WorldCamera } from './camera';
import { ColorEngine } from './color-engine';
import { EnvelopeFollower, GLOW, lerpParams, MEDIUM } from './envelope';
import { EventDetector, type SonoraEvent } from './events';
import { FlashGuard } from './flash-guard';
import { GenerativeState } from './generative';
import { buildProgram } from './gl-utils';
import { PostProcessPipeline } from './post-process';
import { QualityManager, type QualityParams, type QualityPreset } from './quality';
import { debugFlags } from './debug-flags';

import fullscreenVertSrc from './shaders/fullscreen.vert?raw';
import postBloomFragSrc from './shaders/post-bloom.frag?raw';
import postCompositeFragSrc from './shaders/post-composite.frag?raw';

/** A display frame up to this early still counts as on time for the cap (ms). */
const CAP_SLACK_MS = 2;
/** Display refresh measurement: rAF intervals kept (median of these). */
const REFRESH_SAMPLES = 120;
/** A cap within this fraction of refresh / k paces every k-th refresh. */
const DIVISOR_TOLERANCE = 0.04;
/** Frame pacing stats: rendered-frame times kept (s), and an interval longer
 * than this many refresh intervals counts as a held (repeated) frame. */
const PACING_WINDOW_S = 1;
const HELD_RATIO = 1.5;
/** Auto exposure: allowed blown-out fraction and mean linear luminance,
 *  lowest exposure it may reach, and how fast it falls / recovers (s). Slow
 *  enough that it never pumps on beats. */
const AE_HOT_TARGET = 0.03;
const AE_LUMA_TARGET = 0.2;
const AE_MIN = 0.5;
const AE_DOWN_TAU = 0.8;
const AE_UP_TAU = 4;
/** Flash-guard hold: while damping, exposure leans toward the running
 * luminance. The measurement is a frame late, so an instant correction
 * oscillates (frame-to-frame white/grey flicker on paper looks); the hold is
 * smoothed and kept within a gentle range so the loop can never ring. */
const HOLD_RANGE: [number, number] = [0.8, 1.25];
const HOLD_TAU = 0.25;

// ── Tuning ──────────────────────────────────────────────────────
/** Style swap: fade out, swap, fade in (total seconds). */
const STYLE_FADE_SECONDS = 0.6;
/** Largest dt a single step may advance (s). */
const MAX_DT = 0.05;
/** Cap on the canvas backing store (pixels on the long side). */
const MAX_BACKING_LONG_SIDE = 3840;
/** Default post values for art styles. */
const POST_DEFAULTS: PostControls = {
  exposure: 1, bloom: 0.55, bloomThreshold: 1.0, grain: 0.04, vignette: 0.28, tonemap: 'filmic', flash: 0,
};

export interface RendererStats {
  fps: number;
  frameMs: number;
  quality: QualityParams;
  /** Large luminance flashes measured in the last second (flash guard). */
  flashes: number;
  /** Auto-exposure multiplier currently applied (1 = none). */
  exposure: number;
  sceneWidth: number;
  sceneHeight: number;
}

/** Real-time frame pacing over the last second (FPS readout, harness). */
export interface PacingStats {
  /** Rendered frames per second. */
  fps: number;
  /** Longest interval between rendered frames (ms). */
  worstMs: number;
  /** Measured display refresh rate (Hz; 0 until measured). */
  displayHz: number;
  /** What the cap aims for right now (fps). */
  targetFps: number;
  /** Rendered frames that followed an interval longer than the paced one (held frames). */
  held: number;
}

export interface RendererOptions {
  initialStyle?: StyleId;
  /** Start the rAF loop immediately (default true). */
  autoStart?: boolean;
  /** Seed for camera/style variation (default random). */
  seed?: number;
  /** Keep the drawing buffer for readback (verification harness). */
  preserveDrawingBuffer?: boolean;
}

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly colorEngine: ColorEngine;
  readonly events: EventDetector;
  readonly camera: WorldCamera;
  pushFrame(frame: AudioFeatureFrame): void;
  step(dt: number): void;
  start(): void;
  stop(): void;
  setResponsiveness(t: number): void;
  setQuality(preset: QualityPreset): void;
  /** Frame-rate cap: 0 = match the display (every refresh), -k = every k-th
   * refresh (refresh / k, always even), > 0 = that many fps. */
  setFpsCap(fps: number): void;
  /** Measured display refresh rate (Hz; 0 until enough frames were seen). */
  displayHz(): number;
  pacing(): PacingStats;
  /** Record every rendered frame's timestamp (ms) until called with false; returns the log. */
  recordFrames(on: boolean): number[];
  getQualityPreset(): QualityPreset;
  setStyle(id: StyleId, immediate?: boolean): void;
  /** Switch style, look and view together: crossfade (default) or cut. The
   * look and view apply at the swap, so the outgoing picture never changes. */
  transition(t: { style: StyleId; variant: string; depth: boolean; cut?: boolean }): void;
  /** Ask the flash guard for a deliberate flash (e.g. a hard cut); false = skip it. */
  requestFlash(): boolean;
  getStyle(): StyleId;
  getDescriptor(): StyleDescriptor;
  setVariant(id: string): void;
  getVariant(): string;
  setLightMode(mode: LightMode): void;
  getLightMode(): LightMode;
  isLight(): boolean;
  setDepth(on: boolean): void;
  getDepth(): boolean;
  setRingCount(n: number): void;
  onEvent(cb: (e: SonoraEvent) => void): () => void;
  stats(): RendererStats;
}

function sizeCanvas(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  let w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  let h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  const long = Math.max(w, h);
  if (long > MAX_BACKING_LONG_SIDE) {
    const k = MAX_BACKING_LONG_SIDE / long;
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

export function initRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): Renderer {
  const ctxGl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: true, powerPreference: 'high-performance',
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
  if (!ctxGl) throw new Error('WebGL 2 not supported');
  const gl: WebGL2RenderingContext = ctxGl;
  // Every art style renders into float targets; without them the screen would stay black.
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('float render targets not supported (EXT_color_buffer_float)');
  gl.getExtension('OES_texture_float_linear');

  // ── Shared fullscreen quad ──
  const quadVAO = gl.createVertexArray()!;
  const quadVBO = gl.createBuffer()!;
  gl.bindVertexArray(quadVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // ── Post pipelines ──
  sizeCanvas(canvas);
  const legacyPost = new PostProcessPipeline(
    gl,
    buildProgram(gl, fullscreenVertSrc, postBloomFragSrc),
    buildProgram(gl, fullscreenVertSrc, postCompositeFragSrc),
    canvas.width, canvas.height,
  );
  legacyPost.bloomStrength = 0.25;
  const artPost = new ArtPost(gl);

  // ── Shared state ──
  const seed = options.seed ?? Math.floor(Math.random() * 1e6);
  const beatPulse = new BeatPulse();
  const colorEngine = new ColorEngine();
  const generative = new GenerativeState(seed);
  const events = new EventDetector();
  const camera = new WorldCamera(seed % 997);
  const quality = new QualityManager();
  const envIntensity = new EnvelopeFollower(MEDIUM);
  const envGlow = new EnvelopeFollower(GLOW);
  // Auto exposure (filmic scenes): pulls exposure down when the measured
  // frame is too bright or too much of it is blown out; recovers slowly.
  let autoExposure = 1;
  let holdSmooth = 1;
  let aeTarget = 1;
  const post: PostControls = { ...POST_DEFAULTS };
  const flash = new FlashGuard();
  quality.setFrameBudget(1000 / 60);

  let descriptor = getStyle(options.initialStyle ?? 'ink');
  let variant = descriptor.defaultVariant;
  let lightMode: LightMode = 'auto';
  let depth = descriptor.defaultDepth;
  let ringCount: number | null = null;

  const makeStyle = (d: StyleDescriptor): VisualStyle => {
    const s = d.create({ gl, canvas, quadVAO, quality: quality.params, seed });
    s.setVariant?.(variant);
    if (ringCount !== null) s.setRingCount?.(ringCount);
    return s;
  };
  let style = makeStyle(descriptor);
  quality.onChange((q) => style.setQuality?.(q));

  let fadeAlpha = 1;
  let pending: StyleDescriptor | null = null;
  /** Look / view to apply when the pending style swaps in (transition()). */
  let pendingLook: { variant: string; depth: boolean } | null = null;

  let frame: AudioFeatureFrame = emptyFrame();
  let time = 0;
  let running = false;
  let rafId = 0;
  let lastWall = 0;
  let fpsAccum = 0, fpsFrames = 0, fps = 0, frameMs = 0;
  let classicBloomBase = 0.25;

  const eventListeners: ((e: SonoraEvent) => void)[] = [];
  let sceneW = 1, sceneH = 1;

  const ctx: StyleContext = {
    gl, canvas, quadVAO,
    width: 1, height: 1,
    bindScene: () => {
      if (descriptor.category === 'classic') legacyPost.bindSceneFBO();
      else artPost.bindScene();
    },
    frame, time: 0, dt: 0,
    fadeInOut: 0, intensity: 0, intensitySmoothed: 0,
    bassHits: 0, bassPresence: 0, midHits: 0, midPresence: 0, highHits: 0, highPresence: 0,
    beatPhase: 0, beatConfidence: 0, beatOnset: false, analysisFrames: 0, responsiveness: 0.6, intensityGlow: 0,
    events: [], eventState: events.state, camera,
    palette: colorEngine.getResolved(), light: false, depth,
    quality: quality.params, post, flash,
    beatPulse, colorEngine, generative,
  };

  function step(rawDt: number): void {
    const dt = Math.min(Math.max(rawDt, 0), MAX_DT);
    time += dt;
    sizeCanvas(canvas);

    // Crossfade between styles
    const fadeRate = 2 / STYLE_FADE_SECONDS;
    if (pending) {
      fadeAlpha = Math.max(0, fadeAlpha - fadeRate * dt);
      if (fadeAlpha <= 0) {
        style.dispose();
        descriptor = pending;
        pending = null;
        if (pendingLook) { variant = pendingLook.variant; depth = pendingLook.depth; pendingLook = null; }
        variant = descriptor.variants.some((v) => v.id === variant) ? variant : descriptor.defaultVariant;
        style = makeStyle(descriptor);
      }
    } else if (fadeAlpha < 1) {
      fadeAlpha = Math.min(1, fadeAlpha + fadeRate * dt);
    }

    generative.update(dt);
    colorEngine.update(dt);
    flash.tick(dt);

    const f = frame;
    const drained = events.drain();
    for (const e of drained) for (const l of eventListeners) l(e);

    // Mapping aggregates (DOCS/14 hierarchy rule)
    ctx.frame = f;
    ctx.time = time;
    ctx.dt = dt;
    ctx.fadeInOut = f.fade_in_out;
    ctx.intensity = f.intensity;
    ctx.intensitySmoothed = envIntensity.update(f.intensity, dt);
    ctx.intensityGlow = envGlow.update(f.intensity, dt);
    ctx.bassHits = Math.max(f.hits.sub_bass, f.hits.bass);
    ctx.bassPresence = Math.max(f.presence.sub_bass, f.presence.bass);
    ctx.midHits = Math.max(f.hits.low_mid, f.hits.mid, f.hits.upper_mid);
    ctx.midPresence = (f.presence.low_mid + f.presence.mid + f.presence.upper_mid) / 3;
    ctx.highHits = Math.max(f.hits.high, f.hits.air);
    ctx.highPresence = Math.max(f.presence.high, f.presence.air);
    ctx.beatPhase = f.beat.phase;
    ctx.beatConfidence = f.beat.confidence;
    ctx.beatOnset = beatOnsetLatched;
    beatOnsetLatched = false;
    ctx.analysisFrames = framesSinceStep;
    framesSinceStep = 0;
    beatPulse.update(f.beat.phase, ctx.beatOnset && f.fade_in_out > 0.5, dt, f.beat.confidence, f.energy.instant);

    ctx.events = drained;
    ctx.eventState = events.state;
    ctx.palette = colorEngine.getResolved();
    ctx.light = resolveLight(descriptor, variant, lightMode);
    ctx.depth = descriptor.supportsDepth && depth;
    ctx.quality = quality.params;
    Object.assign(post, POST_DEFAULTS);
    post.grain = quality.params.level === 'low' ? 0.03 : 0.04;

    camera.update({
      dt, intensity: ctx.intensitySmoothed, fadeInOut: f.fade_in_out,
      beatOnset: ctx.beatOnset, beatConfidence: f.beat.confidence,
      events: drained, eventState: events.state,
    });

    if (descriptor.category === 'classic') {
      legacyPost.resize(canvas.width, canvas.height);
      sceneW = canvas.width; sceneH = canvas.height;
      ctx.width = sceneW; ctx.height = sceneH;
      camera.setAspect(sceneW / sceneH);
      style.resize?.(sceneW, sceneH);
      for (const e of drained) style.onEvent?.(e, ctx);
      style.update(ctx);
      legacyPost.bindSceneFBO();
      gl.clearColor(0.025, 0.02, 0.04, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      style.render(ctx);
      gl.disable(gl.BLEND);
      legacyPost.bloomStrength = classicBloomBase + ctx.intensitySmoothed * 0.2 * f.fade_in_out;
      legacyPost.apply(quadVAO, time, [fadeAlpha, fadeAlpha, fadeAlpha]);
    } else {
      const q = quality.params;
      sceneW = Math.max(1, Math.round(canvas.width * q.renderScale));
      sceneH = Math.max(1, Math.round(canvas.height * q.renderScale));
      artPost.resize(sceneW, sceneH, canvas.width, canvas.height, q.bloomLevels);
      ctx.width = sceneW; ctx.height = sceneH;
      camera.setAspect(sceneW / sceneH);
      style.resize?.(sceneW, sceneH);
      for (const e of drained) style.onEvent?.(e, ctx);
      style.update(ctx);
      artPost.bindScene();
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      style.render(ctx);
      const measured = artPost.takeLuma();
      if (measured !== null) flash.observe(measured);
      if (post.tonemap === 'filmic' && !debugFlags.fixedExposure) {
        if (measured !== null) {
          const over = Math.max((artPost.latestHot - AE_HOT_TARGET) / AE_HOT_TARGET, (measured - AE_LUMA_TARGET) / AE_LUMA_TARGET);
          aeTarget = over > 0 ? Math.max(AE_MIN, autoExposure * (1 - Math.min(0.4, over * 0.25))) : Math.min(1, autoExposure * 1.05);
        }
        autoExposure += (aeTarget - autoExposure) * (1 - Math.exp(-dt / (aeTarget < autoExposure ? AE_DOWN_TAU : AE_UP_TAU)));
        post.exposure *= autoExposure;
      }
      const holdWant = flash.current > 0.002 ? Math.min(HOLD_RANGE[1], Math.max(HOLD_RANGE[0], flash.target / flash.current)) : 1;
      holdSmooth += (1 + (holdWant - 1) * flash.damping - holdSmooth) * (1 - Math.exp(-dt / HOLD_TAU));
      artPost.apply(quadVAO, post, time, fadeAlpha, holdSmooth);
    }
  }

  // Beat onsets arrive at analysis rate; latch so a render frame never misses one.
  let beatOnsetLatched = false;
  let framesSinceStep = 0;

  // Frame-rate cap. "Match display" renders on every refresh. A cap that
  // divides the measured refresh (165 → 82.5, 55) renders every k-th refresh,
  // so frames stay evenly spaced. Any other cap renders on the refresh closest
  // to each due time: the average is right but the spacing alternates (e.g.
  // 60 on 165 Hz holds frames for 3-3-3-2 refreshes, which judders).
  let fpsCap = 0;
  let nextDue = 0;
  let lastRaf = 0;
  let refreshMs = 0;
  let rafCount = 0;
  const rafIntervals: number[] = [];
  const rendered: number[] = [];
  let frameLog: number[] | null = null;

  /** Every-k-th-refresh pacing for the current cap, or 0 for due-time pacing. */
  function refreshDivisor(): number {
    if (fpsCap === 0) return 1;
    if (fpsCap < 0) return Math.max(1, Math.round(-fpsCap));
    if (!refreshMs) return 0;
    const k = 1000 / refreshMs / fpsCap;
    const kr = Math.round(k);
    return kr >= 1 && Math.abs(k - kr) <= DIVISOR_TOLERANCE * kr ? kr : 0;
  }

  function measureRefresh(now: number): void {
    if (lastRaf) {
      const d = now - lastRaf;
      if (d > 2 && d < 100) {
        rafIntervals.push(d);
        if (rafIntervals.length > REFRESH_SAMPLES) rafIntervals.shift();
        if (rafIntervals.length >= 20) {
          // rAF never fires early, but slow frames stretch some intervals: take
          // the mean of the intervals near the fastest (within 20% of the 10th
          // percentile), which is the refresh without the jitter bias.
          const sorted = [...rafIntervals].sort((a, b) => a - b);
          const base = sorted[Math.floor(sorted.length * 0.1)];
          const near = sorted.filter((d) => d <= base * 1.2);
          refreshMs = near.reduce((x, y) => x + y, 0) / near.length;
        }
      }
    }
    lastRaf = now;
  }

  function loop(now: number): void {
    if (!running) return;
    measureRefresh(now);
    // Auto quality judges frame time against the paced interval.
    if (fpsCap < 0 && refreshMs) quality.setFrameBudget(refreshMs * -fpsCap);
    rafCount++;
    const k = refreshDivisor();
    if (k > 1) {
      if (rafCount % k !== 0) { rafId = requestAnimationFrame(loop); return; }
    } else if (k === 0 && fpsCap > 0) {
      const interval = 1000 / fpsCap;
      if (nextDue === 0 || now - nextDue > interval * 2) nextDue = now;
      if (now < nextDue - CAP_SLACK_MS) { rafId = requestAnimationFrame(loop); return; }
      nextDue += interval;
    }
    rendered.push(now);
    while (rendered.length && now - rendered[0] > PACING_WINDOW_S * 1000) rendered.shift();
    frameLog?.push(now);
    const nowS = now / 1000;
    const wallDt = lastWall ? nowS - lastWall : 1 / 60;
    lastWall = nowS;
    const t0 = performance.now();
    step(wallDt);
    frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
    quality.sample(wallDt * 1000);
    fpsAccum += wallDt; fpsFrames++;
    if (fpsAccum >= 0.5) { fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }
    rafId = requestAnimationFrame(loop);
  }

  const api: Renderer = {
    canvas, colorEngine, events, camera,
    pushFrame(fr: AudioFeatureFrame): void {
      events.process(fr);
      if (fr.beat.onset) beatOnsetLatched = true;
      framesSinceStep++;
      frame = fr;
    },
    step,
    start(): void {
      if (running) return;
      running = true;
      lastWall = 0;
      lastRaf = 0;
      rafId = requestAnimationFrame(loop);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
    },
    setResponsiveness(t: number): void {
      const r = Math.max(0, Math.min(1, t));
      envIntensity.setParams(lerpParams(r));
      ctx.responsiveness = r;
    },
    setFpsCap(n: number): void {
      fpsCap = Number.isFinite(n) ? n : 0;
      nextDue = 0;
      quality.setFrameBudget(fpsCap > 0 ? 1000 / fpsCap : 0);
    },
    displayHz: () => (refreshMs ? 1000 / refreshMs : 0),
    pacing(): PacingStats {
      const hz = refreshMs ? 1000 / refreshMs : 0;
      const k = refreshDivisor();
      const target = k >= 1 ? hz / k : fpsCap > 0 ? fpsCap : hz;
      let worst = 0, held = 0;
      // A frame is held when it follows a longer gap than the pacing intends.
      const paced = k >= 1 && refreshMs ? refreshMs * k : target > 0 ? 1000 / target : 0;
      for (let i = 1; i < rendered.length; i++) {
        const d = rendered[i] - rendered[i - 1];
        worst = Math.max(worst, d);
        if (paced && d > paced + refreshMs * (HELD_RATIO - 1)) held++;
      }
      const span = rendered.length > 1 ? (rendered[rendered.length - 1] - rendered[0]) / 1000 : 0;
      return { fps: span > 0 ? (rendered.length - 1) / span : 0, worstMs: worst, displayHz: hz, targetFps: target, held };
    },
    recordFrames(on: boolean): number[] {
      const log = frameLog ?? [];
      frameLog = on ? [] : null;
      return log;
    },
    setQuality(p: QualityPreset): void {
      quality.setPreset(p);
      classicBloomBase = quality.params.level === 'low' ? 0.08 : quality.params.level === 'high' ? 0.4 : 0.25;
      legacyPost.grainAmount = quality.params.level === 'low' ? 0 : 0.03;
    },
    getQualityPreset: () => quality.currentPreset,
    setStyle(id: StyleId, immediate = false): void {
      const d = getStyle(id);
      if (d.id === descriptor.id && !pending) return;
      depth = d.defaultDepth;
      if (immediate) {
        style.dispose();
        descriptor = d;
        pending = null;
        variant = d.defaultVariant;
        style = makeStyle(d);
        return;
      }
      pending = d;
    },
    transition(t): void {
      const d = getStyle(t.style);
      if (t.cut) {
        style.dispose();
        descriptor = d;
        pending = null;
        pendingLook = null;
        variant = d.variants.some((v) => v.id === t.variant) ? t.variant : d.defaultVariant;
        depth = t.depth;
        style = makeStyle(d);
        fadeAlpha = 1;
        return;
      }
      if (d.id === descriptor.id && !pending && variant === t.variant && depth === t.depth) return;
      pending = d;
      pendingLook = { variant: t.variant, depth: t.depth };
    },
    requestFlash: () => flash.request(),
    getStyle: () => (pending ?? descriptor).id,
    getDescriptor: () => pending ?? descriptor,
    setVariant(id: string): void {
      variant = id;
      style.setVariant?.(id);
    },
    getVariant: () => style.getVariant?.() ?? variant,
    setLightMode(m: LightMode): void { lightMode = m; },
    getLightMode: () => lightMode,
    isLight: () => resolveLight(descriptor, variant, lightMode),
    setDepth(on: boolean): void { depth = on; },
    getDepth: () => depth,
    setRingCount(n: number): void {
      ringCount = n;
      style.setRingCount?.(n);
    },
    onEvent(cb: (e: SonoraEvent) => void): () => void {
      eventListeners.push(cb);
      return () => {
        const i = eventListeners.indexOf(cb);
        if (i >= 0) eventListeners.splice(i, 1);
      };
    },
    stats: () => ({ fps, frameMs, quality: quality.params, flashes: flash.recentFlashes, exposure: autoExposure, sceneWidth: sceneW, sceneHeight: sceneH }),
  };

  if (options.autoStart ?? true) api.start();
  return api;
}

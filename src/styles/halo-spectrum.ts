/**
 * Halo Spectrum — circular bar graph with a base ring and 48 frequency
 * bars that radiate outward, react to transients, and decay back down.
 *
 * Two variants (selectable in the settings panel):
 *   "soft"  — bars are wide, smoothly interpolated, and merge into each
 *             other like flames or aurora tendrils rising from the ring.
 *   "sharp" — bars are thin, crisp radial lines with clear separation;
 *             looks like a premium circular equalizer.
 *
 * Architecture (preserved from previous versions):
 *   1. SHUFFLE  — seeded Fisher-Yates scatter of 96 FFT bins so energy
 *                 distributes irregularly (no gear-tooth pattern).
 *   2. ROTATE   — slow mapping phase (~1 rev / 25 s) drifts which bins
 *                 drive which bars, so the same kick looks different.
 *   3. PULSE    — per-bar attack/decay (fast up, ~200 ms decay). Bars
 *                 shoot up on hits and relax back to zero (flat ring).
 *   4. AMPLITUDE — per-bin random gain [0.3–1.0] breaks uniform spikes.
 *   5. SMOOTH   — two passes of 3-bar circular average (proportional to
 *                 the previous 9-bin/96-slot smoothing).
 *   6. LFOs     — per-group breathing sines [0.8–1.2] at 15/17/19 s.
 *
 * Layer 1 (base ring) never deforms — stays perfectly circular.
 * Layer 2 (bars) reacts and relaxes. Together they look like a glowing
 * ring with organic frequency tendrils (soft) or precision bars (sharp).
 *
 * Driving signals (DOCS/14-MAPPING-LAYER-SPEC.md):
 *   - Juiced FFT (96 bins) → 48 bar heights via pulse buffer
 *   - bass hits            → global ring-radius kick
 *   - intensity            → base ring size (macro)
 *   - high presence        → rim shimmer on ring edge
 *   - fade_in_out          → overall visibility
 */

import { hslToRgb } from '../engine/color-engine';
import { EnvelopeFollower, MEDIUM } from '../engine/envelope';
import { buildProgram } from '../engine/gl-utils';
import { STYLE_VARIANTS } from './visual-style';

import fullscreenVertSrc from '../engine/shaders/fullscreen.vert?raw';
import haloFragSrc from '../engine/shaders/halo.frag?raw';

import type { StyleContext, StyleDeps, VariantOption, VisualStyle } from './visual-style';

const N_BARS  = 48;    // bars around the circle
const N_FFT   = 96;    // juiced-FFT bins from the mapping layer
const BINS_PER_BAR = N_FFT / N_BARS;   // = 2

const TAU = Math.PI * 2;

// ── Pulse buffer tuning ──────────────────────────────────────────────
// Snap up fast, linger longer. These constants are normalised to a
// 60 fps frame; both decay and attack are recompensated by dt below
// so the perceived envelope is frame-rate independent.
const PULSE_DECAY_PER_FRAME  = 0.88;   // slower decay → bars stay visible longer
const PULSE_ATTACK_PER_FRAME = 0.60;   // very fast snap up — ~93 % within 50 ms

// ── Slow mapping rotation ─────────────────────────────────────────────
const MAPPING_PERIOD_SEC = 25;

// ── Per-group breathing LFOs ─────────────────────────────────────────
const BASS_LFO_PERIOD = 15;            // coprime primes → never sync
const MID_LFO_PERIOD  = 17;
const HIGH_LFO_PERIOD = 19;
const LFO_AMPLITUDE   = 0.2;           // ±20 % → [0.8, 1.2]

// ── Spatial smoothing (per-bar) ──────────────────────────────────────
// ±2 bars = 5-bar kernel, two passes → effective ~9-bar triangular ≈ 67°
const SMOOTH_RADIUS = 2;

// ── Seeded PRNG (LCG) ────────────────────────────────────────────────
function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Fisher-Yates shuffle of [0..95]. Scatters bass bins irregularly. */
function buildShuffleArray(): Int32Array {
  const rng = seededRng(42);
  const arr = new Int32Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) arr[i] = i;
  for (let i = N_FFT - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

/** Per-bin amplitude multiplier in [0.3, 1.0]. Breaks uniform kicks. */
function buildBinAmplitudes(): Float32Array {
  const rng = seededRng(137);
  const arr = new Float32Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) arr[i] = 0.3 + rng() * 0.7;
  return arr;
}

export function createHaloStyle(deps: StyleDeps): VisualStyle {
  const { gl } = deps;

  const prog = buildProgram(gl, fullscreenVertSrc, haloFragSrc);

  const u = {
    resolution  : gl.getUniformLocation(prog, 'u_resolution')!,
    time        : gl.getUniformLocation(prog, 'u_time')!,
    pulse       : gl.getUniformLocation(prog, 'u_pulse')!,
    intensity   : gl.getUniformLocation(prog, 'u_intensity')!,
    bassPulse   : gl.getUniformLocation(prog, 'u_bass_pulse')!,
    highPresence: gl.getUniformLocation(prog, 'u_high_presence')!,
    fadeInOut   : gl.getUniformLocation(prog, 'u_fade_in_out')!,
    variant     : gl.getUniformLocation(prog, 'u_variant')!,
    colorInner  : gl.getUniformLocation(prog, 'u_color_inner')!,
    colorMid    : gl.getUniformLocation(prog, 'u_color_mid')!,
    colorOuter  : gl.getUniformLocation(prog, 'u_color_outer')!,
    colorAccent : gl.getUniformLocation(prog, 'u_color_accent')!,
  };

  // ── Static data (built once per style instance) ──────────────────
  const shuffleArray  = buildShuffleArray();
  const binAmplitudes = buildBinAmplitudes();

  // ── Per-frame buffers (pre-allocated) ────────────────────────────
  const pulseBuf    = new Float32Array(N_BARS);   // raw attack/decay state
  const smoothBuf   = new Float32Array(N_BARS);   // scratch: smoothing pass 1
  const pulseRender = new Float32Array(N_BARS);   // final output → shader
  const posLfo      = new Float32Array(N_BARS);   // cached LFO per bar

  // ── Global signal envelopes ──────────────────────────────────────
  const bassPulseEnv    = new EnvelopeFollower(MEDIUM);
  const highPresenceEnv = new EnvelopeFollower(MEDIUM);

  // ── Variant state ─────────────────────────────────────────────────
  let variantId = 'soft';   // default

  // ── Slow-evolution state ─────────────────────────────────────────
  let mappingPhase = 0;
  let lfoTime      = 0;

  let cachedBassPulse    = 0;
  let cachedHighPresence = 0;

  return {
    id: 'halo',

    variants: STYLE_VARIANTS['halo'] as VariantOption[],
    setVariant(id: string): void { variantId = id; },
    getVariant(): string { return variantId; },

    update(ctx: StyleContext): void {
      const { dt, frame, bassHits, highPresence, intensitySmoothed } = ctx;

      // Advance slow-evolution clocks
      mappingPhase = (mappingPhase + dt / MAPPING_PERIOD_SEC) % 1;
      lfoTime += dt;

      const bassLfo = 1 + LFO_AMPLITUDE * Math.sin(TAU * lfoTime / BASS_LFO_PERIOD);
      const midLfo  = 1 + LFO_AMPLITUDE * Math.sin(TAU * lfoTime / MID_LFO_PERIOD);
      const highLfo = 1 + LFO_AMPLITUDE * Math.sin(TAU * lfoTime / HIGH_LFO_PERIOD);

      const decayMul    = Math.pow(PULSE_DECAY_PER_FRAME,     dt * 60);
      const attackAlpha = 1 - Math.pow(1 - PULSE_ATTACK_PER_FRAME, dt * 60);

      const src    = frame.juiced_fft;
      const srcLen = src.length;

      // ── Per-bar pulse update ───────────────────────────────────
      // Each bar averages BINS_PER_BAR shuffled+rotated FFT bins.
      for (let bar = 0; bar < N_BARS; bar++) {
        let avg = 0;
        let primaryBin = 0;   // first bin — determines LFO group

        for (let b = 0; b < BINS_PER_BAR; b++) {
          const fftPos     = bar * BINS_PER_BAR + b;
          const srcAngle   = (fftPos / N_FFT + mappingPhase) % 1;
          const shuffleIdx = Math.floor(srcAngle * N_FFT) % N_FFT;
          const sourceBin  = shuffleArray[shuffleIdx];
          if (b === 0) primaryBin = sourceBin;
          const rawVal = sourceBin < srcLen ? src[sourceBin] : 0;
          avg += rawVal * binAmplitudes[sourceBin];
        }
        avg /= BINS_PER_BAR;

        posLfo[bar] = primaryBin < 32 ? bassLfo
                    : primaryBin < 64 ? midLfo
                    : highLfo;

        pulseBuf[bar] *= decayMul;
        if (avg > pulseBuf[bar]) {
          pulseBuf[bar] += (avg - pulseBuf[bar]) * attackAlpha;
        }
      }

      // ── Spatial smoothing: two passes of (2*SMOOTH_RADIUS+1)-bar avg
      for (let bar = 0; bar < N_BARS; bar++) {
        let sum = 0;
        for (let k = -SMOOTH_RADIUS; k <= SMOOTH_RADIUS; k++) {
          sum += pulseBuf[(bar + k + N_BARS) % N_BARS];
        }
        smoothBuf[bar] = sum / (SMOOTH_RADIUS * 2 + 1);
      }
      cachedBassPulse    = bassPulseEnv.update(bassHits, dt);
      cachedHighPresence = highPresenceEnv.update(highPresence, dt);

      // Pulse-amplitude gain — doubled vs. previous tuning. Bars now
      // dwarf the (lightly pulsing) ring on every transient. Intensity
      // already drives shader-side maxBarH (0.5 + intensity·1.0), so
      // here we just need a per-frame multiplier that keeps the buffer
      // hot during loud passages and lets it drop during quiet ones.
      //   intensityGain  : [0.6, 2.4] — quiet passages stay restrained
      //                    while loud sections push pulses well past 1.0
      //   bassSpike      : [1.0, ~2.6] — every kick spikes every bar
      const intensityGain = 0.6 + intensitySmoothed * 1.8;
      const bassSpike     = 1.0 + cachedBassPulse * 1.6;
      const gain          = intensityGain * bassSpike;

      for (let bar = 0; bar < N_BARS; bar++) {
        let sum = 0;
        for (let k = -SMOOTH_RADIUS; k <= SMOOTH_RADIUS; k++) {
          sum += smoothBuf[(bar + k + N_BARS) % N_BARS];
        }
        pulseRender[bar] = (sum / (SMOOTH_RADIUS * 2 + 1)) * posLfo[bar] * gain;
      }
    },

    render(ctx: StyleContext): void {
      const { canvas, time, fadeInOut, intensity, colorEngine, quadVAO } = ctx;

      gl.clearColor(0.012, 0.01, 0.02, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);

      const palette    = colorEngine.getPalette();
      const ringColors = colorEngine.getRingColors();
      const accent     = hslToRgb(palette.accent);

      gl.useProgram(prog);
      gl.uniform2f (u.resolution,   canvas.width, canvas.height);
      gl.uniform1f (u.time,         time);
      gl.uniform1fv(u.pulse,        pulseRender);
      gl.uniform1f (u.intensity,    intensity);
      gl.uniform1f (u.bassPulse,    cachedBassPulse);
      gl.uniform1f (u.highPresence, cachedHighPresence);
      gl.uniform1f (u.fadeInOut,    fadeInOut);
      gl.uniform1i (u.variant,      variantId === 'sharp' ? 1 : 0);
      gl.uniform3fv(u.colorInner,   ringColors[0]);
      gl.uniform3fv(u.colorMid,     ringColors[1]);
      gl.uniform3fv(u.colorOuter,   ringColors[2]);
      gl.uniform3fv(u.colorAccent,  accent);

      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },

    dispose(): void {
      gl.deleteProgram(prog);
    },
  };
}

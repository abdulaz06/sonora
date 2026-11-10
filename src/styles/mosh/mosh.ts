/**
 * Mosh — feedback / datamosh (refs 01, 11). The underground one.
 *
 * A feedback buffer where each frame samples the previous one zoomed toward
 * a drifting vanishing point (recursive nested-frame tunnel), displaced by
 * its own luminance, smeared pixel-sort style, with RGB glitch blocks and
 * scanline tears.
 *   intensity  → recursion zoom speed and displacement
 *   beat       → a new nested frame (fresh seed texture enters at the edges)
 *   bass hits  → smear bursts
 *   high hits  → RGB glitch blocks and scanline tears
 *   drop       → freeze for a moment, then release in a full mosh
 *
 * Variants: Concrete (procedural concrete/asphalt with cracks, grain and
 * worn paint; no photos) and Signal (Sonora geometry, spectrum and noise).
 * Strobe-like effects go through the flash guard.
 */

import { clamp01, createRng } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { bindTarget, drawQuad, makeProgram, PingPong, setUniforms, withIncludes } from '../shared/gl';

import noiseSrc from '../shared/noise.glsl?raw';
import moshFrag from './shaders/mosh.frag?raw';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';

// ── Tuning ──────────────────────────────────────────────────────
/** Feedback buffer scale relative to the scene target, per quality. */
const BUFFER_SCALE: Record<QualityParams['level'], number> = { low: 0.6, medium: 0.85, high: 1 };
/** Tunnel depth speed (levels per second) at intensity 0 and 1. */
const ZOOM_MIN = 0.03;
const ZOOM_MAX = 0.35;
/** Size ratio between nested frames. */
const LEVEL_SCALE = 1.55;
/** A beat pushes the tunnel back one level over this long (s). */
const BEAT_EASE = 0.18;
/** Minimum time between injected frames (s). */
const INJECT_GAP = 0.22;
/** Drop: freeze length and release decay (s). */
const FREEZE_S = 0.45;
const RELEASE_TAU = 1.6;
/** Glitch block lifetime range (s). */
const BLOCK_LIFE = [0.06, 0.2];
const MAX_BLOCKS = 8;

interface Block { x: number; y: number; w: number; h: number; dx: number; dy: number; split: number; k: number; age: number; life: number }

export function createMoshStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0x3051);
  let quality = deps.quality;
  let variant = 'concrete';
  const prog = makeProgram(gl, fullscreenVert, withIncludes(moshFrag, { noise: noiseSrc }));
  const copy = makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform sampler2D u_src; uniform vec2 u_res; out vec4 frag;
void main() { frag = texture(u_src, gl_FragCoord.xy / u_res); }`);
  let fb: PingPong | null = null;
  let fbW = 0, fbH = 0;

  let time = 0;
  let fill = true;
  let lastInject = -1;
  let smearEnv = 0;
  let tearEnv = 0;
  let freezeUntil = -1;
  let released = true;
  let releaseEnv = 0;
  let smearAngle = rng() * Math.PI * 2;
  const blocks: Block[] = [];
  let injectNow = false;
  let depth = 0;
  let pushLeft = 0;

  function ensure(w: number, h: number): void {
    const s = BUFFER_SCALE[quality.level];
    const bw = Math.max(64, Math.round(w * s)), bh = Math.max(64, Math.round(h * s));
    if (fb && bw === fbW && bh === fbH) return;
    fb?.dispose();
    fb = new PingPong(gl, bw, bh, { internal: gl.RGBA16F, filter: gl.LINEAR });
    fbW = bw; fbH = bh;
    fill = true;
  }

  function spawnBlocks(n: number, big: boolean): void {
    for (let i = 0; i < n; i++) {
      if (blocks.length >= MAX_BLOCKS) blocks.shift();
      const w = big ? 0.2 + rng() * 0.5 : 0.04 + rng() * 0.22;
      const h = big ? 0.03 + rng() * 0.12 : 0.01 + rng() * 0.06;
      blocks.push({
        x: rng() * (1 - w), y: rng() * (1 - h), w, h,
        dx: (rng() - 0.5) * 0.08, dy: (rng() - 0.5) * 0.01, split: 0.002 + rng() * 0.012, k: rng(),
        age: 0, life: BLOCK_LIFE[0] + rng() * (BLOCK_LIFE[1] - BLOCK_LIFE[0]),
      });
    }
  }

  return {
    id: 'mosh',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (e.type === 'drop') {
        freezeUntil = time + FREEZE_S;
        released = false;
      } else if (e.type === 'bigHit') {
        smearEnv = 1;
        if (ctx.flash.request()) spawnBlocks(3, true);
      } else if (e.type === 'trackChange') {
        fill = true;
      }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      smearEnv = Math.max(smearEnv * Math.exp(-dt / 0.18), ctx.bassHits > 0.6 ? ctx.bassHits * (0.5 + 0.5 * ctx.fadeInOut) : 0);
      tearEnv = Math.max(tearEnv * Math.exp(-dt / 0.12), ctx.highHits > 0.5 ? ctx.highHits : 0);
      if (!released && time >= freezeUntil) {
        released = true;
        releaseEnv = 1;
        if (ctx.flash.request()) spawnBlocks(5, true);
      }
      releaseEnv *= Math.exp(-dt / RELEASE_TAU);
      if (releaseEnv < 0.01) releaseEnv = 0;
      smearAngle += dt * (0.1 + 0.4 * ctx.intensitySmoothed) * (simplex2(time * 0.2, 4) > 0 ? 1 : -1);

      // New nested frame on the beat (or on bass hits when the beat is unsure).
      const beat = (ctx.beatOnset && ctx.beatConfidence > 0.25) || (ctx.beatConfidence <= 0.25 && ctx.bassHits > 0.7);
      injectNow = false;
      if (beat && time - lastInject > INJECT_GAP && ctx.fadeInOut > 0.05) {
        injectNow = true;
        lastInject = time;
        pushLeft += 1;
      }
      // Glitch blocks on high hits.
      if (ctx.highHits > 0.55 && rng() < 0.5) spawnBlocks(1 + Math.floor(ctx.highHits * 3), false);
      for (const b of blocks) b.age += dt;
      for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].age > blocks[i].life) blocks.splice(i, 1);
    },

    render(ctx: StyleContext): void {
      ensure(ctx.width, ctx.height);
      const f = fb!;
      const cam = ctx.camera;
      const pal = ctx.palette;
      const aspect = ctx.width / ctx.height;
      const frozen = time < freezeUntil;
      // Continuous drift plus an eased one-level push per beat.
      const push = Math.min(pushLeft, ctx.dt / BEAT_EASE);
      pushLeft -= push;
      if (!frozen) depth += (ZOOM_MIN + (ZOOM_MAX - ZOOM_MIN) * ctx.intensitySmoothed + 1.5 * releaseEnv) * ctx.dt * (0.3 + 0.7 * ctx.fadeInOut) + push;
      const vp: [number, number] = [0.5 + simplex2(time * 0.05, 1) * 0.14, 0.5 + simplex2(time * 0.045, 2) * 0.12];
      const blockData: number[] = [], fxData: number[] = [];
      for (let i = 0; i < MAX_BLOCKS; i++) {
        const b = blocks[i];
        blockData.push(b ? b.x : 0, b ? b.y : 0, b ? b.w : 0, b ? b.h : 0);
        fxData.push(b ? b.dx : 0, b ? b.dy : 0, b ? b.split : 0, b ? b.k : 0);
      }
      const fft: number[] = [];
      const jf = ctx.frame.juiced_fft;
      for (let i = 0; i < 32; i++) fft.push(jf.length ? jf[Math.floor((i * jf.length) / 32)] : 0);

      gl.disable(gl.BLEND);
      bindTarget(gl, f.write);
      gl.useProgram(prog.prog);
      setUniforms(gl, prog, {
        u_prev: f.read.tex[0], u_res: [f.write.w, f.write.h], u_time: time, u_aspect: aspect,
        u_vp: vp, u_zoom: depth, u_level_scale: LEVEL_SCALE, u_rot: cam.rotation * 0.4 + simplex2(time * 0.07, 3) * 0.12,
        u_disp: (0.0015 + 0.005 * ctx.intensitySmoothed + 0.03 * releaseEnv) * (0.4 + 0.6 * ctx.fadeInOut),
        u_smear_dir: [Math.cos(smearAngle), Math.sin(smearAngle)], u_smear: clamp01(smearEnv * 0.6 + releaseEnv * 0.8),
        u_inject: injectNow || fill, u_fill: fill, u_frame_w: 0.004, u_freeze: frozen,
        u_blocks: blockData, u_block_fx: fxData, u_block_count: blocks.length, u_tear: clamp01(tearEnv + releaseEnv * 0.6),
        u_decay: 0.998,
        u_variant: variant === 'concrete' ? 0 : 1, u_seed_off: [cam.center[0] * 0.3, cam.center[1] * 0.3],
        u_seed_scale: 2.2, u_c0: pal.primary, u_c1: pal.secondary, u_c2: pal.accent, u_c3: pal.highlight,
        u_fft: fft, u_pulse: ctx.bassHits,
      }, ['u_block_count', 'u_variant']);
      drawQuad(gl, quadVAO);
      f.swap();
      fill = false;

      ctx.bindScene();
      gl.useProgram(copy.prog);
      setUniforms(gl, copy, { u_src: f.read.tex[0], u_res: [ctx.width, ctx.height] });
      drawQuad(gl, quadVAO);
      const post = ctx.post;
      post.tonemap = 'none';
      post.bloom = variant === 'signal' ? 0.35 : 0.1;
      post.bloomThreshold = 0.9;
      post.grain = 0.055;
      post.vignette = 0.35;
    },

    setVariant(id: string): void {
      if ((id === 'concrete' || id === 'signal') && id !== variant) { variant = id; fill = true; }
    },
    getVariant: () => variant,
    setQuality(q: QualityParams): void { quality = q; },
    dispose(): void {
      fb?.dispose();
      gl.deleteProgram(prog.prog);
      gl.deleteProgram(copy.prog);
    },
  };
}

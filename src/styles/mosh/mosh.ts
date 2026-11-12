/**
 * Mosh — a twisting glitch tunnel (refs 01, 11). The underground one.
 *
 * An analytic nested-frame (Droste) tunnel of Signal patterns — concentric
 * lines, halftone, moiré and a live radial spectrum — coloured through a
 * palette gradient map, with a feedback datamosh layer on top.
 *   beat       → the tunnel pushes one level (in or out) on the hit
 *   direction  → reverses every bar in drops, flows in through builds,
 *                drifts out in breakdowns: never a constant zoom
 *   intensity  → twist between nested frames and spin speed
 *   phrase     → frame shape morphs (rectangle / circle / diamond)
 *   bass hits  → smear bursts and rim light
 *   high hits  → RGB glitch blocks and scanline tears
 *   drop       → freeze for a moment, then release with the twist reversed
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
/** Drift speed (levels / s) at intensity 0 and 1, before section direction. */
const DRIFT_MIN = 0.04;
const DRIFT_MAX = 0.3;
/** Size ratio between nested frames. */
const LEVEL_SCALE = 1.6;
/** A beat pushes the tunnel this many levels over BEAT_EASE seconds. */
const BEAT_PUSH = 0.6;
const BEAT_EASE = 0.16;
/** Direction per section (+1 in, −1 out); drops flip every bar. */
const SECTION_DIR: Record<string, number> = { silence: 1, intro: 1, steady: 1, build: 1, drop: 1, breakdown: -1 };
const FLIP_BEATS = 4;
/** Twist between nested frames (rad) at intensity 0 / 1. */
const TWIST_MIN = 0.06;
const TWIST_MAX = 0.42;
/** Frame shapes cycle every this many beats (and on drops). */
const SHAPE_BEATS = 32;
const SHAPES: [number, number][] = [[0, 0], [1, 0], [0, 1], [0.5, 0]];
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
  const prog = makeProgram(gl, fullscreenVert, withIncludes(moshFrag, { noise: noiseSrc }));
  const copy = makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform sampler2D u_src; uniform vec2 u_res; out vec4 frag;
void main() { frag = texture(u_src, gl_FragCoord.xy / u_res); }`);
  let fb: PingPong | null = null;
  let fbW = 0, fbH = 0;

  let time = 0;
  let smearEnv = 0;
  let tearEnv = 0;
  let rimEnv = 0;
  let freezeUntil = -1;
  let released = true;
  let releaseEnv = 0;
  let smearAngle = rng() * Math.PI * 2;
  const blocks: Block[] = [];
  let depth = 0;
  let pushLeft = 0;
  let dir = 1, dirSmooth = 1;
  let beatCount = 0;
  let twist = TWIST_MIN, twistSign = 1;
  let spin = 0, spinSign = 1;
  let shapeIdx = 0;
  const shape: [number, number] = [0, 0];
  let lastBeat = -1;

  function ensure(w: number, h: number): void {
    const s = BUFFER_SCALE[quality.level];
    const bw = Math.max(64, Math.round(w * s)), bh = Math.max(64, Math.round(h * s));
    if (fb && bw === fbW && bh === fbH) return;
    fb?.dispose();
    fb = new PingPong(gl, bw, bh, { internal: gl.RGBA16F, filter: gl.LINEAR });
    fbW = bw; fbH = bh;
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
        twistSign = -twistSign;
        spinSign = -spinSign;
        shapeIdx = (shapeIdx + 1 + Math.floor(rng() * (SHAPES.length - 1))) % SHAPES.length;
      } else if (e.type === 'bigHit') {
        smearEnv = 1;
        if (ctx.flash.request()) spawnBlocks(3, true);
      }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const fade = ctx.fadeInOut;
      const section = ctx.eventState.section;
      smearEnv = Math.max(smearEnv * Math.exp(-dt / 0.18), ctx.bassHits > 0.6 ? ctx.bassHits * (0.5 + 0.5 * fade) : 0);
      tearEnv = Math.max(tearEnv * Math.exp(-dt / 0.12), ctx.highHits > 0.5 ? ctx.highHits : 0);
      rimEnv = Math.max(rimEnv * Math.exp(-dt / 0.15), ctx.bassHits * 0.8);
      if (!released && time >= freezeUntil) {
        released = true;
        releaseEnv = 1;
        if (ctx.flash.request()) spawnBlocks(5, true);
      }
      releaseEnv *= Math.exp(-dt / RELEASE_TAU);
      if (releaseEnv < 0.01) releaseEnv = 0;
      smearAngle += dt * (0.1 + 0.4 * ctx.intensitySmoothed) * (simplex2(time * 0.2, 4) > 0 ? 1 : -1);

      // Beats: push one step in the current direction; drops flip every bar;
      // the frame shape changes every SHAPE_BEATS beats.
      const beat = (ctx.beatOnset && ctx.beatConfidence > 0.25) || (ctx.beatConfidence <= 0.25 && ctx.bassHits > 0.7);
      if (beat && time - lastBeat > 0.2 && fade > 0.05) {
        lastBeat = time;
        beatCount++;
        if (section === 'drop' && beatCount % FLIP_BEATS === 0) dir = -dir;
        else if (section !== 'drop') dir = SECTION_DIR[section] ?? 1;
        pushLeft += BEAT_PUSH * dir * (0.6 + 0.8 * ctx.responsiveness);
        if (beatCount % SHAPE_BEATS === 0) shapeIdx = (shapeIdx + 1) % SHAPES.length;
      }
      if (section !== 'drop' && !beat) dir = SECTION_DIR[section] ?? dir;
      dirSmooth += (dir - dirSmooth) * (1 - Math.exp(-dt / 0.25));
      const tw = (TWIST_MIN + (TWIST_MAX - TWIST_MIN) * clamp01(ctx.intensityGlow * 1.1 + 0.3 * ctx.eventState.buildProgress)) * twistSign;
      twist += (tw - twist) * (1 - Math.exp(-dt / 0.8));
      spin += dt * (0.04 + 0.22 * ctx.intensitySmoothed + 0.8 * releaseEnv) * spinSign;
      const target = SHAPES[shapeIdx];
      shape[0] += (target[0] - shape[0]) * (1 - Math.exp(-dt / 0.9));
      shape[1] += (target[1] - shape[1]) * (1 - Math.exp(-dt / 0.9));

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
      const push = Math.sign(pushLeft) * Math.min(Math.abs(pushLeft), (BEAT_PUSH * ctx.dt) / BEAT_EASE * 1.6);
      pushLeft -= push;
      if (!frozen) {
        const drift = DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * ctx.intensityGlow + 0.8 * ctx.eventState.buildProgress;
        depth += (drift * dirSmooth + 1.5 * releaseEnv) * ctx.dt * (0.3 + 0.7 * ctx.fadeInOut) + push;
      }
      const vp: [number, number] = [0.5 + simplex2(time * 0.05, 1) * 0.16, 0.5 + simplex2(time * 0.045, 2) * 0.13];
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
        u_vp: vp, u_zoom: depth, u_level_scale: LEVEL_SCALE, u_rot: spin + cam.rotation * 0.4,
        u_twist: twist, u_shape: shape,
        u_disp: (0.0015 + 0.005 * ctx.intensitySmoothed + 0.03 * releaseEnv) * (0.4 + 0.6 * ctx.fadeInOut),
        u_smear_dir: [Math.cos(smearAngle), Math.sin(smearAngle)], u_smear: clamp01(smearEnv * 0.6 + releaseEnv * 0.8),
        u_rim: rimEnv * (0.4 + 0.6 * ctx.fadeInOut), u_freeze: frozen,
        u_blocks: blockData, u_block_fx: fxData, u_block_count: blocks.length, u_tear: clamp01(tearEnv + releaseEnv * 0.6),
        u_bg: pal.bg, u_c0: pal.primary, u_c2: pal.accent, u_c3: pal.highlight,
        u_fft: fft, u_pulse: ctx.bassHits,
      });
      drawQuad(gl, quadVAO);
      f.swap();

      ctx.bindScene();
      gl.useProgram(copy.prog);
      setUniforms(gl, copy, { u_src: f.read.tex[0], u_res: [ctx.width, ctx.height] });
      drawQuad(gl, quadVAO);
      const post = ctx.post;
      post.tonemap = 'none';
      post.bloom = 0.25;
      post.bloomThreshold = 0.85;
      post.grain = 0.05;
      post.vignette = 0.35;
    },

    setVariant(): void { /* single look: Signal */ },
    getVariant: () => 'signal',
    setQuality(q: QualityParams): void { quality = q; },
    dispose(): void {
      fb?.dispose();
      gl.deleteProgram(prog.prog);
      gl.deleteProgram(copy.prog);
    },
  };
}

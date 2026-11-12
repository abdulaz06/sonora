/**
 * Strands — the GPU particle engine behind three styles (refs 08, 10, 03).
 *
 * Particle state lives in two RGBA32F textures (MRT ping-pong) updated by a
 * fragment shader; no per-particle CPU work. Particles are drawn into an
 * accumulation buffer that decays each frame (additive density → silky
 * traces), then a display pass tone-maps it per style.
 *
 *   silk    ribbons of threads + dust starfield; bass hits send shockwaves;
 *           drop / some big hits cut to the inverted (ink-on-bone) look
 *   wisp    a few bright agents darting through black, shedding smoke that
 *           forms loops; bass hits blow smoke rings
 *   warp    sparks streaking toward the camera; build accelerates, drop jumps
 *
 * Each is its own style in the registry (`createSilkStyle`, …); they share
 * this engine and its shaders (`#define VARIANT 0 | 2 | 4`).
 */

import { clamp01, createRng } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import {
  bindTarget, createTarget, deleteTarget, drawQuad, makeProgram, PingPong, setUniforms,
  withIncludes, type Program, type Target,
} from '../shared/gl';

import noiseSrc from '../shared/noise.glsl?raw';
import updateFrag from './shaders/update.frag?raw';
import renderVert from './shaders/render.vert?raw';
import renderFrag from './shaders/render.frag?raw';
import displayFrag from './shaders/display.frag?raw';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';

// ── Tuning ──────────────────────────────────────────────────────
export type StrandsKind = 'silk' | 'wisp' | 'warp';
/** Shader VARIANT number per kind (gaps are retired looks). */
const SHADER_VARIANT: Record<StrandsKind, number> = { silk: 0, wisp: 2, warp: 4 };

/** Particle texture side per quality level (side² particles). */
const SIDE: Record<QualityParams['level'], number> = { low: 448, medium: 1024, high: 1448 };

interface KindCfg {
  /** Fraction of the particle budget this style uses. */
  count: number;
  /** Accumulation decay per frame at 60 fps. */
  decay: number;
  point: number;
  /** Density gain (render) and tone-map gain (display). */
  gain: number;
  display: number;
}

const CFG: Record<StrandsKind, KindCfg> = {
  silk: { count: 1, decay: 0.84, point: 1, gain: 0.03, display: 1.1 },
  wisp: { count: 0.06, decay: 0.975, point: 1, gain: 0.014, display: 1.5 },
  warp: { count: 0.06, decay: 0.5, point: 1, gain: 0.75, display: 1 },
};

/** Silk: shockwave speed (world units/s) and lifetime (s). */
const SHOCK_SPEED = 0.9;
const SHOCK_LIFE = 1.1;
/** Silk: inversion cut length in beats (drop) and chance on a big hit. */
const CUT_BEATS_DROP = 2;
const CUT_BEATS_HIT = 1;
const CUT_HIT_CHANCE = 0.3;

interface Shock { x: number; y: number; r: number; s: number; age: number }
interface Agent { x: number; y: number; heading: number; speed: number; turn: number; glow: number }

export function createSilkStyle(deps: StyleDeps): VisualStyle { return createStrandsStyle(deps, 'silk'); }
export function createWispStyle(deps: StyleDeps): VisualStyle { return createStrandsStyle(deps, 'wisp'); }
export function createWarpStyle(deps: StyleDeps): VisualStyle { return createStrandsStyle(deps, 'warp'); }

function createStrandsStyle(deps: StyleDeps, kind: StrandsKind): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0x57a2);
  let quality = deps.quality;
  let side = SIDE[quality.level];
  const emptyVAO = gl.createVertexArray()!;
  const cfg = CFG[kind];

  const stateOpts = { internal: gl.RGBA32F, filter: gl.NEAREST, attachments: 2 };
  let state = new PingPong(gl, side, side, stateOpts);
  let accum: Target | null = null;
  let needsInit = true;

  const fill = makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform vec4 u_color; out vec4 frag; void main() { frag = u_color; }`);
  const def = `#define VARIANT ${SHADER_VARIANT[kind]}`;
  const inc = (s: string): string => withIncludes(s, { noise: noiseSrc });
  const p: { update: Program; render: Program; display: Program } = {
    update: makeProgram(gl, fullscreenVert, inc(updateFrag), def),
    render: makeProgram(gl, inc(renderVert), inc(renderFrag), def),
    display: makeProgram(gl, fullscreenVert, inc(displayFrag), def),
  };

  // ── State ─────────────────────────────────────────────────────
  let time = 0;
  let fieldT = rng() * 100;
  let speedEnv = 0.3;
  const shocks: Shock[] = [];
  let bassCooldown = 0;
  let cutUntil = -1;
  let sparkle = 0;
  // Wisp
  const agents: Agent[] = [0, 1, 2].map((i) => ({
    x: (rng() - 0.5) * 0.6, y: (rng() - 0.5) * 0.4, heading: rng() * 6.28, speed: 0.2, turn: (i % 2 ? 1 : -1) * 1.2, glow: 1,
  }));
  let ring = { x: 0, y: 0, age: 9, s: 0 };
  // Warp
  let warpJump = 0;
  let warpSpeed = 6;

  function ensureAccum(w: number, h: number): void {
    if (accum && accum.w === w && accum.h === h) return;
    deleteTarget(gl, accum);
    accum = createTarget(gl, w, h, { internal: gl.RGBA16F });
  }

  function resizeState(): void {
    const s = SIDE[quality.level];
    if (s === side) return;
    state.dispose();
    side = s;
    state = new PingPong(gl, side, side, stateOpts);
    needsInit = true;
  }

  const beatSeconds = (ctx: StyleContext): number => 60 / Math.max(60, Math.min(200, ctx.frame.beat.bpm || 120));

  function cut(ctx: StyleContext, beats: number): void {
    if (ctx.flash.request()) cutUntil = time + beats * beatSeconds(ctx);
  }

  return {
    id: kind,

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (kind === 'silk') {
        if (e.type === 'drop') cut(ctx, CUT_BEATS_DROP);
        else if (e.type === 'bigHit' && rng() < CUT_HIT_CHANCE) cut(ctx, CUT_BEATS_HIT);
      } else if (kind === 'warp' && e.type === 'drop') {
        warpJump = 1;
        if (ctx.flash.request()) ctx.post.flash = 0.1;
      } else if (kind === 'wisp' && e.type === 'drop') {
        agents.forEach((a) => { a.speed += 1.2; a.glow = 2; });
      }
      if (e.type === 'trackChange') fieldT += 50;
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const fade = ctx.fadeInOut;
      const build = ctx.eventState.buildProgress;
      const target = 0.25 + 0.9 * ctx.intensitySmoothed + 0.4 * build + 0.6 * ctx.eventState.dropEnvelope;
      speedEnv += (1 - Math.exp(-dt / 0.6)) * (target * (0.3 + 0.7 * fade) - speedEnv);
      fieldT += dt * (0.03 + 0.09 * speedEnv) + (ctx.beatOnset ? 0.02 * ctx.beatConfidence : 0);
      sparkle = Math.max(sparkle * Math.exp(-dt / 0.15), ctx.highHits);
      bassCooldown -= dt;

      // Silk shockwaves on bass hits.
      if (kind === 'silk' && ctx.bassHits > 0.55 && bassCooldown <= 0 && fade > 0.1) {
        const c = ctx.camera;
        const q = c.screenToWorld2D((rng() - 0.5) * 1.4, (rng() - 0.5) * 1.2);
        shocks.push({ x: q[0], y: q[1], r: 0.02, s: 0.6 * ctx.bassHits, age: 0 });
        if (shocks.length > 4) shocks.shift();
        bassCooldown = 0.18;
      }
      for (const s of shocks) { s.age += dt; s.r += SHOCK_SPEED * dt; s.s *= Math.exp(-dt / 0.5); }
      while (shocks.length && shocks[0].age > SHOCK_LIFE) shocks.shift();

      // Wisp agents.
      if (kind === 'wisp') {
        const c = ctx.camera;
        agents.forEach((a, i) => {
          a.turn += (simplex2(time * 0.4, i * 13) * 3 - a.turn) * dt * 0.8;
          if (ctx.midHits > 0.6 && rng() < 0.2) a.turn += (rng() - 0.5) * 8;
          const base = 0.12 + 0.45 * ctx.intensitySmoothed;
          a.speed += ((base + ctx.bassHits * 0.6) - a.speed) * (1 - Math.exp(-dt / 0.3));
          a.heading += a.turn * dt;
          // Stay near the view.
          const dx = c.center[0] - a.x, dy = c.center[1] - a.y;
          if (Math.hypot(dx, dy) > c.viewHeight * 0.45) {
            const want = Math.atan2(dy, dx);
            let diff = want - a.heading;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            a.heading += diff * dt * 2.5;
          }
          a.x += Math.cos(a.heading) * a.speed * dt;
          a.y += Math.sin(a.heading) * a.speed * dt;
          a.glow += (1 - a.glow) * dt * 2;
        });
        ring.age += dt;
        if (ctx.bassHits > 0.7 && ring.age > 0.6 && fade > 0.1) {
          const a = agents[Math.floor(rng() * agents.length)];
          ring = { x: a.x, y: a.y, age: 0, s: ctx.bassHits };
        }
      }

      // Warp speed: intensity and tempo, build accelerates, drop jumps.
      if (kind === 'warp') {
        const bpmFactor = Math.sqrt(Math.max(60, Math.min(200, ctx.frame.beat.bpm || 120)) / 120);
        warpJump *= Math.exp(-dt / 0.9);
        const warpTarget = (2.5 + 16 * ctx.intensitySmoothed) * bpmFactor * (1 + 1.5 * build) * (0.25 + 0.75 * fade) + 32 * warpJump;
        warpSpeed += (1 - Math.exp(-dt / 0.4)) * (warpTarget - warpSpeed);
      }
    },

    render(ctx: StyleContext): void {
      resizeState();
      ensureAccum(ctx.width, ctx.height);
      const cam = ctx.camera;
      const pal = ctx.palette;
      const view = cam.viewHeight;
      const aspect = ctx.width / ctx.height;
      const count = Math.floor(side * side * cfg.count);
      const rows = Math.ceil(count / side);
      const presence = Math.max(ctx.midPresence, ctx.bassPresence * 0.8);
      const active = kind === 'warp' ? 1
        : clamp01(0.12 + 0.88 * presence * (0.3 + 0.7 * ctx.fadeInOut) + 0.3 * ctx.intensityGlow);

      // Silk emitters: three segments wandering around the view.
      const emit: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t = time * (0.05 + i * 0.013) + i * 2.1;
        const a = cam.screenToWorld2D(Math.sin(t * 1.3) * 0.9, Math.cos(t * 0.9 + i) * 0.8);
        const b = cam.screenToWorld2D(Math.sin(t * 0.7 + 2 + i) * 0.9, Math.cos(t * 1.1 + 1) * 0.8);
        emit.push(a[0], a[1], b[0], b[1]);
      }
      emit.push(0, 0, 0, 0);
      const shockData: number[] = [];
      for (let i = 0; i < 4; i++) {
        const s = shocks[i];
        shockData.push(s ? s.x : 0, s ? s.y : 0, s ? s.r : 0, s ? s.s : 0);
      }
      const agentData: number[] = [];
      for (let i = 0; i < 4; i++) {
        const a = agents[i];
        agentData.push(a ? a.x : 0, a ? a.y : 0, a ? Math.cos(a.heading) * a.speed : 0, a ? Math.sin(a.heading) * a.speed : 0);
      }

      const common = {
        u_time: time, u_center: [cam.center[0], cam.center[1]], u_view: view, u_aspect: aspect,
        u_rot: cam.rotation, u_field_t: fieldT, u_active: active,
      };

      // ── 1. Update particles ──
      gl.disable(gl.BLEND);
      bindTarget(gl, state.write);
      gl.viewport(0, 0, side, rows);
      gl.useProgram(p.update.prog);
      setUniforms(gl, p.update, {
        ...common,
        u_stateA: state.read.tex[0], u_stateB: state.read.tex[1],
        u_dt: Math.min(ctx.dt, 1 / 30), u_init: needsInit ? 1 : 0, u_intensity: ctx.intensitySmoothed,
        u_fade: ctx.fadeInOut, u_speed: kind === 'warp' ? warpSpeed : 0.5 + speedEnv * 1.3,
        u_field_scale: 1.6, u_emit: emit, u_emit_count: 3, u_shock: shockData, u_shock_count: shocks.length,
        u_agents: agentData, u_agent_count: agents.length, u_ring: [ring.x, ring.y, ring.age, ring.s],
      });
      drawQuad(gl, quadVAO);
      state.swap();
      needsInit = false;

      // ── 2. Accumulate ──
      bindTarget(gl, accum!);
      gl.enable(gl.BLEND);
      gl.useProgram(fill.prog);
      const decay = Math.pow(cfg.decay, ctx.dt * 60);
      gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
      gl.blendColor(0, 0, 0, decay);
      setUniforms(gl, fill, { u_color: [0, 0, 0, 0] });
      drawQuad(gl, quadVAO);

      gl.useProgram(p.render.prog);
      gl.blendFunc(gl.ONE, gl.ONE);
      setUniforms(gl, p.render, {
        ...common,
        u_stateA: state.read.tex[0], u_stateB: state.read.tex[1], u_side: side,
        u_point: cfg.point * Math.max(1, ctx.height / 1080), u_gain: cfg.gain * (kind === 'silk' ? 0.6 + 0.8 * ctx.fadeInOut : 1),
        u_sparkle: sparkle, u_res: [ctx.width, ctx.height],
        u_vp: [simplex2(time * 0.07, 4) * 0.25, simplex2(time * 0.06, 5) * 0.18], u_roll: cam.roll * 3,
        u_streak: 0.016 + 0.012 * ctx.intensitySmoothed,
        u_c0: pal.primary, u_c1: pal.secondary, u_c2: mixRgb(pal.highlight, [1, 1, 1], 0.6), u_c3: pal.accent,
      });
      gl.bindVertexArray(emptyVAO);
      if (kind === 'warp') gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      else gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // ── 3. Display ──
      ctx.bindScene();
      const silkLight = ctx.light !== time < cutUntil; // the cut inverts whatever is current
      gl.useProgram(p.display.prog);
      const agentUv: number[] = [];
      const agentDir: number[] = [];
      for (let i = 0; i < 4; i++) {
        const a = agents[i];
        const uv = a ? worldToUv(cam, a.x, a.y, view, aspect) : [0, 0];
        agentUv.push(uv[0], uv[1], a ? (0.4 + 0.6 * ctx.fadeInOut) * a.glow * (0.8 + a.speed) : 0, 0.006 + 0.004 * (a?.glow ?? 1));
        agentDir.push(a ? Math.cos(a.heading - cam.rotation) : 1, a ? Math.sin(a.heading - cam.rotation) : 0, a ? a.speed : 0, 0);
      }
      setUniforms(gl, p.display, {
        u_accum: accum!.tex[0], u_res: [ctx.width, ctx.height], u_time: time,
        u_bg: pal.bg, u_paper: pal.paper, u_c0: pal.primary, u_c1: pal.secondary, u_c2: pal.accent, u_c3: pal.highlight,
        u_light: kind === 'silk' ? silkLight : false, u_gain: cfg.display, u_fade: ctx.fadeInOut,
        u_pulse: ctx.bassHits,
        u_agents: agentUv, u_agent_dir: agentDir, u_agent_count: kind === 'wisp' ? agents.length : 0,
      });
      drawQuad(gl, quadVAO);

      const post = ctx.post;
      if (kind === 'silk' && silkLight) { post.tonemap = 'none'; post.bloom = 0; post.vignette = 0.15; }
      else if (kind === 'wisp') { post.bloom = 0.9; post.bloomThreshold = 0.8; post.vignette = 0.4; }
      else if (kind === 'warp') { post.bloom = 0.7; post.bloomThreshold = 0.9; }
      else { post.bloom = 0.6; }
    },

    setQuality(q: QualityParams): void {
      quality = q;
    },

    dispose(): void {
      state.dispose();
      deleteTarget(gl, accum);
      gl.deleteProgram(p.update.prog);
      gl.deleteProgram(p.render.prog);
      gl.deleteProgram(p.display.prog);
      gl.deleteProgram(fill.prog);
      gl.deleteVertexArray(emptyVAO);
    },
  };
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function worldToUv(cam: StyleContext['camera'], x: number, y: number, view: number, aspect: number): [number, number] {
  const dx = x - cam.center[0], dy = y - cam.center[1];
  const c = Math.cos(-cam.rotation), s = Math.sin(-cam.rotation);
  const rx = dx * c - dy * s, ry = dx * s + dy * c;
  return [0.5 + rx / (view * aspect), 0.5 + ry / view];
}

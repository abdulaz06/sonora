/**
 * Strands — GPU particle engine (refs 08, 05, 10, 03).
 *
 * Particle state lives in two RGBA32F textures (MRT ping-pong) updated by a
 * fragment shader; no per-particle CPU work. Particles are drawn into an
 * accumulation buffer that decays each frame (additive density → silky
 * traces), then a display pass tone-maps it per variant.
 *
 * Variants
 *   silk    gold ribbons + dust starfield; bass hits send shockwaves; drop /
 *           some big hits cut to the inverted (ink-on-bone) look for a beat
 *   lumen   hair-thin iridescent filaments bursting from a light with
 *           anamorphic streaks; quiet = tight cross, loud = X spread
 *   wisp    a few bright agents darting through black, shedding smoke that
 *           forms loops; bass hits blow smoke rings
 *   starry  Van Gogh-inspired brushstrokes along swirling eddies with glowing
 *           star nodes and halo rings (painterly blues/yellows, recolourable)
 *   warp    sparks streaking toward the camera; build accelerates, drop jumps
 *
 * Mapping (DOCS/16 §5): presence → emission / active count, intensity → flow
 * speed, beat → field pulse / star pulse / roll, bass hits → shockwaves /
 * rings / agent surges, high hits → dust sparkle / filament spread, drop →
 * inversion cut (Silk), X-spread (Lumen), jump (Warp).
 */

import { clamp01, createRng } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import {
  bindTarget, createTarget, deleteTarget, drawQuad, makeProgram, PingPong, rgbHue, setUniforms,
  withIncludes, type Program, type Target,
} from '../shared/gl';

import noiseSrc from '../shared/noise.glsl?raw';
import updateFrag from './shaders/update.frag?raw';
import renderVert from './shaders/render.vert?raw';
import renderFrag from './shaders/render.frag?raw';
import displayFrag from './shaders/display.frag?raw';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';

// ── Tuning ──────────────────────────────────────────────────────
const VARIANTS = ['silk', 'lumen', 'wisp', 'starry', 'warp'] as const;
type Variant = (typeof VARIANTS)[number];

/** Particle texture side per quality level (side² particles). */
const SIDE: Record<QualityParams['level'], number> = { low: 448, medium: 1024, high: 1448 };

interface VariantCfg {
  /** Fraction of the particle budget this variant uses. */
  count: number;
  /** Accumulation decay per frame at 60 fps. */
  decay: number;
  point: number;
  /** Density gain (render) and tone-map gain (display). */
  gain: number;
  display: number;
  /** Additive (density) or alpha (paint) accumulation. */
  paint: boolean;
}

const CFG: Record<Variant, VariantCfg> = {
  silk: { count: 1, decay: 0.84, point: 1, gain: 0.03, display: 1.1, paint: false },
  lumen: { count: 0.12, decay: 0.8, point: 1, gain: 0.005, display: 1.0, paint: false },
  wisp: { count: 0.06, decay: 0.975, point: 1, gain: 0.014, display: 1.5, paint: false },
  starry: { count: 0.13, decay: 0.9, point: 1, gain: 1, display: 1, paint: true },
  warp: { count: 0.06, decay: 0.5, point: 1, gain: 0.75, display: 1, paint: false },
};

/** Silk: shockwave speed (world units/s) and lifetime (s). */
const SHOCK_SPEED = 0.9;
const SHOCK_LIFE = 1.1;
/** Silk: inversion cut length in beats (drop) and chance on a big hit. */
const CUT_BEATS_DROP = 2;
const CUT_BEATS_HIT = 1;
const CUT_HIT_CHANCE = 0.3;
/** Starry: vortex lattice cell size (world units). */
const VORTEX_CELL = 0.55;
/** Starry painterly base colours (cobalt night), rotated to the palette hue. */
const STARRY_BASE: [number, number, number][] = [
  [0.05, 0.1, 0.3], [0.16, 0.36, 0.78], [0.95, 0.78, 0.28], [1.0, 0.96, 0.75],
];
const STARRY_REF_HUE = 220;

interface Shock { x: number; y: number; r: number; s: number; age: number }
interface Agent { x: number; y: number; heading: number; speed: number; turn: number; glow: number }

export function createStrandsStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0x57a2);
  let quality = deps.quality;
  let variant: Variant = 'silk';
  let side = SIDE[quality.level];
  const emptyVAO = gl.createVertexArray()!;

  const stateOpts = { internal: gl.RGBA32F, filter: gl.NEAREST, attachments: 2 };
  let state = new PingPong(gl, side, side, stateOpts);
  let accum: Target | null = null;
  let needsInit = true;

  const fill = makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform vec4 u_color; out vec4 frag; void main() { frag = u_color; }`);
  const progs = new Map<Variant, { update: Program; render: Program; display: Program }>();
  const programsFor = (v: Variant): { update: Program; render: Program; display: Program } => {
    let p = progs.get(v);
    if (!p) {
      const def = `#define VARIANT ${VARIANTS.indexOf(v)}`;
      const inc = (s: string): string => withIncludes(s, { noise: noiseSrc });
      p = {
        update: makeProgram(gl, fullscreenVert, inc(updateFrag), def),
        render: makeProgram(gl, inc(renderVert), inc(renderFrag), def),
        display: makeProgram(gl, fullscreenVert, inc(displayFrag), def),
      };
      progs.set(v, p);
    }
    return p;
  };
  programsFor(variant);

  // ── Variant state ─────────────────────────────────────────────
  let time = 0;
  let fieldT = rng() * 100;
  let speedEnv = 0.3;
  const shocks: Shock[] = [];
  let bassCooldown = 0;
  let cutUntil = -1;
  let sparkle = 0;
  // Lumen
  let spread = 0;
  let lumenAngle = 0;
  // Wisp
  const agents: Agent[] = [0, 1, 2].map((i) => ({
    x: (rng() - 0.5) * 0.6, y: (rng() - 0.5) * 0.4, heading: rng() * 6.28, speed: 0.2, turn: (i % 2 ? 1 : -1) * 1.2, glow: 1,
  }));
  let ring = { x: 0, y: 0, age: 9, s: 0 };
  // Warp
  let warpJump = 0;
  let warpSpeed = 6;
  let starPulse = 0;

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
    id: 'strands',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (variant === 'silk') {
        if (e.type === 'drop') cut(ctx, CUT_BEATS_DROP);
        else if (e.type === 'bigHit' && rng() < CUT_HIT_CHANCE) cut(ctx, CUT_BEATS_HIT);
      } else if (variant === 'lumen' && e.type === 'drop') {
        spread = 1;
      } else if (variant === 'warp' && e.type === 'drop') {
        warpJump = 1;
        if (ctx.flash.request()) ctx.post.flash = 0.1;
      } else if (variant === 'wisp' && e.type === 'drop') {
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
      starPulse = Math.max(starPulse * Math.exp(-dt / 0.25), ctx.beatOnset ? 1 : 0, ctx.bassHits * 0.8);
      bassCooldown -= dt;

      // Silk shockwaves on bass hits.
      if (variant === 'silk' && ctx.bassHits > 0.55 && bassCooldown <= 0 && fade > 0.1) {
        const c = ctx.camera;
        const p = c.screenToWorld2D((rng() - 0.5) * 1.4, (rng() - 0.5) * 1.2);
        shocks.push({ x: p[0], y: p[1], r: 0.02, s: 0.6 * ctx.bassHits, age: 0 });
        if (shocks.length > 4) shocks.shift();
        bassCooldown = 0.18;
      }
      for (const s of shocks) { s.age += dt; s.r += SHOCK_SPEED * dt; s.s *= Math.exp(-dt / 0.5); }
      while (shocks.length && shocks[0].age > SHOCK_LIFE) shocks.shift();

      // Lumen spread: highs and intensity open the X; quiet closes to a star.
      const targetSpread = clamp01(ctx.intensitySmoothed * 0.8 + ctx.highPresence * 0.3 + ctx.eventState.dropEnvelope);
      spread += (1 - Math.exp(-dt / 0.4)) * (targetSpread - spread);
      lumenAngle = simplex2(time * 0.05, 9) * 0.25;

      // Wisp agents.
      if (variant === 'wisp') {
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
      const bpmFactor = Math.sqrt(Math.max(60, Math.min(200, ctx.frame.beat.bpm || 120)) / 120);
      warpJump *= Math.exp(-dt / 0.9);
      const warpTarget = (2.5 + 16 * ctx.intensitySmoothed) * bpmFactor * (1 + 1.5 * build) * (0.25 + 0.75 * fade) + 32 * warpJump;
      warpSpeed += (1 - Math.exp(-dt / 0.4)) * (warpTarget - warpSpeed);
    },

    render(ctx: StyleContext): void {
      resizeState();
      ensureAccum(ctx.width, ctx.height);
      const p = programsFor(variant);
      const cfg = CFG[variant];
      const cam = ctx.camera;
      const pal = ctx.palette;
      const view = cam.viewHeight;
      const aspect = ctx.width / ctx.height;
      const count = Math.floor(side * side * cfg.count);
      const rows = Math.ceil(count / side);
      const presence = Math.max(ctx.midPresence, ctx.bassPresence * 0.8);
      const active = variant === 'warp' ? 1 : variant === 'starry' ? 0.3 + 0.7 * ctx.fadeInOut
        : clamp01(0.12 + 0.88 * presence * (0.3 + 0.7 * ctx.fadeInOut) + 0.3 * ctx.intensitySmoothed);

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
      // Lumen source wanders inside the view (never pinned to the centre).
      const src = cam.screenToWorld2D(simplex2(time * 0.03, 1) * 0.45, simplex2(time * 0.027, 2) * 0.35);
      // Cross when quiet; the diagonal X takes over as it gets loud.
      const bal = (() => {
        const diag = 0.75 * spread * spread;
        const h = (1 - diag) * (0.5 + 0.2 * (ctx.bassPresence - ctx.highPresence));
        return [h, 1 - diag - h];
      })();
      const agentData: number[] = [];
      for (let i = 0; i < 4; i++) {
        const a = agents[i];
        agentData.push(a ? a.x : 0, a ? a.y : 0, a ? Math.cos(a.heading) * a.speed : 0, a ? Math.sin(a.heading) * a.speed : 0);
      }
      // Starry vortices / stars from a world lattice around the camera.
      const vort: number[] = [];
      const stars: number[] = [];
      const starsWorld: number[] = [];
      if (variant === 'starry') {
        const cx = Math.floor(cam.center[0] / VORTEX_CELL), cy = Math.floor(cam.center[1] / VORTEX_CELL);
        const cells: { d: number; x: number; y: number; h: number; h2: number }[] = [];
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
          const gx = cx + i, gy = cy + j;
          const h = fract(Math.sin(gx * 127.1 + gy * 311.7) * 43758.5453);
          const h2 = fract(Math.sin(gx * 269.5 + gy * 183.3) * 24634.6345);
          const x = (gx + 0.2 + 0.6 * h) * VORTEX_CELL, y = (gy + 0.2 + 0.6 * h2) * VORTEX_CELL;
          cells.push({ d: Math.hypot(x - cam.center[0], y - cam.center[1]), x, y, h, h2 });
        }
        cells.sort((a, b) => a.d - b.d);
        for (const c of cells.slice(0, 8)) vort.push(c.x, c.y, (c.h > 0.5 ? 1 : -1) * (0.25 + 0.35 * c.h2), 0.18 + 0.2 * c.h);
        for (const c of cells) {
          if (stars.length >= 32 || c.h2 < 0.62) continue;
          starsWorld.push(c.x, c.y, (0.018 + 0.02 * c.h) * view * 2.6, 0);
          const sc = worldToUv(cam, c.x, c.y, view, aspect);
          stars.push(sc[0], sc[1], 0.018 + 0.02 * c.h, starPulse * (0.5 + 0.5 * c.h));
        }
      }
      const starCount = stars.length / 4;
      while (starsWorld.length < 32) starsWorld.push(0, 0, 0, 0);
      while (vort.length < 32) vort.push(0, 0, 0, 1);
      while (stars.length < 32) stars.push(0, 0, 1, 0);

      const common = {
        u_time: time, u_center: [cam.center[0], cam.center[1]], u_view: view, u_aspect: aspect,
        u_rot: cam.rotation, u_field_t: fieldT, u_vort: vort, u_vort_count: variant === 'starry' ? 8 : 0,
        u_active: active,
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
        u_fade: ctx.fadeInOut, u_speed: variant === 'warp' ? warpSpeed : 0.5 + speedEnv * (variant === 'lumen' ? 0.9 : 1.3),
        u_field_scale: 1.6, u_emit: emit, u_emit_count: 3, u_shock: shockData, u_shock_count: shocks.length,
        u_source: [src[0], src[1], spread, lumenAngle], u_balance: bal,
        u_agents: agentData, u_agent_count: agents.length, u_ring: [ring.x, ring.y, ring.age, ring.s],
      }, ['u_emit_count', 'u_shock_count', 'u_agent_count', 'u_vort_count']);
      drawQuad(gl, quadVAO);
      state.swap();
      needsInit = false;

      // ── 2. Accumulate ──
      bindTarget(gl, accum!);
      gl.enable(gl.BLEND);
      gl.useProgram(fill.prog);
      const decay = Math.pow(cfg.decay, ctx.dt * 60);
      if (cfg.paint) {
        // Fade the canvas toward the background paint.
        const base = hueRotateJs(STARRY_BASE[0], starryShift(ctx));
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        gl.blendColor(0, 0, 0, 1 - decay);
        setUniforms(gl, fill, { u_color: [base[0] * 0.6, base[1] * 0.6, base[2] * 0.6, 1] });
      } else {
        gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
        gl.blendColor(0, 0, 0, decay);
        setUniforms(gl, fill, { u_color: [0, 0, 0, 0] });
      }
      drawQuad(gl, quadVAO);

      gl.useProgram(p.render.prog);
      if (cfg.paint) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE);
      const shift = starryShift(ctx);
      const sb = STARRY_BASE;
      setUniforms(gl, p.render, {
        ...common,
        u_stateA: state.read.tex[0], u_stateB: state.read.tex[1], u_side: side,
        u_point: cfg.point * Math.max(1, ctx.height / 1080), u_gain: cfg.gain * (variant === 'silk' ? 0.6 + 0.8 * ctx.fadeInOut : 1),
        u_sparkle: sparkle, u_res: [ctx.width, ctx.height],
        u_stroke_len: 0.026 + 0.022 * speedEnv, u_stroke_w: 0.0078 + 0.0042 * speedEnv,
        u_stars_w: starsWorld, u_star_w_count: variant === 'starry' ? starsWorld.length / 4 : 0,
        u_vp: [simplex2(time * 0.07, 4) * 0.25, simplex2(time * 0.06, 5) * 0.18], u_roll: cam.roll * 3,
        u_streak: 0.016 + 0.012 * ctx.intensitySmoothed,
        u_fil_len: 0.14 + 0.16 * spread, u_fil_max: view * 0.25,
        u_c0: variant === 'starry' ? sb[0] : pal.primary,
        u_c1: variant === 'starry' ? sb[1] : pal.secondary,
        u_c2: variant === 'starry' ? sb[2] : mixRgb(pal.highlight, [1, 1, 1], 0.6),
        u_c3: variant === 'starry' ? sb[3] : pal.accent,
        u_hue_shift: shift, u_warm_shift: shift * 0.25,
      }, ['u_side', 'u_vort_count', 'u_star_w_count']);
      gl.bindVertexArray(emptyVAO);
      if (variant === 'starry' || variant === 'warp' || variant === 'lumen') gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      else gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // ── 3. Display ──
      ctx.bindScene();
      const silkLight = ctx.light !== time < cutUntil; // the cut inverts whatever is current
      gl.useProgram(p.display.prog);
      const srcUv = worldToUv(cam, src[0], src[1], view, aspect);
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
        u_bg: pal.bg, u_paper: pal.paper, u_c0: pal.primary, u_c1: pal.secondary, u_c2: variant === 'starry' ? sb[2] : pal.accent,
        u_c3: variant === 'starry' ? sb[3] : pal.highlight,
        u_light: variant === 'silk' ? silkLight : false, u_gain: cfg.display, u_fade: ctx.fadeInOut,
        u_pulse: Math.max(ctx.bassHits, starPulse * 0.5), u_src: srcUv, u_streak: 0.5 + spread, u_balance: bal,
        u_agents: agentUv, u_agent_dir: agentDir, u_agent_count: variant === 'wisp' ? agents.length : 0,
        u_stars: stars, u_star_count: variant === 'starry' ? starCount : 0, u_hue_shift: shift,
      }, ['u_agent_count', 'u_star_count']);
      drawQuad(gl, quadVAO);

      // Post per variant.
      const post = ctx.post;
      if (variant === 'silk' && silkLight) { post.tonemap = 'none'; post.bloom = 0; post.vignette = 0.15; }
      else if (variant === 'starry') { post.bloom = 0.25; post.bloomThreshold = 1.2; post.grain = 0.05; }
      else if (variant === 'lumen') { post.bloom = 0.8; post.bloomThreshold = 0.9; }
      else if (variant === 'wisp') { post.bloom = 0.9; post.bloomThreshold = 0.8; post.vignette = 0.4; }
      else if (variant === 'warp') { post.bloom = 0.7; post.bloomThreshold = 0.9; }
      else { post.bloom = 0.6; }
    },

    setVariant(id: string): void {
      if (!(VARIANTS as readonly string[]).includes(id) || id === variant) return;
      variant = id as Variant;
      needsInit = true;
      if (accum) { bindTarget(gl, accum); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    },
    getVariant: () => variant,

    setQuality(q: QualityParams): void {
      quality = q;
    },

    dispose(): void {
      state.dispose();
      deleteTarget(gl, accum);
      for (const p of progs.values()) {
        gl.deleteProgram(p.update.prog);
        gl.deleteProgram(p.render.prog);
        gl.deleteProgram(p.display.prog);
      }
      gl.deleteProgram(fill.prog);
      gl.deleteVertexArray(emptyVAO);
    },
  };

  function starryShift(ctx: StyleContext): number {
    return rgbHue(ctx.palette.primary) - STARRY_REF_HUE;
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hueRotateJs(c: [number, number, number], deg: number): [number, number, number] {
  const a = (deg * Math.PI) / 180, k = 0.57735;
  const ca = Math.cos(a), sa = Math.sin(a);
  const dot = k * (c[0] + c[1] + c[2]);
  const cr: [number, number, number] = [k * (c[2] - c[1]), k * (c[0] - c[2]), k * (c[1] - c[0])];
  return [0, 1, 2].map((i) => c[i] * ca + cr[i] * sa + k * dot * (1 - ca)) as [number, number, number];
}

function worldToUv(cam: StyleContext['camera'], x: number, y: number, view: number, aspect: number): [number, number] {
  const dx = x - cam.center[0], dy = y - cam.center[1];
  const c = Math.cos(-cam.rotation), s = Math.sin(-cam.rotation);
  const rx = dx * c - dy * s, ry = dx * s + dy * c;
  return [0.5 + rx / (view * aspect), 0.5 + ry / view];
}

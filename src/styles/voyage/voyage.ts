/**
 * Voyage — a long camera flight through a raymarched Mandelbox (ref 12).
 *
 * The camera follows a spline laid through open space by a CPU mirror of the
 * distance estimator (mandelbox.ts), so it never clips the walls; its speed
 * is relative to the local clearance, so tight passages and big halls both
 * read at a comfortable pace.
 *   presence     → fold parameters breathe (scale, min radius)
 *   bass hits    → fold "breath" pulse + emissive veins (frame-accurate)
 *   highs        → iridescent sheen
 *   beat         → camera roll
 *   intensity    → flight speed and glow; build → faster, wider
 *   drop         → Voyage: dive (surge + FOV kick); Kaleido: mirror flip
 *   breakdown    → slower, deeper fog
 *
 * Performance: the march runs at a fraction of the scene resolution with a
 * per-frame sub-pixel jitter and a temporal upscale (resolve.frag); the step
 * budget adapts to the measured frame time. Low is genuinely lighter (fewer
 * pixels, steps, iterations, no extra AO taps).
 */

import { clamp, clamp01, createRng, expApproach, spring, type Vec3 } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { QualityLevel, QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { bindTarget, createTarget, deleteTarget, drawQuad, makeProgram, PingPong, setUniforms, withIncludes, type Target } from '../shared/gl';
import { cross, FlightPath, norm, type BoxParams, type FlightSpace } from './mandelbox';

import noiseSrc from '../shared/noise.glsl?raw';
import marchFrag from './shaders/march.frag?raw';
import resolveFrag from './shaders/resolve.frag?raw';
import presentFrag from './shaders/present.frag?raw';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';

// ── Tuning ──────────────────────────────────────────────────────
interface Budget { marchScale: number; steps: number; iters: number; detail: number; ao: boolean; blend: number }
const BUDGET: Record<QualityLevel, Budget> = {
  low: { marchScale: 0.5, steps: 56, iters: 8, detail: 1.6, ao: false, blend: 0.2 },
  medium: { marchScale: 0.5, steps: 88, iters: 10, detail: 1.1, ao: true, blend: 0.15 },
  high: { marchScale: 0.75, steps: 130, iters: 12, detail: 0.8, ao: true, blend: 0.12 },
};
/** Fractal parameters and the flight space inside the box. */
const BASE: BoxParams = { scale: 2.9, minR2: 0.25, fold: 1.0 };
const SPACE: FlightSpace = { bound: 3.0, clearance: 0.16 };
/** Melting warp: amplitude (world units) base / from mids / from builds, frequency. */
const WARP_BASE = 0.01;
const WARP_MID = 0.018;
const WARP_BUILD = 0.014;
const WARP_FREQ = 2.6;
/** Corkscrew twist ahead of the camera (rad per world unit): base and beat kick. */
const TWIST_BASE = 0.004;
const TWIST_BEAT = 0.016;
/** Backdrop cylinder world: radius, tiles around, march steps per quality. */
const WORLD_R = 36;
const WORLD_TILES = 30;
const WORLD_STEPS: Record<QualityLevel, number> = { low: 28, medium: 44, high: 64 };
/** Drop Kaleido fold: fade in, hold, fade out (s). */
const KAL_IN = 0.35;
const KAL_HOLD = 2.6;
const KAL_OUT = 1.3;
/** Camera safety: push away from walls closer than this x clearance. */
const SAFE_K = 0.35;
/** Presence modulation of scale / minR2, bass breath on the fold. */
const SCALE_MOD = 0.07;
const MINR_MOD = 0.06;
const FOLD_BREATH = 0.035;
/** Flight speed in clearances per second at intensity 0 / 1. */
const SPEED_MIN = 0.35;
const SPEED_MAX = 1.9;
/** Field of view (deg) and drop kick. */
const FOV = 64;
const FOV_BUILD = 10;
const FOV_DROP = 20;
/** Beat roll impulse (rad/s) and wander (rad). */
const ROLL_KICK = 0.9;
const ROLL_WANDER = 0.5;
/** Drop dive: extra speed multiplier and decay (s). */
const DIVE_SPEED = 3.5;
const DIVE_TAU = 1.8;
/** Adaptive step budget: target frame interval (ms). */
const TARGET_MS = 1000 / 60;
const FAR = 14;
/** Kaleido segment counts cycled on drops. */
const SEGMENTS = [6, 8, 5, 7];
const HALTON: [number, number][] = [];
for (let i = 1; i <= 8; i++) {
  const h = (b: number): number => { let f = 1, r = 0, n = i; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; };
  HALTON.push([h(2) - 0.5, h(3) - 0.5]);
}

export function createVoyageStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0xf4ac);
  let quality = deps.quality;
  const march = makeProgram(gl, fullscreenVert, withIncludes(marchFrag, { noise: noiseSrc }));
  const resolve = makeProgram(gl, fullscreenVert, resolveFrag);
  const present = makeProgram(gl, fullscreenVert, presentFrag);
  let low: Target | null = null;
  let hist: PingPong | null = null;
  let resetHist = true;

  // Live fractal parameters (read by the path planner too).
  const params: BoxParams = { ...BASE, warpAmp: WARP_BASE, warpFreq: WARP_FREQ, warpTime: 0, lip: 1 };
  const path = new FlightPath(() => params, () => SPACE, rng);

  let time = 0;
  let frameIdx = 0;
  let pos: Vec3 = path.sample(0);
  let fwd: Vec3 = [0, 0, -1];
  let up: Vec3 = [0, 1, 0];
  let roll = 0, rollVel = 0, rollSign = 1;
  let fov = FOV, fovVel = 0;
  let dive = 0;
  let flashEnv = 0;
  let scaleS = 0, minrS = 0, breath = 0;
  let fogS = 0.16;
  let segIdx = 0;
  let kalRot = 0, kalRotVel = 0;
  let kalT = 99;
  let twistEnv = 0, twistSign = 1;
  let warpMid = 0;
  const safe: Vec3 = [0, 0, 0];
  let stepScale = 1;
  let lastReal = -1, realMs = TARGET_MS;
  let prev: { pos: Vec3; right: Vec3; up: Vec3; fwd: Vec3; tan: number } | null = null;

  function ensure(w: number, h: number): void {
    const b = BUDGET[quality.level];
    const lw = Math.max(32, Math.round(w * b.marchScale)), lh = Math.max(32, Math.round(h * b.marchScale));
    if (!low || low.w !== lw || low.h !== lh) {
      deleteTarget(gl, low);
      low = createTarget(gl, lw, lh, { internal: gl.RGBA16F, filter: gl.LINEAR });
      resetHist = true;
    }
    if (!hist || hist.read.w !== w || hist.read.h !== h) {
      hist?.dispose();
      hist = new PingPong(gl, w, h, { internal: gl.RGBA16F, filter: gl.LINEAR });
      resetHist = true;
    }
  }

  function restart(): void {
    path.reset();
    pos = path.sample(0);
    const ahead = path.sample(SPACE.clearance);
    fwd = norm([ahead[0] - pos[0], ahead[1] - pos[1], ahead[2] - pos[2]]);
    resetHist = true;
    prev = null;
  }

  return {
    id: 'voyage',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (e.type === 'drop') {
        if (ctx.flash.request()) flashEnv = 1;
        dive = 1;
        fovVel += FOV_DROP * 6;
        // The world folds into a mirrored mandala for a few seconds.
        kalT = 0;
        segIdx = (segIdx + 1) % SEGMENTS.length;
        kalRotVel += 2.5 * (rng() < 0.5 ? -1 : 1);
      } else if (e.type === 'bigHit') {
        rollVel += ROLL_KICK * 1.6 * rollSign;
        rollSign = -rollSign;
      } else if (e.type === 'trackChange') {
        restart();
      }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const fade = ctx.fadeInOut;
      const es = ctx.eventState;

      // Adaptive step budget from the real frame interval.
      const now = performance.now();
      if (lastReal > 0) realMs += (Math.min(now - lastReal, 100) - realMs) * 0.05;
      lastReal = now;
      if (realMs > TARGET_MS * 1.12) stepScale = Math.max(0.55, stepScale - 0.01);
      else if (realMs < TARGET_MS * 0.9) stepScale = Math.min(1, stepScale + 0.004);

      // Fractal parameters.
      scaleS += (ctx.midPresence - scaleS) * expApproach(dt, 2.5);
      minrS += (ctx.highPresence - minrS) * expApproach(dt, 3);
      breath = Math.max(breath * Math.exp(-dt / 0.16), ctx.bassHits);
      params.scale = BASE.scale - SCALE_MOD * (scaleS - 0.4) + 0.02 * simplex2(time * 0.03, 7);
      params.minR2 = clamp(BASE.minR2 + MINR_MOD * (minrS - 0.3), 0.12, 0.5);
      params.fold = BASE.fold + FOLD_BREATH * breath;
      // Melting warp (shared with the planner so the flight stays clear).
      warpMid += (ctx.midPresence - warpMid) * expApproach(dt, 1.5);
      params.warpAmp = (WARP_BASE + WARP_MID * warpMid + WARP_BUILD * es.buildProgress) * (0.5 + 0.5 * fade);
      params.warpTime = time;
      // Distance-bound correction: the warp's slope plus the twist's (about
      // 6 units off-axis at most inside the box).
      params.lip = 1 / (1 + params.warpAmp * WARP_FREQ * 2.5 + (TWIST_BASE + TWIST_BEAT) * 6);

      // Flight.
      dive *= Math.exp(-dt / DIVE_TAU);
      const sp = SPACE;
      const clear = clamp(path.de(pos), sp.clearance * 0.2, sp.clearance * 3);
      const speed = clear * (SPEED_MIN + (SPEED_MAX - SPEED_MIN) * ctx.intensitySmoothed + 0.8 * es.buildProgress)
        * (0.3 + 0.7 * fade) * (es.section === 'breakdown' ? 0.6 : 1) * (1 + DIVE_SPEED * dive);
      path.advance(speed * dt);
      const onPath = path.sample(0);
      // Safety: if the breathing / warping walls come too close, ease away.
      const here: Vec3 = [onPath[0] + safe[0], onPath[1] + safe[1], onPath[2] + safe[2]];
      const dHere = path.de(here);
      if (dHere < SAFE_K * sp.clearance) {
        const e = 0.01;
        const g = norm([
          path.de([here[0] + e, here[1], here[2]]) - dHere,
          path.de([here[0], here[1] + e, here[2]]) - dHere,
          path.de([here[0], here[1], here[2] + e]) - dHere,
        ]);
        const push = (SAFE_K * sp.clearance - dHere) * Math.min(1, dt * 8);
        safe[0] += g[0] * push; safe[1] += g[1] * push; safe[2] += g[2] * push;
      } else {
        const k0 = Math.exp(-dt / 2);
        safe[0] *= k0; safe[1] *= k0; safe[2] *= k0;
      }
      pos = [onPath[0] + safe[0], onPath[1] + safe[1], onPath[2] + safe[2]];
      const look = path.sample(Math.max(sp.clearance, clear * 2.5));
      const fwdT = norm([look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]]);
      const k = expApproach(dt, 0.45);
      fwd = norm([fwd[0] + (fwdT[0] - fwd[0]) * k, fwd[1] + (fwdT[1] - fwd[1]) * k, fwd[2] + (fwdT[2] - fwd[2]) * k]);
      // Keep "up" orthogonal, leaning gently toward world up.
      const lean = expApproach(dt, 4);
      up = [up[0], up[1] + lean, up[2]];
      const d = up[0] * fwd[0] + up[1] * fwd[1] + up[2] * fwd[2];
      up = norm([up[0] - fwd[0] * d, up[1] - fwd[1] * d, up[2] - fwd[2] * d]);

      // Roll on the beat.
      if (ctx.beatOnset && ctx.beatConfidence > 0.3) {
        rollVel += ROLL_KICK * rollSign * (0.4 + 0.6 * fade);
        rollSign = -rollSign;
        // The far world corkscrews on the beat, alternating direction.
        twistEnv = 1;
        twistSign = -twistSign;
      }
      twistEnv *= Math.exp(-dt / 0.35);
      kalT += dt;
      [roll, rollVel] = spring(roll, rollVel, ROLL_WANDER * simplex2(time * 0.05, 11), 2.2, dt);
      const fovT = FOV + FOV_BUILD * es.buildProgress + 4 * ctx.bassHits;
      [fov, fovVel] = spring(fov, fovVel, fovT, 4, dt);
      [kalRot, kalRotVel] = spring(kalRot, kalRotVel, kalRot, 2, dt);
      kalRot += dt * (0.05 + 0.15 * ctx.intensitySmoothed);
      flashEnv *= Math.exp(-dt / 0.22);
      const fogT = es.section === 'breakdown' ? 0.3 : es.section === 'silence' ? 0.24 : 0.14;
      fogS += (fogT - fogS) * expApproach(dt, 1.5);
    },

    render(ctx: StyleContext): void {
      ensure(ctx.width, ctx.height);
      const L = low!, H = hist!;
      const b = BUDGET[quality.level];
      const pal = ctx.palette;
      const aspect = ctx.width / ctx.height;
      const tan = Math.tan(((fov * Math.PI) / 180) / 2);
      // Camera basis with roll.
      const r0 = norm(cross(fwd, up));
      const u0 = cross(r0, fwd);
      const cr = Math.cos(roll + ctx.camera.rotation * 0.3), sr = Math.sin(roll + ctx.camera.rotation * 0.3);
      const right: Vec3 = [r0[0] * cr + u0[0] * sr, r0[1] * cr + u0[1] * sr, r0[2] * cr + u0[2] * sr];
      const camUp: Vec3 = [u0[0] * cr - r0[0] * sr, u0[1] * cr - r0[1] * sr, u0[2] * cr - r0[2] * sr];
      const jit = HALTON[frameIdx % HALTON.length];
      frameIdx++;
      // The sun sits toward one end of the cylinder axis, like a habitat's end cap.
      const sun = norm([0.3 * Math.sin(time * 0.02), 0.35 + 0.1 * Math.sin(time * 0.013), 1]);
      const worldP = (2 * Math.PI * WORLD_R) / WORLD_TILES;
      const kal = kalT < KAL_IN ? kalT / KAL_IN : kalT < KAL_IN + KAL_HOLD ? 1 : Math.max(0, 1 - (kalT - KAL_IN - KAL_HOLD) / KAL_OUT);
      const fade = ctx.fadeInOut;

      gl.disable(gl.BLEND);
      bindTarget(gl, L);
      gl.useProgram(march.prog);
      setUniforms(gl, march, {
        u_res: [L.w, L.h], u_jitter: jit, u_cam_pos: pos, u_cam_right: right, u_cam_up: camUp, u_cam_fwd: fwd,
        u_tan_half: tan, u_aspect: aspect,
        u_warp_amp: params.warpAmp ?? 0, u_warp_freq: WARP_FREQ, u_lip: params.lip ?? 1,
        u_twist: (TWIST_BASE + TWIST_BEAT * twistEnv * (0.6 + 0.8 * ctx.responsiveness)) * twistSign,
        u_world_r: WORLD_R, u_world_p: worldP, u_world_sc: worldP / 8.2, u_world_steps: WORLD_STEPS[quality.level],
        u_scale: params.scale, u_min_r2: params.minR2, u_fold: params.fold, u_iters: b.iters,
        u_steps: Math.round(b.steps * stepScale), u_detail: b.detail, u_far: FAR, u_ao_on: b.ao,
        u_sun: sun, u_bg: pal.bg, u_c0: pal.primary, u_c1: pal.secondary, u_c2: pal.accent, u_c3: pal.highlight,
        u_time: time, u_pulse: clamp01(breath) * (0.4 + 0.6 * fade),
        u_glow: clamp01(0.5 * ctx.intensityGlow + 0.5 * ctx.eventState.buildProgress + 0.6 * ctx.eventState.dropEnvelope) * fade,
        u_shimmer: clamp01(0.6 * ctx.highPresence + 0.6 * ctx.highHits) * fade,
        u_fog: fogS, u_light: 0.45 + 0.55 * fade,
      });
      drawQuad(gl, quadVAO);

      bindTarget(gl, H.write);
      gl.useProgram(resolve.prog);
      const p = prev ?? { pos, right, up: camUp, fwd, tan };
      setUniforms(gl, resolve, {
        u_cur: L.tex[0], u_hist: H.read.tex[0], u_res: [H.write.w, H.write.h], u_low_res: [L.w, L.h], u_jitter: jit,
        u_cam_pos: pos, u_cam_right: right, u_cam_up: camUp, u_cam_fwd: fwd, u_tan_half: tan,
        u_prev_pos: p.pos, u_prev_right: p.right, u_prev_up: p.up, u_prev_fwd: p.fwd, u_prev_tan_half: p.tan,
        u_aspect: aspect, u_reset: resetHist, u_blend: b.blend,
      });
      drawQuad(gl, quadVAO);
      H.swap();
      resetHist = false;
      prev = { pos: [...pos], right, up: camUp, fwd: [...fwd], tan };

      ctx.bindScene();
      gl.useProgram(present.prog);
      setUniforms(gl, present, {
        u_src: H.read.tex[0], u_res: [ctx.width, ctx.height], u_aspect: aspect,
        u_kaleido: kal * kal * (3 - 2 * kal), u_segments: SEGMENTS[segIdx], u_rot: kalRot,
        u_chroma: (0.0025 + 0.004 * ctx.bassHits) * (0.4 + 0.6 * fade),
        u_src_rot: 0.3 * simplex2(time * 0.04, 5), u_center: [0.5 + 0.05 * simplex2(time * 0.03, 8), 0.5 + 0.05 * simplex2(time * 0.03, 9)],
        u_zoom: 0.62 - 0.06 * ctx.bassHits,
      });
      drawQuad(gl, quadVAO);

      const post = ctx.post;
      post.tonemap = 'filmic';
      post.exposure = 1 + 0.4 * flashEnv;
      post.bloom = 0.35;
      post.bloomThreshold = 0.95;
      post.grain = 0.03;
      post.vignette = 0.32;
      post.flash = 0;
    },

    setVariant(): void { /* single look */ },
    getVariant: () => 'voyage',
    setQuality(q: QualityParams): void { quality = q; resetHist = true; },
    dispose(): void {
      deleteTarget(gl, low);
      hist?.dispose();
      gl.deleteProgram(march.prog);
      gl.deleteProgram(resolve.prog);
      gl.deleteProgram(present.prog);
    },
  };
}

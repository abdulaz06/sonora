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
/** Fractal parameters per variant. */
const BASE: Record<'voyage' | 'kaleido', BoxParams> = {
  voyage: { scale: 2.9, minR2: 0.25, fold: 1.0 },
  kaleido: { scale: 2.6, minR2: 0.36, fold: 1.0 },
};
/** Flight space per variant: radius kept inside the box, preferred clearance. */
const SPACE: Record<'voyage' | 'kaleido', FlightSpace> = {
  voyage: { bound: 3.0, clearance: 0.16 },
  kaleido: { bound: 3.0, clearance: 0.13 },
};
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

type Variant = 'voyage' | 'kaleido';

export function createVoyageStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0xf4ac);
  let quality = deps.quality;
  let variant: Variant = 'voyage';
  const march = makeProgram(gl, fullscreenVert, withIncludes(marchFrag, { noise: noiseSrc }));
  const resolve = makeProgram(gl, fullscreenVert, resolveFrag);
  const present = makeProgram(gl, fullscreenVert, presentFrag);
  let low: Target | null = null;
  let hist: PingPong | null = null;
  let resetHist = true;

  // Live fractal parameters (read by the path planner too).
  const params: BoxParams = { ...BASE.voyage };
  const path = new FlightPath(() => params, () => SPACE[variant], rng);

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
    const ahead = path.sample(SPACE[variant].clearance);
    fwd = norm([ahead[0] - pos[0], ahead[1] - pos[1], ahead[2] - pos[2]]);
    resetHist = true;
    prev = null;
  }

  return {
    id: 'voyage',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (e.type === 'drop') {
        if (ctx.flash.request()) flashEnv = 1;
        if (variant === 'voyage') {
          dive = 1;
          fovVel += FOV_DROP * 6;
        } else {
          segIdx = (segIdx + 1) % SEGMENTS.length;
          kalRotVel += 2.5 * (rng() < 0.5 ? -1 : 1);
          dive = 0.6;
        }
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
      const base = BASE[variant];
      params.scale = base.scale - SCALE_MOD * (scaleS - 0.4) + 0.02 * simplex2(time * 0.03, 7);
      params.minR2 = clamp(base.minR2 + MINR_MOD * (minrS - 0.3), 0.12, 0.5);
      params.fold = base.fold + FOLD_BREATH * breath;

      // Flight.
      dive *= Math.exp(-dt / DIVE_TAU);
      const sp = SPACE[variant];
      const clear = clamp(path.de(pos), sp.clearance * 0.2, sp.clearance * 3);
      const speed = clear * (SPEED_MIN + (SPEED_MAX - SPEED_MIN) * ctx.intensitySmoothed + 0.8 * es.buildProgress)
        * (0.3 + 0.7 * fade) * (es.section === 'breakdown' ? 0.6 : 1) * (1 + DIVE_SPEED * dive);
      path.advance(speed * dt);
      pos = path.sample(0);
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
      }
      [roll, rollVel] = spring(roll, rollVel, ROLL_WANDER * simplex2(time * 0.05, 11), 2.2, dt);
      const fovT = FOV + FOV_BUILD * es.buildProgress + 4 * ctx.bassHits;
      [fov, fovVel] = spring(fov, fovVel, fovT, 4, dt);
      [kalRot, kalRotVel] = spring(kalRot, kalRotVel, kalRot, 2, dt);
      kalRot += dt * (0.05 + 0.15 * ctx.intensitySmoothed) * (variant === 'kaleido' ? 1 : 0);
      flashEnv *= Math.exp(-dt / 0.22);
      const fogT = es.section === 'breakdown' ? 0.3 : es.section === 'silence' ? 0.24 : 0.14;
      fogS += (fogT * (variant === 'kaleido' ? 0.7 : 1) - fogS) * expApproach(dt, 1.5);
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
      const sunA = time * 0.02;
      const sun = norm([Math.cos(sunA) * 0.6, 0.55, Math.sin(sunA) * 0.6]);
      const fade = ctx.fadeInOut;

      gl.disable(gl.BLEND);
      bindTarget(gl, L);
      gl.useProgram(march.prog);
      setUniforms(gl, march, {
        u_res: [L.w, L.h], u_jitter: jit, u_cam_pos: pos, u_cam_right: right, u_cam_up: camUp, u_cam_fwd: fwd,
        u_tan_half: tan, u_aspect: aspect,
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
        u_kaleido: variant === 'kaleido', u_segments: SEGMENTS[segIdx], u_rot: kalRot,
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

    setVariant(id: string): void {
      if (id === 'voyage' && id !== variant) {
        variant = id;
        Object.assign(params, BASE[variant]);
        restart();
      }
    },
    getVariant: () => variant,
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

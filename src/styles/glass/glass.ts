/**
 * Glass — raymarched refractive forms in a studio (refs: glass/).
 *
 *   bubbles   smooth-union glass blobs that merge and split with the bass
 *   fins      a twisted ribbon of tinted glass slats
 *   chrome    a field of mirror tubes riding a travelling wave
 *
 * Glass refracts with a per-channel index (rainbow fringes), Fresnel, bounded
 * internal reflections; the studio is a palette gradient with softboxes, so
 * the colour comes from the palette and the glints from the lights.
 *
 * Mapping: kicks ripple the surfaces and flare the key light (on the hit
 * frame); highs sparkle the glints; intensity drives the spin and how many
 * forms there are; builds tighten the twist; drops reform the arrangement.
 * Rendered at a reduced resolution per quality and scaled up (Low: fewer
 * steps, no internal bounce).
 */

import { clamp01, createRng } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { RGB } from '../../engine/color-engine';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { bindTarget, createTarget, deleteTarget, drawQuad, makeProgram, setUniforms, type Program, type Target } from '../shared/gl';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';
import glassFrag from './shaders/glass.frag?raw';

// ── Tuning ──────────────────────────────────────────────────────
type Look = 'bubbles' | 'fins' | 'chrome';
const SCENE: Record<Look, number> = { bubbles: 0, fins: 1, chrome: 2 };
/** March resolution (share of the scene target), steps and internal bounces per quality. */
const RES: Record<QualityParams['level'], number> = { low: 0.55, medium: 0.72, high: 1 };
const STEPS: Record<QualityParams['level'], number> = { low: 48, medium: 80, high: 120 };
const BOUNCES: Record<QualityParams['level'], number> = { low: 0, medium: 1, high: 2 };
/** Bubbles: how many (quiet → loud), size range, smooth-union width (calm → bass). */
const BALLS: [number, number] = [4, 9];
const BALL_R: [number, number] = [0.17, 0.33];
const BLEND_K: [number, number] = [0.12, 0.36];
/** Spin (rad/s): base + intensity; camera orbit (rad/s). */
const SPIN: [number, number] = [0.12, 0.9];
const ORBIT = 0.05;
/** Kick: ripple strength, key-light flare and its decay (s). */
const KICK_RIPPLE = 1;
const KICK_FLARE = 0.7;
const KICK_TAU = 0.16;
/** Kick: the whole studio light lifts by this share on the hit frame (fixed headroom). */
const KICK_STUDIO = 0.38;
/** Drop: reform envelope decay (s). */
const REFORM_TAU = 1.2;

export function createGlassStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0x61a5);
  let quality = deps.quality;
  let look: Look = 'bubbles';
  const progs: Partial<Record<string, Program>> = {};
  const glassProg = (): Program => {
    const key = `${look}-${BOUNCES[quality.level]}`;
    return (progs[key] ??= makeProgram(gl, fullscreenVert, glassFrag, `#define SCENE ${SCENE[look]}\n#define BOUNCES ${BOUNCES[quality.level]}`));
  };
  let up: Program | null = null;
  const upProgram = (): Program => (up ??= makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform sampler2D u_src; uniform vec2 u_res; uniform vec2 u_src_res; out vec4 frag;
// Bilinear scale-up with a light sharpen (keeps the glass edges crisp).
void main() { vec2 uv = gl_FragCoord.xy / u_res; vec2 tx = 1.0 / u_src_res;
  vec3 c = texture(u_src, uv).rgb;
  vec3 b = (texture(u_src, uv + vec2(tx.x, 0.0)).rgb + texture(u_src, uv - vec2(tx.x, 0.0)).rgb + texture(u_src, uv + vec2(0.0, tx.y)).rgb + texture(u_src, uv - vec2(0.0, tx.y)).rgb) * 0.25;
  frag = vec4(max(c + (c - b) * 0.35, 0.0), 1.0); }`));
  let target: Target | null = null;

  // ── State ──
  let time = 0;
  let spin = 0;
  let orbit = rng() * Math.PI * 2;
  let layout = rng() * 100;
  let kickArmed = true;
  let kick = 0;
  let rippleT = 9;
  let rippleC: [number, number, number] = [0, 0, 0];
  let reform = 0;
  let waveT = 0;
  let sparkle = 0;
  let countNow = 6;

  const ballPos = (i: number, t: number): [number, number, number, number] => {
    const s = layout + i * 7.31;
    const r = 0.25 + 0.42 * (0.5 + 0.5 * Math.sin(s * 1.7));
    const a = s + t * (0.11 + 0.05 * Math.sin(s)) + spin * 0.6;
    const y = Math.sin(s * 2.3 + t * 0.17) * 0.32;
    const rad = BALL_R[0] + (BALL_R[1] - BALL_R[0]) * (0.5 + 0.5 * Math.sin(s * 3.1 + t * 0.2));
    return [Math.cos(a) * r * (1 + reform * 0.8), y * (1 + reform * 0.6), Math.sin(a) * r * (1 + reform * 0.8), rad];
  };

  return {
    id: 'glass',

    onEvent(e: SonoraEvent): void {
      if (e.type === 'drop') { layout = rng() * 100; reform = 1; rippleT = 0; rippleC = [0, 0, 0]; }
      else if (e.type === 'trackChange') layout = rng() * 100;
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const fade = ctx.fadeInOut;
      spin += dt * (SPIN[0] + SPIN[1] * ctx.intensitySmoothed) * (0.4 + 0.6 * fade);
      orbit += dt * ORBIT * (1 + ctx.intensitySmoothed);
      waveT += dt * (1.2 + 3.5 * ctx.intensitySmoothed);
      reform *= Math.exp(-dt / REFORM_TAU);
      rippleT += dt;
      kick *= Math.exp(-dt / KICK_TAU);
      // Frame-accurate: the bass envelope flares the key light on the hit frame.
      kick = Math.max(kick, ctx.bassHits * fade);
      sparkle = Math.max(sparkle * Math.exp(-dt / 0.12), ctx.highHits);
      if (ctx.bassHits < 0.3) kickArmed = true;
      if (kickArmed && ctx.bassHits > 0.55 && fade > 0.1) {
        kickArmed = false;
        rippleT = 0;
        const b = ballPos(Math.floor(rng() * countNow), time);
        rippleC = look === 'bubbles' ? [b[0], b[1], b[2]] : [(rng() - 0.5) * 0.8, 0, (rng() - 0.5) * 0.8];
      }
      const want = BALLS[0] + (BALLS[1] - BALLS[0]) * clamp01(ctx.intensityGlow);
      countNow += (want - countNow) * (1 - Math.exp(-dt / 3));
    },

    render(ctx: StyleContext): void {
      const pal = ctx.palette;
      const cam = ctx.camera;
      const q = quality.level;
      const w = Math.max(1, Math.round(ctx.width * RES[q])), h = Math.max(1, Math.round(ctx.height * RES[q]));
      if (!target || target.w !== w || target.h !== h) { deleteTarget(gl, target); target = createTarget(gl, w, h, { internal: gl.RGBA16F }); }
      const glowK = clamp01(ctx.intensityGlow);
      const es = ctx.eventState;

      // Camera: an orbit around the forms, the shared camera's surge and roll.
      const dist = (look === 'chrome' ? 2.2 : look === 'fins' ? 2.2 : 2.1) * (1 - cam.lurchAmount * 0.12);
      const elev = look === 'chrome' ? 0.85 + 0.12 * Math.sin(time * 0.05) : 0.18 + 0.12 * Math.sin(time * 0.07);
      const az = orbit + simplex2(time * 0.03, 3) * 0.4;
      const pos: [number, number, number] = [Math.cos(az) * Math.cos(elev) * dist, Math.sin(elev) * dist + (look === 'chrome' ? 0.3 : 0), Math.sin(az) * Math.cos(elev) * dist];
      const tgt: [number, number, number] = [0, look === 'chrome' ? 0.2 : 0, 0];
      const f = norm3([tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]]);
      let r = norm3(cross3(f, [0, 1, 0]));
      let u = cross3(r, f);
      const roll = cam.roll * 1.2;
      [r, u] = [add3(mul3(r, Math.cos(roll)), mul3(u, Math.sin(roll))), add3(mul3(u, Math.cos(roll)), mul3(r, -Math.sin(roll)))];
      const fov = (look === 'chrome' ? 48 : 42) * Math.PI / 180 + (cam.fov - 52 * Math.PI / 180);

      // Forms.
      const n = Math.round(countNow);
      const balls: number[] = [];
      for (let i = 0; i < 10; i++) { const b = i < n ? ballPos(i, time) : [0, 0, 0, 0]; balls.push(b[0], b[1], b[2], b[3]); }

      // Studio colours from the palette.
      // Chrome is brighter overall (mirrors everywhere): a smaller lift keeps each hit's step in bounds.
      const studio = 1 + KICK_STUDIO * kick * (look === 'chrome' ? 0.5 : 1);
      const lo = mix3(pal.bg, pal.shade, 0.5).map((x) => x * 1.4 * studio) as RGB;
      const mid = mul3(pal.secondary, 0.7 * studio) as RGB;
      const hi = mul3(mix3(pal.highlight, pal.primary, 0.35), 0.95 * studio) as RGB;
      const keyI = (1.8 + 1.2 * glowK) * (1 + KICK_FLARE * kick) * (look === 'chrome' ? 0.4 : 1);
      const key = mul3(mix3([1, 1, 1], pal.highlight, 0.25), keyI);
      const rim = mul3(pal.accent, 1.3 + 0.6 * glowK);
      const tint: RGB = look === 'fins' ? normTint(pal.primary, 0.75) : look === 'chrome' ? mix3([1, 1, 1], pal.highlight, 0.3) as RGB : mix3([1, 1, 1], pal.secondary, 0.12) as RGB;

      bindTarget(gl, target);
      gl.disable(gl.BLEND);
      const p = glassProg();
      gl.useProgram(p.prog);
      setUniforms(gl, p, {
        u_res: [w, h], u_time: time, u_cam_pos: pos, u_cam_fwd: f, u_cam_right: r, u_cam_up: u, u_tan_half: Math.tan(fov / 2),
        u_steps: STEPS[q], u_env_lo: lo, u_env_mid: mid, u_env_hi: hi, u_key: key, u_rim: rim, u_sparkle: sparkle,
        u_balls: balls, u_ball_count: n, u_blend_k: BLEND_K[0] + (BLEND_K[1] - BLEND_K[0]) * clamp01(ctx.bassPresence),
        u_ripple: [rippleC[0], rippleC[1], rippleC[2], KICK_RIPPLE * (rippleT < 1.5 ? 1 : 0)], u_ripple_t: rippleT,
        u_spin: spin, u_twist: 0.1 + 0.16 * es.buildProgress + 0.05 * glowK, u_count: look === 'fins' ? 10 + Math.round(10 * glowK) : 8 + 6 * glowK,
        u_tint: tint, u_wave_t: waveT, u_wave_amp: 0.4 + 0.8 * clamp01(ctx.bassPresence), u_reform: reform,
      });
      drawQuad(gl, quadVAO);

      ctx.bindScene();
      const sp = upProgram();
      gl.useProgram(sp.prog);
      setUniforms(gl, sp, { u_src: target.tex[0], u_res: [ctx.width, ctx.height], u_src_res: [w, h] });
      drawQuad(gl, quadVAO);
      const post = ctx.post;
      post.bloom = 0.5;
      post.bloomThreshold = 1.0;
      post.exposure = look === 'chrome' ? 0.7 : 1;
      post.vignette = 0.3;
    },

    setQuality(qp: QualityParams): void { quality = qp; },
    setVariant(id: string): void { look = id === 'fins' ? 'fins' : id === 'chrome' ? 'chrome' : 'bubbles'; },
    getVariant: () => look,
    dispose(): void {
      for (const x of Object.values(progs)) if (x) gl.deleteProgram(x.prog);
      if (up) gl.deleteProgram(up.prog);
      deleteTarget(gl, target);
    },
  };
}

type V3 = [number, number, number];
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: readonly number[], k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const mix3 = (a: readonly number[], b: readonly number[], t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** A transmission tint from a colour: its hue at full brightness, `k` of the way from white. */
function normTint(c: RGB, k: number): RGB {
  const m = Math.max(c[0], c[1], c[2], 1e-3);
  return mix3([1, 1, 1], [c[0] / m, c[1] / m, c[2] / m], k);
}

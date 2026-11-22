/**
 * Cymatics — sound made visible (refs: cymatics/).
 *
 * Sand on a vibrating plate settles on the nodal lines of its standing wave
 * (Chladni patterns). GPU grains random-walk with a step set by the plate's
 * amplitude where they are, so they leave the antinodes and gather on the
 * nodes; every grain is drawn mirrored, so the relief is symmetric left/right.
 * Their density becomes a heightfield on a raised plate with a carved
 * medallion, lit like a bas-relief (grazing light, deep shadows, ambient
 * occlusion, fibrous grain). A small mirrored dye field grows smoky fur off
 * the edges; thrown grains sparkle in the dark.
 *
 * Mapping:
 *   mode (m, n)   band balance and spectral centroid pick it; builds raise it
 *                 slowly; drops jump to a new complex mode with a burst;
 *                 breakdowns relax to simple modes and round the plate
 *   kicks         throw the sand up a little (it resettles) and send a ripple
 *   intensity     how lively the sand is; the medallion grows with it
 *   highs         thrown grains glint
 * Looks: Stone, Sand, Liquid (the standing wave itself, caustics over the
 * sand on the bottom). The palette tints the light and the deepest shadows;
 * the material stays close to monochrome, as in the reference.
 */

import { clamp01, createRng } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { RGB } from '../../engine/color-engine';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { bindTarget, createTarget, deleteTarget, drawQuad, makeProgram, PingPong, setUniforms, withIncludes, type Program, type Target } from '../shared/gl';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';
import noiseSrc from '../shared/noise.glsl?raw';
import updateFrag from './shaders/update.frag?raw';
import splatVert from './shaders/splat.vert?raw';
import smokeFrag from './shaders/smoke.frag?raw';
import shadeFrag from './shaders/shade.frag?raw';

// ── Tuning ──────────────────────────────────────────────────────
type Look = 'stone' | 'sand' | 'liquid';
const LOOK_ID: Record<Look, number> = { stone: 0, sand: 1, liquid: 2 };
/** Grain texture side per quality (side² grains, each drawn twice), density and smoke sizes. */
const SIDE: Record<QualityParams['level'], number> = { low: 320, medium: 640, high: 900 };
const DENS: Record<QualityParams['level'], number> = { low: 512, medium: 1024, high: 1536 };
const SMOKE: Record<QualityParams['level'], number> = { low: 256, medium: 512, high: 512 };
const SHADOW_STEPS: Record<QualityParams['level'], number> = { low: 8, medium: 16, high: 22 };
/** Plate units covered by the density / smoke targets (half width). */
const EXTENT = 1.3;
/** Plate half extents (a portrait slab) and corner radius; breakdowns round it into a disc. */
const PLATE: [number, number] = [0.8, 0.95];
const PLATE_ROUND = 0.16;
const DISC_R = 0.84;
/** Mode complexity (m + n): quiet → loud, build adds, breakdown rests at, drop jumps to. */
const COMPLEXITY = [3, 9];
const BUILD_ADD = 4;
const BREAKDOWN_C = 3;
const DROP_C: [number, number] = [10, 14];
/** Mode changes: least time between (s), phrase timer (s), blend time (s) normal / drop. */
const MODE_MIN_S = 6;
const MODE_PHRASE_S = 22;
const BLEND_S = 2.2;
const DROP_BLEND_S = 0.45;
/** Sand liveliness: base, + intensity (motion follower), + while changing mode, + build. */
const DRIVE = [0.18, 1.1, 1.2, 0.4];
/** Kick: arm / fire thresholds; ripple speed (plate units/s) and decay (s). */
const KICK = [0.3, 0.55];
const SHOCK_SPEED = 1.5;
const SHOCK_TAU = 0.35;
/** Kick light pulse: the raking light brightens on the hit frame (fixed headroom), decay (s). */
const KICK_LIGHT = 0.42;
const KICK_LIGHT_TAU = 0.16;
/** Grazing light: elevation (rad), turn speed (rad/s). */
const LIGHT_EL = 0.36;
const LIGHT_TURN = 0.045;
/** Sand height gain. */
const GAIN = 0.32;

interface Mode { m: number; n: number; s: number }

function modesOf(c: number): Mode[] {
  const out: Mode[] = [];
  for (let m = 1; m < c; m++) {
    const n = c - m;
    if (n <= m) continue;
    out.push({ m, n, s: 1 }, { m, n, s: -1 });
  }
  return out;
}

export function createCymaticsStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0xc1ad);
  let quality = deps.quality;
  let look: Look = 'stone';
  const emptyVAO = gl.createVertexArray()!;
  const stateOpts = { internal: gl.RGBA32F, filter: gl.NEAREST, attachments: 2 };
  let side = SIDE[quality.level];
  let state = new PingPong(gl, side, side, stateOpts);
  let raw: Target | null = null;
  let blurA: Target | null = null;
  let blurB: Target | null = null;
  let smoke: PingPong | null = null;
  let needsInit = true;

  const inc = (s: string): string => withIncludes(s, { noise: noiseSrc });
  const progs: Partial<Record<string, Program>> = {};
  const prog = (key: string, make: () => Program): Program => (progs[key] ??= make());
  const P = {
    update: () => prog('update', () => makeProgram(gl, fullscreenVert, updateFrag)),
    splat: () => prog('splat', () => makeProgram(gl, splatVert, `#version 300 es
precision highp float; in vec3 v_w; out vec4 frag; void main() { frag = vec4(v_w, 1.0); }`)),
    blur: () => prog('blur', () => makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform sampler2D u_src; uniform vec2 u_dir; uniform vec2 u_res; out vec4 frag;
void main() { vec2 uv = gl_FragCoord.xy / u_res; vec4 c = texture(u_src, uv) * 0.2270;
  c += (texture(u_src, uv + u_dir * 1.3846) + texture(u_src, uv - u_dir * 1.3846)) * 0.3162;
  c += (texture(u_src, uv + u_dir * 3.2308) + texture(u_src, uv - u_dir * 3.2308)) * 0.0703; frag = c; }`)),
    smoke: () => prog('smoke', () => makeProgram(gl, fullscreenVert, inc(smokeFrag))),
    shade: () => prog(`shade${LOOK_ID[look]}`, () => makeProgram(gl, fullscreenVert, inc(shadeFrag), `#define LOOK ${LOOK_ID[look]}`)),
  };

  // ── State ──
  let time = 0;
  let modeA: Mode = { m: 1, n: 2, s: 1 };
  let modeB: Mode = modeA;
  let blend = 1, blendRate = 1 / BLEND_S;
  let complexity = 3;
  let lastModeT = -99;
  let kickArmed = true;
  let kickNow = 0, burstNow = 0;
  let shockT = 9, shockAmp = 0;
  let disc = 0;
  let medal = 0.15;
  let lightAz = rng() * Math.PI * 2;
  let centroid = 0.5;
  let flash = 0;
  let glint = 0;
  let kickLight = 0;

  function ensureTargets(): void {
    const q = quality.level;
    const s = SIDE[q];
    if (s !== side) { state.dispose(); side = s; state = new PingPong(gl, side, side, stateOpts); needsInit = true; }
    const d = DENS[q];
    if (!raw || raw.w !== d) {
      deleteTarget(gl, raw); deleteTarget(gl, blurA); deleteTarget(gl, blurB);
      raw = createTarget(gl, d, d, { internal: gl.RGBA16F });
      blurA = createTarget(gl, d, d, { internal: gl.RGBA16F });
      blurB = createTarget(gl, d, d, { internal: gl.RGBA16F });
      // Mipmapped (ambient occlusion reads a wide level).
      gl.bindTexture(gl.TEXTURE_2D, blurB.tex[0]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    const sm = SMOKE[q];
    if (!smoke || smoke.read.w !== sm) { smoke?.dispose(); smoke = new PingPong(gl, sm, sm, { internal: gl.RGBA16F }); }
  }

  /** Pick the next mode near complexity c (the centroid leans the m:n ratio), never the current one. */
  function pickMode(c: number): Mode {
    const list = modesOf(Math.max(3, Math.round(c))).filter((x) => !(x.m === modeB.m && x.n === modeB.n && x.s === modeB.s));
    if (!list.length) return modeB;
    // Brighter sound (high centroid) leans toward lopsided m:n (busier, finer lines).
    const want = 0.25 + 0.6 * (1 - centroid);
    let best = list[0], bestScore = Infinity;
    for (const x of list) {
      const score = Math.abs(x.m / x.n - want) + rng() * 0.35;
      if (score < bestScore) { bestScore = score; best = x; }
    }
    return best;
  }

  function changeMode(next: Mode, seconds: number): void {
    if (blend < 1) modeA = modeB;
    else modeA = modeB;
    modeB = next;
    blend = 0;
    blendRate = 1 / seconds;
    lastModeT = time;
  }

  const lightCol = (pal: StyleContext['palette']): RGB => {
    const h = pal.highlight;
    return [0.75 + 0.25 * h[0], 0.75 + 0.25 * h[1], 0.75 + 0.25 * h[2]];
  };

  return {
    id: 'cymatics',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (e.type === 'drop') {
        const c = DROP_C[0] + Math.floor(rng() * (DROP_C[1] - DROP_C[0] + 1));
        changeMode(pickMode(c), DROP_BLEND_S);
        complexity = c;
        burstNow = 1;
        shockT = 0; shockAmp = 1.4;
        if (ctx.flash.request()) flash = 1;
      } else if (e.type === 'breakdown') {
        changeMode(pickMode(BREAKDOWN_C + (rng() < 0.5 ? 0 : 1)), BLEND_S * 1.5);
        complexity = BREAKDOWN_C;
      } else if (e.type === 'trackChange') {
        changeMode(pickMode(3 + Math.floor(rng() * 3)), BLEND_S);
        needsInit = true;
      }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const es = ctx.eventState;
      const fade = ctx.fadeInOut;
      const f = ctx.frame;
      const c0 = f.spectral.centroid > 1.5 ? f.spectral.centroid / 8000 : f.spectral.centroid;
      centroid += (clamp01(c0) - centroid) * (1 - Math.exp(-dt / 2.5));
      if (blend < 1) blend = Math.min(1, blend + dt * blendRate);

      // Complexity the music asks for; change modes when it has moved, or each phrase.
      const glowK = clamp01(ctx.intensityGlow);
      let target = COMPLEXITY[0] + (COMPLEXITY[1] - COMPLEXITY[0]) * glowK + BUILD_ADD * es.buildProgress;
      // Band balance: bass-heavy music rests on simpler modes, bright music on finer ones.
      target += (ctx.highPresence - ctx.bassPresence) * 2;
      if (es.section === 'breakdown') target = BREAKDOWN_C;
      if (es.section === 'silence') target = 3;
      if (es.section === 'drop' && es.sinceDrop < 8) target = Math.max(target, complexity);
      const since = time - lastModeT;
      if (blend >= 1 && since > MODE_MIN_S && (Math.abs(target - complexity) >= 2 || since > MODE_PHRASE_S) && fade > 0.05) {
        complexity = Math.round(target);
        changeMode(pickMode(complexity), es.section === 'build' ? BLEND_S * 1.3 : BLEND_S);
      }

      // Kicks: throw the sand, a ripple from the centre.
      kickNow = 0;
      if (ctx.bassHits < KICK[0]) kickArmed = true;
      if (kickArmed && ctx.bassHits > KICK[1] && fade > 0.1) {
        kickArmed = false;
        kickNow = ctx.bassHits;
        kickLight = Math.max(kickLight, ctx.bassHits);
        shockT = 0; shockAmp = Math.max(shockAmp * Math.exp(-shockT / SHOCK_TAU), 0.6 + 0.6 * ctx.bassHits);
      }
      shockT += dt;
      flash *= Math.exp(-dt / 0.12);
      kickLight *= Math.exp(-dt / KICK_LIGHT_TAU);
      // Frame-accurate: the bass envelope itself lifts the light on the hit frame.
      kickLight = Math.max(kickLight, ctx.bassHits * fade * 0.8);
      glint = Math.max(glint * Math.exp(-dt / 0.15), ctx.highHits);

      // Plate shape: a disc in breakdowns; the medallion grows with intensity and builds.
      disc += ((es.section === 'breakdown' ? 1 : 0) - disc) * (1 - Math.exp(-dt / 2.5));
      const medWant = es.section === 'breakdown' ? 0.4 : es.section === 'silence' ? 0.1 : 0.14 + 0.16 * glowK + 0.12 * es.buildProgress;
      medal += (medWant - medal) * (1 - Math.exp(-dt / 1.5));
      lightAz += dt * LIGHT_TURN * (1 + ctx.intensitySmoothed);
    },

    render(ctx: StyleContext): void {
      ensureTargets();
      const pal = ctx.palette;
      const es = ctx.eventState;
      const fade = ctx.fadeInOut;
      // The slab widens on landscape screens (a portrait slab in a 16:9 frame leaves too much black).
      const wide = Math.min(1.25, Math.max(0.85, (ctx.width / ctx.height) * 0.62));
      const half: [number, number] = [PLATE[0] * wide + (DISC_R - PLATE[0] * wide) * disc, PLATE[1] + (DISC_R - PLATE[1]) * disc];
      const round = PLATE_ROUND + (DISC_R - PLATE_ROUND) * disc;
      const mA = [modeA.m, modeA.n, modeA.s, 0], mB = [modeB.m, modeB.n, modeB.s, 0];
      const changing = blend < 1 ? 1 : 0;
      const drive = (DRIVE[0] + DRIVE[1] * ctx.intensitySmoothed + DRIVE[2] * changing + DRIVE[3] * es.buildProgress) * (0.3 + 0.7 * fade);

      // 1. Grains.
      gl.disable(gl.BLEND);
      bindTarget(gl, state.write);
      const up = P.update();
      gl.useProgram(up.prog);
      setUniforms(gl, up, {
        u_A: state.read.tex[0], u_B: state.read.tex[1], u_dt: Math.min(ctx.dt, 1 / 30), u_time: time, u_init: needsInit ? 1 : 0,
        u_modeA: mA, u_modeB: mB, u_blend: blend * blend * (3 - 2 * blend), u_drive: drive,
        u_kick: kickNow, u_burst: burstNow, u_half: half, u_round: round,
      });
      drawQuad(gl, quadVAO);
      state.swap();
      needsInit = false;
      burstNow = 0;

      // 2. Splat (mirrored) into the density target.
      bindTarget(gl, raw!);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const sp = P.splat();
      gl.useProgram(sp.prog);
      setUniforms(gl, sp, { u_A: state.read.tex[0], u_B: state.read.tex[1], u_side: side, u_extent: EXTENT, u_point: Math.max(1, raw!.w / 1024) });
      gl.bindVertexArray(emptyVAO);
      gl.drawArrays(gl.POINTS, 0, side * side * 2);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // 3. Blur (two passes) → mipmapped shape density.
      const bl = P.blur();
      gl.useProgram(bl.prog);
      const d = raw!.w;
      bindTarget(gl, blurA!);
      setUniforms(gl, bl, { u_src: raw!.tex[0], u_dir: [2.6 / d, 0], u_res: [d, d] });
      drawQuad(gl, quadVAO);
      bindTarget(gl, blurB!);
      setUniforms(gl, bl, { u_src: blurA!.tex[0], u_dir: [0, 2.6 / d], u_res: [d, d] });
      drawQuad(gl, quadVAO);
      gl.bindTexture(gl.TEXTURE_2D, blurB!.tex[0]);
      gl.generateMipmap(gl.TEXTURE_2D);

      // 4. Edge smoke.
      const sm = smoke!;
      bindTarget(gl, sm.write);
      const sk = P.smoke();
      gl.useProgram(sk.prog);
      setUniforms(gl, sk, {
        u_prev: sm.read.tex[0], u_dens: blurB!.tex[0], u_res: [sm.write.w, sm.write.h], u_dt: Math.min(ctx.dt, 1 / 30), u_time: time,
        u_extent: EXTENT, u_half: half, u_round: round, u_feed: (0.6 + 1.6 * clamp01(ctx.intensityGlow)) * fade,
        u_kick: Math.max(kickNow, 0) * 0.6, u_decay: look === 'liquid' ? 0.97 : 0.988,
      });
      drawQuad(gl, quadVAO);
      sm.swap();

      // 5. Shade.
      ctx.bindScene();
      const sh = P.shade();
      gl.useProgram(sh.prog);
      const cam = ctx.camera;
      const camP: [number, number] = [simplex2(time * 0.021, 1) * 0.12 + Math.sin(cam.lurchAmount * 3) * 0.02, simplex2(time * 0.017, 2) * 0.08];
      const view = 2.25 * cam.viewHeight / (0.85 + 0.45 * 0.5);
      const az = lightAz + simplex2(time * 0.05, 4) * 0.5;
      const L = [Math.cos(LIGHT_EL) * Math.cos(az), Math.cos(LIGHT_EL) * Math.sin(az), Math.sin(LIGHT_EL)];
      const lc = lightCol(pal);
      const lk = (1.1 + 0.4 * clamp01(ctx.intensityGlow)) * (0.45 + 0.55 * fade) * (1 + KICK_LIGHT * kickLight * (look === 'liquid' ? 0.6 : 1));
      const shockA = shockAmp * Math.exp(-shockT / SHOCK_TAU);
      setUniforms(gl, sh, {
        u_dens: blurB!.tex[0], u_raw: raw!.tex[0], u_smoke: sm.read.tex[0],
        u_res: [ctx.width, ctx.height], u_time: time, u_extent: EXTENT,
        u_cam: camP, u_view: view, u_rot: cam.rotation * 0.25,
        u_half: half, u_round: round, u_med: medal, u_med_rings: 3 + Math.round(complexity / 2),
        u_light_dir: L, u_light_col: [lc[0] * lk, lc[1] * lk, lc[2] * lk],
        u_shadow_col: pal.shade, u_amb_col: [pal.secondary[0] * 0.3 + 0.12, pal.secondary[1] * 0.3 + 0.12, pal.secondary[2] * 0.3 + 0.12],
        u_bg: [pal.bg[0] * 0.6, pal.bg[1] * 0.6, pal.bg[2] * 0.6], u_glint_col: [0.7 + 0.3 * pal.highlight[0], 0.7 + 0.3 * pal.highlight[1], 0.7 + 0.3 * pal.highlight[2]].map((x) => x * (0.5 + 1.2 * glint)),
        u_gain: GAIN, u_shock: shockT * SHOCK_SPEED, u_shock_amp: shockA, u_shadow_steps: SHADOW_STEPS[quality.level],
        u_modeA: mA, u_modeB: mB, u_blend: blend * blend * (3 - 2 * blend),
        u_wave: (0.4 + 1.2 * ctx.intensitySmoothed + 0.8 * shockA) * Math.sin(time * (6 + 4 * ctx.intensitySmoothed)),
        u_flash: flash,
      });
      drawQuad(gl, quadVAO);
      const post = ctx.post;
      post.bloom = 0.25;
      post.bloomThreshold = 1.0;
      post.vignette = 0.4;
    },

    setQuality(q: QualityParams): void { quality = q; },
    setVariant(id: string): void { look = id === 'sand' ? 'sand' : id === 'liquid' ? 'liquid' : 'stone'; },
    getVariant: () => look,
    dispose(): void {
      state.dispose(); smoke?.dispose();
      deleteTarget(gl, raw); deleteTarget(gl, blurA); deleteTarget(gl, blurB);
      for (const p of Object.values(progs)) if (p) gl.deleteProgram(p.prog);
      gl.deleteVertexArray(emptyVAO);
    },
  };
}

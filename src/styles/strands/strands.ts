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
  withIncludes, type Program, type Target, type UniformValue,
} from '../shared/gl';

import noiseSrc from '../shared/noise.glsl?raw';
import updateFrag from './shaders/update.frag?raw';
import renderVert from './shaders/render.vert?raw';
import renderFrag from './shaders/render.frag?raw';
import displayFrag from './shaders/display.frag?raw';
import tunnelVert from './shaders/tunnel.vert?raw';
import { HIST, TRAIL_LIFE, TUNNEL_FOG, TUNNEL_PATH, TUNNEL_PATH_Y, TUNNEL_RADIUS, TUNNEL_SPAN, Tunnel, tunnelCentre } from './tunnel';
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
  wisp: { count: 0.1, decay: 0.975, point: 1, gain: 0.02, display: 1.6 },
  warp: { count: 0.06, decay: 0.5, point: 1, gain: 0.75, display: 1 },
};

/** Silk: shockwave speed (world units/s) and lifetime (s). */
const SHOCK_SPEED = 0.9;
const SHOCK_LIFE = 1.1;
/** Silk drop: burst decay (s), formation hold and fade (s). */
const BURST_TAU = 0.45;
const FORM_HOLD = 5;
const FORM_FADE = 2.5;
/** Silk: inversion cut length in beats (drop) and chance on a big hit. */
const CUT_BEATS_DROP = 2;
const CUT_BEATS_HIT = 1;
const CUT_HIT_CHANCE = 0.3;

/** Warp pace (tunnel units/s): cruise from quiet to loud, and the section
 * multipliers that make slow parts drift and builds/drops rush. */
const WARP_CRUISE = [1.6, 15];
const WARP_SECTION: Record<string, number> = { silence: 0.06, intro: 0.8, steady: 1, build: 1, drop: 1.35, breakdown: 0.1 };
/** Slow motion: breakdowns, and intros while still quiet, drift at this pace
 * (streaks shrink to near-hanging stars). Anything louder runs at regular pace. */
const WARP_SLOMO = 0.1;
const WARP_QUIET_INTRO = 0.35;
/** Builds accelerate up to this multiple at full build progress. */
const WARP_BUILD_MAX = 2.6;
/** Drop jump: extra multiple, decay (s). Beat surge: extra fraction, decay (s). */
const WARP_JUMP = 2.2;
const WARP_JUMP_TAU = 1.1;
const WARP_SURGE = 0.18;
const WARP_SURGE_TAU = 0.18;
/** Speed easing (s): accelerate / decelerate. */
const WARP_ACCEL_TAU = 0.45;
const WARP_DECEL_TAU = 0.9;

/** Depth view (Silk / Wisp): the 2D simulation lies on the ground plane of
 * the 3D camera, scaled up (ground units per sim unit), over a region of this
 * many sim units around the point the camera looks at. */
const DEPTH_SCALE: Record<StrandsKind, number> = { silk: 2.4, wisp: 1.3, warp: 1 };
const DEPTH_VIEW = 1.5;
const DEPTH_ASPECT = 1.3;
/** Wisp: screen height whose ground point the flames circle (below the centre = nearer). */
const DEPTH_WISP_SY = -0.3;
/** Height of the silk curtains / wisp flight band: base + share of camera altitude. */
const DEPTH_HSPAN = [0.1, 0.25];
/** Wisp smoke decay per frame in Depth (shorter, so camera motion doesn't smear it). */
const WISP_DEPTH_DECAY = 0.955;
/** Wisp Depth: largest a close flame grows (its brightness is eased as it grows). */
const DEPTH_FLAME_GROW = 1.6;
/** Wisp Depth: smoke tone-map gain (smoke spreads over more screen and fades faster). */
const WISP_DEPTH_SMOKE = 1.8;
/** Wisp Depth Ground: share of particles that float as embers. */
const WISP_EMBERS = 0.14;
/** Wisp Depth Tunnel: accumulation decay (short streaks), share of particles in
 * the walls (the rest are trails), point gain, kick threshold / re-arm. */
const TUNNEL_DECAY = 0.82;
const TUNNEL_WALL_SHARE = 0.6;
const TUNNEL_GAIN = 0.05;
const TUNNEL_WALL_GAIN = 4;
const TUNNEL_KICK = [0.5, 0.3];

interface Shock { x: number; y: number; r: number; s: number; age: number }
interface Agent { x: number; y: number; heading: number; speed: number; turn: number; glow: number }
interface Ring { x: number; y: number; age: number; s: number; h: number }

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
  // Depth view programs (Silk / Wisp), built on first use; the Flat ones stay as they are.
  let pd: { render: Program; display: Program } | null = null;
  const depthPrograms = (): { render: Program; display: Program } => {
    const d = `${def}
#define DEPTH 1`;
    pd ??= {
      render: makeProgram(gl, inc(renderVert), inc(renderFrag), d),
      display: makeProgram(gl, fullscreenVert, inc(displayFrag), d),
    };
    return pd;
  };
  let wasDepth: boolean | null = null;
  // Wisp looks (Depth only): 'ground' or 'tunnel'.
  let variant = kind === 'wisp' ? 'ground' : kind;
  const tunnel = kind === 'wisp' ? new Tunnel(deps.seed) : null;
  let tunnelProg: Program | null = null;
  let histTex: WebGLTexture | null = null;
  let wasTunnel = false;
  let tunnelArmed = true;

  // ── State ─────────────────────────────────────────────────────
  let time = 0;
  let fieldT = rng() * 100;
  let speedEnv = 0.3;
  const shocks: Shock[] = [];
  let bassCooldown = 0;
  let cutUntil = -1;
  let sparkle = 0;
  // Silk beat / drop state
  let burst = 0, formT = 99, formRot = 0;
  // Wisp
  const agents: Agent[] = [0, 1, 2].map((i) => ({
    x: (rng() - 0.5) * 0.6, y: (rng() - 0.5) * 0.4, heading: rng() * 6.28, speed: 0.2, turn: (i % 2 ? 1 : -1) * 1.2, glow: 1,
  }));
  let ring: Ring = { x: 0, y: 0, age: 9, s: 0, h: 0 };
  // Warp
  let warpJump = 0;
  let warpSpeed = 6;
  let warpSurge = 0;
  let warpSection = 1;

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

  const depthOf = (ctx: StyleContext): boolean => ctx.depth && kind !== 'warp';
  const tunnelOn = (ctx: StyleContext): boolean => kind === 'wisp' && variant === 'tunnel' && depthOf(ctx);
  const hspan = (ctx: StyleContext): number => DEPTH_HSPAN[0] + DEPTH_HSPAN[1] * ctx.camera.position[1];
  /** Wisp flame height (matches agentH() in render.vert). */
  const agentH = (ctx: StyleContext, i: number, t: number): number =>
    hspan(ctx) * (0.55 + 0.32 * Math.sin(t * 0.37 + i * 2.1) + 0.13 * Math.sin(t * 1.13 + i * 4.0));
  /** Sim-space point for normalised screen coords: the 2D camera in Flat, the
   * ground under the 3D camera in Depth (emitters and shocks keep to the lower,
   * nearer part of the screen there). */
  const toSim = (ctx: StyleContext, sx: number, sy: number): [number, number] => {
    const cam = ctx.camera;
    if (!depthOf(ctx)) return cam.screenToWorld2D(sx, sy);
    const g = cam.screenToGround(sx * 0.85, -0.3 + sy * 0.45, 4);
    if (g) return [g[0] / DEPTH_SCALE[kind], g[1] / DEPTH_SCALE[kind]];
    const c = depthCenter(ctx, kind);
    return [c[0] + sx * DEPTH_VIEW * 0.4, c[1] + sy * DEPTH_VIEW * 0.3];
  };

  /** Wisp Depth Tunnel: stateless tunnel particles into the accumulation buffer, then flames on top. */
  function renderTunnel(ctx: StyleContext, tn: Tunnel): void {
    const pal = ctx.palette;
    const dprog = depthPrograms();
    tunnelProg ??= makeProgram(gl, inc(tunnelVert), inc(renderFrag), `${def}\n#define TUNNEL 1`);
    if (!histTex) {
      histTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, histTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, HIST, 3, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, histTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HIST, 3, gl.RGBA, gl.FLOAT, tn.hist);

    const count = Math.floor(side * side * cfg.count);
    const flames: number[] = [];
    tn.flames.forEach((f) => flames.push(f.pos[0], f.pos[1], f.pos[2], f.glow * (0.4 + 0.6 * ctx.fadeInOut)));
    const rings: number[] = [];
    for (let i = 0; i < 4; i++) {
      const g = tn.rings[i];
      rings.push(g ? g.s : -1e4, g ? g.str * (1 - g.age / 1.2) : 0, 0, 0);
    }

    bindTarget(gl, accum!);
    gl.enable(gl.BLEND);
    gl.useProgram(fill.prog);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    gl.blendColor(0, 0, 0, Math.pow(TUNNEL_DECAY, ctx.dt * 60));
    setUniforms(gl, fill, { u_color: [0, 0, 0, 0] });
    drawQuad(gl, quadVAO);
    gl.useProgram(tunnelProg.prog);
    gl.blendFunc(gl.ONE, gl.ONE);
    setUniforms(gl, tunnelProg, {
      u_view_proj: tn.viewProj, u_cam_pos: tn.camPos, u_s: tn.s, u_time: tn.time,
      u_wall_count: Math.floor(count * TUNNEL_WALL_SHARE), u_point: Math.max(1, ctx.height / 1080),
      u_gain: TUNNEL_GAIN * (0.5 + 0.5 * ctx.fadeInOut), u_wall_gain: TUNNEL_WALL_GAIN, u_radius: TUNNEL_RADIUS, u_span: TUNNEL_SPAN,
      u_path: TUNNEL_PATH, u_path_y: TUNNEL_PATH_Y, u_fog: TUNNEL_FOG,
      u_wisp_col: [...pal.primary, 1, ...pal.accent, 1, ...pal.highlight, 1, ...mixRgb(pal.highlight, [1, 1, 1], 0.5), 1],
      u_flames: flames, u_rings: rings, u_ring_count: tn.rings.length,
      u_hist: histTex, u_hist_head: tn.histHead, u_hist_len: tn.histLen, u_trail_life: TRAIL_LIFE,
    });
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    // Flames, projected through the tunnel camera.
    ctx.bindScene();
    gl.useProgram(dprog.display.prog);
    const scrAspect = ctx.width / ctx.height;
    const agentUv: number[] = [];
    const agentDir: number[] = [];
    tn.flames.forEach((f, i) => {
      const pr = tn.project(f.pos);
      const ah = tn.project(tn.aheadOf(i));
      const size = 0.012 + 0.006 * f.glow;
      if (!pr) { agentUv.push(-9, -9, 0, size); agentDir.push(1, 0, 0, 0); return; }
      let dx = 0, dy = 1;
      if (ah) {
        dx = (ah.uv[0] - pr.uv[0]) * scrAspect; dy = ah.uv[1] - pr.uv[1];
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      }
      const near = Math.min(1.8, Math.max(0.6, 1.3 / pr.w));
      agentUv.push(pr.uv[0], pr.uv[1], (0.5 + 0.5 * ctx.fadeInOut) * f.glow * 1.3 / Math.max(1, Math.sqrt(near)), size * near);
      agentDir.push(dx, dy, 0.6 * near, 0);
    });
    agentUv.push(0, 0, 0, 0.01); agentDir.push(1, 0, 0, 0);
    const far = tn.project(tunnelCentre(tn.s + 24));
    setUniforms(gl, dprog.display, {
      u_scene: 1, u_vanish: far ? far.uv : [0.5, 0.5], u_horizon: -9,
      u_accum: accum!.tex[0], u_res: [ctx.width, ctx.height], u_time: time,
      u_bg: pal.bg, u_paper: pal.paper, u_c0: pal.primary, u_c1: pal.secondary, u_c2: pal.accent, u_c3: pal.highlight,
      u_light: false, u_gain: cfg.display * WISP_DEPTH_SMOKE, u_fade: ctx.fadeInOut, u_pulse: ctx.bassHits,
      u_agents: agentUv, u_agent_dir: agentDir, u_agent_count: 3,
    });
    drawQuad(gl, quadVAO);
    const post = ctx.post;
    post.bloom = 0.9; post.bloomThreshold = 0.8; post.vignette = 0.45;
  }

  return {
    id: kind,

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (kind === 'silk') {
        if (e.type === 'drop') { cut(ctx, CUT_BEATS_DROP); burst = 1; formT = 0; formRot = rng() * Math.PI; }
        else if (e.type === 'bigHit' && rng() < CUT_HIT_CHANCE) cut(ctx, CUT_BEATS_HIT);
      } else if (kind === 'warp' && e.type === 'drop') {
        warpJump = 1;
      } else if (kind === 'wisp' && e.type === 'drop') {
        agents.forEach((a) => { a.speed += 1.2; a.glow = 2; });
        if (tunnelOn(ctx)) tunnel?.drop();
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
        const q = toSim(ctx, (rng() - 0.5) * 1.4, (rng() - 0.5) * 1.2);
        shocks.push({ x: q[0], y: q[1], r: 0.02, s: 0.6 * ctx.bassHits, age: 0 });
        if (shocks.length > 4) shocks.shift();
        bassCooldown = 0.18;
      }
      if (kind === 'silk') {
        burst *= Math.exp(-dt / BURST_TAU);
        formT += dt;
        formRot += dt * 0.15;
      }
      for (const s of shocks) { s.age += dt; s.r += SHOCK_SPEED * dt; s.s *= Math.exp(-dt / 0.5); }
      while (shocks.length && shocks[0].age > SHOCK_LIFE) shocks.shift();

      // Wisp Tunnel: pace, flames, camera; a ring of light on each kick.
      if (tunnel && tunnelOn(ctx)) {
        tunnel.update(ctx);
        if (ctx.bassHits < TUNNEL_KICK[1]) tunnelArmed = true;
        if (tunnelArmed && ctx.bassHits > TUNNEL_KICK[0] && fade > 0.1) { tunnel.kick(ctx.bassHits); tunnelArmed = false; }
        if (ctx.midHits > 0.6 && rng() < 0.2) tunnel.swerve(Math.floor(rng() * 3), (rng() - 0.5) * 3);
      }

      // Wisp agents.
      if (kind === 'wisp') {
        const depth = depthOf(ctx);
        const home = depth ? depthCenter(ctx, kind) : [0, 0];
        const reach = depth ? DEPTH_VIEW * 0.25 : ctx.camera.viewHeight * 0.45;
        if (wasDepth !== null && wasDepth !== depth) {
          // Entering / leaving Depth: start the flames around the new view.
          agents.forEach((a) => { a.x = home[0] + (rng() - 0.5) * reach; a.y = home[1] + (rng() - 0.5) * reach; });
        }
        agents.forEach((a, i) => {
          a.turn += (simplex2(time * 0.4, i * 13) * 3 - a.turn) * dt * 0.8;
          if (ctx.midHits > 0.6 && rng() < 0.2) a.turn += (rng() - 0.5) * 8;
          const base = 0.12 + 0.45 * ctx.intensitySmoothed;
          a.speed += ((base + ctx.bassHits * 0.6) - a.speed) * (1 - Math.exp(-dt / 0.3));
          a.heading += a.turn * dt;
          // Stay near the view (Wisp's own fixed centre in Flat, see viewOf();
          // the ground ahead of the camera in Depth).
          const dx = home[0] - a.x, dy = home[1] - a.y;
          if (Math.hypot(dx, dy) > reach) {
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
          ring = { x: a.x, y: a.y, age: 0, s: ctx.bassHits, h: agentH(ctx, agents.indexOf(a), time) };
        }
      }

      // Warp speed: intensity and tempo, build accelerates, drop jumps.
      if (kind === 'warp') {
        // Pace follows the song: cruise on the slow intensity follower, section
        // multipliers (silence ≈ still, breakdown drift, drop rush), builds
        // accelerate, the drop jumps, every beat surges a little.
        const bpmFactor = Math.sqrt(Math.max(60, Math.min(200, ctx.frame.beat.bpm || 120)) / 120);
        const section = ctx.eventState.section;
        let sec = WARP_SECTION[section] ?? 1;
        if (section === 'intro' && ctx.intensityGlow < WARP_QUIET_INTRO) sec = WARP_SLOMO;
        const slomo = sec <= WARP_SLOMO + 1e-6;
        warpSection += (sec - warpSection) * (1 - Math.exp(-dt / 0.8));
        warpJump *= Math.exp(-dt / WARP_JUMP_TAU);
        const onBeat = ctx.beatConfidence > 0.3 ? ctx.beatOnset : ctx.bassHits > 0.7;
        warpSurge = Math.max(warpSurge * Math.exp(-dt / WARP_SURGE_TAU), onBeat ? 1 : 0);
        const cruise = WARP_CRUISE[0] + (WARP_CRUISE[1] - WARP_CRUISE[0]) * Math.pow(clamp01(ctx.intensityGlow), 1.3);
        const buildMul = 1 + (WARP_BUILD_MAX - 1) * build * build;
        const warpTarget = cruise * bpmFactor * warpSection * buildMul * (0.15 + 0.85 * fade)
          * (1 + WARP_JUMP * warpJump) * (1 + WARP_SURGE * warpSurge * (0.6 + 0.8 * ctx.responsiveness) * (slomo ? 0.4 : 1));
        const tau = warpTarget > warpSpeed ? WARP_ACCEL_TAU : WARP_DECEL_TAU;
        warpSpeed += (1 - Math.exp(-dt / tau)) * (warpTarget - warpSpeed);
      }
    },

    render(ctx: StyleContext): void {
      resizeState();
      ensureAccum(ctx.width, ctx.height);
      const cam = ctx.camera;
      const pal = ctx.palette;
      const depth = depthOf(ctx);
      if (wasDepth !== null && wasDepth !== depth) needsInit = true;
      wasDepth = depth;
      if (tunnel && tunnelOn(ctx)) {
        if (!wasTunnel) tunnel.reset();
        wasTunnel = true;
        renderTunnel(ctx, tunnel);
        return;
      }
      if (wasTunnel) { wasTunnel = false; needsInit = true; }
      const prog = depth ? { ...p, ...depthPrograms() } : p;
      // The simulated region: the 2D view in Flat, the ground ahead in Depth.
      const view = depth ? DEPTH_VIEW : cam.viewHeight;
      const vw: View = depth ? { center: depthCenter(ctx, kind), rot: 0 } : viewOf(ctx, kind);
      const aspect = depth ? DEPTH_ASPECT : ctx.width / ctx.height;
      const count = Math.floor(side * side * cfg.count);
      const rows = Math.ceil(count / side);
      const presence = Math.max(ctx.midPresence, ctx.bassPresence * 0.8);
      const active = kind === 'warp' ? 1
        : clamp01(0.12 + 0.88 * presence * (0.3 + 0.7 * ctx.fadeInOut) + 0.3 * ctx.intensityGlow);

      // Silk emitters: three segments wandering around the view, or, after a
      // drop, four diameters through the core (an eight-spoke starburst).
      const form = formT < FORM_HOLD ? 1 : Math.max(0, 1 - (formT - FORM_HOLD) / FORM_FADE);
      const core = depth ? vw.center : cam.center;
      const emit: number[] = [];
      let emitCount = 3;
      if (kind === 'silk' && form > 0.3) {
        emitCount = 4;
        for (let i = 0; i < 4; i++) {
          const a = formRot + (i * Math.PI) / 4;
          const L = view * 0.12;
          emit.push(core[0] - Math.cos(a) * L, core[1] - Math.sin(a) * L, core[0] + Math.cos(a) * L, core[1] + Math.sin(a) * L);
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const t = time * (0.05 + i * 0.013) + i * 2.1;
          const a = toSim(ctx, Math.sin(t * 1.3) * 0.9, Math.cos(t * 0.9 + i) * 0.8);
          const b = toSim(ctx, Math.sin(t * 0.7 + 2 + i) * 0.9, Math.cos(t * 1.1 + 1) * 0.8);
          emit.push(a[0], a[1], b[0], b[1]);
        }
        emit.push(0, 0, 0, 0);
      }
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
        u_time: time, u_center: vw.center, u_view: view, u_aspect: aspect,
        u_rot: vw.rot, u_field_t: fieldT, u_active: active,
      };

      // ── 1. Update particles ──
      gl.disable(gl.BLEND);
      bindTarget(gl, state.write);
      gl.viewport(0, 0, side, rows);
      gl.useProgram(prog.update.prog);
      setUniforms(gl, prog.update, {
        ...common,
        u_stateA: state.read.tex[0], u_stateB: state.read.tex[1],
        u_dt: Math.min(ctx.dt, 1 / 30), u_init: needsInit ? 1 : 0, u_intensity: ctx.intensitySmoothed,
        u_fade: ctx.fadeInOut, u_speed: kind === 'warp' ? warpSpeed : 0.5 + speedEnv * 1.3,
        u_field_scale: 1.6, u_emit: emit, u_emit_count: emitCount, u_shock: shockData, u_shock_count: shocks.length,
        u_core: [core[0], core[1]], u_gather: kind === 'silk' ? Math.pow(Math.max(0, (ctx.eventState.buildProgress - 0.3) / 0.7), 2) * ctx.fadeInOut : 0,
        u_burst: burst, u_form: kind === 'silk' ? form : 0,
        u_agents: agentData, u_agent_count: agents.length, u_ring: [ring.x, ring.y, ring.age, ring.s],
        u_embers: depth && kind === 'wisp' ? WISP_EMBERS : 0,
      });
      drawQuad(gl, quadVAO);
      state.swap();
      needsInit = false;

      // ── 2. Accumulate ──
      bindTarget(gl, accum!);
      gl.enable(gl.BLEND);
      gl.useProgram(fill.prog);
      const decay = Math.pow(depth && kind === 'wisp' ? WISP_DEPTH_DECAY : cfg.decay, ctx.dt * 60);
      gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
      gl.blendColor(0, 0, 0, decay);
      setUniforms(gl, fill, { u_color: [0, 0, 0, 0] });
      drawQuad(gl, quadVAO);

      // Wisp Depth Ground: flame world positions (embers glow near them, the ground is lit under them).
      const flameW: number[] = [];
      for (let i = 0; i < 3; i++) {
        const a = agents[i];
        const S = DEPTH_SCALE[kind];
        const wx = a.x * S, wz = a.y * S;
        const dx = wx - cam.position[0], dz = wz - cam.position[2];
        const bright = (0.45 + 0.55 * ctx.fadeInOut) * a.glow * (0.8 + a.speed);
        flameW.push(wx, agentH(ctx, i, time) - cam.curvature * (dx * dx + dz * dz), wz, bright);
      }

      gl.useProgram(prog.render.prog);
      gl.blendFunc(gl.ONE, gl.ONE);
      const depthU: Record<string, UniformValue> = depth ? {
        u_view_proj: cam.viewProj, u_cam_pos: cam.position,
        u_fog: [cam.fogNear, cam.fogFar], u_curve_k: cam.curvature, u_hspan: hspan(ctx), u_ring_h: ring.h,
        u_dscale: DEPTH_SCALE[kind], u_flame_w: flameW,
      } : {};
      setUniforms(gl, prog.render, {
        ...depthU,
        ...common,
        u_stateA: state.read.tex[0], u_stateB: state.read.tex[1], u_side: side,
        u_point: cfg.point * Math.max(1, ctx.height / 1080), u_gain: cfg.gain * (kind === 'silk' ? 0.6 + 0.8 * ctx.fadeInOut
          // Warp: longer streaks at speed cover more screen; keep brightness even.
          : kind === 'warp' ? Math.min(1.5, Math.max(0.4, Math.sqrt(7 / Math.max(warpSpeed, 0.1)))) : 1),
        u_sparkle: sparkle, u_res: [ctx.width, ctx.height],
        u_vp: [simplex2(time * 0.07, 4) * 0.25, simplex2(time * 0.06, 5) * 0.18], u_roll: cam.roll * 3,
        u_streak: 0.02,
        u_c0: pal.primary, u_c1: pal.secondary, u_c2: mixRgb(pal.highlight, [1, 1, 1], 0.6), u_c3: pal.accent,
        u_wisp_col: [...pal.primary, 1, ...pal.accent, 1, ...pal.highlight, 1, ...mixRgb(pal.highlight, [1, 1, 1], 0.5), 1],
      });
      gl.bindVertexArray(emptyVAO);
      if (kind === 'warp') gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      else gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      // ── 3. Display ──
      ctx.bindScene();
      const silkLight = ctx.light !== time < cutUntil; // the cut inverts whatever is current
      gl.useProgram(prog.display.prog);
      const agentUv: number[] = [];
      const agentDir: number[] = [];
      const scrAspect = ctx.width / ctx.height;
      for (let i = 0; i < 4; i++) {
        const a = agents[i];
        const bright = a ? (0.45 + 0.55 * ctx.fadeInOut) * a.glow * (0.8 + a.speed) : 0;
        const size = 0.011 + 0.006 * (a?.glow ?? 1);
        if (!a) { agentUv.push(0, 0, 0, size); agentDir.push(1, 0, 0, 0); continue; }
        if (!depth) {
          const uv = worldToUv(vw, a.x, a.y, view, aspect);
          agentUv.push(uv[0], uv[1], bright, size);
          agentDir.push(Math.cos(a.heading - vw.rot), Math.sin(a.heading - vw.rot), a.speed, 0);
          continue;
        }
        // Depth: project the flame (and a point just ahead of it, for its direction).
        const h = agentH(ctx, i, time);
        const pr = projectGround(ctx, kind, a.x, a.y, h);
        const ahead = projectGround(ctx, kind, a.x + Math.cos(a.heading) * 0.03, a.y + Math.sin(a.heading) * 0.03, h);
        if (!pr) { agentUv.push(-9, -9, 0, size); agentDir.push(1, 0, 0, 0); continue; }
        let dx = 1, dy = 0;
        if (ahead) {
          dx = (ahead.uv[0] - pr.uv[0]) * scrAspect; dy = ahead.uv[1] - pr.uv[1];
          const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        }
        const near = Math.min(DEPTH_FLAME_GROW, Math.max(0.5, 1.4 / pr.w));
        agentUv.push(pr.uv[0], pr.uv[1], bright * pr.fog / Math.max(1, Math.sqrt(near)), size * near);
        agentDir.push(dx, dy, a.speed * near, 0);
      }
      // Depth: screen height of the horizon (ignoring roll) for a faint glow.
      const horizon = 0.5 + 0.5 * Math.tan(-cam.pitch) / Math.tan(cam.fov / 2);
      const groundU: Record<string, UniformValue> = depth ? {
        u_scene: 0, u_cam_pos: cam.position, u_cam_fwd: cam.forward, u_cam_right: cam.right, u_cam_up: cam.up,
        u_tan_half: Math.tan(cam.fov / 2), u_curve_k: cam.curvature, u_fog: [cam.fogNear, cam.fogFar], u_flame_w: flameW,
      } : {};
      setUniforms(gl, prog.display, {
        ...groundU,
        u_horizon: horizon,
        u_accum: accum!.tex[0], u_res: [ctx.width, ctx.height], u_time: time,
        u_bg: pal.bg, u_paper: pal.paper, u_c0: pal.primary, u_c1: pal.secondary, u_c2: pal.accent, u_c3: pal.highlight,
        u_light: kind === 'silk' ? silkLight : false, u_gain: cfg.display * (depth && kind === 'wisp' ? WISP_DEPTH_SMOKE : 1), u_fade: ctx.fadeInOut,
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

    setVariant(id: string): void {
      if (kind === 'wisp') variant = id === 'tunnel' ? 'tunnel' : 'ground';
    },

    getVariant(): string {
      return variant;
    },

    dispose(): void {
      state.dispose();
      deleteTarget(gl, accum);
      gl.deleteProgram(p.update.prog);
      gl.deleteProgram(p.render.prog);
      gl.deleteProgram(p.display.prog);
      if (pd) { gl.deleteProgram(pd.render.prog); gl.deleteProgram(pd.display.prog); }
      if (tunnelProg) gl.deleteProgram(tunnelProg.prog);
      if (histTex) gl.deleteTexture(histTex);
      gl.deleteProgram(fill.prog);
      gl.deleteVertexArray(emptyVAO);
    },
  };
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

interface View { center: [number, number]; rot: number }

/** Where a style looks. Wisp keeps its own fixed centre and no rotation, so
 * camera drift and dragging never carry its flames off screen (zoom still
 * applies through the camera's view height). The others follow the camera. */
function viewOf(ctx: StyleContext, kind: StrandsKind): View {
  const cam = ctx.camera;
  return kind === 'wisp' ? { center: [0, 0], rot: 0 } : { center: [cam.center[0], cam.center[1]], rot: cam.rotation };
}

function worldToUv(vw: View, x: number, y: number, view: number, aspect: number): [number, number] {
  const dx = x - vw.center[0], dy = y - vw.center[1];
  const c = Math.cos(-vw.rot), s = Math.sin(-vw.rot);
  const rx = dx * c - dy * s, ry = dx * s + dy * c;
  return [0.5 + rx / (view * aspect), 0.5 + ry / view];
}

/** Ground point (sim units) the Depth view centres its simulation on: just
 * ahead of where the 3D camera looks. */
function depthCenter(ctx: StyleContext, kind: StrandsKind): [number, number] {
  const cam = ctx.camera;
  // Wisp keeps its flames nearer, in the middle of the picture.
  const g = cam.screenToGround(0, kind === 'wisp' ? DEPTH_WISP_SY : 0.1, 3);
  if (g) return [g[0] / DEPTH_SCALE[kind], g[1] / DEPTH_SCALE[kind]];
  const fx = cam.forward[0], fz = cam.forward[2];
  const l = Math.hypot(fx, fz) || 1;
  return [(cam.position[0] + (fx / l) * 1.6) / DEPTH_SCALE[kind], (cam.position[2] + (fz / l) * 1.6) / DEPTH_SCALE[kind]];
}

/** Project a sim-space point at height h (Depth view) to screen uv, with clip w
 * and fog visibility; null behind the camera. Mirrors worldAt()/project() in render.vert. */
function projectGround(ctx: StyleContext, kind: StrandsKind, sx: number, sy: number, h: number): { uv: [number, number]; w: number; fog: number } | null {
  const cam = ctx.camera;
  const x = sx * DEPTH_SCALE[kind], z = sy * DEPTH_SCALE[kind];
  const dx = x - cam.position[0], dz = z - cam.position[2];
  const y = h - cam.curvature * (dx * dx + dz * dz);
  const m = cam.viewProj;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw < 0.02) return null;
  const d = Math.hypot(dx, y - cam.position[1], dz);
  const fog = 1 - smoothstep(cam.fogNear, cam.fogFar, d);
  return { uv: [0.5 + 0.5 * cx / cw, 0.5 + 0.5 * cy / cw], w: cw, fog };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

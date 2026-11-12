/**
 * Ink (formerly Flow Ink) — the flagship style. Looks: Glow, Marble, Sumi.
 *
 * A stable-fluids ink simulation on a periodic domain several screens wide.
 * The world camera drifts across it (Flat) or glides low over it as a
 * displaced, lit surface with fog (Depth, default).
 *
 * Signal mapping (DOCS/16 §5, tuned with the verify harness):
 *   mid presence  → ink inflow from emitters around the view
 *   intensity     → turbulence (stirring + vorticity) and camera speed
 *   bass hits     → big splats from varied positions incl. off-screen; surface lift
 *   high hits     → fine sparkle dye
 *   beat phase    → gentle surface breathing (Depth)
 *   drop          → burst converging from off-screen + camera lurch + flash
 *   build         → rising turbulence and sparkle
 *   silence       → ink settles and dissipates, camera slows
 *
 * Variants: Ink (luminous palette ink), Sumi (black ink on bone, ref07),
 * Marble (duotone marbling with stipple grain, ref04). All honour the colour
 * system, Auto Drift and the Light/Dark toggle.
 */

import { buildProgram } from '../../engine/gl-utils';
import { clamp01, createRng, smoothstep } from '../../engine/math';
import type { SonoraEvent } from '../../engine/events';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { FluidSim, type FluidParams, type Splat } from './fluid';

import commonSrc from './shaders/common.glsl?raw';
import inkSrc from './shaders/ink.glsl?raw';
import flatFragSrc from './shaders/flat.frag?raw';
import groundVertSrc from './shaders/ground.vert?raw';
import groundFragSrc from './shaders/ground.frag?raw';
import skyFragSrc from './shaders/sky.frag?raw';
import fullscreenVertSrc from '../../engine/shaders/fullscreen.vert?raw';

// ── Tuning ──────────────────────────────────────────────────────
/** World units per periodic domain tile (1 unit = one view height in Flat). */
const DOMAIN = 4.0;
/** Depth view: ground grid size (world units) and how far ahead it is centred. */
const GRID_SIZE = 8;
/** Grid centre: where the camera looks at the surface, clamped (world units). */
const GRID_AHEAD_MIN = 0.4;
const GRID_AHEAD_MAX = 2.6;
/** Surface height (world units) from ink, and from bass lift. */
const HEIGHT_SCALE = 0.018;
const LIFT_SCALE = 0.03;
const BREATH_AMOUNT = 0.14;
/** Flat view: world units visible vertically per camera view-height. */
const FLAT_VIEW_SCALE = 1.3;

/** Inflow emitters attached to the view. */
const EMITTERS = 4;
const INFLOW_DYE = 1.7;         // dye per second at full mid presence (a drizzle, not a flood)
const INFLOW_RADIUS = 0.0045;   // uv
const INFLOW_SPEED = 0.16;      // uv/s jet

/** Bass splats. */
const BASS_THRESHOLD = 0.4;
const BASS_COOLDOWN = 0.11;
const BASS_RADIUS = [0.024, 0.045];   // uv range: big enough to read as one splash
const BASS_DYE = 1.0;
/** Energy (fast glow) injected by a bass splat. */
const BASS_ENERGY = 1.0;
/** Beat kick: outward ink push on the frame of the hit (uv/s; radius × splat radius). */
const BASS_KICK_SPEED = 1.1;
const BASS_KICK_RADIUS = 1.9;
/** A second, wider kick inside the view so ink already on screen jumps too. */
const VIEW_KICK_SPEED = 0.55;
const VIEW_KICK_RADIUS = 0.07;
/** Jets per bass splat and their speed (uv/s): jets become vortex pairs. */
const BASS_JETS = 2;
const BASS_JET_SPEED = 0.35;
const BASS_SWIRL = 0.02;
/** Frame-accurate brightening of all ink on bass hits, per variant (ink, sumi, marble). */
/** How much ink brightens (or deepens, on paper) on a hit, per variant. Not
 * scaled by Responsiveness: that drives motion, never brightness. */
const PULSE_GAIN = [0.35, 1.3, 0.28];
/** Black ink on paper reads much heavier than glowing ink: scale Sumi's dye. */
const SUMI_DYE = 0.5;
/** Energy channel decay (1/s): ~150 ms glow. */
const ENERGY_DECAY = 6.5;
/** Sparkle on high hits. */
const HIGH_THRESHOLD = 0.3;
const HIGH_COOLDOWN = 0.045;
const SPARK_RADIUS = [0.0008, 0.0018];
/** Mid accents. */
const MID_THRESHOLD = 0.55;
const MID_COOLDOWN = 0.22;

/** Turbulence: stirring (uv/s²) and vorticity (texel units at 256²). */
const STIR_MIN = 0.02;
const STIR_MAX = 0.09;
const CURL_MIN = 10;
const CURL_MAX = 18;
/** Subtractive decay of faint ink (dye units / s) — keeps negative space. */
const INK_FLOOR_DECAY = 0.04;
/** Dye decay (1/s) for Glow/Sumi while playing (quiet → loud) and silent.
 * Each kick's splash should read on its own and fade in ~1–2 s, as v0.1
 * did, instead of piling up into a field that swallows new hits. */
const INK_DECAY_QUIET = 0.55;
const INK_DECAY_LOUD = 0.48;
const INK_DECAY_SILENT = 1.2;
/** Breakdowns: ink lingers and drifts (calm, not empty), with more inflow. */
const INK_DECAY_BREAKDOWN = 0.18;
const INFLOW_BREAKDOWN = 1.8;
const MARBLE_DECAY = 0.004;

/** Shader variant index per look (Glow was called "ink" before v1.0). */
const VARIANT_INDEX: Record<string, number> = { glow: 0, sumi: 1, marble: 2 };

interface Emitter {
  phase: number;
  speed: number;
  channel: 0 | 1;
  lastX: number;
  lastY: number;
}

function inject(src: string): string {
  return src.replace('//#include common', commonSrc).replace('//#include ink', inkSrc);
}

/** Tileable value-noise fbm (R8, mipmapped) used for pigment / paper grain. */
function createGrainTexture(gl: WebGL2RenderingContext, seed: number): WebGLTexture {
  const N = 256;
  const rng = createRng(seed);
  const lattice = (period: number): Float32Array => {
    const a = new Float32Array(period * period);
    for (let i = 0; i < a.length; i++) a[i] = rng();
    return a;
  };
  const data = new Uint8Array(N * N);
  const octaves = [8, 16, 32, 64, 128].map((p) => ({ p, l: lattice(p) }));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, amp = 0.5, norm = 0;
    for (const { p, l } of octaves) {
      const fx = (x / N) * p, fy = (y / N) * p;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const g = (i: number, j: number): number => l[((j % p) * p) + (i % p)];
      const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * sx;
      const b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * sx;
      v += (a + (b - a) * sy) * amp;
      norm += amp;
      amp *= 0.62;
    }
    data[y * N + x] = Math.round((v / norm) * 255);
  }
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

interface Mesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  res: number;
}

function createGrid(gl: WebGL2RenderingContext, res: number): Mesh {
  const verts = new Float32Array(res * res * 2);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    verts[(j * res + i) * 2] = i / (res - 1);
    verts[(j * res + i) * 2 + 1] = j / (res - 1);
  }
  const idx = new Uint32Array((res - 1) * (res - 1) * 6);
  let k = 0;
  for (let j = 0; j < res - 1; j++) for (let i = 0; i < res - 1; i++) {
    const a = j * res + i, b = a + 1, c = a + res, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, count: idx.length, res };
}

function uniformMap(gl: WebGL2RenderingContext, prog: WebGLProgram): Record<string, WebGLUniformLocation | null> {
  const u: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (info) u[info.name] = gl.getUniformLocation(prog, info.name);
  }
  return u;
}

export function createInkStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0x51f0);
  let quality: QualityParams = deps.quality;

  const sim = new FluidSim(gl, quadVAO, quality.simResolution, quality.dyeResolution, quality.iterations);
  const flatProg = buildProgram(gl, fullscreenVertSrc, inject(flatFragSrc));
  const groundProg = buildProgram(gl, groundVertSrc, inject(groundFragSrc));
  const uFlat = uniformMap(gl, flatProg);
  const uGround = uniformMap(gl, groundProg);
  const skyProg = buildProgram(gl, fullscreenVertSrc, skyFragSrc);
  const uSky = uniformMap(gl, skyProg);
  const grainTex = createGrainTexture(gl, deps.seed);
  let grid = createGrid(gl, quality.meshResolution);

  let variant = 'glow';
  let breakdownEnv = 0;
  let noiseZ = rng() * 100;
  let bassCooldown = 0, highCooldown = 0, midCooldown = 0;
  let inkToggle = 0;
  let time = 0;
  const emitters: Emitter[] = [];
  const resetEmitters = (): void => {
    emitters.length = 0;
    for (let i = 0; i < EMITTERS; i++) {
      emitters.push({ phase: rng() * 100, speed: 0.6 + rng() * 0.8, channel: (i % 2) as 0 | 1, lastX: NaN, lastY: NaN });
    }
  };
  resetEmitters();

  const params: FluidParams = {
    curlStrength: CURL_MIN, damping: 0.3, velocityDissipation: 0.15,
    noiseAmp: STIR_MIN, noisePeriod: 5, noiseZ, noiseDetail: 1,
    dyeDissipation: [INK_DECAY_QUIET, INK_DECAY_QUIET, 1.6, 2.5], dyeFloorDecay: [INK_FLOOR_DECAY, INK_FLOOR_DECAY, 0.05, 0],
  };

  // ── Placement helpers ─────────────────────────────────────────
  /** Domain uv for a normalised screen point (may be off-screen). */
  function screenToUv(ctx: StyleContext, sx: number, sy: number): [number, number] {
    let w: [number, number] | null;
    if (ctx.depth) {
      w = ctx.camera.screenToGround(sx, Math.min(sy, 0.25), 5);
      if (!w) {
        const c = ctx.camera;
        const d = 0.8 + rng() * 2.4;
        const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
        w = [c.position[0] + fx * d + fz * sx * d * 0.7, c.position[2] + fz * d - fx * sx * d * 0.7];
      }
    } else {
      w = ctx.camera.screenToWorld2D(sx, sy);
    }
    return [w[0] / DOMAIN, w[1] / DOMAIN];
  }

  /** Random placement: mostly in view, some at the edges, some off-screen. */
  function randomScreen(): [number, number] {
    const r = rng();
    if (r < 0.8) {
      // In view, biased away from the centre so compositions stay off-axis.
      const x = (rng() < 0.5 ? -1 : 1) * (0.2 + 0.75 * Math.sqrt(rng()));
      return [x, rng() * 1.6 - 0.85];
    }
    const a = rng() * Math.PI * 2;
    const rad = r < 0.85 ? 0.95 + rng() * 0.25 : 1.25 + rng() * 0.35;
    return [Math.cos(a) * rad, Math.sin(a) * rad * 0.8];
  }

  /** Uv-per-second velocities → sim texels per second. */
  const tps = (v: number): number => v * sim.simRes;

  function push(s: Omit<Splat, 'seed'> & { seed?: number }): void {
    const k = variant === 'sumi' ? SUMI_DYE : 1;
    const dye: Splat['dye'] = k === 1 ? s.dye : [s.dye[0] * k, s.dye[1] * k, s.dye[2], s.dye[3]];
    sim.splat({ seed: s.seed ?? rng() * 100, ...s, dye });
  }

  /** Directional velocity jet: in incompressible flow it rolls up into a vortex pair. */
  function jet(x: number, y: number, dirX: number, dirY: number, speed: number, radius: number): void {
    push({ x, y, radius, dye: [0, 0, 0, 0], vx: tps(dirX * speed), vy: tps(dirY * speed), radial: 0, swirl: 0, detail: 0 });
  }

  function bassSplat(ctx: StyleContext, strength: number): void {
    const [sx, sy] = randomScreen();
    const [x, y] = screenToUv(ctx, sx, sy);
    const radius = BASS_RADIUS[0] + (BASS_RADIUS[1] - BASS_RADIUS[0]) * (0.3 + 0.7 * rng()) * (0.6 + 0.4 * strength);
    const ch = (inkToggle++ % 3 === 2) ? 1 : 0;
    const amt = BASS_DYE * (0.6 + 0.6 * strength) * (variant === 'marble' ? 0.3 : 1);
    push({
      x, y, radius,
      dye: [ch === 0 ? amt : amt * 0.12, ch === 1 ? amt : amt * 0.08, 0, BASS_ENERGY * strength],
      vx: 0, vy: 0, radial: 0, swirl: tps(BASS_SWIRL * (rng() < 0.5 ? -1 : 1)), detail: 0.8,
    });
    const snap = 0.45 + 1.1 * ctx.responsiveness;
    sim.kick(x, y, radius * BASS_KICK_RADIUS, BASS_KICK_SPEED * strength * snap);
    // Ink already in view jumps on the same frame.
    const [vx, vy] = screenToUv(ctx, (rng() - 0.5) * 1.2, (rng() - 0.5) * 1.0);
    sim.kick(vx, vy, VIEW_KICK_RADIUS, VIEW_KICK_SPEED * strength * snap);
    // 1–3 jets at irregular angles: symmetric jets read as propellers.
    const jets = 1 + Math.floor(rng() * BASS_JETS);
    let a = rng() * Math.PI * 2;
    for (let i = 0; i < jets; i++) {
      a += 1.2 + rng() * 2.6;
      const off = radius * 0.4;
      jet(x + Math.cos(a) * off, y + Math.sin(a) * off, Math.cos(a), Math.sin(a),
        BASS_JET_SPEED * strength * (0.6 + 0.6 * rng()), radius * 0.55);
    }
  }

  function sparkle(ctx: StyleContext, strength: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const [x, y] = screenToUv(ctx, rng() * 2 - 1, rng() * 1.6 - 0.9);
      push({
        x, y, radius: SPARK_RADIUS[0] + rng() * (SPARK_RADIUS[1] - SPARK_RADIUS[0]),
        dye: [0.05 * strength, 0, 0.5 + 0.7 * strength, 0],
        vx: 0, vy: 0, radial: 0, swirl: 0, detail: 0,
      });
    }
  }

  function dropBurst(ctx: StyleContext, strength: number): void {
    const n = 7;
    const base = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const sx = Math.cos(a) * 1.25, sy = Math.sin(a) * 1.0;
      const [x, y] = screenToUv(ctx, sx, sy);
      const [cx, cy] = screenToUv(ctx, sx * 0.15, sy * 0.15);
      let dx = cx - x, dy = cy - y;
      dx -= Math.round(dx); dy -= Math.round(dy);
      const len = Math.hypot(dx, dy) || 1;
      const amt = (0.9 + 0.6 * strength) * (variant === 'marble' ? 0.35 : 1);
      const radius = 0.03 + rng() * 0.02;
      push({
        x, y, radius,
        dye: [i % 2 === 0 ? amt : amt * 0.15, i % 2 === 1 ? amt : amt * 0.1, 0.25, 1.1],
        vx: 0, vy: 0, radial: 0, swirl: 0, detail: 1,
      });
      jet(x, y, dx / len, dy / len, 1.3 * strength, radius * 0.7);
    }
    sparkle(ctx, 0.8, 24);
  }

  function seedField(ctx: StyleContext | null, marble: boolean): void {
    const count = marble ? 70 : 4;
    for (let i = 0; i < count; i++) {
      const x = ctx ? screenToUv(ctx, rng() * 2 - 1, rng() * 2 - 1)[0] : rng();
      const y = ctx ? screenToUv(ctx, rng() * 2 - 1, rng() * 2 - 1)[1] : rng();
      push({
        x: marble ? rng() : x, y: marble ? rng() : y,
        radius: marble ? 0.08 + rng() * 0.1 : 0.02 + rng() * 0.02,
        dye: marble ? (i % 2 ? [0, 1.6, 0, 0] : [1.6, 0, 0, 0]) : [0.3, 0.1, 0, 0],
        vx: 0, vy: 0, radial: 0, swirl: 0, detail: marble ? 0.3 : 1,
      });
      if (!marble) {
        const a = rng() * Math.PI * 2;
        jet(x, y, Math.cos(a), Math.sin(a), 0.35, 0.012);
      }
    }
  }

  // ── Per-frame mapping ─────────────────────────────────────────
  function emit(ctx: StyleContext, dt: number): void {
    const fade = ctx.fadeInOut;
    const presence = ctx.midPresence;
    const build = ctx.eventState.buildProgress;
    const calm = ctx.eventState.section === 'breakdown' ? 0.55 : 1;
    const rate = presence * fade * (variant === 'marble' ? 0.8 : 1) * (1 + (INFLOW_BREAKDOWN - 1) * breakdownEnv);
    if (rate < 0.01) {
      for (const e of emitters) e.lastX = NaN;
      return;
    }
    for (const e of emitters) {
      e.phase += dt * e.speed * (0.25 + 0.5 * ctx.intensitySmoothed + 0.4 * build) * calm;
      // Lissajous path around the view edge, drifting in and out.
      const p = e.phase;
      const sx = Math.sin(p * 0.73 + e.speed * 3) * 1.05;
      const sy = Math.sin(p * 0.51 + e.speed * 7) * 0.85 - 0.05;
      const [x, y] = screenToUv(ctx, sx, sy);
      // Jet roughly toward the view centre, wobbling.
      const [cx, cy] = screenToUv(ctx, Math.sin(p * 0.37) * 0.9, Math.cos(p * 0.29) * 0.7);
      let dx = cx - x, dy = cy - y;
      dx -= Math.round(dx); dy -= Math.round(dy);
      const len = Math.hypot(dx, dy) || 1;
      const speed = INFLOW_SPEED * (0.5 + 0.8 * ctx.intensitySmoothed + 0.6 * build) * calm;
      const amt = INFLOW_DYE * rate * dt;
      const ch = variant === 'marble' ? ((Math.floor(p * 0.4) % 2) as 0 | 1) : e.channel;
      push({
        x, y, radius: INFLOW_RADIUS * (0.8 + 0.6 * presence),
        dye: [ch === 0 ? amt : amt * 0.08, ch === 1 ? amt : amt * 0.08, 0, 0],
        vx: tps((dx / len) * speed), vy: tps((dy / len) * speed),
        radial: 0, swirl: tps(0.04 * Math.sin(p)), detail: 0.7,
      });
      e.lastX = x; e.lastY = y;
    }
  }

  function mapAudio(ctx: StyleContext): void {
    const dt = ctx.dt;
    const fade = ctx.fadeInOut;
    bassCooldown -= dt; highCooldown -= dt; midCooldown -= dt;
    if (fade < 0.05) return;

    if (ctx.bassHits > BASS_THRESHOLD && bassCooldown <= 0) {
      bassSplat(ctx, clamp01(ctx.bassHits) * fade);
      bassCooldown = BASS_COOLDOWN * (ctx.eventState.section === 'breakdown' ? 2 : 1);
    }
    if (ctx.highHits > HIGH_THRESHOLD && highCooldown <= 0) {
      const n = 2 + Math.round(ctx.highHits * 5 + ctx.eventState.buildProgress * 5);
      sparkle(ctx, ctx.highHits * fade, n);
      highCooldown = HIGH_COOLDOWN;
    }
    if (ctx.midHits > MID_THRESHOLD && midCooldown <= 0) {
      const [sx, sy] = randomScreen();
      const [x, y] = screenToUv(ctx, sx, sy);
      push({
        x, y, radius: 0.016 + rng() * 0.012,
        dye: [0.05, 0.6 * ctx.midHits * fade * (variant === 'marble' ? 0.4 : 1), 0.1, 0.7 * ctx.midHits],
        vx: 0, vy: 0, radial: 0, swirl: 0, detail: 0.8,
      });
      sim.kick(x, y, 0.03, 0.5 * ctx.midHits);
      const a = rng() * Math.PI * 2;
      jet(x, y, Math.cos(a), Math.sin(a), 0.3 * ctx.midHits, 0.008);
      midCooldown = MID_COOLDOWN;
    }
  }

  return {
    id: 'ink',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (e.type === 'drop') dropBurst(ctx, e.strength);
      else if (e.type === 'bigHit') bassSplat(ctx, 1);
      else if (e.type === 'trackChange') { resetEmitters(); noiseZ += 37; }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const fade = ctx.fadeInOut;
      const silence = 1 - fade;
      const build = ctx.eventState.buildProgress;
      const turbulence = clamp01(ctx.intensitySmoothed * 0.85 + build * 0.35 + ctx.eventState.dropEnvelope * 0.4);
      const marble = variant === 'marble';

      noiseZ += dt * (0.05 + 0.18 * turbulence) * (marble ? 0.7 : 1);
      params.noiseZ = noiseZ;
      params.noiseAmp = tps(STIR_MIN + (STIR_MAX - STIR_MIN) * turbulence) * (marble ? 1.2 : 1) * (0.35 + 0.65 * fade);
      // Flat shows the sim at higher magnification; less confinement avoids a crumpled look.
      params.curlStrength = (CURL_MIN + (CURL_MAX - CURL_MIN) * turbulence) * (ctx.depth ? 1 : 0.55);
      params.damping = 0.25 + silence * 1.2;
      params.noisePeriod = marble ? 2 : 4;
      params.noiseDetail = marble ? 0.15 : 0.8;
      params.curlStrength *= marble ? 0.4 : 1;
      const floor = marble ? 0 : INK_FLOOR_DECAY * (1 + 2 * smoothstep(0.3, 1, silence));
      params.dyeFloorDecay[0] = floor;
      params.dyeFloorDecay[1] = floor;
      breakdownEnv += ((ctx.eventState.section === 'breakdown' ? 1 : 0) - breakdownEnv) * (1 - Math.exp(-dt / 1.5));
      let playing = INK_DECAY_QUIET + (INK_DECAY_LOUD - INK_DECAY_QUIET) * clamp01(ctx.intensityGlow * 1.2);
      playing += (INK_DECAY_BREAKDOWN - playing) * breakdownEnv;
      const inkDecay = marble ? MARBLE_DECAY : playing + (INK_DECAY_SILENT - playing) * smoothstep(0.2, 1, silence);
      params.dyeDissipation[0] = inkDecay;
      params.dyeDissipation[1] = inkDecay;
      params.dyeDissipation[2] = 1.4;
      params.dyeDissipation[3] = ENERGY_DECAY;

      emit(ctx, dt);
      mapAudio(ctx);
    },

    render(ctx: StyleContext): void {
      const dt = ctx.dt;
      sim.step(dt, params);
      ctx.bindScene();

      const pal = ctx.palette;
      const light = ctx.light;
      const vIdx = VARIANT_INDEX[variant] ?? 0;
      const inkA = pal.primary;
      const inkB = pal.duotone ? pal.secondary : pal.accent;
      const spark = pal.highlight;
      const fogColor: [number, number, number] = light
        ? [pal.paper[0] * 0.97, pal.paper[1] * 0.97, pal.paper[2] * 0.97]
        : [pal.bg[0] + inkA[0] * 0.045, pal.bg[1] + inkA[1] * 0.045, pal.bg[2] + inkA[2] * 0.045];

      // Post for this frame
      // Beat pulse straight from the bass-hit envelope (instant attack, ~80 ms decay).
      const pulse = clamp01(Math.max(ctx.bassHits, 0.5 * ctx.midHits) * ctx.fadeInOut);
      const post = ctx.post;
      if (light) {
        post.tonemap = 'none';
        post.bloom = 0;
        post.vignette = 0.16;
        post.grain = 0.028;
      } else {
        post.exposure = vIdx === 2 ? 1.0 : 1.05;
        post.bloom = vIdx === 2 ? 0.35 : 0.6;
        post.bloomThreshold = 1.0;
        post.flash = 0.03 * ctx.eventState.dropEnvelope;
      }

      const setCommon = (u: Record<string, WebGLUniformLocation | null>): void => {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.dyeTexture); gl.uniform1i(u.u_dye, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.heightTexture); gl.uniform1i(u.u_height, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, grainTex); gl.uniform1i(u.u_grain, 2);
        gl.uniform1f(u.u_dye_res, sim.dyeRes);
        gl.uniform1f(u.u_sim_res, sim.simRes);
        gl.uniform1f(u.u_domain, DOMAIN);
        gl.uniform3fv(u.u_bg, pal.bg);
        gl.uniform3fv(u.u_paper, pal.paper);
        gl.uniform3fv(u.u_ink_a, inkA);
        gl.uniform3fv(u.u_ink_b, inkB);
        gl.uniform3fv(u.u_spark, spark);
        gl.uniform1i(u.u_variant, vIdx);
        gl.uniform1i(u.u_light, light ? 1 : 0);
        gl.uniform1f(u.u_fade, ctx.fadeInOut);
        gl.uniform1f(u.u_time, time);
        gl.uniform1f(u.u_drop, ctx.eventState.dropEnvelope);
        gl.uniform1f(u.u_sharpen, quality.level === 'low' ? 0.4 : 0.6);
        gl.uniform1f(u.u_glow, 1.0);
        gl.uniform1f(u.u_pulse, pulse);
        gl.uniform1f(u.u_pulse_gain, PULSE_GAIN[vIdx] ?? 0.4);
      };

      if (!ctx.depth) {
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(flatProg);
        setCommon(uFlat);
        gl.uniform2f(uFlat.u_resolution, ctx.width, ctx.height);
        gl.uniform2f(uFlat.u_cam_center, ctx.camera.center[0], ctx.camera.center[1]);
        gl.uniform1f(uFlat.u_cam_view_h, ctx.camera.viewHeight * FLAT_VIEW_SCALE);
        gl.uniform1f(uFlat.u_cam_rot, ctx.camera.rotation);
        gl.bindVertexArray(quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
        gl.activeTexture(gl.TEXTURE0);
        return;
      }

      // ── Depth view ──
      const cam = ctx.camera;
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(skyProg);
      gl.uniform2f(uSky.u_resolution, ctx.width, ctx.height);
      gl.uniform3fv(uSky.u_forward, cam.forward);
      gl.uniform3fv(uSky.u_right, cam.right);
      gl.uniform3fv(uSky.u_up, cam.up);
      gl.uniform1f(uSky.u_tan, Math.tan(cam.fov / 2));
      gl.uniform1f(uSky.u_aspect, cam.aspect);
      const atmo = Math.max(0, cam.curvature) * (light ? 0 : 0.25);
      gl.uniform3fv(uSky.u_horizon, [fogColor[0] + inkA[0] * atmo, fogColor[1] + inkA[1] * atmo, fogColor[2] + inkA[2] * atmo]);
      gl.uniform3fv(uSky.u_zenith, light ? pal.paper : [pal.bg[0] * 0.55, pal.bg[1] * 0.55, pal.bg[2] * 0.55]);
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.useProgram(groundProg);
      setCommon(uGround);

      const spacing = GRID_SIZE / (grid.res - 1);
      const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
      const ahead = Math.min(GRID_AHEAD_MAX, Math.max(GRID_AHEAD_MIN, cam.position[1] / Math.tan(Math.max(0.05, -cam.pitch))));
      const ox = Math.floor((cam.position[0] + fx * ahead - GRID_SIZE / 2) / spacing) * spacing;
      const oz = Math.floor((cam.position[2] + fz * ahead - GRID_SIZE / 2) / spacing) * spacing;
      const breath = (0.5 + 0.5 * Math.cos(ctx.beatPhase * Math.PI * 2)) * ctx.beatConfidence * ctx.fadeInOut;
      const heightScale = HEIGHT_SCALE * (1 + BREATH_AMOUNT * breath) * (marbleFlatten(variant));

      gl.uniformMatrix4fv(uGround.u_view_proj, false, cam.viewProj);
      gl.uniform2f(uGround.u_grid_origin, ox, oz);
      gl.uniform1f(uGround.u_grid_size, GRID_SIZE);
      gl.uniform1f(uGround.u_height_scale, heightScale);
      gl.uniform1f(uGround.u_lift_scale, LIFT_SCALE);
      gl.uniform3f(uGround.u_cam_pos, cam.position[0], cam.position[1], cam.position[2]);
      gl.uniform3f(uGround.u_light_dir, fx * 0.8 + cam.right[0] * 0.3, 0.42, fz * 0.8 + cam.right[2] * 0.3);
      gl.uniform3fv(uGround.u_fog_color, fogColor);
      gl.uniform2f(uGround.u_fog, cam.fogNear, cam.fogFar);
      gl.uniform1f(uGround.u_spec, vIdx === 2 ? 0.12 : light ? 0.05 : 1.0);
      gl.uniform1f(uGround.u_curve_k, cam.curvature);

      gl.bindVertexArray(grid.vao);
      gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0);
    },

    setVariant(id: string): void {
      if (!(id in VARIANT_INDEX) || id === variant) return;
      const wasMarble = variant === 'marble';
      variant = id;
      if (id === 'marble' && !wasMarble) seedField(null, true);
    },

    getVariant: () => variant,

    setQuality(q: QualityParams): void {
      quality = q;
      sim.configure(q.simResolution, q.dyeResolution, q.iterations);
      if (grid.res !== q.meshResolution) {
        gl.deleteVertexArray(grid.vao);
        gl.deleteBuffer(grid.vbo);
        gl.deleteBuffer(grid.ibo);
        grid = createGrid(gl, q.meshResolution);
      }
    },

    dispose(): void {
      sim.dispose();
      gl.deleteProgram(flatProg);
      gl.deleteProgram(groundProg);
      gl.deleteProgram(skyProg);
      gl.deleteTexture(grainTex);
      gl.deleteVertexArray(grid.vao);
      gl.deleteBuffer(grid.vbo);
      gl.deleteBuffer(grid.ibo);
    },
  };
}

/** Marble reads as a flatter, LED-wall surface. */
function marbleFlatten(variant: string): number {
  return variant === 'marble' ? 0.5 : 1;
}

/**
 * Ink (formerly Flow Ink) — the flagship style. Looks: Glow, Marble, Sumi.
 *
 * Motion is v0.1 Flow Ink's (git e094ede), the version that felt synced: the
 * ink is carried by a curl-noise velocity field (no momentum, no pressure, no
 * vorticity), moved with a soft step, and every hit drops a big soft blob of
 * ink that sinks into the sheets. Calm parts stay calm; only big shapes move.
 * The field slowly evolves and jumps to a new pattern on drops and track
 * changes, so it never repeats the way v0.1 did. It runs on a periodic world
 * several screens wide; the camera drifts over it (Flat) or glides low over
 * it as a lit surface (Depth). One v0.1 "screen" = the Flat view height.
 *
 * Signal mapping (v0.1):
 *   bass hits     → a big soft blob near the centre (random spot) with a small
 *                   one-frame outward push; a second can follow 130 ms later
 *   mid hits      → a medium blob anywhere, in the second ink colour
 *   high hits     → a smaller blob anywhere, in the highlight colour
 *   mid presence  → ambient drizzle the flow smears into sheets
 *   intensity     → flow speed (motion) and how long ink lingers (glow follower)
 *   drop          → a new flow pattern and a bigger blob; camera lurch
 *   silence       → ink fades faster, the flow slows
 *
 * Looks only change how the ink is drawn: Glow (luminous palette ink), Marble
 * (duotone marbling with stipple grain, ref04), Sumi (black ink on bone,
 * ref07). No whole-picture beat pulses: the response is the new ink itself.
 */

import { buildProgram } from '../../engine/gl-utils';
import { clamp01, createRng } from '../../engine/math';
import type { SonoraEvent } from '../../engine/events';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { debugFlags, inkExp } from '../../engine/debug-flags';
import { FluidSim, type FlowParams, type Splat } from './fluid';
import { flowVelocity } from './flow-field';

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

/** One v0.1 screen in domain uv (v0.1's sim covered exactly one screen). */
const SCREEN_UV = FLAT_VIEW_SCALE / DOMAIN;
/** Curl field: v0.1 sampled noise at p·1.2 and p·3.5 (p = ±1 across a screen,
 * its square sim stretched over the wide screen) → noise cells across the
 * periodic domain: large layer (x, y), fine layer (x, y). Fewer across x so
 * shapes are wide like v0.1's. */
const FLOW_PERIOD: [number, number, number, number] = [4, 7, 12, 22];
/** Fine-layer weight at full intensity. v0.1 used 0.4 × intensity, but with
 * our periodic noise it combs ink into scalloped fronts and threads (measured
 * and seen), so it is off; the large layer's curls give v0.1's spirals. */
const FLOW_DETAIL = 0;
/** Speed: v0.1's curl × (0.012 + 0.07·intensity) × 30 screens per second, ×2
 * for our gentler noise gradient and v0.1's horizontal stretch; measured
 * against the v0.1 recording (block-matched ink speed 0.41 vs 0.38 screen
 * heights per second). */
const FLOW_SPEED: [number, number] = [0.012 * 30 * 2, 0.07 * 30 * 2];
/** Field drift (large-layer cells per second) and evolution (per second). */
const FLOW_DRIFT: [number, number] = [0.06, 0.045];
const FLOW_EVOLVE = 0.03;
/** A drop or a new track jumps the field to a fresh pattern. */
const FLOW_JUMP = 1.7;
/** v0.1 fade per frame at 60 fps: 0.978 quiet → 0.990 loud; 0.04 more when silent. */
const FADE_PER_FRAME: [number, number] = [0.978, 0.99];
const FADE_SILENT = 0.04;
/** Soft caps (v0.1: density 1.6). */
const DYE_CAP: [number, number, number, number] = [1.6, 1.6, 1.6, 2.0];
/** Dye texture size per quality: v0.1 used 384 texels per screen; the world is
 * ~3 screens wide, so ~1000 keeps v0.1's softness (fine detail is what made
 * round 6 shimmer). */
const FLOW_DYE_RES: Record<QualityParams['level'], number> = { low: 768, medium: 1024, high: 1280 };
/** Soft single-step advection (v0.1) for Glow; Marble and Sumi keep crisp
 * edges (their looks need them) with the same motion. */
const SOFT_ADVECT: Record<string, boolean> = { glow: true, marble: true, sumi: true };
/** Unsharp-mask strength per look (Glow stays soft like v0.1). */
const SHARPEN: Record<string, number> = { glow: 0.1, marble: 0.6, sumi: 0.6 };
/** Paper / pigment grain per look. It is fixed to the world, so it slides as
 * the camera drifts: Glow has none (v0.1 had none; it read as shimmer). */
const GRAIN: Record<string, number> = { glow: 0, marble: 1, sumi: 1 };

/** v0.1 impulses: threshold, cooldown (s), strength (base + per hit), radius
 * (screen fractions, base + per hit), one-frame push (screen units). */
const BASS = { threshold: 0.4, cooldown: 0.13, strength: [0.55, 0.65], radius: [0.13, 0.06], dist: [0.1, 0.18], push: 0.5 };
const MID = { threshold: 0.45, cooldown: 0.1, strength: [0.3, 0.35], radius: [0.08, 0.04], push: 0.2 };
const HIGH = { threshold: 0.4, cooldown: 0.07, strength: [0.2, 0.3], radius: [0.04, 0.02], push: 0.15 };
/** v0.1 drew blobs on a square sim stretched over the wide screen (1.8x wider
 * than tall); our splats are round, so radii are widened to cover the same area. */
const RADIUS_WIDEN = 1.5;
/** No ambient drizzle: v0.1's (mid presence × dots) floods the screen with our
 * analysis, which reports more mid presence than v0.1's did; the blobs alone
 * give v0.1's broad sheets (measured). */
/** Each look's drops (same motion and timing everywhere): radius scale, edge
 * (0 soft gaussian, 1 solid body with a ragged edge) and amount. Glow: v0.1's
 * soft glowing blobs. Sumi: small crisp ink drops (a soft blob's faint skirt
 * greys the whole page on paper, which reads as flicker). Marble: hits mix
 * into the marbled field at full strength (a third was tried in the
 * smoothness fix: no fewer pops, weaker hits); its highlight channel lights
 * the marble in its own colours instead of adding a third colour. */
const DROPS: Record<string, { radius: number; edge: number; amount: number }> = {
  glow: { radius: 1, edge: 0, amount: 1 },
  // edge -1: a solid round drop with a soft rim (see splat.frag)
  sumi: { radius: 0.62, edge: -1, amount: 1.1 },
  marble: { radius: 1, edge: 0, amount: 1 },
};
/** A hit's ink lands over three frames, front-loaded (35% on the frame of
 * the hit): the peak stays early (v0.1 rises over 2-3 frames too) while no
 * single frame jumps the picture by more than the per-hit limit. The drop,
 * often landing on a near-empty screen, builds over six. */
const ATTACK: number[] = [0.35, 0.35, 0.3];
const ATTACK_DROP: number[] = [0.12, 0.16, 0.2, 0.2, 0.18, 0.14];
/** The landing above was counted in frames and tuned at 60 fps; at 165 fps
 * it landed in 18 ms instead of 50 (the "teleport"). It is now a time
 * profile: the same shares at 0, 1/60 and 2/60 s, linear in between, so every
 * frame rate lands a hit in the tuned time (and 60 fps lands exactly as before). */
const LAND_STEP = 1 / 60;
/** New ink enters the flow instead of appearing: each hit starts as a seed
 * (this fraction of its radius) on the frame of the hit and spreads to full
 * size over `time` seconds (ease-out), carried by the flow while it lands; its
 * final shape is exactly the old blob's. Glow spreads in 50 ms so its kicks
 * keep their punch (peak within ~70 ms, as before); the crisp looks, where a
 * blob popping in is most visible, spread over 100 ms (measured: pop score at
 * 165 fps p99 Glow 5.6 → 2.1, Marble 4.0 → 2.5, Sumi 4.8 → 1.8). */
const GROW: Record<string, { seed: number; time: number }> = {
  glow: { seed: 0.45, time: 0.05 },
  marble: { seed: 0.45, time: 0.1 },
  sumi: { seed: 0.45, time: 0.1 },
};
/** The one-frame push lasts one 60 fps frame of time at any frame rate. */
const PUSH_TIME = 1 / 60;
/** One analysis frame of audio (the DSP produces 60 per second). */
const ANALYSIS_DT = 1 / 60;
/** Marble draws a full screen of two-tone marbling (as before round 6): a
 * marbled field seeded across the world that renews slowly (fade, 1/s), with
 * the same motion and hits as Glow mixing into it. */
const MARBLE_FADE = 0.06;
const MARBLE_SEEDS = 70;
/** Marble's beat brightening (its value before round 6). */
const MARBLE_PULSE = 0.28;
/** Black ink on paper reads much heavier than glowing ink: scale Sumi's dye. */
const SUMI_DYE = 0.5;

/** Shader variant index per look (Glow was called "ink" before v1.0). */
const VARIANT_INDEX: Record<string, number> = { glow: 0, sumi: 1, marble: 2 };


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
  let lastDropAt = -99;
  let clock = 0;
  let flowZ = rng() * 50;
  const flowOffset: [number, number] = [rng() * 7, rng() * 7];
  let bassCooldown = 0, highCooldown = 0, midCooldown = 0;
  let time = 0;
  let dyeLevel: QualityParams['level'] = quality.level;
  sim.configure(quality.simResolution, FLOW_DYE_RES[dyeLevel], quality.iterations);

  const params: FlowParams = {
    period: FLOW_PERIOD, detail: 0, offset: flowOffset, z: flowZ, speed: 0,
    dyeDissipation: [1, 1, 1.4, 6], dyeFloorDecay: [0.01, 0.01, 0.02, 0],
    drizzle: [0, 0, 1], cap: DYE_CAP, soft: true, fixedStep: 0,
  };
  /** Fixed-step advection: steps the sim runs this frame (-1 = per-frame mode). */
  let stepsNow = -1;
  /** Hits from events (drop, big hit), landed in update(). */
  const eventHits: { scale: number; attack: number[] }[] = [];

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

  /** Uv-per-second velocities → sim texels per second. */
  const tps = (v: number): number => v * sim.simRes;
  /** v0.1 flow speed (screens per second per unit curl) right now. */
  const flowSpeed = (ctx: StyleContext): number => FLOW_SPEED[0] + FLOW_SPEED[1] * clamp01(ctx.intensitySmoothed);

  function push(s: Omit<Splat, 'seed'> & { seed?: number }): void {
    const k = variant === 'sumi' ? SUMI_DYE : 1;
    const dye: Splat['dye'] = k === 1 ? s.dye : [s.dye[0] * k, s.dye[1] * k, s.dye[2] * k, s.dye[3]];
    sim.splat({ seed: s.seed ?? rng() * 100, ...s, dye });
  }

  /** Screen point for the current view (Depth keeps blobs on the ground in view). */
  function toView(ctx: StyleContext, sx: number, sy: number): [number, number] {
    return ctx.depth ? [sx * 0.85, -0.1 + sy * 0.32] : [sx, sy];
  }

  /**
   * One v0.1 impulse: a soft gaussian blob of ink (screen-fraction radius) at
   * normalised screen point (sx, sy), with a small push for this frame only.
   */
  function blob(ctx: StyleContext, sx: number, sy: number, channel: 0 | 1 | 2, strength: number, radius: number, pushX: number, pushY: number, attack = ATTACK): void {
    const [vx, vy] = toView(ctx, sx, sy);
    let [x, y] = screenToUv(ctx, vx, vy);
    if (stepsNow >= 0 && sim.warpTime > 0) {
      // The display shows the ink `warpTime` along the flow: land where it will be seen.
      flowVelocity(x, y, params, flowOut);
      x -= flowOut[0] * sim.warpTime;
      y -= flowOut[1] * sim.warpTime;
    }
    const look = DROPS[variant] ?? DROPS.glow;
    const dye: Splat['dye'] = [0, 0, 0, 0];
    dye[channel] = strength * look.amount;
    const v = flowSpeed(ctx) * SCREEN_UV * 1.2 * strength;   // v0.1: kick × falloff × strength × 1.2, × speed
    const seed = rng() * 100;
    const r = radius * SCREEN_UV * RADIUS_WIDEN * look.radius;
    if (!debugFlags.inkLegacy) {
      // Lands over time (see LAND_STEP / GROW_*), starting on this frame.
      const cum: number[] = [];
      attack.reduce((s, w) => { cum.push(s + w); return s + w; }, 0);
      const ld: Landing = { x, y, radius: r, dye, detail: look.edge, seed, age: 0, cum, m: 0, r: 0,
        pvx: tps(pushX * v), pvy: tps(pushY * v), fresh: true, pushed: false };
      landings.push(ld);
      land(ld, ctx.dt);
      return;
    }
    const part = (k: number): Splat['dye'] => [dye[0] * attack[k], dye[1] * attack[k], dye[2] * attack[k], 0];
    // The push and the first share land on the frame of the hit; the rest follows.
    push({ x, y, radius: r, dye: part(0), vx: tps(pushX * v), vy: tps(pushY * v), radial: 0, swirl: 0, detail: look.edge, seed });
    pending.push({ x, y, radius: r, dye, detail: look.edge, seed, step: 1, attack });
  }

  // ── Landing over time (fixed behaviour) ───────────────────────
  /** A hit still landing: `cum` = cumulative shares at 0, 1/60, 2/60 … s;
   * `m` / `r` = the amount and radius already deposited; push in sim texels/s. */
  interface Landing { x: number; y: number; radius: number; dye: Splat['dye']; detail: number; seed: number; age: number; cum: number[]; m: number; r: number; pvx: number; pvy: number; fresh: boolean; pushed: boolean }
  const landings: Landing[] = [];
  const flowOut: [number, number] = [0, 0];
  const growSeed = (): number => inkExp('growSeed', (GROW[variant] ?? GROW.glow).seed);
  const growTime = (): number => inkExp('growTime', (GROW[variant] ?? GROW.glow).time);

  /** Share of a hit landed by `age` seconds (linear between the 60 fps steps). */
  function landedShare(cum: number[], age: number): number {
    const f = age / LAND_STEP;
    const i = Math.floor(f + 1e-6);
    if (i >= cum.length - 1) return 1;
    const t = Math.max(0, f - i);
    return cum[i] + (cum[i + 1] - cum[i]) * t;
  }

  /** Radius scale at `age`: from the seed to full size, ease-out. */
  function grownRadius(age: number): number {
    const T = growTime();
    if (T <= 0) return 1;
    const u = Math.min(1, age / T);
    const s = growSeed();
    return s + (1 - s) * (1 - (1 - u) * (1 - u));
  }

  /**
   * Deposit what this landing should hold now. The ink on screen is always one
   * blob of the current radius and amount: each frame adds the difference
   * between this stage and the previous one, so it spreads outward rather than
   * fading in, and its final shape is the old blob's. Then carry it (and the
   * push) with the flow, as the GPU carries the ink already deposited.
   */
  function land(q: Landing, dt: number): void {
    const m = landedShare(q.cum, q.age);
    const r = q.radius * grownRadius(q.age);
    const d = q.dye;
    const k = variant === 'sumi' ? SUMI_DYE : 1;
    if (m > q.m + 1e-6 || r > q.r + 1e-9) {
      // One additive splat: this stage minus the previous one (never negative).
      sim.splat({ x: q.x, y: q.y, radius: r, dye: [d[0] * m * k, d[1] * m * k, d[2] * m * k, 0], vx: 0, vy: 0, radial: 0, swirl: 0,
        detail: q.detail, seed: q.seed, prev: q.m > 0 ? { radius: q.r / r, amount: q.m / m } : undefined });
      q.m = m;
      q.r = r;
    }
    // Push: the old one-frame push, lasting one 60 fps frame of time. With
    // fixed-step advection it rides the first step after the hit (exactly as at 60 fps).
    let w: number;
    let sdt: number;
    if (stepsNow >= 0) {
      w = stepsNow > 0 && !q.pushed ? 1 / stepsNow : 0;
      if (w > 0) q.pushed = true;
      sdt = (params.fixedStep ?? 0) * stepsNow;
    } else {
      w = Math.max(0, Math.min(q.age + dt, PUSH_TIME) - q.age) / Math.max(dt, 1e-6);
      sdt = Math.min(dt, 1 / 30);
    }
    if (w > 0 && (q.pvx !== 0 || q.pvy !== 0)) {
      sim.splat({ x: q.x, y: q.y, radius: q.radius, dye: [0, 0, 0, 0], vx: q.pvx * w, vy: q.pvy * w, radial: 0, swirl: 0, detail: 0, seed: q.seed });
    }
    // Carry the landing point as the GPU carries the ink already deposited.
    flowVelocity(q.x, q.y, params, flowOut);
    q.x += (flowOut[0] + (q.pvx * w) / sim.simRes) * sdt;
    q.y += (flowOut[1] + (q.pvy * w) / sim.simRes) * sdt;
    q.age += dt;
  }

  function landAll(dt: number): void {
    for (let i = landings.length - 1; i >= 0; i--) {
      const q = landings[i];
      // Landed already this frame (a hit from onEvent, before update).
      if (q.fresh) { q.fresh = false; continue; }
      land(q, dt);
      if (q.m >= 1 - 1e-6 && q.age >= growTime() && q.age >= PUSH_TIME && (stepsNow < 0 || q.pushed)) landings.splice(i, 1);
    }
  }

  function bassBlob(ctx: StyleContext, hit: number, scale = 1, attack = ATTACK): void {
    // Near (not at) the centre, at a random angle, pushed outward.
    const a = rng() * Math.PI * 2, d = BASS.dist[0] + rng() * BASS.dist[1];
    blob(ctx, Math.cos(a) * d * 2, Math.sin(a) * d * 2, 0,
      (BASS.strength[0] + BASS.strength[1] * hit) * scale, (BASS.radius[0] + BASS.radius[1] * hit) * scale,
      Math.cos(a) * BASS.push, Math.sin(a) * BASS.push, attack);
  }

  /** Marble's field: big patches of both colours across the whole world. */
  function seedMarble(): void {
    for (let i = 0; i < MARBLE_SEEDS; i++) {
      push({
        x: rng(), y: rng(), radius: 0.08 + rng() * 0.1,
        dye: i % 2 ? [0, 1.6, 0, 0] : [1.6, 0, 0, 0],
        vx: 0, vy: 0, radial: 0, swirl: 0, detail: 0.3,
      });
    }
  }

  /** The rest of each hit's ink, landing over the next frames. */
  interface Pending { x: number; y: number; radius: number; dye: Splat['dye']; detail: number; seed: number; step: number; attack: number[] }
  const pending: Pending[] = [];
  function landPending(): void {
    for (let i = pending.length - 1; i >= 0; i--) {
      const q = pending[i];
      const w = q.attack[q.step];
      push({ x: q.x, y: q.y, radius: q.radius, dye: [q.dye[0] * w, q.dye[1] * w, q.dye[2] * w, 0], vx: 0, vy: 0, radial: 0, swirl: 0, detail: q.detail, seed: q.seed });
      if (++q.step >= q.attack.length) pending.splice(i, 1);
    }
  }

  // ── Per-frame mapping (v0.1) ──────────────────────────────────
  function mapAudio(ctx: StyleContext, dt: number): void {
    if (inkExp('noHits', 0) > 0) return;
    const fade = ctx.fadeInOut;
    bassCooldown -= dt; highCooldown -= dt; midCooldown -= dt;
    if (fade <= 0.1) return;
    if (ctx.bassHits > BASS.threshold && bassCooldown <= 0) {
      bassBlob(ctx, ctx.bassHits);
      bassCooldown = BASS.cooldown;
    }
    if (ctx.midHits > MID.threshold && midCooldown <= 0) {
      blob(ctx, rng() * 2 - 1, rng() * 2 - 1, 1, MID.strength[0] + MID.strength[1] * ctx.midHits,
        MID.radius[0] + MID.radius[1] * ctx.midHits, (rng() - 0.5) * 2 * MID.push, (rng() - 0.5) * 2 * MID.push);
      midCooldown = MID.cooldown;
    }
    if (ctx.highHits > HIGH.threshold && highCooldown <= 0) {
      blob(ctx, rng() * 2 - 1, rng() * 2 - 1, 2, HIGH.strength[0] + HIGH.strength[1] * ctx.highHits,
        HIGH.radius[0] + HIGH.radius[1] * ctx.highHits, (rng() - 0.5) * 2 * HIGH.push, (rng() - 0.5) * 2 * HIGH.push);
      highCooldown = HIGH.cooldown;
    }
  }

  return {
    id: 'ink',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      // Event hits land in update() (after this frame's advection steps are
      // planned), on this same frame; the previous behaviour landed them here.
      const hit = (scale: number, attack: number[]): void => {
        if (debugFlags.inkLegacy) bassBlob(ctx, 1, scale, attack);
        else eventHits.push({ scale, attack });
      };
      if (e.type === 'drop') {
        flowZ += FLOW_JUMP;
        hit(1.15, ATTACK_DROP);
        lastDropAt = clock;
      } else if (e.type === 'bigHit' && clock - lastDropAt > 1.5) {
        hit(1, ATTACK);
      } else if (e.type === 'trackChange') {
        flowZ += FLOW_JUMP;
      }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      clock += dt;
      const fade = ctx.fadeInOut;

      // The v0.1 field: drifts and slowly evolves (never repeats).
      flowOffset[0] += FLOW_DRIFT[0] * dt;
      flowOffset[1] += FLOW_DRIFT[1] * dt;
      flowZ += FLOW_EVOLVE * dt;
      params.offset = flowOffset;
      params.z = flowZ;
      params.detail = FLOW_DETAIL * clamp01(ctx.intensitySmoothed);
      params.speed = flowSpeed(ctx) * SCREEN_UV;
      params.soft = (SOFT_ADVECT[variant] ?? true) && inkExp('soft', 1) > 0;
      const wantDye = Math.round(FLOW_DYE_RES[dyeLevel] * inkExp('dyeScale', 1));
      if (wantDye !== sim.dyeRes) sim.configure(quality.simResolution, wantDye, quality.iterations);

      // v0.1 fade: longer when loud (glow follower), extra when silent.
      const perFrame = FADE_PER_FRAME[0] + (FADE_PER_FRAME[1] - FADE_PER_FRAME[0]) * clamp01(ctx.intensityGlow);
      const eff = Math.max(0.5, perFrame - FADE_SILENT * (1 - fade));
      const rate = -Math.log(eff) * 60;
      const marble = variant === 'marble';
      params.dyeDissipation[0] = marble ? MARBLE_FADE : rate;
      params.dyeDissipation[1] = marble ? MARBLE_FADE : rate;
      params.dyeDissipation[2] = rate * 1.3;
      params.dyeFloorDecay[0] = marble ? 0 : 0.01 + 0.04 * (1 - fade);
      params.dyeFloorDecay[1] = params.dyeFloorDecay[0];

      // The soft step resamples the ink (bilinear) every time it runs, which
      // blurs it a little: run once per rendered frame, 165 fps blurred it
      // ~2x as much per second as the tuned 60 fps (softer, dimmer hits). It
      // runs at the tuned 60 Hz; the display samples the ink along the flow in
      // between, so motion stays smooth at any refresh.
      params.fixedStep = !debugFlags.inkLegacy && inkExp('fixedStep', 1) > 0 ? LAND_STEP : 0;
      stepsNow = params.fixedStep ? sim.planSteps(dt, params.fixedStep) : -1;
      if (debugFlags.inkLegacy) { landings.length = 0; landPending(); }
      else {
        landAll(dt);
        pending.length = 0;
        if (inkExp('noHits', 0) === 0) for (const h of eventHits) bassBlob(ctx, 1, h.scale, h.attack);
        eventHits.length = 0;
      }
      // Hits are decided per analysis frame (60 per second of audio), not per
      // rendered frame: the same hits, at the same moments, at any refresh.
      if (debugFlags.inkLegacy) mapAudio(ctx, ctx.dt);
      else if (ctx.analysisFrames > 0) mapAudio(ctx, ctx.analysisFrames * ANALYSIS_DT);
      for (const q of landings) q.fresh = false;
    },

    render(ctx: StyleContext): void {
      const dt = ctx.dt;
      sim.stepFlow(dt, params);
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
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sim.velocityTexture); gl.uniform1i(u.u_vel, 3);
        gl.uniform1f(u.u_warp, stepsNow >= 0 ? sim.warpTime : 0);
        gl.uniform4fv(u.u_warp_diss, params.dyeDissipation);
        gl.uniform4fv(u.u_warp_floor, params.dyeFloorDecay);
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
        gl.uniform1f(u.u_sharpen, (SHARPEN[variant] ?? 0.4) * (quality.level === 'low' ? 0.7 : 1) * inkExp('sharpen', 1));
        const legacy = debugFlags.inkLegacy;
        gl.uniform1i(u.u_height_cubic, inkExp('heightCubic', 0));
        gl.uniform1i(u.u_marble_spark, inkExp('marbleSpark', legacy ? 0 : 1));
        gl.uniform1i(u.u_dye_filter, inkExp('dyeFilter', 0));
        gl.uniform1f(u.u_dither, inkExp('dither', 1));
        gl.uniform1f(u.u_veins, inkExp('veins', 1));
        gl.uniform1f(u.u_vein_aa, inkExp('veinAA', legacy ? 0 : 1));
        gl.uniform1f(u.u_stip_aa, inkExp('stipAA', 0));
        gl.uniform1f(u.u_glow, 1.0);
        // Marble keeps its gentle beat brightening from before round 6 (a dark
        // look: its hits land on ink that is already there). Glow and Sumi
        // answer with the new ink only: a whole-page pulse on paper reads as
        // flicker.
        gl.uniform1f(u.u_pulse, variant === 'marble' ? clamp01(ctx.bassHits * ctx.fadeInOut) : 0);
        gl.uniform1f(u.u_pulse_gain, variant === 'marble' ? MARBLE_PULSE : 0);
        gl.uniform1f(u.u_grain_amt, (GRAIN[variant] ?? 1) * inkExp('grain', 1));
        gl.uniform1i(u.u_linear, variant === 'glow' ? 1 : 0);
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
      // Looks share the same motion and hits; Marble adds its marbled field.
      if (!(id in VARIANT_INDEX) || id === variant) return;
      variant = id;
      if (id === 'marble') seedMarble();
    },

    getVariant: () => variant,

    setQuality(q: QualityParams): void {
      quality = q;
      dyeLevel = q.level;
      sim.configure(q.simResolution, FLOW_DYE_RES[dyeLevel], q.iterations);
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

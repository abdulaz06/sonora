/**
 * Wisp Depth "Tunnel": the chase camera and flames racing down an endless,
 * winding tunnel (drawn by shaders/tunnel.vert). The tunnel has its own
 * camera; the world camera's presets don't apply here.
 *
 *   pace     follows the song like Warp: slow intensity → cruise, builds
 *            accelerate, the drop bursts forward, breakdowns drift
 *   beats    a ring of light races down the walls from the lead flame; the
 *            flames flare; the camera sways (roll) on each beat
 *   mids     a flame swerves
 */
import { clamp01, lookAt, mat4, multiply, perspective, type Mat4, type Vec3 } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { StyleContext } from '../visual-style';

// ── Tuning ──────────────────────────────────────────────────────
export const TUNNEL_RADIUS = 1.0;
/** Tunnel length kept ahead of the camera (world units). */
export const TUNNEL_SPAN = 36;
/** Centre line bends: x = a sin(s f) + b sin(s g + 1.3), y = a sin(s f + 0.7). */
export const TUNNEL_PATH: [number, number, number, number] = [2.4, 0.11, 1.5, 0.047];
export const TUNNEL_PATH_Y: [number, number] = [1.4, 0.083];
export const TUNNEL_FOG: [number, number] = [4, 30];
/** Seconds a trail particle lives. */
export const TRAIL_LIFE = 3.2;
/** Flame history: samples at 60 Hz (matches tunnel.vert). */
export const HIST = 256;
const HIST_HZ = 60;
/** Pace (units/s): cruise from quiet to loud; section multipliers; build and drop. */
const CRUISE: [number, number] = [1.4, 6.5];
const SECTION: Record<string, number> = { silence: 0.2, intro: 0.75, steady: 1, build: 1, drop: 1.25, breakdown: 0.4 };
const BUILD_MAX = 2.0;
const JUMP = 1.6;
const JUMP_TAU = 1.3;
const ACCEL_TAU = 0.5;
const DECEL_TAU = 1.0;
/** Flames ride this far ahead of the camera, spread across the tunnel. */
const AHEAD = 1.15;
const SPREAD = 0.42;
/** Camera: field of view, how much it banks into bends, beat roll sway. */
const FOV = (74 * Math.PI) / 180;
const BANK = 7;
const SWAY = 0.07;
const SWAY_TAU = 0.35;
/** Beat rings: speed down the tunnel (units/s, on top of the camera), life (s). */
const RING_SPEED = 6;
const RING_LIFE = 1.2;
const MAX_RINGS = 4;
/** How much the flames flare on a kick. */
const RING_FLARE = 0.3;

export function tunnelCentre(s: number): Vec3 {
  const [a, f, b, g] = TUNNEL_PATH;
  return [a * Math.sin(s * f) + b * Math.sin(s * g + 1.3), TUNNEL_PATH_Y[0] * Math.sin(s * TUNNEL_PATH_Y[1] + 0.7), -s];
}

interface Flame { ahead: number; ox: number; oy: number; glow: number; swerve: number; pos: Vec3 }
interface Ring { s: number; str: number; age: number }

export class Tunnel {
  s = 0;
  time = 0;
  readonly view: Mat4 = mat4();
  readonly proj: Mat4 = mat4();
  readonly viewProj: Mat4 = mat4();
  camPos: Vec3 = [0, 0, 0];
  readonly flames: Flame[] = [0, 1, 2].map(() => ({ ahead: AHEAD, ox: 0, oy: 0, glow: 1, swerve: 0, pos: [0, 0, 0] as Vec3 }));
  readonly rings: Ring[] = [];
  readonly hist = new Float32Array(HIST * 3 * 4);
  histHead = 0;
  histLen = 0;
  private histAcc = 0;
  private speed = 2;
  private jump = 0;
  private section = 1;
  private sway = 0;
  private swaySide = 1;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed % 100;
    this.s = this.seed * 3;
  }

  /** Clear the trail history (e.g. when the tunnel is entered again). */
  reset(): void {
    this.histLen = 0;
    this.rings.length = 0;
  }

  kick(strength: number): void {
    const lead = this.flames.reduce((a, f) => (f.ahead > a.ahead ? f : a));
    this.rings.push({ s: this.s + lead.ahead, str: clamp01(strength), age: 0 });
    while (this.rings.length > MAX_RINGS) this.rings.shift();
    for (const f of this.flames) f.glow = Math.max(f.glow, 1 + RING_FLARE * strength);
    this.swaySide = -this.swaySide;
    this.sway = SWAY * this.swaySide * (0.5 + 0.5 * strength);
  }

  swerve(i: number, amount: number): void {
    this.flames[i % 3].swerve += amount;
  }

  drop(): void {
    this.jump = 1;
    for (const f of this.flames) { f.glow = 2.2; f.ahead += 0.5; }
  }

  update(ctx: StyleContext): void {
    const dt = Math.min(ctx.dt, 1 / 20);
    this.time += dt;
    const t = this.time;
    // Pace follows the song.
    const sec = SECTION[ctx.eventState.section] ?? 1;
    this.section += (sec - this.section) * (1 - Math.exp(-dt / 0.8));
    this.jump *= Math.exp(-dt / JUMP_TAU);
    const build = ctx.eventState.buildProgress;
    const cruise = CRUISE[0] + (CRUISE[1] - CRUISE[0]) * Math.pow(clamp01(ctx.intensityGlow), 1.2);
    const target = cruise * this.section * (1 + (BUILD_MAX - 1) * build * build) * (1 + JUMP * this.jump) * (0.2 + 0.8 * ctx.fadeInOut);
    this.speed += (1 - Math.exp(-dt / (target > this.speed ? ACCEL_TAU : DECEL_TAU))) * (target - this.speed);
    this.s += this.speed * dt;

    // Flames weave across the tunnel ahead of the camera.
    this.flames.forEach((f, i) => {
      f.swerve *= Math.exp(-dt / 0.6);
      const wob = 0.3 + 0.5 * ctx.intensitySmoothed;
      f.ox = SPREAD * Math.sin(t * (0.55 + 0.17 * i) * (0.6 + wob) + i * 2.1 + f.swerve) + 0.12 * simplex2(t * 0.4, i * 7 + this.seed);
      f.oy = SPREAD * 0.75 * Math.sin(t * (0.43 + 0.13 * i) * (0.6 + wob) + i * 4.2) + 0.1 * simplex2(t * 0.37, i * 11 + this.seed);
      const want = AHEAD + 0.35 * Math.sin(t * 0.31 + i * 2.3);
      f.ahead += (want - f.ahead) * (1 - Math.exp(-dt / 0.9));
      f.glow += (1 - f.glow) * (1 - Math.exp(-dt / 0.25));
      const s = this.s + f.ahead;
      const c = tunnelCentre(s);
      const n = tunnelCentre(s + 0.05);
      const tx = n[0] - c[0], ty = n[1] - c[1], tz = n[2] - c[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      // Cross-section frame: side = T × up, up' = side × T.
      const T: Vec3 = [tx / tl, ty / tl, tz / tl];
      const side: Vec3 = norm([-T[2], 0, T[0]]);
      const up: Vec3 = [side[1] * T[2] - side[2] * T[1], side[2] * T[0] - side[0] * T[2], side[0] * T[1] - side[1] * T[0]];
      const r = TUNNEL_RADIUS;
      f.pos = [c[0] + (side[0] * f.ox + up[0] * f.oy) * r, c[1] + (side[1] * f.ox + up[1] * f.oy) * r, c[2] + (side[2] * f.ox + up[2] * f.oy) * r];
    });

    // Rings race on down the tunnel and fade.
    for (const g of this.rings) { g.age += dt; g.s += (RING_SPEED + this.speed) * dt; }
    while (this.rings.length && this.rings[0].age > RING_LIFE) this.rings.shift();

    // Camera: on the centre line, looking ahead and leaning toward the flames;
    // banks into bends and sways on beats.
    this.sway *= Math.exp(-dt / SWAY_TAU);
    const eye = tunnelCentre(this.s);
    const look = tunnelCentre(this.s + 2.4);
    const fc: Vec3 = [0, 0, 0];
    for (const f of this.flames) for (let k = 0; k < 3; k++) fc[k] += f.pos[k] / 3;
    const target3: Vec3 = [look[0] * 0.7 + fc[0] * 0.3, look[1] * 0.7 + fc[1] * 0.3, look[2] * 0.7 + fc[2] * 0.3];
    const ahead2 = tunnelCentre(this.s + 4);
    const bend = (ahead2[0] - 2 * look[0] + eye[0]) / 16;   // lateral curvature
    const roll = Math.max(-0.45, Math.min(0.45, -bend * BANK)) + this.sway;
    this.camPos = eye;
    lookAt(this.view, eye, target3, [Math.sin(roll), Math.cos(roll), 0]);
    perspective(this.proj, FOV, ctx.width / ctx.height, 0.05, 60);
    multiply(this.viewProj, this.proj, this.view);

    // Record the flames at 60 Hz for their trails.
    this.histAcc += dt;
    while (this.histAcc >= 1 / HIST_HZ) {
      this.histAcc -= 1 / HIST_HZ;
      this.flames.forEach((f, i) => this.hist.set([f.pos[0], f.pos[1], f.pos[2], f.glow], (i * HIST + this.histHead) * 4));
      this.histHead = (this.histHead + 1) % HIST;
      this.histLen = Math.min(HIST, this.histLen + 1);
    }
  }

  /** Screen uv and clip w of a world point; null behind the camera. */
  project(p: Vec3): { uv: [number, number]; w: number } | null {
    const m = this.viewProj;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w < 0.05) return null;
    return { uv: [0.5 + 0.5 * x / w, 0.5 + 0.5 * y / w], w };
  }

  /** Direction of travel at a flame (a point slightly ahead on the path). */
  aheadOf(i: number): Vec3 {
    const f = this.flames[i];
    const c = tunnelCentre(this.s + f.ahead), n = tunnelCentre(this.s + f.ahead + 0.08);
    return [f.pos[0] + n[0] - c[0], f.pos[1] + n[1] - c[1], f.pos[2] + n[2] - c[2]];
  }
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

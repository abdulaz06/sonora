/**
 * World camera — styles render into a world larger than the screen and look
 * at it through this camera. Never a fixed, centred composition.
 *
 * 2D: `center` (world units), `viewHeight` (world units visible vertically)
 *     and `rotation`. World units are arbitrary; a style decides how big its
 *     world is (Flow Ink's periodic fluid domain is a few view-heights wide).
 * 3D: a perspective camera gliding over the ground plane y = 0, looking
 *     slightly down, with `view`/`proj` matrices and fog distances.
 *
 * Both modes drift on smooth noise so the framing keeps changing; speed rides
 * on intensity; drops trigger a lurch (surge forward, pitch dip, zoom punch,
 * FOV kick) through critically damped springs; beats add a gentle bank.
 */

import type { EventState, SonoraEvent } from './events';
import { simplex2 } from './noise';
import {
  clamp, clamp01, expApproach, lookAt, mat4, multiply, perspective, spring, type Mat4, type Vec3,
} from './math';

// ── Tuning ──────────────────────────────────────────────────────
/** 2D drift speed (view-heights per second) at intensity 0 and 1. */
const DRIFT_SPEED_MIN = 0.018;
const DRIFT_SPEED_MAX = 0.11;
/** 2D zoom range (view height multiplier) and rotation wander (rad). */
const ZOOM_MIN = 0.85;
const ZOOM_MAX = 1.3;
const ROTATION_WANDER = 0.45;
/** Heading change rate (noise frequency, Hz). */
const HEADING_FREQ = 0.012;

/** 3D glide speed (world units / s) at intensity 0 and 1. */
const GLIDE_SPEED_MIN = 0.035;
const GLIDE_SPEED_MAX = 0.22;
/** 3D altitude (world units) and look-down pitch (rad). */
const ALTITUDE_BASE = 0.34;
const ALTITUDE_WANDER = 0.12;
const PITCH_BASE = -0.36;
const PITCH_WANDER = 0.08;
const FOV_BASE = (52 * Math.PI) / 180;
/** Bank on beats (rad) and how fast it eases (s). */
const BEAT_BANK = 0.045;
const BANK_TAU = 0.35;
/** Drop lurch: forward surge (units/s), pitch dip (rad), FOV kick (rad), zoom punch. */
const LURCH_SURGE = 0.9;
const LURCH_PITCH = -0.16;
const LURCH_FOV = (12 * Math.PI) / 180;
const LURCH_ZOOM = 0.22;
const LURCH_SPIN = 0.35;
const LURCH_OMEGA = 3.2;
/** How quickly the speed follows intensity (s). */
const SPEED_TAU = 1.6;
/** Silence: fraction of speed kept when the scene has faded out. */
const SILENT_SPEED = 0.25;
/** Fog distances for 3D styles (world units). */
const FOG_NEAR = 0.5;
const FOG_FAR = 3.4;

export interface CameraInput {
  dt: number;
  intensity: number;
  fadeInOut: number;
  beatOnset: boolean;
  beatConfidence: number;
  events: readonly SonoraEvent[];
  eventState: EventState;
}

export class WorldCamera {
  // ── 2D state ──
  center: [number, number] = [0, 0];
  viewHeight = 1;
  rotation = 0;
  // ── 3D state ──
  position: Vec3 = [0, ALTITUDE_BASE, 0];
  yaw = 0;
  pitch = PITCH_BASE;
  roll = 0;
  fov = FOV_BASE;
  aspect = 16 / 9;
  readonly near = 0.02;
  readonly far = 12;
  readonly fogNear = FOG_NEAR;
  readonly fogFar = FOG_FAR;
  readonly view: Mat4 = mat4();
  readonly proj: Mat4 = mat4();
  readonly viewProj: Mat4 = mat4();
  /** Forward / right / up unit vectors of the 3D camera. */
  forward: Vec3 = [0, 0, -1];
  right: Vec3 = [1, 0, 0];
  up: Vec3 = [0, 1, 0];
  /** 0–1: how hard the camera is lurching right now (styles can read it). */
  lurchAmount = 0;
  /** Accumulated travel distance (handy as a time-like value). */
  travel = 0;

  private t: number;
  private speed = DRIFT_SPEED_MIN;
  private lurch = 0;
  private lurchVel = 0;
  private bankTarget = 0;
  private bankSide = 1;
  private spinDir = 1;
  private readonly seed: number;

  constructor(seed = Math.random() * 1000) {
    this.seed = seed % 1000;
    this.t = this.seed * 7.31;
    this.yaw = this.seed;
  }

  /** Kick the camera (drops call this; styles may too). 0–1. */
  kick(strength: number): void {
    this.lurchVel += LURCH_OMEGA * 2.2 * clamp01(strength);
    this.spinDir = Math.sin(this.t * 13.7) > 0 ? 1 : -1;
  }

  update(input: CameraInput): void {
    const { dt, intensity, fadeInOut } = input;
    this.t += dt;
    const t = this.t;

    for (const e of input.events) {
      if (e.type === 'drop') this.kick(0.6 + 0.4 * e.strength);
      else if (e.type === 'bigHit') this.kick(0.18 * e.strength);
    }
    [this.lurch, this.lurchVel] = spring(this.lurch, this.lurchVel, 0, LURCH_OMEGA, dt);
    this.lurchAmount = clamp01(Math.abs(this.lurch));

    // Speed follows intensity; silence slows the world down; breakdowns float.
    const section = input.eventState.section;
    const calm = section === 'breakdown' ? 0.6 : 1;
    const target = (0.25 + 0.75 * intensity) * calm * (SILENT_SPEED + (1 - SILENT_SPEED) * fadeInOut);
    this.speed += expApproach(dt, SPEED_TAU) * (target - this.speed);

    // ── 2D ──
    const heading = simplex2(t * HEADING_FREQ, this.seed) * Math.PI * 2;
    const v2 = (DRIFT_SPEED_MIN + (DRIFT_SPEED_MAX - DRIFT_SPEED_MIN) * this.speed) + this.lurch * LURCH_SURGE * 0.12;
    this.center[0] += Math.cos(heading) * v2 * dt * this.viewHeight;
    this.center[1] += Math.sin(heading) * v2 * dt * this.viewHeight;
    const zoomN = 0.5 + 0.5 * simplex2(t * 0.021, this.seed + 31);
    this.viewHeight = (ZOOM_MIN + (ZOOM_MAX - ZOOM_MIN) * zoomN) * (1 - LURCH_ZOOM * this.lurch);
    this.rotation = simplex2(t * 0.009, this.seed + 57) * ROTATION_WANDER + this.lurch * LURCH_SPIN * this.spinDir * 0.4;

    // ── 3D ──
    if (input.beatOnset && input.beatConfidence > 0.3 && fadeInOut > 0.3) {
      this.bankSide = -this.bankSide;
      this.bankTarget = BEAT_BANK * this.bankSide * (0.4 + 0.6 * intensity);
    }
    this.bankTarget *= Math.exp(-dt / 1.2);
    const wanderRoll = simplex2(t * 0.03, this.seed + 91) * 0.05;
    this.roll += expApproach(dt, BANK_TAU) * (this.bankTarget + wanderRoll + this.lurch * 0.06 * this.spinDir - this.roll);

    this.yaw += simplex2(t * 0.017, this.seed + 13) * 0.11 * dt + this.lurch * this.spinDir * 0.25 * dt;
    const glide = GLIDE_SPEED_MIN + (GLIDE_SPEED_MAX - GLIDE_SPEED_MIN) * this.speed + this.lurch * LURCH_SURGE * 0.35;
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.position[0] += fx * glide * dt;
    this.position[2] += fz * glide * dt;
    this.travel += glide * dt;
    const lift = section === 'breakdown' ? 0.12 : section === 'silence' ? 0.08 : 0;
    const altTarget = ALTITUDE_BASE + ALTITUDE_WANDER * simplex2(t * 0.025, this.seed + 71) + lift;
    this.position[1] += expApproach(dt, 2.5) * (altTarget - this.position[1]);
    this.pitch = PITCH_BASE + PITCH_WANDER * simplex2(t * 0.02, this.seed + 3) + LURCH_PITCH * this.lurch;
    this.fov = FOV_BASE + LURCH_FOV * this.lurch;

    this.updateMatrices();
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  private updateMatrices(): void {
    const cp = Math.cos(this.pitch);
    const f: Vec3 = [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
    // Roll the world-up around the forward axis.
    const r0: Vec3 = [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
    // up = right × forward
    const u0: Vec3 = [r0[1] * f[2] - r0[2] * f[1], r0[2] * f[0] - r0[0] * f[2], r0[0] * f[1] - r0[1] * f[0]];
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const up: Vec3 = [u0[0] * cr + r0[0] * sr, u0[1] * cr + r0[1] * sr, u0[2] * cr + r0[2] * sr];
    const right: Vec3 = [r0[0] * cr - u0[0] * sr, r0[1] * cr - u0[1] * sr, r0[2] * cr - u0[2] * sr];
    this.forward = f;
    this.up = up;
    this.right = right;
    const p = this.position;
    lookAt(this.view, p, [p[0] + f[0], p[1] + f[1], p[2] + f[2]], up);
    perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    multiply(this.viewProj, this.proj, this.view);
  }

  /**
   * World point on the ground plane under normalised screen coords
   * (sx, sy in [-1, 1], may exceed 1 for off-screen). Returns null above the
   * horizon or beyond `maxDist`.
   */
  screenToGround(sx: number, sy: number, maxDist = 6): [number, number] | null {
    const th = Math.tan(this.fov / 2);
    const dx = this.forward[0] + (this.right[0] * sx * this.aspect + this.up[0] * sy) * th;
    const dy = this.forward[1] + (this.right[1] * sx * this.aspect + this.up[1] * sy) * th;
    const dz = this.forward[2] + (this.right[2] * sx * this.aspect + this.up[2] * sy) * th;
    if (dy >= -1e-3) return null;
    const k = -this.position[1] / dy;
    if (k * Math.hypot(dx, dy, dz) > maxDist) return null;
    return [this.position[0] + dx * k, this.position[2] + dz * k];
  }

  /** World point (2D camera) under normalised screen coords. */
  screenToWorld2D(sx: number, sy: number): [number, number] {
    const h = this.viewHeight * 0.5;
    const x = sx * h * this.aspect, y = sy * h;
    const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
    return [this.center[0] + x * c - y * s, this.center[1] + x * s + y * c];
  }

  /** Small helper so styles can clamp per-mode values. */
  static clampFog(d: number): number {
    return clamp((d - FOG_NEAR) / (FOG_FAR - FOG_NEAR), 0, 1);
  }
}

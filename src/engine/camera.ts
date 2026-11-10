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
/** Altitude range (world units) mapped from view.height 0..1. */
const ALT_MIN = 0.1;
const ALT_MAX = 2.0;
/** Look-down angle (rad) mapped from view.tilt 0..1 (0 = horizon, 1 = straight down). */
const TILT_MIN = 0.1;
const TILT_MAX = 1.5;
/** Surface curvature (1/units) at view.curve = ±1. */
const CURVE_STRENGTH = 0.32;
/** How quickly the camera eases to a new view / preset (s). */
const VIEW_TAU = 0.7;
/** Mouse sensitivity: radians per pixel dragged, height per wheel notch. */
const DRAG_YAW = 0.004;
const DRAG_TILT = 0.0022;
const WHEEL_HEIGHT = 0.05;
/** Flat view: zoom range from the wheel, and pan per pixel (view heights). */
const FLAT_ZOOM_MIN = 0.5;
const FLAT_ZOOM_MAX = 2.5;

/** User-facing camera view for depth styles. */
export interface CameraView {
  /** 0 = skimming the surface, 1 = high above it. */
  height: number;
  /** 0 = looking at the horizon, 1 = looking straight down. */
  tilt: number;
  /** -1 = curves up like a bowl (U), 0 = flat, 1 = curves away like a planet (∩). */
  curve: number;
}

export interface CameraPreset {
  id: string;
  label: string;
  hint: string;
  view: CameraView;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'glide', label: 'Glide', hint: 'Low over the surface, looking ahead', view: { height: 0.22, tilt: 0.18, curve: 0 } },
  { id: 'horizon', label: 'Horizon', hint: 'Skimming the surface toward a curved horizon', view: { height: 0.04, tilt: 0.04, curve: 0.25 } },
  { id: 'planet', label: 'Planet', hint: 'High up; the surface curves away like a planet', view: { height: 0.6, tilt: 0.55, curve: 0.6 } },
  { id: 'valley', label: 'Valley', hint: 'The surface rises around you like a bowl', view: { height: 0.3, tilt: 0.2, curve: -0.7 } },
  { id: 'overhead', label: 'Overhead', hint: 'Looking straight down from above', view: { height: 0.55, tilt: 1, curve: 0 } },
];

export const DEFAULT_CAMERA_VIEW: CameraView = { ...CAMERA_PRESETS[0].view };

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
  pitch = -0.36;
  roll = 0;
  fov = FOV_BASE;
  aspect = 16 / 9;
  readonly near = 0.02;
  readonly far = 14;
  /** Target view (from settings / presets) and the eased view in use. */
  private viewTarget: CameraView = { ...DEFAULT_CAMERA_VIEW };
  private viewNow: CameraView = { ...DEFAULT_CAMERA_VIEW };
  /** Flat-view zoom from the wheel. */
  private flatZoom = 1;
  private onViewChange: ((v: CameraView) => void) | null = null;
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

  /** Fog distances grow with altitude so high views can see further. */
  get fogNear(): number { return FOG_NEAR + this.position[1] * 0.5; }
  get fogFar(): number { return FOG_FAR + this.position[1] * 1.4; }
  /** Surface curvature in 1/world units (positive = planet, negative = bowl). */
  get curvature(): number { return this.viewNow.curve * CURVE_STRENGTH; }

  /** Set the target view (eases there). */
  setView(v: Partial<CameraView>): void {
    this.viewTarget = {
      height: clamp(v.height ?? this.viewTarget.height, 0, 1),
      tilt: clamp(v.tilt ?? this.viewTarget.tilt, 0, 1),
      curve: clamp(v.curve ?? this.viewTarget.curve, -1, 1),
    };
  }

  getView(): CameraView { return { ...this.viewTarget }; }

  /** Called when the user changes the view with the mouse (for persistence). */
  setViewListener(cb: ((v: CameraView) => void) | null): void { this.onViewChange = cb; }

  /** Mouse drag: turn (dx) and tilt (dy) in Depth; pan in Flat. Pixels. */
  drag(dx: number, dy: number, depth: boolean): void {
    if (depth) {
      this.yaw += dx * DRAG_YAW;
      const t = clamp(this.viewTarget.tilt + dy * DRAG_TILT / (TILT_MAX - TILT_MIN), 0, 1);
      this.viewTarget.tilt = t;
      this.onViewChange?.(this.getView());
    } else {
      const k = this.viewHeight / 900;
      const c = Math.cos(this.rotation), s = Math.sin(this.rotation);
      this.center[0] -= (dx * c + dy * s) * k;
      this.center[1] += (-dx * s + dy * c) * k;
    }
  }

  /** Mouse wheel: height in Depth, zoom in Flat. `notches` > 0 = away from the surface / zoom out. */
  wheel(notches: number, depth: boolean): void {
    if (depth) {
      this.viewTarget.height = clamp(this.viewTarget.height + notches * WHEEL_HEIGHT, 0, 1);
      this.onViewChange?.(this.getView());
    } else {
      this.flatZoom = clamp(this.flatZoom * Math.pow(1.1, notches), FLAT_ZOOM_MIN, FLAT_ZOOM_MAX);
    }
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
    this.viewHeight = (ZOOM_MIN + (ZOOM_MAX - ZOOM_MIN) * zoomN) * (1 - LURCH_ZOOM * this.lurch) * this.flatZoom;
    this.rotation = simplex2(t * 0.009, this.seed + 57) * ROTATION_WANDER + this.lurch * LURCH_SPIN * this.spinDir * 0.4;

    // ── 3D ──
    if (input.beatOnset && input.beatConfidence > 0.3 && fadeInOut > 0.3) {
      this.bankSide = -this.bankSide;
      this.bankTarget = BEAT_BANK * this.bankSide * (0.4 + 0.6 * intensity);
    }
    this.bankTarget *= Math.exp(-dt / 1.2);
    const wanderRoll = simplex2(t * 0.03, this.seed + 91) * 0.05;
    this.roll += expApproach(dt, BANK_TAU) * (this.bankTarget + wanderRoll + this.lurch * 0.06 * this.spinDir - this.roll);

    // Ease toward the user's view.
    const ve = expApproach(dt, VIEW_TAU);
    this.viewNow.height += ve * (this.viewTarget.height - this.viewNow.height);
    this.viewNow.tilt += ve * (this.viewTarget.tilt - this.viewNow.tilt);
    this.viewNow.curve += ve * (this.viewTarget.curve - this.viewNow.curve);
    const altitude = ALT_MIN + (ALT_MAX - ALT_MIN) * Math.pow(this.viewNow.height, 1.5);
    const tilt = TILT_MIN + (TILT_MAX - TILT_MIN) * Math.pow(this.viewNow.tilt, 1.2);
    // Straight-down views wander less so they stay steady.
    const wander = 1 - this.viewNow.tilt * 0.7;

    this.yaw += simplex2(t * 0.017, this.seed + 13) * 0.11 * dt * wander + this.lurch * this.spinDir * 0.25 * dt;
    // Higher views travel faster so motion stays visible.
    const glide = (GLIDE_SPEED_MIN + (GLIDE_SPEED_MAX - GLIDE_SPEED_MIN) * this.speed) * (1 + altitude * 0.9)
      + this.lurch * LURCH_SURGE * 0.35;
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.position[0] += fx * glide * dt;
    this.position[2] += fz * glide * dt;
    this.travel += glide * dt;
    const lift = section === 'breakdown' ? 0.12 : section === 'silence' ? 0.08 : 0;
    const altTarget = altitude * (1 + (ALTITUDE_WANDER / ALTITUDE_BASE) * 0.5 * simplex2(t * 0.025, this.seed + 71)) + lift;
    this.position[1] += expApproach(dt, 1.2) * (altTarget - this.position[1]);
    this.pitch = clamp(-tilt + PITCH_WANDER * wander * simplex2(t * 0.02, this.seed + 3) + LURCH_PITCH * this.lurch, -1.53, -0.03);
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

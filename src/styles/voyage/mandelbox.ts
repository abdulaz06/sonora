/**
 * Mandelbox distance estimator (mirrors `de()` in march.frag) and the flight
 * planner that lays a smooth spline path through open space inside the
 * fractal: waypoints are chosen so every point along each segment keeps a
 * clearance from the surface, preferring gentle turns and a "just right"
 * distance to the walls (close enough to see detail, far enough not to clip).
 */

import type { Vec3 } from '../../engine/math';

export interface BoxParams {
  /** Mandelbox scale (negative = organic caves, positive = architecture). */
  scale: number;
  /** Minimum radius² of the sphere fold (fixed radius² is 1). */
  minR2: number;
  /** Box fold limit. */
  fold: number;
  /** Melting warp (mirrors bend() in march.frag): amplitude, frequency, time. */
  warpAmp?: number;
  warpFreq?: number;
  warpTime?: number;
  /** Distance-bound correction for the warp (≤ 1). */
  lip?: number;
}

/** Where the planner may fly: radius from the origin and preferred clearance. */
export interface FlightSpace {
  bound: number;
  clearance: number;
}

// ── Tuning ──────────────────────────────────────────────────────
/** Iterations of the CPU estimator (more = more detail = safer clearance). */
const DE_ITERS = 13;
/** Minimum clearance along a segment, as a fraction of the preferred one. */
const CLEAR_MIN = 0.25;
/** Segment length as a multiple of the local clearance, and its limits
 * (multiples of the preferred clearance). */
const SEG_K = 3.2;
const SEG_MIN = 0.6;
const SEG_MAX = 5;
/** Candidate directions tried per waypoint and samples per segment. */
const TRIES = 28;
const SAMPLES = 10;
/** Line-of-sight scoring: cap (in clearances) and weight. */
const VIEW_CAP = 25;
const VIEW_WEIGHT = 0.35;

export function deBox(x0: number, y0: number, z0: number, p: BoxParams, iters = DE_ITERS): number {
  let x = x0, y = y0, z = z0;
  const wa = p.warpAmp ?? 0;
  if (wa > 0) {
    const f = p.warpFreq ?? 1, t = p.warpTime ?? 0;
    x = x0 + wa * Math.sin(y0 * f + t * 0.35);
    y = y0 + wa * Math.sin(z0 * f + t * 0.29);
    z = z0 + wa * Math.sin(x0 * f + t * 0.41);
  }
  let px = x, py = y, pz = z, pw = 1;
  const s = p.scale, as = Math.abs(s), f = p.fold, maxK = 1 / p.minR2;
  for (let i = 0; i < iters; i++) {
    px = (px > f ? f : px < -f ? -f : px) * 2 - px;
    py = (py > f ? f : py < -f ? -f : py) * 2 - py;
    pz = (pz > f ? f : pz < -f ? -f : pz) * 2 - pz;
    const r2 = px * px + py * py + pz * pz;
    let k = r2 > 0 ? 1 / r2 : maxK;
    k = k < 1 ? 1 : k > maxK ? maxK : k;
    px = px * k * s + x;
    py = py * k * s + y;
    pz = pz * k * s + z;
    pw = pw * k * as + 1;
  }
  return (Math.sqrt(px * px + py * py + pz * pz) / Math.abs(pw)) * (p.lip ?? 1);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t, t3 = t2 * t;
  const o: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    o[i] = 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
      + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return o;
}

/** Spline flight through the fractal. */
export class FlightPath {
  private pts: Vec3[] = [];
  private seg = 0;
  private u = 0;
  private segLen = 1;

  /** Optional destination: waypoints are pulled toward it and may leave the
   * flight bound (used to fly out of the fractal for wide shots). */
  private goal: Vec3 | null = null;
  private goalWeight = 0;

  constructor(private params: () => BoxParams, private space: () => FlightSpace, private rng: () => number) {
    this.reset();
  }

  /** Clearance (distance to the surface) at a point. */
  de(p: Vec3): number { return deBox(p[0], p[1], p[2], this.params()); }

  /** Free distance along a ray (sphere tracing, capped), in clearances. */
  private viewDepth(from: Vec3, dir: Vec3): number {
    const sp = this.space();
    const cap = sp.clearance * VIEW_CAP;
    let t = 0;
    for (let i = 0; i < 40 && t < cap; i++) {
      const d = this.de(add(from, scl(dir, t)));
      if (d < sp.clearance * 0.05) break;
      t += d * 0.9;
    }
    return Math.min(t, cap) / sp.clearance;
  }

  private randomDir(): Vec3 {
    const z = this.rng() * 2 - 1, a = this.rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z];
  }

  /** Steer future waypoints toward `p` (null clears). Drops planned points
   * beyond the next two so the turn starts soon. */
  setGoal(p: Vec3 | null, weight = 2.5): void {
    this.goal = p;
    this.goalWeight = weight;
    if (p && this.pts.length > this.seg + 6) this.pts.length = this.seg + 6;
  }

  /** Continue from point p heading along dir (after replaying a wide-shot exit backwards). */
  restartAt(p: Vec3, dir: Vec3): void {
    const sp = this.space();
    const d = norm(dir);
    this.goal = null;
    this.pts = [sub(p, scl(d, sp.clearance)), [...p] as Vec3];
    while (this.pts.length < 5) this.extend();
    this.seg = 0;
    this.u = 0;
    this.segLen = this.measure();
  }

  /** Find a fresh start inside the structure. */
  reset(): void {
    const sp = this.space();
    let best: Vec3 = [0, 0, sp.bound], bestScore = -Infinity;
    for (let i = 0; i < 600; i++) {
      const d = this.randomDir();
      const p = scl(d, sp.bound * (0.15 + this.rng() * 0.8));
      const c = this.de(p);
      const score = -Math.abs(Math.log(Math.max(c, 1e-5) / sp.clearance));
      if (score > bestScore) { bestScore = score; best = p; }
    }
    // Start looking down the longest open line of sight.
    let dir = this.randomDir(), bestView = -1;
    for (let i = 0; i < 48; i++) {
      const d = this.randomDir();
      const v = this.viewDepth(best, d);
      if (v > bestView) { bestView = v; dir = d; }
    }
    this.pts = [sub(best, scl(dir, sp.clearance)), best];
    while (this.pts.length < 5) this.extend();
    this.seg = 0;
    this.u = 0;
    this.segLen = this.measure();
  }

  private extend(): void {
    const n = this.pts.length;
    const cur = this.pts[n - 1];
    const dir0 = norm(sub(cur, this.pts[n - 2]));
    const sp = this.space();
    const L = Math.min(SEG_MAX * sp.clearance, Math.max(SEG_MIN * sp.clearance, this.de(cur) * SEG_K));
    let best: Vec3 | null = null, bestScore = -Infinity;
    for (let t = 0; t < TRIES * 2; t++) {
      // Widen the cone as tries fail; past TRIES allow any direction (U-turn).
      const wide = t < TRIES ? 0.35 + (t / TRIES) * 0.8 : 2;
      const d = norm(add(dir0, scl(this.randomDir(), wide)));
      const q = add(cur, scl(d, L));
      if (!this.goal && len(q) > sp.bound) continue;
      let minD = Infinity;
      for (let s = 1; s <= SAMPLES; s++) minD = Math.min(minD, this.de(add(cur, scl(d, (L * s) / SAMPLES))));
      if (minD < CLEAR_MIN * sp.clearance) continue;
      // Prefer smooth turns, the preferred clearance, and a long view ahead.
      let score = -Math.abs(Math.log(minD / sp.clearance)) + 0.9 * dot(d, dir0)
        + VIEW_WEIGHT * Math.log(1 + this.viewDepth(q, d));
      if (this.goal) score += this.goalWeight * dot(d, norm(sub(this.goal, cur)));
      if (score > bestScore) { bestScore = score; best = q; }
      if (t >= TRIES && best) break;
    }
    // Nowhere to go: step back the way we came.
    this.pts.push(best ?? add(cur, scl(dir0, -L)));
  }

  private measure(): number {
    const [a, b, c, d] = this.pts.slice(this.seg, this.seg + 4);
    let l = 0, prev = b;
    for (let i = 1; i <= 8; i++) { const p = catmull(a, b, c, d, i / 8); l += len(sub(p, prev)); prev = p; }
    return Math.max(l, 1e-3);
  }

  /** Point at `ahead` world units beyond the current position (approx). */
  sample(ahead = 0): Vec3 {
    let seg = this.seg, u = this.u + ahead / this.segLen;
    while (u >= 1 && seg + 4 < this.pts.length) { u -= 1; seg++; }
    u = Math.min(u, 1);
    const [a, b, c, d] = this.pts.slice(seg, seg + 4);
    return catmull(a, b, c, d, u);
  }

  /** Advance by `dist` world units. */
  advance(dist: number): void {
    this.u += dist / this.segLen;
    while (this.u >= 1) {
      this.u -= 1;
      this.seg++;
      while (this.pts.length < this.seg + 6) this.extend();
      if (this.seg > 8) { this.pts.splice(0, this.seg - 2); this.seg = 2; }
      this.segLen = this.measure();
    }
  }
}

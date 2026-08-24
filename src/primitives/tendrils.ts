/**
 * Flow tendrils — smooth curves that follow the flow field.
 *
 * Drivers (per DOCS/14-MAPPING-LAYER-SPEC.md):
 *   - primary drive   → mid-band presence (sustained vocals/pads/leads)
 *   - spawn bursts    → mid-band hits (melodic transients)
 *   - visibility gate → fade_in_out
 *
 * Tendrils are the "mid-frequency" visual channel. Each tendril is a polyline
 * traced through the flow field, rendered as a line strip.
 */

import { FlowField } from './flow-field';

const MAX_TENDRILS = 12;
const POINTS_PER_TENDRIL = 48;
const FLOATS_PER_POINT = 6; // x, y, alpha, r, g, b

interface Tendril {
  points: { x: number; y: number }[];
  originX: number;
  originY: number;
  life: number;
  maxLife: number;
  speed: number;
  width: number;
}

export class TendrilSystem {
  private tendrils: Tendril[] = [];
  private spawnTimer = 0;

  /** GPU vertex data for all tendril points. */
  vertexData: Float32Array;
  /** Total number of vertices to render. */
  totalPoints = 0;
  /** Segment counts per tendril (for multi-draw). */
  segmentCounts: number[] = [];

  constructor() {
    this.vertexData = new Float32Array(MAX_TENDRILS * POINTS_PER_TENDRIL * FLOATS_PER_POINT);
  }

  /** Update tendrils: advance existing, spawn new if mid-band presence is sustained.
   *  @param midPresence  — averaged low_mid/mid/upper_mid presence (0–1)
   *  @param midHits      — max mid-band hit strength (0–1) for bursty spawns
   *  @param fadeInOut    — global visibility gate */
  update(
    flowField: FlowField,
    midPresence: number,
    midHits: number,
    fadeInOut: number,
    dt: number,
    color: [number, number, number],
  ): void {
    // Presence is the sustained drive; hits add occasional bursts of activity.
    const drive = (midPresence + midHits * 0.4) * fadeInOut;

    // Spawn new tendrils based on drive
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && drive > 0.05 && this.tendrils.length < MAX_TENDRILS) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 0.15 + Math.random() * 0.3;
      this.tendrils.push({
        points: [{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist }],
        originX: Math.cos(angle) * dist,
        originY: Math.sin(angle) * dist,
        life: 3 + Math.random() * 4,
        maxLife: 3 + Math.random() * 4,
        speed: 0.15 + drive * 0.4,
        width: 0.002 + drive * 0.004,
      });
      this.spawnTimer = 0.3 + (1 - drive) * 0.7; // Spawn faster when energy is high
    }

    // Update existing tendrils
    let writeIdx = 0;
    for (let i = 0; i < this.tendrils.length; i++) {
      const t = this.tendrils[i];
      t.life -= dt;
      if (t.life <= 0) continue;

      // Grow the tendril by following the flow field
      const head = t.points[t.points.length - 1];
      if (t.points.length < POINTS_PER_TENDRIL) {
        const [dx, dy] = flowField.sample(head.x, head.y);
        const step = t.speed * dt;
        t.points.push({
          x: head.x + dx * step,
          y: head.y + dy * step,
        });
      } else {
        // Once full, advance by shifting and adding new head
        const [dx, dy] = flowField.sample(head.x, head.y);
        const step = t.speed * dt;
        t.points.shift();
        t.points.push({
          x: head.x + dx * step,
          y: head.y + dy * step,
        });
      }

      if (writeIdx !== i) this.tendrils[writeIdx] = t;
      writeIdx++;
    }
    this.tendrils.length = writeIdx;

    // Write vertex data
    this.totalPoints = 0;
    this.segmentCounts = [];

    for (const t of this.tendrils) {
      const lifeRatio = t.life / t.maxLife;
      const fadeIn = Math.min(1, (1 - lifeRatio) * 4); // Quick fade in
      const fadeOut = Math.min(1, lifeRatio * 3);       // Gentle fade out
      const baseAlpha = fadeIn * fadeOut;
      const len = t.points.length;

      for (let j = 0; j < len; j++) {
        const p = t.points[j];
        // Alpha tapers at both ends of the tendril
        const posFade = Math.sin((j / Math.max(1, len - 1)) * Math.PI);
        const alpha = baseAlpha * posFade * 0.6;

        const off = this.totalPoints * FLOATS_PER_POINT;
        this.vertexData[off    ] = p.x;
        this.vertexData[off + 1] = p.y;
        this.vertexData[off + 2] = alpha;
        this.vertexData[off + 3] = color[0];
        this.vertexData[off + 4] = color[1];
        this.vertexData[off + 5] = color[2];
        this.totalPoints++;
      }

      this.segmentCounts.push(len);
    }
  }
}

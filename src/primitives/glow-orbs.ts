/**
 * Glow orbs — soft radial light sources that drift slowly.
 *
 * Drivers (per DOCS/14-MAPPING-LAYER-SPEC.md):
 *   - brightness / spawn → low-band presence (sustained sub/bass)
 *   - count cap          → intensity (macro arc)
 *   - visibility gate    → fade_in_out
 *
 * Orbs are the "low-frequency" visual channel — they glow when bass sustains
 * and fade quickly on transients alone (which is why presence, not hits,
 * drives them).
 */

import { simplex2 } from '../engine/noise';

const MAX_ORBS = 8;
const FLOATS_PER_ORB = 7; // x, y, size, alpha, r, g, b

interface Orb {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  size: number;
  phase: number;     // Noise phase offset for drifting
  driftSpeed: number;
  life: number;
  maxLife: number;
}

export class GlowOrbSystem {
  private orbs: Orb[] = [];
  private spawnTimer = 0;
  instanceData: Float32Array;
  liveCount = 0;

  constructor() {
    this.instanceData = new Float32Array(MAX_ORBS * FLOATS_PER_ORB);
  }

  /** Update orbs from the mapping layer.
   *  @param lowPresence — max of sub_bass/bass presence (sustained lows)
   *  @param intensity   — long-window song intensity (caps orb count)
   *  @param fadeInOut   — global visibility gate */
  update(
    lowPresence: number,
    intensity: number,
    fadeInOut: number,
    dt: number,
    time: number,
    color: [number, number, number],
  ): void {
    const drive = lowPresence;
    const maxActive = Math.max(1, Math.ceil(intensity * MAX_ORBS));

    // Spawn orbs when low-band presence is sustained, capped by intensity.
    this.spawnTimer -= dt;
    if (
      this.spawnTimer <= 0 &&
      drive > 0.08 &&
      this.orbs.length < maxActive
    ) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 0.1 + Math.random() * 0.35;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      this.orbs.push({
        x, y,
        baseX: x,
        baseY: y,
        size: 0.08 + Math.random() * 0.12,
        phase: Math.random() * 100,
        driftSpeed: 0.3 + Math.random() * 0.5,
        life: 5 + Math.random() * 8,
        maxLife: 5 + Math.random() * 8,
      });
      this.spawnTimer = 1.5 + (1 - drive) * 3;
    }

    // Update orbs
    let writeIdx = 0;
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      o.life -= dt;
      if (o.life <= 0) continue;

      // Slow drift using noise
      const t = time * o.driftSpeed + o.phase;
      o.x = o.baseX + simplex2(t, 0) * 0.08;
      o.y = o.baseY + simplex2(0, t) * 0.08;

      if (writeIdx !== i) this.orbs[writeIdx] = o;
      writeIdx++;
    }
    this.orbs.length = writeIdx;
    this.liveCount = writeIdx;

    // Write instance data
    for (let i = 0; i < this.liveCount; i++) {
      const o = this.orbs[i];
      const lifeRatio = o.life / o.maxLife;
      const fadeIn = Math.min(1, (1 - lifeRatio) * 2);
      const fadeOut = Math.min(1, lifeRatio * 2);
      const alpha = fadeIn * fadeOut * (0.15 + drive * 0.25) * fadeInOut;

      const off = i * FLOATS_PER_ORB;
      this.instanceData[off    ] = o.x;
      this.instanceData[off + 1] = o.y;
      this.instanceData[off + 2] = o.size * (1 + drive * 0.3);
      this.instanceData[off + 3] = alpha;
      this.instanceData[off + 4] = color[0];
      this.instanceData[off + 5] = color[1];
      this.instanceData[off + 6] = color[2];
    }
  }
}

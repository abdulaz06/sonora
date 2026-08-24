/**
 * Generative variation — session seed, slow parameter drift via noise.
 * Ensures visuals never repeat exactly across sessions.
 */

import { seedNoise, simplex2 } from './noise';

export class GenerativeState {
  readonly seed: number;
  private time = 0;

  // Slowly drifting parameters (all -1..1, use as modulation signals)
  /** Slow drift for ring radius modulation. */
  ringDrift = 0;
  /** Slow drift for particle spawn position bias. */
  particleDrift = 0;
  /** Slow drift for color hue shift. */
  hueDrift = 0;
  /** Slow drift for overall intensity modulation. */
  intensityDrift = 0;
  /** Slow drift for flow field turbulence. */
  turbulenceDrift = 0;

  constructor(seed?: number) {
    this.seed = seed ?? (Math.random() * 0xFFFFFFFF) >>> 0;
    seedNoise(this.seed);
  }

  /** Update drift parameters. Call once per frame. */
  update(dt: number): void {
    this.time += dt;
    const t = this.time;

    // Each parameter uses different noise coordinates so they vary independently.
    // Very slow periods (30s-3min) for subtle evolution.
    this.ringDrift       = simplex2(t * 0.02,  100);
    this.particleDrift   = simplex2(t * 0.015, 200);
    this.hueDrift        = simplex2(t * 0.01,  300);
    this.intensityDrift  = simplex2(t * 0.008, 400);
    this.turbulenceDrift = simplex2(t * 0.012, 500);
  }
}

/**
 * Asymmetric envelope follower for smoothing audio features.
 * Fast attack captures transients, slower release creates smooth decay.
 * The responsiveness slider interpolates between smooth and punchy presets.
 */

export interface EnvelopeParams {
  attack: number;  // seconds
  release: number; // seconds
}

/** Preset envelope speeds. */
export const SMOOTH: EnvelopeParams  = { attack: 0.08,  release: 0.5  };
export const MEDIUM: EnvelopeParams  = { attack: 0.035, release: 0.2  };
// Punchy still follows the music closely, but not frame-by-frame noise: a
// 5 ms / 50 ms follower made speeds and anything tied to them jitter.
export const PUNCHY: EnvelopeParams  = { attack: 0.015, release: 0.12 };
/** Fixed, slow follower for brightness and density (never responsiveness-driven). */
export const GLOW: EnvelopeParams    = { attack: 0.12,  release: 0.7  };

/** Interpolate between smooth and punchy based on a 0–1 slider. */
export function lerpParams(t: number): EnvelopeParams {
  return {
    attack:  SMOOTH.attack  + t * (PUNCHY.attack  - SMOOTH.attack),
    release: SMOOTH.release + t * (PUNCHY.release - SMOOTH.release),
  };
}

export class EnvelopeFollower {
  value = 0;
  private params: EnvelopeParams;

  constructor(params: EnvelopeParams = MEDIUM) {
    this.params = { ...params };
  }

  setParams(params: EnvelopeParams): void {
    this.params.attack = params.attack;
    this.params.release = params.release;
  }

  update(target: number, dt: number): number {
    const tau = target > this.value ? this.params.attack : this.params.release;
    const alpha = 1 - Math.exp(-dt / Math.max(tau, 0.001));
    this.value += alpha * (target - this.value);
    return this.value;
  }

  reset(value = 0): void {
    this.value = value;
  }
}

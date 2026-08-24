/**
 * Core rings — pulsing circles driven by the mapping layer.
 *
 * Drivers (per DOCS/14-MAPPING-LAYER-SPEC.md hierarchy rule):
 *   - macro base size  → intensity        (long-window song intensity)
 *   - visibility gate  → fade_in_out      (silence-aware global alpha)
 *   - transient pulse  → bassHits         (per-band hit signal for sub/bass)
 *   - baseline glow    → bassPresence     (sustained bass gives quiet shimmer)
 *
 * The ring system no longer maintains its own loudness envelope — the macro
 * arc comes directly from `intensity` on the frame.
 */

import { EnvelopeFollower, MEDIUM } from '../engine/envelope';

export interface RingState {
  radius: number;
  energy: number;
  thickness: number;
  glow: number;
  color: [number, number, number];
}

export const MIN_RING_COUNT = 2;
export const MAX_RING_COUNT = 10;
export const DEFAULT_RING_COUNT = 3;

// Inner-most and outer-most "full loudness" radii. With N rings we spread
// evenly between these so increasing the count subdivides the same visual
// space rather than expanding it.
const INNER_RADIUS = 0.20;
const OUTER_RADIUS = 0.58;

function clampCount(n: number): number {
  return Math.max(MIN_RING_COUNT, Math.min(MAX_RING_COUNT, Math.round(n)));
}

/** Evenly spaced base radii from INNER_RADIUS to OUTER_RADIUS. */
function buildBaseRadii(count: number): number[] {
  if (count === 1) return [(INNER_RADIUS + OUTER_RADIUS) * 0.5];
  const radii: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    radii[i] = INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * t;
  }
  return radii;
}

export class RingSystem {
  rings: RingState[] = [];
  private transientEnvelopes: EnvelopeFollower[] = [];
  private baseRadii: number[] = [];
  /** Current macro scale (0–1), exposed for the shader as u_loudness. */
  loudness = 0;

  constructor(count: number = DEFAULT_RING_COUNT) {
    this.setRingCount(count);
  }

  /** Resize the ring array. Preserves existing transient envelopes when possible
   *  so the visual stays smooth as the user drags the slider. */
  setRingCount(count: number): void {
    const n = clampCount(count);
    if (n === this.rings.length) return;

    this.baseRadii = buildBaseRadii(n);

    // Grow / shrink envelopes (keep existing values for indices that overlap)
    if (n > this.transientEnvelopes.length) {
      while (this.transientEnvelopes.length < n) {
        this.transientEnvelopes.push(new EnvelopeFollower(MEDIUM));
      }
    } else if (n < this.transientEnvelopes.length) {
      this.transientEnvelopes.length = n;
    }

    // Grow / shrink ring state (keep existing color so a fresh frame doesn't flash)
    if (n > this.rings.length) {
      while (this.rings.length < n) {
        this.rings.push({
          radius: 0,
          energy: 0,
          thickness: 0,
          glow: 0,
          color: [0.3, 0.5, 0.9] as [number, number, number],
        });
      }
    } else if (n < this.rings.length) {
      this.rings.length = n;
    }
  }

  get ringCount(): number {
    return this.rings.length;
  }

  /** Update ring state from the mapping layer.
   *  @param bassHits      — max of sub_bass/bass hits (transient punch)
   *  @param bassPresence  — max of sub_bass/bass presence (sustained floor)
   *  @param intensity     — long-window song intensity (macro arc driver)
   *  @param fadeInOut     — global visibility gate (0=silent, 1=active)
   *  @param dt            — frame delta time */
  update(
    bassHits: number,
    bassPresence: number,
    intensity: number,
    fadeInOut: number,
    dt: number,
  ): void {
    // Shape intensity for a musically useful range — emphasize quiet-to-medium
    // so buildups register early without the full drop being washed out.
    const loudnessScale = Math.pow(Math.min(1, intensity), 0.6);
    this.loudness = loudnessScale;

    // Ring pulse driver: hits are the transient, presence is a baseline floor
    // that keeps sustained bass from producing a totally flat ring.
    const pulseDrive = bassHits + bassPresence * 0.2;

    const n = this.rings.length;
    for (let i = 0; i < n; i++) {
      const baseR = this.baseRadii[i];

      // Each ring responds slightly differently — outer rings lag a touch.
      // Normalize the lag amount across N rings so it feels consistent
      // regardless of count (full lag at the outermost ring, none at the
      // innermost).
      const lagT = n > 1 ? i / (n - 1) : 0;
      const drive = pulseDrive * (1.2 - lagT * 0.45);
      const transient = this.transientEnvelopes[i].update(drive, dt);

      // Base radius scales with intensity AND fade-in-out, so silence truly hides the ring.
      const baseRadius = baseR * loudnessScale * fadeInOut;
      // Transient pulse adds on top (also gated by fadeInOut).
      const weight = 0.6 + lagT * 0.6;
      this.rings[i].radius = baseRadius + transient * 0.1 * weight * fadeInOut;
      this.rings[i].energy = transient;
      // Thickness and glow also scale with the macro envelope.
      const macro = 0.5 + loudnessScale * 0.5;
      this.rings[i].thickness = (0.005 + transient * 0.015) * macro * fadeInOut;
      this.rings[i].glow = (0.04 + transient * 0.12) * macro * fadeInOut;
    }
  }
}

/**
 * Beat pulse system — global rhythmic signal that visual elements subscribe to.
 *
 * Provides:
 * - phasePulse: continuous 0→1 sawtooth synced to beat (for breathing)
 * - onsetFlash: sharp spike on beat onset (for impact)
 * - pulseEase: smoothed sine-shaped version of phase (for organic motion)
 * - energyPulse: energy-driven pulse for non-rhythmic music
 */

export class BeatPulse {
  /** 0–1 sawtooth synced to beat phase. */
  phasePulse = 0;
  /** Sharp flash on beat onset, fast decay. */
  onsetFlash = 0;
  /** Smooth sine-shaped beat breathing. */
  pulseEase = 0;
  /** Energy-driven pulse (fallback when beat confidence is low). */
  energyPulse = 0;

  private lastEnergy = 0;

  update(beatPhase: number, beatOnset: boolean, dt: number, beatConfidence = 0.5, instantEnergy = 0): void {
    this.phasePulse = beatPhase;

    // Sine-shaped ease for organic breathing
    const beatEase = 0.5 + 0.5 * Math.cos(beatPhase * Math.PI * 2);

    // Energy-derived pulse for non-rhythmic audio
    const energyDelta = instantEnergy - this.lastEnergy;
    this.lastEnergy = instantEnergy;
    if (energyDelta > 0.02) {
      this.energyPulse = Math.min(1, this.energyPulse + energyDelta * 3);
    } else {
      this.energyPulse *= Math.exp(-dt / 0.15);
    }

    // Blend between beat-locked and energy-driven based on confidence
    const conf = Math.min(1, beatConfidence * 1.5); // boost slightly
    this.pulseEase = beatEase * conf + this.energyPulse * (1 - conf);

    // Sharp flash on onset, exponential decay
    if (beatOnset) {
      this.onsetFlash = 1.0;
    } else if (energyDelta > 0.05 && beatConfidence < 0.3) {
      // Energy spike flash for non-rhythmic music
      this.onsetFlash = Math.max(this.onsetFlash, energyDelta * 4);
    }
    this.onsetFlash *= Math.exp(-dt / 0.08);
    if (this.onsetFlash < 0.001) this.onsetFlash = 0;
  }
}

/**
 * Flash safety (WCAG 2.3.1: no more than three flashes in any one second).
 *
 * Two layers:
 *  1. `request()` — styles ask before a deliberate flash (inversion cut,
 *     glitch strobe, drop flash). At most FLASHES_PER_SECOND are granted in
 *     any rolling second, with a minimum gap between them.
 *  2. `observe()` — the renderer feeds the measured mean luminance of each
 *     frame (async GPU readback, ~1 frame late). Large swings from any source
 *     (beat pulses, cuts, strobes) are counted; if the limit is reached the
 *     guard engages `damping` for a while, and the composite pulls each frame
 *     toward the running luminance so further swings stay small.
 */

// ── Tuning ──────────────────────────────────────────────────────
const FLASHES_PER_SECOND = 3;
/** Minimum time between granted deliberate flashes (s). */
const MIN_GAP_S = 0.25;
/** A luminance rise of at least this much (0–1) counts as a flash. */
const FLASH_DELTA = 0.1;
/** Window used to find the trough before a rise (s). */
const TROUGH_WINDOW_S = 0.3;
/** How long damping stays engaged after the limit is hit (s). */
const DAMP_HOLD_S = 1.2;
/** How fast damping ramps in / out (per second). */
const DAMP_RATE_IN = 12;
const DAMP_RATE_OUT = 2;
/** Running-luminance follower time constant (s). */
const RUNNING_TAU = 0.6;

export class FlashGuard {
  private granted: number[] = [];
  private measured: number[] = [];
  private history: { t: number; l: number }[] = [];
  private armed = true;
  private dampUntil = -Infinity;
  private damp = 0;
  private running = 0;
  private last = 0;
  private time = 0;

  /** 0–1: how strongly the composite holds luminance steady right now. */
  get damping(): number { return this.damp; }
  /** Running mean luminance the composite steers toward while damping. */
  get target(): number { return this.running; }
  /** Latest measured luminance (one frame or so late). */
  get current(): number { return this.last; }
  /** Large flashes measured in the last second. */
  get recentFlashes(): number { return this.measured.length; }
  /** True while deliberate flashes are being refused. */
  get limited(): boolean { return this.time < this.dampUntil; }

  /** Ask for a deliberate flash; returns whether it may happen now. */
  request(): boolean {
    const t = this.time;
    this.granted = this.granted.filter((g) => t - g < 1);
    const lastGrant = this.granted[this.granted.length - 1] ?? -Infinity;
    if (this.limited || this.granted.length + this.measured.length >= FLASHES_PER_SECOND || t - lastGrant < MIN_GAP_S) {
      return false;
    }
    this.granted.push(t);
    return true;
  }

  /** Advance time (every rendered frame). */
  tick(dt: number): void {
    this.time += dt;
    const engaged = this.time < this.dampUntil;
    const rate = engaged ? DAMP_RATE_IN : -DAMP_RATE_OUT;
    this.damp = Math.min(1, Math.max(0, this.damp + rate * dt));
  }

  /** Feed a measured mean luminance (0–1) of the displayed frame. */
  observe(luma: number): void {
    const t = this.time;
    this.last = luma;
    this.running += (1 - Math.exp(-1 / 60 / RUNNING_TAU)) * (luma - this.running);
    this.history.push({ t, l: luma });
    while (this.history.length && t - this.history[0].t > TROUGH_WINDOW_S) this.history.shift();
    this.measured = this.measured.filter((m) => t - m < 1);
    let trough = Infinity;
    for (const h of this.history) trough = Math.min(trough, h.l);
    // Count each rise once; re-arm after the level comes back down.
    if (this.armed && luma - trough >= FLASH_DELTA) {
      this.measured.push(t);
      this.armed = false;
      if (this.measured.length >= FLASHES_PER_SECOND) this.dampUntil = t + DAMP_HOLD_S;
    } else if (!this.armed && luma - trough < FLASH_DELTA * 0.5) {
      this.armed = true;
    }
  }
}

/**
 * Harness switches, read every frame by the code that uses them.
 *
 *   inkExp      Harness-only experiment knobs (one factor at a time).
 */
export interface DebugFlags {
  inkExp: Record<string, number>;
  /** Harness: hold auto exposure at 1. Its measurement is an async GPU
   * readback that lands after a wall-clock delay, so in offline renders (as
   * fast as possible, any step size) its timing depends on the render rate. */
  fixedExposure: boolean;
}

export const debugFlags: DebugFlags = { inkExp: {}, fixedExposure: false };

export function setDebugFlags(f: Partial<DebugFlags>): void {
  if (f.inkExp) debugFlags.inkExp = { ...f.inkExp };
  if (f.fixedExposure !== undefined) debugFlags.fixedExposure = f.fixedExposure;
}

/** Experiment knob value (harness), or `fallback` when unset. */
export function inkExp(name: string, fallback: number): number {
  const v = debugFlags.inkExp[name];
  return v === undefined ? fallback : v;
}

/**
 * Temporary A/B switches, read every frame by the code that uses them.
 *
 *   inkLegacy   Ink's behaviour before the smoothness fix (DOCS/SPRINT-LOG
 *               "Ink smoothness fix"): frame-counted landing, pending ink at a
 *               fixed spot, one-frame push, full-strength Marble hits with a
 *               mint highlight, bilinear blurred field. Settings › Advanced
 *               exposes it until Abdul signs off; then it is removed.
 *   inkExp      Harness-only experiment knobs (one factor at a time).
 */
export interface DebugFlags {
  inkLegacy: boolean;
  inkExp: Record<string, number>;
  /** Harness: hold auto exposure at 1. Its measurement is an async GPU
   * readback that lands after a wall-clock delay, so in offline renders (as
   * fast as possible, any step size) its timing depends on the render rate. */
  fixedExposure: boolean;
}

export const debugFlags: DebugFlags = { inkLegacy: false, inkExp: {}, fixedExposure: false };

export function setDebugFlags(f: Partial<DebugFlags>): void {
  if (f.inkLegacy !== undefined) debugFlags.inkLegacy = f.inkLegacy;
  if (f.inkExp) debugFlags.inkExp = { ...f.inkExp };
  if (f.fixedExposure !== undefined) debugFlags.fixedExposure = f.fixedExposure;
}

/** Experiment knob value (harness), or `fallback` when unset. */
export function inkExp(name: string, fallback: number): number {
  const v = debugFlags.inkExp[name];
  return v === undefined ? fallback : v;
}

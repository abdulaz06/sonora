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
}

export const debugFlags: DebugFlags = { inkLegacy: false, inkExp: {} };

export function setDebugFlags(f: Partial<DebugFlags>): void {
  if (f.inkLegacy !== undefined) debugFlags.inkLegacy = f.inkLegacy;
  if (f.inkExp) debugFlags.inkExp = { ...f.inkExp };
}

/** Experiment knob value (harness), or `fallback` when unset. */
export function inkExp(name: string, fallback: number): number {
  const v = debugFlags.inkExp[name];
  return v === undefined ? fallback : v;
}

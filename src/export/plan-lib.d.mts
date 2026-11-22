// Types for plan-lib.mjs (the studio page imports it from TypeScript).
export interface Combo { id: string; style: 'ink' | 'silk' | 'wisp' | 'warp' | 'voyage'; variant: string; depth: boolean; label: string }
export type PalettePick = number | 'album' | { hue: number } | { drift: true; index?: number };
export interface Shot { at: number; style: Combo['style']; variant: string; depth: boolean; palette?: PalettePick; camera?: string }
export interface Plan {
  format?: string; song?: string; track?: string; title?: string; artist?: string; genre?: string; name?: string;
  window: { start: number; end: number }; size: [number, number]; fps?: number; quality?: string; supersample?: number; preroll?: number;
  shots: Shot[]; changes?: { at: number; palette?: number }[];
  text?: 'full' | 'intro' | 'none'; labels?: boolean; nowPlaying?: false | number[];
  card?: { at: number; line?: string }; textCards?: { at: number; end: number; text: string }[];
}
export interface Analysis {
  title: string; duration: number; bpm: number; beatPeriod: number; beats: number[]; bars: number[];
  events: { type: string; t: number; strength: number }[]; sections: { section: string; t: number }[];
  suggestions: Record<string, { start: number; end: number; bars: number; score: number; why: string }[]>;
  peaksPerSecond: number; peaks: number[]; fps: number;
  curve: { intensity: number[]; energy: number[]; fade: number[]; bass: number[]; mid: number[]; high: number[]; build: number[]; vocal: number[] };
}
export interface StudioState {
  format: 'song' | 'beatswitch' | 'showcase' | 'tour' | 'album'; song: string; title: string; artist: string; genre?: string; name?: string;
  window: { start: number; end: number }; combo: string; palette: PalettePick; combo2?: string; palette2?: PalettePick; switchAt?: number;
  showcase?: 'palettes' | 'looks'; tour?: { combos: string[]; every: number }; text: 'full' | 'intro' | 'none'; labels: boolean; nowPlaying: boolean;
  size?: [number, number]; camera?: string; camera2?: string;
}
export const COMBOS: Combo[];
export const PALETTE_NAMES: string[];
export function paletteName(p: PalettePick | undefined): string;
export function comboOf(shot: Pick<Shot, 'style' | 'variant' | 'depth'>): Combo | undefined;
export function styleLine(shot: Pick<Shot, 'style' | 'variant' | 'depth' | 'palette'>, withPalette?: boolean): string;
export function shotFor(comboId: string, palette?: PalettePick, camera?: string): Omit<Shot, 'at'>;
export function snapToBar(t: number, bars: number[]): number;
export function barsIn(w: { start: number; end: number }, bars: number[]): number[];
export function cutTimes(w: { start: number; end: number }, bars: number[], events: Analysis['events'], every: number): number[];
export function buildPlan(state: StudioState, analysis: Analysis | null): Plan;
export const LABEL_TIMING: { in: number; hold: number; out: number };
export const TOAST_TIMING: { in: number; hold: number; out: number };

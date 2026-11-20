// Media plan: every thumbnail / preview loop the app (and the landing page)
// ships. Rendered by scripts/media.mjs from the engine in audio time.
//
// Fields
//   name        output base name: <style>, <style>-<look>, <style>-view-<depth|flat>, explain-*, pal-*
//   kind        style | look | view | classic | explain | palette
//   style, look, depth (true/false), light (auto|dark|light), camera (preset id), palette (index)
//   track       generated test track
//   candidates  track times rendered for curation (contact sheet)
//   pick        chosen time (after reviewing the contact sheet)
//   loop        seconds of preview loop rendered from `pick` (0 = still only)
//   sizes       still widths shipped (default [1280, 640])
//   quality     engine quality (default high)
//   resp        responsiveness (default 0.6)

const H = 'house-124';
const T = 'halftime-140';
const D = 'dense-128';

const style = (name, o) => ({ name, kind: 'style', loop: 4, ...o });
const look = (name, o) => ({ name, kind: 'look', loop: 4, ...o });
const view = (name, o) => ({ name, kind: 'view', loop: 0, ...o });

export const PLAN = [
  // ── Style heroes ──
  style('ink', { style: 'ink', look: 'glow', depth: true, track: H, candidates: [26, 38, 47, 52, 56, 61, 66, 72], pick: 66, palette: 3 }),
  style('silk', { style: 'silk', look: 'silk', depth: false, track: H, candidates: [30, 40, 48, 51, 55, 60, 68, 76], pick: 47.5 }),
  style('wisp', { style: 'wisp', look: 'ground', depth: false, track: H, candidates: [30, 40, 48, 51, 55, 60, 68, 76], pick: 51, palette: 2 }),
  style('warp', { style: 'warp', look: 'warp', track: H, palette: 1, candidates: [30, 44, 48, 50, 53, 58, 66, 76], pick: 50 }),
  style('voyage', { style: 'voyage', look: 'void', track: H, candidates: [30, 40, 47, 51, 55, 60, 66, 74], pick: 66, palette: 6 }),

  // ── Looks ──
  look('ink-glow', { style: 'ink', look: 'glow', depth: true, track: H, candidates: [30, 44, 50, 54, 58, 64, 70, 76], pick: 54 }),
  look('ink-marble', { style: 'ink', look: 'marble', depth: true, track: H, candidates: [30, 44, 50, 54, 58, 64, 70, 76], pick: 50, palette: 5 }),
  look('ink-sumi', { style: 'ink', look: 'sumi', depth: true, track: H, candidates: [30, 44, 50, 54, 58, 64, 70, 76], pick: 54 }),
  look('wisp-ground', { style: 'wisp', look: 'ground', depth: true, track: H, candidates: [30, 44, 50, 54, 58, 64, 70, 76], pick: 54, palette: 2 }),
  look('wisp-tunnel', { style: 'wisp', look: 'tunnel', depth: true, track: H, candidates: [30, 44, 50, 54, 58, 64, 70, 76], pick: 50, palette: 3 }),
  look('voyage-void', { loop: 2.5, style: 'voyage', look: 'void', track: H, candidates: [95, 96, 97, 97.5, 98, 98.5], pick: 96 }),
  look('voyage-city', { loop: 3.5, style: 'voyage', look: 'city', track: H, candidates: [86, 88, 90, 92, 94, 96, 98, 100], pick: 94, palette: 5 }),
  look('voyage-ocean', { loop: 3.5, style: 'voyage', look: 'ocean', track: H, candidates: [86, 88, 90, 92, 94, 96, 98, 100], pick: 95 }),

  // ── Views (stills) ──
  view('ink-view-depth', { style: 'ink', look: 'glow', depth: true, track: H, candidates: [44, 54, 64, 72], pick: 64 }),
  view('ink-view-flat', { style: 'ink', look: 'glow', depth: false, track: H, candidates: [44, 54, 64, 72], pick: 64 }),
  view('silk-view-depth', { style: 'silk', look: 'silk', depth: true, track: H, candidates: [44, 54, 64, 72], pick: 44 }),
  view('silk-view-flat', { style: 'silk', look: 'silk', depth: false, track: H, candidates: [44, 54, 64, 72], pick: 44 }),
  view('wisp-view-depth', { style: 'wisp', look: 'ground', depth: true, track: H, candidates: [44, 54, 64, 72], pick: 44, palette: 2 }),
  view('wisp-view-flat', { style: 'wisp', look: 'ground', depth: false, track: H, candidates: [44, 54, 64, 72], pick: 44, palette: 2 }),

  // ── Classic ──
  { name: 'aura', kind: 'classic', style: 'aura', look: 'circle', track: H, candidates: [50, 56, 62, 70], pick: 62, loop: 0, quality: 'medium' },
  { name: 'halo', kind: 'classic', style: 'halo', look: 'soft', track: H, candidates: [50, 56, 62, 70], pick: 70, loop: 0, quality: 'medium' },

  // ── Settings explainers ──
  { name: 'explain-resp-smooth', kind: 'explain', style: 'silk', look: 'silk', depth: false, track: H, candidates: [56], pick: 56, loop: 3, resp: 0, sizes: [640] },
  { name: 'explain-resp-punchy', kind: 'explain', style: 'silk', look: 'silk', depth: false, track: H, candidates: [56], pick: 56, loop: 3, resp: 1, sizes: [640] },
  { name: 'explain-light-dark', kind: 'explain', style: 'ink', look: 'sumi', depth: false, light: 'dark', track: H, candidates: [58], pick: 58, loop: 0, sizes: [640] },
  { name: 'explain-light-light', kind: 'explain', style: 'ink', look: 'sumi', depth: false, light: 'light', track: H, candidates: [58], pick: 58, loop: 0, sizes: [640] },
  { name: 'explain-quality-low', kind: 'explain', style: 'voyage', look: 'void', track: H, candidates: [55], pick: 55, loop: 0, quality: 'low', sizes: [640], crop: 0.5 },
  { name: 'explain-quality-high', kind: 'explain', style: 'voyage', look: 'void', track: H, candidates: [55], pick: 55, loop: 0, quality: 'high', sizes: [640], crop: 0.5 },
  ...['glide', 'horizon', 'planet', 'valley', 'overhead'].map((c) => (
    { name: `explain-cam-${c}`, kind: 'explain', style: 'ink', look: 'glow', depth: true, camera: c, track: H, candidates: [56], pick: 56, loop: 0, sizes: [640] })),
  { name: 'explain-drift-off', kind: 'explain', style: 'ink', look: 'glow', depth: false, track: D, candidates: [40], pick: 40, loop: 0, sizes: [640], palette: 0 },

  // ── Palettes, per style (swatch picker thumbnails) ──
  ...['ink', 'silk', 'wisp', 'warp', 'voyage'].flatMap((s) => Array.from({ length: 9 }, (_, i) => ({
    name: `pal-${s}-${i}`, kind: 'palette', style: s,
    look: { ink: 'glow', silk: 'silk', wisp: 'ground', warp: 'warp', voyage: 'void' }[s],
    depth: s === 'ink', track: H, candidates: [54], pick: 54, loop: 0, sizes: [480], palette: i, quality: 'medium', warmup: 8,
  }))),
];

/** Defaults applied to every entry. */
export function withDefaults(e) {
  return { light: 'auto', palette: 0, quality: 'high', resp: 0.6, sizes: [1280, 640], warmup: 12, ...e };
}

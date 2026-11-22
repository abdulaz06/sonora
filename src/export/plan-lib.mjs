// Reel / trailer / export plans, shared by the app's Export screen
// (src/ui/screens/export.ts), the studio page (src/reel/studio.ts), the
// renderer (render.mjs), the launch templates and the trailer planner. A plan
// is plain JSON: song, window, size, shots (style / look / view / palette from
// a time), palette or look changes, and the overlays.
import { COMBOS } from './combos.mjs';

export { COMBOS };
export const PALETTE_NAMES = ['ocean', 'aurora', 'ember', 'neon', 'crimson', 'solar', 'violet', 'sunset', 'acid'];

/** "ocean", "album colours", "hue 200°", "ocean drift". */
export function paletteName(p) {
  if (p === 'album' || (p && p.album)) return 'album colours';
  if (typeof p === 'number') return PALETTE_NAMES[p] ?? 'ocean';
  if (p && typeof p.hue === 'number') return `hue ${Math.round(p.hue)}°`;
  if (p && p.drift) return `${PALETTE_NAMES[p.index ?? 0]} drift`;
  return 'ocean';
}

/** The combo for a shot (style / look / view). */
export function comboOf(shot) {
  return COMBOS.find((c) => c.style === shot.style && c.variant === shot.variant && c.depth === !!shot.depth)
    ?? COMBOS.find((c) => c.style === shot.style && c.depth === !!shot.depth)
    ?? COMBOS.find((c) => c.style === shot.style);
}

/** House style line: "silk · depth · ocean" (labels drop the palette). */
export function styleLine(shot, withPalette = true) {
  const base = comboOf(shot)?.label ?? shot.style;
  return withPalette ? `${base} · ${paletteName(shot.palette)}` : base;
}

export const shotFor = (comboId, palette = 0, camera) => {
  const c = COMBOS.find((x) => x.id === comboId) ?? COMBOS[0];
  return { style: c.style, variant: c.variant, depth: c.depth, palette, ...(camera ? { camera } : {}) };
};

/** Nearest bar line. */
export function snapToBar(t, bars) {
  let best = bars[0] ?? t, bd = Infinity;
  for (const b of bars) { const d = Math.abs(b - t); if (d < bd) { bd = d; best = b; } }
  return best;
}

export const barsIn = (w, bars) => bars.filter((b) => b >= w.start - 1e-3 && b < w.end - 1e-3);

/** Cut times on bar lines every `every` bars, shifted so a drop inside the window lands on a cut. */
export function cutTimes(w, bars, events, every) {
  const inside = barsIn(w, bars);
  if (!inside.length) return [w.start];
  const drop = events.find((e) => e.type === 'drop' && e.t > w.start + 0.5 && e.t < w.end - 0.5);
  let phase = 0;
  if (drop) { const k = inside.indexOf(snapToBar(drop.t, inside)); if (k >= 0) phase = k % every; }
  const cuts = inside.filter((_, k) => k % every === phase);
  if (cuts[0] > w.start + 1e-3) cuts.unshift(w.start);
  return cuts;
}

/**
 * The studio's formats → a plan.
 * state: { format, song, title, artist, window:{start,end}, combo, palette, combo2, switchAt, showcase:'palettes'|'looks',
 *          tour:{ combos:[ids], every }, text, labels, nowPlaying, size, camera }
 */
export function buildPlan(state, analysis) {
  const w = state.window;
  const bars = analysis?.bars ?? [];
  const events = analysis?.events ?? [];
  const base = {
    format: state.format, song: state.song, title: state.title, artist: state.artist, window: { start: +w.start.toFixed(3), end: +w.end.toFixed(3) },
    size: state.size ?? [1080, 1920], fps: 60, quality: 'high', supersample: 1.333, preroll: 8,
    text: state.text ?? 'full', labels: !!state.labels, nowPlaying: state.nowPlaying ? [+(w.start + 0.4).toFixed(3)] : false,
    genre: state.genre, name: state.name,
  };
  const cam = state.camera;
  const pal = state.format === 'album' ? 'album' : state.palette ?? 0;
  if (state.format === 'beatswitch') {
    const at = snapToBar(state.switchAt ?? (w.start + w.end) / 2, barsIn(w, bars).slice(1));
    return { ...base, shots: [{ at: w.start, ...shotFor(state.combo, pal, cam) }, { at, ...shotFor(state.combo2 ?? 'voyage-void', state.palette2 ?? pal, state.camera2) }] };
  }
  if (state.format === 'showcase') {
    const shot = { at: w.start, ...shotFor(state.combo, pal, cam) };
    const inside = barsIn(w, bars).slice(1);
    if (state.showcase === 'looks') {
      const looks = COMBOS.filter((c) => c.style === shot.style && c.depth === shot.depth);
      return { ...base, shots: inside.reduce((acc, b, k) => { acc.push({ at: b, ...shotFor(looks[(k + 1) % looks.length].id, pal, cam) }); return acc; }, [shot]), labels: base.labels };
    }
    const start = typeof pal === 'number' ? pal : 0;
    return { ...base, shots: [shot], changes: inside.map((b, k) => ({ at: b, palette: (start + k + 1) % PALETTE_NAMES.length })) };
  }
  if (state.format === 'tour') {
    const combos = state.tour?.combos?.length ? state.tour.combos : ['silk-depth', 'ink-glow-depth', 'wisp-tunnel', 'warp', 'voyage-void'];
    const cuts = cutTimes(w, bars, events, state.tour?.every ?? 2);
    return { ...base, shots: cuts.map((at, k) => ({ at, ...shotFor(combos[k % combos.length], pal, combos[k % combos.length].includes('depth') ? 'planet' : undefined) })) };
  }
  // Song / Album colours: one style for the whole window.
  return { ...base, shots: [{ at: w.start, ...shotFor(state.combo, pal, cam) }] };
}

/** Overlay state at time t (studio preview: the same timings render.mjs burns in). */
export const LABEL_TIMING = { in: 0.3, hold: 1.5, out: 0.3 };
export const TOAST_TIMING = { in: 0.45, hold: 5, out: 0.45 };

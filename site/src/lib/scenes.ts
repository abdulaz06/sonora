/**
 * What each live section of the landing page shows. Words come from the app's
 * catalog (src/app/catalog.ts); media names are the app's `npm run media` files.
 */
import type { StyleId } from '../../../src/styles/visual-style';
import type { Scene } from './stage';
import { mediaFor } from '../../../src/app/catalog';

export interface Option { label: string; title: string; scene: Scene; media: string }
export interface StyleScenes { groupLabel: string; options: Option[]; initial: number }

export const HERO_SCENE: Scene = { style: 'ink', variant: 'glow', depth: true };
/** Where the hero starts in the demo (s): the groove is in, the build is coming. */
export const HERO_START_S = 12;
/** Longest the shader warm-up may take before the page goes live anyway (ms). */
export const PREWARM_TIMEOUT_MS = 15000;
/** Seconds rendered (hidden) before the canvas fades in over the poster. */
export const HERO_WARM_S = 4;

export const SCENES: Record<Exclude<StyleId, 'aura' | 'halo'>, StyleScenes> = {
  ink: {
    groupLabel: 'look · view', initial: 1,
    options: [
      { label: 'Glow', title: 'Glowing colour on black', scene: { style: 'ink', variant: 'glow', depth: true }, media: 'ink-glow' },
      { label: 'Marble', title: 'Two-tone marbling with a fine grain', scene: { style: 'ink', variant: 'marble', depth: true }, media: 'ink-marble' },
      { label: 'Sumi', title: 'Black ink dropped on bone paper', scene: { style: 'ink', variant: 'sumi', depth: true }, media: 'ink-sumi' },
      { label: 'Flat', title: 'Look straight down at it, like a canvas', scene: { style: 'ink', variant: 'glow', depth: false }, media: 'ink-view-flat' },
    ],
  },
  silk: {
    groupLabel: 'view', initial: 0,
    options: [
      { label: 'Flat', title: 'Threads flowing across a flat black canvas', scene: { style: 'silk', variant: 'silk', depth: false }, media: 'silk' },
      { label: 'Depth', title: 'The threads float as sheets above a ground you glide over', scene: { style: 'silk', variant: 'silk', depth: true }, media: 'silk-view-depth' },
    ],
  },
  wisp: {
    groupLabel: 'view · look', initial: 2,
    options: [
      { label: 'Flat', title: 'The flames on a flat black canvas', scene: { style: 'wisp', variant: 'ground', depth: false }, media: 'wisp' },
      { label: 'Ground', title: 'Flames over a dark plain, lighting the ground', scene: { style: 'wisp', variant: 'ground', depth: true }, media: 'wisp-ground' },
      { label: 'Tunnel', title: 'Chase the flames down an endless tunnel', scene: { style: 'wisp', variant: 'tunnel', depth: true }, media: 'wisp-tunnel' },
    ],
  },
  warp: {
    groupLabel: 'one look', initial: 0,
    options: [
      { label: 'Warp', title: 'Stars streaking past at hyperspace speed', scene: { style: 'warp', variant: 'warp', depth: false }, media: 'warp' },
    ],
  },
  voyage: {
    groupLabel: 'look', initial: 1,
    options: [
      { label: 'Void', title: 'The fractal floating in a starry sky', scene: { style: 'voyage', variant: 'void', depth: false }, media: 'voyage-void' },
      { label: 'City', title: 'A curved world of cities wraps around it', scene: { style: 'voyage', variant: 'city', depth: false }, media: 'voyage-city' },
      { label: 'Ocean', title: 'A world-sized ocean with huge swells', scene: { style: 'voyage', variant: 'ocean', depth: false }, media: 'voyage-ocean' },
    ],
  },
};

/** The palettes section: one visual, recoloured. `media` = its pal-<media>-<n> stills. */
export const PALETTE_SCENE: Scene & { media: string } = { style: 'silk', variant: 'silk', depth: false, media: 'silk' };
/** Seconds each palette holds while cycling. */
export const PALETTE_HOLD_S = 3.6;
/** Custom hue tiles (every 15°, as the palette research swept). */
export const HUES = Array.from({ length: 24 }, (_, i) => i * 15);

/** Every scene the page can show (sections, chips, Set Mode), compiled ahead in a worker.
 * Voyage (≈3 s of compiling) goes later, while no live section is on screen. */
export const PREWARM: Required<Scene>[] = [
  { style: 'ink', variant: 'glow', depth: true },
  { style: 'silk', variant: 'silk', depth: false },
  { style: 'ink', variant: 'marble', depth: true },
  { style: 'wisp', variant: 'tunnel', depth: true },
  { style: 'warp', variant: 'warp', depth: false },
  { style: 'voyage', variant: 'city', depth: false },
  { style: 'ink', variant: 'glow', depth: false },
  { style: 'ink', variant: 'sumi', depth: true },
  { style: 'silk', variant: 'silk', depth: true },
  { style: 'wisp', variant: 'ground', depth: false },
  { style: 'wisp', variant: 'ground', depth: true },
  { style: 'voyage', variant: 'void', depth: false },
  { style: 'voyage', variant: 'ocean', depth: false },
  { style: 'ink', variant: 'marble', depth: false },
  { style: 'ink', variant: 'sumi', depth: false },
];
export const PREWARM_FIRST = PREWARM.filter((s) => s.style !== 'voyage');
export const PREWARM_LATER = PREWARM.filter((s) => s.style === 'voyage');

/**
 * Media for a fallback: the app's files (src/assets/media), except where the
 * site has its own. Silk's app loop and still catch its drop inversion (white
 * frames); the site's are cut from the trailer's pre-drop Silk shot.
 */
const SITE_MEDIA: Record<string, { still: string; loop: string }> = {
  silk: { still: '/media/silk-still.webp', loop: '/media/silk-loop.webm' },
};
export function siteMedia(name: string): { still: string; stillSmall: string; loop?: string } {
  const own = SITE_MEDIA[name];
  if (own) return { still: own.still, stillSmall: own.still, loop: own.loop };
  const m = mediaFor(name);
  return { still: m.still, stillSmall: m.stillSmall ?? m.still, loop: m.loop };
}

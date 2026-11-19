/**
 * Catalog: the plain-language words and media for every style, look and view.
 * One vocabulary everywhere (defined in the first-run intro):
 *   style    the kind of visual
 *   look     a variation of a style
 *   view     Depth (3D camera) or Flat (2D canvas)
 *   palette  the colours
 * Media come from `npm run media` (src/assets/media/, names in its manifest).
 */

import type { MediaSrc } from '../ui/ds/components';
import type { StyleId } from '../styles/visual-style';

const FILES = import.meta.glob('../assets/media/*.{webp,webm}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const url = (file: string): string | undefined => FILES[`../assets/media/${file}`];

/** Still (1280 + 640) and loop for a media name; falls back to `fallback`'s files. */
export function mediaFor(name: string, fallback?: string): MediaSrc {
  const still = url(`${name}-1280.webp`) ?? url(`${name}-640.webp`) ?? url(`${name}-480.webp`);
  if (!still && fallback && fallback !== name) return mediaFor(fallback);
  return {
    still: still ?? '',
    stillSmall: url(`${name}-640.webp`) ?? url(`${name}-480.webp`) ?? still ?? '',
    loop: url(`${name}.webm`),
    alt: '',
  };
}
export const hasMedia = (name: string): boolean => !!(url(`${name}-1280.webp`) ?? url(`${name}-640.webp`) ?? url(`${name}-480.webp`));

export interface LookInfo { id: string; label: string; line: string; media: string; /** Only in the Depth view (Wisp). */ depthOnly?: boolean }
export interface ViewInfo { depth: string; flat: string }
export interface StyleInfo {
  id: StyleId;
  label: string;
  /** One plain line: what you see and what music it suits. */
  line: string;
  /** A longer sentence for the style detail screen. */
  more: string;
  /** Music it suits, as a short tag line. */
  suits: string;
  looks: LookInfo[];
  /** Depth / Flat explanations when the style has both views. */
  views?: ViewInfo;
  /** Heavy on the graphics card. */
  heavy?: boolean;
}

export const STYLE_INFO: Record<StyleId, StyleInfo> = {
  ink: {
    id: 'ink', label: 'Ink',
    line: 'Liquid ink that blooms on every kick and drifts with the melody.',
    more: 'Colour pours into the dark on each beat and streams away along slow currents. Calm enough for an evening, sharp enough for a club.',
    suits: 'anything with a beat',
    looks: [
      { id: 'glow', label: 'Glow', line: 'Glowing colour on black.', media: 'ink-glow' },
      { id: 'marble', label: 'Marble', line: 'Two-tone marbling with a fine grain.', media: 'ink-marble' },
      { id: 'sumi', label: 'Sumi', line: 'Black ink dropped on bone paper.', media: 'ink-sumi' },
    ],
    views: { depth: 'Fly low over the ink as a 3D surface.', flat: 'Look straight down at it, like a canvas.' },
  },
  silk: {
    id: 'silk', label: 'Silk',
    line: 'Millions of points of light pulled into flowing threads.',
    more: 'Threads gather and twist with the bass and flare on every hit; builds tie them into a knot that bursts on the drop.',
    suits: 'house, techno, clean electronic',
    looks: [],
    views: { depth: 'The threads float as sheets above a ground you glide over.', flat: 'Threads flowing across a flat black canvas.' },
  },
  wisp: {
    id: 'wisp', label: 'Wisp',
    line: 'Three flames darting through the dark, shedding smoke rings on the bass.',
    more: 'Small, alive and a little hypnotic. Flat keeps them on a black canvas; Depth gives them a world to fly through.',
    suits: 'slower, moodier music',
    looks: [
      { id: 'ground', label: 'Ground', line: 'Flames over a dark plain, lighting the ground.', media: 'wisp-ground', depthOnly: true },
      { id: 'tunnel', label: 'Tunnel', line: 'Chase the flames down an endless tunnel.', media: 'wisp-tunnel', depthOnly: true },
    ],
    views: { depth: 'Fly with the flames in 3D, over the ground or down a tunnel.', flat: 'The flames on a flat black canvas.' },
  },
  warp: {
    id: 'warp', label: 'Warp',
    line: 'Stars streaking past at hyperspace speed.',
    more: 'Quiet parts hang almost still, builds accelerate, and every drop jumps forward. The simplest style, and the loudest.',
    suits: 'big builds and drops',
    looks: [],
  },
  voyage: {
    id: 'voyage', label: 'Voyage',
    line: 'A flight through an endless 3D fractal, with wide shots of the world outside.',
    more: 'The camera dives through folding fractal space and pulls out in quiet passages to show the world around it.',
    suits: 'long, evolving tracks',
    heavy: true,
    looks: [
      { id: 'void', label: 'Void', line: 'The fractal floating in a starry sky.', media: 'voyage-void' },
      { id: 'city', label: 'City', line: 'A curved world of cities wraps around it.', media: 'voyage-city' },
      { id: 'ocean', label: 'Ocean', line: 'A world-sized ocean with huge swells.', media: 'voyage-ocean' },
    ],
  },
  aura: {
    id: 'aura', label: 'Aura', line: 'The original rings, particles and glow from sonora 0.1.', more: 'Classic.', suits: 'nostalgia',
    looks: [],
  },
  halo: {
    id: 'halo', label: 'Halo', line: 'The original circular spectrum from sonora 0.1.', more: 'Classic.', suits: 'nostalgia',
    looks: [],
  },
};

export const ART_STYLES: StyleId[] = ['ink', 'silk', 'wisp', 'warp', 'voyage'];
export const CLASSIC_STYLES: StyleId[] = ['aura', 'halo'];

/** Media name for what's on screen for a style / look / view. */
export function mediaNameFor(style: StyleId, look: string, depth: boolean): string {
  const info = STYLE_INFO[style];
  // The style heroes are Flat Wisp and Flat Silk (with loops).
  if (style === 'wisp') return depth ? `wisp-${look}` : 'wisp';
  if (style === 'silk' && !depth) return 'silk';
  if (info.looks.length > 0 && info.looks.some((l) => l.id === look)) {
    if (style === 'ink' && !depth) return 'ink-view-flat';
    return `${style}-${look}`;
  }
  if (info.views) return `${style}-view-${depth ? 'depth' : 'flat'}`;
  return style;
}

/** Human summary like "ink · glow · depth". */
export function describe(style: StyleId, look: string, depth: boolean, hasDepth: boolean): string {
  const info = STYLE_INFO[style];
  const parts = [info.label];
  const l = info.looks.find((x) => x.id === look);
  if (l && (!l.depthOnly || depth)) parts.push(l.label);
  if (hasDepth) parts.push(depth ? 'Depth' : 'Flat');
  return parts.join(' · ').toLowerCase();
}

/**
 * Set Mode pieces: every style / look the autopilot can choose (the include
 * list). `energy` places it on the calm (0) → driving (1) scale; `views` are
 * the views it may use.
 */
export interface Piece { id: string; style: StyleId; look: string; label: string; views: ('depth' | 'flat')[]; energy: number; media: string }
export const PIECES: Piece[] = [
  { id: 'ink:glow', style: 'ink', look: 'glow', label: 'Ink · Glow', views: ['depth', 'flat'], energy: 0.45, media: 'ink-glow' },
  { id: 'ink:marble', style: 'ink', look: 'marble', label: 'Ink · Marble', views: ['depth', 'flat'], energy: 0.35, media: 'ink-marble' },
  { id: 'ink:sumi', style: 'ink', look: 'sumi', label: 'Ink · Sumi', views: ['depth', 'flat'], energy: 0.2, media: 'ink-sumi' },
  { id: 'silk', style: 'silk', look: 'silk', label: 'Silk', views: ['flat', 'depth'], energy: 0.75, media: 'silk' },
  { id: 'wisp:flat', style: 'wisp', look: 'ground', label: 'Wisp · Flat', views: ['flat'], energy: 0.35, media: 'wisp-view-flat' },
  { id: 'wisp:ground', style: 'wisp', look: 'ground', label: 'Wisp · Ground', views: ['depth'], energy: 0.25, media: 'wisp-ground' },
  { id: 'wisp:tunnel', style: 'wisp', look: 'tunnel', label: 'Wisp · Tunnel', views: ['depth'], energy: 0.7, media: 'wisp-tunnel' },
  { id: 'warp', style: 'warp', look: 'warp', label: 'Warp', views: ['flat'], energy: 0.9, media: 'warp' },
  { id: 'voyage:void', style: 'voyage', look: 'void', label: 'Voyage · Void', views: ['flat'], energy: 0.55, media: 'voyage-void' },
  { id: 'voyage:city', style: 'voyage', look: 'city', label: 'Voyage · City', views: ['flat'], energy: 0.5, media: 'voyage-city' },
  { id: 'voyage:ocean', style: 'voyage', look: 'ocean', label: 'Voyage · Ocean', views: ['flat'], energy: 0.45, media: 'voyage-ocean' },
];

export const SHORTCUTS: [string[], string][] = [
  [['F'], 'Fullscreen (also F11)'],
  [['Esc'], 'Back / menu'],
  [['H'], 'Hide everything (clean mode)'],
  [['M'], 'Set Mode on / off'],
  [['S'], 'Next style'],
  [['V'], 'Next look or view'],
  [['1–9'], 'Palettes'],
  [['D'], 'Audio signals (advanced)'],
  [['P'], 'Show / hide FPS'],
];

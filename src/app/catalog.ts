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
import { SHOW_12, SHOW_13, STYLES_13 } from './release';

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
    looks: SHOW_12 ? [
      { id: 'silk', label: 'Silk', line: 'Threads flowing on currents.', media: 'silk' },
      { id: 'helix', label: 'Helix', line: 'Threads of light twisting into a double helix; drops unwind it.', media: 'silk-helix' },
    ] : [],
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
  stage: {
    id: 'stage', label: 'Stage',
    line: 'A concert light show: moving beams, lasers and haze, run like a lighting operator would.',
    more: 'A few beams breathe in the quiet, converge and sweep faster through a build, and the whole rig fires on the drop. Breakdowns fall to a curtain of light with one white searchlight.',
    suits: 'EDM, techno, anything that drops',
    looks: [
      { id: 'club', label: 'Club', line: 'A low club ceiling packed with lasers.', media: 'stage-club' },
      { id: 'arena', label: 'Arena', line: 'A huge arena with long beams.', media: 'stage-arena' },
      { id: 'cathedral', label: 'Cathedral', line: 'A tall nave: a curtain of light and a single searchlight.', media: 'stage-cathedral' },
    ],
  },
  cymatics: {
    id: 'cymatics', label: 'Cymatics',
    line: 'Sand on a vibrating plate settling into the patterns of the sound, carved like stone.',
    more: 'The music picks the plate’s note: sand gathers on the still lines and forms mirrored reliefs, jumps on every kick, and leaps into a new, intricate pattern on the drop.',
    suits: 'ambient, cinematic, deep house',
    looks: [
      { id: 'stone', label: 'Stone', line: 'A carved grey relief under a raking light.', media: 'cymatics-stone' },
      { id: 'sand', label: 'Sand', line: 'Warm sand grains on the plate.', media: 'cymatics-sand' },
      { id: 'liquid', label: 'Liquid', line: 'Standing waves on water, with caustic light on the sand below.', media: 'cymatics-liquid' },
    ],
  },
  glass: {
    id: 'glass', label: 'Glass',
    line: 'Glass and chrome forms turning in a studio, bending the light into rainbows.',
    more: 'Blobs of glass merge and split with the bass, every kick ripples their surface, and the drop sets them in a new arrangement. Glints sparkle on the hi-hats.',
    suits: 'downtempo, R&B, polished pop',
    heavy: true,
    looks: [
      { id: 'bubbles', label: 'Bubbles', line: 'Glass blobs that merge and split.', media: 'glass-bubbles' },
      { id: 'fins', label: 'Fins', line: 'A twisting ribbon of coloured glass slats.', media: 'glass-fins' },
      { id: 'chrome', label: 'Chrome', line: 'A field of mirror tubes riding a wave.', media: 'glass-chrome' },
    ],
  },
  cover: {
    id: 'cover', label: 'Cover',
    line: 'The album art of what’s playing becomes the visual, swept into orbits of itself.',
    more: 'Copies of the cover sweep around it on the beat, slice into strips through a build and fall into a tunnel of covers on the drop. Each new song flips in tile by tile. With no cover, it paints its own artwork from your palette.',
    suits: 'any album you love',
    looks: [],
  },
  echo: {
    id: 'echo', label: 'Echo',
    line: 'A dancer made of light, its steps on your beat, trailing echoes of itself.',
    more: 'Real dance moves, retimed so the steps land on the beat. Echoes of the last moments follow the dancer; on the drop they multiply and fan out around it.',
    suits: 'dance, pop, R&B',
    looks: [
      { id: 'glow', label: 'Glow', line: 'Light on black.', media: 'echo-glow' },
      { id: 'trace', label: 'Trace', line: 'Red and violet echoes on a bright ground.', media: 'echo-trace' },
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

/** 1.2 styles (hidden on the deployed website until the release, see release.ts). */
export const NEW_STYLES_12: StyleId[] = ['stage', 'cymatics', 'glass', 'cover', 'echo'].filter((s) => SHOW_13 || !(STYLES_13 as readonly string[]).includes(s)) as StyleId[];
export const ART_STYLES: StyleId[] = ['ink', 'silk', 'wisp', 'warp', 'voyage', ...(SHOW_12 ? NEW_STYLES_12 : [])];
export const CLASSIC_STYLES: StyleId[] = ['aura', 'halo'];

/** Media name for what's on screen for a style / look / view. */
export function mediaNameFor(style: StyleId, look: string, depth: boolean): string {
  const info = STYLE_INFO[style];
  // The style heroes are Flat Wisp and Flat Silk (with loops).
  if (style === 'wisp') return depth ? `wisp-${look}` : 'wisp';
  if (style === 'silk' && look === 'helix') return depth ? 'silk-helix-depth' : 'silk-helix';
  if (style === 'silk' && !depth) return 'silk';
  if (style === 'silk') return 'silk-view-depth';
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
/** 1.2 pieces (calm 0 → driving 1). */
const PIECES_12: Piece[] = [
  { id: 'stage:club', style: 'stage', look: 'club', label: 'Stage · Club', views: ['flat'], energy: 0.9, media: 'stage-club' },
  { id: 'stage:arena', style: 'stage', look: 'arena', label: 'Stage · Arena', views: ['flat'], energy: 0.8, media: 'stage-arena' },
  { id: 'stage:cathedral', style: 'stage', look: 'cathedral', label: 'Stage · Cathedral', views: ['flat'], energy: 0.5, media: 'stage-cathedral' },
  { id: 'cymatics:stone', style: 'cymatics', look: 'stone', label: 'Cymatics · Stone', views: ['flat'], energy: 0.3, media: 'cymatics-stone' },
  { id: 'cymatics:sand', style: 'cymatics', look: 'sand', label: 'Cymatics · Sand', views: ['flat'], energy: 0.35, media: 'cymatics-sand' },
  { id: 'cymatics:liquid', style: 'cymatics', look: 'liquid', label: 'Cymatics · Liquid', views: ['flat'], energy: 0.25, media: 'cymatics-liquid' },
  { id: 'glass:bubbles', style: 'glass', look: 'bubbles', label: 'Glass · Bubbles', views: ['flat'], energy: 0.4, media: 'glass-bubbles' },
  { id: 'glass:fins', style: 'glass', look: 'fins', label: 'Glass · Fins', views: ['flat'], energy: 0.55, media: 'glass-fins' },
  { id: 'glass:chrome', style: 'glass', look: 'chrome', label: 'Glass · Chrome', views: ['flat'], energy: 0.6, media: 'glass-chrome' },
  { id: 'cover', style: 'cover', look: 'cover', label: 'Cover', views: ['flat'], energy: 0.5, media: 'cover' },
  { id: 'echo:glow', style: 'echo', look: 'glow', label: 'Echo · Glow', views: ['flat'], energy: 0.6, media: 'echo-glow' },
  { id: 'echo:trace', style: 'echo', look: 'trace', label: 'Echo · Trace', views: ['flat'], energy: 0.45, media: 'echo-trace' },
];
export const PIECES: Piece[] = [
  { id: 'ink:glow', style: 'ink', look: 'glow', label: 'Ink · Glow', views: ['depth', 'flat'], energy: 0.45, media: 'ink-glow' },
  { id: 'ink:marble', style: 'ink', look: 'marble', label: 'Ink · Marble', views: ['depth', 'flat'], energy: 0.35, media: 'ink-marble' },
  { id: 'ink:sumi', style: 'ink', look: 'sumi', label: 'Ink · Sumi', views: ['depth', 'flat'], energy: 0.2, media: 'ink-sumi' },
  { id: 'silk', style: 'silk', look: 'silk', label: 'Silk', views: ['flat', 'depth'], energy: 0.75, media: 'silk' },
  ...(SHOW_12 ? [{ id: 'silk:helix', style: 'silk' as StyleId, look: 'helix', label: 'Silk · Helix', views: ['flat', 'depth'] as ('flat' | 'depth')[], energy: 0.65, media: 'silk-helix' }] : []),
  { id: 'wisp:flat', style: 'wisp', look: 'ground', label: 'Wisp · Flat', views: ['flat'], energy: 0.35, media: 'wisp-view-flat' },
  { id: 'wisp:ground', style: 'wisp', look: 'ground', label: 'Wisp · Ground', views: ['depth'], energy: 0.25, media: 'wisp-ground' },
  { id: 'wisp:tunnel', style: 'wisp', look: 'tunnel', label: 'Wisp · Tunnel', views: ['depth'], energy: 0.7, media: 'wisp-tunnel' },
  { id: 'warp', style: 'warp', look: 'warp', label: 'Warp', views: ['flat'], energy: 0.9, media: 'warp' },
  { id: 'voyage:void', style: 'voyage', look: 'void', label: 'Voyage · Void', views: ['flat'], energy: 0.55, media: 'voyage-void' },
  { id: 'voyage:city', style: 'voyage', look: 'city', label: 'Voyage · City', views: ['flat'], energy: 0.5, media: 'voyage-city' },
  { id: 'voyage:ocean', style: 'voyage', look: 'ocean', label: 'Voyage · Ocean', views: ['flat'], energy: 0.45, media: 'voyage-ocean' },
  ...(SHOW_12 ? PIECES_12.filter((p) => SHOW_13 || !(STYLES_13 as readonly StyleId[]).includes(p.style)) : []),
];

export const SHORTCUTS: [string[], string][] = [
  [['F'], 'Fullscreen (also F11)'],
  [['Esc'], 'Back / menu'],
  [['H'], 'Hide everything (clean mode)'],
  [['M'], 'Set Mode on / off'],
  [['S'], 'Next style'],
  [['V'], 'Next look or view'],
  [['1–9'], 'Palettes'],
  [['A'], 'Album colours on / off'],
  [['R'], 'Controller on a second screen (desktop)'],
  [['E'], 'Export a video from a song (desktop)'],
  [['F9'], 'Record the visual with the sound (desktop)'],
  [['D'], 'Audio signals (advanced)'],
  [['P'], 'Show / hide FPS'],
  ...(SHOW_12 ? [[['G'], 'Filter: none, glyph, reeded glass']] as [string[], string][] : []),
];

/**
 * Style registry — the single list of every style Sonora ships. Add a new
 * style by writing its module and appending a descriptor here.
 */

import { createAuraStyle } from './classic/aura';
import { createHaloStyle } from './classic/halo-spectrum';
import { createInkStyle } from './ink/ink';
import { createSilkStyle, createWarpStyle, createWispStyle } from './strands/strands';
import { createMoshStyle } from './mosh/mosh';
import { createVoyageStyle } from './voyage/voyage';
import { STYLE_VARIANTS, type StyleCategory, type StyleDescriptor, type StyleId } from './visual-style';

export const STYLES: StyleDescriptor[] = [
  {
    id: 'ink', label: 'Ink', category: 'art',
    variants: STYLE_VARIANTS.ink, defaultVariant: 'glow',
    supportsLight: true, supportsDepth: true, defaultDepth: true,
    create: createInkStyle,
  },
  {
    id: 'silk', label: 'Silk', category: 'art',
    variants: STYLE_VARIANTS.silk, defaultVariant: 'silk',
    supportsLight: true, supportsDepth: false, defaultDepth: false,
    create: createSilkStyle,
  },
  {
    id: 'wisp', label: 'Wisp', category: 'art',
    variants: STYLE_VARIANTS.wisp, defaultVariant: 'wisp',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: createWispStyle,
  },
  {
    id: 'warp', label: 'Warp', category: 'art',
    variants: STYLE_VARIANTS.warp, defaultVariant: 'warp',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: createWarpStyle,
  },
  {
    id: 'voyage', label: 'Voyage', category: 'art',
    variants: STYLE_VARIANTS.voyage, defaultVariant: 'voyage',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: createVoyageStyle,
  },
  {
    id: 'mosh', label: 'Mosh', category: 'art',
    variants: STYLE_VARIANTS.mosh, defaultVariant: 'signal',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: createMoshStyle,
  },
  {
    id: 'aura', label: 'Aura', category: 'classic',
    variants: STYLE_VARIANTS.aura, defaultVariant: 'circle',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: createAuraStyle,
  },
  {
    id: 'halo', label: 'Halo', category: 'classic',
    variants: STYLE_VARIANTS.halo, defaultVariant: 'soft',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: createHaloStyle,
  },
];

export const DEFAULT_STYLE: StyleId = 'ink';

export function getStyle(id: StyleId): StyleDescriptor {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

export function isStyleId(v: unknown): v is StyleId {
  return typeof v === 'string' && STYLES.some((s) => s.id === v);
}

/** Styles visible in pickers (classic hidden unless enabled). */
export function visibleStyles(showClassic: boolean, category?: StyleCategory): StyleDescriptor[] {
  return STYLES.filter((s) => (showClassic || s.category !== 'classic') && (!category || s.category === category));
}

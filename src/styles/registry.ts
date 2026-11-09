/**
 * Style registry — the single list of every style Sonora ships. Add a new
 * style by writing its module and appending a descriptor here.
 */

import { createAuraStyle } from './classic/aura';
import { createHaloStyle } from './classic/halo-spectrum';
import { createFlowInkStyle } from './flow-ink/flow-ink';
import { STYLE_VARIANTS, type StyleCategory, type StyleDescriptor, type StyleId } from './visual-style';

export const STYLES: StyleDescriptor[] = [
  {
    id: 'flow-ink', label: 'Flow Ink', category: 'art',
    variants: STYLE_VARIANTS['flow-ink'], defaultVariant: 'ink',
    supportsLight: true, supportsDepth: true, defaultDepth: true,
    create: createFlowInkStyle,
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

export const DEFAULT_STYLE: StyleId = 'flow-ink';

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

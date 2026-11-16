import { CAMERA_PRESETS, type CameraPreset } from '../engine/camera';
/**
 * Style registry — the single list of every style Sonora ships. Add a new
 * style by writing its module and appending a descriptor here.
 */

import { createAuraStyle } from './classic/aura';
import { createHaloStyle } from './classic/halo-spectrum';
import { createInkStyle } from './ink/ink';
import { createSilkStyle, createWarpStyle, createWispStyle } from './strands/strands';
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
    supportsLight: true, supportsDepth: true, defaultDepth: false,
    // Silk's threads reach well past the frame: its Planet looks from higher up.
    cameraPresets: { planet: { height: 0.9, tilt: 0.73, curve: 1 } },
    create: createSilkStyle,
  },
  {
    id: 'wisp', label: 'Wisp', category: 'art',
    variants: STYLE_VARIANTS.wisp, defaultVariant: 'ground',
    supportsLight: false, supportsDepth: true, defaultDepth: false,
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
    variants: STYLE_VARIANTS.voyage, defaultVariant: 'void',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: createVoyageStyle,
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

/** Camera presets for a style (its own views where it has them). */
export function presetsFor(id: StyleId): CameraPreset[] {
  const own = getStyle(id).cameraPresets ?? {};
  return CAMERA_PRESETS.map((p) => ({ ...p, view: { ...(own[p.id] ?? p.view) } }));
}

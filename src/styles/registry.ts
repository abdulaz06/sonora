import { CAMERA_PRESETS, type CameraPreset } from '../engine/camera';
/**
 * Style registry — the single list of every style Sonora ships. Add a new
 * style by writing its module and appending a descriptor here.
 */

import { SHOW_12 } from '../app/release';
import { STYLE_VARIANTS, type StyleCategory, type StyleDeps, type StyleDescriptor, type StyleId, type VisualStyle } from './visual-style';

// Styles (their code and shaders) load on demand: the web page fetches only
// what it shows. The desktop app, the dev page and the harness preload them
// all before the engine starts (preloadStyles), so nothing changes there.
type Factory = (deps: StyleDeps) => VisualStyle;
const LOADERS: Record<StyleId, () => Promise<Factory>> = {
  ink: () => import('./ink/ink').then((m) => m.createInkStyle),
  silk: () => import('./strands/strands').then((m) => m.createSilkStyle),
  wisp: () => import('./strands/strands').then((m) => m.createWispStyle),
  warp: () => import('./strands/strands').then((m) => m.createWarpStyle),
  voyage: () => import('./voyage/voyage').then((m) => m.createVoyageStyle),
  stage: () => import('./stage/stage').then((m) => m.createStageStyle),
  aura: () => import('./classic/aura').then((m) => m.createAuraStyle),
  halo: () => import('./classic/halo-spectrum').then((m) => m.createHaloStyle),
};
const factories: Partial<Record<StyleId, Factory>> = {};
/** 1.2 styles: hidden from pickers on the deployed website until the release (release.ts). */
const UNRELEASED_12: StyleId[] = ['stage'];
const loading: Partial<Record<StyleId, Promise<Factory>>> = {};

/** Load a style's code (once). */
export function loadStyle(id: StyleId): Promise<Factory> {
  const f = factories[id];
  if (f) return Promise.resolve(f);
  loading[id] ??= LOADERS[id]().then((x) => { factories[id] = x; return x; });
  return loading[id]!;
}

/** Whether a style's code is here (the engine can build it at once). */
export const styleLoaded = (id: StyleId): boolean => !!factories[id];

/** Load several styles (default: all). */
export async function preloadStyles(ids: StyleId[] = Object.keys(LOADERS) as StyleId[]): Promise<void> {
  await Promise.all(ids.map((id) => loadStyle(id)));
}

const lazy = (id: StyleId) => (deps: StyleDeps): VisualStyle => {
  const f = factories[id];
  if (!f) throw new Error(`style ${id} isn't loaded yet`);
  return f(deps);
};

export const STYLES: StyleDescriptor[] = [
  {
    id: 'ink', label: 'Ink', category: 'art',
    variants: STYLE_VARIANTS.ink, defaultVariant: 'glow',
    supportsLight: true, supportsDepth: true, defaultDepth: true,
    create: lazy('ink'),
  },
  {
    id: 'silk', label: 'Silk', category: 'art',
    variants: STYLE_VARIANTS.silk, defaultVariant: 'silk',
    supportsLight: true, supportsDepth: true, defaultDepth: false,
    // Silk's threads reach well past the frame: its Planet looks from higher up.
    cameraPresets: { planet: { height: 0.9, tilt: 0.73, curve: 1 } },
    create: lazy('silk'),
  },
  {
    id: 'wisp', label: 'Wisp', category: 'art',
    variants: STYLE_VARIANTS.wisp, defaultVariant: 'ground',
    supportsLight: false, supportsDepth: true, defaultDepth: false,
    create: lazy('wisp'),
  },
  {
    id: 'warp', label: 'Warp', category: 'art',
    variants: STYLE_VARIANTS.warp, defaultVariant: 'warp',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: lazy('warp'),
  },
  {
    id: 'voyage', label: 'Voyage', category: 'art',
    variants: STYLE_VARIANTS.voyage, defaultVariant: 'void',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: lazy('voyage'),
  },
  {
    id: 'stage', label: 'Stage', category: 'art',
    variants: STYLE_VARIANTS.stage, defaultVariant: 'club',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: lazy('stage'),
  },
  {
    id: 'aura', label: 'Aura', category: 'classic',
    variants: STYLE_VARIANTS.aura, defaultVariant: 'circle',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: lazy('aura'),
  },
  {
    id: 'halo', label: 'Halo', category: 'classic',
    variants: STYLE_VARIANTS.halo, defaultVariant: 'soft',
    supportsLight: false, supportsDepth: false, defaultDepth: false,
    create: lazy('halo'),
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
  return STYLES.filter((s) => (showClassic || s.category !== 'classic') && (!category || s.category === category) && (SHOW_12 || !UNRELEASED_12.includes(s.id)));
}

/** Camera presets for a style (its own views where it has them). */
export function presetsFor(id: StyleId): CameraPreset[] {
  const own = getStyle(id).cameraPresets ?? {};
  return CAMERA_PRESETS.map((p) => ({ ...p, view: { ...(own[p.id] ?? p.view) } }));
}

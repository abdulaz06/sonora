/**
 * Glyph atlas for the Glyph filter: characters drawn once with the bundled
 * IBM Plex Mono (OFL) into one row of boxes, white on black, plus each glyph's
 * ink coverage. The density ramp is picked from a candidate set by measured
 * coverage (evenly spread from the space to the densest glyph); four line
 * glyphs follow it for edges ('-', '/', '|', '\').
 *
 * The font is loaded from its own file (not the page CSS), so the atlas is the
 * same in the app, the web page, the harness and offline exports.
 */

import plexMono600 from '../../assets/fonts/ibm-plex-mono-latin-600-normal.woff2?url';

// ── Tuning ──────────────────────────────────────────────────────
/** One glyph box in the atlas (px). Plex Mono's advance is 0.6 em. */
export const ATLAS_BOX_W = 40;
export const ATLAS_BOX_H = 64;
const FONT_PX = 52;
/** Extra stroke around each glyph (px in the atlas): bolder characters carry more light. */
const EMBOLDEN_PX = 2.2;
/** The density ramp (the space first), sorted by measured coverage at load. */
const RAMP = ' .:-=+*xoaeQ8@';
export const DENSITY_LEVELS = RAMP.length;
/** Edge glyphs, by edge direction bin: horizontal, rising, vertical, falling. */
export const EDGE_GLYPHS = ['-', '/', '|', '\\'];

export interface GlyphAtlas {
  /** Canvas with every glyph in one row (density ramp, then the edge glyphs). */
  image: HTMLCanvasElement | OffscreenCanvas;
  /** Glyph count (DENSITY_LEVELS + EDGE_GLYPHS.length). */
  count: number;
  /** Ink coverage (0–1) per glyph. */
  coverage: number[];
  /** The characters, in atlas order (for the record). */
  chars: string;
}

let atlas: GlyphAtlas | null = null;
let loading: Promise<GlyphAtlas> | null = null;

/** The atlas once it's built (null until then). */
export const glyphAtlas = (): GlyphAtlas | null => atlas;

/** Build the atlas (once); resolves when it's ready. */
export function loadGlyphAtlas(): Promise<GlyphAtlas> {
  loading ??= (async () => {
    const family = 'SonoraGlyphMono';
    try {
      const face = new FontFace(family, `url(${plexMono600})`, { weight: '600' });
      await face.load();
      (typeof document !== 'undefined' ? document.fonts : (self as unknown as { fonts: FontFaceSet }).fonts).add(face);
    } catch {
      // Falls back to the system monospace font below.
    }
    atlas = build(`600 ${FONT_PX}px ${family}, "IBM Plex Mono", Consolas, monospace`);
    return atlas;
  })();
  return loading;
}

function canvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function draw(font: string, chars: string): { image: HTMLCanvasElement | OffscreenCanvas; coverage: number[] } {
  const w = ATLAS_BOX_W * chars.length, h = ATLAS_BOX_H;
  const image = canvas(w, h);
  const g = image.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineWidth = EMBOLDEN_PX;
  g.lineJoin = 'round';
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < chars.length; i++) {
    g.fillText(chars[i], (i + 0.5) * ATLAS_BOX_W, h * 0.54);
    g.strokeText(chars[i], (i + 0.5) * ATLAS_BOX_W, h * 0.54);
  }
  const px = g.getImageData(0, 0, w, h).data;
  const coverage: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    let sum = 0;
    for (let y = 0; y < h; y++) for (let x = i * ATLAS_BOX_W; x < (i + 1) * ATLAS_BOX_W; x++) sum += px[(y * w + x) * 4];
    coverage.push(sum / (255 * ATLAS_BOX_W * h));
  }
  return { image, coverage };
}

function build(font: string): GlyphAtlas {
  // Order the ramp by measured coverage (fonts differ a little), edges after it.
  const probe = draw(font, RAMP);
  const ramp = [...RAMP].map((c, i) => ({ c, cov: probe.coverage[i] })).sort((a, b) => a.cov - b.cov).map((r) => r.c).join('');
  const chars = ramp + EDGE_GLYPHS.join('');
  const { image, coverage } = draw(font, chars);
  return { image, count: chars.length, coverage, chars };
}

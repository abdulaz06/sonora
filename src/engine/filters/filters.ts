/**
 * Filters: a global post-process over any art style (Settings › Filter), drawn
 * after the composite, so it is in the app, exports, recordings and the web.
 *
 *   glyph    the picture redrawn as characters (density by brightness, edges
 *            as line glyphs, the picture's own colours); two passes: one texel
 *            per cell picks a glyph with hysteresis (no shimmer), then every
 *            pixel draws its cell's glyph from the atlas
 *   reeded   the picture through ribbed glass (per-flute refraction, slight
 *            per-flute blur and dispersion, highlight line, grooves);
 *            vertical, angled or radial flutes
 *
 * New renderers take the current default (`setDefaultFilter`), so exports and
 * previews follow the user's filter without being told.
 */

import { buildProgram } from '../gl-utils';
import type { ResolvedPalette } from '../color-engine';
import { ATLAS_BOX_H, ATLAS_BOX_W, DENSITY_LEVELS, glyphAtlas, loadGlyphAtlas, type GlyphAtlas } from './glyph-atlas';

import fullscreenVert from '../shaders/fullscreen.vert?raw';
import cellsFrag from './shaders/glyph-cells.frag?raw';
import drawFrag from './shaders/glyph-draw.frag?raw';
import reededFrag from './shaders/reeded.frag?raw';

export type FilterId = 'none' | 'glyph' | 'reeded';
export type GlyphSize = 'small' | 'medium' | 'large';
export type FluteAngle = 'vertical' | 'angled' | 'radial';

export interface FilterSettings {
  id: FilterId;
  glyphSize: GlyphSize;
  /** Rib width, 0 (very fine: the default and the narrowest) to 1 (wide). */
  fluteWidth: number;
  fluteAngle: FluteAngle;
}

export const DEFAULT_FILTER: FilterSettings = { id: 'none', glyphSize: 'medium', fluteWidth: 0, fluteAngle: 'radial' };

// ── Tuning ──────────────────────────────────────────────────────
/** Character cell height (px) at 1080 px on the frame's short side; width = height × GLYPH_ASPECT. */
export const GLYPH_CELL_PX: Record<GlyphSize, number> = { small: 10, medium: 14, large: 20 };
const GLYPH_ASPECT = ATLAS_BOX_W / ATLAS_BOX_H;
/** Extra band (in density levels) a cell's brightness must cross before its glyph changes. */
const GLYPH_HYST = 0.4;
/** Edge strength that switches a cell to a line glyph, and back off. */
const GLYPH_EDGE: [number, number] = [0.38, 0.24];
/** Share of the cell colour drawn behind the glyphs. */
const GLYPH_FILL = 0.1;
/** Rib width (px at 1080 px on the short side): very fine at 0, wide at 1 (more of the slider for the fine end). */
const FLUTE_PX: [number, number] = [9, 72];
export const flutePx = (w: number): number => FLUTE_PX[0] + (FLUTE_PX[1] - FLUTE_PX[0]) * Math.pow(Math.min(1, Math.max(0, w)), 1.6);
/** Named widths (harness, older saves). */
export const FLUTE_NAMED: Record<string, number> = { fine: 0, medium: 0.45, wide: 1 };
/** Angled flutes: tilt from vertical (rad). */
const FLUTE_ANGLE = (20 * Math.PI) / 180;

let defaultFilter: FilterSettings = { ...DEFAULT_FILTER };
/** The filter new renderers start with (the app sets it with the user's choice). */
export const getDefaultFilter = (): FilterSettings => ({ ...defaultFilter });
export function setDefaultFilter(f: FilterSettings): void { defaultFilter = { ...f }; }

/** Resolves when every filter can draw (the glyph atlas is built). Harness and exports await it. */
export const filtersReady = (): Promise<unknown> => loadGlyphAtlas();

interface Rt { fb: WebGLFramebuffer; tex: WebGLTexture[]; w: number; h: number }

function target(gl: WebGL2RenderingContext, w: number, h: number, internal: number, n = 1, filter: number = gl.LINEAR): Rt {
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const tex: WebGLTexture[] = [];
  const bufs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    tex.push(t);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  }
  gl.drawBuffers(bufs);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h };
}

function drop(gl: WebGL2RenderingContext, t: Rt | null): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  for (const x of t.tex) gl.deleteTexture(x);
}

type U = Record<string, WebGLUniformLocation | null>;
function locs(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): U {
  const u: U = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return u;
}

export interface FilterFrame {
  palette: ResolvedPalette;
  light: boolean;
  /** Bass-hit envelope (0–1): Glyph's characters answer each kick on the hit frame. */
  pulse: number;
}

export class FilterPass {
  private gl: WebGL2RenderingContext;
  private quadVAO: WebGLVertexArrayObject;
  private src: Rt | null = null;
  private progs: { cells: WebGLProgram; draw: WebGLProgram; reeded: WebGLProgram } | null = null;
  private u: { cells: U; draw: U; reeded: U } | null = null;
  private cells: [Rt, Rt] | null = null;
  private cellsReset = true;
  private atlasTex: WebGLTexture | null = null;
  private atlas: GlyphAtlas | null = null;
  private wasGlyph = false;

  constructor(gl: WebGL2RenderingContext, quadVAO: WebGLVertexArrayObject) {
    this.gl = gl;
    this.quadVAO = quadVAO;
    void loadGlyphAtlas();
  }

  /** Whether this filter draws now (the glyph atlas may still be loading). */
  active(f: FilterSettings): boolean {
    if (f.id === 'glyph') return glyphAtlas() !== null;
    return f.id === 'reeded';
  }

  /** The target the composite draws into while a filter is on (output size). */
  input(w: number, h: number): WebGLFramebuffer {
    const gl = this.gl;
    if (!this.src || this.src.w !== w || this.src.h !== h) {
      drop(gl, this.src);
      this.src = target(gl, w, h, gl.RGBA8);
    }
    return this.src.fb;
  }

  private build(): void {
    if (this.progs) return;
    const gl = this.gl;
    const cells = buildProgram(gl, fullscreenVert, cellsFrag);
    const draw = buildProgram(gl, fullscreenVert, drawFrag);
    const reeded = buildProgram(gl, fullscreenVert, reededFrag);
    this.progs = { cells, draw, reeded };
    this.u = {
      cells: locs(gl, cells, ['u_src', 'u_prev', 'u_cell', 'u_res', 'u_levels', 'u_light', 'u_reset', 'u_hyst', 'u_edge']),
      draw: locs(gl, draw, ['u_state', 'u_colour', 'u_atlas', 'u_cell', 'u_count', 'u_levels', 'u_cov', 'u_tint', 'u_paper', 'u_light', 'u_fill', 'u_pulse']),
      reeded: locs(gl, reeded, ['u_src', 'u_res', 'u_w', 'u_mode', 'u_angle', 'u_tint', 'u_light']),
    };
  }

  private ensureAtlas(): GlyphAtlas | null {
    const a = glyphAtlas();
    if (!a) return null;
    if (this.atlas === a && this.atlasTex) return a;
    const gl = this.gl;
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, a.image as TexImageSource);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlasTex = t;
    this.atlas = a;
    return a;
  }

  /** Draw the filtered frame to the canvas (the composite is in `input()`'s target). */
  apply(f: FilterSettings, fr: FilterFrame): void {
    const gl = this.gl;
    const src = this.src;
    if (!src) return;
    this.build();
    const P = this.progs!, U = this.u!;
    const W = src.w, H = src.h;
    const unit = Math.min(W, H) / 1080;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quadVAO);

    if (f.id === 'glyph') {
      const a = this.ensureAtlas();
      if (!a) return;
      const ch = Math.max(6, Math.round(GLYPH_CELL_PX[f.glyphSize] * unit));
      const cw = Math.max(4, Math.round(ch * GLYPH_ASPECT));
      const cols = Math.ceil(W / cw), rows = Math.ceil(H / ch);
      if (!this.cells || this.cells[0].w !== cols || this.cells[0].h !== rows) {
        if (this.cells) { drop(gl, this.cells[0]); drop(gl, this.cells[1]); }
        this.cells = [target(gl, cols, rows, gl.RGBA16F, 2, gl.NEAREST), target(gl, cols, rows, gl.RGBA16F, 2, gl.NEAREST)];
        this.cellsReset = true;
      }
      if (!this.wasGlyph) this.cellsReset = true;
      const [prev, next] = this.cells;
      // Pass 1: cells.
      gl.bindFramebuffer(gl.FRAMEBUFFER, next.fb);
      gl.viewport(0, 0, cols, rows);
      gl.useProgram(P.cells);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex[0]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex[0]);
      gl.uniform1i(U.cells.u_src, 0);
      gl.uniform1i(U.cells.u_prev, 1);
      gl.uniform2f(U.cells.u_cell, cw, ch);
      gl.uniform2f(U.cells.u_res, W, H);
      gl.uniform1f(U.cells.u_levels, DENSITY_LEVELS);
      gl.uniform1f(U.cells.u_light, fr.light ? 1 : 0);
      gl.uniform1f(U.cells.u_reset, this.cellsReset ? 1 : 0);
      gl.uniform1f(U.cells.u_hyst, GLYPH_HYST);
      gl.uniform2f(U.cells.u_edge, GLYPH_EDGE[0], GLYPH_EDGE[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.cellsReset = false;
      this.cells = [next, prev];
      // Pass 2: draw to the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(P.draw);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, next.tex[0]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, next.tex[1]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform1i(U.draw.u_state, 0);
      gl.uniform1i(U.draw.u_colour, 1);
      gl.uniform1i(U.draw.u_atlas, 2);
      gl.uniform2f(U.draw.u_cell, cw, ch);
      gl.uniform1f(U.draw.u_count, a.count);
      gl.uniform1f(U.draw.u_levels, DENSITY_LEVELS);
      const cov = new Float32Array(24);
      cov.set(a.coverage.slice(0, 24));
      gl.uniform1fv(U.draw.u_cov, cov);
      gl.uniform3fv(U.draw.u_tint, fr.palette.highlight);
      gl.uniform3fv(U.draw.u_paper, fr.palette.paper);
      gl.uniform1f(U.draw.u_light, fr.light ? 1 : 0);
      gl.uniform1f(U.draw.u_fill, GLYPH_FILL);
      gl.uniform1f(U.draw.u_pulse, Math.min(1, Math.max(0, fr.pulse)));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.wasGlyph = true;
    } else if (f.id === 'reeded') {
      this.wasGlyph = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(P.reeded);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex[0]);
      gl.uniform1i(U.reeded.u_src, 0);
      gl.uniform2f(U.reeded.u_res, W, H);
      gl.uniform1f(U.reeded.u_w, Math.max(6, flutePx(f.fluteWidth) * unit));
      gl.uniform1i(U.reeded.u_mode, f.fluteAngle === 'radial' ? 2 : 0);
      gl.uniform1f(U.reeded.u_angle, f.fluteAngle === 'angled' ? FLUTE_ANGLE : 0);
      gl.uniform3fv(U.reeded.u_tint, fr.palette.highlight);
      gl.uniform1f(U.reeded.u_light, fr.light ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    for (let i = 2; i >= 0; i--) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.bindVertexArray(null);
  }

  /** The filter is off: forget glyph history (the next glyph frame starts fresh). */
  idle(): void { this.wasGlyph = false; }

  dispose(): void {
    const gl = this.gl;
    drop(gl, this.src);
    if (this.cells) { drop(gl, this.cells[0]); drop(gl, this.cells[1]); }
    if (this.atlasTex) gl.deleteTexture(this.atlasTex);
    if (this.progs) { gl.deleteProgram(this.progs.cells); gl.deleteProgram(this.progs.draw); gl.deleteProgram(this.progs.reeded); }
  }
}

/**
 * Small GL toolkit shared by the art styles: render targets, ping-pong
 * pairs, programs with `//#include name` chunks and automatic uniform maps,
 * and a typed uniform setter.
 */

import { buildProgram } from '../../engine/gl-utils';

export interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture[];
  w: number;
  h: number;
}

export interface TargetOpts {
  internal?: number;
  format?: number;
  type?: number;
  filter?: number;
  wrap?: number;
  /** Number of colour attachments (MRT). */
  attachments?: number;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number, o: TargetOpts = {}): Target {
  const internal = o.internal ?? gl.RGBA16F;
  const format = o.format ?? gl.RGBA;
  const type = o.type ?? (internal === gl.RGBA32F || internal === gl.RG32F || internal === gl.R32F ? gl.FLOAT
    : internal === gl.RGBA8 || internal === gl.R8 ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT);
  const filter = o.filter ?? gl.LINEAR;
  const wrap = o.wrap ?? gl.CLAMP_TO_EDGE;
  const n = o.attachments ?? 1;
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const tex: WebGLTexture[] = [];
  const bufs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    tex.push(t);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  }
  gl.drawBuffers(bufs);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  for (const x of t.tex) gl.deleteTexture(x);
}

export function bindTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.viewport(0, 0, t.w, t.h);
}

/** Two targets that swap roles each step. */
export class PingPong {
  read: Target;
  write: Target;
  constructor(private gl: WebGL2RenderingContext, w: number, h: number, o: TargetOpts = {}) {
    this.read = createTarget(gl, w, h, o);
    this.write = createTarget(gl, w, h, o);
  }
  swap(): void {
    const t = this.read;
    this.read = this.write;
    this.write = t;
  }
  dispose(): void {
    deleteTarget(this.gl, this.read);
    deleteTarget(this.gl, this.write);
  }
}

export type Uniforms = Record<string, WebGLUniformLocation | null>;
export interface Program {
  prog: WebGLProgram;
  u: Uniforms;
  /** GL type of each uniform (FLOAT, INT, BOOL, SAMPLER_2D, …). */
  types: Record<string, number>;
}

/** Replace `//#include name` lines with chunks. */
export function withIncludes(src: string, chunks: Record<string, string>): string {
  return src.replace(/^\/\/#include\s+(\w+)\s*$/gm, (_m, name: string) => {
    const c = chunks[name];
    if (c === undefined) throw new Error(`missing shader include ${name}`);
    return c;
  });
}

/** Compile a program and map every active uniform (array names without `[0]`). */
export function makeProgram(gl: WebGL2RenderingContext, vert: string, frag: string, defines = ''): Program {
  const inject = (s: string): string => (defines ? s.replace(/^(#version[^\n]*\n)/, `$1${defines}\n`) : s);
  const prog = buildProgram(gl, inject(vert), inject(frag));
  const u: Uniforms = {};
  const types: Record<string, number> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(prog, info.name);
    types[name] = info.type;
  }
  return { prog, u, types };
}

export type UniformValue = number | boolean | number[] | Float32Array | WebGLTexture;

/**
 * Set uniforms by name, using each uniform's declared GL type: scalars and
 * booleans go to float or int uniforms as declared, arrays of 2/3/4 → vecN
 * (longer arrays → vec4 arrays), textures bind to consecutive units.
 * `ints` is kept for call-site readability; the declared type wins.
 */
export function setUniforms(
  gl: WebGL2RenderingContext,
  p: Program,
  values: Record<string, UniformValue>,
  _ints: string[] = [],
  unit0 = 0,
): void {
  let unit = unit0;
  for (const [k, v] of Object.entries(values)) {
    const loc = p.u[k];
    if (loc === undefined || loc === null) continue;
    if (v instanceof WebGLTexture) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, v);
      gl.uniform1i(loc, unit);
      unit++;
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      const x = typeof v === 'boolean' ? (v ? 1 : 0) : v;
      const t = p.types[k];
      if (t === gl.INT || t === gl.BOOL || t === gl.UNSIGNED_INT) gl.uniform1i(loc, Math.round(x));
      else gl.uniform1f(loc, x);
    } else if (v.length === 2) gl.uniform2fv(loc, v);
    else if (v.length === 3) gl.uniform3fv(loc, v);
    else if (v.length % 4 === 0) gl.uniform4fv(loc, v);
  }
  gl.activeTexture(gl.TEXTURE0);
}

export function drawQuad(gl: WebGL2RenderingContext, quadVAO: WebGLVertexArrayObject): void {
  gl.bindVertexArray(quadVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
}

/** RGB (0–1) → hue in degrees. */
export function rgbHue(c: [number, number, number]): number {
  const [r, g, b] = c;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 1e-5) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

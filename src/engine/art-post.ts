/**
 * Post pipeline for art styles.
 *
 *   scene (RGBA16F, canvas × renderScale)
 *     → prefilter (threshold, half res) → dual-filter down chain → up chain
 *     → composite (bloom, exposure, filmic/none tonemap, vignette, grain) → canvas
 *
 * Bloom only picks up HDR highlights above `PostControls.bloomThreshold`, so
 * ordinary mid-tones stay crisp. Classic styles keep the legacy pipeline in
 * `post-process.ts` so their look does not change.
 */

import { buildProgram } from './gl-utils';
import type { PostControls } from '../styles/visual-style';

import fullscreenVert from './shaders/fullscreen.vert?raw';
import prefilterFrag from './shaders/post/bloom-prefilter.frag?raw';
import downFrag from './shaders/post/bloom-down.frag?raw';
import upFrag from './shaders/post/bloom-up.frag?raw';
import compositeFrag from './shaders/post/composite.frag?raw';

// ── Tuning ──────────────────────────────────────────────────────
const BLOOM_KNEE = 0.35;

export interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number, filter: number = gl.LINEAR): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function uniforms(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): Uniforms {
  const u: Uniforms = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return u;
}

export class ArtPost {
  private gl: WebGL2RenderingContext;
  private scene: Target | null = null;
  private depth: WebGLRenderbuffer | null = null;
  private mips: Target[] = [];
  private levels = 5;
  private outW = 1;
  private outH = 1;

  private prefilter: WebGLProgram;
  private down: WebGLProgram;
  private up: WebGLProgram;
  private composite: WebGLProgram;
  private uPre: Uniforms;
  private uDown: Uniforms;
  private uUp: Uniforms;
  private uComp: Uniforms;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prefilter = buildProgram(gl, fullscreenVert, prefilterFrag);
    this.down = buildProgram(gl, fullscreenVert, downFrag);
    this.up = buildProgram(gl, fullscreenVert, upFrag);
    this.composite = buildProgram(gl, fullscreenVert, compositeFrag);
    this.uPre = uniforms(gl, this.prefilter, ['u_src', 'u_texel', 'u_threshold', 'u_knee']);
    this.uDown = uniforms(gl, this.down, ['u_src', 'u_texel']);
    this.uUp = uniforms(gl, this.up, ['u_src', 'u_texel', 'u_dst_texel']);
    this.uComp = uniforms(gl, this.composite, [
      'u_scene', 'u_bloom', 'u_resolution', 'u_time', 'u_exposure', 'u_bloom_strength',
      'u_grain', 'u_vignette', 'u_tonemap', 'u_flash', 'u_tint',
    ]);
  }

  get sceneWidth(): number { return this.scene?.w ?? 1; }
  get sceneHeight(): number { return this.scene?.h ?? 1; }

  /** (Re)allocate for a scene size, output size and bloom depth. */
  resize(sceneW: number, sceneH: number, outW: number, outH: number, levels: number): void {
    const gl = this.gl;
    this.outW = outW;
    this.outH = outH;
    if (this.scene && this.scene.w === sceneW && this.scene.h === sceneH && levels === this.levels && this.mips.length) return;
    if (this.scene) deleteTarget(gl, this.scene);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
    for (const m of this.mips) deleteTarget(gl, m);
    this.scene = createTarget(gl, sceneW, sceneH);
    // Depth for 3D styles (displaced meshes)
    this.depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, sceneW, sceneH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.levels = levels;
    this.mips = [];
    let w = sceneW, h = sceneH;
    for (let i = 0; i < levels; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this.mips.push(createTarget(gl, w, h));
    }
  }

  bindScene(): void {
    const gl = this.gl;
    const s = this.scene!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
    gl.viewport(0, 0, s.w, s.h);
  }

  apply(quadVAO: WebGLVertexArrayObject, post: PostControls, time: number, tint: number): void {
    const gl = this.gl;
    const scene = this.scene!;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(quadVAO);
    gl.activeTexture(gl.TEXTURE0);

    const useBloom = post.bloom > 0.001;
    if (useBloom) {
      // Prefilter into mip 0
      const m0 = this.mips[0];
      gl.bindFramebuffer(gl.FRAMEBUFFER, m0.fb);
      gl.viewport(0, 0, m0.w, m0.h);
      gl.useProgram(this.prefilter);
      gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.uniform1i(this.uPre.u_src, 0);
      gl.uniform2f(this.uPre.u_texel, 1 / scene.w, 1 / scene.h);
      gl.uniform1f(this.uPre.u_threshold, post.bloomThreshold);
      gl.uniform1f(this.uPre.u_knee, BLOOM_KNEE);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Down chain
      gl.useProgram(this.down);
      gl.uniform1i(this.uDown.u_src, 0);
      for (let i = 1; i < this.mips.length; i++) {
        const src = this.mips[i - 1], dst = this.mips[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(this.uDown.u_texel, 1 / src.w, 1 / src.h);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      // Up chain (additive)
      gl.useProgram(this.up);
      gl.uniform1i(this.uUp.u_src, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.mips.length - 1; i > 0; i--) {
        const src = this.mips[i], dst = this.mips[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(this.uUp.u_texel, 1 / src.w, 1 / src.h);
        gl.uniform2f(this.uUp.u_dst_texel, 1 / dst.w, 1 / dst.h);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disable(gl.BLEND);
    }

    // Composite to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.outW, this.outH);
    gl.useProgram(this.composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(this.uComp.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mips[0].tex);
    gl.uniform1i(this.uComp.u_bloom, 1);
    gl.uniform2f(this.uComp.u_resolution, this.outW, this.outH);
    gl.uniform1f(this.uComp.u_time, time);
    gl.uniform1f(this.uComp.u_exposure, post.exposure);
    gl.uniform1f(this.uComp.u_bloom_strength, useBloom ? post.bloom : 0);
    gl.uniform1f(this.uComp.u_grain, post.grain);
    gl.uniform1f(this.uComp.u_vignette, post.vignette);
    gl.uniform1i(this.uComp.u_tonemap, post.tonemap === 'filmic' ? 0 : 1);
    gl.uniform1f(this.uComp.u_flash, post.flash);
    gl.uniform3f(this.uComp.u_tint, tint, tint, tint);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }
}

/**
 * Post-processing pipeline using framebuffer objects.
 * Chain: Scene FBO → Bloom (H+V blur) → Composite (bloom + grain + vignette + color grade)
 */

interface FBO {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

function createFBO(gl: WebGL2RenderingContext, width: number, height: number): FBO {
  const framebuffer = gl.createFramebuffer()!;
  const texture = gl.createTexture()!;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { framebuffer, texture, width, height };
}

function resizeFBO(gl: WebGL2RenderingContext, fbo: FBO, width: number, height: number): void {
  if (fbo.width === width && fbo.height === height) return;
  fbo.width = width;
  fbo.height = height;
  gl.bindTexture(gl.TEXTURE_2D, fbo.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, null);
}

export interface PostProcessUniforms {
  bloomDirection: WebGLUniformLocation;
  bloomResolution: WebGLUniformLocation;
  bloomTexture: WebGLUniformLocation;
  bloomIntensity: WebGLUniformLocation;
  compScene: WebGLUniformLocation;
  compBloom: WebGLUniformLocation;
  compResolution: WebGLUniformLocation;
  compTime: WebGLUniformLocation;
  compBloomStrength: WebGLUniformLocation;
  compGrainAmount: WebGLUniformLocation;
  compVignetteStrength: WebGLUniformLocation;
  compTint: WebGLUniformLocation;
}

export class PostProcessPipeline {
  private gl: WebGL2RenderingContext;
  private sceneFBO: FBO;
  private bloomFBO1: FBO; // Horizontal blur result
  private bloomFBO2: FBO; // Vertical blur result (final bloom)

  bloomProgram: WebGLProgram;
  compositeProgram: WebGLProgram;
  uniforms: PostProcessUniforms;

  // Tuning
  bloomStrength = 0.4;
  grainAmount = 0.03;
  vignetteStrength = 0.3;

  constructor(
    gl: WebGL2RenderingContext,
    bloomProgram: WebGLProgram,
    compositeProgram: WebGLProgram,
    width: number,
    height: number,
  ) {
    this.gl = gl;
    this.bloomProgram = bloomProgram;
    this.compositeProgram = compositeProgram;

    // Scene at full res, bloom at half res for performance
    this.sceneFBO = createFBO(gl, width, height);
    const bw = Math.max(1, width >> 1);
    const bh = Math.max(1, height >> 1);
    this.bloomFBO1 = createFBO(gl, bw, bh);
    this.bloomFBO2 = createFBO(gl, bw, bh);

    this.uniforms = {
      bloomDirection: gl.getUniformLocation(bloomProgram, 'u_direction')!,
      bloomResolution: gl.getUniformLocation(bloomProgram, 'u_resolution')!,
      bloomTexture: gl.getUniformLocation(bloomProgram, 'u_texture')!,
      bloomIntensity: gl.getUniformLocation(bloomProgram, 'u_intensity')!,
      compScene: gl.getUniformLocation(compositeProgram, 'u_scene')!,
      compBloom: gl.getUniformLocation(compositeProgram, 'u_bloom')!,
      compResolution: gl.getUniformLocation(compositeProgram, 'u_resolution')!,
      compTime: gl.getUniformLocation(compositeProgram, 'u_time')!,
      compBloomStrength: gl.getUniformLocation(compositeProgram, 'u_bloom_strength')!,
      compGrainAmount: gl.getUniformLocation(compositeProgram, 'u_grain_amount')!,
      compVignetteStrength: gl.getUniformLocation(compositeProgram, 'u_vignette_strength')!,
      compTint: gl.getUniformLocation(compositeProgram, 'u_tint')!,
    };
  }

  /** Resize all FBOs to match canvas dimensions. */
  resize(width: number, height: number): void {
    const gl = this.gl;
    resizeFBO(gl, this.sceneFBO, width, height);
    const bw = Math.max(1, width >> 1);
    const bh = Math.max(1, height >> 1);
    resizeFBO(gl, this.bloomFBO1, bw, bh);
    resizeFBO(gl, this.bloomFBO2, bw, bh);
  }

  /** Bind the scene FBO — render all scene content into this. */
  bindSceneFBO(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.framebuffer);
    gl.viewport(0, 0, this.sceneFBO.width, this.sceneFBO.height);
  }

  /** Run the post-processing chain and output to screen.
   *  Call after all scene rendering is done. */
  apply(quadVAO: WebGLVertexArrayObject, time: number, tint: [number, number, number]): void {
    const gl = this.gl;

    // ── Pass 1: Horizontal bloom blur ────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO1.framebuffer);
    gl.viewport(0, 0, this.bloomFBO1.width, this.bloomFBO1.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.bloomProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.texture);
    gl.uniform1i(this.uniforms.bloomTexture, 0);
    gl.uniform2f(this.uniforms.bloomResolution, this.bloomFBO1.width, this.bloomFBO1.height);
    gl.uniform2f(this.uniforms.bloomDirection, 1.0, 0.0);
    gl.uniform1f(this.uniforms.bloomIntensity, 1.5);

    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── Pass 2: Vertical bloom blur ──────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFBO2.framebuffer);
    gl.viewport(0, 0, this.bloomFBO2.width, this.bloomFBO2.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindTexture(gl.TEXTURE_2D, this.bloomFBO1.texture);
    gl.uniform2f(this.uniforms.bloomDirection, 0.0, 1.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // ── Pass 3: Composite to screen ──────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.sceneFBO.width, this.sceneFBO.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.compositeProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.texture);
    gl.uniform1i(this.uniforms.compScene, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomFBO2.texture);
    gl.uniform1i(this.uniforms.compBloom, 1);

    gl.uniform2f(this.uniforms.compResolution, this.sceneFBO.width, this.sceneFBO.height);
    gl.uniform1f(this.uniforms.compTime, time);
    gl.uniform1f(this.uniforms.compBloomStrength, this.bloomStrength);
    gl.uniform1f(this.uniforms.compGrainAmount, this.grainAmount);
    gl.uniform1f(this.uniforms.compVignetteStrength, this.vignetteStrength);
    gl.uniform3fv(this.uniforms.compTint, tint);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }
}

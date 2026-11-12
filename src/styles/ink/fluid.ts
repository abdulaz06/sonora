/**
 * GPU stable-fluids solver on a periodic (toroidal) domain.
 *
 *   velocity  RG16F   simRes²   self-advected, vorticity confinement, curl-noise stirring
 *   pressure  R16F    simRes²   Jacobi iterations, warm-started from the last frame
 *   dye       RGBA16F dyeRes²   MacCormack advection (sharp filaments), per-channel decay
 *   height    RGBA16F simRes²   blurred dye, used for surface height / unsharp masking
 *
 * Dye channels are palette slots, not colours: r = ink A, g = ink B,
 * b = sparkle, a = surface lift. The renderer maps them through the palette,
 * so colour changes and Auto Drift apply to ink already on screen.
 *
 * Splats are instanced quads blended additively into the velocity and dye
 * fields; copies are emitted across the periodic seams.
 */

import { buildProgram } from '../../engine/gl-utils';
import commonSrc from './shaders/common.glsl?raw';
import simSrc from './shaders/sim.glsl?raw';
import splatFragSrc from './shaders/splat.frag?raw';
import splatVertSrc from './shaders/splat.vert?raw';
import fullscreenVertSrc from '../../engine/shaders/fullscreen.vert?raw';

// ── Tuning ──────────────────────────────────────────────────────
/** Most splat instances (incl. seam copies) per step. */
const MAX_INSTANCES = 192;
/** Splat quad half-size in radii (gaussian is ~0 beyond 3). */
const SPLAT_EXTENT = 2.6;
/** Largest sim step (s); longer frames are clamped. */
const MAX_SIM_DT = 1 / 30;
/** Fraction of last frame's pressure kept as the solver's starting guess. */
const PRESSURE_WARM_START = 0.8;
const INSTANCE_FLOATS = 13;
/** Concurrent beat kicks and how fast each fades (s). */
const MAX_KICKS = 8;
const KICK_TAU = 0.09;

export interface Splat {
  /** Domain uv (wrapped automatically). */
  x: number;
  y: number;
  /** Radius in domain uv. */
  radius: number;
  /** Dye added per channel (ink A, ink B, sparkle, lift). */
  dye: [number, number, number, number];
  /** Directional push (sim texels / s). */
  vx: number;
  vy: number;
  /** Outward push (sim texels / s). */
  radial: number;
  /** Tangential push (sim texels / s). */
  swirl: number;
  /** 0 = soft blob, 1 = noisy core with tendrils. */
  detail: number;
  seed: number;
}

export interface FluidParams {
  curlStrength: number;
  /** Velocity damping (1/s). */
  damping: number;
  /** Velocity self-advection dissipation (1/s). */
  velocityDissipation: number;
  /** Curl-noise stirring amplitude (texels/s²). */
  noiseAmp: number;
  /** Curl-noise lattice cells across the domain (integer). */
  noisePeriod: number;
  /** Noise evolution coordinate. */
  noiseZ: number;
  /** Weight of the finer noise octaves (0 = only the base period). */
  noiseDetail: number;
  /** Per-channel dye decay rates (1/s). */
  dyeDissipation: [number, number, number, number];
  /** Per-channel subtractive decay (dye units / s): removes faint haze. */
  dyeFloorDecay: [number, number, number, number];
}

interface Tex {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  size: number;
}

interface Double {
  read: Tex;
  write: Tex;
}

type Prog = { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

function inject(src: string): string {
  return src.replace('//#include common', commonSrc);
}

/** Split sim.glsl into programs at `//#program name` markers. */
function parsePrograms(src: string): Record<string, string> {
  const parts = src.split(/^\/\/#program\s+(\w+)\s*$/m);
  const header = parts[0].replace(/^\/\/.*$/gm, '').trim();
  const out: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = `${header}\n${inject(parts[i + 1])}`;
  return out;
}

export class FluidSim {
  readonly gl: WebGL2RenderingContext;
  simRes = 0;
  dyeRes = 0;
  iterations = 20;

  private progs: Record<string, Prog> = {};
  private splatProg: Prog;
  private quadVAO: WebGLVertexArrayObject;
  private splatVAO: WebGLVertexArrayObject;
  private instanceBuf: WebGLBuffer;
  private instances = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);
  private instanceCount = 0;
  private kicks: { x: number; y: number; r: number; s: number }[] = [];
  private kickData = new Float32Array(MAX_KICKS * 4);

  private vel!: Double;
  private pressure!: Double;
  private dye!: Double;
  private curl!: Tex;
  private div!: Tex;
  private tmp!: Tex;
  private heightTex!: Tex;

  constructor(gl: WebGL2RenderingContext, quadVAO: WebGLVertexArrayObject, simRes: number, dyeRes: number, iterations: number) {
    this.gl = gl;
    this.quadVAO = quadVAO;
    const sources = parsePrograms(simSrc);
    for (const [name, frag] of Object.entries(sources)) this.progs[name] = this.makeProg(fullscreenVertSrc, frag);
    this.splatProg = this.makeProg(splatVertSrc, inject(splatFragSrc));

    // Splat VAO: unit quad corners + per-instance attributes
    this.splatVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.splatVAO);
    const corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);
    const stride = INSTANCE_FLOATS * 4;
    const attrib = (loc: number, size: number, offset: number): void => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attrib(1, 4, 0);
    attrib(2, 4, 4);
    attrib(3, 4, 8);
    attrib(4, 1, 12);
    gl.bindVertexArray(null);

    this.configure(simRes, dyeRes, iterations);
  }

  get dyeTexture(): WebGLTexture { return this.dye.read.tex; }
  get heightTexture(): WebGLTexture { return this.heightTex.tex; }
  get velocityTexture(): WebGLTexture { return this.vel.read.tex; }

  /** (Re)allocate fields, resampling existing content into the new sizes. */
  configure(simRes: number, dyeRes: number, iterations: number): void {
    const gl = this.gl;
    this.iterations = iterations;
    if (simRes === this.simRes && dyeRes === this.dyeRes) return;
    const old = this.simRes ? { vel: this.vel, dye: this.dye } : null;
    const oldOthers = this.simRes ? [this.pressure.read, this.pressure.write, this.curl, this.div, this.tmp, this.heightTex] : [];

    this.vel = { read: this.tex(simRes, gl.RG16F, gl.RG), write: this.tex(simRes, gl.RG16F, gl.RG) };
    this.pressure = { read: this.tex(simRes, gl.R16F, gl.RED), write: this.tex(simRes, gl.R16F, gl.RED) };
    this.curl = this.tex(simRes, gl.R16F, gl.RED);
    this.div = this.tex(simRes, gl.R16F, gl.RED);
    this.heightTex = this.tex(simRes, gl.RGBA16F, gl.RGBA);
    this.dye = { read: this.tex(dyeRes, gl.RGBA16F, gl.RGBA), write: this.tex(dyeRes, gl.RGBA16F, gl.RGBA) };
    this.tmp = this.tex(dyeRes, gl.RGBA16F, gl.RGBA);

    if (old) {
      this.copy(old.vel.read, this.vel.read);
      this.copy(old.dye.read, this.dye.read);
      for (const t of [old.vel.read, old.vel.write, old.dye.read, old.dye.write, ...oldOthers]) this.free(t);
    }
    this.simRes = simRes;
    this.dyeRes = dyeRes;
  }

  /** Queue a splat for the next step. */
  splat(s: Splat): void {
    const e = s.radius * SPLAT_EXTENT;
    const x = ((s.x % 1) + 1) % 1;
    const y = ((s.y % 1) + 1) % 1;
    const xs = [x];
    const ys = [y];
    if (x - e < 0) xs.push(x + 1);
    if (x + e > 1) xs.push(x - 1);
    if (y - e < 0) ys.push(y + 1);
    if (y + e > 1) ys.push(y - 1);
    for (const cx of xs) for (const cy of ys) {
      if (this.instanceCount >= MAX_INSTANCES) return;
      const o = this.instanceCount * INSTANCE_FLOATS;
      const a = this.instances;
      a[o] = cx; a[o + 1] = cy; a[o + 2] = s.radius; a[o + 3] = s.seed;
      a[o + 4] = s.dye[0]; a[o + 5] = s.dye[1]; a[o + 6] = s.dye[2]; a[o + 7] = s.dye[3];
      a[o + 8] = s.vx; a[o + 9] = s.vy; a[o + 10] = s.radial; a[o + 11] = s.swirl;
      a[o + 12] = s.detail;
      this.instanceCount++;
    }
  }

  /**
   * Beat kick: pushes ink outward from (x, y) immediately, fading over ~0.1 s.
   * `radius` in uv, `speed` in uv/s at the start.
   */
  kick(x: number, y: number, radius: number, speed: number): void {
    if (this.kicks.length >= MAX_KICKS) this.kicks.shift();
    this.kicks.push({ x: ((x % 1) + 1) % 1, y: ((y % 1) + 1) % 1, r: radius, s: speed });
  }

  step(rawDt: number, p: FluidParams): void {
    const gl = this.gl;
    const dt = Math.min(rawDt, MAX_SIM_DT);
    const simTexel = 1 / this.simRes;
    const dyeTexel = 1 / this.dyeRes;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // ── Splats (additive, in place) ──
    if (this.instanceCount > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instances, 0, this.instanceCount * INSTANCE_FLOATS);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const sp = this.splatProg;
      gl.useProgram(sp.prog);
      gl.uniform1f(sp.u.u_extent, SPLAT_EXTENT);
      gl.bindVertexArray(this.splatVAO);
      this.target(this.vel.read);
      gl.uniform1i(sp.u.u_mode, 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
      this.target(this.dye.read);
      gl.uniform1i(sp.u.u_mode, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
      gl.disable(gl.BLEND);
      this.instanceCount = 0;
    }

    gl.bindVertexArray(this.quadVAO);

    // ── Curl + forces ──
    this.pass('curl', this.curl, { u_vel: this.vel.read }, { u_texel: [simTexel, simTexel] });
    this.pass('forces', this.vel.write, { u_vel: this.vel.read, u_curl: this.curl }, {
      u_texel: [simTexel, simTexel], u_dt: dt, u_curl_strength: p.curlStrength, u_damping: p.damping,
      u_noise_amp: p.noiseAmp, u_noise_period: p.noisePeriod, u_noise_z: p.noiseZ, u_noise_detail: p.noiseDetail,
    });
    this.swap(this.vel);

    // ── Projection ──
    this.pass('divergence', this.div, { u_vel: this.vel.read }, { u_texel: [simTexel, simTexel] });
    this.pass('scale', this.pressure.write, { u_src: this.pressure.read }, { u_texel: [simTexel, simTexel], u_scale: PRESSURE_WARM_START });
    this.swap(this.pressure);
    for (let i = 0; i < this.iterations; i++) {
      this.pass('pressure', this.pressure.write, { u_pressure: this.pressure.read, u_div: this.div }, { u_texel: [simTexel, simTexel] });
      this.swap(this.pressure);
    }
    this.pass('gradient', this.vel.write, { u_pressure: this.pressure.read, u_vel: this.vel.read }, { u_texel: [simTexel, simTexel] });
    this.swap(this.vel);

    // ── Advection ──
    this.pass('advectVel', this.vel.write, { u_vel: this.vel.read }, {
      u_texel: [simTexel, simTexel], u_dt: dt, u_dissipation: p.velocityDissipation,
    });
    this.swap(this.vel);
    // Fade beat kicks and pack them for the dye pass.
    const fade = Math.exp(-dt / KICK_TAU);
    this.kicks = this.kicks.filter((k) => (k.s *= fade) > 0.004);
    this.kickData.fill(0);
    this.kicks.forEach((k, i) => this.kickData.set([k.x, k.y, k.r, k.s], i * 4));
    const dyeU = {
      u_dye_texel: [dyeTexel, dyeTexel], u_sim_res: this.simRes, u_dt: dt,
      u_dissipation: p.dyeDissipation as number[], u_floor_decay: p.dyeFloorDecay as number[],
    };
    const ap = this.progs.advectDye;
    gl.useProgram(ap.prog);
    gl.uniform4fv(ap.u.u_kicks, this.kickData);
    gl.uniform1i(ap.u.u_kick_count, this.kicks.length);
    this.pass('advectDye', this.tmp, { u_vel: this.vel.read, u_dye: this.dye.read, u_tmp: this.dye.read }, { ...dyeU, u_pass: 0 });
    this.pass('advectDye', this.dye.write, { u_vel: this.vel.read, u_dye: this.dye.read, u_tmp: this.tmp }, { ...dyeU, u_pass: 1 });
    this.swap(this.dye);

    // ── Height / blurred field ──
    this.pass('height', this.heightTex, { u_dye: this.dye.read }, { u_texel: [simTexel, simTexel] });
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of [this.vel.read, this.vel.write, this.pressure.read, this.pressure.write, this.dye.read,
      this.dye.write, this.curl, this.div, this.tmp, this.heightTex]) this.free(t);
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.prog);
    gl.deleteProgram(this.splatProg.prog);
    gl.deleteBuffer(this.instanceBuf);
    gl.deleteVertexArray(this.splatVAO);
  }

  // ── Internals ───────────────────────────────────────────────────
  private makeProg(vert: string, frag: string): Prog {
    const gl = this.gl;
    const prog = buildProgram(gl, vert, frag);
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (info) u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(prog, info.name);
    }
    return { prog, u };
  }

  private tex(size: number, internal: number, format: number): Tex {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, size, size, 0, format, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, size };
  }

  private free(t: Tex): void {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  private target(t: Tex): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, t.fb);
    this.gl.viewport(0, 0, t.size, t.size);
  }

  private swap(d: Double): void {
    const t = d.read;
    d.read = d.write;
    d.write = t;
  }

  private copy(src: Tex, dst: Tex): void {
    const gl = this.gl;
    gl.bindVertexArray(this.quadVAO);
    this.pass('copy', dst, { u_src: src }, { u_texel: [1 / dst.size, 1 / dst.size] });
    gl.bindVertexArray(null);
  }

  private pass(
    name: string,
    out: Tex,
    textures: Record<string, Tex>,
    uniforms: Record<string, number | number[]>,
  ): void {
    const gl = this.gl;
    const p = this.progs[name];
    gl.useProgram(p.prog);
    this.target(out);
    let unit = 0;
    for (const [k, t] of Object.entries(textures)) {
      const loc = p.u[k];
      if (loc === undefined || loc === null) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(loc, unit);
      unit++;
    }
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = p.u[k];
      if (!loc) continue;
      if (typeof v === 'number') {
        if (k === 'u_pass') gl.uniform1i(loc, v);
        else gl.uniform1f(loc, v);
      } else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 4) gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }
}

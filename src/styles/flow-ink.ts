/**
 * Flow Field Ink — fluid/ink simulation driven by audio.
 *
 * Architecture: ping-pong RGBA16F FBOs at low resolution (default 384²).
 * Each frame the sim shader advects the ink density along a curl-noise
 * velocity field, dissipates it slightly, and injects:
 *   - Force impulses on bass hits        (sharp colored splats)
 *   - Ambient ink at mid-band presence   (drizzle that keeps the field alive)
 * Then a render pass upscales to the scene FBO.
 *
 * Driving signals (DOCS/14-MAPPING-LAYER-SPEC.md):
 *   - intensity      → velocity magnitude / turbulence (calm ↔ chaotic)
 *   - bass hits      → force impulses (the "drop" feel)
 *   - mid presence   → ambient ink density
 *   - fade_in_out    → overall alpha + extra dissipation when silent
 */

import { hslToRgb } from '../engine/color-engine';
import { buildProgram } from '../engine/gl-utils';

import flowInkRenderFragSrc from '../engine/shaders/flow-ink-render.frag?raw';
import flowInkSimFragSrc from '../engine/shaders/flow-ink-sim.frag?raw';
import fullscreenVertSrc from '../engine/shaders/fullscreen.vert?raw';

import type { StyleContext, StyleDeps, VisualStyle } from './visual-style';

// Sim resolution — fixed regardless of canvas size for stable behavior.
// 384² is ~150k cells and runs comfortably on integrated GPUs.
const SIM_RES = 384;

// At most 8 force impulses per frame (matches MAX_IMPULSES in the shader).
const MAX_IMPULSES = 8;

interface SimFBO {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

function createSimFBO(gl: WebGL2RenderingContext, size: number): SimFBO {
  const fb = gl.createFramebuffer()!;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // RGBA16F: HDR color + density. Linear filtering so the upscale to
  // screen is smooth and the advection sampling is bilinear.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size, size, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  // Clear to zero so we don't start with garbage.
  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { fb, tex };
}

export function createFlowInkStyle(deps: StyleDeps): VisualStyle {
  const { gl } = deps;

  const simProg = buildProgram(gl, fullscreenVertSrc, flowInkSimFragSrc);
  const renderProg = buildProgram(gl, fullscreenVertSrc, flowInkRenderFragSrc);

  // Sim uniform locations
  const sU = {
    prev: gl.getUniformLocation(simProg, 'u_prev')!,
    resolution: gl.getUniformLocation(simProg, 'u_resolution')!,
    time: gl.getUniformLocation(simProg, 'u_time')!,
    dt: gl.getUniformLocation(simProg, 'u_dt')!,
    intensity: gl.getUniformLocation(simProg, 'u_intensity')!,
    dissipation: gl.getUniformLocation(simProg, 'u_dissipation')!,
    ambientRate: gl.getUniformLocation(simProg, 'u_ambient_rate')!,
    ambientColor: gl.getUniformLocation(simProg, 'u_ambient_color')!,
    fadeInOut: gl.getUniformLocation(simProg, 'u_fade_in_out')!,
    impulseCount: gl.getUniformLocation(simProg, 'u_impulse_count')!,
    impulsePos: gl.getUniformLocation(simProg, 'u_impulse_pos')!,
    impulseColor: gl.getUniformLocation(simProg, 'u_impulse_color')!,
    impulseStrength: gl.getUniformLocation(simProg, 'u_impulse_strength')!,
    impulseRadius: gl.getUniformLocation(simProg, 'u_impulse_radius')!,
    impulseKick: gl.getUniformLocation(simProg, 'u_impulse_kick')!,
  };

  const rU = {
    density: gl.getUniformLocation(renderProg, 'u_density')!,
    resolution: gl.getUniformLocation(renderProg, 'u_resolution')!,
    fadeInOut: gl.getUniformLocation(renderProg, 'u_fade_in_out')!,
    intensity: gl.getUniformLocation(renderProg, 'u_intensity')!,
    bgColor: gl.getUniformLocation(renderProg, 'u_bg_color')!,
  };

  // Ping-pong FBOs
  let fboA = createSimFBO(gl, SIM_RES);
  let fboB = createSimFBO(gl, SIM_RES);

  // Pre-allocated impulse uniform buffers (avoid per-frame allocation)
  const impulsePos = new Float32Array(MAX_IMPULSES * 2);
  const impulseColor = new Float32Array(MAX_IMPULSES * 3);
  const impulseStrength = new Float32Array(MAX_IMPULSES);
  const impulseRadius = new Float32Array(MAX_IMPULSES);
  const impulseKick = new Float32Array(MAX_IMPULSES * 2);

  // Per-frame state
  let impulseCount = 0;
  // Throttle — allow at most one bass impulse per N seconds so a
  // continuous kick pattern doesn't saturate the field.
  let bassCooldown = 0;
  let midCooldown = 0;
  let highCooldown = 0;

  function pushImpulse(
    x: number, y: number,
    color: [number, number, number],
    strength: number, radius: number,
    kickX: number, kickY: number,
  ): void {
    if (impulseCount >= MAX_IMPULSES) return;
    const i = impulseCount;
    impulsePos[i * 2] = x;
    impulsePos[i * 2 + 1] = y;
    impulseColor[i * 3] = color[0];
    impulseColor[i * 3 + 1] = color[1];
    impulseColor[i * 3 + 2] = color[2];
    impulseStrength[i] = strength;
    impulseRadius[i] = radius;
    impulseKick[i * 2] = kickX;
    impulseKick[i * 2 + 1] = kickY;
    impulseCount++;
  }

  return {
    id: 'flow-ink',

    update(ctx: StyleContext): void {
      const { dt, bassHits, midHits, highHits, fadeInOut, colorEngine } = ctx;
      const palette = colorEngine.getPalette();
      const ringColors = colorEngine.getRingColors();
      const accent = hslToRgb(palette.accent);
      const highlight = hslToRgb(palette.highlight);

      bassCooldown = Math.max(0, bassCooldown - dt);
      midCooldown = Math.max(0, midCooldown - dt);
      highCooldown = Math.max(0, highCooldown - dt);

      impulseCount = 0;

      // Bass hits → big colored splats near (but not at) the center,
      // with an outward kick so they explode rather than puddle.
      if (bassHits > 0.4 && bassCooldown <= 0 && fadeInOut > 0.1) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 0.10 + Math.random() * 0.18;
        const x = 0.5 + Math.cos(angle) * dist;
        const y = 0.5 + Math.sin(angle) * dist;
        pushImpulse(
          x, y,
          ringColors[1], // mid ring color (mostly the primary palette hue)
          0.55 + bassHits * 0.65,
          0.13 + bassHits * 0.06,
          Math.cos(angle) * 0.5,
          Math.sin(angle) * 0.5,
        );
        bassCooldown = 0.13;
      }

      // Mid hits → smaller off-center splats, accent color
      if (midHits > 0.45 && midCooldown <= 0 && fadeInOut > 0.1) {
        pushImpulse(
          Math.random(), Math.random(),
          accent as [number, number, number],
          0.30 + midHits * 0.35,
          0.08 + midHits * 0.04,
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
        );
        midCooldown = 0.10;
      }

      // High hits → tiny sparkly splats anywhere
      if (highHits > 0.4 && highCooldown <= 0 && fadeInOut > 0.1) {
        pushImpulse(
          Math.random(), Math.random(),
          highlight as [number, number, number],
          0.20 + highHits * 0.30,
          0.04 + highHits * 0.02,
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
        );
        highCooldown = 0.07;
      }
    },

    render(ctx: StyleContext): void {
      const {
        canvas, time, dt, intensity, fadeInOut, midPresence, colorEngine, quadVAO,
      } = ctx;

      const palette = colorEngine.getPalette();
      const accent = hslToRgb(palette.accent);
      const bg = hslToRgb({ h: palette.bg.h, s: palette.bg.s, l: palette.bg.l + 0.05 });

      // ── Capture the current scene FBO binding ──
      // The renderer bound its scene FBO before calling render(), but our
      // sim pass needs to bind its own FBOs. We'll restore the scene FBO
      // afterward by re-binding via PostProcessPipeline.bindSceneFBO,
      // except we don't have a handle here — so instead we read the
      // current binding once and restore it.
      const sceneFB = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

      // ── Sim pass: render fboA → fboB ──
      gl.disable(gl.BLEND);
      gl.useProgram(simProg);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fboB.fb);
      gl.viewport(0, 0, SIM_RES, SIM_RES);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fboA.tex);
      gl.uniform1i(sU.prev, 0);
      gl.uniform2f(sU.resolution, SIM_RES, SIM_RES);
      gl.uniform1f(sU.time, time);
      gl.uniform1f(sU.dt, dt);
      gl.uniform1f(sU.intensity, intensity);
      // Dissipation: faster fade when intensity is low so quiet sections
      // really do calm down rather than carrying ink forever.
      gl.uniform1f(sU.dissipation, 0.978 + intensity * 0.012);
      // Ambient ink scales with mid presence and fade — quiet music
      // gets a gentle drizzle that keeps the field non-empty, silence
      // turns it off entirely.
      gl.uniform1f(sU.ambientRate, midPresence * fadeInOut);
      gl.uniform3fv(sU.ambientColor, accent);
      gl.uniform1f(sU.fadeInOut, fadeInOut);

      gl.uniform1i(sU.impulseCount, impulseCount);
      gl.uniform2fv(sU.impulsePos, impulsePos);
      gl.uniform3fv(sU.impulseColor, impulseColor);
      gl.uniform1fv(sU.impulseStrength, impulseStrength);
      gl.uniform1fv(sU.impulseRadius, impulseRadius);
      gl.uniform2fv(sU.impulseKick, impulseKick);

      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Swap ping-pong
      const tmp = fboA;
      fboA = fboB;
      fboB = tmp;

      // ── Render pass: density → scene FBO ──
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFB);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(bg[0], bg[1], bg[2], 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(renderProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fboA.tex);
      gl.uniform1i(rU.density, 0);
      gl.uniform2f(rU.resolution, canvas.width, canvas.height);
      gl.uniform1f(rU.fadeInOut, fadeInOut);
      gl.uniform1f(rU.intensity, intensity);
      gl.uniform3fv(rU.bgColor, bg);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    },

    dispose(): void {
      gl.deleteProgram(simProg);
      gl.deleteProgram(renderProg);
      gl.deleteFramebuffer(fboA.fb);
      gl.deleteTexture(fboA.tex);
      gl.deleteFramebuffer(fboB.fb);
      gl.deleteTexture(fboB.tex);
    },
  };
}

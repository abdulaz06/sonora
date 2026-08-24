/**
 * Aura — abstract field of luminous organic forms.
 *
 * Element palette (all driven via the mapping layer per
 * DOCS/14-MAPPING-LAYER-SPEC.md §"Hierarchy Rule"):
 *   - Rings        ← bass hits (pulse) + bass presence (glow) + intensity (size)
 *   - Particles    ← high presence (mist) + high/mid/bass hits (bursts)
 *   - Tendrils     ← mid presence + mid hits, in a noise-driven flow field
 *   - Glow orbs    ← bass presence (brightness) + intensity (count)
 *   - Beat flash   ← gated by fade_in_out
 *
 * This is the original "Aura" composition — extracted from the renderer
 * so it can sit alongside Halo Spectrum and Flow-Ink as a switchable mode.
 */

import { hslToRgb } from '../engine/color-engine';
import { buildProgram } from '../engine/gl-utils';
import { FlowField } from '../primitives/flow-field';
import { GlowOrbSystem } from '../primitives/glow-orbs';
import { ParticleSystem } from '../primitives/particles';
import { DEFAULT_RING_COUNT, MAX_RING_COUNT, RingSystem } from '../primitives/rings';
import { TendrilSystem } from '../primitives/tendrils';

import glowOrbFragSrc from '../engine/shaders/glow-orb.frag?raw';
import glowOrbVertSrc from '../engine/shaders/glow-orb.vert?raw';
import particleFragSrc from '../engine/shaders/particle.frag?raw';
import particleVertSrc from '../engine/shaders/particle.vert?raw';
import ringFragSrc from '../engine/shaders/ring.frag?raw';
import ringVertSrc from '../engine/shaders/ring.vert?raw';
import tendrilFragSrc from '../engine/shaders/tendril.frag?raw';
import tendrilVertSrc from '../engine/shaders/tendril.vert?raw';

import { STYLE_VARIANTS } from './visual-style';

import type { StyleContext, StyleDeps, VariantOption, VisualStyle } from './visual-style';

const INST_STRIDE = 7 * 4; // x, y, size, alpha, r, g, b
const MAX_TENDRIL_VERTS = 12 * 48; // MAX_TENDRILS * POINTS_PER_TENDRIL
const TENDRIL_STRIDE = 6 * 4; // x, y, alpha, r, g, b
const MAX_PARTICLES_BUFFER = 200;
const MAX_GLOW_ORBS_BUFFER = 8;

export function createAuraStyle(deps: StyleDeps): VisualStyle {
  const { gl } = deps;

  // ── Programs ─────────────────────────────────────────────────
  const ringProg = buildProgram(gl, ringVertSrc, ringFragSrc);
  const particleProg = buildProgram(gl, particleVertSrc, particleFragSrc);
  const tendrilProg = buildProgram(gl, tendrilVertSrc, tendrilFragSrc);
  const glowOrbProg = buildProgram(gl, glowOrbVertSrc, glowOrbFragSrc);

  // ── Ring uniforms ────────────────────────────────────────────
  const ringIdx = Array.from({ length: MAX_RING_COUNT }, (_, i) => i);
  const rU = {
    resolution: gl.getUniformLocation(ringProg, 'u_resolution')!,
    time: gl.getUniformLocation(ringProg, 'u_time')!,
    bassEnergy: gl.getUniformLocation(ringProg, 'u_bass_energy')!,
    beatPulse: gl.getUniformLocation(ringProg, 'u_beat_pulse')!,
    onsetFlash: gl.getUniformLocation(ringProg, 'u_onset_flash')!,
    loudness: gl.getUniformLocation(ringProg, 'u_loudness')!,
    ringCount: gl.getUniformLocation(ringProg, 'u_ring_count')!,
    shape: gl.getUniformLocation(ringProg, 'u_shape')!,
    ring: ringIdx.map((i) => gl.getUniformLocation(ringProg, `u_ring[${i}]`)),
    ringColor: ringIdx.map((i) => gl.getUniformLocation(ringProg, `u_ring_color[${i}]`)),
  };

  // ── Variant (ring silhouette) ────────────────────────────────
  const SHAPE_ID: Record<string, number> = { circle: 0, triangle: 1, square: 2 };
  let variantId = 'circle';

  // ── Quad data shared by particles/orbs ───────────────────────
  const pQuad = new Float32Array([
    -1, -1, 1, -1, -1, 1,
    1, -1, 1, 1, -1, 1,
  ]);

  // ── Particle VAO (instanced) ─────────────────────────────────
  const particleVAO = gl.createVertexArray()!;
  const pQuadVBO = gl.createBuffer()!;
  const pInstanceVBO = gl.createBuffer()!;

  gl.bindVertexArray(particleVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, pQuadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, pQuad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, pInstanceVBO);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES_BUFFER * INST_STRIDE, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, INST_STRIDE, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, INST_STRIDE, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, INST_STRIDE, 12);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, INST_STRIDE, 16);
  gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);

  const pU = {
    resolution: gl.getUniformLocation(particleProg, 'u_resolution')!,
  };

  // ── Tendril VAO ──────────────────────────────────────────────
  const tendrilVAO = gl.createVertexArray()!;
  const tendrilVBO = gl.createBuffer()!;

  gl.bindVertexArray(tendrilVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, tendrilVBO);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_TENDRIL_VERTS * TENDRIL_STRIDE, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, TENDRIL_STRIDE, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, TENDRIL_STRIDE, 8);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, TENDRIL_STRIDE, 12);
  gl.bindVertexArray(null);

  const tU = {
    resolution: gl.getUniformLocation(tendrilProg, 'u_resolution')!,
  };

  // ── Glow orb VAO (instanced, same layout as particles) ───────
  const glowOrbVAO = gl.createVertexArray()!;
  const goQuadVBO = gl.createBuffer()!;
  const goInstanceVBO = gl.createBuffer()!;

  gl.bindVertexArray(glowOrbVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, goQuadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, pQuad, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, goInstanceVBO);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_GLOW_ORBS_BUFFER * INST_STRIDE, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, INST_STRIDE, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, INST_STRIDE, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, INST_STRIDE, 12);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, INST_STRIDE, 16);
  gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);

  const goU = {
    resolution: gl.getUniformLocation(glowOrbProg, 'u_resolution')!,
  };

  // ── Primitive systems ────────────────────────────────────────
  const ringSystem = new RingSystem(DEFAULT_RING_COUNT);
  const particleSystem = new ParticleSystem();
  const flowField = new FlowField();
  const tendrilSystem = new TendrilSystem();
  const glowOrbSystem = new GlowOrbSystem();

  return {
    id: 'aura',

    variants: STYLE_VARIANTS['aura'] as VariantOption[],
    setVariant(id: string): void { variantId = id; },
    getVariant(): string { return variantId; },

    setRingCount(n: number): void { ringSystem.setRingCount(n); },
    getRingCount(): number { return ringSystem.ringCount; },

    update(ctx: StyleContext): void {
      const {
        dt, time,
        fadeInOut, intensity, intensitySmoothed,
        bassHits, bassPresence,
        midHits, midPresence,
        highHits, highPresence,
        colorEngine, generative,
      } = ctx;

      const pal = colorEngine.getPalette();
      const highlightRgb = hslToRgb(pal.highlight) as [number, number, number];
      const secondaryRgb = hslToRgb(pal.secondary) as [number, number, number];
      const accentRgb = hslToRgb(pal.accent) as [number, number, number];
      const ringColors3 = colorEngine.getRingColors();

      // ── Flow field ──
      flowField.update(time, intensitySmoothed + generative.turbulenceDrift * 0.2);

      // ── Rings ──
      ringSystem.update(bassHits, bassPresence, intensity, fadeInOut, dt);
      // Spread the palette gradient evenly across however many rings we have
      // — the slider can change the count between frames.
      const ringColorsN = colorEngine.getRingColorsN(ringSystem.ringCount);
      for (let i = 0; i < ringSystem.ringCount; i++) {
        ringSystem.rings[i].color = ringColorsN[i];
      }
      // Generative radius drift (scaled by loudness so silence stays silent)
      for (const ring of ringSystem.rings) {
        ring.radius += generative.ringDrift * 0.02 * ringSystem.loudness;
      }

      // ── Particles ──
      particleSystem.spawnMist(highPresence * 3 * fadeInOut, dt);
      if (highHits > 0.35) {
        particleSystem.burst(
          4,
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
          0.1 + highHits * 0.2,
          highlightRgb,
        );
      }
      if (midHits > 0.45) {
        particleSystem.burst(
          3,
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
          0.08 + midHits * 0.15,
          secondaryRgb,
        );
      }
      if (bassHits > 0.45) {
        particleSystem.burst(3, 0, 0, 0.08 + bassHits * 0.12, ringColors3[1]);
      }
      particleSystem.update(dt);

      // ── Tendrils ──
      tendrilSystem.update(flowField, midPresence, midHits, fadeInOut, dt, secondaryRgb);

      // ── Glow orbs ──
      glowOrbSystem.update(bassPresence, intensity, fadeInOut, dt, time, accentRgb);
    },

    render(ctx: StyleContext): void {
      const { canvas, time, fadeInOut, bassHits, bassPresence, beatPulse, quadVAO } = ctx;

      gl.clearColor(0.025, 0.02, 0.04, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);

      // ── Rings (fullscreen quad, standard blend) ──
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(ringProg);
      gl.uniform2f(rU.resolution, canvas.width, canvas.height);
      gl.uniform1f(rU.time, time);
      gl.uniform1f(rU.bassEnergy, bassPresence + bassHits * 0.3);
      gl.uniform1f(rU.beatPulse, beatPulse.pulseEase);
      gl.uniform1f(rU.onsetFlash, beatPulse.onsetFlash * fadeInOut);
      gl.uniform1f(rU.loudness, ringSystem.loudness);
      gl.uniform1i(rU.ringCount, ringSystem.rings.length);
      gl.uniform1i(rU.shape, SHAPE_ID[variantId] ?? 0);

      for (let i = 0; i < ringSystem.rings.length; i++) {
        const r = ringSystem.rings[i];
        if (rU.ring[i]) gl.uniform4f(rU.ring[i], r.radius, r.energy, r.thickness, r.glow);
        if (rU.ringColor[i]) gl.uniform3fv(rU.ringColor[i], r.color);
      }

      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // ── Glow orbs (instanced, additive) ──
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      if (glowOrbSystem.liveCount > 0) {
        gl.useProgram(glowOrbProg);
        gl.uniform2f(goU.resolution, canvas.width, canvas.height);
        gl.bindVertexArray(glowOrbVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, goInstanceVBO);
        gl.bufferSubData(
          gl.ARRAY_BUFFER, 0,
          glowOrbSystem.instanceData.subarray(0, glowOrbSystem.liveCount * 7),
        );
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, glowOrbSystem.liveCount);
      }

      // ── Tendrils (line strips, additive) ──
      if (tendrilSystem.totalPoints > 0) {
        gl.useProgram(tendrilProg);
        gl.uniform2f(tU.resolution, canvas.width, canvas.height);
        gl.bindVertexArray(tendrilVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, tendrilVBO);
        gl.bufferSubData(
          gl.ARRAY_BUFFER, 0,
          tendrilSystem.vertexData.subarray(0, tendrilSystem.totalPoints * 6),
        );

        let offset = 0;
        for (const count of tendrilSystem.segmentCounts) {
          gl.drawArrays(gl.LINE_STRIP, offset, count);
          offset += count;
        }
      }

      // ── Particles (instanced, additive) ──
      if (particleSystem.liveCount > 0) {
        gl.useProgram(particleProg);
        gl.uniform2f(pU.resolution, canvas.width, canvas.height);
        gl.bindVertexArray(particleVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, pInstanceVBO);
        gl.bufferSubData(
          gl.ARRAY_BUFFER, 0,
          particleSystem.instanceData.subarray(0, particleSystem.liveCount * 7),
        );
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, particleSystem.liveCount);
      }

      gl.bindVertexArray(null);
    },

    dispose(): void {
      gl.deleteProgram(ringProg);
      gl.deleteProgram(particleProg);
      gl.deleteProgram(tendrilProg);
      gl.deleteProgram(glowOrbProg);
      gl.deleteBuffer(pQuadVBO);
      gl.deleteBuffer(pInstanceVBO);
      gl.deleteBuffer(tendrilVBO);
      gl.deleteBuffer(goQuadVBO);
      gl.deleteBuffer(goInstanceVBO);
      gl.deleteVertexArray(particleVAO);
      gl.deleteVertexArray(tendrilVAO);
      gl.deleteVertexArray(glowOrbVAO);
    },
  };
}

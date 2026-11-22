/**
 * Memory — walking through a scanned place made of Gaussian splats (refs: memory/).
 *
 * Scenes are built offline from CC0 Poly Haven photoscans (scripts/memory/
 * build-scenes.py: models placed along a path over a scanned ground, every
 * surface sampled into flat disc splats) and loaded on demand, one per look.
 * Splats are drawn back to front (a counting sort in a worker; synchronously
 * in offline exports, so frames are deterministic) as projected Gaussians.
 *
 *   kicks       a ring of light runs out from the walker through the scene
 *               (on the hit frame; darks and mid-tones only) and a fifth of
 *               the splats lift off into drifting points
 *   bass        pushes splats outward along the view
 *   build       the world slowly pulls apart …
 *   drop        … and snaps back together with a camera surge
 *   breakdown   the scene turns into a point cloud of glowing points (reel14)
 *   edges       the frame's edges dissolve into the fog (reel01); the walk
 *               loops back through a fade into the fog
 * Looks: Forest, Coast, Desert. The palette grades the scan lightly and
 * colours the fog and the light; the scan stays natural.
 */

import { clamp01, createRng, lookAt, mat4, perspective, type Vec3 } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { drawQuad, makeProgram, setUniforms } from '../shared/gl';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';
import splatVert from './shaders/splat.vert?raw';
import splatFrag from './shaders/splat.frag?raw';
import { sortSplats } from './sort';
import { trackAsset } from '../../engine/assets';
import forestUrl from '../../assets/memory/forest.splat?url';
import coastUrl from '../../assets/memory/coast.splat?url';
import desertUrl from '../../assets/memory/desert.splat?url';

// ── Tuning ──────────────────────────────────────────────────────
type Look = 'forest' | 'coast' | 'desert';
const URLS: Record<Look, string> = { forest: forestUrl, coast: coastUrl, desert: desertUrl };
/** Path: start / end z (m), eye height, sideways sway. */
const PATH: [number, number] = [3, -31];
const EYE: Record<Look, number> = { forest: 1.45, coast: 3.3, desert: 1.6 };
const SWAY = 0.7;
/** Walk speed (m/s): quiet → loud; drop surge. */
const SPEED: [number, number] = [0.22, 1.1];
const SURGE = 3.5;
/** Fog (m): near / far per look; the loop fades over this distance (m). */
const FOG: Record<Look, [number, number]> = { forest: [5, 22], coast: [8, 30], desert: [7, 26] };
const LOOP_FADE = 2.5;
/** Kick dissolve decay (s), bass push gain, build pull-apart (m) and drop snap (s). */
const DISSOLVE_TAU = 0.2;
const APART = 1.3;
const SNAP_TAU = 0.22;
/** Palette grade share and the frame-edge dissolve. */
const GRADE = 0.32;
const EDGE = 0.85;
/** Kick: share of splats that lift off and how bright they glow. Kept small: a lift over most of
 * the scene brightened the whole frame on every kick (motion gate's background step). */
const KICK_LIFT: Record<Look, [number, number]> = { forest: [0.2, 1.0], coast: [0.2, 1.0], desert: [0.2, 1.2] };
/** Kick light ring: starts this far out (m), travels at this speed (m/s), width (m), decay (s), gain per look. */
const RING_R0 = 2.0;
const RING_SPEED = 26;
const RING_WIDTH = 1.6;
const RING_TAU = 0.32;
const RING_GAIN: Record<Look, number> = { forest: 1.1, coast: 1.8, desert: 2.4 };
/** The ring lifts colours up to this share of the fog's luminance (forest, coast) or this luminance (desert). */
const RING_CAP: Record<Look, number> = { forest: 0.8, coast: 0.92, desert: 0.5 };
/** Scene light per look: the desert is a moonlit night (dark enough that the ring reads). */
const GAIN: Record<Look, number> = { forest: 1, coast: 1, desert: 0.6 };
/** The desert's moonlight takes this much of the palette's primary hue (the light carries the palette, D89). */
const MOON_TINT = 0.6;
/** How much of the primary the bright fogs take (Forest, Coast): a near-white fog read grey in pale palettes. */
const FOG_TINT = 0.6;
/** Low quality draws every other splat. */
const LOW_STRIDE = 2;

interface Scene { n: number; pos: Float32Array; posTex: WebGLTexture; nrmTex: WebGLTexture; colTex: WebGLTexture; texW: number }

export function createMemoryStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0x3e30);
  let quality = deps.quality;
  let look: Look = 'forest';
  const prog = makeProgram(gl, splatVert, splatFrag);
  const bgProg = makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform vec2 u_res; uniform vec3 u_top; uniform vec3 u_bot; out vec4 frag;
void main() { float y = gl_FragCoord.y / u_res.y; frag = vec4(mix(u_bot, u_top, smoothstep(0.0, 1.0, y)), 1.0); }`);
  const vao = gl.createVertexArray()!;
  const corners = gl.createBuffer()!;
  const idxBuf = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, idxBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);

  const scenes: Partial<Record<Look, Scene>> = {};
  const loading: Partial<Record<Look, boolean>> = {};
  let worker: Worker | null = null;
  let workerLook: Look | null = null;
  let pending = false;
  let drawCount = 0;
  let sortedFor: Look | null = null;

  function upload(l: Look, buf: ArrayBuffer): void {
    const v = new DataView(buf);
    const n = v.getUint32(8, true);
    const lo = [v.getFloat32(12, true), v.getFloat32(16, true), v.getFloat32(20, true)];
    const hi = [v.getFloat32(24, true), v.getFloat32(28, true), v.getFloat32(32, true)];
    const texW = 2048, texH = Math.ceil(n / texW);
    const pos = new Float32Array(n * 3);
    const posT = new Float32Array(texW * texH * 4);
    const nrmT = new Float32Array(texW * texH * 4);
    const colT = new Uint8Array(texW * texH * 4);
    const base = 36;
    for (let i = 0; i < n; i++) {
      const o = base + i * 13;
      for (let k = 0; k < 3; k++) {
        const q = v.getUint16(o + k * 2, true) / 65535;
        const x = lo[k] + (hi[k] - lo[k]) * q;
        pos[i * 3 + k] = x;
        posT[i * 4 + k] = x;
      }
      posT[i * 4 + 3] = ((i * 2654435761) >>> 0) / 4294967296;
      // octahedral normal
      let nx = v.getInt8(o + 6) / 127, ny = v.getInt8(o + 7) / 127;
      let nz = 1 - Math.abs(nx) - Math.abs(ny);
      if (nz < 0) { const tx = (1 - Math.abs(ny)) * Math.sign(nx), ty = (1 - Math.abs(nx)) * Math.sign(ny); nx = tx; ny = ty; }
      const l = Math.hypot(nx, ny, nz) || 1;
      nrmT[i * 4] = nx / l; nrmT[i * 4 + 1] = ny / l; nrmT[i * 4 + 2] = nz / l;
      nrmT[i * 4 + 3] = Math.pow(2, v.getUint8(o + 8) / 32 - 8);
      colT[i * 4] = v.getUint8(o + 9); colT[i * 4 + 1] = v.getUint8(o + 10); colT[i * 4 + 2] = v.getUint8(o + 11); colT[i * 4 + 3] = v.getUint8(o + 12);
    }
    const tex = (internal: number, format: number, type: number, data: ArrayBufferView): WebGLTexture => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, texW, texH, 0, format, type, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return t;
    };
    scenes[l] = {
      n, pos, texW,
      posTex: tex(gl.RGBA32F, gl.RGBA, gl.FLOAT, posT),
      nrmTex: tex(gl.RGBA32F, gl.RGBA, gl.FLOAT, nrmT),
      colTex: tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, colT),
    };
  }

  function ensure(l: Look): Scene | null {
    const s = scenes[l];
    if (s) return s;
    if (!loading[l]) {
      loading[l] = true;
      void trackAsset(fetch(URLS[l]).then((r) => r.arrayBuffer()).then((b) => upload(l, b)));
    }
    return null;
  }

  // ── State ──
  let time = 0;
  let travel = rng() * 10;
  let dissolve = 0;
  let apart = 0;
  let points = 0;
  let surge = 0;
  let flash = 0;
  let kick = 0;
  let ringT = 9;
  let ringArmed = true;

  const gainCol = (pal: StyleContext['palette']): [number, number, number] => {
    const g = GAIN[look];
    if (look !== 'desert') return [g, g, g];
    const h = pal.primary, m = Math.max(h[0], h[1], h[2], 1e-3);
    const c = [0, 1, 2].map((i) => 1 + (h[i] / m - 1) * MOON_TINT);
    const k = g / Math.max(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], 0.05);
    return [c[0] * k, c[1] * k, c[2] * k];
  };

  return {
    id: 'memory',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (e.type === 'drop') {
        surge = 1;
        if (ctx.flash.request()) flash = 1;
      }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const es = ctx.eventState;
      const fade = ctx.fadeInOut;
      surge *= Math.exp(-dt / 0.9);
      flash *= Math.exp(-dt / 0.18);
      kick = Math.max(kick * Math.exp(-dt / 0.16), ctx.bassHits * fade);
      dissolve = Math.max(dissolve * Math.exp(-dt / DISSOLVE_TAU), ctx.bassHits * fade);
      ringT += dt;
      if (ctx.bassHits < 0.3) ringArmed = true;
      if (ringArmed && ctx.bassHits > 0.5 && fade > 0.1) { ringArmed = false; ringT = 0; }
      const apartWant = es.section === 'build' ? es.buildProgress * es.buildProgress * APART : 0;
      apart += (apartWant - apart) * (1 - Math.exp(-dt / (apartWant < apart ? SNAP_TAU : 2.5)));
      const ptWant = es.section === 'breakdown' ? 1 : 0;
      points += (ptWant - points) * (1 - Math.exp(-dt / 1.4));
      const speed = (SPEED[0] + (SPEED[1] - SPEED[0]) * ctx.intensitySmoothed) * (0.3 + 0.7 * fade) * (es.section === 'breakdown' ? 0.5 : 1) + SURGE * surge;
      travel += dt * speed;
    },

    render(ctx: StyleContext): void {
      const pal = ctx.palette;
      const W = ctx.width, H = ctx.height;
      const es = ctx.eventState;
      const fade = ctx.fadeInOut;
      const cam = ctx.camera;
      // Fog and light from the palette (the forest's fog is bright, as in reel01; the desert's is night).
      // The palette lives in the light (D89): the fog and sky take the palette's hues, the scans stay natural.
      const fogCol: [number, number, number] = look === 'forest' ? mix3(mix3(pal.paper, pal.highlight, 0.3), pal.primary, FOG_TINT)
        : look === 'coast' ? mix3(mix3(mix3(pal.highlight, pal.paper, 0.45), pal.secondary, 0.15), pal.primary, FOG_TINT) : mix3(mix3(pal.secondary, pal.bg, 0.55), pal.accent, 0.12);
      const night = mix3(pal.bg, pal.shade, 0.3);
      const fogNow = mix3(fogCol, night, points * 0.8);
      ctx.bindScene();
      gl.disable(gl.BLEND);
      gl.useProgram(bgProg.prog);
      setUniforms(gl, bgProg, { u_res: [W, H], u_top: fogNow, u_bot: mix3(fogNow, pal.shade, 0.35) });
      drawQuad(gl, quadVAO);

      const s = ensure(look);
      if (!s) return;
      // The walk: along the path, looping back through the fog.
      const span = PATH[0] - PATH[1];
      const along = travel % span;
      const z = PATH[0] - along;
      const loopFog = clamp01(1 - Math.min(along, span - along) / LOOP_FADE);
      const x = simplex2(time * 0.05, 1) * SWAY;
      const eye: Vec3 = [x, EYE[look] + 0.12 * simplex2(time * 0.07, 2) + 0.05 * Math.sin(travel * 3.1), z];
      const yaw = simplex2(time * 0.04, 3) * 0.35 + cam.roll * 0.5;
      const pitch = -0.08 + 0.06 * simplex2(time * 0.05, 4) + cam.lurchAmount * -0.05;
      const fwd: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
      const view = mat4(), proj = mat4();
      lookAt(view, eye, [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]], [Math.sin(cam.roll * 1.2), Math.cos(cam.roll * 1.2), 0]);
      const fov = (W < H ? 64 : 55) * Math.PI / 180 + (cam.fov - 52 * Math.PI / 180) * 0.7;
      perspective(proj, fov, W / H, 0.05, 80);
      const fy = H / (2 * Math.tan(fov / 2));

      // Sort (worker in real time; synchronous offline, deterministic).
      const stride = quality.level === 'low' ? LOW_STRIDE : 1;
      const applySort = (idx: Uint32Array): void => {
        let list = idx;
        if (stride > 1) { list = new Uint32Array(Math.ceil(idx.length / stride)); let k = 0; for (let i = 0; i < idx.length; i += stride) list[k++] = idx[i]; }
        gl.bindBuffer(gl.ARRAY_BUFFER, idxBuf);
        gl.bufferData(gl.ARRAY_BUFFER, list, gl.DYNAMIC_DRAW);
        drawCount = list.length;
        sortedFor = look;
      };
      if (ctx.offline || typeof Worker === 'undefined') {
        applySort(sortSplats(s.pos, eye, fwd));
      } else {
        if (!worker) {
          worker = new Worker(new URL('./sort.worker.ts', import.meta.url), { type: 'module' });
          worker.onmessage = (e: MessageEvent<{ idx: Uint32Array }>) => { pending = false; applySort(e.data.idx); };
        }
        if (workerLook !== look) { worker.postMessage({ pos: s.pos }); workerLook = look; pending = false; }
        if (!pending) { pending = true; worker.postMessage({ cam: eye, fwd, id: 0 }); }
        if (sortedFor !== look) {
          // First frame of a scene: sort here once so something shows at once.
          applySort(sortSplats(s.pos, eye, fwd));
        }
      }

      const [fn, ff] = FOG[look];
      const loopK = Math.max(loopFog, flash * 0.35);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog.prog);
      setUniforms(gl, prog, {
        u_pos: s.posTex, u_nrm: s.nrmTex, u_col: s.colTex, u_tex_w: s.texW,
        u_view: view, u_proj: proj, u_res: [W, H], u_focal: [fy, fy], u_cam: eye, u_time: time,
        u_dissolve: dissolve * 0.85, u_push: clamp01(ctx.bassPresence) * 0.5 + kick * 0.5, u_apart: apart, u_points: points,
        u_fog_near: fn * (1 - loopK * 0.9) * (0.75 + 0.25 * fade), u_fog_far: ff * (1 - loopK * 0.85) * (0.8 + 0.2 * fade), u_fog_col: fogNow,
        u_lift_share: KICK_LIFT[look][0], u_lift_glow: KICK_LIFT[look][1],
        u_ring: [RING_R0 + RING_SPEED * ringT, ringT < 2 ? Math.exp(-ringT / RING_TAU) * fade : 0, RING_WIDTH + 0.12 * RING_SPEED * ringT], u_ring_gain: RING_GAIN[look], u_gain: gainCol(pal),
        u_ring_cap: RING_CAP[look] * (look === 'desert' ? 1 : 0.299 * fogNow[0] + 0.587 * fogNow[1] + 0.114 * fogNow[2]),
        u_light: mix3(pal.highlight, [1, 1, 1], 0.4),
        u_shadow: mix3(pal.shade, [0, 0, 0], 0.3), u_grade: GRADE + 0.25 * points, u_edge: EDGE * (es.section === 'silence' ? 1.2 : 1), u_glow: points * 0.6,
      });
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, drawCount);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      const post = ctx.post;
      post.bloom = 0.35 + 0.4 * points;
      post.bloomThreshold = 0.9;
      post.vignette = 0.2;
    },

    setQuality(q: QualityParams): void { quality = q; },
    setVariant(id: string): void { look = id === 'coast' ? 'coast' : id === 'desert' ? 'desert' : 'forest'; ensure(look); },
    getVariant: () => look,
    dispose(): void {
      worker?.terminate();
      for (const sc of Object.values(scenes)) if (sc) { gl.deleteTexture(sc.posTex); gl.deleteTexture(sc.nrmTex); gl.deleteTexture(sc.colTex); }
      gl.deleteProgram(prog.prog); gl.deleteProgram(bgProg.prog);
      gl.deleteBuffer(corners); gl.deleteBuffer(idxBuf); gl.deleteVertexArray(vao);
    },
  };
}

const mix3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

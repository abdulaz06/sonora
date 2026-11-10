/**
 * Turing — Gray-Scott reaction-diffusion (ref 02).
 *
 * A periodic grid several screens wide; the world camera drifts across it.
 *   intensity  → feed/kill regime: spots (quiet) ↔ labyrinth ↔ stripes (loud),
 *                so the pattern visibly changes character across a song
 *   beat       → brief growth-rate pulses
 *   hits       → seeds dropped at varied positions (bass: big squares, mid: discs)
 *   drop       → colour inversion (through the flash guard) + a reseed wave
 *   trackChange→ the track title grows out of the maze (text-mask seeding)
 *
 * Variants: Coral (pigment on bone, ref02) and Bioluminescent (glowing
 * edges on black).
 */

import { clamp01, createRng, lerp } from '../../engine/math';
import type { SonoraEvent } from '../../engine/events';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { bindTarget, drawQuad, makeProgram, PingPong, setUniforms } from '../shared/gl';

import rdFrag from './shaders/rd.frag?raw';
import displayFrag from './shaders/display.frag?raw';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';

// ── Tuning ──────────────────────────────────────────────────────
const GRID: Record<QualityParams['level'], number> = { low: 512, medium: 1024, high: 1536 };
/** Simulation steps per frame (at 60 fps). */
const STEPS: Record<QualityParams['level'], number> = { low: 8, medium: 14, high: 20 };
/** Grid cells per camera view-height: keeps pattern size constant across quality. */
const CELLS_PER_VIEW = 260;
/** Feed/kill regimes keyed by intensity: spots → labyrinth → stripes. */
const REGIMES: [number, number, number][] = [
  [0.0, 0.0367, 0.0649],
  [0.45, 0.0545, 0.062],
  [1.0, 0.06, 0.0618],
];
const SEED_COOLDOWN = 0.12;
const INVERT_BEATS = 2;
/** Reseed wave: ring speed (view heights / s) and duration (s). */
const WAVE_SPEED = 0.6;
const WAVE_TIME = 1.6;
/** How long the text mask keeps re-seeding its letters (s), and how often (frames). */
const TEXT_HOLD_S = 6;
const TEXT_EVERY = 6;
/** Text mask canvas size and on-screen width (fraction of the view width). */
const MASK_W = 1024;
const MASK_H = 256;
const TEXT_VIEW_WIDTH = 0.85;

export function createTuringStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0x7e11);
  let quality = deps.quality;
  let variant = 'coral';
  let grid = GRID[quality.level];
  const stateOpts = { internal: gl.RG32F, format: gl.RG, filter: gl.LINEAR, wrap: gl.REPEAT };
  let state = new PingPong(gl, grid, grid, stateOpts);
  const rd = makeProgram(gl, fullscreenVert, rdFrag);
  const display = makeProgram(gl, fullscreenVert, displayFrag);
  const init = makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform vec2 u_texel; uniform float u_seed; out vec4 frag;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453); }
void main() { vec2 uv = gl_FragCoord.xy * u_texel; vec2 cell = floor(uv * 24.0);
  float on = step(0.93, h(cell)) * step(length(fract(uv * 24.0) - 0.5), 0.18);
  frag = vec4(on > 0.5 ? 0.5 : 1.0, on > 0.5 ? 0.25 : 0.0, 0.0, 1.0); }`);

  // Text mask texture (filled by seedText).
  const maskTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let maskFrames = 0;
  let maskRect: [number, number, number, number] = [0, 0, 1, 1];
  let pendingText: string | null = null;

  let needsInit = true;
  let time = 0;
  let seedCooldown = 0;
  let pulse = 0;
  let invertUntil = -1;
  let wave: { x: number; y: number; age: number } | null = null;
  let regime = 0.3;
  const seeds: number[] = [];

  const domain = (): number => grid / CELLS_PER_VIEW;

  function addSeed(x: number, y: number, r: number, square: boolean): void {
    if (seeds.length >= 32) return;
    const d = domain();
    seeds.push(((x / d) % 1 + 1) % 1, ((y / d) % 1 + 1) % 1, r / d, square ? 1 : 0);
  }

  function resize(): void {
    const g = GRID[quality.level];
    if (g === grid) return;
    state.dispose();
    grid = g;
    state = new PingPong(gl, grid, grid, stateOpts);
    needsInit = true;
  }

  /** Render text into the mask and arm a few frames of seeding over the view. */
  function seedTextNow(ctx: StyleContext, text: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = MASK_W;
    canvas.height = MASK_H;
    const c2 = canvas.getContext('2d');
    if (!c2) return;
    c2.fillStyle = '#000';
    c2.fillRect(0, 0, MASK_W, MASK_H);
    c2.fillStyle = '#fff';
    let size = 180;
    c2.font = `500 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
    while (c2.measureText(text).width > MASK_W * 0.92 && size > 40) {
      size -= 8;
      c2.font = `500 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
    }
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText(text, MASK_W / 2, MASK_H / 2);
    const img = c2.getImageData(0, 0, MASK_W, MASK_H).data;
    const red = new Uint8Array(MASK_W * MASK_H);
    // Flip vertically: canvas rows are top-down, GL textures bottom-up.
    for (let y = 0; y < MASK_H; y++) for (let x = 0; x < MASK_W; x++) {
      red[(MASK_H - 1 - y) * MASK_W + x] = img[(y * MASK_W + x) * 4];
    }
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MASK_W, MASK_H, 0, gl.RED, gl.UNSIGNED_BYTE, red);
    const cam = ctx.camera;
    const d = domain();
    const wWorld = cam.viewHeight * (ctx.width / ctx.height) * TEXT_VIEW_WIDTH;
    const hWorld = wWorld * (MASK_H / MASK_W);
    // The mask is axis-aligned in grid space; keep the camera roughly level while it shows.
    const fr = (x: number): number => x - Math.floor(x);
    maskRect = [fr((cam.center[0] - wWorld / 2) / d), fr((cam.center[1] - hWorld / 2) / d), wWorld / d, hWorld / d];
    maskFrames = Math.round(TEXT_HOLD_S * 60);
  }

  return {
    id: 'turing',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      const cam = ctx.camera;
      if (e.type === 'drop') {
        if (ctx.flash.request()) invertUntil = time + INVERT_BEATS * 60 / Math.max(60, ctx.frame.beat.bpm || 120);
        wave = { x: cam.center[0], y: cam.center[1], age: 0 };
      } else if (e.type === 'bigHit') {
        const p = cam.screenToWorld2D((rng() - 0.5) * 1.4, (rng() - 0.5) * 1.2);
        addSeed(p[0], p[1], 0.05, true);
      } else if (e.type === 'trackChange' && e.info?.title) {
        pendingText = e.info.title;
      }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      seedCooldown -= dt;
      pulse = Math.max(pulse * Math.exp(-dt / 0.18), ctx.beatOnset ? ctx.beatConfidence : 0);
      regime += (1 - Math.exp(-dt / 2.5)) * (clamp01(ctx.intensitySmoothed * 1.1 + ctx.eventState.buildProgress * 0.2) - regime);
      const cam = ctx.camera;
      if (ctx.fadeInOut > 0.1 && seedCooldown <= 0) {
        if (ctx.bassHits > 0.6) {
          const p = cam.screenToWorld2D((rng() - 0.5) * 1.8, (rng() - 0.5) * 1.6);
          addSeed(p[0], p[1], 0.012 + 0.02 * ctx.bassHits, rng() < 0.6);
          seedCooldown = SEED_COOLDOWN;
        } else if (ctx.midHits > 0.65 || ctx.highHits > 0.75) {
          const p = cam.screenToWorld2D((rng() - 0.5) * 2.2, (rng() - 0.5) * 1.8);
          addSeed(p[0], p[1], 0.008, false);
          seedCooldown = SEED_COOLDOWN;
        }
      }
      if (wave) {
        wave.age += dt;
        const r = wave.age * WAVE_SPEED * cam.viewHeight;
        for (let i = 0; i < 4; i++) {
          const a = rng() * Math.PI * 2;
          addSeed(wave.x + Math.cos(a) * r, wave.y + Math.sin(a) * r, 0.01, false);
        }
        if (wave.age > WAVE_TIME) wave = null;
      }
      if (pendingText) { seedTextNow(ctx, pendingText); pendingText = null; }
    },

    render(ctx: StyleContext): void {
      resize();
      const texel: [number, number] = [1 / grid, 1 / grid];
      gl.disable(gl.BLEND);
      if (needsInit) {
        bindTarget(gl, state.read);
        gl.useProgram(init.prog);
        setUniforms(gl, init, { u_texel: texel, u_seed: rng() * 100 });
        drawQuad(gl, quadVAO);
        needsInit = false;
      }
      // Regime from intensity.
      let f = REGIMES[0][1], k = REGIMES[0][2];
      for (let i = 1; i < REGIMES.length; i++) {
        const [t0, f0, k0] = REGIMES[i - 1], [t1, f1, k1] = REGIMES[i];
        if (regime <= t1) {
          const t = (regime - t0) / (t1 - t0);
          f = lerp(f0, f1, t); k = lerp(k0, k1, t);
          break;
        }
        f = f1; k = k1;
      }
      const steps = Math.max(1, Math.round(STEPS[quality.level] * Math.min(2, ctx.dt * 60)));
      const growth = 1 + 0.35 * pulse;
      gl.useProgram(rd.prog);
      for (let i = 0; i < steps; i++) {
        bindTarget(gl, state.write);
        const first = i === 0;
        setUniforms(gl, rd, {
          u_state: state.read.tex[0], u_texel: texel, u_feed: f, u_kill: k, u_dt: Math.min(1, 0.95 * growth),
          u_seeds: first ? padSeeds(seeds) : new Array<number>(32).fill(0), u_seed_count: first ? seeds.length / 4 : 0,
          u_mask: maskTex, u_mask_rect: maskRect, u_mask_on: first && maskFrames > 0 && maskFrames % TEXT_EVERY === 0 ? 1 : 0,
        }, ['u_seed_count']);
        drawQuad(gl, quadVAO);
        state.swap();
      }
      seeds.length = 0;
      if (maskFrames > 0) maskFrames--;

      ctx.bindScene();
      const pal = ctx.palette;
      const cam = ctx.camera;
      gl.useProgram(display.prog);
      setUniforms(gl, display, {
        u_state: state.read.tex[0], u_res: [ctx.width, ctx.height], u_center: [cam.center[0], cam.center[1]],
        u_view: cam.viewHeight, u_rot: cam.rotation * 0.5, u_domain: domain(), u_grid: grid,
        u_variant: variant === 'coral' ? 0 : 1, u_light: ctx.light, u_invert: time < invertUntil,
        u_bg: pal.bg, u_paper: pal.paper, u_ink: pal.duotone ? pal.primary : mixRgb(pal.primary, pal.secondary, 0.25),
        u_glow: pal.accent, u_hot: pal.highlight, u_pulse: pulse, u_hit: ctx.bassHits * (0.4 + 0.6 * ctx.fadeInOut), u_time: time,
      }, ['u_variant']);
      drawQuad(gl, quadVAO);
      const post = ctx.post;
      if (variant === 'coral' && ctx.light) { post.tonemap = 'none'; post.bloom = 0; post.vignette = 0.12; post.grain = 0.025; }
      else if (variant === 'bio') { post.bloom = 0.9; post.bloomThreshold = 0.75; }
    },

    setVariant(id: string): void {
      if (id === 'coral' || id === 'bio') variant = id;
    },
    getVariant: () => variant,
    setQuality(q: QualityParams): void { quality = q; },
    dispose(): void {
      state.dispose();
      gl.deleteProgram(rd.prog);
      gl.deleteProgram(display.prog);
      gl.deleteProgram(init.prog);
      gl.deleteTexture(maskTex);
    },
  };
}

function padSeeds(s: number[]): number[] {
  const out = s.slice(0, 32);
  while (out.length < 32) out.push(0, 0, 0, 0);
  return out;
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

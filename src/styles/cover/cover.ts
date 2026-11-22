/**
 * Cover — the album art becomes the visual (refs: cover/).
 *
 * The cover of what's playing sits at the centre of a ground taken from its
 * own colours (album colours drive the palette), over a feedback buffer of
 * its own swept copies: copies orbit it on ellipses and are stamped at a
 * fixed rate, so their trails smear into serrated sweeps (the same at any
 * frame rate). Each section gets its own treatment from the event layer:
 *   silence / intro   the cover alone, breathing, a soft halo
 *   steady            orbiting sweeps
 *   build             the cover slices into strips that slide faster and faster
 *   drop              a feedback tunnel of covers stamped on every beat, a
 *                     four-way mirror
 *   breakdown         the cover breaks into tiles floating at different depths
 *   kicks             the cover pulses and the sweeps flare
 *   trackChange       the tiles turn over from the old cover to the new one
 * No cover: generated artwork from the palette (Set Mode leaves Cover out).
 */

import { clamp01, createRng } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import { coverArt } from '../../engine/cover-art';
import type { SonoraEvent } from '../../engine/events';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { bindTarget, createTarget, deleteTarget, drawQuad, makeProgram, PingPong, setUniforms, type Program, type Target } from '../shared/gl';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';
import coverFrag from './shaders/cover.frag?raw';
import stampVert from './shaders/stamp.vert?raw';
import stampFrag from './shaders/stamp.frag?raw';
import warpFrag from './shaders/warp.frag?raw';
import genFrag from './shaders/genart.frag?raw';

// ── Tuning ──────────────────────────────────────────────────────
/** Feedback resolution (share of the scene) per quality. */
const FB_RES: Record<QualityParams['level'], number> = { low: 0.5, medium: 0.75, high: 1 };
/** Main cover half size (screen heights) and its breathing. */
const SIZE = 0.24;
const BREATHE = 0.012;
/** Kick pulse (size share) and decay (s). */
const KICK_PULSE = 0.08;
/** Dark ground: the secondary's luminance before it tints the second tone (Ocean's). */
const DARK_SEC_LUMA = 0.28;
const KICK_TAU = 0.15;
/** Sweeps: stamps per second (fixed rate), alpha per stamp, trail keep per 1/60 s. */
const STAMP_HZ = 36;
const STAMP_ALPHA = 0.55;
const KEEP = 0.982;
/** Orbits: count (quiet → loud), radius (screen heights), speed (rad/s). */
const ORBITS: [number, number] = [1, 3];
const ORBIT_R: [number, number] = [0.33, 0.5];
const ORBIT_SPEED: [number, number] = [0.5, 2.2];
/** Drop tunnel: zoom per 1/60 s, turn per second, how long it lasts (s). */
const TUNNEL_ZOOM = 1.012;
const TUNNEL_TURN = 0.25;
const TUNNEL_S = 9;
/** Track-change flip (s). */
const FLIP_S = 1.3;

type Mode = 0 | 1 | 2 | 3;

export function createCoverStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0xc0e2);
  let quality = deps.quality;
  const progs: Partial<Record<string, Program>> = {};
  const P = (k: string, v: string, f: string): Program => (progs[k] ??= makeProgram(gl, v, f));
  let fb: PingPong | null = null;
  let gen: Target | null = null;
  // Two cover textures: the current one and the previous (for the flip).
  const tex = [gl.createTexture()!, gl.createTexture()!];
  let cur = 0;
  let curKey = '';
  let curAspect = 1, prevAspect = 1;
  let hasTex = [false, false];
  for (const t of tex) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ── State ──
  let time = 0;
  let kick = 0;
  let kickArmed = true;
  let stampAcc = 0;
  let orbitT = rng() * 10;
  let plane = rng() * Math.PI;
  let flip = 1;
  let genSeed = rng() * 100;
  let tunnelT = 99;
  let prevPhase = 0;
  let beatWrap = false;
  let stripPhase = 0;
  let mirrorPhase = 0;
  let wasCover = false;

  function upload(img: ImageBitmap): void {
    const next = 1 - cur;
    gl.bindTexture(gl.TEXTURE_2D, tex[next]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    prevAspect = curAspect;
    curAspect = img.width / Math.max(1, img.height);
    hasTex[next] = true;
    cur = next;
  }

  function modeOf(ctx: StyleContext): { mode: Mode; amount: number; count: number } {
    const es = ctx.eventState;
    if (tunnelT < TUNNEL_S) return { mode: 2, amount: clamp01(1 - tunnelT / TUNNEL_S) * 0.9 + 0.1, count: 6 };
    if (es.section === 'breakdown') return { mode: 3, amount: 1, count: 6 };
    if (es.section === 'build') return { mode: 1, amount: 0.25 + 0.75 * es.buildProgress, count: Math.round(6 + 18 * es.buildProgress) };
    return { mode: 0, amount: 0, count: 6 };
  }

  return {
    id: 'cover',

    onEvent(e: SonoraEvent): void {
      if (e.type === 'drop') { tunnelT = 0; plane = rng() * Math.PI; }
      else if (e.type === 'trackChange') { genSeed = rng() * 100; }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const fade = ctx.fadeInOut;
      kick *= Math.exp(-dt / KICK_TAU);
      kick = Math.max(kick, ctx.bassHits * fade);
      if (ctx.bassHits < 0.3) kickArmed = true;
      if (kickArmed && ctx.bassHits > 0.55 && fade > 0.1) kickArmed = false;
      orbitT += dt * (ORBIT_SPEED[0] + (ORBIT_SPEED[1] - ORBIT_SPEED[0]) * ctx.intensitySmoothed) * (0.3 + 0.7 * fade);
      plane += dt * 0.04;
      tunnelT += dt;
      stripPhase += dt * (0.5 + 4 * ctx.eventState.buildProgress + 1.5 * ctx.intensitySmoothed);
      mirrorPhase += dt * (0.4 + ctx.intensitySmoothed);
      flip = Math.min(1, flip + dt / FLIP_S);
      beatWrap = beatWrap || ctx.beatPhase < prevPhase - 0.5;
      prevPhase = ctx.beatPhase;

      // A new cover (or none): flip to it.
      const art = coverArt();
      const key = art ? art.key + ':' + art.version : 'gen';
      if (key !== curKey) {
        if (art) { upload(art.image); flip = hasTex[1 - cur] ? 0 : 1; }
        else if (wasCover) flip = 0;
        wasCover = !!art;
        curKey = key;
      }
    },

    render(ctx: StyleContext): void {
      const pal = ctx.palette;
      const es = ctx.eventState;
      const w = Math.max(1, Math.round(ctx.width * FB_RES[quality.level])), h = Math.max(1, Math.round(ctx.height * FB_RES[quality.level]));
      if (!fb || fb.read.w !== w || fb.read.h !== h) { fb?.dispose(); fb = new PingPong(gl, w, h, { internal: gl.RGBA16F }); }
      const aspect = ctx.width / ctx.height;
      const art = coverArt();
      const fade = ctx.fadeInOut;
      const glowK = clamp01(ctx.intensityGlow);

      // Generated artwork when there's no cover (every frame: it follows palette changes).
      if (!art) {
        if (!gen) gen = createTarget(gl, 512, 512, { internal: gl.RGBA8 });
        bindTarget(gl, gen);
        gl.disable(gl.BLEND);
        const gp = P('gen', fullscreenVert, genFrag);
        gl.useProgram(gp.prog);
        setUniforms(gl, gp, { u_res: [512, 512], u_seed: genSeed, u_time: time, u_c0: pal.primary, u_c1: pal.secondary, u_c2: pal.accent, u_c3: pal.highlight, u_bg: pal.bg });
        drawQuad(gl, quadVAO);
      }
      const coverTex = art ? tex[cur] : gen!.tex[0];
      const prevTex = art ? (hasTex[1 - cur] ? tex[1 - cur] : tex[cur]) : (hasTex[cur] ? tex[cur] : gen!.tex[0]);
      const cAsp = art ? curAspect : 1;

      // Where the cover is: near the middle, drifting with the camera a little.
      const cam = ctx.camera;
      const center: [number, number] = [simplex2(time * 0.05, 1) * 0.06 + Math.sin(cam.rotation) * 0.03, simplex2(time * 0.04, 2) * 0.04];
      const size = (SIZE + BREATHE * Math.sin(time * 0.6)) * (1 + KICK_PULSE * kick) * (0.92 + 0.08 * fade) / Math.max(0.75, cam.viewHeight);
      const rotM = cam.rotation * 0.15;
      const md = modeOf(ctx);

      // 1. Feedback: fade (and in the drop, a tunnel: zoom + turn).
      const tunnel = tunnelT < TUNNEL_S;
      const k60 = ctx.dt * 60;
      bindTarget(gl, fb.write);
      gl.disable(gl.BLEND);
      const wp = P('warp', fullscreenVert, warpFrag);
      gl.useProgram(wp.prog);
      setUniforms(gl, wp, {
        u_prev: fb.read.tex[0], u_res: [w, h], u_zoom: tunnel ? Math.pow(TUNNEL_ZOOM, k60) : 1, u_rot: tunnel ? TUNNEL_TURN * ctx.dt : 0,
        u_keep: Math.pow(tunnel ? 0.95 : KEEP, k60), u_center: [0.5 + center[0] / aspect, 0.5 + center[1]],
      });
      drawQuad(gl, quadVAO);

      // 2. Stamps at a fixed rate: orbiting copies (and in the tunnel, the cover itself on each beat).
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const sp = P('stamp', stampVert, stampFrag);
      gl.useProgram(sp.prog);
      gl.bindVertexArray(quadVAO);
      const n = Math.round(ORBITS[0] + (ORBITS[1] - ORBITS[0]) * glowK);
      const showOrbits = !tunnel && md.mode !== 3 && es.section !== 'silence';
      stampAcc += ctx.dt * STAMP_HZ;
      const stamps = Math.min(8, Math.floor(stampAcc));
      stampAcc -= stamps;
      for (let s = 0; s < stamps && showOrbits; s++) {
        const tt = orbitT - (stamps - 1 - s) / STAMP_HZ * (ORBIT_SPEED[0] + (ORBIT_SPEED[1] - ORBIT_SPEED[0]) * ctx.intensitySmoothed);
        for (let i = 0; i < n; i++) {
          const ph = tt + (i * Math.PI * 2) / n;
          const R = ORBIT_R[0] + (ORBIT_R[1] - ORBIT_R[0]) * (0.5 + 0.5 * Math.sin(i * 2.1 + time * 0.1));
          const pl = plane + i * 1.1;
          const ex = Math.cos(ph) * R, ey = Math.sin(ph) * R * 0.45;
          const x = center[0] + ex * Math.cos(pl) - ey * Math.sin(pl), y = center[1] + ex * Math.sin(pl) + ey * Math.cos(pl);
          setUniforms(gl, sp, {
            u_cover: coverTex, u_center: [x, y], u_size: size * (0.55 + 0.25 * Math.cos(ph)), u_rot: ph + pl, u_aspect: aspect, u_cover_aspect: cAsp,
            u_alpha: STAMP_ALPHA * (0.35 + 0.65 * fade), u_gain: 0.9 + 0.6 * kick,
          });
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
      if (tunnel && beatWrap) {
        setUniforms(gl, sp, { u_cover: coverTex, u_center: center, u_size: size * 1.02, u_rot: rotM, u_aspect: aspect, u_cover_aspect: cAsp, u_alpha: 0.9, u_gain: 1 });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      beatWrap = false;
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      fb.swap();

      // 3. Composite.
      ctx.bindScene();
      const cp = P('cover', fullscreenVert, coverFrag);
      gl.useProgram(cp.prog);
      const light = ctx.light;
      const bg = light ? mix3(pal.paper, pal.highlight, 0.12) : mix3(pal.bg, pal.shade, 0.25);
      // The dark ground's second tone at one level in every palette (a bright secondary lifted the page).
      const sec = pal.secondary, sl = Math.max(0.2126 * sec[0] + 0.7152 * sec[1] + 0.0722 * sec[2], 1e-3);
      const secN = sec.map((x) => x * Math.min(2, Math.max(0.4, DARK_SEC_LUMA / sl))) as [number, number, number];
      const bg2 = light ? mix3(pal.paper, pal.secondary, 0.18) : mix3(pal.bg, secN, 0.22);
      const halo = light ? mix3(pal.shade, [0, 0, 0], 0.4) : mix3(pal.primary, pal.highlight, 0.3);
      setUniforms(gl, cp, {
        u_cover: coverTex, u_prev: prevTex, u_fb: fb.read.tex[0], u_res: [ctx.width, ctx.height], u_time: time,
        u_bg: bg, u_bg2: bg2, u_halo: halo, u_light: light,
        u_center: center, u_size: size, u_rot: rotM, u_mode: md.mode, u_amount: md.amount, u_count: md.count,
        u_phase: md.mode === 2 ? mirrorPhase : stripPhase, u_kick: kick, u_flip: flip, u_cover_aspect: cAsp,
      });
      drawQuad(gl, quadVAO);
      void prevAspect;
      const post = ctx.post;
      if (light) { post.tonemap = 'none'; post.bloom = 0; post.vignette = 0.12; }
      else { post.bloom = 0.35; post.vignette = 0.3; }
    },

    setQuality(q: QualityParams): void { quality = q; },
    dispose(): void {
      fb?.dispose(); deleteTarget(gl, gen);
      for (const t of tex) gl.deleteTexture(t);
      for (const p of Object.values(progs)) if (p) gl.deleteProgram(p.prog);
    },
  };
}

const mix3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

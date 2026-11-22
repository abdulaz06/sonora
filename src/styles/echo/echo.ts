/**
 * Echo — a dancer made of light (refs: echo/).
 *
 * Motion capture (CMU Graphics Lab Motion Capture Database, mocap.cs.cmu.edu;
 * converted by scripts/echo/convert-cmu.py) is retimed so each clip's own
 * beat lands on the music's beats (the clip's period is mapped onto the beat
 * clock, with a little phase correction). The figure is drawn as light: soft
 * capsules along the bones and the body's volume, seen through a slow orbit.
 * Earlier poses come back as time-echo copies in the palette, and a smear
 * buffer keeps the trails.
 *
 *   phrases / drops    switch to new moves (a short pose crossfade)
 *   drop               echoes multiply and fan out in space
 *   breakdown          slower, expressive moves; fewer, wider echoes
 *   kicks              the figure flares on the hit frame
 *   intensity          how many echoes and how far apart in time
 * Looks: Glow (light on black), Trace (red/violet on a bright ground, reel11).
 */

import { clamp01, createRng, lookAt, mat4, multiply, perspective, type Vec3 } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { RGB } from '../../engine/color-engine';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { bindTarget, createTarget, deleteTarget, drawQuad, makeProgram, setUniforms, type Target } from '../shared/gl';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';
import capsuleVert from './shaders/capsule.vert?raw';
import capsuleFrag from './shaders/capsule.frag?raw';
import displayFrag from './shaders/display.frag?raw';
import movesUrl from '../../assets/echo/moves.bin?url';

// ── Tuning ──────────────────────────────────────────────────────
/** Joint names in the move file's order (convert-cmu.py JOINTS). */
const JOINTS = ['root', 'lowerback', 'upperback', 'thorax', 'lowerneck', 'upperneck', 'head',
  'lclavicle', 'lhumerus', 'lradius', 'lwrist', 'lhand', 'rclavicle', 'rhumerus', 'rradius', 'rwrist', 'rhand',
  'lhipjoint', 'lfemur', 'ltibia', 'lfoot', 'ltoes', 'rhipjoint', 'rfemur', 'rtibia', 'rfoot', 'rtoes'];
/** Body volume: capsule radius (m) for the bone ending at each joint. */
const RADIUS: Record<string, number> = {
  lowerback: 0.13, upperback: 0.14, thorax: 0.13, lowerneck: 0.06, upperneck: 0.05, head: 0.1,
  lclavicle: 0.05, rclavicle: 0.05, lhumerus: 0.052, rhumerus: 0.052, lradius: 0.042, rradius: 0.042,
  lwrist: 0.035, rwrist: 0.035, lhand: 0.03, rhand: 0.03, lhipjoint: 0.08, rhipjoint: 0.08,
  lfemur: 0.075, rfemur: 0.075, ltibia: 0.055, rtibia: 0.055, lfoot: 0.042, rfoot: 0.042, ltoes: 0.03, rtoes: 0.03,
};
/** Echoes: count quiet → loud, in a drop; time between echoes (s) loud → quiet. */
const ECHOES: [number, number] = [3, 7];
const DROP_ECHOES = 13;
const ECHO_GAP: [number, number] = [0.1, 0.22];
/** Drop fan: lateral spread (m) and turn (rad) per echo; how long it lasts (s). */
const FAN_SPREAD = 0.42;
const FAN_TURN = 0.2;
const FAN_TAU = 5;
/** History kept for echoes (s). */
const HISTORY_S = 2.4;
/** Trail buffer keep per 1/60 s (dark, paper). */
const TRAIL_KEEP = [0.9, 0.86];
/** Camera orbit: distance (m), height, speed (rad/s). */
const CAM_DIST = 3.7;
const CAM_H = 1.25;
const ORBIT = 0.07;
/** Kick flare and decay (s). */
const KICK_FLARE = 1.1;
const KICK_TAU = 0.14;
/** Phrase length (beats) between move changes; pose crossfade (s). */
const PHRASE_BEATS = 32;
const XFADE_S = 0.5;

const mixRgb = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Clip { name: string; fps: number; frames: number; period: number; first: number; data: Int16Array }
interface Moves { joints: number; bones: [number, number][]; clips: Clip[] }

let moves: Moves | null = null;
let loading: Promise<void> | null = null;
function loadMoves(): Promise<void> {
  loading ??= fetch(movesUrl).then((r) => r.arrayBuffer()).then((buf) => {
    const v = new DataView(buf);
    let o = 4;
    const u32 = (): number => { const x = v.getUint32(o, true); o += 4; return x; };
    const f32 = (): number => { const x = v.getFloat32(o, true); o += 4; return x; };
    u32();
    const nClips = u32(), nJ = u32(), nB = u32();
    const bones: [number, number][] = [];
    for (let i = 0; i < nB; i++) { bones.push([v.getUint8(o), v.getUint8(o + 1)]); o += 2; }
    const clips: Clip[] = [];
    for (let c = 0; c < nClips; c++) {
      const len = v.getUint8(o); o += 1;
      const name = new TextDecoder().decode(new Uint8Array(buf, o, len)); o += len;
      const fps = f32(), frames = u32(), period = f32(), first = f32();
      const data = new Int16Array(buf.slice(o, o + frames * nJ * 3 * 2)); o += frames * nJ * 3 * 2;
      clips.push({ name, fps, frames, period, first, data });
    }
    moves = { joints: nJ, bones, clips };
  });
  return loading;
}

/** Which moves suit which section. */
const SET: Record<string, string[]> = {
  calm: ['modern-arms', 'modern-jete'],
  steady: ['salsa-a', 'salsa-b', 'lambada', 'modern-pirouette'],
  drive: ['twist', 'salsa-b', 'modern-pirouette', 'lambada'],
};

export function createEchoStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0xec40);
  let quality = deps.quality;
  let look: 'glow' | 'trace' = 'glow';
  void loadMoves();
  const cap = makeProgram(gl, capsuleVert, capsuleFrag);
  const disp = makeProgram(gl, fullscreenVert, displayFrag);
  const fade = makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform vec4 u_color; out vec4 frag; void main() { frag = u_color; }`);
  // Instanced capsules.
  const MAX_INST = 512;
  const inst = new Float32Array(MAX_INST * 10);
  const vao = gl.createVertexArray()!;
  const corners = gl.createBuffer()!;
  const ibuf = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
  gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
  const stride = 40;
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 24); gl.vertexAttribDivisor(3, 1);
  gl.bindVertexArray(null);
  let trail: Target | null = null;
  let fig: Target | null = null;

  // ── State ──
  let time = 0;
  let clip = -1, prevClip = -1, xfade = 1;
  let u = 0, prevU = 0;
  let beats = 0, prevPhase = 0, lastSwitchBeat = -999;
  let kick = 0;
  let fan = 0;
  let orbit = rng() * Math.PI * 2;
  const hist: { t: number; p: Float32Array }[] = [];

  const clipIndex = (name: string): number => moves?.clips.findIndex((c) => c.name === name) ?? -1;
  function pickClip(set: string[]): void {
    if (!moves) return;
    const options = set.map(clipIndex).filter((i) => i >= 0 && i !== clip);
    const next = options.length ? options[Math.floor(rng() * options.length)] : 0;
    prevClip = clip; prevU = u; xfade = clip < 0 ? 1 : 0;
    clip = next;
    const c = moves.clips[clip];
    u = c.first;
    lastSwitchBeat = beats;
  }

  /** Pose of a clip at motion time t (looping between its first beat and its end). */
  function sample(ci: number, t: number, out: Float32Array): void {
    const c = moves!.clips[ci];
    const J = moves!.joints;
    const loopStart = c.first, loopEnd = (c.frames - 2) / c.fps;
    const span = Math.max(0.5, loopEnd - loopStart);
    const tt = t > loopEnd ? loopStart + ((t - loopStart) % span) : t;
    const f = tt * c.fps;
    const i0 = Math.max(0, Math.min(c.frames - 2, Math.floor(f)));
    const a = f - i0;
    for (let j = 0; j < J * 3; j++) out[j] = (c.data[i0 * J * 3 + j] * (1 - a) + c.data[(i0 + 1) * J * 3 + j] * a) / 1000;
  }

  const poseA = new Float32Array(JOINTS.length * 3), poseB = new Float32Array(JOINTS.length * 3);

  return {
    id: 'echo',

    onEvent(e: SonoraEvent): void {
      if (!moves) return;
      if (e.type === 'drop') { pickClip(SET.drive); fan = 1; }
      else if (e.type === 'breakdown') pickClip(SET.calm);
      else if (e.type === 'trackChange') pickClip(SET.steady);
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const fadeIn = ctx.fadeInOut;
      const es = ctx.eventState;
      if (ctx.beatPhase < prevPhase - 0.5) beats = Math.floor(beats) + 1;
      beats = Math.floor(beats) + ctx.beatPhase;
      prevPhase = ctx.beatPhase;
      kick = Math.max(kick * Math.exp(-dt / KICK_TAU), ctx.bassHits * fadeIn);
      fan *= Math.exp(-dt / FAN_TAU);
      orbit += dt * ORBIT * (1 + ctx.intensitySmoothed);
      if (!moves) return;
      if (clip < 0) pickClip(es.section === 'breakdown' || es.section === 'intro' || es.section === 'silence' ? SET.calm : SET.steady);
      if (beats - lastSwitchBeat > PHRASE_BEATS) pickClip(es.section === 'breakdown' ? SET.calm : es.section === 'drop' ? SET.drive : SET.steady);
      // Retime: the clip's beat onto one (or two) music beats, nudged into phase.
      const c = moves.clips[clip];
      const beatSec = 60 / Math.max(60, Math.min(200, ctx.frame.beat.bpm || 120));
      const m = c.period / beatSec > 1.4 ? 0.5 : c.period / beatSec < 0.7 ? 2 : 1;
      let rate = c.period / (beatSec * m);
      if (ctx.beatConfidence > 0.3) {
        const motionBeat = (u - c.first) / c.period;
        let err = (motionBeat - beats / m) % 1;
        if (err > 0.5) err -= 1; if (err < -0.5) err += 1;
        rate *= 1 - Math.max(-0.25, Math.min(0.25, err * 0.6));
      }
      const quiet = es.section === 'silence' ? 0.2 : 0.35 + 0.65 * fadeIn;
      u += dt * rate * quiet;
      prevU += dt * rate * quiet;
      xfade = Math.min(1, xfade + dt / XFADE_S);
      // Pose history for the echoes (time-based).
      sample(clip, u, poseA);
      if (xfade < 1 && prevClip >= 0) {
        sample(prevClip, prevU, poseB);
        const k = xfade * xfade * (3 - 2 * xfade);
        for (let j = 0; j < poseA.length; j++) poseA[j] = poseB[j] + (poseA[j] - poseB[j]) * k;
      }
      hist.push({ t: time, p: poseA.slice() });
      while (hist.length > 2 && time - hist[0].t > HISTORY_S) hist.shift();
    },

    render(ctx: StyleContext): void {
      const W = ctx.width, H = ctx.height;
      if (!trail || trail.w !== W || trail.h !== H) {
        deleteTarget(gl, trail); deleteTarget(gl, fig);
        trail = createTarget(gl, W, H, { internal: gl.RGBA16F });
        fig = createTarget(gl, W, H, { internal: gl.RGBA16F });
      }
      const trailT = trail, figT = fig!;
      const pal = ctx.palette;
      const light = ctx.light;
      const cam = ctx.camera;
      const es = ctx.eventState;
      const glowK = clamp01(ctx.intensityGlow);
      const fadeIn = ctx.fadeInOut;

      // Camera: a slow orbit, the shared camera's surge, roll and FOV kick.
      const dist = CAM_DIST * (1 - 0.12 * cam.lurchAmount) * (W < H ? 1.25 : 1);
      const az = orbit + simplex2(time * 0.03, 1) * 0.5;
      const eye: Vec3 = [Math.sin(az) * dist, CAM_H + 0.25 * simplex2(time * 0.04, 2), Math.cos(az) * dist];
      const view = mat4(), proj = mat4(), vp = mat4();
      const roll = cam.roll * 1.3;
      lookAt(view, eye, [0, 0.95, 0], [Math.sin(roll) * Math.cos(az), Math.cos(roll), -Math.sin(roll) * Math.sin(az)]);
      const fov = (W < H ? 58 : 44) * Math.PI / 180 + (cam.fov - 52 * Math.PI / 180) * 0.6;
      perspective(proj, fov, W / H, 0.05, 50);
      multiply(vp, proj, view);
      const focal = H / (2 * Math.tan(fov / 2));
      const project = (x: number, y: number, z: number): [number, number, number] => {
        const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
        const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
        const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
        return [(cx / cw * 0.5 + 0.5) * W, (cy / cw * 0.5 + 0.5) * H, cw];
      };

      // Build capsule instances: echoes (oldest first) then the live figure.
      let n = 0;
      const addFigure = (p: Float32Array, col: RGB, inten: number, glow: number, off: [number, number], turn: number, rScale: number): void => {
        if (!moves) return;
        const ct = Math.cos(turn), st = Math.sin(turn);
        const pts: [number, number, number][] = [];
        for (let j = 0; j < moves.joints; j++) {
          const x0 = p[j * 3], y0 = p[j * 3 + 1], z0 = p[j * 3 + 2];
          const x = x0 * ct - z0 * st + off[0], z = x0 * st + z0 * ct + off[1];
          pts.push(project(x, y0, z));
        }
        for (const [a, b] of moves.bones) {
          if (n >= MAX_INST) return;
          const r = (RADIUS[JOINTS[b]] ?? 0.04) * rScale;
          const pa = pts[a], pb = pts[b];
          if (pa[2] < 0.1 || pb[2] < 0.1) continue;
          const o = n * 10;
          inst[o] = pa[0]; inst[o + 1] = pa[1]; inst[o + 2] = pb[0]; inst[o + 3] = pb[1];
          inst[o + 4] = Math.max(1, r * focal / pa[2]); inst[o + 5] = Math.max(1, r * focal / pb[2]);
          inst[o + 6] = col[0] * inten; inst[o + 7] = col[1] * inten; inst[o + 8] = col[2] * inten; inst[o + 9] = glow;
          n++;
        }
      };
      const poseAt = (delay: number): Float32Array | null => {
        const t = time - delay;
        for (let i = hist.length - 1; i > 0; i--) {
          if (hist[i - 1].t <= t) {
            const a = hist[i - 1], b = hist[i];
            const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
            const out = new Float32Array(a.p.length);
            for (let j = 0; j < out.length; j++) out[j] = a.p[j] + (b.p[j] - a.p[j]) * k;
            return out;
          }
        }
        return hist[0]?.p ?? null;
      };
      const drop = es.section === 'drop' && es.sinceDrop < 10;
      const count = Math.round((quality.level === 'low' ? 0.6 : 1) * (drop ? DROP_ECHOES : es.section === 'breakdown' ? ECHOES[0] : ECHOES[0] + (ECHOES[1] - ECHOES[0]) * glowK));
      const gap = (ECHO_GAP[1] - (ECHO_GAP[1] - ECHO_GAP[0]) * clamp01(ctx.intensitySmoothed)) * (es.section === 'breakdown' ? 1.8 : 1);
      // Echo colours run from the primary into the secondary (analogous: no grey in between).
      const ramp = (k: number): RGB => [pal.primary[0] + (pal.secondary[0] - pal.primary[0]) * k, pal.primary[1] + (pal.secondary[1] - pal.primary[1]) * k, pal.primary[2] + (pal.secondary[2] - pal.primary[2]) * k];
      const right: [number, number] = [Math.cos(az), -Math.sin(az)];
      for (let i = count; i >= 1; i--) {
        const p = poseAt(i * gap);
        if (!p) continue;
        const k = i / count;
        const side = (i % 2 ? 1 : -1) * Math.ceil(i / 2);
        const off: [number, number] = [right[0] * side * FAN_SPREAD * fan, right[1] * side * FAN_SPREAD * fan];
        const inten = (light ? 1 : 0.42) * (1 - k * 0.7) * (0.4 + 0.6 * fadeIn);
        // Dark: thin lines of light with a little glow. Paper: translucent copies (opacity in the glow slot).
        // On paper the copies darken on the hit frame (local ink, the page itself never pulses).
        addFigure(p, ramp(k), inten, light ? Math.min(1, 0.55 * (1 - 0.75 * k) * (1 + 1.6 * kick)) : 0.35, off, side * FAN_TURN * fan, light ? 1 - 0.15 * k : 0.38 - 0.12 * k);
      }
      const live = hist[hist.length - 1]?.p;
      const liveCol: RGB = light ? [pal.primary[0] * 0.75, pal.primary[1] * 0.75, pal.primary[2] * 0.75] : [pal.highlight[0] * 0.7 + pal.primary[0] * 0.3, pal.highlight[1] * 0.7 + pal.primary[1] * 0.3, pal.highlight[2] * 0.7 + pal.primary[2] * 0.3];
      const liveI = (light ? 1 - 0.3 * kick : 0.7) * (0.45 + 0.55 * fadeIn) * (1 + KICK_FLARE * kick * (light ? 0 : 1));
      const echoN = n;
      // The body's volume as a faint wide glow, the skeleton as bright lines of light.
      if (live && !light) addFigure(live, ramp(0.2), 0.1 * (0.45 + 0.55 * fadeIn) * (1 + 2 * kick), 0.8, [0, 0], 0, 1.1 + 0.15 * kick);
      if (live) addFigure(live, liveCol, liveI, light ? 0.95 : 0.6, [0, 0], 0, light ? 1 + 0.08 * kick : 0.42 + 0.06 * kick);

      gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, n * 10);
      const draw = (first: number, count_: number, glowReach: number): void => {
        if (count_ <= 0) return;
        gl.useProgram(cap.prog);
        setUniforms(gl, cap, { u_res: [W, H], u_glow: glowReach, u_light: light });
        gl.bindVertexArray(vao);
        // First instance offset: rebind attributes from `first`.
        const off = first * 40;
        gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 40, off);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 40, off + 16);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 40, off + 24);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count_);
        gl.bindVertexArray(null);
      };

      // 1. Trails: fade, then the live figure (it smears as it moves).
      bindTarget(gl, trailT);
      gl.enable(gl.BLEND);
      gl.useProgram(fade.prog);
      gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
      gl.blendColor(0, 0, 0, Math.pow(TRAIL_KEEP[light ? 1 : 0], ctx.dt * 60));
      setUniforms(gl, fade, { u_color: [0, 0, 0, 0] });
      drawQuad(gl, quadVAO);
      gl.blendFunc(gl.ONE, gl.ONE);
      draw(echoN, n - echoN, 0.8);

      // 2. The crisp figures: echoes then the live one, premultiplied over.
      bindTarget(gl, figT);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Paper: copies merge (max), so overlapping capsules never stack into dots at the joints.
      if (light) gl.blendEquation(gl.MAX); else gl.blendFunc(gl.ONE, gl.ONE);
      draw(0, n, light ? 1.2 : 1.4);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);

      // 3. Display.
      ctx.bindScene();
      gl.useProgram(disp.prog);
      // Floor pool under the dancer's feet (projected), its radius from the dancer's size on screen.
      const rx = live ? live[0] : 0, rz = live ? live[2] : 0;
      const pc = project(rx, 0, rz);
      const pr = Math.max(20, 0.9 * focal / Math.max(0.5, pc[2]));
      const poolK = (light ? 0.08 + 0.62 * kick : 0.05 + 0.32 * kick) * (0.4 + 0.6 * fadeIn);
      const poolCol = light ? mixRgb(pal.shade, pal.secondary, 0.3) : mixRgb(pal.primary, pal.highlight, 0.3);
      setUniforms(gl, disp, {
        u_trail: trailT.tex[0], u_fig: figT.tex[0], u_res: [W, H], u_bg: pal.bg, u_paper: pal.paper, u_light: light, u_time: time,
        u_pool: [pc[0], pc[1], pr * (light ? 1.2 : 1.6), pr * (light ? 0.4 : 0.45)], u_pool_k: poolK, u_pool_col: poolCol,
      });
      drawQuad(gl, quadVAO);
      const post = ctx.post;
      if (light) { post.tonemap = 'none'; post.bloom = 0; post.vignette = 0.12; }
      else { post.bloom = 0.7; post.bloomThreshold = 0.8; post.vignette = 0.35; post.exposure = 0.82; }
    },

    setQuality(q: QualityParams): void { quality = q; },
    setVariant(id: string): void { look = id === 'trace' ? 'trace' : 'glow'; void look; },
    getVariant: () => look,
    dispose(): void {
      gl.deleteProgram(cap.prog); gl.deleteProgram(disp.prog); gl.deleteProgram(fade.prog);
      gl.deleteBuffer(corners); gl.deleteBuffer(ibuf); gl.deleteVertexArray(vao);
      deleteTarget(gl, trail); deleteTarget(gl, fig);
    },
  };
}

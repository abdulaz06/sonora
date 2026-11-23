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
import bodyFrag from './shaders/body.frag?raw';
import movesUrl from '../../assets/echo/moves.bin?url';
import { trackAsset } from '../../engine/assets';

// ── Tuning ──────────────────────────────────────────────────────
/** Joint names in the move file's order (convert-cmu.py JOINTS). */
const JOINTS = ['root', 'lowerback', 'upperback', 'thorax', 'lowerneck', 'upperneck', 'head',
  'lclavicle', 'lhumerus', 'lradius', 'lwrist', 'lhand', 'rclavicle', 'rhumerus', 'rradius', 'rwrist', 'rhand',
  'lhipjoint', 'lfemur', 'ltibia', 'lfoot', 'ltoes', 'rhipjoint', 'rfemur', 'rtibia', 'rfoot', 'rtoes'];
const J = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<string, number>;
/** Body volume: radius (m) at the near end of the bone ending at each joint; it tapers to TAPER at the far end. */
const RADIUS: Record<string, number> = {
  lowerback: 0.12, upperback: 0.13, thorax: 0.13, lowerneck: 0.055, upperneck: 0.05, head: 0.1,
  lclavicle: 0.055, rclavicle: 0.055, lhumerus: 0.052, rhumerus: 0.052, lradius: 0.043, rradius: 0.043,
  lwrist: 0.034, rwrist: 0.034, lhand: 0.028, rhand: 0.028, lhipjoint: 0.085, rhipjoint: 0.085,
  lfemur: 0.08, rfemur: 0.08, ltibia: 0.056, rtibia: 0.056, lfoot: 0.045, rfoot: 0.045, ltoes: 0.032, rtoes: 0.032,
};
const TAPER = 0.8;
/** Extra capsules that fill the torso and round the head: [joint a, joint b, radius (m)]. */
const FILL: [string, string, number][] = [
  ['lclavicle', 'lhipjoint', 0.075], ['rclavicle', 'rhipjoint', 0.075], ['lclavicle', 'rclavicle', 0.07],
  ['lhipjoint', 'rhipjoint', 0.085], ['thorax', 'lhipjoint', 0.09], ['thorax', 'rhipjoint', 0.09], ['head', 'head', 0.105],
];
/** Light trails from the hands and feet: samples, time between samples (s). */
const TRAIL_JOINTS = ['lhand', 'rhand', 'ltoes', 'rtoes'];
const TRAIL_SAMPLES = 12;
const TRAIL_STEP = 0.03;
/** Time echoes (delayed copies): count quiet → loud, in a drop; time between echoes (s) loud → quiet. */
const ECHOES: [number, number] = [2, 5];
const DROP_ECHOES = 5;
const ECHO_GAP: [number, number] = [0.1, 0.22];
/** Formations of in-sync dancers: spacing (m) in a row, dancer height for a tower (m), depth spacing, ring radius. */
const ROW_GAP = 0.85;
const TOWER_GAP = 1.72;
const DEPTH_GAP = 1.9;
const RING_R = 2.4;
/** A new formation slides out from the centre over this long (s); grid rows follow each other by this delay (s). */
const SPAWN_S = 0.45;
const ROW_DELAY = 0.09;
/** History kept for echoes and trails (s). */
const HISTORY_S = 2.4;
/** Trail buffer keep per 1/60 s (dark, paper). */
const TRAIL_KEEP = [0.88, 0.86];
/** Camera orbit: distance (m), height, speed (rad/s); framing follows the formation over CAM_TAU (s). */
const CAM_DIST = 3.7;
const CAM_H = 1.25;
const ORBIT = 0.07;
const CAM_TAU = 0.6;
/** Kick: rim flare, the body's pop, decay (s). */
const KICK_FLARE = 1.0;
const KICK_POP = 0.035;
const KICK_TAU = 0.14;
/** Motion swing within each beat: faster into the beat, slower out of it (the dancer hits the beat). */
const BEAT_SWING = 0.3;
/** Phrase length (beats) between move changes; pose crossfade (s); formations change every this many beats in a drop. */
const PHRASE_BEATS = 32;
const XFADE_S = 0.5;
const FORM_BEATS = 16;
/** After a drop the formations keep going this long (s) while the music stays loud. */
const POST_DROP_S = 75;

type P3 = [number, number, number];
const FADE_FRAG = `#version 300 es
precision highp float; uniform vec4 u_color; out vec4 frag; void main() { frag = u_color; }`;
const mixRgb = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Clip { name: string; fps: number; frames: number; period: number; first: number; data: Int16Array }
interface Moves { joints: number; bones: [number, number][]; clips: Clip[] }

let moves: Moves | null = null;
let loading: Promise<void> | null = null;
function loadMoves(): Promise<void> {
  loading ??= trackAsset(fetch(movesUrl).then((r) => r.arrayBuffer()).then((buf) => {
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
  }));
  return loading;
}

/** Which moves suit which section. */
const SET: Record<string, string[]> = {
  calm: ['modern-arms', 'modern-jete', 'modern-high', 'modern-bend', 'modern-attitude', 'whirl'],
  steady: ['salsa-a', 'salsa-c', 'salsa-d', 'salsa-e', 'salsa-f', 'salsa-g', 'lambada', 'modern-pirouette', 'modern-steps', 'mickey', 'macarena'],
  drive: ['twist', 'russian-a', 'russian-b', 'breakdance', 'salsa-b', 'modern-leap', 'modern-tour', 'lambada', 'macarena'],
};
type Formation = 'solo' | 'trio' | 'row' | 'tower' | 'grid' | 'ring';
/** Drop formations, in order (each lasts FORM_BEATS). */
const DROP_FORMS: Formation[] = ['row', 'tower', 'grid', 'ring'];
interface Slot { x: number; y: number; z: number; turn: number; delay: number; k: number }

export function createEchoStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0xec40);
  let quality = deps.quality;
  let look: 'glow' | 'trace' = 'glow';
  void loadMoves();
  const cap = makeProgram(gl, capsuleVert, capsuleFrag);
  const bodyP = makeProgram(gl, capsuleVert, bodyFrag);
  const disp = makeProgram(gl, fullscreenVert, displayFrag);
  const fade = makeProgram(gl, fullscreenVert, FADE_FRAG);
  // Instanced capsules (bodies, lines, trails share one buffer in ranges).
  const MAX_INST = 3072;
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
  let bodyT: Target | null = null;

  // ── State ──
  let time = 0;
  let clip = -1, prevClip = -1, xfade = 1;
  let u = 0, prevU = 0;
  let beats = 0, prevPhase = 0, lastSwitchBeat = -999;
  let kick = 0;
  let orbit = rng() * Math.PI * 2;
  let form: Formation = 'solo', formStart = 0, formIdx = 0, formBeat = 0;
  let camAz = orbit, camY = 0.95, camDist = CAM_DIST, camLift = 0;
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
  function setForm(f: Formation): void {
    if (f === form) return;
    form = f; formStart = time; formBeat = beats;
  }

  /** Pose of a clip at motion time t (looping between its first beat and its end). */
  function sample(ci: number, t: number, out: Float32Array): void {
    const c = moves!.clips[ci];
    const nJ = moves!.joints;
    const loopStart = c.first, loopEnd = (c.frames - 2) / c.fps;
    const span = Math.max(0.5, loopEnd - loopStart);
    const tt = t > loopEnd ? loopStart + ((t - loopStart) % span) : t;
    const f = tt * c.fps;
    const i0 = Math.max(0, Math.min(c.frames - 2, Math.floor(f)));
    const a = f - i0;
    for (let j = 0; j < nJ * 3; j++) out[j] = (c.data[i0 * nJ * 3 + j] * (1 - a) + c.data[(i0 + 1) * nJ * 3 + j] * a) / 1000;
  }

  /** Where the in-sync dancers stand (the live dancer first), eased out from the centre after a change. */
  function slots(f: Formation, n: number): Slot[] {
    const out: Slot[] = [{ x: 0, y: 0, z: 0, turn: 0, delay: 0, k: 1 }];
    const sp = Math.min(1, (time - formStart) / SPAWN_S);
    const e = 1 - Math.pow(1 - sp, 3);
    if (f === 'trio') {
      for (const sd of [-1, 1]) out.push({ x: sd * ROW_GAP * e, y: 0, z: -0.35 * e, turn: 0, delay: 0, k: 0.75 });
    } else if (f === 'row') {
      for (let i = 1; i <= n; i++) {
        const side = i % 2 ? 1 : -1, c = Math.ceil(i / 2);
        out.push({ x: side * c * ROW_GAP * e, y: 0, z: 0, turn: 0, delay: 0, k: 0.85 - 0.04 * c });
      }
    } else if (f === 'tower') {
      for (let i = 1; i <= n; i++) out.push({ x: 0, y: i * TOWER_GAP * e, z: 0, turn: 0, delay: 0, k: 0.85 - 0.06 * i });
    } else if (f === 'grid') {
      const cols = 5;
      for (let i = 1; i <= n; i++) {
        const row = Math.floor(i / cols), col = (i % cols) - 2;
        if (row === 0 && col === 0) continue;
        out.push({ x: col * ROW_GAP * 1.3 * e, y: 0, z: -row * DEPTH_GAP * e, turn: 0, delay: row * ROW_DELAY, k: 0.85 - 0.12 * row });
      }
    } else if (f === 'ring') {
      for (let i = 1; i <= n; i++) {
        const a = (i / (n + 1)) * Math.PI * 2;
        out.push({ x: Math.sin(a) * RING_R * e, y: 0, z: (Math.cos(a) - 1) * RING_R * e, turn: a, delay: 0, k: 0.8 });
      }
    }
    return out;
  }

  const poseA = new Float32Array(JOINTS.length * 3), poseB = new Float32Array(JOINTS.length * 3);

  return {
    id: 'echo',

    onEvent(e: SonoraEvent): void {
      if (!moves) return;
      if (e.type === 'drop') { pickClip(SET.drive); formIdx = 0; setForm(DROP_FORMS[0]); }
      else if (e.type === 'breakdown') { pickClip(SET.calm); setForm('solo'); }
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
      orbit += dt * ORBIT * (1 + ctx.intensitySmoothed);
      // Formations: solo while quiet, a trio late in a build, the drop's sequence on the beat grid.
      // The drop section is 20 s; the loud groove after it keeps the formations going.
      const afterDrop = es.section === 'steady' && es.sinceDrop < POST_DROP_S && ctx.intensitySmoothed > 0.5;
      if (es.section === 'drop' || afterDrop) {
        if (form === 'solo' || form === 'trio') { formIdx = 0; setForm(DROP_FORMS[0]); }
        else if (beats - formBeat >= FORM_BEATS && ctx.beatPhase < 0.25) { formIdx = (formIdx + 1) % DROP_FORMS.length; setForm(DROP_FORMS[formIdx]); }
      } else if (es.section === 'build' && es.buildProgress > 0.45) setForm('trio');
      else setForm('solo');
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
        // Swing: the motion rushes into each beat and eases out of it, so steps land on the hit.
        rate *= 1 + BEAT_SWING * Math.cos(2 * Math.PI * ctx.beatPhase) * ctx.beatConfidence;
      }
      const quiet = es.section === 'silence' ? 0.2 : 0.35 + 0.65 * fadeIn;
      u += dt * rate * quiet;
      prevU += dt * rate * quiet;
      xfade = Math.min(1, xfade + dt / XFADE_S);
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
        deleteTarget(gl, trail); deleteTarget(gl, fig); deleteTarget(gl, bodyT);
        trail = createTarget(gl, W, H, { internal: gl.RGBA16F });
        fig = createTarget(gl, W, H, { internal: gl.RGBA16F });
        bodyT = createTarget(gl, W, H, { internal: gl.RGBA16F });
      }
      const trailT = trail, figT = fig!, bodyTT = bodyT!;
      const pal = ctx.palette;
      const light = ctx.light;
      const cam = ctx.camera;
      const es = ctx.eventState;
      const glowK = clamp01(ctx.intensityGlow);
      const fadeIn = ctx.fadeInOut;
      const dt = ctx.dt;
      const lowQ = quality.level === 'low';

      // Formation and its framing.
      const clones = form === 'solo' ? 0 : form === 'trio' ? 2 : form === 'row' ? (lowQ ? 6 : 10) : form === 'tower' ? (lowQ ? 4 : 7) : form === 'grid' ? (lowQ ? 9 : 14) : (lowQ ? 6 : 9);
      const sl = slots(form, clones);
      let minX = 0, maxX = 0, maxY = 1.8, minZ = 0;
      for (const q of sl) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y + 1.8); minZ = Math.min(minZ, q.z); }
      const portrait = W < H;
      const wantDist = (form === 'tower' ? 5.2 : Math.max(CAM_DIST, (maxX - minX) * (portrait ? 1.05 : 0.62) + 1.6, form === 'ring' ? RING_R * 2.2 : 0)) * (portrait ? 1.25 : 1);
      // Tower: a crane shot that rises up the stack over the formation (framed on a few dancers at a time).
      const towerK = Math.min(1, (time - formStart) / (FORM_BEATS * 60 / Math.max(60, ctx.frame.beat.bpm || 120)));
      const wantY = form === 'tower' ? 1.0 + (maxY - 2.6) * (0.5 - 0.5 * Math.cos(Math.PI * towerK)) : 0.95;
      // The grid is seen from above (rows behind each other would hide); others near eye level.
      const wantLift = form === 'grid' ? 2.2 : form === 'ring' ? 1.2 : 0;
      // Rows and grids are seen from the front (they line up end-on otherwise); solo, tower and ring orbit.
      const frontal = form === 'row' || form === 'grid' || form === 'trio';
      const wantAz = frontal ? 0.45 * Math.sin(time * 0.11) : orbit + simplex2(time * 0.03, 1) * 0.5;
      const kc = 1 - Math.exp(-dt / CAM_TAU);
      let dAz = wantAz - camAz; dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
      camAz += dAz * kc; camY += (wantY - camY) * kc; camDist += (wantDist - camDist) * kc; camLift += (wantLift - camLift) * kc;
      if (frontal) orbit = camAz - simplex2(time * 0.03, 1) * 0.5;

      const dist = camDist * (1 - 0.12 * cam.lurchAmount);
      const az = camAz;
      const lookZ = minZ * (form === 'grid' ? 0.45 : 0.3);
      const eye: Vec3 = [Math.sin(az) * dist, camY + camLift + (CAM_H - 0.95) + 0.25 * simplex2(time * 0.04, 2), Math.cos(az) * dist + lookZ];
      const view = mat4(), proj = mat4(), vp = mat4();
      const roll = cam.roll * 1.3;
      lookAt(view, eye, [0, camY, lookZ], [Math.sin(roll) * Math.cos(az), Math.cos(roll), -Math.sin(roll) * Math.sin(az)]);
      const fov = (portrait ? 58 : 44) * Math.PI / 180 + (cam.fov - 52 * Math.PI / 180) * 0.6;
      perspective(proj, fov, W / H, 0.05, 80);
      multiply(vp, proj, view);
      const focal = H / (2 * Math.tan(fov / 2));
      const project = (x: number, y: number, z: number): P3 => {
        const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
        const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
        const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
        return [(cx / cw * 0.5 + 0.5) * W, (cy / cw * 0.5 + 0.5) * H, cw];
      };

      let n = 0;
      const push = (pa: P3, pb: P3, ra: number, rb: number, col: RGB, inten: number, glow: number): void => {
        if (n >= MAX_INST || pa[2] < 0.1 || pb[2] < 0.1) return;
        const o = n * 10;
        inst[o] = pa[0]; inst[o + 1] = pa[1]; inst[o + 2] = pb[0]; inst[o + 3] = pb[1];
        inst[o + 4] = Math.max(0.8, ra * focal / pa[2]); inst[o + 5] = Math.max(0.8, rb * focal / pb[2]);
        inst[o + 6] = col[0] * inten; inst[o + 7] = col[1] * inten; inst[o + 8] = col[2] * inten; inst[o + 9] = glow;
        n++;
      };
      /** A dancer's joints placed in the world (turned about the vertical, moved, scaled about the feet). */
      const place = (p: Float32Array, q: { x: number; y: number; z: number; turn: number }, scale: number): P3[] => {
        const ct = Math.cos(q.turn), st = Math.sin(q.turn);
        const pts: P3[] = [];
        const rx = p[0], rz = p[2];
        for (let j = 0; j < JOINTS.length; j++) {
          const x0 = (p[j * 3] - rx) * scale + rx, y0 = p[j * 3 + 1] * scale, z0 = (p[j * 3 + 2] - rz) * scale + rz;
          pts.push(project(x0 * ct - z0 * st + q.x, y0 + q.y, x0 * st + z0 * ct + q.z));
        }
        return pts;
      };
      const addLines = (pts: P3[], col: RGB, inten: number, glow: number, rScale: number): void => {
        if (!moves) return;
        for (const [a, b] of moves.bones) { const r = (RADIUS[JOINTS[b]] ?? 0.04) * rScale; push(pts[a], pts[b], r, r * TAPER, col, inten, glow); }
      };
      const addBody = (pts: P3[], strength: number): void => {
        if (!moves) return;
        for (const [a, b] of moves.bones) { const r = RADIUS[JOINTS[b]] ?? 0.04; push(pts[a], pts[b], r, r * TAPER, [0, 0, 0], 0, strength); }
        for (const [a, b, r] of FILL) push(pts[J[a]], pts[J[b]], r, r, [0, 0, 0], 0, strength);
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
      const live = hist[hist.length - 1]?.p;
      const pop = 1 + KICK_POP * kick;

      // 1. Time echoes behind the centre dancer (lines of light in the palette's ramp).
      const drop = es.section === 'drop' && es.sinceDrop < 10;
      const count = Math.round((lowQ ? 0.6 : 1) * (drop ? DROP_ECHOES : es.section === 'breakdown' ? ECHOES[0] + 2 : ECHOES[0] + (ECHOES[1] - ECHOES[0]) * glowK));
      const gap = (ECHO_GAP[1] - (ECHO_GAP[1] - ECHO_GAP[0]) * clamp01(ctx.intensitySmoothed)) * (es.section === 'breakdown' ? 1.8 : 1);
      const ramp = (k: number): RGB => [pal.primary[0] + (pal.secondary[0] - pal.primary[0]) * k, pal.primary[1] + (pal.secondary[1] - pal.primary[1]) * k, pal.primary[2] + (pal.secondary[2] - pal.primary[2]) * k];
      const centre = { x: 0, y: 0, z: 0, turn: 0 };
      for (let i = count; i >= 1; i--) {
        const p = poseAt(i * gap);
        if (!p) continue;
        const k = i / count;
        const inten = (light ? 1 : 0.38) * (1 - k * 0.7) * (0.4 + 0.6 * fadeIn);
        addLines(place(p, centre, 1), ramp(k), inten, light ? Math.min(1, 0.5 * (1 - 0.75 * k) * (1 + 1.6 * kick)) : 0.3, light ? 0.95 - 0.15 * k : 0.34 - 0.1 * k);
      }
      // 2. Light trails from the hands and feet of the centre dancer.
      const trailStart = n;
      if (live) {
        const trailCol: RGB = light ? mixRgb(pal.shade, pal.secondary, 0.4) : mixRgb(pal.highlight, pal.accent, 0.35);
        const prev: (P3 | null)[] = TRAIL_JOINTS.map(() => null);
        for (let si = 0; si <= TRAIL_SAMPLES; si++) {
          const p = si === 0 ? live : poseAt(si * TRAIL_STEP);
          if (!p) break;
          const fk = 1 - si / TRAIL_SAMPLES;
          TRAIL_JOINTS.forEach((jn, ti) => {
            const j = J[jn];
            const q = project(p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
            const pq = prev[ti];
            if (pq) push(pq, q, 0.018 * (fk + 0.15), 0.018 * fk, trailCol, (light ? 0.7 : 0.75) * fk * (0.5 + 0.5 * fadeIn) * (1 + 0.8 * kick), light ? 0.6 * fk : 0.5);
            prev[ti] = q;
          });
        }
      }
      // 3. The skeleton inside each body (faint lines: the eerie robot under the skin).
      const placed = live ? sl.map((q, qi) => {
        const p = q.delay > 0 ? poseAt(q.delay) ?? live : live;
        return { pts: place(p, q, qi === 0 ? pop : 1), k: q.k };
      }) : [];
      const coreCol: RGB = light ? mixRgb(pal.shade, pal.primary, 0.2) : mixRgb(pal.highlight, [1, 1, 1], 0.25);
      let smearEnd = n;
      placed.forEach((pl, pi) => {
        addLines(pl.pts, coreCol, (light ? 0.5 : 0.28) * pl.k * (0.45 + 0.55 * fadeIn), light ? 0.55 * pl.k : 0.25, 0.16);
        if (pi === 0) smearEnd = n;   // only the centre dancer smears (clones sliding out streaked into a lattice)
      });
      const lineEnd = n;
      // 4. Bodies (distance fields, MAX-joined).
      const bodyStart = n;
      for (const pl of placed) addBody(pl.pts, pl.k);
      const bodyEnd = n;

      gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, n * 10);
      const draw = (prog: typeof cap, first: number, count_: number, glowReach: number): void => {
        if (count_ <= 0) return;
        gl.useProgram(prog.prog);
        setUniforms(gl, prog, { u_res: [W, H], u_glow: glowReach, u_light: light });
        gl.bindVertexArray(vao);
        const off = first * 40;
        gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 40, off);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 40, off + 16);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 40, off + 24);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count_);
        gl.bindVertexArray(null);
      };

      // Smear buffer: fade, then the trails and skeletons (they smear as they move).
      bindTarget(gl, trailT);
      gl.enable(gl.BLEND);
      gl.useProgram(fade.prog);
      gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
      gl.blendColor(0, 0, 0, Math.pow(TRAIL_KEEP[light ? 1 : 0], dt * 60));
      setUniforms(gl, fade, { u_color: [0, 0, 0, 0] });
      drawQuad(gl, quadVAO);
      gl.blendFunc(gl.ONE, gl.ONE);
      draw(cap, trailStart, smearEnd - trailStart, 0.6);

      // Crisp lines: echoes, trails, skeletons.
      bindTarget(gl, figT);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (light) gl.blendEquation(gl.MAX); else gl.blendFunc(gl.ONE, gl.ONE);
      draw(cap, 0, lineEnd, light ? 1.0 : 0.9);

      // Bodies.
      bindTarget(gl, bodyTT);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.blendEquation(gl.MAX);
      draw(bodyP, bodyStart, bodyEnd - bodyStart, 0);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);

      // Display.
      ctx.bindScene();
      gl.useProgram(disp.prog);
      const rx = live ? live[0] : 0, rz = live ? live[2] : 0;
      const pc = project(rx, 0, rz);
      const pr = Math.max(20, 0.9 * focal / Math.max(0.5, pc[2]));
      const poolK = (light ? 0.08 + 0.62 * kick : 0.04 + 0.26 * kick) * (0.4 + 0.6 * fadeIn);
      const poolCol = light ? mixRgb(pal.shade, pal.secondary, 0.3) : mixRgb(pal.primary, pal.highlight, 0.3);
      const fadeB = 0.45 + 0.55 * fadeIn;
      const rimCol: RGB = light ? mixRgb(pal.shade, [0, 0, 0], 0.25) : mixRgb(pal.highlight, pal.primary, 0.3);
      const rimI = light ? 1 : 0.85 * fadeB * (1 + KICK_FLARE * kick);
      const fillCol: RGB = light ? mixRgb(pal.primary, pal.paper, 0.45) : mixRgb(pal.primary, pal.bg, 0.4);
      const fillI = light ? 1 : (0.16 + 0.1 * kick) * fadeB;
      const coreI = light ? 0 : 0.12 * fadeB;
      setUniforms(gl, disp, {
        u_trail: trailT.tex[0], u_fig: figT.tex[0], u_body: bodyTT.tex[0], u_res: [W, H], u_bg: pal.bg, u_paper: pal.paper, u_light: light, u_time: time,
        u_pool: [pc[0], pc[1], pr * (light ? 1.2 : 1.6), pr * (light ? 0.4 : 0.45)], u_pool_k: poolK, u_pool_col: poolCol,
        u_body_rim: [rimCol[0] * rimI, rimCol[1] * rimI, rimCol[2] * rimI], u_body_fill: [fillCol[0] * fillI, fillCol[1] * fillI, fillCol[2] * fillI],
        u_body_core: [coreCol[0] * coreI, coreCol[1] * coreI, coreCol[2] * coreI],
      });
      drawQuad(gl, quadVAO);
      const post = ctx.post;
      // Glow: less bloom than before, so the movement reads.
      if (light) { post.tonemap = 'none'; post.bloom = 0; post.vignette = 0.12; }
      else { post.bloom = 0.42; post.bloomThreshold = 0.85; post.vignette = 0.35; post.exposure = 0.8; }
    },

    setQuality(q: QualityParams): void { quality = q; },
    setVariant(id: string): void { look = id === 'trace' ? 'trace' : 'glow'; void look; },
    getVariant: () => look,
    dispose(): void {
      gl.deleteProgram(cap.prog); gl.deleteProgram(bodyP.prog); gl.deleteProgram(disp.prog); gl.deleteProgram(fade.prog);
      gl.deleteBuffer(corners); gl.deleteBuffer(ibuf); gl.deleteVertexArray(vao);
      deleteTarget(gl, trail); deleteTarget(gl, fig); deleteTarget(gl, bodyT);
    },
  };
}

/**
 * Stage — a virtual concert lighting rig in a hazy venue (refs: stage/).
 *
 * The rig: moving-head beams on a truss and on the floor (gobo spots where
 * they land), laser fans, scanning sheets and a tunnel, LED bars, a white
 * searchlight, and in breakdowns a curtain of coloured light with a
 * chandelier glow. Seen from the crowd, the back, the side, above and the
 * stage, with cuts like a show director's.
 *
 * Choreography from the event layer, like a lighting operator:
 *   silence / intro   a few dim beams breathing, thin haze
 *   steady            mirrored sweeps locked to the beat; lasers scan
 *   build             beams converge on a rising point and sweep faster,
 *                     lasers scan tighter, the haze thickens
 *   drop              the full rig: beam fans, laser sheets and tunnel,
 *                     colour hits on the beat, a strobe (flash guard)
 *   breakdown         the curtain of light; one white searchlight rises
 *   kicks             a fixture group flashes and snaps to its next position
 *   hats              LED bars sparkle
 *   bass              the haze glow pulses
 *
 * Looks: Club (low ceiling, dense lasers), Arena (huge space, long beams),
 * Cathedral (the curtain and the searchlight, tall and narrow).
 */

import { clamp01, createRng } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { RGB } from '../../engine/color-engine';
import type { QualityParams } from '../../engine/quality';
import type { StyleContext, StyleDeps, VisualStyle } from '../visual-style';
import { createTarget, deleteTarget, drawQuad, makeProgram, setUniforms, type Program, type Target } from '../shared/gl';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';
import stageFrag from './shaders/stage.frag?raw';

// ── Tuning ──────────────────────────────────────────────────────
type Look = 'club' | 'arena' | 'cathedral';
type V3 = [number, number, number];
type Program_ = 'breathe' | 'sweep' | 'converge' | 'fan' | 'curtain';

/** Shader array sizes (stage.frag). */
const MAX_BEAMS = 18;
const MAX_FANS = 8;
const MAX_BARS = 8;
/** Moving heads used on Low (the rest are skipped: real work reduction). */
const LOW_BEAMS = 9;
/** Head intensity (HDR) per program, and lasers / bars / searchlight. */
const HEAD_GAIN: Record<Program_, number> = { breathe: 0.15, sweep: 0.3, converge: 0.25, fan: 0.42, curtain: 0.2 };
const LASER_GAIN = 2.1;
const SHEET_GAIN = 0.8;
const BAR_GAIN = 2.0;
const SEARCH_GAIN = 1.4;
/** Kick: group flash decay (s) and boost; pattern snap (rad). */
const KICK_TAU = 0.14;
const KICK_BOOST = 1.6;
const KICK_SNAP = 0.22;
/** Bass haze pulse decay (s). */
const BASS_TAU = 0.16;
/** Haze density follows its target this slowly (s): a drop never clears the haze on one frame. */
const HAZE_TAU = 0.9;
/** Build: how much the haze thickens at full build progress. */
const HAZE_BUILD = 0.45;
/** Head aim easing (s) per program. */
const AIM_TAU: Record<Program_, number> = { breathe: 0.9, sweep: 0.22, converge: 0.35, fan: 0.14, curtain: 0.8 };
/** Searchlight rise speed (m/s) and curtain fade (s). */
const SEARCH_RISE = 22;
const CURTAIN_TAU = 1.2;
/** Blinder hit: attack and decay (s); drop always asks, big hits in a drop section ask this often.
 * The fixtures blast (heads and LED bars to white-hot), not the room: a whole-room wash lifts the
 * dark haze in one frame, and the background may not step more than 0.02 a frame (motion gate).
 * The room itself takes only a faint wash. */
const STROBE_ATTACK = 0.035;
const STROBE_TAU = 0.12;
const STROBE_HAZE = 0.02;
const BLINDER_HEADS = 1.6;
const BLINDER_BARS = 4;
/** The drop strobe starts this long after the drop's cut (a cut and a blast on one frame jump too far). */
const STROBE_DELAY = 0.06;
const STROBE_HIT_CHANCE = 0.4;
/** Shots: shortest and usual length (beats); first shots after a drop switch faster. */
const SHOT_MIN_S = 6;
const SHOT_BEATS = 32;
const DROP_SHOT_BEATS = 16;
/** Cuts dissolve over this long (s): still a cut to the eye, but no single frame jumps. */
const CUT_DISSOLVE_S = 0.16;
/** Drop "full rig" lasts this many beats, then the drop section sweeps with fans. */
const FULL_RIG_BEATS = 32;

interface LookCfg {
  room: [number, number, number, number];   // half width, height, back z, front z
  trussY: number; trussZ: number; trussHW: number; trussN: number;
  floorZ: number; floorHW: number; floorN: number;
  stageZ: number;
  beamTan: number; beamLen: number; beamR: number;
  laserY: number; laserReach: number; laserHW: number;
  hazeBase: number; reflect: number;
  curtainBase: number; searchBase: number;
  floorCol: number;
  tunnel: boolean;
  /** Exposure for this look (the arena's long throws read darker, the cathedral's curtain brighter). */
  exposure: number;
}

const LOOKS: Record<Look, LookCfg> = {
  club: {
    room: [11, 6.5, -15, 18], trussY: 5.8, trussZ: -11, trussHW: 6.5, trussN: 8,
    floorZ: -9.6, floorHW: 7.5, floorN: 4, stageZ: -12,
    beamTan: 0.02, beamLen: 40, beamR: 0.05,
    laserY: 4.6, laserReach: 40, laserHW: 4,
    hazeBase: 1.0, reflect: 0.8, curtainBase: 0, searchBase: 0, floorCol: 0.012, tunnel: true, exposure: 1,
  },
  arena: {
    room: [46, 30, -55, 70], trussY: 21, trussZ: -42, trussHW: 26, trussN: 12,
    floorZ: -38, floorHW: 30, floorN: 4, stageZ: -45,
    beamTan: 0.014, beamLen: 140, beamR: 0.14,
    laserY: 16, laserReach: 130, laserHW: 14,
    hazeBase: 0.42, reflect: 0.65, curtainBase: 0, searchBase: 0, floorCol: 0.008, tunnel: true, exposure: 1.2,
  },
  cathedral: {
    room: [14, 34, -32, 34], trussY: 29, trussZ: -22, trussHW: 8, trussN: 8,
    floorZ: -20, floorHW: 9, floorN: 2, stageZ: -24,
    beamTan: 0.016, beamLen: 80, beamR: 0.09,
    laserY: 22, laserReach: 70, laserHW: 6,
    hazeBase: 0.5, reflect: 0.7, curtainBase: 0.45, searchBase: 0.3, floorCol: 0.01, tunnel: false, exposure: 0.74,
  },
};

interface Head { pos: V3; up: boolean; side: number; group: number; dir: V3; slot: number }
interface Shot { name: string; pos: V3; target: V3; fov: number; crowd: number }

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mixV = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Direction from pan (around y, 0 = toward the audience, +z) and tilt (0 = straight down / up). */
const aim = (pan: number, tilt: number, up: boolean): V3 => [Math.sin(pan) * Math.sin(tilt), (up ? 1 : -1) * Math.cos(tilt), Math.cos(pan) * Math.sin(tilt)];

export function createStageStyle(deps: StyleDeps): VisualStyle {
  const { gl, quadVAO } = deps;
  const rng = createRng(deps.seed ^ 0x5a6e);
  let quality = deps.quality;
  let look: Look = 'club';
  let cfg = LOOKS[look];
  let prog: Program | null = null;
  const program = (): Program => (prog ??= makeProgram(gl, fullscreenVert, stageFrag));
  // Cut dissolve: the last frame is kept; after a cut it fades out over the new shot.
  let hold: Target | null = null;
  let dissolve = 0;
  let blend: Program | null = null;
  const blendProgram = (): Program => (blend ??= makeProgram(gl, fullscreenVert, `#version 300 es
precision highp float; uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_a; out vec4 frag;
void main() { frag = vec4(texture(u_tex, gl_FragCoord.xy / u_res).rgb, u_a); }`));

  // ── Rig ──
  let heads: Head[] = [];
  function buildRig(): void {
    heads = [];
    for (let i = 0; i < cfg.trussN; i++) {
      const x = -cfg.trussHW + (2 * cfg.trussHW * i) / Math.max(1, cfg.trussN - 1);
      const side = x < -0.1 ? -1 : x > 0.1 ? 1 : 0;
      heads.push({ pos: [x, cfg.trussY, cfg.trussZ], up: false, side, group: i % 4, dir: [0, -1, 0], slot: i % 4 });
    }
    for (let i = 0; i < cfg.floorN; i++) {
      const x = -cfg.floorHW + (2 * cfg.floorHW * i) / Math.max(1, cfg.floorN - 1);
      heads.push({ pos: [x, 0.35, cfg.floorZ], up: true, side: x < 0 ? -1 : 1, group: 4, dir: [0, 1, 0], slot: 2 });
    }
  }
  buildRig();

  // ── State ──
  let time = 0;
  let beats = 0, prevPhase = 0;
  let kickGroup = 0;
  const groupFlash = [0, 0, 0, 0, 0];
  const groupStep = [0, 0, 0, 0, 0];
  let kickArmed = true;
  let bassEnv = 0;
  let strobeT = 9;
  let dropBeat = -999;
  let curtain = 0;
  let searchLen = 0;
  let colourShift = 0;
  let sparkle = 0;
  let laserScan = 0;
  let lastBeat = 0;
  let hazeNow = 0.5;
  // Camera shots.
  let shot = 0, shotStart = 0, shotBeat = 0, shotLen = SHOT_BEATS;
  let section = 'silence';

  const beatPos = (): number => beats;

  function programOf(ctx: StyleContext): Program_ {
    const es = ctx.eventState;
    if (es.section === 'breakdown') return 'curtain';
    if (es.section === 'build') return 'converge';
    if (es.section === 'drop' && beatPos() - dropBeat < FULL_RIG_BEATS) return 'fan';
    if (es.section === 'silence' || ctx.fadeInOut < 0.35 || (es.section === 'intro' && ctx.intensityGlow < 0.3)) return 'breathe';
    return 'sweep';
  }

  // Shots by look scale (room units).
  function shots(): ((ts: number) => Shot)[] {
    const [hw, h, back, front] = cfg.room;
    const mid = (back + front) * 0.5;
    const sz = cfg.stageZ;
    return [
      // 0 crowd: eye height among the crowd, looking up at the rig
      (ts) => ({ name: 'crowd', pos: [Math.sin(ts * 0.05) * hw * 0.12, 1.7, mid * 0.35 + 3], target: [Math.sin(ts * 0.07) * hw * 0.08, h * 0.55, sz], fov: 62, crowd: 1 }),
      // 1 back wide: high at the back, the whole rig; a slow push in
      (ts) => ({ name: 'wide', pos: [Math.sin(ts * 0.03) * hw * 0.2, h * 0.42, front - 2 - ts * 0.18 * (h / 6.5)], target: [0, h * 0.38, sz], fov: 55, crowd: 0.55 }),
      // 2 side: from the side, across the beams
      (ts) => ({ name: 'side', pos: [hw * 0.82, h * 0.5, sz + (front - sz) * 0.3 + Math.sin(ts * 0.04) * 2], target: [-hw * 0.25, h * 0.4, sz + (front - sz) * 0.12], fov: 58, crowd: 0 }),
      // 3 overhead: above the floor, looking down at the gobos and the beams' heads
      (ts) => ({ name: 'over', pos: [Math.sin(ts * 0.04) * hw * 0.2, h * 0.92, sz + (front - sz) * 0.42], target: [0, 0, sz + (front - sz) * 0.12 + Math.sin(ts * 0.05) * 2], fov: 62, crowd: 0 }),
      // 4 stage: from behind the rig, beams streaming out over the crowd
      (ts) => ({ name: 'stage', pos: [Math.sin(ts * 0.06) * hw * 0.15, h * 0.32, back + 1.5], target: [0, h * 0.22, front], fov: 64, crowd: 0 }),
    ];
  }

  function pickShot(ctx: StyleContext, reason: 'drop' | 'phrase' | 'section'): void {
    const es = ctx.eventState;
    let pool: number[];
    if (es.section === 'breakdown') pool = [0];
    else if (es.section === 'build') pool = [0, 4];
    else if (reason === 'drop') pool = [1, 2, 3];
    else if (es.section === 'drop') pool = [1, 2, 3, 4, 0];
    else if (es.section === 'silence' || es.section === 'intro') pool = [1, 0];
    else pool = [0, 1, 2, 3, 4];
    const choices = pool.filter((x) => x !== shot);
    shot = choices.length ? choices[Math.floor(rng() * choices.length)] : pool[0];
    shotStart = time;
    dissolve = 1;
    shotBeat = beatPos();
    shotLen = es.section === 'drop' ? DROP_SHOT_BEATS : SHOT_BEATS;
  }

  function paletteSlot(pal: StyleContext['palette'], i: number): RGB {
    const k = ((i % 4) + 4) % 4;
    return k === 0 ? pal.primary : k === 1 ? pal.secondary : k === 2 ? pal.accent : pal.highlight;
  }

  return {
    id: 'stage',

    onEvent(e: SonoraEvent, ctx: StyleContext): void {
      if (e.type === 'drop') {
        dropBeat = beatPos();
        if (ctx.flash.request()) strobeT = -STROBE_DELAY;
        colourShift++;
        pickShot(ctx, 'drop');
      } else if (e.type === 'bigHit' && ctx.eventState.section === 'drop' && rng() < STROBE_HIT_CHANCE) {
        if (ctx.flash.request()) strobeT = 0;
      } else if (e.type === 'breakdown') {
        pickShot(ctx, 'section');
      } else if (e.type === 'build') {
        if (time - shotStart > SHOT_MIN_S) pickShot(ctx, 'section');
      } else if (e.type === 'trackChange') {
        colourShift += 2;
      }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      // Beat clock: count phase wraps (the tracker's phase), so moves land on beats.
      const ph = ctx.beatPhase;
      if (ph < prevPhase - 0.5) beats = Math.floor(beats) + 1;
      beats = Math.floor(beats) + ph;
      prevPhase = ph;

      const fade = ctx.fadeInOut;
      const es = ctx.eventState;
      const prg = programOf(ctx);
      bassEnv = Math.max(bassEnv * Math.exp(-dt / BASS_TAU), ctx.bassHits * fade);
      sparkle = Math.max(sparkle * Math.exp(-dt / 0.12), ctx.highHits);
      strobeT += dt;
      for (let g = 0; g < groupFlash.length; g++) groupFlash[g] *= Math.exp(-dt / KICK_TAU);

      // Kicks: one group flashes on the hit frame and snaps to its next position.
      if (ctx.bassHits < 0.3) kickArmed = true;
      if (kickArmed && ctx.bassHits > 0.55 && fade > 0.15) {
        kickArmed = false;
        groupFlash[kickGroup] = 1;
        groupStep[kickGroup] = groupStep[kickGroup] > 0 ? -KICK_SNAP : KICK_SNAP;
        kickGroup = (kickGroup + 1) % 4;
        groupFlash[4] = Math.max(groupFlash[4], 0.6);
      }
      // Colour hits: every beat in the first bars after a drop rotates the colours.
      if (prg === 'fan' && Math.floor(beats) !== lastBeat) colourShift++;
      lastBeat = Math.floor(beats);

      // Curtain and searchlight.
      const curtainWant = Math.max(cfg.curtainBase * (es.section === 'drop' ? 0.35 : 1), es.section === 'breakdown' ? 1 : 0);
      curtain += (curtainWant - curtain) * (1 - Math.exp(-dt / CURTAIN_TAU));
      const searchOn = es.section === 'breakdown' || (cfg.searchBase > 0 && es.section !== 'drop' && es.section !== 'silence');
      searchLen = searchOn ? Math.min(cfg.beamLen, searchLen + dt * SEARCH_RISE * (cfg.room[1] / 30 + 0.5)) : Math.max(0, searchLen - dt * cfg.beamLen * 2);

      // Laser scan speed: builds scan faster.
      laserScan += dt * (0.25 + 0.6 * ctx.intensitySmoothed + 2.2 * es.buildProgress) * (prg === 'fan' ? 2 : 1);

      // Aim the heads.
      const bp = beatPos();
      const tau = AIM_TAU[prg];
      const k = 1 - Math.exp(-dt / tau);
      const focus: V3 = [Math.sin(time * (0.3 + 2.2 * es.buildProgress)) * cfg.room[0] * 0.25 * (1 - es.buildProgress),
        cfg.room[1] * (0.15 + 0.55 * es.buildProgress), cfg.stageZ + (cfg.room[3] - cfg.stageZ) * 0.3];
      heads.forEach((hd, i) => {
        let want: V3;
        const n = heads.length;
        if (prg === 'converge' && !hd.up) want = norm(sub(focus, hd.pos));
        else if (prg === 'converge') want = norm(sub(add(focus, [0, cfg.room[1] * 0.3, 0]), hd.pos));
        else if (prg === 'fan') {
          const fi = i / Math.max(1, n - 1) - 0.5;
          const wave = 0.18 * Math.sin(bp * Math.PI / 4 + i * 0.55);
          want = hd.up ? aim(hd.side * 0.45 + wave, 0.25 + 0.15 * Math.sin(bp * Math.PI / 2), true) : aim(fi * 1.7 + groupStep[hd.group] * 0.5, 1.05 + wave, false);
        } else if (prg === 'curtain') {
          want = hd.up ? aim(hd.side * 0.15, 0.08, true) : aim(hd.side * 0.08 + 0.03 * Math.sin(time * 0.3 + i), 0.12 + 0.05 * Math.sin(time * 0.2 + i), false);
        } else if (prg === 'breathe') {
          want = hd.up ? aim(hd.side * 0.2, 0.15 + 0.1 * Math.sin(time * 0.2 + i), true) : aim(hd.side * 0.3 + 0.1 * Math.sin(time * 0.17 + i), 0.8 + 0.2 * Math.sin(time * 0.23 + i * 1.3), false);
        } else {
          // Sweep: mirrored pairs, eight-beat pan and sixteen-beat tilt cycles per group.
          const g = hd.group;
          const pan = (hd.side || 1) * (0.2 + 0.38 * Math.sin((2 * Math.PI * bp) / 8 + g * 0.9)) + groupStep[Math.min(g, 3)];
          const tilt = 0.95 + 0.32 * Math.sin((2 * Math.PI * bp) / 16 + g * 1.4);
          want = hd.up ? aim(pan * 0.6, 0.2 + 0.25 * (0.5 + 0.5 * Math.sin((2 * Math.PI * bp) / 8 + i)), true) : aim(pan, tilt, false);
        }
        hd.dir = norm(mixV(hd.dir, want, k));
      });

      // Shots: phrase cuts (never sooner than SHOT_MIN_S).
      if (es.section !== section) { section = es.section; }
      if (beatPos() - shotBeat > shotLen && time - shotStart > SHOT_MIN_S) pickShot(ctx, 'phrase');
    },

    render(ctx: StyleContext): void {
      const p = program();
      const pal = ctx.palette;
      const cam = ctx.camera;
      const es = ctx.eventState;
      const fade = ctx.fadeInOut;
      const prg = programOf(ctx);
      const low = quality.level === 'low';
      const glowK = clamp01(ctx.intensityGlow);

      // ── Camera: the shot, with the shared camera's roll, drop surge and FOV kick ──
      const sh = shots()[shot](time - shotStart);
      const fwd0 = norm(sub(sh.target, sh.pos));
      const surge = cam.lurchAmount * cfg.room[1] * 0.12;
      const drift: V3 = [simplex2(time * 0.07, 3) * 0.04 * cfg.room[1], simplex2(time * 0.06, 5) * 0.03 * cfg.room[1], 0];
      const pos = add(add(sh.pos, mul(fwd0, surge)), drift);
      const fwd = norm(sub(add(sh.target, drift), pos));
      let right = norm(cross(fwd, [0, 1, 0]));
      let up = cross(right, fwd);
      const roll = cam.roll * 1.5;
      const cr = Math.cos(roll), sr = Math.sin(roll);
      [right, up] = [add(mul(right, cr), mul(up, sr)), add(mul(up, cr), mul(right, -sr))];
      const fovKick = cam.fov - (52 * Math.PI) / 180;
      const fov = (sh.fov * Math.PI) / 180 + fovKick;
      const tanHalf = Math.tan(fov / 2);

      // ── Beams: moving heads + the searchlight ──
      const beamPos: number[] = [], beamDir: number[] = [], beamCol: number[] = [], beamExt: number[] = [];
      const maxHeads = low ? LOW_BEAMS : MAX_BEAMS - 1;
      const blinder = strobeT >= 0 && strobeT < 1 ? (strobeT < STROBE_ATTACK ? strobeT / STROBE_ATTACK : Math.exp(-(strobeT - STROBE_ATTACK) / STROBE_TAU)) : 0;
      const headGain = HEAD_GAIN[prg] * (0.25 + 0.75 * fade) * (prg === 'breathe' ? 0.5 + 0.5 * glowK : 0.7 + 0.5 * glowK) * (1 + BLINDER_HEADS * blinder);
      const used = heads.slice(0, maxHeads);
      used.forEach((hd, i) => {
        let on = 1;
        if (prg === 'breathe') on = i % 3 === 0 ? 0.6 + 0.4 * Math.sin(time * 0.5 + i) : 0;
        if (prg === 'curtain' && hd.up) on = 0.3;
        const flash = 1 + KICK_BOOST * groupFlash[Math.min(hd.group, 4)];
        const slot = prg === 'curtain' ? 0 : hd.slot + colourShift;
        const c = paletteSlot(pal, slot);
        const inten = headGain * on * flash;
        beamPos.push(hd.pos[0], hd.pos[1], hd.pos[2], cfg.beamR);
        beamDir.push(hd.dir[0], hd.dir[1], hd.dir[2], cfg.beamTan * (prg === 'curtain' ? 1.6 : 1));
        beamCol.push(c[0] * inten, c[1] * inten, c[2] * inten, hd.up ? 0 : (i % 3) + 1);
        beamExt.push(cfg.beamLen, 0.35, 0.7, 0);
      });
      if (searchLen > 0.5) {
        const wob = 0.015 * Math.sin(time * 0.4);
        const sAmt = (es.section === 'breakdown' ? 1 : cfg.searchBase) * (0.4 + 0.6 * fade);
        beamPos.push(0, 0.3, cfg.stageZ + 2.5, cfg.beamR * 1.3);
        beamDir.push(wob, 1, 0.02, 0.0045);
        beamCol.push(SEARCH_GAIN * sAmt, SEARCH_GAIN * sAmt * 0.98, SEARCH_GAIN * sAmt * 1.02, 0);
        beamExt.push(searchLen, 0.45, 1.5, 0);
      }
      const beamCount = beamPos.length / 4;
      while (beamPos.length < MAX_BEAMS * 4) { beamPos.push(0, 0, 0, 0.1); beamDir.push(0, -1, 0, 0.01); beamCol.push(0, 0, 0, 0); beamExt.push(1, 0, 0, 0); }

      // ── Lasers: fans, sheets, tunnel; the curtain (vertical fans) ──
      const fanPos: number[] = [], fanDir: number[] = [], fanNrm: number[] = [], fanCol: number[] = [];
      const pushFan = (src: V3, centre: V3, rightV: V3, span: number, count: number, col: RGB, gain: number, reach: number, lw: number): void => {
        if (fanPos.length / 4 >= MAX_FANS || gain <= 0.001) return;
        const c = norm(centre);
        const n = norm(cross(rightV, c));
        fanPos.push(src[0], src[1], src[2], reach);
        fanDir.push(c[0], c[1], c[2], span);
        fanNrm.push(n[0], n[1], n[2], count);
        fanCol.push(col[0] * gain, col[1] * gain, col[2] * gain, lw);
      };
      const lsrc: V3 = [0, cfg.laserY, cfg.stageZ + 0.5];
      const laserOn = prg === 'sweep' ? 0.55 + 0.45 * glowK : prg === 'converge' ? 0.8 : prg === 'fan' ? 1.2 : prg === 'breathe' ? 0.15 * fade : 0;
      const lg = LASER_GAIN * laserOn * (0.3 + 0.7 * fade);
      const scanTilt = 0.08 + 0.2 * Math.sin(laserScan);
      const bpr = es.buildProgress;
      if (lg > 0) {
        const span = prg === 'converge' ? 0.5 - 0.38 * bpr : prg === 'fan' ? 0.7 : 0.4;
        const count = prg === 'fan' ? 23 : Math.round(9 + 8 * glowK + 6 * bpr);
        const lc = paletteSlot(pal, 2 + colourShift);
        // Over the crowd: a fan tilted a little downward, scanning.
        pushFan(lsrc, [0, -scanTilt, 1], [1, 0, 0], span, count, lc, lg, cfg.laserReach, 0.0016);
        if (prg !== 'breathe' && !low) {
          // Mirrored side fans.
          const hw = cfg.laserHW;
          const lc2 = paletteSlot(pal, 1 + colourShift);
          const tilt2 = 0.12 + 0.18 * Math.sin(laserScan * 1.3 + 1.0);
          pushFan([-hw, cfg.laserY * 0.92, cfg.stageZ + 0.5], [0.35, -tilt2, 1], [1, 0, -0.35], span * 0.7, Math.round(count * 0.6), lc2, lg * 0.8, cfg.laserReach, 0.0016);
          pushFan([hw, cfg.laserY * 0.92, cfg.stageZ + 0.5], [-0.35, -tilt2, 1], [1, 0, 0.35], span * 0.7, Math.round(count * 0.6), lc2, lg * 0.8, cfg.laserReach, 0.0016);
        }
        if (prg === 'fan') {
          // Scanning sheets sweeping on the beat.
          const sw = Math.sin(beatPos() * Math.PI / 2);
          const sc = paletteSlot(pal, 3 + colourShift);
          pushFan(lsrc, [0, -0.05 - 0.22 * (0.5 + 0.5 * sw), 1], [1, 0, 0], 0.65, 0, sc, SHEET_GAIN * (0.3 + 0.7 * fade), cfg.laserReach, 0.002);
        }
      }
      if (curtain > 0.01) {
        // The curtain: vertical fans of beams falling from high over the stage, in three layers.
        const top: V3 = [0, cfg.room[1] * 0.96, cfg.stageZ + 1];
        const cc = mixV(pal.primary, pal.accent, 0.25);
        const ca = curtain * (0.3 + 0.7 * fade);
        for (let L = 0; L < 3 && fanPos.length / 4 < MAX_FANS; L++) {
          const z = cfg.stageZ + 1 + L * (cfg.room[3] - cfg.stageZ) * 0.06;
          pushFan([top[0], top[1], z], [0, -1, 0.04 * L], [1, 0, 0], 0.95 - L * 0.12, low ? 24 : 64 - L * 12, L === 1 ? pal.primary : cc, ca * (1.4 - L * 0.3), cfg.room[1] * 1.4, 0.0035 + L * 0.0015);
        }
      }
      const fanCount = fanPos.length / 4;
      while (fanPos.length < MAX_FANS * 4) { fanPos.push(0, 0, 0, 1); fanDir.push(0, 0, 1, 0.1); fanNrm.push(0, 1, 0, 0); fanCol.push(0, 0, 0, 0.002); }

      // Tunnel: in the full rig, a cone of beams from the stage toward the crowd.
      const tunnelOn = cfg.tunnel && prg === 'fan' && !low && Math.floor((beatPos() - dropBeat) / 8) % 2 === 1;
      const tc = paletteSlot(pal, 2 + colourShift);
      const tg = tunnelOn ? LASER_GAIN * 1.3 * fade : 0;
      const coneAx = norm([0, -0.12, 1]);

      // ── LED bars: stage lip, truss front, two uprights ──
      const barA: number[] = [], barB: number[] = [], barC: number[] = [];
      const pushBar = (a: V3, b: V3, px: number, col: RGB, gain: number, phase: number): void => {
        if (barA.length / 4 >= MAX_BARS) return;
        barA.push(a[0], a[1], a[2], px); barB.push(b[0], b[1], b[2], phase); barC.push(col[0] * gain, col[1] * gain, col[2] * gain, sparkle);
      };
      const barGain = BAR_GAIN * (0.25 + 0.75 * fade) * (0.45 + 0.55 * glowK) * (1 + 1.4 * groupFlash[4] + BLINDER_BARS * blinder);
      const chase = beatPos() / 4;
      const hwb = cfg.trussHW * 1.15;
      pushBar([-hwb, 1.1, cfg.stageZ + 2], [hwb, 1.1, cfg.stageZ + 2], 48, paletteSlot(pal, 0 + colourShift), barGain, chase);
      pushBar([-hwb, cfg.trussY - 0.5, cfg.trussZ + 0.4], [hwb, cfg.trussY - 0.5, cfg.trussZ + 0.4], 64, paletteSlot(pal, 3 + colourShift), barGain * 0.7, -chase);
      pushBar([-hwb - 1, 0.2, cfg.stageZ + 1], [-hwb - 1, cfg.trussY * 0.85, cfg.stageZ + 1], 24, paletteSlot(pal, 1 + colourShift), barGain * 0.8, chase * 2);
      pushBar([hwb + 1, 0.2, cfg.stageZ + 1], [hwb + 1, cfg.trussY * 0.85, cfg.stageZ + 1], 24, paletteSlot(pal, 1 + colourShift), barGain * 0.8, chase * 2 + 0.5);
      const barCount = barA.length / 4;
      while (barA.length < MAX_BARS * 4) { barA.push(0, -99, 0, 1); barB.push(1, -99, 0, 0); barC.push(0, 0, 0, 0); }

      // ── Haze ──
      const hazeWant = cfg.hazeBase * (0.55 + HAZE_BUILD * bpr + 0.25 * glowK + 0.35 * curtain) * (0.4 + 0.6 * fade);
      hazeNow += (hazeWant - hazeNow) * (1 - Math.exp(-ctx.dt / HAZE_TAU));
      const haze = hazeNow;
      const ambC = mixV(pal.primary, pal.secondary, 0.4);
      // The room's ambient haze follows the energy only (a bass pulse here lifted the whole night: motion gate).
      const amb = (0.01 + 0.02 * glowK) * (0.3 + 0.7 * fade);
      const curtainAmb = curtain * 0.07;
      const hazeAmb: V3 = [ambC[0] * amb + pal.primary[0] * curtainAmb, ambC[1] * amb + pal.primary[1] * curtainAmb, ambC[2] * amb + pal.primary[2] * curtainAmb];
      const strobe = STROBE_HAZE * blinder;

      const flo = cfg.floorCol;
      const curtainCol = mixV(pal.primary, pal.shade, 0.15);
      const curtainI = curtain * (0.35 + 0.65 * fade) * (1 + 0.25 * bassEnv) * 0.75;
      ctx.bindScene();
      gl.disable(gl.BLEND);
      gl.useProgram(p.prog);
      setUniforms(gl, p, {
        u_res: [ctx.width, ctx.height], u_time: time,
        u_cam_pos: pos, u_cam_fwd: fwd, u_cam_right: right, u_cam_up: up, u_tan_half: tanHalf,
        u_room: cfg.room, u_px: (2 * tanHalf) / ctx.height,
        u_beam_count: beamCount, u_beam_pos: beamPos, u_beam_dir: beamDir, u_beam_col: beamCol, u_beam_ext: beamExt,
        u_fan_count: fanCount, u_fan_pos: fanPos, u_fan_dir: fanDir, u_fan_nrm: fanNrm, u_fan_col: fanCol,
        u_cone_pos: [0, cfg.laserY * 0.7, cfg.stageZ + 1, Math.cos(0.18)], u_cone_dir: [coneAx[0], coneAx[1], coneAx[2], 24],
        u_cone_col: [tc[0] * tg, tc[1] * tg, tc[2] * tg, laserScan * 0.7],
        u_bar_count: barCount, u_bar_a: barA, u_bar_b: barB, u_bar_col: barC,
        u_haze: haze, u_haze_amb: hazeAmb, u_strobe: strobe,
        u_crowd: sh.crowd, u_crowd_bob: Math.pow(1 - ctx.beatPhase, 3) * ctx.beatConfidence * fade,
        u_reflect: low ? 0 : cfg.reflect * (quality.level === 'high' ? 1 : 0.85),
        u_rim: mixV(paletteSlot(pal, colourShift), [1, 1, 1], 0.2), u_floor_col: [flo, flo, flo * 1.2],
        u_curtain: [curtainCol[0] * curtainI, curtainCol[1] * curtainI, curtainCol[2] * curtainI, cfg.stageZ + 0.6],
        u_curtain2: mul(pal.accent, curtainI * 0.6),
        u_glitter: curtain * (0.4 + 0.6 * fade), u_glitter_pos: [0, cfg.room[1] * 0.9, cfg.stageZ + 1.5], u_glitter_col: mixV(pal.highlight, [1, 1, 1], 0.3),
      });
      drawQuad(gl, quadVAO);

      // Cut dissolve: blend the held frame over the new shot; otherwise keep this frame.
      if (!hold || hold.w !== ctx.width || hold.h !== ctx.height) {
        deleteTarget(gl, hold);
        hold = createTarget(gl, ctx.width, ctx.height, { internal: gl.RGBA16F });
        dissolve = 0;
        ctx.bindScene();
      }
      if (dissolve > 0.001) {
        const bp_ = blendProgram();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(bp_.prog);
        setUniforms(gl, bp_, { u_tex: hold.tex[0], u_res: [ctx.width, ctx.height], u_a: dissolve * dissolve * (3 - 2 * dissolve) });
        drawQuad(gl, quadVAO);
        gl.disable(gl.BLEND);
        dissolve = Math.max(0, dissolve - ctx.dt / CUT_DISSOLVE_S);
      } else {
        const sceneFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneFb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, hold.fb);
        gl.blitFramebuffer(0, 0, ctx.width, ctx.height, 0, 0, ctx.width, ctx.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFb);
      }

      const post = ctx.post;
      post.bloom = 0.6;
      post.bloomThreshold = 0.8;
      post.exposure = cfg.exposure;
      post.vignette = 0.35;
      post.grain = Math.max(post.grain, 0.035);
    },

    setQuality(q: QualityParams): void { quality = q; },
    setVariant(id: string): void {
      const l: Look = id === 'arena' ? 'arena' : id === 'cathedral' ? 'cathedral' : 'club';
      if (l === look) return;
      look = l;
      cfg = LOOKS[look];
      buildRig();
      shot = 1; shotStart = time;
    },
    getVariant: () => look,
    dispose(): void {
      if (prog) gl.deleteProgram(prog.prog);
      if (blend) gl.deleteProgram(blend.prog);
      deleteTarget(gl, hold);
    },
  };
}

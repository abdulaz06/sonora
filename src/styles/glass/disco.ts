/**
 * Glass › Chrome: a universe of mirror-ball planets (disco.frag), flown
 * through with a chase camera like Voyage's.
 *
 *   kicks      a ring of tilting, flashing tiles runs across every planet
 *              (on the hit frame, from the side facing the camera)
 *   bars       pairs of planets ram into each other, the contact landing on
 *              a beat; the collision sends a big ring across both
 *   drop       the camera surges, the nearest big pair collides on the next
 *              beat with a flash (flash guard)
 *   intensity  flight speed, spin; highs sparkle the glints
 *   build      the flight slows, planets spin up
 * The planets are placed along the flight path from a hash (an endless field)
 * and drawn exactly (ray–sphere), so the cost doesn't depend on detail.
 */

import { clamp01, createRng } from '../../engine/math';
import { simplex2 } from '../../engine/noise';
import type { SonoraEvent } from '../../engine/events';
import type { StyleContext } from '../visual-style';
import { drawQuad, makeProgram, setUniforms, type Program } from '../shared/gl';
import fullscreenVert from '../../engine/shaders/fullscreen.vert?raw';
import discoFrag from './shaders/disco.frag?raw';

// ── Tuning ──────────────────────────────────────────────────────
/** Planets drawn at most (High / Medium / Low). */
const MAX_PL = 24;
const PLANETS: Record<'low' | 'medium' | 'high', number> = { low: 12, medium: 20, high: 24 };
/** Field: cell length along the path (m), planets per cell, lateral distance (m), radius range (m), rare giants. */
const CELL = 9;
const LATERAL: [number, number] = [3.5, 12];
const RADIUS: [number, number] = [0.7, 3.0];
const GIANT: [number, number, number] = [0.12, 4.5, 6.5];   // chance, radius range
const AHEAD = 95;
/** Flight speed (m/s) quiet → loud; drop surge (m/s) and its decay (s). */
const SPEED: [number, number] = [2.0, 7.5];
const SURGE = 14;
const SURGE_TAU = 1.1;
/** Collisions: approach time (beats) so the contact lands on a beat; bounce-back share and decay (s). */
const APPROACH_BEATS = 2;
const BOUNCE = 0.45;
const BOUNCE_TAU = 0.6;
/** Collisions every this many beats: drop / loud / otherwise (0 = none). */
const COLLIDE_EVERY = { drop: 4, loud: 8, calm: 0 };
/** Ring strengths: kick, collision. */
const KICK_RING = 1.0;
const HIT_RING = 1.8;
/** Planet surfaces stay at least this far from the flight path (m). */
const CLEARANCE = 2.6;
/** Distance fog (1/m). */
const FOG = 0.011;

interface Planet { key: number; base: [number, number, number]; r: number; rows: number; tint: number; seed: number; spinRate: number; spin: number;
  off: [number, number, number]; rip: [number, number, number, number]; rip2: [number, number, number, number]; ripAmp: [number, number] }
interface Collision { a: number; b: number; t0: number; dur: number; dir: [number, number, number]; gap: number; flash: boolean; hit: boolean }

const hash = (n: number): number => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export interface Disco {
  onEvent(e: SonoraEvent, ctx: StyleContext): void;
  update(ctx: StyleContext): void;
  draw(ctx: StyleContext, w: number, h: number, level: 'low' | 'medium' | 'high'): void;
  dispose(): void;
}

export function createDisco(gl: WebGL2RenderingContext, quadVAO: WebGLVertexArrayObject, seed: number): Disco {
  const rng = createRng(seed ^ 0xd15c);
  const progs: Partial<Record<string, Program>> = {};
  const prog = (bounce: number): Program => (progs[bounce] ??= makeProgram(gl, fullscreenVert, discoFrag, `#define MAX_PL ${MAX_PL}\n#define BOUNCE ${bounce}`));

  let time = 0, s = 0, surge = 0, kick = 0, sparkle = 0, flash = 0;
  let beats = 0, prevPhase = 0, lastCollideBeat = 0;
  let kickArmed = true;
  const planets = new Map<number, Planet>();
  const collisions: Collision[] = [];
  let pendingDrop = false;

  const path = (z: number): [number, number, number] => [6 * Math.sin(z * 0.031) + 3 * Math.sin(z * 0.013 + 1.3), 2.5 * Math.sin(z * 0.023 + 0.4), -z];

  /** Planets of the cells around the camera (created from a hash, kept while in range). */
  function refresh(): void {
    const c0 = Math.floor((s - 8) / CELL), c1 = Math.floor((s + AHEAD) / CELL);
    for (const [k] of planets) { const c = Math.floor(k / 4); if (c < c0 || c > c1) planets.delete(k); }
    for (let c = c0; c <= c1; c++) {
      const count = hash(c * 3.1) < 0.35 ? 1 : 2;
      for (let j = 0; j < count; j++) {
        const key = c * 4 + j;
        if (planets.has(key)) continue;
        const h1 = hash(key * 1.7 + 0.3), h2 = hash(key * 2.9 + 1.1), h3 = hash(key * 4.3 + 2.7), h4 = hash(key * 5.9 + 3.3);
        const giant = h4 < GIANT[0];
        const r = giant ? GIANT[1] + (GIANT[2] - GIANT[1]) * h3 : RADIUS[0] + (RADIUS[1] - RADIUS[0]) * h3 * h3;
        const z = (c + h1) * CELL;
        const a = h2 * Math.PI * 2;
        const d = Math.max(LATERAL[0] + r, LATERAL[0] + (LATERAL[1] - LATERAL[0]) * hash(key * 7.7) + r * 0.6);
        const p = path(z);
        planets.set(key, {
          key, base: [p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d * 0.6, p[2]], r, rows: Math.round(10 + r * 6),
          tint: Math.floor(hash(key * 9.1) * 4), seed: hash(key * 11.3) * 100, spinRate: (0.08 + 0.25 * hash(key * 13.7)) * (hash(key * 15.1) < 0.5 ? -1 : 1), spin: h1 * 6,
          off: [0, 0, 0], rip: [0, 1, 0, 9], rip2: [0, 1, 0, 9], ripAmp: [0, 0],
        });
      }
    }
  }

  /** A planet's place, kept clear of the flight path (a collision could push one into the camera's way). */
  const posOf = (p: Planet): [number, number, number] => {
    const c: [number, number, number] = [p.base[0] + p.off[0], p.base[1] + p.off[1], p.base[2] + p.off[2]];
    const q = path(-c[2]);
    const dx = c[0] - q[0], dy = c[1] - q[1];
    const d = Math.hypot(dx, dy) || 1e-3;
    const need = p.r + CLEARANCE;
    if (d < need) { c[0] = q[0] + dx / d * need; c[1] = q[1] + dy / d * need; }
    return c;
  };

  /** Two planets ahead that can meet: close enough to each other, far enough ahead to be seen coming. */
  function startCollision(beatSec: number, withFlash: boolean, ahead: [number, number]): void {
    const cand = [...planets.values()].filter((p) => { const dz = -p.base[2] - s; return dz > ahead[0] && dz < ahead[1]; });
    let best: [Planet, Planet, number] | null = null;
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
      const A = cand[i], B = cand[j];
      if (collisions.some((c) => c.a === A.key || c.b === A.key || c.a === B.key || c.b === B.key)) continue;
      const pa = posOf(A), pb = posOf(B);
      const dist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      const gap = dist - A.r - B.r;
      if (gap < 0.5 || gap > 11) continue;
      const score = (A.r + B.r) * 2 - gap * 0.3;
      if (!best || score > best[2]) best = [A, B, score];
    }
    if (!best) return;
    const [A, B] = best;
    const pa = posOf(A), pb = posOf(B);
    const d: [number, number, number] = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    collisions.push({ a: A.key, b: B.key, t0: time, dur: APPROACH_BEATS * beatSec, dir: [d[0] / L, d[1] / L, d[2] / L], gap: L - A.r - B.r, flash: withFlash, hit: false });
  }

  return {
    onEvent(e: SonoraEvent): void {
      if (e.type === 'drop') { surge = 1; pendingDrop = true; }
    },

    update(ctx: StyleContext): void {
      const dt = ctx.dt;
      time += dt;
      const fade = ctx.fadeInOut;
      const es = ctx.eventState;
      if (ctx.beatPhase < prevPhase - 0.5) beats = Math.floor(beats) + 1;
      beats = Math.floor(beats) + ctx.beatPhase;
      prevPhase = ctx.beatPhase;
      const beatSec = 60 / Math.max(60, Math.min(200, ctx.frame.beat.bpm || 120));
      surge *= Math.exp(-dt / SURGE_TAU);
      kick = Math.max(kick * Math.exp(-dt / 0.16), ctx.bassHits * fade);
      sparkle = Math.max(sparkle * Math.exp(-dt / 0.12), ctx.highHits);
      flash *= Math.exp(-dt / 0.12);
      const build = es.section === 'build' ? es.buildProgress : 0;
      s += dt * ((SPEED[0] + (SPEED[1] - SPEED[0]) * ctx.intensitySmoothed) * (0.35 + 0.65 * fade) * (1 - 0.5 * build) + SURGE * surge);
      refresh();
      for (const p of planets.values()) {
        p.spin += dt * p.spinRate * (0.5 + ctx.intensitySmoothed + 2 * build);
        p.rip[3] += dt; p.rip2[3] += dt;
      }
      // Kicks: a ring on every planet, from the side facing the camera (frame-accurate).
      if (ctx.bassHits < 0.3) kickArmed = true;
      if (kickArmed && ctx.bassHits > 0.55 && fade > 0.1) {
        kickArmed = false;
        const cam = path(s);
        for (const p of planets.values()) {
          const c = posOf(p);
          const v = [cam[0] - c[0] + (rng() - 0.5) * p.r, cam[1] - c[1] + (rng() - 0.5) * p.r, cam[2] - c[2]];
          const L = Math.hypot(v[0], v[1], v[2]) || 1;
          p.rip = [v[0] / L, v[1] / L, v[2] / L, 0];
          p.ripAmp[0] = KICK_RING * Math.min(1, ctx.bassHits * 1.2) * fade;
        }
      }
      // Collisions on the beat grid; the drop's lands one beat after the drop.
      if (pendingDrop) { pendingDrop = false; startCollision(beatSec * 0.5, true, [14, 40]); lastCollideBeat = Math.floor(beats); }
      const every = es.section === 'drop' ? COLLIDE_EVERY.drop : ctx.intensitySmoothed > 0.55 ? COLLIDE_EVERY.loud : COLLIDE_EVERY.calm;
      if (every > 0 && Math.floor(beats) - lastCollideBeat >= every && Math.floor(beats) % 2 === 0) {
        lastCollideBeat = Math.floor(beats);
        startCollision(beatSec, false, [22, 55]);
      }
      for (let i = collisions.length - 1; i >= 0; i--) {
        const c = collisions[i];
        const A = planets.get(c.a), B = planets.get(c.b);
        if (!A || !B) { collisions.splice(i, 1); continue; }
        const t = time - c.t0;
        const total = A.r + B.r;
        // Approach (eased in: they accelerate into each other), then a damped bounce back.
        const share = t < c.dur ? Math.pow(t / c.dur, 2.2) : 1 - BOUNCE * (1 - Math.exp(-(t - c.dur) / BOUNCE_TAU)) * Math.exp(-(t - c.dur) / (BOUNCE_TAU * 3));
        const move = c.gap * share * 0.5;
        const wa = B.r / total, wb = A.r / total;   // the smaller planet moves more
        A.off = [c.dir[0] * move * 2 * wa, c.dir[1] * move * 2 * wa, c.dir[2] * move * 2 * wa];
        B.off = [-c.dir[0] * move * 2 * wb, -c.dir[1] * move * 2 * wb, -c.dir[2] * move * 2 * wb];
        if (!c.hit && t >= c.dur) {
          c.hit = true;
          A.rip2 = [c.dir[0], c.dir[1], c.dir[2], 0]; A.ripAmp[1] = HIT_RING;
          B.rip2 = [-c.dir[0], -c.dir[1], -c.dir[2], 0]; B.ripAmp[1] = HIT_RING;
          if (c.flash && ctx.flash.request()) flash = 1;
        }
        if (t > c.dur + 6) collisions.splice(i, 1);
      }
    },

    draw(ctx: StyleContext, w: number, h: number, level: 'low' | 'medium' | 'high'): void {
      const pal = ctx.palette;
      const cam = ctx.camera;
      // Chase camera: on the path, looking ahead, banking into the curves.
      const eye = path(s);
      eye[0] += simplex2(time * 0.05, 1) * 0.8; eye[1] += simplex2(time * 0.04, 2) * 0.5;
      const ahead = path(s + 11);
      const f = norm([ahead[0] - eye[0], ahead[1] - eye[1], ahead[2] - eye[2]]);
      const curve = path(s + 20)[0] - 2 * path(s + 10)[0] + eye[0];
      const roll = cam.roll * 1.2 - curve * 0.04;
      let r = norm(cross(f, [0, 1, 0]));
      let u = cross(r, f);
      [r, u] = [add(mul(r, Math.cos(roll)), mul(u, Math.sin(roll))), add(mul(u, Math.cos(roll)), mul(r, -Math.sin(roll)))];
      const fov = 62 * Math.PI / 180 + (cam.fov - 52 * Math.PI / 180) + kick * 0.03;

      // The nearest planets (by distance), up to the quality's count.
      const list = [...planets.values()].map((p) => ({ p, c: posOf(p) }))
        .filter(({ c, p }) => -c[2] - s > -p.r - 2)
        .sort((a, b) => Math.hypot(a.c[0] - eye[0], a.c[1] - eye[1], a.c[2] - eye[2]) - Math.hypot(b.c[0] - eye[0], b.c[1] - eye[1], b.c[2] - eye[2]))
        .slice(0, Math.min(MAX_PL, PLANETS[level]));
      const pl: number[] = [], sp: number[] = [], rp: number[] = [], rp2: number[] = [], ra: number[] = [];
      for (let i = 0; i < MAX_PL; i++) {
        const e = list[i];
        if (!e) { pl.push(0, -999, 0, 0.01); sp.push(0, 10, 0, 0); rp.push(0, 1, 0, 9); rp2.push(0, 1, 0, 9); ra.push(0, 0); continue; }
        pl.push(e.c[0], e.c[1], e.c[2], e.p.r);
        sp.push(e.p.spin, e.p.rows, e.p.tint, e.p.seed);
        rp.push(...e.p.rip); rp2.push(...e.p.rip2);
        ra.push(e.p.rip[3] < 3 ? e.p.ripAmp[0] : 0, e.p.rip2[3] < 4 ? e.p.ripAmp[1] : 0);
      }
      const glowK = clamp01(ctx.intensityGlow);
      const sunA = time * 0.01;
      // Sun 0 rides behind the camera (a spotlight: the near face of every ball catches it); two coloured suns ahead.
      const back = norm([-f[0] + 0.35 * u[0] + 0.2 * Math.sin(sunA * 7) * r[0], -f[1] + 0.35 * u[1], -f[2] + 0.35 * u[2]]);
      const suns = [back, norm([Math.cos(sunA) * 0.8, 0.3, -0.6]), norm([-0.6, -0.25 + 0.1 * Math.sin(sunA * 3), -0.7])];
      const sc = (c: readonly number[], k: number): number[] => [c[0] * k, c[1] * k, c[2] * k];
      const p = prog(level === 'low' ? 0 : 1);
      gl.useProgram(p.prog);
      setUniforms(gl, p, {
        u_res: [w, h], u_time: time, u_cam_pos: eye, u_cam_fwd: f, u_cam_right: r, u_cam_up: u, u_tan_half: Math.tan(fov / 2),
        u_count: list.length, u_pl: pl, u_spin: sp, u_rip: rp, u_rip2: rp2, u_rip_amp: ra,
        u_c0: pal.primary, u_c1: pal.secondary, u_c2: pal.accent, u_c3: pal.highlight, u_bg: pal.bg,
        u_sun_dir: [...suns[0], ...suns[1], ...suns[2]],
        u_sun_col: [...sc(mixc(pal.highlight, [1, 1, 1], 0.5), (0.9 + 0.5 * glowK) * (1 + 0.6 * kick)), ...sc(pal.primary, 1.3 + 0.6 * glowK), ...sc(pal.accent, 1.0 + 0.5 * glowK)],
        u_glint: sparkle, u_fog: FOG, u_flash: flash, u_twinkle: (0.012 + 0.05 * sparkle + 0.04 * kick) * (0.4 + 0.6 * ctx.fadeInOut),
      });
      drawQuad(gl, quadVAO);
    },

    dispose(): void { for (const x of Object.values(progs)) if (x) gl.deleteProgram(x.prog); },
  };
}

type V3 = [number, number, number];
const norm = (a: readonly number[]): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: readonly number[], k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const mixc = (a: readonly number[], b: readonly number[], t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Event layer — turns continuous mapping signals into discrete musical events
 * every style can subscribe to.
 *
 *   drop        sharp energy + bass return after a build, a silence gap, or a
 *               long bass-less stretch
 *   build       sustained rising tension (energy trend up, or highs without bass)
 *   breakdown   bass gone and energy low for a while after a full section
 *   bigHit      an accented low-end impact clearly above the running level
 *   trackChange silence gap followed by sound (placeholder until media info
 *               arrives); `notifyTrackChange` lets a media source fire it directly
 *
 * Runs once per analysis frame (60 Hz of audio time), so it is deterministic
 * for a given input regardless of render frame rate. Every state uses
 * hysteresis (evidence integrators with separate enter/exit levels) so events
 * do not flicker.
 */

import type { AudioFeatureFrame } from '../types/audio-frame';
import { clamp01, expApproach } from './math';

// ── Tuning ──────────────────────────────────────────────────────
const FRAME_DT = 1 / 60;
/** Energy followers (s). */
const FAST_TAU = 0.2;
const MID_TAU = 1.5;
/** Running loudness reference (half-life, s) and floor (raw RMS). */
const REF_HALF_LIFE = 40;
const REF_FLOOR = 0.01;
/** Raw RMS below which audio counts as silent. */
const SILENCE_RMS = 0.0025;
/** History windows (s). */
const HISTORY_S = 6;

/** Build: evidence seconds to enter / exit, and cap. */
const BUILD_ENTER = 2.5;
const BUILD_EXIT = 0.6;
const BUILD_CAP = 6;
/** Mid-level rise over 4 s that counts as a rising trend. */
const BUILD_TREND = 0.06;
/** Typical build length used to normalise `buildProgress` (s). */
const BUILD_TYPICAL_S = 16;

/** Kick-activity follower (s) and gain over bass-band hits. */
const KICK_TAU = 0.8;
const KICK_GAIN = 1.6;
/** Seconds of sound before drops/bigHits can fire (reference must settle). */
const SETTLE_S = 6;
/** Drop: required jumps (relative to the reference) within `DROP_WINDOW_S`. */
const DROP_WINDOW_S = 0.9;
const DROP_ENERGY_JUMP = 0.3;
const DROP_LOW_JUMP = 0.4;
/** Silence gaps longer than this are track changes, not pre-drop gaps (s). */
const DROP_MAX_GAP_S = 4;
const DROP_ARM_AFTER_BUILD_S = 5;
const DROP_ARM_AFTER_GAP_S = 3;
const DROP_BASSLESS_S = 5;
const DROP_REFRACTORY_S = 10;
/** How long the post-drop envelope lasts (s). */
const DROP_ENVELOPE_S = 2.5;
/** How long the `drop` section label is held after a drop (s). */
const DROP_SECTION_S = 20;

/** Breakdown evidence seconds to enter / exit. */
const BREAKDOWN_ENTER = 2.0;
const BREAKDOWN_EXIT = 0.8;
const BREAKDOWN_CAP = 4;

/** bigHit thresholds and refractory (s). */
const BIGHIT_BASS = 0.85;
const BIGHIT_SPIKE = 1.35;
const BIGHIT_REFRACTORY_S = 0.9;

/** trackChange: silence length required before sound resumes (s). */
const TRACK_GAP_S = 1.5;

/** Events kept for the debug overlay. */
const RECENT_EVENTS = 8;

export type SonoraEventType = 'drop' | 'build' | 'breakdown' | 'bigHit' | 'trackChange';
export type Section = 'silence' | 'intro' | 'steady' | 'build' | 'drop' | 'breakdown';

export interface TrackInfo {
  title?: string;
  artist?: string;
  source: 'gap' | 'media';
}

export interface SonoraEvent {
  type: SonoraEventType;
  /** 0–1. */
  strength: number;
  /** Analysis time (s since the detector started). */
  time: number;
  info?: TrackInfo;
}

export interface EventState {
  section: Section;
  /** 0–1 while in a build, else 0. */
  buildProgress: number;
  /** 1 at a drop, decaying to 0 over a few seconds. */
  dropEnvelope: number;
  /** Seconds since the last drop (Infinity before the first). */
  sinceDrop: number;
  /** Seconds of continuous silence (0 when sound is playing). */
  silentFor: number;
  /** Fast loudness relative to the running reference (≈0–1.2). */
  level: number;
  /** Recent events, newest last. */
  recent: SonoraEvent[];
}

type Listener = (e: SonoraEvent) => void;

/** Fixed-size ring of numbers sampled once per analysis frame. */
class Ring {
  private buf: Float32Array;
  private pos = 0;
  private filled = 0;
  constructor(size: number) { this.buf = new Float32Array(size); }
  push(v: number): void {
    this.buf[this.pos] = v;
    this.pos = (this.pos + 1) % this.buf.length;
    if (this.filled < this.buf.length) this.filled++;
  }
  /** Value `framesAgo` frames back (clamped to the oldest stored). */
  ago(framesAgo: number): number {
    const n = Math.min(framesAgo, this.filled - 1);
    if (n < 0) return 0;
    return this.buf[(this.pos - 1 - n + this.buf.length * 2) % this.buf.length];
  }
  /** Minimum over the last `frames` frames. */
  minOver(frames: number): number {
    const n = Math.min(frames, this.filled);
    let m = Infinity;
    for (let i = 0; i < n; i++) m = Math.min(m, this.ago(i));
    return n === 0 ? 0 : m;
  }
}

export class EventDetector {
  private time = 0;
  private fast = 0;
  private mid = 0;
  private ref = REF_FLOOR;

  private levelHist = new Ring(Math.ceil(HISTORY_S / FRAME_DT));
  private midHist = new Ring(Math.ceil(HISTORY_S / FRAME_DT));
  private bassHist = new Ring(Math.ceil(HISTORY_S / FRAME_DT));
  private highHist = new Ring(Math.ceil(HISTORY_S / FRAME_DT));

  private buildScore = 0;
  private inBuild = false;
  private buildStart = 0;
  private lastBuildTime = -Infinity;

  private breakdownScore = 0;
  private inBreakdown = false;

  private lastDrop = -Infinity;
  private lastGapEnd = -Infinity;
  private basslessFor = 0;
  private silentFor = 0;
  private hadSound = false;
  private lastBigHit = -Infinity;
  private kick = 0;
  private soundFor = 0;
  private gapLength = 0;

  private queue: SonoraEvent[] = [];
  private listeners: Listener[] = [];
  private recent: SonoraEvent[] = [];
  private stateCache: EventState = {
    section: 'silence', buildProgress: 0, dropEnvelope: 0, sinceDrop: Infinity,
    silentFor: 0, level: 0, recent: [],
  };

  /** Subscribe to events as they are detected (analysis-rate). */
  on(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  /** Remove and return events detected since the last drain. */
  drain(): SonoraEvent[] {
    if (this.queue.length === 0) return EMPTY;
    const q = this.queue;
    this.queue = [];
    return q;
  }

  get state(): EventState { return this.stateCache; }

  /** Fire a trackChange from a media-info source (Prompt 3). */
  notifyTrackChange(info: Omit<TrackInfo, 'source'>): void {
    this.emit('trackChange', 1, { ...info, source: 'media' });
  }

  reset(): void {
    const listeners = this.listeners;
    Object.assign(this, new EventDetector());
    this.listeners = listeners;
  }

  process(f: AudioFeatureFrame): void {
    const dt = FRAME_DT;
    this.time += dt;
    const t = this.time;
    const rms = f.energy.instant;

    this.fast += expApproach(dt, FAST_TAU) * (rms - this.fast);
    this.mid += expApproach(dt, MID_TAU) * (rms - this.mid);
    this.ref = Math.max(this.ref * Math.pow(0.5, dt / REF_HALF_LIFE), this.mid, REF_FLOOR);
    const level = this.fast / this.ref;
    const midLevel = this.mid / this.ref;
    const highs = Math.max(f.presence.upper_mid, f.presence.high, f.presence.air);
    const bassHit = Math.max(f.hits.sub_bass, f.hits.bass);
    // Drum/low-end drive: kick activity or sustained sub. Pads leak into the
    // 60–250 Hz band, so the bass band alone is not used.
    this.kick += expApproach(dt, KICK_TAU) * (Math.min(1, bassHit * KICK_GAIN) - this.kick);
    const low = Math.max(this.kick, f.presence.sub_bass * 0.85);

    // ── Silence + trackChange (gap) ──
    const silent = rms < SILENCE_RMS;
    if (silent) {
      this.silentFor += dt;
    } else {
      if (this.silentFor >= TRACK_GAP_S && this.hadSound) this.emit('trackChange', 1, { source: 'gap' });
      if (this.silentFor > 0) { this.lastGapEnd = t; this.gapLength = this.silentFor; }
      if (this.silentFor > DROP_MAX_GAP_S) this.soundFor = 0;
      this.silentFor = 0;
      this.hadSound = true;
      this.soundFor += dt;
    }
    // A near-silent dip inside music (pre-drop gap) also arms drops.
    if (level < 0.15 && midLevel > 0.2) { this.lastGapEnd = t; this.gapLength = 0.5; }
    const settled = this.soundFor > SETTLE_S;

    this.basslessFor = low < 0.3 ? this.basslessFor + dt : 0;

    // ── Drop ──
    const dropFrames = Math.round(DROP_WINDOW_S / dt);
    const energyJump = level - this.levelHist.minOver(dropFrames);
    const lowJump = low - this.bassHist.minOver(dropFrames);
    const armed =
      this.inBuild ||
      t - this.lastBuildTime < DROP_ARM_AFTER_BUILD_S ||
      (t - this.lastGapEnd < DROP_ARM_AFTER_GAP_S && this.gapLength <= DROP_MAX_GAP_S) ||
      this.bassHist.minOver(Math.round(DROP_BASSLESS_S / dt)) < 0.25;
    const sinceDrop = t - this.lastDrop;
    if (
      armed && settled && sinceDrop > DROP_REFRACTORY_S && !silent &&
      energyJump > DROP_ENERGY_JUMP && lowJump > DROP_LOW_JUMP && low > 0.5 && level > 0.5
    ) {
      const strength = clamp01(0.4 + energyJump * 0.8 + lowJump * 0.4);
      this.lastDrop = t;
      this.inBuild = false;
      this.buildScore = 0;
      this.inBreakdown = false;
      this.breakdownScore = 0;
      this.emit('drop', strength);
    }

    // ── Build ──
    const frames4s = Math.round(4 / dt);
    const trend = midLevel - this.midHist.ago(frames4s);
    const highsTrend = highs - this.highHist.ago(frames4s);
    const tension = !silent && settled && midLevel > 0.15 && (
      (trend > BUILD_TREND && highsTrend > 0) ||
      (low < 0.3 && highs > 0.4 && highsTrend > 0.05)
    );
    const recentlyDropped = t - this.lastDrop < 6;
    this.buildScore = Math.min(BUILD_CAP, Math.max(0, this.buildScore + (tension && !recentlyDropped ? dt : -1.5 * dt)));
    if (!this.inBuild && this.buildScore > BUILD_ENTER) {
      this.inBuild = true;
      this.buildStart = t - this.buildScore;
      this.inBreakdown = false;
      this.breakdownScore = 0;
      this.emit('build', clamp01(0.4 + Math.max(0, trend) * 3 + highs * 0.3));
    } else if (this.inBuild && this.buildScore < BUILD_EXIT) {
      this.inBuild = false;
    }
    if (this.inBuild) this.lastBuildTime = t;

    // ── Breakdown ──
    const hadFullSection = this.lastDrop > -Infinity || this.bassHist.ago(frames4s) > 0.5;
    const calm = !silent && this.kick < 0.25 && highs < 0.45 && midLevel < 0.75;
    this.breakdownScore = Math.min(BREAKDOWN_CAP, Math.max(0,
      this.breakdownScore + (calm && !this.inBuild ? dt : -2 * dt)));
    if (!this.inBreakdown && this.breakdownScore > BREAKDOWN_ENTER && hadFullSection) {
      this.inBreakdown = true;
      this.emit('breakdown', clamp01(1 - midLevel));
    } else if (this.inBreakdown && this.breakdownScore < BREAKDOWN_EXIT) {
      this.inBreakdown = false;
    }

    // ── bigHit ──
    if (
      settled && bassHit > BIGHIT_BASS && this.fast > this.mid * BIGHIT_SPIKE && level > 0.45 &&
      t - this.lastBigHit > BIGHIT_REFRACTORY_S
    ) {
      this.lastBigHit = t;
      this.emit('bigHit', clamp01(bassHit * (this.fast / Math.max(this.mid, 1e-4)) / 2));
    }

    this.levelHist.push(level);
    this.midHist.push(midLevel);
    this.bassHist.push(low);
    this.highHist.push(highs);

    // ── State snapshot ──
    let section: Section;
    if (this.silentFor > 1.5 || f.fade_in_out < 0.05) section = 'silence';
    else if (this.inBuild) section = 'build';
    else if (this.inBreakdown) section = 'breakdown';
    else if (t - this.lastDrop < DROP_SECTION_S) section = 'drop';
    else if (!settled || f.fade_in_out < 0.9) section = 'intro';
    else section = 'steady';

    const s = this.stateCache;
    s.section = section;
    s.buildProgress = this.inBuild ? clamp01((t - this.buildStart) / BUILD_TYPICAL_S) : 0;
    s.sinceDrop = t - this.lastDrop;
    s.dropEnvelope = Math.max(0, 1 - s.sinceDrop / DROP_ENVELOPE_S) ** 2;
    s.silentFor = this.silentFor;
    s.level = level;
    s.recent = this.recent;
  }

  private emit(type: SonoraEventType, strength: number, info?: TrackInfo): void {
    const e: SonoraEvent = { type, strength, time: this.time, info };
    this.queue.push(e);
    this.recent.push(e);
    if (this.recent.length > RECENT_EVENTS) this.recent.shift();
    for (const l of this.listeners) l(e);
  }
}

const EMPTY: SonoraEvent[] = [];

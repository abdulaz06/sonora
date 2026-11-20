/**
 * Plays the recorded demo frames in audio time, looping, optionally with the
 * demo track's audio. Every display frame, `tick()` returns the analysis
 * frames whose time has come (in order), so a caller can push them into the
 * engine before rendering, exactly as live analysis would arrive.
 *
 * Clock: the AudioContext when sound is on (minus its output latency, so the
 * picture lines up with what you hear), else the performance clock. Hidden
 * tabs pause the silent clock.
 */

import type { AudioFeatureFrame } from '../../../src/types/audio-frame';
import { EventDetector, type SonoraEvent } from '../../../src/engine/events';
import { decodeDemo, type DemoHeader } from './demo-format';

// ── Tuning ──────────────────────────────────────────────────────
/** More frames than this behind (a hitch, a hidden tab) and the clock skips ahead. */
const MAX_CATCH_UP = 20;
/** Audio fade when sound is switched (s). */
const FADE_S = 0.25;
const AUDIO_GAIN = 0.85;
/** Frames the event layer hears per slice while warming up. */
const WARM_SLICE = 700;

export type FrameListener = (f: AudioFeatureFrame, t: number) => void;
export type EventListener = (e: SonoraEvent, t: number) => void;

export class DemoPlayer {
  readonly header: DemoHeader;
  readonly frames: AudioFeatureFrame[];
  readonly duration: number;
  /** Event layer on the same frames (the engine runs an identical one inside). */
  readonly events = new EventDetector();
  private fps: number;
  private next = 0;
  private wallBase = performance.now();
  private wallOffset = 0;
  private paused = false;
  private pausedAt = 0;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private ctxStart = 0;
  private ctxOffset = 0;
  private loading: Promise<void> | null = null;
  private frameListeners: FrameListener[] = [];
  private eventListeners: EventListener[] = [];
  private _sound = false;
  private _time = 0;
  private warming = false;

  static async load(url: string): Promise<DemoPlayer> {
    const buf = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`demo frames: ${r.status}`);
      return r.arrayBuffer();
    });
    const p = new DemoPlayer(buf);
    await p.hearLoop();
    return p;
  }

  /** The event layer hears one whole loop first, as looping playback would
   * have (sections, running loudness); in slices, so no long task. */
  private async hearLoop(): Promise<void> {
    this.warming = true;
    for (let i = 0; i < this.frames.length; i += WARM_SLICE) {
      const end = Math.min(this.frames.length, i + WARM_SLICE);
      for (let k = i; k < end; k++) this.events.process(this.frames[k]);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.warming = false;
    this.wallBase = performance.now();
  }

  private constructor(buf: ArrayBuffer) {
    const { header, frames } = decodeDemo(buf);
    this.header = header;
    this.frames = frames;
    this.fps = header.fps;
    this.duration = header.frames / header.fps;
    this.events.on((e) => { if (!this.warming) for (const l of this.eventListeners) l(e, this._time); });
    document.addEventListener('visibilitychange', () => this.setHidden(document.hidden));
  }

  get sound(): boolean { return this._sound; }
  /** Loop-relative time of the last delivered frame (s). */
  get time(): number { return this._time; }

  onFrame(l: FrameListener): void { this.frameListeners.push(l); }
  onEvent(l: EventListener): void { this.eventListeners.push(l); }

  /** Clock position in the loop, unwrapped (s). */
  private clock(): number {
    if (this._sound && this.ctx && this.src) {
      const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
      return this.ctxOffset + Math.max(0, this.ctx.currentTime - this.ctxStart - lat);
    }
    const now = this.paused ? this.pausedAt : performance.now();
    return this.wallOffset + (now - this.wallBase) / 1000;
  }

  /** Deliver every frame that is due; returns them in order. */
  tick(): AudioFeatureFrame[] {
    const n = this.header.frames;
    const due = Math.floor(this.clock() * this.fps);
    if (due - this.next > MAX_CATCH_UP) this.next = due - MAX_CATCH_UP;
    const out: AudioFeatureFrame[] = [];
    while (this.next < due) {
      const i = ((this.next % n) + n) % n;
      const f = this.frames[i];
      this._time = (i + 1) / this.fps;
      this.events.process(f);
      for (const l of this.frameListeners) l(f, this._time);
      out.push(f);
      this.next++;
    }
    return out;
  }

  /** Jump to a loop time (s); keeps sound in sync. */
  seek(t: number): void {
    const cur = this.clock();
    const loops = Math.floor(cur / this.duration);
    const target = loops * this.duration + t;
    this.next = Math.floor(target * this.fps);
    this.rebase(target);
  }

  private rebase(at: number): void {
    this.wallBase = performance.now();
    this.wallOffset = at;
    if (this.paused) this.pausedAt = this.wallBase;
    if (this._sound && this.ctx && this.buffer) this.startSource(at);
  }

  private setHidden(hidden: boolean): void {
    if (this._sound) return; // audio keeps playing; frames catch up on return
    if (hidden && !this.paused) { this.paused = true; this.pausedAt = performance.now(); }
    else if (!hidden && this.paused) { this.wallBase += performance.now() - this.pausedAt; this.paused = false; }
  }

  private startSource(at: number): void {
    if (!this.ctx || !this.buffer || !this.gain) return;
    this.src?.stop();
    this.src?.disconnect();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = this.duration;
    src.connect(this.gain);
    const offset = ((at % this.duration) + this.duration) % this.duration;
    this.ctxStart = this.ctx.currentTime + 0.02;
    this.ctxOffset = at;
    src.start(this.ctxStart, offset);
    this.src = src;
  }

  /** Turn the demo track's audio on or off (lazy-loads it the first time). */
  async setSound(on: boolean, urls: { webm: string; m4a: string }): Promise<void> {
    if (on === this._sound) return;
    if (!on) {
      const at = this.clock();
      this._sound = false;
      if (this.ctx && this.gain) {
        const t = this.ctx.currentTime;
        this.gain.gain.cancelScheduledValues(t);
        this.gain.gain.setTargetAtTime(0, t, FADE_S / 3);
        const src = this.src;
        window.setTimeout(() => { src?.stop(); src?.disconnect(); }, FADE_S * 1000 + 50);
        this.src = null;
      }
      this.wallBase = performance.now();
      this.wallOffset = at;
      this.paused = false;
      return;
    }
    this.ctx ??= new AudioContext({ latencyHint: 'playback' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.buffer) {
      this.loading ??= (async () => {
        const probe = document.createElement('audio');
        const useWebm = probe.canPlayType('audio/webm; codecs="opus"') !== '';
        const data = await fetch(useWebm ? urls.webm : urls.m4a).then((r) => r.arrayBuffer());
        this.buffer = await this.ctx!.decodeAudioData(data);
      })();
      await this.loading;
    }
    this.gain ??= (() => { const g = this.ctx!.createGain(); g.connect(this.ctx!.destination); return g; })();
    const at = this.clock();
    this._sound = true;
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.gain.gain.setTargetAtTime(AUDIO_GAIN, this.ctx.currentTime + 0.02, FADE_S / 3);
    this.startSource(at);
  }

  /** Next event of a type after loop time `t`, from the recorded timeline. */
  nextEvent(type: string, t: number): number | null {
    const ev = this.header.events.filter((e) => e.type === type);
    if (!ev.length) return null;
    const after = ev.find((e) => e.t > t + 0.5);
    return (after ?? ev[0]).t;
  }
}

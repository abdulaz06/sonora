/**
 * Live recording (desktop): the visual itself, not the desktop, with the system
 * audio sonora is hearing. Each drawn frame is copied on the GPU into a small
 * compositing canvas (at the output's size or a preset), the corner mark drawn
 * over it, and handed to the hardware H.264 encoder: no CPU readback, no wait
 * on the GPU. Frames are timed by the capture clock of the audio they show
 * (stamped on every analysis frame by Rust), and the sound is AAC encoded in
 * Rust from that same clock, so picture and sound line up whatever the display
 * does. Saves to Videos\sonora; warns before the disk fills and stops cleanly.
 */

import type { Renderer } from '../engine/renderer';
import type { AudioFeatureFrame } from '../types/audio-frame';
import { desktopSink, freeBytes, recEnd, recPull, recStart, recStop } from './desktop-io';
import { createMp4, type Mp4Writer } from './mp4';
import { createOverlay, OUTRO_S, preloadOverlay, type Corner, type Overlay } from './overlay';

// ── Tuning ──────────────────────────────────────────────────────
/** Pull encoded audio from Rust this often (ms). */
const AUDIO_PULL_MS = 200;
/** Check free disk space this often (ms). */
const DISK_CHECK_MS = 4000;
/** Warn below this much free space (bytes). */
const DISK_WARN = 2e9;
/** Stop (cleanly) below this much free space (bytes). */
const DISK_STOP = 6e8;
/** A frame's picture shows audio up to its analysis window's end; it is timed this much earlier
 * so a hit's first frame lands within a frame of the sound (measured with the click track). */
const SHOW_OFFSET_S = 1 / 60;

export type RecPreset = 'output' | '720' | '1080' | '1440' | '2160';
export interface RecOptions { preset: RecPreset; fps: 30 | 60; corner: Corner; outro: boolean }
export type RecState = 'idle' | 'starting' | 'recording' | 'finishing';
export interface RecStatus { state: RecState; elapsed: number; path: string; warning: string; size: [number, number] }
export interface RecResult { path: string; bytes: number; seconds: number; frames: number; dropped: number; error?: string }

export interface Recorder {
  status(): RecStatus;
  onChange(cb: (s: RecStatus) => void): () => void;
  start(o: RecOptions): Promise<void>;
  stop(): Promise<RecResult | null>;
  /** CPU time the capture adds to each recorded frame (ms, smoothed). */
  costMs(): number;
}

/** The recording's size: the output's (even, at most 4K) or a preset on its short side, same aspect. */
export function recordSize(cw: number, ch: number, preset: RecPreset): [number, number] {
  const even = (x: number): number => Math.max(2, Math.round(x / 2) * 2);
  if (preset === 'output') {
    const k = Math.min(1, 3840 / Math.max(cw, ch));
    return [even(cw * k), even(ch * k)];
  }
  const s = Number(preset);
  return cw >= ch ? [even((s * cw) / ch), even(s)] : [even(s), even((s * ch) / cw)];
}

interface Session {
  mp4: Mp4Writer; comp: HTMLCanvasElement; g: CanvasRenderingContext2D; overlay: Overlay; corner: Corner; outro: boolean;
  startClock: number; rate: number; fps: number; next: number; frames: number; audioFrames: number;
  stopAt: number | null; timers: number[]; resolveStop: ((r: RecResult) => void) | null; error: string; lastT: number;
  unhook: () => void;
}

export function createRecorder(renderer: Renderer, subscribe: (cb: (f: AudioFeatureFrame) => void) => () => void): Recorder {
  let status: RecStatus = { state: 'idle', elapsed: 0, path: '', warning: '', size: [0, 0] };
  const listeners = new Set<(s: RecStatus) => void>();
  const set = (p: Partial<RecStatus>): void => { status = { ...status, ...p }; for (const l of listeners) l(status); };
  let cost = 0;

  // Capture clock of the latest analysis frame and when it arrived (wall time).
  let lastClock = -1, lastArrival = 0;
  subscribe((f) => { if (f.clock !== undefined) { lastClock = f.clock; lastArrival = performance.now(); } });

  let session: Session | null = null;
  // Fonts and the mark load once the app is idle, so starting a recording never waits on them.
  window.setTimeout(() => (window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 0)))(() => void preloadOverlay()), 4000);

  async function pullAudio(final = false): Promise<void> {
    const s = session;
    if (!s) return;
    try {
      const frames = await recPull();
      s.mp4.addAudio(frames, s.audioFrames);
      s.audioFrames += frames.length;
    } catch (e) { if (!final) s.error ||= String(e); }
  }

  function onFrame(): void {
    const s = session;
    if (!s || lastClock < 0) return;
    const t0 = performance.now();
    // Audio time this picture shows: its analysis frame's clock, plus the wall time since it
    // arrived (frames drawn between analysis frames), at most one analysis frame ahead.
    const since = Math.min((t0 - lastArrival) / 1000, 1 / 60);
    const t = (lastClock - s.startClock) / s.rate - SHOW_OFFSET_S + since;
    if (t < s.next || t <= s.lastT) return;
    if (s.stopAt !== null && t > s.stopAt) { void finish(); return; }
    s.lastT = t;
    // Keep the frame grid: a slow frame skips slots rather than drifting.
    s.next = (Math.floor(t * s.fps) + 1) / s.fps;
    s.g.drawImage(renderer.canvas, 0, 0, s.comp.width, s.comp.height);
    s.overlay.draw(s.g, t);
    // The first frame opens the file at 0 (it arrives a few ms after the first recorded sample).
    void s.mp4.addFrame(s.comp, s.frames === 0 ? 0 : t, 1 / s.fps).catch((e: unknown) => { s.error ||= String(e); });
    s.frames++;
    cost = cost * 0.95 + (performance.now() - t0) * 0.05;
    if (Math.floor(t) !== Math.floor(status.elapsed)) set({ elapsed: Math.max(0, t) });
    if (s.stopAt !== null && t >= s.stopAt - 1 / s.fps) void finish();
  }

  async function finish(): Promise<void> {
    const s = session;
    if (!s || s.resolveStop === null) return;
    const resolve = s.resolveStop;
    s.resolveStop = null;
    s.unhook();
    s.timers.forEach((id) => window.clearInterval(id));
    let dropped = 0;
    try {
      const st = await recStop();
      dropped = st.dropped;
      await pullAudio(true);
      const out = await s.mp4.finish();
      resolve({ path: status.path, bytes: out.bytes, seconds: Math.max(0, s.lastT), frames: out.videoFrames, dropped, error: s.error || undefined });
    } catch (e) {
      await s.mp4.abort().catch(() => undefined);
      resolve({ path: '', bytes: 0, seconds: Math.max(0, s.lastT), frames: s.frames, dropped, error: String(e) });
    } finally {
      await recEnd().catch(() => undefined);
      session = null;
      set({ state: 'idle', warning: '' });
    }
  }

  const api: Recorder = {
    status: () => status,
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    costMs: () => cost,
    async start(o) {
      if (status.state !== 'idle') return;
      set({ state: 'starting', elapsed: 0, warning: '' });
      try {
        const free = await freeBytes();
        if (free < DISK_STOP * 2) throw new Error('not enough free disk space to record');
        const [W, H] = recordSize(renderer.canvas.width, renderer.canvas.height, o.preset);
        const d = new Date();
        const p2 = (n: number): string => String(n).padStart(2, '0');
        const sink = await desktopSink(`recording ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`);
        const rs = await recStart();
        const mp4 = await createMp4({ width: W, height: H, fps: o.fps, sink, audio: { sampleRate: rs.sampleRate, channels: 2, asc: new Uint8Array(rs.asc), delay: 0 } });
        const comp = document.createElement('canvas');
        comp.width = W; comp.height = H;
        const g = comp.getContext('2d', { alpha: false })!;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'medium';
        const overlay = await createOverlay({ size: [W, H], duration: 1e9, mark: { corner: o.corner }, outro: false });
        const sess: Session = { mp4, comp, g, overlay, corner: o.corner, outro: o.outro, startClock: rs.startClock, rate: rs.clockRate, fps: o.fps, next: 0, frames: 0, audioFrames: 0, stopAt: null, timers: [], resolveStop: null, error: '', lastT: -1, unhook: () => undefined };
        session = sess;
        sess.timers.push(window.setInterval(() => void pullAudio(), AUDIO_PULL_MS));
        sess.timers.push(window.setInterval(() => {
          void freeBytes().then((f) => {
            if (session !== sess) return;
            if (f < DISK_STOP) { set({ warning: 'disk full: recording stopped' }); void api.stop(); } else if (f < DISK_WARN) set({ warning: `disk almost full: ${(f / 1e9).toFixed(1)} GB left` });
          });
        }, DISK_CHECK_MS));
        sess.unhook = renderer.addFrameHook(() => onFrame());
        set({ state: 'recording', path: sink.path, size: [W, H] });
      } catch (e) {
        await recEnd().catch(() => undefined);
        session = null;
        set({ state: 'idle', warning: `couldn’t record: ${e instanceof Error ? e.message : String(e)}` });
        throw e;
      }
    },
    stop() {
      const s = session;
      if (!s || status.state !== 'recording') return Promise.resolve(null);
      return new Promise<RecResult>((resolve) => {
        s.resolveStop = resolve;
        const now = Math.max(0, s.lastT);
        set({ state: 'finishing' });
        if (!s.outro) { s.stopAt = now; void finish(); return; }
        // The picture fades to Night under the end card for OUTRO_S more seconds, then it stops.
        s.stopAt = now + OUTRO_S;
        void createOverlay({ size: [s.comp.width, s.comp.height], duration: now, mark: { corner: s.corner }, outro: true }).then((ov) => { s.overlay = ov; });
      });
    },
  };
  return api;
}

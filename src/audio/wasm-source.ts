/**
 * Browser frame source: Web Audio → AudioWorklet (mono PCM) → sonora-dsp
 * compiled to WebAssembly → the same `AudioFeatureFrame`s the desktop emits.
 *
 * Live inputs
 *   tab     a browser tab's audio (getDisplayMedia, tab surface). Follows the
 *           tab, so it keeps working when speakers/headphones change.
 *   system  the whole computer's audio (screen + system audio). Chromium binds
 *           it to the output device active when sharing started; when the
 *           device changes it goes silent, so we detect that and offer a
 *           one-click reconnect.
 *   mic     microphone / line-in, re-acquired automatically if it drops.
 *   file    a decoded audio file played through the speakers.
 *
 * Health is reported through `onStatus` (state, label, message, live level)
 * so the UI can show what is being heard and offer recovery.
 *
 * Offline mode (verification harness): load decoded PCM, then advance audio
 * time explicitly with `stepOffline(seconds)` — fully deterministic.
 */

import init, { WasmAnalyzer } from './wasm-pkg/sonora_dsp.js';
import wasmUrl from './wasm-pkg/sonora_dsp_bg.wasm?url';
import workletUrl from './pcm-tap.worklet.js?url';

import type { AudioFeatureFrame } from '../types/audio-frame';
import { FrameHub, type FrameListener, type FrameSource } from './frame-source';

// ── Tuning ──────────────────────────────────────────────────────
/** RMS above which the input counts as "sound". */
const SIGNAL_RMS = 0.002;
/** After an output-device change, this much silence means system capture died (ms). */
const DEVICE_CHANGE_SILENCE_MS = 1500;
/** Sound must have been heard this recently before a device change to arm the check (ms). */
const PLAYING_BEFORE_CHANGE_MS = 3000;
/** How long after a device change the silence check stays armed (ms). */
const DEVICE_CHANGE_WINDOW_MS = 15000;
/** Silence this long while connected shows a gentle "no sound" hint (ms). */
const QUIET_HINT_MS = 8000;
/** Health check interval (ms). */
const HEALTH_INTERVAL_MS = 250;
/** Level meter smoothing per worklet block. */
const LEVEL_SMOOTH = 0.25;

export type SourceKind = 'tab' | 'system' | 'mic' | 'file';
export type SourceState =
  | 'idle'        // nothing selected yet
  | 'starting'    // waiting for the browser picker / permission
  | 'live'        // connected and hearing sound
  | 'quiet'       // connected, no sound for a while
  | 'reconnect'   // capture died (device change / sharing stopped): needs a click
  | 'error';      // could not start

export interface SourceStatus {
  kind: SourceKind | null;
  state: SourceState;
  /** What is being heard ("Browser tab", "Microphone (USB)", "song.mp3", …). */
  label: string;
  /** Plain-language explanation for quiet / reconnect / error. */
  message: string;
  /** 0–1 smoothed input level. */
  level: number;
}

/** getDisplayMedia options that are newer than the bundled DOM typings. */
type DisplayOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
};

/** Music needs the raw signal: Chromium enables voice processing by default. */
const RAW_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

let wasmReady: Promise<unknown> | null = null;
function loadWasm(): Promise<unknown> {
  wasmReady ??= init({ module_or_path: wasmUrl });
  return wasmReady;
}

export class WasmFrameSource implements FrameSource {
  readonly kind = 'wasm' as const;
  private hub = new FrameHub();
  private analyzer: WasmAnalyzer | null = null;

  // Live graph
  private ctx: AudioContext | null = null;
  private tap: AudioWorkletNode | null = null;
  private sourceNode: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private fileBuffer: AudioBuffer | null = null;
  private fileStartedAt = 0;
  private fileOffset = 0;
  private playing = false;
  private onEnded: (() => void) | null = null;

  // Health
  private status: SourceStatus = { kind: null, state: 'idle', label: '', message: '', level: 0 };
  private statusListeners: ((s: SourceStatus) => void)[] = [];
  private lastSignal = 0;
  private deviceChangedAt = 0;
  private micDeviceId: string | undefined;
  private healthTimer = 0;
  private reacquiring = false;

  // Offline
  private offlinePcm: Float32Array | null = null;
  private offlinePos = 0;
  private offlineRate = 44100;

  static async create(): Promise<WasmFrameSource> {
    await loadWasm();
    return new WasmFrameSource();
  }

  constructor() {
    navigator.mediaDevices?.addEventListener('devicechange', () => this.onDeviceChange());
  }

  subscribe(listener: FrameListener): () => void {
    return this.hub.subscribe(listener);
  }

  async start(): Promise<void> {
    await this.ctx?.resume();
  }

  stop(): void {
    this.teardownLive();
    this.setStatus({ kind: null, state: 'idle', label: '', message: '' });
  }

  /** Subscribe to source health; called immediately with the current status. */
  onStatus(cb: (s: SourceStatus) => void): () => void {
    this.statusListeners.push(cb);
    cb(this.status);
    return () => { this.statusListeners = this.statusListeners.filter((x) => x !== cb); };
  }

  get currentStatus(): SourceStatus { return this.status; }

  // ── Live: file ──────────────────────────────────────────────────
  async loadFile(data: Blob | ArrayBuffer): Promise<AudioBuffer> {
    const ctx = await this.ensureContext();
    const bytes = data instanceof Blob ? await data.arrayBuffer() : data.slice(0);
    return ctx.decodeAudioData(bytes);
  }

  /** Play a decoded buffer from `offset` seconds. */
  async playBuffer(buffer: AudioBuffer, offset = 0, onEnded?: () => void, label = 'Audio file'): Promise<void> {
    const ctx = await this.ensureContext();
    this.disconnectInput();
    this.fileBuffer = buffer;
    this.onEnded = onEnded ?? null;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.tap!);
    this.tap!.connect(ctx.destination);
    src.onended = () => {
      if (this.sourceNode === src) { this.playing = false; this.onEnded?.(); }
    };
    src.start(0, offset);
    this.sourceNode = src;
    this.fileStartedAt = ctx.currentTime;
    this.fileOffset = offset;
    this.playing = true;
    this.lastSignal = performance.now();
    this.setStatus({ kind: 'file', state: 'live', label, message: '' });
    this.startHealth();
    await ctx.resume();
  }

  pause(): void {
    if (!this.fileBuffer || !this.playing) return;
    this.fileOffset = this.currentTime;
    this.disconnectInput(true);
    this.playing = false;
  }

  async resume(): Promise<void> {
    if (this.fileBuffer && !this.playing) {
      await this.playBuffer(this.fileBuffer, this.fileOffset, this.onEnded ?? undefined, this.status.label);
    }
  }

  get isPlaying(): boolean { return this.playing; }
  get duration(): number { return this.fileBuffer?.duration ?? 0; }
  get currentTime(): number {
    if (!this.fileBuffer) return 0;
    if (!this.playing || !this.ctx) return this.fileOffset;
    return this.fileOffset + (this.ctx.currentTime - this.fileStartedAt);
  }

  // ── Live: capture ───────────────────────────────────────────────
  /** Audio inputs (labels appear once microphone permission was granted). */
  async listInputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  async useMicrophone(deviceId?: string): Promise<void> {
    this.setStatus({ kind: 'mic', state: 'starting', label: 'Microphone', message: '' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...RAW_AUDIO, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
      });
      this.micDeviceId = deviceId;
      await this.useStream(stream, 'mic', stream.getAudioTracks()[0]?.label || 'Microphone');
    } catch (err) {
      this.fail('mic', err, 'Microphone access was blocked, or no microphone is connected.');
      throw err;
    }
  }

  /**
   * Share a browser tab's audio (recommended) or the whole computer's audio.
   * Call from a click: browsers require a user gesture.
   */
  async useDisplayAudio(kind: 'tab' | 'system'): Promise<void> {
    const prev = { ...this.status };
    this.setStatus({ kind, state: 'starting', label: kind === 'tab' ? 'Browser tab' : 'Whole computer', message: '' });
    const audio = { ...RAW_AUDIO, suppressLocalAudioPlayback: false } as MediaTrackConstraints;
    const opts: DisplayOptions = kind === 'tab'
      ? {
        video: { displaySurface: 'browser' }, audio,
        preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
        systemAudio: 'exclude', monitorTypeSurfaces: 'exclude',
      }
      : {
        video: { displaySurface: 'monitor' }, audio,
        systemAudio: 'include', monitorTypeSurfaces: 'include', surfaceSwitching: 'exclude',
      };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(opts);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        // Picker cancelled: put back whatever was running before.
        this.setStatus(this.stream || this.fileBuffer ? prev : { kind: null, state: 'idle', label: '', message: '' });
      } else {
        this.fail(kind, err, 'This browser could not start screen sharing.');
      }
      throw err;
    }
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      const msg = surface === 'window'
        ? 'Windows can’t share sound from a single app window. Choose a browser tab, or Entire screen with "Also share system audio" on.'
        : surface === 'browser' || kind === 'tab'
          ? 'No sound was shared. Pick the tab again and keep "Also share tab audio" switched on.'
          : 'No sound was shared. Choose Entire screen and switch on "Also share system audio".';
      this.setStatus({ kind, state: 'error', label: '', message: msg });
      throw new Error(msg);
    }
    // Only the sound is needed.
    stream.getVideoTracks().forEach((t) => t.stop());
    const actual: SourceKind = surface === 'browser' ? 'tab' : surface === 'monitor' ? 'system' : kind;
    await this.useStream(stream, actual, actual === 'tab' ? 'Browser tab' : 'Whole computer');
  }

  /** Re-run the last capture. Call from a click. */
  async reconnect(): Promise<void> {
    const k = this.status.kind;
    if (k === 'tab' || k === 'system') await this.useDisplayAudio(k);
    else if (k === 'mic') await this.useMicrophone(this.micDeviceId);
    else if (k === 'file') await this.resume();
  }

  private async useStream(stream: MediaStream, kind: SourceKind, label: string): Promise<void> {
    const ctx = await this.ensureContext();
    this.disconnectInput();
    this.fileBuffer = null;
    this.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(this.tap!);
    // Keep the tap pulled by the graph without playing the input back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    this.tap!.connect(mute).connect(ctx.destination);
    this.sourceNode = src;
    this.playing = true;
    this.lastSignal = performance.now();
    this.deviceChangedAt = 0;
    for (const t of stream.getAudioTracks()) {
      t.addEventListener('ended', () => {
        if (this.stream !== stream) return;
        if (kind === 'mic') void this.reacquireMic();
        else this.setStatus({
          state: 'reconnect',
          message: kind === 'tab' ? 'Tab sharing stopped.' : 'Sharing stopped.',
        });
      });
    }
    this.setStatus({ kind, state: 'live', label, message: '' });
    this.startHealth();
    await ctx.resume();
  }

  // ── Health ──────────────────────────────────────────────────────
  private onDeviceChange(): void {
    const now = performance.now();
    // Only arm the "capture died" check if music was actually playing.
    this.deviceChangedAt = now - this.lastSignal < PLAYING_BEFORE_CHANGE_MS ? now : 0;
    // An output change can suspend the context; keep it running.
    void this.ctx?.resume();
    if (this.status.kind === 'mic') void this.reacquireMic();
  }

  /** Mic dropped (unplugged / switched): pick it up again, else the default mic. */
  private async reacquireMic(): Promise<void> {
    if (this.reacquiring) return;
    const track = this.stream?.getAudioTracks()[0];
    if (track && track.readyState === 'live') return;
    this.reacquiring = true;
    try {
      const inputs = await this.listInputs();
      const keep = this.micDeviceId && inputs.some((d) => d.deviceId === this.micDeviceId) ? this.micDeviceId : undefined;
      await this.useMicrophone(keep);
    } catch {
      this.setStatus({ state: 'reconnect', message: 'The microphone was disconnected.' });
    } finally {
      this.reacquiring = false;
    }
  }

  private startHealth(): void {
    if (this.healthTimer) return;
    this.healthTimer = window.setInterval(() => this.checkHealth(), HEALTH_INTERVAL_MS);
  }

  private checkHealth(): void {
    const s = this.status;
    if (!this.stream && !this.fileBuffer) return;
    if (this.ctx && this.ctx.state !== 'running' && this.playing) void this.ctx.resume();
    if (s.state === 'reconnect' || s.state === 'error' || s.state === 'starting') return;
    const now = performance.now();
    const silentFor = now - this.lastSignal;
    if (s.kind === 'system' && this.deviceChangedAt > 0 && now - this.deviceChangedAt < DEVICE_CHANGE_WINDOW_MS
      && silentFor >= DEVICE_CHANGE_SILENCE_MS && this.lastSignal < this.deviceChangedAt) {
      this.setStatus({
        state: 'reconnect',
        message: 'Your speakers or headphones changed, and whole-computer sharing stays on the old device. Reconnect to follow the new one, or share a browser tab instead (tabs keep working through device changes).',
      });
      return;
    }
    if (s.kind !== 'file' && silentFor >= QUIET_HINT_MS) {
      if (s.state !== 'quiet') {
        this.setStatus({
          state: 'quiet',
          message: s.kind === 'tab' ? 'No sound from the shared tab. Is music playing there?'
            : s.kind === 'system' ? 'No sound from this computer. Is music playing?'
              : 'No sound from the microphone.',
        });
      }
    } else if (s.state === 'quiet' && silentFor < 500) {
      this.setStatus({ state: 'live', message: '' });
    }
  }

  private fail(kind: SourceKind, err: unknown, fallback: string): void {
    const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
    this.setStatus({ kind, state: 'error', label: '', message: fallback + detail });
  }

  private setStatus(patch: Partial<SourceStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.statusListeners) l(this.status);
  }

  /** Per worklet block: update the level meter and the last-sound time. */
  private onLevel(rms: number): void {
    const level = Math.min(1, Math.sqrt(rms) * 2.2);
    this.status.level += (level - this.status.level) * LEVEL_SMOOTH;
    if (rms > SIGNAL_RMS) this.lastSignal = performance.now();
  }

  // ── Offline (harness) ───────────────────────────────────────────
  loadOffline(mono: Float32Array, sampleRate: number): void {
    this.teardownLive();
    this.offlinePcm = mono;
    this.offlineRate = sampleRate;
    this.offlinePos = 0;
    this.analyzer?.free();
    this.analyzer = new WasmAnalyzer(sampleRate);
  }

  get offlineTime(): number { return this.offlinePos / this.offlineRate; }
  get offlineDuration(): number { return this.offlinePcm ? this.offlinePcm.length / this.offlineRate : 0; }

  /** Feed `seconds` of audio through the analyser, emitting every frame produced. */
  stepOffline(seconds: number): number {
    const pcm = this.offlinePcm;
    const an = this.analyzer;
    if (!pcm || !an) return 0;
    const end = Math.min(pcm.length, this.offlinePos + Math.round(seconds * this.offlineRate));
    const hop = an.hop();
    let produced = 0;
    while (this.offlinePos < end) {
      const next = Math.min(end, this.offlinePos + hop);
      an.push(pcm.subarray(this.offlinePos, next));
      this.offlinePos = next;
      produced += this.drain();
    }
    return produced;
  }

  // ── Internals ───────────────────────────────────────────────────
  private async ensureContext(): Promise<AudioContext> {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(workletUrl);
    const tap = new AudioWorkletNode(ctx, 'sonora-pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const block = e.data;
      let sum = 0;
      for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
      this.onLevel(Math.sqrt(sum / block.length));
      this.analyzer?.push(block);
      this.drain();
    };
    ctx.addEventListener('statechange', () => { if (ctx.state !== 'running' && this.playing) void ctx.resume(); });
    this.analyzer?.free();
    this.analyzer = new WasmAnalyzer(ctx.sampleRate);
    this.ctx = ctx;
    this.tap = tap;
    return ctx;
  }

  private drain(): number {
    const an = this.analyzer;
    if (!an) return 0;
    let n = 0;
    for (let json = an.nextFrameJson(); json !== undefined; json = an.nextFrameJson()) {
      this.hub.emit(JSON.parse(json) as AudioFeatureFrame);
      n++;
    }
    return n;
  }

  private disconnectInput(keepBuffer = false): void {
    if (this.sourceNode) {
      if (this.sourceNode instanceof AudioBufferSourceNode) {
        this.sourceNode.onended = null;
        try { this.sourceNode.stop(); } catch { /* already stopped */ }
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this.tap?.disconnect();
    const old = this.stream;
    this.stream = null;
    old?.getTracks().forEach((t) => t.stop());
    if (!keepBuffer) this.fileBuffer = null;
  }

  private teardownLive(): void {
    this.disconnectInput();
    this.playing = false;
    window.clearInterval(this.healthTimer);
    this.healthTimer = 0;
    void this.ctx?.close();
    this.ctx = null;
    this.tap = null;
  }
}

/**
 * Browser frame source: Web Audio → AudioWorklet (mono PCM) → sonora-dsp
 * compiled to WebAssembly → the same `AudioFeatureFrame`s the desktop emits.
 *
 * Live inputs: an audio file (played through the speakers), the microphone,
 * or tab/system audio via getDisplayMedia where the browser supports it.
 *
 * Offline mode (verification harness): load decoded PCM, then advance audio
 * time explicitly with `stepOffline(seconds)` — fully deterministic and
 * independent of real time or frame rate.
 */

import init, { WasmAnalyzer } from './wasm-pkg/sonora_dsp.js';
import wasmUrl from './wasm-pkg/sonora_dsp_bg.wasm?url';
import workletUrl from './pcm-tap.worklet.js?url';

import type { AudioFeatureFrame } from '../types/audio-frame';
import { FrameHub, type FrameListener, type FrameSource } from './frame-source';

export type LiveInputKind = 'file' | 'mic' | 'display';

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

  // Offline
  private offlinePcm: Float32Array | null = null;
  private offlinePos = 0;
  private offlineRate = 44100;

  static async create(): Promise<WasmFrameSource> {
    await loadWasm();
    return new WasmFrameSource();
  }

  subscribe(listener: FrameListener): () => void {
    return this.hub.subscribe(listener);
  }

  async start(): Promise<void> {
    await this.ctx?.resume();
  }

  stop(): void {
    this.teardownLive();
  }

  /** Current input description for UIs. */
  get liveKind(): LiveInputKind | null {
    if (this.stream) return this.stream.getVideoTracks().length > 0 || this.displayMode ? 'display' : 'mic';
    return this.fileBuffer ? 'file' : null;
  }
  private displayMode = false;

  // ── Live: file ──────────────────────────────────────────────────
  async loadFile(data: Blob | ArrayBuffer): Promise<AudioBuffer> {
    const ctx = await this.ensureContext();
    const bytes = data instanceof Blob ? await data.arrayBuffer() : data.slice(0);
    return ctx.decodeAudioData(bytes);
  }

  /** Play a decoded buffer from `offset` seconds. */
  async playBuffer(buffer: AudioBuffer, offset = 0, onEnded?: () => void): Promise<void> {
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
    await ctx.resume();
  }

  pause(): void {
    if (!this.fileBuffer || !this.playing) return;
    this.fileOffset = this.currentTime;
    this.disconnectInput(true);
    this.playing = false;
  }

  async resume(): Promise<void> {
    if (this.fileBuffer && !this.playing) await this.playBuffer(this.fileBuffer, this.fileOffset, this.onEnded ?? undefined);
  }

  get isPlaying(): boolean { return this.playing; }
  get duration(): number { return this.fileBuffer?.duration ?? 0; }
  get currentTime(): number {
    if (!this.fileBuffer) return 0;
    if (!this.playing || !this.ctx) return this.fileOffset;
    return this.fileOffset + (this.ctx.currentTime - this.fileStartedAt);
  }

  // ── Live: microphone / display audio ────────────────────────────
  async useMicrophone(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.displayMode = false;
    await this.useStream(stream);
  }

  /** Tab or system audio. Chromium needs video:true to offer audio; video is dropped. */
  async useDisplayAudio(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio track shared. Tick "Share audio" in the picker.');
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    this.displayMode = true;
    await this.useStream(stream);
  }

  private async useStream(stream: MediaStream): Promise<void> {
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
    await ctx.resume();
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
      this.analyzer?.push(e.data);
      this.drain();
    };
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
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (!keepBuffer) this.fileBuffer = null;
  }

  private teardownLive(): void {
    this.disconnectInput();
    this.playing = false;
    void this.ctx?.close();
    this.ctx = null;
    this.tap = null;
  }
}

/** Parse a 16-bit PCM WAV to mono floats (exact, no resampling). */
export function decodeWavMono(buf: ArrayBuffer): { sampleRate: number; mono: Float32Array } | null {
  const v = new DataView(buf);
  const tag = (o: number): string => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let pos = 12, channels = 1, rate = 44100, bits = 16;
  while (pos + 8 <= buf.byteLength) {
    const id = tag(pos);
    const size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      channels = v.getUint16(body + 2, true);
      rate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (bits !== 16) return null;
      const frames = Math.floor(size / (2 * channels));
      const mono = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) acc += v.getInt16(body + (f * channels + c) * 2, true) / 32768;
        mono[f] = acc / channels;
      }
      return { sampleRate: rate, mono };
    }
    pos += 8 + size + (size & 1);
  }
  return null;
}

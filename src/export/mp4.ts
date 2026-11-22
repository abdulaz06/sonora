/**
 * MP4 writing for exports and recordings: the picture through WebCodecs
 * (WebView2's hardware H.264 encoder), the sound as AAC frames from the
 * platform (Windows' own encoder, via Rust), muxed by mp4-muxer (MIT) and
 * streamed to a sink (a file in Videos\sonora on the desktop; memory in tests).
 * No bundled codec anywhere.
 */

import { Muxer, StreamTarget } from 'mp4-muxer';

// ── Tuning ──────────────────────────────────────────────────────
/** A keyframe every this many seconds (seeking, social re-encodes). */
const KEYFRAME_S = 2;
/** Frames the encoder may hold before the producer waits. */
const MAX_ENCODE_QUEUE = 6;
/** Muxer output is batched into writes of this size. */
const WRITE_CHUNK = 4 * 1024 * 1024;
/** Video bitrate (bits per second) per output pixel per frame (60 fps 1080p ≈ 26 Mbps). */
const BITS_PER_PIXEL_FRAME = 0.21;
/** Upper bound (bits per second). */
const MAX_BITRATE = 90e6;

/** Where the file goes. */
export interface Sink {
  readonly path: string;
  write(data: Uint8Array, position: number): Promise<void>;
  close(): Promise<number>;
  abort(): Promise<void>;
}

/** AAC frames from the platform encoder. */
export interface AacStream {
  readonly sampleRate: number;
  readonly channels: number;
  /** AudioSpecificConfig. */
  readonly asc: Uint8Array;
  /** Encoder delay (samples) to remove at the start. */
  readonly delay: number;
}

export interface Mp4Options {
  width: number;
  height: number;
  fps: number;
  /** Override the bitrate (bits/s). */
  bitrate?: number;
  audio: AacStream | null;
  sink: Sink;
  /** Known frame counts: the index goes at the front of the file (fast start). */
  expected?: { video: number; audio: number };
}

/** Pick an H.264 profile/level the hardware encoder accepts for this size and rate. */
export async function pickVideoConfig(width: number, height: number, fps: number, bitrate?: number): Promise<VideoEncoderConfig> {
  const br = Math.min(MAX_BITRATE, bitrate ?? Math.round(width * height * fps * BITS_PER_PIXEL_FRAME));
  const mbps = (width / 16) * (height / 16) * fps;
  // Level by macroblock rate: 4.2 (≤ 522,240 MB/s), 5.1 (≤ 983,040), 5.2 (≤ 2,073,600).
  const levels = mbps <= 522240 && width * height <= 2228224 ? ['2A', '33', '34'] : mbps <= 983040 ? ['33', '34'] : ['34', '33'];
  const tries: VideoEncoderConfig[] = [];
  for (const hw of ['prefer-hardware', 'no-preference'] as const) {
    for (const lv of levels) {
      tries.push({ codec: `avc1.6400${lv}`, width, height, bitrate: br, framerate: fps, hardwareAcceleration: hw, avc: { format: 'avc' }, bitrateMode: 'variable', latencyMode: 'quality' });
    }
  }
  for (const c of tries) {
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) return c; } catch { /* next */ }
  }
  throw new Error(`no H.264 encoder for ${width}×${height} at ${fps} fps`);
}

export interface Mp4Writer {
  readonly config: VideoEncoderConfig;
  /** Encode one frame (timestamp in seconds); waits while the encoder is busy. */
  addFrame(source: CanvasImageSource, t: number, duration: number, key?: boolean): Promise<void>;
  /** AAC frames (each 1024 samples) in order; `first` = index of the first one in this batch. */
  addAudio(frames: Uint8Array[], first: number): void;
  finish(): Promise<{ bytes: number; videoFrames: number; audioFrames: number }>;
  abort(): Promise<void>;
  /** Bytes still being written. */
  pendingBytes(): number;
}

export async function createMp4(o: Mp4Options): Promise<Mp4Writer> {
  const config = await pickVideoConfig(o.width, o.height, o.fps, o.bitrate);
  let failed: Error | null = null;
  let writes = Promise.resolve();
  let pending = 0;
  const target = new StreamTarget({
    chunked: true, chunkSize: WRITE_CHUNK,
    onData: (data, position) => {
      const copy = data.slice();
      pending += copy.byteLength;
      writes = writes.then(() => o.sink.write(copy, position)).then(() => { pending -= copy.byteLength; }, (e: unknown) => { failed ??= e instanceof Error ? e : new Error(String(e)); });
    },
  });
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: o.width, height: o.height, frameRate: o.fps },
    audio: o.audio ? { codec: 'aac', numberOfChannels: o.audio.channels, sampleRate: o.audio.sampleRate } : undefined,
    fastStart: o.expected ? { expectedVideoChunks: o.expected.video + 4, expectedAudioChunks: o.expected.audio + 8 } : false,
    firstTimestampBehavior: 'strict',
  });
  let videoFrames = 0, audioFrames = 0, frameIndex = 0;
  const enc = new VideoEncoder({
    output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); videoFrames++; } catch (e) { failed ??= e as Error; } },
    error: (e) => { failed ??= e instanceof Error ? e : new Error(String(e)); },
  });
  enc.configure(config);
  const audioMeta: EncodedAudioChunkMetadata | undefined = o.audio ? { decoderConfig: { codec: 'mp4a.40.2', sampleRate: o.audio.sampleRate, numberOfChannels: o.audio.channels, description: o.audio.asc } } : undefined;
  let audioMetaSent = false;
  const keyEvery = Math.max(1, Math.round(KEYFRAME_S * o.fps));
  const check = (): void => { if (failed) throw failed; };

  return {
    config,
    async addFrame(source, t, duration, key) {
      check();
      while (enc.encodeQueueSize > MAX_ENCODE_QUEUE) await new Promise<void>((r) => enc.addEventListener('dequeue', () => r(), { once: true }));
      const frame = new VideoFrame(source, { timestamp: Math.round(t * 1e6), duration: Math.round(duration * 1e6), alpha: 'discard' });
      try { enc.encode(frame, { keyFrame: key ?? frameIndex % keyEvery === 0 }); } finally { frame.close(); }
      frameIndex++;
    },
    addAudio(frames, first) {
      check();
      if (!o.audio) return;
      const sr = o.audio.sampleRate;
      frames.forEach((f, i) => {
        const k = first + i;
        muxer.addAudioChunkRaw(f, 'key', Math.round(((k * 1024) / sr) * 1e6), Math.round((1024 / sr) * 1e6), audioMetaSent ? undefined : audioMeta);
        audioMetaSent = true;
        audioFrames++;
      });
    },
    async finish() {
      check();
      await enc.flush();
      enc.close();
      check();
      muxer.finalize();
      await writes;
      check();
      const bytes = await o.sink.close();
      return { bytes, videoFrames, audioFrames };
    },
    async abort() {
      try { enc.close(); } catch { /* closed */ }
      await writes.catch(() => undefined);
      await o.sink.abort();
    },
    pendingBytes: () => pending,
  };
}

/** Unpack Rust's AAC frame buffer: u32 count, u32 lengths, bytes (little-endian). */
export function unpackFrames(buf: ArrayBuffer): Uint8Array[] {
  if (buf.byteLength < 4) return [];
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const out: Uint8Array[] = [];
  let off = 4 + n * 4;
  for (let i = 0; i < n; i++) {
    const len = dv.getUint32(4 + i * 4, true);
    out.push(new Uint8Array(buf, off, len));
    off += len;
  }
  return out;
}

/** A sink in memory (tests and the browser harness). */
export function memorySink(name = 'memory.mp4'): Sink & { bytes(): Uint8Array } {
  let buf = new Uint8Array(1 << 20);
  let size = 0;
  return {
    path: name,
    async write(data, pos) {
      const need = pos + data.byteLength;
      if (need > buf.byteLength) { const nb = new Uint8Array(Math.max(need, buf.byteLength * 2)); nb.set(buf.subarray(0, size)); buf = nb; }
      buf.set(data, pos);
      size = Math.max(size, need);
    },
    async close() { return size; },
    async abort() { size = 0; },
    bytes: () => buf.subarray(0, size),
  };
}

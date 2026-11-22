/**
 * Offline export: a plan → an MP4, deterministic and in audio time, like the
 * verify harness and the reel studio. A fixed-step loop renders every frame
 * (a slow PC renders more slowly; the result is the same). Analysis always
 * runs from the song's start; every shot gets a fresh engine that warms up for
 * WARM_S before its first frame, so nothing starts cold. Frames are rendered
 * supersampled when asked, composited with the overlays on a 2D canvas, and
 * encoded with the hardware H.264 encoder; the sound is the window (plus the
 * outro) as AAC.
 */

import { WasmFrameSource } from '../audio/wasm-source';
import type { Palette } from '../engine/color-engine';
import { initRenderer, type Renderer } from '../engine/renderer';
import { presetsFor } from '../styles/registry';
import type { StyleId } from '../styles/visual-style';
import { createMp4, type AacStream, type Sink } from './mp4';
import { createOverlay, type OverlaySpec } from './overlay';
import type { PalettePick, Plan, Shot } from './plan-lib.mjs';
import type { Song } from './song';

// ── Tuning ──────────────────────────────────────────────────────
/** Every shot renders this much of the song before its first frame (s). */
export const WARM_S = 8;
/** Engine seed for exports (the harness's). */
const SEED = 1234;
/** Audio is encoded this far ahead of the picture (s). */
const AUDIO_AHEAD_S = 1;
/** Fade the sound in / out at the window's ends (s); the outro fades it over its length. */
const AUDIO_FADE_IN = 0.05, AUDIO_FADE_OUT = 0.25;
/** Yield to the page at least this often while rendering (ms). */
const YIELD_MS = 12;

export interface AacEncoderLike extends AacStream {
  encode(pcm: Int16Array): Promise<Uint8Array[]>;
  close(): Promise<Uint8Array[]>;
}

export interface ExportSettings {
  plan: Plan;
  size: [number, number];
  fps: number;
  /** Render scale over the output size (1 = Standard; Best supersamples). */
  supersample: number;
  overlay: OverlaySpec;
  /** Album colours from the cover (null when there's no usable cover). */
  albumPalette: Palette | null;
  /** Portrait framing for tall frames (the reel studio's flag). */
  portrait: boolean;
}

export interface ExportProgress {
  stage: 'warming' | 'rendering' | 'finishing';
  frame: number;
  total: number;
  /** Frames per second of wall time. */
  rate: number;
  /** Seconds left (estimate). */
  eta: number;
  shot: number;
  shots: number;
}

export interface ExportResult {
  path: string;
  bytes: number;
  frames: number;
  seconds: number;
  wallSeconds: number;
  codec: string;
  hardware: string;
  /** Hash of every frame's pixels (determinism checks; only with `hashFrames`). */
  frameHash?: string;
  /** Per-frame hashes (with `hashFrames`). */
  frameHashes?: string[];
}

const yieldNow = (): Promise<void> => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

/** Apply a palette pick the way the app does (album colours, a preset, a custom hue, Auto Drift). */
export function applyPalette(r: Renderer, p: PalettePick | undefined, album: Palette | null): void {
  const ce = r.colorEngine;
  ce.setAutoDrift(false);
  const pick = p ?? 0;
  if (pick === 'album') { ce.setAlbum(album, 0, true); return; }
  ce.setAlbum(null, 0, true);
  if (typeof pick === 'number') ce.setPalette(pick, true);
  else if ('hue' in pick) { ce.setCustomHue(pick.hue); ce.update(10); }
  else { ce.setPalette(pick.index ?? 0, true); ce.setAutoDrift(true); }
}

/** Configure an engine for a shot (style, look, view, camera, palette). */
export function applyShot(r: Renderer, s: Omit<Shot, 'at'>, album: Palette | null, cut = true): void {
  if (cut) r.transition({ style: s.style as StyleId, variant: s.variant, depth: s.depth, cut: true });
  else { r.setStyle(s.style as StyleId, true); r.setVariant(s.variant); r.setDepth(s.depth); }
  applyPalette(r, s.palette, album);
  const preset = presetsFor(s.style as StyleId).find((x) => x.id === s.camera);
  if (preset) r.camera.setView(preset.view);
}

/** Render a plan to an MP4. */
export async function renderExport(
  song: Song, s: ExportSettings, sink: Sink, aac: AacEncoderLike | null,
  onProgress: (p: ExportProgress) => void, signal: AbortSignal, opts: { hashFrames?: boolean } = {},
): Promise<ExportResult> {
  const t0 = performance.now();
  const [OW, OH] = s.size;
  const RW = Math.round((OW * s.supersample) / 2) * 2, RH = Math.round((OH * s.supersample) / 2) * 2;
  const fps = s.fps, dt = 1 / fps;
  const { start: W0, end: W1 } = s.plan.window;
  const overlay = await createOverlay(s.overlay);
  const length = overlay.length;
  const total = Math.round(length * fps);
  const D = W1 - W0;
  const sr = song.sampleRate;

  // ── Output ──
  const audioSamples = Math.round(length * sr);
  const mp4 = await createMp4({
    width: OW, height: OH, fps, audio: aac, sink,
    expected: { video: total, audio: Math.ceil(audioSamples / 1024) + 2 },
  });
  const comp = document.createElement('canvas');
  comp.width = OW; comp.height = OH;
  const g = comp.getContext('2d', { alpha: false })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';

  // ── Sound: the window (and the song under the outro), faded, as AAC, a little ahead of the picture ──
  let audioDone = 0;      // samples encoded
  let audioFrames = 0;    // AAC frames muxed
  const i0 = Math.round(W0 * sr);
  const encodeAudioTo = async (tEnd: number, last = false): Promise<void> => {
    if (!aac) return;
    const target = Math.min(audioSamples, Math.round(tEnd * sr));
    if (target > audioDone) {
      const n = target - audioDone;
      const pcm = new Int16Array(n * 2);
      for (let k = 0; k < n; k++) {
        const j = audioDone + k, src = i0 + j, t = j / sr;
        let gain = Math.min(1, t / AUDIO_FADE_IN);
        const fadeLen = s.overlay.outro ? length - D : AUDIO_FADE_OUT;
        const fadeFrom = s.overlay.outro ? D : length - AUDIO_FADE_OUT;
        if (t > fadeFrom) gain *= Math.max(0, 1 - (t - fadeFrom) / fadeLen);
        const l = src < song.left.length ? song.left[src] : 0, r = src < song.right.length ? song.right[src] : 0;
        pcm[k * 2] = Math.max(-32768, Math.min(32767, Math.round(l * gain * 32767)));
        pcm[k * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r * gain * 32767)));
      }
      audioDone = target;
      const frames = await aac.encode(pcm);
      mp4.addAudio(frames, audioFrames);
      audioFrames += frames.length;
    }
    if (last) {
      const rest = await aac.close();
      mp4.addAudio(rest, audioFrames);
      audioFrames += rest.length;
    }
  };

  // ── Shots ──
  const shots = s.plan.shots.map((sh, i) => ({ ...sh, end: i + 1 < s.plan.shots.length ? s.plan.shots[i + 1].at : W0 + length }));
  const changes = [...(s.plan.changes ?? [])].sort((a, b) => a.at - b.at);
  let frame = 0, lastYield = performance.now();
  let hash = 0x811c9dc5;
  const hashPx = opts.hashFrames ? new Uint8Array(OW * OH * 4) : null;
  const hashes: string[] = [];
  const rateStart = { t: performance.now(), f: 0 };
  const report = (stage: ExportProgress['stage'], shot: number): void => {
    const el = (performance.now() - rateStart.t) / 1000;
    const rate = el > 0.5 ? (frame - rateStart.f) / el : 0;
    onProgress({ stage, frame, total, rate, eta: rate > 0 ? (total - frame) / rate : 0, shot, shots: shots.length });
  };
  const source = await WasmFrameSource.create();
  try {
    for (const [n, sh] of shots.entries()) {
      const k0 = Math.max(0, Math.round((sh.at - W0) * fps)), k1 = Math.min(total, Math.round((sh.end - W0) * fps));
      if (k1 <= k0) continue;
      // A fresh engine per shot (as the studio's page per shot): the same plan always gives the same frames.
      const canvas = document.createElement('canvas');
      canvas.width = RW; canvas.height = RH;
      const r = initRenderer(canvas, { autoStart: false, preserveDrawingBuffer: true, seed: SEED, fixedSize: true, offline: true, initialStyle: sh.style as StyleId });
      try {
        r.camera.portraitFraming = s.portrait && RH > RW ? 1 : 0;
        r.setQuality('high');
        r.setLightMode('auto');
        applyShot(r, sh, s.albumPalette, false);
        const unsub = source.subscribe((f) => r.pushFrame(f));
        source.loadOffline(song.mono, sr);
        const tStart = W0 + k0 / fps;
        const warm = Math.min(WARM_S, tStart);
        source.stepOffline(tStart - warm);
        report('warming', n);
        const warmSteps = Math.round(warm * fps);
        for (let k = 0; k < warmSteps; k++) {
          if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
          source.stepOffline(dt); r.step(dt);
          if (performance.now() - lastYield > YIELD_MS) { await yieldNow(); lastYield = performance.now(); }
        }
        const mine = changes.filter((c) => c.at > tStart && c.at < W0 + k1 / fps);
        for (let k = k0; k < k1; k++) {
          if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
          const now = W0 + (k + 1) / fps;
          while (mine.length && mine[0].at <= now) {
            const c = mine.shift()! as { palette?: PalettePick; variant?: string; depth?: boolean };
            if (c.palette !== undefined) applyPalette(r, c.palette, s.albumPalette);
            if (c.variant) r.setVariant(c.variant);
            if (c.depth !== undefined) r.setDepth(c.depth);
          }
          source.stepOffline(dt);
          r.step(dt);
          const t = k / fps;
          g.drawImage(canvas, 0, 0, OW, OH);
          overlay.draw(g, t);
          if (hashPx) {
            // Hash what the encoder gets (a VideoFrame of the composite). getImageData would make the
            // browser move the canvas to CPU drawing part-way through, which itself changes the pixels.
            const vf = new VideoFrame(comp, { timestamp: 0, alpha: 'discard' });
            await vf.copyTo(hashPx, { format: 'RGBA' } as VideoFrameCopyToOptions);
            vf.close();
            const px = hashPx;
            let fh = 0x811c9dc5;
            for (let i = 0; i < px.length; i += 61) { fh ^= px[i]; fh = Math.imul(fh, 0x01000193) >>> 0; }
            hashes.push(fh.toString(16));
            hash = Math.imul(hash ^ fh, 0x01000193) >>> 0;
          }
          await encodeAudioTo(t + AUDIO_AHEAD_S);
          await mp4.addFrame(comp, t, dt);
          frame++;
          if (frame % 6 === 0) report('rendering', n);
          if (performance.now() - lastYield > YIELD_MS) { await yieldNow(); lastYield = performance.now(); }
        }
        unsub();
      } finally {
        r.stop();
        canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
      }
    }
    report('finishing', shots.length - 1);
    await encodeAudioTo(length, true);
    const out = await mp4.finish();
    return {
      path: sink.path, bytes: out.bytes, frames: out.videoFrames, seconds: length, wallSeconds: (performance.now() - t0) / 1000,
      codec: mp4.config.codec, hardware: mp4.config.hardwareAcceleration ?? 'no-preference',
      frameHash: hashPx ? hash.toString(16) : undefined,
      frameHashes: hashPx ? hashes : undefined,
    };
  } catch (e) {
    await mp4.abort();
    throw e;
  }
}

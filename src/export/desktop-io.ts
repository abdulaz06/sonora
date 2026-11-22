/**
 * Desktop bridges for exports and recordings: files in Videos\sonora (Rust
 * writes the muxer's bytes at their positions) and Windows' AAC encoder.
 * Loaded only in the desktop app.
 */

import { invoke } from '@tauri-apps/api/core';
import { unpackFrames, type AacStream, type Sink } from './mp4';

export interface Opened { id: number; path: string; free: number }

/** A new file in Videos\sonora (a free name is chosen). */
export async function desktopSink(name: string, ext = 'mp4'): Promise<Sink & { free: number }> {
  const o = await invoke<Opened>('out_open', { name, ext });
  return {
    path: o.path,
    free: o.free,
    write: (data, position) => invoke<void>('out_write', data, { headers: { 'x-id': String(o.id), 'x-pos': String(position) } }),
    close: () => invoke<number>('out_close', { id: o.id }),
    abort: () => invoke<void>('out_abort', { id: o.id }),
  };
}

export const freeBytes = (): Promise<number> => invoke<number>('out_free');
export const revealFile = (path: string): Promise<void> => invoke<void>('out_reveal', { path });

export interface AacEncoder extends AacStream {
  /** Interleaved 16-bit PCM in → AAC frames out (1024 samples each). */
  encode(pcm: Int16Array): Promise<Uint8Array[]>;
  close(): Promise<Uint8Array[]>;
}

/** Windows' AAC encoder (Media Foundation): 44.1 / 48 kHz, 1–2 channels, 96–192 kbps. */
export async function openAac(sampleRate: number, channels: number, kbps = 192): Promise<AacEncoder> {
  const o = await invoke<{ id: number; asc: number[]; sampleRate: number; channels: number }>('aac_open', { sampleRate, channels, kbps });
  return {
    sampleRate: o.sampleRate,
    channels: o.channels,
    asc: new Uint8Array(o.asc),
    // Measured: the encoder's frames line up with the input (an impulse at sample n decodes at n).
    delay: 0,
    encode: async (pcm) => unpackFrames(await invoke<ArrayBuffer>('aac_encode', new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), { headers: { 'x-id': String(o.id) } })),
    close: async () => unpackFrames(await invoke<ArrayBuffer>('aac_close', { id: o.id })),
  };
}

export interface RecStarted { startClock: number; clockRate: number; sampleRate: number; asc: number[] }
export const recStart = (): Promise<RecStarted> => invoke<RecStarted>('rec_start');
export const recPull = async (): Promise<Uint8Array[]> => unpackFrames(await invoke<ArrayBuffer>('rec_pull'));
export const recStop = (): Promise<{ endClock: number; dropped: number }> => invoke('rec_stop');
export const recEnd = (): Promise<void> => invoke<void>('rec_end');

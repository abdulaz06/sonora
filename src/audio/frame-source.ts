/**
 * Where analysis frames come from. The renderer never cares: both the Tauri
 * desktop pipeline (WASAPI → Rust → IPC) and the browser pipeline (Web Audio →
 * AudioWorklet → WASM) deliver identical `AudioFeatureFrame`s through this
 * interface, one per 1/60 s of audio, in order.
 */

import type { AudioFeatureFrame } from '../types/audio-frame';

export type FrameListener = (frame: AudioFeatureFrame) => void;

export interface FrameSource {
  readonly kind: 'tauri' | 'wasm';
  /** Subscribe to every frame. Returns an unsubscribe function. */
  subscribe(listener: FrameListener): () => void;
  /** Begin delivering frames. */
  start(): Promise<void>;
  /** Stop delivering frames and release audio resources. */
  stop(): void;
}

/** Small helper shared by implementations. */
export class FrameHub {
  private listeners: FrameListener[] = [];
  subscribe(l: FrameListener): () => void {
    this.listeners.push(l);
    return () => { this.listeners = this.listeners.filter((x) => x !== l); };
  }
  emit(frame: AudioFeatureFrame): void {
    for (const l of this.listeners) l(frame);
  }
}

/**
 * Desktop frame source: the Rust pipeline (WASAPI loopback → sonora-dsp)
 * emits `audio-frame` events over Tauri IPC.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { AudioFeatureFrame } from '../types/audio-frame';
import { FrameHub, type FrameListener, type FrameSource } from './frame-source';

export class TauriFrameSource implements FrameSource {
  readonly kind = 'tauri' as const;
  private hub = new FrameHub();
  private unlisten: UnlistenFn | null = null;

  subscribe(listener: FrameListener): () => void {
    return this.hub.subscribe(listener);
  }

  async start(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<AudioFeatureFrame>('audio-frame', (event) => {
      this.hub.emit(event.payload);
    });
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
  }
}

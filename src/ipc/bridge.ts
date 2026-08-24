import { listen } from '@tauri-apps/api/event';
import type { AudioFeatureFrame } from '../types/audio-frame';

export type FrameCallback = (frame: AudioFeatureFrame) => void;

export async function listenAudioFrame(
  callback: FrameCallback
): Promise<() => void> {
  return listen<AudioFeatureFrame>('audio-frame', (event) => {
    callback(event.payload);
  });
}

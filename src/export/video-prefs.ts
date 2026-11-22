/**
 * Preferences shared by exports and recordings (the mark's corner, the outro)
 * and the recording's own (size, frame rate). Kept in local storage: the app's
 * settings file stays as it is, and the controller window (same origin) sees
 * the same values.
 */

import type { Corner } from './overlay';
import type { RecPreset } from './recorder';

const KEY = 'sonora.video.v1';

export interface VideoPrefs { corner: Corner; outro: boolean; recPreset: RecPreset; recFps: 30 | 60 }
const DEFAULTS: VideoPrefs = { corner: 'br', outro: true, recPreset: 'output', recFps: 60 };

export function videoPrefs(): VideoPrefs {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VideoPrefs>) }; } catch { return { ...DEFAULTS }; }
}

export function setVideoPrefs(p: Partial<VideoPrefs>): VideoPrefs {
  const next = { ...videoPrefs(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

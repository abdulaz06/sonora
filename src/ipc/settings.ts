/**
 * Persistent user settings — loaded once at startup, then saved
 * (debounced) on every change. Backed by a JSON file in the OS app data
 * directory; the Rust side just shuttles the blob in/out (see
 * `src-tauri/src/config/settings.rs`).
 */

import { invoke } from '@tauri-apps/api/core';

import type { QualityPreset, StyleId } from '../ui/settings-panel';

export interface PersistedSettings {
  /** Active visual style. */
  mode: StyleId;
  /** Last-selected variant per mode (so switching modes restores correctly). */
  variants: Partial<Record<StyleId, string>>;
  /** Selected palette index (0..PALETTES.length-1), or -1 for custom. */
  paletteIndex: number;
  /** Custom hue (0–360); active when paletteIndex === -1. */
  customHue: number;
  /** 0 = smooth, 1 = punchy. */
  responsiveness: number;
  /** Quality preset. */
  quality: QualityPreset;
  /** Concentric shape count (Aura mode). */
  ringCount: number;
  /** Capture source: `'default'` follows the system default and auto-switches
   *  when it changes; any other string pins to that device id. */
  audioDevice: string;
  /** Window position + size, restored on next launch. */
  window: {
    width: number;
    height: number;
    x: number | null;
    y: number | null;
  };
  /** Was the app fullscreen when it last closed? */
  fullscreen: boolean;
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  mode: 'aura',
  variants: {},
  paletteIndex: 0,
  customHue: 200,
  responsiveness: 0.6,
  quality: 'medium',
  ringCount: 3,
  audioDevice: 'default',
  window: {
    width: 1280,
    height: 800,
    x: null,
    y: null,
  },
  fullscreen: false,
};

/** Load saved settings from disk; returns DEFAULT_SETTINGS if none exist. */
export async function loadSettings(): Promise<PersistedSettings> {
  try {
    const raw = await invoke<unknown>('load_settings');
    if (raw === null || raw === undefined) {
      return { ...DEFAULT_SETTINGS };
    }
    return mergeWithDefaults(raw);
  } catch (err) {
    console.warn('Failed to load settings, using defaults:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist settings to disk (no debounce — caller does that). */
async function writeSettings(settings: PersistedSettings): Promise<void> {
  try {
    await invoke('save_settings', { settings });
  } catch (err) {
    console.warn('Failed to save settings:', err);
  }
}

/**
 * Debounced save. Calls coalesce within `delayMs` so dragging a slider
 * produces one disk write at the end, not 60 per second.
 */
export function createSettingsSaver(delayMs = 500): {
  scheduleSave: (settings: PersistedSettings) => void;
  flush: () => Promise<void>;
} {
  let timer: number | null = null;
  let pending: PersistedSettings | null = null;

  function scheduleSave(settings: PersistedSettings): void {
    pending = settings;
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = null;
      const snapshot = pending;
      pending = null;
      if (snapshot) void writeSettings(snapshot);
    }, delayMs);
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      const snapshot = pending;
      pending = null;
      await writeSettings(snapshot);
    }
  }

  return { scheduleSave, flush };
}

/** Validate / fill in missing fields when loading. Tolerant of partial JSON. */
function mergeWithDefaults(raw: unknown): PersistedSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  const out: PersistedSettings = { ...DEFAULT_SETTINGS };

  if (typeof r.mode === 'string' && (r.mode === 'aura' || r.mode === 'halo' || r.mode === 'flow-ink')) {
    out.mode = r.mode;
  }
  if (r.variants && typeof r.variants === 'object') {
    const v = r.variants as Record<string, unknown>;
    const variants: Partial<Record<StyleId, string>> = {};
    for (const k of ['aura', 'halo', 'flow-ink'] as StyleId[]) {
      const val = v[k];
      if (typeof val === 'string') variants[k] = val;
    }
    out.variants = variants;
  }
  if (typeof r.paletteIndex === 'number' && Number.isFinite(r.paletteIndex)) {
    out.paletteIndex = r.paletteIndex;
  }
  if (typeof r.customHue === 'number' && Number.isFinite(r.customHue)) {
    out.customHue = clamp(r.customHue, 0, 360);
  }
  if (typeof r.responsiveness === 'number' && Number.isFinite(r.responsiveness)) {
    out.responsiveness = clamp(r.responsiveness, 0, 1);
  }
  if (r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') {
    out.quality = r.quality;
  }
  if (typeof r.ringCount === 'number' && Number.isFinite(r.ringCount)) {
    out.ringCount = clamp(Math.round(r.ringCount), 2, 10);
  }
  if (typeof r.audioDevice === 'string' && r.audioDevice.length > 0) {
    out.audioDevice = r.audioDevice;
  }
  if (r.window && typeof r.window === 'object') {
    const w = r.window as Record<string, unknown>;
    out.window = {
      width: typeof w.width === 'number' && Number.isFinite(w.width) ? Math.max(640, Math.round(w.width)) : DEFAULT_SETTINGS.window.width,
      height: typeof w.height === 'number' && Number.isFinite(w.height) ? Math.max(400, Math.round(w.height)) : DEFAULT_SETTINGS.window.height,
      x: typeof w.x === 'number' && Number.isFinite(w.x) ? Math.round(w.x) : null,
      y: typeof w.y === 'number' && Number.isFinite(w.y) ? Math.round(w.y) : null,
    };
  }
  if (typeof r.fullscreen === 'boolean') {
    out.fullscreen = r.fullscreen;
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Persistent user settings — loaded once at startup, then saved
 * (debounced) on every change. Backed by a JSON file in the OS app data
 * directory; the Rust side just shuttles the blob in/out (see
 * `src-tauri/src/config/settings.rs`).
 */

import { invoke } from '@tauri-apps/api/core';

import { DEFAULT_CAMERA_VIEW, type CameraView } from '../engine/camera';
import { DEFAULT_DRIFT_PERIOD_S, MAX_DRIFT_PERIOD_S, MIN_DRIFT_PERIOD_S } from '../engine/color-engine';
import type { QualityPreset } from '../engine/quality';
import { DEFAULT_STYLE, isStyleId, STYLES } from '../styles/registry';
import type { LightMode, StyleId } from '../styles/visual-style';

/** Bump when a default changes in a way saved settings must not override. */
export const SETTINGS_VERSION = 3;

export interface PersistedSettings {
  /** Schema version (see SETTINGS_VERSION). */
  settingsVersion: number;
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
  /** Quality preset (`auto` adapts to frame time). */
  quality: QualityPreset;
  /** Show Aura / Halo in the style picker. */
  showClassic: boolean;
  /** Slow hue rotation on top of the palette. */
  autoDrift: boolean;
  /** Seconds per full Auto Drift hue cycle. */
  driftPeriod: number;
  /** Per-style background preference. */
  lightModes: Partial<Record<StyleId, LightMode>>;
  /** Per-style depth (3D) view preference. */
  depth: Partial<Record<StyleId, boolean>>;
  /** Depth-view camera: height, tilt, curvature. */
  camera: CameraView;
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
  settingsVersion: SETTINGS_VERSION,
  mode: DEFAULT_STYLE,
  variants: {},
  paletteIndex: 0,
  customHue: 200,
  responsiveness: 0.6,
  quality: 'medium',
  showClassic: false,
  autoDrift: false,
  driftPeriod: DEFAULT_DRIFT_PERIOD_S,
  lightModes: {},
  depth: {},
  camera: { ...DEFAULT_CAMERA_VIEW },
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
export function mergeWithDefaults(raw: unknown): PersistedSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const r = raw as Record<string, unknown>;
  const out: PersistedSettings = { ...DEFAULT_SETTINGS };

  if (isStyleId(r.mode)) out.mode = r.mode;
  const ids = STYLES.map((d) => d.id);
  if (r.variants && typeof r.variants === 'object') {
    const v = r.variants as Record<string, unknown>;
    const variants: Partial<Record<StyleId, string>> = {};
    for (const k of ids) {
      const val = v[k];
      if (typeof val === 'string') variants[k] = val;
    }
    out.variants = variants;
  }
  if (typeof r.showClassic === 'boolean') out.showClassic = r.showClassic;
  // v3: Auto Drift defaults off (it made palettes look wrong); older saves reset it.
  const version = typeof r.settingsVersion === 'number' ? r.settingsVersion : 1;
  if (typeof r.autoDrift === 'boolean' && version >= 3) out.autoDrift = r.autoDrift;
  out.settingsVersion = SETTINGS_VERSION;
  if (typeof r.driftPeriod === 'number' && Number.isFinite(r.driftPeriod)) {
    out.driftPeriod = clamp(r.driftPeriod, MIN_DRIFT_PERIOD_S, MAX_DRIFT_PERIOD_S);
  }
  if (r.lightModes && typeof r.lightModes === 'object') {
    const lm = r.lightModes as Record<string, unknown>;
    const modes: Partial<Record<StyleId, LightMode>> = {};
    for (const k of ids) {
      const val = lm[k];
      if (val === 'auto' || val === 'dark' || val === 'light') modes[k] = val;
    }
    out.lightModes = modes;
  }
  if (r.depth && typeof r.depth === 'object') {
    const d = r.depth as Record<string, unknown>;
    const depth: Partial<Record<StyleId, boolean>> = {};
    for (const k of ids) if (typeof d[k] === 'boolean') depth[k] = d[k] as boolean;
    out.depth = depth;
  }
  if (r.camera && typeof r.camera === 'object') {
    const c = r.camera as Record<string, unknown>;
    const num = (v: unknown, lo: number, hi: number, d: number): number =>
      (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
    out.camera = {
      height: num(c.height, 0, 1, DEFAULT_CAMERA_VIEW.height),
      tilt: num(c.tilt, 0, 1, DEFAULT_CAMERA_VIEW.tilt),
      curve: num(c.curve, -1, 1, DEFAULT_CAMERA_VIEW.curve),
    };
  }
  // Classic styles stay selectable only while the classic group is shown.
  const desc = STYLES.find((d) => d.id === out.mode);
  if (desc?.category === 'classic' && !out.showClassic) out.mode = DEFAULT_STYLE;
  if (typeof r.paletteIndex === 'number' && Number.isFinite(r.paletteIndex)) {
    out.paletteIndex = r.paletteIndex;
  }
  if (typeof r.customHue === 'number' && Number.isFinite(r.customHue)) {
    out.customHue = clamp(r.customHue, 0, 360);
  }
  if (typeof r.responsiveness === 'number' && Number.isFinite(r.responsiveness)) {
    out.responsiveness = clamp(r.responsiveness, 0, 1);
  }
  if (r.quality === 'low' || r.quality === 'medium' || r.quality === 'high' || r.quality === 'auto') {
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

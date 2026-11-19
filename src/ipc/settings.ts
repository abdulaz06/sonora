/**
 * Persistent user settings — loaded once at startup, then saved
 * (debounced) on every change. Backed by a JSON file in the OS app data
 * directory; the Rust side just shuttles the blob in/out (see
 * `src-tauri/src/config/settings.rs`).
 */

import { invoke } from '@tauri-apps/api/core';

import { DEFAULT_CAMERA_VIEW, FLAT_ZOOM_MAX, FLAT_ZOOM_MIN, type CameraView } from '../engine/camera';
import { DEFAULT_DRIFT_PERIOD_S, MAX_DRIFT_PERIOD_S, MIN_DRIFT_PERIOD_S } from '../engine/color-engine';
import type { QualityPreset } from '../engine/quality';
import { DEFAULT_STYLE, isStyleId, STYLES } from '../styles/registry';
import type { LightMode, StyleId } from '../styles/visual-style';

/** Bump when a default changes in a way saved settings must not override. */
export const SETTINGS_VERSION = 7;

/** Settings each style keeps for itself (v5): changing one style never
 * changes another. Colours can be shared with `matchColours`. */
export interface StylePrefs {
  paletteIndex: number;
  customHue: number;
  autoDrift: boolean;
  driftPeriod: number;
  responsiveness: number;
  camera: CameraView;
  flatZoom: number;
}

/** Where the now-playing overlay sits. */
export type Corner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

/** Now playing (v6): the track your media player reports. */
export interface NowPlayingPrefs {
  /** Show the overlay on a track change and when the mouse moves. */
  show: boolean;
  position: Corner;
  /** Previous / play-pause / next buttons in the overlay. */
  controls: boolean;
}

/** Set Mode (v6): the autopilot that switches visuals with the music. */
export interface SetModePrefs {
  on: boolean;
  /** Pieces (catalog PIECES ids) it may choose; empty = all. */
  include: string[];
  /** Never switch more often than this (s). */
  minInterval: number;
  /** Change palettes too. */
  palettes: boolean;
}

export const SET_MODE_INTERVALS = [60, 120, 180, 300, 600] as const;

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
  /** Frame-rate cap: 0 = match the display (every refresh), -k = every k-th
   * refresh (display / k), > 0 = that many fps (v7; before, 60 was the default). */
  fpsCap: number;
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
  /** Flat-view zoom (1 = normal); kept apart from the Depth camera. */
  flatZoom: number;
  /** Per-style settings (the fields above mirror the active style's). */
  styles: Partial<Record<StyleId, StylePrefs>>;
  /** Use one set of colours (palette, custom hue, drift) for every style. */
  matchColours: boolean;
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
  // ── v6 ──
  /** Display name of the pinned output device (fallback when its id changes). */
  audioDeviceName: string;
  /** Skip the home menu and open the last visual. */
  openLastVisual: boolean;
  /** The first-run intro has been seen. */
  onboarded: boolean;
  /** Launch count (the launch moment shortens after the first few). */
  launches: number;
  nowPlaying: NowPlayingPrefs;
  setMode: SetModePrefs;
  /** Display used for fullscreen (monitor name); null = the one the window is on. */
  fullscreenMonitor: string | null;
  /** Check GitHub Releases for updates on launch. */
  checkUpdates: boolean;
  // ── v7 ──
  /** Frames-per-second readout in a corner (also the P key). */
  showFps: boolean;
  fpsCorner: Corner;
  /** Temporary A/B: Ink's behaviour before the smoothness fix (removed after sign-off). */
  inkLegacy: boolean;
}

/** Fixed frame-rate caps offered on every display (and 90, kept for older saves). */
export const COMMON_FPS_CAPS = [30, 60, 120, 144] as const;
const VALID_FIXED_CAPS = [30, 60, 90, 120, 144];
/** Divisor caps: every 2nd, 3rd (or 4th) display refresh. */
const DIVISOR_CAPS = [-2, -3, -4];

export interface FpsCapChoice {
  value: number;
  label: string;
  /** Frames land on an uneven number of refreshes on this display (judder). */
  uneven: boolean;
}

/** Display rate as a short label: 165, 82.5, 59.9 → 60. */
export function fpsLabel(fps: number): string {
  const r = Math.round(fps);
  return Math.abs(fps - r) < 0.15 ? String(r) : fps.toFixed(1);
}

/** Does a fixed cap pace evenly on a display of `hz` (a whole number of refreshes per frame)? */
export function capIsEven(cap: number, hz: number): boolean {
  if (cap <= 0 || hz <= 0) return true;
  const k = hz / cap;
  return Math.round(k) >= 1 && Math.abs(k - Math.round(k)) <= 0.04 * Math.round(k);
}

/**
 * Frame-rate choices for a display measured at `hz` (0 = not measured yet):
 * match display, its whole-number divisors (even pacing), then the common caps
 * (marked uneven when they don't divide the refresh). The current choice is
 * always included.
 */
export function fpsCapChoices(hz: number, current: number): FpsCapChoice[] {
  const out: FpsCapChoice[] = [{ value: 0, label: hz ? `match ${fpsLabel(hz)}` : 'match display', uneven: false }];
  const divisors = hz ? DIVISOR_CAPS.slice(0, hz >= 100 ? 2 : 1).map((k) => ({ value: k, fps: hz / -k })) : [];
  for (const d of divisors) if (d.fps >= 20) out.push({ value: d.value, label: fpsLabel(d.fps), uneven: false });
  for (const c of COMMON_FPS_CAPS) {
    // A common cap that equals a divisor already listed is not repeated.
    // Caps at or above the refresh are the same as matching it.
    if (divisors.some((d) => Math.abs(d.fps - c) < 0.5) || (hz && c > hz - 0.5)) continue;
    out.push({ value: c, label: String(c), uneven: !capIsEven(c, hz) });
  }
  if (!out.some((c) => c.value === current)) {
    out.push(current < 0
      ? { value: current, label: hz ? fpsLabel(hz / -current) : `1/${-current}`, uneven: false }
      : { value: current, label: String(current), uneven: !capIsEven(current, hz) });
  }
  return out;
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  settingsVersion: SETTINGS_VERSION,
  mode: DEFAULT_STYLE,
  variants: {},
  paletteIndex: 0,
  customHue: 200,
  responsiveness: 0.6,
  quality: 'medium',
  fpsCap: 0,
  showClassic: false,
  autoDrift: false,
  driftPeriod: DEFAULT_DRIFT_PERIOD_S,
  lightModes: {},
  depth: {},
  camera: { ...DEFAULT_CAMERA_VIEW },
  flatZoom: 1,
  styles: {},
  matchColours: false,
  ringCount: 3,
  audioDevice: 'default',
  window: {
    width: 1280,
    height: 800,
    x: null,
    y: null,
  },
  fullscreen: false,
  audioDeviceName: '',
  openLastVisual: false,
  onboarded: false,
  launches: 0,
  nowPlaying: { show: true, position: 'bottom-left', controls: true },
  setMode: { on: false, include: [], minInterval: 120, palettes: true },
  fullscreenMonitor: null,
  checkUpdates: true,
  showFps: false,
  fpsCorner: 'top-left',
  inkLegacy: false,
};

/** Load saved settings from disk; returns DEFAULT_SETTINGS if none exist. */
export async function loadSettings(): Promise<PersistedSettings> {
  try {
    const raw = await invoke<unknown>('load_settings');
    if (raw === null || raw === undefined) {
      return defaultSettings();
    }
    return mergeWithDefaults(raw);
  } catch (err) {
    console.warn('Failed to load settings, using defaults:', err);
    return defaultSettings();
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

/** v4 lineup: map retired style ids to their nearest successor. */
function migrateStyleId(mode: unknown, strandsVariant: unknown): unknown {
  switch (mode) {
    case 'flow-ink': case 'turing': case 'mosh': return 'ink';
    case 'strands': return strandsVariant === 'wisp' || strandsVariant === 'warp' ? strandsVariant : 'silk';
    case 'fractal': return 'voyage';
    default: return mode;
  }
}

/** Per-style maps saved under old ids (lightModes, depth). */
function renameKeys(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...m };
  if (out.ink === undefined && m['flow-ink'] !== undefined) out.ink = m['flow-ink'];
  if (out.silk === undefined && m.strands !== undefined) out.silk = m.strands;
  return out;
}

/** Validate / fill in missing fields when loading. Tolerant of partial JSON. */
export function mergeWithDefaults(raw: unknown): PersistedSettings {
  if (!raw || typeof raw !== 'object') return defaultSettings();
  const r = raw as Record<string, unknown>;
  const out: PersistedSettings = defaultSettings();

  const ids = STYLES.map((d) => d.id);
  const rawVariants = (r.variants && typeof r.variants === 'object' ? r.variants : {}) as Record<string, unknown>;
  const mode = migrateStyleId(r.mode, rawVariants.strands);
  if (isStyleId(mode)) out.mode = mode;
  if (r.variants && typeof r.variants === 'object') {
    const v: Record<string, unknown> = { ...rawVariants };
    // v4: Flow Ink became Ink and its "Ink" look became Glow.
    if (v.ink === undefined && typeof v['flow-ink'] === 'string') v.ink = v['flow-ink'] === 'ink' ? 'glow' : v['flow-ink'];
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
  if (typeof r.fpsCap === 'number' && (r.fpsCap === 0 || VALID_FIXED_CAPS.includes(r.fpsCap) || DIVISOR_CAPS.includes(r.fpsCap))) {
    // v7: the old default (60) judders on displays it doesn't divide (165 Hz);
    // it becomes "match display". Any other explicit choice is kept.
    out.fpsCap = version < 7 && r.fpsCap === 60 ? 0 : r.fpsCap;
  }
  if (typeof r.autoDrift === 'boolean' && version >= 3) out.autoDrift = r.autoDrift;
  out.settingsVersion = SETTINGS_VERSION;
  if (typeof r.driftPeriod === 'number' && Number.isFinite(r.driftPeriod)) {
    out.driftPeriod = clamp(r.driftPeriod, MIN_DRIFT_PERIOD_S, MAX_DRIFT_PERIOD_S);
  }
  if (r.lightModes && typeof r.lightModes === 'object') {
    const lm = renameKeys(r.lightModes as Record<string, unknown>);
    const modes: Partial<Record<StyleId, LightMode>> = {};
    for (const k of ids) {
      const val = lm[k];
      if (val === 'auto' || val === 'dark' || val === 'light') modes[k] = val;
    }
    out.lightModes = modes;
  }
  if (r.depth && typeof r.depth === 'object') {
    const d = renameKeys(r.depth as Record<string, unknown>);
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
  if (typeof r.flatZoom === 'number' && Number.isFinite(r.flatZoom)) out.flatZoom = clamp(r.flatZoom, FLAT_ZOOM_MIN, FLAT_ZOOM_MAX);
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
  if (typeof r.matchColours === 'boolean') out.matchColours = r.matchColours;
  const styles: Partial<Record<StyleId, StylePrefs>> = {};
  const rs = (r.styles && typeof r.styles === 'object' ? r.styles : null) as Record<string, unknown> | null;
  for (const id of ids) {
    const p = rs?.[id];
    // v5: before per-style settings, every style shared one set: start each
    // style from it so nobody loses their choices.
    styles[id] = parseStylePrefs(p, stylePrefsOf(out));
  }
  out.styles = styles;

  // ── v6 ──
  if (typeof r.audioDeviceName === 'string') out.audioDeviceName = r.audioDeviceName;
  // Before v6 the pinned device was saved by its display name.
  else if (version < 6 && out.audioDevice !== 'default') out.audioDeviceName = out.audioDevice;
  if (typeof r.openLastVisual === 'boolean') out.openLastVisual = r.openLastVisual;
  // Anyone upgrading from an earlier version has used Sonora already: no intro.
  out.onboarded = typeof r.onboarded === 'boolean' ? r.onboarded : version < 6;
  if (typeof r.launches === 'number' && Number.isFinite(r.launches)) out.launches = Math.max(0, Math.round(r.launches));
  else if (version < 6) out.launches = 10;
  const np = (r.nowPlaying && typeof r.nowPlaying === 'object' ? r.nowPlaying : {}) as Record<string, unknown>;
  out.nowPlaying = {
    show: typeof np.show === 'boolean' ? np.show : DEFAULT_SETTINGS.nowPlaying.show,
    position: np.position === 'bottom-left' || np.position === 'bottom-right' || np.position === 'top-left' || np.position === 'top-right'
      ? np.position : DEFAULT_SETTINGS.nowPlaying.position,
    controls: typeof np.controls === 'boolean' ? np.controls : DEFAULT_SETTINGS.nowPlaying.controls,
  };
  const sm = (r.setMode && typeof r.setMode === 'object' ? r.setMode : {}) as Record<string, unknown>;
  out.setMode = {
    on: typeof sm.on === 'boolean' ? sm.on : false,
    include: Array.isArray(sm.include) ? sm.include.filter((x): x is string => typeof x === 'string') : [],
    minInterval: typeof sm.minInterval === 'number' && Number.isFinite(sm.minInterval) ? clamp(Math.round(sm.minInterval), 30, 1800) : DEFAULT_SETTINGS.setMode.minInterval,
    palettes: typeof sm.palettes === 'boolean' ? sm.palettes : DEFAULT_SETTINGS.setMode.palettes,
  };
  if (typeof r.fullscreenMonitor === 'string' && r.fullscreenMonitor) out.fullscreenMonitor = r.fullscreenMonitor;
  if (typeof r.checkUpdates === 'boolean') out.checkUpdates = r.checkUpdates;
  // ── v7 ──
  if (typeof r.showFps === 'boolean') out.showFps = r.showFps;
  if (r.fpsCorner === 'bottom-left' || r.fpsCorner === 'bottom-right' || r.fpsCorner === 'top-left' || r.fpsCorner === 'top-right') out.fpsCorner = r.fpsCorner;
  if (typeof r.inkLegacy === 'boolean') out.inkLegacy = r.inkLegacy;
  return out;
}

/** A fresh copy of the defaults (nested objects not shared). */
export function defaultSettings(): PersistedSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as PersistedSettings;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** The active-style fields of a settings object, as style preferences. */
export function stylePrefsOf(s: PersistedSettings): StylePrefs {
  return {
    paletteIndex: s.paletteIndex, customHue: s.customHue, autoDrift: s.autoDrift, driftPeriod: s.driftPeriod,
    responsiveness: s.responsiveness, camera: { ...s.camera }, flatZoom: s.flatZoom,
  };
}

/** Defaults for a style nobody has configured yet. */
export function defaultStylePrefs(): StylePrefs {
  return stylePrefsOf(DEFAULT_SETTINGS);
}

function parseStylePrefs(raw: unknown, fallback: StylePrefs): StylePrefs {
  if (!raw || typeof raw !== 'object') return { ...fallback, camera: { ...fallback.camera } };
  const p = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number): number =>
    (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
  const c = (p.camera && typeof p.camera === 'object' ? p.camera : {}) as Record<string, unknown>;
  return {
    paletteIndex: typeof p.paletteIndex === 'number' && Number.isInteger(p.paletteIndex) ? p.paletteIndex : fallback.paletteIndex,
    customHue: num(p.customHue, 0, 360, fallback.customHue),
    autoDrift: typeof p.autoDrift === 'boolean' ? p.autoDrift : fallback.autoDrift,
    driftPeriod: num(p.driftPeriod, MIN_DRIFT_PERIOD_S, MAX_DRIFT_PERIOD_S, fallback.driftPeriod),
    responsiveness: num(p.responsiveness, 0, 1, fallback.responsiveness),
    camera: {
      height: num(c.height, 0, 1, fallback.camera.height),
      tilt: num(c.tilt, 0, 1, fallback.camera.tilt),
      curve: num(c.curve, -1, 1, fallback.camera.curve),
    },
    flatZoom: num(p.flatZoom, FLAT_ZOOM_MIN, FLAT_ZOOM_MAX, fallback.flatZoom),
  };
}

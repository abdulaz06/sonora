/**
 * The controller's stand-in for the output's Controller and Platform: the same
 * interfaces, so the existing settings sheet and UI kit run here unchanged.
 * Reads come from the mirrored state; every change is sent to the output,
 * which applies it and broadcasts the new state back to both windows (one
 * source of truth).
 */

import type { AlbumState } from '../app/album-colours';
import type { Controller, ShowOptions } from '../app/controller';
import { COMMIT_FIELDS, type Link, type RemoteAction, type RemoteCall, type RemoteState } from '../app/link';
import type { MediaAction, MonitorInfo, Platform } from '../app/platform';
import { audioStatus, nowPlaying, Store } from '../app/stores';
import type { CameraView } from '../engine/camera';
import type { QualityPreset } from '../engine/quality';
import type { Renderer } from '../engine/renderer';
import { defaultSettings, type PersistedSettings } from '../ipc/settings';
import { getStyle } from '../styles/registry';
import type { LightMode, StyleId } from '../styles/visual-style';

export interface Proxy {
  ctl: Controller;
  platform: Platform;
  /** The last state from the output (null until it answers). */
  state: Store<RemoteState | null>;
  act(a: RemoteAction): void;
  /** Covers by key (sent once each). */
  art(key: string): string;
}

export function createProxy(link: Link, desktop: { listDevices?: Platform['listDevices']; listMonitors?: () => Promise<MonitorInfo[]> } = {}): Proxy {
  // The settings object the screens hold on to: updated in place from the output.
  const settings: PersistedSettings = defaultSettings();
  const state = new Store<RemoteState | null>(null);
  const album = new Store<AlbumState>({ status: 'none', art: '', palette: null });
  const arts = new Map<string, string>();
  const listeners: ((s: PersistedSettings) => void)[] = [];
  const fsListeners: ((fs: boolean) => void)[] = [];

  const call = (m: RemoteCall, ...a: unknown[]): void => link.send({ t: 'call', m, a });
  const act = (a: RemoteAction): void => link.send({ t: 'act', act: a });
  const artOf = (key: string): string => (key ? arts.get(key) ?? '' : '');

  link.on((msg) => {
    if (msg.t === 'art') { arts.set(msg.key, msg.art); apply(); return; }
    if (msg.t === 'level') { audioStatus.patch({ level: msg.v }); return; }
    if (msg.t === 'bye') { state.set(null); return; }
    if (msg.t !== 'state') return;
    const prev = state.get();
    for (const k of Object.keys(msg.s.settings) as (keyof PersistedSettings)[]) (settings as unknown as Record<string, unknown>)[k] = msg.s.settings[k];
    state.set(msg.s);
    if (prev?.fullscreen !== msg.s.fullscreen) for (const l of fsListeners) l(msg.s.fullscreen);
    apply();
    for (const l of listeners) l(settings);
  });

  // Mirror the output's stores into this window's (the screens read them).
  function apply(): void {
    const s = state.get();
    if (!s) return;
    const a = s.album;
    album.set({ status: a.status, art: artOf(a.artKey), palette: a.palette });
    nowPlaying.set(s.np ? { ...s.np, art: artOf(s.np.artKey) } : null);
    audioStatus.patch({ ...s.audio });
  }

  const variantFor = (id: StyleId): string => {
    const d = getStyle(id);
    const v = settings.variants[id];
    return v && d.variants.some((x) => x.id === v) ? v : d.defaultVariant;
  };
  const depthFor = (id: StyleId): boolean => settings.depth[id] ?? getStyle(id).defaultDepth;

  // Only what the settings sheet asks of the renderer.
  const renderer = { displayHz: () => state.get()?.displayHz ?? 0 } as unknown as Renderer;

  const ctl: Controller = {
    settings,
    renderer,
    album,
    onFrame: () => undefined,
    onLevel: () => () => undefined,
    subscribe(cb) { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
    commit() {
      const patch: Record<string, unknown> = {};
      for (const k of COMMIT_FIELDS) patch[k] = settings[k];
      link.send({ t: 'commit', patch });
    },
    variantFor,
    depthFor,
    depthActive: () => getStyle(settings.mode).supportsDepth && depthFor(settings.mode),
    show: (id: StyleId, o?: ShowOptions) => call('show', id, o ?? {}),
    setVariant: (v: string) => call('setVariant', v),
    setDepth: (on: boolean) => call('setDepth', on),
    setLightMode: (m: LightMode) => call('setLightMode', m),
    setShowClassic: (on: boolean) => call('setShowClassic', on),
    setRingCount: (n: number) => call('setRingCount', n),
    setCamera: (v: CameraView) => call('setCamera', v),
    setFlatZoom: (z: number) => call('setFlatZoom', z),
    setMatchColours: (on: boolean) => call('setMatchColours', on),
    setPalette: (i: number) => call('setPalette', i),
    setCustomHue: (h: number) => call('setCustomHue', h),
    setAlbumColours: (on: boolean) => call('setAlbumColours', on),
    setGlow: (g: number) => call('setGlow', g),
    setBlackout: (on: boolean) => call('setBlackout', on),
    isBlackout: () => state.get()?.blackout ?? false,
    setFrozen: (on: boolean) => call('setFrozen', on),
    setAutoDrift: (on: boolean) => call('setAutoDrift', on),
    setDriftPeriod: (s: number) => call('setDriftPeriod', s),
    setResponsiveness: (t: number) => call('setResponsiveness', t),
    setQuality: (q: QualityPreset) => call('setQuality', q),
    setFpsCap: (n: number) => call('setFpsCap', n),
    setShowFps: (on: boolean) => call('setShowFps', on),
    cycleCameraPreset: () => call('cycleCameraPreset'),
    toggleDebug: () => undefined,
    setCanvasInput: () => undefined,
  };

  const platform: Platform = {
    get kind() { return state.get()?.platform ?? 'desktop'; },
    get version() { return state.get()?.version ?? ''; },
    listDevices: desktop.listDevices ?? (async () => []),
    setDevice: (id, name) => act({ a: 'setDevice', id, name }),
    toggleFullscreen: () => act({ a: 'toggleFullscreen' }),
    isFullscreen: () => state.get()?.fullscreen ?? false,
    onFullscreenChange: (cb) => { fsListeners.push(cb); cb(state.get()?.fullscreen ?? false); },
    listMonitors: desktop.listMonitors ?? (async () => state.get()?.monitors ?? []),
    mediaControl: (a: MediaAction) => act({ a: 'media', v: a }),
    checkForUpdate: async () => null,
  };

  return { ctl, platform, state, act, art: artOf };
}

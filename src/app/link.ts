/**
 * The link between the output (the window showing the visual) and the
 * controller (the remote on a second screen, D84). One source of truth: the
 * output owns every setting and the engine; the controller mirrors the state
 * it broadcasts and sends calls back. Both windows share an origin, so a
 * BroadcastChannel carries it (two Tauri windows share one WebView2
 * environment; on the web, two tabs). Preview frames travel on their own
 * channel, straight from the output's encoder worker.
 */

import type { AlbumStatus } from './album-colours';
import type { Palette } from '../engine/color-engine';
import type { PersistedSettings } from '../ipc/settings';
import type { AudioStatus, MediaInfo } from './stores';
import type { MonitorInfo } from './platform';

export const LINK_CHANNEL = 'sonora-link';
export const PREVIEW_CHANNEL = 'sonora-preview';

/** The controller pings this often (ms); the output drops it (and stops the
 * preview) after LINK_TIMEOUT_MS of silence. */
export const PING_MS = 1000;
export const LINK_TIMEOUT_MS = 3500;

/** Controller methods the remote may call on the output's controller. */
export const REMOTE_CALLS = [
  'show', 'setVariant', 'setDepth', 'setLightMode', 'setShowClassic', 'setRingCount', 'setCamera', 'setFlatZoom',
  'setMatchColours', 'setPalette', 'setCustomHue', 'setAlbumColours', 'setAutoDrift', 'setDriftPeriod',
  'setResponsiveness', 'setGlow', 'setQuality', 'setFpsCap', 'setShowFps', 'setFilter', 'setBlackout', 'setFrozen', 'cycleCameraPreset',
] as const;
export type RemoteCall = typeof REMOTE_CALLS[number];

/** Settings fields the remote may change directly and commit (the same ones
 * the settings sheet edits in place); everything else goes through calls. */
export const COMMIT_FIELDS = ['setMode', 'nowPlaying', 'openLastVisual', 'fullscreenMonitor', 'checkUpdates', 'fpsCorner', 'controllerOffered'] as const;
export type CommitField = typeof COMMIT_FIELDS[number];

export type RemoteAction =
  | { a: 'setSetMode'; on: boolean }
  | { a: 'switchNow' }
  | { a: 'goVisual' }
  | { a: 'goMenu' }
  | { a: 'toggleFullscreen' }
  | { a: 'moveOutput'; monitor: string }
  | { a: 'media'; v: 'prev' | 'playpause' | 'next' }
  | { a: 'setDevice'; id: string; name: string }
  | { a: 'key'; key: string }
  | { a: 'record' };

export interface RemoteState {
  settings: PersistedSettings;
  album: { status: AlbumStatus; artKey: string; palette: Palette | null };
  np: (Omit<MediaInfo, 'art'> & { artKey: string }) | null;
  audio: Omit<AudioStatus, 'level'>;
  blackout: boolean;
  frozen: boolean;
  fullscreen: boolean;
  screen: string;
  displayHz: number;
  version: string;
  platform: 'desktop' | 'web';
  /** Displays and the one the output is on (desktop). */
  monitors: MonitorInfo[];
  outputMonitor: string;
  /** Recording (desktop; null where there's none). */
  rec: { state: string; elapsed: number } | null;
}

export type LinkMsg =
  | { t: 'hello' }
  | { t: 'ping' }
  | { t: 'state'; s: RemoteState }
  | { t: 'art'; key: string; art: string }
  | { t: 'level'; v: number }
  | { t: 'call'; m: RemoteCall; a: unknown[] }
  | { t: 'commit'; patch: Partial<Pick<PersistedSettings, CommitField>> }
  | { t: 'act'; act: RemoteAction }
  | { t: 'bye' };

/** A preview frame from the output's encoder worker. */
export interface PreviewMsg {
  t: 'frame';
  blob: Blob;
  w: number;
  h: number;
  /** Capture time, ms since the epoch (performance.timeOrigin + now), for latency. */
  at: number;
  seq: number;
  /** Rows are bottom-up (a readPixels capture): draw flipped. */
  flip: boolean;
}

export interface Link {
  send(m: LinkMsg): void;
  on(cb: (m: LinkMsg) => void): () => void;
  close(): void;
}

export function openLink(): Link {
  const ch = new BroadcastChannel(LINK_CHANNEL);
  const subs: ((m: LinkMsg) => void)[] = [];
  ch.onmessage = (e: MessageEvent<LinkMsg>) => { for (const s of subs) s(e.data); };
  return {
    send: (m) => ch.postMessage(m),
    on(cb) { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); }; },
    close: () => ch.close(),
  };
}

/** Wall-clock milliseconds comparable across windows. */
export const wallMs = (): number => performance.timeOrigin + performance.now();
